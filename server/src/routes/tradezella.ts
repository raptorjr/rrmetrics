import { Hono } from 'hono';
import type { Env, AuthContext } from '../bindings';
import { requiresLogin } from '../middleware/auth';
import { generateId } from '../utils/id';
import {
  matchTradeZellaRows,
  matchTradeZellaRowsAcrossAccounts,
  parseTradeZellaRows,
  summarizeTradeZellaAccounts,
  type TradeZellaRow,
} from '../services/TradeZellaImport';

type HonoEnv = { Bindings: Env; Variables: AuthContext };
type AccountSetting = {
  sourceAccountName: string;
  displayName: string;
  currencyCode: string;
  isEval: boolean;
  matchAccount: string | null;
};

const tradezella = new Hono<HonoEnv>();
const currencies = new Set(['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'CHF', 'JPY']);

function parseRows(body: any): TradeZellaRow[] | null {
  if (!Array.isArray(body?.rows) || body.rows.length === 0 || body.rows.length > 10_000) return null;
  return parseTradeZellaRows(body.rows);
}

function accountSettingsFromBody(value: unknown): AccountSetting[] | null {
  if (!Array.isArray(value)) return null;
  const result: AccountSetting[] = [];
  for (const item of value) {
    if (!item || typeof item.sourceAccountName !== 'string' || !item.sourceAccountName.trim()
      || typeof item.displayName !== 'string' || !item.displayName.trim()
      || typeof item.currencyCode !== 'string' || !currencies.has(item.currencyCode.toUpperCase())
      || typeof item.isEval !== 'boolean'
      || (item.matchAccount != null && typeof item.matchAccount !== 'string')) return null;
    result.push({
      sourceAccountName: item.sourceAccountName.trim(),
      displayName: item.displayName.trim(),
      currencyCode: item.currencyCode.toUpperCase(),
      isEval: item.isEval,
      matchAccount: typeof item.matchAccount === 'string' && item.matchAccount.trim() ? item.matchAccount.trim() : null,
    });
  }
  return result;
}

function existingRows(db: any, userId: string) {
  return db.prepare(
    `SELECT id, ticker, enter_time, exit_time, enter_price, exit_price, quantity, manual_pl, gross_pl, fees, commissions, account
     FROM trades WHERE user_id = ?`,
  ).all(userId) as Array<{
    id: string; ticker: string; enter_time: string; exit_time: string;
    enter_price: number; exit_price: number; quantity: number; manual_pl: number | null;
    gross_pl: number | null; fees: number; commissions: number; account: string | null;
  }>;
}

function reservedTradeIds(db: any, userId: string): Set<string> {
  const rows = db.prepare('SELECT DISTINCT trade_id FROM tradezella_imported_trades WHERE user_id = ?').all(userId) as Array<{ trade_id: string }>;
  return new Set(rows.map(row => row.trade_id));
}

function sourceMappings(db: any, userId: string, rows: TradeZellaRow[]) {
  const byAccount = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!byAccount.has(row.sourceAccount)) byAccount.set(row.sourceAccount, new Set());
    byAccount.get(row.sourceAccount)!.add(row.sourceFingerprint);
  }
  const result = new Map<string, string[]>();
  const query = db.prepare(
    `SELECT source_account_name, source_fingerprint, trade_id
     FROM tradezella_imported_trades
     WHERE user_id = ? AND source_account_name = ? AND source_fingerprint = ?`,
  );
  for (const [account, fingerprints] of byAccount) {
    for (const fingerprint of fingerprints) {
      const matches = query.all(userId, account, fingerprint) as Array<{ trade_id: string }>;
      if (matches.length) result.set(account + '|' + fingerprint, matches.map(row => row.trade_id));
    }
  }
  return result;
}


tradezella.get('/api/tradezella/accounts', requiresLogin, async (c) => {
  const user = c.get('user');
  const db = c.get('db');
  const accounts = db.prepare(
    `SELECT source_account_name AS sourceAccountName, display_name AS displayName,
            currency_code AS currencyCode, is_eval AS isEval, match_account AS matchAccount
     FROM tradezella_accounts WHERE user_id = ? ORDER BY source_account_name`,
  ).all(user.id);
  const rrAccounts = db.prepare('SELECT DISTINCT account FROM trades WHERE user_id = ? AND account IS NOT NULL AND account != \'\' ORDER BY account').all(user.id).map((row: any) => row.account);
  return c.json({ accounts, rrAccounts });
});

tradezella.post('/api/tradezella/accounts', requiresLogin, async (c) => {
  const user = c.get('user');
  const db = c.get('db');
  const body = await c.req.json();
  const accounts = accountSettingsFromBody(body.accounts);
  if (!accounts) return c.json({ error: 'Account names, display names, supported currencies and Eval settings are required.' }, 400);

  const upsert = db.prepare(
    `INSERT INTO tradezella_accounts (id, user_id, source_account_name, display_name, currency_code, is_eval, match_account)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, source_account_name) DO UPDATE SET
       display_name = excluded.display_name,
       currency_code = excluded.currency_code,
       is_eval = excluded.is_eval,
       match_account = excluded.match_account`,
  );
  const save = db.transaction(() => {
    for (const account of accounts) upsert.run(
      generateId(), user.id, account.sourceAccountName, account.displayName,
      account.currencyCode, account.isEval ? 1 : 0, account.matchAccount,
    );
  });
  save();
  return c.json({ saved: accounts.length });
});


tradezella.delete('/api/tradezella/accounts/:sourceAccountName', requiresLogin, async (c) => {
  const user = c.get('user');
  const db = c.get('db');
  const sourceAccountName = decodeURIComponent(c.req.param('sourceAccountName') || '').trim();
  if (!sourceAccountName) return c.json({ error: 'Source account name is required.' }, 400);

  try {
    let removedTrades = 0;
    let removedLinks = 0;
    const run = db.transaction(() => {
      // Only delete trades created by this importer. Matches that point to
      // existing Topstep/manual trades are unlinked, never deleted.
      const owned = db.prepare(
        `SELECT DISTINCT t.id FROM trades t
         INNER JOIN tradezella_imported_trades m ON m.trade_id = t.id
         WHERE m.user_id = ? AND m.source_account_name = ?
           AND t.user_id = ? AND t.tradovate_source = 'tradezella'`,
      ).all(user.id, sourceAccountName, user.id) as Array<{ id: string }>;
      for (const trade of owned) {
        db.prepare("DELETE FROM trades WHERE id = ? AND user_id = ? AND tradovate_source = 'tradezella'")
          .run(trade.id, user.id);
        removedTrades += 1;
      }
      const links = db.prepare(
        'SELECT COUNT(*) AS count FROM tradezella_imported_trades WHERE user_id = ? AND source_account_name = ?',
      ).get(user.id, sourceAccountName) as { count: number };
      removedLinks = Number(links?.count || 0);
      db.prepare('DELETE FROM tradezella_imported_trades WHERE user_id = ? AND source_account_name = ?')
        .run(user.id, sourceAccountName);
      db.prepare('DELETE FROM tradezella_accounts WHERE user_id = ? AND source_account_name = ?')
        .run(user.id, sourceAccountName);
    });
    run();
    return c.json({ deleted: true, sourceAccountName, removedTrades, removedLinks });
  } catch (error: any) {
    console.error('TradeZella account deletion error:', error);
    return c.json({ error: error?.message || 'Could not remove this TradeZella account.' }, 500);
  }
});

tradezella.post('/api/tradezella/preview', requiresLogin, async (c) => {
  const user = c.get('user');
  const db = c.get('db');
  const body = await c.req.json();
  const parsedRows = parseRows(body);
  if (!parsedRows?.length) return c.json({ error: 'No valid TradeZella trades found. Check the CSV columns and values.' }, 400);

  try {
    const reserved = reservedTradeIds(db, user.id);
    const allExisting = existingRows(db, user.id);
    const existing = allExisting.filter(trade => !reserved.has(trade.id));
    const mappings = sourceMappings(db, user.id, parsedRows);
    const unrecorded = parsedRows.filter(row => !mappings.has(row.sourceAccount + '|' + row.sourceFingerprint));
    const savedAccounts = new Map((db.prepare(
      `SELECT source_account_name, display_name, currency_code, is_eval, match_account
       FROM tradezella_accounts WHERE user_id = ?`,
    ).all(user.id) as any[]).map(row => [row.source_account_name, row]));
    const matches: ReturnType<typeof matchTradeZellaRows> = [];
    for (const accountName of new Set<string>(unrecorded.map(row => row.sourceAccount))) {
      const saved = savedAccounts.get(accountName);
      const inferred = accountName === '150k XFA' ? '$150k Express' : accountName === '50k XFA' ? '$50k Express' : accountName === 'Practice' ? 'Practice' : null;
      const matchAccount = saved?.match_account ?? inferred;
      const accountRows = unrecorded.filter(row => row.sourceAccount === accountName);
      matches.push(...matchTradeZellaRowsAcrossAccounts(accountRows, existing, matchAccount, allExisting, unrecorded.filter(row => row.sourceAccount !== accountName)));
    }
    const resultsByRow = new Map<number, typeof matches[number]>();
    for (const match of matches) for (const sourceRow of match.sourceRows) resultsByRow.set(sourceRow, match);

    const accounts = summarizeTradeZellaAccounts(parsedRows).map(account => {
      const accountRows = parsedRows.filter(row => row.sourceAccount === account.accountName);
      const alreadyImported = accountRows.filter(row => mappings.has(row.sourceAccount + '|' + row.sourceFingerprint)).length;
      const newCount = accountRows.filter(row => resultsByRow.get(row.sourceRow)?.status === 'new').length;
      const needsReview = accountRows.filter(row => resultsByRow.get(row.sourceRow)?.status === 'review').length;
      const saved = savedAccounts.get(account.accountName);
      return {
        ...account,
        alreadyImported,
        matchedTrades: accountRows.filter(row => resultsByRow.get(row.sourceRow)?.status === 'matched').length,
        alreadyInRR: alreadyImported + accountRows.filter(row => resultsByRow.get(row.sourceRow)?.status === 'matched').length,
        newTrades: newCount,
        needsReview,
        displayName: saved?.display_name || account.accountName,
        currencyCode: saved?.currency_code || 'USD',
        isEval: saved ? !!saved.is_eval : /eval|combine/i.test(account.accountName),
        matchAccount: saved?.match_account ?? (account.accountName === '150k XFA' ? '$150k Express' : account.accountName === '50k XFA' ? '$50k Express' : account.accountName === 'Practice' ? 'Practice' : ''),
      };
    });

    const matchesWithExisting = [
      ...parsedRows.filter(row => mappings.has(row.sourceAccount + '|' + row.sourceFingerprint)).map(row => ({
        status: 'matched' as const, sourceRows: [row.sourceRow],
        existingTradeIds: mappings.get(row.sourceAccount + '|' + row.sourceFingerprint)!,
        reason: 'Previously imported or linked source row',
      })),
      ...matches,
    ];
    return c.json({
      source: 'TradeZella', totalRows: body.rows.length, validTrades: parsedRows.length,
      skippedRows: body.rows.length - parsedRows.length, accounts, matches: matchesWithExisting,
    });
  } catch (error: any) {
    console.error('TradeZella preview error:', error);
    return c.json({ error: error?.message || 'Could not preview the TradeZella export.' }, 500);
  }
});

tradezella.post('/api/tradezella/import', requiresLogin, async (c) => {
  const user = c.get('user');
  const db = c.get('db');
  const body = await c.req.json();
  const parsedRows = parseRows(body);
  const settings = accountSettingsFromBody(body.accounts);
  const selectedAccounts = Array.isArray(body.selectedAccounts)
    ? body.selectedAccounts.filter((name: unknown): name is string => typeof name === 'string')
    : [];
  if (!parsedRows?.length || !settings || !selectedAccounts.length) {
    return c.json({ error: 'Select at least one account and provide its account settings.' }, 400);
  }
  const settingsBySource = new Map<string, AccountSetting>(settings.map(item => [item.sourceAccountName, item]));
  if (selectedAccounts.some((name: string) => !settingsBySource.has(name))) {
    return c.json({ error: 'Every selected source account must have account settings.' }, 400);
  }

  const selectedRows = parsedRows.filter(row => selectedAccounts.includes(row.sourceAccount));
  if (!selectedRows.length) return c.json({ error: 'No valid trades found for the selected accounts.' }, 400);

  try {
    const mappings = sourceMappings(db, user.id, selectedRows);
    const unrecorded = selectedRows.filter(row => !mappings.has(row.sourceAccount + '|' + row.sourceFingerprint));
    const reserved = reservedTradeIds(db, user.id);
    const allCandidates = existingRows(db, user.id);
    const candidates = allCandidates.filter(trade => !reserved.has(trade.id));
    const selectedTargets = selectedAccounts.map((name: string) => settingsBySource.get(name)!.matchAccount).filter((name: string | null): name is string => Boolean(name));
    if (new Set(selectedTargets).size !== selectedTargets.length) return c.json({ error: 'Two selected TradeZella accounts cannot be matched against the same RR account.' }, 400);
    const matches = selectedAccounts.flatMap((accountName: string) => {
      const account = settingsBySource.get(accountName)!;
      const accountRows = unrecorded.filter(row => row.sourceAccount === accountName);
      return matchTradeZellaRowsAcrossAccounts(accountRows, candidates, account.matchAccount, allCandidates, unrecorded.filter(row => row.sourceAccount !== accountName));
    });
    const rowByNumber = new Map(unrecorded.map(row => [row.sourceRow, row]));
    const upsertAccount = db.prepare(
      `INSERT INTO tradezella_accounts (id, user_id, source_account_name, display_name, currency_code, is_eval, match_account)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, source_account_name) DO UPDATE SET
         display_name = excluded.display_name, currency_code = excluded.currency_code, is_eval = excluded.is_eval, match_account = excluded.match_account`,
    );
    const insertTrade = db.prepare(
      `INSERT INTO trades (id, user_id, ticker, enter_time, exit_time, enter_price, exit_price,
        quantity, manual_pl, gross_pl, fees, commissions, currency_code, is_eval, account,
        tradovate_source, created_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'tradezella', ?)`,
    );
    const insertMapping = db.prepare(
      `INSERT OR IGNORE INTO tradezella_imported_trades
       (id, user_id, source_account_name, source_fingerprint, source_row, trade_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );

    let imported = 0;
    let linked = 0;
    let review = 0;
    let alreadyImported = selectedRows.length - unrecorded.length;
    const run = db.transaction(() => {
      for (const accountName of selectedAccounts) {
        const account = settingsBySource.get(accountName)!;
        upsertAccount.run(generateId(), user.id, account.sourceAccountName, account.displayName,
          account.currencyCode, account.isEval ? 1 : 0, account.matchAccount);
      }

      for (const match of matches) {
        if (match.status === 'review') { review += match.sourceRows.length; continue; }
        if (match.status === 'matched') {
          for (const sourceRow of match.sourceRows) {
            const row = rowByNumber.get(sourceRow);
            if (!row) continue;
            for (const tradeId of match.existingTradeIds) {
              insertMapping.run(generateId(), user.id, row.sourceAccount, row.sourceFingerprint, row.sourceRow, tradeId);
            }
            linked += 1;
          }
          continue;
        }
        for (const sourceRow of match.sourceRows) {
          const row = rowByNumber.get(sourceRow);
          if (!row) continue;
          const account = settingsBySource.get(row.sourceAccount)!;
          const tradeId = generateId();
          insertTrade.run(tradeId, user.id, row.ticker, row.enterTime, row.exitTime,
            row.enterPrice, row.exitPrice, row.quantity, row.manualPL, row.grossPL,
            row.fees, row.commissions, account.currencyCode, account.isEval ? 1 : 0,
            account.displayName, new Date().toISOString());
          insertMapping.run(generateId(), user.id, row.sourceAccount, row.sourceFingerprint, row.sourceRow, tradeId);
          imported += 1;
        }
      }
    });
    run();

    return c.json({ imported, linked, needsReview: review, alreadyImported, selectedAccounts });
  } catch (error: any) {
    console.error('TradeZella import error:', error);
    return c.json({ error: error?.message || 'TradeZella import failed.' }, 500);
  }
});

export default tradezella;
