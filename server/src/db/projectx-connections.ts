import type { Db } from './connection';
import type { ProjectXConnectionRow } from '../bindings';
import { generateId } from '../utils/id';

function parseJson<T>(value: unknown): T | null {
  if (value == null) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }
  return value as T;
}

function rowFromDb(row: any): ProjectXConnectionRow {
  return {
    ...row,
    selected_accounts: parseJson<number[]>(row.selected_accounts),
    account_settings: parseJson<Record<string, { type: 'evaluation' | 'xfa' | 'live_funded' | 'other'; displayName: string }>>(row.account_settings),
    reinstated_order_keys: parseJson<string[]>(row.reinstated_order_keys),
    copytrade_config: parseJson<{ leadAccountId: number; multiplier: number }>(row.copytrade_config),
    auto_sync_enabled: !!row.auto_sync_enabled,
    auto_sync_last_result: parseJson<Record<string, any>>(row.auto_sync_last_result),
  } as ProjectXConnectionRow;
}

export async function findByBrokerConnectionId(
  db: Db,
  brokerConnectionId: string,
): Promise<ProjectXConnectionRow | null> {
  const row = db
    .prepare('SELECT * FROM projectx_connections WHERE broker_connection_id = ?')
    .get(brokerConnectionId);
  return row ? rowFromDb(row) : null;
}

export async function create(
  db: Db,
  brokerConnectionId: string,
  fields: {
    username: string;
    api_key: string;
    access_token: string;
    token_expires_at: string;
  },
): Promise<ProjectXConnectionRow> {
  const id = generateId();
  try {
    db.prepare(
      `INSERT INTO projectx_connections (
         id, broker_connection_id, username, api_key, access_token, token_expires_at, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      brokerConnectionId,
      fields.username,
      fields.api_key,
      fields.access_token,
      fields.token_expires_at,
      new Date().toISOString(),
    );
  } catch (err: any) {
    throw new Error(`Failed to create projectx connection: ${err.message}`);
  }

  const row = db.prepare('SELECT * FROM projectx_connections WHERE id = ?').get(id);
  return rowFromDb(row);
}

export async function updateByBrokerConnectionId(
  db: Db,
  brokerConnectionId: string,
  updates: Partial<Pick<ProjectXConnectionRow, 'username' | 'api_key' | 'access_token' | 'token_expires_at' | 'selected_accounts' | 'account_settings' | 'last_full_sync_time' | 'reinstated_order_keys' | 'copytrade_config' | 'auto_sync_enabled' | 'auto_sync_interval_minutes' | 'auto_sync_next_at' | 'auto_sync_last_attempt_at' | 'auto_sync_last_error' | 'auto_sync_last_result'>>,
): Promise<void> {
  const columns: string[] = [];
  const values: unknown[] = [];

  if (updates.username !== undefined) {
    columns.push('username = ?');
    values.push(updates.username);
  }
  if (updates.api_key !== undefined) {
    columns.push('api_key = ?');
    values.push(updates.api_key);
  }
  if (updates.access_token !== undefined) {
    columns.push('access_token = ?');
    values.push(updates.access_token);
  }
  if (updates.token_expires_at !== undefined) {
    columns.push('token_expires_at = ?');
    values.push(updates.token_expires_at);
  }
  if (updates.selected_accounts !== undefined) {
    columns.push('selected_accounts = ?');
    values.push(updates.selected_accounts == null ? null : JSON.stringify(updates.selected_accounts));
  }
  if (updates.account_settings !== undefined) {
    columns.push('account_settings = ?');
    values.push(updates.account_settings == null ? null : JSON.stringify(updates.account_settings));
  }
  if (updates.last_full_sync_time !== undefined) { columns.push('last_full_sync_time = ?'); values.push(updates.last_full_sync_time); }
  if (updates.reinstated_order_keys !== undefined) { columns.push('reinstated_order_keys = ?'); values.push(updates.reinstated_order_keys == null ? null : JSON.stringify(updates.reinstated_order_keys)); }
  if (updates.copytrade_config !== undefined) {
    columns.push('copytrade_config = ?');
    values.push(updates.copytrade_config == null ? null : JSON.stringify(updates.copytrade_config));
  }

  if (updates.auto_sync_enabled !== undefined) { columns.push('auto_sync_enabled = ?'); values.push(updates.auto_sync_enabled ? 1 : 0); }
  if (updates.auto_sync_interval_minutes !== undefined) { columns.push('auto_sync_interval_minutes = ?'); values.push(updates.auto_sync_interval_minutes); }
  if (updates.auto_sync_next_at !== undefined) { columns.push('auto_sync_next_at = ?'); values.push(updates.auto_sync_next_at); }
  if (updates.auto_sync_last_attempt_at !== undefined) { columns.push('auto_sync_last_attempt_at = ?'); values.push(updates.auto_sync_last_attempt_at); }
  if (updates.auto_sync_last_error !== undefined) { columns.push('auto_sync_last_error = ?'); values.push(updates.auto_sync_last_error); }
  if (updates.auto_sync_last_result !== undefined) { columns.push('auto_sync_last_result = ?'); values.push(updates.auto_sync_last_result == null ? null : JSON.stringify(updates.auto_sync_last_result)); }

  if (columns.length === 0) return;

  try {
    db.prepare(
      `UPDATE projectx_connections SET ${columns.join(', ')} WHERE broker_connection_id = ?`,
    ).run(...values, brokerConnectionId);
  } catch (err: any) {
    throw new Error(`Failed to update projectx connection: ${err.message}`);
  }
}

export async function findExpiringSoon(
  db: Db,
  thresholdIso: string,
): Promise<ProjectXConnectionRow[]> {
  const rows = db
    .prepare(
      `SELECT * FROM projectx_connections
       WHERE api_key IS NOT NULL AND token_expires_at <= ?`,
    )
    .all(thresholdIso);
  return rows.map(rowFromDb);
}

export async function findByProjectXTradeIds(
  db: Db,
  userId: string,
  tradeIds: string[],
): Promise<string[]> {
  if (tradeIds.length === 0) return [];

  const found: string[] = [];
  for (let i = 0; i < tradeIds.length; i += 500) {
    const group = tradeIds.slice(i, i + 500);
    const rows = db
      .prepare(
        `SELECT projectx_trade_id FROM trades
         WHERE user_id = ? AND projectx_trade_id IN (${new Array(group.length).fill('?').join(', ')})`,
      )
      .all(userId, ...group) as Array<{ projectx_trade_id: string | null }>;
    for (const row of rows) {
      if (row.projectx_trade_id) found.push(row.projectx_trade_id);
    }
  }
  return found;
}


export async function findAutoSyncEnabled(db: Db): Promise<ProjectXConnectionRow[]> {
  return db.prepare('SELECT * FROM projectx_connections WHERE auto_sync_enabled = 1 AND api_key IS NOT NULL').all().map(rowFromDb);
}
