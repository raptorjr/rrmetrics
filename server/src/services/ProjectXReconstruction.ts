export interface ProjectXTradeLeg {
  id: number;
  accountId: number;
  contractId: string;
  creationTimestamp: string;
  price: number;
  profitAndLoss: number | null;
  fees: number | null;
  commissions: number | null;
  side: number;
  size: number;
  voided: boolean;
  orderId: number;
  fillId: number | null;
}

export interface ReconstructedPosition {
  positionKey: string;
  accountId: number;
  contractId: string;
  direction: 1 | -1;
  enterTime: string;
  exitTime: string;
  enterPrice: number;
  exitPrice: number;
  quantity: number;
  grossPL: number;
  fees: number;
  commissions: number;
  netPL: number;
  tradeIds: number[];
}

export interface ProjectXOrderSnapshot {
  id: number;
  accountId: number;
  contractId: string;
  status: number;
  side: number;
  fillVolume: number | null;
}

/**
 * Find the narrow exception where the Trades API marks every leg of an order
 * voided, while the Orders API still reports the complete quantity as filled.
 * The raw voided records remain unchanged; this set only allows reconstruction
 * to account for a fully corroborated simulated-account execution.
 */
export function findFullyFilledVoidedOrderOverrides(
  trades: ProjectXTradeLeg[],
  orders: ProjectXOrderSnapshot[],
): Set<string> {
  const tradesByOrder = new Map<string, ProjectXTradeLeg[]>();
  for (const trade of trades) {
    const key = `${trade.accountId}:${trade.orderId}`;
    const legs = tradesByOrder.get(key) || [];
    legs.push(trade);
    tradesByOrder.set(key, legs);
  }

  const overrides = new Set<string>();
  for (const order of orders) {
    const key = `${order.accountId}:${order.id}`;
    const legs = tradesByOrder.get(key) || [];
    if (
      order.status !== 2
      || order.fillVolume == null
      || order.fillVolume <= 0
      || legs.length === 0
      || !legs.every(leg =>
        leg.voided
        && leg.contractId === order.contractId
        && leg.side === order.side
      )
    ) {
      continue;
    }

    const legQuantity = legs.reduce((total, leg) => total + leg.size, 0);
    if (legQuantity === order.fillVolume) {
      overrides.add(key);
    }
  }

  return overrides;
}

/**
 * Refresh corroborated voided-order overrides only for accounts whose Orders
 * history was successfully queried. Accounts not included in a sync (for
 * example, deselected historical accounts) retain their previous evidence.
 */
export function mergeVoidedOrderOverrides(
  previous: string[],
  fresh: Set<string>,
  refreshedAccountIds: Set<number>,
): Set<string> {
  const result = new Set(previous);
  for (const key of result) {
    const separator = key.indexOf(':');
    const accountId = Number(key.slice(0, separator));
    if (separator > 0 && refreshedAccountIds.has(accountId)) result.delete(key);
  }
  for (const key of fresh) result.add(key);
  return result;
}

export interface ReconstructionResult {
  positions: ReconstructedPosition[];
  openPositions: Array<{
    accountId: number;
    contractId: string;
    quantity: number;
    enterTime: string;
  }>;
  warnings: string[];
}

interface WorkingPosition {
  accountId: number;
  contractId: string;
  direction: 1 | -1;
  firstTradeId: number;
  enterTime: string;
  exitTime: string;
  entryQty: number;
  entryNotional: number;
  exitQty: number;
  exitNotional: number;
  maxExposure: number;
  grossPL: number;
  fees: number;
  commissions: number;
  tradeIds: number[];
}

export function reconstructProjectXPositions(
  input: ProjectXTradeLeg[],
  reinstatedVoidedOrderKeys: Set<string> = new Set(),
): ReconstructionResult {
  const warnings: string[] = [];
  const latestById = new Map<string, ProjectXTradeLeg>();

  // A later copy of the same trade ID replaces the earlier version.
  // This also allows an updated voided state to take effect.
  for (const leg of input) {
    const key = `${leg.accountId}:${leg.id}`;
    latestById.set(key, leg);
  }

  // Keep voided records in the source data, but never count them.
  const active = [...latestById.values()].filter(leg =>
    !leg.voided || reinstatedVoidedOrderKeys.has(`${leg.accountId}:${leg.orderId}`)
  );

  // First separate accounts and contracts. They must never share inventory.
  const instruments = new Map<string, ProjectXTradeLeg[]>();

  for (const leg of active) {
    const key = `${leg.accountId}:${leg.contractId}`;
    const list = instruments.get(key) || [];
    list.push(leg);
    instruments.set(key, list);
  }

  const positions: ReconstructedPosition[] = [];
  const openPositions: ReconstructionResult['openPositions'] = [];

  for (const legs of instruments.values()) {
    // If an instrument becomes inconsistent, keep positions completed before
    // the first warning but do not publish any later positions from that
    // instrument. A bad sequence must not contaminate subsequent trades.
    let instrumentHasWarnings = false;
    let safePositionCount = positions.length;
    const warn = (message: string) => {
      if (!instrumentHasWarnings) {
        instrumentHasWarnings = true;
        safePositionCount = positions.length;
      }
      warnings.push(message);
    };
    // Rebuild executions. Simulated accounts use orderId; live accounts
    // use fillId. Individual trade IDs are always preserved.
    const executions = new Map<string, ProjectXTradeLeg[]>();

    for (const leg of legs) {
      const executionId = leg.fillId != null
        ? `fill:${leg.fillId}`
        : `order:${leg.orderId}`;

      const list = executions.get(executionId) || [];
      list.push(leg);
      executions.set(executionId, list);
    }

    const orderedExecutions = [...executions.values()]
      .map(executionLegs => {
        executionLegs.sort((a, b) =>
          Date.parse(a.creationTimestamp) - Date.parse(b.creationTimestamp)
          || a.id - b.id
        );
        return executionLegs;
      })
      .sort((a, b) =>
        Date.parse(a[0].creationTimestamp) - Date.parse(b[0].creationTimestamp)
        || a[0].id - b[0].id
      );

    let netQuantity = 0;
    let current: WorkingPosition | null = null;

    const finishPosition = () => {
      if (!current || current.exitQty <= 0 || current.entryQty <= 0) {
        return;
      }

      positions.push({
        positionKey:
          `px:${current.accountId}:${current.contractId}:${current.firstTradeId}`,
        accountId: current.accountId,
        contractId: current.contractId,
        direction: current.direction,
        enterTime: current.enterTime,
        exitTime: current.exitTime,
        enterPrice: current.entryNotional / current.entryQty,
        exitPrice: current.exitNotional / current.exitQty,
        quantity: current.direction * current.maxExposure,
        grossPL: current.grossPL,
        fees: current.fees,
        commissions: current.commissions,
        netPL: current.grossPL - current.fees - current.commissions,
        tradeIds: [...current.tradeIds],
      });

      current = null;
    };

    for (const execution of orderedExecutions) {
      const sides = new Set(execution.map(leg => leg.side));

      if (sides.size !== 1) {
        warn(`Mixed sides in execution ${execution[0].orderId}; execution skipped`);
        continue;
      }

      const direction: 1 | -1 = execution[0].side === 0 ? 1 : -1;

      // ProjectX explicitly identifies closing legs through non-null P&L.
      // Process all closing legs before any reversal opening leg.
      const closingLegs = execution.filter(
        leg => leg.profitAndLoss !== null
      );
      const openingLegs = execution.filter(
        leg => leg.profitAndLoss === null
      );

      for (const leg of closingLegs) {
        if (
          !current
          || netQuantity === 0
          || Math.sign(netQuantity) === direction
        ) {
          warn(`Unmatched closing leg ${leg.id}; no opposite position exists`);
          continue;
        }

        if (leg.size > Math.abs(netQuantity)) {
          warn(`Closing leg ${leg.id} exceeds open quantity; expected API opening leg for reversal`);
          continue;
        }

        current.exitQty += leg.size;
        current.exitNotional += leg.size * leg.price;
        current.grossPL += leg.profitAndLoss ?? 0;
        current.fees += leg.fees ?? 0;
        current.commissions += leg.commissions ?? 0;
        current.exitTime = leg.creationTimestamp;
        current.tradeIds.push(leg.id);

        netQuantity += direction * leg.size;

        if (netQuantity === 0) {
          finishPosition();
        }
      }

      // Null-P&L legs are openings, including the residual opening leg
      // when an execution reverses an existing position.
      for (const leg of openingLegs) {
        if (
          netQuantity !== 0
          && Math.sign(netQuantity) !== direction
        ) {
          warn(`Opening leg ${leg.id} conflicts with remaining position`);
          continue;
        }

        if (!current) {
          current = {
            accountId: leg.accountId,
            contractId: leg.contractId,
            direction,
            firstTradeId: leg.id,
            enterTime: leg.creationTimestamp,
            exitTime: '',
            entryQty: 0,
            entryNotional: 0,
            exitQty: 0,
            exitNotional: 0,
            maxExposure: 0,
            grossPL: 0,
            fees: 0,
            commissions: 0,
            tradeIds: [],
          };
        }

        current.entryQty += leg.size;
        current.entryNotional += leg.size * leg.price;
        current.fees += leg.fees ?? 0;
        current.commissions += leg.commissions ?? 0;
        current.tradeIds.push(leg.id);

        netQuantity += direction * leg.size;
        current.maxExposure = Math.max(
          current.maxExposure,
          Math.abs(netQuantity)
        );
      }
    }

    if (instrumentHasWarnings) {
      positions.splice(safePositionCount);
    }

    // An open balance reconstructed after an inconsistency is not
    // trustworthy. Quarantine it just like later completed positions; the
    // broker's Position/searchOpen snapshot remains the authority for live
    // exposure.
    if (!instrumentHasWarnings && current && netQuantity !== 0) {
      openPositions.push({
        accountId: current.accountId,
        contractId: current.contractId,
        quantity: netQuantity,
        enterTime: current.enterTime,
      });
    }
  }

  return { positions, openPositions, warnings };
}
