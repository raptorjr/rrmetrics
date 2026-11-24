import path from 'node:path';

export interface OhlcvBar {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
  sourceSymbol: string | null;
}

export interface CsvInspection {
  format: 'csv';
  delimiter: ',' | ';' | '\t';
  columns: string[];
  detectedSymbols: string[];
  rowCount: number;
  validRowCount: number;
  invalidRowCount: number;
  detectedInstrument: string | null;
  detectedTimeframe: string | null;
  timestampUnit: 'iso' | 'seconds' | 'milliseconds' | 'microseconds' | 'nanoseconds' | null;
  timezone: string | null;
  timezoneNeedsConfirmation: boolean;
  startTime: string | null;
  endTime: string | null;
  sample: OhlcvBar[];
  errors: string[];
  warnings: string[];
}

const HEADER_ALIASES: Record<string, string[]> = {
  timestamp: ['timestamp', 'time', 'datetime', 'date', 'ts', 'start', 'bar_time'],
  open: ['open', 'o'],
  high: ['high', 'h'],
  low: ['low', 'l'],
  close: ['close', 'c', 'last'],
  volume: ['volume', 'vol', 'v'],
  instrument: ['symbol', 'ticker', 'instrument', 'contract'],
};

function detectCsvDelimiter(source: string): ',' | ';' | '\t' {
  const firstLine = source.split(/\r?\n/, 1)[0] ?? '';
  const candidates: Array<',' | ';' | '\t'> = [',', ';', '\t'];
  const counts = candidates.map((delimiter) => {
    let quoted = false;
    let count = 0;
    for (let index = 0; index < firstLine.length; index += 1) {
      const char = firstLine[index];
      if (char === '"' && quoted && firstLine[index + 1] === '"') {
        index += 1;
      } else if (char === '"') {
        quoted = !quoted;
      } else if (!quoted && char === delimiter) {
        count += 1;
      }
    }
    return count;
  });
  const bestIndex = counts.indexOf(Math.max(...counts));
  return counts[bestIndex] > 0 ? candidates[bestIndex] : ',';
}

function parseCsvRows(source: string, delimiter: ',' | ';' | '\t'): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"' && field.length === 0) {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field.replace(/\r$/, ''));
      if (row.some(value => value.trim() !== '')) rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (quoted) throw new Error('CSV contains an unterminated quoted field.');
  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/, ''));
    if (row.some(value => value.trim() !== '')) rows.push(row);
  }
  return rows;
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, '');
}

function parseTimestamp(value: string): { timestamp: number; unit: CsvInspection['timestampUnit']; timezone: string | null; needsTimezone: boolean } | null {
  const input = value.trim();
  if (!input) return null;

  if (/^\d+(?:\.\d+)?$/.test(input)) {
    const numeric = Number(input);
    if (!Number.isFinite(numeric)) return null;
    const absolute = Math.abs(numeric);
    if (absolute >= 1e17) return { timestamp: Math.trunc(numeric / 1e6), unit: 'nanoseconds', timezone: 'UTC', needsTimezone: false };
    if (absolute >= 1e14) return { timestamp: Math.trunc(numeric / 1e3), unit: 'microseconds', timezone: 'UTC', needsTimezone: false };
    if (absolute >= 1e11) return { timestamp: Math.trunc(numeric), unit: 'milliseconds', timezone: 'UTC', needsTimezone: false };
    if (absolute >= 1e8) return { timestamp: Math.trunc(numeric * 1000), unit: 'seconds', timezone: 'UTC', needsTimezone: false };
    return null;
  }

  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(input);
  const parsed = Date.parse(hasZone ? input : `${input}Z`);
  if (!Number.isFinite(parsed)) return null;
  return {
    timestamp: parsed,
    unit: 'iso',
    timezone: hasZone ? 'explicit' : null,
    needsTimezone: !hasZone,
  };
}

function timeframeFromGap(milliseconds: number): string | null {
  const seconds = Math.round(milliseconds / 1000);
  if (seconds <= 0) return null;
  if (seconds % 86400 === 0) return `${seconds / 86400}d`;
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

function detectInstrument(filename: string, symbols: string[]): string | null {
  const candidates = [...symbols, path.basename(filename, path.extname(filename))]
    .join(' ').toUpperCase();
  const tokens = candidates.split(/[^A-Z0-9]+/).filter(Boolean);
  const known = ['MNQ', 'NQ', 'MES', 'ES', 'MGC', 'GC', 'MYM', 'YM', 'M2K', 'RTY', 'MCL', 'CL', '6E', '6B', '6J'];
  const matches = new Set<string>();

  for (const token of tokens) {
    for (const symbol of known) {
      // Recognize dated futures contracts such as ESZ6, ESZ26 and NQZ6.
      const datedContract = new RegExp('^' + symbol + '[FGHJKMNQUVXZ][0-9]{1,2}$');
      if (token === symbol || datedContract.test(token)) matches.add(symbol);
    }
  }
  return matches.size === 1 ? [...matches][0] : null;
}
export function inspectOhlcvCsv(buffer: Buffer, filename: string): CsvInspection {
  const source = buffer.toString('utf8').replace(/^\uFEFF/, '');
  if (source.includes('\u0000')) throw new Error('The uploaded file does not look like a UTF-8 CSV file.');

  const delimiter = detectCsvDelimiter(source);
  const rows = parseCsvRows(source, delimiter);
  if (rows.length < 2) throw new Error('CSV must contain a header row and at least one data row.');

  const headers = rows[0].map(normalizeHeader);
  const findColumn = (key: string): number => {
    const aliases = HEADER_ALIASES[key].map(normalizeHeader);
    return headers.findIndex(header => aliases.includes(header));
  };
  const indexes = {
    timestamp: findColumn('timestamp'),
    open: findColumn('open'),
    high: findColumn('high'),
    low: findColumn('low'),
    close: findColumn('close'),
    volume: findColumn('volume'),
    instrument: findColumn('instrument'),
  };

  const missing = ['timestamp', 'open', 'high', 'low', 'close'].filter(key => indexes[key as keyof typeof indexes] < 0);
  if (missing.length) throw new Error(`Missing required OHLCV columns: ${missing.join(', ')}.`);

  const errors: string[] = [];
  const warnings: string[] = [];
  const bars: OhlcvBar[] = [];
  const symbols: string[] = [];
  const timestamps = new Set<string>();
  let invalidRowCount = 0;
  let timestampUnit: CsvInspection['timestampUnit'] = null;
  let timezone: string | null = null;
  let timezoneNeedsConfirmation = false;

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const get = (index: number) => index >= 0 ? (row[index] ?? '').trim() : '';
    const parsedTime = parseTimestamp(get(indexes.timestamp));
    const sourceSymbol = get(indexes.instrument).toUpperCase() || null;
    const values = {
      open: Number(get(indexes.open)),
      high: Number(get(indexes.high)),
      low: Number(get(indexes.low)),
      close: Number(get(indexes.close)),
    };
    const volumeText = get(indexes.volume);
    const volume = volumeText === '' ? null : Number(volumeText);
    const validPrices = Object.values(values).every(Number.isFinite)
      && values.high >= Math.max(values.open, values.close, values.low)
      && values.low <= Math.min(values.open, values.close, values.high)
      && values.low > 0;
    const validVolume = volume === null || (Number.isFinite(volume) && volume >= 0);

    if (!parsedTime || !validPrices || !validVolume) {
      invalidRowCount += 1;
      if (errors.length < 10) errors.push(`Row ${rowIndex + 1}: invalid timestamp, OHLC values or volume.`);
      continue;
    }
    const timestampKey = `${sourceSymbol ?? ''}\u0000${parsedTime.timestamp}`;
    if (timestamps.has(timestampKey)) {
      invalidRowCount += 1;
      if (errors.length < 10) errors.push(`Row ${rowIndex + 1}: duplicate timestamp for ${sourceSymbol || 'file'}.`);
      continue;
    }

    timestamps.add(timestampKey);
    timestampUnit = timestampUnit ?? parsedTime.unit;
    if (timestampUnit !== parsedTime.unit) {
      invalidRowCount += 1;
      timestamps.delete(timestampKey);
      if (errors.length < 10) errors.push(`Row ${rowIndex + 1}: mixed timestamp formats or units.`);
      continue;
    }
    if (parsedTime.needsTimezone) timezoneNeedsConfirmation = true;
    if (parsedTime.timezone === 'explicit') timezone = 'explicit';
    if (sourceSymbol) symbols.push(sourceSymbol);

    bars.push({
      timestamp: parsedTime.timestamp,
      ...values,
      volume,
      sourceSymbol,
    });
  }

  bars.sort((a, b) => a.timestamp - b.timestamp);
  // Calculate intervals independently per source symbol. Interleaved symbols
  // commonly share timestamps; treating those as one stream skews the median.
  const timestampsBySymbol = new Map<string, number[]>();
  for (const bar of bars) {
    const key = bar.sourceSymbol ?? '';
    const timestamps = timestampsBySymbol.get(key) ?? [];
    timestamps.push(bar.timestamp);
    timestampsBySymbol.set(key, timestamps);
  }
  const gaps = [...timestampsBySymbol.values()].flatMap((timestamps) => {
    timestamps.sort((a, b) => a - b);
    return timestamps.slice(1)
      .map((timestamp, index) => timestamp - timestamps[index])
      .filter(gap => gap > 0);
  });
  const medianGap = gaps.length ? [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : 0;
  const uniqueSymbols = [...new Set(symbols)];
  const detectedInstrument = detectInstrument(filename, uniqueSymbols);
  if (uniqueSymbols.length > 1) warnings.push('The file contains multiple instrument symbols. Each symbol must be imported as its own dataset; no symbol data should be discarded.');
  if (invalidRowCount) warnings.push(`${invalidRowCount} row(s) were excluded from the valid preview.`);
  if (timezoneNeedsConfirmation) warnings.push('Timestamps without an explicit timezone need timezone confirmation before import.');
  if (!detectedInstrument) warnings.push('Instrument could not be identified confidently; select it during review.');

  return {
    format: 'csv',
    delimiter,
    columns: rows[0],
    detectedSymbols: uniqueSymbols,
    rowCount: rows.length - 1,
    validRowCount: bars.length,
    invalidRowCount,
    detectedInstrument,
    detectedTimeframe: medianGap ? timeframeFromGap(medianGap) : null,
    timestampUnit,
    timezone,
    timezoneNeedsConfirmation,
    startTime: bars.length ? new Date(bars[0].timestamp).toISOString() : null,
    endTime: bars.length ? new Date(bars[bars.length - 1].timestamp).toISOString() : null,
    sample: bars.slice(0, 10),
    errors,
    warnings,
  };
}
);
      if (token === symbol || datedContract.test(token)) matches.add(symbol);
    }
  }
  return matches.size === 1 ? [...matches][0] : null;
}

export function inspectOhlcvCsv(buffer: Buffer, filename: string): CsvInspection {
  const source = buffer.toString('utf8').replace(/^\uFEFF/, '');
  if (source.includes('\u0000')) throw new Error('The uploaded file does not look like a UTF-8 CSV file.');

  const delimiter = detectCsvDelimiter(source);
  const rows = parseCsvRows(source, delimiter);
  if (rows.length < 2) throw new Error('CSV must contain a header row and at least one data row.');

  const headers = rows[0].map(normalizeHeader);
  const findColumn = (key: string): number => {
    const aliases = HEADER_ALIASES[key].map(normalizeHeader);
    return headers.findIndex(header => aliases.includes(header));
  };
  const indexes = {
    timestamp: findColumn('timestamp'),
    open: findColumn('open'),
    high: findColumn('high'),
    low: findColumn('low'),
    close: findColumn('close'),
    volume: findColumn('volume'),
    instrument: findColumn('instrument'),
  };

  const missing = ['timestamp', 'open', 'high', 'low', 'close'].filter(key => indexes[key as keyof typeof indexes] < 0);
  if (missing.length) throw new Error(`Missing required OHLCV columns: ${missing.join(', ')}.`);

  const errors: string[] = [];
  const warnings: string[] = [];
  const bars: OhlcvBar[] = [];
  const symbols: string[] = [];
  const timestamps = new Set<string>();
  let invalidRowCount = 0;
  let timestampUnit: CsvInspection['timestampUnit'] = null;
  let timezone: string | null = null;
  let timezoneNeedsConfirmation = false;

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const get = (index: number) => index >= 0 ? (row[index] ?? '').trim() : '';
    const parsedTime = parseTimestamp(get(indexes.timestamp));
    const sourceSymbol = get(indexes.instrument).toUpperCase() || null;
    const values = {
      open: Number(get(indexes.open)),
      high: Number(get(indexes.high)),
      low: Number(get(indexes.low)),
      close: Number(get(indexes.close)),
    };
    const volumeText = get(indexes.volume);
    const volume = volumeText === '' ? null : Number(volumeText);
    const validPrices = Object.values(values).every(Number.isFinite)
      && values.high >= Math.max(values.open, values.close, values.low)
      && values.low <= Math.min(values.open, values.close, values.high)
      && values.low > 0;
    const validVolume = volume === null || (Number.isFinite(volume) && volume >= 0);

    if (!parsedTime || !validPrices || !validVolume) {
      invalidRowCount += 1;
      if (errors.length < 10) errors.push(`Row ${rowIndex + 1}: invalid timestamp, OHLC values or volume.`);
      continue;
    }
    const timestampKey = `${sourceSymbol ?? ''}\u0000${parsedTime.timestamp}`;
    if (timestamps.has(timestampKey)) {
      invalidRowCount += 1;
      if (errors.length < 10) errors.push(`Row ${rowIndex + 1}: duplicate timestamp for ${sourceSymbol || 'file'}.`);
      continue;
    }

    timestamps.add(timestampKey);
    timestampUnit = timestampUnit ?? parsedTime.unit;
    if (timestampUnit !== parsedTime.unit) {
      invalidRowCount += 1;
      timestamps.delete(timestampKey);
      if (errors.length < 10) errors.push(`Row ${rowIndex + 1}: mixed timestamp formats or units.`);
      continue;
    }
    if (parsedTime.needsTimezone) timezoneNeedsConfirmation = true;
    if (parsedTime.timezone === 'explicit') timezone = 'explicit';
    if (sourceSymbol) symbols.push(sourceSymbol);

    bars.push({
      timestamp: parsedTime.timestamp,
      ...values,
      volume,
      sourceSymbol,
    });
  }

  bars.sort((a, b) => a.timestamp - b.timestamp);
  const gaps = bars.slice(1).map((bar, index) => bar.timestamp - bars[index].timestamp).filter(gap => gap > 0);
  const medianGap = gaps.length ? [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : 0;
  const uniqueSymbols = [...new Set(symbols)];
  const detectedInstrument = detectInstrument(filename, uniqueSymbols);
  if (uniqueSymbols.length > 1) warnings.push('The file contains multiple instrument symbols. Each symbol must be imported as its own dataset; no symbol data should be discarded.');
  if (invalidRowCount) warnings.push(`${invalidRowCount} row(s) were excluded from the valid preview.`);
  if (timezoneNeedsConfirmation) warnings.push('Timestamps without an explicit timezone need timezone confirmation before import.');
  if (!detectedInstrument) warnings.push('Instrument could not be identified confidently; select it during review.');

  return {
    format: 'csv',
    delimiter,
    columns: rows[0],
    detectedSymbols: uniqueSymbols,
    rowCount: rows.length - 1,
    validRowCount: bars.length,
    invalidRowCount,
    detectedInstrument,
    detectedTimeframe: medianGap ? timeframeFromGap(medianGap) : null,
    timestampUnit,
    timezone,
    timezoneNeedsConfirmation,
    startTime: bars.length ? new Date(bars[0].timestamp).toISOString() : null,
    endTime: bars.length ? new Date(bars[bars.length - 1].timestamp).toISOString() : null,
    sample: bars.slice(0, 10),
    errors,
    warnings,
  };
}
