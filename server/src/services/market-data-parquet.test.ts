import test from 'node:test';
import assert from 'node:assert/strict';
import { asyncBufferFromFile, parquetReadObjects } from 'hyparquet';
import { parquetWriteBuffer } from 'hyparquet-writer';
import { inspectOhlcvParquet, normalizeOhlcvParquet, writeOhlcvBarsToParquet } from './market-data-parquet';
import { readOhlcvParquetRange } from './market-data-query';

function makeParquet(columns: Array<{ name: string; data: unknown[]; type: string }>): Buffer {
  return Buffer.from(parquetWriteBuffer({ columnData: columns as never }));
}

test('inspects Parquet OHLCV and recognizes a dated futures filename', async () => {
  const buffer = makeParquet([
    { name: 'ts', type: 'TIMESTAMP', data: [
      new Date('2026-11-09T14:30:00Z'),
      new Date('2026-11-09T14:31:00Z'),
      new Date('2026-11-09T14:32:00Z'),
    ] },
    { name: 'open', type: 'DOUBLE', data: [25000, 25001, 25002] },
    { name: 'high', type: 'DOUBLE', data: [25002, 25003, 25004] },
    { name: 'low', type: 'DOUBLE', data: [24999, 25000, 25001] },
    { name: 'close', type: 'DOUBLE', data: [25001, 25002, 25003] },
    { name: 'volume', type: 'DOUBLE', data: [100, 120, 90] },
  ]);
  const result = await inspectOhlcvParquet(buffer, 'NQZ26_1m.parquet');
  assert.equal(result.rowCount, 3);
  assert.equal(result.validRowCount, 3);
  assert.equal(result.detectedInstrument, 'NQ');
  assert.equal(result.detectedTimeframe, '1m');
  assert.equal(result.timezoneNeedsConfirmation, false);
  assert.equal(result.sample.length, 3);
});

test('allows matching timestamps across separate source symbols', async () => {
  const buffer = makeParquet([
    { name: 'ts', type: 'TIMESTAMP', data: [
      new Date('2026-11-09T14:30:00Z'),
      new Date('2026-11-09T14:30:00Z'),
      new Date('2026-11-09T14:31:00Z'),
      new Date('2026-11-09T14:31:00Z'),
    ] },
    { name: 'symbol', type: 'STRING', data: ['NQZ6', 'ESZ6', 'NQZ6', 'ESZ6'] },
    { name: 'open', type: 'DOUBLE', data: [25000, 6000, 25001, 6001] },
    { name: 'high', type: 'DOUBLE', data: [25002, 6002, 25003, 6003] },
    { name: 'low', type: 'DOUBLE', data: [24999, 5999, 25000, 6000] },
    { name: 'close', type: 'DOUBLE', data: [25001, 6001, 25002, 6002] },
  ]);
  const result = await inspectOhlcvParquet(buffer, 'multi-symbol.parquet');
  assert.equal(result.validRowCount, 4);
  assert.equal(result.invalidRowCount, 0);
  assert.deepEqual(result.detectedSymbols, ['NQZ6', 'ESZ6']);
  assert.equal(result.detectedInstrument, null);
  assert.equal(result.detectedTimeframe, '1m');
  assert.ok(result.warnings.some(warning => warning.includes('multiple instrument symbols')));
});

test('rejects Parquet files that do not contain OHLCV columns', async () => {
  const buffer = makeParquet([
    { name: 'ts', type: 'TIMESTAMP', data: [new Date('2026-11-09T14:30:00Z')] },
    { name: 'price', type: 'DOUBLE', data: [25000] },
    { name: 'volume', type: 'INT32', data: [1] },
  ]);
  await assert.rejects(() => inspectOhlcvParquet(buffer, 'NQZ6_ticks.parquet'), /required OHLCV columns/);
});


test('infers sub-minute Parquet intervals accurately', async () => {
  const buffer = makeParquet([
    { name: 'ts', type: 'TIMESTAMP', data: [
      new Date('2026-11-09T14:30:00Z'),
      new Date('2026-11-09T14:30:30Z'),
      new Date('2026-11-09T14:31:00Z'),
    ] },
    { name: 'open', type: 'DOUBLE', data: [25000, 25001, 25002] },
    { name: 'high', type: 'DOUBLE', data: [25002, 25003, 25004] },
    { name: 'low', type: 'DOUBLE', data: [24999, 25000, 25001] },
    { name: 'close', type: 'DOUBLE', data: [25001, 25002, 25003] },
  ]);
  const result = await inspectOhlcvParquet(buffer, 'NQ_30s.parquet');
  assert.equal(result.detectedTimeframe, '30s');
});

test('skipping invalid rows does not discard a valid row at the same timestamp', async () => {
  const buffer = makeParquet([
    { name: 'ts', type: 'TIMESTAMP', data: [
      new Date('2026-11-09T14:30:00Z'),
      new Date('2026-11-09T14:31:00Z'),
      new Date('2026-11-09T14:31:00Z'),
      new Date('2026-11-09T14:32:00Z'),
    ] },
    { name: 'open', type: 'DOUBLE', data: [25000, 25001, 25001, 25002] },
    { name: 'high', type: 'DOUBLE', data: [25002, 25000, 25003, 25004] },
    { name: 'low', type: 'DOUBLE', data: [24999, 25000, 25000, 25001] },
    { name: 'close', type: 'DOUBLE', data: [25001, 25002, 25002, 25003] },
  ]);
  const directory = await import('node:fs/promises').then(fs => fs.mkdtemp('/tmp/rrm-parquet-'));
  const destination = `${directory}/normalized.parquet`;
  try {
    const result = await normalizeOhlcvParquet(buffer, destination, { skipInvalidRows: true });
    assert.equal(result.rowCount, 3);
    const file = await asyncBufferFromFile(destination);
    const rows = await parquetReadObjects({ file, columns: ['timestamp', 'open'] });
    assert.equal(rows.length, 3);
    assert.equal(rows[1].open, 25001);
    assert.equal((rows[1].timestamp as Date).toISOString(), '2026-11-09T14:31:00.000Z');
  } finally {
    await import('node:fs/promises').then(fs => fs.rm(directory, { recursive: true, force: true }));
  }
});


test('queries a bounded time range from normalized Parquet data', async () => {
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rrm-query-'));
  const destination = path.join(directory, 'bars.parquet');
  const base = Date.parse('2026-11-09T14:30:00Z');
  try {
    await writeOhlcvBarsToParquet(destination, [
      { timestamp: base, open: 10, high: 12, low: 9, close: 11, volume: 100 },
      { timestamp: base + 60_000, open: 11, high: 13, low: 10, close: 12, volume: 120 },
      { timestamp: base + 120_000, open: 12, high: 14, low: 11, close: 13, volume: 90 },
    ]);
    const bars = await readOhlcvParquetRange(destination, base + 60_000, base + 60_000);
    assert.equal(bars.length, 1);
    assert.equal(bars[0].timestamp, base + 60_000);
    assert.equal(bars[0].close, 12);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});


test('interprets unannotated numeric epoch-second timestamps as UTC milliseconds', async () => {
  const buffer = makeParquet([
    { name: 'ts', type: 'INT64', data: [1794234600n, 1794234660n, 1794234720n] },
    { name: 'open', type: 'DOUBLE', data: [25000, 25001, 25002] },
    { name: 'high', type: 'DOUBLE', data: [25002, 25003, 25004] },
    { name: 'low', type: 'DOUBLE', data: [24999, 25000, 25001] },
    { name: 'close', type: 'DOUBLE', data: [25001, 25002, 25003] },
  ]);
  const result = await inspectOhlcvParquet(buffer, 'NQ_epoch_seconds.parquet');
  assert.equal(result.startTime, '2026-11-09T14:30:00.000Z');
  assert.equal(result.detectedTimeframe, '1m');
});

test('does not detect source symbols from invalid Parquet rows', async () => {
  const buffer = makeParquet([
    { name: 'ts', type: 'TIMESTAMP', data: [
      new Date('2026-11-09T14:30:00Z'),
      new Date('2026-11-09T14:31:00Z'),
    ] },
    { name: 'symbol', type: 'STRING', data: ['NQZ6', 'ESZ6'] },
    { name: 'open', type: 'DOUBLE', data: [25000, 6000] },
    { name: 'high', type: 'DOUBLE', data: [25002, 5998] },
    { name: 'low', type: 'DOUBLE', data: [24999, 5999] },
    { name: 'close', type: 'DOUBLE', data: [25001, 6001] },
  ]);
  const result = await inspectOhlcvParquet(buffer, 'multi.parquet');
  assert.equal(result.validRowCount, 1);
  assert.equal(result.invalidRowCount, 1);
  assert.deepEqual(result.detectedSymbols, ['NQZ6']);
  assert.equal(result.detectedInstrument, 'NQ');
});
