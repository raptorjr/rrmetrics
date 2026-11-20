const MAX_COLUMNS = 8;
const MAX_ROWS = 8;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const getDefaultSize = (item) => ({
  w: clamp(Math.trunc(Number(item.defaultColumns) || 1), Number(item.minColumns) || 1, MAX_COLUMNS),
  h: clamp(Math.trunc(Number(item.defaultRows) || 1), Number(item.minRows) || 1, MAX_ROWS),
});

const hasCollision = (candidate, size, occupied) => occupied.some(entry =>
  candidate.col < entry.col + entry.w
  && candidate.col + size.w > entry.col
  && candidate.row < entry.row + entry.h
  && candidate.row + size.h > entry.row
);

const findAvailablePosition = (size, occupied, preferred = { col: 1, row: 1 }) => {
  const startCol = clamp(Math.trunc(preferred.col) || 1, 1, Math.max(1, MAX_COLUMNS - size.w + 1));
  const startRow = Math.max(1, Math.trunc(preferred.row) || 1);
  for (let rowOffset = 0; rowOffset < 1000; rowOffset += 1) {
    const row = startRow + rowOffset;
    const columns = rowOffset === 0
      ? [...Array.from({ length: MAX_COLUMNS - startCol - size.w + 2 }, (_, index) => startCol + index),
        ...Array.from({ length: startCol - 1 }, (_, index) => index + 1)]
      : Array.from({ length: MAX_COLUMNS - size.w + 1 }, (_, index) => index + 1);
    for (const col of columns) {
      const candidate = { col, row };
      if (!hasCollision(candidate, size, occupied)) return candidate;
    }
  }
  return { col: 1, row: startRow + 1000 };
};

const placeTileAndDisplace = (tileId, target, order, hidden, sizes, savedPositions = {}) => {
  const visible = order.filter(id => !hidden.includes(id));
  const positions = { ...savedPositions };
  const sizeFor = id => sizes[id] || { w: 1, h: 1 };
  const movingSize = sizeFor(tileId);
  const preferred = {
    col: clamp(Math.trunc(Number(target.col) || 1), 1, Math.max(1, MAX_COLUMNS - movingSize.w + 1)),
    row: Math.max(1, Math.trunc(Number(target.row) || 1)),
  };
  const collides = (a, aSize, b, bSize) =>
    a.col < b.col + bSize.w && a.col + aSize.w > b.col
    && a.row < b.row + bSize.h && a.row + aSize.h > b.row;

  const displaced = [];
  const occupied = [];
  visible.forEach(id => {
    if (id === tileId) return;
    const position = positions[id] || { col: 1, row: 1 };
    const size = sizeFor(id);
    if (collides(preferred, movingSize, position, size)) displaced.push(id);
    else occupied.push({ ...position, ...size });
  });

  positions[tileId] = preferred;
  occupied.push({ ...preferred, ...movingSize });
  displaced.forEach(id => {
    const size = sizeFor(id);
    const next = findAvailablePosition(size, occupied, positions[id] || { col: 1, row: 1 });
    positions[id] = next;
    occupied.push({ ...next, ...size });
  });

  return completePositions(order, hidden, sizes, positions);
};

const completePositions = (order, hidden, sizes, savedPositions = {}) => {
  const visible = order.filter(id => !hidden.includes(id));
  const positions = {};
  const occupied = [];
  const reserve = id => {
    const size = sizes[id] || { w: 1, h: 1 };
    const saved = savedPositions[id];
    if (!saved) return false;
    const candidate = {
      col: clamp(Math.trunc(Number(saved.col) || 1), 1, Math.max(1, MAX_COLUMNS - size.w + 1)),
      row: Math.max(1, Math.trunc(Number(saved.row) || 1)),
    };
    if (hasCollision(candidate, size, occupied)) return false;
    positions[id] = candidate;
    occupied.push({ ...candidate, w: size.w, h: size.h });
    return true;
  };
  visible.forEach(reserve);
  visible.forEach(id => {
    if (positions[id]) return;
    const size = sizes[id] || { w: 1, h: 1 };
    const position = findAvailablePosition(size, occupied);
    positions[id] = position;
    occupied.push({ ...position, w: size.w, h: size.h });
  });
  return positions;
};

const normalizeLayout = (saved, defaultOrder, defaultVisible, items) => {
  const ids = items.map(item => item.id);
  const valid = new Set(ids);
  const defaults = [...new Set(defaultOrder.filter(id => valid.has(id))), ...ids.filter(id => !defaultOrder.includes(id))];
  if (!saved || !Array.isArray(saved.order) || !Array.isArray(saved.hidden)) {
    const hidden = defaults.filter(id => !defaultVisible.includes(id));
    const sizes = Object.fromEntries(items.map(item => [item.id, getDefaultSize(item)]));
    return { gridVersion: 2, order: defaults, hidden, sizes, positions: completePositions(defaults, hidden, sizes) };
  }
  const savedOrder = [...new Set(saved.order.filter(id => valid.has(id)))];
  const newIds = defaults.filter(id => !savedOrder.includes(id));
  const order = [...savedOrder, ...newIds];
  const hidden = [...new Set([
    ...saved.hidden.filter(id => valid.has(id)),
    ...newIds.filter(id => !defaultVisible.includes(id)),
  ])];
  const legacy = saved.gridVersion !== 2;
  const sizes = Object.fromEntries(items.map(item => {
    const fallback = getDefaultSize(item);
    const savedSize = saved.sizes && saved.sizes[item.id];
    const rawWidth = Number(savedSize && savedSize.w);
    const migratedWidth = legacy && rawWidth > 1 ? rawWidth * 2 : rawWidth;
    return [item.id, {
      w: clamp(Math.trunc(migratedWidth || fallback.w), Number(item.minColumns) || 1, MAX_COLUMNS),
      h: clamp(Math.trunc(Number(savedSize && savedSize.h) || fallback.h), Number(item.minRows) || 1, MAX_ROWS),
    }];
  }));
  const positions = Object.fromEntries(Object.entries(saved.positions || {}).filter(([id, point]) =>
    valid.has(id) && point && Number.isFinite(Number(point.col)) && Number(point.col) >= 1
    && Number.isFinite(Number(point.row)) && Number(point.row) >= 1
  ).map(([id, point]) => [id, {
    col: clamp(Math.trunc(Number(point.col)), 1, MAX_COLUMNS),
    row: Math.max(1, Math.trunc(Number(point.row))),
  }]));
  return { gridVersion: 2, order, hidden, sizes, positions: completePositions(order, hidden, sizes, positions) };
};

const readLayoutFromValue = (saved, defaultOrder, defaultVisible, items) => {
  try {
    return normalizeLayout(saved, defaultOrder, defaultVisible, items);
  } catch {
    return normalizeLayout(null, defaultOrder, defaultVisible, items);
  }
};

const STARTER_LAYOUTS = [
  {
    id: 'trading-overview',
    name: 'Trading Overview',
    description: 'A balanced daily view with your key numbers, calendar and performance charts.',
    visible: ['totalPL', 'winRate', 'totalTrades', 'avgWinLoss', 'tradingCalendar', 'equityCurve', 'performanceByDay'],
    sizes: {
      avgWinLoss: { w: 1, h: 1 },
      tradingCalendar: { w: 4, h: 5 },
      equityCurve: { w: 4, h: 3 },
      performanceByDay: { w: 4, h: 2 },
    },
  },
  {
    id: 'performance-analysis',
    name: 'Performance Analysis',
    description: 'Focus on equity progression, expectancy and risk-adjusted performance.',
    visible: ['totalPL', 'expectancy', 'profitFactor', 'maxDrawdown', 'sharpeRatio', 'sortinoRatio', 'equityCurve', 'performanceByDay', 'monteCarloSimulation'],
    sizes: {
      equityCurve: { w: 8, h: 3 },
      performanceByDay: { w: 4, h: 2 },
      monteCarloSimulation: { w: 8, h: 3 },
    },
  },
  {
    id: 'trade-analysis',
    name: 'Trade Analysis',
    description: 'Compare direction, instruments, execution times and detailed trade statistics.',
    visible: ['longShortBreakdown', 'detailedStatistics', 'tickerPerformance', 'performanceByEntryTime', 'avgDuration', 'bestTrade', 'worstTrade'],
    sizes: {
      longShortBreakdown: { w: 8, h: 1 },
      detailedStatistics: { w: 4, h: 3 },
      tickerPerformance: { w: 4, h: 3 },
      performanceByEntryTime: { w: 8, h: 3 },
    },
  },
  {
    id: 'minimal',
    name: 'Minimal',
    description: 'Just the essentials: a few key statistics and the equity curve.',
    visible: ['totalPL', 'winRate', 'totalTrades', 'equityCurve'],
    sizes: {
      equityCurve: { w: 8, h: 3 },
    },
  },
];

const createStarterLayout = (starter, items, currentOrder = []) => {
  const ids = items.map(item => item.id);
  const visible = new Set(starter.visible.filter(id => ids.includes(id)));
  const order = [
    ...starter.visible.filter(id => ids.includes(id)),
    ...currentOrder.filter(id => !starter.visible.includes(id) && ids.includes(id)),
    ...ids.filter(id => !starter.visible.includes(id) && !currentOrder.includes(id)),
  ];
  const sizes = Object.fromEntries(items.map(item => {
    const fallback = getDefaultSize(item);
    const preferred = starter.sizes[item.id] || {};
    return [item.id, {
      w: clamp(Math.trunc(Number(preferred.w) || fallback.w), Number(item.minColumns) || 1, MAX_COLUMNS),
      h: clamp(Math.trunc(Number(preferred.h) || fallback.h), Number(item.minRows) || 1, MAX_ROWS),
    }];
  }));
  const hidden = ids.filter(id => !visible.has(id));
  return { gridVersion: 2, order, hidden, sizes, positions: completePositions(order, hidden, sizes) };
};

module.exports = {
  MAX_COLUMNS,
  MAX_ROWS,
  clamp,
  getDefaultSize,
  completePositions,
  findAvailablePosition,
  placeTileAndDisplace,
  normalizeLayout,
  readLayoutFromValue,
  STARTER_LAYOUTS,
  createStarterLayout,
};
