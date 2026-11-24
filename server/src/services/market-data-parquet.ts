import fs from 'node:fs';
import path from 'node:path';
import {
  parquetMetadataAsync,
  parquetReadObjects,
  parquetSchema,
} from 'hyparquet';
import type { AsyncBuffer, FileMetaData } from 'hyparquet';
import { compressors } from 'hyparquet-compressors';
import { wallClockToUtc } from './market-data-time';
import { fileWriter, parquetWriteRows } from 'hyparquet-writer';

const READ_BATCH_SIZE = 50_000;

const COLUMN_ALIASES = {
  timestamp: ['timestamp', 'time', 'datetime', 'date', 'ts', 'start', 'bar_time'],
  open: ['open', 'o'],
  high: ['high', 'h'],
  low: ['low', 'l'],
  close: ['close', 'c', 'last'],
  volume: ['volume', 'vol', 'v'],
  symbol: ['symbol', 'ticker', 'instrument', 'contract', 'source_symbol'],
} as const;

export interface ParquetOhlcvBar {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
  sourceSymbol: string | null;
}

export interface ParquetOhlcvInspection {
  format: 'parquet';
  columns: string[];
  rowCount: number;
  validRowCount: number;
  invalidRowCount: number;
  detectedInstrument: string | null;
  detectedSymbols: string[];
  detectedTimeframe: string | null;
  timestampUnit: string;
  timezone: string | null;
  timezoneNeedsConfirmation: boolean;
  startTime: string | null;
  endTime: string | null;
  sample: ParquetOhlcvBar[];
  errors: string[];
  warnings: string[];
  compressionCodecs: string[];
}

interface ColumnMapping {
  timestamp: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume?: string;
  symbol?: string;
}

interface ParquetLayout {
  file: AsyncBuffer;
  metadata: FileMetaData;
  columns: string[];
  mapping: ColumnMapping;
  timestampUnit: string;
  timezone: string | null;
  timezoneNeedsConfirmation: boolean;
  compressionCodecs: string[];
}

export interface NormalizeParquetOptions {
  sourceSymbol?: string | null;
  timezone?: string | null;
  skipInvalidRows?: boolean;
}

function toAsyncBuffer(buffer: Uint8Array): AsyncBuffer {
  return {
    byteLength: buffer.byteLength,
    slice(start: number, end = buffer.byteLength): ArrayBuffer {
      const part = buffer.subarray(start, end);
      const copy = new Uint8Array(part.byteLength);
      copy.set(part);
      return copy.buffer;
    },
  };
}

function normalizeColumnName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function mapColumns(columns: string[]): ColumnMapping {
  const normalized = new Map(columns.map(column => [normalizeColumnName(column), column]));
  const find = (key: keyof typeof COLUMN_ALIASES): string | undefined =>
    COLUMN_ALIASES[key].map(normalizeColumnName).map(alias => normalized.get(alias)).find(Boolean);

  const timestamp = find('timestamp');
  const open = find('open');
  const high = find('high');
  const low = find('low');
  const close = find('close');
  if (!timestamp || !open || !high || !low || !close) {
    throw new Error('Parquet file does not contain the required OHLCV columns (timestamp, open, high, low, close).');
  }
  return {
    timestamp,
    open,
    high,
    low,
    close,
    volume: find('volume'),
    symbol: find('symbol'),
  };
}

function detectInstrument(filename: string, symbols: string[]): string | null {
  const tokens = [...symbols, path.basename(filename, path.extname(filename))]
    .join(' ').toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  const known = ['MNQ', 'NQ', 'MES', 'ES', 'MGC', 'GC', 'MYM', 'YM', 'M2K', 'RTY', 'MCL', 'CL', '6E', '6B', '6J'];
  const matches = new Set<string>();
  for (const token of tokens) {
    for (const symbol of known) {
      const datedContract = new RegExp('^' + symbol + '[FGHJKMNQUVXZ][0-9]{1,2}$');
      if (token === symbol || datedContract.test(token)) matches.add(symbol);
    }
  }
  return matches.size === 1 ? [...matches][0] : null;
}

function timestampUnitFromSchema(element: FileMetaData['schema'][number] | undefined): string {
  const logical = element?.logical_type;
  if (logical?.type === 'TIMESTAMP') return logical.unit;
  if (element?.converted_type === 'TIMESTAMP_MICROS') return 'MICROS';
  if (element?.converted_type === 'TIMESTAMP_MILLIS') return 'MILLIS';
  return 'UNKNOWN';
}

function timestampToMilliseconds(value: unknown, unit: string): number | null {
  if (value instanceof Date) {
    const result = value.getTime();
    return Number.isFinite(result) ? result : null;
  }
  if (typeof value === 'bigint') {
    if (unit === 'NANOS') return Number(value / 1_000_000n);
    if (unit === 'MICROS') return Number(value / 1_000n);
    if (unit === 'MILLIS') return Number(value);
    const absolute = value < 0n ? -value : value;
    if (absolute >= 100_000_000_000_000_000n) return Number(value / 1_000_000n);
    if (absolute >= 100_000_000_000_000n) return Number(value / 1_000n);
    return Number(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    if (unit === 'NANOS') return Math.trunc(value / 1_000_000);
    if (unit === 'MICROS') return Math.trunc(value / 1_000);
    if (unit === 'MILLIS') return Math.trunc(value);
    if (Math.abs(value) >= 1e17) return Math.trunc(value / 1e6);
    if (Math.abs(value) >= 1e14) return Math.trunc(value / 1e3);
    return Math.trunc(value);
  }
  if (typeof value === 'string') {
    const hasTimezone = /(?:Z|[+-]\\d{2}:?\\d{2})$/i.test(value);
    const normalized = hasTimezone ? value : `${value.replace(' ', 'T')}Z`;
    const parsed = Date.parse(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function numericValue(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'bigint' ? Number(value) : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isValidBar(bar: Omit<ParquetOhlcvBar, 'timestamp' | 'sourceSymbol'>): boolean {
  if (![bar.open, bar.high, bar.low, bar.close].every(Number.isFinite)) return false;
  if (bar.open <= 0 || bar.high <= 0 || bar.low <= 0 || bar.close <= 0) return false;
  if (bar.high < Math.max(bar.open, bar.close, bar.low)) return false;
  if (bar.low > Math.min(bar.open, bar.close, bar.high)) return false;
  return bar.volume === null || (Number.isFinite(bar.volume) && bar.volume >= 0);
}

async function inspectLayout(buffer: Uint8Array): Promise<ParquetLayout> {
  const file = toAsyncBuffer(buffer);
  const metadata = await parquetMetadataAsync(file);
  const schema = parquetSchema(metadata);
  const columns = schema.children.map(child => child.element.name);
  const mapping = mapColumns(columns);
  const timestampElement = metadata.schema.find(element => element.name === mapping.timestamp);
  const logicalTimestamp = timestampElement?.logical_type?.type === 'TIMESTAMP'
    ? timestampElement.logical_type
    : null;
  const timestampUnit = timestampUnitFromSchema(timestampElement);
  const legacyUtcTimestamp = timestampElement?.converted_type === 'TIMESTAMP_MILLIS'
    || timestampElement?.converted_type === 'TIMESTAMP_MICROS';
  const timezoneNeedsConfirmation = logicalTimestamp
    ? !logicalTimestamp.isAdjustedToUTC
    : !legacyUtcTimestamp;
  const timezone = logicalTimestamp?.isAdjustedToUTC || legacyUtcTimestamp ? 'UTC' : null;
  const compressionCodecs = [...new Set(
    metadata.row_groups.flatMap(group =>
      group.columns.map(column => column.meta_data?.codec).filter((codec): codec is NonNullable<typeof codec> => Boolean(codec)),
    ),
  )];

  return {
    file,
    metadata,
    columns,
    mapping,
    timestampUnit,
    timezone,
    timezoneNeedsConfirmation,
    compressionCodecs,
  };
}

function medianFromHistogram(histogram: Map<number, number>): number | null {
  let total = 0;
  for (const count of histogram.values()) total += count;
  if (!total) return null;
  const targets = [Math.floor((total - 1) / 2), Math.floor(total / 2)];
  let cumulative = 0;
  const sorted = [...histogram.entries()].sort((a, b) => a[0] - b[0]);
  let first = 0;
  let second = 0;
  for (const [gap, count] of sorted) {
    const previous = cumulative;
    cumulative += count;
    if (targets[0] >= previous && targets[0] < cumulative) first = gap;
    if (targets[1] >= previous && targets[1] < cumulative) {
      second = gap;
      break;
    }
  }
  return Math.round((first + second) / 2);
}

export async function inspectOhlcvParquet(
  buffer: Uint8Array,
  filename: string,
): Promise<ParquetOhlcvInspection> {
  const layout = await inspectLayout(buffer);
  const rowCount = Number(layout.metadata.num_rows);
  if (!Number.isSafeInteger(rowCount) || rowCount < 1) {
    throw new Error('Parquet file contains no readable rows or exceeds the supported row count.');
  }

  const symbols = new Set<string>();
  const lastTimestampBySymbol = new Map<string, number>();
  const gapsBySymbol = new Map<string, Map<number, number>>();
  const sample: ParquetOhlcvBar[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  let validRowCount = 0;
  let invalidRowCount = 0;
  let startTime = Number.POSITIVE_INFINITY;
  let endTime = Number.NEGATIVE_INFINITY;

  const readColumns = [
    layout.mapping.timestamp,
    layout.mapping.open,
    layout.mapping.high,
    layout.mapping.low,
    layout.mapping.close,
    ...(layout.mapping.volume ? [layout.mapping.volume] : []),
    ...(layout.mapping.symbol ? [layout.mapping.symbol] : []),
  ];

  for (let rowStart = 0; rowStart < rowCount; rowStart += READ_BATCH_SIZE) {
    const rowEnd = Math.min(rowCount, rowStart + READ_BATCH_SIZE);
    const rows = await parquetReadObjects({
      file: layout.file,
      metadata: layout.metadata,
      columns: readColumns,
      rowStart,
      rowEnd,
      compressors,
    });

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const timestamp = timestampToMilliseconds(row[layout.mapping.timestamp], layout.timestampUnit);
      const sourceSymbolValue = layout.mapping.symbol ? row[layout.mapping.symbol] : null;
      const sourceSymbol = sourceSymbolValue === null || sourceSymbolValue === undefined || sourceSymbolValue === ''
        ? null
        : String(sourceSymbolValue).trim().toUpperCase();
      if (sourceSymbol) symbols.add(sourceSymbol);

      const bar = {
        timestamp: timestamp ?? Number.NaN,
        open: numericValue(row[layout.mapping.open]) ?? Number.NaN,
        high: numericValue(row[layout.mapping.high]) ?? Number.NaN,
        low: numericValue(row[layout.mapping.low]) ?? Number.NaN,
        close: numericValue(row[layout.mapping.close]) ?? Number.NaN,
        volume: layout.mapping.volume ? numericValue(row[layout.mapping.volume]) : null,
        sourceSymbol,
      };

      let reason: string | null = null;
      if (timestamp === null) reason = 'invalid timestamp';
      else if (!isValidBar(bar)) reason = 'invalid OHLCV values';
      else {
        const key = sourceSymbol ?? '';
        const previous = lastTimestampBySymbol.get(key);
        if (previous !== undefined && timestamp <= previous) {
          reason = timestamp === previous ? 'duplicate timestamp' : 'timestamps are not ordered';
        } else if (previous !== undefined) {
          const gap = timestamp - previous;
          const histogram = gapsBySymbol.get(key) ?? new Map<number, number>();
          histogram.set(gap, (histogram.get(gap) ?? 0) + 1);
          gapsBySymbol.set(key, histogram);
        }
      }

      if (reason) {
        invalidRowCount += 1;
        if (errors.length < 10) errors.push(`Row ${rowStart + index + 1}: ${reason}.`);
        continue;
      }

      lastTimestampBySymbol.set(sourceSymbol ?? '', timestamp!);
      validRowCount += 1;
      startTime = Math.min(startTime, timestamp!);
      endTime = Math.max(endTime, timestamp!);
      if (sample.length < 10) sample.push({ ...bar, timestamp: timestamp! });
    }
  }

  const detectedSymbols = [...symbols];
  const detectedInstrument = detectInstrument(filename, detectedSymbols);
  const gaps = new Map<number, number>();
  for (const histogram of gapsBySymbol.values()) {
    for (const [gap, count] of histogram) gaps.set(gap, (gaps.get(gap) ?? 0) + count);
  }
  const medianGap = medianFromHistogram(gaps);
  const gapSeconds = medianGap ? Math.round(medianGap / 1000) : 0;
  const detectedTimeframe = gapSeconds
    ? gapSeconds % 86_400 === 0 ? `${gapSeconds / 86_400}d`
      : gapSeconds % 3_600 === 0 ? `${gapSeconds / 3_600}h`
        : gapSeconds % 60 === 0 ? `${gapSeconds / 60}m`
          : `${gapSeconds}s`
    : null;

  if (detectedSymbols.length > 1) {
    warnings.push('The file contains multiple instrument symbols. Import each symbol as a separate dataset; no symbol data should be discarded.');
  }
  if (invalidRowCount) warnings.push(`${invalidRowCount} row(s) were excluded from the valid preview.`);
  if (layout.timezoneNeedsConfirmation) {
    warnings.push('Parquet timestamps are not explicitly marked as UTC. Confirm the source timezone before import.');
  }
  if (!detectedInstrument) warnings.push('Instrument could not be identified confidently; select it during review.');

  return {
    format: 'parquet',
    columns: layout.columns,
    rowCount,
    validRowCount,
    invalidRowCount,
    detectedInstrument,
    detectedSymbols,
    detectedTimeframe,
    timestampUnit: layout.timestampUnit,
    timezone: layout.timezone,
    timezoneNeedsConfirmation: layout.timezoneNeedsConfirmation,
    startTime: Number.isFinite(startTime) ? new Date(startTime).toISOString() : null,
    endTime: Number.isFinite(endTime) ? new Date(endTime).toISOString() : null,
    sample,
    errors,
    warnings,
    compressionCodecs: layout.compressionCodecs,
  };
}

function timestampForImport(value: unknown, unit: string, timezoneNeedsConfirmation: boolean, timezone?: string | null): number {
  const timestamp = timestampToMilliseconds(value, unit);
  if (timestamp === null) throw new Error('Parquet row contains an invalid timestamp.');
  if (timezoneNeedsConfirmation) {
    if (!timezone) throw new Error('A timezone must be confirmed before importing this Parquet file.');
    if (value instanceof Date) return wallClockToUtc(value, timezone);
    if (typeof value === 'string' && !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) {
      const parsed = new Date(value.endsWith('Z') ? value : `${value.replace(' ', 'T')}Z`);
      if (!Number.isFinite(parsed.getTime())) throw new Error('Parquet row contains an invalid local timestamp.');
      return wallClockToUtc(parsed, timezone);
    }
  }
  return timestamp;
}

export async function writeOhlcvBarsToParquet(
  destinationPath: string,
  rows: Iterable<Pick<ParquetOhlcvBar, 'timestamp' | 'open' | 'high' | 'low' | 'close' | 'volume'>> |
    AsyncIterable<Pick<ParquetOhlcvBar, 'timestamp' | 'open' | 'high' | 'low' | 'close' | 'volume'>>,
): Promise<{ rowCount: number; startTime: string; endTime: string }> {
  let rowCount = 0;
  let startTime = Number.POSITIVE_INFINITY;
  let endTime = Number.NEGATIVE_INFINITY;
  let previousTimestamp = Number.NEGATIVE_INFINITY;

  async function* writerRows(): AsyncGenerator<Record<string, unknown>> {
    for await (const bar of rows) {
      if (!Number.isSafeInteger(bar.timestamp) || bar.timestamp <= previousTimestamp) {
        throw new Error('Normalized OHLCV rows must have unique, ascending millisecond timestamps.');
      }
      if (!isValidBar(bar)) throw new Error(`Invalid normalized OHLCV values at row ${rowCount + 1}.`);
      previousTimestamp = bar.timestamp;
      rowCount += 1;
      startTime = Math.min(startTime, bar.timestamp);
      endTime = Math.max(endTime, bar.timestamp);
      yield {
        timestamp: new Date(bar.timestamp),
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
      };
    }
  }

  await fs.promises.mkdir(path.dirname(destinationPath), { recursive: true });
  try {
    await parquetWriteRows({
      writer: fileWriter(destinationPath),
      rows: writerRows(),
      columns: [
        { name: 'timestamp', type: 'TIMESTAMP', columnIndex: true },
        { name: 'open', type: 'DOUBLE' },
        { name: 'high', type: 'DOUBLE' },
        { name: 'low', type: 'DOUBLE' },
        { name: 'close', type: 'DOUBLE' },
        { name: 'volume', type: 'DOUBLE' },
      ],
      rowGroupSize: 50_000,
      codec: 'SNAPPY',
      createdBy: 'RR Metrics historical market data',
    });
  } catch (error) {
    await fs.promises.rm(destinationPath, { force: true }).catch(() => undefined);
    throw error;
  }

  if (!rowCount || !Number.isFinite(startTime) || !Number.isFinite(endTime)) {
    await fs.promises.rm(destinationPath, { force: true });
    throw new Error('No valid OHLCV rows were supplied for normalization.');
  }
  return {
    rowCount,
    startTime: new Date(startTime).toISOString(),
    endTime: new Date(endTime).toISOString(),
  };
}

export async function normalizeOhlcvParquet(
  buffer: Uint8Array,
  destinationPath: string,
  options: NormalizeParquetOptions = {},
): Promise<{ rowCount: number; startTime: string; endTime: string; sourceSymbol: string | null }> {
  const layout = await inspectLayout(buffer);
  if (layout.timezoneNeedsConfirmation && !options.timezone) {
    throw new Error('A timezone must be confirmed before importing this Parquet file.');
  }

  const inspection = await inspectOhlcvParquet(buffer, 'source.parquet');
  const symbols = new Set(inspection.detectedSymbols);
  const sourceSymbol = options.sourceSymbol?.toUpperCase() ?? (symbols.size === 1 ? [...symbols][0] : null);
  if (symbols.size > 1 && !sourceSymbol) {
    throw new Error('This file contains multiple symbols. Select a source symbol for this dataset before importing.');
  }
  if (sourceSymbol && symbols.size && !symbols.has(sourceSymbol)) {
    throw new Error(`Selected source symbol ${sourceSymbol} was not found in the file.`);
  }

  const readColumns = [
    layout.mapping.timestamp,
    layout.mapping.open,
    layout.mapping.high,
    layout.mapping.low,
    layout.mapping.close,
    ...(layout.mapping.volume ? [layout.mapping.volume] : []),
    ...(layout.mapping.symbol ? [layout.mapping.symbol] : []),
  ];

  async function* normalizedRows(): AsyncGenerator<Pick<ParquetOhlcvBar, 'timestamp' | 'open' | 'high' | 'low' | 'close' | 'volume'>> {
    let previousTimestamp = Number.NEGATIVE_INFINITY;
    const totalRows = Number(layout.metadata.num_rows);
    for (let rowStart = 0; rowStart < totalRows; rowStart += READ_BATCH_SIZE) {
      const rowEnd = Math.min(totalRows, rowStart + READ_BATCH_SIZE);
      const rows = await parquetReadObjects({
        file: layout.file,
        metadata: layout.metadata,
        columns: readColumns,
        rowStart,
        rowEnd,
        compressors,
      });
      for (const row of rows) {
        const symbolValue = layout.mapping.symbol ? row[layout.mapping.symbol] : null;
        const rowSymbol = symbolValue === null || symbolValue === undefined || symbolValue === ''
          ? null
          : String(symbolValue).trim().toUpperCase();
        if (layout.mapping.symbol && sourceSymbol && rowSymbol !== sourceSymbol) continue;
        let timestamp: number;
        try {
          timestamp = timestampForImport(
            row[layout.mapping.timestamp],
            layout.timestampUnit,
            layout.timezoneNeedsConfirmation,
            options.timezone,
          );
        } catch (error) {
          if (options.skipInvalidRows) continue;
          throw error;
        }
        if (timestamp <= previousTimestamp) {
          if (options.skipInvalidRows) continue;
          throw new Error('Selected source-symbol rows are duplicated or not in chronological order.');
        }
        const bar = {
          open: numericValue(row[layout.mapping.open]),
          high: numericValue(row[layout.mapping.high]),
          low: numericValue(row[layout.mapping.low]),
          close: numericValue(row[layout.mapping.close]),
          volume: layout.mapping.volume ? numericValue(row[layout.mapping.volume]) : null,
        };
        if (!isValidBar({
          open: bar.open ?? Number.NaN,
          high: bar.high ?? Number.NaN,
          low: bar.low ?? Number.NaN,
          close: bar.close ?? Number.NaN,
          volume: bar.volume,
        })) {
          if (options.skipInvalidRows) continue;
          throw new Error(`Invalid OHLCV values at source row ${rowStart + rows.indexOf(row) + 1}.`);
        }
        previousTimestamp = timestamp;
        yield {
          timestamp,
          open: bar.open!,
          high: bar.high!,
          low: bar.low!,
          close: bar.close!,
          volume: bar.volume,
        };
      }
    }
  }

  const result = await writeOhlcvBarsToParquet(destinationPath, normalizedRows());
  return { ...result, sourceSymbol };
}
