import type { Db } from './connection';
import { randomUUID } from 'node:crypto';

type Json = Record<string, any>;
const record = (x: unknown): x is Json => !!x && typeof x === 'object' && !Array.isArray(x);
const number = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const integer = (x: unknown): x is number => number(x) && Number.isSafeInteger(x);
const direction = (x: unknown) => x === 'long' || x === 'short';
const price = (x: unknown) => number(x) && x > 0;
const qty = (x: unknown) => integer(x) && x > 0 && x <= 100;
const level = (x: unknown) => x == null || price(x);
const type = (x: unknown) => ['market','limit','stop_market'].includes(String(x));
const id = (x: unknown) => typeof x === 'string' && /^replay-\d+$/.test(x);
const fill = (x: unknown) => record(x) && direction(x.direction) && qty(x.quantity) && price(x.price)
  && integer(x.time) && ['entry','exit'].includes(x.kind);
const fills = (x: unknown) => Array.isArray(x) && x.length > 0 && x.length <= 20000 && x.every(fill);
const position = (x: unknown) => record(x) && id(x.id) && direction(x.direction) && qty(x.quantity)
  && price(x.entryPrice) && integer(x.entryTime) && level(x.stopPrice) && level(x.targetPrice)
  && number(x.realizedPnl) && fills(x.fills);
const pending = (x: unknown) => record(x) && id(x.id) && direction(x.direction) && qty(x.quantity)
  && ['limit','stop_market'].includes(x.type) && price(x.triggerPrice) && level(x.stopPrice) && level(x.targetPrice);
const trade = (x: unknown) => record(x) && id(x.id) && direction(x.direction) && integer(x.quantity) && x.quantity > 0
  && price(x.entryPrice) && price(x.exitPrice) && integer(x.entryTime) && integer(x.exitTime)
  && x.exitTime >= x.entryTime && number(x.pnl) && (x.rMultiple == null || number(x.rMultiple)) && fills(x.fills);
const MAX_CHECKPOINT = 8 * 1024 * 1024;
type Row = { id: string; name: string; description: string; start_time: string; end_time: string; starting_balance_cents: number; revision: number; checkpoint_json: string | null; created_at: string; updated_at: string };
function rowFor(db: Db, owner: string, session: string) {
  return db.prepare('SELECT * FROM replay_sessions WHERE user_id=? AND id=?').get(owner, session) as Row | undefined;
}
function allTrades(db: Db, session: string): Json[] {
  return (db.prepare('SELECT trade_json FROM replay_session_trades WHERE session_id=? ORDER BY rowid').all(session) as {trade_json:string}[]).map(x => JSON.parse(x.trade_json));
}
function view(db: Db, row: Row, full = false) {
  const checkpoint = row.checkpoint_json ? JSON.parse(row.checkpoint_json) : null;
  const trades = allTrades(db, row.id);
  const realized = trades.reduce((sum,t) => sum + t.pnl, 0) + (checkpoint?.position?.realizedPnl ?? 0);
  return { id: row.id, name: row.name, description: row.description, startTime: row.start_time, endTime: row.end_time,
    startingBalance: row.starting_balance_cents / 100, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at,
    realizedPnl: realized, balance: row.starting_balance_cents / 100 + realized, tradeCount: trades.length,
    winRate: trades.length ? 100 * trades.filter(t => t.pnl > 0).length / trades.length : 0,
    progress: checkpoint ? Math.round(100 * checkpoint.index / Math.max(1, checkpoint.barCount - 1)) : 0,
    status: checkpoint && checkpoint.index === checkpoint.barCount - 1 && !checkpoint.position && !checkpoint.pendingOrder ? 'completed' : 'in_progress',
    ...(full ? { checkpoint, trades } : {}) };
}
export function listReplaySessions(db: Db, owner: string) {
  return (db.prepare('SELECT * FROM replay_sessions WHERE user_id=? ORDER BY updated_at DESC').all(owner) as Row[]).map(row => view(db,row));
}
export function getReplaySession(db: Db, owner: string, session: string) {
  const row = rowFor(db,owner,session);
  return row ? view(db,row,true) : null;
}
export function createReplaySession(db: Db, owner: string, input: unknown) {
  if (!record(input) || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 120
    || (input.description != null && (typeof input.description !== 'string' || input.description.length > 2000))
    || !number(input.startingBalance) || input.startingBalance < .01 || input.startingBalance > 1e9
    || typeof input.startTime !== 'string' || typeof input.endTime !== 'string') return null;
  const start = Date.parse(input.startTime), end = Date.parse(input.endTime);
  if (!number(start) || !number(end) || end <= start) return null;
  const startIso = new Date(start).toISOString(), endIso = new Date(end).toISOString();
  // First release supports a range contained in a ready OHLCV dataset.
  const covered = db.prepare(`SELECT d.id FROM market_data_file_datasets d JOIN market_data_files f
    ON f.id=d.file_id AND f.user_id=d.user_id WHERE d.user_id=? AND f.import_status='ready'
    AND d.data_kind != 'trades' AND d.start_time<=? AND d.end_time>=? LIMIT 1`).get(owner,startIso,endIso);
  if (!covered) return null;
  const session = randomUUID(), now = new Date().toISOString();
  db.prepare(`INSERT INTO replay_sessions (id,user_id,name,description,start_time,end_time,starting_balance_cents,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(session,owner,input.name.trim(),String(input.description ?? '').trim(),startIso,endIso,Math.round(input.startingBalance*100),now,now);
  return getReplaySession(db,owner,session);
}
export function saveReplaySession(db: Db, owner: string, session: string, input: unknown) {
  if (!record(input) || !integer(input.revision) || !record(input.checkpoint) || !Array.isArray(input.trades)) return { error:'Invalid checkpoint.', status:400 } as const;
  const c = input.checkpoint, trades = input.trades;
  if (c.version !== 1 || typeof c.marketKey !== 'string' || c.marketKey.length > 200 || typeof c.timeframe !== 'string'
    || typeof c.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(c.fingerprint)
    || !integer(c.index) || c.index < 0 || !integer(c.barCount) || c.barCount < 2 || c.index >= c.barCount || !integer(c.time)
    || !integer(c.orderSequence) || c.orderSequence < 0 || !qty(c.quantity)
    || !Array.isArray(c.quantityPresets) || c.quantityPresets.length !== 5 || !c.quantityPresets.every(qty)
    || ![.25,.5,1,2,5,10,20].includes(c.speed) || !type(c.orderType) || typeof c.orderPrice !== 'string' || c.orderPrice.length > 80
    || (c.position != null && !position(c.position)) || (c.pendingOrder != null && !pending(c.pendingOrder))
    || !record(c.layout) || c.layout.kind !== 'grid' || c.layout.v !== 1 || !Array.isArray(c.layout.cells) || c.layout.cells.length > 4
    || trades.length > 20000 || !trades.every(trade) || new Set(trades.map(t=>t.id)).size !== trades.length
    || JSON.stringify(input).length > MAX_CHECKPOINT) return {error:'Invalid or oversized checkpoint.',status:400} as const;
  return db.transaction(() => {
    const row = rowFor(db,owner,session);
    if (!row) return {error:'Session not found.',status:404} as const;
    if (row.revision !== input.revision) return {error:'Session changed on another device. Reopen it before saving again.',status:409} as const;
    if (c.time * 1000 < Date.parse(row.start_time) || c.time * 1000 > Date.parse(row.end_time)) return {error:'Replay time is outside this session.',status:400} as const;
    const prior = row.checkpoint_json ? JSON.parse(row.checkpoint_json) : null;
    if (prior && (prior.marketKey !== c.marketKey || prior.timeframe !== c.timeframe || prior.fingerprint !== c.fingerprint)) return {error:'Session historical source changed.',status:409} as const;
    const existing = allTrades(db,session);
    const incoming = new Map(trades.map(t=>[t.id,JSON.stringify(t)]));
    if (existing.some(t=>incoming.get(t.id)!==JSON.stringify(t))) return {error:'Saved trade history cannot be changed or removed.',status:409} as const;
    if (existing.length && prior && c.index < prior.index) return {error:'Cannot rewind executed history.',status:409} as const;
    const insert = db.prepare('INSERT OR IGNORE INTO replay_session_trades(session_id,trade_id,trade_json) VALUES(?,?,?)');
    for (const t of trades) insert.run(session,t.id,JSON.stringify(t));
    db.prepare('UPDATE replay_sessions SET checkpoint_json=?, revision=revision+1, updated_at=? WHERE id=? AND user_id=?')
      .run(JSON.stringify(c),new Date().toISOString(),session,owner);
    return { revision: row.revision+1 };
  })();
}
