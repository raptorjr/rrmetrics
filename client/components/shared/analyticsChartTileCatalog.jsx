const React = require('react');
const { useMemo, useState } = React;
const { getTradePL, runMonteCarloSimulation, groupTradesByDate } = require('../../utils/analytics');
const { isBreakevenTrade } = require('../../utils/tickValues');
const { toEST, getDisplayTimeZone, formatDuration } = require('../../utils/dateUtils');
const InfoTooltip = require('./InfoTooltip');

const DEFINITIONS = [
  { id: 'dailyNetPL', label: 'Net Daily P/L', category: 'Charts', minColumns: 1, minRows: 1, defaultColumns: 6, defaultRows: 2, description: "Shows net profit and loss for each trading day over time." },
  { id: 'equityCurve', label: 'Equity Curve', category: 'Charts', minColumns: 1, minRows: 1, defaultColumns: 4, defaultRows: 2, description: "Tracks cumulative profit and loss in exit-time order across the selected trades." },
  { id: 'performanceByDay', label: 'Performance by Day', category: 'Charts', minColumns: 1, minRows: 2, defaultColumns: 4, defaultRows: 2, description: "Shows total profit and loss grouped by weekday of trade exit." },
  { id: 'performanceByEntryTime', label: 'Performance by Entry Time', category: 'Charts', minColumns: 1, minRows: 2, defaultColumns: 6, defaultRows: 2, description: "Groups trades into 30-minute entry-time buckets and compares average or total P/L." },
  { id: 'monteCarloSimulation', label: 'Monte Carlo Simulation', category: 'Risk', minColumns: 2, minRows: 2, defaultColumns: 6, defaultRows: 2, description: "Runs repeated simulations of the observed trade outcomes to estimate evaluation pass probability and time to pass." },
];

const Panel = ({ title, children, actions }) => <div className="dashboard-tile-panel h-full min-h-0 min-w-0 overflow-hidden flex flex-col bg-bg-surface border border-border rounded-xl p-3 md:p-4"><div className="shrink-0 flex items-center justify-between gap-2 mb-2"><h3 className="min-w-0 text-text-primary font-semibold text-sm">{title}</h3>{actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}</div><div className="flex-1 min-h-0 min-w-0 flex flex-col">{children}</div></div>;
const Preview = ({ item }) => (
  <div className="h-[82px] rounded-md border border-border bg-bg-page p-2 flex flex-col justify-between overflow-hidden">
    <span className="text-[10px] font-semibold text-text-secondary">{item.label}</span>
    {item.id === 'dailyNetPL' && (
      <svg viewBox="0 0 240 52" className="w-full h-12" role="img" aria-label="Illustrative daily net profit and loss">
        <line x1="2" x2="238" y1="27" y2="27" stroke="rgb(var(--border))" />
        {[12,-8,18,-16,8,-22,14,6,-12,20,-5].map((value,index)=><rect key={index} x={5+index*21} y={value>=0?27-value:27} width="12" height={Math.abs(value)} rx="1" fill={value>=0?'rgb(var(--positive))':'rgb(var(--negative))'}/>)}
      </svg>
    )}
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
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: getDisplayTimeZone(), hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
      }).formatToParts(new Date(trade.enterTime));
      const hour = Number(parts.find(part => part.type === 'hour').value);
      const minute = Number(parts.find(part => part.type === 'minute').value) < 30 ? 0 : 30;
      const key = String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
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
    const hours = Array.from({ length: 24 }, (_, hour) => hour);
    const result = [];
    hours.forEach(hour => [0, 30].forEach(minute => {
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
  const barWidth = Math.max(2, barGap * 0.62);

  return (
    <Panel title="Performance by Entry Time">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex bg-bg-input rounded-lg p-0.5 text-xs">
          <button onClick={() => onModeChange('avg')} className={'px-2.5 py-1 rounded-md ' + (mode === 'avg' ? 'bg-accent text-accent-text' : 'text-text-secondary')}>Avg P/L</button>
          <button onClick={() => onModeChange('total')} className={'px-2.5 py-1 rounded-md ' + (mode === 'total' ? 'bg-accent text-accent-text' : 'text-text-secondary')}>Total P/L</button>
        </div>
        <span className="text-[10px] text-text-tertiary">30-minute buckets · local time</span>
      </div>
      <div className="w-full flex-1 min-h-0 min-w-0 overflow-hidden">
        <svg viewBox={'0 0 ' + width + ' ' + height} role="img" aria-label="Profit and loss by entry time" preserveAspectRatio="none" className="dashboard-responsive-chart w-full h-full min-h-0">
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
              {(index % 12 === 0 || index === timeStats.length - 1) && <text x={x + barWidth / 2} y="224" textAnchor="middle" className={`chart-axis-label chart-x-label chart-x-label-${index === timeStats.length - 1 ? 4 : Math.floor(index / 12)}`} fill="rgb(var(--text-primary))" fontSize="12">{stat.time}</text>}
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

const PerformanceByDayTile = ({ trades }) => {
  const [mode, setMode] = useState('avg');
  const [showTable, setShowTable] = useState(false);
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const stats = useMemo(() => {
    const days = dayNames.map((day, index) => ({ day, index, count: 0, wins: 0, losses: 0, breakevens: 0, totalPL: 0 }));
    trades.forEach(trade => {
      const weekday = new Intl.DateTimeFormat('en-US', {
        timeZone: getDisplayTimeZone(),
        weekday: 'short',
      }).format(new Date(trade.exitTime));
      const day = days[dayNames.indexOf(weekday)];
      const pl = getTradePL(trade);
      day.count++; day.totalPL += pl;
      if (isBreakevenTrade(trade)) day.breakevens++;
      else if (pl > 0) day.wins++; else day.losses++;
    });
    return days.map(day => ({ ...day, avgPL: day.count ? day.totalPL / day.count : 0, winRate: day.wins + day.losses ? day.wins / (day.wins + day.losses) * 100 : 0 }));
  }, [trades]);
  const values = stats.map(day => mode === 'avg' ? day.avgPL : day.totalPL);
  const maxValue = Math.max(1, ...values.map(Math.abs));
  const zeroY = 116, halfHeight = 76, left = 24, right = 616, gap = (right - left) / 7, barWidth = gap * 0.58;
  return <Panel title="Performance by Day">
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 mb-1">
      <div className="flex bg-bg-input rounded-lg p-0.5 text-xs">
        <button onClick={() => setMode('avg')} className={'px-2.5 py-1 rounded-md ' + (mode === 'avg' ? 'bg-accent text-accent-text' : 'text-text-secondary')}>Avg P/L</button>
        <button onClick={() => setMode('total')} className={'px-2.5 py-1 rounded-md ' + (mode === 'total' ? 'bg-accent text-accent-text' : 'text-text-secondary')}>Total P/L</button>
      </div>
      <span className="text-[10px] text-text-tertiary">By exit weekday</span>
    </div>
    <svg viewBox="0 0 640 230" role="img" aria-label={mode === 'avg' ? 'Average profit and loss by weekday' : 'Total profit and loss by weekday'} preserveAspectRatio="none" className="dashboard-responsive-chart w-full flex-1 min-h-0">
      <line x1={left} x2={right} y1={zeroY} y2={zeroY} stroke="rgb(var(--text-muted))" strokeDasharray="4 4" />
      {stats.map((day, index) => {
        const value = values[index], height = Math.abs(value) / maxValue * halfHeight;
        const x = left + index * gap + (gap - barWidth) / 2, y = value >= 0 ? zeroY - height : zeroY;
        return <g key={day.day}>
          <rect x={x} y={y} width={barWidth} height={Math.max(1, height)} rx="3" className="performance-day-bar" fill={value >= 0 ? 'rgb(var(--positive))' : 'rgb(var(--negative))'} />
          <text className="weekday-full" x={x + barWidth / 2} y="210" textAnchor="middle" fill="rgb(var(--text-primary))" fontSize="12">{day.day}</text><text className="weekday-short" x={x + barWidth / 2} y="210" textAnchor="middle" fill="rgb(var(--text-primary))" fontSize="12">{day.day[0]}</text>
          {day.count > 0 && <title>{day.day}: {day.count} trades · {mode === 'avg' ? 'Average' : 'Total'} P/L ${value.toFixed(2)}</title>}
        </g>;
      })}
    </svg>
    <div className="flex shrink-0 items-center justify-between mt-1">
      <span className="text-[10px] text-text-tertiary">{trades.length} trades in selected period</span>
      <button onClick={() => setShowTable(value => !value)} className="text-xs text-text-secondary hover:text-text-primary underline">{showTable ? 'Hide details' : 'Show details'}</button>
    </div>
    {showTable && <div className="max-h-[260px] overflow-y-auto mt-2">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-bg-surface"><tr className="border-b border-border"><th className="text-left py-2">Day</th><th className="text-right">Trades</th><th className="text-right">Wins</th><th className="text-right">Losses</th><th className="text-right">Win rate</th><th className="text-right">Total P/L</th><th className="text-right">Avg P/L</th></tr></thead>
        <tbody>{stats.filter(day => day.count > 0).map(day => <tr key={day.day} className="border-b border-border/50"><td className="py-1.5">{day.day}</td><td className="text-right">{day.count}</td><td className="text-right">{day.wins}</td><td className="text-right">{day.losses}</td><td className="text-right">{day.winRate.toFixed(1)}%</td><td className={'text-right ' + (day.totalPL >= 0 ? 'text-positive' : 'text-negative')}>${day.totalPL.toFixed(2)}</td><td className={'text-right ' + (day.avgPL >= 0 ? 'text-positive' : 'text-negative')}>${day.avgPL.toFixed(2)}</td></tr>)}</tbody>
      </table>
    </div>}
  </Panel>;
};

const DailyNetPLTile = ({ trades }) => {
  const daily = useMemo(() => Object.entries(groupTradesByDate(trades)).sort(([a],[b]) => a.localeCompare(b)), [trades]);
  const values = daily.map(([, day]) => day.totalPL);
  const maxValue = Math.max(1, ...values.map(Math.abs));
  const width = 900, height = 300, pad = { left: 58, right: 18, top: 18, bottom: 36 };
  const chartWidth = width - pad.left - pad.right, zeroY = pad.top + (height - pad.top - pad.bottom) / 2;
  const gap = daily.length ? chartWidth / daily.length : chartWidth;
  const barWidth = Math.max(1, Math.min(8, gap * 0.72));
  const dateLabel = value => { const [year,month,day] = value.split('-'); return month + '/' + day + '/' + year.slice(2); };
  return <Panel title="Net Daily P/L">
    <div className="flex shrink-0 justify-between text-[10px] text-text-tertiary"><span>Loss</span><span>Profit</span></div>
    <svg viewBox={'0 0 ' + width + ' ' + height} role="img" aria-label="Daily net profit and loss over time" preserveAspectRatio="none" className="dashboard-responsive-chart w-full flex-1 min-h-0">
      {[0,1,2,3,4].map(index => { const y=pad.top+index*(height-pad.top-pad.bottom)/4; const value=maxValue-(index*maxValue*2/4); return <g key={index}><line x1={pad.left} x2={width-pad.right} y1={y} y2={y} stroke="rgb(var(--border))" strokeDasharray="3 4"/><text x={pad.left-8} y={y+4} textAnchor="end" className={`chart-axis-label chart-y-label chart-y-label-${index}`} fill="rgb(var(--text-primary))" fontSize="12">{'$' + Math.round(value).toLocaleString()}</text></g>; })}
      <line x1={pad.left} x2={width-pad.right} y1={zeroY} y2={zeroY} stroke="rgb(var(--text-secondary))" strokeDasharray="4 3"/>
      {daily.map(([date,day],index)=>{const value=day.totalPL; const barHeight=Math.abs(value)/maxValue*((height-pad.top-pad.bottom)/2-4); const x=pad.left+index*gap+(gap-barWidth)/2; return <rect key={date} x={x} y={value>=0?zeroY-barHeight:zeroY} width={barWidth} height={Math.max(1,barHeight)} fill={value>=0?'rgb(var(--positive))':'rgb(var(--negative))'}><title>{date}: {day.tradeCount} trades · {'$' + value.toFixed(2)}</title></rect>;})}
      {[0,1,2,3,4].map(index=>{const entry=daily[Math.round(index*(daily.length-1)/4)];return entry?<text key={index} x={pad.left+index*chartWidth/4} y={height-8} textAnchor="middle" className={`chart-axis-label chart-x-label chart-x-label-${index}` } fill="rgb(var(--text-primary))" fontSize="12">{dateLabel(entry[0])}</text>:null;})}
    </svg>
    <div className="shrink-0 text-right text-[10px] text-text-tertiary">{daily.length} trading days</div>
  </Panel>;
};

const MonteCarloTile = ({ trades, settings, settingsControl }) => {
  const [runVersion, setRunVersion] = useState(0);
  const results = useMemo(() => runMonteCarloSimulation(trades, settings), [trades, settings.profitTarget, settings.maxDrawdown, runVersion]);
  if (results.insufficientTrades || !results.paths || results.paths.length === 0) {
    return <Panel title={<span className="flex items-center gap-1">Monte Carlo Eval Simulation <InfoTooltip text="Historical trade P/L is sampled with replacement at the rounded average trades-per-day rate. Drawdown is checked at the end of each simulated day. Results are illustrative, not a prediction." /></span>}><p className="text-sm text-text-tertiary">At least five trades are needed to run the simulation.</p></Panel>;
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
    <Panel
      title={<span className="flex items-center gap-0.5">Monte Carlo Eval Simulation<InfoTooltip text="Historical trade P/L is sampled with replacement at the rounded average trades-per-day rate. Drawdown is checked at the end of each simulated day. Results are illustrative, not a prediction." />{settingsControl}<button type="button" onClick={() => setRunVersion(value => value + 1)} title="Recalculate simulation" aria-label="Recalculate simulation" className="dashboard-tile-icon-button">↻</button></span>}
    >
      <div className="shrink-0 flex flex-wrap items-center justify-between gap-2 text-[10px] text-text-tertiary mb-1">
        <span>{results.totalSimulations.toLocaleString()} simulations · ${results.profitTarget.toLocaleString()} target · ${results.maxDrawdown.toLocaleString()} EOD drawdown</span>
      </div>
      <div className="dashboard-monte-layout flex flex-1 min-h-0 min-w-0 gap-3">
        <div className="dashboard-monte-summary flex shrink-0 flex-col justify-center gap-2 w-28">
          <div className="bg-bg-page rounded-lg px-2 py-2 text-center"><div className="text-text-secondary text-[9px] uppercase">Pass Rate</div><div className={'text-base font-bold ' + (results.passRate >= 50 ? 'text-positive' : 'text-negative')}>{results.passRate.toFixed(1)}%</div></div>
          <div className="bg-bg-page rounded-lg px-2 py-2 text-center"><div className="text-text-secondary text-[9px] uppercase">Avg Days</div><div className="text-base font-bold text-text-primary">{results.avgDaysToPass > 0 ? results.avgDaysToPass.toFixed(1) : '—'}</div></div>
          <div className="bg-bg-page rounded-lg px-2 py-2 text-center"><div className="text-text-secondary text-[9px] uppercase">Median Days</div><div className="text-base font-bold text-text-primary">{results.medianDaysToPass > 0 ? results.medianDaysToPass.toFixed(1) : '—'}</div></div>
        </div>
        <div className="dashboard-monte-chart flex-1 min-h-0 min-w-0 overflow-hidden">
          <svg viewBox={'0 0 ' + width + ' ' + height} role="img" aria-label="Monte Carlo simulated equity paths" preserveAspectRatio="none" className="dashboard-responsive-chart w-full h-full min-h-0">
            {[0, 1, 2, 3, 4, 5].map(index => {
              const y = padding.top + (chartHeight / 5) * index;
              const value = maxValue - (range / 5) * index;
              return <g key={index}><line x1={padding.left} x2={width - padding.right} y1={y} y2={y} stroke="rgb(var(--border))" /><text x={padding.left - 8} y={y + 4} textAnchor="end" className={`chart-axis-label chart-y-label chart-y-label-${index}`} fill="rgb(var(--text-primary))" fontSize="12">{'$' + value.toFixed(0)}</text></g>;
            })}
            <line x1={padding.left} x2={width - padding.right} y1={toY(0)} y2={toY(0)} stroke="rgb(var(--text-tertiary))" strokeDasharray="3 3" />
            {results.paths.map((path, pathIndex) => {
              const points = path.points.map((value, index) => toX(index).toFixed(1) + ',' + toY(value).toFixed(1)).join(' ');
              return <polyline key={pathIndex} points={points} fill="none" stroke={path.passed ? 'rgb(var(--positive))' : 'rgb(var(--negative))'} strokeOpacity={path.passed ? 0.25 : 0.2} strokeWidth="1" />;
            })}
          </svg>
        </div>
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
  const width = 900, height = 300, pad = { left: 62, right: 22, top: 24, bottom: 38 };
  const chartWidth = width - pad.left - pad.right, chartHeight = height - pad.top - pad.bottom;
  const min = Math.min(0, ...cumulative), max = Math.max(0, ...cumulative), range = max - min || 1;
  const points = cumulative.map((value, index) => ({
    x: pad.left + (cumulative.length <= 1 ? chartWidth / 2 : index * chartWidth / (cumulative.length - 1)),
    y: pad.top + ((max - value) / range) * chartHeight,
  }));
  const path = points.map((point, index) => (index ? 'L' : 'M') + ' ' + point.x.toFixed(1) + ' ' + point.y.toFixed(1)).join(' ');
  const zeroY = pad.top + (max / range) * chartHeight;
  const areaPath = points.length ? path + ' L ' + points[points.length - 1].x.toFixed(1) + ' ' + zeroY.toFixed(1) + ' L ' + points[0].x.toFixed(1) + ' ' + zeroY.toFixed(1) + ' Z' : '';
  let equityPeak = 0, maxEquityDrawdown = 0;
  cumulative.forEach(value => { equityPeak = Math.max(equityPeak, value); maxEquityDrawdown = Math.max(maxEquityDrawdown, equityPeak - value); });
  const highEquity = cumulative.length ? Math.max(...cumulative) : 0;
  const dateLabel = value => { const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { month: '2-digit', day: '2-digit', year: '2-digit' }); };
  return [
    tile('dailyNetPL', () => <DailyNetPLTile trades={trades} />),
    tile('equityCurve', () => <Panel title={<span className="flex items-center gap-2">Equity Curve <InfoTooltip text="Cumulative net trade P/L in exit-time order. The area is shaded around zero. Maximum drawdown measures the largest decline from a previous cumulative P/L peak." /></span>}>
      {trades.length ? <div className="dashboard-equity-layout flex flex-1 min-h-0 min-w-0 gap-3">
        <div className="dashboard-equity-summary flex shrink-0 flex-col justify-center gap-2 w-28">
          {[['Total P/L', '$'+running.toFixed(2), running>=0],['Highest equity', '$'+highEquity.toFixed(2), true],['Max drawdown', '$'+maxEquityDrawdown.toFixed(2), false],['Trades', String(trades.length), true]].map(([label,value,positive])=><div key={label} className="min-w-0 rounded bg-bg-page px-2 py-2"><div className="text-[9px] uppercase text-text-tertiary">{label}</div><div className={'text-xs font-semibold truncate '+(label==='Trades'?'text-text-primary':positive?'text-positive':'text-negative')}>{value}</div></div>)}
        </div>
        <div className="dashboard-equity-chart flex-1 min-h-0 min-w-0 overflow-hidden">
          <svg viewBox={'0 0 ' + width + ' ' + height} role="img" aria-label="Cumulative profit and loss with dates and zero reference" preserveAspectRatio="none" className="dashboard-responsive-chart w-full h-full min-h-0">
            <defs><linearGradient id="equity-area-gradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="rgb(var(--positive))" stopOpacity="0.24"/><stop offset={((zeroY / height) * 100) + '%'} stopColor="rgb(var(--positive))" stopOpacity="0.03"/><stop offset={((zeroY / height) * 100) + '%'} stopColor="rgb(var(--negative))" stopOpacity="0.03"/><stop offset="100%" stopColor="rgb(var(--negative))" stopOpacity="0.24"/></linearGradient></defs>
            {[0,1,2,3,4].map(index => { const y=pad.top+index*chartHeight/4, value=max-index*range/4; return <g key={index}><line x1={pad.left} x2={width-pad.right} y1={y} y2={y} stroke="rgb(var(--border))"/><text x={pad.left-8} y={y+4} textAnchor="end" className={`chart-axis-label chart-y-label chart-y-label-${index}`} fill="rgb(var(--text-primary))" fontSize="12">{'$'+Math.round(value).toLocaleString()}</text></g>; })}
            <line x1={pad.left} x2={width-pad.right} y1={zeroY} y2={zeroY} stroke="rgb(var(--text-secondary))" strokeDasharray="4 4"/>
            {areaPath && <path d={areaPath} fill="url(#equity-area-gradient)"/>}
            {points.length>1 && <path d={path} fill="none" stroke={running>=0?'rgb(var(--positive))':'rgb(var(--negative))'} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>}
            {[0,1,2,3,4].map(index=>{const pointIndex=Math.round(index*(sorted.length-1)/4); return sorted[pointIndex] ? <text key={index} x={pad.left+index*chartWidth/4} y={height-8} textAnchor="middle" className={`chart-axis-label chart-x-label chart-x-label-${index}` } fill="rgb(var(--text-primary))" fontSize="12">{dateLabel(sorted[pointIndex].exitTime)}</text> : null;})}
          </svg>
        </div>
      </div> : <p className="text-sm text-text-tertiary">No trades available</p>}
    </Panel>),
    tile('performanceByDay', () => <PerformanceByDayTile trades={trades} />),
    tile('performanceByEntryTime', () => <EntryTimeTile trades={trades} mode={entryTimeMode} onModeChange={onEntryTimeModeChange} />),
    {
      ...tile('monteCarloSimulation', ({ settingsControl } = {}) => <MonteCarloTile trades={trades} settings={monteCarloSettings} settingsControl={settingsControl} />),
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
