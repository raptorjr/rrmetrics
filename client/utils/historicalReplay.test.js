const test = require('node:test');
const assert = require('node:assert/strict');
const {
  timeframeSeconds,
  getAvailableMarkets,
  isRangeWithinCoverage,
  aggregateCandles,
} = require('./historicalReplay');

test('market catalogue exposes only available native and aggregatable timeframes', () => {
  const markets = getAvailableMarkets([
    { id: 'a', instrument: 'MGC', source_symbol: 'MGCZ6', timeframe: '10s', start_time: '2026-11-02T00:00:00.000Z', end_time: '2026-11-03T00:00:00.000Z' },
    { id: 'b', instrument: 'MGC', source_symbol: 'MGCZ6', timeframe: '1m', start_time: '2026-11-02T00:00:00.000Z', end_time: '2026-11-04T00:00:00.000Z' },
    { id: 'c', instrument: 'ES', source_symbol: 'ESZ6', timeframe: '1m', start_time: '2026-11-05T00:00:00.000Z', end_time: '2026-11-06T00:00:00.000Z' },
  ]);
  assert.equal(markets.length, 2);
  const mgc = markets.find(market => market.instrument === 'MGC');
  assert.equal(mgc.baseTimeframe, '10s');
  assert.deepEqual(mgc.availableTimeframes, ['10s', '30s', '1m', '2m', '3m', '5m', '10m', '15m', '30m', '1h', '2h', '4h']);
  assert.equal(mgc.coverage[0].end, Date.parse('2026-11-03T00:00:00.000Z'));
  assert.equal(timeframeSeconds('5m'), 300);
  assert.equal(timeframeSeconds('1d'), 86400);
});

test('higher timeframe aggregation preserves OHLCV and UTC bucket boundaries', () => {
  const bars = [
    { time: 0, open: 10, high: 12, low: 9, close: 11, volume: 5 },
    { time: 10, open: 11, high: 13, low: 10, close: 12, volume: 7 },
    { time: 20, open: 12, high: 14, low: 8, close: 9, volume: 3 },
    { time: 30, open: 9, high: 10, low: 7, close: 8, volume: 4 },
  ];
  assert.deepEqual(aggregateCandles(bars, '30s'), [
    { time: 0, open: 10, high: 14, low: 8, close: 9, volume: 15 },
    { time: 30, open: 9, high: 10, low: 7, close: 8, volume: 4 },
  ]);
});

test('market catalogue does not advertise trade-only datasets as chart markets', () => {
  const markets = getAvailableMarkets([
    { id: 'tick', data_kind: 'trades', instrument: 'ES', source_symbol: 'ESZ6', timeframe: null, start_time: '2026-11-02T00:00:00.000Z', end_time: '2026-11-03T00:00:00.000Z' },
  ]);
  assert.deepEqual(markets, []);
});

test('replay date range must stay inside one continuous coverage period', () => {
  const coverage = { start: Date.parse('2026-11-09T00:00:00.000Z'), end: Date.parse('2026-11-10T23:59:59.000Z') };
  assert.equal(isRangeWithinCoverage(Date.parse('2026-11-09T01:00:00.000Z'), Date.parse('2026-11-10T12:00:00.000Z'), coverage), true);
  assert.equal(isRangeWithinCoverage(Date.parse('2026-11-08T23:59:59.000Z'), coverage.end, coverage), false);
  assert.equal(isRangeWithinCoverage(coverage.start, Date.parse('2026-11-11T00:00:00.000Z'), coverage), false);
  assert.equal(isRangeWithinCoverage(coverage.end, coverage.start, coverage), false);
});

test('market catalogue keeps disjoint coverage periods separate', () => {
  const markets = getAvailableMarkets([
    { id: 'first', instrument: 'NQ', source_symbol: null, timeframe: '1m', start_time: '2026-11-09T00:00:00.000Z', end_time: '2026-11-09T23:59:00.000Z' },
    { id: 'second', instrument: 'NQ', source_symbol: null, timeframe: '1m', start_time: '2026-11-11T00:00:00.000Z', end_time: '2026-11-11T23:59:00.000Z' },
  ]);
  assert.equal(markets.length, 1);
  assert.equal(markets[0].sourceSymbol, '');
  assert.equal(markets[0].coverage.length, 2);
  assert.equal(isRangeWithinCoverage(
    Date.parse('2026-11-09T01:00:00.000Z'),
    Date.parse('2026-11-09T20:00:00.000Z'),
    markets[0].coverage[0],
  ), true);
  assert.equal(isRangeWithinCoverage(
    Date.parse('2026-11-09T20:00:00.000Z'),
    Date.parse('2026-11-11T02:00:00.000Z'),
    markets[0].coverage[0],
  ), false);
});

test('saved replay date ranges only offer eligible base-resolution markets', () => {
  const { getSessionMarkets } = require('./historicalReplay');
  const start = Date.parse('2026-01-01T00:00:00Z'), end = Date.parse('2026-01-02T00:00:00Z');
  const row = (instrument, timeframe, a, b) => ({instrument,timeframe,data_kind:'ohlcv',start_time:new Date(a).toISOString(),end_time:new Date(b).toISOString()});
  const markets = getSessionMarkets([row('NQ','1m',start,end),row('ES','1m',start,end-60000),row('ES','5m',start,end)],start,end);
  assert.deepEqual(markets.map(m=>m.instrument),['NQ']);
});

test('time-based playback progresses equally on different execution intervals', () => {
  const {restoreReplaySpeed,replayStepBudget}=require('./historicalReplay');
  assert.equal(restoreReplaySpeed(null,10),60);
  assert.equal(restoreReplaySpeed({speed:10},10),120);
  assert.equal(restoreReplaySpeed({speed:60,speedMode:'time'},1),60);
  for(const seconds of [1,10,60]) {
    let carry=0,bars=0;
    for(let n=0;n<20;n++){
      const result=replayStepBudget(50,carry,60,seconds);carry=result.carry;bars+=result.count;
    }
    assert.equal(bars*seconds,60);assert.ok(carry<1e-8);
  }
  assert.equal(replayStepBudget(60000,0,60,1).count,15);
});


test('chart starts at shortest compatible favourite independently of execution and includes source intervals', () => {
  const {replayChartIntervals}=require('./historicalReplay');
  const result=replayChartIntervals('10s',['10s','30s','1m'],['15m','1m']);
  assert.equal(result.initial,'1m');assert.ok(result.menu.includes('10s'));assert.ok(result.menu.includes('30s'));
  assert.equal(replayChartIntervals('1m',['1m'],['10s','5m']).initial,'5m');
  assert.ok(!replayChartIntervals('10s',['15s']).menu.includes('15s'));
});
test('restart clears only drawings and host viewport while retaining chart layout and indicators', () => {
  const {resetReplayChartLayout}=require('./historicalReplay');
  const original={layout:'1x2',cells:[{timeframe:'5m',chart:{drawings:[{id:'future'}],hostReplayView:{from:100},indicators:[{id:'ema'}]}},{chart:null}]};
  const reset=resetReplayChartLayout(original);
  assert.deepEqual(reset.cells[0].chart,{drawings:[],indicators:[{id:'ema'}]});assert.equal(reset.cells[0].timeframe,'5m');assert.equal(original.cells[0].chart.drawings.length,1);
});


test('restart clears the independent per-symbol drawing bank',()=>{
  const {resetReplayChartLayout}=require('./historicalReplay');
  const layout={rrMultiSymbol:true,rrDrawings:{MGC:[{id:'a'}],MNQ:[{id:'b'}]},rrContextSources:{MNQ:{fingerprint:'source'}},cells:[{chart:{drawings:[{id:'a'}]}}]};
  const restarted=resetReplayChartLayout(layout);
  assert.deepEqual(restarted.rrDrawings,{});
  assert.deepEqual(restarted.rrContextSources,layout.rrContextSources);
  assert.deepEqual(restarted.cells[0].chart.drawings,[]);
});

test('clickable replay ranges group identical market coverage and round inward to minute precision',()=>{
  const {replaySessionRangeChoices,getSessionMarkets}=require('./historicalReplay');
  const row=(instrument,timeframe,start_time,end_time)=>({instrument,timeframe,start_time,end_time,data_kind:'ohlcv'});
  const datasets=[
    row('MGC','10s','2026-11-02T00:00:10Z','2026-11-23T05:32:50Z'),
    row('NQ','1m','2026-11-09T00:00:00Z','2026-11-09T23:59:00Z'),
    row('ES','1m','2026-11-09T00:00:00Z','2026-11-09T23:59:00Z'),
  ];
  const ranges=replaySessionRangeChoices(datasets);
  assert.equal(ranges.length,2);
  assert.equal(ranges[0].start,Date.parse('2026-11-02T00:01:00Z'));
  assert.equal(ranges[0].end,Date.parse('2026-11-23T05:32:00Z'));
  assert.deepEqual(ranges[1].sourceLabels,['ES','NQ']);
  assert.deepEqual(ranges[1].eligibleLabels,['ES','MGC','NQ']);
  assert.deepEqual(getSessionMarkets(datasets,Date.parse('2026-11-08T23:00:00Z'),ranges[1].end).map(m=>m.instrument),['MGC']);
});

test('continuation skips revealed minutes and expired source ranges without bridging gaps',()=>{
 const {continuationRanges,earliestContinuationRange}=require('./historicalReplay');
 const m=Date.parse('2026-11-01T00:00:00Z'),minute=60000;
 const ranges=[{key:'later',start:m+10*minute,end:m+20*minute},{key:'overlap',start:m,end:m+5*minute},{key:'old',start:m-minute*3,end:m}];
 const result=continuationRanges(ranges,new Date(m+10000).toISOString());
 assert.deepEqual(result.map(r=>[r.key,r.start,r.end]),[['later',m+10*minute,m+20*minute],['overlap',m+minute,m+5*minute]]);
 assert.equal(earliestContinuationRange(result).key,'overlap');
 assert.equal(earliestContinuationRange(continuationRanges(ranges,new Date(m+20*minute).toISOString())),null);
 assert.equal(continuationRanges(ranges,null),ranges);
});

test('logarithmic slider spans the full supported range and preserves saved intermediate speeds',()=>{
 const {replaySpeedAtPercent,replaySpeedPercent,restoreReplaySpeed}=require('./historicalReplay');
 assert.equal(replaySpeedAtPercent(0),1);assert.equal(replaySpeedAtPercent(100),1200);
 assert.equal(replaySpeedAtPercent(50),35);
 for(const speed of [1,2,17,60,83,239,600,1199,1200]){
   assert.equal(replaySpeedAtPercent(replaySpeedPercent(speed)),speed);
   assert.equal(restoreReplaySpeed({speed,speedMode:'time'},10),speed);
 }
 assert.equal(restoreReplaySpeed({speed:9999,speedMode:'time'},10),1200);
 assert.equal(restoreReplaySpeed({speed:0,speedMode:'time'},10),1);
 assert.equal(restoreReplaySpeed({speed:NaN,speedMode:'time'},10),60);
});
