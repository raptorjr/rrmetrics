const test = require('node:test');
const assert = require('node:assert/strict');
const { runMonteCarloSimulation, calculateKellyCriterion, calculateAnalytics, calculateExpectancy, calculateProfitFactor, calculateMaxDrawdown } = require('./analytics');
const { isBreakevenTrade } = require('./tickValues');

const makeTrade = (pl, priceMove = pl === 0 ? 0.1 : 1, day = '2026-01-05') => ({
  ticker: 'MGC',
  quantity: 1,
  enterPrice: 2500,
  exitPrice: 2500 + priceMove,
  manualPL: pl,
  enterTime: `${day}T15:00:00.000Z`,
  exitTime: `${day}T15:01:00.000Z`,
});

const withRandom = (value, callback) => {
  const originalRandom = Math.random;
  Math.random = typeof value === 'function' ? value : () => value;
  try {
    return callback();
  } finally {
    Math.random = originalRandom;
  }
};

test('Monte Carlo sampling retains breakeven outcomes', () => {
  const trades = [
    makeTrade(100, 1),
    makeTrade(0),
    makeTrade(0),
    makeTrade(0),
    makeTrade(0),
  ];

  const result = withRandom(0.3, () => runMonteCarloSimulation(trades, {
    simulations: 1,
    samplePaths: 1,
    maxDays: 1,
  }));

  assert.equal(result.passRate, 0);
  assert.deepEqual(result.paths[0].points, [0, 0]);
  assert.equal(result.paths[0].passed, false);
});

test('Monte Carlo sample paths stop when the profit target is reached', () => {
  const trades = Array.from({ length: 5 }, () => makeTrade(100, 1));

  const result = withRandom(0.2, () => runMonteCarloSimulation(trades, {
    profitTarget: 100,
    maxDrawdown: 2000,
    simulations: 1,
    samplePaths: 1,
    maxDays: 10,
  }));

  assert.equal(result.passRate, 100);
  assert.equal(result.avgDaysToPass, 1);
  assert.equal(result.medianDaysToPass, 1);
  assert.deepEqual(result.paths[0].points, [0, 500]);
  assert.equal(result.paths[0].passed, true);
});

test('Monte Carlo simulation reports insufficient trade history', () => {
  const result = runMonteCarloSimulation(Array.from({ length: 4 }, () => makeTrade(100)));

  assert.equal(result.insufficientTrades, true);
  assert.deepEqual(result.paths, []);
  assert.equal(result.totalSimulations, 10000);
});

test('Monte Carlo sample paths stop when trailing drawdown is breached', () => {
  const trades = Array.from({ length: 5 }, () => makeTrade(-100, -1));

  const result = withRandom(0.2, () => runMonteCarloSimulation(trades, {
    maxDrawdown: 400,
    simulations: 1,
    samplePaths: 1,
    maxDays: 10,
  }));

  assert.equal(result.passRate, 0);
  assert.deepEqual(result.paths[0].points, [0, -500]);
  assert.equal(result.paths[0].passed, false);
});

test('Monte Carlo median averages the middle successful pass times', () => {
  const trades = [
    makeTrade(100, 1, '2026-01-05'),
    makeTrade(200, 2, '2026-01-06'),
    makeTrade(300, 3, '2026-01-07'),
    makeTrade(400, 4, '2026-01-08'),
    makeTrade(500, 5, '2026-01-09'),
  ];
  const randomValues = [
    ...Array(5).fill(0.01),
    ...Array(3).fill(0.21),
    ...Array(2).fill(0.41),
    ...Array(2).fill(0.61),
  ];
  let randomIndex = 0;

  const result = withRandom(() => randomValues[randomIndex++], () => runMonteCarloSimulation(trades, {
    profitTarget: 500,
    maxDrawdown: 2000,
    simulations: 4,
    samplePaths: 4,
    maxDays: 10,
  }));

  assert.equal(result.passRate, 100);
  assert.equal(result.avgDaysToPass, 3);
  assert.equal(result.medianDaysToPass, 2.5);
});


test('manual P/L takes precedence over price movement for breakeven classification', () => {
  assert.equal(isBreakevenTrade(makeTrade(100, 0.1)), false);
  assert.equal(isBreakevenTrade(makeTrade(-25, 0)), false);
  assert.equal(isBreakevenTrade(makeTrade(0, 1)), true);
});

test('price-based breakeven classification uses the tick threshold when manual P/L is absent', () => {
  const nearFlat = { ...makeTrade(0, 0.1), manualPL: undefined };
  const decisive = { ...makeTrade(0, 1), manualPL: undefined };

  assert.equal(isBreakevenTrade(nearFlat), true);
  assert.equal(isBreakevenTrade(decisive), false);
});

test('Kelly calculation excludes price-based breakeven trades', () => {
  const trades = [
    makeTrade(100, 1),
    makeTrade(-50, -1),
    { ...makeTrade(0, 0.1), manualPL: undefined },
  ];

  const result = calculateKellyCriterion(trades, 2000);

  assert.equal(result.kellyPct, 25);
  assert.equal(result.optimalRisk, 500);
});

test('expectancy includes breakeven trades in the per-trade average', () => {
  const trades = [
    makeTrade(100, 1),
    makeTrade(50, 0.5),
    makeTrade(-50, -0.5),
    makeTrade(0, 0.1),
    makeTrade(0, 0.1),
  ];

  const stats = calculateAnalytics(trades);
  const expectancy = stats.totalTrades > 0 ? stats.totalPL / stats.totalTrades : 0;

  assert.equal(stats.winRate, 2 / 3 * 100);
  assert.equal(stats.breakevens, 2);
  assert.equal(expectancy, 20);
});

test('expectancy is average net P/L per trade, including breakevens', () => {
  assert.equal(calculateExpectancy({ totalPL: 100, totalTrades: 5 }), 20);
  assert.equal(calculateExpectancy({ totalPL: -75, totalTrades: 3 }), -25);
  assert.equal(calculateExpectancy({ totalPL: 0, totalTrades: 0 }), 0);
  assert.equal(calculateExpectancy(null), 0);
});

test('profit factor uses gross wins and losses and preserves no-loss behaviour', () => {
  assert.equal(calculateProfitFactor([makeTrade(100, 1), makeTrade(-50, -0.5), makeTrade(0, 0.1)]), 2);
  assert.equal(calculateProfitFactor([makeTrade(100, 1), makeTrade(0, 0.1)]), 100);
  assert.equal(calculateProfitFactor([makeTrade(-50, -0.5)]), 0);
  assert.equal(calculateProfitFactor([]), 0);
});

test('maximum drawdown uses chronological cumulative P/L from a zero baseline', () => {
  const trades = [
    { ...makeTrade(-50, -0.5), exitTime: '2026-01-05T10:02:00Z' },
    { ...makeTrade(100, 1), exitTime: '2026-01-05T10:01:00Z' },
    { ...makeTrade(-80, -0.8), exitTime: '2026-01-05T10:03:00Z' },
  ];
  assert.equal(calculateMaxDrawdown(trades), 130);
  assert.equal(calculateMaxDrawdown([]), 0);
});
