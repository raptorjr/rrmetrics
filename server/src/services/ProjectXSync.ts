import type { Db } from '../db/connection';
import type { ProjectXTradeLeg, ReconstructedPosition } from './ProjectXReconstruction';
import { reconstructProjectXPositions } from './ProjectXReconstruction';

export interface ProjectXRawTrade extends ProjectXTradeLeg {}

export interface ProjectXSyncResult {
  rawLegs: number;
  positions: number;
  openPositions: number;
  warnings: string[];
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

  const deleteProjection = db.prepare(`
    DELETE FROM trades
    WHERE user_id = ? AND broker_connection_id = ? AND projectx_source = 'projectx'
  `);

  const insertPosition = db.prepare(`
    INSERT INTO trades (
      id, user_id, ticker, enter_time, exit_time, enter_price, exit_price,
      quantity, manual_pl, gross_pl, fees, commissions, comments,
      projectx_trade_id, projectx_source, broker_connection_id, account,
      is_eval, created_date
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'projectx', ?, ?, ?, ?)
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

    // Remove raw histories for accounts that are no longer selected (or are
    // no longer the copy-trade lead). Otherwise deselected accounts linger.
    if (selectedAccountIds.length > 0) {
      db.prepare(
        `DELETE FROM projectx_trade_legs WHERE broker_connection_id = ? AND account_id NOT IN (${selectedAccountIds.map(() => '?').join(', ')})`,
      ).run(connectionId, ...selectedAccountIds);
    }

    const stored = readLegs.all(connectionId) as Array<{ raw_json: string }>;
    const allLegs = stored.map(row => JSON.parse(row.raw_json) as ProjectXRawTrade);
    const reconstruction = reconstructProjectXPositions(allLegs);

    deleteProjection.run(userId, connectionId);

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

      insertPosition.run(
        `px:${connectionId}:${position.positionKey}`,
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
        position.tradeIds.join(','),
        `px:${connectionId}:${position.positionKey}`,
        connectionId,
        accountName,
        connectionIsEval || /EV/i.test(accountName) ? 1 : 0,
        now,
      );
    }

    return reconstruction;
  })();

  return {
    rawLegs: trades.length,
    positions: result.positions.length,
    openPositions: result.openPositions.length,
    warnings: result.warnings,
  };
}
