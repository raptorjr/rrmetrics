import { Hono } from 'hono';
import type { Env, AuthContext } from '../bindings';
import * as backtestingDb from '../db/backtesting';
import { readReplayChartSettings, saveReplayChartSettings, validateReplayChartSettings } from '../db/replay-chart-settings';
import * as replaySessions from '../db/replay-sessions';
import { requiresLogin } from '../middleware/auth';

type HonoEnv = {
  Bindings: Env;
  Variables: AuthContext;
};

const backtesting = new Hono<HonoEnv>();

// The implicit local profile, not a client-supplied ID, owns these preferences.
backtesting.get('/api/backtesting/chart-settings', requiresLogin, (c) => {
  try {
    return c.json({ settings: readReplayChartSettings(c.get('db'), c.get('user').id) });
  } catch (err) {
    console.error('Replay chart settings load failed:', err);
    return c.json({ error: 'Could not load trading settings.' }, 500);
  }
});
backtesting.put('/api/backtesting/chart-settings', requiresLogin, async (c) => {
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid trading settings.' }, 400); }
  const settings = validateReplayChartSettings(body);
  if (!settings) return c.json({ error: 'Invalid trading settings.' }, 400);
  try {
    saveReplayChartSettings(c.get('db'), c.get('user').id, settings);
    return c.json({ settings });
  } catch (err) {
    console.error('Replay chart settings save failed:', err);
    return c.json({ error: 'Could not save trading settings.' }, 500);
  }
});

// GET /api/backtesting/sessions — list all sessions with stats
backtesting.get('/api/backtesting/sessions', requiresLogin, async (c) => {
  const user = c.get('user');
  const db = c.get('db');
  try {
    const sessions = await backtestingDb.getSessionsWithStats(db, user.id);
    return c.json({ sessions });
  } catch (err) {
    console.error('getSessions error:', err);
    return c.json({ error: 'Failed to fetch sessions' }, 500);
  }
});

// POST /api/backtesting/sessions — start a new session
backtesting.post('/api/backtesting/sessions', requiresLogin, async (c) => {
  const user = c.get('user');
  const db = c.get('db');
  const body = await c.req.json();
  const { name, ticker, startDate } = body;

  if (!ticker || !startDate) {
    return c.json({ error: 'ticker and startDate are required' }, 400);
  }

  try {
    const session = await backtestingDb.createSession(db, user.id, { name, ticker, startDate });
    return c.json(session);
  } catch (err) {
    console.error('createSession error:', err);
    return c.json({ error: 'Failed to create session' }, 500);
  }
});

// POST /api/backtesting/sessions/:id/end — end a session
backtesting.post('/api/backtesting/sessions/:id/end', requiresLogin, async (c) => {
  const user = c.get('user');
  const db = c.get('db');
  const sessionId = c.req.param('id');
  const body = await c.req.json();
  const { endDate } = body;

  if (!endDate) {
    return c.json({ error: 'endDate is required' }, 400);
  }

  try {
    const session = await backtestingDb.endSession(db, user.id, sessionId, endDate);
    return c.json(session);
  } catch (err) {
    console.error('endSession error:', err);
    return c.json({ error: 'Failed to end session' }, 500);
  }
});

// POST /api/backtesting/sessions/:id/continue — re-activate a session
backtesting.post('/api/backtesting/sessions/:id/continue', requiresLogin, async (c) => {
  const user = c.get('user');
  const db = c.get('db');
  const sessionId = c.req.param('id');

  try {
    const session = await backtestingDb.continueSession(db, user.id, sessionId);
    return c.json(session);
  } catch (err) {
    console.error('continueSession error:', err);
    return c.json({ error: 'Failed to continue session' }, 500);
  }
});

// DELETE /api/backtesting/sessions/:id — delete a session and its trades
backtesting.delete('/api/backtesting/sessions/:id', requiresLogin, async (c) => {
  const user = c.get('user');
  const db = c.get('db');
  const sessionId = c.req.param('id');

  try {
    await backtestingDb.deleteSession(db, user.id, sessionId);
    return c.json({ message: 'Session deleted' });
  } catch (err) {
    console.error('deleteSession error:', err);
    return c.json({ error: 'Failed to delete session' }, 500);
  }
});

// GET /api/backtesting/sessions/:id/trades — list trades for a session
backtesting.get('/api/backtesting/sessions/:id/trades', requiresLogin, async (c) => {
  const user = c.get('user');
  const db = c.get('db');
  const sessionId = c.req.param('id');

  try {
    const trades = await backtestingDb.getTradesForSession(db, user.id, sessionId);
    return c.json({ trades });
  } catch (err) {
    console.error('getTradesForSession error:', err);
    return c.json({ error: 'Failed to fetch trades' }, 500);
  }
});

// GET /api/backtesting/trades — list all trades across sessions
backtesting.get('/api/backtesting/trades', requiresLogin, async (c) => {
  const user = c.get('user');
  const db = c.get('db');

  try {
    const trades = await backtestingDb.getTrades(db, user.id);
    return c.json({ trades });
  } catch (err) {
    console.error('getTrades error:', err);
    return c.json({ error: 'Failed to fetch trades' }, 500);
  }
});

// POST /api/backtesting/trades — add a trade to the active session
backtesting.post('/api/backtesting/trades', requiresLogin, async (c) => {
  const user = c.get('user');
  const db = c.get('db');
  const body = await c.req.json();
  const { sessionId, result, profitFactor, timeOfDay } = body;

  if (!sessionId || !result || profitFactor == null || !timeOfDay) {
    return c.json({ error: 'sessionId, result, profitFactor, and timeOfDay are required' }, 400);
  }
  if (result !== 'win' && result !== 'loss') {
    return c.json({ error: 'result must be "win" or "loss"' }, 400);
  }

  try {
    const trade = await backtestingDb.addTrade(db, user.id, { sessionId, result, profitFactor, timeOfDay });
    return c.json(trade);
  } catch (err) {
    console.error('addTrade error:', err);
    return c.json({ error: 'Failed to add trade' }, 500);
  }
});

// DELETE /api/backtesting/trades/:id — delete a trade
backtesting.delete('/api/backtesting/trades/:id', requiresLogin, async (c) => {
  const user = c.get('user');
  const db = c.get('db');
  const tradeId = c.req.param('id');

  try {
    await backtestingDb.deleteTrade(db, user.id, tradeId);
    return c.json({ message: 'Trade deleted' });
  } catch (err) {
    console.error('deleteTrade error:', err);
    return c.json({ error: 'Failed to delete trade' }, 500);
  }
});

// Independent virtual replay accounts. Never write to broker or manual journal tables.
backtesting.get('/api/backtesting/replay-sessions', requiresLogin, (c) =>
  c.json({ sessions: replaySessions.listReplaySessions(c.get('db'),c.get('user').id) }));
backtesting.post('/api/backtesting/replay-sessions', requiresLogin, async (c) => {
  let body: unknown; try { body = await c.req.json(); } catch { return c.json({error:'Invalid session.'},400); }
  const session = replaySessions.createReplaySession(c.get('db'),c.get('user').id,body);
  return session ? c.json({session},201) : c.json({error:'Choose a name, positive starting balance and a historical range covered by an imported OHLCV dataset.'},400);
});
backtesting.get('/api/backtesting/replay-sessions/:id', requiresLogin, (c) => {
  const session = replaySessions.getReplaySession(c.get('db'),c.get('user').id,c.req.param('id'));
  return session ? c.json({session}) : c.json({error:'Session not found.'},404);
});
backtesting.put('/api/backtesting/replay-sessions/:id/checkpoint', requiresLogin, async (c) => {
  let body: unknown; try { body = await c.req.json(); } catch { return c.json({error:'Invalid checkpoint.'},400); }
  const result = replaySessions.saveReplaySession(c.get('db'),c.get('user').id,c.req.param('id'),body);
  return 'error' in result ? c.json({error:result.error},result.status) : c.json(result);
});
export default backtesting;
