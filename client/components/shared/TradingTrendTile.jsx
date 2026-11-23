const React = require('react');
const { useState } = React;
const InfoTooltip = require('./InfoTooltip');

const SAMPLE_METRICS = [
  { label: 'Expectancy', previous: '0.42R', recent: '0.56R', change: '+33%', direction: 'positive' },
  { label: 'Profit factor', previous: '1.38', recent: '1.61', change: '+0.23', direction: 'positive' },
  { label: 'Average win', previous: '1.12R', recent: '1.24R', change: '+11%', direction: 'positive' },
  { label: 'Average loss', previous: '0.81R', recent: '0.77R', change: '−5%', direction: 'positive' },
];

const METHODOLOGY = [
  'Trading Trend compares recent financial performance using normalized results, so increasing contract size alone does not make a period look better.',
  '',
  'The comparison sample is sized from the average number of trades across the latest 3–4 active trading days. Days with no trades are excluded from that frequency estimate. The comparison uses complete active days, with each day receiving equal weight so unusually busy days cannot dominate.',
  '',
  'Candidate measures include expectancy, profit factor, average win/loss and drawdown. Win rate is supporting context, not a standalone measure of improvement.',
  '',
  'The minimum sample size, exact normalization method (including cross-instrument comparability), treatment of low-volume days and neutral trend thresholds are still being refined. If the evidence is insufficient, the tile should say so rather than force a trend classification.',
  '',
  'Trading Quality is a separate future view. It will require structured plan and execution data; it must not be inferred from financial results.',
];

const TradingTrendTile = () => {
  const [view, setView] = useState('financial');

  return (
    <div className="dashboard-tile-panel h-full min-h-0 min-w-0 overflow-hidden flex flex-col bg-bg-surface border border-border rounded-xl p-3 md:p-4">
      <div className="shrink-0 flex items-center justify-between gap-2 mb-2">
        <h3 className="min-w-0 flex items-center gap-1 text-text-primary font-semibold text-sm">
          Trading Trend
          <InfoTooltip text={METHODOLOGY.join('\n')} />
        </h3>
        <span className="shrink-0 text-[9px] uppercase tracking-wide text-text-tertiary">Illustrative preview</span>
      </div>

      <div className="flex flex-col h-full min-h-0 gap-3 overflow-hidden">
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
                <div className="text-[10px] uppercase tracking-wide text-text-tertiary">Overall trend</div>
                <div className="text-xl leading-tight font-bold text-positive">Improving</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] text-text-tertiary">Recent vs previous</div>
                <div className="text-sm font-semibold text-text-primary tabular-nums">38 vs 38 trades</div>
                <div className="text-[10px] text-text-secondary">Approximately 4 active days per period</div>
              </div>
            </div>

            <div className="grid grid-cols-2 xl:grid-cols-4 gap-2 min-h-0">
              {SAMPLE_METRICS.map(metric => (
                <div key={metric.label} className="min-w-0 rounded-lg bg-bg-page px-3 py-2.5">
                  <div className="text-[10px] text-text-secondary truncate">{metric.label}</div>
                  <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="text-base font-semibold text-text-primary tabular-nums">{metric.recent}</span>
                    <span className="text-[11px] font-semibold text-positive tabular-nums">{metric.change}</span>
                  </div>
                  <div className="mt-1 text-[10px] text-text-tertiary tabular-nums">Previous {metric.previous}</div>
                </div>
              ))}
            </div>

            <div className="shrink-0 flex items-center justify-between gap-2 text-[10px] text-text-tertiary">
              <span>Normalized results · equal weight per active day</span>
              <span className="tabular-nums">Sample values only</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

module.exports = TradingTrendTile;
