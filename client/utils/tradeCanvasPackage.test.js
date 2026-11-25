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

test('installed chart package applies unit preferences to position, protective and pending tags', () => {
  const { PositionRenderer, OrderRenderer } = require('@tradecanvas/core');
  const { ChartWidget } = require('@tradecanvas/chart/widget');
  const { formatTradingAmounts, formatPendingDistance } = require('./replayTradingDisplay');
  const { getInstrumentSpec, toReplayChartPosition } = require('./backtestingReplay');
  assert.equal(typeof ChartWidget.prototype.addToolbarButton, 'function');
  const spec = getInstrumentSpec('NQ');
  const viewport = { visibleRange: { from: 0, to: 100 }, priceRange: { min: 24900, max: 25100 },
    barWidth: 10, barSpacing: 0, offset: 0, chartRect: { x: 0, y: 0, width: 1000, height: 300 } };
  const position = toReplayChartPosition({ id: 'p1', direction: 'long', entryPrice: 25000, quantity: 2, stopPrice: 24980, targetPrice: 25024 }, spec);
  const labels = tags => tags.flatMap(tag => tag.cells.map(cell => cell.kind === 'text' ? cell.text : ''));
  const renderer = new PositionRenderer();
  const units = ['currency', 'ticks'];
  const format = ctx => formatTradingAmounts(ctx, spec, units);
  const config = { enabled: true, positionLabel: format, protectiveAmountLabel: format,
    orderDetailLabel: (order, price) => formatPendingDistance(order, price, 25000, spec, units) };
  const drag = { orderId: 'p1', sourceType: 'takeProfit', startPrice: 25024, currentPrice: 25025 };
  const texts = labels(renderer.tags([position], 25006, viewport, config, drag));
  assert.ok(texts.includes('+$240.00 · +24 ticks'));
  assert.ok(texts.includes('-$800.00 · -80 ticks'));
  assert.ok(texts.includes('+$1,000.00 · +100 ticks'));
  const pending = { id: 'o1', side: 'buy', type: 'limit', price: 24990, quantity: 2 };
  assert.ok(labels(new OrderRenderer().tags([pending], viewport, config, null)).includes('$400.00 · 40 ticks away'));
});

test('replay Trading settings uses a native toolbar button exempt from responsive folding', () => {
  const { addReplayTradingSettingsButton } = require('./replayTradingToolbar');
  const classes = new Set(['tcw-btn', 'tcw-host-btn', 'tcw-toolbar-overflow']);
  const attrs = new Map([['data-tcw-folded', '']]);
  const element = { classList: { remove: value => classes.delete(value) },
    removeAttribute: key => attrs.delete(key), setAttribute: (key, value) => attrs.set(key, value) };
  let spec, opened = 0;
  const handle = { element };
  const widget = { addToolbarButton: value => { spec = value; return handle; } };
  assert.equal(addReplayTradingSettingsButton(widget, () => opened++), handle);
  assert.equal(spec.id, 'rr-trading-settings');
  assert.equal(spec.side, 'right');
  assert.equal(spec.text, '');
  assert.equal(spec.icon, 'settings');
  assert.equal(spec.label, 'Settings');
  assert.equal(classes.has('tcw-toolbar-overflow'), false);
  assert.equal(attrs.has('data-tcw-folded'), false);
  assert.equal(attrs.get('aria-label'), 'Settings');
  assert.ok(classes.has('tcw-host-btn'));
  spec.onClick();
  assert.equal(opened, 1);
  assert.equal(addReplayTradingSettingsButton({ addToolbarButton: () => null }, () => {}), null);
});
