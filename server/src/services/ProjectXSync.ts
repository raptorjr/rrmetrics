import type { Db } from '../db/connection';
import type { ProjectXTradeLeg, ReconstructedPosition } from './ProjectXReconstruction';
import { reconstructProjectXPositions } from './ProjectXReconstruction';

export interface ProjectXRawTrade extends ProjectXTradeLeg {}

export interface ProjectXSyncResult {
  rawLegs: number;
  positions: number;
  newTradesImported: number;
  openPositions: number;
  warnings: string[];
  reinstatedVoidedOrders: number;
}

/**
 * Persist the latest complete broker history and rebuild this connection's
 * imported positions. Raw trade IDs are the source of truth; position rows
 * are a replaceable projection of that source.
 */
export function reconcileProjectXHistory(
  db: Db,
  userId: string,
  connectionId: string,
  trades: ProjectXRawTrade[],
  accountNames: Map<number, string>,
  contractNames: Record<string, string>,
  multiplier: number,
  connectionIsEval: boolean,
  selectedAccountIds: number[],
  reinstatedVoidedOrderKeys: Set<string> = new Set(),
  accountSettings: Record<string, { type: 'evaluation' | 'xfa' | 'live_funded' | 'other'; displayName: string; currencyCode?: string }> = {},
): ProjectXSyncResult {
  const now = new Date().toISOString();

  const upsertLeg = db.prepare(`
    INSERT INTO projectx_trade_legs (
      broker_connection_id, account_id, trade_id, contract_id,
      creation_timestamp, voided, raw_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(broker_connection_id, account_id, trade_id) DO UPDATE SET
      contract_id = excluded.contract_id,
      creation_timestamp = excluded.creation_timestamp,
      voided = excluded.voided,
      raw_json = excluded.raw_json,
      updated_at = excluded.updated_at
  `);

  const readLegs = db.prepare(`
    SELECT raw_json FROM projectx_trade_legs
    WHERE broker_connection_id = ?
    ORDER BY creation_timestamp, trade_id
  `);

  // Track the current projection IDs so unchanged positions can be updated
  // in place. This preserves tags, rule checks and other journal metadata.
  db.exec('CREATE TEMP TABLE IF NOT EXISTS projectx_current_position_ids (id TEXT PRIMARY KEY)');
  const clearCurrentIds = db.prepare('DELETE FROM projectx_current_position_ids');
  const rememberCurrentId = db.prepare('INSERT OR IGNORE INTO projectx_current_position_ids (id) VALUES (?)');
  const deleteStaleProjection = db.prepare(`
    DELETE FROM trades
    WHERE user_id = ? AND broker_connection_id = ? AND projectx_source = 'projectx'
      AND id NOT IN (SELECT id FROM projectx_current_position_ids)
  `);

  const insertPosition = db.prepare(`
    INSERT INTO trades (
      id, user_id, ticker, enter_time, exit_time, enter_price, exit_price,
      quantity, manual_pl, gross_pl, fees, commissions, currency_code, comments,
      projectx_trade_id, projectx_source, broker_connection_id, account,
      is_eval, created_date
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'projectx', ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      ticker = excluded.ticker,
      enter_time = excluded.enter_time,
      exit_time = excluded.exit_time,
      enter_price = excluded.enter_price,
      exit_price = excluded.exit_price,
      quantity = excluded.quantity,
      manual_pl = excluded.manual_pl,
      gross_pl = excluded.gross_pl,
      fees = excluded.fees,
      commissions = excluded.commissions,
      currency_code = excluded.currency_code,
      projectx_trade_id = excluded.projectx_trade_id,
      broker_connection_id = excluded.broker_connection_id,
      account = excluded.account,
      is_eval = excluded.is_eval
  `);

  const result = db.transaction(() => {
    for (const leg of trades) {
      upsertLeg.run(
        connectionId,
        leg.accountId,
        leg.id,
        leg.contractId,
        leg.creationTimestamp,
        leg.voided ? 1 : 0,
        JSON.stringify(leg),
        now,
      );
    }

    // Keep raw execution history for previously imported accounts, even when
    // they are later deselected or disappear from the broker's current account
    // list. Account selection controls future downloads, not historical retention.

    const stored = readLegs.all(connectionId) as Array<{ raw_json: string }>;
    const allLegs = stored.map(row => JSON.parse(row.raw_json) as ProjectXRawTrade);
    const reconstruction = reconstructProjectXPositions(allLegs, reinstatedVoidedOrderKeys);

    const existingPositionIds = new Set(
      (db.prepare(`SELECT id FROM trades WHERE user_id = ? AND broker_connection_id = ? AND projectx_source = 'projectx'`).all(userId, connectionId) as Array<{ id: string }>).map(row => row.id),
    );
    let newTradesImported = 0;
    clearCurrentIds.run();

    for (const position of reconstruction.positions) {
      const accountName = accountNames.get(position.accountId) || `ProjectX ${position.accountId}`;
      const ticker = contractNames[position.contractId] || position.contractId;
      const scaled: ReconstructedPosition = {
        ...position,
        quantity: position.quantity * multiplier,
        grossPL: position.grossPL * multiplier,
        fees: position.fees * multiplier,
        commissions: position.commissions * multiplier,
        netPL: position.netPL * multiplier,
      };

      const projectionId = `px:${connectionId}:${position.positionKey}`;
      rememberCurrentId.run(projectionId);
      if (!existingPositionIds.has(projectionId)) newTradesImported += 1;
      insertPosition.run(
        projectionId,
        userId,
        ticker,
        position.enterTime,
        position.exitTime,
        position.enterPrice,
        position.exitPrice,
        scaled.quantity,
        scaled.netPL,
        scaled.grossPL,
        scaled.fees,
        scaled.commissions,
        (accountSettings[String(position.accountId)]?.currencyCode || 'USD').toUpperCase(),
        '',
        projectionId,
        connectionId,
        accountName,
        accountSettings[String(position.accountId)]
          ? (accountSettings[String(position.accountId)].type === 'evaluation' ? 1 : 0)
          : (Object.keys(accountSettings).length === 0 && (connectionIsEval || /EV/i.test(accountName)) ? 1 : 0),
        now,
      );
    }

    // When reconstruction is incomplete, preserve the previous projection
    // snapshot rather than deleting rows that may be absent only because an
    // instrument was quarantined after its first inconsistency.
    if (reconstruction.warnings.length === 0) {
      deleteStaleProjection.run(userId, connectionId);
    }
    return { ...reconstruction, newTradesImported };
  })();

  return {
    rawLegs: trades.length,
    positions: result.positions.length,
    newTradesImported: result.newTradesImported,
    openPositions: result.openPositions.length,
    warnings: result.warnings,
    reinstatedVoidedOrders: reinstatedVoidedOrderKeys.size,
  };
}


/**
 * Clear only this user's imported ProjectX projection and raw broker history.
 * The connection and encrypted credentials remain intact so it can be synced
 * again without reconnecting. All deletes and the sync timestamp reset are
 * committed atomically.
 */
export function clearProjectXImport(
  db: Db,
  userId: string,
  connectionId: string,
): { deletedPositions: number; deletedRawLegs: number } {
  const run = db.transaction(() => {
    const deletedPositions = db.prepare(`
      DELETE FROM trades
      WHERE user_id = ? AND broker_connection_id = ? AND projectx_source = 'projectx'
    `).run(userId, connectionId).changes;

    const deletedRawLegs = db.prepare(`
      DELETE FROM projectx_trade_legs WHERE broker_connection_id = ?
    `).run(connectionId).changes;

    db.prepare(`
      UPDATE broker_connections SET last_sync_time = NULL, updated_at = ?
      WHERE id = ? AND owner = ?
    `).run(new Date().toISOString(), connectionId, userId);

    return { deletedPositions, deletedRawLegs };
  });

  return run();
}
