const React = require('react');
const StatCard = require('./StatCard');
const WinRateCard = require('./WinRateCard');
const AvgWinLossCard = require('./AvgWinLossCard');
const { formatDuration } = require('../../utils/dateUtils');

/**
 * Shared performance tile catalogue used by Dashboard and Analytics.
 * Layout metadata is intentionally stored with each definition so the
 * dashboard grid can later use the same catalogue for sizing and placement.
 */
const PERFORMANCE_TILE_DEFINITIONS = [
  { id: 'totalPL', label: 'Total P/L', category: 'Performance', minColumns: 1, minRows: 1, defaultColumns: 1, defaultRows: 1 },
  { id: 'winRate', label: 'Win Rate', category: 'Performance', minColumns: 1, minRows: 1, defaultColumns: 1, defaultRows: 1 },
  { id: 'totalTrades', label: 'Total Trades', category: 'Activity', minColumns: 1, minRows: 1, defaultColumns: 1, defaultRows: 1 },
  { id: 'avgDuration', label: 'Avg Duration', category: 'Activity', minColumns: 1, minRows: 1, defaultColumns: 1, defaultRows: 1 },
  { id: 'avgWinLoss', label: 'Avg Win / Loss', category: 'Performance', minColumns: 1, minRows: 1, defaultColumns: 2, defaultRows: 1 },
  { id: 'bestTrade', label: 'Best Trade', category: 'Performance', minColumns: 1, minRows: 1, defaultColumns: 1, defaultRows: 1 },
  { id: 'worstTrade', label: 'Worst Trade', category: 'Performance', minColumns: 1, minRows: 1, defaultColumns: 1, defaultRows: 1 },
  { id: 'breakevenRate', label: 'Breakeven Rate', category: 'Performance', minColumns: 1, minRows: 1, defaultColumns: 1, defaultRows: 1 },
  { id: 'profitFactor', label: 'Profit Factor', category: 'Performance', minColumns: 1, minRows: 1, defaultColumns: 1, defaultRows: 1 },
  { id: 'expectancy', label: 'Expectancy', category: 'Performance', minColumns: 1, minRows: 1, defaultColumns: 1, defaultRows: 1 },
  { id: 'maxDrawdown', label: 'Max Drawdown', category: 'Risk', minColumns: 1, minRows: 1, defaultColumns: 1, defaultRows: 1 },
  { id: 'sharpeRatio', label: 'Sharpe Ratio', category: 'Risk', minColumns: 1, minRows: 1, defaultColumns: 1, defaultRows: 1 },
  { id: 'sortinoRatio', label: 'Sortino Ratio', category: 'Risk', minColumns: 1, minRows: 1, defaultColumns: 1, defaultRows: 1 },
  { id: 'kellyRisk', label: 'Kelly Optimal Risk', category: 'Risk', minColumns: 1, minRows: 1, defaultColumns: 1, defaultRows: 1 },
];

const createPerformanceTiles = ({
  stats,
  profitFactor,
  expectancy,
  maxDrawdown,
  sharpeRatio,
  sortinoRatio,
  kelly,
  kellyDrawdown,
  onKellyDrawdownChange,
  changes = {},
}) => {
  const definitions = Object.fromEntries(PERFORMANCE_TILE_DEFINITIONS.map(item => [item.id, item]));
  const card = (id, render) => ({ ...definitions[id], render });

  return [
    card('totalPL', () => <StatCard label="Total P/L" tooltip="Net profit or loss across the selected trades, after fees and commissions." value={`$${stats.totalPL.toFixed(2)}`} color={stats.totalPL >= 0 ? 'text-positive' : 'text-negative'} change={changes.totalPL} />),
    card('winRate', () => <WinRateCard wins={stats.wins} losses={stats.losses} breakevens={stats.breakevens} total={stats.totalTrades} change={changes.winRate} />),
    card('totalTrades', () => <StatCard label="Total Trades" tooltip="Number of closed trades in the selected period." value={stats.totalTrades} color="text-text-primary" subValue={`${stats.avgTradesPerDay.toFixed(1)} avg/day`} change={changes.totalTrades} />),
    card('avgDuration', () => <StatCard label="Avg Duration" tooltip="Average time between entry and exit across the selected trades." value={formatDuration(stats.avgDuration)} color="text-text-primary" />),
    card('avgWinLoss', () => <AvgWinLossCard avgWin={stats.avgWin} avgLoss={stats.avgLoss} />),
    card('bestTrade', () => <StatCard label="Best Trade" tooltip="The highest net P&L from a single trade in the selected period." value={`$${stats.bestTrade.toFixed(2)}`} color="text-positive" change={changes.bestTrade} />),
    card('worstTrade', () => <StatCard label="Worst Trade" tooltip="The lowest net P&L from a single trade in the selected period." value={`$${stats.worstTrade.toFixed(2)}`} color="text-negative" />),
    card('breakevenRate', () => <StatCard label="Breakeven Rate" tooltip="Percentage of all closed trades that finished at or near zero P&L." value={`${stats.breakevenPct.toFixed(1)}%`} subValue={`${stats.breakevens} trades`} color="text-text-primary" />),
    card('profitFactor', () => <StatCard label="Profit Factor" tooltip="Gross profit divided by gross loss. Above 1.00 means gross profits exceed gross losses; below 1.00 means gross losses are larger." value={profitFactor.toFixed(2)} color="text-text-primary" change={changes.profitFactor} />),
    card('expectancy', () => <StatCard label="Expectancy" tooltip="Average amount won or lost per trade over the selected sample. Positive expectancy means the average trade is profitable." value={`$${expectancy.toFixed(2)}`} color={expectancy >= 0 ? 'text-positive' : 'text-negative'} change={changes.expectancy} />),
    card('maxDrawdown', () => <StatCard label="Max Drawdown" tooltip="Largest peak-to-trough decline in cumulative P&L during the selected period." value={`$${maxDrawdown.toFixed(2)}`} color="text-negative" />),
    card('sharpeRatio', () => <StatCard label="Sharpe Ratio" tooltip="Risk-adjusted return measuring reward per unit of total volatility. Higher is generally better." value={sharpeRatio === Infinity ? '∞' : sharpeRatio.toFixed(2)} color={sharpeRatio > 0 ? 'text-positive' : 'text-negative'} />),
    card('sortinoRatio', () => <StatCard label="Sortino Ratio" tooltip="Risk-adjusted return that focuses on downside variability rather than penalizing upside fluctuations. Higher is generally better." value={sortinoRatio === Infinity ? '∞' : sortinoRatio.toFixed(2)} color={sortinoRatio > 0 ? 'text-positive' : 'text-negative'} />),
    card('kellyRisk', () => (
      <div className="bg-bg-surface border border-border rounded-xl p-5">
        <div className="text-text-secondary text-xs font-medium uppercase tracking-wider mb-2">Kelly Optimal Risk</div>
        <div className="font-mono text-2xl font-bold text-text-primary">${kelly.optimalRisk.toFixed(0)}</div>
        <div className="text-text-tertiary text-xs mt-1">{kelly.kellyPct.toFixed(1)}% of drawdown</div>
        <div className="flex items-center gap-2 mt-2">
          <span className="text-text-tertiary text-xs">Max DD $</span>
          <input type="number" value={kellyDrawdown} onChange={event => onKellyDrawdownChange(Math.max(0, Number(event.target.value)))} className="w-20 bg-bg-input border border-border rounded px-2 py-1 text-xs font-mono text-text-primary focus:outline-none focus:border-accent" />
        </div>
      </div>
    )),
  ];
};

module.exports = { PERFORMANCE_TILE_DEFINITIONS, createPerformanceTiles };
