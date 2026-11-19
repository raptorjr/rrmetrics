import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  findFullyFilledVoidedOrderOverrides,
  mergeVoidedOrderOverrides,
  reconstructProjectXPositions,
  type ProjectXTradeLeg,
} from './ProjectXReconstruction';

function leg(
  id: number,
  side: number,
  size: number,
  price: number,
  pnl: number | null,
  orderId: number,
  timestamp: string,
  fees = 0,
  commissions = 0,
  voided = false,
): ProjectXTradeLeg {
  return {
    id,
    accountId: 1,
    contractId: 'MGC',
    creationTimestamp: timestamp,
    price,
    profitAndLoss: pnl,
    fees,
    commissions,
    side,
    size,
    voided,
    orderId,
    fillId: null,
  };
}

test('groups multiple entries and partial exits into one position', () => {
  const result = reconstructProjectXPositions([
    leg(1, 0, 2, 100, null, 10, '2026-11-01T10:00:00Z', 2, 1),
    leg(2, 0, 1, 102, null, 11, '2026-11-01T10:01:00Z', 1, 0.5),
    leg(3, 1, 1, 105, 10, 12, '2026-11-01T10:02:00Z', 1, 0.5),
    leg(4, 1, 2, 104, 20, 13, '2026-11-01T10:03:00Z', 2, 1),
  ]);

  assert.equal(result.positions.length, 1);
  assert.equal(result.openPositions.length, 0);
  assert.equal(result.warnings.length, 0);

  const p = result.positions[0];
  assert.equal(p.quantity, 3);
  assert.equal(p.grossPL, 30);
  assert.equal(p.fees, 6);
  assert.equal(p.commissions, 3);
  assert.equal(p.netPL, 21);
  assert.equal(p.enterPrice, (2 * 100 + 102) / 3);
  assert.equal(p.exitPrice, (105 + 2 * 104) / 3);
});

test('groups multiple closing legs sharing one execution ID', () => {
  const result = reconstructProjectXPositions([
    leg(1, 0, 5, 100, null, 10, '2026-11-01T10:00:00Z', 3.55, 1.25),
    leg(2, 1, 2, 101, 20, 11, '2026-11-01T10:01:00Z', 1.42, 0.5),
    leg(3, 1, 3, 102, 30, 11, '2026-11-01T10:01:00Z', 2.13, 0.75),
  ]);

  assert.equal(result.positions.length, 1);
  assert.equal(result.positions[0].grossPL, 50);
  assert.equal(result.positions[0].fees, 7.1);
  assert.equal(result.positions[0].commissions, 2.5);
  assert.equal(result.positions[0].exitPrice, 101.6);
  assert.equal(result.warnings.length, 0);
});

test('splits a reversal into a closed position and a new opposite position', () => {
  const result = reconstructProjectXPositions([
    leg(1, 0, 2, 100, null, 10, '2026-11-01T10:00:00Z', 2, 1),
    // One execution closes the long and opens a new short position.
    leg(2, 1, 2, 110, 20, 11, '2026-11-01T10:01:00Z', 2, 1),
    leg(3, 1, 3, 110, null, 11, '2026-11-01T10:01:00Z', 3, 1.5),
    leg(4, 0, 3, 100, 30, 12, '2026-11-01T10:02:00Z', 3, 1.5),
  ]);

  assert.equal(result.positions.length, 2);
  assert.equal(result.positions[0].quantity, 2);
  assert.equal(result.positions[0].netPL, 14);
  assert.equal(result.positions[1].quantity, -3);
  assert.equal(result.positions[1].netPL, 21);
  assert.equal(result.openPositions.length, 0);
  assert.equal(result.warnings.length, 0);
});

test('keeps positions completed before an instrument warning and quarantines later positions', () => {
  const result = reconstructProjectXPositions([
    leg(1, 0, 1, 100, null, 10, '2026-11-01T10:00:00Z'),
    leg(2, 1, 1, 101, 10, 11, '2026-11-01T10:01:00Z'),
    // An unmatched close makes the subsequent instrument history unsafe.
    leg(3, 1, 1, 102, 10, 12, '2026-11-01T10:02:00Z'),
    leg(4, 0, 1, 103, null, 13, '2026-11-01T10:03:00Z'),
    leg(5, 1, 1, 104, 10, 14, '2026-11-01T10:04:00Z'),
  ]);

  assert.equal(result.positions.length, 1);
  assert.equal(result.positions[0].tradeIds.join(','), '1,2');
  assert.equal(result.warnings.length, 1);
});

test('does not publish an open position from an instrument with reconstruction warnings', () => {
  const result = reconstructProjectXPositions([
    leg(1, 0, 1, 100, null, 10, '2026-11-01T10:00:00Z'),
    // This same-side closing leg cannot close the existing long.
    leg(2, 0, 1, 101, 10, 11, '2026-11-01T10:01:00Z'),
  ]);

  assert.equal(result.warnings.length, 1);
  assert.equal(result.positions.length, 0);
  assert.equal(result.openPositions.length, 0);
});

test('reinstates only fully filled orders whose complete trade-leg set is voided', () => {
  const voidedBuy = leg(1, 0, 2, 4371, -16, 100, '2026-09-22T14:01:26Z', 1.42, 0.5, true);
  const voidedSellA = leg(2, 1, 2, 4370.9, 4, 101, '2026-09-22T14:39:12Z', 1.42, 0.5, true);
  const voidedSellB = { ...voidedSellA, id: 3, profitAndLoss: 6 };
  const voidedSellC = { ...voidedSellA, id: 4, profitAndLoss: 18 };
  const overrides = findFullyFilledVoidedOrderOverrides(
    [voidedBuy, voidedSellA, voidedSellB, voidedSellC],
    [
      { id: 100, accountId: 1, contractId: 'MGC', status: 2, side: 0, fillVolume: 2 },
      { id: 101, accountId: 1, contractId: 'MGC', status: 2, side: 1, fillVolume: 6 },
    ],
  );

  assert.deepEqual([...overrides].sort(), ['1:100', '1:101']);
  const reconstructed = reconstructProjectXPositions([
    leg(5, 1, 2, 4370.2, null, 99, '2026-09-22T13:39:48Z'),
    voidedBuy,
    leg(6, 0, 2, 4370.7, null, 102, '2026-09-22T14:01:55Z'),
    leg(7, 0, 2, 4370.6, null, 103, '2026-09-22T14:02:49Z'),
    leg(8, 0, 2, 4370, null, 104, '2026-09-22T14:04:14Z'),
    voidedSellA,
    voidedSellB,
    voidedSellC,
  ], overrides);

  assert.equal(reconstructed.warnings.length, 0);
  assert.equal(reconstructed.openPositions.length, 0);
  assert.equal(reconstructed.positions.length, 2);
});

test('does not reinstate partially voided, cancelled, or quantity-mismatched orders', () => {
  const voided = leg(1, 0, 2, 100, -10, 100, '2026-11-01T10:00:00Z', 0, 0, true);
  const active = leg(2, 0, 1, 100, null, 100, '2026-11-01T10:00:00Z');
  const overrides = findFullyFilledVoidedOrderOverrides(
    [voided, active],
    [{ id: 100, accountId: 1, contractId: 'MGC', status: 2, side: 0, fillVolume: 3 }],
  );
  assert.equal(overrides.size, 0);

  const cancelled = findFullyFilledVoidedOrderOverrides(
    [voided],
    [{ id: 100, accountId: 1, contractId: 'MGC', status: 3, side: 0, fillVolume: 2 }],
  );
  assert.equal(cancelled.size, 0);

  const mismatch = findFullyFilledVoidedOrderOverrides(
    [voided],
    [{ id: 100, accountId: 1, contractId: 'MGC', status: 2, side: 0, fillVolume: 3 }],
  );
  assert.equal(mismatch.size, 0);
});

test('latest voided version of a trade ID is excluded', () => {
  const original = leg(
    1, 0, 1, 100, null, 10, '2026-11-01T10:00:00Z', 1, 0.5
  );
  const voidedUpdate = { ...original, voided: true };

  const result = reconstructProjectXPositions([
    original,
    voidedUpdate,
    leg(2, 1, 1, 101, 10, 11, '2026-11-01T10:01:00Z', 1, 0.5),
  ]);

  assert.equal(result.positions.length, 0);
  assert.equal(result.openPositions.length, 0);
  assert.equal(result.warnings.length, 1);
});

test('reconstructs the attached ProjectX diagnostic and matches daily counts', {
  skip: !fs.existsSync(path.join(process.cwd(), 'data/projectx-diagnostic.json')),
}, () => {
  const file = path.join(process.cwd(), 'data/projectx-diagnostic.json');
  const diagnostic = JSON.parse(fs.readFileSync(file, 'utf8'));

  const expectedCounts: Record<string, number> = {
    '2026-11-02': 11,
    '2026-11-03': 14,
    '2026-11-04': 19,
    '2026-11-05': 4,
    '2026-11-06': 4,
    '2026-11-09': 5,
    '2026-11-10': 16,
    '2026-11-11': 5,
    '2026-11-12': 6,
    '2026-11-13': 4,
    '2026-11-16': 6,
    '2026-11-17': 8,
  };

  const daily: Record<string, { count: number; net: number }> = {};
  let totalPositions = 0;

  for (const account of diagnostic.accounts) {
    const result = reconstructProjectXPositions(account.trades);
    assert.deepEqual(result.warnings, []);
    assert.deepEqual(result.openPositions, []);

    totalPositions += result.positions.length;

    for (const position of result.positions) {
      const date = position.exitTime.slice(0, 10);
      if (!daily[date]) daily[date] = { count: 0, net: 0 };
      daily[date].count++;
      daily[date].net += position.netPL;
    }
  }

  assert.equal(totalPositions, 106);

  for (const [date, expected] of Object.entries(expectedCounts)) {
    assert.equal(daily[date]?.count, expected, `${date} trade count`);
  }

  assert.equal(Number(daily['2026-11-03'].net.toFixed(2)), 22.60);
  assert.equal(Number(daily['2026-11-04'].net.toFixed(2)), -3634.60);
  assert.equal(Number(daily['2026-11-10'].net.toFixed(2)), -1080.00);
  assert.equal(Number(daily['2026-11-17'].net.toFixed(2)), -676.80);
});


test('refreshes voided-order overrides only for accounts successfully queried', () => {
  const previous = ['7:100', '8:200', '9:300'];
  const fresh = new Set(['7:101']);
  const merged = mergeVoidedOrderOverrides(previous, fresh, new Set([7]));
  assert.deepEqual([...merged].sort(), ['7:101', '8:200', '9:300']);
});

test('clears stale overrides when a successfully queried account has no qualifying orders', () => {
  const merged = mergeVoidedOrderOverrides(
    ['7:100', '8:200'],
    new Set(),
    new Set([7]),
  );
  assert.deepEqual([...merged], ['8:200']);
});
