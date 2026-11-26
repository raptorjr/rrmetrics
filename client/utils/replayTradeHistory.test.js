const test=require('node:test');
const assert=require('node:assert/strict');
const {replayHistoryRows,replayFillSide}=require('./replayTradeHistory');
test('history is newest first, without mutating trades or their ordered fills',()=>{
  const fills=[{time:4,kind:'entry',direction:'long'},{time:4,kind:'exit',direction:'short'}];
  const trades=[{id:'a',exitTime:4,pnl:25,fills},{id:'b',exitTime:4,pnl:-5},{id:'c',exitTime:8,pnl:0}];
  const rows=replayHistoryRows(trades);
  assert.deepEqual(rows.map(t=>t.id),['c','b','a']);
  assert.deepEqual(trades.map(t=>t.id),['a','b','c']);
  assert.strictEqual(rows[2].fills,fills);
  assert.equal(rows[2].pnl,25);
  assert.deepEqual(replayHistoryRows([]),[]);
});
test('fill direction describes the executed side, not the round-trip side',()=>{
  assert.equal(replayFillSide({direction:'long',kind:'exit'}),'Buy');
  assert.equal(replayFillSide({direction:'short',kind:'exit'}),'Sell');
});
