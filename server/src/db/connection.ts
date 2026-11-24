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

  // Expand the source-owned dataset catalogue to support tick-event datasets.
  // Rebuild the table transactionally so existing OHLCV records and ownership
  // constraints are preserved on installations created before tick support.
  const marketDatasetTable = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'market_data_file_datasets'",
  ).get() as { sql: string } | undefined;
  if (marketDatasetTable?.sql.includes("data_kind IN ('ohlcv')")) {
    db.transaction(() => {
      db.exec(`
        DROP INDEX IF EXISTS idx_market_data_datasets_query;
        DROP INDEX IF EXISTS idx_market_data_datasets_file;
        ALTER TABLE market_data_file_datasets RENAME TO market_data_file_datasets_legacy;
        CREATE TABLE market_data_file_datasets (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
          file_id TEXT NOT NULL,
          data_kind TEXT NOT NULL CHECK (data_kind IN ('ohlcv', 'ticks')),
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
        INSERT INTO market_data_file_datasets (
          id, user_id, file_id, data_kind, instrument, source_symbol, timeframe,
          timezone, timestamp_unit, row_count, start_time, end_time, schema_version,
          normalized_storage_key, created_at
        )
        SELECT
          id, user_id, file_id, data_kind, instrument, source_symbol, timeframe,
          timezone, timestamp_unit, row_count, start_time, end_time, schema_version,
          normalized_storage_key, created_at
        FROM market_data_file_datasets_legacy;
        DROP TABLE market_data_file_datasets_legacy;
        CREATE INDEX idx_market_data_datasets_query
          ON market_data_file_datasets(user_id, instrument, timeframe, start_time, end_time);
        CREATE INDEX idx_market_data_datasets_file
          ON market_data_file_datasets(file_id);
      `);
    })();
  }

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
  if (!projectxColumns.has('full_sync_enabled')) db.exec('ALTER TABLE projectx_connections ADD COLUMN full_sync_enabled INTEGER NOT NULL DEFAULT 0');
  if (!projectxColumns.has('setup_completed')) db.exec('ALTER TABLE projectx_connections ADD COLUMN setup_completed INTEGER NOT NULL DEFAULT 0');
  db.exec("UPDATE projectx_connections SET setup_completed = 1 WHERE setup_completed = 0 AND selected_accounts IS NOT NULL AND selected_accounts != '[]' AND EXISTS (SELECT 1 FROM broker_connections bc WHERE bc.id = projectx_connections.broker_connection_id AND bc.last_sync_time IS NOT NULL)");

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
    db.transaction(() => db.exec(`
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
    `))();
  }

  instance = db;
  return db;
}

/** Explicit boot-time initialization (schema creation happens here). */
export function initDb(): Db {
  return getDb();
}
