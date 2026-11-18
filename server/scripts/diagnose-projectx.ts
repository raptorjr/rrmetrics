import fs from 'node:fs';
import { getDb } from '../src/db/connection';
import { getEnv, getSecretKey } from '../src/config';
import { decrypt } from '../src/utils/crypto';
import { ProjectXAPI } from '../src/services/ProjectXAPI';

async function main() {
  getSecretKey();
  const db = getDb();
  const env = getEnv();

  const connection = db.prepare(`
    SELECT bc.id, bc.label, bc.last_sync_time,
           pc.username, pc.api_key, pc.access_token,
           pc.token_expires_at, pc.selected_accounts
    FROM broker_connections bc
    JOIN projectx_connections pc
      ON pc.broker_connection_id = bc.id
    WHERE bc.broker = 'projectx'
    LIMIT 1
  `).get() as any;

  if (!connection) throw new Error('No ProjectX connection found');

  const api = new ProjectXAPI();
  let token = await decrypt(connection.access_token, env.ENCRYPTION_KEY);

  if (new Date(connection.token_expires_at) < new Date()) {
    const key = await decrypt(connection.api_key, env.ENCRYPTION_KEY);
    token = await api.authenticate(connection.username, key);
  }

  const accounts = await api.getAccounts(token);
  const selected = JSON.parse(connection.selected_accounts || '[]');
  const accountsToFetch = accounts.filter(a => selected.includes(a.id));

  if (!accountsToFetch.length) {
    throw new Error('No selected ProjectX accounts found');
  }

  const start = '2026-11-01T00:00:00.000Z';
  const end = new Date().toISOString();
  const results: any[] = [];

  for (const account of accountsToFetch) {
    const trades = await api.searchTrades(token, account.id, start, end);
    results.push({
      accountId: account.id,
      accountName: account.name,
      trades
    });

    console.log(
      `${account.name}: ${trades.length} execution legs, ` +
      `${trades.filter((t: any) => !t.voided).length} active`
    );
  }

  const output = {
    generatedAt: new Date().toISOString(),
    start,
    end,
    accounts: results
  };

  fs.writeFileSync(
    '/app/data/projectx-diagnostic.json',
    JSON.stringify(output, null, 2)
  );

  console.log('Diagnostic export created.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
