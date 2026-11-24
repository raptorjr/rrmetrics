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
