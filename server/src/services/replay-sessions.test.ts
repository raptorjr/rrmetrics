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
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM trades').get() as any).n,0);
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM backtesting_trades').get() as any).n,0);
  } finally {db.close();}
});
