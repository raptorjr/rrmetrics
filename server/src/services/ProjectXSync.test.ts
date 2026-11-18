import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { reconcileProjectXHistory } from './ProjectXSync';
import type { ProjectXRawTrade } from './ProjectXSync';

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE trades (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      ticker TEXT NOT NULL,
      enter_time TEXT NOT NULL,
      exit_time TEXT NOT NULL,
      enter_price REAL NOT NULL,
      exit_price REAL NOT NULL,
      quantity REAL NOT NULL,
      manual_pl REAL,
      gross_pl REAL,
      fees REAL NOT NULL DEFAULT 0,
      commissions REAL NOT NULL DEFAULT 0,
      comments TEXT NOT NULL DEFAULT '',
      projectx_trade_id TEXT,
      projectx_source TEXT,
      broker_connection_id TEXT,
      account TEXT,
      is_eval INTEGER NOT NULL DEFAULT 0,
      created_date TEXT NOT NULL
    );
    CREATE TABLE projectx_trade_legs (
      broker_connection_id TEXT NOT NULL,
      account_id INTEGER NOT NULL,
      trade_id INTEGER NOT NULL,
      contract_id TEXT NOT NULL,
      creation_timestamp TEXT NOT NULL,
      voided INTEGER NOT NULL DEFAULT 0,
      raw_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (broker_connection_id, account_id, trade_id)
    );
  `);
  return db;
}

const legs: ProjectXRawTrade[] = [
  {
    id: 1, accountId: 7, contractId: 'CON.F.US.MGC.Z6',
    creationTimestamp: '2026-11-02T10:00:00Z', price: 4000,
    profitAndLoss: null, fees: 1.42, commissions: 0.5,
    side: 0, size: 2, voided: false, orderId: 10, fillId: null,
  },
  {
    id: 2, accountId: 7, contractId: 'CON.F.US.MGC.Z6',
    creationTimestamp: '2026-11-02T10:05:00Z', price: 4001,
    profitAndLoss: 10, fees: 1.42, commissions: 0.5,
    side: 1, size: 2, voided: false, orderId: 11, fillId: null,
  },
];

test('reconciles raw ProjectX legs into a net-P&L trade and is idempotent', () => {
  const db = createDb();
  const args = [
    db, 'user-1', 'connection-1', legs,
    new Map([[7, 'Topstep Practice']]),
    { 'CON.F.US.MGC.Z6': 'MGC' },
    1, false, [7],
  ] as const;

  const first = reconcileProjectXHistory(...args);
  assert.equal(first.rawLegs, 2);
  assert.equal(first.positions, 1);
  assert.equal(first.openPositions, 0);

  const row = db.prepare('SELECT * FROM trades').get() as any;
  assert.equal(row.ticker, 'MGC');
  assert.equal(row.quantity, 2);
  assert.equal(row.gross_pl, 10);
  assert.equal(row.fees, 2.84);
  assert.equal(row.commissions, 1);
  assert.equal(row.manual_pl, 6.16);
  assert.equal(row.projectx_source, 'projectx');

  reconcileProjectXHistory(...args);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM trades').get().count, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM projectx_trade_legs').get().count, 2);
  db.close();
});

test('rebuilds an existing position when a broker leg is corrected or voided', () => {
  const db = createDb();
  const args = [
    db, 'user-1', 'connection-1', legs,
    new Map([[7, 'Topstep Practice']]),
    { 'CON.F.US.MGC.Z6': 'MGC' },
    1, false,
  ] as const;

  reconcileProjectXHistory(...args);
  const corrected = legs.map(leg => leg.id === 2
    ? { ...leg, profitAndLoss: 8, fees: 2, voided: false }
    : leg);
  const result = reconcileProjectXHistory(
    db, 'user-1', 'connection-1', corrected,
    new Map([[7, 'Topstep Practice']]),
    { 'CON.F.US.MGC.Z6': 'MGC' }, 1, false, [7],
  );
  const row = db.prepare('SELECT * FROM trades').get() as any;
  assert.equal(result.positions, 1);
  assert.equal(row.gross_pl, 8);
  assert.equal(row.manual_pl, 3.58);

  const voided = corrected.map(leg => leg.id === 2 ? { ...leg, voided: true } : leg);
  const voidedResult = reconcileProjectXHistory(
    db, 'user-1', 'connection-1', voided,
    new Map([[7, 'Topstep Practice']]),
    { 'CON.F.US.MGC.Z6': 'MGC' }, 1, false,
  );
  assert.equal(voidedResult.positions, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM trades').get().count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM projectx_trade_legs').get().count, 2);
  db.close();
});
