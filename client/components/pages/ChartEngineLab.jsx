const React = require('react');
const { useEffect, useMemo, useRef, useState } = React;
const { authFetch } = require('../../helper.js');
const { normalizeOhlcvRows } = require('../../utils/backtestingReplay');
const { getAvailableMarkets, aggregateCandles, timeframeSeconds } = require('../../utils/historicalReplay');

const periodForKLine = timeframe => {
  const match = /^(\\d+)(s|m|h|d)$/.exec(String(timeframe || ''));
  if (!match) return { span: 1, type: 'minute' };
  return { span: Number(match[1]), type: ({ s: 'second', m: 'minute', h: 'hour', d: 'day' })[match[2]] };
};

const KLineChartPanel = ({ candles, ticker, timeframe }) => {
  const hostRef = useRef(null);
  const chartRef = useRef(null);
  const [chartError, setChartError] = useState('');

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !candles.length) return undefined;
    let chart;
    let disposed = false;
    let resizeObserver;
    setChartError('');
    try {
      const { init, dispose } = require('klinecharts');
      chart = init(host, { styles: 'dark', timezone: 'America/New_York' });
      if (!chart) throw new Error('KLineChart could not initialise its canvas.');
      chartRef.current = chart;
      chart.setSymbol({ ticker, pricePrecision: 2, volumePrecision: 0 });
      chart.setPeriod(periodForKLine(timeframe));
      const bars = candles.map(bar => ({
        timestamp: bar.time * 1000,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: Number(bar.volume || 0),
      }));
      chart.setDataLoader({
        getBars: ({ callback }) => callback(bars, { forward: false, backward: false }),
      });
      try { chart.createIndicator('MA'); } catch (indicatorError) { console.warn('KLineChart MA indicator unavailable', indicatorError); }
      resizeObserver = typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => { if (!disposed) chart.resize(); })
        : null;
      if (resizeObserver) resizeObserver.observe(host);
    } catch (error) {
      setChartError(error.message || 'KLineChart failed to initialise.');
    }
    return () => {
      disposed = true;
      if (resizeObserver) resizeObserver.disconnect();
      if (chart) dispose(host);
      chartRef.current = null;
    };
  }, [candles, ticker, timeframe]);

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="px-3 py-2 border-b border-border flex items-center justify-between">
        <span className="text-xs font-semibold text-text-primary">KLineChart · v10</span>
        <span className="text-[10px] text-text-muted">{candles.length.toLocaleString()} bars</span>
      </div>
      {chartError ? <div className="p-4 text-sm text-negative">{chartError}</div> : <div ref={hostRef} className="w-full" style={{ height: 480 }} />}
    </div>
  );
};

const TradeCanvasPanel = ({ candles, ticker, timeframe }) => {
  const hostRef = useRef(null);
  const [chartError, setChartError] = useState('');

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !candles.length) return undefined;
    let widget;
    setChartError('');
    try {
      const { ChartWidget } = require('@tradecanvas/chart/widget');
      widget = new ChartWidget(host, {
        symbol: ticker,
        timeframe,
        theme: 'dark',
        historyLimit: Math.max(500, candles.length),
        persistLayouts: false,
        persistSettings: false,
        trading: false,
      });
      widget.getChart().setData(candles.map(bar => ({
        time: bar.time * 1000,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: Number(bar.volume || 0),
      })));
      widget.getChart().setDataTimeframe(timeframe);
      try { widget.getChart().addIndicator('sma', { period: 20 }); } catch (indicatorError) { console.warn('TradeCanvas SMA indicator unavailable', indicatorError); }
    } catch (error) {
      setChartError(error.message || 'TradeCanvas failed to initialise.');
    }
    return () => {
      if (widget) widget.destroy();
    };
  }, [candles, ticker, timeframe]);

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="px-3 py-2 border-b border-border flex items-center justify-between">
        <span className="text-xs font-semibold text-text-primary">TradeCanvas · headless-backed widget</span>
        <span className="text-[10px] text-text-muted">{candles.length.toLocaleString()} bars</span>
      </div>
      {chartError ? <div className="p-4 text-sm text-negative">{chartError}</div> : <div ref={hostRef} className="w-full" style={{ height: 540 }} />}
    </div>
  );
};

const ChartEngineLab = () => {
  const [datasets, setDatasets] = useState([]);
  const [marketKey, setMarketKey] = useState('');
  const [timeframe, setTimeframe] = useState('');
  const [candles, setCandles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeEngine, setActiveEngine] = useState('kline');

  const markets = useMemo(() => getAvailableMarkets(datasets), [datasets]);
  const market = markets.find(item => item.key === marketKey) || markets[0] || null;
  const timeframes = market?.availableTimeframes || [];

  useEffect(() => {
    let cancelled = false;
    authFetch('/api/market-data/datasets')
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Unable to load historical market-data catalogue.');
        if (!cancelled) {
          const nextDatasets = data.datasets || [];
          setDatasets(nextDatasets);
          const nextMarkets = getAvailableMarkets(nextDatasets);
          if (nextMarkets.length) {
            setMarketKey(nextMarkets[0].key);
            setTimeframe(nextMarkets[0].availableTimeframes[0] || nextMarkets[0].baseTimeframe);
          }
        }
      })
      .catch(loadError => { if (!cancelled) setError(loadError.message || 'Unable to load market data.'); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!market || !timeframe) return undefined;
    const coverage = market.coverage[0];
    if (!coverage) return undefined;
    let cancelled = false;
    setLoading(true);
    setError('');
    const params = new URLSearchParams({
      start: new Date(coverage.start).toISOString(),
      end: new Date(coverage.end).toISOString(),
      instrument: market.instrument,
      timeframe: market.baseTimeframe,
    });
    params.set('sourceSymbol', market.sourceSymbol || '__none__');
    authFetch('/api/market-data/query?' + params.toString())
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Unable to query historical market data.');
        if (cancelled) return;
        const baseBars = normalizeOhlcvRows(data.bars || []);
        const selectedBars = timeframe === market.baseTimeframe ? baseBars : aggregateCandles(baseBars, timeframe);
        if (!selectedBars.length) throw new Error('No candles were returned for this market and timeframe.');
        setCandles(selectedBars);
      })
      .catch(loadError => { if (!cancelled) { setCandles([]); setError(loadError.message || 'Unable to prepare chart data.'); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [marketKey, timeframe, datasets.length]);

  const changeMarket = nextKey => {
    const nextMarket = markets.find(item => item.key === nextKey);
    setMarketKey(nextKey);
    if (nextMarket) setTimeframe(nextMarket.availableTimeframes[0] || nextMarket.baseTimeframe);
  };

  const timeframeOptions = timeframes.map(value => ({ value, label: value }));
  const marketOptions = markets.map(item => ({ value: item.key, label: item.label }));

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-bg-surface p-4 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-text-primary font-semibold">Shared historical data feed</h2>
            <p className="text-xs text-text-muted mt-1">Both candidate engines use the same RR Metrics market-data endpoint and the same selected OHLCV candles. This is a chart-rendering test, not a separate replay or trade simulator.</p>
          </div>
          <span className="text-[10px] rounded-full px-2 py-1 bg-positive/10 text-positive">{candles.length.toLocaleString()} bars loaded</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-[10px] uppercase tracking-wider font-semibold text-text-muted mb-1">Instrument</span>
            <select value={market?.key || ''} onChange={event => changeMarket(event.target.value)} disabled={!markets.length || loading} className="w-full bg-bg-input border border-border rounded-lg px-3 py-2 text-sm text-text-primary">
              {marketOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="block text-[10px] uppercase tracking-wider font-semibold text-text-muted mb-1">Timeframe</span>
            <select value={timeframe} onChange={event => setTimeframe(event.target.value)} disabled={!timeframes.length || loading} className="w-full bg-bg-input border border-border rounded-lg px-3 py-2 text-sm text-text-primary">
              {timeframeOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
        </div>
        {market && <p className="text-[10px] text-text-muted">Data source: {market.sourceSymbol || market.instrument} · base resolution {market.baseTimeframe} · first coverage segment {new Date(market.coverage[0].start).toLocaleString()} – {new Date(market.coverage[0].end).toLocaleString()}</p>}
        {loading && <p className="text-xs text-text-muted">Loading historical candles…</p>}
        {error && <p className="text-xs text-negative">{error}</p>}
      </div>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Chart engine panels">
        <button type="button" role="tab" aria-selected={activeEngine === 'kline'} onClick={() => setActiveEngine('kline')} className={'px-3 py-2 rounded-lg text-xs font-semibold border ' + (activeEngine === 'kline' ? 'border-accent bg-accent/10 text-accent' : 'border-border text-text-muted')}>KLineChart</button>
        <button type="button" role="tab" aria-selected={activeEngine === 'tradecanvas'} onClick={() => setActiveEngine('tradecanvas')} className={'px-3 py-2 rounded-lg text-xs font-semibold border ' + (activeEngine === 'tradecanvas' ? 'border-accent bg-accent/10 text-accent' : 'border-border text-text-muted')}>TradeCanvas</button>
      </div>

      {loading && !candles.length ? <div className="rounded-xl border border-border bg-bg-surface p-8 text-center text-sm text-text-muted">Preparing historical data…</div> : null}
      {!loading && !candles.length && !error ? <div className="rounded-xl border border-border bg-bg-surface p-8 text-center text-sm text-text-muted">No historical candle data is available for this selection.</div> : null}
      {candles.length > 0 && !loading && activeEngine === 'kline' && <KLineChartPanel candles={candles} ticker={market?.instrument || 'NQ'} timeframe={timeframe} />}
      {candles.length > 0 && !loading && activeEngine === 'tradecanvas' && <TradeCanvasPanel candles={candles} ticker={market?.instrument || 'NQ'} timeframe={timeframe} />}

      <div className="rounded-xl border border-border bg-bg-surface p-4 space-y-2">
        <h3 className="text-sm font-semibold text-text-primary">What to test</h3>
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-text-secondary">
          <li>• Candle clarity and price-axis precision</li>
          <li>• Pan, zoom and crosshair responsiveness</li>
          <li>• Built-in indicators and parameter controls</li>
          <li>• Drawing tools and editing experience</li>
          <li>• Handling large historical datasets</li>
          <li>• Behaviour when switching instrument/timeframe</li>
        </ul>
      </div>
    </div>
  );
};

export default ChartEngineLab;
