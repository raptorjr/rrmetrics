const NEUTRAL_THRESHOLDS = Object.freeze({
  expectancy: 15,
  profitFactor: 0.36,
  avgWin: 21,
  avgLoss: 19,
});

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

const classifyTradingTrend = (previous, recent) => {
  if (!previous || !recent) return { status: 'Insufficient data', reason: 'A complete comparison is not available.' };

  const expectancy = getDirection(previous.expectancy, recent.expectancy, NEUTRAL_THRESHOLDS.expectancy);
  const profitFactor = getDirection(previous.profitFactor, recent.profitFactor, NEUTRAL_THRESHOLDS.profitFactor);
  const avgWin = getDirection(previous.avgWin, recent.avgWin, NEUTRAL_THRESHOLDS.avgWin);
  const avgLoss = getDirection(previous.avgLoss, recent.avgLoss, NEUTRAL_THRESHOLDS.avgLoss, true);

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

module.exports = { NEUTRAL_THRESHOLDS, getDirection, classifyTradingTrend };
