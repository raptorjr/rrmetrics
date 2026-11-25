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

test('chart positions carry the same point value as replay execution for every configured instrument', () => {
  const { toReplayChartPosition, getInstrumentSpec, INSTRUMENT_SPECS } = require('./backtestingReplay');
  for (const symbol of Object.keys(INSTRUMENT_SPECS)) {
    const spec = getInstrumentSpec(symbol);
    for (const direction of ['long', 'short']) {
      const position = { id: 'p1', direction, entryPrice: 100, quantity: 3, stopPrice: 100, targetPrice: direction === 'long' ? 124 : 76 };
      const chart = toReplayChartPosition(position, spec);
      assert.equal(chart.pointValue, spec.pointValue);
      assert.equal(chart.currencySymbol, '$');
      assert.equal(chart.quantity, 3);
      assert.equal(chart.stopLoss, 100);
      assert.equal(chart.takeProfit, position.targetPrice);
      assert.equal((chart.takeProfit - chart.entryPrice) * chart.quantity * chart.pointValue * (chart.side === 'buy' ? 1 : -1), calculateTradePnl(position, position.targetPrice, spec.pointValue));
    }
  }
});

const { validateReplayQuantity, createReplayPosition, applyReplayFill, advanceReplayOrders, replayBreakevenPrice, seedReplayOrderPrice } = require('./backtestingReplay');
test('scaling long and short positions uses weighted average, realized P/L and one completed trade', () => {
  const spec = { pointValue: 20, tickSize: .25, decimals: 2 };
  for (const direction of ['long', 'short']) {
    const opposite = direction === 'long' ? 'short' : 'long', sign = direction === 'long' ? 1 : -1;
    const order = (direction, quantity) => ({ id: 'p1', direction, quantity, type: 'market', stopPrice: null, targetPrice: null });
    let p = createReplayPosition(order(direction, 2), 100, 1);
    p = updateReplayLevels(p, { stopPrice: 100 - sign * 5, targetPrice: 100 + sign * 20 }, 100, spec).position;
    p = applyReplayFill(p, order(direction, 2), 100 + sign * 4, 2, spec, 'Scale in').position;
    assert.equal(p.quantity, 4);
    assert.equal(p.entryPrice, 100 + sign * 2);
    assert.equal(p.stopPrice, 100 - sign * 5);
    assert.equal(p.targetPrice, 100 + sign * 20);
    assert.equal(p.riskBudgetPoints, 28);
    p = applyReplayFill(p, order(opposite, 1), 100 + sign * 6, 3, spec, 'Scale out').position;
    assert.equal(p.quantity, 3);
    assert.equal(p.realizedPnl, 80);
    assert.equal(calculateTradePnl(p, 100 + sign * 8, 20), 360);
    const result = applyReplayFill(p, order(opposite, 3), 100 + sign * 8, 4, spec, 'Manual close');
    assert.equal(result.position, null);
    assert.equal(result.trade.pnl, 440);
    assert.equal(result.trade.quantity, 4);
    assert.equal(result.trade.fills.length, 4);
    assert.equal(result.trade.rMultiple, 440 / 560);
    assert.equal(calculateTradeStats([result.trade]).total, 1);
  }
});
test('pending scaling honors protective exit priority, never reverses and cancels on flat', () => {
  const spec = { pointValue: 20, tickSize: .25, decimals: 2 };
  const p = createReplayPosition({ id: 'p', direction: 'long', quantity: 2, stopPrice: 95, targetPrice: 110 }, 100, 1);
  const pending = { id: 'o', positionId: 'p', direction: 'short', quantity: 1, type: 'limit', triggerPrice: 105 };
  const partial = advanceReplayOrders(p, pending, { open: 101, high: 106, low: 100, close: 105, time: 2 }, spec);
  assert.equal(partial.position.quantity, 1);
  assert.equal(partial.position.realizedPnl, 100);
  assert.equal(partial.pendingOrder, null);
  const exit = advanceReplayOrders(p, pending, { open: 101, high: 106, low: 94, close: 105, time: 2 }, spec);
  assert.equal(exit.position, null);
  assert.equal(exit.pendingOrder, null);
  assert.equal(exit.trade.pnl, -200);
  assert.ok(validateReplayQuantity(p, 'short', 3));
  assert.ok(validateReplayQuantity({ ...p, quantity: 99 }, 'long', 2));
  assert.equal(validateReplayQuantity(p, 'short', 2), '');
  const flat = advanceReplayOrders(p, { ...pending, quantity: 2 }, { open: 101, high: 106, low: 100, close: 105, time: 2 }, spec);
  assert.equal(flat.trade.pnl, 200);
  assert.equal(flat.position, null);
});
test('fractional average entry uses protective tick rounding at BE and seeds price only on type selection', () => {
  const spec = { pointValue: 20, tickSize: .25, decimals: 2 };
  const long = { direction: 'long', entryPrice: 100.125, stopPrice: 99 };
  const short = { ...long, direction: 'short', stopPrice: 101 };
  assert.equal(replayBreakevenPrice(long, spec), 100.25);
  assert.equal(replayBreakevenPrice(short, spec), 100);
  assert.equal(canMoveToBreakeven(long, 100.25, spec), false);
  assert.equal(canMoveToBreakeven(long, 100.5, spec), true);
  assert.equal(seedReplayOrderPrice('limit', 100.25, spec), '100.25');
  assert.equal(seedReplayOrderPrice('stop_market', 100.25, spec), '100.25');
  assert.equal(seedReplayOrderPrice('market', 100.25, spec), '');
  assert.equal(seedReplayOrderPrice('limit', 0, spec), '');
});

test('adding after a reduction preserves realized P/L and records actual fills', () => {
  const spec = { pointValue: 20, tickSize: .25, decimals: 2 };
  const initial = { id: 'p2', direction: 'long', quantity: 2, stopPrice: null, targetPrice: null };
  let p = createReplayPosition(initial, 100, 1);
  p = applyReplayFill(p, { direction: 'short', quantity: 1 }, 105, 2, spec, 'Scale out').position;
  p = applyReplayFill(p, { direction: 'long', quantity: 2 }, 110, 3, spec, 'Scale in').position;
  assert.equal(p.quantity, 3);
  assert.equal(p.realizedPnl, 100);
  assert.equal(p.riskIncomplete, true);
  const closed = applyReplayFill(p, { direction: 'short', quantity: 3 }, 115, 4, spec, 'Manual close').trade;
  assert.equal(closed.pnl, 600);
  assert.equal(closed.entryPrice, 105);
  assert.equal(closed.exitPrice, 112.5);
  assert.equal(closed.rMultiple, null);
});
