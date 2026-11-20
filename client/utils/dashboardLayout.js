const MAX_COLUMNS = 4;
const MAX_ROWS = 8;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const getDefaultSize = (item) => ({
  w: clamp(Math.trunc(Number(item.defaultColumns) || 1), Number(item.minColumns) || 1, MAX_COLUMNS),
  h: clamp(Math.trunc(Number(item.defaultRows) || 1), Number(item.minRows) || 1, MAX_ROWS),
});

const normalizeLayout = (saved, defaultOrder, defaultVisible, items) => {
  const ids = items.map(item => item.id);
  const valid = new Set(ids);
  const defaults = [...new Set(defaultOrder.filter(id => valid.has(id))), ...ids.filter(id => !defaultOrder.includes(id))];
  if (!saved || !Array.isArray(saved.order) || !Array.isArray(saved.hidden)) {
    return {
      order: defaults,
      hidden: defaults.filter(id => !defaultVisible.includes(id)),
      sizes: Object.fromEntries(items.map(item => [item.id, getDefaultSize(item)])),
    };
  }
  const savedOrder = [...new Set(saved.order.filter(id => valid.has(id)))];
  const newIds = defaults.filter(id => !savedOrder.includes(id));
  const order = [...savedOrder, ...newIds];
  const hidden = [...new Set([
    ...saved.hidden.filter(id => valid.has(id)),
    ...newIds.filter(id => !defaultVisible.includes(id)),
  ])];
  const sizes = Object.fromEntries(items.map(item => {
    const fallback = getDefaultSize(item);
    const savedSize = saved.sizes && saved.sizes[item.id];
    return [item.id, {
      w: clamp(Math.trunc(Number(savedSize && savedSize.w) || fallback.w), Number(item.minColumns) || 1, MAX_COLUMNS),
      h: clamp(Math.trunc(Number(savedSize && savedSize.h) || fallback.h), Number(item.minRows) || 1, MAX_ROWS),
    }];
  }));
  return { order, hidden, sizes };
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
      tradingCalendar: { w: 2, h: 3 },
      equityCurve: { w: 2, h: 3 },
      performanceByDay: { w: 2, h: 2 },
    },
  },
  {
    id: 'performance-analysis',
    name: 'Performance Analysis',
    description: 'Focus on equity progression, expectancy and risk-adjusted performance.',
    visible: ['totalPL', 'expectancy', 'profitFactor', 'maxDrawdown', 'sharpeRatio', 'sortinoRatio', 'equityCurve', 'performanceByDay', 'monteCarloSimulation'],
    sizes: {
      equityCurve: { w: 4, h: 3 },
      performanceByDay: { w: 2, h: 2 },
      monteCarloSimulation: { w: 4, h: 3 },
    },
  },
  {
    id: 'trade-analysis',
    name: 'Trade Analysis',
    description: 'Compare direction, instruments, execution times and detailed trade statistics.',
    visible: ['longShortBreakdown', 'detailedStatistics', 'tickerPerformance', 'performanceByEntryTime', 'avgDuration', 'bestTrade', 'worstTrade'],
    sizes: {
      longShortBreakdown: { w: 4, h: 1 },
      detailedStatistics: { w: 2, h: 3 },
      tickerPerformance: { w: 2, h: 3 },
      performanceByEntryTime: { w: 4, h: 3 },
    },
  },
  {
    id: 'minimal',
    name: 'Minimal',
    description: 'Just the essentials: a few key statistics and the equity curve.',
    visible: ['totalPL', 'winRate', 'totalTrades', 'equityCurve'],
    sizes: {
      equityCurve: { w: 4, h: 3 },
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
  return {
    order,
    hidden: ids.filter(id => !visible.has(id)),
    sizes,
  };
};

module.exports = {
  MAX_COLUMNS,
  MAX_ROWS,
  clamp,
  getDefaultSize,
  normalizeLayout,
  readLayoutFromValue,
  STARTER_LAYOUTS,
  createStarterLayout,
};
