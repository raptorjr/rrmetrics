const React = require('react');
const { useCallback, useEffect, useMemo, useRef, useState } = React;
const { authFetch } = require('../../helper.js');
import { createChart, CandlestickSeries, ColorType, LineStyle } from 'lightweight-charts';
const {
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
const { formatDateEST, formatTimeEST, getDisplayTimeZone, getDateFormat, getTimeFormat } = require('../../utils/dateUtils');
const { getAvailableMarkets, isRangeWithinCoverage, aggregateCandles, timeframeSeconds } = require('../../utils/historicalReplay');

const formatBarTime = value => {
  const date = new Date(value * 1000);
  return `${formatDateEST(date)} ${formatTimeEST(date)}`;
};

const getZonedParts = (date, timeZone) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  return Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
};

const toDisplayDateTimeInput = value => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const p = getZonedParts(date, getDisplayTimeZone());
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
};

const fromDisplayDateTimeInput = value => {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value || '');
  if (!match) return null;
  const [, year, month, day, hour, minute, second = '00'] = match;
  const target = Date.UTC(+year, +month - 1, +day, +hour, +minute, +second);
  const timeZone = getDisplayTimeZone();
  let timestamp = target;
  // Resolve the wall-clock value in the user's configured display timezone.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const p = getZonedParts(new Date(timestamp), timeZone);
    const represented = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    const difference = target - represented;
    timestamp += difference;
    if (difference === 0) break;
  }
  return new Date(timestamp);
};

const formatDisplayDateTimeInput = value => {
  const date = fromDisplayDateTimeInput(value);
  return date ? `${formatDateEST(date)} ${formatTimeEST(date)}` : 'Select date and time';
};

const ReplayDateTimePicker = ({ value, onChange, min, max, dateFormat, timeFormat }) => {
  const [open, setOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const match = /^(\d{4})-(\d{2})/.exec(value || '');
    return match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1)) : new Date();
  });
  useEffect(() => {
    const match = /^(\d{4})-(\d{2})/.exec(value || '');
    if (match) setVisibleMonth(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1)));
  }, [value]);
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value || '');
  const year = parts ? Number(parts[1]) : 2000;
  const month = parts ? Number(parts[2]) : 1;
  const day = parts ? Number(parts[3]) : 1;
  const hour = parts ? Number(parts[4]) : 0;
  const minute = parts ? Number(parts[5]) : 0;
  const second = parts ? Number(parts[6] || 0) : 0;
  const selectedDate = String(year).padStart(4, '0') + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
  const minDate = min ? min.slice(0, 10) : '';
  const maxDate = max ? max.slice(0, 10) : '';
  const minMonth = minDate ? Number(minDate.slice(0, 4)) * 12 + Number(minDate.slice(5, 7)) - 1 : -Infinity;
  const maxMonth = maxDate ? Number(maxDate.slice(0, 4)) * 12 + Number(maxDate.slice(5, 7)) - 1 : Infinity;
  const monthIndex = visibleMonth.getUTCFullYear() * 12 + visibleMonth.getUTCMonth();
  const monthLabel = visibleMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const firstWeekday = (new Date(Date.UTC(visibleMonth.getUTCFullYear(), visibleMonth.getUTCMonth(), 1)).getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(visibleMonth.getUTCFullYear(), visibleMonth.getUTCMonth() + 1, 0)).getUTCDate();
  const calendarCells = [...Array(firstWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, index) => index + 1)];
  while (calendarCells.length % 7) calendarCells.push(null);
  const pad = number => String(number).padStart(2, '0');
  const candidate = (nextDate, nextHour = hour, nextMinute = minute, nextSecond = second) => nextDate + 'T' + pad(nextHour) + ':' + pad(nextMinute) + ':' + pad(nextSecond);
  const isAllowed = nextValue => (!min || nextValue >= min) && (!max || nextValue <= max);
  const update = nextValue => { if (isAllowed(nextValue)) onChange(nextValue); };
  const changeDate = nextDay => {
    const nextDate = visibleMonth.getUTCFullYear() + '-' + pad(visibleMonth.getUTCMonth() + 1) + '-' + pad(nextDay);
    let nextValue = candidate(nextDate);
    if (min && nextValue < min) nextValue = min;
    if (max && nextValue > max) nextValue = max;
    update(nextValue);
  };
  const setTime = (nextHour, nextMinute = minute, nextSecond = second) => update(candidate(selectedDate, nextHour, nextMinute, nextSecond));
  const displayDate = (() => {
    if (!parts) return 'Select date and time';
    const date = new Date(Date.UTC(year, month - 1, day));
    if (dateFormat === 'dmy-dot') return pad(day) + '.' + pad(month) + '.' + year;
    if (dateFormat === 'dmy-slash') return pad(day) + '/' + pad(month) + '/' + year;
    if (dateFormat === 'mdy-slash') return pad(month) + '/' + pad(day) + '/' + year;
    if (dateFormat === 'ymd-dash') return year + '-' + pad(month) + '-' + pad(day);
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  })();
  const displayHour = timeFormat === '24h' ? hour : (hour % 12 || 12);
  const setHourDisplay = nextDisplayHour => {
    const nextHour = timeFormat === '24h' ? nextDisplayHour : (nextDisplayHour % 12) + (hour >= 12 ? 12 : 0);
    setTime(nextHour);
  };
  const setPeriod = period => setTime((hour % 12) + (period === 'PM' ? 12 : 0));
  const monthStepAllowed = direction => monthIndex + direction >= minMonth && monthIndex + direction <= maxMonth;
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(current => !current)} className="w-full text-left bg-bg-input border border-border rounded-lg px-3 py-2 text-sm text-text-primary" aria-expanded={open}>
        {parts ? (displayDate + ' ' + (timeFormat === '24h' ? pad(hour) + ':' + pad(minute) : pad(displayHour) + ':' + pad(minute) + ' ' + (hour >= 12 ? 'PM' : 'AM'))) : 'Select date and time'}
      </button>
      {open && <div className="absolute z-50 top-full left-0 mt-2 w-[min(100%,22rem)] min-w-[20rem] rounded-xl border border-border bg-bg-surface shadow-2xl p-3" role="dialog" aria-label="Choose date and time">
        <div className="flex items-center justify-between mb-3">
          <button type="button" disabled={!monthStepAllowed(-1)} onClick={() => setVisibleMonth(new Date(Date.UTC(visibleMonth.getUTCFullYear(), visibleMonth.getUTCMonth() - 1, 1)))} className="px-2 py-1 rounded hover:bg-bg-input disabled:opacity-30" aria-label="Previous month">‹</button>
          <div className="text-sm font-semibold text-text-primary">{monthLabel}</div>
          <button type="button" disabled={!monthStepAllowed(1)} onClick={() => setVisibleMonth(new Date(Date.UTC(visibleMonth.getUTCFullYear(), visibleMonth.getUTCMonth() + 1, 1)))} className="px-2 py-1 rounded hover:bg-bg-input disabled:opacity-30" aria-label="Next month">›</button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-text-muted mb-1">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(label => <div key={label} className="py-1">{label}</div>)}</div>
        <div className="grid grid-cols-7 gap-1">
          {calendarCells.map((calendarDay, index) => {
            if (!calendarDay) return <span key={'empty-' + index} />;
            const dateValue = visibleMonth.getUTCFullYear() + '-' + pad(visibleMonth.getUTCMonth() + 1) + '-' + pad(calendarDay);
            const disabled = (minDate && dateValue < minDate) || (maxDate && dateValue > maxDate);
            const selected = dateValue === selectedDate;
            return <button key={dateValue} type="button" disabled={Boolean(disabled)} onClick={() => changeDate(calendarDay)} className={'h-8 rounded-md text-xs ' + (selected ? 'bg-accent text-white font-semibold' : 'text-text-primary hover:bg-bg-input') + ' disabled:opacity-20 disabled:cursor-not-allowed'}>{calendarDay}</button>;
          })}
        </div>
        <div className="border-t border-border mt-3 pt-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-2">Time · {timeFormat === '24h' ? '24-hour' : '12-hour'}</div>
          <div className="grid gap-2 items-center" style={{ gridTemplateColumns: timeFormat === '24h' ? '1fr auto 1fr auto 1fr' : '1fr auto 1fr auto 1fr auto' }}>
            <select aria-label="Hour" value={displayHour} onChange={event => setHourDisplay(Number(event.target.value))} className="min-w-0 bg-bg-input border border-border rounded-md px-2 py-2 text-sm text-text-primary">
              {(timeFormat === '24h' ? Array.from({length:24},(_,i)=>i) : Array.from({length:12},(_,i)=>i+1)).map(value => <option key={value} value={value}>{pad(value)}</option>)}
            </select>
            <span className="text-text-muted">:</span>
            <select aria-label="Minute" value={minute} onChange={event => setTime(hour,Number(event.target.value))} className="min-w-0 bg-bg-input border border-border rounded-md px-2 py-2 text-sm text-text-primary">
              {Array.from({length:60},(_,i)=>i).map(value => <option key={value} value={value}>{pad(value)}</option>)}
            </select>
            <span className="text-text-muted">:</span>
            <select aria-label="Second" value={second} onChange={event => setTime(hour,minute,Number(event.target.value))} className="min-w-0 bg-bg-input border border-border rounded-md px-2 py-2 text-sm text-text-primary">
              {Array.from({length:60},(_,i)=>i).map(value => <option key={value} value={value}>{pad(value)}</option>)}
            </select>
            {timeFormat !== '24h' && <select aria-label="AM or PM" value={hour >= 12 ? 'PM' : 'AM'} onChange={event => setPeriod(event.target.value)} className="min-w-0 bg-bg-input border border-border rounded-md px-2 py-2 text-sm text-text-primary"><option>AM</option><option>PM</option></select>}
          </div>
        </div>
        <div className="flex justify-end mt-3"><button type="button" onClick={() => setOpen(false)} className="px-3 py-1.5 rounded-md text-xs font-medium bg-bg-input text-text-primary hover:bg-bg-page">Done</button></div>
      </div>}
    </div>
  );
};

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

const ReplayContextChart = ({ candles, replayTime, ticker, timeframe, baseTimeframe, height = 280 }) => {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const visibleCandles = useMemo(() => aggregateCandles(candles.filter(candle => candle.time + timeframeSeconds(baseTimeframe) <= replayTime), timeframe), [candles, replayTime, timeframe]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const border = getCssColor('--border', '#334155');
    const chart = createChart(container, {
      width: Math.max(container.clientWidth, 240), height,
      layout: { background: { type: ColorType.Solid, color: getCssColor('--bg-surface', '#111827') }, textColor: getCssColor('--text-secondary', '#cbd5e1') },
      attributionLogo: true,
      grid: { vertLines: { color: border }, horzLines: { color: border } },
      rightPriceScale: { borderColor: border },
      timeScale: { borderColor: border, timeVisible: true, secondsVisible: timeframeSeconds(timeframe) < 60, rightOffset: 5, barSpacing: 6 },
      crosshair: { mode: 0 }, handleScroll: true, handleScale: true,
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: getCssColor('--positive', '#22c55e'), downColor: getCssColor('--negative', '#ef4444'),
      borderVisible: false, wickUpColor: getCssColor('--positive', '#22c55e'), wickDownColor: getCssColor('--negative', '#ef4444'),
      priceFormat: { type: 'price', precision: getInstrumentSpec(ticker).decimals, minMove: getInstrumentSpec(ticker).tickSize },
    });
    chartRef.current = chart; seriesRef.current = series;
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(entries => {
      const width = entries[0]?.contentRect.width;
      if (width > 0) chart.applyOptions({ width: Math.floor(width) });
    }) : null;
    if (observer) observer.observe(container);
    return () => { if (observer) observer.disconnect(); chart.remove(); chartRef.current = null; seriesRef.current = null; };
  }, []);

  useEffect(() => {
    if (!seriesRef.current) return;
    seriesRef.current.setData(visibleCandles);
    if (chartRef.current) chartRef.current.timeScale().scrollToRealTime();
  }, [visibleCandles]);

  useEffect(() => {
    if (!seriesRef.current) return;
    const spec = getInstrumentSpec(ticker);
    seriesRef.current.applyOptions({ priceFormat: { type: 'price', precision: spec.decimals, minMove: spec.tickSize } });
  }, [ticker]);

  return (
    <div className='min-w-0 rounded-lg border border-border overflow-hidden'>
      <div className='px-3 py-2 border-b border-border text-xs font-semibold text-text-secondary'>{ticker} · {timeframe} <span className='font-normal text-text-muted'>· context</span></div>
      <div ref={containerRef} style={{ height }} className='w-full' />
    </div>
  );
};

const BacktestingReplayWorkspace = () => {
  const [ticker, setTicker] = useState('NQ');
  const [candles, setCandles] = useState([]);
  const [marketBaseCandles, setMarketBaseCandles] = useState([]);
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
  const [historicalDatasets, setHistoricalDatasets] = useState([]);
  const [selectedMarketKey, setSelectedMarketKey] = useState('');
  const [historicalLoading, setHistoricalLoading] = useState(false);
  const [historicalTimeframe, setHistoricalTimeframe] = useState('1m');
  const [historicalStart, setHistoricalStart] = useState('');
  const [historicalEnd, setHistoricalEnd] = useState('');
  const [selectedCoverageIndex, setSelectedCoverageIndex] = useState(0);
  const [replayLayout, setReplayLayout] = useState('single');
  const [contextTimeframes, setContextTimeframes] = useState(['5m', '15m']);
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

  const availableMarkets = useMemo(() => getAvailableMarkets(historicalDatasets), [historicalDatasets]);
  const selectedMarket = useMemo(() => availableMarkets.find(market => market.key === selectedMarketKey) || null, [availableMarkets, selectedMarketKey]);
  const historicalTimeframes = selectedMarket?.availableTimeframes || [];
  const baseTimeframe = selectedMarket?.baseTimeframe || '';
  const selectedCoverage = selectedMarket?.coverage[selectedCoverageIndex] || selectedMarket?.coverage[0] || null;

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await authFetch('/api/market-data/datasets');
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Unable to load historical market-data catalogue.');
        if (cancelled) return;
        const datasets = data.datasets || [];
        setHistoricalDatasets(datasets);
        const markets = getAvailableMarkets(datasets);
        if (markets.length) {
          const preferred = markets.find(market => market.instrument === ticker) || markets[0];
          setSelectedMarketKey(preferred.key);
          setTicker(preferred.instrument);
        }
      } catch (loadError) {
        if (!cancelled) setImportError(loadError.message || 'Unable to load historical market-data catalogue.');
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!selectedMarket) return;
    setTicker(selectedMarket.instrument);
    const first = selectedMarket.coverage[0];
    setSelectedCoverageIndex(0);
    if (first) {
      setHistoricalStart(toDisplayDateTimeInput(first.start));
      setHistoricalEnd(toDisplayDateTimeInput(first.end));
    }
    if (!selectedMarket.availableTimeframes.includes(historicalTimeframe)) setHistoricalTimeframe(selectedMarket.availableTimeframes[0] || '');
  }, [selectedMarketKey, historicalDatasets.length]);

  useEffect(() => {
    if (!selectedMarket || !baseTimeframe || !historicalStart || !historicalEnd) return undefined;
    const startTime = fromDisplayDateTimeInput(historicalStart);
    const endTime = fromDisplayDateTimeInput(historicalEnd);
    if (!startTime || !endTime || !Number.isFinite(startTime.getTime()) || !Number.isFinite(endTime.getTime()) || !isRangeWithinCoverage(startTime.getTime(), endTime.getTime(), selectedCoverage)) return undefined;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setHistoricalLoading(true);
      setImportError('');
      try {
        const params = new URLSearchParams({ start: startTime.toISOString(), end: endTime.toISOString(), instrument: selectedMarket.instrument, timeframe: baseTimeframe });
        params.set('sourceSymbol', selectedMarket.sourceSymbol || '__none__');
        const response = await authFetch('/api/market-data/query?' + params.toString());
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Unable to prepare the selected historical market data.');
        if (cancelled) return;
        const baseCandles = normalizeOhlcvRows(data.bars || []);
        setMarketBaseCandles(baseCandles);
        const normalized = historicalTimeframe === baseTimeframe ? baseCandles : aggregateCandles(baseCandles, historicalTimeframe);
        if (normalized.length < 2) throw new Error('There are not enough historical bars in this period to start replay.');
        setCandles(normalized);
        setCurrentIndex(Math.min(80, normalized.length - 1));
        currentIndexRef.current = Math.min(80, normalized.length - 1);
        setIsPlaying(false);
        setPosition(null); positionRef.current = null;
        setPendingOrder(null); pendingOrderRef.current = null;
        setClosedTrades([]); setStopInput(''); setTargetInput('');
        setMessage('Historical data prepared automatically.');
      } catch (loadError) {
        if (!cancelled) { setMarketBaseCandles([]); setCandles([]); setCurrentIndex(0); currentIndexRef.current = 0; setImportError(loadError.message || 'Unable to prepare historical market data.'); }
      } finally {
        if (!cancelled) setHistoricalLoading(false);
      }
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [selectedMarketKey, baseTimeframe, historicalTimeframe, historicalStart, historicalEnd, selectedCoverage, historicalDatasets.length]);
  const spec = getInstrumentSpec(ticker);
  const currentCandle = candles[currentIndex] || candles[0];
  const replayTime = currentCandle ? currentCandle.time + timeframeSeconds(historicalTimeframe) : 0;
  const contextChartCandles = contextTimeframes.map(timeframe => ({ timeframe, candles: marketBaseCandles }));
  const contextOptions = historicalTimeframes.filter(timeframe => timeframe !== historicalTimeframe);

  useEffect(() => {
    if (!historicalTimeframes.length) {
      setContextTimeframes([]);
      return;
    }
    const choices = historicalTimeframes.filter(timeframe => timeframe !== historicalTimeframe);
    setContextTimeframes(previous => {
      const retained = previous.filter(timeframe => choices.includes(timeframe));
      const defaults = choices.filter(timeframe => ['5m', '15m'].includes(timeframe));
      return [...new Set([...retained, ...defaults, ...choices])].slice(0, 2);
    });
  }, [historicalTimeframes.join(','), historicalTimeframe]);
  const currentPrice = currentCandle ? currentCandle.close : 0;
  const intervalSeconds = useMemo(() => getIntervalSeconds(candles), [candles]);
  const intervalLabel = historicalTimeframe || formatInterval(intervalSeconds);
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

  const resetForMarketChange = () => {
    setIsPlaying(false); setPosition(null); positionRef.current = null;
    setPendingOrder(null); pendingOrderRef.current = null; setClosedTrades([]);
    setStopInput(''); setTargetInput(''); setMessage(''); setError('');
    setCandles([]); setMarketBaseCandles([]); setCurrentIndex(0); currentIndexRef.current = 0;
  };

  const handleMarketChange = event => {
    const market = availableMarkets.find(item => item.key === event.target.value);
    if (!market) return;
    resetForMarketChange();
    setSelectedMarketKey(market.key);
    setTicker(market.instrument);
  };

  const handleCoverageChange = event => {
    const index = Number(event.target.value);
    const range = selectedMarket?.coverage[index];
    if (!range) return;
    setSelectedCoverageIndex(index);
    setHistoricalStart(toDisplayDateTimeInput(range.start));
    setHistoricalEnd(toDisplayDateTimeInput(range.end));
    resetForMarketChange();
  };

  const handleDateChange = (setter, value) => {
    const nextDate = fromDisplayDateTimeInput(value);
    if (!nextDate || !selectedCoverage
      || nextDate.getTime() < selectedCoverage.start
      || nextDate.getTime() > selectedCoverage.end) return;
    if (setter === setHistoricalStart) {
      setHistoricalStart(value);
      const currentEnd = fromDisplayDateTimeInput(historicalEnd);
      if (currentEnd && nextDate > currentEnd) setHistoricalEnd(value);
    } else {
      setHistoricalEnd(value);
      const currentStart = fromDisplayDateTimeInput(historicalStart);
      if (currentStart && nextDate < currentStart) setHistoricalStart(value);
    }
    resetForMarketChange();
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
    if (!candles.length) { setError('Select an available historical market and period before placing a trade.'); return; }
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
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="space-y-1">
            <span className="block text-text-tertiary text-[11px] font-semibold uppercase tracking-wider">Market / ticker</span>
            <select value={selectedMarketKey} onChange={handleMarketChange} disabled={!availableMarkets.length || historicalLoading} className="w-full bg-bg-input border border-border rounded-lg px-3 py-2 text-sm text-text-primary">
              {!availableMarkets.length && <option value="">No historical markets available</option>}
              {availableMarkets.map(market => <option key={market.key} value={market.key}>{market.label}</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <span className="block text-text-tertiary text-[11px] font-semibold uppercase tracking-wider">Chart timeframe</span>
            <select value={historicalTimeframe} onChange={event => { setHistoricalTimeframe(event.target.value); resetForMarketChange(); }} disabled={!historicalTimeframes.length || historicalLoading} className="w-full bg-bg-input border border-border rounded-lg px-3 py-2 text-sm text-text-primary">
              {historicalTimeframes.map(value => <option key={value} value={value}>{value}{value === baseTimeframe ? ' · source' : ' · aggregated'}</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <span className="block text-text-tertiary text-[11px] font-semibold uppercase tracking-wider">Chart layout</span>
            <select value={replayLayout} onChange={event => setReplayLayout(event.target.value)} className="w-full bg-bg-input border border-border rounded-lg px-3 py-2 text-sm text-text-primary">
              <option value="single">Single chart</option>
              <option value="split2" disabled={!contextOptions.length}>2 charts</option>
              <option value="split3" disabled={contextOptions.length < 2}>3 charts</option>
            </select>
          </label>
          {selectedMarket?.coverage.length > 1 && <label className="space-y-1">
            <span className="block text-text-tertiary text-[11px] font-semibold uppercase tracking-wider">Continuous data period</span>
            <select value={selectedCoverageIndex} onChange={handleCoverageChange} disabled={historicalLoading} className="w-full bg-bg-input border border-border rounded-lg px-3 py-2 text-sm text-text-primary">
              {selectedMarket.coverage.map((range, index) => <option key={index} value={index}>{formatDateEST(range.start)} {formatTimeEST(range.start)} – {formatDateEST(range.end)} {formatTimeEST(range.end)}</option>)}
            </select>
          </label>}
          <div className="space-y-1">
            <span className="block text-text-tertiary text-[11px] font-semibold uppercase tracking-wider">Available data</span>
            <div className="bg-bg-input border border-border rounded-lg px-3 py-2 text-xs text-text-secondary">
              {selectedCoverage ? formatDateEST(selectedCoverage.start) + ' – ' + formatDateEST(selectedCoverage.end) : 'No historical data'}
            </div>
          </div>
          <label className="space-y-1">
            <span className="block text-text-tertiary text-[11px] font-semibold uppercase tracking-wider">From · {getDisplayTimeZone()}</span>
            <ReplayDateTimePicker value={historicalStart} onChange={value => handleDateChange(setHistoricalStart, value)} min={selectedCoverage ? toDisplayDateTimeInput(selectedCoverage.start) : undefined} max={selectedCoverage ? toDisplayDateTimeInput(selectedCoverage.end) : undefined} dateFormat={getDateFormat()} timeFormat={getTimeFormat()} />
          </label>
          <label className="space-y-1">
            <span className="block text-text-tertiary text-[11px] font-semibold uppercase tracking-wider">To · {getDisplayTimeZone()}</span>
            <ReplayDateTimePicker value={historicalEnd} onChange={value => handleDateChange(setHistoricalEnd, value)} min={selectedCoverage ? toDisplayDateTimeInput(selectedCoverage.start) : undefined} max={selectedCoverage ? toDisplayDateTimeInput(selectedCoverage.end) : undefined} dateFormat={getDateFormat()} timeFormat={getTimeFormat()} />
          </label>
          <div className="flex items-end text-xs text-text-muted">
            {historicalLoading ? 'Preparing historical data…' : selectedMarket ? 'Data loads automatically when you change a selection.' : 'Import data under Settings → Providers → Historical Futures.'}
          </div>
        </div>
        {selectedMarket?.coverage.length > 1 && <p className="text-[11px] text-text-muted">Choose a continuous data period. The date controls are restricted to that period, so replay cannot cross a known coverage gap.</p>}
        {!availableMarkets.length && <div className="rounded-lg border border-border bg-bg-page px-3 py-4 text-sm text-text-muted">No historical OHLCV markets are available yet. Add data under Settings → Providers → Historical Futures. Available markets and periods will appear here automatically.</div>}
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
          <div className={replayLayout === 'single' ? 'grid grid-cols-1 gap-3' : replayLayout === 'split2' ? 'grid grid-cols-1 xl:grid-cols-2 gap-3' : 'grid grid-cols-1 xl:grid-cols-3 gap-3'}>
            <div className="min-w-0">
              <div className="mb-2 text-xs font-semibold text-text-secondary">{ticker} · {historicalTimeframe} <span className="font-normal text-text-muted">· execution</span></div>
              <div ref={chartContainerRef} className="w-full h-[430px]" />
            </div>
            {replayLayout !== 'single' && contextChartCandles.slice(0, replayLayout === 'split2' ? 1 : 2).map(item => (
              <div key={item.timeframe} className="min-w-0">
                <div className="mb-2">
                  <label className="block text-[10px] text-text-muted uppercase tracking-wider mb-1">Context timeframe</label>
                  <select value={item.timeframe} onChange={event => setContextTimeframes(previous => previous.map(value => value === item.timeframe ? event.target.value : value))} className="w-full bg-bg-input border border-border rounded-lg px-2 py-1.5 text-xs text-text-primary">
                    {contextOptions.map(value => <option key={value} value={value}>{value}</option>)}
                  </select>
                </div>
                <ReplayContextChart candles={item.candles} replayTime={replayTime} ticker={ticker} timeframe={item.timeframe} baseTimeframe={baseTimeframe} height={430} />
              </div>
            ))}
          </div>
          <div className="px-3 py-2 border-t border-border text-[10px] text-text-muted">
            TradingView Lightweight Charts™ · Copyright (c) 2025 TradingView, Inc. · <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer" className="text-accent hover:underline">tradingview.com</a>
          </div>
          <div className="px-4 py-3 border-t border-border flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setIsPlaying(value => !value)} disabled={!candles.length || (!isPlaying && currentIndex >= candles.length - 1)} aria-label={isPlaying ? 'Pause replay' : 'Play replay'} className="w-10 h-10 inline-flex items-center justify-center rounded-lg bg-accent text-accent-text text-sm font-semibold disabled:opacity-40">{isPlaying ? 'Ⅱ' : '▶'}</button>
            <button type="button" onClick={advanceOne} disabled={!candles.length || currentIndex >= candles.length - 1} className="px-3 py-2 rounded-lg border border-border text-sm text-text-secondary hover:text-text-primary">Step +1</button>
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
              disabled={!candles.length || !canSeek}
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
            {!position && !pendingOrder ? <div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => openPosition('long')} className="py-2.5 rounded-lg bg-positive text-white text-sm font-semibold disabled:opacity-40" disabled={!candles.length}>BUY {quantity} @ {orderType === 'stop_market' ? 'STOP' : orderType.toUpperCase()}</button><button type="button" onClick={() => openPosition('short')} className="py-2.5 rounded-lg bg-negative text-white text-sm font-semibold disabled:opacity-40" disabled={!candles.length}>SELL {quantity} @ {orderType === 'stop_market' ? 'STOP' : orderType.toUpperCase()}</button></div> : pendingOrder ? <div className="rounded-lg bg-bg-input p-3 text-xs space-y-2"><div className="flex justify-between"><span className="text-text-muted">Pending {pendingOrder.type.replace('_', ' ')}</span><strong>{pendingOrder.direction.toUpperCase()} × {pendingOrder.quantity}</strong></div><div className="flex justify-between"><span className="text-text-muted">Order price</span><span className="font-mono">{formatPrice(pendingOrder.triggerPrice, spec.decimals)}</span></div><button type="button" onClick={() => { setPendingOrder(null); pendingOrderRef.current = null; setMessage('Pending order cancelled.'); }} className="w-full py-2 rounded-lg border border-border text-sm text-text-secondary">Cancel pending order</button></div> : <div className="space-y-2"><div className="rounded-lg bg-bg-input p-3 text-xs space-y-1"><div className="flex justify-between"><span className="text-text-muted">Open position</span><strong className={position.direction === 'long' ? 'text-positive' : 'text-negative'}>{position.direction.toUpperCase()} × {position.quantity}</strong></div><div className="flex justify-between"><span className="text-text-muted">Entry</span><span className="font-mono">{formatPrice(position.entryPrice, spec.decimals)}</span></div><div className="flex justify-between"><span className="text-text-muted">Unrealized P/L</span><strong className={unrealizedPnl >= 0 ? 'text-positive' : 'text-negative'}>{formatMoney(unrealizedPnl)}</strong></div></div><button type="button" onClick={updatePositionLevels} className="w-full py-2 rounded-lg border border-border text-sm text-text-secondary hover:text-text-primary">Update SL / TP levels</button><button type="button" onClick={() => closePosition(position, currentPrice, currentCandle.time, 'Manual close')} className="w-full py-2.5 rounded-lg bg-accent text-accent-text text-sm font-semibold">Close position</button></div>}
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
