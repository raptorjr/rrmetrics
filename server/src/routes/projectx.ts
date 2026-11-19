import { Hono } from 'hono';
import type { Env, AuthContext } from '../bindings';
import * as brokerDb from '../db/broker-connections';
import * as pxConnDb from '../db/projectx-connections';
import * as tradesDb from '../db/trades';
import { encrypt, decrypt } from '../utils/crypto';
import { ProjectXAPI } from '../services/ProjectXAPI';
import { findFullyFilledVoidedOrderOverrides, mergeVoidedOrderOverrides, reconstructProjectXPositions } from '../services/ProjectXReconstruction';
import { clearProjectXImport, reconcileProjectXHistory } from '../services/ProjectXSync';
import { requiresLogin } from '../middleware/auth';
import { getDb } from '../db/connection';

type HonoEnv = {
  Bindings: Env;
  Variables: AuthContext;
};

const projectx = new Hono<HonoEnv>();
const activeSyncs = new Set<string>();

/**
 * POST /api/projectx/connect
 * Authenticate with ProjectX, create broker_connection + projectx_connection,
 * store encrypted credentials.
 */
projectx.post(
  '/api/projectx/connect',
  requiresLogin,
  async (c) => {
    const user = c.get('user');
    const body = await c.req.json();
    const { username, apiKey } = body as { username?: string; apiKey?: string };

    if (!username || !apiKey) {
      return c.json({ error: 'Username and API key are required' }, 400);
    }

    const serviceClient = getDb();

    const limit = Infinity;

    try {
      const api = new ProjectXAPI();
      const token = await api.authenticate(username, apiKey);

      // Fetch accounts to return to client
      const accounts = await api.getAccounts(token);

      // Create parent broker_connection with limit check (returns UUID string)
      const connectionId = await brokerDb.createWithLimitCheck(
        serviceClient,
        user.id,
        'projectx',
        'live', // ProjectX is always live
        `ProjectX — ${username}`,
        limit,
      );

      // Create child projectx_connection with encrypted credentials
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      await pxConnDb.create(serviceClient, connectionId, {
        username,
        api_key: await encrypt(apiKey, c.env.ENCRYPTION_KEY),
        access_token: await encrypt(token, c.env.ENCRYPTION_KEY),
        token_expires_at: expiresAt,
      });

      return c.json({ message: 'Connected successfully', accounts, connectionId });
    } catch (err: any) {
      console.error('ProjectX connect error:', err.message);
      return c.json({ error: `Failed to connect: ${err.message}` }, 400);
    }
  },
);

/**
 * GET /api/projectx/status
 * Returns all ProjectX connections for the user with their status,
 * plus overall connection usage and limits.
 */
projectx.get(
  '/api/projectx/status',
  requiresLogin,
  async (c) => {
    const user = c.get('user');
    const serviceClient = getDb();

    try {
      // Fetch all ProjectX connections for user
      const brokerConns = await brokerDb.findByOwnerAndBroker(serviceClient, user.id, 'projectx');

      // Total count across ALL brokers for limit tracking
      const totalCount = await brokerDb.countByOwner(serviceClient, user.id);


      // Build status for each connection
      const connections = [];
      for (const bc of brokerConns) {
        const pxConn = await pxConnDb.findByBrokerConnectionId(serviceClient, bc.id);
        const hasToken = !!pxConn?.access_token;

        let tokenExpired = false;
        if (hasToken && pxConn?.token_expires_at) {
          tokenExpired = new Date(pxConn.token_expires_at) < new Date();
        }

        let accounts: any[] = [];
        const configured = hasToken && !tokenExpired;

        // If connected (or expired but has credentials), try to fetch accounts
        if (hasToken && pxConn) {
          try {
            const api = new ProjectXAPI();
            let token = await decrypt(pxConn.access_token!, c.env.ENCRYPTION_KEY);

            // Re-auth if expired and we have stored credentials
            if (tokenExpired && pxConn.username && pxConn.api_key) {
              const apiKey = await decrypt(pxConn.api_key, c.env.ENCRYPTION_KEY);
              token = await api.authenticate(pxConn.username, apiKey);
              const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
              await pxConnDb.updateByBrokerConnectionId(serviceClient, bc.id, {
                access_token: await encrypt(token, c.env.ENCRYPTION_KEY),
                token_expires_at: expiresAt,
              });
              tokenExpired = false;
            }

            accounts = await api.getAccounts(token);
          } catch {
            // If fetching accounts fails, still return status
          }
        }

        connections.push({
          connectionId: bc.id,
          environment: bc.environment,
          label: bc.label,
          configured: hasToken && !tokenExpired,
          legacyIsEval: bc.is_eval,
          expired: hasToken && tokenExpired,
          selectedAccounts: pxConn?.selected_accounts || [],
          accountSettings: pxConn?.account_settings || {},
          lastFullSyncTime: pxConn?.last_full_sync_time || null,
          fullSyncEnabled: !!(pxConn as any)?.full_sync_enabled,
          setupCompleted: !!(pxConn as any)?.setup_completed,
          copytradeConfig: pxConn?.copytrade_config || null,
          lastSyncTime: bc.last_sync_time,
          autoSyncEnabled: pxConn?.auto_sync_enabled || false,
          autoSyncIntervalMinutes: pxConn?.auto_sync_interval_minutes || 5,
          autoSyncNextAt: pxConn?.auto_sync_next_at || null,
          autoSyncStartedAt: pxConn?.auto_sync_started_at || null,
          autoSyncLastAttemptAt: pxConn?.auto_sync_last_attempt_at || null,
          autoSyncLastError: pxConn?.auto_sync_last_error || null,
          autoSyncLastResult: pxConn?.auto_sync_last_result || null,
          accounts,
        });
      }

      return c.json({
        connections,
        connectionsUsed: totalCount,
        connectionLimit: null,
        canUseBrokerSync: true,
      });
    } catch (err: any) {
      console.error('ProjectX status error:', err.message);
      return c.json({ error: 'Failed to get ProjectX status' }, 500);
    }
  },
);

/**
 * POST /api/projectx/accounts
 * Save selected accounts and copytrade configuration for a connection.
 */
projectx.post(
  '/api/projectx/accounts',
  requiresLogin,
  async (c) => {
    const user = c.get('user');
    const body = await c.req.json();
    const { connectionId, selectedAccounts, copytradeConfig, accountSettings } = body as {
      connectionId?: string;
      selectedAccounts?: number[];
      copytradeConfig?: { leadAccountId: number; multiplier: number } | null;
      accountSettings?: Record<string, { type: 'evaluation' | 'xfa' | 'live_funded' | 'other'; displayName: string; currencyCode?: string }>;
    };

    if (!connectionId) {
      return c.json({ error: 'Missing connectionId' }, 400);
    }

    if (!selectedAccounts || !Array.isArray(selectedAccounts) || selectedAccounts.length === 0) {
      return c.json({ error: 'Select at least one account' }, 400);
    }

    const supportedCurrencies = new Set(['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'CHF', 'JPY']);
    if (accountSettings && Object.values(accountSettings).some(setting => setting.currencyCode && !supportedCurrencies.has(setting.currencyCode.toUpperCase()))) {
      return c.json({ error: 'Unsupported account currency' }, 400);
    }

    // Validate copytrade config if provided
    if (copytradeConfig) {
      if (!selectedAccounts.includes(copytradeConfig.leadAccountId)) {
        return c.json({ error: 'Lead account must be one of the selected accounts' }, 400);
      }
      if (!copytradeConfig.multiplier || copytradeConfig.multiplier < 1) {
        return c.json({ error: 'Multiplier must be at least 1' }, 400);
      }
    }

    try {
      const serviceClient = getDb();

      // Verify connection ownership
      const brokerConn = await brokerDb.findById(serviceClient, connectionId);
      if (!brokerConn || brokerConn.owner !== user.id) {
        return c.json({ error: 'Connection not found' }, 404);
      }

      const existingPxConn = await pxConnDb.findByBrokerConnectionId(serviceClient, connectionId);
      if ((existingPxConn as any)?.setup_completed) return c.json({ error: 'Topstep setup is already completed. Reset the setup before changing imported accounts or their settings.' }, 409);
      // Preserve settings for historical accounts that are no longer returned
      // by ProjectX. The account settings are a durable local record, not a
      // mirror of the broker's current account list.
      const mergedAccountSettings = {
        ...(existingPxConn?.account_settings || {}),
        ...(accountSettings || {}),
      };

      await pxConnDb.updateByBrokerConnectionId(serviceClient, connectionId, {
        selected_accounts: selectedAccounts as any,
        ...(accountSettings ? { account_settings: mergedAccountSettings as any } : {}),
        copytrade_config: copytradeConfig as any,
        setup_completed: true,
        last_full_sync_time: null,
      });

      return c.json({ message: 'Account settings saved' });
    } catch (err: any) {
      console.error('ProjectX accounts save error:', err.message);
      return c.json({ error: 'Failed to save account settings' }, 500);
    }
  },
);

/**
 * POST /api/projectx/eval
 * Toggle the is_eval flag on a ProjectX broker connection.
 */
projectx.post(
  '/api/projectx/eval',
  requiresLogin,
  async (c) => {
    const user = c.get('user');
    const body = await c.req.json();
    const { connectionId, isEval } = body as {
      connectionId?: string;
      isEval?: boolean;
    };

    if (!connectionId || typeof isEval !== 'boolean') {
      return c.json({ error: 'Missing connectionId or isEval' }, 400);
    }

    const serviceClient = getDb();
    const connection = await brokerDb.findById(serviceClient, connectionId);
    if (!connection || connection.owner !== user.id) {
      return c.json({ error: 'Connection not found' }, 404);
    }

    await brokerDb.updateById(serviceClient, connectionId, { is_eval: isEval });

    return c.json({ message: `Eval ${isEval ? 'enabled' : 'disabled'}` });
  },
);

projectx.post('/api/projectx/full-sync-settings', requiresLogin, async (c) => {
  const user = c.get('user'); const body = await c.req.json();
  const { connectionId, enabled } = body as { connectionId?: string; enabled?: boolean };
  if (!connectionId || typeof enabled !== 'boolean') return c.json({ error: 'Missing connectionId or enabled' }, 400);
  const db = getDb(); const connection = await brokerDb.findById(db, connectionId);
  if (!connection || connection.owner !== user.id || connection.broker !== 'projectx') return c.json({ error: 'Topstep connection not found' }, 404);
  await pxConnDb.updateByBrokerConnectionId(db, connectionId, { full_sync_enabled: enabled } as any);
  return c.json({ message: enabled ? 'Weekly complete-history refresh enabled' : 'Weekly complete-history refresh disabled' });
});

projectx.post('/api/projectx/reset-setup', requiresLogin, async (c) => {
  const user = c.get('user'); const body = await c.req.json();
  const { connectionId } = body as { connectionId?: string };
  if (!connectionId) return c.json({ error: 'Missing connectionId' }, 400);
  const db = getDb(); const connection = await brokerDb.findById(db, connectionId);
  if (!connection || connection.owner !== user.id || connection.broker !== 'projectx') return c.json({ error: 'Topstep connection not found' }, 404);
  if (activeSyncs.has(connectionId)) return c.json({ error: 'Wait for the current sync to finish before resetting setup' }, 409);
  const cleared = clearProjectXImport(db, user.id, connectionId);
  await pxConnDb.updateByBrokerConnectionId(db, connectionId, {
    selected_accounts: [], account_settings: {}, copytrade_config: null,
    last_full_sync_time: null, reinstated_order_keys: [],
    setup_completed: false, full_sync_enabled: false,
  } as any);
  return c.json({ message: 'Topstep setup reset. Imported trade history was cleared.', ...cleared });
});

projectx.post('/api/projectx/auto-sync', requiresLogin, async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const { connectionId, enabled, intervalMinutes } = body as { connectionId?: string; enabled?: boolean; intervalMinutes?: number };
  if (!connectionId || typeof enabled !== 'boolean') return c.json({ error: 'Missing connectionId or enabled' }, 400);
  const interval = intervalMinutes ?? 5;
  if (![1, 5, 10, 15, 30].includes(interval)) return c.json({ error: 'Interval must be 1, 5, 10, 15, or 30 minutes' }, 400);
  const db = getDb();
  const connection = await brokerDb.findById(db, connectionId);
  if (!connection || connection.owner !== user.id || connection.broker !== 'projectx') return c.json({ error: 'Topstep connection not found' }, 404);
  const pxConn = await pxConnDb.findByBrokerConnectionId(db, connectionId);
  if (!pxConn?.access_token) return c.json({ error: 'Topstep is not connected' }, 400);
  const nextAt = enabled ? new Date(Date.now() + interval * 60_000).toISOString() : null;
  await pxConnDb.updateByBrokerConnectionId(db, connectionId, { auto_sync_enabled: enabled, auto_sync_interval_minutes: interval, auto_sync_next_at: nextAt, auto_sync_last_error: null });
  return c.json({ message: enabled ? 'Automatic sync enabled' : 'Automatic sync disabled', nextAt });
});

/**
 * POST /api/projectx/sync
 * Incremental Topstep sync with periodic full-history reconciliation. Initial sync
 * and weekly reconciliation fetch all history; normal syncs fetch a rolling 24h window.
 */
projectx.post(
  '/api/projectx/sync',
  requiresLogin,
  async (c) => {
    const user = c.get('user');
    const db = c.get('db');
    const body = await c.req.json();
    const { connectionId, fullHistory: forceFullHistory } = body as { connectionId?: string; fullHistory?: boolean };

    if (!connectionId) {
      return c.json({ error: 'Missing connectionId' }, 400);
    }

    if (activeSyncs.has(connectionId)) return c.json({ error: 'A sync is already running for this Topstep connection' }, 409);
    activeSyncs.add(connectionId);
    try {
      const serviceClient = getDb();
      const brokerConn = await brokerDb.findById(serviceClient, connectionId);
      if (!brokerConn || brokerConn.owner !== user.id) {
        return c.json({ error: 'Connection not found' }, 404);
      }

      const pxConn = await pxConnDb.findByBrokerConnectionId(serviceClient, connectionId);
      if (!pxConn?.access_token) {
        return c.json({ error: 'ProjectX not connected for this connection' }, 400);
      }

      const selectedAccounts: number[] = pxConn.selected_accounts || [];
      if (selectedAccounts.length === 0) {
        return c.json({ error: 'No accounts selected for sync' }, 400);
      }

      const api = new ProjectXAPI();
      let token: string;
      try {
        token = await decrypt(pxConn.access_token, c.env.ENCRYPTION_KEY);
        if (
          pxConn.token_expires_at &&
          new Date(pxConn.token_expires_at) < new Date()
        ) {
          if (!pxConn.username || !pxConn.api_key) {
            return c.json(
              { error: 'ProjectX session expired. Please reconnect your account.', expired: true },
              401,
            );
          }
          const apiKey = await decrypt(pxConn.api_key, c.env.ENCRYPTION_KEY);
          token = await api.authenticate(pxConn.username, apiKey);
          const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
          await pxConnDb.updateByBrokerConnectionId(serviceClient, connectionId, {
            access_token: await encrypt(token, c.env.ENCRYPTION_KEY),
            token_expires_at: expiresAt,
          });
        }
      } catch {
        return c.json(
          { error: 'ProjectX session expired. Please reconnect your account.', expired: true },
          401,
        );
      }

      // A copytrade connection imports the configured lead account and applies
      // the multiplier to reconstructed position size and P&L.
      const accountsToSync = pxConn.copytrade_config
        ? [pxConn.copytrade_config.leadAccountId]
        : selectedAccounts;
      const firstImport = !brokerConn.last_sync_time;
      const fullReconciliationDue = !!(pxConn as any).full_sync_enabled && (!pxConn.last_full_sync_time
        || Date.now() - Date.parse(pxConn.last_full_sync_time) >= 7 * 24 * 60 * 60 * 1000);
      const isFullHistory = forceFullHistory === true || firstImport || fullReconciliationDue;
      const historyStart = isFullHistory
        ? '2020-01-01T00:00:00Z'
        : new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const multiplier = pxConn.copytrade_config?.multiplier || 1;

      const accounts = await api.getAccounts(token);
      const accountNameMap = new Map<number, string>(
        accounts.map(account => [account.id, account.name]),
      );

      const allTrades: import('../services/ProjectXAPI').Trade[] = [];
      const allOrders: import('../services/ProjectXAPI').ProjectXOrder[] = [];
      const orderCheckErrors: string[] = [];
      const orderCheckSuccessfulAccountIds = new Set<number>();
      const brokerOpenPositions: Array<{
        accountId: number;
        accountName: string;
        contractId: string;
        type: number;
        size: number;
        averagePrice: number;
        creationTimestamp: string;
      }> = [];
      const positionCheckErrors: string[] = [];

      for (const accountId of accountsToSync) {
        // Normal syncs overlap the previous 24 hours to catch delayed fills and corrections.
        // Full history is reserved for the first sync, weekly reconciliation, or an explicit request.
        const history = await api.searchTrades(token, accountId, historyStart);
        allTrades.push(...history.map(trade => ({
          ...trade,
          commissions: trade.commissions ?? null,
          fillId: trade.fillId ?? null,
        })));

        // Orders are an independent cross-check. Only orders whose entire
        // trade-leg set is voided but whose filled quantity matches exactly
        // can qualify for the narrow simulated-history reconciliation.
        try {
          const orderHistory = await api.searchOrders(token, accountId, historyStart);
          allOrders.push(...orderHistory);
          orderCheckSuccessfulAccountIds.add(accountId);
        } catch (error: any) {
          // The normal trade import can still proceed safely without this
          // optional cross-check; anomalous voided legs remain quarantined.
          orderCheckErrors.push(`Account ${accountId}: ${error.message}`);
        }

        // Independently query the broker's live position snapshot. This helps
        // distinguish a reconstruction problem from a genuinely open position.
        try {
          const currentPositions = await api.searchOpenPositions(token, accountId);
          brokerOpenPositions.push(...currentPositions.map(position => ({
            ...position,
            accountName: accountNameMap.get(accountId) || `ProjectX ${accountId}`,
          })));
        } catch (error: any) {
          positionCheckErrors.push(`Account ${accountId}: ${error.message}`);
        }
      }

      // Rebuild from all locally stored legs, not just the incremental response.
      // This preserves complete position history while only downloading recent broker data.
      const storedLegRows = db.prepare('SELECT raw_json FROM projectx_trade_legs WHERE broker_connection_id = ?').all(connectionId) as Array<{ raw_json: string }>;
      const mergedTrades = new Map<string, import('../services/ProjectXAPI').Trade>();
      for (const row of storedLegRows) {
        const trade = JSON.parse(row.raw_json) as import('../services/ProjectXAPI').Trade;
        if (accountsToSync.includes(trade.accountId)) mergedTrades.set(`${trade.accountId}:${trade.id}`, trade);
      }
      for (const trade of allTrades) mergedTrades.set(`${trade.accountId}:${trade.id}`, trade);

      const freshOrderOverrides = findFullyFilledVoidedOrderOverrides([...mergedTrades.values()], allOrders);
      // Refresh override evidence only for accounts whose Orders history was
      // successfully queried. A full sync still covers only selected accounts;
      // deselected historical accounts must retain their previously verified
      // overrides because their raw executions remain part of reconstruction.
      // An incremental Orders query covers only the recent window. Its
      // missing historical orders must not revoke previously verified
      // overrides. Only a full-history query can replace account-wide evidence.
      const fullyRefreshedOrderAccountIds = isFullHistory
        ? orderCheckSuccessfulAccountIds
        : new Set<number>();
      const reinstatedOrderKeys = mergeVoidedOrderOverrides(
        pxConn.reinstated_order_keys || [],
        freshOrderOverrides,
        fullyRefreshedOrderAccountIds,
      );

      const contractNames: Record<string, string> = {};
      const recentContractIds = new Set(allTrades.map(trade => trade.contractId));
      const contractIds = [...new Set([...mergedTrades.values()].map(trade => trade.contractId))];
      await Promise.all(contractIds.map(async contractId => {
        if (!recentContractIds.has(contractId)) {
          contractNames[contractId] = contractId.split('.')[3] || contractId;
          return;
        }
        try {
          const contract = await api.searchContract(token, contractId);
          if (!contract) {
            contractNames[contractId] = contractId;
            return;
          }
          const name = contract.name || contractId;
          contractNames[contractId] = name.replace(/[A-Z]\d+$/i, '').toUpperCase() || name.toUpperCase();
        } catch {
          contractNames[contractId] = contractId;
        }
      }));

      const result = reconcileProjectXHistory(
        db,
        user.id,
        connectionId,
        allTrades,
        new Map([
          ...accounts.map(account => [account.id, pxConn.account_settings?.[String(account.id)]?.displayName?.trim() || account.name] as [number, string]),
          ...Object.entries(pxConn.account_settings || {})
            .filter(([, setting]) => !!setting.displayName?.trim())
            .map(([accountId, setting]) => [Number(accountId), setting.displayName.trim()] as [number, string]),
        ]),
        contractNames,
        multiplier,
        brokerConn.is_eval,
        accountsToSync,
        reinstatedOrderKeys,
        pxConn.account_settings || {},
      );

      const syncedAt = new Date().toISOString();
      await brokerDb.updateById(serviceClient, connectionId, { last_sync_time: syncedAt });
      const fullReconciliationCompleted = isFullHistory;
      await pxConnDb.updateByBrokerConnectionId(serviceClient, connectionId, {
        reinstated_order_keys: [...reinstatedOrderKeys],
        ...(fullReconciliationCompleted ? { last_full_sync_time: syncedAt } : {}),
      });

      const openPositionMismatch = positionCheckErrors.length === 0
        && brokerOpenPositions.length !== result.openPositions;
      const positionSummary = positionCheckErrors.length > 0
        ? ` Broker open-position check unavailable: ${positionCheckErrors.join('; ')}.`
        : openPositionMismatch
          ? ` IMPORTANT: ProjectX currently reports ${brokerOpenPositions.length} open position(s), but trade-history reconstruction reports ${result.openPositions}.`
          : ` ProjectX and trade-history reconstruction both report ${result.openPositions} open position(s).`;

      return c.json({
        message: `${isFullHistory ? 'Full-history reconciliation' : 'Incremental sync'}: ` + (result.warnings.length > 0
          ? `Partially imported ${result.positions} safe positions from ${result.rawLegs} execution legs. ${result.warnings.length} reconstruction warning(s); affected instrument history was held back.`
          : `Reconciled ${result.positions} positions from ${result.rawLegs} raw execution legs`)
          + (result.reinstatedVoidedOrders > 0
            ? ` Reconciled ${result.reinstatedVoidedOrders} fully filled order(s) whose trade legs were marked voided, based on the Orders API.`
            : '')
          + (orderCheckErrors.length > 0
            ? ` Order-history cross-check unavailable: ${orderCheckErrors.join('; ')}.`
            : '')
          + positionSummary,
        partial: result.warnings.length > 0,
        synced: result.positions,
        newTradesImported: result.newTradesImported,
        rawLegs: result.rawLegs,
        openPositions: result.openPositions,
        brokerOpenPositions: brokerOpenPositions.length,
        brokerOpenPositionDetails: brokerOpenPositions,
        openPositionMismatch,
        positionCheckErrors,
        warnings: result.warnings,
        syncMode: isFullHistory ? 'full' : 'incremental',
        historyStart,
        fullReconciliationCompleted,
        lastFullSyncTime: fullReconciliationCompleted ? syncedAt : pxConn.last_full_sync_time,
        nextFullReconciliationDue: fullReconciliationCompleted
          ? new Date(Date.parse(syncedAt) + 7 * 24 * 60 * 60 * 1000).toISOString()
          : pxConn.last_full_sync_time
            ? new Date(Date.parse(pxConn.last_full_sync_time) + 7 * 24 * 60 * 60 * 1000).toISOString()
            : null,
      });
    } catch (err: any) {
      console.error('ProjectX sync error:', err.message);
      return c.json({ error: `Sync failed: ${err.message}` }, 500);
    } finally {
      activeSyncs.delete(connectionId);
    }
  },
);

/**
 * Read-only diagnostics for stored Topstep execution history.
 * Does not call the broker API or modify imported data.
 */
projectx.get('/api/projectx/reconstruction-diagnostics/:connectionId', requiresLogin, async (c) => {
  const user = c.get('user');
  const connectionId = c.req.param('connectionId');
  const db = getDb();
  const connection = await brokerDb.findById(db, connectionId);
  if (!connection || connection.owner !== user.id || connection.broker !== 'projectx') {
    return c.json({ error: 'Topstep connection not found' }, 404);
  }

  try {
    const pxConn = await pxConnDb.findByBrokerConnectionId(db, connectionId);
    const rows = db.prepare(`
      SELECT account_id, trade_id, contract_id, creation_timestamp, raw_json
      FROM projectx_trade_legs
      WHERE broker_connection_id = ?
      ORDER BY account_id, contract_id, creation_timestamp, trade_id
    `).all(connectionId) as Array<{ account_id: number; trade_id: number; contract_id: string; creation_timestamp: string; raw_json: string }>;
    const legs = rows.map(row => JSON.parse(row.raw_json) as import('../services/ProjectXReconstruction').ProjectXTradeLeg);
    const reconstruction = reconstructProjectXPositions(legs, new Set(pxConn?.reinstated_order_keys || []));
    const legsById = new Map<number, typeof legs[number][]>();
    const legsByOrder = new Map<number, typeof legs[number][]>();
    for (const leg of legs) {
      legsById.set(leg.id, [...(legsById.get(leg.id) || []), leg]);
      legsByOrder.set(leg.orderId, [...(legsByOrder.get(leg.orderId) || []), leg]);
    }

    const groups = new Map<string, { accountId: number; contractId: string; type: string; count: number; examples: Array<{ warning: string; relatedLegs: Array<{ id: number; orderId: number; fillId: number | null; side: number; size: number; price: number; profitAndLoss: number | null; voided: boolean; time: string }> }> }>();
    for (const warning of reconstruction.warnings) {
      const legId = Number(warning.match(/leg (\d+)/i)?.[1]);
      const executionOrderId = Number(warning.match(/execution (\d+)/i)?.[1]);
      let related = Number.isFinite(legId) ? (legsById.get(legId) || []) : [];
      if (!related.length && Number.isFinite(executionOrderId)) related = legsByOrder.get(executionOrderId) || [];
      const leg = related[0];
      const accountId = leg?.accountId ?? 0;
      const contractId = leg?.contractId ?? 'unknown';
      const type = warning.startsWith('Unmatched closing') ? 'Unmatched closing leg'
        : warning.startsWith('Closing leg exceeds') ? 'Closing quantity exceeds open quantity'
        : warning.startsWith('Opening leg conflicts') ? 'Opening direction conflicts'
        : warning.startsWith('Mixed sides') ? 'Mixed sides in execution' : 'Other';
      const key = `${accountId}:${contractId}:${type}`;
      const group = groups.get(key) || { accountId, contractId, type, count: 0, examples: [] };
      group.count += 1;
      if (group.examples.length < 5) {
        const sample = related.length ? related : [];
        group.examples.push({
          warning,
          relatedLegs: sample.slice(0, 8).map(item => ({
            id: item.id, orderId: item.orderId, fillId: item.fillId, side: item.side,
            size: item.size, price: item.price, profitAndLoss: item.profitAndLoss,
            voided: item.voided, time: item.creationTimestamp,
          })),
        });
      }
      groups.set(key, group);
    }

    const accountSummary = new Map<number, { accountId: number; name: string; rawLegs: number; contracts: Set<string> }>();
    for (const leg of legs) {
      const entry = accountSummary.get(leg.accountId) || {
        accountId: leg.accountId,
        name: pxConn?.account_settings?.[String(leg.accountId)]?.displayName || `Topstep ${leg.accountId}`,
        rawLegs: 0,
        contracts: new Set<string>(),
      };
      entry.rawLegs += 1;
      entry.contracts.add(leg.contractId);
      accountSummary.set(leg.accountId, entry);
    }

    return c.json({
      readOnly: true,
      generatedAt: new Date().toISOString(),
      totalRawLegs: legs.length,
      uniqueAccounts: accountSummary.size,
      uniqueContracts: new Set(legs.map(leg => `${leg.accountId}:${leg.contractId}`)).size,
      reconstructedPositions: reconstruction.positions.length,
      openPositions: reconstruction.openPositions.length,
      warningCount: reconstruction.warnings.length,
      unsafeInstrumentCount: reconstruction.unsafeInstrumentKeys.length,
      accounts: [...accountSummary.values()].map(item => ({ ...item, contracts: item.contracts.size })),
      warningGroups: [...groups.values()].sort((a, b) => b.count - a.count),
      unsafeInstrumentKeys: reconstruction.unsafeInstrumentKeys,
    });
  } catch (error: any) {
    console.error('Topstep reconstruction diagnostics failed:', error);
    return c.json({ error: 'Could not analyse stored Topstep execution history' }, 500);
  }
});

/**
 * POST /api/projectx/clear
 * Remove this connection's imported ProjectX trades and raw execution history,
 * while preserving the connection credentials and selected account settings.
 */
projectx.post('/api/projectx/clear', requiresLogin, async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const { connectionId } = body as { connectionId?: string };

  if (!connectionId) {
    return c.json({ error: 'Missing connectionId' }, 400);
  }

  const db = getDb();
  const connection = await brokerDb.findById(db, connectionId);
  if (!connection || connection.owner !== user.id || connection.broker !== 'projectx') {
    return c.json({ error: 'ProjectX connection not found' }, 404);
  }

  try {
    const result = clearProjectXImport(db, user.id, connectionId);
    await pxConnDb.updateByBrokerConnectionId(db, connectionId, { last_full_sync_time: null, reinstated_order_keys: [] });
    return c.json({
      message: 'ProjectX imported data cleared. Your connection and account settings are unchanged.',
      deletedPositions: result.deletedPositions,
      deletedRawLegs: result.deletedRawLegs,
    });
  } catch (err: any) {
    console.error('ProjectX clear error:', err.message);
    return c.json({ error: 'Failed to clear ProjectX imported data' }, 500);
  }
});

/**
 * DELETE /api/projectx/connections/:connectionId
 * Deletes a broker connection and its child projectx_connection (cascade).
 */
projectx.delete('/api/projectx/connections/:connectionId', requiresLogin, async (c) => {
  const user = c.get('user');
  const connectionId = c.req.param('connectionId');
  const serviceClient = getDb();

  try {
    await brokerDb.deleteById(serviceClient, connectionId, user.id);
    return c.json({ message: 'Connection deleted' });
  } catch (err: any) {
    return c.json({ error: `Failed to delete connection: ${err.message}` }, 500);
  }
});

export default projectx;
