import type { Db } from './connection';
import { generateId } from '../utils/id';

export class ReplaySessionError extends Error {
  constructor(message: string, public status: 400 | 404 | 409 = 400) { super(message); }
}
type Row = { id: string; user_id: string; name: string; description: string; start_time: string; end_time: string; starting_balance_cents: number; revision: number; checkpoint_json: string | null; created_at: string; updated_at: string };
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const obj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const instruments = new Set(['NQ','MNQ','ES','MES','GC','MGC']);
const pointValues: Record<string,number> = { NQ:20,MNQ:2,ES:50,MES:5,GC:100,MGC:10 };
const interval = (v: string) => { const m = /^(\d+)(s|m|h|d)$/.exec(v); return m ? Number(m[1]) * ({ s:1,m:60,h:3600,d:86400 }[m[2]] ?? 0) : 0; };
function eligible(db: Db, user: string, start: string, end: string) {
  const rows = db.prepare(`SELECT d.instrument,d.source_symbol,d.timeframe,d.start_time,d.end_time FROM market_data_file_datasets d JOIN market_data_files f ON f.id=d.file_id AND f.user_id=d.user_id WHERE d.user_id=? AND f.import_status='ready'`).all(user) as Array<{instrument:string;source_symbol:string|null;timeframe:string;start_time:string;end_time:string}>;
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    if (!instruments.has(row.instrument) || !interval(row.timeframe)) continue;
    const key = row.instrument + '::' + (row.source_symbol || '');
    groups.set(key, [...(groups.get(key) ?? []),row]);
  }
  return [...groups].flatMap(([key, group]) => {
    const base = group.sort((a,b)=>interval(a.timeframe)-interval(b.timeframe))[0].timeframe;
    const ranges = group.filter(r=>r.timeframe===base).map(r=>[Date.parse(r.start_time),Date.parse(r.end_time)]).sort((a,b)=>a[0]-b[0]);
    const merged:number[][]=[];
    for(const r of ranges) { const last=merged[merged.length-1]; if(last && r[0]<=last[1]+1000) last[1]=Math.max(last[1],r[1]); else merged.push(r); }
    return merged.some(r=>r[0]<=Date.parse(start)&&r[1]>=Date.parse(end)) ? [{key,base}] : [];
  });
}
function rowFor(db: Db,user:string,id:string):Row {
  const r=db.prepare('SELECT * FROM replay_sessions WHERE id=? AND user_id=?').get(id,user) as Row|undefined;
  if(!r) throw new ReplaySessionError('Session not found.',404);
  return r;
}
function summarize(r:Row, checkpoint:any, trades:any[]) {
  const realized = trades.reduce((sum,t)=>sum+Math.round(t.pnl*100),0)+Math.round((checkpoint?.position?.realizedPnl??0)*100);
  const open = checkpoint?.position;
  const unrealized = open ? Math.round((checkpoint.currentPrice-open.entryPrice)*(open.direction==='long'?1:-1)*open.quantity*pointValues[checkpoint.instrument]*100) : 0;
  return { id:r.id,name:r.name,description:r.description,startTime:r.start_time,endTime:r.end_time,startingBalance:r.starting_balance_cents/100,
    balance:(r.starting_balance_cents+realized)/100,equity:(r.starting_balance_cents+realized+unrealized)/100,realizedPnl:realized/100,
    tradeCount:trades.length,winRate:trades.length?100*trades.filter(t=>t.pnl>0).length/trades.length:0,
    progress:checkpoint?Math.round(100*checkpoint.currentIndex/Math.max(1,checkpoint.barCount-1)):0,
    status:checkpoint && checkpoint.currentIndex===checkpoint.barCount-1&&!open&&!checkpoint.pendingOrder?'completed':'active',
    revision:r.revision,updatedAt:r.updated_at };
}
function tradesFor(db:Db,id:string) { return (db.prepare('SELECT trade_json FROM replay_session_trades WHERE session_id=? ORDER BY rowid').all(id) as {trade_json:string}[]).map(r=>JSON.parse(r.trade_json)); }
export function getReplaySession(db:Db,user:string,id:string) {
  const r=rowFor(db,user,id), checkpoint=r.checkpoint_json?JSON.parse(r.checkpoint_json):null, trades=tradesFor(db,id);
  return {...summarize(r,checkpoint,trades),checkpoint,trades};
}
export function listReplaySessions(db:Db,user:string) {
  return (db.prepare('SELECT * FROM replay_sessions WHERE user_id=? ORDER BY updated_at DESC').all(user) as Row[]).map(r=>summarize(r,r.checkpoint_json?JSON.parse(r.checkpoint_json):null,tradesFor(db,r.id)));
}
export function createReplaySession(db:Db,user:string,input:unknown) {
  if(!obj(input)||typeof input.name!=='string'||!input.name.trim()||input.name.length>120||typeof(input.description??'')!=='string'||(input.description??'').length>2000||!finite(input.startingBalance)||input.startingBalance<=0||input.startingBalance>1e9) throw new ReplaySessionError('Provide a name and positive starting balance.');
  const a=Date.parse(input.startTime),b=Date.parse(input.endTime);
  if(!Number.isFinite(a)||!Number.isFinite(b)||b<=a) throw new ReplaySessionError('Choose a valid historical period.');
  const start=new Date(a).toISOString(),end=new Date(b).toISOString();
  if(!eligible(db,user,start,end).length) throw new ReplaySessionError('No supported market covers this historical period.');
  const cents=Math.round(input.startingBalance*100);
  if(cents<1) throw new ReplaySessionError('Starting balance must be at least one cent.');
  const id=generateId(), now=new Date().toISOString();
  db.prepare('INSERT INTO replay_sessions(id,user_id,name,description,start_time,end_time,starting_balance_cents,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id,user,input.name.trim(),(input.description??'').trim(),start,end,cents,now,now);
  return getReplaySession(db,user,id);
}
function validOrder(v:any,position=false) {
  return v===null || (obj(v)&&typeof v.id==='string'&&/^replay-\d+$/.test(v.id)&&['long','short'].includes(v.direction)&&Number.isInteger(v.quantity)&&v.quantity>=1&&v.quantity<=100&&
    (position?finite(v.entryPrice)&&v.entryPrice>0&&finite(v.entryTime)&&finite(v.realizedPnl)&&Array.isArray(v.fills):['limit','stop_market'].includes(v.type)&&finite(v.triggerPrice)&&v.triggerPrice>0)&&
    [v.stopPrice,v.targetPrice].every(x=>x==null||(finite(x)&&x>0)));
}
function validateCheckpoint(c:any,r:Row) {
  if(!obj(c)||c.version!==1||typeof c.marketKey!=='string'||!instruments.has(c.instrument)||!c.marketKey.startsWith(c.instrument+'::')||typeof c.baseTimeframe!=='string'||!interval(c.baseTimeframe)||c.timeframe!==c.baseTimeframe||
    typeof c.fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(c.fingerprint)||!Number.isInteger(c.barCount)||c.barCount<2||c.barCount>200000||!Number.isInteger(c.currentIndex)||c.currentIndex<0||c.currentIndex>=c.barCount||
    !finite(c.currentTime)||c.currentTime*1000<Date.parse(r.start_time)||c.currentTime*1000>Date.parse(r.end_time)||!finite(c.currentPrice)||c.currentPrice<=0||
    !Number.isInteger(c.orderSequence)||c.orderSequence<0||!Number.isInteger(c.quantity)||c.quantity<1||c.quantity>100||!Array.isArray(c.quantityPresets)||c.quantityPresets.length!==5||!c.quantityPresets.every((n:any)=>Number.isInteger(n)&&n>=1&&n<=100)||
    ![.25,.5,1,2,5,10,20].includes(c.speed)||!['market','limit','stop_market'].includes(c.orderType)||typeof c.orderPrice!=='string'||c.orderPrice.length>64||!validOrder(c.position,true)||!validOrder(c.pendingOrder)||!obj(c.layout)||!obj(c.layout.grid)||c.layout.grid.kind!=='grid'||c.layout.grid.v!==1||!Array.isArray(c.layout.grid.cells)||c.layout.grid.cells.length>4||!c.layout.grid.cells.every((cell:any)=>obj(cell)&&cell.symbol===c.instrument)) throw new ReplaySessionError('Invalid replay checkpoint.');
}
export function saveReplaySession(db:Db,user:string,id:string,input:unknown) {
  if(!obj(input)||!Number.isInteger(input.revision)||!Array.isArray(input.trades)||input.trades.length>100000||JSON.stringify(input).length>20_000_000) throw new ReplaySessionError('Invalid replay save.');
  return db.transaction(()=>{
    const r=rowFor(db,user,id);
    if(r.revision!==input.revision) throw new ReplaySessionError('Session was changed on another device. Reopen before editing.',409);
    const c=input.checkpoint;
    validateCheckpoint(c,r);
    const old=r.checkpoint_json?JSON.parse(r.checkpoint_json):null;
    if(old&&(old.fingerprint!==c.fingerprint||old.marketKey!==c.marketKey||old.baseTimeframe!==c.baseTimeframe)) throw new ReplaySessionError('Historical source changed; existing session is preserved.',409);
    if(!old&&!eligible(db,user,r.start_time,r.end_time).some(m=>m.key===c.marketKey&&m.base===c.baseTimeframe)) throw new ReplaySessionError('Historical source is no longer available.',409);
    const previous=tradesFor(db,id);
    if(input.trades.length<previous.length) throw new ReplaySessionError('Completed trades cannot be removed.',409);
    for(let i=0;i<previous.length;i++) if(JSON.stringify(previous[i])!==JSON.stringify(input.trades[i])) throw new ReplaySessionError('Completed trades cannot be rewritten.',409);
    const seen=new Set<string>();
    for(const t of input.trades) {
      if(!obj(t)||typeof t.id!=='string'||!/^replay-\d+$/.test(t.id)||seen.has(t.id)||!['long','short'].includes(t.direction)||!finite(t.pnl)||!finite(t.entryTime)||!finite(t.exitTime)||t.exitTime<t.entryTime||t.exitTime>c.currentTime||!finite(t.entryPrice)||!finite(t.exitPrice)||!Number.isInteger(t.quantity)||t.quantity<1||!Array.isArray(t.fills)) throw new ReplaySessionError('Invalid completed replay trade.');
      seen.add(t.id);
    }
    const add=db.prepare('INSERT INTO replay_session_trades(session_id,trade_id,trade_json) VALUES(?,?,?)');
    for(const t of input.trades.slice(previous.length)) add.run(id,t.id,JSON.stringify(t));
    db.prepare('UPDATE replay_sessions SET checkpoint_json=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=? AND revision=?').run(JSON.stringify(c),new Date().toISOString(),id,user,r.revision);
    return getReplaySession(db,user,id);
  })();
}
