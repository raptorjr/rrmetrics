import { Hono } from 'hono';
import type { Env, AuthContext } from '../bindings';
import * as brokerDb from '../db/broker-connections';
import * as pxConnDb from '../db/projectx-connections';
import * as tradesDb from '../db/trades';
import { encrypt, decrypt } from '../utils/crypto';
import { ProjectXAPI } from '../services/ProjectXAPI';
import { reconcileProjectXHistory } from '../services/ProjectXSync';
import { requiresLogin } from '../middleware/auth';
import { getDb } from '../db/connection';

type HonoEnv = {
  Bindings: Env;
  Variables: AuthContext;
};

const projectx = new Hono<HonoEnv>();

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
          isEval: bc.is_eval,
          configured: hasToken && !tokenExpired,
          expired: hasToken && tokenExpired,
          selectedAccounts: pxConn?.selected_accounts || [],
          copytradeConfig: pxConn?.copytrade_config || null,
          lastSyncTime: bc.last_sync_time,
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
    const { connectionId, selectedAccounts, copytradeConfig } = body as {
      connectionId?: string;
      selectedAccounts?: number[];
      copytradeConfig?: { leadAccountId: number; multiplier: number } | null;
    };

    if (!connectionId) {
      return c.json({ error: 'Missing connectionId' }, 400);
    }

    if (!selectedAccounts || !Array.isArray(selectedAccounts) || selectedAccounts.length === 0) {
      return c.json({ error: 'Select at least one account' }, 400);
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

      await pxConnDb.updateByBrokerConnectionId(serviceClient, connectionId, {
        selected_accounts: selectedAccounts as any,
        copytrade_config: copytradeConfig as any,
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

/**
 * POST /api/projectx/sync
 * Full-history reconciliation from ProjectX. The broker can correct or void
 * older records, so the sync deliberately re-fetches selected account history.
 */
projectx.post(
  '/api/projectx/sync',
  requiresLogin,
  async (c) => {
    const user = c.get('user');
    const db = c.get('db');
    const body = await c.req.json();
    const { connectionId } = body as { connectionId?: string };

    if (!connectionId) {
      return c.json({ error: 'Missing connectionId' }, 400);
    }

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
      const multiplier = pxConn.copytrade_config?.multiplier || 1;

      const accounts = await api.getAccounts(token);
      const accountNameMap = new Map<number, string>(
        accounts.map(account => [account.id, account.name]),
      );

      const allTrades: import('../services/ProjectXAPI').Trade[] = [];
      for (const accountId of accountsToSync) {
        // Full history is intentional: ProjectX can revise or void old trade IDs.
        const history = await api.searchTrades(token, accountId, '2020-01-01T00:00:00Z');
        allTrades.push(...history.map(trade => ({
          ...trade,
          commissions: trade.commissions ?? null,
          fillId: trade.fillId ?? null,
        })));
      }

      const contractNames: Record<string, string> = {};
      const contractIds = [...new Set(allTrades.map(trade => trade.contractId))];
      await Promise.all(contractIds.map(async contractId => {
        try {
          const contract = await api.searchContract(token, contractId);
          if (!contract) {
            contractNames[contractId] = contractId;
            return;
          }
          const name = contract.name || contractId;
          contractNames[contractId] = name.replace(/[A-Z]\\d+$/i, '').toUpperCase() || name.toUpperCase();
        } catch {
          contractNames[contractId] = contractId;
        }
      }));

      const result = reconcileProjectXHistory(
        db,
        user.id,
        connectionId,
        allTrades,
        accountNameMap,
        contractNames,
        multiplier,
        brokerConn.is_eval,
      );

      await brokerDb.updateById(serviceClient, connectionId, {
        last_sync_time: new Date().toISOString(),
      });

      return c.json({
        message: `Reconciled ${result.positions} positions from ${result.rawLegs} raw execution legs`,
        synced: result.positions,
        rawLegs: result.rawLegs,
        openPositions: result.openPositions,
        warnings: result.warnings,
      });
    } catch (err: any) {
      console.error('ProjectX sync error:', err.message);
      return c.json({ error: `Sync failed: ${err.message}` }, 500);
    }
  },
);

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
