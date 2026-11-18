const React = require('react');
const { useState } = React;

const ChangeIndicator = require('../shared/ChangeIndicator');
const WinRateCard = require('../shared/WinRateCard');
const AvgWinLossCard = require('../shared/AvgWinLossCard');
const StatCard = require('../shared/StatCard');
const PeriodFilter = require('../shared/PeriodFilter');
const EvalFilterControl = require('../shared/EvalFilterControl');
const CustomizableStats = require('../shared/CustomizableStats');
const CalendarView = require('./CalendarView');
const Icons = require('../shared/Icons');

const { getDateRange, getPreviousDateRange, filterTradesByDateRange, calcPercentChange } = require('../../utils/periodUtils');
const { getTradePL, calculateAnalytics, applyEvalFilter, calculateSharpeRatio, calculateSortinoRatio, calculateKellyCriterion } = require('../../utils/analytics');
const { formatDuration } = require('../../utils/dateUtils');


const DashboardPage = ({ trades, onOpenForm, onOpenImport, onManualSync, brokerStatuses, onOpenAddTrade, onEditTrade, dailyNotes, onSaveNote, onDeleteNote, tags, strategyRules, evalFilter, setEvalFilter, sidebarCollapsed }) => {
  const [period, setPeriod] = useState('all');
  const [syncing, setSyncing] = useState(false);
  const [kellyDrawdown, setKellyDrawdown] = useState(2000);
  const hasBrokers = brokerStatuses && brokerStatuses.length > 0;

  const handleSync = async () => {
    if (syncing || !onManualSync) return;
    setSyncing(true);
    try { await onManualSync(); } finally { setSyncing(false); }
  };

  const baseTrades = applyEvalFilter(trades, evalFilter);
  const dateRange = getDateRange(period);
  const filteredTrades = filterTradesByDateRange(baseTrades, dateRange);
  const stats = calculateAnalytics(filteredTrades);

  const prevRange = getPreviousDateRange(period);
  const prevTrades = prevRange ? filterTradesByDateRange(baseTrades, prevRange) : null;
  const prevStats = prevTrades ? calculateAnalytics(prevTrades) : null;
  const showChange = period !== 'all' && prevStats;

  const profitFactor = (() => {
    let grossWins = 0, grossLosses = 0;
    filteredTrades.forEach(trade => {
      const pl = getTradePL(trade);
      if (pl > 0) grossWins += pl;
      else grossLosses += Math.abs(pl);
    });
    return grossLosses === 0 ? grossWins : grossWins / grossLosses;
  })();
  const expectancy = stats.totalTrades > 0
    ? (stats.winRate / 100) * stats.avgWin + (1 - stats.winRate / 100) * stats.avgLoss
    : 0;
  const maxDrawdown = (() => {
    const sorted = [...filteredTrades].sort((a, b) => new Date(a.exitTime) - new Date(b.exitTime));
    let peak = 0, running = 0, drawdown = 0;
    sorted.forEach(trade => {
      running += getTradePL(trade);
      peak = Math.max(peak, running);
      drawdown = Math.max(drawdown, peak - running);
    });
    return drawdown;
  })();
  const sharpeRatio = calculateSharpeRatio(filteredTrades);
  const sortinoRatio = calculateSortinoRatio(filteredTrades);
  const kelly = calculateKellyCriterion(filteredTrades, kellyDrawdown);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Dashboard</h1>
          <p className="text-text-secondary text-sm mt-1">Overview of your trading performance</p>
        </div>
        <div className="flex items-center gap-2">
          {hasBrokers && (
            <button
              className="flex items-center justify-center w-9 h-9 bg-bg-surface border border-border text-text-secondary rounded-lg hover:text-text-primary hover:border-accent transition-all disabled:opacity-50"
              onClick={handleSync}
              disabled={syncing}
              title="Sync broker trades"
            >
              <Icons.RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
            </button>
          )}
          <>
              <button className="flex items-center gap-2 px-4 py-2.5 bg-accent text-accent-text text-sm font-semibold rounded-lg hover:brightness-110 transition-all" onClick={onOpenForm}>
                <Icons.Plus className="w-4 h-4" />
                New Trade
              </button>
              <button
                className="flex items-center justify-center w-9 h-9 bg-bg-surface border border-border text-text-secondary rounded-lg hover:text-text-primary hover:border-accent transition-all"
                onClick={onOpenImport}
                title="Import CSV"
                aria-label="Import CSV"
              >
                <Icons.Download className="w-4 h-4" />
              </button>
          </>
        </div>
      </div>

      {/* Period Filter + Eval filter */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-0">
          <PeriodFilter value={period} onChange={setPeriod} trades={trades} />
        </div>
        <EvalFilterControl trades={trades} evalFilter={evalFilter} setEvalFilter={setEvalFilter} />
      </div>

      <CustomizableStats
        storageKey="rrmetrics_dashboard_tiles"
        defaultOrder={['totalPL', 'winRate', 'totalTrades', 'avgDuration', 'avgWinLoss', 'bestTrade', 'worstTrade', 'breakevenRate', 'profitFactor', 'expectancy', 'maxDrawdown', 'sharpeRatio', 'sortinoRatio', 'kellyRisk']}
        defaultVisible={['totalPL', 'winRate', 'totalTrades', 'avgDuration', 'avgWinLoss', 'bestTrade', 'worstTrade', 'breakevenRate']}
        items={[
          { id: 'totalPL', label: 'Total P/L', render: () => <StatCard label="Total P/L" tooltip="Net profit or loss across the selected trades, after fees and commissions." value={`$${stats.totalPL.toFixed(2)}`} color={stats.totalPL >= 0 ? 'text-positive' : 'text-negative'} change={showChange ? calcPercentChange(stats.totalPL, prevStats.totalPL) : null} /> },
          { id: 'winRate', label: 'Win Rate', render: () => <WinRateCard wins={stats.wins} losses={stats.losses} total={stats.totalTrades} change={showChange ? calcPercentChange(stats.winRate, prevStats.winRate) : null} /> },
          { id: 'totalTrades', label: 'Total Trades', render: () => <StatCard label="Total Trades" tooltip="Number of closed trades in the selected period." value={stats.totalTrades} color="text-text-primary" subValue={`${stats.avgTradesPerDay.toFixed(1)} avg/day`} change={showChange ? calcPercentChange(stats.totalTrades, prevStats.totalTrades) : null} /> },
          { id: 'avgDuration', label: 'Avg Duration', render: () => <StatCard label="Avg Duration" tooltip="Average time between entry and exit across the selected trades." value={formatDuration(stats.avgDuration)} color="text-text-primary" /> },
          { id: 'avgWinLoss', label: 'Avg Win / Loss', render: () => <AvgWinLossCard avgWin={stats.avgWin} avgLoss={stats.avgLoss} /> },
          { id: 'bestTrade', label: 'Best Trade', render: () => <StatCard label="Best Trade" tooltip="The highest net P&L from a single trade in the selected period." value={`$${stats.bestTrade.toFixed(2)}`} color="text-positive" change={showChange ? calcPercentChange(stats.bestTrade, prevStats.bestTrade) : null} /> },
          { id: 'worstTrade', label: 'Worst Trade', render: () => <StatCard label="Worst Trade" tooltip="The lowest net P&L from a single trade in the selected period." value={`$${stats.worstTrade.toFixed(2)}`} color="text-negative" /> },
          { id: 'breakevenRate', label: 'Breakeven Rate', render: () => <StatCard label="Breakeven Rate" tooltip="Percentage of all closed trades that finished at or near zero P&L." value={`${stats.breakevenPct.toFixed(1)}%`} subValue={`${stats.breakevens} trades`} color="text-text-primary" /> },
          { id: 'profitFactor', label: 'Profit Factor', render: () => <StatCard label="Profit Factor" tooltip="Gross profit divided by gross loss. Above 1.00 means gross profits exceed gross losses; below 1.00 means gross losses are larger." value={profitFactor.toFixed(2)} color="text-text-primary" /> },
          { id: 'expectancy', label: 'Expectancy', render: () => <StatCard label="Expectancy" tooltip="Average amount won or lost per trade over the selected sample. Positive expectancy means the average trade is profitable." value={`${expectancy.toFixed(2)}`} color={expectancy >= 0 ? 'text-positive' : 'text-negative'} /> },
          { id: 'maxDrawdown', label: 'Max Drawdown', render: () => <StatCard label="Max Drawdown" tooltip="Largest peak-to-trough decline in cumulative P&L during the selected period." value={`${maxDrawdown.toFixed(2)}`} color="text-negative" /> },
          { id: 'sharpeRatio', label: 'Sharpe Ratio', render: () => <StatCard label="Sharpe Ratio" tooltip="Risk-adjusted return relative to total variability in results. Higher is generally better; negative values indicate negative average performance." value={sharpeRatio === Infinity ? '∞' : sharpeRatio.toFixed(2)} color={sharpeRatio > 0 ? 'text-positive' : 'text-negative'} /> },
          { id: 'sortinoRatio', label: 'Sortino Ratio', render: () => <StatCard label="Sortino Ratio" tooltip="Risk-adjusted return that focuses on downside variability rather than penalizing upside fluctuations. Higher is generally better." value={sortinoRatio === Infinity ? '∞' : sortinoRatio.toFixed(2)} color={sortinoRatio > 0 ? 'text-positive' : 'text-negative'} /> },
          { id: 'kellyRisk', label: 'Kelly Optimal Risk', render: () => (
            <div className="bg-bg-surface border border-border rounded-xl p-5">
              <div className="text-text-secondary text-xs font-medium uppercase tracking-wider mb-2">Kelly Optimal Risk</div>
              <div className="font-mono text-2xl font-bold text-text-primary">${kelly.optimalRisk.toFixed(0)}</div>
              <div className="text-text-tertiary text-xs mt-1">{kelly.kellyPct.toFixed(1)}% of drawdown</div>
              <div className="flex items-center gap-2 mt-2">
                <span className="text-text-tertiary text-xs">Max DD $</span>
                <input type="number" value={kellyDrawdown} onChange={event => setKellyDrawdown(Math.max(0, Number(event.target.value)))} className="w-20 bg-bg-input border border-border rounded px-2 py-1 text-xs font-mono text-text-primary focus:outline-none focus:border-accent" />
              </div>
            </div>
          ) },
        ]}
      />

      {/* Calendar */}
      <CalendarView trades={baseTrades} dailyNotes={dailyNotes} onSaveNote={onSaveNote} onDeleteNote={onDeleteNote} tags={tags} strategyRules={strategyRules} onOpenAddTrade={onOpenAddTrade} onEditTrade={onEditTrade} sidebarCollapsed={sidebarCollapsed} />
    </div>
  );
};


module.exports = DashboardPage;
