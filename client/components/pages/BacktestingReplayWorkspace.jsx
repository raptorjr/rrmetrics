const React = require('react');
const { useCallback, useEffect, useMemo, useRef, useState } = React;
const { authFetch } = require('../../helper.js');
const ReplayTradeCanvasGrid = require('./ReplayTradeCanvasGrid').default;
const {
  getInstrumentSpec,
  normalizeOhlcvRows,
  applyReplayFill, advanceReplayOrders, seedReplayOrderPrice, replayBreakevenPrice,
  calculateTradePnl,
  calculateTradeStats,
  snapReplayPrice, validateReplayLevels, validateReplayEntry, validateReplayOrderDraft, updateReplayLevels, canMoveToBreakeven, replayOrderMenu,
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
  const pickerRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = event => {
      if (!pickerRef.current?.contains(event.target)) setOpen(false);
    };
    const handleKeyDown = event => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);
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
    <div ref={pickerRef} className="relative">
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
  const currentIndexRef = useRef(80);
  const candlesRef = useRef(candles);
  const positionRef = useRef(null);
  const pendingOrderRef = useRef(null);
  const advanceOneRef = useRef(null);
  const orderSequence = useRef(0);

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
        candlesRef.current = normalized;
        setCandles(normalized);
        setCurrentIndex(0);
        currentIndexRef.current = 0;
        setIsPlaying(false);
        setPosition(null); positionRef.current = null;
        setPendingOrder(null); pendingOrderRef.current = null;
        setClosedTrades([]); 
        setOrderType('market'); setOrderPrice('');
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
  const currentPrice = currentCandle ? currentCandle.close : 0;
  const intervalSeconds = useMemo(() => getIntervalSeconds(candles), [candles]);
  const intervalLabel = historicalTimeframe || formatInterval(intervalSeconds);
  const stats = useMemo(() => calculateTradeStats(closedTrades), [closedTrades]);
  const unrealizedPnl = position ? calculateTradePnl(position, currentPrice, spec.pointValue) : 0;
  const initialIndex = 0;
  const canSeek = !position && !pendingOrder && closedTrades.length === 0;

  useEffect(() => { candlesRef.current = candles; }, [candles]);
  useEffect(() => { currentIndexRef.current = currentIndex; }, [currentIndex]);
  useEffect(() => { positionRef.current = position; }, [position]);
  useEffect(() => { pendingOrderRef.current = pendingOrder; }, [pendingOrder]);

  const commitFill = useCallback((result, reason, price) => {
    if (result.error) { setError(result.error); return; }
    positionRef.current = result.position; setPosition(result.position);
    if (result.trade) {
      setClosedTrades(previous => previous.concat(result.trade));
      setMessage('Position closed: ' + reason + ' · ' + formatMoney(result.trade.pnl));
      // Never let an adjustment survive a flat position.
      pendingOrderRef.current = null; setPendingOrder(null);
    } else {
      setMessage(reason + ' @ ' + formatPrice(price, spec.decimals) + ' · ' + result.position.quantity + ' open');
    }
    setError('');
  }, [spec.decimals]);

  const closePosition = useCallback((activePosition, exitPrice, exitTime, reason) => {
    const result = applyReplayFill(activePosition, {
      direction: activePosition.direction === 'long' ? 'short' : 'long', quantity: activePosition.quantity,
    }, exitPrice, exitTime, spec, reason);
    commitFill(result, reason, exitPrice);
  }, [spec, commitFill]);

  const advanceOne = useCallback(() => {
    const nextIndex = currentIndexRef.current + 1;
    const data = candlesRef.current;
    if (nextIndex >= data.length) { setIsPlaying(false); return; }
    currentIndexRef.current = nextIndex; setCurrentIndex(nextIndex);
    const result = advanceReplayOrders(positionRef.current, pendingOrderRef.current, data[nextIndex], spec);
    if (result) {
      pendingOrderRef.current = result.pendingOrder; setPendingOrder(result.pendingOrder);
      if (result.error) setError(result.error);
      else commitFill(result, result.reason, result.price);
    }
    if (nextIndex >= data.length - 1) setIsPlaying(false);
  }, [spec, commitFill]);

  useEffect(() => { advanceOneRef.current = advanceOne; }, [advanceOne]);

  useEffect(() => {
    if (!isPlaying) return undefined;
    const interval = setInterval(() => {
      if (advanceOneRef.current) advanceOneRef.current();
    }, Math.max(50, Math.round(1000 / speed)));
    return () => clearInterval(interval);
  }, [isPlaying, speed]);

  const resetForMarketChange = () => {
    setIsPlaying(false); setPosition(null); positionRef.current = null;
    setPendingOrder(null); pendingOrderRef.current = null; setClosedTrades([]);
     setMessage(''); setError('');
    candlesRef.current = [];
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
  const latestCandle = () => candlesRef.current[currentIndexRef.current];
  const changeOrderType = type => {
    setOrderType(type);
    setOrderPrice(seedReplayOrderPrice(type, latestCandle()?.close, spec));
    setError('');
  };

  const resetOrderPrice = () => {
    if (pendingOrderRef.current) return;
    setOrderPrice(seedReplayOrderPrice(orderType, latestCandle()?.close, spec));
    setError('');
  };

  const openPosition = (direction, options = {}) => {
    const candle = latestCandle();
    if (!candle || historicalLoading) { setError('Select an available historical market and period before placing a trade.'); return; }
    if (pendingOrderRef.current) return;
    const active = positionRef.current;
    const parsedQuantity = Number(options.quantity ?? quantity);
    const type = options.type ?? orderType;
    const { triggerPrice, error: orderError } = validateReplayOrderDraft(active, direction, parsedQuantity, type, options.price ?? orderPrice, candle.close, spec);
    if (orderError) { setError(orderError); return; }
    const order = { id: 'replay-' + (++orderSequence.current), direction, quantity: parsedQuantity, type, triggerPrice, stopPrice: null, targetPrice: null, positionId: active?.id ?? null };
    setQuantity(parsedQuantity); setOrderType(type); setOrderPrice(type === 'market' ? '' : String(triggerPrice));
    if (type === 'market') {
      const reason = !active ? 'Market entry' : active.direction === direction ? 'Scale in' : 'Scale out';
      commitFill(applyReplayFill(active, order, candle.close, candle.time, spec, reason), reason, candle.close);
    } else {
      pendingOrderRef.current = order; setPendingOrder(order);
      setMessage((direction === 'long' ? 'Buy' : 'Sell') + ' ' + type.replace('_', ' ') + ' order placed at ' + formatPrice(triggerPrice, spec.decimals) + '.');
      setError('');
    }
  };

  const applyPositionLevels = (id, changes) => {
    const active = positionRef.current, candle = latestCandle();
    if (!active || active.id !== id || !candle) return;
    const result = updateReplayLevels(active, changes, candle.close, spec);
    if (result.error) { setError(result.error); return; }
    positionRef.current = result.position; setPosition(result.position);
    setError(''); setMessage('Position levels updated.');
  };

  const moveToBreakeven = () => {
    const active = positionRef.current, candle = latestCandle();
    if (!canMoveToBreakeven(active, candle?.close, spec)) return;
    applyPositionLevels(active.id, { stopPrice: replayBreakevenPrice(active, spec) });
  };

  const modifyPendingOrder = ({ orderId, newPrice }) => {
    const order = pendingOrderRef.current, candle = latestCandle();
    if (!order || order.id !== orderId || !candle) return;
    const price = snapReplayPrice(newPrice, spec);
    const error = validateReplayEntry(order.direction, order.type, price, candle.close)
      || validateReplayLevels(order.direction, price, order.stopPrice, order.targetPrice);
    if (error) { setError(error); return; }
    const updated = { ...order, triggerPrice: price };
    pendingOrderRef.current = updated; setPendingOrder(updated);
    setOrderPrice(String(price)); setError(''); setMessage('Pending order moved.');
  };

  const cancelPendingOrder = (id) => {
    if (!pendingOrderRef.current || pendingOrderRef.current.id !== id) return;
    pendingOrderRef.current = null; setPendingOrder(null); setError(''); setMessage('Pending order cancelled.');
  };

  const closeFromChart = (id) => {
    const active = positionRef.current, candle = latestCandle();
    if (active?.id === id && candle) closePosition(active, candle.close, candle.time, 'Manual close');
  };

  const chartMenuItems = (context) => {
    const candle = latestCandle();
    if (historicalLoading || !candle || context.price == null) return [];
    const price = snapReplayPrice(context.price, spec);
    if (!Number.isFinite(price) || price <= 0) return [];
    const active = positionRef.current, pending = pendingOrderRef.current;
    if (active) {
      const items = [];
      if (price !== candle.close) {
        const stopSide = active.direction === 'long' ? price < candle.close : price > candle.close;
        const field = stopSide ? 'stopPrice' : 'targetPrice';
        const label = stopSide ? 'Stop loss' : 'Take profit';
        items.push({ label: (active[field] == null ? 'Set ' : 'Move ') + label + ' @ ' + formatPrice(price, spec.decimals),
          onSelect: () => applyPositionLevels(active.id, { [field]: price }) });
      }
      if (canMoveToBreakeven(active, candle.close, spec)) items.push({ label: 'Move stop to BE', onSelect: () => {
        const current = positionRef.current;
        if (current?.id === active.id) moveToBreakeven();
      } });
      if (pending) items.push({ label: 'Cancel pending order', onSelect: () => cancelPendingOrder(pending.id) });
      items.push({ label: 'Close position at market', onSelect: () => closeFromChart(active.id) });
      return items;
    }
    if (pending) return [{ label: 'Cancel pending order', onSelect: () => cancelPendingOrder(pending.id) }];
    // A menu opened on a previous market/session must not submit after data changes.
    const sessionBars = candlesRef.current;
    return replayOrderMenu(price, candle.close, quantityPresets, quantity,
      value => formatPrice(value, spec.decimals), order => {
        if (candlesRef.current === sessionBars) openPosition(order.direction, order);
      });
  };

  const resetReplay = () => {
    if ((closedTrades.length || position || pendingOrder) && !window.confirm('Reset replay and clear all orders and trades from this temporary session?')) return;
    setIsPlaying(false);
    setCurrentIndex(initialIndex);
    currentIndexRef.current = initialIndex;
    setPosition(null);
    positionRef.current = null;
    setClosedTrades([]);
    setPendingOrder(null);
    pendingOrderRef.current = null;
    setError('');
    setOrderType('market'); setOrderPrice('');
    setMessage('Replay reset.');
  };

  const adjustQuantity = delta => setQuantity(value => Math.max(1, Math.min(100, Number(value) + delta)));
  const savePresets = () => {
    const values = presetDraft.map(Number);
    if (values.some(value => !Number.isInteger(value) || value < 1 || value > 100)) { setError('Each preset must be a whole number from 1 to 100.'); return; }
    setQuantityPresets(values); setQuantity(values[0]); setEditingPresets(false); setError('');
  };

  const realizedOpenPnl = position?.realizedPnl ?? 0;
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
          <ReplayTradeCanvasGrid
            ticker={ticker}
            timeframe={historicalTimeframe}
            baseCandles={marketBaseCandles}
            replayTime={replayTime}
            baseTimeframe={baseTimeframe}
            position={position}
            pendingOrder={pendingOrder}
            spec={spec}
            currentPrice={currentPrice}
            chartMenuItems={chartMenuItems}
            onOrderModify={modifyPendingOrder}
            onOrderCancel={({ orderId }) => cancelPendingOrder(orderId)}
            onPositionModify={({ positionId, stopLoss, takeProfit }) => applyPositionLevels(positionId, { stopPrice: stopLoss, targetPrice: takeProfit })}
            onPositionClose={({ positionId }) => closeFromChart(positionId)}
          />
          <div className="px-4 py-3 border-t border-border space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => {
                if (!canSeek || !window.confirm('Jump to the beginning of this replay? The chart will return to the first candle.')) return;
                setIsPlaying(false);
                currentIndexRef.current = 0;
                setCurrentIndex(0);
              }} disabled={!candles.length || !canSeek || currentIndex === 0} title="Jump to beginning" aria-label="Jump to beginning" className="w-10 h-10 inline-flex items-center justify-center rounded-lg border border-border text-text-secondary hover:text-text-primary disabled:opacity-30"><span aria-hidden="true" className="text-xl leading-none tracking-[-0.12em]">||◀</span></button>
              <button type="button" onClick={() => { if (!canSeek) return; setIsPlaying(false); const next = Math.max(0, currentIndexRef.current - 1); currentIndexRef.current = next; setCurrentIndex(next); }} disabled={!candles.length || !canSeek || currentIndex === 0} title="Previous candle" aria-label="Previous candle" className="w-10 h-10 inline-flex items-center justify-center rounded-lg border border-border text-text-secondary hover:text-text-primary disabled:opacity-30"><span aria-hidden="true" className="inline-block rotate-180 text-xl leading-none">▶|</span></button>
              <button type="button" onClick={() => setIsPlaying(value => !value)} disabled={!candles.length || (!isPlaying && currentIndex >= candles.length - 1)} aria-label={isPlaying ? 'Pause replay' : 'Play replay'} className="w-10 h-10 inline-flex items-center justify-center rounded-lg bg-accent text-accent-text text-sm font-semibold disabled:opacity-40">{isPlaying ? 'Ⅱ' : '▶'}</button>
              <button type="button" onClick={() => { setIsPlaying(false); advanceOne(); }} disabled={!candles.length || currentIndex >= candles.length - 1} title="Next candle" aria-label="Next candle" className="w-10 h-10 inline-flex items-center justify-center rounded-lg border border-border text-text-secondary hover:text-text-primary disabled:opacity-30"><span aria-hidden="true" className="text-xl leading-none">▶|</span></button>
              <button type="button" onClick={resetReplay} title="Reset replay and clear simulated trades" aria-label="Reset replay" className="w-9 h-9 inline-flex items-center justify-center rounded-lg border border-border text-text-secondary hover:text-text-primary">↺</button>
              <div className="ml-auto flex items-center gap-2 text-xs text-text-muted">
                <label htmlFor="replay-speed">Bars/sec</label>
                <select id="replay-speed" value={speed} onChange={event => setSpeed(Number(event.target.value))} className="bg-bg-input border border-border rounded-lg px-2 py-2 text-text-primary">
                  <option value="0.25">0.25</option>
                  <option value="0.5">0.5</option>
                  <option value="1">1</option>
                  <option value="2">2</option>
                  <option value="5">5</option>
                  <option value="10">10</option>
                  <option value="20">20</option>
                </select>
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 text-xs">
              <div className="min-w-0">
                <div className="font-medium text-text-primary">{currentCandle ? formatBarTime(currentCandle.time) : 'Waiting for historical data'}</div>
                <div className="text-text-muted">{candles.length ? (currentIndex + 1).toLocaleString() + ' of ' + candles.length.toLocaleString() + ' candles' : 'No candles loaded'}</div>
              </div>
              <div className="text-right text-text-muted">{candles.length ? Math.round((currentIndex / Math.max(1, candles.length - 1)) * 100) + '%' : '—'}</div>
            </div>
            <input
              type="range"
              min="0"
              max={Math.max(0, candles.length - 1)}
              value={currentIndex}
              disabled={!candles.length || !canSeek}
              onChange={event => {
                setIsPlaying(false);
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
            {!canSeek && <div className="text-[10px] text-text-muted">Rewind and seeking are disabled after a simulated trade to preserve execution history. Reset to start over.</div>}
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-bg-surface border border-border rounded-xl p-4 space-y-3">
            <h3 className="text-text-primary font-semibold text-sm">Order entry</h3>
            <div className={orderType === 'market' ? 'grid grid-cols-1' : 'grid grid-cols-2 gap-2'}>
              <div><label className="block text-text-tertiary text-[11px] font-semibold uppercase tracking-wider mb-1">Order type</label><select aria-label="Order type" value={orderType} disabled={!!pendingOrder} onChange={event => changeOrderType(event.target.value)} className="w-full bg-bg-input border border-border rounded-lg px-2 py-2 text-sm text-text-primary"><option value="market">Market</option><option value="limit">Limit</option><option value="stop_market">Stop Market</option></select></div>
              {orderType !== 'market' && <div><label className="block text-text-tertiary text-[11px] font-semibold uppercase tracking-wider mb-1">Order price</label><div className="flex items-center gap-1"><input aria-label="Order price" type="number" step={spec.tickSize} value={orderPrice} disabled={!!pendingOrder} onChange={event => { setOrderPrice(event.target.value); setError(''); }} className="w-full min-w-0 bg-bg-input border border-border rounded-lg px-2 py-2 text-sm text-text-primary" placeholder="Price" /><button type="button" aria-label="Reset to current market price" title="Reset to current market price" disabled={!!pendingOrder || historicalLoading || !currentPrice} onClick={resetOrderPrice} className="shrink-0 w-7 h-9 rounded-lg border border-border text-text-muted hover:text-text-primary disabled:opacity-40 flex items-center justify-center"><svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 7v5h-5M4 17v-5h5M6 8a7 7 0 0 1 11.5-2L20 9M4 15l2.5 3A7 7 0 0 0 18 16"/></svg></button></div></div>}
            </div>
            {orderType !== 'market' && <div className="flex items-center justify-between text-xs"><span className="text-text-muted">Current market price</span><span className="text-text-secondary tabular-nums">{currentPrice > 0 ? formatPrice(currentPrice, spec.decimals) : '—'}</span></div>}
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => adjustQuantity(-1)} disabled={!!pendingOrder || quantity <= 1} className="w-7 h-8 shrink-0 rounded-full border border-border text-text-primary disabled:opacity-40" aria-label="Decrease contracts">−</button>
              <div className="flex flex-1 justify-center gap-1 min-w-0">{quantityPresets.map((preset, index) => <button key={index} type="button" onClick={() => setQuantity(preset)} disabled={!!pendingOrder} className={"min-w-0 flex-1 h-8 px-1 rounded-full text-xs font-semibold disabled:opacity-40 " + (quantity === preset ? 'bg-accent text-accent-text' : 'bg-bg-input text-text-secondary hover:text-text-primary')}>{preset}</button>)}</div>
              <button type="button" onClick={() => adjustQuantity(1)} disabled={!!pendingOrder || quantity >= 100} className="w-7 h-8 shrink-0 rounded-full border border-border text-text-primary disabled:opacity-40" aria-label="Increase contracts">+</button>
              <button type="button" onClick={() => { setPresetDraft(quantityPresets.map(String)); setEditingPresets(value => !value); }} disabled={!!pendingOrder} className="w-6 h-8 shrink-0 rounded-lg text-text-muted hover:text-text-primary disabled:opacity-40" title="Edit contract presets" aria-label="Edit contract presets">✎</button>
            </div>
            {editingPresets && <div className="rounded-lg border border-border bg-bg-input p-3 space-y-2"><div className="text-xs font-semibold text-text-secondary">Contract presets</div><div className="grid grid-cols-5 gap-2">{presetDraft.map((value, index) => <input key={index} type="number" min="1" max="100" step="1" value={value} onChange={event => setPresetDraft(previous => previous.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} className="min-w-0 w-full rounded border border-border bg-bg-surface px-1 py-2 text-center text-sm text-text-primary" aria-label={"Preset " + (index + 1)} />)}</div><div className="flex justify-end gap-2"><button type="button" onClick={() => setEditingPresets(false)} className="px-3 py-1.5 text-xs text-text-muted">Cancel</button><button type="button" onClick={savePresets} className="px-3 py-1.5 rounded bg-accent text-accent-text text-xs font-semibold">Save</button></div></div>}
            <div className="grid grid-cols-2 gap-2">
              {['long', 'short'].map(direction => {
                const { error: draftError } = validateReplayOrderDraft(position, direction, quantity, orderType, orderPrice, currentPrice, spec);
                const disabled = !candles.length || historicalLoading || !!pendingOrder || !!draftError;
                const action = !position ? '' : position.direction === direction ? 'Add' : quantity === position.quantity ? 'Close' : 'Reduce';
                return <button key={direction} type="button" onClick={() => openPosition(direction)} title={pendingOrder ? 'Cancel the working order before submitting another.' : draftError || undefined} disabled={disabled} className={'py-2 rounded-lg text-white text-sm font-semibold disabled:opacity-40 ' + (direction === 'long' ? 'bg-positive' : 'bg-negative')}>
                  {direction === 'long' ? 'BUY' : 'SELL'} {quantity} @ {orderType === 'stop_market' ? 'STOP' : orderType.toUpperCase()}
                  {action && <span className="block text-[10px] font-normal opacity-80">{action}</span>}
                </button>;
              })}
            </div>
            {!pendingOrder && orderType !== 'market' && <p className="text-[11px] text-text-muted">{orderType === 'limit' ? 'Buy below · Sell above market' : 'Buy above · Sell below market'}{snapReplayPrice(orderPrice, spec) === currentPrice && currentPrice > 0 ? ' — adjust the order price' : ''}</p>}
            {pendingOrder && <div className="rounded-lg bg-bg-input p-3 text-xs space-y-2"><div className="flex justify-between"><span className="text-text-muted">Pending {pendingOrder.type.replace('_', ' ')}</span><strong>{pendingOrder.direction.toUpperCase()} × {pendingOrder.quantity}</strong></div><div className="flex justify-between"><span className="text-text-muted">Order price</span><span className="font-mono">{formatPrice(pendingOrder.triggerPrice, spec.decimals)}</span></div><button type="button" onClick={() => cancelPendingOrder(pendingOrder.id)} className="w-full py-2 rounded-lg bg-negative text-white text-sm font-semibold hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">Cancel pending order</button></div>}
            {position && <div className="space-y-2"><div className="rounded-lg bg-bg-input p-3 text-xs space-y-1"><div className="flex justify-between"><span className="text-text-muted">Open position</span><strong className={position.direction === 'long' ? 'text-positive' : 'text-negative'}>{position.direction.toUpperCase()} × {position.quantity}</strong></div><div className="flex justify-between"><span className="text-text-muted">Avg entry</span><span className="font-mono">{formatPrice(position.entryPrice, spec.decimals)}</span></div><div className="flex justify-between"><span className="text-text-muted">Unrealized P/L</span><strong className={unrealizedPnl >= 0 ? 'text-positive' : 'text-negative'}>{formatMoney(unrealizedPnl)}</strong></div>{position.fills?.some(fill => fill.kind === 'exit') && <div className="flex justify-between"><span className="text-text-muted">Realized P/L</span><strong className={realizedOpenPnl >= 0 ? 'text-positive' : 'text-negative'}>{formatMoney(realizedOpenPnl)}</strong></div>}</div>
              <div className="flex gap-2"><button type="button" onClick={() => closeFromChart(position.id)} className="flex-1 py-2 rounded-lg bg-accent text-accent-text text-sm font-semibold">Close position</button><button type="button" title="Move stop to remaining average entry (rounded to a protective tick, before fees)" disabled={!canMoveToBreakeven(position, currentPrice, spec)} onClick={moveToBreakeven} className="px-5 py-2 rounded-lg border border-border text-sm font-semibold text-text-primary disabled:opacity-40">BE</button></div>
            </div>}
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
            {position && position.fills?.some(fill => fill.kind === 'exit') && <div className="flex justify-between text-xs"><span className="text-text-muted">Realized on open trade (not included above)</span><strong className={realizedOpenPnl >= 0 ? 'text-positive' : 'text-negative'}>{formatMoney(realizedOpenPnl)}</strong></div>}
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
        <p>First-stage replay prototype: simulated trades and statistics are temporary and are not saved to the database yet. Scaling is supported; one completed trade is recorded when flat. Fees, slippage, exchange partial fills and tick-by-tick execution are not modelled.</p>
        <p>When a stop and target are both inside the same candle, the replay assumes the stop was hit first. This is deliberately conservative; tick data will allow more precise sequencing later.</p>
      </div>
    </div>
  );
};

export default BacktestingReplayWorkspace;
