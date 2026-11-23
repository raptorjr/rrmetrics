const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyTradingTrend, getDirection, NEUTRAL_THRESHOLDS } = require('./tradingTrendAssessment');

const period = (expectancy, profitFactor, avgWin, avgLoss) => ({
  expectancy, profitFactor, avgWin, avgLoss,
});

const baseline = period(10, 1.2, 50, 30);

test('uses conservative neutral thresholds', () => {
  assert.deepEqual(NEUTRAL_THRESHOLDS, {
    expectancy: 15, profitFactor: 0.36, avgWin: 21, avgLoss: 19,
  });
  assert.equal(getDirection(10, 24, 15), 'neutral');
  assert.equal(getDirection(1, 1.35, 0.36), 'neutral');
  assert.equal(getDirection(50, 71, 21), 'neutral');
  assert.equal(getDirection(30, 10, 19, true), 'declining');
});

test('classifies aligned improvement', () => {
  const result = classifyTradingTrend(baseline, period(30, 1.8, 80, 25));
  assert.equal(result.status, 'Improving');
});

test('classifies aligned deterioration', () => {
  const result = classifyTradingTrend(baseline, period(-20, 0.7, 35, 55));
  assert.equal(result.status, 'Declining');
});

test('classifies all-neutral movement as stable', () => {
  const result = classifyTradingTrend(baseline, period(20, 1.4, 60, 40));
  assert.equal(result.status, 'Stable');
});

test('does not count expectancy and profit factor as independent votes', () => {
  const result = classifyTradingTrend(baseline, period(30, 1.2, 50, 30));
  assert.equal(result.status, 'Mixed');
});

test('classifies conflicting support metrics as mixed', () => {
  const result = classifyTradingTrend(baseline, period(30, 1.8, 80, 55));
  assert.equal(result.status, 'Mixed');
});

test('classifies latest observed pattern as mixed', () => {
  const result = classifyTradingTrend(
    period(-0.32, 0.56, 24.64, 28.11),
    period(2.67, 1.01, 68.66, 50.77),
  );
  assert.equal(result.status, 'Mixed');
});

test('returns insufficient data for unavailable comparisons', () => {
  assert.equal(classifyTradingTrend(null, baseline).status, 'Insufficient data');
  assert.equal(classifyTradingTrend(baseline, period(10, null, 50, 30)).status, 'Insufficient data');
});
