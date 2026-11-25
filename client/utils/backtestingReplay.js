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

// Replay orders are evaluated by RR Metrics only. Never use unrevealed prices.
function snapReplayPrice(price, spec) {
  if (price == null || !Number.isFinite(Number(price))) return NaN;
  return Number((Math.round(Number(price) / spec.tickSize) * spec.tickSize).toFixed(spec.decimals));
}

function validateReplayLevels(direction, referencePrice, stopPrice, targetPrice) {
  if (!Number.isFinite(referencePrice) || referencePrice <= 0) return 'No valid replay price.';
  if (stopPrice != null && (!Number.isFinite(stopPrice) || stopPrice <= 0 || (direction === 'long' ? stopPrice >= referencePrice : stopPrice <= referencePrice))) {
    return 'Stop loss must be below the reference price for a long, and above it for a short.';
  }
  if (targetPrice != null && (!Number.isFinite(targetPrice) || targetPrice <= 0 || (direction === 'long' ? targetPrice <= referencePrice : targetPrice >= referencePrice))) {
    return 'Take profit must be above the reference price for a long, and below it for a short.';
  }
  return '';
}

function validateReplayEntry(direction, type, price, marketPrice) {
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(marketPrice) || marketPrice <= 0) return 'No valid order price.';
  if (type === 'market') return '';
  const above = direction === 'long' ? type === 'stop_market' : type === 'limit';
  if (!['limit', 'stop_market'].includes(type) || (above ? price <= marketPrice : price >= marketPrice)) return 'Order price is no longer on the valid side of the market.';
  return '';
}

function updateReplayLevels(position, changes, marketPrice, spec) {
  const stopPrice = changes.stopPrice === undefined ? position.stopPrice : changes.stopPrice === null ? null : snapReplayPrice(changes.stopPrice, spec);
  const targetPrice = changes.targetPrice === undefined ? position.targetPrice : changes.targetPrice === null ? null : snapReplayPrice(changes.targetPrice, spec);
  const error = validateReplayLevels(position.direction, marketPrice,
    changes.stopPrice === undefined ? null : stopPrice, changes.targetPrice === undefined ? null : targetPrice);
  if (error) return { error };
  // A later move to BE or into profit must not redefine initial R.
  const firstRisk = stopPrice != null && (position.direction === 'long' ? stopPrice < position.entryPrice : stopPrice > position.entryPrice)
    ? Math.abs(position.entryPrice - stopPrice) : null;
  const updated = { ...position, stopPrice, targetPrice, initialRiskPoints: position.initialRiskPoints ?? firstRisk };
  if (position.fills && position.riskBudgetPoints == null && !position.riskIncomplete && firstRisk != null) {
    updated.riskBudgetPoints = firstRisk * position.quantity;
  }
  return { position: updated };
}

// A weighted entry can be between ticks. Round toward protection rather than a loss.
function replayBreakevenPrice(position, spec) {
  if (!spec) return position.entryPrice;
  const ticks = position.entryPrice / spec.tickSize;
  const tick = position.direction === 'long' ? Math.ceil(ticks - 1e-8) : Math.floor(ticks + 1e-8);
  return Number((tick * spec.tickSize).toFixed(spec.decimals));
}

function canMoveToBreakeven(position, marketPrice, spec) {
  if (!position || !Number.isFinite(marketPrice)) return false;
  const long = position.direction === 'long';
  const price = replayBreakevenPrice(position, spec);
  return (long ? marketPrice > price : marketPrice < price)
    && (position.stopPrice == null || (long ? position.stopPrice < price : position.stopPrice > price));
}

function replayOrderMenu(price, marketPrice, presets, quantity, format, submit) {
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(marketPrice) || marketPrice <= 0) return [];
  const quantities = [...new Set([...presets, quantity])].filter(q => Number.isInteger(q) && q >= 1 && q <= 100);
  const choices = [['long', 'market', 'Market Buy'], ['short', 'market', 'Market Sell']];
  if (price > marketPrice) choices.push(['long', 'stop_market', 'Stop Buy'], ['short', 'limit', 'Limit Sell']);
  else if (price < marketPrice) choices.push(['long', 'limit', 'Limit Buy'], ['short', 'stop_market', 'Stop Sell']);
  return choices.map(([direction, type, label]) => ({
    label: type === 'market' ? label : label + ' @ ' + format(price),
    onSelect: () => {},
    submenu: quantities.map(q => ({ label: label + ' ' + q, onSelect: () => submit({ direction, type, quantity: q, price }) })),
  }));
}

// One net position; one working entry/adjustment order. No implicit reversal.
function validateReplayQuantity(position, direction, quantity) {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) return 'Quantity must be a whole number between 1 and 100.';
  if (!position) return '';
  if (direction === position.direction && position.quantity + quantity > 100) return 'Maximum open position is 100 contracts.';
  if (direction !== position.direction && quantity > position.quantity) return 'Reduction exceeds the open position. Select a smaller quantity; reversing is not supported.';
  return '';
}

function createReplayPosition(order, price, time) {
  const initialRiskPoints = order.stopPrice == null ? null : Math.abs(price - order.stopPrice);
  return { ...order, entryPrice: price, entryTime: time, initialRiskPoints,
    riskBudgetPoints: initialRiskPoints == null ? null : initialRiskPoints * order.quantity,
    riskIncomplete: false, realizedPnl: 0,
    fills: [{ direction: order.direction, quantity: order.quantity, price, time, kind: 'entry' }] };
}

function applyReplayFill(position, order, price, time, spec, reason) {
  const error = validateReplayQuantity(position, order.direction, order.quantity);
  if (error) return { error };
  if (!Number.isFinite(price) || price <= 0) return { error: 'Invalid fill price.' };
  if (!position) return { position: createReplayPosition(order, price, time) };
  const sameSide = order.direction === position.direction;
  const fill = { direction: order.direction, quantity: order.quantity, price, time, kind: sameSide ? 'entry' : 'exit', reason };
  const fills = [...position.fills, fill];
  if (sameSide) {
    const quantity = position.quantity + order.quantity;
    const entryPrice = (position.entryPrice * position.quantity + price * order.quantity) / quantity;
    const additionalRisk = position.stopPrice == null ? null : Math.max(0, (price - position.stopPrice) * (position.direction === 'long' ? 1 : -1)) * order.quantity;
    const riskIncomplete = position.riskIncomplete || (position.riskBudgetPoints != null && additionalRisk == null);
    return { position: { ...position, quantity, entryPrice, fills, riskIncomplete,
      riskBudgetPoints: position.riskBudgetPoints == null ? null : position.riskBudgetPoints + (additionalRisk ?? 0) } };
  }
  const pnl = calculateTradePnl({ ...position, quantity: order.quantity }, price, spec.pointValue);
  const realizedPnl = (position.realizedPnl ?? 0) + pnl;
  const quantity = position.quantity - order.quantity;
  if (quantity > 0) return { position: { ...position, quantity, fills, realizedPnl,
    riskIncomplete: position.riskIncomplete || position.riskBudgetPoints == null } };
  const entries = fills.filter(f => f.kind === 'entry'), exits = fills.filter(f => f.kind === 'exit');
  const totalQuantity = entries.reduce((sum, f) => sum + f.quantity, 0);
  const weighted = fs => fs.reduce((sum, f) => sum + f.price * f.quantity, 0) / totalQuantity;
  const risk = position.riskIncomplete || position.riskBudgetPoints == null ? null : position.riskBudgetPoints * spec.pointValue;
  const totalPnl = Math.round(realizedPnl * 100) / 100;
  return { position: null, trade: { id: position.id, direction: position.direction, quantity: totalQuantity,
    entryPrice: weighted(entries), exitPrice: weighted(exits), entryTime: position.entryTime, exitTime: time,
    stopPrice: position.stopPrice, targetPrice: position.targetPrice, pnl: totalPnl,
    rMultiple: risk > 0 ? totalPnl / risk : null, reason, fills } };
}

// Existing protective orders win over a working size adjustment when bar order is unknown.
function advanceReplayOrders(position, pendingOrder, candle, spec) {
  if (position) {
    const exit = evaluateCandleExit(position, candle);
    if (exit) return { ...applyReplayFill(position, {
      direction: position.direction === 'long' ? 'short' : 'long', quantity: position.quantity,
    }, exit.price, candle.time, spec, exit.reason), pendingOrder: null, reason: exit.reason, price: exit.price };
  }
  if (!pendingOrder) return null;
  const fill = evaluateEntryOrder(pendingOrder, candle);
  if (!fill) return null;
  if (pendingOrder.positionId && pendingOrder.positionId !== position?.id) return { position, pendingOrder: null, error: 'Position changed; working order cancelled.' };
  const result = applyReplayFill(position, pendingOrder, fill.price, candle.time, spec, fill.reason);
  return { ...result, position: result.error ? position : result.position, pendingOrder: null, reason: fill.reason, price: fill.price };
}

function seedReplayOrderPrice(type, marketPrice, spec) {
  return type === 'market' || !Number.isFinite(marketPrice) || marketPrice <= 0 ? '' : snapReplayPrice(marketPrice, spec).toFixed(spec.decimals);
}

// Chart overlays use the same contract specification as the replay engine.
function toReplayChartPosition(position, spec) {
  return {
    id: position.id, side: position.direction === 'long' ? 'buy' : 'sell',
    quantity: position.quantity, entryPrice: position.entryPrice,
    pointValue: spec.pointValue, currencySymbol: '$',
    stopLoss: position.stopPrice ?? undefined, takeProfit: position.targetPrice ?? undefined,
  };
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
  toReplayChartPosition,
  replayBreakevenPrice, validateReplayQuantity, createReplayPosition, applyReplayFill, advanceReplayOrders, seedReplayOrderPrice,
  snapReplayPrice, validateReplayLevels, validateReplayEntry, updateReplayLevels, canMoveToBreakeven, replayOrderMenu,
};
