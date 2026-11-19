import { Hono } from 'hono';
import type { Env, AuthContext } from '../bindings';
import * as profilesDb from '../db/profiles';
import { requiresLogin } from '../middleware/auth';

type HonoEnv = {
  Bindings: Env;
  Variables: AuthContext;
};

const account = new Hono<HonoEnv>();

// GET /api/account
account.get('/api/account', requiresLogin, async (c) => {
  const profile = c.get('profile');
  return c.json({ account: profilesDb.toAPI(profile) });
});

// POST /api/preferences/theme
account.post('/api/preferences/theme', requiresLogin, async (c) => {
  const profile = c.get('profile');
  const db = c.get('db');
  const body = await c.req.json();
  let { theme, customColors } = body;

  if (!theme || !['dark', 'light', 'custom'].includes(theme)) {
    return c.json({ error: 'Invalid theme.' }, 400);
  }

  try {
    const updateData: Record<string, unknown> = { theme };
    const validHex = /^#[0-9A-Fa-f]{6}$/;

    if (customColors) {
      if (customColors.accent === null) {
        updateData.customColorsAccent = null;
      } else if (customColors.accent && validHex.test(customColors.accent)) {
        updateData.customColorsAccent = customColors.accent;
      }

      if (theme === 'custom') {
        const customFields: Array<[string, string]> = [
          ['bgPage', 'customColorsBgPage'],
          ['bgSurface', 'customColorsBgSurface'],
          ['textPrimary', 'customColorsTextPrimary'],
          ['positive', 'customColorsPositive'],
          ['negative', 'customColorsNegative'],
        ];
        for (const [clientKey, dbKey] of customFields) {
          if (customColors[clientKey] === null) {
            updateData[dbKey] = null;
          } else if (customColors[clientKey] && validHex.test(customColors[clientKey])) {
            updateData[dbKey] = customColors[clientKey];
          }
        }
      }
    }

    await profilesDb.updateById(db, profile.id, updateData);

    const updatedProfile = await profilesDb.findById(db, profile.id);
    if (updatedProfile) {
      return c.json({
        theme: updatedProfile.theme,
        customColors: {
          bgPage: updatedProfile.custom_colors_bg_page,
          bgSurface: updatedProfile.custom_colors_bg_surface,
          textPrimary: updatedProfile.custom_colors_text_primary,
          accent: updatedProfile.custom_colors_accent,
          positive: updatedProfile.custom_colors_positive,
          negative: updatedProfile.custom_colors_negative,
        },
      });
    }

    return c.json({ theme });
  } catch (err) {
    console.error('Theme update error:', err);
    return c.json({ error: 'Failed to update theme.' }, 500);
  }
});

// POST /api/account/complete-registration — records the IP at signup time (fraud flagging only)
// Only writes once; subsequent calls are no-ops so this can be called safely at any time.
account.post('/api/account/complete-registration', requiresLogin, async (c) => {
  const profile = c.get('profile');
  const db = c.get('db');

  if (profile.registration_ip) {
    return c.json({ ok: true });
  }

  const ip = c.req.header('CF-Connecting-IP')
    ?? c.req.header('X-Forwarded-For')?.split(',')[0].trim()
    ?? null;

  if (ip) {
    try {
      await profilesDb.updateById(db, profile.id, { registrationIp: ip });
    } catch (err) {
      console.error('complete-registration IP capture error:', err);
    }
  }

  return c.json({ ok: true });
});

// POST /api/account/onboarding-complete
account.post('/api/account/onboarding-complete', requiresLogin, async (c) => {
  const profile = c.get('profile');
  const db = c.get('db');
  try {
    await profilesDb.updateById(db, profile.id, { onboardingCompleted: true });
    return c.json({ ok: true });
  } catch (err: any) {
    return c.json({ error: 'Failed to mark onboarding complete' }, 500);
  }
});


account.get('/api/account/managed-accounts', requiresLogin, async (c) => {
  const user = c.get('user');
  const db = c.get('db');
  try {
    const accounts: any[] = [];
    const tz = db.prepare(`SELECT source_account_name, display_name, currency_code, is_eval, match_account
      FROM tradezella_accounts WHERE user_id = ? ORDER BY source_account_name`).all(user.id) as any[];
    for (const row of tz) {
      const counts = db.prepare(`SELECT
        COUNT(DISTINCT CASE WHEN t.tradovate_source = 'tradezella' THEN t.id END) AS imported,
        COUNT(DISTINCT CASE WHEN t.tradovate_source != 'tradezella' THEN t.id END) AS linked
        FROM tradezella_imported_trades m LEFT JOIN trades t ON t.id = m.trade_id
        WHERE m.user_id = ? AND m.source_account_name = ?`).get(user.id, row.source_account_name) as any;
      accounts.push({ id: `tradezella::${row.source_account_name}`, provider: 'TradeZella',
        kind: 'tradezella', name: row.display_name || row.source_account_name,
        sourceName: row.source_account_name, currencyCode: row.currency_code || 'USD',
        accountType: row.is_eval ? 'evaluation' : 'other',
        importedTrades: Number(counts?.imported || 0), linkedTrades: Number(counts?.linked || 0) });
    }

    const pxRows = db.prepare(`SELECT bc.id AS connection_id, pc.account_settings, pc.selected_accounts
      FROM broker_connections bc JOIN projectx_connections pc ON pc.broker_connection_id = bc.id
      WHERE bc.owner = ? AND bc.broker = 'projectx'`).all(user.id) as any[];
    for (const conn of pxRows) {
      let settings: Record<string, any> = {};
      let selected: number[] = [];
      try { settings = conn.account_settings ? JSON.parse(conn.account_settings) : {}; } catch {}
      try { selected = conn.selected_accounts ? JSON.parse(conn.selected_accounts) : []; } catch {}
      const rawIds = db.prepare('SELECT DISTINCT account_id FROM projectx_trade_legs WHERE broker_connection_id = ?').all(conn.connection_id) as any[];
      const ids = new Set([...Object.keys(settings), ...selected.map(String), ...rawIds.map(x => String(x.account_id))]);
      for (const accountId of ids) {
        const prefix = `px:${conn.connection_id}:px:${accountId}:`;
        const tradeRows = db.prepare(`SELECT DISTINCT account FROM trades WHERE user_id = ?
          AND broker_connection_id = ? AND projectx_source = 'projectx' AND projectx_trade_id LIKE ?`)
          .all(user.id, conn.connection_id, `${prefix}%`) as any[];
        const setting = settings[accountId] || {};
        const name = setting.displayName?.trim() || tradeRows[0]?.account || `Topstep account ${accountId}`;
        const count = db.prepare(`SELECT COUNT(*) AS count FROM trades WHERE user_id = ?
          AND broker_connection_id = ? AND projectx_source = 'projectx' AND projectx_trade_id LIKE ?`)
          .get(user.id, conn.connection_id, `${prefix}%`) as any;
        const raw = db.prepare('SELECT COUNT(*) AS count FROM projectx_trade_legs WHERE broker_connection_id = ? AND account_id = ?')
          .get(conn.connection_id, Number(accountId)) as any;
        accounts.push({ id: `projectx::${conn.connection_id}::${accountId}`, provider: 'Topstep',
          kind: 'projectx', connectionId: conn.connection_id, accountId: Number(accountId),
          name, sourceName: String(accountId), currencyCode: setting.currencyCode || 'USD',
          accountType: setting.type || 'other', importedTrades: Number(count?.count || 0),
          rawExecutions: Number(raw?.count || 0) });
      }
    }

    // Discover newly seen accounts once, then retain their identities even if
    // their trades are cleared or the broker no longer reports them.
    const others = db.prepare(`SELECT t.broker_connection_id AS connection_id, t.account, bc.broker
      FROM trades t LEFT JOIN broker_connections bc ON bc.id = t.broker_connection_id
      WHERE t.user_id = ? AND t.broker_connection_id IS NOT NULL
      AND (t.projectx_source IS NULL OR t.projectx_source != 'projectx')
      AND t.account IS NOT NULL AND t.account != ''
      GROUP BY t.broker_connection_id, t.account, bc.broker`).all(user.id) as any[];
    const remember = db.prepare(`INSERT OR IGNORE INTO managed_accounts
      (id, user_id, provider, source_key, connection_id, source_account_id, source_name, display_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const row of others) remember.run(
      `broker::${row.connection_id}::${row.account}`, user.id, row.broker || 'Broker',
      `${row.connection_id}::${row.account}`, row.connection_id, row.account, row.account, row.account,
    );
    const durableOthers = db.prepare(`SELECT a.*, COUNT(t.id) AS trade_count
      FROM managed_accounts a LEFT JOIN trades t ON t.user_id = a.user_id
        AND t.broker_connection_id = a.connection_id AND t.account = a.source_account_id
      WHERE a.user_id = ? GROUP BY a.id ORDER BY a.provider, a.display_name`).all(user.id) as any[];
    for (const row of durableOthers) accounts.push({ id: row.id, provider: row.provider,
      kind: 'broker', connectionId: row.connection_id, name: row.display_name,
      sourceName: row.source_name, importedTrades: Number(row.trade_count || 0) });
    return c.json({ accounts });
  } catch (err: any) {
    console.error('Managed account inventory error:', err);
    return c.json({ error: 'Could not load managed accounts.' }, 500);
  }
});

account.post('/api/account/managed-accounts/action', requiresLogin, async (c) => {
  const user = c.get('user');
  const db = c.get('db');
  const body = await c.req.json();
  const { id, action } = body as { id?: string; action?: string };
  if (!id || !['clear', 'delete', 'rename'].includes(action || '')) return c.json({ error: 'A valid account and action are required.' }, 400);
  try {
    if (action === 'rename') {
      const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : '';
      if (!displayName || displayName.length > 100) return c.json({ error: 'A display name between 1 and 100 characters is required.' }, 400);
      if (id.startsWith('tradezella::')) {
        const sourceName = id.slice('tradezella::'.length);
        const changed = db.prepare('UPDATE tradezella_accounts SET display_name = ? WHERE user_id = ? AND source_account_name = ?').run(displayName, user.id, sourceName).changes;
        if (!changed) return c.json({ error: 'TradeZella account not found.' }, 404);
      } else if (id.startsWith('projectx::')) {
        const [, connectionId, accountId] = id.split('::');
        const row = db.prepare("SELECT pc.account_settings FROM projectx_connections pc JOIN broker_connections bc ON bc.id = pc.broker_connection_id WHERE pc.broker_connection_id = ? AND bc.owner = ? AND bc.broker = 'projectx'").get(connectionId, user.id) as any;
        if (!row) return c.json({ error: 'Topstep account not found.' }, 404);
        let settings: Record<string, any> = {};
        try { settings = row.account_settings ? JSON.parse(row.account_settings) : {}; } catch {}
        settings[accountId] = { ...(settings[accountId] || {}), displayName };
        const prefix = `px:${connectionId}:px:${accountId}:`;
        db.prepare("UPDATE trades SET account = ? WHERE user_id = ? AND broker_connection_id = ? AND projectx_source = 'projectx' AND projectx_trade_id LIKE ?")
          .run(displayName, user.id, connectionId, `${prefix}%`);
        db.prepare('UPDATE projectx_connections SET account_settings = ? WHERE broker_connection_id = ?').run(JSON.stringify(settings), connectionId);
      } else if (id.startsWith('broker::')) {
        const [, connectionId, oldName] = id.split('::');
        const owned = db.prepare('SELECT id FROM broker_connections WHERE id = ? AND owner = ?').get(connectionId, user.id);
        if (!owned) return c.json({ error: 'Broker account not found.' }, 404);
        const managed = db.prepare('SELECT display_name FROM managed_accounts WHERE id = ? AND user_id = ?').get(id, user.id) as any;
        db.prepare('UPDATE trades SET account = ? WHERE user_id = ? AND broker_connection_id = ? AND account = ?').run(displayName, user.id, connectionId, managed?.display_name || oldName);
        db.prepare('UPDATE managed_accounts SET display_name = ? WHERE id = ? AND user_id = ?').run(displayName, id, user.id);
      } else return c.json({ error: 'Unknown account type.' }, 400);
      return c.json({ ok: true, action: 'rename', displayName });
    }
    const result = db.transaction(() => {
      if (id.startsWith('tradezella::')) {
        const sourceName = id.slice('tradezella::'.length);
        const rows = db.prepare(`SELECT DISTINCT t.id FROM tradezella_imported_trades m
          JOIN trades t ON t.id = m.trade_id WHERE m.user_id = ? AND m.source_account_name = ?
          AND t.user_id = ? AND t.tradovate_source = 'tradezella'`).all(user.id, sourceName, user.id) as any[];
        for (const row of rows) db.prepare("DELETE FROM trades WHERE id = ? AND user_id = ? AND tradovate_source = 'tradezella'").run(row.id, user.id);
        db.prepare('DELETE FROM tradezella_imported_trades WHERE user_id = ? AND source_account_name = ?').run(user.id, sourceName);
        if (action === 'delete') db.prepare('DELETE FROM tradezella_accounts WHERE user_id = ? AND source_account_name = ?').run(user.id, sourceName);
        return { removedTrades: rows.length };
      }
      if (id.startsWith('projectx::')) {
        const [, connectionId, accountIdText] = id.split('::');
        const accountId = Number(accountIdText);
        const owned = db.prepare("SELECT id FROM broker_connections WHERE id = ? AND owner = ? AND broker = 'projectx'").get(connectionId, user.id);
        if (!owned || !Number.isSafeInteger(accountId)) throw new Error('Topstep account not found.');
        const prefix = `px:${connectionId}:px:${accountId}:`;
        const deleted = db.prepare(`DELETE FROM trades WHERE user_id = ? AND broker_connection_id = ?
          AND projectx_source = 'projectx' AND projectx_trade_id LIKE ?`).run(user.id, connectionId, `${prefix}%`).changes;
        const raw = db.prepare('DELETE FROM projectx_trade_legs WHERE broker_connection_id = ? AND account_id = ?').run(connectionId, accountId).changes;
        const px = db.prepare('SELECT account_settings, selected_accounts, reinstated_order_keys FROM projectx_connections WHERE broker_connection_id = ?').get(connectionId) as any;
        let settings: Record<string, any> = {}; let selected: number[] = []; let reinstated: string[] = [];
        try { settings = px?.account_settings ? JSON.parse(px.account_settings) : {}; } catch {}
        try { selected = px?.selected_accounts ? JSON.parse(px.selected_accounts) : []; } catch {}
        try { reinstated = px?.reinstated_order_keys ? JSON.parse(px.reinstated_order_keys) : []; } catch {}
        reinstated = reinstated.filter(key => !key.startsWith(`${accountId}:`));
        if (action === 'delete') { delete settings[String(accountId)]; selected = selected.filter(value => value !== accountId); }
        db.prepare('UPDATE projectx_connections SET account_settings = ?, selected_accounts = ?, reinstated_order_keys = ?, last_full_sync_time = NULL WHERE broker_connection_id = ?')
          .run(JSON.stringify(settings), JSON.stringify(selected), JSON.stringify(reinstated), connectionId);
        db.prepare('UPDATE broker_connections SET last_sync_time = NULL, updated_at = ? WHERE id = ? AND owner = ?')
          .run(new Date().toISOString(), connectionId, user.id);
        return { removedTrades: deleted, removedRawExecutions: raw };
      }
      if (id.startsWith('broker::')) {
        const [, connectionId, accountName] = id.split('::');
        const owned = db.prepare('SELECT id FROM broker_connections WHERE id = ? AND owner = ?').get(connectionId, user.id);
        if (!owned) throw new Error('Broker account not found.');
        const managed = db.prepare('SELECT display_name FROM managed_accounts WHERE id = ? AND user_id = ?').get(id, user.id) as any;
        const deleted = db.prepare('DELETE FROM trades WHERE user_id = ? AND broker_connection_id = ? AND account = ?')
          .run(user.id, connectionId, managed?.display_name || accountName).changes;
        if (action === 'delete') db.prepare('DELETE FROM managed_accounts WHERE id = ? AND user_id = ?')
          .run(id, user.id);
        return { removedTrades: deleted };
      }
      throw new Error('Unknown account type.');
    })();
    return c.json({ ok: true, action, ...result });
  } catch (err: any) {
    console.error('Managed account action error:', err);
    return c.json({ error: err?.message || 'Could not update account.' }, 500);
  }
});

export default account;
