const {test}=require('node:test');
const assert=require('node:assert/strict');
const {replayTradingDay,realizedByDay,buildReplayStatistics}=require('./replayDailyStats');
const {applyReplayFill,INSTRUMENT_SPECS}=require('./backtestingReplay');
const time=s=>Date.parse(s)/1000;
const before=time('2026-11-02T22:59:00Z'),after=time('2026-11-02T23:00:00Z');
test('historical trading day follows New York 18:00 through DST and calendar boundaries',()=>{
 assert.equal(replayTradingDay(before),'2026-11-02');
 assert.equal(replayTradingDay(after),'2026-11-03');
 assert.equal(replayTradingDay(time('2026-07-06T21:59:59Z')),'2026-07-06');
 assert.equal(replayTradingDay(time('2026-07-06T22:00:00Z')),'2026-07-07');
 assert.equal(replayTradingDay(time('2026-12-31T23:00:00Z')),'2027-01-01');
 assert.equal(replayTradingDay(time('2026-11-03T05:00:00Z')),'2026-11-03');
 assert.equal(replayTradingDay(undefined),null);
});
test('daily cash follows actual reductions, completed metrics follow final exit, and closure does not count a partial twice',()=>{
 const spec=INSTRUMENT_SPECS.NQ;
 const start=applyReplayFill(null,{id:'replay-1',direction:'long',quantity:2},100,before-120,spec).position;
 const partial=applyReplayFill(start,{direction:'short',quantity:1},105,before,spec).position;
 const scaled=applyReplayFill(partial,{direction:'long',quantity:1},110,after,spec).position;
 const closed=applyReplayFill(scaled,{direction:'short',quantity:2},103,after+60,spec).trade;
 assert.equal(partial.realizedPnl,100);assert.equal(closed.pnl,20);
 let stats=buildReplayStatistics([],[],partial,'NQ');
 assert.equal(stats.day('2026-11-02').realizedPnl,100);assert.equal(stats.day('2026-11-02').total,0);
 assert.equal(stats.account.realizedPnl,100);
 stats=buildReplayStatistics([],[closed],null,'NQ');
 assert.equal(stats.day('2026-11-02').realizedPnl,100);assert.equal(stats.day('2026-11-02').total,0);
 assert.equal(stats.day('2026-11-03').realizedPnl,-80);assert.equal(stats.day('2026-11-03').netPnl,20);
 assert.equal(stats.day('2026-11-03').wins,1);assert.equal(stats.account.realizedPnl,20);
 assert.equal(stats.session.realizedPnl,20);
});
test('prior sessions contribute to account and same-day statistics regardless of repeated trade IDs',()=>{
 const close=(instrument,direction,entry,exit,t)=>{
  const spec=INSTRUMENT_SPECS[instrument];
  const p=applyReplayFill(null,{id:'replay-1',direction,quantity:1},entry,t-60,spec).position;
  return applyReplayFill(p,{direction:direction==='long'?'short':'long',quantity:1},exit,t,spec).trade;
 };
 const prior={id:'one',instrument:'GC',trades:[close('GC','short',100,99,before),close('GC','long',100,102,after+60)]};
 const current=[close('NQ','long',100,95,after+120)];
 const stats=buildReplayStatistics([prior],current,null,'NQ');
 assert.equal(stats.day('2026-11-02').realizedPnl,100);
 assert.equal(stats.day('2026-11-03').realizedPnl,100);
 assert.equal(stats.day('2026-11-03').total,2);
 assert.equal(stats.day('2026-11-03').profitFactor,2);
 assert.equal(stats.session.total,1);assert.equal(stats.session.realizedPnl,-100);
 assert.equal(stats.account.total,3);assert.equal(stats.account.realizedPnl,200);
 assert.equal(stats.day('2026-11-04').realizedPnl,0);
});
test('unreconciled multi-day allocation remains unavailable without changing stored totals',()=>{
 const trade={direction:'long',pnl:999,exitTime:after,fills:[
  {kind:'entry',direction:'long',quantity:2,price:100,time:before-60},
  {kind:'exit',direction:'short',quantity:1,price:105,time:before},
  {kind:'exit',direction:'short',quantity:1,price:105,time:after}
 ]};
 assert.deepEqual(realizedByDay(trade,'NQ').unknown,['2026-11-02','2026-11-03']);
 const stats=buildReplayStatistics([],[trade],null,'NQ');
 assert.equal(stats.day('2026-11-02').realizedPnl,null);
 assert.equal(stats.day('2026-11-03').realizedPnl,null);
 assert.equal(stats.day('2026-11-04').realizedPnl,0);
 assert.equal(stats.account.realizedPnl,999);
 assert.equal(stats.day('2026-11-03').netPnl,999);
});
