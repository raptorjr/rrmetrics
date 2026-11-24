const React = require('react');
const { useState } = React;

const candidates = [
  {
    id: 'lightweight',
    name: 'TradingView Lightweight Charts',
    role: 'Current engine · baseline',
    status: 'Installed',
    statusTone: 'success',
    description: 'The chart engine currently used by RR Metrics. This is our reference for rendering quality, replay updates, zooming and viewport behaviour.',
    strengths: ['Already integrated with replay', 'Fast candlestick rendering', 'Small footprint'],
    tradeoffs: ['Drawing tools need implementation', 'Indicators are calculated and rendered by RR Metrics'],
    url: 'https://tradingview.github.io/lightweight-charts/',
    urlLabel: 'Documentation',
  },
  {
    id: 'kline',
    name: 'KLineChart',
    role: 'Candidate 1',
    status: 'Not integrated',
    statusTone: 'neutral',
    description: 'An open-source financial chart with built-in technical indicators and drawing overlays. First candidate for a practical integration test.',
    strengths: ['Built-in indicators', 'Drawing and annotation overlays', 'Apache 2.0 licence'],
    tradeoffs: ['Replay update behaviour needs testing', 'Independent multi-chart behaviour needs validation'],
    url: 'https://klinecharts.com/',
    urlLabel: 'Documentation',
  },
  {
    id: 'tradecanvas',
    name: 'TradeCanvas',
    role: 'Candidate 2',
    status: 'Not integrated',
    statusTone: 'neutral',
    description: 'A more complete trading chart offering a full widget or a lower-level chart API, with indicators, drawing tools and linked charts.',
    strengths: ['Large indicator and drawing-tool catalogue', 'Headless API for custom interfaces', 'MIT licence'],
    tradeoffs: ['Newer project; maturity and API stability need evaluation', 'Replay and custom data-feed integration must be proven'],
    url: 'https://tradecanvas.dev/docs/getting-started/',
    urlLabel: 'Documentation',
  },
];

const ChartEngineLab = () => {
  const [selected, setSelected] = useState('lightweight');
  const active = candidates.find(candidate => candidate.id === selected) || candidates[0];

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-bg-surface p-4 space-y-3">
        <div>
          <h2 className="text-text-primary font-semibold">Test candidates</h2>
          <p className="text-text-muted text-xs mt-1">Switch between engines here. The existing Chart Replay view remains unchanged and is always available as the baseline.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2" role="tablist" aria-label="Chart engine candidates">
          {candidates.map(candidate => (
            <button
              key={candidate.id}
              type="button"
              role="tab"
              aria-selected={selected === candidate.id}
              onClick={() => setSelected(candidate.id)}
              className={'rounded-lg border px-3 py-3 text-left transition-colors ' + (selected === candidate.id ? 'border-accent bg-accent/10' : 'border-border bg-bg-input hover:border-text-muted')}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-text-primary">{candidate.name}</span>
                <span className={'text-[10px] rounded-full px-2 py-0.5 ' + (candidate.statusTone === 'success' ? 'bg-positive/10 text-positive' : 'bg-bg-page text-text-muted')}>{candidate.status}</span>
              </div>
              <div className="text-[10px] text-text-muted mt-1">{candidate.role}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-bg-surface p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">{active.role}</div>
            <h2 className="text-text-primary text-lg font-semibold mt-1">{active.name}</h2>
          </div>
          <a href={active.url} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline">{active.urlLabel} ↗</a>
        </div>
        <p className="text-sm text-text-secondary">{active.description}</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-lg bg-bg-page border border-border p-3">
            <h3 className="text-xs font-semibold text-text-primary mb-2">Strengths to evaluate</h3>
            <ul className="space-y-1.5">{active.strengths.map(item => <li key={item} className="text-xs text-text-secondary flex gap-2"><span className="text-positive">+</span>{item}</li>)}</ul>
          </div>
          <div className="rounded-lg bg-bg-page border border-border p-3">
            <h3 className="text-xs font-semibold text-text-primary mb-2">Risks / questions</h3>
            <ul className="space-y-1.5">{active.tradeoffs.map(item => <li key={item} className="text-xs text-text-secondary flex gap-2"><span className="text-warning">•</span>{item}</li>)}</ul>
          </div>
        </div>
        {active.id === 'lightweight' ? (
          <div className="rounded-lg border border-positive/30 bg-positive/5 px-4 py-3 text-xs text-text-secondary">
            This is the live engine used by Chart Replay. Use the Chart Replay tab to compare its actual behaviour against the candidate integrations.
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-bg-page px-4 py-3 space-y-1">
            <div className="text-sm font-medium text-text-primary">Integration test not started</div>
            <p className="text-xs text-text-muted">This candidate is listed for evaluation, but is not yet loaded into RR Metrics. The next step is to add it behind this view and feed it the same historical candles as the existing replay chart.</p>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-border bg-bg-surface p-4">
        <h3 className="text-sm font-semibold text-text-primary mb-2">Comparison checklist</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {['Candlestick rendering and price precision', 'Progressive replay without future candles', 'Zoom and scroll remain stable during playback', 'Independent timeframes and multiple charts', 'Drawing tools and editable annotations', 'Indicators and configurable parameters', 'Persist layouts and chart settings', 'Bundle size, memory and rendering performance', 'Licence and long-term maintenance'].map(item => (
            <div key={item} className="text-xs text-text-secondary flex gap-2"><span className="text-text-muted">□</span>{item}</div>
          ))}
        </div>
      </div>
    </div>
  );
};

module.exports = ChartEngineLab;
