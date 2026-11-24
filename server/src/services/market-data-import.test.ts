import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectOhlcvCsv } from './market-data-import';

test('inspects valid OHLCV CSV and detects instrument and timeframe', () => {
  const csv = [
    'timestamp,open,high,low,close,volume',
    '2026-11-09T14:30:00Z,25000,25002,24999,25001,100',
    '2026-11-09T14:31:00Z,25001,25003,25000,25002,120',
    '2026-11-09T14:32:00Z,25002,25004,25001,25003,90',
  ].join('\n');
  const result = inspectOhlcvCsv(Buffer.from(csv), 'NQ_1m.csv');
  assert.equal(result.validRowCount, 3);
  assert.equal(result.detectedInstrument, 'NQ');
  assert.equal(result.detectedTimeframe, '1m');
  assert.equal(result.timezoneNeedsConfirmation, false);
  assert.equal(result.sample.length, 3);
});

test('flags timezone-less timestamps for confirmation', () => {
  const csv = [
    'time,open,high,low,close',
    '2026-11-09 14:30:00,25000,25002,24999,25001',
    '2026-11-09 14:31:00,25001,25003,25000,25002',
  ].join('\n');
  const result = inspectOhlcvCsv(Buffer.from(csv), 'unknown.csv');
  assert.equal(result.timezoneNeedsConfirmation, true);
  assert.equal(result.detectedInstrument, null);
  assert.ok(result.warnings.some(warning => warning.includes('timezone')));
});

test('rejects missing OHLC columns and invalid prices', () => {
  assert.throws(() => inspectOhlcvCsv(Buffer.from('time,close\n2026-01-01,1'), 'NQ.csv'), /Missing required/);
  const csv = 'time,open,high,low,close\n2026-01-01T00:00:00Z,10,8,9,11';
  const result = inspectOhlcvCsv(Buffer.from(csv), 'NQ.csv');
  assert.equal(result.invalidRowCount, 1);
  assert.equal(result.validRowCount, 0);
});


test('detects semicolon and tab-delimited CSV files', () => {
  const fixtures = [
    { delimiter: ';', csv: 'timestamp;open;high;low;close\n2026-11-09T14:30:00Z;25000;25002;24999;25001\n2026-11-09T14:31:00Z;25001;25003;25000;25002' },
    { delimiter: '\t', csv: 'timestamp\topen\thigh\tlow\tclose\n2026-11-09T14:30:00Z\t25000\t25002\t24999\t25001\n2026-11-09T14:31:00Z\t25001\t25003\t25000\t25002' },
  ] as const;

  for (const fixture of fixtures) {
    const result = inspectOhlcvCsv(Buffer.from(fixture.csv), 'NQ_1m.csv');
    assert.equal(result.delimiter, fixture.delimiter);
    assert.equal(result.validRowCount, 2);
  }
});

test('allows matching timestamps for different symbols but rejects duplicates per symbol', () => {
  const csv = [
    'timestamp,symbol,open,high,low,close,volume',
    '2026-11-09T14:30:00Z,NQ,25000,25002,24999,25001,100',
    '2026-11-09T14:30:00Z,ES,6000,6002,5999,6001,200',
    '2026-11-09T14:31:00Z,NQ,25001,25003,25000,25002,110',
    '2026-11-09T14:31:00Z,ES,6001,6003,6000,6002,210',
    '2026-11-09T14:31:00Z,NQ,25001,25003,25000,25002,110',
  ].join('\n');

  const result = inspectOhlcvCsv(Buffer.from(csv), 'multi-symbol.csv');
  assert.equal(result.validRowCount, 4);
  assert.equal(result.invalidRowCount, 1);
  assert.deepEqual(result.detectedSymbols, ['NQ', 'ES']);
  assert.equal(result.detectedInstrument, null);
  assert.equal(result.sample[0].sourceSymbol, 'NQ');
  assert.ok(result.warnings.some(warning => warning.includes('multiple instrument symbols')));
});


test('detects dated futures contract symbols and their canonical roots', () => {
  const csv = [
    'timestamp,symbol,open,high,low,close,volume',
    '2026-11-09T14:30:00Z,ESZ6,6000,6002,5999,6001,100',
    '2026-11-09T14:31:00Z,ESZ6,6001,6003,6000,6002,110',
  ].join('\n');
  const result = inspectOhlcvCsv(Buffer.from(csv), 'sample.csv');
  assert.equal(result.detectedInstrument, 'ES');
  assert.deepEqual(result.detectedSymbols, ['ESZ6']);
});

test('infers timeframe independently for interleaved instruments', () => {
  const csv = [
    'timestamp,symbol,open,high,low,close,volume',
    '2026-11-09T14:30:00Z,NQZ6,25000,25002,24999,25001,100',
    '2026-11-09T14:30:00Z,ESZ6,6000,6002,5999,6001,200',
    '2026-11-09T14:31:00Z,NQZ6,25001,25003,25000,25002,110',
    '2026-11-09T14:31:00Z,ESZ6,6001,6003,6000,6002,210',
    '2026-11-09T14:32:00Z,NQZ6,25002,25004,25001,25003,120',
    '2026-11-09T14:32:00Z,ESZ6,6002,6004,6001,6003,220',
  ].join('\n');
  const result = inspectOhlcvCsv(Buffer.from(csv), 'multi-symbol.csv');
  assert.equal(result.detectedTimeframe, '1m');
  assert.equal(result.detectedInstrument, null);
});


test('detects canonical instrument from a dated-contract filename', () => {
  const csv = [
    'timestamp,open,high,low,close,volume',
    '2026-11-09T14:30:00Z,25000,25002,24999,25001,100',
    '2026-11-09T14:31:00Z,25001,25003,25000,25002,110',
  ].join('\n');
  const result = inspectOhlcvCsv(Buffer.from(csv), 'NQZ26_2026-11-09_1m.csv');
  assert.equal(result.detectedInstrument, 'NQ');
});

test('reinterprets timezone-less CSV timestamps using the confirmed source timezone', async () => {
  const { parseOhlcvCsv } = await import('./market-data-import');
  const csv = [
    'timestamp,open,high,low,close',
    '2026-11-09 14:30:00,25000,25002,24999,25001',
    '2026-11-09 14:31:00,25001,25003,25000,25002',
  ].join('\n');
  const result = parseOhlcvCsv(Buffer.from(csv), 'NQ_1m.csv', { timezone: 'America/New_York' });
  assert.equal(result.inspection.timezoneNeedsConfirmation, false);
  assert.equal(result.inspection.timezone, 'America/New_York');
  assert.equal(new Date(result.bars[0].timestamp).toISOString(), '2026-11-09T19:30:00.000Z');
});


test('does not detect source symbols from invalid rows', () => {
  const csv = [
    'timestamp,symbol,open,high,low,close,volume',
    '2026-11-09T14:30:00Z,NQZ6,25000,25002,24999,25001,100',
    '2026-11-09T14:31:00Z,ESZ6,6000,5998,5999,6001,100',
  ].join('\n');
  const result = inspectOhlcvCsv(Buffer.from(csv), 'multi.csv');
  assert.equal(result.validRowCount, 1);
  assert.equal(result.invalidRowCount, 1);
  assert.deepEqual(result.detectedSymbols, ['NQZ6']);
  assert.equal(result.detectedInstrument, 'NQ');
});
