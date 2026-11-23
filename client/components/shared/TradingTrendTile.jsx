const React = require('react');
const { useMemo, useState } = React;
const InfoTooltip = require('./InfoTooltip');
const { getTradePL } = require('../../utils/analytics');
const { toEST } = require('../../utils/dateUtils');

const MIN_PERIOD_TRADES = 30;
const COMPARISON_ACTIVE_DAYS = 8;
const DAILY_WEIGHT_CAP = 5;

const METHODOLOGY = [
  'Trading Trend compares normalized trading performance using P/L per unit (trade P/L divided by absolute position quantity). This removes the direct effect of trading more contracts, but dollar-per-unit results are not automatically comparable across different instruments.',
  '',
  'The comparison uses two consecutive windows of eight active trading days: the eight most recent active days and the eight active days immediately before them. Each period must contain at least 30 trades.',
  '',
  'Daily results use capped weighting: each active day receives a weight equal to its trade count, capped at five. This gives a one-trade day less influence while preventing very busy days from dominating. Metrics shown are weighted daily expectancy, profit factor, average win and average loss.',
  '',
  'Cross-instrument normalization, minimum-data safeguards and neutral thresholds for an overall Improving/Stable/Declining classification still need validation. Until those are settled, the tile shows the measured comparison but does not claim an overall trend direction.',
  '',
  'Trading Quality is a separate future view and must not be inferred from financial results.',
];

const getDayKey = trade => {
  const date = toEST(trade.exitTime);
  return date.year + '-' + String(date.month).padStart(2, '0') + '-' + String(date.day).padStart(2, '0');
};

const getNormalizedPL = trade => {
  const quantity = Math.abs(Number(trade.quantity));
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  return getTradePL(trade) / quantity;
};

const getPeriodMetrics = days => {
  if (!days.length) return null;
  const daily = days.map(day => {
    const values = day.trades.map(getNormalizedPL).filter(value => value !== null && Number.isFinite(value));
    const wins = values.filter(value => value > 0);
    const losses = values.filter(value => value < 0);
    return {
      weight: Math.min(values.length, DAILY_WEIGHT_CAP),
      expectancy: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
      grossWins: wins.reduce((sum, value) => sum + value, 0),
      grossLosses: losses.reduce((sum, value) => sum + Math.abs(value), 0),
      avgWin: wins.length ? wins.reduce((sum, value) => sum + value, 0) / wins.length : null,
      avgLoss: losses.length ? losses.reduce((sum, value) => sum + value, 0) / losses.length : null,
    };
  }).filter(day => day.expectancy !== null && day.weight > 0);

  if (!daily.length) return null;
  const weightedMean = key => {
    const values = daily.filter(day => day[key] !== null && Number.isFinite(day[key]));
    const totalWeight = values.reduce((sum, day) => sum + day.weight, 0);
    return totalWeight ? values.reduce((sum, day) => sum + day[key] * day.weight, 0) / totalWeight : null;
  };
  const grossWins = daily.reduce((sum, day) => sum + day.grossWins * day.weight, 0);
  const grossLosses = daily.reduce((sum, day) => sum + day.grossLosses * day.weight, 0);
  const averageLoss = weightedMean('avgLoss');
  return {
    expectancy: weightedMean('expectancy'),
    profitFactor: grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : null,
    avgWin: weightedMean('avgWin'),
    avgLoss: averageLoss === null ? null : Math.abs(averageLoss),
    tradeCount: days.reduce((sum, day) => sum + day.trades.length, 0),
    dayCount: days.length,
  };
};

const takeActiveDayWindow = (days, endIndex, windowSize) => {
  const startIndex = endIndex - windowSize + 1;
  return startIndex >= 0 ? days.slice(startIndex, endIndex + 1) : [];
};

const formatValue = (value, suffix = '') => {
  if (value === null || value === undefined || !Number.isFinite(value)) return value === Infinity ? '∞' : '—';
  return (value < 0 ? '−' : '') + Math.abs(value).toFixed(2) + suffix;
};

const formatChange = (recent, previous, lowerIsBetter = false) => {
  if (recent === null || previous === null || !Number.isFinite(recent) || !Number.isFinite(previous)) return '—';
  const delta = recent - previous;
  const percent = Math.abs(previous) > 0.000001 ? (delta / Math.abs(previous)) * 100 : null;
  const improved = lowerIsBetter ? delta < 0 : delta > 0;
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : '';
  const crossedZero = recent * previous < 0;
  // Large relative changes are unstable when the previous value is near zero.
  // Show the absolute delta instead once the relative change reaches 100%.
  const useAbsoluteDelta = percent === null || crossedZero || Math.abs(percent) >= 100;
  const text = useAbsoluteDelta
    ? sign + Math.abs(delta).toFixed(2)
    : sign + Math.abs(percent).toFixed(0) + '%';
  return { text, improved, neutral: Math.abs(delta) < 0.000001 };
};

const TradingTrendTile = ({ trades = [] }) => {
  const [view, setView] = useState('financial');
  const result = useMemo(() => {
    const byDate = new Map();
    (trades || []).forEach(trade => {
      const normalizedPL = getNormalizedPL(trade);
      if (normalizedPL === null || !Number.isFinite(normalizedPL)) return;
      const key = getDayKey(trade);
      if (!byDate.has(key)) byDate.set(key, { key, trades: [] });
      byDate.get(key).trades.push(trade);
    });
    const days = Array.from(byDate.values()).sort((a, b) => a.key.localeCompare(b.key));
    const recentDays = takeActiveDayWindow(days, days.length - 1, COMPARISON_ACTIVE_DAYS);
    const previousDays = takeActiveDayWindow(days, days.length - COMPARISON_ACTIVE_DAYS - 1, COMPARISON_ACTIVE_DAYS);
    const recent = { days: recentDays, count: recentDays.reduce((sum, day) => sum + day.trades.length, 0) };
    const previous = { days: previousDays, count: previousDays.reduce((sum, day) => sum + day.trades.length, 0) };
    const enoughData = recent.days.length === COMPARISON_ACTIVE_DAYS
      && previous.days.length === COMPARISON_ACTIVE_DAYS
      && recent.count >= MIN_PERIOD_TRADES && previous.count >= MIN_PERIOD_TRADES;
    const recentMetrics = enoughData ? getPeriodMetrics(recent.days) : null;
    const previousMetrics = enoughData ? getPeriodMetrics(previous.days) : null;
    return {
      enoughData, daysAvailable: days.length, recent, previous, recentMetrics, previousMetrics,
    };
  }, [trades]);

  const metricRows = result.enoughData ? [
    { label: 'Expectancy / unit', key: 'expectancy', suffix: '', lowerIsBetter: false },
    { label: 'Profit factor', key: 'profitFactor', suffix: '', lowerIsBetter: false },
    { label: 'Average win / unit', key: 'avgWin', suffix: '', lowerIsBetter: false },
    { label: 'Average loss / unit', key: 'avgLoss', suffix: '', lowerIsBetter: true },
  ].map(metric => {
    const previous = result.previousMetrics[metric.key];
    const recent = result.recentMetrics[metric.key];
    return { ...metric, previous, recent, change: formatChange(recent, previous, metric.lowerIsBetter) };
  }) : [];

  return (
    <div className="dashboard-tile-panel h-full min-h-0 min-w-0 overflow-hidden flex flex-col bg-bg-surface border border-border rounded-xl p-3 md:p-4">
      <div className="shrink-0 flex items-center justify-between gap-2 mb-2">
        <h3 className="min-w-0 flex items-center gap-1 text-text-primary font-semibold text-sm">
          Trading Trend
          <InfoTooltip text={METHODOLOGY.join('\\n')} />
        </h3>
        <span className="shrink-0 text-[9px] uppercase tracking-wide text-text-tertiary">Live comparison</span>
      </div>

      <div className="flex flex-col flex-1 min-h-0 gap-3 overflow-hidden">
        <div className="flex justify-start shrink-0" role="group" aria-label="Trading trend view">
          <div className="inline-flex items-center gap-0.5 rounded-lg bg-bg-page p-0.5">
            <button type="button" onClick={() => setView('financial')} aria-pressed={view === 'financial'}
              className={'rounded-md px-3 py-1 text-[11px] font-medium transition-colors ' + (view === 'financial' ? 'bg-accent text-accent-text' : 'text-text-secondary hover:text-text-primary')}>
              Financial Performance
            </button>
            <button type="button" disabled aria-disabled="true" title="Planned for a future release"
              className="rounded-md px-3 py-1 text-[11px] font-medium text-text-tertiary opacity-50 cursor-not-allowed">
              Trading Quality · Later
            </button>
          </div>
        </div>

        {view === 'financial' && (
          <>
            <div className="shrink-0 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-wide text-text-tertiary">Trend assessment</div>
                <div className="text-lg leading-tight font-bold text-text-primary">{result.enoughData ? 'Not classified yet' : 'Building baseline'}</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] text-text-tertiary">Recent vs previous</div>
                <div className="text-sm font-semibold text-text-primary tabular-nums">
                  {result.enoughData ? result.recent.count + ' vs ' + result.previous.count + ' trades' : 'Insufficient sample'}
                </div>
                <div className="text-[10px] text-text-secondary">
                  {result.enoughData ? result.recent.days.length + ' vs ' + result.previous.days.length + ' active days' : 'Need 8 active days and 30 trades per period'}
                </div>
              </div>
            </div>

            {result.enoughData ? (
              <>
                <div
                  className="flex-1 min-h-0 grid gap-2 auto-rows-fr overflow-hidden"
                  style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))' }}
                >
                  {metricRows.map(metric => (
                    <div key={metric.key} className="min-w-0 rounded-lg bg-bg-page px-3 py-2.5 flex flex-col justify-between">
                      <div className="text-[10px] text-text-secondary">{metric.label}</div>
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 mt-1">
                        <span className={'text-lg leading-tight font-bold tabular-nums ' + (metric.change && metric.change.improved ? 'text-positive' : metric.change && !metric.change.neutral ? 'text-negative' : 'text-text-secondary')}>
                          {metric.change && metric.change.text}
                        </span>
                        <span className="text-xs font-medium text-text-primary tabular-nums">{formatValue(metric.recent, metric.suffix)}</span>
                      </div>
                      <div className="text-[10px] text-text-tertiary tabular-nums mt-1">Previous {formatValue(metric.previous, metric.suffix)}</div>
                    </div>
                  ))}
                </div>
                <div className="shrink-0 text-[10px] text-text-tertiary">
                  Per-unit results · daily weight capped at 5 trades
                </div>
              </>
            ) : (
              <div className="flex-1 min-h-0 flex flex-col justify-center rounded-lg bg-bg-page p-4">
                <div className="text-sm font-semibold text-text-primary mb-1">Not enough history yet</div>
                <p className="text-xs text-text-secondary">
                  {result.daysAvailable} active days available. The method needs two complete comparison windows of {COMPARISON_ACTIVE_DAYS} active days each, with at least {MIN_PERIOD_TRADES} trades in each period.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

module.exports = TradingTrendTile;
