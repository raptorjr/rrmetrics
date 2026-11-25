const {test}=require('node:test');
const assert=require('node:assert/strict');
const {parseClockTime,formatClockTime}=require('./clockTime');

test('shared clock preserves second precision for trades and uses only minutes for Go to',()=>{
  const time={hour:18,minute:55,second:30};
  assert.equal(formatClockTime(time,'24h'),'18:55:30');
  assert.equal(formatClockTime(time,'24h',false),'18:55');
  assert.equal(formatClockTime(time,'12h',false),'06:55 PM');
  assert.deepEqual(parseClockTime('18:55:30','24h'),time);
  assert.deepEqual(parseClockTime('06:55 PM','12h',false),{hour:18,minute:55,second:0});
  assert.equal(parseClockTime('18:55:30','24h',false),null);
});

test('shared clock validates typed time and midnight/noon',()=>{
  assert.equal(parseClockTime('24:00','24h',false),null);
  assert.equal(parseClockTime('18:60','24h',false),null);
  assert.equal(parseClockTime('00:00 AM','12h',false),null);
  assert.equal(parseClockTime('13:00 PM','12h',false),null);
  assert.equal(parseClockTime('06:55','12h',false),null);
  assert.equal(parseClockTime('12:00 AM','12h',false).hour,0);
  assert.equal(parseClockTime('12:00 PM','12h',false).hour,12);
  assert.equal(formatClockTime({hour:0,minute:0},'12h',false),'12:00 AM');
});
