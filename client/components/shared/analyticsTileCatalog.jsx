const React = require('react');
const { getTradePL, calculateAnalytics } = require('../../utils/analytics');
const { isBreakevenTrade } = require('../../utils/tickValues');
const { formatDuration } = require('../../utils/dateUtils');

const TILE_DEFINITIONS = [
  { id: 'longShortBreakdown', label: 'Long vs Short', category: 'Trade Analysis', minColumns: 2, minRows: 1, defaultColumns: 2, defaultRows: 1, description: "Compares trade count, win rate, average P/L and total P/L for long and short positions." },
  { id: 'detailedStatistics', label: 'Detailed Statistics', category: 'Trade Analysis', minColumns: 1, minRows: 2, defaultColumns: 2, defaultRows: 2, description: "A compact breakdown of trade counts, win/loss results, streaks and average duration." },
  { id: 'tickerPerformance', label: 'P/L by Ticker', category: 'Trade Analysis', minColumns: 1, minRows: 2, defaultColumns: 2, defaultRows: 2, description: "Compares results by ticker, including trade count, win rate and total P/L." },
];

const Preview = ({ item }) => (
  <div className="h-[82px] rounded-md border border-border bg-bg-page p-2 flex flex-col justify-between">
    <span className="text-[10px] font-semibold text-text-secondary">{item.label}</span>
    <div className="space-y-1.5"><div className="h-2 rounded bg-bg-input w-full" /><div className="h-2 rounded bg-bg-input w-4/5" /><div className="h-2 rounded bg-bg-input w-3/5" /></div>
  </div>
);
const Panel = ({ title, children }) => <div className="h-full bg-bg-surface border border-border rounded-xl p-5"><h3 className="text-text-primary font-semibold mb-4">{title}</h3>{children}</div>;

const createAnalyticsTiles = (trades = []) => {
  const definitions = Object.fromEntries(TILE_DEFINITIONS.map(item => [item.id, item]));
  const tile = (id, render) => ({ ...definitions[id], preview: <Preview item={definitions[id]} />, render });
  const longStats = calculateAnalytics(trades.filter(trade => Number(trade.quantity) > 0));
  const shortStats = calculateAnalytics(trades.filter(trade => Number(trade.quantity) < 0));
  const side = (label, stats, positive) => (
    <div className="min-w-0">
      <div className="flex items-center gap-2 mb-3"><span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold uppercase ${positive ? 'bg-positive/15 text-positive' : 'bg-negative/15 text-negative'}`}>{label}</span><span className="text-text-secondary text-sm">{stats.totalTrades} trades</span></div>
      <div className="space-y-2">
        <div className="flex justify-between text-sm"><span className="text-text-secondary">Win Rate</span><span className="text-text-primary">{stats.winRate.toFixed(1)}%</span></div>
        <div className="flex justify-between text-sm"><span className="text-text-secondary">Avg P/L</span><span className={`font-semibold ${stats.totalTrades && stats.totalPL / stats.totalTrades >= 0 ? 'text-positive' : 'text-negative'}`}>${stats.totalTrades ? (stats.totalPL / stats.totalTrades).toFixed(2) : '0.00'}</span></div>
        <div className="flex justify-between text-sm"><span className="text-text-secondary">Total P/L</span><span className={`font-semibold ${stats.totalPL >= 0 ? 'text-positive' : 'text-negative'}`}>${stats.totalPL.toFixed(2)}</span></div>
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
    tile('longShortBreakdown', () => <Panel title="Long vs Short Breakdown"><div className="grid grid-cols-1 sm:grid-cols-2 gap-6">{side('Long', longStats, true)}{side('Short', shortStats, false)}</div></Panel>),
    tile('detailedStatistics', () => <Panel title="Detailed Statistics"><div className="space-y-2">{[['Total Trades', stats.totalTrades, 'text-text-primary'], ['Winning Trades', stats.wins, 'text-positive'], ['Losing Trades', stats.losses, 'text-negative'], ['Avg Win', `$${stats.avgWin.toFixed(2)}`, 'text-positive'], ['Avg Loss', `$${stats.avgLoss.toFixed(2)}`, 'text-negative'], ['Best Trade', `$${stats.bestTrade.toFixed(2)}`, 'text-positive'], ['Worst Trade', `$${stats.worstTrade.toFixed(2)}`, 'text-negative'], ['Best Win Streak', bestWinStreak, 'text-positive'], ['Worst Loss Streak', bestLossStreak, 'text-negative'], ['Avg Duration', formatDuration(stats.avgDuration), 'text-text-primary']].map(([label, value, color]) => <div key={label} className="flex items-center justify-between py-1.5 border-b border-border/50"><span className="text-text-secondary text-sm">{label}</span><span className={`text-sm ${color}`}>{value}</span></div>)}</div></Panel>),
    tile('tickerPerformance', () => <Panel title="P/L by Ticker"><div className="space-y-3 max-h-[320px] overflow-y-auto">{Object.entries(tickerStats).sort((a, b) => Math.abs(b[1].totalPL) - Math.abs(a[1].totalPL)).map(([ticker, data]) => { const decisive = data.wins + data.losses; const winRate = decisive ? ((data.wins / decisive) * 100).toFixed(0) : '0'; return <div key={ticker} className="flex items-center justify-between py-2 border-b border-border/50"><div><span className="text-sm font-semibold text-text-primary">{ticker}</span><span className="text-text-tertiary text-xs ml-2">{data.totalTrades} trades · {data.breakevens} BE · {winRate}% WR</span></div><span className={`text-sm font-semibold ${data.totalPL >= 0 ? 'text-positive' : 'text-negative'}`}>{data.totalPL >= 0 ? '+' : ''}${data.totalPL.toFixed(2)}</span></div>; })}{Object.keys(tickerStats).length === 0 && <p className="text-sm text-text-tertiary">No ticker data available</p>}</div></Panel>),
  ];
};

module.exports = { ANALYTICS_TILE_DEFINITIONS: TILE_DEFINITIONS, createAnalyticsTiles };