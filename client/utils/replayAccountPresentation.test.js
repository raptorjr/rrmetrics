const {test}=require('node:test');
const assert=require('node:assert/strict');
const {groupReplaySessions,sessionDefaultName,allowedMinutes,closestAllowedTime}=require('./replayAccountPresentation');
test('account grouping preserves stable identity, carried balances and complete totals under filters',()=>{
 const common={accountId:'a',accountName:'First account',accountStartingBalance:25000};
 const first={...common,id:'one',sequence:1,balance:23340,tradeCount:4,winRate:25,status:'completed'};
 const second={...common,id:'two',sequence:2,balance:23540,tradeCount:1,winRate:100,status:'in_progress'};
 const other={...first,id:'three',accountId:'b',sequence:1};
 const groups=groupReplaySessions([second,other,first]);
 assert.equal(groups.length,2);assert.deepEqual(groups[0].sessions,[first,second]);
 assert.equal(groups[0].balance,23540);assert.equal(groups[0].realizedPnl,-1460);
 assert.equal(groups[0].tradeCount,5);assert.equal(groups[0].winRate,40);
 const filtered=groupReplaySessions([second,other,first],'in_progress');
 assert.equal(filtered.length,1);assert.deepEqual(filtered[0].sessions,[second]);assert.equal(filtered[0].tradeCount,5);
 assert.equal(sessionDefaultName(second),'Session 3');assert.equal(sessionDefaultName(null),'Session 1');
});
test('bounded time selection disables invalid minutes and adjusts to an allowed hour',()=>{
 const day='2026-11-02',min=day+'T14:35:00',max=day+'T16:20:00';
 assert.deepEqual(allowedMinutes(day,13,min,max),[]);
 assert.deepEqual(allowedMinutes(day,14,min,max),Array.from({length:25},(_,i)=>i+35));
 assert.deepEqual(allowedMinutes(day,16,min,max),Array.from({length:21},(_,i)=>i));
 assert.equal(closestAllowedTime(day,[14],14,5,min,max),day+'T14:35:00');
 assert.equal(closestAllowedTime(day,[16],16,50,min,max),day+'T16:20:00');
 assert.equal(closestAllowedTime(day,[13],13,0,min,max),null);
 assert.equal(closestAllowedTime(day,[14,15,16],12,0,min,max),day+'T14:35:00');
});
