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
