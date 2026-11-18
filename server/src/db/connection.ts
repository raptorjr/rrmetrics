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

  instance = db;
  return db;
}

/** Explicit boot-time initialization (schema creation happens here). */
export function initDb(): Db {
  return getDb();
}
