const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ChartWidgetGrid } = require('@tradecanvas/chart/widget');

test('installed TradeCanvas grid supports the replay-disabled toolbar picker', () => {
  // Check the compiled package actually used by RR Metrics, not the source
  // repository or a potentially stale preview alias.
  assert.equal(typeof ChartWidgetGrid, 'function');
  assert.match(String(ChartWidgetGrid), /layoutPickerInToolbar/);
  const sync = ChartWidgetGrid.prototype.syncSharedToolbar;
  assert.equal(typeof sync, 'function');
  assert.match(String(sync), /layoutPickerInToolbar/);
  assert.match(String(sync), /data-role=.objects/);
  assert.match(String(sync), /insertBefore/);
});

test('installed TradeCanvas supports the host-owned replay viewport', () => {
  const { Chart } = require('@tradecanvas/chart');
  assert.equal(typeof Chart.prototype.setHostReplayViewport, 'function');
});

test('installed TradeCanvas exposes the native trading overlay and intent API', () => {
  const { Chart } = require('@tradecanvas/chart');
  for (const method of ['setOrders', 'setPositions', 'setTradingConfig', 'modifyPositionIntent', 'cancelOrderIntent', 'closePositionIntent']) {
    assert.equal(typeof Chart.prototype[method], 'function', method);
  }
});

test('installed TradeCanvas renders the replay contract multiplier on SL and TP', () => {
  const { PositionRenderer } = require('@tradecanvas/core');
  const { toReplayChartPosition, getInstrumentSpec, calculateTradePnl } = require('./backtestingReplay');
  const viewport = { visibleRange: { from: 0, to: 100 }, priceRange: { min: 0, max: 100 },
    barWidth: 10, barSpacing: 0, offset: 0, chartRect: { x: 0, y: 0, width: 1000, height: 100 }, numberLocale: 'en-US' };
  const spec = getInstrumentSpec('NQ');
  const position = { id: 'p1', direction: 'long', quantity: 1, entryPrice: 50, stopPrice: 30, targetPrice: 74 };
  const chartPosition = toReplayChartPosition(position, spec);
  const tags = new PositionRenderer().tags([chartPosition], 55, viewport, { enabled: true, pricePrecision: 2 });
  const labels = tags.flatMap(tag => tag.cells.map(cell => cell.kind === 'text' ? cell.text : ''));
  assert.equal(calculateTradePnl(position, 30, spec.pointValue), -400);
  assert.equal(calculateTradePnl(position, 74, spec.pointValue), 480);
  assert.ok(labels.includes('-$400.00'));
  assert.ok(labels.includes('+$480.00'));
});
