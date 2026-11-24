import assert from 'node:assert/strict';
import test from 'node:test';
import { parquetWriteBuffer } from 'hyparquet-writer';
import { inspectTickParquet, normalizeTickParquet } from './market-data-ticks';
import { readTickParquetRange } from './market-data-query';

function makeTickParquet(): Buffer {
  return Buffer.from(parquetWriteBuffer({
    columnData: [
      { name: 'ts', type: 'TIMESTAMP', data: [
        new Date('2026-11-09T14:30:00.000Z'),
        new Date('2026-11-09T14:30:00.000Z'),
        new Date('2026-11-09T14:30:00.001Z'),
      ] },
      { name: 'price', type: 'DOUBLE', data: [25000.25, 25000.5, 25000.75] },
      { name: 'volume', type: 'INT32', data: [1, 2, 1] },
      { name: 'bid_sz', type: 'INT32', data: [1, 0, 0] },
      { name: 'ask_sz', type: 'INT32', data: [0, 2, 1] },
      { name: 'trade_count', type: 'INT32', data: [1, 1, 1] },
      { name: 'symbol', type: 'STRING', data: ['NQZ6', 'NQZ6', 'NQZ6'] },
      { name: 'exchange', type: 'STRING', data: ['CME', 'CME', 'CME'] },
    ] as never,
  }));
}

test('inspects and normalizes tick events without deduplicating equal timestamps', async () => {
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const buffer = makeTickParquet();
  const inspection = await inspectTickParquet(buffer, 'NQZ6_ticks.parquet');
  assert.equal(inspection.dataKind, 'ticks');
  assert.equal(inspection.rowCount, 3);
  assert.equal(inspection.validRowCount, 3);
  assert.equal(inspection.detectedInstrument, 'NQ');
  assert.equal(inspection.detectedSymbols[0], 'NQZ6');
  assert.equal(inspection.detectedTimeframe, 'tick');

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rrm-ticks-'));
  const destination = path.join(directory, 'ticks.parquet');
  try {
    const normalized = await normalizeTickParquet(buffer, destination);
    assert.equal(normalized.rowCount, 3);
    assert.equal(normalized.sourceSymbol, 'NQZ6');
    const start = Date.parse(normalized.startTime);
    const end = Date.parse(normalized.endTime);
    const ticks = await readTickParquetRange(destination, start, end);
    assert.equal(ticks.length, 3);
    assert.equal(ticks[0].timestamp, ticks[1].timestamp);
    assert.equal(ticks[0].sequence, 0);
    assert.equal(ticks[1].sequence, 1);
    assert.equal(ticks[0].size, 1);
    assert.equal(ticks[1].askSize, 2);
    assert.equal(ticks[2].price, 25000.75);
    assert.equal(ticks[0].sourceSymbol, 'NQZ6');
    assert.equal(ticks[0].exchange, 'CME');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
