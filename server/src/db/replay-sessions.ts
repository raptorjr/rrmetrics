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
type Row = { id: string; user_id: string; name: string; description: string; start_time: string; end_time: string; starting_balance_cents: number; revision: number; checkpoint_json: string | null; created_at: string; updated_at: string };
function rowFor(db: Db, owner: string, session: string) {
  return db.prepare('SELECT * FROM replay_sessions WHERE user_id=? AND id=?').get(owner, session) as Row | undefined;
}
function allTrades(db: Db, session: string): Json[] {
  return (db.prepare('SELECT trade_json FROM replay_session_trades WHERE session_id=? ORDER BY rowid').all(session) as {trade_json:string}[]).map(x => JSON.parse(x.trade_json));
}
type Membership = {accountId:string;accountName:string;accountStartingBalanceCents:number;sequence:number;sessionCount:number};
function membership(db:Db,row:Row):Membership {
  return db.prepare(`SELECT a.id AS accountId,a.name AS accountName,a.starting_balance_cents AS accountStartingBalanceCents,
    m.sequence,(SELECT COUNT(*) FROM replay_account_sessions WHERE account_id=a.id) AS sessionCount
    FROM replay_account_sessions m JOIN replay_accounts a ON a.id=m.account_id
    WHERE m.session_id=? AND a.user_id=?`).get(row.id,row.user_id) as Membership;
}
function accountRows(db:Db,owner:string,accountId:string):Row[] {
  return db.prepare(`SELECT s.* FROM replay_account_sessions m JOIN replay_sessions s ON s.id=m.session_id
    JOIN replay_accounts a ON a.id=m.account_id WHERE a.id=? AND a.user_id=? AND s.user_id=? ORDER BY m.sequence`).all(accountId,owner,owner) as Row[];
}
function view(db: Db, row: Row, full = false) {
  const checkpoint = row.checkpoint_json ? JSON.parse(row.checkpoint_json) : null;
  const trades = allTrades(db, row.id);
  const realized = trades.reduce((sum,t) => sum + t.pnl, 0) + (checkpoint?.position?.realizedPnl ?? 0);
  const m=membership(db,row);
  const sealed=m.sequence<m.sessionCount;
  const depleted=!checkpoint?.position && Math.round(row.starting_balance_cents+realized*100)<=0;
  return { id: row.id, accountId:m.accountId, accountName:m.accountName, accountStartingBalance:m.accountStartingBalanceCents/100,
    sequence:m.sequence,sessionCount:m.sessionCount,sealed,accountStatus:depleted?'depleted':'active',
    canContinue:!sealed && !!checkpoint && !checkpoint.position && !checkpoint.pendingOrder && Math.round(row.starting_balance_cents+realized*100)>0,
    lastReplayTime:checkpoint?new Date(checkpoint.time*1000).toISOString():null,
    name: row.name, description: row.description, startTime: row.start_time, endTime: row.end_time,
    startingBalance: row.starting_balance_cents / 100, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at,
    realizedPnl: realized, balance: row.starting_balance_cents / 100 + realized, tradeCount: trades.length,
    winRate: trades.length ? 100 * trades.filter(t => t.pnl > 0).length / trades.length : 0,
    progress: checkpoint ? Math.round(100 * checkpoint.index / Math.max(1, checkpoint.barCount - 1)) : 0,
    status: sealed || (checkpoint && checkpoint.index === checkpoint.barCount - 1 && !checkpoint.position && !checkpoint.pendingOrder) ? 'completed' : 'in_progress',
    ...(full ? { checkpoint, trades } : {}) };
}
export function listReplaySessions(db: Db, owner: string) {
  return (db.prepare('SELECT * FROM replay_sessions WHERE user_id=? ORDER BY updated_at DESC').all(owner) as Row[]).map(row => view(db,row));
}
export function getReplaySession(db: Db, owner: string, session: string) {
  const row = rowFor(db,owner,session);
  return row ? view(db,row,true) : null;
}
// Read-only analytics projection. The replay trade's recorded P/L is authoritative,
// especially after partial exits. Never insert these records into real trades.
export function replayAnalytics(db: Db, owner: string) {
  return db.transaction(() => {
    const rows=db.prepare('SELECT * FROM replay_sessions WHERE user_id=? ORDER BY updated_at DESC').all(owner) as Row[];
    const summaries=rows.map(row=>view(db,row));
    const accounts=summaries.filter(s=>!s.sealed).map(latest=>{
      const members=summaries.filter(s=>s.accountId===latest.accountId);
      const trades=members.flatMap(s=>allTrades(db,s.id));
      return {...latest,id:latest.accountId,name:latest.accountName,key:'replay::'+latest.accountId,provider:'replay',currencyCode:'USD',
        startingBalance:latest.accountStartingBalance,realizedPnl:latest.balance-latest.accountStartingBalance,
        tradeCount:trades.length,winRate:trades.length?100*trades.filter(t=>t.pnl>0).length/trades.length:0};
    });
    const trades=rows.flatMap(row=>{
      const checkpoint=row.checkpoint_json?JSON.parse(row.checkpoint_json):null;
      const m=membership(db,row);
      return allTrades(db,row.id).map(t=>({
        _id:'replay::'+row.id+'::'+t.id,domain:'backtesting',replaySessionId:row.id,
        replayAccountId:m.accountId,account:m.accountName,ticker:checkpoint.marketKey.split('::')[0],direction:t.direction,
        quantity:t.direction==='short'?-t.quantity:t.quantity,enterPrice:t.entryPrice,exitPrice:t.exitPrice,
        enterTime:new Date(t.entryTime*1000).toISOString(),exitTime:new Date(t.exitTime*1000).toISOString(),
        manualPL:t.pnl,grossPL:t.pnl,netPL:t.pnl,fees:0,currencyCode:'USD',
        rMultiple:t.rMultiple??null,fills:t.fills,
      }));
    });
    return {accounts,trades};
  })();
}
export function createReplaySession(db: Db, owner: string, input: unknown) {
  if (!record(input) || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 120
    || (input.description != null && (typeof input.description !== 'string' || input.description.length > 2000))
    || (input.accountId == null && (!number(input.startingBalance) || input.startingBalance < .01 || input.startingBalance > 1e9))
    || (input.accountId != null && (typeof input.accountId !== 'string' || typeof input.previousSessionId !== 'string' || !integer(input.previousRevision)))
    || (input.accountName != null && (typeof input.accountName !== 'string' || !input.accountName.trim() || input.accountName.length>120))
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
  return db.transaction(()=>{
    let accountId=session,sequence=1,cents=0;
    if(input.accountId!=null){
      accountId=input.accountId;
      const members=accountRows(db,owner,accountId),previous=members[members.length-1];
      if(!previous || previous.id!==input.previousSessionId || previous.revision!==input.previousRevision)return null;
      const summary=view(db,previous);
      if(!summary.canContinue || !summary.lastReplayTime || start<=Date.parse(summary.lastReplayTime))return null;
      cents=Math.round(summary.balance*100);sequence=members.length+1;
      // Seal the predecessor and invalidate any other client's stale checkpoint.
      db.prepare('UPDATE replay_sessions SET revision=revision+1 WHERE id=? AND user_id=?').run(previous.id,owner);
    }else{
      cents=Math.round(input.startingBalance*100);
      db.prepare('INSERT INTO replay_accounts(id,user_id,name,starting_balance_cents,created_at) VALUES(?,?,?,?,?)')
        .run(accountId,owner,(input.accountName??input.name).trim(),cents,now);
    }
    db.prepare(`INSERT INTO replay_sessions (id,user_id,name,description,start_time,end_time,starting_balance_cents,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(session,owner,input.name.trim(),String(input.description ?? '').trim(),startIso,endIso,cents,now,now);
    db.prepare('INSERT INTO replay_account_sessions(account_id,session_id,sequence) VALUES(?,?,?)').run(accountId,session,sequence);
    return getReplaySession(db,owner,session);
  })();
}
// Metadata mutations are explicit and revision checked, like checkpoint resets.
// A stale list on another device must not delete newly saved executions.
export function renameReplaySession(db: Db, owner: string, session: string, input: unknown) {
  if (!record(input) || !integer(input.revision) || input.revision < 0 ||
      typeof input.name !== 'string' || !input.name.trim() || input.name.length > 120)
    return {error:'Enter a valid session name.',status:400} as const;
  const name = input.name.trim();
  return db.transaction(() => {
    const row = rowFor(db,owner,session);
    if (!row) return {error:'Session not found.',status:404} as const;
    if (row.revision !== input.revision) return {error:'Session changed on another device. Refresh the session list and try again.',status:409} as const;
    if (row.name !== name) {
      const m=membership(db,row);
      db.prepare('UPDATE replay_sessions SET name=?, revision=revision+1, updated_at=? WHERE id=? AND user_id=?')
        .run(name,new Date().toISOString(),session,owner);
      // Preserve legacy single-session rename behavior; named multi-session accounts remain independent.
      if(m.sessionCount===1 && m.accountName===row.name)db.prepare('UPDATE replay_accounts SET name=? WHERE id=? AND user_id=?').run(name,m.accountId,owner);
    }
    return {session:view(db,rowFor(db,owner,session)!)};
  })();
}
export function deleteReplaySession(db: Db, owner: string, session: string, input: unknown) {
  if (!record(input) || !integer(input.revision) || input.revision < 0)
    return {error:'Invalid session revision.',status:400} as const;
  return db.transaction(() => {
    const row = rowFor(db,owner,session);
    if (!row) return {error:'Session not found.',status:404} as const;
    if (row.revision !== input.revision) return {error:'Session changed on another device. Refresh the session list and try again.',status:409} as const;
    const m=membership(db,row);
    if(m.sequence<m.sessionCount)return {error:'Earlier sessions cannot be deleted because later sessions depend on their balance.',status:409} as const;
    db.prepare('DELETE FROM replay_sessions WHERE id=? AND user_id=?').run(session,owner);
    if(m.sessionCount===1)db.prepare('DELETE FROM replay_accounts WHERE id=? AND user_id=?').run(m.accountId,owner);
    else {
      const remaining=accountRows(db,owner,m.accountId),previous=remaining[remaining.length-1];
      // Reopen the previous checkpoint, invalidating stale clients.
      db.prepare('UPDATE replay_sessions SET revision=revision+1 WHERE id=? AND user_id=?').run(previous.id,owner);
    }
    return {deleted:true as const};
  })();
}
// Delete a complete practice account atomically; every member revision must
// still match the confirmation snapshot, including newly appended sessions.
export function deleteReplayAccount(db:Db,owner:string,accountId:string,input:unknown){
  if(!record(input)||!Array.isArray(input.sessions)||!input.sessions.length||
    !input.sessions.every((x:unknown)=>record(x)&&typeof x.id==='string'&&integer(x.revision)&&x.revision>=0))
    return {error:'Invalid account deletion snapshot.',status:400} as const;
  return db.transaction(()=>{
    const rows=accountRows(db,owner,accountId);
    if(!rows.length)return {error:'Virtual account not found.',status:404} as const;
    const revisions=new Map(input.sessions.map((x:Json)=>[x.id,x.revision]));
    if(rows.length!==input.sessions.length||revisions.size!==rows.length||rows.some(row=>revisions.get(row.id)!==row.revision))
      return {error:'Account changed on another device. Refresh and confirm again.',status:409} as const;
    for(const row of rows)db.prepare('DELETE FROM replay_sessions WHERE id=? AND user_id=?').run(row.id,owner);
    db.prepare('DELETE FROM replay_accounts WHERE id=? AND user_id=?').run(accountId,owner);
    return {deleted:true as const};
  })();
}
export function saveReplaySession(db: Db, owner: string, session: string, input: unknown) {
  if (!record(input) || !integer(input.revision) || !record(input.checkpoint) || !Array.isArray(input.trades)) return { error:'Invalid checkpoint.', status:400 } as const;
  const c = input.checkpoint, trades = input.trades;
  if (c.version !== 1 || typeof c.marketKey !== 'string' || c.marketKey.length > 200 || typeof c.timeframe !== 'string'
    || typeof c.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(c.fingerprint)
    || !integer(c.index) || c.index < 0 || !integer(c.barCount) || c.barCount < 2 || c.index >= c.barCount || !integer(c.time)
    || !integer(c.orderSequence) || c.orderSequence < 0 || !qty(c.quantity)
    || !Array.isArray(c.quantityPresets) || c.quantityPresets.length !== 5 || !c.quantityPresets.every(qty)
    || !(c.speedMode === 'time' ? integer(c.speed) && c.speed>=1 && c.speed<=1200 : c.speedMode == null && [.25,.5,1,2,5,10,20].includes(c.speed)) || !type(c.orderType) || typeof c.orderPrice !== 'string' || c.orderPrice.length > 80
    || (c.position != null && !position(c.position)) || (c.pendingOrder != null && !pending(c.pendingOrder))
    || !record(c.layout) || c.layout.kind !== 'grid' || c.layout.v !== 1 || !Array.isArray(c.layout.cells) || c.layout.cells.length > 4
    || trades.length > 20000 || !trades.every(trade) || new Set(trades.map(t=>t.id)).size !== trades.length
    || JSON.stringify(input).length > MAX_CHECKPOINT) return {error:'Invalid or oversized checkpoint.',status:400} as const;
  return db.transaction(() => {
    const row = rowFor(db,owner,session);
    if (!row) return {error:'Session not found.',status:404} as const;
    if (row.revision !== input.revision) return {error:'Session changed on another device. Reopen it before saving again.',status:409} as const;
    const m=membership(db,row);
    if(m.sequence<m.sessionCount)return {error:'This session is sealed because the account continued in a later session.',status:409} as const;
    if (c.time * 1000 < Date.parse(row.start_time) || c.time * 1000 > Date.parse(row.end_time)) return {error:'Replay time is outside this session.',status:400} as const;
    const prior = row.checkpoint_json ? JSON.parse(row.checkpoint_json) : null;
    if (prior && (prior.marketKey !== c.marketKey || prior.timeframe !== c.timeframe || prior.fingerprint !== c.fingerprint)) return {error:'Session historical source changed.',status:409} as const;
    // Reset is an explicit, revision-checked destructive operation, never a normal autosave.
    const restart = input.restart === true;
    if (restart && (c.index !== 0 || c.position != null || c.pendingOrder != null || trades.length !== 0 || (prior && c.orderSequence < prior.orderSequence))) return {error:'Invalid restart checkpoint.',status:400} as const;
    const existing = allTrades(db,session);
    const incoming = new Map(trades.map(t=>[t.id,JSON.stringify(t)]));
    const depleted=!prior?.position && Math.round(row.starting_balance_cents+existing.reduce((sum,t)=>sum+t.pnl*100,0))<=0;
    if(depleted && (restart || c.position || c.pendingOrder || trades.length!==existing.length || c.index!==prior?.index))
      return {error:'Account capital exhausted. Review the saved session or create a new account.',status:409} as const;
    if (!restart && existing.some(t=>incoming.get(t.id)!==JSON.stringify(t))) return {error:'Saved trade history cannot be changed or removed.',status:409} as const;
    if (!restart && (existing.length || prior?.position || prior?.pendingOrder) && prior && c.index < prior.index) return {error:'Cannot rewind executed history.',status:409} as const;
    if (restart) db.prepare('DELETE FROM replay_session_trades WHERE session_id=?').run(session);
    const insert = db.prepare('INSERT OR IGNORE INTO replay_session_trades(session_id,trade_id,trade_json) VALUES(?,?,?)');
    for (const t of trades) insert.run(session,t.id,JSON.stringify(t));
    db.prepare('UPDATE replay_sessions SET checkpoint_json=?, revision=revision+1, updated_at=? WHERE id=? AND user_id=?')
      .run(JSON.stringify(c),new Date().toISOString(),session,owner);
    return { revision: row.revision+1 };
  })();
}
