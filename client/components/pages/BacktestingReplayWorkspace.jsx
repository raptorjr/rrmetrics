const React = require('react');
const { useCallback, useEffect, useMemo, useRef, useState } = React;
const Papa = require('papaparse');
const { authFetch } = require('../../helper.js');
import { createChart, CandlestickSeries, ColorType, LineStyle } from 'lightweight-charts';
const {
  createDemoCandles,
  getInstrumentSpec,
  normalizeOhlcvRows,
  evaluateEntryOrder,
  evaluateCandleExit,
  calculateTradePnl,
  calculateTradeStats,
} = require('../../utils/backtestingReplay');

const getCssColor = (name, fallback) => {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!value) return fallback;
  return value.startsWith('#') || value.startsWith('rgb') ? value : 'rgb(' + value + ')';
};

const formatMoney = value => (value < 0 ? '-$' : '$') + Math.abs(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatPrice = (value, decimals = 2) => Number(value).toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
const formatBarTime = value => new Date(value * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const toLocalDateTimeInput = value => { const date = new Date(value); if (!Number.isFinite(date.getTime())) return ''; return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 19); };
const getIntervalSeconds = data => {
  const gaps = [];
  for (let index = 1; index < Math.min(data.length, 30); index += 1) {
    const gap = data[index].time - data[index - 1].time;
    if (gap > 0) gaps.push(gap);
  }
  gaps.sort((a, b) => a - b);
  return gaps.length ? gaps[Math.floor(gaps.length / 2)] : 60;
};
const formatInterval = seconds => seconds < 60
  ? seconds + ' seconds'
  : seconds < 3600
    ? (seconds / 60) + ' minute' + (seconds === 60 ? '' : 's')
    : (seconds / 3600) + ' hour' + (seconds === 3600 ? '' : 's');

const BacktestingReplayWorkspace = () => {
  const [ticker, setTicker] = useState('NQ');
  const [candles, setCandles] = useState(() => createDemoCandles('NQ'));
  const [isDemoData, setIsDemoData] = useState(true);
  const [dataLabel, setDataLabel] = useState('Generated demo candles');
  const [currentIndex, setCurrentIndex] = useState(80);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [quantity, setQuantity] = useState(1);
  const [quantityPresets, setQuantityPresets] = useState([1, 2, 3, 5, 10]);
  const [editingPresets, setEditingPresets] = useState(false);
  const [presetDraft, setPresetDraft] = useState(['1', '2', '3', '5', '10']);
  const [orderType, setOrderType] = useState('market');
  const [orderPrice, setOrderPrice] = useState('');
  const [pendingOrder, setPendingOrder] = useState(null);
  const [stopInput, setStopInput] = useState('');
  const [targetInput, setTargetInput] = useState('');
  const [position, setPosition] = useState(null);
  const [closedTrades, setClosedTrades] = useState([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [importError, setImportError] = useState('');
  const [dataSource, setDataSource] = useState('demo');
  const [historicalDatasets, setHistoricalDatasets] = useState([]);
  const [historicalPanelOpen, setHistoricalPanelOpen] = useState(false);
  const [historicalLoading, setHistoricalLoading] = useState(false);
  const [historicalSourceSymbol, setHistoricalSourceSymbol] = useState('');
  const [historicalTimeframe, setHistoricalTimeframe] = useState('1m');
  const [historicalDatasetId, setHistoricalDatasetId] = useState('');
  const [historicalStart, setHistoricalStart] = useState('');
  const [historicalEnd, setHistoricalEnd] = useState('');
  const chartContainerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const priceLinesRef = useRef([]);
  const previousIndexRef = useRef(80);
  const currentIndexRef = useRef(80);
  const candlesRef = useRef(candles);
  const positionRef = useRef(null);
  const pendingOrderRef = useRef(null);
  const advanceOneRef = useRef(null);

  const tickerDatasets = useMemo(
    () => historicalDatasets.filter(dataset => dataset.instrument === ticker),
    [historicalDatasets, ticker],
  );
  const historicalTimeframes = useMemo(
    () => [...new Set(tickerDatasets.map(dataset => dataset.timeframe))].sort(),
    [tickerDatasets],
  );
  const historicalSymbols = useMemo(
    () => [...new Set(tickerDatasets
      .filter(dataset => dataset.timeframe === historicalTimeframe)
      .map(dataset => dataset.source_symbol)
      .filter(Boolean))].sort(),
    [tickerDatasets, historicalTimeframe],
  );
  const filteredHistoricalDatasets = useMemo(
    () => tickerDatasets.filter(dataset =>
      dataset.timeframe === historicalTimeframe &&
      (!historicalSourceSymbol || dataset.source_symbol === historicalSourceSymbol)),
    [tickerDatasets, historicalTimeframe, historicalSourceSymbol],
  );

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await authFetch('/api/market-data/datasets');
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Unable to load historical market-data catalogue.');
        if (!cancelled) setHistoricalDatasets(data.datasets || []);
      } catch (loadError) {
        if (!cancelled) setImportError(loadError.message || 'Unable to load historical market-data catalogue.');
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (historicalTimeframes.length && !historicalTimeframes.includes(historicalTimeframe)) {
      setHistoricalTimeframe(historicalTimeframes[0]);
    }
  }, [historicalTimeframes, historicalTimeframe]);

  useEffect(() => {
    if (historicalSymbols.length && !historicalSymbols.includes(historicalSourceSymbol)) {
      setHistoricalSourceSymbol(historicalSymbols[0]);
    } else if (!historicalSymbols.length && historicalSourceSymbol) {
      setHistoricalSourceSymbol('');
    }
  }, [historicalSymbols, historicalSourceSymbol]);

  useEffect(() => {
    if (historicalDatasetId && !filteredHistoricalDatasets.some(dataset => dataset.id === historicalDatasetId)) {
      setHistoricalDatasetId('');
    }
    const selected = historicalDatasetId
      ? filteredHistoricalDatasets.filter(dataset => dataset.id === historicalDatasetId)
      : filteredHistoricalDatasets;
    if (!selected.length) {
      setHistoricalStart('');
      setHistoricalEnd('');
      return;
    }
    const starts = selected.map(dataset => new Date(dataset.start_time).getTime()).filter(Number.isFinite);
    const ends = selected.map(dataset => new Date(dataset.end_time).getTime()).filter(Number.isFinite);
    setHistoricalStart(toLocalDateTimeInput(Math.min(...starts)));
    setHistoricalEnd(toLocalDateTimeInput(Math.max(...ends)));
  }, [filteredHistoricalDatasets, historicalDatasetId]);

  const spec = getInstrumentSpec(ticker);
  const currentCandle = candles[currentIndex] || candles[0];
  const currentPrice = currentCandle ? currentCandle.close : 0;
  const intervalSeconds = useMemo(() => getIntervalSeconds(candles), [candles]);
  const intervalLabel = formatInterval(intervalSeconds);
  const stats = useMemo(() => calculateTradeStats(closedTrades), [closedTrades]);
  const unrealizedPnl = position ? calculateTradePnl(position, currentPrice, spec.pointValue) : 0;
  const initialIndex = Math.min(80, Math.max(0, candles.length - 1));
  const canSeek = !position && !pendingOrder && closedTrades.length === 0;

  useEffect(() => { candlesRef.current = candles; }, [candles]);
  useEffect(() => { currentIndexRef.current = currentIndex; }, [currentIndex]);
  useEffect(() => { positionRef.current = position; }, [position]);
  useEffect(() => { pendingOrderRef.current = pendingOrder; }, [pendingOrder]);

  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container) return undefined;

    const border = getCssColor('--border', '#334155');
    const chart = createChart(container, {
      width: Math.max(container.clientWidth, 320),
      height: 430,
      layout: {
        background: { type: ColorType.Solid, color: getCssColor('--bg-surface', '#111827') },
        textColor: getCssColor('--text-secondary', '#cbd5e1'),
      },
      attributionLogo: true,
      grid: {
        vertLines: { color: border },
        horzLines: { color: border },
      },
      rightPriceScale: { borderColor: border },
      timeScale: {
        borderColor: border,
        timeVisible: true,
        secondsVisible: intervalSeconds < 60,
        rightOffset: 8,
        barSpacing: 8,
      },
      crosshair: { mode: 0 },
      handleScroll: true,
      handleScale: true,
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: getCssColor('--positive', '#22c55e'),
      downColor: getCssColor('--negative', '#ef4444'),
      borderVisible: false,
      wickUpColor: getCssColor('--positive', '#22c55e'),
      wickDownColor: getCssColor('--negative', '#ef4444'),
      priceFormat: { type: 'price', precision: spec.decimals, minMove: spec.tickSize },
    });
    chartRef.current = chart;
    seriesRef.current = series;

    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(entries => {
        const entry = entries[0];
        if (entry && entry.contentRect.width > 0) {
          chart.applyOptions({ width: Math.floor(entry.contentRect.width) });
        }
      })
      : null;
    if (resizeObserver) resizeObserver.observe(container);

    return () => {
      if (resizeObserver) resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      priceLinesRef.current = [];
    };
  }, []);

  useEffect(() => {
    if (chartRef.current) chartRef.current.timeScale().applyOptions({ secondsVisible: intervalSeconds < 60 });
  }, [intervalSeconds]);

  useEffect(() => {
    if (!seriesRef.current) return;
    seriesRef.current.setData(candles.slice(0, currentIndex + 1));
    previousIndexRef.current = currentIndex;
    if (chartRef.current) chartRef.current.timeScale().fitContent();
  }, [candles]);

  useEffect(() => {
    if (!seriesRef.current || !candles[currentIndex]) return;
    const previousIndex = previousIndexRef.current;
    if (currentIndex === previousIndex + 1) {
      seriesRef.current.update(candles[currentIndex]);
      if (chartRef.current) chartRef.current.timeScale().scrollToRealTime();
    } else {
      seriesRef.current.setData(candles.slice(0, currentIndex + 1));
    }
    previousIndexRef.current = currentIndex;
  }, [currentIndex]);

  useEffect(() => {
    if (!seriesRef.current) return;
    priceLinesRef.current.forEach(line => seriesRef.current.removePriceLine(line));
    priceLinesRef.current = [];
    if (!position && !pendingOrder) return;
    const lines = [];
    if (pendingOrder) lines.push({ price: pendingOrder.triggerPrice, color: '#f59e0b', title: pendingOrder.type === 'limit' ? 'LIMIT ENTRY' : 'STOP ENTRY' });
    if (position) lines.push({ price: position.entryPrice, color: '#60a5fa', title: position.direction === 'long' ? 'LONG ENTRY' : 'SHORT ENTRY' });
    if (position && position.stopPrice != null) lines.push({ price: position.stopPrice, color: '#ef4444', title: 'STOP' });
    if (position && position.targetPrice != null) lines.push({ price: position.targetPrice, color: '#22c55e', title: 'TARGET' });
    lines.forEach(item => {
      priceLinesRef.current.push(seriesRef.current.createPriceLine({
        price: item.price,
        color: item.color,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: item.title,
      }));
    });
  }, [position, pendingOrder]);

  useEffect(() => {
    if (!seriesRef.current) return;
    seriesRef.current.applyOptions({
      priceFormat: { type: 'price', precision: spec.decimals, minMove: spec.tickSize },
    });
  }, [ticker]);

  const closePosition = useCallback((activePosition, exitPrice, exitTime, reason) => {
    const pnl = calculateTradePnl(activePosition, exitPrice, spec.pointValue);
    const risk = activePosition.stopPrice == null
      ? null
      : Math.abs(activePosition.entryPrice - activePosition.stopPrice) * activePosition.quantity * spec.pointValue;
    const trade = {
      id: String(Date.now()) + '-' + String(Math.random()).slice(2, 7),
      direction: activePosition.direction,
      quantity: activePosition.quantity,
      entryPrice: activePosition.entryPrice,
      exitPrice,
      entryTime: activePosition.entryTime,
      exitTime,
      stopPrice: activePosition.stopPrice,
      targetPrice: activePosition.targetPrice,
      pnl,
      rMultiple: risk > 0 ? pnl / risk : null,
      reason,
    };
    setClosedTrades(previous => previous.concat(trade));
    positionRef.current = null;
    setPosition(null);
    setStopInput('');
    setTargetInput('');
    setMessage((activePosition.direction === 'long' ? 'Long' : 'Short') + ' position closed: ' + reason + ' · ' + formatMoney(pnl));
  }, [spec.pointValue]);

  const advanceOne = useCallback(() => {
    const nextIndex = currentIndexRef.current + 1;
    const data = candlesRef.current;
    if (nextIndex >= data.length) {
      setIsPlaying(false);
      return;
    }
    currentIndexRef.current = nextIndex;
    setCurrentIndex(nextIndex);
    const activeOrder = pendingOrderRef.current;
    if (activeOrder && !positionRef.current) {
      const fill = evaluateEntryOrder(activeOrder, data[nextIndex]);
      if (fill) {
        const filledPosition = { ...activeOrder, entryPrice: fill.price, entryTime: data[nextIndex].time };
        pendingOrderRef.current = null;
        setPendingOrder(null);
        positionRef.current = filledPosition;
        setPosition(filledPosition);
        setMessage(activeOrder.direction.toUpperCase() + ' ' + activeOrder.type.replace('_', ' ') + ' filled at ' + formatPrice(fill.price, spec.decimals) + '.');
      }
    } else if (positionRef.current) {
      const activePosition = positionRef.current;
      const exit = evaluateCandleExit(activePosition, data[nextIndex]);
      if (exit) closePosition(activePosition, exit.price, data[nextIndex].time, exit.reason);
    }
    if (nextIndex >= data.length - 1) setIsPlaying(false);
  }, [closePosition]);

  useEffect(() => { advanceOneRef.current = advanceOne; }, [advanceOne]);

  useEffect(() => {
    if (!isPlaying) return undefined;
    const interval = setInterval(() => {
      if (advanceOneRef.current) advanceOneRef.current();
    }, Math.max(70, Math.round(1000 / speed)));
    return () => clearInterval(interval);
  }, [isPlaying, speed]);

  const handleTickerChange = (event) => {
    const nextTicker = event.target.value;
    setTicker(nextTicker);
    if (isDemoData || dataSource === 'historical') {
      const nextCandles = createDemoCandles(nextTicker);
      setCandles(nextCandles);
      setCurrentIndex(Math.min(80, nextCandles.length - 1));
      currentIndexRef.current = Math.min(80, nextCandles.length - 1);
      setIsDemoData(true);
      setDataSource('demo');
      setDataLabel('Generated demo candles');
    }
    setIsPlaying(false);
    setPosition(null);
    positionRef.current = null;
    setPendingOrder(null);
    pendingOrderRef.current = null;
    setClosedTrades([]);
    setStopInput('');
    setTargetInput('');
    setMessage('');
  };

  const handleCsvUpload = (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    setImportError('');
    setError('');
    setIsPlaying(false);
    Papa.parse(file, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      complete: results => {
        const normalized = normalizeOhlcvRows(results.data);
        if (normalized.length < 2) {
          setImportError('No usable OHLCV bars found. Expected timestamp, open, high, low and close columns.');
          return;
        }
        setCandles(normalized);
        setCurrentIndex(Math.min(80, normalized.length - 1));
        currentIndexRef.current = Math.min(80, normalized.length - 1);
        setDataLabel(file.name + ' · ' + normalized.length.toLocaleString() + ' bars');
        setIsDemoData(false);
        setDataSource('csv');
        setPosition(null);
        positionRef.current = null;
        setClosedTrades([]);
        setStopInput('');
        setTargetInput('');
        setMessage('Loaded ' + normalized.length.toLocaleString() + ' candles. Future bars are hidden during replay.');
      },
      error: parseError => setImportError(parseError.message || 'Could not read this CSV file.'),
    });
    event.target.value = '';
  };

  const loadHistoricalData = async () => {
    if (historicalLoading || !historicalStart || !historicalEnd) return;
    const start = new Date(historicalStart);
    const end = new Date(historicalEnd);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end < start) {
      setImportError('Choose a valid historical start and end time.');
      return;
    }

    setHistoricalLoading(true);
    setImportError('');
    setError('');
    try {
      const params = new URLSearchParams({ start: start.toISOString(), end: end.toISOString() });
      if (historicalDatasetId) {
        params.set('datasetId', historicalDatasetId);
      } else {
        params.set('instrument', ticker);
        params.set('timeframe', historicalTimeframe);
        if (historicalSourceSymbol) params.set('sourceSymbol', historicalSourceSymbol);
      }

      const response = await authFetch('/api/market-data/query?' + params.toString());
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to load the selected historical market data.');
      const normalized = normalizeOhlcvRows(data.bars || []);
      if (normalized.length < 2) throw new Error('The selected range contains fewer than two usable OHLCV bars.');

      setCandles(normalized);
      setCurrentIndex(Math.min(80, normalized.length - 1));
      currentIndexRef.current = Math.min(80, normalized.length - 1);
      setIsDemoData(false);
      setDataSource('historical');
      setDataLabel((data.instrument || ticker) + ' · ' + (data.timeframe || historicalTimeframe) + ' · ' + (data.sourceSymbol || 'source data') + ' · ' + normalized.length.toLocaleString() + ' bars');
      setIsPlaying(false);
      setPosition(null);
      positionRef.current = null;
      setPendingOrder(null);
      pendingOrderRef.current = null;
      setClosedTrades([]);
      setStopInput('');
      setTargetInput('');
      setMessage('Loaded ' + normalized.length.toLocaleString() + ' historical candles from the central market-data manager.');
      setHistoricalPanelOpen(false);
    } catch (loadError) {
      setImportError(loadError.message || 'Unable to load historical market data.');
    } finally {
      setHistoricalLoading(false);
    }
  };

  const validateLevels = (direction, entryPrice, stopPrice, targetPrice) => {
    if (stopPrice != null && (direction === 'long' ? stopPrice >= entryPrice : stopPrice <= entryPrice)) {
      return 'The stop-loss must be below entry for a long, and above entry for a short.';
    }
    if (targetPrice != null && (direction === 'long' ? targetPrice <= entryPrice : targetPrice >= entryPrice)) {
      return 'The take-profit must be above entry for a long, and below entry for a short.';
    }
    return '';
  };

  const openPosition = (direction) => {
    if (positionRef.current || pendingOrderRef.current || !currentCandle) return;
    const parsedQuantity = Number(quantity);
    if (!Number.isInteger(parsedQuantity) || parsedQuantity < 1 || parsedQuantity > 100) { setError('Quantity must be a whole number between 1 and 100.'); return; }
    const triggerPrice = orderType === 'market' ? currentPrice : Number(orderPrice);
    if (orderType !== 'market' && (!Number.isFinite(triggerPrice) || triggerPrice <= 0)) { setError('Enter a valid order price.'); return; }
    const stopPrice = stopInput.trim() === '' ? null : Number(stopInput);
    const targetPrice = targetInput.trim() === '' ? null : Number(targetInput);
    if ((stopPrice != null && !Number.isFinite(stopPrice)) || (targetPrice != null && !Number.isFinite(targetPrice))) { setError('Stop-loss and take-profit must be valid prices.'); return; }
    const validationError = validateLevels(direction, triggerPrice, stopPrice, targetPrice);
    if (validationError) { setError(validationError); return; }
    const order = { direction, quantity: parsedQuantity, type: orderType, triggerPrice, stopPrice, targetPrice };
    if (orderType === 'market') {
      const nextPosition = { ...order, entryPrice: currentPrice, entryTime: currentCandle.time };
      positionRef.current = nextPosition; setPosition(nextPosition);
      setMessage((direction === 'long' ? 'Buy' : 'Sell') + ' market order simulated at ' + formatPrice(currentPrice, spec.decimals) + '.');
    } else {
      pendingOrderRef.current = order; setPendingOrder(order);
      setMessage((direction === 'long' ? 'Buy' : 'Sell') + ' ' + orderType.replace('_', ' ') + ' order placed at ' + formatPrice(triggerPrice, spec.decimals) + '.');
    }
    setError('');
  };

  const updatePositionLevels = () => {
    if (!position) return;
    const stopPrice = stopInput.trim() === '' ? null : Number(stopInput);
    const targetPrice = targetInput.trim() === '' ? null : Number(targetInput);
    if ((stopPrice != null && !Number.isFinite(stopPrice)) || (targetPrice != null && !Number.isFinite(targetPrice))) {
      setError('Stop-loss and take-profit must be valid prices.');
      return;
    }
    const validationError = validateLevels(position.direction, position.entryPrice, stopPrice, targetPrice);
    if (validationError) {
      setError(validationError);
      return;
    }
    const updated = { ...position, stopPrice, targetPrice };
    positionRef.current = updated;
    setPosition(updated);
    setError('');
    setMessage('Position levels updated.');
  };

  const resetReplay = () => {
    if ((closedTrades.length || position || pendingOrder) && !window.confirm('Reset replay and clear all orders and trades from this temporary session?')) return;
    setIsPlaying(false);
    setCurrentIndex(initialIndex);
    currentIndexRef.current = initialIndex;
    setPosition(null);
    positionRef.current = null;
    setClosedTrades([]);
    setStopInput('');
    setTargetInput('');
    setPendingOrder(null);
    pendingOrderRef.current = null;
    setError('');
    setMessage('Replay reset.');
  };

  const adjustQuantity = delta => setQuantity(value => Math.max(1, Math.min(100, Number(value) + delta)));
  const savePresets = () => {
    const values = presetDraft.map(Number);
    if (values.some(value => !Number.isInteger(value) || value < 1 || value > 100)) { setError('Each preset must be a whole number from 1 to 100.'); return; }
    setQuantityPresets(values); setQuantity(values[0]); setEditingPresets(false); setError('');
  };

  const statsProfitFactor = stats.profitFactor == null
    ? (stats.grossProfit > 0 ? '∞' : '—')
    : stats.profitFactor.toFixed(2);

  return (
    <div className="space-y-4">
      <div className="bg-bg-surface border border-border rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-text-tertiary text-[11px] font-semibold uppercase tracking-wider mb-1">Instrument</label>
              <select value={ticker} onChange={handleTickerChange} className="bg-bg-input border border-border rounded-lg px-3 py-2 text-sm text-text-primary">
                <option value="NQ">NQ</option>
                <option value="MNQ">MNQ</option>
                <option value="ES">ES</option>
                <option value="MES">MES</option>
                <option value="GC">GC</option>
                <option value="MGC">MGC</option>
              </select>
            </div>
            <div>
              <span className="block text-text-tertiary text-[11px] font-semibold uppercase tracking-wider mb-1">Chart interval</span>
              <span className="inline-flex px-3 py-2 rounded-lg border border-border bg-bg-input text-sm text-text-secondary">{intervalLabel}</span>
            </div>
            <div className="min-w-0">
              <span className="block text-text-tertiary text-[11px] font-semibold uppercase tracking-wider mb-1">Market data</span>
              <span className="block max-w-[260px] truncate text-sm text-text-secondary" title={dataLabel}>{dataLabel}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => { setHistoricalPanelOpen(value => !value); setImportError(''); }} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-bg-input text-sm text-text-primary hover:border-accent">
              {historicalPanelOpen ? 'Close historical data' : 'Load historical data'}
            </button>
            <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-bg-input text-sm text-text-primary hover:border-accent cursor-pointer">
              Upload OHLCV CSV
              <input type="file" accept=".csv,text/csv" className="hidden" onChange={handleCsvUpload} />
            </label>
          </div>>
        </div>
        {historicalPanelOpen && (
          <div className="rounded-lg border border-border bg-bg-page/50 p-3 space-y-3">
            <div>
              <div className="text-sm font-semibold text-text-primary">Historical Futures</div>
              <div className="text-xs text-text-muted mt-0.5">Select a stored source and date range. Data is loaded through RR Metrics' central market-data API.</div>
            </div>
            {tickerDatasets.length === 0 ? (
              <div className="rounded-lg border border-border bg-bg-surface px-3 py-4 text-xs text-text-muted">
                No historical datasets are available for {ticker}. Add CSV or Parquet files under Settings → Providers → Historical Futures first.
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                  <label className="space-y-1">
                    <span className="block text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Timeframe</span>
                    <select value={historicalTimeframe} onChange={event => { setHistoricalTimeframe(event.target.value); setHistoricalDatasetId(''); }} className="w-full bg-bg-input border border-border rounded-lg px-3 py-2 text-sm text-text-primary">
                      {historicalTimeframes.map(value => <option key={value} value={value}>{value}</option>)}
                    </select>
                  </label>
                  {historicalSymbols.length > 1 && (
                    <label className="space-y-1">
                      <span className="block text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Contract / source symbol</span>
                      <select value={historicalSourceSymbol} onChange={event => { setHistoricalSourceSymbol(event.target.value); setHistoricalDatasetId(''); }} className="w-full bg-bg-input border border-border rounded-lg px-3 py-2 text-sm text-text-primary">
                        {historicalSymbols.map(value => <option key={value} value={value}>{value}</option>)}
                      </select>
                    </label>
                  )}
                  <label className="space-y-1 sm:col-span-2">
                    <span className="block text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Source selection</span>
                    <select value={historicalDatasetId} onChange={event => {
                      const id = event.target.value;
                      setHistoricalDatasetId(id);
                      const dataset = filteredHistoricalDatasets.find(item => item.id === id);
                      if (dataset) {
                        if (dataset.source_symbol) setHistoricalSourceSymbol(dataset.source_symbol);
                        setHistoricalTimeframe(dataset.timeframe);
                      }
                    }} className="w-full bg-bg-input border border-border rounded-lg px-3 py-2 text-sm text-text-primary">
                      <option value="">Combine non-overlapping files for this contract</option>
                      {filteredHistoricalDatasets.map(dataset => (
                        <option key={dataset.id} value={dataset.id}>
                          {dataset.original_filename} · {dataset.source_symbol || dataset.instrument} · {new Date(dataset.start_time).toLocaleDateString()} – {new Date(dataset.end_time).toLocaleDateString()}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className="block text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">From</span>
                    <input type="datetime-local" step="1" value={historicalStart} onChange={event => setHistoricalStart(event.target.value)} className="w-full bg-bg-input border border-border rounded-lg px-3 py-2 text-sm text-text-primary" />
                  </label>
                  <label className="space-y-1">
                    <span className="block text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">To</span>
                    <input type="datetime-local" step="1" value={historicalEnd} onChange={event => setHistoricalEnd(event.target.value)} className="w-full bg-bg-input border border-border rounded-lg px-3 py-2 text-sm text-text-primary" />
                  </label>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-[11px] text-text-muted">
                    {filteredHistoricalDatasets.length} matching source dataset(s). Overlapping files require selecting a specific source.
                  </div>
                  <button type="button" onClick={loadHistoricalData} disabled={historicalLoading || !historicalStart || !historicalEnd || !filteredHistoricalDatasets.length} className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-text disabled:opacity-50">
                    {historicalLoading ? 'Loading…' : 'Load selected historical range'}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
        {isDemoData && (
          <div className="text-xs text-amber-500 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
            Synthetic demonstration data only — this is not historical market data. Upload a CSV or load stored Historical Futures data to replay real candles.
          </div>
        )}
        {!isDemoData && dataSource === 'csv' && (
          <div className="text-xs text-text-muted">Uploaded CSV data is held in this browser session only. It is not saved to RR Metrics. Confirm the selected instrument matches the file.</div>
        )}
        {!isDemoData && dataSource === 'historical' && (
          <div className="text-xs text-text-muted">Loaded from the server-managed Historical Futures catalogue. The source file and normalized dataset remain stored independently.</div>
        )}
        {importError && <div className="text-xs text-negative">{importError}</div>}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_300px] gap-4">
        <div className="bg-bg-surface border border-border rounded-xl overflow-hidden min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-border">
            <div>
              <div className="text-text-primary font-semibold">{ticker} · {intervalLabel}</div>
              <div className="text-text-muted text-xs">{currentCandle ? formatBarTime(currentCandle.time) : 'No data'} · {currentIndex + 1} / {candles.length} bars revealed</div>
            </div>
            <div className="text-right">
              <div className="font-mono text-text-primary text-lg">{formatPrice(currentPrice, spec.decimals)}</div>
              <div className="text-text-muted text-[11px]">Last revealed close</div>
            </div>
          </div>
          <div ref={chartContainerRef} className="w-full h-[430px]" />
          <div className="px-3 py-2 border-t border-border text-[10px] text-text-muted">
            TradingView Lightweight Charts™ · Copyright (c) 2025 TradingView, Inc. · <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer" className="text-accent hover:underline">tradingview.com</a>
          </div>
          <div className="px-4 py-3 border-t border-border flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setIsPlaying(value => !value)} disabled={!isPlaying && currentIndex >= candles.length - 1} aria-label={isPlaying ? 'Pause replay' : 'Play replay'} className="w-10 h-10 inline-flex items-center justify-center rounded-lg bg-accent text-accent-text text-sm font-semibold disabled:opacity-40">{isPlaying ? 'Ⅱ' : '▶'}</button>
            <button type="button" onClick={advanceOne} disabled={currentIndex >= candles.length - 1} className="px-3 py-2 rounded-lg border border-border text-sm text-text-secondary hover:text-text-primary">Step +1</button>
            <button type="button" onClick={resetReplay} className="px-3 py-2 rounded-lg border border-border text-sm text-text-secondary hover:text-text-primary">Reset</button>
            <div className="ml-auto flex items-center gap-2 text-xs text-text-muted">
              <label htmlFor="replay-speed">Speed</label>
              <select id="replay-speed" value={speed} onChange={event => setSpeed(Number(event.target.value))} className="bg-bg-input border border-border rounded-lg px-2 py-2 text-text-primary">
                <option value="0.5">0.5×</option>
                <option value="1">1×</option>
                <option value="2">2×</option>
                <option value="5">5×</option>
                <option value="10">10×</option>
              </select>
            </div>
          </div>
          <div className="px-4 pb-4">
            <input
              type="range"
              min="0"
              max={Math.max(0, candles.length - 1)}
              value={currentIndex}
              disabled={!canSeek}
              onChange={event => {
                const next = Number(event.target.value);
                currentIndexRef.current = next;
                setCurrentIndex(next);
              }}
              className="w-full accent-accent disabled:opacity-40"
              aria-label="Replay position"
            />
            <div className="flex justify-between text-[10px] text-text-muted">
              <span>{candles.length ? formatBarTime(candles[0].time) : ''}</span>
              <span>{candles.length ? formatBarTime(candles[candles.length - 1].time) : ''}</span>
            </div>
            {!canSeek && <div className="text-[10px] text-text-muted mt-1">Rewind is disabled after the first trade to keep the trade sequence consistent. Reset to start over.</div>}
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-bg-surface border border-border rounded-xl p-4 space-y-3">
            <h3 className="text-text-primary font-semibold text-sm">Order entry</h3>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => adjustQuantity(-1)} disabled={!!position || !!pendingOrder || quantity <= 1} className="w-9 h-9 rounded-full border border-border text-text-primary disabled:opacity-40" aria-label="Decrease contracts">−</button>
              <div className="flex flex-1 justify-center gap-1.5">{quantityPresets.map((preset, index) => <button key={index} type="button" onClick={() => setQuantity(preset)} disabled={!!position || !!pendingOrder} className={"min-w-8 h-9 px-2 rounded-full text-xs font-semibold " + (quantity === preset ? 'bg-accent text-accent-text' : 'bg-bg-input text-text-secondary hover:text-text-primary')}>{preset}</button>)}</div>
              <button type="button" onClick={() => adjustQuantity(1)} disabled={!!position || !!pendingOrder || quantity >= 100} className="w-9 h-9 rounded-full border border-border text-text-primary disabled:opacity-40" aria-label="Increase contracts">+</button>
              <button type="button" onClick={() => { setPresetDraft(quantityPresets.map(String)); setEditingPresets(value => !value); }} className="w-9 h-9 rounded-lg text-text-muted hover:text-text-primary" title="Edit contract presets" aria-label="Edit contract presets">✎</button>
            </div>
            {editingPresets && <div className="rounded-lg border border-border bg-bg-input p-3 space-y-2"><div className="text-xs font-semibold text-text-secondary">Contract presets</div><div className="grid grid-cols-5 gap-2">{presetDraft.map((value, index) => <input key={index} type="number" min="1" max="100" step="1" value={value} onChange={event => setPresetDraft(previous => previous.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} className="min-w-0 w-full rounded border border-border bg-bg-surface px-1 py-2 text-center text-sm text-text-primary" aria-label={"Preset " + (index + 1)} />)}</div><div className="flex justify-end gap-2"><button type="button" onClick={() => setEditingPresets(false)} className="px-3 py-1.5 text-xs text-text-muted">Cancel</button><button type="button" onClick={savePresets} className="px-3 py-1.5 rounded bg-accent text-accent-text text-xs font-semibold">Save</button></div></div>}
            <div className="grid grid-cols-2 gap-2"><div><label className="block text-text-tertiary text-[11px] font-semibold uppercase tracking-wider mb-1">Order type</label><select value={orderType} disabled={!!position || !!pendingOrder} onChange={event => setOrderType(event.target.value)} className="w-full bg-bg-input border border-border rounded-lg px-2 py-2 text-sm text-text-primary"><option value="market">Market</option><option value="limit">Limit</option><option value="stop_market">Stop Market</option></select></div>{orderType !== 'market' && <div><label className="block text-text-tertiary text-[11px] font-semibold uppercase tracking-wider mb-1">Entry price</label><input type="number" step={spec.tickSize} value={orderPrice} onChange={event => setOrderPrice(event.target.value)} className="w-full bg-bg-input border border-border rounded-lg px-2 py-2 text-sm text-text-primary" placeholder="Price" /></div>}</div>
            <div><label className="block text-text-tertiary text-[11px] font-semibold uppercase tracking-wider mb-1">Stop-loss price (optional)</label><input type="number" step={spec.tickSize} value={stopInput} disabled={!!position || !!pendingOrder} onChange={event => setStopInput(event.target.value)} className="w-full bg-bg-input border border-border rounded-lg px-3 py-2 text-sm text-text-primary disabled:opacity-50" placeholder="Price" /></div>
            <div><label className="block text-text-tertiary text-[11px] font-semibold uppercase tracking-wider mb-1">Take-profit price (optional)</label><input type="number" step={spec.tickSize} value={targetInput} disabled={!!position || !!pendingOrder} onChange={event => setTargetInput(event.target.value)} className="w-full bg-bg-input border border-border rounded-lg px-3 py-2 text-sm text-text-primary disabled:opacity-50" placeholder="Price" /></div>
            {!position && !pendingOrder ? <div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => openPosition('long')} className="py-2.5 rounded-lg bg-positive text-white text-sm font-semibold">BUY {quantity} @ {orderType === 'stop_market' ? 'STOP' : orderType.toUpperCase()}</button><button type="button" onClick={() => openPosition('short')} className="py-2.5 rounded-lg bg-negative text-white text-sm font-semibold">SELL {quantity} @ {orderType === 'stop_market' ? 'STOP' : orderType.toUpperCase()}</button></div> : pendingOrder ? <div className="rounded-lg bg-bg-input p-3 text-xs space-y-2"><div className="flex justify-between"><span className="text-text-muted">Pending {pendingOrder.type.replace('_', ' ')}</span><strong>{pendingOrder.direction.toUpperCase()} × {pendingOrder.quantity}</strong></div><div className="flex justify-between"><span className="text-text-muted">Order price</span><span className="font-mono">{formatPrice(pendingOrder.triggerPrice, spec.decimals)}</span></div><button type="button" onClick={() => { setPendingOrder(null); pendingOrderRef.current = null; setMessage('Pending order cancelled.'); }} className="w-full py-2 rounded-lg border border-border text-sm text-text-secondary">Cancel pending order</button></div> : <div className="space-y-2"><div className="rounded-lg bg-bg-input p-3 text-xs space-y-1"><div className="flex justify-between"><span className="text-text-muted">Open position</span><strong className={position.direction === 'long' ? 'text-positive' : 'text-negative'}>{position.direction.toUpperCase()} × {position.quantity}</strong></div><div className="flex justify-between"><span className="text-text-muted">Entry</span><span className="font-mono">{formatPrice(position.entryPrice, spec.decimals)}</span></div><div className="flex justify-between"><span className="text-text-muted">Unrealized P/L</span><strong className={unrealizedPnl >= 0 ? 'text-positive' : 'text-negative'}>{formatMoney(unrealizedPnl)}</strong></div></div><button type="button" onClick={updatePositionLevels} className="w-full py-2 rounded-lg border border-border text-sm text-text-secondary hover:text-text-primary">Update SL / TP levels</button><button type="button" onClick={() => closePosition(position, currentPrice, currentCandle.time, 'Manual close')} className="w-full py-2.5 rounded-lg bg-accent text-accent-text text-sm font-semibold">Close position</button></div>}
            {error && <p className="text-xs text-negative">{error}</p>}{message && <p className="text-xs text-text-muted">{message}</p>}
          </div>

          <div className="bg-bg-surface border border-border rounded-xl p-4 space-y-3">
            <h3 className="text-text-primary font-semibold text-sm">Backtest statistics</h3>
            <div className="grid grid-cols-2 gap-3">
              <div><div className="text-[10px] uppercase tracking-wider text-text-muted">Closed trades</div><div className="text-xl font-semibold text-text-primary">{stats.total}</div></div>
              <div><div className="text-[10px] uppercase tracking-wider text-text-muted">Win rate</div><div className="text-xl font-semibold text-text-primary">{stats.winRate.toFixed(1)}%</div></div>
              <div><div className="text-[10px] uppercase tracking-wider text-text-muted">Net P/L</div><div className={'text-lg font-semibold ' + (stats.netPnl >= 0 ? 'text-positive' : 'text-negative')}>{formatMoney(stats.netPnl)}</div></div>
              <div><div className="text-[10px] uppercase tracking-wider text-text-muted">Profit factor</div><div className="text-lg font-semibold text-text-primary">{statsProfitFactor}</div></div>
            </div>
            <div className="border-t border-border pt-2 flex justify-between text-xs"><span className="text-text-muted">Wins / losses / BE</span><span className="text-text-primary">{stats.wins} / {stats.losses} / {stats.breakeven}</span></div>
            {position && <div className="flex justify-between text-xs"><span className="text-text-muted">Open P/L (not included above)</span><strong className={unrealizedPnl >= 0 ? 'text-positive' : 'text-negative'}>{formatMoney(unrealizedPnl)}</strong></div>}
            {closedTrades.length === 0 && <p className="text-xs text-text-muted">Close your first simulated trade to start building statistics.</p>}
          </div>
        </div>
      </div>

      <div className="bg-bg-surface border border-border rounded-xl p-4">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h3 className="text-text-primary font-semibold text-sm">Trade history</h3>
          <span className="text-text-muted text-xs">{closedTrades.length} closed</span>
        </div>
        {closedTrades.length === 0 ? (
          <p className="text-text-muted text-sm">No trades yet. Start the replay and place a simulated trade.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[720px]">
              <thead><tr className="text-text-muted border-b border-border text-left">
                <th className="py-2 pr-3">Side</th><th className="py-2 pr-3">Entry time</th><th className="py-2 pr-3">Entry</th><th className="py-2 pr-3">Exit</th><th className="py-2 pr-3">Qty</th><th className="py-2 pr-3">P/L</th><th className="py-2">Exit reason</th>
              </tr></thead>
              <tbody>
                {closedTrades.map(trade => (
                  <tr key={trade.id} className="border-b border-border/60 text-text-secondary">
                    <td className={'py-2 pr-3 font-semibold ' + (trade.direction === 'long' ? 'text-positive' : 'text-negative')}>{trade.direction.toUpperCase()}</td>
                    <td className="py-2 pr-3">{formatBarTime(trade.entryTime)}</td>
                    <td className="py-2 pr-3 font-mono">{formatPrice(trade.entryPrice, spec.decimals)}</td>
                    <td className="py-2 pr-3 font-mono">{formatPrice(trade.exitPrice, spec.decimals)}</td>
                    <td className="py-2 pr-3">{trade.quantity}</td>
                    <td className={'py-2 pr-3 font-semibold ' + (trade.pnl >= 0 ? 'text-positive' : 'text-negative')}>{formatMoney(trade.pnl)}</td>
                    <td className="py-2">{trade.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="text-[11px] text-text-muted space-y-1">
        <p>First-stage replay prototype: simulated trades and statistics are temporary and are not saved to the database yet. Fees, slippage, partial fills and tick-by-tick execution are not modelled.</p>
        <p>When a stop and target are both inside the same candle, the replay assumes the stop was hit first. This is deliberately conservative; tick data will allow more precise sequencing later.</p>
      </div>
    </div>
  );
};

export default BacktestingReplayWorkspace;
