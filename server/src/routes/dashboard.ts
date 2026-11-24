import { Hono } from 'hono';
import type { Env, AuthContext } from '../bindings';
import { requiresLogin } from '../middleware/auth';

type HonoEnv = {
  Bindings: Env;
  Variables: AuthContext;
};

const dashboard = new Hono<HonoEnv>();
const MAX_COLLECTION_BYTES = 1024 * 1024;
const MAX_DASHBOARDS = 50;

dashboard.get('/api/dashboards', requiresLogin, (c) => {
  const user = c.get('user');
  const db = c.get('db');
  const storageKey = c.req.query('key') || '';
  if (!/^[a-zA-Z0-9_.:-]{1,120}$/.test(storageKey)) return c.json({ error: 'A valid dashboard storage key is required.' }, 400);
  try {
    const row = db.prepare('SELECT collection_json, updated_at FROM dashboard_settings WHERE user_id = ? AND storage_key = ?').get(user.id, storageKey) as
      { collection_json: string; updated_at: string } | undefined;
    if (!row) return c.json({ collection: null, updatedAt: null });
    return c.json({ collection: JSON.parse(row.collection_json), updatedAt: row.updated_at });
  } catch (err) {
    console.error('Dashboard settings read error:', err);
    return c.json({ error: 'Could not load dashboard settings.' }, 500);
  }
});

dashboard.put('/api/dashboards', requiresLogin, async (c) => {
  const user = c.get('user');
  const db = c.get('db');
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'A valid dashboard collection is required.' }, 400);
  }

  const storageKey = body?.key;
  if (typeof storageKey !== 'string' || !/^[a-zA-Z0-9_.:-]{1,120}$/.test(storageKey)) {
    return c.json({ error: 'A valid dashboard storage key is required.' }, 400);
  }
  const collection = body?.collection;
  if (!collection || collection.version !== 1 || !Array.isArray(collection.items) ||
      collection.items.length < 1 || collection.items.length > MAX_DASHBOARDS ||
      typeof collection.activeDashboardId !== 'string') {
    return c.json({ error: 'The dashboard collection has an invalid structure.' }, 400);
  }

  const ids = new Set<string>();
  for (const item of collection.items) {
    if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id) ||
        typeof item.name !== 'string' || !item.name.trim() || item.name.length > 48 ||
        !item.layout || !Array.isArray(item.layout.order) || !Array.isArray(item.layout.hidden) ||
        !item.layout.sizes || typeof item.layout.sizes !== 'object' ||
        !item.layout.positions || typeof item.layout.positions !== 'object') {
      return c.json({ error: 'One or more dashboards contain invalid data.' }, 400);
    }
    ids.add(item.id);
  }
  if (!ids.has(collection.activeDashboardId)) {
    return c.json({ error: 'The active dashboard does not exist in this collection.' }, 400);
  }

  const serialized = JSON.stringify(collection);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_COLLECTION_BYTES) {
    return c.json({ error: 'The dashboard collection is too large to save.' }, 413);
  }

  try {
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO dashboard_settings (user_id, storage_key, collection_json, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, storage_key) DO UPDATE SET
        collection_json = excluded.collection_json,
        updated_at = excluded.updated_at`).run(user.id, storageKey, serialized, now);
    return c.json({ ok: true, updatedAt: now });
  } catch (err) {
    console.error('Dashboard settings save error:', err);
    return c.json({ error: 'Could not save dashboard settings.' }, 500);
  }
});

export default dashboard;
