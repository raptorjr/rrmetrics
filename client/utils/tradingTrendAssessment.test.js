const test = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyTradingTrend,
  getDirection,
  getTradingTrendThresholds,
  REFERENCE_TICK_THRESHOLDS,
} = require('./tradingTrendAssessment');

const period = (expectancy, profitFactor, avgWin, avgLoss) => ({
  expectancy, profitFactor, avgWin, avgLoss,
});

const baseline = period(10, 1.2, 50, 30);

test('defines neutral ranges in reference ticks, not fixed dollars', () => {
  assert.deepEqual(REFERENCE_TICK_THRESHOLDS, {
    expectancy: 15, profitFactor: 0.36, avgWin: 21, avgLoss: 19,
  });
  assert.equal(getDirection(10, 24, 15), 'neutral');
  assert.equal(getDirection(1, 1.35, 0.36), 'neutral');
});

test('converts reference tick ranges using each instrument point and tick value', () => {
  assert.deepEqual(getTradingTrendThresholds('MGC'), {
    expectancy: 15, profitFactor: 0.36, avgWin: 21, avgLoss: 19, tickValue: 1,
  });
  assert.deepEqual(getTradingTrendThresholds('MES'), {
    expectancy: 18.75, profitFactor: 0.36, avgWin: 26.25, avgLoss: 23.75, tickValue: 1.25,
  });
  assert.deepEqual(getTradingTrendThresholds('MNQ'), {
    expectancy: 7.5, profitFactor: 0.36, avgWin: 10.5, avgLoss: 9.5, tickValue: 0.5,
  });
  assert.deepEqual(getTradingTrendThresholds('SPY'), {
    expectancy: 0.15, profitFactor: 0.36, avgWin: 0.21, avgLoss: 0.19, tickValue: 0.01,
  });
});

test('does not classify instruments without known tick specifications', () => {
  assert.equal(getTradingTrendThresholds('UNKNOWN'), null);
  assert.equal(classifyTradingTrend(baseline, period(30, 1.8, 80, 25), 'UNKNOWN').status, 'Insufficient data');
});

test('classifies aligned improvement', () => {
  const result = classifyTradingTrend(baseline, period(30, 1.8, 80, 25), 'MGC');
  assert.equal(result.status, 'Improving');
});

test('classifies aligned deterioration', () => {
  const result = classifyTradingTrend(baseline, period(-20, 0.7, 35, 55), 'MGC');
  assert.equal(result.status, 'Declining');
});

test('classifies all-neutral movement as stable', () => {
  const result = classifyTradingTrend(baseline, period(20, 1.4, 60, 40), 'MGC');
  assert.equal(result.status, 'Stable');
});

test('does not count expectancy and profit factor as independent votes', () => {
  const result = classifyTradingTrend(baseline, period(30, 1.2, 50, 30), 'MGC');
  assert.equal(result.status, 'Mixed');
});

test('classifies conflicting support metrics as mixed', () => {
  const result = classifyTradingTrend(baseline, period(30, 1.8, 80, 55), 'MGC');
  assert.equal(result.status, 'Mixed');
});

test('classifies latest observed MGC pattern as mixed', () => {
  const result = classifyTradingTrend(
    period(-0.32, 0.56, 24.64, 28.11),
    period(2.67, 1.01, 68.66, 50.77),
    'MGC',
  );
  assert.equal(result.status, 'Mixed');
});

test('returns insufficient data for unavailable comparisons', () => {
  assert.equal(classifyTradingTrend(null, baseline, 'MGC').status, 'Insufficient data');
  assert.equal(classifyTradingTrend(baseline, period(10, null, 50, 30), 'MGC').status, 'Insufficient data');
});
