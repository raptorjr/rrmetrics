const { getTradePL, groupTradesByDate } = require('./analytics');

const SCORE_WEIGHTS = {
  winRate: 15,
  profitFactor: 25,
  averageWinLoss: 20,
  drawdownControl: 20,
  recoveryFactor: 10,
  consistency: 10,
};

const clampScore = value => Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
const linearScore = (value, floor, ceiling) => clampScore(((value - floor) / (ceiling - floor)) * 100);

const calculateTradingScore = (trades = []) => {
  const validTrades = (Array.isArray(trades) ? trades : [])
    .filter(trade => trade && trade.exitTime && Number.isFinite(getTradePL(trade)))
    .sort((a, b) => new Date(a.exitTime) - new Date(b.exitTime));

  const totalTrades = validTrades.length;
  const daily = Object.values(groupTradesByDate(validTrades));
  const tradingDays = daily.length;
  const decisive = validTrades.filter(trade => getTradePL(trade) !== 0);
  const wins = decisive.filter(trade => getTradePL(trade) > 0);
  const losses = decisive.filter(trade => getTradePL(trade) < 0);
  const grossProfit = wins.reduce((sum, trade) => sum + getTradePL(trade), 0);
  const grossLoss = Math.abs(losses.reduce((sum, trade) => sum + getTradePL(trade), 0));
  const winRate = decisive.length ? (wins.length / decisive.length) * 100 : 0;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;
  const averageWin = wins.length ? grossProfit / wins.length : 0;
  const averageLoss = losses.length ? grossLoss / losses.length : 0;
  const averageWinLoss = averageLoss > 0 ? averageWin / averageLoss : averageWin > 0 ? Infinity : 0;

  let runningEquity = 0;
  let peakEquity = 0;
  let maxDrawdown = 0;
  validTrades.forEach(trade => {
    runningEquity += getTradePL(trade);
    peakEquity = Math.max(peakEquity, runningEquity);
    maxDrawdown = Math.max(maxDrawdown, peakEquity - runningEquity);
  });

  const totalPL = validTrades.reduce((sum, trade) => sum + getTradePL(trade), 0);
  const drawdownPct = peakEquity > 0 ? (maxDrawdown / peakEquity) * 100 : Infinity;
  const recoveryFactor = maxDrawdown > 0 ? totalPL / maxDrawdown : totalPL > 0 ? Infinity : 0;

  const positiveDays = daily.map(day => day.totalPL).filter(value => value > 0);
  const totalPositiveDayPL = positiveDays.reduce((sum, value) => sum + value, 0);
  const bestDayShare = totalPositiveDayPL > 0
    ? Math.max(...positiveDays) / totalPositiveDayPL
    : 1;

  const metrics = [
    {
      id: 'winRate', label: 'Win rate', weight: SCORE_WEIGHTS.winRate,
      value: winRate, displayValue: winRate.toFixed(1) + '%',
      score: linearScore(winRate, 30, 60),
      explanation: 'Share of non-breakeven trades that closed profitable.',
      improvement: 'Review losing setups and entry selectivity. Look for repeatable situations where you can avoid low-quality trades without forcing extra trades.',
    },
    {
      id: 'profitFactor', label: 'Profit factor', weight: SCORE_WEIGHTS.profitFactor,
      value: profitFactor, displayValue: profitFactor === Infinity ? '∞' : profitFactor.toFixed(2),
      score: profitFactor === Infinity ? 100 : linearScore(profitFactor, 0.5, 2.5),
      explanation: 'Gross winning P/L divided by gross losing P/L.',
      improvement: 'Compare your strongest and weakest setups. Focus on reducing avoidable losses while preserving the trades that contribute most to gross profit.',
    },
    {
      id: 'averageWinLoss', label: 'Avg win / loss', weight: SCORE_WEIGHTS.averageWinLoss,
      value: averageWinLoss, displayValue: averageWinLoss === Infinity ? '∞' : averageWinLoss.toFixed(2) + ':1',
      score: averageWinLoss === Infinity ? 100 : linearScore(averageWinLoss, 0.5, 2.5),
      explanation: 'Average winning trade divided by the average losing trade size.',
      improvement: 'Review whether losses are being cut consistently and whether profitable trades are given room to reach their planned targets.',
    },
    {
      id: 'drawdownControl', label: 'Drawdown control', weight: SCORE_WEIGHTS.drawdownControl,
      value: drawdownPct, displayValue: Number.isFinite(drawdownPct) ? drawdownPct.toFixed(1) + '%' : '—',
      score: Number.isFinite(drawdownPct) ? 100 - linearScore(drawdownPct, 5, 30) : 0,
      explanation: 'Largest peak-to-trough decline as a percentage of the highest cumulative P/L peak.',
      improvement: 'Protect accumulated gains. Review losing streaks, position sizing and whether a daily loss limit could reduce deep drawdowns.',
    },
    {
      id: 'recoveryFactor', label: 'Recovery factor', weight: SCORE_WEIGHTS.recoveryFactor,
      value: recoveryFactor, displayValue: recoveryFactor === Infinity ? '∞' : recoveryFactor.toFixed(2),
      score: recoveryFactor === Infinity ? 100 : linearScore(recoveryFactor, 0.5, 3),
      explanation: 'Net P/L divided by maximum peak-to-trough drawdown.',
      improvement: 'Work on limiting the depth of losing periods and rebuilding equity steadily rather than trying to recover losses quickly.',
    },
    {
      id: 'consistency', label: 'Consistency', weight: SCORE_WEIGHTS.consistency,
      value: bestDayShare, displayValue: (bestDayShare * 100).toFixed(1) + '%',
      score: 100 - linearScore(bestDayShare, 0.2, 0.8),
      explanation: 'A low share from one day suggests profits are spread across many sessions.',
      improvement: 'Aim for repeatable execution across sessions. Review whether a large share of profits depends on one unusually strong day or a small number of exceptional trades.',
    },
  ];

  const enoughData = totalTrades >= 20 && tradingDays >= 5;
  const weightedScore = metrics.reduce((sum, metric) => sum + metric.score * metric.weight, 0) / 100;
  const ranked = [...metrics].sort((a, b) => a.score - b.score);
  const weakest = ranked[0];
  const strongest = ranked[ranked.length - 1];

  return {
    score: enoughData ? Math.round(weightedScore * 10) / 10 : null,
    enoughData,
    totalTrades,
    tradingDays,
    totalPL,
    metrics,
    weakest: enoughData ? weakest : null,
    strongest: enoughData ? strongest : null,
    methodology: {
      weights: SCORE_WEIGHTS,
      minimumTrades: 20,
      minimumTradingDays: 5,
      thresholds: {
        winRate: '30% = 0; 60% = 100',
        profitFactor: '0.5 = 0; 2.5 = 100',
        averageWinLoss: '0.5 = 0; 2.5 = 100',
        drawdownControl: '5% drawdown = 100; 30% or more = 0',
        recoveryFactor: '0.5 = 0; 3.0 = 100',
        consistency: 'Best positive day at 20% of positive-day profit = 100; 80% or more = 0',
      },
    },
  };
};

module.exports = { calculateTradingScore, SCORE_WEIGHTS };
