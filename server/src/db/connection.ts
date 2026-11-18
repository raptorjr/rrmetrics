import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { DB_PATH, ensureDataDirs } from '../config';

/** The better-sqlite3 database handle type used across the db layer. */
export type Db = Database.Database;

let instance: Db | null = null;

/**
 * Returns the process-wide SQLite connection, creating the data directory,
 * database file, and schema on first use.
 */
export function getDb(): Db {
  if (instance) return instance;

  ensureDataDirs();
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const schemaPath = path.join(__dirname, 'schema.sql');
  db.exec(fs.readFileSync(schemaPath, 'utf8'));

  // CREATE TABLE IF NOT EXISTS does not add columns to existing databases.
  // Apply additive, idempotent migrations before the DB is exposed to routes.
  const tradeColumns = new Set(
    (db.prepare('PRAGMA table_info(trades)').all() as Array<{ name: string }>).map(column => column.name),
  );
  if (!tradeColumns.has('gross_pl')) db.exec('ALTER TABLE trades ADD COLUMN gross_pl REAL');
  if (!tradeColumns.has('fees')) db.exec('ALTER TABLE trades ADD COLUMN fees REAL NOT NULL DEFAULT 0');
  if (!tradeColumns.has('commissions')) db.exec('ALTER TABLE trades ADD COLUMN commissions REAL NOT NULL DEFAULT 0');

  const projectxColumns = new Set((db.prepare('PRAGMA table_info(projectx_connections)').all() as Array<{ name: string }>).map(column => column.name));
  if (!projectxColumns.has('account_settings')) db.exec('ALTER TABLE projectx_connections ADD COLUMN account_settings TEXT');
  if (!projectxColumns.has('last_full_sync_time')) db.exec('ALTER TABLE projectx_connections ADD COLUMN last_full_sync_time TEXT');
  if (!projectxColumns.has('reinstated_order_keys')) db.exec('ALTER TABLE projectx_connections ADD COLUMN reinstated_order_keys TEXT');
  if (!projectxColumns.has('auto_sync_enabled')) db.exec('ALTER TABLE projectx_connections ADD COLUMN auto_sync_enabled INTEGER NOT NULL DEFAULT 0');
  if (!projectxColumns.has('auto_sync_interval_minutes')) db.exec('ALTER TABLE projectx_connections ADD COLUMN auto_sync_interval_minutes INTEGER NOT NULL DEFAULT 5');
  if (!projectxColumns.has('auto_sync_next_at')) db.exec('ALTER TABLE projectx_connections ADD COLUMN auto_sync_next_at TEXT');
  if (!projectxColumns.has('auto_sync_started_at')) db.exec('ALTER TABLE projectx_connections ADD COLUMN auto_sync_started_at TEXT');
  if (!projectxColumns.has('auto_sync_last_attempt_at')) db.exec('ALTER TABLE projectx_connections ADD COLUMN auto_sync_last_attempt_at TEXT');
  if (!projectxColumns.has('auto_sync_last_error')) db.exec('ALTER TABLE projectx_connections ADD COLUMN auto_sync_last_error TEXT');
  if (!projectxColumns.has('auto_sync_last_result')) db.exec('ALTER TABLE projectx_connections ADD COLUMN auto_sync_last_result TEXT');

  instance = db;
  return db;
}

/** Explicit boot-time initialization (schema creation happens here). */
export function initDb(): Db {
  return getDb();
}
