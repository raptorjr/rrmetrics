const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createDemoCandles,
  normalizeOhlcvRows,
  evaluateCandleExit,
  calculateTradePnl,
  calculateTradeStats,
  parseTimestamp,
} = require('./backtestingReplay');

test('demo candles are deterministic and valid OHLC records', () => {
  const first = createDemoCandles('NQ', 20);
  const second = createDemoCandles('NQ', 20);
  assert.deepEqual(first, second);
  assert.equal(first.length, 20);
  first.forEach((candle) => {
    assert.ok(candle.high >= Math.max(candle.open, candle.close));
    assert.ok(candle.low <= Math.min(candle.open, candle.close));
    assert.ok(candle.high >= candle.low);
  });
});

test('timestamp parser accepts seconds, milliseconds, nanoseconds and ISO strings', () => {
  assert.equal(parseTimestamp(1794182400), 1794182400);
  assert.equal(parseTimestamp(1794182400000), 1794182400);
  assert.equal(parseTimestamp(1794182400000000), 1794182400);
  assert.equal(parseTimestamp(1794182400000000000), 1794182400);
  assert.equal(parseTimestamp('2026-11-09T00:00:00Z'), 1794182400);
  assert.equal(parseTimestamp('2026-11-09 00:00:00'), 1794182400);
});

test('OHLCV normalizer sorts rows, removes duplicate times and rejects invalid bars', () => {
  const rows = [
    { timestamp: 120, open: 101, high: 104, low: 100, close: 103, volume: 10 },
    { timestamp: 60, open: 100, high: 102, low: 99, close: 101, volume: 8 },
    { timestamp: 120, open: 103, high: 105, low: 102, close: 104, volume: 11 },
    { timestamp: 180, open: 100, high: 99, low: 98, close: 98, volume: 2 },
  ];
  const result = normalizeOhlcvRows(rows);
  assert.equal(result.length, 2);
  assert.equal(result[0].time, 60);
  assert.equal(result[1].time, 120);
  assert.equal(result[1].close, 104);
});

test('bar exit uses conservative stop-first handling when both levels are touched', () => {
  const position = { direction: 'long', stopPrice: 99, targetPrice: 103 };
  const result = evaluateCandleExit(position, { low: 98, high: 104 });
  assert.equal(result.price, 99);
  assert.equal(result.ambiguous, true);
});

test('trade P/L handles long and short positions', () => {
  const long = { direction: 'long', entryPrice: 100, quantity: 2 };
  const short = { direction: 'short', entryPrice: 100, quantity: 2 };
  assert.equal(calculateTradePnl(long, 102, 20), 80);
  assert.equal(calculateTradePnl(short, 98, 20), 80);
});

test('trade statistics separate wins, losses and breakeven trades', () => {
  const stats = calculateTradeStats([{ pnl: 100 }, { pnl: -40 }, { pnl: 0 }]);
  assert.equal(stats.total, 3);
  assert.equal(stats.wins, 1);
  assert.equal(stats.losses, 1);
  assert.equal(stats.breakeven, 1);
  assert.equal(stats.netPnl, 60);
  assert.equal(stats.profitFactor, 2.5);
});
