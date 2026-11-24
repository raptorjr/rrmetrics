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

const ALIASES = {
  timestamp: ['timestamp', 'time', 'datetime', 'date', 'ts'],
  price: ['price', 'trade_price', 'last', 'last_price'],
  volume: ['volume', 'size', 'qty', 'quantity', 'trade_size'],
  bidSize: ['bid_sz', 'bid_size', 'bidvolume', 'bid_volume'],
  askSize: ['ask_sz', 'ask_size', 'askvolume', 'ask_volume'],
  tradeCount: ['trade_count', 'trades', 'count'],
  symbol: ['symbol', 'ticker', 'instrument', 'contract', 'source_symbol'],
  exchange: ['exchange', 'venue'],
} as const;

export interface TradeTick {
  timestampNs: string;
  price: number;
  volume: number;
  bidSize: number | null;
  askSize: number | null;
  tradeCount: number | null;
  sourceSymbol: string | null;
  exchange: string | null;
  sourceRow: number;
}

export interface TradeTickInspection {
  dataKind: 'trades';
  format: 'parquet';
  columns: string[];
  rowCount: number;
  validRowCount: number;
  invalidRowCount: number;
  detectedInstrument: string | null;
  detectedSymbols: string[];
  detectedExchange: string | null;
  timestampUnit: string;
  timezone: string | null;
  timezoneNeedsConfirmation: boolean;
  startTime: string | null;
  endTime: string | null;
  startTimeNs: string | null;
  endTimeNs: string | null;
  totalVolume: number;
  totalTradeCount: number | null;
  bidAskMismatchCount: number;
  sample: TradeTick[];
  errors: string[];
  warnings: string[];
  compressionCodecs: string[];
}

interface TickMapping {
  timestamp: string;
  price: string;
  volume: string;
  bidSize?: string;
  askSize?: string;
  tradeCount?: string;
  symbol?: string;
  exchange?: string;
}

interface TickLayout {
  file: AsyncBuffer;
  metadata: FileMetaData;
  columns: string[];
  mapping: TickMapping;
  timestampUnit: string;
  timezone: string | null;
  timezoneNeedsConfirmation: boolean;
  compressionCodecs: string[];
}

export interface NormalizeTradeTicksOptions {
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

function mapColumns(columns: string[]): TickMapping {
  const normalized = new Map(columns.map(column => [normalizeColumnName(column), column]));
  const find = (key: keyof typeof ALIASES): string | undefined =>
    ALIASES[key].map(normalizeColumnName).map(alias => normalized.get(alias)).find(Boolean);
  const timestamp = find('timestamp');
  const price = find('price');
  const volume = find('volume');
  if (!timestamp || !price || !volume) {
    throw new Error('Parquet file does not contain the required trade-tick columns (timestamp, price, volume).');
  }
  return {
    timestamp,
    price,
    volume,
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
    const ms = value.getTime();
    return Number.isFinite(ms) ? BigInt(ms) * 1_000_000n : null;
  }
  if (typeof value === 'bigint') {
    const absolute = value < 0n ? -value : value;
    if (unit === 'NANOS') return value;
    if (unit === 'MICROS') return value * 1_000n;
    if (unit === 'MILLIS') return value * 1_000_000n;
    if (unit === 'SECONDS') return value * 1_000_000_000n;
    if (absolute >= 100_000_000_000_000_000n) return value;
    if (absolute >= 100_000_000_000_000n) return value * 1_000n;
    if (absolute >= 100_000_000_000n) return value * 1_000_000n;
    if (absolute >= 100_000_000n) return value * 1_000_000_000n;
    return null;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    const absolute = Math.abs(value);
    if (unit === 'NANOS') return BigInt(Math.trunc(value));
    if (unit === 'MICROS') return BigInt(Math.trunc(value)) * 1_000n;
    if (unit === 'MILLIS') return BigInt(Math.trunc(value)) * 1_000_000n;
    if (unit === 'SECONDS') return BigInt(Math.trunc(value)) * 1_000_000_000n;
    if (absolute >= 1e17) return BigInt(Math.trunc(value));
    if (absolute >= 1e14) return BigInt(Math.trunc(value)) * 1_000n;
    if (absolute >= 1e11) return BigInt(Math.trunc(value)) * 1_000_000n;
    if (absolute >= 1e8) return BigInt(Math.trunc(value)) * 1_000_000_000n;
    return null;
  }
  if (typeof value === 'string') {
    const input = value.trim();
    if (!input) return null;
    if (/^-?\d+$/.test(input)) {
      try {
        return timestampToNanoseconds(BigInt(input), unit);
      } catch {
        return null;
      }
    }
    const fraction = input.match(/\.(\d{1,9})(?=(?:Z|[+-]\d{2}:?\d{2})?$)/i)?.[1] ?? '';
    const withoutFraction = input.replace(/\.\d{1,9}(?=(?:Z|[+-]\d{2}:?\d{2})?$)/i, '');
    const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(input);
    const normalized = hasTimezone ? withoutFraction : withoutFraction.replace(' ', 'T') + 'Z';
    const parsed = Date.parse(normalized);
    if (!Number.isFinite(parsed)) return null;
    const fractionalNs = fraction ? BigInt(fraction.padEnd(9, '0')) : 0n;
    return BigInt(parsed) * 1_000_000n + fractionalNs;
  }
  return null;
}

function timestampForImport(value: unknown, unit: string, timezoneNeedsConfirmation: boolean, timezone?: string | null): bigint {
  const timestamp = timestampToNanoseconds(value, unit);
  if (timestamp === null) throw new Error('Tick row contains an invalid timestamp.');
  if (!timezoneNeedsConfirmation) return timestamp;
  if (!timezone) throw new Error('A timezone must be confirmed before importing this tick file.');
  if (typeof value === 'string' && /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) return timestamp;
  const needsWallClockConversion = value instanceof Date
    || typeof value === 'number'
    || typeof value === 'bigint'
    || typeof value === 'string';
  if (!needsWallClockConversion) return timestamp;
  const wholeMilliseconds = timestamp / 1_000_000n;
  const subMillisecond = timestamp % 1_000_000n;
  const converted = wallClockToUtc(new Date(Number(wholeMilliseconds)), timezone);
  return BigInt(converted) * 1_000_000n + subMillisecond;
}

function numericValue(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'bigint' ? Number(value) : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isoFromNanoseconds(value: bigint): string {
  return new Date(Number(value / 1_000_000n)).toISOString();
}

async function inspectLayout(buffer: Uint8Array): Promise<TickLayout> {
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
  return { file, metadata, columns, mapping, timestampUnit, timezone, timezoneNeedsConfirmation, compressionCodecs };
}

function readValues(row: Record<string, unknown>, mapping: TickMapping) {
  return {
    price: numericValue(row[mapping.price]),
    volume: numericValue(row[mapping.volume]),
    bidSize: mapping.bidSize ? numericValue(row[mapping.bidSize]) : null,
    askSize: mapping.askSize ? numericValue(row[mapping.askSize]) : null,
    tradeCount: mapping.tradeCount ? numericValue(row[mapping.tradeCount]) : null,
    sourceSymbol: mapping.symbol && row[mapping.symbol] != null && row[mapping.symbol] !== ''
      ? String(row[mapping.symbol]).trim().toUpperCase() : null,
    exchange: mapping.exchange && row[mapping.exchange] != null && row[mapping.exchange] !== ''
      ? String(row[mapping.exchange]).trim().toUpperCase() : null,
  };
}

function validateTick(values: ReturnType<typeof readValues>): string | null {
  if (values.price === null || values.price <= 0) return 'invalid trade price';
  if (values.volume === null || values.volume <= 0) return 'invalid trade volume';
  if (values.bidSize !== null && (!Number.isSafeInteger(values.bidSize) || values.bidSize < 0)) return 'invalid bid-side executed volume';
  if (values.askSize !== null && (!Number.isSafeInteger(values.askSize) || values.askSize < 0)) return 'invalid ask-side executed volume';
  if (values.tradeCount !== null && (!Number.isSafeInteger(values.tradeCount) || values.tradeCount < 1)) return 'invalid trade count';
  return null;
}

export async function inspectTradeTicksParquet(
  buffer: Uint8Array,
  filename: string,
): Promise<TradeTickInspection> {
  const layout = await inspectLayout(buffer);
  const rowCount = Number(layout.metadata.num_rows);
  if (!Number.isSafeInteger(rowCount) || rowCount < 1) {
    throw new Error('Parquet tick file contains no readable rows or exceeds the supported row count.');
  }

  const symbols = new Set<string>();
  const exchanges = new Set<string>();
  const lastTimestampBySymbol = new Map<string, bigint>();
  const sample: TradeTick[] = [];
  const symbolSample: TradeTick[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  let validRowCount = 0;
  let invalidRowCount = 0;
  let missingSymbolRows = 0;
  let totalVolume = 0;
  let missingSymbolVolume = 0;
  let totalTradeCount = 0;
  let missingSymbolTradeCount = 0;
  const hasTradeCount = Boolean(layout.mapping.tradeCount);
  let bidAskMismatchCount = 0;
  let startTimeNs: bigint | null = null;
  let endTimeNs: bigint | null = null;
  let symbolStartTimeNs: bigint | null = null;
  let symbolEndTimeNs: bigint | null = null;

  const readColumns = [
    layout.mapping.timestamp, layout.mapping.price, layout.mapping.volume,
    ...(layout.mapping.bidSize ? [layout.mapping.bidSize] : []),
    ...(layout.mapping.askSize ? [layout.mapping.askSize] : []),
    ...(layout.mapping.tradeCount ? [layout.mapping.tradeCount] : []),
    ...(layout.mapping.symbol ? [layout.mapping.symbol] : []),
    ...(layout.mapping.exchange ? [layout.mapping.exchange] : []),
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
      const row = rows[index] as Record<string, unknown>;
      const timestampNs = timestampToNanoseconds(row[layout.mapping.timestamp], layout.timestampUnit);
      const values = readValues(row, layout.mapping);
      let reason: string | null = null;
      if (timestampNs === null) reason = 'invalid timestamp';
      else reason = validateTick(values);
      if (!reason && timestampNs !== null) {
        const key = values.sourceSymbol ?? '';
        const previous = lastTimestampBySymbol.get(key);
        if (previous !== undefined && timestampNs < previous) reason = 'timestamps are not ordered';
      }
      if (reason || timestampNs === null) {
        invalidRowCount += 1;
        if (errors.length < 10) errors.push('Row ' + (rowStart + index + 1) + ': ' + (reason || 'invalid tick') + '.');
        continue;
      }
      if (layout.mapping.symbol && !values.sourceSymbol) missingSymbolRows += 1;
      const key = values.sourceSymbol ?? '';
      lastTimestampBySymbol.set(key, timestampNs);
      if (values.sourceSymbol) {
        symbols.add(values.sourceSymbol);
        if (symbolStartTimeNs === null || timestampNs < symbolStartTimeNs) symbolStartTimeNs = timestampNs;
        if (symbolEndTimeNs === null || timestampNs > symbolEndTimeNs) symbolEndTimeNs = timestampNs;
        if (symbolSample.length < 10) {
          symbolSample.push({
            timestampNs: timestampNs.toString(),
            price: values.price!,
            volume: values.volume!,
            bidSize: values.bidSize,
            askSize: values.askSize,
            tradeCount: values.tradeCount,
            sourceSymbol: values.sourceSymbol,
            exchange: values.exchange,
            sourceRow: rowStart + index,
          });
        }
      }
      if (values.exchange) exchanges.add(values.exchange);
      validRowCount += 1;
      totalVolume += values.volume!;
      if (!values.sourceSymbol) missingSymbolVolume += values.volume!;
      if (values.tradeCount !== null) {
        totalTradeCount += values.tradeCount;
        if (!values.sourceSymbol) missingSymbolTradeCount += values.tradeCount;
      }
      if (values.bidSize !== null && values.askSize !== null && values.bidSize + values.askSize !== values.volume) {
        bidAskMismatchCount += 1;
      }
      if (startTimeNs === null || timestampNs < startTimeNs) startTimeNs = timestampNs;
      if (endTimeNs === null || timestampNs > endTimeNs) endTimeNs = timestampNs;
      if (sample.length < 10) {
        sample.push({
          timestampNs: timestampNs.toString(),
          price: values.price!,
          volume: values.volume!,
          bidSize: values.bidSize,
          askSize: values.askSize,
          tradeCount: values.tradeCount,
          sourceSymbol: values.sourceSymbol,
          exchange: values.exchange,
          sourceRow: rowStart + index,
        });
      }
    }
  }

  const detectedSymbols = [...symbols];
  if (detectedSymbols.length > 1 && missingSymbolRows) {
    invalidRowCount += missingSymbolRows;
    validRowCount -= missingSymbolRows;
    totalVolume -= missingSymbolVolume;
    if (hasTradeCount) totalTradeCount -= missingSymbolTradeCount;
    startTimeNs = symbolStartTimeNs;
    endTimeNs = symbolEndTimeNs;
    warnings.push(missingSymbolRows + ' valid row(s) have no source symbol and cannot be assigned safely to one of the detected contracts.');
  }
  const detectedInstrument = detectInstrument(filename, detectedSymbols);
  if (detectedSymbols.length > 1) warnings.push('The file contains multiple contract symbols. Import each symbol as a separate source-owned tick dataset.');
  if (invalidRowCount) warnings.push(invalidRowCount + ' row(s) were excluded from the valid preview.');
  if (layout.timezoneNeedsConfirmation) warnings.push('Parquet tick timestamps are not explicitly marked as UTC. Confirm the source timezone before import.');
  if (!detectedInstrument) warnings.push('Instrument could not be identified confidently; select it during review.');
  if (!hasTradeCount) warnings.push('The source does not provide trade_count; that field will remain unavailable.');
  if (bidAskMismatchCount) warnings.push(bidAskMismatchCount + ' row(s) have bid_sz + ask_sz values that do not equal volume; source values will be preserved without reinterpretation.');

  return {
    dataKind: 'trades',
    format: 'parquet',
    columns: layout.columns,
    rowCount,
    validRowCount,
    invalidRowCount,
    detectedInstrument,
    detectedSymbols,
    detectedExchange: exchanges.size === 1 ? [...exchanges][0] : null,
    timestampUnit: layout.timestampUnit,
    timezone: layout.timezone,
    timezoneNeedsConfirmation: layout.timezoneNeedsConfirmation,
    startTime: startTimeNs === null ? null : isoFromNanoseconds(startTimeNs),
    endTime: endTimeNs === null ? null : isoFromNanoseconds(endTimeNs),
    startTimeNs: startTimeNs?.toString() ?? null,
    endTimeNs: endTimeNs?.toString() ?? null,
    totalVolume,
    totalTradeCount: hasTradeCount ? totalTradeCount : null,
    bidAskMismatchCount,
    sample: detectedSymbols.length > 1 ? symbolSample : sample,
    errors,
    warnings,
    compressionCodecs: layout.compressionCodecs,
  };
}

export async function normalizeTradeTicksParquet(
  buffer: Uint8Array,
  destinationPath: string,
  options: NormalizeTradeTicksOptions = {},
): Promise<{
  rowCount: number;
  totalVolume: number;
  totalTradeCount: number | null;
  startTime: string;
  endTime: string;
  startTimeNs: string;
  endTimeNs: string;
  sourceSymbol: string | null;
  exchange: string | null;
}> {
  const layout = await inspectLayout(buffer);
  if (layout.timezoneNeedsConfirmation && !options.timezone) {
    throw new Error('A timezone must be confirmed before importing this tick file.');
  }
  const inspection = await inspectTradeTicksParquet(buffer, 'source.parquet');
  const symbols = new Set(inspection.detectedSymbols);
  const sourceSymbol = options.sourceSymbol?.toUpperCase() ?? (symbols.size === 1 ? [...symbols][0] : null);
  if (symbols.size > 1 && !sourceSymbol) {
    throw new Error('This file contains multiple contract symbols. Select one source symbol before importing.');
  }
  if (sourceSymbol && !symbols.has(sourceSymbol)) {
    throw new Error('The selected source symbol was not found in the tick file.');
  }
  if (inspection.invalidRowCount && !options.skipInvalidRows) {
    throw new Error('The tick file contains invalid or unassigned rows. Explicitly confirm whether those rows should be skipped.');
  }

  const readColumns = [
    layout.mapping.timestamp, layout.mapping.price, layout.mapping.volume,
    ...(layout.mapping.bidSize ? [layout.mapping.bidSize] : []),
    ...(layout.mapping.askSize ? [layout.mapping.askSize] : []),
    ...(layout.mapping.tradeCount ? [layout.mapping.tradeCount] : []),
    ...(layout.mapping.symbol ? [layout.mapping.symbol] : []),
    ...(layout.mapping.exchange ? [layout.mapping.exchange] : []),
  ];

  let rowCount = 0;
  let totalVolume = 0;
  let totalTradeCount = 0;
  let previousTimestamp: bigint | null = null;
  let firstTimestamp: bigint | null = null;
  let lastTimestamp: bigint | null = null;

  async function* normalizedRows(): AsyncGenerator<Record<string, unknown>> {
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
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index] as Record<string, unknown>;
        const values = readValues(row, layout.mapping);
        if (layout.mapping.symbol && sourceSymbol && values.sourceSymbol && values.sourceSymbol !== sourceSymbol) continue;
        if (symbols.size > 1 && !values.sourceSymbol) continue;
        let timestampNs: bigint;
        try {
          timestampNs = timestampForImport(row[layout.mapping.timestamp], layout.timestampUnit, layout.timezoneNeedsConfirmation, options.timezone);
        } catch (error) {
          if (options.skipInvalidRows) continue;
          throw error;
        }
        const reason = validateTick(values);
        if (reason || (previousTimestamp !== null && timestampNs < previousTimestamp)) {
          if (options.skipInvalidRows) continue;
          throw new Error('Invalid or out-of-order tick at source row ' + (rowStart + index + 1) + '.');
        }
        previousTimestamp = timestampNs;
        firstTimestamp = firstTimestamp === null || timestampNs < firstTimestamp ? timestampNs : firstTimestamp;
        lastTimestamp = lastTimestamp === null || timestampNs > lastTimestamp ? timestampNs : lastTimestamp;
        rowCount += 1;
        totalVolume += values.volume!;
        if (values.tradeCount !== null) totalTradeCount += values.tradeCount;
        yield {
          timestamp_ns: timestampNs,
          source_row: BigInt(rowStart + index),
          price: values.price!,
          volume: values.volume!,
          bid_size: values.bidSize,
          ask_size: values.askSize,
          trade_count: values.tradeCount,
          source_symbol: values.sourceSymbol,
          exchange: values.exchange,
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
        { name: 'timestamp_ns', type: 'INT64', columnIndex: true },
        { name: 'source_row', type: 'INT64' },
        { name: 'price', type: 'DOUBLE' },
        { name: 'volume', type: 'DOUBLE' },
        { name: 'bid_size', type: 'DOUBLE' },
        { name: 'ask_size', type: 'DOUBLE' },
        { name: 'trade_count', type: 'DOUBLE' },
        { name: 'source_symbol', type: 'STRING' },
        { name: 'exchange', type: 'STRING' },
      ],
      rowGroupSize: 50_000,
      codec: 'SNAPPY',
      createdBy: 'RR Metrics historical trade tick data',
    });
  } catch (error) {
    await fs.promises.rm(destinationPath, { force: true }).catch(() => undefined);
    throw error;
  }

  if (!rowCount || firstTimestamp === null || lastTimestamp === null) {
    await fs.promises.rm(destinationPath, { force: true });
    throw new Error('No valid trade-tick rows were supplied for normalization.');
  }
  return {
    rowCount,
    totalVolume,
    totalTradeCount: layout.mapping.tradeCount ? totalTradeCount : null,
    startTime: isoFromNanoseconds(firstTimestamp),
    endTime: isoFromNanoseconds(lastTimestamp),
    startTimeNs: firstTimestamp.toString(),
    endTimeNs: lastTimestamp.toString(),
    sourceSymbol,
    exchange: inspection.detectedExchange,
  };
}
