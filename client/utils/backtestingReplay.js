const INSTRUMENT_SPECS = {
  NQ: { pointValue: 20, tickSize: 0.25, decimals: 2, basePrice: 25000 },
  MNQ: { pointValue: 2, tickSize: 0.25, decimals: 2, basePrice: 25000 },
  ES: { pointValue: 50, tickSize: 0.25, decimals: 2, basePrice: 6800 },
  MES: { pointValue: 5, tickSize: 0.25, decimals: 2, basePrice: 6800 },
  GC: { pointValue: 100, tickSize: 0.1, decimals: 2, basePrice: 4200 },
  MGC: { pointValue: 10, tickSize: 0.1, decimals: 2, basePrice: 4200 },
};

function getInstrumentSpec(symbol) {
  return INSTRUMENT_SPECS[String(symbol || '').toUpperCase()] || INSTRUMENT_SPECS.NQ;
}

function createDemoCandles(symbol, count = 720) {
  const spec = getInstrumentSpec(symbol);
  let seed = String(symbol || 'NQ').split('').reduce((value, char) => (value * 31 + char.charCodeAt(0)) >>> 0, 17);
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const candles = [];
  let previousClose = spec.basePrice;
  const startTime = Math.floor(Date.UTC(2026, 10, 9, 0, 0, 0) / 1000);
  const volatility = spec.basePrice > 10000 ? 13 : 3.5;

  for (let index = 0; index < count; index += 1) {
    const open = previousClose;
    const sessionWave = Math.sin(index / 43) * volatility * 0.12;
    const impulse = (random() - 0.49) * volatility;
    const close = Math.max(spec.tickSize, open + impulse + sessionWave);
    const high = Math.max(open, close) + random() * volatility * 0.42;
    const low = Math.min(open, close) - random() * volatility * 0.42;
    candles.push({
      time: startTime + index * 60,
      open: Number(open.toFixed(spec.decimals)),
      high: Number(high.toFixed(spec.decimals)),
      low: Number(low.toFixed(spec.decimals)),
      close: Number(close.toFixed(spec.decimals)),
      volume: Math.round(80 + random() * 620),
    });
    previousClose = close;
  }
  return candles;
}

function parseTimestamp(value) {
  if (typeof value === 'number' || (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim()))) {
    let timestamp = Number(value);
    if (!Number.isFinite(timestamp)) return null;
    if (timestamp > 1e17) timestamp /= 1e9;
    else if (timestamp > 1e14) timestamp /= 1e6;
    else if (timestamp > 1e11) timestamp /= 1000;
    return Math.floor(timestamp);
  }
  if (typeof value !== 'string' || !value.trim()) return null;
  const textValue = value.trim();
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(textValue);
  const normalizedValue = hasZone ? textValue : textValue.replace(' ', 'T') + 'Z';
  const parsed = Date.parse(normalizedValue);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
}

function findField(row, aliases) {
  const keys = Object.keys(row || {});
  for (const alias of aliases) {
    const match = keys.find(key => key.toLowerCase().trim() === alias);
    if (match !== undefined) return row[match];
  }
  return undefined;
}

function normalizeOhlcvRows(rows) {
  if (!Array.isArray(rows)) return [];
  const normalized = [];

  rows.forEach((row) => {
    const time = parseTimestamp(findField(row, ['time', 'timestamp', 'ts', 'datetime', 'date']));
    const open = Number(findField(row, ['open', 'o']));
    const high = Number(findField(row, ['high', 'h']));
    const low = Number(findField(row, ['low', 'l']));
    const close = Number(findField(row, ['close', 'c']));
    const rawVolume = findField(row, ['volume', 'vol', 'v']);
    const volume = rawVolume === undefined || rawVolume === '' ? 0 : Number(rawVolume);

    if (time === null || ![open, high, low, close, volume].every(Number.isFinite)) return;
    if (open <= 0 || high <= 0 || low <= 0 || close <= 0 || volume < 0) return;
    if (high < Math.max(open, close) || low > Math.min(open, close) || high < low) return;

    normalized.push({ time, open, high, low, close, volume });
  });

  normalized.sort((a, b) => a.time - b.time);
  const unique = [];
  normalized.forEach((candle) => {
    if (unique.length && unique[unique.length - 1].time === candle.time) unique[unique.length - 1] = candle;
    else unique.push(candle);
  });
  return unique;
}

function evaluateEntryOrder(order, candle) {
  if (!order || !candle || order.type === 'market') return null;
  const isBuy = order.direction === 'long';
  if (order.type === 'limit') {
    if (!(isBuy ? candle.low <= order.triggerPrice : candle.high >= order.triggerPrice)) return null;
    return { price: isBuy ? Math.min(candle.open, order.triggerPrice) : Math.max(candle.open, order.triggerPrice), reason: 'Limit order filled' };
  }
  if (order.type === 'stop_market') {
    if (!(isBuy ? candle.high >= order.triggerPrice : candle.low <= order.triggerPrice)) return null;
    return { price: isBuy ? Math.max(candle.open, order.triggerPrice) : Math.min(candle.open, order.triggerPrice), reason: 'Stop-market order triggered' };
  }
  return null;
}

function evaluateCandleExit(position, candle) {
  if (!position || !candle) return null;
  const isLong = position.direction === 'long';
  const stopHit = position.stopPrice != null && (isLong ? candle.low <= position.stopPrice : candle.high >= position.stopPrice);
  const targetHit = position.targetPrice != null && (isLong ? candle.high >= position.targetPrice : candle.low <= position.targetPrice);

  if (stopHit) {
    return {
      price: position.stopPrice,
      reason: targetHit ? 'Stop loss (both levels touched; conservative stop-first assumption)' : 'Stop loss',
      ambiguous: targetHit,
    };
  }
  if (targetHit) {
    return { price: position.targetPrice, reason: 'Take profit', ambiguous: false };
  }
  return null;
}

function calculateTradePnl(position, exitPrice, pointValue) {
  if (!position || !Number.isFinite(exitPrice)) return 0;
  const direction = position.direction === 'short' ? -1 : 1;
  return (exitPrice - position.entryPrice) * direction * position.quantity * pointValue;
}

function calculateTradeStats(trades) {
  const safeTrades = Array.isArray(trades) ? trades : [];
  const wins = safeTrades.filter(trade => trade.pnl > 0);
  const losses = safeTrades.filter(trade => trade.pnl < 0);
  const grossProfit = wins.reduce((sum, trade) => sum + trade.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((sum, trade) => sum + trade.pnl, 0));
  const netPnl = grossProfit - grossLoss;
  return {
    total: safeTrades.length,
    wins: wins.length,
    losses: losses.length,
    breakeven: safeTrades.length - wins.length - losses.length,
    winRate: safeTrades.length ? (wins.length / safeTrades.length) * 100 : 0,
    grossProfit,
    grossLoss,
    netPnl,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
  };
}

module.exports = {
  INSTRUMENT_SPECS,
  getInstrumentSpec,
  createDemoCandles,
  parseTimestamp,
  normalizeOhlcvRows,
  evaluateEntryOrder,
  evaluateCandleExit,
  calculateTradePnl,
  calculateTradeStats,
};
