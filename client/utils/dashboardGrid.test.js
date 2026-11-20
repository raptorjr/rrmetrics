const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeLayout,
  readLayoutFromValue,
  getDefaultSize,
  createStarterLayout,
  STARTER_LAYOUTS,
} = require('./dashboardLayout');

const items = [
  { id: 'totalPL', minColumns: 1, minRows: 1, defaultColumns: 1, defaultRows: 1 },
  { id: 'winRate', minColumns: 1, minRows: 1, defaultColumns: 1, defaultRows: 1 },
  { id: 'tradingCalendar', minColumns: 4, minRows: 4, defaultColumns: 4, defaultRows: 4 },
  { id: 'equityCurve', minColumns: 2, minRows: 2, defaultColumns: 4, defaultRows: 2 },
  { id: 'performanceByDay', minColumns: 2, minRows: 2, defaultColumns: 4, defaultRows: 2 },
];

test('new dashboard layouts include all valid tiles and respect default visibility', () => {
  const layout = normalizeLayout(null, ['totalPL', 'winRate'], ['totalPL'], items);

  assert.deepEqual(layout.order, ['totalPL', 'winRate', 'tradingCalendar', 'equityCurve', 'performanceByDay']);
  assert.deepEqual(layout.hidden, ['winRate', 'tradingCalendar', 'equityCurve', 'performanceByDay']);
  assert.deepEqual(layout.sizes.tradingCalendar, { w: 4, h: 4 });
});

test('saved layouts discard removed tiles, deduplicate order and append newly introduced tiles', () => {
  const layout = normalizeLayout({
    order: ['winRate', 'removed', 'winRate'],
    hidden: ['removed', 'totalPL'],
    sizes: { winRate: { w: 99, h: 99 } },
  }, ['totalPL', 'winRate', 'tradingCalendar'], ['totalPL'], items);

  assert.deepEqual(layout.order, ['winRate', 'totalPL', 'tradingCalendar', 'equityCurve', 'performanceByDay']);
  assert.deepEqual(layout.hidden, ['totalPL', 'tradingCalendar', 'equityCurve', 'performanceByDay']);
  assert.deepEqual(layout.sizes.winRate, { w: 8, h: 8 });
});

test('malformed saved layouts safely fall back to defaults', () => {
  const layout = readLayoutFromValue({ order: 'not-an-array', hidden: [] }, ['totalPL'], ['totalPL'], items);

  assert.deepEqual(layout.order, items.map(item => item.id));
  assert.deepEqual(layout.hidden, ['winRate', 'tradingCalendar', 'equityCurve', 'performanceByDay']);
});

test('tile default sizes respect each component minimum and the grid limits', () => {
  assert.deepEqual(getDefaultSize({
    id: 'wide',
    minColumns: 2,
    minRows: 3,
    defaultColumns: 99,
    defaultRows: 1,
  }), { w: 8, h: 3 });
});

test('starter layouts only expose valid tiles and apply independent sizes', () => {
  const knownIds = new Set([
    'totalPL', 'winRate', 'totalTrades', 'avgDuration', 'avgWinLoss',
    'bestTrade', 'worstTrade', 'breakevenRate', 'profitFactor', 'expectancy',
    'maxDrawdown', 'sharpeRatio', 'sortinoRatio', 'kellyRisk',
    'tradingCalendar', 'longShortBreakdown', 'detailedStatistics',
    'tickerPerformance', 'equityCurve', 'performanceByDay',
    'performanceByEntryTime', 'monteCarloSimulation',
  ]);

  assert.equal(STARTER_LAYOUTS.length, 4);
  STARTER_LAYOUTS.forEach(starter => {
    assert.equal(new Set(starter.visible).size, starter.visible.length);
    starter.visible.forEach(id => assert.ok(knownIds.has(id), `Unknown tile in ${starter.name}: ${id}`));
    Object.keys(starter.sizes).forEach(id => assert.ok(starter.visible.includes(id)));
  });
});

test('applying a starter layout preserves the other tiles without overwriting saved layouts', () => {
  const starter = STARTER_LAYOUTS.find(item => item.id === 'trading-overview');
  const itemsWithExtra = [...items, { id: 'extra', minColumns: 1, minRows: 1, defaultColumns: 1, defaultRows: 1 }];
  const layout = createStarterLayout(starter, itemsWithExtra, ['extra', 'performanceByDay', 'totalPL', 'winRate']);

  assert.deepEqual(layout.order, ['totalPL', 'winRate', 'tradingCalendar', 'equityCurve', 'performanceByDay', 'extra']);
  assert.deepEqual(layout.hidden, ['extra']);
  assert.deepEqual(layout.sizes.tradingCalendar, { w: 4, h: 4 });
  assert.deepEqual(layout.sizes.equityCurve, { w: 4, h: 3 });
});


test('legacy four-column layouts migrate to eight-column widths without enlarging compact metric tiles', () => {
  const layout = normalizeLayout({
    order: ['totalPL', 'equityCurve', 'tradingCalendar'],
    hidden: [],
    sizes: {
      totalPL: { w: 1, h: 1 },
      equityCurve: { w: 2, h: 2 },
      tradingCalendar: { w: 2, h: 3 },
    },
  }, ['totalPL', 'equityCurve', 'tradingCalendar'], ['totalPL', 'equityCurve', 'tradingCalendar'], items);

  assert.equal(layout.gridVersion, 2);
  assert.deepEqual(layout.sizes.totalPL, { w: 1, h: 1 });
  assert.deepEqual(layout.sizes.equityCurve, { w: 4, h: 2 });
  assert.deepEqual(layout.sizes.tradingCalendar, { w: 4, h: 4 });
});

test('saved manual positions are normalized and retained', () => {
  const layout = normalizeLayout({
    gridVersion: 2,
    order: ['totalPL'],
    hidden: [],
    sizes: {},
    positions: { totalPL: { col: 99, row: 3 }, removed: { col: 2, row: 2 } },
  }, ['totalPL'], ['totalPL'], items);

  assert.deepEqual(layout.positions, { totalPL: { col: 8, row: 3 } });
});
