const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateTradingScore } = require('./tradingScore');

const makeTrade = (pl, day, index = 0) => ({
  ticker: 'MGC',
  quantity: 1,
  enterPrice: 2500,
  exitPrice: 2501,
  manualPL: pl,
  enterTime: day + 'T14:00:00.000Z',
  exitTime: new Date(new Date(day + 'T15:00:00.000Z').getTime() + index * 60000).toISOString(),
});

test('Trading Score requires a meaningful sample before showing an overall score', () => {
  const result = calculateTradingScore(Array.from({ length: 10 }, (_, i) => makeTrade(i % 2 ? 100 : -50, '2026-01-05', i)));
  assert.equal(result.score, null);
  assert.equal(result.enoughData, false);
  assert.equal(result.totalTrades, 10);
});

test('Trading Score returns six weighted dimensions with a bounded overall score', () => {
  const trades = [];
  for (let day = 0; day < 10; day++) {
    for (let trade = 0; trade < 4; trade++) {
      trades.push(makeTrade((day + trade) % 3 === 0 ? -50 : 100, '2026-01-' + String(day + 1).padStart(2, '0'), trade));
    }
  }
  const result = calculateTradingScore(trades);
  assert.equal(result.enoughData, true);
  assert.equal(result.metrics.length, 6);
  assert.ok(result.score >= 0 && result.score <= 100);
  assert.equal(result.metrics.reduce((sum, metric) => sum + metric.weight, 0), 100);
  assert.ok(result.weakest);
  assert.ok(result.strongest);
});

test('Trading Score handles no losing trades without producing NaN', () => {
  const trades = [];
  for (let day = 0; day < 5; day++) {
    for (let trade = 0; trade < 4; trade++) {
      trades.push(makeTrade(100, '2026-02-' + String(day + 1).padStart(2, '0'), trade));
    }
  }
  const result = calculateTradingScore(trades);
  assert.equal(result.enoughData, true);
  assert.ok(Number.isFinite(result.score));
  assert.equal(result.metrics.find(metric => metric.id === 'profitFactor').score, 100);
  assert.equal(result.metrics.find(metric => metric.id === 'averageWinLoss').score, 100);
});
