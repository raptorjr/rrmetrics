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
  if (!tradeColumns.has('currency_code')) db.exec("ALTER TABLE trades ADD COLUMN currency_code TEXT NOT NULL DEFAULT 'USD'");

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

  const tradezellaAccountColumns = new Set((db.prepare('PRAGMA table_info(tradezella_accounts)').all() as Array<{ name: string }>).map(column => column.name));
  if (!tradezellaAccountColumns.has('match_account')) db.exec('ALTER TABLE tradezella_accounts ADD COLUMN match_account TEXT');

  // TradeZella source rows can map to multiple RR partial-exit trades.
  // Rebuild older versions of this table whose UNIQUE key allowed only one trade_id.
  const tradezellaIndexes = db.prepare('PRAGMA index_list(tradezella_imported_trades)').all() as Array<{ name: string; unique: number }>;
  const hasLegacyTradeZellaUnique = tradezellaIndexes.some(index => {
    if (!index.unique) return false;
    const columns = (db.prepare(`PRAGMA index_info("${index.name}")`).all() as Array<{ name: string }>).map(column => column.name);
    return columns.join(',') === 'user_id,source_account_name,source_fingerprint';
  });
  if (hasLegacyTradeZellaUnique) {
    db.exec(`
      CREATE TABLE tradezella_imported_trades_new (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        source_account_name TEXT NOT NULL,
        source_fingerprint TEXT NOT NULL,
        source_row INTEGER,
        trade_id TEXT NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
        imported_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        UNIQUE(user_id, source_account_name, source_fingerprint, trade_id)
      );
      INSERT INTO tradezella_imported_trades_new
        (id, user_id, source_account_name, source_fingerprint, source_row, trade_id, imported_at)
      SELECT id, user_id, source_account_name, source_fingerprint, source_row, trade_id, imported_at
      FROM tradezella_imported_trades;
      DROP TABLE tradezella_imported_trades;
      ALTER TABLE tradezella_imported_trades_new RENAME TO tradezella_imported_trades;
      CREATE INDEX IF NOT EXISTS idx_tradezella_imported_trades_user_id
        ON tradezella_imported_trades(user_id);
    `);
  }

  instance = db;
  return db;
}

/** Explicit boot-time initialization (schema creation happens here). */
export function initDb(): Db {
  return getDb();
}
