import fs from 'node:fs';
import path from 'node:path';
import {
  parquetMetadataAsync,
  parquetReadObjects,
  parquetSchema,
} from 'hyparquet';
import type { AsyncBuffer, FileMetaData } from 'hyparquet';
import { compressors } from 'hyparquet-compressors';
import { fileWriter, parquetWriteRows } from 'hyparquet-writer';
import { wallClockToUtc } from './market-data-time';

const READ_BATCH_SIZE = 50_000;

const TICK_ALIASES = {
  timestamp: ['timestamp', 'time', 'datetime', 'date', 'ts', 'event_time', 'trade_time'],
  price: ['price', 'last', 'trade_price', 'p'],
  size: ['size', 'volume', 'qty', 'quantity', 'trade_size', 'contracts'],
  bidSize: ['bid_sz', 'bid_size', 'bid_volume', 'bid_qty'],
  askSize: ['ask_sz', 'ask_size', 'ask_volume', 'ask_qty'],
  tradeCount: ['trade_count', 'trades', 'count'],
  symbol: ['symbol', 'ticker', 'instrument', 'contract', 'source_symbol'],
  exchange: ['exchange', 'venue', 'market'],
} as const;

export interface TickRecord {
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

export interface TickParquetInspection {
  format: 'parquet';
  dataKind: 'ticks';
  columns: string[];
  rowCount: number;
  validRowCount: number;
  invalidRowCount: number;
  detectedInstrument: string | null;
  detectedSymbols: string[];
  detectedTimeframe: 'tick';
  timestampUnit: string;
  timezone: string | null;
  timezoneNeedsConfirmation: boolean;
  startTime: string | null;
  endTime: string | null;
  sample: TickRecord[];
  errors: string[];
  warnings: string[];
  compressionCodecs: string[];
}

interface TickColumnMapping {
  timestamp: string;
  price: string;
  size: string;
  bidSize?: string;
  askSize?: string;
  tradeCount?: string;
  symbol?: string;
  exchange?: string;
}

interface TickParquetLayout {
  file: AsyncBuffer;
  metadata: FileMetaData;
  columns: string[];
  mapping: TickColumnMapping;
  timestampUnit: string;
  timezone: string | null;
  timezoneNeedsConfirmation: boolean;
  compressionCodecs: string[];
}

export interface NormalizeTicksOptions {
  sourceSymbol?: string | null;
  timezone?: string | null;
  skipInvalidRows?: boolean;
  detectedSymbols?: string[];
}

const rawTimestampParsers = {
  timestampFromMilliseconds: (value: bigint) => value,
  timestampFromMicroseconds: (value: bigint) => value,
  timestampFromNanoseconds: (value: bigint) => value,
};

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

function mapTickColumns(columns: string[]): TickColumnMapping {
  const normalized = new Map(columns.map(column => [normalizeColumnName(column), column]));
  const find = (key: keyof typeof TICK_ALIASES): string | undefined =>
    TICK_ALIASES[key].map(normalizeColumnName).map(alias => normalized.get(alias)).find(Boolean);
  const timestamp = find('timestamp');
  const price = find('price');
  const size = find('size');
  if (!timestamp || !price || !size) {
    throw new Error('Parquet file does not contain the required tick columns (timestamp, price, size/volume).');
  }
  return {
    timestamp,
    price,
    size,
    bidSize: find('bidSize'),
    askSize: find('askSize'),
    tradeCount: find('tradeCount'),
    symbol: find('symbol'),
    exchange: find('exchange'),
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

function timestampToNanoseconds(value: unknown, unit: string): bigint | null {
  if (value instanceof Date) {
    const millis = value.getTime();
    return Number.isFinite(millis) ? BigInt(millis) * 1_000_000n : null;
  }
  if (typeof value === 'bigint') {
    if (unit === 'NANOS') return value;
    if (unit === 'MICROS') return value * 1_000n;
    if (unit === 'MILLIS') return value * 1_000_000n;
    const absolute = value < 0n ? -value : value;
    if (absolute >= 100_000_000_000_000_000n) return value;
    if (absolute >= 100_000_000_000_000n) return value * 1_000n;
    return value * 1_000_000n;
  }
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    const integer = BigInt(value);
    if (unit === 'NANOS') return integer;
    if (unit === 'MICROS') return integer * 1_000n;
    if (unit === 'MILLIS') return integer * 1_000_000n;
    if (Math.abs(value) >= 1e17) return integer;
    if (Math.abs(value) >= 1e14) return integer * 1_000n;
    return integer * 1_000_000n;
  }
  if (typeof value === 'string') {
    const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
    const parsed = Date.parse(hasTimezone ? value : value.replace(' ', 'T') + 'Z');
    return Number.isFinite(parsed) ? BigInt(parsed) * 1_000_000n : null;
  }
  return null;
}

function normalizeTimestampTimezone(
  timestampNs: bigint,
  timezoneNeedsConfirmation: boolean,
  timezone?: string | null,
): bigint {
  if (!timezoneNeedsConfirmation) return timestampNs;
  if (!timezone) throw new Error('A timezone must be confirmed before importing this tick file.');
  const millis = Number(timestampNs / 1_000_000n);
  if (!Number.isSafeInteger(millis)) throw new Error('Tick timestamp is outside the supported date range.');
  const remainder = timestampNs % 1_000_000n;
  const utcMillis = wallClockToUtc(new Date(millis), timezone);
  return BigInt(utcMillis) * 1_000_000n + remainder;
}

function numericValue(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'bigint' ? Number(value) : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function inspectTickLayout(buffer: Uint8Array): Promise<TickParquetLayout> {
  const file = toAsyncBuffer(buffer);
  const metadata = await parquetMetadataAsync(file);
  const schema = parquetSchema(metadata);
  const columns = schema.children.map(child => child.element.name);
  const mapping = mapTickColumns(columns);
  const timestampElement = metadata.schema.find(element => element.name === mapping.timestamp);
  const logicalTimestamp = timestampElement?.logical_type?.type === 'TIMESTAMP'
    ? timestampElement.logical_type : null;
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
    file, metadata, columns, mapping, timestampUnit,
    timezone, timezoneNeedsConfirmation, compressionCodecs,
  };
}

function readTickRow(row: Record<string, unknown>, mapping: TickColumnMapping, timestampUnit: string, timezoneNeedsConfirmation: boolean, timezone?: string | null, sequence = 0): TickRecord | null {
  const rawNs = timestampToNanoseconds(row[mapping.timestamp], timestampUnit);
  if (rawNs === null) return null;
  let timestampNs: bigint;
  try {
    timestampNs = normalizeTimestampTimezone(rawNs, timezoneNeedsConfirmation, timezone);
  } catch {
    if (timezoneNeedsConfirmation && !timezone) timestampNs = rawNs;
    else return null;
  }
  const timestamp = Number(timestampNs / 1_000_000n);
  const price = numericValue(row[mapping.price]);
  const size = numericValue(row[mapping.size]);
  const bidSize = mapping.bidSize ? numericValue(row[mapping.bidSize]) : null;
  const askSize = mapping.askSize ? numericValue(row[mapping.askSize]) : null;
  const tradeCount = mapping.tradeCount ? numericValue(row[mapping.tradeCount]) : null;
  const symbolValue = mapping.symbol ? row[mapping.symbol] : null;
  const exchangeValue = mapping.exchange ? row[mapping.exchange] : null;
  if (!Number.isSafeInteger(timestamp) || price === null || price <= 0 || size === null || size < 0) return null;
  if (bidSize !== null && bidSize < 0) return null;
  if (askSize !== null && askSize < 0) return null;
  if (tradeCount !== null && (tradeCount < 0 || !Number.isInteger(tradeCount))) return null;
  return {
    timestamp,
    timestampNs: timestampNs.toString(),
    sequence,
    price,
    size,
    bidSize,
    askSize,
    tradeCount,
    sourceSymbol: symbolValue === null || symbolValue === undefined || symbolValue === '' ? null : String(symbolValue).trim().toUpperCase(),
    exchange: exchangeValue === null || exchangeValue === undefined || exchangeValue === '' ? null : String(exchangeValue).trim().toUpperCase(),
  };
}

export async function inspectTickParquet(buffer: Uint8Array, filename: string): Promise<TickParquetInspection> {
  const layout = await inspectTickLayout(buffer);
  const totalRows = Number(layout.metadata.num_rows);
  if (!Number.isSafeInteger(totalRows) || totalRows < 1) throw new Error('Parquet tick file contains no records.');
  const readColumns = [
    layout.mapping.timestamp, layout.mapping.price, layout.mapping.size,
    ...(layout.mapping.bidSize ? [layout.mapping.bidSize] : []),
    ...(layout.mapping.askSize ? [layout.mapping.askSize] : []),
    ...(layout.mapping.tradeCount ? [layout.mapping.tradeCount] : []),
    ...(layout.mapping.symbol ? [layout.mapping.symbol] : []),
    ...(layout.mapping.exchange ? [layout.mapping.exchange] : []),
  ];
  const lastTimestampBySymbol = new Map<string, bigint>();
  const symbols = new Set<string>();
  const errors: string[] = [];
  const sample: TickRecord[] = [];
  let invalidRowCount = 0;
  let startNs: bigint | null = null;
  let endNs: bigint | null = null;

  for (let rowStart = 0; rowStart < totalRows; rowStart += READ_BATCH_SIZE) {
    const rowEnd = Math.min(totalRows, rowStart + READ_BATCH_SIZE);
    const rows = await parquetReadObjects({
      file: layout.file, metadata: layout.metadata, columns: readColumns,
      rowStart, rowEnd, compressors, parsers: rawTimestampParsers,
    });
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index] as Record<string, unknown>;
      const record = readTickRow(row, layout.mapping, layout.timestampUnit, false, null, rowStart + index);
      if (!record) {
        invalidRowCount += 1;
        if (errors.length < 10) errors.push('Row ' + (rowStart + index + 1) + ': invalid timestamp, price, size or optional tick fields.');
        continue;
      }
      if (record.sourceSymbol) symbols.add(record.sourceSymbol);
      const ns = BigInt(record.timestampNs);
      const key = record.sourceSymbol || '__default__';
      const previous = lastTimestampBySymbol.get(key);
      if (previous !== undefined && ns < previous) {
        invalidRowCount += 1;
        if (errors.length < 10) errors.push('Row ' + (rowStart + index + 1) + ': tick events are not in chronological order.');
        continue;
      }
      lastTimestampBySymbol.set(key, ns);
      if (startNs === null || ns < startNs) startNs = ns;
      if (endNs === null || ns > endNs) endNs = ns;
      if (sample.length < 10) sample.push(record);
    }
  }

  const detectedSymbols = [...symbols];
  const warnings: string[] = [
    'Tick records are preserved as individual events. Repeated timestamps are retained; no candle aggregation or timestamp deduplication is performed.',
  ];
  if (detectedSymbols.length > 1) warnings.push('The file contains multiple source symbols. Each symbol must be imported as its own tick dataset.');
  if (invalidRowCount) warnings.push(invalidRowCount + ' invalid or out-of-order tick row(s) were excluded from the valid preview.');
  if (layout.timezoneNeedsConfirmation) warnings.push('Tick timestamps do not declare UTC; confirm the source timezone before import.');
  const detectedInstrument = detectInstrument(filename, detectedSymbols);
  if (!detectedInstrument) warnings.push('Instrument could not be identified confidently; select it during review.');

  return {
    format: 'parquet',
    dataKind: 'ticks',
    columns: layout.columns,
    rowCount: totalRows,
    validRowCount: totalRows - invalidRowCount,
    invalidRowCount,
    detectedInstrument,
    detectedSymbols,
    detectedTimeframe: 'tick',
    timestampUnit: layout.timestampUnit,
    timezone: layout.timezone,
    timezoneNeedsConfirmation: layout.timezoneNeedsConfirmation,
    startTime: startNs === null ? null : new Date(Number(startNs / 1_000_000n)).toISOString(),
    endTime: endNs === null ? null : new Date(Number(endNs / 1_000_000n)).toISOString(),
    sample,
    errors,
    warnings,
    compressionCodecs: layout.compressionCodecs,
  };
}

export async function normalizeTickParquet(
  buffer: Uint8Array,
  destinationPath: string,
  options: NormalizeTicksOptions = {},
): Promise<{ rowCount: number; startTime: string; endTime: string; sourceSymbol: string | null }> {
  const layout = await inspectTickLayout(buffer);
  if (layout.timezoneNeedsConfirmation && !options.timezone) {
    throw new Error('A timezone must be confirmed before importing this tick file.');
  }
  const detectedSymbols = options.detectedSymbols ?? (await inspectTickParquet(buffer, 'source.parquet')).detectedSymbols;
  const symbols = new Set(detectedSymbols);
  const sourceSymbol = options.sourceSymbol?.toUpperCase() ?? (symbols.size === 1 ? [...symbols][0] : null);
  if (symbols.size > 1 && !sourceSymbol) {
    throw new Error('This tick file contains multiple symbols. Select a source symbol for this dataset before importing.');
  }
  if (sourceSymbol && symbols.size && !symbols.has(sourceSymbol)) {
    throw new Error('Selected source symbol ' + sourceSymbol + ' was not found in the tick file.');
  }

  const readColumns = [
    layout.mapping.timestamp, layout.mapping.price, layout.mapping.size,
    ...(layout.mapping.bidSize ? [layout.mapping.bidSize] : []),
    ...(layout.mapping.askSize ? [layout.mapping.askSize] : []),
    ...(layout.mapping.tradeCount ? [layout.mapping.tradeCount] : []),
    ...(layout.mapping.symbol ? [layout.mapping.symbol] : []),
    ...(layout.mapping.exchange ? [layout.mapping.exchange] : []),
  ];
  let rowCount = 0;
  let startMs = Number.POSITIVE_INFINITY;
  let endMs = Number.NEGATIVE_INFINITY;
  let previousNs: bigint | null = null;

  async function* normalizedRows(): AsyncGenerator<Record<string, unknown>> {
    const totalRows = Number(layout.metadata.num_rows);
    for (let rowStart = 0; rowStart < totalRows; rowStart += READ_BATCH_SIZE) {
      const rowEnd = Math.min(totalRows, rowStart + READ_BATCH_SIZE);
      const rows = await parquetReadObjects({
        file: layout.file, metadata: layout.metadata, columns: readColumns,
        rowStart, rowEnd, compressors, parsers: rawTimestampParsers,
      });
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index] as Record<string, unknown>;
        const symbolValue = layout.mapping.symbol ? row[layout.mapping.symbol] : null;
        const rowSymbol = symbolValue === null || symbolValue === undefined || symbolValue === ''
          ? null : String(symbolValue).trim().toUpperCase();
        if (layout.mapping.symbol && sourceSymbol && rowSymbol !== sourceSymbol) continue;
        const rawNs = timestampToNanoseconds(row[layout.mapping.timestamp], layout.timestampUnit);
        if (rawNs === null) {
          if (options.skipInvalidRows) continue;
          throw new Error('Invalid tick timestamp at source row ' + (rowStart + index + 1) + '.');
        }
        let timestampNs: bigint;
        try {
          timestampNs = normalizeTimestampTimezone(rawNs, layout.timezoneNeedsConfirmation, options.timezone);
        } catch (error) {
          if (options.skipInvalidRows) continue;
          throw error;
        }
        if (previousNs !== null && timestampNs < previousNs) {
          if (options.skipInvalidRows) continue;
          throw new Error('Selected tick source-symbol rows are not in chronological order.');
        }
        const price = numericValue(row[layout.mapping.price]);
        const size = numericValue(row[layout.mapping.size]);
        const bidSize = layout.mapping.bidSize ? numericValue(row[layout.mapping.bidSize]) : null;
        const askSize = layout.mapping.askSize ? numericValue(row[layout.mapping.askSize]) : null;
        const tradeCount = layout.mapping.tradeCount ? numericValue(row[layout.mapping.tradeCount]) : null;
        if (price === null || price <= 0 || size === null || size < 0
          || (bidSize !== null && bidSize < 0)
          || (askSize !== null && askSize < 0)
          || (tradeCount !== null && (tradeCount < 0 || !Number.isInteger(tradeCount)))) {
          if (options.skipInvalidRows) continue;
          throw new Error('Invalid tick values at source row ' + (rowStart + index + 1) + '.');
        }
        const timestamp = Number(timestampNs / 1_000_000n);
        if (!Number.isSafeInteger(timestamp)) {
          if (options.skipInvalidRows) continue;
          throw new Error('Tick timestamp is outside the supported date range.');
        }
        previousNs = timestampNs;
        rowCount += 1;
        startMs = Math.min(startMs, timestamp);
        endMs = Math.max(endMs, timestamp);
        yield {
          timestamp: new Date(timestamp),
          timestamp_ns: timestampNs,
          sequence: BigInt(rowStart + index),
          price,
          size,
          bid_size: bidSize,
          ask_size: askSize,
          trade_count: tradeCount === null ? null : BigInt(Math.trunc(tradeCount)),
          source_symbol: sourceSymbol ?? rowSymbol,
          exchange: !layout.mapping.exchange || row[layout.mapping.exchange] == null
            ? null : String(row[layout.mapping.exchange]).trim().toUpperCase(),
        };
      }
    }
  }

  await fs.promises.mkdir(path.dirname(destinationPath), { recursive: true });
  try {
    await parquetWriteRows({
      writer: fileWriter(destinationPath),
      rows: normalizedRows(),
      columns: [
        { name: 'timestamp', type: 'TIMESTAMP', columnIndex: true },
        { name: 'timestamp_ns', type: 'INT64', columnIndex: true },
        { name: 'sequence', type: 'INT64' },
        { name: 'price', type: 'DOUBLE' },
        { name: 'size', type: 'DOUBLE' },
        { name: 'bid_size', type: 'DOUBLE' },
        { name: 'ask_size', type: 'DOUBLE' },
        { name: 'trade_count', type: 'INT64' },
        { name: 'source_symbol', type: 'STRING' },
        { name: 'exchange', type: 'STRING' },
      ],
      rowGroupSize: READ_BATCH_SIZE,
      codec: 'SNAPPY',
      createdBy: 'RR Metrics historical tick data',
    });
  } catch (error) {
    await fs.promises.rm(destinationPath, { force: true }).catch(() => undefined);
    throw error;
  }

  if (!rowCount || !Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    await fs.promises.rm(destinationPath, { force: true });
    throw new Error('No valid tick records were supplied for normalization.');
  }
  return {
    rowCount,
    startTime: new Date(startMs).toISOString(),
    endTime: new Date(endMs).toISOString(),
    sourceSymbol,
  };
}
