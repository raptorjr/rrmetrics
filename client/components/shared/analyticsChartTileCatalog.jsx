const React = require('react');
const { useMemo, useState } = React;
const { getTradePL, runMonteCarloSimulation, groupTradesByDate } = require('../../utils/analytics');
const { isBreakevenTrade } = require('../../utils/tickValues');
const { toEST, getDisplayTimeZone, formatDuration } = require('../../utils/dateUtils');
const InfoTooltip = require('./InfoTooltip');
const { calculateTradingScore } = require('../../utils/tradingScore');

const DEFINITIONS = [
  { id: 'dailyNetPL', label: 'Net Daily P/L', category: 'Charts', minColumns: 2, minRows: 2, defaultColumns: 6, defaultRows: 2, description: "Shows net profit and loss for each trading day over time." },
  { id: 'equityCurve', label: 'Equity Curve', category: 'Charts', minColumns: 1, minRows: 2, defaultColumns: 4, defaultRows: 2, description: "Tracks cumulative profit and loss in exit-time order across the selected trades." },
  { id: 'performanceByDay', label: 'Performance by Day', category: 'Charts', minColumns: 1, minRows: 2, defaultColumns: 4, defaultRows: 2, description: "Shows total profit and loss grouped by weekday of trade exit." },
  { id: 'performanceByEntryTime', label: 'Performance by Entry Time', category: 'Charts', minColumns: 1, minRows: 2, defaultColumns: 6, defaultRows: 2, description: "Groups trades into 30-minute entry-time buckets and compares average or total P/L." },
  { id: 'monteCarloSimulation', label: 'Monte Carlo Simulation', category: 'Risk', minColumns: 2, minRows: 2, defaultColumns: 6, defaultRows: 2, description: "Runs repeated simulations of the observed trade outcomes to estimate evaluation pass probability and time to pass." },
  { id: 'tradingScore', label: 'RR Trading Score', category: 'Performance', minColumns: 2, minRows: 2, defaultColumns: 6, defaultRows: 3, description: "A development-focused score across profitability, risk management, recovery and consistency, with insights into the biggest improvement opportunity." },
];


const getNiceAxis = (values, targetIntervals = 5) => {
  const min = Math.min(0, ...values), max = Math.max(0, ...values);
  const rawStep = Math.max(1, (max - min) / targetIntervals);
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const normalized = rawStep / magnitude;
  const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
  let axisMin = Math.floor(min / step) * step, axisMax = Math.ceil(max / step) * step;
  if (axisMin === axisMax) { axisMin -= step; axisMax += step; }
  const ticks = [];
  for (let value = axisMin; value <= axisMax + step * 0.001; value += step) ticks.push(Number(value.toPrecision(12)));
  return { min: axisMin, max: axisMax, ticks };
};
const formatAxisCurrency = value => (value < 0 ? '-$' : '$') + Math.abs(value).toLocaleString('en-US', { maximumFractionDigits: 0 });
const renderAxisGrid = (ticks, yForValue, left, right) => ticks.map((value, index) => {
  const y = yForValue(value);
  return <g key={value}>
    <line x1={left} x2={right} y1={y} y2={y} stroke="rgb(var(--text-tertiary))" strokeWidth="1" strokeDasharray="2 4" opacity="0.42" />
    <text x={left - 9} y={y + 4} textAnchor="end" className={"chart-axis-label chart-y-label chart-y-label-" + index} fill="rgb(var(--text-primary))" fontSize="12">{formatAxisCurrency(value)}</text>
  </g>;
});
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
    {item.id === 'tradingScore' && (
      <div className="flex items-center gap-3">
        <div className="text-lg font-bold text-accent">72.4</div>
        <div className="flex-1 grid grid-cols-3 gap-1">
          {[76,82,71,38,69,54].map((value,index)=><div key={index} className="h-1.5 rounded-full bg-bg-input overflow-hidden"><div className="h-full rounded-full bg-accent" style={{width:value+'%'}}/></div>)}
        </div>
      </div>
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
  const axis = getNiceAxis(values);
  const width = 900, height = 300, pad = { left: 76, right: 18, top: 18, bottom: 38 };
  const chartWidth = width - pad.left - pad.right, chartHeight = height - pad.top - pad.bottom;
  const yForValue = value => pad.top + ((axis.max - value) / (axis.max - axis.min)) * chartHeight;
  const zeroY = yForValue(0), barGap = chartWidth / timeStats.length;
  const barWidth = Math.max(2, barGap * 0.62);

  return (
    <Panel title={<span className="flex items-center gap-1">Performance by Entry Time <InfoTooltip text="Groups trades by their local entry time in 30-minute buckets. Avg P/L is the average result per trade in each bucket; Total P/L is the combined result. The table also shows trade count, win rate and profit/loss values." /></span>}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex bg-bg-input rounded-lg p-0.5 text-xs">
          <button onClick={() => onModeChange('avg')} className={'px-2.5 py-1 rounded-md ' + (mode === 'avg' ? 'bg-accent text-accent-text' : 'text-text-secondary')}>Avg P/L</button>
          <button onClick={() => onModeChange('total')} className={'px-2.5 py-1 rounded-md ' + (mode === 'total' ? 'bg-accent text-accent-text' : 'text-text-secondary')}>Total P/L</button>
        </div>

      </div>
      {!showTable && <div className="w-full flex-1 min-h-0 min-w-0 overflow-hidden">
        <svg viewBox={'0 0 ' + width + ' ' + height} role="img" aria-label="Profit and loss by entry time" preserveAspectRatio="none" className="dashboard-responsive-chart entry-time-chart w-full h-full min-h-0">
          {renderAxisGrid(axis.ticks, yForValue, pad.left, width - pad.right)}
          <line x1={pad.left} x2={width - pad.right} y1={zeroY} y2={zeroY} stroke="rgb(var(--text-secondary))" strokeWidth="1.2" strokeDasharray="4 3" />
          {timeStats.map((stat, index) => {
            const value = values[index];
            const valueY = yForValue(value);
            const x = pad.left + index * barGap + (barGap - barWidth) / 2;
            const pf = stat.grossLossPL === 0 ? (stat.grossWinPL > 0 ? '∞' : '0.00') : (stat.grossWinPL / stat.grossLossPL).toFixed(2);
            const tooltip = stat.time + ' · ' + stat.count + ' trades · ' + stat.breakevens + ' breakeven · ' + stat.winRate.toFixed(1) + '% win rate · PF ' + pf + ' · Total $' + stat.totalPL.toFixed(2) + ' · Average $' + stat.avgPL.toFixed(2);
            return <g key={stat.time}>
              {stat.count > 0 && <rect x={x} y={Math.min(zeroY, valueY)} width={barWidth} height={Math.max(1, Math.abs(zeroY - valueY))} rx="2" fill={value >= 0 ? 'rgb(var(--positive))' : 'rgb(var(--negative))'} opacity="0.85"><title>{tooltip}</title></rect>}
              {(index % 6 === 0 || index === timeStats.length - 1) && <text x={x + barWidth / 2} y={height - 9} textAnchor="middle" className={`chart-axis-label chart-x-label entry-time-x-label chart-x-label-${index === timeStats.length - 1 ? 8 : Math.floor(index / 6)}`} fill="rgb(var(--text-primary))" fontSize="12">{stat.time}</text>}
            </g>;
          })}
        </svg>
      </div>}
      <div className="flex items-center justify-between mt-2">
        <span className="text-[10px] text-text-tertiary">{timeStats.reduce((sum, stat) => sum + stat.count, 0)} trades in selected period</span>
        <button onClick={() => setShowTable(value => !value)} className="text-xs text-text-secondary hover:text-text-primary underline">{showTable ? 'Hide details' : 'Show details'}</button>
      </div>
      {showTable && <div className="max-h-[260px] overflow-y-auto mt-3 pr-2">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-bg-surface"><tr className="border-b border-border"><th className="text-left py-2">Time</th><th className="text-right py-2">Trades</th><th className="text-right py-2">Win rate</th><th className="text-right py-2">Total P/L</th><th className="text-right py-2">Avg P/L</th></tr></thead>
          <tbody>{timeStats.filter(stat => stat.count > 0).map(stat => <tr key={stat.time} className="border-b border-border/50">
            <td className="py-1.5">{stat.time}</td><td className="text-right">{stat.count}</td><td className="text-right">{stat.winRate.toFixed(1)}%</td>
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
  const axis = getNiceAxis(values);
  const width = 900, height = 300, pad = { left: 76, right: 18, top: 18, bottom: 38 };
  const chartWidth = width - pad.left - pad.right, chartHeight = height - pad.top - pad.bottom;
  const yForValue = value => pad.top + ((axis.max - value) / (axis.max - axis.min)) * chartHeight;
  const zeroY = yForValue(0), gap = chartWidth / 7, barWidth = gap * 0.58;
  return <Panel title={<span className="flex items-center gap-1">Performance by Day <InfoTooltip text="Groups trades by the weekday they exited, using your selected display time zone. Avg P/L is the average result per trade for that weekday; Total P/L is the combined result. The table breaks results down into trade count, wins, losses, win rate, total P/L and average P/L." /></span>}>
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 mb-1">
      <div className="flex bg-bg-input rounded-lg p-0.5 text-xs">
        <button onClick={() => setMode('avg')} className={'px-2.5 py-1 rounded-md ' + (mode === 'avg' ? 'bg-accent text-accent-text' : 'text-text-secondary')}>Avg P/L</button>
        <button onClick={() => setMode('total')} className={'px-2.5 py-1 rounded-md ' + (mode === 'total' ? 'bg-accent text-accent-text' : 'text-text-secondary')}>Total P/L</button>
      </div>

    </div>
    {!showTable && <svg viewBox={'0 0 ' + width + ' ' + height} role="img" aria-label={mode === 'avg' ? 'Average profit and loss by weekday' : 'Total profit and loss by weekday'} preserveAspectRatio="none" className="dashboard-responsive-chart w-full flex-1 min-h-0">
      {renderAxisGrid(axis.ticks, yForValue, pad.left, width - pad.right)}
      <line x1={pad.left} x2={width - pad.right} y1={zeroY} y2={zeroY} stroke="rgb(var(--text-secondary))" strokeWidth="1.2" strokeDasharray="4 3" />
      {stats.map((day, index) => {
        const value = values[index], valueY = yForValue(value);
        const x = pad.left + index * gap + (gap - barWidth) / 2;
        return <g key={day.day}>
          <rect x={x} y={Math.min(zeroY, valueY)} width={barWidth} height={Math.max(1, Math.abs(zeroY - valueY))} rx="3" className="performance-day-bar" fill={value >= 0 ? 'rgb(var(--positive))' : 'rgb(var(--negative))'} />
          <text className="weekday-full" x={x + barWidth / 2} y={height - 9} textAnchor="middle" fill="rgb(var(--text-primary))" fontSize="12">{day.day}</text><text className="weekday-short" x={x + barWidth / 2} y={height - 9} textAnchor="middle" fill="rgb(var(--text-primary))" fontSize="12">{day.day[0]}</text>
          {day.count > 0 && <title>{day.day}: {day.count} trades · {mode === 'avg' ? 'Average' : 'Total'} P/L ${value.toFixed(2)}</title>}
        </g>;
      })}
    </svg>}
    <div className="flex shrink-0 items-center justify-between mt-1">
      <span className="text-[10px] text-text-tertiary">{trades.length} trades in selected period</span>
      <button onClick={() => setShowTable(value => !value)} className="text-xs text-text-secondary hover:text-text-primary underline">{showTable ? 'Hide details' : 'Show details'}</button>
    </div>
    {showTable && <div className="max-h-[260px] overflow-y-auto mt-2 pr-2">
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
  const minValue = Math.min(0, ...values);
  const maxValue = Math.max(0, ...values);
  const rawStep = Math.max(1, (maxValue - minValue) / 5);
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const normalizedStep = rawStep / magnitude;
  const step = (normalizedStep <= 1 ? 1 : normalizedStep <= 2 ? 2 : normalizedStep <= 5 ? 5 : 10) * magnitude;
  let axisMin = Math.floor(minValue / step) * step;
  let axisMax = Math.ceil(maxValue / step) * step;
  if (axisMin === axisMax) { axisMin -= step; axisMax += step; }
  const ticks = [];
  for (let value = axisMin; value <= axisMax + step * 0.001; value += step) ticks.push(value);
  const width = 900, height = 300, pad = { left: 72, right: 18, top: 18, bottom: 36 };
  const chartWidth = width - pad.left - pad.right;
  const chartHeight = height - pad.top - pad.bottom;
  const yForValue = value => pad.top + ((axisMax - value) / (axisMax - axisMin)) * chartHeight;
  const zeroY = yForValue(0);
  const gap = daily.length ? chartWidth / daily.length : chartWidth;
  const barWidth = Math.max(1, Math.min(8, gap * 0.72));
  const dateLabel = value => { const [year,month,day] = value.split('-'); return month + '/' + day + '/' + year.slice(2); };
  const axisLabel = value => (value < 0 ? '-$' : '$') + Math.abs(value).toLocaleString('en-US', { maximumFractionDigits: 0 });
  return <Panel title={<span className="flex items-center gap-1">Net Daily P/L <InfoTooltip text="Net profit or loss for each trading day. Green bars are profitable days; red bars are losing days. The horizontal axis marks zero." /></span>}>
    <svg viewBox={'0 0 ' + width + ' ' + height} role="img" aria-label="Daily net profit and loss over time" preserveAspectRatio="none" className="dashboard-responsive-chart w-full flex-1 min-h-0">
      {ticks.map((value, index) => {
        const y = yForValue(value);
        return <g key={value}>
          <line x1={pad.left} x2={width-pad.right} y1={y} y2={y} stroke="rgb(var(--text-tertiary))" strokeWidth="1" strokeDasharray="2 4" opacity="0.42" />
          <text x={pad.left-9} y={y+4} textAnchor="end" className={'chart-axis-label chart-y-label chart-y-label-' + index} fill="rgb(var(--text-primary))" fontSize="12">{axisLabel(value)}</text>
        </g>;
      })}
      <line x1={pad.left} x2={width-pad.right} y1={zeroY} y2={zeroY} stroke="rgb(var(--text-secondary))" strokeWidth="1.2" strokeDasharray="4 3" />
      {daily.map(([date,day],index)=>{
        const value=day.totalPL;
        const valueY=yForValue(value);
        const x=pad.left+index*gap+(gap-barWidth)/2;
        return <rect key={date} x={x} y={Math.min(zeroY,valueY)} width={barWidth} height={Math.max(1,Math.abs(zeroY-valueY))} fill={value>=0?'rgb(var(--positive))':'rgb(var(--negative))'}><title>{date}: {day.tradeCount} trades · {(value < 0 ? '-$' : '$') + Math.abs(value).toFixed(2)}</title></rect>;
      })}
      {[0,1,2,3,4,5,6].map(index=>{
        const entry=daily[Math.round(index*(daily.length-1)/6)];
        return entry?<text key={index} x={pad.left+index*chartWidth/6} y={height-8} textAnchor={index===0?'start':index===6?'end':'middle'} className={'chart-axis-label chart-x-label chart-x-label-'+index} fill="rgb(var(--text-primary))" fontSize="12">{dateLabel(entry[0])}</text>:null;
      })}
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
  let maxDay = 1;
  const simulationValues = [];
  results.paths.forEach(path => {
    maxDay = Math.max(maxDay, path.points.length);
    simulationValues.push(...path.points);
  });
  const axis = getNiceAxis(simulationValues);
  const width = 900, height = 300;
  const padding = { top: 18, right: 18, bottom: 28, left: 76 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const toX = day => padding.left + (day / Math.max(1, maxDay - 1)) * chartWidth;
  const toY = value => padding.top + ((axis.max - value) / (axis.max - axis.min)) * chartHeight;

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
            {renderAxisGrid(axis.ticks, toY, padding.left, width - padding.right)}
            <line x1={padding.left} x2={width - padding.right} y1={toY(0)} y2={toY(0)} stroke="rgb(var(--text-secondary))" strokeWidth="1.2" strokeDasharray="4 3" />
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


const TradingScoreTile = ({ trades }) => {
  const result = useMemo(() => calculateTradingScore(trades), [trades]);
  const [view, setView] = useState('radar');
  const center = { x: 190, y: 125 };
  const radius = 92;
  const polar = (value, index, scale = 1) => {
    const angle = (-Math.PI / 2) + (index * Math.PI * 2 / result.metrics.length);
    const distance = radius * scale * (value / 100);
    return { x: center.x + Math.cos(angle) * distance, y: center.y + Math.sin(angle) * distance };
  };
  const radarPoints = result.metrics.map((metric, index) => polar(metric.score, index));
  const polygon = radarPoints.map(point => point.x.toFixed(1) + ',' + point.y.toFixed(1)).join(' ');
  const labelPoints = result.metrics.map((metric,index) => {
    const p = polar(100,index,1.18);
    return { ...p, metric, anchor: p.x < center.x - 12 ? 'end' : p.x > center.x + 12 ? 'start' : 'middle' };
  });
  const scoreColor = result.score === null ? 'text-text-secondary' : result.score >= 70 ? 'text-positive' : result.score >= 45 ? 'text-warning' : 'text-negative';
  const methodology = 'RR Trading Score is an educational self-review, not a prediction or a ranking. Weights: Profit factor 25%, Avg win/loss 20%, Drawdown control 20%, Win rate 15%, Recovery factor 10%, Consistency 10%. Scoring thresholds: Win rate 30–60%; Profit factor and avg win/loss 0.5–2.5; drawdown 5–30% of highest cumulative P/L peak; recovery factor 0.5–3.0; best positive day share 20–80%. At least 20 closed trades across 5 trading days are required.';
  const insights = result.enoughData && result.weakest && result.strongest ? (
    <div className="flex flex-col gap-3 w-full max-w-3xl mx-auto">
      <div className="rounded-lg bg-bg-page p-4 min-w-0">
        <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-warning mb-1">Improvement opportunity</div>
        <div className="text-base font-semibold text-text-primary">{result.weakest.label} · {Math.round(result.weakest.score)}/100</div>
        <p className="text-sm text-text-secondary mt-2 leading-relaxed">{result.weakest.improvement}</p>
      </div>
      <div className="rounded-lg bg-bg-page p-4 min-w-0">
        <div className="text-[10px] uppercase tracking-wider text-positive mb-1">Current strength</div>
        <div className="text-base font-semibold text-text-primary">{result.strongest.label} · {Math.round(result.strongest.score)}/100</div>
        <p className="text-sm text-text-secondary mt-2 leading-relaxed">{result.strongest.explanation}</p>
      </div>
    </div>
  ) : null;
  return <Panel title={<span className="flex items-center gap-1">RR Trading Score <InfoTooltip text={methodology}/></span>}>
    <div className="flex flex-col h-full min-h-0 gap-2 overflow-hidden">
      <div className="flex items-center justify-between gap-3 shrink-0">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-text-tertiary">Your score</div>
          <div className={'text-3xl leading-none font-bold tabular-nums '+scoreColor}>{result.score === null ? '—' : result.score.toFixed(1)}</div>
        </div>
        <div className="text-right text-xs text-text-tertiary">
          <div>{result.totalTrades.toLocaleString()} trades</div>
          <div>{result.tradingDays.toLocaleString()} trading days</div>
        </div>
      </div>
      {!result.enoughData ? (
        <div className="flex-1 flex flex-col justify-center rounded-lg bg-bg-page p-4">
          <div className="text-sm font-semibold text-text-primary mb-1">Building your baseline</div>
          <p className="text-xs text-text-secondary">We need at least 20 closed trades across 5 trading days before showing a score. Your current sample has {result.totalTrades} trades across {result.tradingDays} trading days.</p>
        </div>
      ) : (
        <>
          <div className="flex justify-start shrink-0" role="group" aria-label="Trading score view">
            <div className="inline-flex items-center gap-0.5 rounded-lg bg-bg-page p-0.5">
              {['radar','insights','details'].map(option => (
                <button key={option} onClick={() => setView(option)} aria-pressed={view === option}
                  className={'rounded-md px-3 py-1 text-[11px] font-medium capitalize transition-colors '+(view === option ? 'bg-accent text-black' : 'text-text-secondary hover:text-text-primary')}>
                  {option === 'radar' ? 'Radar' : option === 'insights' ? 'Insights' : 'Details'}
                </button>
              ))}
            </div>
          </div>
          {view === 'radar' && (
            <div className="flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden">
              <svg viewBox="0 0 380 250" role="img" aria-label="Radar chart of six RR Trading Score dimensions. Metric values appear below each label; hover for more details." className="w-full h-full max-h-full" preserveAspectRatio="xMidYMid meet">
                {[20,40,60,80,100].map(level=>{
                  const pts=result.metrics.map((metric,index)=>polar(level,index));
                  return <polygon key={level} points={pts.map(p=>p.x+','+p.y).join(' ')} fill="none" stroke="rgb(var(--border))" strokeWidth="1"/>;
                })}
                {result.metrics.map((metric,index)=>{
                  const p=polar(100,index);
                  return <line key={metric.id} x1={center.x} y1={center.y} x2={p.x} y2={p.y} stroke="rgb(var(--border))" strokeWidth="1"/>;
                })}
                <polygon points={polygon} fill="rgb(var(--accent))" fillOpacity="0.22" stroke="rgb(var(--accent))" strokeWidth="2"/>
                {radarPoints.map((p,index)=>{
                  const metric=result.metrics[index];
                  return <circle key={metric.id} cx={p.x} cy={p.y} r="5" fill="rgb(var(--accent))" stroke="rgb(var(--bg-surface))" strokeWidth="1.5" className="cursor-help">
                    <title>{metric.label}: {metric.displayValue} · Score {Math.round(metric.score)}/100 · Weight {metric.weight}%&#10;{metric.explanation}</title>
                  </circle>;
                })}
                {labelPoints.map(({x,y,metric,anchor})=><text key={metric.id} x={x} y={y-2} textAnchor={anchor} fill="rgb(var(--text-secondary))" fontSize="9" className="cursor-help">
                  <title>{metric.label}: {metric.displayValue} · Score {Math.round(metric.score)}/100 · Weight {metric.weight}%&#10;{metric.explanation}</title>
                  <tspan x={x} dy="0">{metric.label}</tspan>
                  <tspan x={x} dy="12" fill="rgb(var(--text-primary))" fontSize="10" fontWeight="600">{metric.displayValue}</tspan>
                </text>)}
              </svg>
            </div>
          )}
          {view === 'insights' && (
            <div className="flex-1 min-h-0 overflow-y-auto rounded-lg bg-bg-surface p-3">
              {insights}
            </div>
          )}
          {view === 'details' && (
            <div className="flex-1 min-h-0 overflow-y-auto rounded-lg bg-bg-page px-3 py-2">
              <div className="sticky top-0 z-10 grid grid-cols-[minmax(0,1.5fr)_minmax(76px,0.8fr)_minmax(64px,0.6fr)_minmax(54px,0.5fr)] gap-x-3 border-b border-border/70 bg-bg-page py-2 text-[10px] uppercase tracking-wide text-text-tertiary">
                <span>Dimension</span><span className="text-right">Actual</span><span className="text-right">Score</span><span className="text-right">Weight</span>
              </div>
              {result.metrics.map(metric => (
                <div key={metric.id} className="grid grid-cols-[minmax(0,1.5fr)_minmax(76px,0.8fr)_minmax(64px,0.6fr)_minmax(54px,0.5fr)] gap-x-3 border-b border-border/40 py-2 last:border-0">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-text-primary">{metric.label}</div>
                    <div className="text-[10px] leading-snug text-text-tertiary mt-0.5">{metric.explanation}</div>
                  </div>
                  <span className="text-right text-xs font-semibold text-text-primary tabular-nums">{metric.displayValue}</span>
                  <span className="text-right text-xs text-text-secondary tabular-nums">{Math.round(metric.score)}/100</span>
                  <span className="text-right text-xs text-text-secondary tabular-nums">{metric.weight}%</span>
                </div>
              ))}
              <div className="pt-2 text-[10px] text-text-tertiary">Scores are weighted to form your overall RR Trading Score.</div>
            </div>
          )}
          <div className="text-[10px] text-text-tertiary shrink-0">A personal review tool, not a target to chase. Score based on the selected trades.</div>
        </>
      )}
    </div>
  </Panel>;
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
  const equityAxis = getNiceAxis(cumulative);
  const width = 900, height = 300, pad = { left: 76, right: 22, top: 24, bottom: 38 };
  const chartWidth = width - pad.left - pad.right, chartHeight = height - pad.top - pad.bottom;
  const yForEquity = value => pad.top + ((equityAxis.max - value) / (equityAxis.max - equityAxis.min)) * chartHeight;
  const points = cumulative.map((value, index) => ({
    x: pad.left + (cumulative.length <= 1 ? chartWidth / 2 : index * chartWidth / (cumulative.length - 1)),
    y: yForEquity(value),
  }));
  const path = points.map((point, index) => (index ? 'L' : 'M') + ' ' + point.x.toFixed(1) + ' ' + point.y.toFixed(1)).join(' ');
  const zeroY = yForEquity(0);
  const areaPath = points.length ? path + ' L ' + points[points.length - 1].x.toFixed(1) + ' ' + zeroY.toFixed(1) + ' L ' + points[0].x.toFixed(1) + ' ' + zeroY.toFixed(1) + ' Z' : '';
  let equityPeak = 0, maxEquityDrawdown = 0;
  cumulative.forEach(value => { equityPeak = Math.max(equityPeak, value); maxEquityDrawdown = Math.max(maxEquityDrawdown, equityPeak - value); });
  const highEquity = cumulative.length ? Math.max(...cumulative) : 0;
  const dateLabel = value => { const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { month: '2-digit', day: '2-digit', year: '2-digit' }); };
  return [
    tile('tradingScore', () => <TradingScoreTile trades={trades} />),
    tile('dailyNetPL', () => <DailyNetPLTile trades={trades} />),
    tile('equityCurve', () => <Panel title={<span className="flex items-center gap-2">Equity Curve <InfoTooltip text="Cumulative net trade P/L in exit-time order. The area is shaded around zero. Maximum drawdown measures the largest decline from a previous cumulative P/L peak." /></span>}>
      {trades.length ? <div className="dashboard-equity-layout flex flex-1 min-h-0 min-w-0 gap-3">
        <div className="dashboard-equity-summary flex shrink-0 flex-col justify-center gap-2 w-28">
          {[['Total P/L', '$'+running.toFixed(2), running>=0],['Highest equity', '$'+highEquity.toFixed(2), true],['Max drawdown', '$'+maxEquityDrawdown.toFixed(2), false],['Trades', String(trades.length), true]].map(([label,value,positive])=><div key={label} className="min-w-0 rounded bg-bg-page px-2 py-2"><div className="text-[9px] uppercase text-text-tertiary">{label}</div><div className={'text-xs font-semibold truncate '+(label==='Trades'?'text-text-primary':positive?'text-positive':'text-negative')}>{value}</div></div>)}
        </div>
        <div className="dashboard-equity-chart flex-1 min-h-0 min-w-0 overflow-hidden">
          <svg viewBox={'0 0 ' + width + ' ' + height} role="img" aria-label="Cumulative profit and loss with dates and zero reference" preserveAspectRatio="none" className="dashboard-responsive-chart dashboard-equity-responsive-chart w-full h-full min-h-0">
            <defs><linearGradient id="equity-area-gradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="rgb(var(--positive))" stopOpacity="0.24"/><stop offset={((zeroY / height) * 100) + '%'} stopColor="rgb(var(--positive))" stopOpacity="0.03"/><stop offset={((zeroY / height) * 100) + '%'} stopColor="rgb(var(--negative))" stopOpacity="0.03"/><stop offset="100%" stopColor="rgb(var(--negative))" stopOpacity="0.24"/></linearGradient></defs>
            {renderAxisGrid(equityAxis.ticks, yForEquity, pad.left, width - pad.right)}
            <line x1={pad.left} x2={width-pad.right} y1={zeroY} y2={zeroY} stroke="rgb(var(--text-secondary))" strokeDasharray="4 4"/>
            {areaPath && <path d={areaPath} fill="url(#equity-area-gradient)"/>}
            {points.length>1 && <path d={path} fill="none" stroke={running>=0?'rgb(var(--positive))':'rgb(var(--negative))'} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>}
            {[0,1,2,3,4,5,6].map(index=>{const pointIndex=Math.round(index*(sorted.length-1)/6); const isFirst=index===0, isLast=index===6; return sorted[pointIndex] ? <text key={index} x={pad.left+index*chartWidth/6} y={height-8} textAnchor={isFirst?'start':isLast?'end':'middle'} className={`chart-axis-label chart-x-label chart-x-label-${index}` } fill="rgb(var(--text-primary))" fontSize="12">{dateLabel(sorted[pointIndex].exitTime)}</text> : null;})}
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
