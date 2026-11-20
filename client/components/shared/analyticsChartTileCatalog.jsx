const React = require('react');
const { useMemo, useState } = React;
const { getTradePL, runMonteCarloSimulation } = require('../../utils/analytics');
const { isBreakevenTrade } = require('../../utils/tickValues');
const { toEST } = require('../../utils/dateUtils');

const DEFINITIONS = [
  { id: 'equityCurve', label: 'Equity Curve', category: 'Charts', minColumns: 1, minRows: 1, defaultColumns: 4, defaultRows: 2, description: "Tracks cumulative profit and loss in exit-time order across the selected trades." },
  { id: 'performanceByDay', label: 'Performance by Day', category: 'Charts', minColumns: 1, minRows: 1, defaultColumns: 4, defaultRows: 2, description: "Shows total profit and loss grouped by weekday of trade exit." },
  { id: 'performanceByEntryTime', label: 'Performance by Entry Time', category: 'Charts', minColumns: 1, minRows: 1, defaultColumns: 6, defaultRows: 2, description: "Groups trades into 30-minute entry-time buckets and compares average or total P/L." },
  { id: 'monteCarloSimulation', label: 'Monte Carlo Simulation', category: 'Risk', minColumns: 1, minRows: 1, defaultColumns: 6, defaultRows: 2, description: "Runs repeated simulations of the observed trade outcomes to estimate evaluation pass probability and time to pass." },
];

const Panel = ({ title, children }) => <div className="dashboard-tile-panel h-full min-h-0 min-w-0 overflow-hidden flex flex-col bg-bg-surface border border-border rounded-xl p-3 md:p-4"><h3 className="shrink-0 text-text-primary font-semibold text-sm mb-2">{title}</h3><div className="flex-1 min-h-0 min-w-0 flex flex-col">{children}</div></div>;
const Preview = ({ item }) => (
  <div className="h-[82px] rounded-md border border-border bg-bg-page p-2 flex flex-col justify-between overflow-hidden">
    <span className="text-[10px] font-semibold text-text-secondary">{item.label}</span>
    {item.id === 'equityCurve' && (
      <svg viewBox="0 0 240 52" className="w-full h-12" role="img" aria-label="Illustrative rising equity curve">
        <line x1="2" x2="238" y1="44" y2="44" stroke="rgb(var(--border))" strokeDasharray="3 3" />
        <path d="M 4 42 L 28 36 L 52 39 L 78 25 L 102 30 L 128 18 L 152 22 L 178 11 L 202 15 L 236 5" fill="none" stroke="rgb(var(--positive))" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )}
    {item.id === 'performanceByDay' && (
      <svg viewBox="0 0 240 52" className="w-full h-12" role="img" aria-label="Illustrative profit and loss by weekday">
        <line x1="2" x2="238" y1="27" y2="27" stroke="rgb(var(--border))" />
        {[12, 23, -9, 17, -15, 28, 7].map((value, index) => {
          const height = Math.abs(value);
          return <rect key={index} x={12 + index * 33} y={value >= 0 ? 27 - height : 27} width="17" height={height} rx="2" fill={value >= 0 ? 'rgb(var(--positive))' : 'rgb(var(--negative))'} opacity="0.8" />;
        })}
      </svg>
    )}
    {item.id === 'performanceByEntryTime' && (
      <svg viewBox="0 0 240 52" className="w-full h-12" role="img" aria-label="Illustrative performance by entry time">
        <line x1="2" x2="238" y1="27" y2="27" stroke="rgb(var(--border))" />
        {[8, 18, -8, 24, 14, -13, 30, 19, 9, -5, 22].map((value, index) => {
          const height = Math.abs(value);
          return <rect key={index} x={5 + index * 21} y={value >= 0 ? 27 - height : 27} width="13" height={height} rx="2" fill={value >= 0 ? 'rgb(var(--positive))' : 'rgb(var(--negative))'} opacity="0.8" />;
        })}
      </svg>
    )}
    {item.id === 'monteCarloSimulation' && (
      <svg viewBox="0 0 240 52" className="w-full h-12" role="img" aria-label="Illustrative Monte Carlo simulation paths">
        <line x1="2" x2="238" y1="44" y2="44" stroke="rgb(var(--border))" strokeDasharray="3 3" />
        <polyline points="4,44 34,37 64,40 94,27 124,31 154,20 184,15 214,7 236,5" fill="none" stroke="rgb(var(--positive))" strokeWidth="1.8" opacity="0.8" />
        <polyline points="4,44 34,48 64,35 94,39 124,29 154,33 184,24 214,26 236,17" fill="none" stroke="rgb(var(--positive))" strokeWidth="1.5" opacity="0.45" />
        <polyline points="4,44 34,31 64,35 94,42 124,39 154,47 184,41 214,44 236,36" fill="none" stroke="rgb(var(--negative))" strokeWidth="1.5" opacity="0.45" />
      </svg>
    )}
  </div>
);

const EntryTimeTile = ({ trades, mode, onModeChange }) => {
  const [showTable, setShowTable] = useState(false);
  const timeStats = useMemo(() => {
    const buckets = {};
    trades.forEach(trade => {
      const est = toEST(trade.enterTime);
      const minute = est.minutes < 30 ? 0 : 30;
      const key = String(est.hours).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
      if (!buckets[key]) buckets[key] = { totalPL: 0, wins: 0, losses: 0, breakevens: 0, count: 0, winPL: 0, lossPL: 0, grossWinPL: 0, grossLossPL: 0 };
      const pl = getTradePL(trade);
      buckets[key].totalPL += pl;
      buckets[key].count++;
      if (pl > 0) buckets[key].grossWinPL += pl;
      else buckets[key].grossLossPL += Math.abs(pl);
      if (isBreakevenTrade(trade)) buckets[key].breakevens++;
      else if (pl > 0) { buckets[key].wins++; buckets[key].winPL += pl; }
      else { buckets[key].losses++; buckets[key].lossPL += Math.abs(pl); }
    });
    const hours = [];
    for (let hour = 18; hour <= 23; hour++) hours.push(hour);
    for (let hour = 0; hour <= 16; hour++) hours.push(hour);
    const result = [];
    hours.forEach(hour => [0, 30].forEach(minute => {
      if (hour === 16 && minute === 30) return;
      const time = String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
      const data = buckets[time] || { totalPL: 0, wins: 0, losses: 0, breakevens: 0, count: 0, winPL: 0, lossPL: 0, grossWinPL: 0, grossLossPL: 0 };
      result.push({ time, ...data, winRate: data.wins + data.losses > 0 ? (data.wins / (data.wins + data.losses)) * 100 : 0, avgPL: data.count ? data.totalPL / data.count : 0 });
    }));
    return result;
  }, [trades]);

  const values = timeStats.map(stat => mode === 'avg' ? stat.avgPL : stat.totalPL);
  const maxValue = Math.max(1, ...values.map(Math.abs));
  const width = 900, height = 260, padding = 28, zeroY = 112, chartHalfHeight = 76;
  const barGap = (width - padding * 2) / timeStats.length;
  const barWidth = barGap * 0.64;

  return (
    <Panel title="Performance by Entry Time">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex bg-bg-input rounded-lg p-0.5 text-xs">
          <button onClick={() => onModeChange('avg')} className={'px-2.5 py-1 rounded-md ' + (mode === 'avg' ? 'bg-accent text-accent-text' : 'text-text-secondary')}>Avg P/L</button>
          <button onClick={() => onModeChange('total')} className={'px-2.5 py-1 rounded-md ' + (mode === 'total' ? 'bg-accent text-accent-text' : 'text-text-secondary')}>Total P/L</button>
        </div>
        <span className="text-[10px] text-text-tertiary">30-minute buckets · US Eastern time</span>
      </div>
      <div className="w-full flex-1 min-h-0 min-w-0 overflow-hidden">
        <svg viewBox={'0 0 ' + width + ' ' + height} role="img" aria-label="Profit and loss by entry time" className="w-full h-full min-h-0">
          <line x1={padding} x2={width - padding} y1={zeroY} y2={zeroY} stroke="rgb(var(--border))" strokeDasharray="4 4" />
          {timeStats.map((stat, index) => {
            const value = values[index];
            const barHeight = (Math.abs(value) / maxValue) * chartHalfHeight;
            const x = padding + index * barGap + (barGap - barWidth) / 2;
            const y = value >= 0 ? zeroY - barHeight : zeroY;
            const pf = stat.grossLossPL === 0 ? (stat.grossWinPL > 0 ? '∞' : '0.00') : (stat.grossWinPL / stat.grossLossPL).toFixed(2);
            const tooltip = stat.time + ' · ' + stat.count + ' trades · ' + stat.breakevens + ' breakeven · ' + stat.winRate.toFixed(1) + '% win rate · PF ' + pf + ' · Total $' + stat.totalPL.toFixed(2) + ' · Average $' + stat.avgPL.toFixed(2);
            return <g key={stat.time}>
              {stat.count > 0 && <rect x={x} y={y} width={barWidth} height={Math.max(1, barHeight)} rx="2" fill={value >= 0 ? 'rgb(var(--positive))' : 'rgb(var(--negative))'} opacity="0.85"><title>{tooltip}</title></rect>}
              {(index % 6 === 0 || index === timeStats.length - 1) && <text x={x + barWidth / 2} y="224" textAnchor="middle" fill="rgb(var(--text-tertiary))" fontSize="10">{stat.time}</text>}
            </g>;
          })}
        </svg>
      </div>
      <div className="flex items-center justify-between mt-2">
        <span className="text-[10px] text-text-tertiary">{timeStats.reduce((sum, stat) => sum + stat.count, 0)} trades in selected period</span>
        <button onClick={() => setShowTable(value => !value)} className="text-xs text-text-secondary hover:text-text-primary underline">{showTable ? 'Hide details' : 'Show details'}</button>
      </div>
      {showTable && <div className="max-h-[260px] overflow-y-auto mt-3">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-bg-surface"><tr className="border-b border-border"><th className="text-left py-2">Time</th><th className="text-right py-2">Trades</th><th className="text-right py-2">BE</th><th className="text-right py-2">Win rate</th><th className="text-right py-2">Total P/L</th><th className="text-right py-2">Avg P/L</th></tr></thead>
          <tbody>{timeStats.filter(stat => stat.count > 0).map(stat => <tr key={stat.time} className="border-b border-border/50">
            <td className="py-1.5">{stat.time}</td><td className="text-right">{stat.count}</td><td className="text-right">{stat.breakevens}</td><td className="text-right">{stat.winRate.toFixed(1)}%</td>
            <td className={'text-right ' + (stat.totalPL >= 0 ? 'text-positive' : 'text-negative')}>{(stat.totalPL >= 0 ? '+' : '') + '$' + stat.totalPL.toFixed(2)}</td>
            <td className={'text-right ' + (stat.avgPL >= 0 ? 'text-positive' : 'text-negative')}>{(stat.avgPL >= 0 ? '+' : '') + '$' + stat.avgPL.toFixed(2)}</td>
          </tr>)}</tbody>
        </table>
      </div>}
    </Panel>
  );
};

const MonteCarloTile = ({ trades, settings }) => {
  const results = useMemo(() => runMonteCarloSimulation(trades, settings), [trades, settings.profitTarget, settings.maxDrawdown]);
  if (results.insufficientTrades || !results.paths || results.paths.length === 0) {
    return <Panel title="Monte Carlo Eval Simulation"><p className="text-sm text-text-tertiary">At least five trades are needed to run the simulation.</p></Panel>;
  }
  let maxDay = 1, minValue = 0, maxValue = 0;
  results.paths.forEach(path => {
    maxDay = Math.max(maxDay, path.points.length);
    path.points.forEach(value => { minValue = Math.min(minValue, value); maxValue = Math.max(maxValue, value); });
  });
  maxValue = maxValue > 0 ? maxValue * 1.05 : maxValue * 0.95;
  minValue = minValue < 0 ? minValue * 1.05 : minValue * 0.95;
  const range = maxValue - minValue || 1;
  const width = 900, height = 300;
  const padding = { top: 18, right: 18, bottom: 28, left: 58 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const toX = day => padding.left + (day / Math.max(1, maxDay - 1)) * chartWidth;
  const toY = value => padding.top + ((maxValue - value) / range) * chartHeight;

  return (
    <Panel title="Monte Carlo Eval Simulation">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-text-tertiary mb-2">
        <span>{results.totalSimulations.toLocaleString()} simulations · ${results.profitTarget.toLocaleString()} target · ${results.maxDrawdown.toLocaleString()} EOD trailing drawdown</span><span>{results.paths.length} sample paths</span>
      </div>
      <p className="text-[10px] text-text-tertiary mb-2">Historical trade P/L is sampled with replacement at the rounded average trades-per-day rate. Drawdown is checked at the end of each simulated day; results are illustrative, not a prediction.</p>
      <div className="w-full flex-1 min-h-0 min-w-0 overflow-hidden">
        <svg viewBox={'0 0 ' + width + ' ' + height} role="img" aria-label="Monte Carlo simulated equity paths" className="w-full h-full min-h-0">
          {[0, 1, 2, 3, 4, 5].map(index => {
            const y = padding.top + (chartHeight / 5) * index;
            const value = maxValue - (range / 5) * index;
            return <g key={index}><line x1={padding.left} x2={width - padding.right} y1={y} y2={y} stroke="rgb(var(--border))" /><text x={padding.left - 8} y={y + 4} textAnchor="end" fill="rgb(var(--text-tertiary))" fontSize="10">{'$' + value.toFixed(0)}</text></g>;
          })}
          <line x1={padding.left} x2={width - padding.right} y1={toY(0)} y2={toY(0)} stroke="rgb(var(--text-tertiary))" strokeDasharray="3 3" />
          {results.paths.map((path, pathIndex) => {
            const points = path.points.map((value, index) => toX(index).toFixed(1) + ',' + toY(value).toFixed(1)).join(' ');
            return <polyline key={pathIndex} points={points} fill="none" stroke={path.passed ? 'rgb(var(--positive))' : 'rgb(var(--negative))'} strokeOpacity={path.passed ? 0.25 : 0.2} strokeWidth="1" />;
          })}
        </svg>
      </div>
      <div className="grid grid-cols-3 gap-2 mt-3">
        <div className="bg-bg-page rounded-lg p-3 text-center"><div className="text-text-secondary text-[10px] uppercase">Pass Rate</div><div className={'text-xl font-bold ' + (results.passRate >= 50 ? 'text-positive' : 'text-negative')}>{results.passRate.toFixed(1)}%</div></div>
        <div className="bg-bg-page rounded-lg p-3 text-center"><div className="text-text-secondary text-[10px] uppercase">Avg Days to Pass</div><div className="text-xl font-bold text-text-primary">{results.avgDaysToPass > 0 ? results.avgDaysToPass.toFixed(1) : '—'}</div></div>
        <div className="bg-bg-page rounded-lg p-3 text-center"><div className="text-text-secondary text-[10px] uppercase">Median Days to Pass</div><div className="text-xl font-bold text-text-primary">{results.medianDaysToPass > 0 ? results.medianDaysToPass.toFixed(1) : '—'}</div></div>
      </div>
    </Panel>
  );
};

const createAnalyticsChartTiles = (trades = [], options = {}) => {
  const monteCarloSettings = options.monteCarloSettings || { profitTarget: 3000, maxDrawdown: 2000 };
  const onMonteCarloSettingsChange = options.onMonteCarloSettingsChange || (() => {});
  const entryTimeMode = options.entryTimeMode === 'total' ? 'total' : 'avg';
  const onEntryTimeModeChange = options.onEntryTimeModeChange || (() => {});
  const defs = Object.fromEntries(DEFINITIONS.map(item => [item.id, item]));
  const tile = (id, render) => ({ ...defs[id], preview: <Preview item={defs[id]} />, render });
  const sorted = [...trades].sort((a, b) => new Date(a.exitTime) - new Date(b.exitTime));
  const cumulative = [];
  let running = 0;
  sorted.forEach(trade => { running += getTradePL(trade); cumulative.push(running); });
  const width = 640, height = 230, pad = 28;
  const min = Math.min(0, ...cumulative), max = Math.max(0, ...cumulative), range = max - min || 1;
  const points = cumulative.map((value, index) => ({
    x: pad + (cumulative.length <= 1 ? (width - pad * 2) / 2 : index * (width - pad * 2) / (cumulative.length - 1)),
    y: pad + ((max - value) / range) * (height - pad * 2),
  }));
  const path = points.map((point, index) => (index ? 'L' : 'M') + ' ' + point.x.toFixed(1) + ' ' + point.y.toFixed(1)).join(' ');
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dayValues = Array(7).fill(0);
  trades.forEach(trade => { const est = toEST(trade.exitTime); const day = new Date(est.year, est.month - 1, est.day).getDay(); dayValues[day] += getTradePL(trade); });
  const dayMax = Math.max(1, ...dayValues.map(Math.abs));
  const zeroY = 105;
  return [
    tile('equityCurve', () => <Panel title="Equity Curve">
      {trades.length ? <div className="w-full flex-1 min-h-0 min-w-0 overflow-hidden"><svg viewBox={'0 0 ' + width + ' ' + height} role="img" aria-label="Cumulative profit and loss chart" className="w-full h-full min-h-0">
        {[0, 1, 2, 3, 4].map(index => <line key={index} x1={pad} x2={width - pad} y1={pad + index * (height - pad * 2) / 4} y2={pad + index * (height - pad * 2) / 4} stroke="rgb(var(--border))" strokeWidth="1" />)}
        {min < 0 && max > 0 && <line x1={pad} x2={width - pad} y1={pad + (max / range) * (height - pad * 2)} y2={pad + (max / range) * (height - pad * 2)} stroke="rgb(var(--text-muted))" strokeDasharray="4 4" />}
        {points.length > 1 && <path d={path} fill="none" stroke={cumulative[cumulative.length - 1] >= 0 ? 'rgb(var(--positive))' : 'rgb(var(--negative))'} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />}
      </svg></div> : <p className="text-sm text-text-tertiary">No trades available</p>}
      <div className={'text-right text-sm font-semibold ' + (running >= 0 ? 'text-positive' : 'text-negative')}>{(running >= 0 ? '+' : '') + '$' + running.toFixed(2)} total P/L</div>
    </Panel>),
    tile('performanceByDay', () => <Panel title="Performance by Day">
      <div className="flex items-center justify-between text-[10px] text-text-tertiary mb-2"><span>Loss</span><span>Profit</span></div>
      <svg viewBox="0 0 640 230" role="img" aria-label="Profit and loss by weekday" className="w-full flex-1 h-full min-h-0">
        <line x1="24" x2="616" y1={zeroY} y2={zeroY} stroke="rgb(var(--border))" strokeDasharray="4 4" />
        {dayValues.map((value, index) => { const barHeight = Math.abs(value) / dayMax * 78; const x = 48 + index * 84; return <g key={dayNames[index]}><rect x={x} y={value >= 0 ? zeroY - barHeight : zeroY} width="42" height={Math.max(1, barHeight)} rx="4" fill={value >= 0 ? 'rgb(var(--positive))' : 'rgb(var(--negative))'} opacity="0.85" /><text x={x + 21} y="205" textAnchor="middle" fill="rgb(var(--text-tertiary))" fontSize="12">{dayNames[index]}</text><text x={x + 21} y={value >= 0 ? zeroY - barHeight - 7 : zeroY + barHeight + 15} textAnchor="middle" fill="rgb(var(--text-secondary))" fontSize="10">{value === 0 ? '' : Math.round(value)}</text></g>; })}
      </svg>
      <p className="text-[11px] text-text-tertiary text-right">Total P/L by exit weekday</p>
    </Panel>),
    tile('performanceByEntryTime', () => <EntryTimeTile trades={trades} mode={entryTimeMode} onModeChange={onEntryTimeModeChange} />),
    {
      ...tile('monteCarloSimulation', () => <MonteCarloTile trades={trades} settings={monteCarloSettings} />),
      settings: [
        {
          id: 'profitTarget', label: 'Profit target ($)', description: 'Evaluation profit target used by each simulation.',
          type: 'number', min: 1, step: 100, value: monteCarloSettings.profitTarget,
          onChange: value => onMonteCarloSettingsChange('profitTarget', value),
        },
        {
          id: 'maxDrawdown', label: 'Maximum drawdown ($)', description: 'Trailing drawdown limit checked at the end of each simulated day.',
          type: 'number', min: 1, step: 100, value: monteCarloSettings.maxDrawdown,
          onChange: value => onMonteCarloSettingsChange('maxDrawdown', value),
        },
      ],
    },
  ];
};

module.exports = { ANALYTICS_CHART_TILE_DEFINITIONS: DEFINITIONS, createAnalyticsChartTiles };
