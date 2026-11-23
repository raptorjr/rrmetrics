const { TICK_VALUES, TICK_SIZES, COMMON_TICKERS } = require('./tickValues');

// Neutral ranges are calibrated in MGC-equivalent ticks, then converted to
// the selected instrument's dollar value per tick. This avoids applying the
// same dollar threshold to contracts with different point/tick values.
const REFERENCE_TICK_THRESHOLDS = Object.freeze({
  expectancy: 15,
  profitFactor: 0.36,
  avgWin: 21,
  avgLoss: 19,
});

const getTradingTrendThresholds = ticker => {
  const symbol = String(ticker || '').trim().toUpperCase();
  const supported = Object.prototype.hasOwnProperty.call(TICK_VALUES, symbol)
    || COMMON_TICKERS.includes(symbol);
  if (!supported) return null;

  const tickValue = (TICK_VALUES[symbol] ?? 1) * (TICK_SIZES[symbol] ?? 0.01);
  if (!Number.isFinite(tickValue) || tickValue <= 0) return null;

  return {
    expectancy: REFERENCE_TICK_THRESHOLDS.expectancy * tickValue,
    profitFactor: REFERENCE_TICK_THRESHOLDS.profitFactor,
    avgWin: REFERENCE_TICK_THRESHOLDS.avgWin * tickValue,
    avgLoss: REFERENCE_TICK_THRESHOLDS.avgLoss * tickValue,
    tickValue,
  };
};

const getDirection = (previous, recent, threshold, lowerIsBetter = false) => {
  if (previous === null || previous === undefined || recent === null || recent === undefined
    || Number.isNaN(previous) || Number.isNaN(recent)) return 'unknown';

  if (previous === recent) return 'neutral';
  if (previous === Infinity) return recent === Infinity ? 'neutral' : (lowerIsBetter ? 'improving' : 'declining');
  if (recent === Infinity) return lowerIsBetter ? 'declining' : 'improving';
  if (!Number.isFinite(previous) || !Number.isFinite(recent)) return 'unknown';

  const delta = recent - previous;
  if (Math.abs(delta) <= threshold) return 'neutral';
  const increased = delta > 0;
  return (increased !== lowerIsBetter) ? 'improving' : 'declining';
};

const classifyTradingTrend = (previous, recent, ticker) => {
  if (!previous || !recent) {
    return { status: 'Insufficient data', reason: 'A complete comparison is not available.' };
  }

  const thresholds = getTradingTrendThresholds(ticker);
  if (!thresholds) {
    return {
      status: 'Insufficient data',
      reason: 'This instrument does not have a verified tick size and point value for trend calibration.',
    };
  }

  const expectancy = getDirection(previous.expectancy, recent.expectancy, thresholds.expectancy);
  const profitFactor = getDirection(previous.profitFactor, recent.profitFactor, thresholds.profitFactor);
  const avgWin = getDirection(previous.avgWin, recent.avgWin, thresholds.avgWin);
  const avgLoss = getDirection(previous.avgLoss, recent.avgLoss, thresholds.avgLoss, true);

  if ([expectancy, profitFactor, avgWin, avgLoss].includes('unknown')) {
    return { status: 'Insufficient data', reason: 'One or more required metrics could not be compared.' };
  }

  // Expectancy and profit factor are related measures and form one vote.
  // Opposing meaningful movements make profitability itself inconclusive.
  if (expectancy !== 'neutral' && profitFactor !== 'neutral' && expectancy !== profitFactor) {
    return { status: 'Mixed', reason: 'Expectancy and profit factor moved in different directions.' };
  }

  const profitability = expectancy !== 'neutral' ? expectancy : profitFactor;
  const supporting = [avgWin, avgLoss];
  const hasImprovement = profitability === 'improving' && supporting.includes('improving');
  const hasDeterioration = profitability === 'declining' && supporting.includes('declining');
  const hasOpposingSupport = supporting.includes('improving') && supporting.includes('declining');

  if (hasOpposingSupport) {
    return { status: 'Mixed', reason: 'Average win and average loss moved in different directions.' };
  }
  if (hasImprovement && !supporting.includes('declining')) {
    return { status: 'Improving', reason: 'Profitability improved and at least one supporting metric improved, with no meaningful deterioration.' };
  }
  if (hasDeterioration && !supporting.includes('improving')) {
    return { status: 'Declining', reason: 'Profitability deteriorated and at least one supporting metric deteriorated, with no meaningful improvement.' };
  }
  if (profitability === 'neutral' && avgWin === 'neutral' && avgLoss === 'neutral') {
    return { status: 'Stable', reason: 'All three performance dimensions remained within their neutral ranges.' };
  }
  return { status: 'Mixed', reason: 'The changes do not provide enough agreement for an improving or declining assessment.' };
};

module.exports = {
  REFERENCE_TICK_THRESHOLDS,
  getTradingTrendThresholds,
  getDirection,
  classifyTradingTrend,
};
