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
    { delimiter: ';', csv: 'timestamp;open;high;low;close\\n2026-11-09T14:30:00Z;25000;25002;24999;25001\\n2026-11-09T14:31:00Z;25001;25003;25000;25002' },
    { delimiter: '\\t', csv: 'timestamp\\topen\\thigh\\tlow\\tclose\\n2026-11-09T14:30:00Z\\t25000\\t25002\\t24999\\t25001\\n2026-11-09T14:31:00Z\\t25001\\t25003\\t25000\\t25002' },
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
  ].join('\\n');

  const result = inspectOhlcvCsv(Buffer.from(csv), 'multi-symbol.csv');
  assert.equal(result.validRowCount, 4);
  assert.equal(result.invalidRowCount, 1);
  assert.deepEqual(result.detectedSymbols, ['NQ', 'ES']);
  assert.equal(result.detectedInstrument, null);
  assert.equal(result.sample[0].sourceSymbol, 'NQ');
  assert.ok(result.warnings.some(warning => warning.includes('multiple instrument symbols')));
});
