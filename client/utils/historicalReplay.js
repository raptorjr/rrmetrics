const TIMEFRAME_SECONDS = {
  '10s': 10, '15s': 15, '30s': 30,
  '1m': 60, '2m': 120, '3m': 180, '5m': 300, '10m': 600, '15m': 900, '30m': 1800,
  '1h': 3600, '2h': 7200, '4h': 14400,
};

const AGGREGATABLE_TIMEFRAMES = ['30s', '1m', '2m', '3m', '5m', '10m', '15m', '30m', '1h', '2h', '4h'];

function timeframeSeconds(value) {
  const normalized = String(value || '').toLowerCase();
  if (TIMEFRAME_SECONDS[normalized]) return TIMEFRAME_SECONDS[normalized];
  const match = /^(\d+)(s|m|h|d)$/.exec(normalized);
  if (!match) return 0;
  const amount = Number(match[1]);
  return amount * ({ s: 1, m: 60, h: 3600, d: 86400 }[match[2]]);
}

function compareTimeframes(a, b) {
  return timeframeSeconds(a) - timeframeSeconds(b);
}

function getAvailableMarkets(datasets) {
  const grouped = new Map();
  (datasets || []).forEach(dataset => {
    if (!dataset || dataset.data_kind === 'trades' || !dataset.instrument || !timeframeSeconds(dataset.timeframe)) return;
    const key = dataset.instrument + '::' + (dataset.source_symbol || '');
    if (!grouped.has(key)) grouped.set(key, {
      key,
      instrument: dataset.instrument,
      sourceSymbol: dataset.source_symbol || '',
      datasets: [],
      timeframes: new Set(),
      coverage: [],
    });
    const market = grouped.get(key);
    market.datasets.push(dataset);
    market.timeframes.add(dataset.timeframe);
    market.coverage.push({
      start: new Date(dataset.start_time).getTime(),
      end: new Date(dataset.end_time).getTime(),
    });
  });
  return [...grouped.values()].map(market => {
    market.datasets.sort((a, b) => compareTimeframes(a.timeframe, b.timeframe));
    const base = market.datasets[0]?.timeframe;
    // Coverage must match the base-resolution source actually queried by replay.
    market.coverage = market.datasets
      .filter(dataset => dataset.timeframe === base)
      .map(dataset => ({ start: new Date(dataset.start_time).getTime(), end: new Date(dataset.end_time).getTime() }))
      .filter(range => Number.isFinite(range.start) && Number.isFinite(range.end))
      .sort((a, b) => a.start - b.start)
      .reduce((ranges, range) => {
        const previous = ranges[ranges.length - 1];
        if (previous && range.start <= previous.end + 1000) previous.end = Math.max(previous.end, range.end);
        else ranges.push({ ...range });
        return ranges;
      }, []);
    const baseSeconds = timeframeSeconds(base);
    const available = new Set(market.timeframes);
    if (baseSeconds >= 60) {
      AGGREGATABLE_TIMEFRAMES.forEach(candidate => {
        const seconds = timeframeSeconds(candidate);
        if (seconds >= baseSeconds && seconds % baseSeconds === 0) available.add(candidate);
      });
    } else {
      AGGREGATABLE_TIMEFRAMES.forEach(candidate => {
        const seconds = timeframeSeconds(candidate);
        if (seconds % baseSeconds === 0) available.add(candidate);
      });
    }
    market.baseTimeframe = base;
    market.availableTimeframes = [...available].sort(compareTimeframes);
    market.start = market.coverage[0]?.start ?? null;
    market.end = market.coverage[market.coverage.length - 1]?.end ?? null;
    market.label = market.sourceSymbol && market.sourceSymbol !== market.instrument
      ? market.instrument + ' · ' + market.sourceSymbol
      : market.instrument;
    return market;
  }).filter(market => market.datasets.length && market.coverage.length)
    .sort((a, b) => a.label.localeCompare(b.label));
}

function isRangeWithinCoverage(startTime, endTime, coverage) {
  return Number.isFinite(startTime)
    && Number.isFinite(endTime)
    && endTime >= startTime
    && Boolean(coverage)
    && Number.isFinite(coverage.start)
    && Number.isFinite(coverage.end)
    && startTime >= coverage.start
    && endTime <= coverage.end;
}

function aggregateCandles(candles, targetTimeframe) {
  const targetSeconds = timeframeSeconds(targetTimeframe);
  if (!targetSeconds || !Array.isArray(candles) || !candles.length) return [];
  const buckets = new Map();
  candles.forEach(candle => {
    const bucketTime = Math.floor(candle.time / targetSeconds) * targetSeconds;
    const current = buckets.get(bucketTime);
    if (!current) {
      buckets.set(bucketTime, {
        time: bucketTime,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: Number(candle.volume || 0),
      });
    } else {
      current.high = Math.max(current.high, candle.high);
      current.low = Math.min(current.low, candle.low);
      current.close = candle.close;
      current.volume += Number(candle.volume || 0);
    }
  });
  return [...buckets.values()].sort((a, b) => a.time - b.time);
}

function getSessionMarkets(datasets, start, end) {
  return getAvailableMarkets(datasets).filter(m => m.datasets.some(d => d.timeframe === m.baseTimeframe &&
    isRangeWithinCoverage(start, end, { start: Date.parse(d.start_time), end: Date.parse(d.end_time) })));
}
// The session form uses minute precision. Round inward so a displayed boundary
// never selects an instant outside the imported source. Group identical periods
// and list every market eligible for the entire selectable range.
function replaySessionRangeChoices(datasets) {
  const choices=new Map();
  for(const market of getAvailableMarkets(datasets)){
    for(const dataset of market.datasets.filter(d=>d.timeframe===market.baseTimeframe)){
      const start=Math.ceil(Date.parse(dataset.start_time)/60000)*60000;
      const end=Math.floor(Date.parse(dataset.end_time)/60000)*60000;
      if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)continue;
      const key=start+'|'+end;
      if(!choices.has(key))choices.set(key,{key,start,end,sourceLabels:[]});
      const entry=choices.get(key);
      if(!entry.sourceLabels.includes(market.label))entry.sourceLabels.push(market.label);
    }
  }
  return [...choices.values()].map(range=>({...range,eligibleLabels:getSessionMarkets(datasets,range.start,range.end).map(m=>m.label)}))
    .sort((a,b)=>b.end-a.end||a.start-b.start);
}
// Simulated active-market seconds per wall-clock second, not bars/sec.
const REPLAY_SPEEDS = [1,10,30,60,120,300,600,1200];
function restoreReplaySpeed(checkpoint, intervalSeconds) {
  if (!checkpoint) return 60;
  const wanted = checkpoint.speedMode === 'time' ? checkpoint.speed : checkpoint.speed * intervalSeconds;
  return REPLAY_SPEEDS.reduce((best,value)=>Math.abs(value-wanted)<Math.abs(best-wanted)?value:best,60);
}
// Bound background-tab catch-up without skipping any execution bars.
function replayStepBudget(elapsedMs, carry, speed, intervalSeconds) {
  if (!(intervalSeconds>0) || !(speed>0)) return { count:0, carry:0 };
  const budget = Math.max(0,carry) + Math.min(250,Math.max(0,elapsedMs))*speed/1000;
  const count = Math.min(100,Math.floor((budget+1e-9)/intervalSeconds));
  return {count,carry:Math.max(0,budget-count*intervalSeconds)};
}
// Chart intervals are independent of the execution resolution. Never create finer bars from coarser data.
const DEFAULT_REPLAY_CHART_FAVORITES = ['1m','5m','15m','1h','4h','1d'];
const DEFAULT_REPLAY_CHART_MENU = ['1m','3m','5m','15m','30m','1h','2h','4h','1d','1w','1M'];
function chartIntervalSeconds(tf) {
  if (tf === '1M') return 30 * 86400;
  if (tf === '1w') return 7 * 86400;
  return timeframeSeconds(tf);
}
function replayChartIntervals(base, available = [], favorites = [], custom = []) {
  const seconds = chartIntervalSeconds(base);
  const supported = tf => typeof tf === 'string' && /^[1-9]\d*[smhdwM]$/.test(tf) && chartIntervalSeconds(tf) > 0 && (!seconds || (chartIntervalSeconds(tf) >= seconds && chartIntervalSeconds(tf) % seconds === 0));
  const sort = (a,b) => chartIntervalSeconds(a)-chartIntervalSeconds(b);
  const menu = [...new Set([...DEFAULT_REPLAY_CHART_MENU,...available,...favorites,...custom,base])].filter(supported).sort(sort);
  const pins = (favorites.length ? favorites : DEFAULT_REPLAY_CHART_FAVORITES).filter(tf=>menu.includes(tf)).sort(sort);
  const fallback = DEFAULT_REPLAY_CHART_FAVORITES.filter(tf=>menu.includes(tf));
  return { menu, initial: pins[0] || fallback[0] || menu[0] || '1m', defaults: DEFAULT_REPLAY_CHART_FAVORITES.filter(tf=>menu.includes(tf)) };
}
function resetReplayChartLayout(layout) {
  return {...layout,rrDrawings:{},cells:layout.cells.map(cell=>{
    if (!cell.chart) return cell;
    const {hostReplayView,...chart}=cell.chart;
    return {...cell,chart:{...chart,drawings:[]}};
  })};
}
module.exports = { replaySessionRangeChoices, replayChartIntervals, resetReplayChartLayout, REPLAY_SPEEDS, restoreReplaySpeed, replayStepBudget, getSessionMarkets, TIMEFRAME_SECONDS, timeframeSeconds, compareTimeframes, getAvailableMarkets, isRangeWithinCoverage, aggregateCandles };
