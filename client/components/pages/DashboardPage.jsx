const React = require('react');
const { useState } = React;

const KELLY_DRAWDOWN_STORAGE_KEY = 'rrmetrics_kelly_drawdown';
const DEFAULT_KELLY_DRAWDOWN = 2000;
const MONTE_CARLO_STORAGE_KEY = 'rrmetrics_monte_carlo_settings';
const DEFAULT_MONTE_CARLO_SETTINGS = { profitTarget: 3000, maxDrawdown: 2000 };
const ENTRY_TIME_MODE_STORAGE_KEY = 'rrmetrics_entry_time_mode';

const readEntryTimeMode = () => {
  try {
    return localStorage.getItem(ENTRY_TIME_MODE_STORAGE_KEY) === 'total' ? 'total' : 'avg';
  } catch {
    return 'avg';
  }
};

const readMonteCarloSettings = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(MONTE_CARLO_STORAGE_KEY) || 'null');
    return {
      profitTarget: Number.isFinite(Number(saved && saved.profitTarget)) && Number(saved.profitTarget) > 0
        ? Number(saved.profitTarget) : DEFAULT_MONTE_CARLO_SETTINGS.profitTarget,
      maxDrawdown: Number.isFinite(Number(saved && saved.maxDrawdown)) && Number(saved.maxDrawdown) > 0
        ? Number(saved.maxDrawdown) : DEFAULT_MONTE_CARLO_SETTINGS.maxDrawdown,
    };
  } catch {
    return { ...DEFAULT_MONTE_CARLO_SETTINGS };
  }
};

const readKellyDrawdown = () => {
  try {
    const saved = localStorage.getItem(KELLY_DRAWDOWN_STORAGE_KEY);
    if (saved === null) return DEFAULT_KELLY_DRAWDOWN;
    const value = Number(saved);
    return Number.isFinite(value) && value >= 0 ? value : DEFAULT_KELLY_DRAWDOWN;
  } catch {
    return DEFAULT_KELLY_DRAWDOWN;
  }
};

const ChangeIndicator = require('../shared/ChangeIndicator');
const WinRateCard = require('../shared/WinRateCard');
const AvgWinLossCard = require('../shared/AvgWinLossCard');
const StatCard = require('../shared/StatCard');
const PeriodFilter = require('../shared/PeriodFilter');
const EvalFilterControl = require('../shared/EvalFilterControl');
const DashboardGrid = require('../shared/DashboardGrid');
const { createPerformanceTiles } = require('../shared/performanceTileCatalog');
const { createAnalyticsTiles } = require('../shared/analyticsTileCatalog');
const { createAnalyticsChartTiles } = require('../shared/analyticsChartTileCatalog');
const CalendarView = require('./CalendarView');
const Icons = require('../shared/Icons');

const { getDateRange, getPreviousDateRange, filterTradesByDateRange, calcPercentChange } = require('../../utils/periodUtils');
const { getTradePL, calculateAnalytics, calculateExpectancy, calculateProfitFactor, calculateMaxDrawdown, applyEvalFilter, calculateSharpeRatio, calculateSortinoRatio, calculateKellyCriterion } = require('../../utils/analytics');
const { formatDuration } = require('../../utils/dateUtils');


const DashboardPage = ({ trades, onOpenForm, onManualSync, brokerStatuses, onOpenAddTrade, onEditTrade, dailyNotes, onSaveNote, onDeleteNote, tags, strategyRules, evalFilter, setEvalFilter, sidebarCollapsed }) => {
  const [period, setPeriod] = useState('all');
  const [syncing, setSyncing] = useState(false);
  const [kellyDrawdown, setKellyDrawdown] = useState(readKellyDrawdown);
  const [monteCarloSettings, setMonteCarloSettings] = useState(readMonteCarloSettings);
  const [entryTimeMode, setEntryTimeMode] = useState(readEntryTimeMode);

  const handleKellyDrawdownChange = value => {
    const nextValue = Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
    setKellyDrawdown(nextValue);
    try {
      localStorage.setItem(KELLY_DRAWDOWN_STORAGE_KEY, String(nextValue));
    } catch {
      // Keep the setting usable for this session when browser storage is unavailable.
    }
  };
  const handleMonteCarloSettingsChange = (key, value) => {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue) || numericValue <= 0) return;
    const next = { ...monteCarloSettings, [key]: numericValue };
    setMonteCarloSettings(next);
    try {
      localStorage.setItem(MONTE_CARLO_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Keep the setting usable for this session when browser storage is unavailable.
    }
  };
  const handleEntryTimeModeChange = mode => {
    const nextMode = mode === 'total' ? 'total' : 'avg';
    setEntryTimeMode(nextMode);
    try {
      localStorage.setItem(ENTRY_TIME_MODE_STORAGE_KEY, nextMode);
    } catch {
      // Keep the setting usable for this session when browser storage is unavailable.
    }
  };
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

  const profitFactor = calculateProfitFactor(filteredTrades);
  const expectancy = calculateExpectancy(stats);
  const maxDrawdown = calculateMaxDrawdown(filteredTrades);
  const sharpeRatio = calculateSharpeRatio(filteredTrades);
  const sortinoRatio = calculateSortinoRatio(filteredTrades);
  const kelly = calculateKellyCriterion(filteredTrades, kellyDrawdown);

  const performanceTiles = createPerformanceTiles({
    stats, profitFactor, expectancy, maxDrawdown, sharpeRatio, sortinoRatio, kelly, kellyDrawdown,
    onKellyDrawdownChange: handleKellyDrawdownChange,
    changes: {
      totalPL: showChange ? calcPercentChange(stats.totalPL, prevStats.totalPL) : null,
      winRate: showChange ? calcPercentChange(stats.winRate, prevStats.winRate) : null,
      totalTrades: showChange ? calcPercentChange(stats.totalTrades, prevStats.totalTrades) : null,
      bestTrade: showChange ? calcPercentChange(stats.bestTrade, prevStats.bestTrade) : null,
    },
  }).concat([{
    id: 'tradingCalendar',
    label: 'Trading Calendar',
    category: 'Calendar',
    minColumns: 4,
    minRows: 5,
    defaultColumns: 4,
    defaultRows: 5,
    preview: <div className="h-[82px] rounded-md border border-border bg-bg-page p-2 flex flex-col justify-between"><div className="flex items-center justify-between"><span className="text-[10px] font-semibold text-text-secondary">Trading Calendar</span><span className="text-[9px] text-text-tertiary">Monthly</span></div><div className="grid grid-cols-7 gap-1">{Array.from({ length: 21 }, (_, index) => <span key={index} className={`h-2 rounded-[2px] ${[2, 5, 9, 12, 16, 19].includes(index) ? 'bg-positive/70' : [7, 14].includes(index) ? 'bg-negative/70' : 'bg-bg-input'}`} />)}</div></div>,
    render: () => <CalendarView trades={baseTrades} dailyNotes={dailyNotes} onSaveNote={onSaveNote} onDeleteNote={onDeleteNote} tags={tags} strategyRules={strategyRules} onOpenAddTrade={onOpenAddTrade} onEditTrade={onEditTrade} sidebarCollapsed={sidebarCollapsed} />,
  }]).concat(createAnalyticsTiles(filteredTrades), createAnalyticsChartTiles(filteredTrades, {
    monteCarloSettings,
    onMonteCarloSettingsChange: handleMonteCarloSettingsChange,
    entryTimeMode,
    onEntryTimeModeChange: handleEntryTimeModeChange,
  }));

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

      <DashboardGrid
        storageKey="rrmetrics_dashboard_tiles"
        defaultOrder={['totalPL', 'winRate', 'totalTrades', 'avgDuration', 'avgWinLoss', 'bestTrade', 'worstTrade', 'breakevenRate', 'profitFactor', 'expectancy', 'maxDrawdown', 'sharpeRatio', 'sortinoRatio', 'kellyRisk', 'tradingCalendar', 'longShortBreakdown', 'detailedStatistics', 'tickerPerformance', 'dailyNetPL', 'equityCurve', 'performanceByDay', 'performanceByEntryTime', 'monteCarloSimulation']}
        defaultVisible={['totalPL', 'winRate', 'totalTrades', 'avgDuration', 'avgWinLoss', 'bestTrade', 'worstTrade', 'breakevenRate', 'tradingCalendar']}
        items={performanceTiles}
      />
    </div>
  );
};


module.exports = DashboardPage;
