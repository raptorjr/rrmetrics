import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { clearProjectXImport, reconcileProjectXHistory } from './ProjectXSync';
import type { ProjectXRawTrade } from './ProjectXSync';

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE broker_connections (id TEXT PRIMARY KEY, owner TEXT NOT NULL, last_sync_time TEXT, updated_at TEXT);
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
    CREATE TABLE trade_tags (trade_id TEXT NOT NULL, tag_id TEXT NOT NULL, PRIMARY KEY (trade_id, tag_id));
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
  const args: Parameters<typeof reconcileProjectXHistory> = [
    db, 'user-1', 'connection-1', legs,
    new Map([[7, 'Topstep Practice']]),
    { 'CON.F.US.MGC.Z6': 'MGC' },
    1, false, [7],
  ];

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

  db.prepare('INSERT INTO trade_tags (trade_id, tag_id) VALUES (?, ?)').run(row.id, 'strategy-tag');
  reconcileProjectXHistory(...args);
  assert.equal((db.prepare('SELECT COUNT(*) AS count FROM trades').get() as { count: number }).count, 1);
  assert.equal((db.prepare('SELECT COUNT(*) AS count FROM trade_tags WHERE trade_id = ?').get(row.id) as { count: number }).count, 1);
  assert.equal((db.prepare('SELECT COUNT(*) AS count FROM projectx_trade_legs').get() as { count: number }).count, 2);
  db.close();
});

test('rebuilds an existing position when a broker leg is corrected or voided', () => {
  const db = createDb();
  const args: Parameters<typeof reconcileProjectXHistory> = [
    db, 'user-1', 'connection-1', legs,
    new Map([[7, 'Topstep Practice']]),
    { 'CON.F.US.MGC.Z6': 'MGC' },
    1, false, [7],
  ];

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
    { 'CON.F.US.MGC.Z6': 'MGC' }, 1, false, [7],
  );
  assert.equal(voidedResult.positions, 0);
  assert.equal((db.prepare('SELECT COUNT(*) AS count FROM trades').get() as { count: number }).count, 0);
  assert.equal((db.prepare('SELECT COUNT(*) AS count FROM projectx_trade_legs').get() as { count: number }).count, 2);
  db.close();
});


test('commits safe positions and raw legs when later history has warnings', () => {
  const db = createDb();
  const mixedHistory: ProjectXRawTrade[] = [
    ...legs,
    {
      id: 3, accountId: 7, contractId: 'CON.F.US.MGC.Z6',
      creationTimestamp: '2026-11-02T10:06:00Z', price: 4002,
      profitAndLoss: 10, fees: 1.42, commissions: 0.5,
      side: 1, size: 2, voided: false, orderId: 12, fillId: null,
    },
    {
      id: 4, accountId: 7, contractId: 'CON.F.US.MGC.Z6',
      creationTimestamp: '2026-11-02T10:07:00Z', price: 4003,
      profitAndLoss: null, fees: 1.42, commissions: 0.5,
      side: 0, size: 1, voided: false, orderId: 13, fillId: null,
    },
    {
      id: 5, accountId: 7, contractId: 'CON.F.US.MGC.Z6',
      creationTimestamp: '2026-11-02T10:08:00Z', price: 4004,
      profitAndLoss: 10, fees: 1.42, commissions: 0.5,
      side: 1, size: 1, voided: false, orderId: 14, fillId: null,
    },
  ];

  const result = reconcileProjectXHistory(
    db, 'user-1', 'connection-1', mixedHistory,
    new Map([[7, 'Topstep Practice']]),
    { 'CON.F.US.MGC.Z6': 'MGC' }, 1, false, [7],
  );

  assert.equal(result.positions, 1);
  assert.equal(result.warnings.length, 1);
  assert.equal((db.prepare('SELECT COUNT(*) AS count FROM trades').get() as { count: number }).count, 1);
  assert.equal((db.prepare('SELECT COUNT(*) AS count FROM projectx_trade_legs').get() as { count: number }).count, 5);
  db.close();
});

test('clears only the selected connection ProjectX import and keeps connection', () => {
  const db = createDb();
  db.prepare('INSERT INTO broker_connections (id, owner, last_sync_time, updated_at) VALUES (?, ?, ?, ?)').run(
    'connection-1', 'user-1', '2026-11-18T10:00:00Z', '2026-11-18T10:00:00Z',
  );
  db.prepare('INSERT INTO broker_connections (id, owner, last_sync_time, updated_at) VALUES (?, ?, ?, ?)').run(
    'connection-2', 'user-1', '2026-11-18T10:00:00Z', '2026-11-18T10:00:00Z',
  );
  reconcileProjectXHistory(
    db, 'user-1', 'connection-1', legs,
    new Map([[7, 'Topstep Practice']]), { 'CON.F.US.MGC.Z6': 'MGC' }, 1, false, [7],
  );
  db.prepare(`INSERT INTO projectx_trade_legs
    (broker_connection_id, account_id, trade_id, contract_id, creation_timestamp, voided, raw_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      'connection-2', 8, 99, 'CON.F.US.MGC.Z6', '2026-11-02T10:00:00Z', 0, '{}', '2026-11-18T10:00:00Z',
    );

  const result = clearProjectXImport(db, 'user-1', 'connection-1');
  assert.deepEqual(result, { deletedPositions: 1, deletedRawLegs: 2 });
  assert.equal((db.prepare('SELECT COUNT(*) AS count FROM trades WHERE broker_connection_id = ?').get('connection-1') as { count: number }).count, 0);
  assert.equal((db.prepare('SELECT COUNT(*) AS count FROM projectx_trade_legs WHERE broker_connection_id = ?').get('connection-1') as { count: number }).count, 0);
  assert.equal((db.prepare('SELECT COUNT(*) AS count FROM projectx_trade_legs WHERE broker_connection_id = ?').get('connection-2') as { count: number }).count, 1);
  assert.equal((db.prepare('SELECT last_sync_time FROM broker_connections WHERE id = ?').get('connection-1') as { last_sync_time: string | null }).last_sync_time, null);
  assert.notEqual((db.prepare('SELECT last_sync_time FROM broker_connections WHERE id = ?').get('connection-2') as { last_sync_time: string | null }).last_sync_time, null);
  db.close();
});


test('applies per-account Topstep type and friendly display name', () => {
  const db = createDb();
  const evalLegs = legs.map(leg => ({ ...leg, accountId: 7 }));
  const xfaLegs = legs.map(leg => ({ ...leg, id: leg.id + 100, accountId: 8, orderId: leg.orderId + 100 }));
  reconcileProjectXHistory(
    db, 'user-1', 'connection-1', [...evalLegs, ...xfaLegs],
    new Map([[7, 'Gold Evaluation'], [8, 'Main XFA']]),
    { 'CON.F.US.MGC.Z6': 'MGC' }, 1, false, [7, 8], new Set(),
    {
      '7': { type: 'evaluation', displayName: 'Gold Evaluation' },
      '8': { type: 'xfa', displayName: 'Main XFA' },
    },
  );
  const rows = db.prepare('SELECT account, is_eval FROM trades ORDER BY account').all() as Array<{ account: string; is_eval: number }>;
  assert.deepEqual(rows, [
    { account: 'Gold Evaluation', is_eval: 1 },
    { account: 'Main XFA', is_eval: 0 },
  ]);
  db.close();
});
