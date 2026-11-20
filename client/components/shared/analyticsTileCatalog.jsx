const React = require('react');
const { getTradePL, calculateAnalytics } = require('../../utils/analytics');
const { isBreakevenTrade } = require('../../utils/tickValues');
const { formatDuration } = require('../../utils/dateUtils');

const TILE_DEFINITIONS = [
  { id: 'longShortBreakdown', label: 'Long vs Short', category: 'Trade Analysis', minColumns: 1, minRows: 1, defaultColumns: 4, defaultRows: 1, description: "Compares trade count, win rate, average P/L and total P/L for long and short positions." },
  { id: 'detailedStatistics', label: 'Detailed Statistics', category: 'Trade Analysis', minColumns: 1, minRows: 1, defaultColumns: 4, defaultRows: 2, description: "A compact breakdown of trade counts, win/loss results, streaks and average duration." },
  { id: 'tickerPerformance', label: 'P/L by Ticker', category: 'Trade Analysis', minColumns: 1, minRows: 1, defaultColumns: 4, defaultRows: 1, description: "Compares results by ticker, including trade count, win rate and total P/L." },
];

const Preview = ({ item }) => (
  <div className="h-[82px] rounded-md border border-border bg-bg-page p-2 flex flex-col justify-between overflow-hidden">
    <span className="text-[10px] font-semibold text-text-secondary">{item.label}</span>
    {item.id === 'longShortBreakdown' && (
      <div className="grid grid-cols-2 gap-3">
        {['Long', 'Short'].map((label, index) => (
          <div key={label} className="space-y-1">
            <div className={`text-[9px] font-bold ${index === 0 ? 'text-positive' : 'text-negative'}`}>{label}</div>
            <div className="h-1.5 rounded bg-bg-input overflow-hidden"><div className={`h-full rounded ${index === 0 ? 'bg-positive' : 'bg-negative'}`} style={{ width: index === 0 ? '72%' : '46%' }} /></div>
            <div className="h-1 rounded bg-bg-input w-4/5" />
          </div>
        ))}
      </div>
    )}
    {item.id === 'detailedStatistics' && (
      <div className="space-y-1.5">
        {['Trades', 'Win rate', 'Avg. P/L', 'Streak'].map((label, index) => (
          <div key={label} className="flex items-center justify-between gap-2 text-[8px]">
            <span className="text-text-tertiary">{label}</span>
            <span className={index === 1 || index === 2 ? 'text-positive font-semibold' : 'text-text-secondary'}>{['50', '64%', '+$49', '5'][index]}</span>
          </div>
        ))}
      </div>
    )}
    {item.id === 'tickerPerformance' && (
      <div className="space-y-1.5">
        {['MGC', 'MES', 'MNQ'].map((ticker, index) => (
          <div key={ticker} className="flex items-center gap-2 text-[8px]">
            <span className="w-7 font-mono text-text-secondary">{ticker}</span>
            <div className="h-1.5 flex-1 rounded bg-bg-input overflow-hidden"><div className={`h-full rounded ${index === 1 ? 'bg-negative' : 'bg-positive'}`} style={{ width: ['76%', '42%', '61%'][index] }} /></div>
            <span className={index === 1 ? 'text-negative' : 'text-positive'}>{index === 1 ? '-$80' : '+$120'}</span>
          </div>
        ))}
      </div>
    )}
  </div>
);
const Panel = ({ title, children }) => <div className="dashboard-tile-panel h-full min-h-0 min-w-0 overflow-hidden flex flex-col bg-bg-surface border border-border rounded-xl p-3 md:p-4"><h3 className="shrink-0 text-text-primary font-semibold text-sm mb-2">{title}</h3><div className="dashboard-tile-panel-content flex-1 min-h-0 min-w-0">{children}</div></div>;

const createAnalyticsTiles = (trades = []) => {
  const definitions = Object.fromEntries(TILE_DEFINITIONS.map(item => [item.id, item]));
  const tile = (id, render) => ({ ...definitions[id], preview: <Preview item={definitions[id]} />, render });
  const longStats = calculateAnalytics(trades.filter(trade => Number(trade.quantity) > 0));
  const shortStats = calculateAnalytics(trades.filter(trade => Number(trade.quantity) < 0));
  const side = (label, stats, positive) => (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-2"><span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold uppercase ${positive ? 'bg-positive/15 text-positive' : 'bg-negative/15 text-negative'}`}>{label}</span><span className="text-text-secondary text-sm">{stats.totalTrades} trades</span></div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
        <span className="text-text-secondary">Win Rate</span><span className="text-text-primary font-semibold">{stats.winRate.toFixed(1)}%</span>
        <span className="text-text-secondary">Avg P/L</span><span className={`font-semibold ${stats.totalTrades && stats.totalPL / stats.totalTrades >= 0 ? 'text-positive' : 'text-negative'}`}>${stats.totalTrades ? (stats.totalPL / stats.totalTrades).toFixed(2) : '0.00'}</span>
        <span className="text-text-secondary">Total P/L</span><span className={`font-semibold ${stats.totalPL >= 0 ? 'text-positive' : 'text-negative'}`}>${stats.totalPL.toFixed(2)}</span>
      </div>
    </div>
  );
  const tickerStats = {};
  trades.forEach(trade => {
    const ticker = trade.ticker || 'Unknown';
    if (!tickerStats[ticker]) tickerStats[ticker] = { wins: 0, losses: 0, breakevens: 0, totalTrades: 0, totalPL: 0 };
    const data = tickerStats[ticker];
    const pl = getTradePL(trade);
    data.totalTrades++;
    if (isBreakevenTrade(trade)) data.breakevens++;
    else if (pl > 0) data.wins++;
    else data.losses++;
    data.totalPL += pl;
  });
  const sorted = [...trades].sort((a, b) => new Date(a.exitTime) - new Date(b.exitTime));
  let bestWinStreak = 0, bestLossStreak = 0, streak = 0, previousWin = null;
  sorted.forEach(trade => {
    if (isBreakevenTrade(trade)) { streak = 0; previousWin = null; return; }
    const isWin = getTradePL(trade) > 0;
    streak = previousWin === isWin ? streak + 1 : 1;
    previousWin = isWin;
    if (isWin) bestWinStreak = Math.max(bestWinStreak, streak);
    else bestLossStreak = Math.max(bestLossStreak, streak);
  });
  const stats = calculateAnalytics(trades);
  return [
    tile('longShortBreakdown', () => <Panel title="Long vs Short Breakdown"><div className="dashboard-long-short grid grid-cols-1 gap-3 h-full min-h-0 overflow-auto">{side('Long', longStats, true)}{side('Short', shortStats, false)}</div></Panel>),
    tile('detailedStatistics', () => <Panel title="Detailed Statistics"><div className="dashboard-detailed-stats grid grid-cols-1 gap-x-5 gap-y-0 h-full min-h-0 overflow-y-auto">{[['Total Trades', stats.totalTrades, 'text-text-primary'], ['Winning Trades', stats.wins, 'text-positive'], ['Losing Trades', stats.losses, 'text-negative'], ['Breakeven Trades', stats.breakevens, 'text-text-secondary'], ['Avg Win', `$${stats.avgWin.toFixed(2)}`, 'text-positive'], ['Avg Loss', `$${stats.avgLoss.toFixed(2)}`, 'text-negative'], ['Best Trade', `$${stats.bestTrade.toFixed(2)}`, 'text-positive'], ['Worst Trade', `$${stats.worstTrade.toFixed(2)}`, 'text-negative'], ['Best Win Streak', bestWinStreak, 'text-positive'], ['Worst Loss Streak', bestLossStreak, 'text-negative'], ['Avg Duration', formatDuration(stats.avgDuration), 'text-text-primary']].map(([label, value, color]) => <div key={label} className="flex items-center justify-between gap-2 py-1.5 border-b border-border/50 pr-2"><span className="text-text-secondary text-sm">{label}</span><span className={`text-sm ${color}`}>{value}</span></div>)}</div></Panel>),
    tile('tickerPerformance', () => <Panel title="P/L by Ticker"><div className="dashboard-ticker-list flex h-full min-h-0 flex-row items-center gap-4 overflow-x-auto overflow-y-hidden">{Object.entries(tickerStats).sort((a, b) => Math.abs(b[1].totalPL) - Math.abs(a[1].totalPL)).map(([ticker, data]) => { const decisive = data.wins + data.losses; const winRate = decisive ? ((data.wins / decisive) * 100).toFixed(0) : '0'; return <div key={ticker} className="dashboard-ticker-item grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-r border-border/50 pr-4 py-1"><span className="text-sm font-semibold text-text-primary">{ticker}</span><span className={`row-span-2 col-start-2 text-sm font-semibold text-right ${data.totalPL >= 0 ? 'text-positive' : 'text-negative'}`}>{data.totalPL >= 0 ? '+' : ''}${data.totalPL.toFixed(2)}</span><span className="dashboard-ticker-meta text-text-tertiary text-xs">{data.totalTrades} trades · {winRate}% WR</span></div>; })}{Object.keys(tickerStats).length === 0 && <p className="text-sm text-text-tertiary">No ticker data available</p>}</div></Panel>),
  ];
};

module.exports = { ANALYTICS_TILE_DEFINITIONS: TILE_DEFINITIONS, createAnalyticsTiles };