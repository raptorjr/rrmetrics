const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getInstrumentSpec } = require('./backtestingReplay');
const { normalizeTradingDisplay, loadTradingDisplay, saveTradingDisplay, formatTradingAmounts, formatPendingDistance } = require('./replayTradingDisplay');
test('trading display loads and saves through the authoritative server, never silently on failure', async () => {
  let stored = null;
  const request = async (url, options) => {
    assert.equal(url, '/api/backtesting/chart-settings');
    if (options?.method === 'PUT') stored = JSON.parse(options.body);
    return { ok: true, json: async () => ({ settings: stored }) };
  };
  assert.deepEqual(await loadTradingDisplay(request), ['currency']);
  assert.deepEqual(await saveTradingDisplay(['ticks', 'invalid', 'points', 'ticks'], request), ['points', 'ticks']);
  assert.deepEqual(await loadTradingDisplay(request), ['points', 'ticks']);
  assert.deepEqual(normalizeTradingDisplay([]), ['currency']);
  await assert.rejects(loadTradingDisplay(async () => ({ ok: false })));
  await assert.rejects(saveTradingDisplay(['points'], async () => ({ ok: false })));
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
