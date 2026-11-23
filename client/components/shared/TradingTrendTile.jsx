const React = require('react');
const { useState } = React;
const InfoTooltip = require('./InfoTooltip');

const SAMPLE_METRICS = [
  { label: 'Expectancy', previous: '0.42R', recent: '0.56R', change: '+33%', direction: 'up', width: 72 },
  { label: 'Profit factor', previous: '1.38', recent: '1.61', change: '+0.23', direction: 'up', width: 68 },
  { label: 'Average win', previous: '1.12R', recent: '1.24R', change: '+11%', direction: 'up', width: 78 },
  { label: 'Average loss', previous: '0.81R', recent: '0.77R', change: '−5%', direction: 'down-good', width: 62 },
];

const TradingTrendTile = () => {
  const [view, setView] = useState('financial');
  const [showDetails, setShowDetails] = useState(false);

  return (
    <div className="dashboard-tile-panel h-full min-h-0 min-w-0 overflow-hidden flex flex-col bg-bg-surface border border-border rounded-xl p-3 md:p-4">
      <div className="shrink-0 flex items-center justify-between gap-2 mb-2">
        <h3 className="min-w-0 flex items-center gap-1 text-text-primary font-semibold text-sm">
          Trading Trend
          <InfoTooltip text="Compares normalized trading performance across two recent samples. Contract size should not make a period look better by itself. The calculations and sample rules are still being refined; this is a visual design preview." />
        </h3>
        <span className="shrink-0 rounded-md border border-border bg-bg-page px-2 py-1 text-[9px] font-medium uppercase tracking-wide text-text-tertiary">Design preview</span>
      </div>

      <div className="flex flex-col h-full min-h-0 gap-2 overflow-hidden">
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
            <div className="shrink-0 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-bg-page px-3 py-2">
              <div>
                <div className="text-[10px] uppercase tracking-wide text-text-tertiary">Overall trend</div>
                <div className="text-lg leading-tight font-bold text-positive">Improving</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] text-text-tertiary">Comparison sample</div>
                <div className="text-xs font-semibold text-text-primary tabular-nums">38 vs 38 trades</div>
                <div className="text-[10px] text-text-secondary">About 4 active days each</div>
              </div>
            </div>

            <div className="shrink-0 flex items-center justify-between gap-2 text-[10px] text-text-tertiary">
              <span>Normalized results · equal weight per active day</span>
              <span className="tabular-nums">Illustrative values</span>
            </div>

            <div className="flex-1 min-h-0 min-w-0 overflow-y-auto">
              <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-x-3 border-b border-border/70 px-1 py-2 text-[9px] uppercase tracking-wide text-text-tertiary">
                <span>Metric</span><span className="text-right">Previous</span><span className="text-right">Recent</span><span className="text-right">Change</span>
              </div>
              {SAMPLE_METRICS.map(metric => (
                <div key={metric.label} className="border-b border-border/40 px-1 py-2 last:border-0">
                  <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-x-3">
                    <span className="min-w-0 text-xs font-medium text-text-primary">{metric.label}</span>
                    <span className="text-right text-[11px] text-text-secondary tabular-nums">{metric.previous}</span>
                    <span className="text-right text-[11px] font-semibold text-text-primary tabular-nums">{metric.recent}</span>
                    <span className={'text-right text-[11px] font-semibold tabular-nums ' + (metric.direction === 'down-good' ? 'text-positive' : 'text-positive')}>{metric.change}</span>
                  </div>
                  <div className="mt-1.5 ml-0 grid grid-cols-2 gap-2">
                    <div className="h-1 rounded-full bg-bg-input overflow-hidden"><div className="h-full rounded-full bg-text-tertiary/60" style={{ width: '58%' }} /></div>
                    <div className="h-1 rounded-full bg-bg-input overflow-hidden"><div className="h-full rounded-full bg-positive" style={{ width: metric.width + '%' }} /></div>
                  </div>
                </div>
              ))}
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <button type="button" onClick={() => setShowDetails(value => !value)} className="text-[11px] text-text-secondary underline hover:text-text-primary">
                  {showDetails ? 'Hide methodology' : 'How is this calculated?'}
                </button>
                <span className="text-[10px] text-text-tertiary">Sample UI only — not live calculations</span>
              </div>
              {showDetails && (
                <div className="mt-2 rounded-lg bg-bg-page p-3 text-[10px] leading-relaxed text-text-secondary">
                  The sample size is estimated from the average number of trades over the latest four active days. Zero-trade days are excluded. Each comparison period uses complete trading days, and each active day receives equal weight so a high-volume scalping day cannot dominate. Final normalization, minimum sample and trend thresholds are still to be validated against real trade data.
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

module.exports = TradingTrendTile;
