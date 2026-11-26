import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import type { Env, AuthContext } from '../bindings';
import backtesting from '../routes/backtesting';

test('persistent replay accounts resume across clients, isolate trades and reject stale checkpoints', async () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON');
    const schema = fs.readFileSync(path.join(__dirname,'../db/schema.sql'),'utf8');
    db.exec(schema);
    for (const id of ['owner','other']) db.prepare('INSERT INTO profiles(id,email,password_hash,created_at) VALUES(?,?,?,?)').run(id,id+'@example.test','','2026-01-01');
    db.prepare("INSERT INTO market_data_providers(id,user_id,provider_type,display_name) VALUES('p','owner','historical_futures','Historical Futures')").run();
    db.prepare("INSERT INTO market_data_files(id,user_id,provider_id,original_filename,input_format,file_size_bytes,content_sha256,import_status,original_storage_key) VALUES('f','owner','p','NQ.csv','csv',1,'hash','ready','originals/nq.csv')").run();
    const start = '2026-01-01T00:00:00.000Z', end = '2026-01-01T00:10:00.000Z';
    db.prepare("INSERT INTO market_data_file_datasets(id,user_id,file_id,data_kind,instrument,timeframe,timestamp_unit,row_count,start_time,end_time,normalized_storage_key) VALUES('d','owner','f','ohlcv','NQ','1m','ms',11,?,?,'normalized/nq.parquet')").run(start,end);
    const app = (id:string) => { const a=new Hono<{Bindings:Env;Variables:AuthContext}>();
      a.use('*',async(c,next)=>{c.set('db',db);c.set('user',{id,email:id+'@example.test'});await next();});a.route('/',backtesting);return a; };
    const desktop=app('owner'), laptop=app('owner'), other=app('other'), url='/api/backtesting/replay-sessions';
    const write=(a:typeof desktop,uri:string,method:string,body:unknown)=>a.request(uri,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const meta={name:'Breakout',description:'test',startingBalance:50000,startTime:start,endTime:end};
    assert.equal((await write(other,url,'POST',meta)).status,400);
    assert.equal((await write(desktop,url,'POST',{...meta,endTime:'2027-01-01'})).status,400);
    const created=await write(desktop,url,'POST',meta);assert.equal(created.status,201);
    const {session}=await created.json() as any;
    const second=await write(desktop,url,'POST',{...meta,name:'Second'});assert.equal(second.status,201);
    assert.equal((await laptop.request(url+'/'+session.id)).status,200);
    assert.equal((await other.request(url+'/'+session.id)).status,404);
    const analyticsUrl='/api/backtesting/replay-analytics', viewUrl='/api/backtesting/account-view';
    const emptyAnalytics=(await (await desktop.request(analyticsUrl)).json() as any);
    assert.equal(emptyAnalytics.accounts.length,2);assert.equal(emptyAnalytics.trades.length,0);
    assert.deepEqual(await (await other.request(analyticsUrl)).json(),{accounts:[],trades:[]});
    const settings={version:1,mode:'backtesting',trading:['manual::Practice'],backtesting:['replay::'+session.id]};
    assert.equal((await write(desktop,viewUrl+'?initialize=1','PUT',settings)).status,200);
    const attemptedInit=await write(laptop,viewUrl+'?initialize=1','PUT',{...settings,mode:'trading',backtesting:[]});
    assert.deepEqual(await attemptedInit.json(),{settings});
    assert.deepEqual(await (await laptop.request(viewUrl)).json(),{settings});
    assert.deepEqual(await (await other.request(viewUrl)).json(),{settings:null});
    assert.equal((await write(laptop,viewUrl,'PUT',{...settings,mode:'trading'})).status,200);
    assert.deepEqual(await (await desktop.request(viewUrl)).json(),{settings:{...settings,mode:'trading'}});
    assert.equal((await write(desktop,viewUrl,'PUT',settings)).status,200);
    assert.equal((await write(desktop,viewUrl,'PUT',{...settings,backtesting:['manual::Practice']})).status,400);
    assert.equal((await write(desktop,viewUrl,'PUT',{...settings,trading:['replay::'+session.id]})).status,400);
    const time=Date.parse(start)/1000;
    const closed={id:'replay-1',direction:'long',quantity:1,entryPrice:100,exitPrice:110,entryTime:time,exitTime:time+60,pnl:200,rMultiple:2,fills:[
      {direction:'long',quantity:1,price:100,time,kind:'entry'},
      {direction:'short',quantity:1,price:110,time:time+60,kind:'exit'}]};
    const open={id:'replay-2',direction:'long',quantity:1,entryPrice:110,entryTime:time+120,stopPrice:105,targetPrice:120,realizedPnl:20,fills:[
      {direction:'long',quantity:2,price:110,time:time+120,kind:'entry'},
      {direction:'short',quantity:1,price:111,time:time+180,kind:'exit'}]};
    const checkpoint={version:1,marketKey:'NQ::',timeframe:'1m',fingerprint:'a'.repeat(64),index:3,barCount:11,time:time+180,orderSequence:2,quantity:1,quantityPresets:[1,2,3,5,10],speed:2,orderType:'market',orderPrice:'',position:open,pendingOrder:null,layout:{v:1,kind:'grid',layout:'1x2',cells:[{chart:{drawings:[{id:'drawing'}]}},{}]}};
    const save=url+'/'+session.id+'/checkpoint', payload={revision:0,checkpoint,trades:[closed]};
    assert.equal((await write(desktop,save,'PUT',payload)).status,200);
    assert.equal((await write(laptop,save,'PUT',payload)).status,409);
    assert.equal((await write(other,save,'PUT',{...payload,revision:1})).status,404);
    const restored=(await (await laptop.request(url+'/'+session.id)).json() as any).session;
    assert.deepEqual(restored.checkpoint,checkpoint);assert.deepEqual(restored.trades,[closed]);
    const projected=(await (await desktop.request(analyticsUrl)).json() as any);
    assert.equal(projected.accounts.length,2);assert.equal(projected.trades.length,1);
    assert.equal(projected.trades[0].manualPL,200);assert.equal(projected.trades[0].domain,'backtesting');
    assert.equal(projected.trades[0].ticker,'NQ');assert.equal(projected.trades[0].quantity,1);
    assert.equal(projected.trades[0].enterTime,start);assert.deepEqual(projected.trades[0].fills,closed.fills);
    assert.equal(projected.accounts.find((a:any)=>a.id===session.id).balance,50220);
    assert.equal(restored.balance,50220);assert.equal(restored.tradeCount,1);assert.equal(restored.progress,30);
    assert.equal((await write(laptop,save,'PUT',{...payload,revision:1,trades:[]})).status,409);
    assert.equal((await write(laptop,save,'PUT',{...payload,revision:1,checkpoint:{...checkpoint,fingerprint:'b'.repeat(64)}})).status,409);
    assert.equal((await write(laptop,save,'PUT',{...payload,revision:1})).status,200);
    db.exec(schema);
    db.prepare("DELETE FROM market_data_files WHERE id='f'").run();
    const again=(await (await laptop.request(url+'/'+session.id)).json() as any).session;
    assert.equal(again.revision,2);assert.equal(again.trades.length,1);
    const reset={revision:2,restart:true,checkpoint:{...checkpoint,index:0,time,position:null,pendingOrder:null,speed:60,speedMode:'time'},trades:[]};
    assert.equal((await write(other,save,'PUT',reset)).status,404);
    assert.equal((await write(laptop,save,'PUT',{...reset,revision:1})).status,409);
    assert.equal((await write(laptop,save,'PUT',{...reset,checkpoint:{...reset.checkpoint,position:open}})).status,400);
    assert.equal((await write(laptop,save,'PUT',reset)).status,200);
    const restarted=(await (await laptop.request(url+'/'+session.id)).json() as any).session;
    assert.equal(restarted.revision,3);assert.equal(restarted.balance,50000);assert.equal(restarted.progress,0);assert.equal(restarted.trades.length,0);
    assert.deepEqual(restarted.checkpoint.layout,checkpoint.layout);
    assert.equal((await write(desktop,save,'PUT',payload)).status,409);
    // Management actions are owner scoped, validate names and reject stale list revisions.
    const uri=url+'/'+session.id;
    const secondSession=(await second.json() as any).session;
    const rename={revision:3,name:'  London practice  '};
    assert.equal((await write(other,uri,'PATCH',rename)).status,404);
    assert.equal((await write(laptop,uri,'PATCH',{...rename,name:'  '})).status,400);
    assert.equal((await write(laptop,uri,'PATCH',{...rename,name:'x'.repeat(121)})).status,400);
    assert.equal((await write(laptop,uri,'PATCH',{...rename,revision:2})).status,409);
    const renamed=await write(laptop,uri,'PATCH',rename);
    assert.equal(renamed.status,200);
    const renamedSession=(await renamed.json() as any).session;
    assert.equal(renamedSession.name,'London practice');assert.equal(renamedSession.id,session.id);
    assert.equal(renamedSession.revision,4);
    const afterRename=(await (await desktop.request(uri)).json() as any).session;
    assert.deepEqual(afterRename.checkpoint,restarted.checkpoint);
    assert.deepEqual(afterRename.trades,restarted.trades);
    assert.equal(afterRename.balance,restarted.balance);
    assert.equal((await write(desktop,save,'PUT',{revision:4,checkpoint,trades:[closed]})).status,200);
    // A different session can have the same trade ID; it must survive deletion.
    const otherSave=url+'/'+secondSession.id+'/checkpoint';
    assert.equal((await write(desktop,otherSave,'PUT',payload)).status,200);
    assert.equal((await write(other,uri,'DELETE',{revision:5})).status,404);
    assert.equal((await write(laptop,uri,'DELETE',{})).status,400);
    assert.equal((await write(laptop,uri,'DELETE',{revision:4})).status,409);
    assert.equal((await write(laptop,uri,'DELETE',{revision:5})).status,200);
    assert.equal((await desktop.request(uri)).status,404);
    assert.equal((await write(desktop,save,'PUT',{revision:5,checkpoint,trades:[closed]})).status,404);
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM replay_session_trades WHERE session_id=?').get(session.id) as any).n,0);
    const untouched=(await (await desktop.request(url+'/'+secondSession.id)).json() as any).session;
    assert.deepEqual(untouched.trades,[closed]);assert.equal(untouched.name,'Second');
    assert.equal((await write(laptop,url+'/'+secondSession.id,'PATCH',{revision:1,name:'Renamed second'})).status,200);
    const renamedWithTrades=(await (await desktop.request(url+'/'+secondSession.id)).json() as any).session;
    assert.equal(renamedWithTrades.name,'Renamed second');
    assert.deepEqual(renamedWithTrades.trades,[closed]);assert.deepEqual(renamedWithTrades.checkpoint,checkpoint);
    assert.equal(renamedWithTrades.balance,untouched.balance);
    const finalAnalytics=(await (await desktop.request(analyticsUrl)).json() as any);
    assert.equal(finalAnalytics.accounts.length,1);assert.equal(finalAnalytics.trades.length,1);
    assert.equal(finalAnalytics.trades[0].account,'Renamed second');assert.equal(finalAnalytics.trades[0].replaySessionId,secondSession.id);
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM trades').get() as any).n,0);
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM backtesting_trades').get() as any).n,0);
  } finally {db.close();}
});

test('legacy accounts migrate idempotently and sequential sessions carry balance without duplicating trade identity', async()=>{
  const db=new Database(':memory:');
  try{
    db.pragma('foreign_keys = ON');
    const schema=fs.readFileSync(path.join(__dirname,'../db/schema.sql'),'utf8');
    // Simulate the schema on Babylon before virtual accounts were introduced.
    const legacy=schema.split('-- A virtual account owns a chronological sequence of replay sessions.')[0];
    db.exec(legacy);
    for(const id of ['owner','other'])db.prepare('INSERT INTO profiles(id,email,password_hash,created_at) VALUES(?,?,?,?)').run(id,id+'@example.test','','2026-01-01');
    db.prepare("INSERT INTO market_data_providers(id,user_id,provider_type,display_name) VALUES('p','owner','historical_futures','Historical Futures')").run();
    db.prepare("INSERT INTO market_data_files(id,user_id,provider_id,original_filename,input_format,file_size_bytes,content_sha256,import_status,original_storage_key) VALUES('f','owner','p','NQ.csv','csv',1,'hash','ready','originals/nq.csv')").run();
    const start='2026-01-01T00:00:00.000Z',end='2026-01-01T00:10:00.000Z',later='2026-01-01T00:05:00.000Z';
    db.prepare("INSERT INTO market_data_file_datasets(id,user_id,file_id,data_kind,instrument,timeframe,timestamp_unit,row_count,start_time,end_time,normalized_storage_key) VALUES('d','owner','f','ohlcv','NQ','1m','ms',11,?,?,'normalized/nq.parquet')").run(start,end);
    db.prepare('INSERT INTO replay_sessions(id,user_id,name,start_time,end_time,starting_balance_cents,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run('legacy','owner','Practice',start,end,5000000,start,start);
    db.exec(schema);db.exec(schema);
    const app=(id:string)=>{const a=new Hono<{Bindings:Env;Variables:AuthContext}>();a.use('*',async(c,next)=>{c.set('db',db);c.set('user',{id,email:id+'@example.test'});await next();});a.route('/',backtesting);return a;};
    const desktop=app('owner'),other=app('other'),url='/api/backtesting/replay-sessions';
    const write=(a:typeof desktop,uri:string,method:string,body:unknown)=>a.request(uri,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const get=async(id:string)=>(await (await desktop.request(url+'/'+id)).json() as any).session;
    const base=(await get('legacy'));assert.equal(base.accountId,'legacy');assert.equal(base.canContinue,false);
    const time=Date.parse(start)/1000;
    const trade={id:'replay-1',direction:'long',quantity:1,entryPrice:100,exitPrice:110,entryTime:time,exitTime:time+60,pnl:200,rMultiple:2,fills:[
      {direction:'long',quantity:1,price:100,time,kind:'entry'},
      {direction:'short',quantity:1,price:110,time:time+60,kind:'exit'}]};
    const checkpoint={version:1,marketKey:'NQ::',timeframe:'1m',fingerprint:'a'.repeat(64),index:3,barCount:11,time:time+180,orderSequence:2,quantity:1,quantityPresets:[1,2,3,5,10],speed:2,orderType:'market',orderPrice:'',position:null,pendingOrder:null,layout:{v:1,kind:'grid',layout:'1x2',cells:[]}};
    const save=url+'/legacy/checkpoint';
    const next={name:'Second day',accountId:'legacy',previousRevision:1,startTime:later,endTime:end};
    assert.equal((await write(desktop,url,'POST',next)).status,400);
    assert.equal((await write(desktop,save,'PUT',{revision:0,checkpoint,trades:[trade]})).status,200);
    assert.equal((await write(other,url,'POST',next)).status,400);
    assert.equal((await write(desktop,url,'POST',{...next,startTime:start})).status,400);
    assert.equal((await write(desktop,url,'POST',{...next,previousRevision:0})).status,400);
    const created=await write(desktop,url,'POST',{...next,startingBalance:1});assert.equal(created.status,201);
    const {session}=await created.json() as any;
    assert.equal(session.startingBalance,50200);assert.equal(session.accountStartingBalance,50000);assert.equal(session.sequence,2);assert.equal(session.accountId,'legacy');
    const sealed=await get('legacy');assert.equal(sealed.sealed,true);assert.equal(sealed.revision,2);
    assert.equal((await write(desktop,save,'PUT',{revision:2,checkpoint,trades:[trade]})).status,409);
    assert.equal((await write(desktop,url+'/legacy','DELETE',{revision:2})).status,409);
    assert.equal((await write(desktop,url,'POST',next)).status,400);
    const trade2={...trade,entryTime:time+300,exitTime:time+360,pnl:-50,exitPrice:97.5,fills:[{...trade.fills[0],time:time+300},{...trade.fills[1],time:time+360,price:97.5}]};
    assert.equal((await write(desktop,url+'/'+session.id+'/checkpoint','PUT',{revision:0,checkpoint:{...checkpoint,index:2,barCount:6,time:time+420},trades:[trade2]})).status,200);
    db.exec(schema);
    const analytics=await (await desktop.request('/api/backtesting/replay-analytics')).json() as any;
    assert.equal(analytics.accounts.length,1);assert.equal(analytics.accounts[0].key,'replay::legacy');
    assert.equal(analytics.accounts[0].startingBalance,50000);assert.equal(analytics.accounts[0].balance,50150);assert.equal(analytics.accounts[0].realizedPnl,150);assert.equal(analytics.accounts[0].tradeCount,2);
    assert.equal(new Set(analytics.trades.map((t:any)=>t._id)).size,2);
    assert.ok(analytics.trades.every((t:any)=>t.replayAccountId==='legacy'));
    assert.equal((await get('legacy')).trades[0].pnl,200);
    assert.deepEqual(await (await other.request('/api/backtesting/replay-analytics')).json(),{accounts:[],trades:[]});
  }finally{db.close();}
});
