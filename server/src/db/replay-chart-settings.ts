import type { Db } from './connection';

const UNITS = ['currency', 'points', 'ticks', 'percent'] as const;
type Unit = typeof UNITS[number];
export interface ReplayChartSettings {
  version: 1;
  labelUnits: Unit[];
}

export function validateReplayChartSettings(input: unknown): ReplayChartSettings | null {
  if (!input || typeof input !== 'object') return null;
  const value = input as { version?: unknown; labelUnits?: unknown };
  if (value.version !== 1 || !Array.isArray(value.labelUnits) ||
      value.labelUnits.length < 1 || value.labelUnits.length > UNITS.length ||
      !value.labelUnits.every(unit => UNITS.includes(unit)) ||
      new Set(value.labelUnits).size !== value.labelUnits.length) return null;
  const chosen = value.labelUnits;
  return { version: 1, labelUnits: UNITS.filter(unit => chosen.includes(unit)) };
}

export function readReplayChartSettings(db: Db, userId: string): ReplayChartSettings | null {
  const row = db.prepare('SELECT settings_json FROM replay_chart_settings WHERE user_id = ?').get(userId) as { settings_json: string } | undefined;
  if (!row) return null;
  const settings = validateReplayChartSettings(JSON.parse(row.settings_json));
  if (!settings) throw new Error('Stored replay chart settings are invalid.');
  return settings;
}

export function saveReplayChartSettings(db: Db, userId: string, settings: ReplayChartSettings): void {
  const validated = validateReplayChartSettings(settings);
  if (!validated) throw new Error('Invalid replay chart settings.');
  db.prepare(`INSERT INTO replay_chart_settings (user_id, settings_json, updated_at)
    VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET
    settings_json = excluded.settings_json, updated_at = excluded.updated_at`)
    .run(userId, JSON.stringify(validated), new Date().toISOString());
}
