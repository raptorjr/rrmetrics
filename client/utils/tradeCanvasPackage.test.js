const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ChartWidgetGrid, ChartWidget } = require('@tradecanvas/chart/widget');

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
  const doc = { createElementNS: (ns, name) => ({ name, attributes: {}, children: [], setAttribute(key, value) { this.attributes[key] = value; }, append(...children) { this.children.push(...children); } }) };
  let spec, opened = 0;
  const handle = { element };
  const widget = { addToolbarButton: value => { spec = value; return handle; } };
  assert.equal(addReplayTradingSettingsButton(widget, () => opened++, doc), handle);
  assert.equal(spec.id, 'rr-trading-settings');
  assert.equal(spec.side, 'right');
  assert.equal(spec.text, 'Settings');
  assert.equal(spec.icon.name, 'svg');
  assert.deepEqual(spec.icon.children.map(child => child.name), ['path', 'circle']);
  assert.equal(spec.label, 'Settings');
  assert.equal(classes.has('tcw-toolbar-overflow'), false);
  assert.equal(attrs.has('data-tcw-folded'), false);
  assert.equal(attrs.get('aria-label'), 'Settings');
  assert.ok(classes.has('tcw-host-btn'));
  spec.onClick();
  assert.equal(opened, 1);
  assert.equal(addReplayTradingSettingsButton({ addToolbarButton: () => null }, () => {}, doc), null);
});

test('installed chart uses replay P/L colour on position tag and axis badge without recolouring protective levels', () => {
  const { PositionRenderer } = require('@tradecanvas/core');
  const { toReplayChartPosition, replayPositionColors, getInstrumentSpec } = require('./backtestingReplay');
  const spec = getInstrumentSpec('NQ');
  const viewport = { visibleRange: { from: 0, to: 100 }, priceRange: { min: 0, max: 100 },
    barWidth: 10, barSpacing: 0, offset: 0, chartRect: { x: 0, y: 0, width: 1000, height: 300 } };
  const renderer = new PositionRenderer();
  const position = { id: 'p1', direction: 'long', quantity: 1, entryPrice: 50, stopPrice: 30, targetPrice: 74 };
  for (const [market, expected] of [[55, '#1fa874'], [45, '#e8505b'], [50, '#4c8dff']]) {
    const config = { enabled: true, pricePrecision: 2, positionColors: replayPositionColors(position, market, spec) };
    const chartPosition = toReplayChartPosition(position, spec);
    const tags = renderer.tags([chartPosition], market, viewport, config);
    assert.deepEqual(tags.map(tag => tag.color), [expected, '#e8505b', '#1fa874']);
    const badges = renderer.axisBadges([chartPosition], viewport, config);
    assert.deepEqual(badges.map(badge => badge.color), ['#e8505b', '#1fa874', expected]);
  }
});

test('installed TradeCanvas provides the grid capture and restore APIs required for saved sessions', () => {
  const { ChartWidgetGrid } = require('@tradecanvas/chart/widget');
  assert.equal(typeof ChartWidgetGrid.prototype.captureLayout, 'function');
  assert.equal(typeof ChartWidgetGrid.prototype.restoreLayout, 'function');
});

test('installed chart captures and restores independent host replay viewport and embedded overlay support', () => {
  const { Chart } = require('@tradecanvas/chart');
  assert.equal(typeof Chart.prototype.captureHostReplayView,'function');
  assert.equal(typeof Chart.prototype.restoreHostReplayView,'function');
  const {ChartWidget}=require('@tradecanvas/chart/widget');
  assert.match(String(ChartWidget), /overlayContainer/);
});


test('installed chart supports the native volume visibility and host style override API', () => {
  const {Chart}=require('@tradecanvas/chart');
  const {ChartWidget}=require('@tradecanvas/chart/widget');
  for(const method of ['getStyleValue','getOverrides','applyOverrides','setVolumeVisible','isVolumeVisible'])assert.equal(typeof Chart.prototype[method],'function',method);
  assert.equal(typeof ChartWidget.prototype.getSettings,'function');
  assert.equal(typeof ChartWidget.prototype.setSettings,'function');
});


test('replay host disables native chart fullscreen in initial and future grid cells', () => {
  const fs=require('node:fs');
  const source=fs.readFileSync(require('node:path').join(__dirname,'../components/pages/ReplayTradeCanvasGrid.jsx'),'utf8');
  assert.equal(source.split("fullscreen: false, 'toolbar.fullscreen': false").length-1,2);
  assert.ok(source.includes('[data-replay-workspace] .tcw-toolbar [data-role="fullscreen"]'));
});


test('installed chart package supports independent static replay markets',()=>{
  assert.equal(typeof ChartWidget.prototype.setHostTimeframes,'function');
  assert.match(String(ChartWidgetGrid),/onChartSymbolChange/);
  assert.match(String(ChartWidgetGrid),/onChartMenuItems/);
  assert.match(String(ChartWidgetGrid),/onChartUnpark/);
});


test('RR Metrics does not install retired market-chart libraries',()=>{
  const manifest=require('../../package.json'),lock=require('../../package-lock.json');
  for(const name of ['lightweight-charts','klinecharts','fancy-canvas']){
    assert.equal(Object.hasOwn(manifest.dependencies||{},name),false,name);
    assert.equal(Object.hasOwn(manifest.devDependencies||{},name),false,name);
    assert.equal(Object.keys(lock.packages).some(path=>path==='node_modules/'+name||path.endsWith('/node_modules/'+name)),false,name);
  }
  assert.ok(manifest.dependencies['@tradecanvas/chart']);
});
