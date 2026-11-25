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
module.exports = { getSessionMarkets, TIMEFRAME_SECONDS, timeframeSeconds, compareTimeframes, getAvailableMarkets, isRangeWithinCoverage, aggregateCandles };
