import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import type { Env, AuthContext } from '../bindings';
import { MARKET_DATA_STAGING_DIR } from '../config';
import { requiresLogin } from '../middleware/auth';
import { generateId } from '../utils/id';
import { inspectOhlcvCsv } from '../services/market-data-import';

type HonoEnv = {
  Bindings: Env;
  Variables: AuthContext;
};

const marketData = new Hono<HonoEnv>();
const MAX_MARKET_DATA_UPLOAD_BYTES = 100 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(['csv', 'parquet']);

function getOrCreateHistoricalProvider(db: AuthContext['db'], userId: string) {
  const existing = db.prepare(
    `SELECT * FROM market_data_providers
     WHERE user_id = ? AND provider_type = 'historical_futures'
     ORDER BY created_at ASC LIMIT 1`,
  ).get(userId) as { id: string; display_name: string } | undefined;
  if (existing) return existing;

  const provider = { id: generateId(), display_name: 'Historical Futures' };
  db.prepare(
    `INSERT INTO market_data_providers (id, user_id, provider_type, display_name)
     VALUES (?, ?, 'historical_futures', ?)`,
  ).run(provider.id, userId, provider.display_name);
  return provider;
}

// GET /api/market-data/providers — list historical market-data providers.
marketData.get('/api/market-data/providers', requiresLogin, async (c) => {
  const user = c.get('user');
  const db = c.get('db');
  const providers = db.prepare(
    `SELECT p.id, p.provider_type, p.display_name, p.created_at,
            COUNT(f.id) AS file_count,
            COALESCE(SUM(CASE WHEN f.import_status = 'ready' THEN 1 ELSE 0 END), 0) AS ready_file_count
     FROM market_data_providers p
     LEFT JOIN market_data_files f ON f.provider_id = p.id AND f.user_id = p.user_id
     WHERE p.user_id = ?
     GROUP BY p.id
     ORDER BY p.created_at ASC`,
  ).all(user.id);
  return c.json({ providers });
});

// POST /api/market-data/files/inspect — stage and inspect one CSV/Parquet file.
marketData.post('/api/market-data/files/inspect', requiresLogin, async (c) => {
  const user = c.get('user');
  const db = c.get('db');

  let file: unknown;
  try {
    const body = await c.req.parseBody();
    file = body.file;
  } catch {
    return c.json({ error: 'Invalid multipart form data.' }, 400);
  }

  if (!(file instanceof File)) return c.json({ error: 'A file field is required.' }, 400);
  if (file.size === 0) return c.json({ error: 'The uploaded file is empty.' }, 400);
  if (file.size > MAX_MARKET_DATA_UPLOAD_BYTES) {
    return c.json({ error: 'File too large. Maximum upload size is 100MB.' }, 413);
  }

  const extension = path.extname(file.name).slice(1).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    return c.json({ error: 'Supported file formats are CSV and Parquet.' }, 400);
  }
  if (extension === 'parquet') {
    return c.json({
      error: 'Parquet inspection is not enabled yet. The Parquet reader is being added as part of this provider implementation.',
      code: 'PARQUET_READER_PENDING',
    }, 501);
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const contentSha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const provider = getOrCreateHistoricalProvider(db, user.id);
  const duplicate = db.prepare(
    `SELECT id, original_filename, import_status FROM market_data_files
     WHERE user_id = ? AND provider_id = ? AND content_sha256 = ?`,
  ).get(user.id, provider.id, contentSha256) as { id: string; original_filename: string; import_status: string } | undefined;

  if (duplicate) {
    return c.json({
      error: 'This exact file has already been uploaded to this provider.',
      code: 'DUPLICATE_FILE',
      existingFile: duplicate,
    }, 409);
  }

  let inspection;
  try {
    inspection = inspectOhlcvCsv(buffer, file.name);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Unable to inspect CSV.' }, 422);
  }
  if (inspection.validRowCount === 0) {
    return c.json({ error: 'No valid OHLCV rows were found.', inspection }, 422);
  }

  const fileId = generateId();
  const storageKey = `${fileId}.upload`;
  const stagingPath = path.join(MARKET_DATA_STAGING_DIR, storageKey);

  try {
    await fs.promises.writeFile(stagingPath, buffer, { flag: 'wx', mode: 0o600 });
    db.prepare(
      `INSERT INTO market_data_files (
        id, user_id, provider_id, original_filename, input_format, file_size_bytes,
        content_sha256, import_status, detected_metadata_json, original_storage_key
      ) VALUES (?, ?, ?, ?, 'csv', ?, ?, 'needs_review', ?, ?)`,
    ).run(
      fileId,
      user.id,
      provider.id,
      path.basename(file.name).slice(0, 255),
      buffer.length,
      contentSha256,
      JSON.stringify(inspection),
      `staging/${storageKey}`,
    );
  } catch (error) {
    await fs.promises.rm(stagingPath, { force: true }).catch(() => undefined);
    console.error('market data staging failed:', error);
    return c.json({ error: 'Failed to stage the uploaded file.' }, 500);
  }

  return c.json({
    file: {
      id: fileId,
      providerId: provider.id,
      filename: path.basename(file.name),
      format: 'csv',
      sizeBytes: buffer.length,
      status: 'needs_review',
    },
    inspection,
    requiresReview: true,
  }, 201);
});

export default marketData;
