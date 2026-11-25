const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getInstrumentSpec } = require('./backtestingReplay');
const { normalizeTradingDisplay, readTradingDisplay, writeTradingDisplay, formatTradingAmounts, formatPendingDistance } = require('./replayTradingDisplay');
test('trading display defaults, canonical order and persistence', () => {
  const map = new Map();
  const storage = { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value) };
  assert.deepEqual(readTradingDisplay(storage), ['currency']);
  writeTradingDisplay(['ticks', 'invalid', 'points', 'ticks'], storage);
  assert.deepEqual(readTradingDisplay(storage), ['points', 'ticks']);
  assert.deepEqual(normalizeTradingDisplay([]), ['currency']);
  assert.deepEqual(readTradingDisplay({ getItem: () => '{' }), ['currency']);
});
test('all units use correct direction, quantity and instrument tick size', () => {
  const spec = getInstrumentSpec('NQ'), units = ['currency', 'points', 'ticks', 'percent'];
  const ctx = { side: 'buy', entryPrice: 25000, currentPrice: 25024, openQuantity: 2 };
  assert.equal(formatTradingAmounts(ctx, spec, units), '+$960.00 · +24.00 pts · +96 ticks · +0.096%');
  assert.equal(formatTradingAmounts({ ...ctx, side: 'sell' }, spec, units), '-$960.00 · -24.00 pts · -96 ticks · -0.096%');
  assert.equal(formatTradingAmounts({ ...ctx, currentPrice: 25000 }, spec, units), '$0.00 · 0.00 pts · 0 ticks · 0.000%');
  assert.equal(formatTradingAmounts(ctx, getInstrumentSpec('MNQ'), ['currency']), '+$96.00');
  assert.equal(formatPendingDistance({ quantity: 2 }, 24980, 25000, spec, ['currency', 'ticks']), '$800.00 · 80 ticks away');
  assert.equal(formatPendingDistance({ quantity: 2 }, 24980, 0, spec, ['currency']), '');
});
