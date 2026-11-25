import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import type { Env, AuthContext } from '../bindings';
import backtesting from '../routes/backtesting';
import { readReplayChartSettings, validateReplayChartSettings } from '../db/replay-chart-settings';

test('replay chart preferences persist per profile, validate requests and survive schema initialization', async () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON');
    const schema = fs.readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf8');
    db.exec(schema);
    const insert = db.prepare('INSERT INTO profiles (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)');
    insert.run('desktop-profile', 'desktop@example.test', '', '2026-01-01');
    insert.run('other-profile', 'other@example.test', '', '2026-01-01');
    const app = (id: string) => {
      const a = new Hono<{ Bindings: Env; Variables: AuthContext }>();
      a.use('*', async (c, next) => { c.set('db', db); c.set('user', { id, email: id + '@example.test' }); await next(); });
      a.route('/', backtesting);
      return a;
    };
    const desktop = app('desktop-profile'), laptop = app('desktop-profile'), other = app('other-profile');
    const url = '/api/backtesting/chart-settings';
    const put = (a: typeof desktop, body: unknown) => a.request(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.deepEqual(await (await laptop.request(url)).json(), { settings: null });
    const saved = await put(desktop, { version: 1, labelUnits: ['ticks', 'currency'], userId: 'other-profile' });
    assert.equal(saved.status, 200);
    assert.deepEqual(await (await laptop.request(url)).json(), { settings: { version: 1, labelUnits: ['currency', 'ticks'] } });
    assert.equal(readReplayChartSettings(db, 'other-profile'), null);
    assert.equal((await put(other, { version: 1, labelUnits: ['points'] })).status, 200);
    for (const invalid of [null, { version: 2, labelUnits: ['ticks'] }, { version: 1, labelUnits: [] }, { version: 1, labelUnits: ['bad'] }, { version: 1, labelUnits: ['ticks','ticks'] }]) {
      assert.equal(validateReplayChartSettings(invalid), null);
      assert.equal((await put(desktop, invalid)).status, 400);
    }
    db.exec(schema);
    assert.deepEqual(readReplayChartSettings(db, 'desktop-profile'), { version: 1, labelUnits: ['currency', 'ticks'] });
    assert.deepEqual(readReplayChartSettings(db, 'other-profile'), { version: 1, labelUnits: ['points'] });
  } finally { db.close(); }
});
