const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  createStarterLayout,
  createBreakpointLayout,
  normalizeDashboardLayouts,
  getResponsivePositions,
  getResizedTileGeometry,
} = require('./dashboardLayout');

const items = [
  { id: 'a', defaultColumns: 4, defaultRows: 2 },
  { id: 'b', defaultColumns: 4, defaultRows: 2 },
  { id: 'c', defaultColumns: 8, defaultRows: 2 },
  { id: 'd', defaultColumns: 2, defaultRows: 1 },
];
const order = items.map(item => item.id);
const visible = order;
const starter = {
  visible,
  sizes: {
    a: { w: 4, h: 2 },
    b: { w: 4, h: 2 },
    c: { w: 8, h: 2 },
    d: { w: 2, h: 1 },
  },
};

const hasOverlap = (positions, layout, columns) => {
  const placed = Object.entries(positions).map(([id, point]) => ({
    id,
    col: point.col,
    row: point.row,
    width: point.width,
    height: layout.sizes[id].h,
  }));
  return placed.some((a, index) => placed.slice(index + 1).some(b =>
    a.col < b.col + b.width
    && a.col + a.width > b.col
    && a.row < b.row + b.height
    && a.row + a.height > b.row
  ));
};

test('breakpoint layouts are collision-free at 2, 4 and 8 columns', () => {
  const base = createStarterLayout(starter, items, order);
  for (const columns of [2, 4, 8]) {
    const layout = createBreakpointLayout(base, columns, items, order, visible);
    const visibleItems = order.map(id => items.find(item => item.id === id));
    const positions = getResponsivePositions(visibleItems, layout, columns);
    assert.equal(hasOverlap(positions, layout, columns), false, `overlap at ${columns} columns`);
  }
});

test('normalizing a legacy dashboard creates independent breakpoint layouts', () => {
  const base = createStarterLayout(starter, items, order);
  const dashboard = normalizeDashboardLayouts(
    { id: 'legacy', name: 'Legacy', layout: base },
    order,
    visible,
    items
  );
  assert.ok(dashboard.layouts[2]);
  assert.ok(dashboard.layouts[4]);
  assert.ok(dashboard.layouts[8]);
  assert.deepEqual(dashboard.layouts[8].positions, base.positions);
});

test('saved breakpoint positions remain independent', () => {
  const base = createStarterLayout(starter, items, order);
  const narrow = createBreakpointLayout(base, 2, items, order, visible);
  narrow.positions.a = { col: 5, row: 7 };
  const dashboard = normalizeDashboardLayouts(
    { id: 'custom', name: 'Custom', layout: base, layouts: { 2: narrow } },
    order,
    visible,
    items
  );
  assert.deepEqual(dashboard.layouts[2].positions.a, { col: 5, row: 7 });
  assert.deepEqual(dashboard.layouts[8].positions, base.positions);
});

test('minimum-area correction keeps narrow-breakpoint widths aligned', () => {
  const geometry = getResizedTileGeometry({
    position: { col: 1, row: 1 },
    size: { w: 4, h: 2 },
    corner: 'se',
    deltaX: 0,
    deltaY: -128,
    gridWidth: 400,
    columns: 2,
    gap: 16,
    rowUnit: 128,
    minW: 4,
    minH: 1,
    minArea: 5,
    maxW: 8,
  });
  assert.equal(geometry.size.w % 4, 0);
  assert.equal(geometry.size.w, 8);
});

test('resizing at narrower breakpoints changes width in whole visible columns', () => {
  const geometry = getResizedTileGeometry({
    position: { col: 1, row: 1 },
    size: { w: 4, h: 2 },
    corner: 'se',
    deltaX: 180,
    deltaY: 0,
    gridWidth: 400,
    columns: 2,
    gap: 16,
    rowUnit: 128,
    minW: 4,
    minH: 1,
    maxW: 8,
  });
  assert.equal(geometry.size.w % 4, 0);
  assert.equal(geometry.size.w, 8);
});


test('dashboard grid width observer attaches after dashboards finish loading', () => {
  const source = fs.readFileSync(path.join(__dirname, '../components/shared/DashboardGrid.jsx'), 'utf8');
  assert.match(source, /const element = gridRef\.current;[\s\S]*?if \(!element\) return undefined;[\s\S]*?\}, \[dashboardReady\]\);/);
});
