const test = require('node:test');
const assert = require('node:assert/strict');
const {
  timeframeSeconds,
  getAvailableMarkets,
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
