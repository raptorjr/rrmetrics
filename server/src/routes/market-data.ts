import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import type { Env, AuthContext } from '../bindings';
import { MARKET_DATA_STAGING_DIR } from '../config';
import { requiresLogin } from '../middleware/auth';
import { generateId } from '../utils/id';
import { inspectOhlcvCsv } from '../services/market-data-import';
import { inspectOhlcvParquet } from '../services/market-data-parquet';

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
    inspection = extension === 'csv'
      ? inspectOhlcvCsv(buffer, file.name)
      : await inspectOhlcvParquet(buffer, file.name);
  } catch (error) {
    return c.json({
      error: error instanceof Error ? error.message : 'Unable to inspect market-data file.',
      code: extension === 'parquet' ? 'PARQUET_INSPECTION_FAILED' : 'CSV_INSPECTION_FAILED',
    }, 422);
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
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'needs_review', ?, ?)`,
    ).run(
      fileId,
      user.id,
      provider.id,
      path.basename(file.name).slice(0, 255),
      extension,
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
      format: extension,
      sizeBytes: buffer.length,
      status: 'needs_review',
    },
    inspection,
    requiresReview: true,
  }, 201);
});

marketData.get('/api/market-data/providers/:providerId/files', requiresLogin, async (c) => {
  const user = c.get('user');
  const db = c.get('db');
  const providerId = c.req.param('providerId');
  const provider = db.prepare(
    'SELECT id FROM market_data_providers WHERE id = ? AND user_id = ?',
  ).get(providerId, user.id);
  if (!provider) return c.notFound();

  const files = db.prepare(
    `SELECT id, original_filename, input_format, file_size_bytes, import_status,
            detected_metadata_json, confirmed_metadata_json, created_at, imported_at, last_error
     FROM market_data_files
     WHERE provider_id = ? AND user_id = ?
     ORDER BY created_at DESC`,
  ).all(providerId, user.id);
  return c.json({
    files: files.map((row: any) => ({
      ...row,
      detectedMetadata: JSON.parse(row.detected_metadata_json || '{}'),
      confirmedMetadata: JSON.parse(row.confirmed_metadata_json || '{}'),
      detected_metadata_json: undefined,
      confirmed_metadata_json: undefined,
    })),
  });
});

// DELETE /api/market-data/files/:fileId — discard an unconfirmed staged upload.
marketData.delete('/api/market-data/files/:fileId', requiresLogin, async (c) => {
  const user = c.get('user');
  const db = c.get('db');
  const fileId = c.req.param('fileId');
  const file = db.prepare(
    `SELECT id, import_status, original_storage_key FROM market_data_files
     WHERE id = ? AND user_id = ?`,
  ).get(fileId, user.id) as { id: string; import_status: string; original_storage_key: string } | undefined;
  if (!file) return c.notFound();
  if (!['needs_review', 'failed'].includes(file.import_status)) {
    return c.json({ error: 'Only unconfirmed or failed uploads can be discarded at this stage.' }, 409);
  }

  const storageKey = file.original_storage_key;
  if (!storageKey.startsWith('staging/') || path.basename(storageKey) !== storageKey.slice('staging/'.length)) {
    return c.json({ error: 'Stored file path failed validation.' }, 500);
  }
  const stagedPath = path.join(MARKET_DATA_STAGING_DIR, path.basename(storageKey));
  const tombstonePath = `${stagedPath}.deleting`;

  try {
    await fs.promises.rename(stagedPath, tombstonePath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
    db.prepare('DELETE FROM market_data_files WHERE id = ? AND user_id = ?').run(fileId, user.id);
    await fs.promises.rm(tombstonePath, { force: true });
    return c.json({ deleted: true, fileId });
  } catch (error) {
    await fs.promises.rename(tombstonePath, stagedPath).catch(() => undefined);
    console.error('market data staged-file deletion failed:', error);
    return c.json({ error: 'Failed to discard staged upload.' }, 500);
  }
});

export default marketData;
