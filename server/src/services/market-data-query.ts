import { asyncBufferFromFile, parquetMetadataAsync, parquetReadObjects } from 'hyparquet';
import { compressors } from 'hyparquet-compressors';

export interface MarketDataBar {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

export async function readOhlcvParquetRange(
  filePath: string,
  startTime: number,
  endTime: number,
): Promise<MarketDataBar[]> {
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime < startTime) {
    throw new Error('A valid start and end time are required for market-data queries.');
  }

  const file = await asyncBufferFromFile(filePath);
  const metadata = await parquetMetadataAsync(file);
  const schemaNames = metadata.schema.map(element => element.name);
  if (!schemaNames.includes('timestamp')) {
    throw new Error('Normalized market-data file is missing its timestamp column.');
  }

  const rows = await parquetReadObjects({
    file,
    metadata,
    columns: ['timestamp', 'open', 'high', 'low', 'close', 'volume'],
    filter: {
      timestamp: {
        $gte: new Date(startTime),
        $lte: new Date(endTime),
      },
    },
    usePageIndex: true,
    compressors,
  });

  const bars: MarketDataBar[] = [];
  for (const row of rows) {
    const timestampValue = row.timestamp;
    const timestamp = timestampValue instanceof Date
      ? timestampValue.getTime()
      : typeof timestampValue === 'bigint' ? Number(timestampValue) : Number(timestampValue);
    const open = Number(row.open);
    const high = Number(row.high);
    const low = Number(row.low);
    const close = Number(row.close);
    const volume = row.volume === null || row.volume === undefined ? null : Number(row.volume);
    if (!Number.isFinite(timestamp) || ![open, high, low, close].every(Number.isFinite)) continue;
    if (high < Math.max(open, close, low) || low > Math.min(open, close, high)) continue;
    bars.push({ timestamp, open, high, low, close, volume });
  }

  bars.sort((a, b) => a.timestamp - b.timestamp);
  return bars;
}


export interface MarketDataTick {
  timestamp: number;
  timestampNs: string;
  sequence: number;
  price: number;
  size: number;
  bidSize: number | null;
  askSize: number | null;
  tradeCount: number | null;
  sourceSymbol: string | null;
  exchange: string | null;
}

export async function readTickParquetRange(
  filePath: string,
  startTime: number,
  endTime: number,
): Promise<MarketDataTick[]> {
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime < startTime) {
    throw new Error('A valid start and end time are required for tick queries.');
  }

  const file = await asyncBufferFromFile(filePath);
  const metadata = await parquetMetadataAsync(file);
  const schemaNames = metadata.schema.map(element => element.name);
  const required = ['timestamp', 'timestamp_ns', 'sequence', 'price', 'size'];
  if (!required.every(name => schemaNames.includes(name))) {
    throw new Error('Normalized tick file is missing required event columns.');
  }

  const rows = await parquetReadObjects({
    file,
    metadata,
    columns: [
      'timestamp', 'timestamp_ns', 'sequence', 'price', 'size',
      'bid_size', 'ask_size', 'trade_count', 'source_symbol', 'exchange',
    ],
    filter: {
      timestamp: {
        $gte: new Date(startTime),
        $lte: new Date(endTime),
      },
    },
    usePageIndex: true,
    compressors,
  });

  const ticks: MarketDataTick[] = [];
  for (const row of rows) {
    const timestamp = row.timestamp instanceof Date
      ? row.timestamp.getTime() : Number(row.timestamp);
    const timestampNs = typeof row.timestamp_ns === 'bigint'
      ? row.timestamp_ns : BigInt(row.timestamp_ns as number);
    const sequenceBigInt = typeof row.sequence === 'bigint'
      ? row.sequence : BigInt(row.sequence as number);
    const sequence = Number(sequenceBigInt);
    const price = Number(row.price);
    const size = Number(row.size);
    const bidSize = row.bid_size === null || row.bid_size === undefined ? null : Number(row.bid_size);
    const askSize = row.ask_size === null || row.ask_size === undefined ? null : Number(row.ask_size);
    const tradeCount = row.trade_count === null || row.trade_count === undefined ? null : Number(row.trade_count);
    if (!Number.isSafeInteger(timestamp) || !Number.isSafeInteger(sequence)
      || !Number.isFinite(price) || price <= 0 || !Number.isFinite(size) || size < 0
      || (bidSize !== null && (!Number.isFinite(bidSize) || bidSize < 0))
      || (askSize !== null && (!Number.isFinite(askSize) || askSize < 0))
      || (tradeCount !== null && (!Number.isInteger(tradeCount) || tradeCount < 0))) {
      throw new Error('Normalized tick file contains an invalid event record.');
    }
    ticks.push({
      timestamp,
      timestampNs: timestampNs.toString(),
      sequence,
      price,
      size,
      bidSize,
      askSize,
      tradeCount,
      sourceSymbol: row.source_symbol == null ? null : String(row.source_symbol),
      exchange: row.exchange == null ? null : String(row.exchange),
    });
  }

  ticks.sort((a, b) => {
    const left = BigInt(a.timestampNs);
    const right = BigInt(b.timestampNs);
    if (left < right) return -1;
    if (left > right) return 1;
    return a.sequence - b.sequence;
  });
  return ticks;
}
