const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeLayout,
  readLayoutFromValue,
  getDefaultSize,
  completePositions,
  findAvailablePosition,
  getDropPositionFromGrab,
  placeTileAndDisplace,
  createStarterLayout,
  STARTER_LAYOUTS,
} = require('./dashboardLayout');

const items = [
  { id: 'totalPL', minColumns: 1, minRows: 1, defaultColumns: 1, defaultRows: 1 },
  { id: 'winRate', minColumns: 1, minRows: 1, defaultColumns: 1, defaultRows: 1 },
  { id: 'tradingCalendar', minColumns: 4, minRows: 5, defaultColumns: 4, defaultRows: 5 },
  { id: 'equityCurve', minColumns: 2, minRows: 2, defaultColumns: 4, defaultRows: 2 },
  { id: 'performanceByDay', minColumns: 2, minRows: 2, defaultColumns: 4, defaultRows: 2 },
];

test('new dashboard layouts include all valid tiles and respect default visibility', () => {
  const layout = normalizeLayout(null, ['totalPL', 'winRate'], ['totalPL'], items);

  assert.deepEqual(layout.order, ['totalPL', 'winRate', 'tradingCalendar', 'equityCurve', 'performanceByDay']);
  assert.deepEqual(layout.hidden, ['winRate', 'tradingCalendar', 'equityCurve', 'performanceByDay']);
  assert.deepEqual(layout.sizes.tradingCalendar, { w: 4, h: 5 });
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
  assert.deepEqual(layout.sizes.tradingCalendar, { w: 4, h: 5 });
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
  assert.deepEqual(layout.sizes.tradingCalendar, { w: 4, h: 5 });
});

test('saved manual positions are normalized and retained', () => {
  const layout = normalizeLayout({
    gridVersion: 2,
    order: ['totalPL'],
    hidden: [],
    sizes: {},
    positions: { totalPL: { col: 99, row: 3 }, removed: { col: 2, row: 2 } },
  }, ['totalPL'], ['totalPL'], items);

  assert.deepEqual(layout.positions.totalPL, { col: 8, row: 3 });
  assert.equal(Object.keys(layout.positions).length, 1);
});


test('visible tiles receive independent non-overlapping grid positions', () => {
  const layout = normalizeLayout(null, items.map(item => item.id), items.map(item => item.id), items);
  const occupied = [];
  for (const item of items) {
    const position = layout.positions[item.id];
    const size = layout.sizes[item.id];
    assert.ok(position, `Missing position for ${item.id}`);
    assert.equal(occupied.some(entry =>
      position.col < entry.col + entry.w
      && position.col + size.w > entry.col
      && position.row < entry.row + entry.h
      && position.row + size.h > entry.row
    ), false, `Unexpected overlap for ${item.id}`);
    occupied.push({ ...position, ...size });
  }
});

test('an independent tile can be placed in empty space without requiring an adjacent tile', () => {
  const occupied = [{ col: 1, row: 1, w: 2, h: 2 }];
  assert.deepEqual(findAvailablePosition({ w: 2, h: 2 }, occupied, { col: 5, row: 3 }), { col: 5, row: 3 });
});

test('calendar minimum size is four columns by five rows', () => {
  const calendar = items.find(item => item.id === 'tradingCalendar');
  assert.deepEqual(getDefaultSize(calendar), { w: 4, h: 5 });
});


test('reordering tiles preserves their manually assigned positions', () => {
  const positions = {
    totalPL: { col: 1, row: 1 },
    tradingCalendar: { col: 3, row: 2 },
    equityCurve: { col: 7, row: 2 },
  };
  const reordered = completePositions(
    ['equityCurve', 'totalPL', 'tradingCalendar'],
    [],
    {
      totalPL: { w: 1, h: 1 },
      tradingCalendar: { w: 4, h: 5 },
      equityCurve: { w: 2, h: 2 },
    },
    positions
  );

  assert.deepEqual(reordered, positions);
});

test('moving a calendar into another tile displaces only the tile in its way', () => {
  const sizes = {
    totalPL: { w: 1, h: 1 },
    tradingCalendar: { w: 4, h: 5 },
    equityCurve: { w: 2, h: 2 },
    performanceByDay: { w: 2, h: 2 },
  };
  const positions = {
    totalPL: { col: 1, row: 1 },
    tradingCalendar: { col: 3, row: 2 },
    equityCurve: { col: 7, row: 2 },
    performanceByDay: { col: 1, row: 8 },
  };

  const moved = placeTileAndDisplace(
    'tradingCalendar',
    { col: 5, row: 2 },
    ['totalPL', 'tradingCalendar', 'equityCurve', 'performanceByDay'],
    [],
    sizes,
    positions
  );

  assert.deepEqual(moved.tradingCalendar, { col: 5, row: 2 });
  assert.deepEqual(moved.totalPL, positions.totalPL);
  assert.deepEqual(moved.performanceByDay, positions.performanceByDay);
  assert.notDeepEqual(moved.equityCurve, positions.equityCurve);

  const occupied = [];
  for (const id of ['totalPL', 'tradingCalendar', 'equityCurve', 'performanceByDay']) {
    const p = moved[id];
    const size = sizes[id];
    assert.equal(occupied.some(entry =>
      p.col < entry.col + entry.w
      && p.col + size.w > entry.col
      && p.row < entry.row + entry.h
      && p.row + size.h > entry.row
    ), false, `Unexpected overlap for ${id}`);
    occupied.push({ ...p, ...size });
  }
});


test('drop placement preserves the point grabbed inside a wide tile', () => {
  const bounds = { left: 0, top: 0, width: 2048, height: 1200 };
  const gap = 16;
  const trackWidth = (bounds.width - gap * 7) / 8;
  const drop = getDropPositionFromGrab({
    clientX: 5 * (trackWidth + gap) + trackWidth / 2,
    clientY: 3 * 128 + 64,
    bounds,
    columns: 8,
    grabOffset: { col: 1, row: 2 },
    gap,
    rowUnit: 128,
  });

  assert.deepEqual(drop, { col: 5, row: 2 });
});

test('drop placement maps responsive four-column tracks to logical grid columns', () => {
  const bounds = { left: 0, top: 0, width: 1200, height: 800 };
  const gap = 16;
  const trackWidth = (bounds.width - gap * 3) / 4;
  const drop = getDropPositionFromGrab({
    clientX: 2 * (trackWidth + gap) + trackWidth / 2,
    clientY: 128 + 64,
    bounds,
    columns: 4,
    grabOffset: { col: 0, row: 0 },
    gap,
    rowUnit: 128,
  });

  assert.deepEqual(drop, { col: 5, row: 2 });
});


test('dropping a tile onto an occupied area gives it priority and displaces every collision', () => {
  const sizes = {
    moving: { w: 2, h: 2 },
    occupiedA: { w: 1, h: 1 },
    occupiedB: { w: 1, h: 1 },
    untouched: { w: 1, h: 1 },
  };
  const positions = {
    moving: { col: 1, row: 1 },
    occupiedA: { col: 5, row: 3 },
    occupiedB: { col: 6, row: 4 },
    untouched: { col: 8, row: 1 },
  };
  const moved = placeTileAndDisplace(
    'moving',
    { col: 5, row: 3 },
    ['moving', 'occupiedA', 'occupiedB', 'untouched'],
    [],
    sizes,
    positions
  );

  assert.deepEqual(moved.moving, { col: 5, row: 3 });
  assert.notDeepEqual(moved.occupiedA, positions.occupiedA);
  assert.notDeepEqual(moved.occupiedB, positions.occupiedB);
  assert.deepEqual(moved.untouched, positions.untouched);

  const occupied = [];
  for (const id of ['moving', 'occupiedA', 'occupiedB', 'untouched']) {
    const position = moved[id];
    const size = sizes[id];
    assert.equal(occupied.some(entry =>
      position.col < entry.col + entry.w
      && position.col + size.w > entry.col
      && position.row < entry.row + entry.h
      && position.row + size.h > entry.row
    ), false, `Unexpected overlap for ${id}`);
    occupied.push({ ...position, ...size });
  }
});
