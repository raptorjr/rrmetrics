const {test}=require('node:test');
const assert=require('node:assert/strict');
const {nextGoToIndex,defaultGoTo}=require('./replayGoTo');
const bars=(...times)=>times.map(t=>({time:Date.parse(t)/1000}));
test('go to uses NY wall time across standard and daylight time',()=>{
  assert.equal(nextGoToIndex(bars('2026-01-05T06:59:00Z','2026-01-05T07:00:00Z','2026-01-05T08:00:00Z'),0,'02:00'),1);
  assert.equal(nextGoToIndex(bars('2026-07-06T05:59:00Z','2026-07-06T06:00:00Z'),0,'02:00'),1);
});
test('go to moves strictly forward and skips closed days without inventing data',()=>{
  const data=bars('2026-11-06T13:00:00Z','2026-11-06T13:01:00Z','2026-11-08T23:00:00Z','2026-11-09T13:00:00Z');
  assert.equal(nextGoToIndex(data,0,'08:00'),3);
  assert.equal(nextGoToIndex(data,1,'17:00'),2);
  assert.equal(nextGoToIndex(data,3,'08:00'),-1);
});
test('nonexistent DST hour is skipped and defaults are independent',()=>{
  const data=bars('2026-03-08T05:00:00Z','2026-03-08T07:00:00Z','2026-03-09T06:00:00Z');
  assert.equal(nextGoToIndex(data,0,'02:00'),2);
  const a=defaultGoTo();a[0].enabled=false;assert.equal(defaultGoTo()[0].enabled,true);
});
