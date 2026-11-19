const React = require('react');
const { getTradePL } = require('../../utils/analytics');
const { toEST } = require('../../utils/dateUtils');

const DEFINITIONS = [
  { id: 'equityCurve', label: 'Equity Curve', category: 'Charts', minColumns: 2, minRows: 2, defaultColumns: 2, defaultRows: 2 },
  { id: 'performanceByDay', label: 'Performance by Day', category: 'Charts', minColumns: 2, minRows: 2, defaultColumns: 2, defaultRows: 2 },
];

const Panel = ({ title, children }) => <div className="h-full min-h-[260px] bg-bg-surface border border-border rounded-xl p-5"><h3 className="text-text-primary font-semibold mb-4">{title}</h3>{children}</div>;
const Preview = ({ item }) => <div className="h-[82px] rounded-md border border-border bg-bg-page p-2 flex flex-col justify-between"><span className="text-[10px] font-semibold text-text-secondary">{item.label}</span><div className="flex items-end gap-1 h-10"><i className="h-3 flex-1 rounded-sm bg-positive/40" /><i className="h-6 flex-1 rounded-sm bg-positive/50" /><i className="h-4 flex-1 rounded-sm bg-negative/50" /><i className="h-8 flex-1 rounded-sm bg-positive/70" /><i className="h-10 flex-1 rounded-sm bg-positive" /></div></div>;

const createAnalyticsChartTiles = (trades = []) => {
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
  const path = points.map((point, index) => `${index ? 'L' : 'M'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dayValues = Array(7).fill(0);
  trades.forEach(trade => { const est = toEST(trade.exitTime); const day = new Date(est.year, est.month - 1, est.day).getDay(); dayValues[day] += getTradePL(trade); });
  const dayMax = Math.max(1, ...dayValues.map(Math.abs));
  const zeroY = 105;
  return [
    tile('equityCurve', () => <Panel title="Equity Curve">
      {trades.length ? <div className="w-full overflow-hidden"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Cumulative profit and loss chart" className="w-full h-auto">
        {[0, 1, 2, 3, 4].map(index => <line key={index} x1={pad} x2={width - pad} y1={pad + index * (height - pad * 2) / 4} y2={pad + index * (height - pad * 2) / 4} stroke="var(--border)" strokeWidth="1" />)}
        {min < 0 && max > 0 && <line x1={pad} x2={width - pad} y1={pad + (max / range) * (height - pad * 2)} y2={pad + (max / range) * (height - pad * 2)} stroke="var(--text-muted)" strokeDasharray="4 4" />}
        {points.length > 1 && <path d={path} fill="none" stroke={cumulative[cumulative.length - 1] >= 0 ? 'var(--positive)' : 'var(--negative)'} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />}
      </svg></div> : <p className="text-sm text-text-tertiary">No trades available</p>}
      <div className={`text-right text-sm font-semibold ${running >= 0 ? 'text-positive' : 'text-negative'}`}>{running >= 0 ? '+' : ''}${running.toFixed(2)} total P/L</div>
    </Panel>),
    tile('performanceByDay', () => <Panel title="Performance by Day">
      <div className="flex items-center justify-between text-[10px] text-text-tertiary mb-2"><span>Loss</span><span>Profit</span></div>
      <svg viewBox="0 0 640 230" role="img" aria-label="Profit and loss by weekday" className="w-full h-auto">
        <line x1="24" x2="616" y1={zeroY} y2={zeroY} stroke="var(--border)" strokeDasharray="4 4" />
        {dayValues.map((value, index) => { const barHeight = Math.abs(value) / dayMax * 78; const x = 48 + index * 84; return <g key={dayNames[index]}><rect x={x} y={value >= 0 ? zeroY - barHeight : zeroY} width="42" height={Math.max(1, barHeight)} rx="4" fill={value >= 0 ? 'var(--positive)' : 'var(--negative)'} opacity="0.85" /><text x={x + 21} y="205" textAnchor="middle" fill="var(--text-tertiary)" fontSize="12">{dayNames[index]}</text><text x={x + 21} y={value >= 0 ? zeroY - barHeight - 7 : zeroY + barHeight + 15} textAnchor="middle" fill="var(--text-secondary)" fontSize="10">{value === 0 ? '' : Math.round(value)}</text></g>; })}
      </svg>
      <p className="text-[11px] text-text-tertiary text-right">Total P/L by exit weekday</p>
    </Panel>),
  ];
};

module.exports = { ANALYTICS_CHART_TILE_DEFINITIONS: DEFINITIONS, createAnalyticsChartTiles };
