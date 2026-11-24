import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { migrateMarketDataDatasetKinds } from './connection';

test('migrates OHLCV-only dataset catalogue without losing ownership or rows', () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE profiles (id TEXT PRIMARY KEY);
    CREATE TABLE market_data_files (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      UNIQUE(id, user_id)
    );
    INSERT INTO profiles (id) VALUES ('user-1');
    INSERT INTO market_data_files (id, user_id) VALUES ('file-1', 'user-1');
    CREATE TABLE market_data_file_datasets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      file_id TEXT NOT NULL,
      data_kind TEXT NOT NULL CHECK (data_kind IN ('ohlcv')),
      instrument TEXT NOT NULL,
      source_symbol TEXT,
      timeframe TEXT NOT NULL,
      timezone TEXT,
      timestamp_unit TEXT NOT NULL,
      row_count INTEGER NOT NULL CHECK (row_count >= 0),
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      schema_version INTEGER NOT NULL DEFAULT 1,
      normalized_storage_key TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      FOREIGN KEY(file_id, user_id) REFERENCES market_data_files(id, user_id) ON DELETE CASCADE
    );
    CREATE INDEX idx_market_data_datasets_query
      ON market_data_file_datasets(user_id, instrument, timeframe, start_time, end_time);
    CREATE INDEX idx_market_data_datasets_file
      ON market_data_file_datasets(file_id);
    INSERT INTO market_data_file_datasets (
      id,user_id,file_id,data_kind,instrument,source_symbol,timeframe,timezone,
      timestamp_unit,row_count,start_time,end_time,normalized_storage_key
    ) VALUES (
      'dataset-1','user-1','file-1','ohlcv','NQ','NQZ6','1m','UTC',
      'MILLIS',1380,'2026-11-09T00:00:00.000Z','2026-11-09T23:00:00.000Z','normalized/nq.parquet'
    );
  `);

  try {
    migrateMarketDataDatasetKinds(db);
    const existing = db.prepare('SELECT * FROM market_data_file_datasets WHERE id = ?').get('dataset-1') as any;
    assert.equal(existing.data_kind, 'ohlcv');
    assert.equal(existing.row_count, 1380);
    assert.equal(existing.file_id, 'file-1');

    db.prepare(`
      INSERT INTO market_data_file_datasets (
        id,user_id,file_id,data_kind,instrument,source_symbol,timeframe,timezone,
        timestamp_unit,row_count,start_time,end_time,normalized_storage_key
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      'dataset-2','user-1','file-1','ticks','NQ','NQZ6','tick','UTC',
      'NANOS',100,'2026-11-09T00:00:00.000Z','2026-11-09T23:00:00.000Z','normalized/nq-ticks.parquet'
    );
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM market_data_file_datasets').get() as any).count, 2);
    assert.equal((db.prepare('PRAGMA foreign_key_check').all() as unknown[]).length, 0);

    // Re-running the migration is a no-op.
    migrateMarketDataDatasetKinds(db);
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM market_data_file_datasets').get() as any).count, 2);
  } finally {
    db.close();
  }
});
