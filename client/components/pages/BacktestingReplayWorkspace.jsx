const React = require('react');
const { useCallback, useEffect, useMemo, useRef, useState } = React;
const { createPortal } = require('react-dom');
const {useConfirm}=require('../shared/AppModal');
const {allowedMinutes,closestAllowedTime}=require('../../utils/replayAccountPresentation');
const { replayDatePopupPosition } = require('../../utils/replayDatePopup');
const { authFetch } = require('../../helper.js');
const ReplayTradeCanvasGrid = require('./ReplayTradeCanvasGrid').default;
const ReplayTradeHistory = require('../shared/ReplayTradeHistory');
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
const { nextGoToIndex } = require('../../utils/replayGoTo');
const { getSessionMarkets, isRangeWithinCoverage, aggregateCandles, timeframeSeconds, replaySpeedAtPercent, replaySpeedPercent, restoreReplaySpeed, replayStepBudget, resetReplayChartLayout } = require('../../utils/historicalReplay');

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
  const pickerRef = useRef(null), popupRef=useRef(null), triggerRef=useRef(null);
  const [popupStyle,setPopupStyle]=useState({visibility:'hidden'});
  React.useLayoutEffect(()=>{
    if(!open)return;
    const place=()=>{
      const trigger=triggerRef.current,popup=popupRef.current;
      if(!trigger||!popup)return;
      setPopupStyle(replayDatePopupPosition(trigger.getBoundingClientRect(),popup.scrollHeight,window.innerWidth,window.innerHeight));
    };
    place();window.addEventListener('resize',place);window.addEventListener('scroll',place,true);
    const observer=typeof ResizeObserver!=='undefined'?new ResizeObserver(place):null;
    if(observer&&popupRef.current)observer.observe(popupRef.current);
    return()=>{window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);observer?.disconnect();};
  },[open]);
  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = event => {
      if (!pickerRef.current?.contains(event.target)&&!popupRef.current?.contains(event.target)) setOpen(false);
    };
    const handleKeyDown = event => {
      if (event.key === 'Escape') {setOpen(false);triggerRef.current?.focus();}
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
  const candidate = (nextDate, nextHour = hour, nextMinute = minute) => nextDate + 'T' + pad(nextHour) + ':' + pad(nextMinute) + ':00';
  const isAllowed = nextValue => (!min || nextValue >= min) && (!max || nextValue <= max);
  const update = nextValue => { if (isAllowed(nextValue)) onChange(nextValue); };
  const changeDate = nextDay => {
    const nextDate = visibleMonth.getUTCFullYear() + '-' + pad(visibleMonth.getUTCMonth() + 1) + '-' + pad(nextDay);
    let nextValue = candidate(nextDate);
    if (min && nextValue < min) nextValue = min;
    if (max && nextValue > max) nextValue = max;
    update(nextValue);
  };
  const setTime = (nextHour, nextMinute = minute) => {const value=closestAllowedTime(selectedDate,[nextHour],nextHour,nextMinute,min,max);if(value)update(value);};
  const hourAllowed=h=>allowedMinutes(selectedDate,h,min,max).length>0;
  const periodHours=period=>Array.from({length:12},(_,i)=>i+(period==='PM'?12:0));
  const actualHour=h=>timeFormat==='24h'?h:(h%12)+(hour>=12?12:0);
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
  const setPeriod = period => {const wanted=(hour%12)+(period==='PM'?12:0);const value=closestAllowedTime(selectedDate,periodHours(period),wanted,minute,min,max);if(value)update(value);};
  const monthStepAllowed = direction => monthIndex + direction >= minMonth && monthIndex + direction <= maxMonth;
  return (
    <div ref={pickerRef} className="relative">
      <button ref={triggerRef} type="button" onClick={() => {if(!open)setPopupStyle({visibility:'hidden'});setOpen(current => !current);}} className="w-full text-left bg-bg-input border border-border rounded-lg px-3 py-2 text-sm text-text-primary" aria-expanded={open}>
        {parts ? (displayDate + ' ' + (timeFormat === '24h' ? pad(hour) + ':' + pad(minute) : pad(displayHour) + ':' + pad(minute) + ' ' + (hour >= 12 ? 'PM' : 'AM'))) : 'Select date and time'}
      </button>
      {open && createPortal(<div ref={popupRef} style={popupStyle} className="fixed z-[1100] rounded-xl border border-border bg-bg-surface shadow-2xl p-3 overflow-y-auto text-text-primary" role="dialog" aria-label="Choose date and time">
        <div className="flex items-center justify-between mb-3">
          <button type="button" disabled={!monthStepAllowed(-1)} onClick={() => setVisibleMonth(new Date(Date.UTC(visibleMonth.getUTCFullYear(), visibleMonth.getUTCMonth() - 1, 1)))} className="px-2 py-1 rounded hover:bg-bg-input disabled:opacity-30" aria-label="Previous month">‹</button>
          <div className="text-sm font-semibold text-text-primary">{monthLabel}</div>
          <button type="button" disabled={!monthStepAllowed(1)} onClick={() => setVisibleMonth(new Date(Date.UTC(visibleMonth.getUTCFullYear(), visibleMonth.getUTCMonth() + 1, 1)))} className="px-2 py-1 rounded hover:bg-bg-input disabled:opacity-30" aria-label="Next month">›</button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-xs text-text-secondary mb-1">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(label => <div key={label} className="py-1">{label}</div>)}</div>
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
          <div className="text-[10px] font-semibold uppercase tracking-wider text-text-secondary mb-2">Time · {timeFormat === '24h' ? '24-hour' : '12-hour'}</div>
          <div className="grid gap-2 items-center" style={{ gridTemplateColumns: timeFormat === '24h' ? '1fr auto 1fr' : '1fr auto 1fr 1fr' }}>
            <select aria-label="Hour" value={displayHour} onChange={event => setHourDisplay(Number(event.target.value))} className="min-w-0 bg-bg-input border border-border rounded-md px-2 py-2 text-sm text-text-primary">
              {(timeFormat === '24h' ? Array.from({length:24},(_,i)=>i) : Array.from({length:12},(_,i)=>i+1)).map(value => <option key={value} value={value} disabled={!hourAllowed(actualHour(value))}>{pad(value)}</option>)}
            </select>
            <span className="text-text-secondary">:</span>
            <select aria-label="Minute" value={minute} onChange={event => setTime(hour,Number(event.target.value))} className="min-w-0 bg-bg-input border border-border rounded-md px-2 py-2 text-sm text-text-primary">
              {Array.from({length:60},(_,i)=>i).map(value => <option key={value} value={value} disabled={!isAllowed(candidate(selectedDate,hour,value))}>{pad(value)}</option>)}
            </select>
            {timeFormat !== '24h' && <select aria-label="AM or PM" value={hour >= 12 ? 'PM' : 'AM'} onChange={event => setPeriod(event.target.value)} className="min-w-0 bg-bg-input border border-border rounded-md px-2 py-2 text-sm text-text-primary">{['AM','PM'].map(period=><option key={period} disabled={!periodHours(period).some(hourAllowed)}>{period}</option>)}</select>}
          </div>
        </div>
        <div className="flex justify-end mt-3"><button type="button" onClick={() => {setOpen(false);triggerRef.current?.focus();}} className="px-3 py-1.5 rounded-md text-xs font-medium bg-bg-input text-text-primary hover:bg-bg-page">Done</button></div>
      </div>,document.body)}
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

const BacktestingReplayWorkspace = ({session, sessions = [], onSwitchSession, onExit}) => {
  const askConfirm=useConfirm();
  const saved = session.checkpoint;
  const workspaceRef = useRef(null), chartCaptureRef = useRef(null), fingerprintRef = useRef('');
  const chartPendingRef=useRef(null);
  const revisionRef = useRef(session.revision), saveInFlight = useRef(null), lastSavedRef = useRef('');
  const exitRef = useRef(false), conflictRef = useRef(false), snapshotRef = useRef(null);
  const [jumpRevision,setJumpRevision]=useState(0);
  const [restartLayout,setRestartLayout]=useState(null), [chartGeneration,setChartGeneration]=useState(0);
  const [chartReady,setChartReady] = useState(false), [saveStatus,setSaveStatus] = useState(saved?'Restoring…':'Not saved yet');
  useEffect(()=>{
    if(chartReady)setSaveStatus(previous=>previous==='Restoring…'?'Saved':previous);
  },[chartReady]);
  const [savingExit,setSavingExit] = useState(false), [fullscreen,setFullscreen] = useState(false);
  const [lockedMarket,setLockedMarket] = useState(!!saved), [showDetails,setShowDetails] = useState(false);
  useEffect(()=>{
    const update=()=>setFullscreen(document.fullscreenElement===workspaceRef.current);
    document.addEventListener('fullscreenchange',update);
    const old=document.body.style.overflow;document.body.style.overflow='hidden';
    return()=>{document.removeEventListener('fullscreenchange',update);document.body.style.overflow=old;};
  },[]);
  const [ticker, setTicker] = useState('NQ');
  const [candles, setCandles] = useState([]);
  const [marketBaseCandles, setMarketBaseCandles] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(80);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(60);
  const [quantity, setQuantity] = useState(1);
  const [quantityPresets, setQuantityPresets] = useState([1, 2, 3, 5, 10]);
  const [editingPresets, setEditingPresets] = useState(false);
  const [presetDraft, setPresetDraft] = useState(['1', '2', '3', '5', '10']);
  const [orderType, setOrderType] = useState('market');
  const [orderPrice, setOrderPrice] = useState('');
  const [pendingOrder, setPendingOrder] = useState(null);
  const [position, setPosition] = useState(null);
  const [closedTrades, setClosedTrades] = useState(session.trades || []);
  const closedTradesRef = useRef(session.trades || []);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [importError, setImportError] = useState('');
  const [historicalDatasets, setHistoricalDatasets] = useState([]);
  const [selectedMarketKey, setSelectedMarketKey] = useState('');
  const [historicalLoading, setHistoricalLoading] = useState(false);
  const [historicalTimeframe, setHistoricalTimeframe] = useState('1m');
  const historicalStart = session.startTime;
  const historicalEnd = session.endTime;
  
  const currentIndexRef = useRef(80);
  const candlesRef = useRef(candles);
  const positionRef = useRef(null);
  const pendingOrderRef = useRef(null);
  const advanceOneRef = useRef(null);
  const orderSequence = useRef(0);

  const availableMarkets = useMemo(() => getSessionMarkets(historicalDatasets,Date.parse(session.startTime),Date.parse(session.endTime)), [historicalDatasets,session.startTime,session.endTime]);
  const selectedMarket = useMemo(() => availableMarkets.find(market => market.key === selectedMarketKey) || null, [availableMarkets, selectedMarketKey]);
  const baseTimeframe = selectedMarket?.baseTimeframe || '';
  const selectedCoverage = selectedMarket?.coverage.find(range=>isRangeWithinCoverage(Date.parse(session.startTime),Date.parse(session.endTime),range)) || null;

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
        const markets = getSessionMarkets(datasets,Date.parse(session.startTime),Date.parse(session.endTime));
        const preferred = saved ? markets.find(m=>m.key===saved.marketKey) : markets.find(m=>m.instrument===ticker) || markets[0];
        if (!preferred) throw Error('Historical data for this session is unavailable. Saved trades are preserved; replay cannot continue.');
        if (saved && !preferred.availableTimeframes.includes(saved.timeframe)) throw Error('Saved execution timeframe is unavailable.');
        setHistoricalTimeframe(saved?.timeframe || preferred.baseTimeframe);
        setSelectedMarketKey(preferred.key);setTicker(preferred.instrument);
      } catch (loadError) {
        if (!cancelled) setImportError(loadError.message || 'Unable to load historical market-data catalogue.');
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!selectedMarket || !baseTimeframe || !historicalStart || !historicalEnd) return undefined;
    const startTime = new Date(session.startTime);
    const endTime = new Date(session.endTime);
    if (!startTime || !endTime || !Number.isFinite(startTime.getTime()) || !Number.isFinite(endTime.getTime()) || !isRangeWithinCoverage(startTime.getTime(), endTime.getTime(), selectedCoverage)) return undefined;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setHistoricalLoading(true);setChartReady(false);
      setImportError('');
      try {
        const params = new URLSearchParams({ start: startTime.toISOString(), end: endTime.toISOString(), instrument: selectedMarket.instrument, timeframe: baseTimeframe });
        params.set('sourceSymbol', selectedMarket.sourceSymbol || '__none__');
        const response = await authFetch('/api/market-data/query?' + params.toString());
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Unable to prepare the selected historical market data.');
        if (cancelled) return;
        const baseCandles = normalizeOhlcvRows(data.bars || []);
        const normalized = historicalTimeframe === baseTimeframe ? baseCandles : aggregateCandles(baseCandles, historicalTimeframe);
        if (normalized.length < 2) throw new Error('There are not enough historical bars in this period to start replay.');
        if (!/^[a-f0-9]{64}$/.test(data.fingerprint || '')) throw Error('Historical source fingerprint is missing.');
        if (saved && (data.fingerprint !== saved.fingerprint || normalized.length !== saved.barCount || normalized[saved.index]?.time !== saved.time))
          throw Error('Historical source has changed. Saved trades remain available, but replay cannot safely resume.');
        fingerprintRef.current=data.fingerprint;setMarketBaseCandles(baseCandles);
        candlesRef.current=normalized;setCandles(normalized);
        const index=saved?.index ?? 0;
        currentIndexRef.current=index;setCurrentIndex(index);setIsPlaying(false);
        positionRef.current=saved?.position ?? null;setPosition(positionRef.current);
        pendingOrderRef.current=saved?.pendingOrder ?? null;setPendingOrder(pendingOrderRef.current);
        closedTradesRef.current=session.trades || [];setClosedTrades(closedTradesRef.current);
        orderSequence.current=saved?.orderSequence ?? 0;
        setQuantity(saved?.quantity ?? 1);setQuantityPresets(saved?.quantityPresets ?? [1,2,3,5,10]);
        setOrderType(saved?.orderType ?? 'market');setOrderPrice(saved?.orderPrice ?? '');setSpeed(restoreReplaySpeed(saved,timeframeSeconds(historicalTimeframe)));
        setMessage(saved ? '' : 'Select your execution market before trading.');
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
  const capitalExhausted=!position && Math.round((session.startingBalance+stats.netPnl)*100)<=0;
  const exhaustedNow=useCallback(()=>!positionRef.current && Math.round((session.startingBalance+closedTradesRef.current.reduce((sum,t)=>sum+t.pnl,0))*100)<=0,[session.startingBalance]);
  const canSeek = !capitalExhausted && chartReady && !savingExit && !conflictRef.current && !position && !pendingOrder && closedTrades.length === 0;

  useEffect(() => { candlesRef.current = candles; }, [candles]);
  useEffect(() => { currentIndexRef.current = currentIndex; }, [currentIndex]);
  useEffect(() => { positionRef.current = position; }, [position]);
  useEffect(() => { pendingOrderRef.current = pendingOrder; }, [pendingOrder]);

  const commitFill = useCallback((result, reason, price) => {
    if (result.error) { setError(result.error); return; }
    positionRef.current = result.position; setPosition(result.position);
    if (result.trade) {
      closedTradesRef.current=closedTradesRef.current.concat(result.trade);
      setClosedTrades(closedTradesRef.current);
      setMessage('Position closed: ' + reason + ' · ' + formatMoney(result.trade.pnl));
      // Never let an adjustment survive a flat position.
      pendingOrderRef.current = null; setPendingOrder(null);
      if(exhaustedNow()){setIsPlaying(false);setMessage('Account capital exhausted. Save and exit to review your history.');}
    } else {
      setMessage(reason + ' @ ' + formatPrice(price, spec.decimals) + ' · ' + result.position.quantity + ' open');
    }
    setError('');
  }, [spec.decimals,exhaustedNow]);

  const closePosition = useCallback((activePosition, exitPrice, exitTime, reason) => {
    const result = applyReplayFill(activePosition, {
      direction: activePosition.direction === 'long' ? 'short' : 'long', quantity: activePosition.quantity,
    }, exitPrice, exitTime, spec, reason);
    commitFill(result, reason, exitPrice);
  }, [spec, commitFill]);

  const advanceOne = useCallback(() => {
    if (exitRef.current || conflictRef.current || !chartReady || exhaustedNow()) {setIsPlaying(false);return;}
    setLockedMarket(true);
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
  }, [spec, commitFill, chartReady,exhaustedNow]);

  useEffect(() => { advanceOneRef.current = advanceOne; }, [advanceOne]);

  useEffect(() => {
    if (!isPlaying) return undefined;
    let last=performance.now(), carry=0;
    const interval = setInterval(() => {
      const now=performance.now();
      const step=replayStepBudget(now-last,carry,speed,timeframeSeconds(historicalTimeframe));last=now;carry=step.carry;
      for(let i=0;i<step.count && currentIndexRef.current<candlesRef.current.length-1;i++) {
        if(exitRef.current||conflictRef.current)break;
        advanceOneRef.current?.();
      }
    },50);
    return () => clearInterval(interval);
  }, [isPlaying, speed, historicalTimeframe]);

  // Forward-only jump. Run the exact same execution path while a position or
  // working order exists; when flat, no bar can create an execution by itself.
  const jumpToTime = option => {
    if(!chartReady||historicalLoading||exitRef.current||conflictRef.current||exhaustedNow())return;
    const target=nextGoToIndex(candlesRef.current,currentIndexRef.current,option.time,option.timeZone);
    if(target<0){setError('No later '+option.label+' with historical data in this session.');return;}
    setIsPlaying(false);setLockedMarket(true);setError('');
    while(currentIndexRef.current<target&&(positionRef.current||pendingOrderRef.current)){
      const before=currentIndexRef.current;
      advanceOneRef.current?.();
      if(currentIndexRef.current===before)return;
    }
    if(exhaustedNow())return;
    currentIndexRef.current=target;setCurrentIndex(target);setJumpRevision(v=>v+1);
  };

  const handleMarketChange = event => {
    if (lockedMarket || exitRef.current || historicalLoading) return;
    const market=availableMarkets.find(item=>item.key===event.target.value);
    if(!market)return;
    setChartReady(false);setIsPlaying(false);setHistoricalLoading(true);
    candlesRef.current=[];setCandles([]);setMarketBaseCandles([]);currentIndexRef.current=0;setCurrentIndex(0);
    setSelectedMarketKey(market.key);setTicker(market.instrument);setHistoricalTimeframe(market.baseTimeframe);
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
    if(exhaustedNow()){setError('Account capital exhausted. Create a new account to continue trading.');return;}
    const candle = latestCandle();
    if (exitRef.current || conflictRef.current || !chartReady || !candle || historicalLoading) { setError('Select an available historical market and period before placing a trade.'); return; }
    if (pendingOrderRef.current) return;
    const active = positionRef.current;
    const parsedQuantity = Number(options.quantity ?? quantity);
    const type = options.type ?? orderType;
    const { triggerPrice, error: orderError } = validateReplayOrderDraft(active, direction, parsedQuantity, type, options.price ?? orderPrice, candle.close, spec);
    if (orderError) { setError(orderError); return; }
    setLockedMarket(true);
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
    if (exitRef.current || conflictRef.current || !chartReady) return;
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
    if (exitRef.current || conflictRef.current || !chartReady) return;
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
    if (exitRef.current || conflictRef.current || !chartReady) return;
    if (!pendingOrderRef.current || pendingOrderRef.current.id !== id) return;
    pendingOrderRef.current = null; setPendingOrder(null); setError(''); setMessage('Pending order cancelled.');
  };

  const closeFromChart = (id) => {
    if (exitRef.current || conflictRef.current || !chartReady) return;
    const active = positionRef.current, candle = latestCandle();
    if (active?.id === id && candle) closePosition(active, candle.close, candle.time, 'Manual close');
  };

  const chartMenuItems = (context) => {
    const candle = latestCandle();
    if (exitRef.current || conflictRef.current || !chartReady || historicalLoading || !candle || context.price == null || exhaustedNow()) return [];
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

  const adjustQuantity = delta => setQuantity(value => Math.max(1, Math.min(100, Number(value) + delta)));
  const savePresets = () => {
    const values = presetDraft.map(Number);
    if (values.some(value => !Number.isInteger(value) || value < 1 || value > 100)) { setError('Each preset must be a whole number from 1 to 100.'); return; }
    setQuantityPresets(values); setQuantity(values[0]); setEditingPresets(false); setError('');
  };

  const realizedOpenPnl=position?.realizedPnl ?? 0;
  const realized=stats.netPnl+realizedOpenPnl, balance=session.startingBalance+realized;
  const accountStart=session.accountStartingBalance??session.startingBalance, accountRealized=balance-accountStart;
  snapshotRef.current=()=>{
    const candle=latestCandle(), layout=chartCaptureRef.current?.();
    if(!chartReady||historicalLoading||!candle||!layout||!fingerprintRef.current)return null;
    return {checkpoint:{version:1,marketKey:selectedMarketKey,timeframe:historicalTimeframe,fingerprint:fingerprintRef.current,
      index:currentIndexRef.current,barCount:candlesRef.current.length,time:candle.time,orderSequence:orderSequence.current,
      quantity,quantityPresets,speed,speedMode:'time',orderType,orderPrice,position:positionRef.current,pendingOrder:pendingOrderRef.current,layout},trades:closedTradesRef.current};
  };
  const save=async({explicit=false}={})=>{
    if(conflictRef.current)return false;
    if(saveInFlight.current){await saveInFlight.current;if(conflictRef.current)return false;}
    let payload,key;
    try{
      if(chartPendingRef.current?.()){
        if(!explicit)return false;
        setSaveStatus('Waiting for chart data…');
        await chartPendingRef.current('wait');
        if(conflictRef.current)return false;
      }
      payload=snapshotRef.current?.();if(!payload)return false;key=JSON.stringify(payload);
    }
    catch(e){setSaveStatus('Could not capture session: '+e.message);return false;}
    if(key===lastSavedRef.current){setSaveStatus('Saved');return true;}
    setLockedMarket(true);setSaveStatus('Saving…');
    const work=(async()=>{
      try{
        const response=await authFetch('/api/backtesting/replay-sessions/'+encodeURIComponent(session.id)+'/checkpoint',{
          method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,revision:revisionRef.current})});
        const data=await response.json();
        if(!response.ok){if(response.status===409){conflictRef.current=true;setIsPlaying(false);}throw Error(data.error||'Save failed.');}
        revisionRef.current=data.revision;lastSavedRef.current=key;setSaveStatus('Saved');return true;
      }catch(e){setSaveStatus(e.message||'Save failed');return false;}
    })();
    saveInFlight.current=work;
    try{return await work;}finally{if(saveInFlight.current===work)saveInFlight.current=null;}
  };
  const saveRef=useRef(save);saveRef.current=save;
  useEffect(()=>{
    if(!chartReady||!lockedMarket)return;
    const timer=setInterval(()=>{if(!exitRef.current&&!conflictRef.current&&!saveInFlight.current)void saveRef.current();},5000);
    return()=>clearInterval(timer);
  },[chartReady,lockedMarket]);
  useEffect(()=>{
    const warn=e=>{if(exitRef.current)return;let dirty=true;try{const snapshot=snapshotRef.current?.();dirty=!!snapshot&&JSON.stringify(snapshot)!==lastSavedRef.current;}catch{}if(dirty){e.preventDefault();e.returnValue='';}};
    window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);
  },[]);
  const saveExit=async(nextSessionId=null)=>{
    if(savingExit||exitRef.current)return;
    const navigate=async()=>{
      if(document.fullscreenElement===workspaceRef.current)try{await document.exitFullscreen();}catch{}
      if(nextSessionId)await onSwitchSession(nextSessionId);else onExit();
    };
    exitRef.current=true;setIsPlaying(false);setSavingExit(true);
    if(!chartReady&&!saveInFlight.current){
      if(await askConfirm({title:'Leave without saving?',message:'Leave this session without changing its saved state?',danger:true,confirmLabel:'Leave session'})){
        try{await navigate();return;}catch(e){setError(e.message||'Could not open session.');}
      }
      exitRef.current=false;setSavingExit(false);return;
    }
    const ok=await save({explicit:true});
    if(ok){try{await navigate();return;}catch(e){setError(e.message||'Could not open session.');}}
    exitRef.current=false;setSavingExit(false);
  };
  const restartSession=async()=>{
    if(!chartReady||savingExit||exitRef.current||conflictRef.current||exhaustedNow()||chartPendingRef.current?.())return;
    setIsPlaying(false);
    if(!(await askConfirm({title:'Restart replay session?',message:'This permanently clears its simulated trades, open position and working orders and restores the starting balance. Chart drawings are cleared; layout and indicators are kept.',danger:true,confirmLabel:'Restart session'})))return;
    if(!chartReady||savingExit||exitRef.current||conflictRef.current||exhaustedNow())return;
    exitRef.current=true;setIsPlaying(false);setSavingExit(true);
    try{
      if(saveInFlight.current)await saveInFlight.current;
      if(conflictRef.current)throw Error('Session changed on another device.');
      const payload=snapshotRef.current?.();
      if(!payload)throw Error('Session is not ready.');
      const checkpoint={...payload.checkpoint,index:0,time:candlesRef.current[0].time,position:null,pendingOrder:null,orderType:'market',orderPrice:''};
      checkpoint.layout=resetReplayChartLayout(checkpoint.layout);
      setSaveStatus('Restarting…');
      const response=await authFetch('/api/backtesting/replay-sessions/'+encodeURIComponent(session.id)+'/checkpoint',{
        method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:revisionRef.current,restart:true,checkpoint,trades:[]})});
      const data=await response.json();
      if(!response.ok){if(response.status===409)conflictRef.current=true;throw Error(data.error||'Restart failed.');}
      revisionRef.current=data.revision;lastSavedRef.current=JSON.stringify({checkpoint,trades:[]});
      positionRef.current=null;pendingOrderRef.current=null;closedTradesRef.current=[];
      setPosition(null);setPendingOrder(null);setClosedTrades([]);setOrderType('market');setOrderPrice('');
      currentIndexRef.current=0;setCurrentIndex(0);setLockedMarket(true);setSaveStatus('Saved');
      setError('');setMessage('');
      setRestartLayout(checkpoint.layout);setChartReady(false);setChartGeneration(v=>v+1);
    }catch(e){setSaveStatus(e.message||'Restart failed');setError(e.message||'Restart failed');}
    finally{exitRef.current=false;setSavingExit(false);}
  };
  const toggleFullscreen=async()=>{
    try{if(document.fullscreenElement===workspaceRef.current)await document.exitFullscreen();else await workspaceRef.current.requestFullscreen();}
    catch{setError('Fullscreen is not available in this browser.');}
  };
  const statsProfitFactor = stats.profitFactor == null
    ? (stats.grossProfit > 0 ? '∞' : '—')
    : stats.profitFactor.toFixed(2);

  return createPortal(
    <div ref={workspaceRef} data-replay-workspace="true" className="fixed inset-0 z-[9999] bg-bg-page text-text-primary flex flex-col overflow-hidden" style={{height:'100dvh'}}>
      <header className="shrink-0 grid grid-cols-[minmax(0,1fr)_minmax(0,6fr)_minmax(0,1fr)] items-center gap-3 border-b border-border bg-bg-surface px-3 py-2">
        <div className="min-w-0">
          <button type="button" disabled={savingExit} onClick={()=>void saveExit()} className="max-w-full whitespace-nowrap overflow-hidden text-ellipsis rounded-lg border border-border bg-bg-input px-3 py-1.5 text-sm font-semibold disabled:opacity-40" title="Save & exit">← {savingExit?'Saving…':'Save & exit'}</button>
        </div>
        <div className="min-w-0 overflow-x-auto">
          <div data-replay-account-group="true" className="flex w-max mx-auto items-center gap-4 whitespace-nowrap text-xs bg-bg-input border border-border rounded-lg px-3 py-1.5">
            <select aria-label="Switch replay session" title="Switch replay session" disabled={savingExit||conflictRef.current} value={session.id} onChange={e=>void saveExit(e.target.value)} className="shrink-0 max-w-[220px] bg-bg-input rounded px-2 py-1 text-sm font-semibold disabled:opacity-40">
              <option value={session.id}>{session.accountName} · {session.name}</option>{sessions.filter(s=>s.id!==session.id).map(s=><option key={s.id} value={s.id}>{s.accountName} · {s.name}</option>)}
            </select>
            <div aria-hidden="true" className="self-stretch w-px bg-border"/>
            {[['Starting',accountStart],['Balance',balance],['Equity',balance+unrealizedPnl],['Realized P/L',accountRealized],['Unrealized P/L',unrealizedPnl]].map(([label,value])=><div key={label}><span className="text-text-secondary mr-2">{label}</span><strong className={label.includes('P/L')?(value<0?'text-negative':'text-positive'):'text-text-primary'}>{formatMoney(value)}</strong></div>)}
          </div>
        </div>
        <div className="flex min-w-0 justify-end items-center gap-2">
          <span role="status" className={'min-w-0 text-xs truncate '+(/^(Saving|Restoring|Restarting|Not saved|Waiting)/.test(saveStatus)?'text-text-secondary':'text-negative')} title={saveStatus==='Saved'?undefined:saveStatus}>{saveStatus==='Saved'?'':saveStatus}</span>
          <button type="button" onClick={toggleFullscreen} className="shrink-0 bg-bg-input border border-border rounded-lg px-2 py-1.5 text-sm" aria-label={fullscreen?'Exit fullscreen':'Fullscreen'} title={fullscreen?'Exit fullscreen':'Fullscreen'}>{fullscreen?'↙':'⛶'}</button>
        </div>
      </header>
      {saveStatus!=='Saved'&&!/^(Saving|Restoring|Restarting|Not saved|Waiting)/.test(saveStatus)&&<div className="shrink-0 px-3 py-2 text-xs text-negative" role="alert">{saveStatus}</div>}
      {capitalExhausted&&<div className="shrink-0 px-3 py-2 text-xs text-negative" role="status">Account capital exhausted. Trading and restart are disabled. Save &amp; exit to review this session or create a new account.</div>}
      {importError&&<div className="shrink-0 px-3 py-2 text-xs text-negative" role="alert">{importError}</div>}
      {conflictRef.current&&<div className="shrink-0 px-3 py-2 text-xs text-negative">Session changed on another device. Saving is blocked. <button onClick={async()=>{if(await askConfirm({title:'Discard unsaved changes?',message:'Discard unsaved changes on this device and return to the session list?',danger:true,confirmLabel:'Discard changes'}))onExit();}} className="underline">Return to session list</button></div>}
      <div className="flex-1 min-h-0 grid grid-cols-[minmax(0,1fr)_300px] gap-1 overflow-hidden" inert={savingExit||conflictRef.current?true:undefined}>

        <div className="bg-bg-surface flex flex-col min-h-0 overflow-hidden min-w-0">
          <div className="shrink-0 flex items-center justify-between gap-3 px-3 py-1 border-b border-border">
            <div>
              <div className="flex items-center gap-2"><span className="text-xs text-text-secondary">Execution instrument</span><select aria-label="Execution market" value={selectedMarketKey} onChange={handleMarketChange} disabled={lockedMarket||historicalLoading||!availableMarkets.length} className="bg-bg-input rounded px-2 py-1 text-sm text-text-primary">{availableMarkets.map(m=><option key={m.key} value={m.key}>{m.label}</option>)}</select><span className="text-xs text-text-secondary">{intervalLabel} execution</span></div>
            </div>
            <div className="text-right">
              <div className="font-mono text-text-primary text-lg">{formatPrice(currentPrice, spec.decimals)}</div>
              <div className="text-text-secondary text-[11px]">Last revealed close</div>
            </div>
          </div>
          <div className="relative flex flex-1 min-h-0 min-w-0">
          <ReplayTradeCanvasGrid
            key={(selectedMarketKey || 'loading')+'|'+chartGeneration}
            ticker={ticker} executionMarket={selectedMarket} markets={availableMarkets} historicalStart={historicalStart} historicalEnd={historicalEnd}
            fullHeight={true} captureRef={chartCaptureRef} pendingRef={chartPendingRef} restoreLayout={restartLayout || saved?.layout} onReady={setChartReady} onRestoreError={setImportError}
            timeframe={historicalTimeframe}
            availableTimeframes={selectedMarket?.availableTimeframes}
            baseCandles={marketBaseCandles}
            replayTime={replayTime}
            baseTimeframe={baseTimeframe}
            position={position}
            pendingOrder={pendingOrder}
            spec={spec}
            currentPrice={currentPrice}
            onGoTo={jumpToTime} jumpRevision={jumpRevision}
            chartMenuItems={chartMenuItems}
            onOrderModify={modifyPendingOrder}
            onOrderCancel={({ orderId }) => cancelPendingOrder(orderId)}
            onPositionModify={({ positionId, stopLoss, takeProfit }) => applyPositionLevels(positionId, { stopPrice: stopLoss, targetPrice: takeProfit })}
            onPositionClose={({ positionId }) => closeFromChart(positionId)}
          />
          {!chartReady && <div className="absolute inset-0 z-30 flex items-center justify-center bg-bg-page/90"><div role="status" className="text-center text-sm text-text-secondary space-y-3">{!importError&&<div className="mx-auto h-8 w-8 border-2 border-accent border-t-transparent rounded-full animate-spin"/>}<div className="font-semibold text-text-primary">{importError?'Historical replay unavailable':historicalLoading||!candles.length?'Loading historical market data…':'Restoring chart layout…'}</div><p>{importError||'Preparing the selected period. Playback will be ready when loading is complete.'}</p></div></div>}
          </div>
          <div className="shrink-0 px-3 py-2 border-t border-border space-y-1">
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
              <div/>
              <div className="flex items-center justify-center gap-2">
              <button type="button" onClick={async () => {
                setIsPlaying(false);
                if (!canSeek || !(await askConfirm({title:'Jump to beginning?',message:'The chart will return to the first candle.',confirmLabel:'Jump to beginning'}))) return;
                if(positionRef.current||pendingOrderRef.current||closedTradesRef.current.length||exitRef.current||conflictRef.current)return;
                setIsPlaying(false);
                currentIndexRef.current = 0;
                setCurrentIndex(0);
              }} disabled={!candles.length || !canSeek || currentIndex === 0} title="Jump to beginning" aria-label="Jump to beginning" className="w-10 h-10 inline-flex items-center justify-center rounded-lg border border-border text-text-secondary hover:text-text-primary disabled:opacity-30"><span aria-hidden="true" className="text-xl leading-none tracking-[-0.12em]">||◀</span></button>
              <button type="button" onClick={() => { if (!canSeek) return; setIsPlaying(false); const next = Math.max(0, currentIndexRef.current - 1); currentIndexRef.current = next; setCurrentIndex(next); }} disabled={!candles.length || !canSeek || currentIndex === 0} title="Previous candle" aria-label="Previous candle" className="w-10 h-10 inline-flex items-center justify-center rounded-lg border border-border text-text-secondary hover:text-text-primary disabled:opacity-30"><span aria-hidden="true" className="inline-block rotate-180 text-xl leading-none">▶|</span></button>
              <button type="button" onClick={() => {setLockedMarket(true);setIsPlaying(value => !value);}} disabled={capitalExhausted || !chartReady || !candles.length || (!isPlaying && currentIndex >= candles.length - 1)} aria-label={isPlaying ? 'Pause replay' : 'Play replay'} className="w-10 h-10 inline-flex items-center justify-center rounded-lg bg-accent text-accent-text text-sm font-semibold disabled:opacity-40">{isPlaying ? 'Ⅱ' : '▶'}</button>
              <button type="button" onClick={() => { setIsPlaying(false); advanceOne(); }} disabled={capitalExhausted || !chartReady || !candles.length || currentIndex >= candles.length - 1} title="Next candle" aria-label="Next candle" className="w-10 h-10 inline-flex items-center justify-center rounded-lg border border-border text-text-secondary hover:text-text-primary disabled:opacity-30"><span aria-hidden="true" className="text-xl leading-none">▶|</span></button>
              <button type="button" onClick={restartSession} disabled={capitalExhausted||!chartReady||savingExit} title="Restart session and reset its simulated trades" aria-label="Restart session" className="w-10 h-10 inline-flex items-center justify-center rounded-lg border border-border text-text-secondary hover:text-text-primary disabled:opacity-30 text-xl">↺</button>
              </div>
              <div className="justify-self-end flex items-center gap-2 text-xs text-text-secondary">
                <label htmlFor="replay-speed" title="Simulated active-market time per real second. Closed-market gaps are skipped.">Speed</label>
                <input id="replay-speed" type="range" min="0" max="100" step="any" value={replaySpeedPercent(speed)} onChange={event=>setSpeed(replaySpeedAtPercent(Number(event.target.value)))} onKeyDown={event=>{if(['ArrowLeft','ArrowDown','ArrowRight','ArrowUp'].includes(event.key)){event.preventDefault();const direction=['ArrowLeft','ArrowDown'].includes(event.key)?-1:1;setSpeed(current=>Math.max(1,Math.min(1200,current+direction*Math.max(1,Math.round(current*.05)))));}}} className="w-24 sm:w-36 accent-accent" aria-valuetext={speed+' times real time'} title="1×–1200×; logarithmic scale"/>
                <span className="text-text-primary font-semibold tabular-nums min-w-[48px] text-right">{speed}×</span>
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 text-xs">
              <div className="min-w-0">
                <div className="font-medium text-text-primary">{currentCandle ? formatBarTime(currentCandle.time) : 'Waiting for historical data'}</div>
                <div className="text-text-secondary">{candles.length ? (currentIndex + 1).toLocaleString() + ' of ' + candles.length.toLocaleString() + ' candles' : 'No candles loaded'}</div>
              </div>
              <div className="text-right text-text-secondary">{candles.length ? Math.round((currentIndex / Math.max(1, candles.length - 1)) * 100) + '%' : '—'}</div>
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
                if(next>0)setLockedMarket(true);
                currentIndexRef.current = next;
                setCurrentIndex(next);
              }}
              className="w-full accent-accent disabled:opacity-40"
              aria-label="Replay position"
            />
            <div className="flex justify-between text-xs text-text-secondary">
              <span>{candles.length ? formatBarTime(candles[0].time) : ''}</span>
              <span>{candles.length ? formatBarTime(candles[candles.length - 1].time) : ''}</span>
            </div>
            {!canSeek && <div className="text-xs text-text-secondary">Rewind and seeking are disabled after a simulated trade to preserve execution history.</div>}
          </div>
        </div>

        <div className="min-h-0 overflow-y-auto flex flex-col gap-2 bg-bg-surface">
          <div className="bg-bg-surface border border-border rounded-lg p-3 space-y-3">
            <h3 className="text-text-primary font-semibold text-sm">Order entry</h3>
            <div className={orderType === 'market' ? 'grid grid-cols-1' : 'grid grid-cols-2 gap-2'}>
              <div><label className="block text-text-secondary text-[11px] font-semibold uppercase tracking-wider mb-1">Order type</label><select aria-label="Order type" value={orderType} disabled={!!pendingOrder} onChange={event => changeOrderType(event.target.value)} className="w-full bg-bg-input border border-border rounded-lg px-2 py-2 text-sm text-text-primary"><option value="market">Market</option><option value="limit">Limit</option><option value="stop_market">Stop Market</option></select></div>
              {orderType !== 'market' && <div><label className="block text-text-secondary text-[11px] font-semibold uppercase tracking-wider mb-1">Order price</label><div className="flex items-center gap-1"><input aria-label="Order price" type="number" step={spec.tickSize} value={orderPrice} disabled={!!pendingOrder} onChange={event => { setOrderPrice(event.target.value); setError(''); }} className="w-full min-w-0 bg-bg-input border border-border rounded-lg px-2 py-2 text-sm text-text-primary" placeholder="Price" /><button type="button" aria-label="Reset to current market price" title="Reset to current market price" disabled={!!pendingOrder || historicalLoading || !currentPrice} onClick={resetOrderPrice} className="shrink-0 w-7 h-9 rounded-lg border border-border text-text-secondary hover:text-text-primary disabled:opacity-40 flex items-center justify-center"><svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 7v5h-5M4 17v-5h5M6 8a7 7 0 0 1 11.5-2L20 9M4 15l2.5 3A7 7 0 0 0 18 16"/></svg></button></div></div>}
            </div>
            {orderType !== 'market' && <div className="flex items-center justify-between text-xs"><span className="text-text-secondary">Current market price</span><span className="text-text-secondary tabular-nums">{currentPrice > 0 ? formatPrice(currentPrice, spec.decimals) : '—'}</span></div>}
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => adjustQuantity(-1)} disabled={!!pendingOrder || quantity <= 1} className="w-7 h-8 shrink-0 rounded-full border border-border text-text-primary disabled:opacity-40" aria-label="Decrease contracts">−</button>
              <div className="flex flex-1 justify-center gap-1 min-w-0">{quantityPresets.map((preset, index) => <button key={index} type="button" onClick={() => setQuantity(preset)} disabled={!!pendingOrder} className={"min-w-0 flex-1 h-8 px-1 rounded-full text-xs font-semibold disabled:opacity-40 " + (quantity === preset ? 'bg-accent text-accent-text' : 'bg-bg-input text-text-secondary hover:text-text-primary')}>{preset}</button>)}</div>
              <button type="button" onClick={() => adjustQuantity(1)} disabled={!!pendingOrder || quantity >= 100} className="w-7 h-8 shrink-0 rounded-full border border-border text-text-primary disabled:opacity-40" aria-label="Increase contracts">+</button>
              <button type="button" onClick={() => { setPresetDraft(quantityPresets.map(String)); setEditingPresets(value => !value); }} disabled={!!pendingOrder} className="w-6 h-8 shrink-0 rounded-lg text-text-secondary hover:text-text-primary disabled:opacity-40" title="Edit contract presets" aria-label="Edit contract presets">✎</button>
            </div>
            {editingPresets && <div className="rounded-lg border border-border bg-bg-input p-3 space-y-2"><div className="text-xs font-semibold text-text-secondary">Contract presets</div><div className="grid grid-cols-5 gap-2">{presetDraft.map((value, index) => <input key={index} type="number" min="1" max="100" step="1" value={value} onChange={event => setPresetDraft(previous => previous.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} className="min-w-0 w-full rounded border border-border bg-bg-surface px-1 py-2 text-center text-sm text-text-primary" aria-label={"Preset " + (index + 1)} />)}</div><div className="flex justify-end gap-2"><button type="button" onClick={() => setEditingPresets(false)} className="px-3 py-1.5 text-xs text-text-secondary">Cancel</button><button type="button" onClick={savePresets} className="px-3 py-1.5 rounded bg-accent text-accent-text text-xs font-semibold">Save</button></div></div>}
            <div className="grid grid-cols-2 gap-2">
              {['long', 'short'].map(direction => {
                const { error: draftError } = validateReplayOrderDraft(position, direction, quantity, orderType, orderPrice, currentPrice, spec);
                const disabled = capitalExhausted || !chartReady || !candles.length || historicalLoading || !!pendingOrder || !!draftError;
                const action = !position ? '' : position.direction === direction ? 'Add' : quantity === position.quantity ? 'Close' : 'Reduce';
                return <button key={direction} type="button" onClick={() => openPosition(direction)} title={pendingOrder ? 'Cancel the working order before submitting another.' : draftError || undefined} disabled={disabled} className={'py-2 rounded-lg text-white text-sm font-semibold disabled:opacity-40 ' + (direction === 'long' ? 'bg-positive' : 'bg-negative')}>
                  {direction === 'long' ? 'BUY' : 'SELL'} {quantity} @ {orderType === 'stop_market' ? 'STOP' : orderType.toUpperCase()}
                  {action && <span className="block text-[10px] font-normal opacity-80">{action}</span>}
                </button>;
              })}
            </div>
            {!pendingOrder && orderType !== 'market' && <p className="text-xs text-text-secondary">{orderType === 'limit' ? 'Buy below · Sell above market' : 'Buy above · Sell below market'}{snapReplayPrice(orderPrice, spec) === currentPrice && currentPrice > 0 ? ' — adjust the order price' : ''}</p>}
            {pendingOrder && <div className="rounded-lg bg-bg-input p-3 text-xs space-y-2"><div className="flex justify-between"><span className="text-text-secondary">Pending {pendingOrder.type.replace('_', ' ')}</span><strong>{pendingOrder.direction.toUpperCase()} × {pendingOrder.quantity}</strong></div><div className="flex justify-between"><span className="text-text-secondary">Order price</span><span className="font-mono">{formatPrice(pendingOrder.triggerPrice, spec.decimals)}</span></div><button type="button" onClick={() => cancelPendingOrder(pendingOrder.id)} className="w-full py-2 rounded-lg bg-negative text-white text-sm font-semibold hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">Cancel pending order</button></div>}
            {position && <div className="space-y-2"><div className="rounded-lg bg-bg-input p-3 text-xs space-y-1"><div className="flex justify-between"><span className="text-text-secondary">Open position</span><strong className={position.direction === 'long' ? 'text-positive' : 'text-negative'}>{position.direction.toUpperCase()} × {position.quantity}</strong></div><div className="flex justify-between"><span className="text-text-secondary">Avg entry</span><span className="font-mono">{formatPrice(position.entryPrice, spec.decimals)}</span></div><div className="flex justify-between"><span className="text-text-secondary">Unrealized P/L</span><strong className={unrealizedPnl >= 0 ? 'text-positive' : 'text-negative'}>{formatMoney(unrealizedPnl)}</strong></div>{position.fills?.some(fill => fill.kind === 'exit') && <div className="flex justify-between"><span className="text-text-secondary">Realized P/L</span><strong className={realizedOpenPnl >= 0 ? 'text-positive' : 'text-negative'}>{formatMoney(realizedOpenPnl)}</strong></div>}</div>
              <div className="flex gap-2"><button type="button" onClick={() => closeFromChart(position.id)} className="flex-1 py-2 rounded-lg bg-accent text-accent-text text-sm font-semibold">Close position</button><button type="button" title="Move stop to remaining average entry (rounded to a protective tick, before fees)" disabled={!canMoveToBreakeven(position, currentPrice, spec)} onClick={moveToBreakeven} className="px-5 py-2 rounded-lg border border-border bg-bg-input text-sm font-semibold text-text-primary hover:border-accent hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-40 disabled:cursor-not-allowed">BE</button></div>
            </div>}
            {error && <p className="text-xs text-negative">{error}</p>}{message && <p className="text-xs text-text-secondary">{message}</p>}
          </div>

          <div className="mt-auto bg-bg-surface border border-border rounded-lg p-3 space-y-3"><h3 className="text-sm font-semibold">Backtest statistics</h3>
            <div className="grid grid-cols-2 gap-3">
              <div><div className="text-[10px] uppercase tracking-wider text-text-secondary">Closed trades</div><div className="text-xl font-semibold text-text-primary">{stats.total}</div></div>
              <div><div className="text-[10px] uppercase tracking-wider text-text-secondary">Win rate</div><div className="text-xl font-semibold text-text-primary">{stats.winRate.toFixed(1)}%</div></div>
              <div><div className="text-[10px] uppercase tracking-wider text-text-secondary">Net P/L</div><div className={'text-lg font-semibold ' + (stats.netPnl >= 0 ? 'text-positive' : 'text-negative')}>{formatMoney(stats.netPnl)}</div></div>
              <div><div className="text-[10px] uppercase tracking-wider text-text-secondary">Profit factor</div><div className="text-lg font-semibold text-text-primary">{statsProfitFactor}</div></div>
            </div>
            <div className="border-t border-border pt-2 flex justify-between text-xs"><span className="text-text-secondary">Wins / losses / BE</span><span className="text-text-primary">{stats.wins} / {stats.losses} / {stats.breakeven}</span></div>
            {position && position.fills?.some(fill => fill.kind === 'exit') && <div className="flex justify-between text-xs"><span className="text-text-secondary">Realized on open trade (not included above)</span><strong className={realizedOpenPnl >= 0 ? 'text-positive' : 'text-negative'}>{formatMoney(realizedOpenPnl)}</strong></div>}
            {position && <div className="flex justify-between text-xs"><span className="text-text-secondary">Open P/L (not included above)</span><strong className={unrealizedPnl >= 0 ? 'text-positive' : 'text-negative'}>{formatMoney(unrealizedPnl)}</strong></div>}
            {closedTrades.length === 0 && <p className="text-xs text-text-secondary">Close your first simulated trade to start building statistics.</p>}
          </div>
        </div>
      </div>

      <div className="shrink-0 bg-bg-surface border-t border-border px-3 py-1 max-h-[30vh] overflow-auto">
        <button className="w-full text-left text-xs text-text-secondary py-1" onClick={()=>setShowDetails(v=>!v)}>{showDetails?"▾":"▸"} Trade history · {closedTrades.length} closed</button>
        {showDetails && <ReplayTradeHistory trades={closedTrades}/>}
      </div>

      <div className="shrink-0 px-3 py-1 text-xs text-text-secondary">
        <p>Simulated account · one completed trade per flat position · gross P/L before fees and slippage.</p>
      </div>
    </div>, document.body
  );
};

export { ReplayDateTimePicker, toDisplayDateTimeInput, fromDisplayDateTimeInput };
export default BacktestingReplayWorkspace;
