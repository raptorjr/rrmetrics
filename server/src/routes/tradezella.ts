import { Hono } from 'hono';
import type { Env, AuthContext } from '../bindings';
import { requiresLogin } from '../middleware/auth';
import {
  matchTradeZellaRows,
  parseTradeZellaRows,
  summarizeTradeZellaAccounts,
} from '../services/TradeZellaImport';

type HonoEnv = {
  Bindings: Env;
  Variables: AuthContext;
};

const tradezella = new Hono<HonoEnv>();

tradezella.post('/api/tradezella/preview', requiresLogin, async (c) => {
  const user = c.get('user');
  const db = c.get('db');
  const body = await c.req.json();

  if (!Array.isArray(body.rows) || body.rows.length === 0) {
    return c.json({ error: 'A non-empty TradeZella CSV row array is required.' }, 400);
  }
  if (body.rows.length > 10_000) {
    return c.json({ error: 'TradeZella preview is limited to 10,000 CSV rows.' }, 400);
  }

  try {
    const parsedRows = parseTradeZellaRows(body.rows);
    if (parsedRows.length === 0) {
      return c.json({ error: 'No valid TradeZella trades were found. Check the CSV columns and values.' }, 400);
    }

    const existing = db.prepare(
      `SELECT id, ticker, enter_time, exit_time, enter_price, exit_price,
              quantity, manual_pl
       FROM trades
       WHERE user_id = ?`,
    ).all(user.id) as Array<{
      id: string;
      ticker: string;
      enter_time: string;
      exit_time: string;
      enter_price: number;
      exit_price: number;
      quantity: number;
      manual_pl: number | null;
    }>;

    // Match the complete file in one pass so one RR position cannot be claimed
    // independently by multiple TradeZella accounts in the same preview.
    const matches = matchTradeZellaRows(parsedRows, existing);
    const resultByRow = new Map<number, typeof matches[number]>();
    for (const match of matches) {
      for (const sourceRow of match.sourceRows) resultByRow.set(sourceRow, match);
    }

    const accounts = summarizeTradeZellaAccounts(parsedRows).map((account) => {
      const accountRows = parsedRows.filter((row) => row.sourceAccount === account.accountName);
      const accountMatches = accountRows.map((row) => resultByRow.get(row.sourceRow)).filter(Boolean);
      const matchedRows = accountMatches.filter((match) => match?.status === 'matched').length;
      const reviewRows = accountMatches.filter((match) => match?.status === 'review').length;
      return {
        ...account,
        matchedTrades: matchedRows,
        newTrades: accountRows.length - matchedRows - reviewRows,
        needsReview: reviewRows,
      };
    });

    return c.json({
      source: 'TradeZella',
      totalRows: body.rows.length,
      validTrades: parsedRows.length,
      skippedRows: body.rows.length - parsedRows.length,
      accounts,
      matches,
    });
  } catch (error: any) {
    console.error('TradeZella preview error:', error);
    return c.json({ error: error?.message || 'Could not preview the TradeZella export.' }, 500);
  }
});

export default tradezella;
