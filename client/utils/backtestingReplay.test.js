const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createDemoCandles,
  normalizeOhlcvRows,
  evaluateEntryOrder,
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

test('limit orders fill at the limit or a better opening price', () => {
  const order = { type: 'limit', direction: 'long', triggerPrice: 100 };
  assert.deepEqual(evaluateEntryOrder(order, { open: 101, low: 99, high: 102 }), { price: 100, reason: 'Limit order filled' });
  assert.deepEqual(evaluateEntryOrder(order, { open: 98, low: 97, high: 101 }), { price: 98, reason: 'Limit order filled' });
  assert.equal(evaluateEntryOrder(order, { open: 101, low: 100.5, high: 102 }), null);
});

test('stop-market orders trigger and account for opening gaps', () => {
  const order = { type: 'stop_market', direction: 'long', triggerPrice: 100 };
  assert.deepEqual(evaluateEntryOrder(order, { open: 99, low: 98, high: 101 }), { price: 100, reason: 'Stop-market order triggered' });
  assert.deepEqual(evaluateEntryOrder(order, { open: 102, low: 101, high: 103 }), { price: 102, reason: 'Stop-market order triggered' });
  assert.equal(evaluateEntryOrder(order, { open: 98, low: 97, high: 99 }), null);
});


const { snapReplayPrice, validateReplayEntry, updateReplayLevels, canMoveToBreakeven, replayOrderMenu } = require('./backtestingReplay');
test('BE and profitable stop moves retain initial R for both directions', () => {
  const spec = { tickSize: .25, decimals: 2 };
  for (const direction of ['long', 'short']) {
    const long = direction === 'long';
    const position = { direction, entryPrice: 100, stopPrice: long ? 95 : 105, targetPrice: long ? 120 : 80, initialRiskPoints: 5 };
    const market = long ? 110 : 90;
    assert.equal(canMoveToBreakeven(position, market), true);
    const be = updateReplayLevels(position, { stopPrice: 100 }, market, spec).position;
    assert.equal(be.initialRiskPoints, 5);
    assert.equal(be.targetPrice, position.targetPrice);
    assert.equal(canMoveToBreakeven(be, market), false);
    const profit = updateReplayLevels(be, { stopPrice: long ? 102.13 : 97.87 }, market, spec).position;
    assert.equal(profit.stopPrice, long ? 102.25 : 97.75);
    assert.equal(profit.initialRiskPoints, 5);
    assert.ok(updateReplayLevels(be, { stopPrice: market }, market, spec).error);
    assert.equal(updateReplayLevels(profit, { stopPrice: null }, market, spec).position.initialRiskPoints, 5);
  }
});
test('pending entries and right click choices respect the replay market price', () => {
  const submitted = [];
  const menu = replayOrderMenu(105, 100, [1, 2, 5], 3, String, order => submitted.push(order));
  assert.deepEqual(menu.map(x => x.label), ['Market Buy', 'Market Sell', 'Stop Buy @ 105', 'Limit Sell @ 105']);
  menu[2].submenu[1].onSelect();
  assert.deepEqual(submitted, [{ direction: 'long', type: 'stop_market', quantity: 2, price: 105 }]);
  assert.equal(validateReplayEntry('long', 'stop_market', 105, 100), '');
  assert.ok(validateReplayEntry('long', 'stop_market', 105, 106));
  assert.equal(snapReplayPrice(100.13, { tickSize: .25, decimals: 2 }), 100.25);
});

test('BE can create a stop but never loosens an already profitable stop', () => {
  const spec = { tickSize: .25, decimals: 2 };
  const position = { direction: 'long', entryPrice: 100, stopPrice: null, targetPrice: 120, initialRiskPoints: null };
  assert.equal(canMoveToBreakeven(position, 100), false);
  assert.equal(canMoveToBreakeven(position, 99), false);
  assert.equal(canMoveToBreakeven(position, 100.25), true);
  const result = updateReplayLevels(position, { stopPrice: 100 }, 100.25, spec).position;
  assert.equal(result.stopPrice, 100);
  assert.equal(result.targetPrice, 120);
  assert.equal(result.initialRiskPoints, null);
  assert.equal(canMoveToBreakeven({ ...position, stopPrice: 102 }, 110), false);
});
test('first protective stop fixes R and below-market choices are correct', () => {
  const spec = { tickSize: .25, decimals: 2 };
  const position = { direction: 'short', entryPrice: 100, stopPrice: null, targetPrice: null };
  const first = updateReplayLevels(position, { stopPrice: 105 }, 98, spec).position;
  assert.equal(first.initialRiskPoints, 5);
  const next = updateReplayLevels(first, { stopPrice: 99 }, 97, spec).position;
  assert.equal(next.initialRiskPoints, 5);
  assert.deepEqual(replayOrderMenu(95, 100, [1, 2], 1, String, () => {}).map(x => x.label), ['Market Buy', 'Market Sell', 'Limit Buy @ 95', 'Stop Sell @ 95']);
});
