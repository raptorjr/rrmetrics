import 'dotenv/config';
import { serve } from '@hono/node-server';
import app from './index';
import { ensureDataDirs, getEnv, getPort, getSecretKey } from './config';
import { getDb, initDb } from './db/connection';
import { ensureLocalUser } from './db/profiles';
import { refreshExpiringBrokerTokens } from './scheduled/broker-refresh';
import * as pxConnDb from './db/projectx-connections';

const BROKER_REFRESH_INTERVAL_MS = 60 * 60 * 1000; // hourly
const PROJECTX_AUTO_SYNC_POLL_INTERVAL_MS = 30 * 1000;
const autoSyncInProgress = new Set<string>();

const runBrokerRefresh = (env: ReturnType<typeof getEnv>) => {
  refreshExpiringBrokerTokens(env).catch((err) => {
    console.error('[Broker Cron] refresh run failed:', err);
  });
};

const main = async () => {
  // Bootstrap: data dirs, server secret, database schema, local user
  ensureDataDirs();
  getSecretKey();
  initDb();
  await ensureLocalUser(getDb());

  const env = getEnv();
  const port = getPort();

  serve({
    fetch: (request) => app.fetch(request, env),
    port,
  });

  console.log(`RR Metrics server listening on http://localhost:${port}`);

  // Hourly broker token refresh (replaces the Workers scheduled() cron)
  runBrokerRefresh(env);
  setInterval(() => runBrokerRefresh(env), BROKER_REFRESH_INTERVAL_MS);

  const runAutoSync = async () => {
    const db = getDb();
    const connections = await pxConnDb.findAutoSyncEnabled(db);
    for (const connection of connections) {
      const id = connection.broker_connection_id;
      if (autoSyncInProgress.has(id)) continue;
      if (connection.auto_sync_next_at && new Date(connection.auto_sync_next_at).getTime() > Date.now()) continue;
      autoSyncInProgress.add(id);
      const attemptedAt = new Date().toISOString();
      try {
        const response = await app.fetch(new Request('http://localhost/api/projectx/sync', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ connectionId: id }),
        }), env);
        const result = await response.json() as Record<string, any>;
        await pxConnDb.updateByBrokerConnectionId(db, id, {
          auto_sync_last_attempt_at: attemptedAt,
          auto_sync_next_at: new Date(Date.now() + (connection.auto_sync_interval_minutes || 5) * 60_000).toISOString(),
          auto_sync_last_error: response.ok ? null : (result.error || `Sync failed (HTTP ${response.status})`),
          auto_sync_last_result: result,
        });
      } catch (error: any) {
        await pxConnDb.updateByBrokerConnectionId(db, id, {
          auto_sync_last_attempt_at: attemptedAt, auto_sync_next_at: new Date(Date.now() + (connection.auto_sync_interval_minutes || 5) * 60_000).toISOString(),
          auto_sync_last_error: error?.message || String(error),
          auto_sync_last_result: { error: error?.message || String(error) },
        });
      } finally {
        autoSyncInProgress.delete(id);
      }
    }
  };
  const pollAutoSync = () => runAutoSync().catch(err => console.error('[Topstep Auto Sync] scheduler run failed:', err));
  pollAutoSync();
  setInterval(pollAutoSync, PROJECTX_AUTO_SYNC_POLL_INTERVAL_MS);
};

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
