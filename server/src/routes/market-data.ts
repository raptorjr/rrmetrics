import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import type { Env, AuthContext } from '../bindings';
import { MARKET_DATA_NORMALIZED_DIR, MARKET_DATA_ORIGINALS_DIR, MARKET_DATA_STAGING_DIR } from '../config';
import { requiresLogin } from '../middleware/auth';
import { generateId } from '../utils/id';
import { inspectOhlcvCsv, parseOhlcvCsv } from '../services/market-data-import';
import { inspectOhlcvParquet, normalizeOhlcvParquet, writeOhlcvBarsToParquet } from '../services/market-data-parquet';

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

// POST /api/market-data/files/:fileId/import — confirm metadata and persist one source-owned dataset.
marketData.post('/api/market-data/files/:fileId/import', requiresLogin, async (c) => {
  const user = c.get('user');
  const db = c.get('db');
  const fileId = c.req.param('fileId');
  const file = db.prepare(
    `SELECT id, provider_id, original_filename, input_format, import_status,
            content_sha256, original_storage_key, confirmed_metadata_json
     FROM market_data_files WHERE id = ? AND user_id = ?`,
  ).get(fileId, user.id) as {
    id: string;
    provider_id: string;
    original_filename: string;
    input_format: 'csv' | 'parquet';
    import_status: string;
    content_sha256: string;
    original_storage_key: string;
    confirmed_metadata_json: string;
  } | undefined;
  if (!file) return c.notFound();
  if (!['needs_review', 'failed'].includes(file.import_status)) {
    return c.json({ error: 'This file is not awaiting import confirmation.' }, 409);
  }
  if (!file.original_storage_key.startsWith('staging/')
    || path.basename(file.original_storage_key) !== file.original_storage_key.slice('staging/'.length)) {
    return c.json({ error: 'Stored file path failed validation.' }, 500);
  }

  let confirmation: {
    instrument?: unknown;
    timeframe?: unknown;
    timezone?: unknown;
    sourceSymbol?: unknown;
    skipInvalidRows?: unknown;
  };
  try {
    confirmation = await c.req.json();
  } catch {
    return c.json({ error: 'A JSON confirmation body is required.' }, 400);
  }

  const stagedPath = path.join(MARKET_DATA_STAGING_DIR, path.basename(file.original_storage_key));
  let buffer: Buffer;
  try {
    buffer = await fs.promises.readFile(stagedPath);
  } catch {
    return c.json({ error: 'The staged source file could not be found. Please upload it again.' }, 410);
  }
  const actualHash = crypto.createHash('sha256').update(buffer).digest('hex');
  if (actualHash !== file.content_sha256) {
    return c.json({ error: 'The staged source file no longer matches its original fingerprint.' }, 409);
  }

  let inspection;
  try {
    inspection = file.input_format === 'csv'
      ? inspectOhlcvCsv(buffer, file.original_filename)
      : await inspectOhlcvParquet(buffer, file.original_filename);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Unable to re-inspect source file.' }, 422);
  }

  const detectedSymbols = inspection.detectedSymbols ?? [];
  const sourceSymbol = typeof confirmation.sourceSymbol === 'string'
    ? confirmation.sourceSymbol.trim().toUpperCase()
    : detectedSymbols.length === 1 ? detectedSymbols[0] : null;
  if (detectedSymbols.length > 1 && !sourceSymbol) {
    return c.json({
      error: 'This file contains multiple source symbols. Select one symbol for this dataset; repeat the import for each remaining symbol.',
      code: 'SOURCE_SYMBOL_REQUIRED',
      detectedSymbols,
    }, 400);
  }
  if (sourceSymbol && !detectedSymbols.includes(sourceSymbol)) {
    return c.json({ error: 'The selected source symbol was not detected in this file.' }, 400);
  }

  const instrument = typeof confirmation.instrument === 'string' && confirmation.instrument.trim()
    ? confirmation.instrument.trim().toUpperCase()
    : inspection.detectedInstrument;
  const timeframe = typeof confirmation.timeframe === 'string' && confirmation.timeframe.trim()
    ? confirmation.timeframe.trim()
    : inspection.detectedTimeframe;
  if (!instrument) return c.json({ error: 'Confirm the canonical instrument before importing.' }, 400);
  if (!timeframe || !/^\d+(?:s|m|h|d)$/.test(timeframe)) {
    return c.json({ error: 'Confirm a supported timeframe (for example 1m or 5m) before importing.' }, 400);
  }

  const timezone = typeof confirmation.timezone === 'string' && confirmation.timezone.trim()
    ? confirmation.timezone.trim()
    : inspection.timezoneNeedsConfirmation ? null : inspection.timezone;
  if (inspection.timezoneNeedsConfirmation && !timezone) {
    return c.json({ error: 'Confirm the source timezone before importing.', code: 'TIMEZONE_REQUIRED' }, 400);
  }
  if (timezone && timezone !== 'UTC' && timezone !== 'explicit') {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    } catch {
      return c.json({ error: 'The supplied timezone is not a valid IANA timezone.' }, 400);
    }
  }

  const skipInvalidRows = confirmation.skipInvalidRows === true;
  if (inspection.invalidRowCount > 0 && !skipInvalidRows) {
    return c.json({
      error: 'The file contains invalid rows. Review the inspection errors and explicitly confirm whether valid rows should be imported while invalid rows are skipped.',
      code: 'INVALID_ROWS_REQUIRE_CONFIRMATION',
      invalidRowCount: inspection.invalidRowCount,
      errors: inspection.errors,
    }, 422);
  }

  const existingDataset = db.prepare(
    `SELECT id FROM market_data_file_datasets
     WHERE file_id = ? AND user_id = ? AND source_symbol IS ?`,
  ).get(fileId, user.id, sourceSymbol);
  if (existingDataset) {
    return c.json({ error: 'A dataset for this source symbol has already been imported from this file.' }, 409);
  }

  const datasetId = generateId();
  const temporaryPath = path.join(MARKET_DATA_NORMALIZED_DIR, `${datasetId}.tmp.parquet`);
  const normalizedPath = path.join(MARKET_DATA_NORMALIZED_DIR, `${datasetId}.parquet`);
  const normalizedStorageKey = `normalized/${datasetId}.parquet`;
  let normalizedResult: { rowCount: number; startTime: string; endTime: string };
  try {
    if (file.input_format === 'csv') {
      const parsed = parseOhlcvCsv(buffer, file.original_filename, { timezone });
      const selectedBars = parsed.bars.filter(bar => !sourceSymbol || bar.sourceSymbol === sourceSymbol);
      normalizedResult = await writeOhlcvBarsToParquet(temporaryPath, selectedBars);
    } else {
      normalizedResult = await normalizeOhlcvParquet(buffer, temporaryPath, {
        sourceSymbol,
        timezone,
        skipInvalidRows,
      });
    }
    await fs.promises.rename(temporaryPath, normalizedPath);
  } catch (error) {
    await fs.promises.rm(temporaryPath, { force: true }).catch(() => undefined);
    return c.json({
      error: error instanceof Error ? error.message : 'Failed to normalize the source dataset.',
      code: 'NORMALIZATION_FAILED',
    }, 422);
  }

  const previousDatasets = db.prepare(
    'SELECT source_symbol FROM market_data_file_datasets WHERE file_id = ? AND user_id = ?',
  ).all(fileId, user.id) as Array<{ source_symbol: string | null }>;
  const importedSymbols = new Set(previousDatasets.map(row => row.source_symbol).filter((value): value is string => Boolean(value)));
  if (sourceSymbol) importedSymbols.add(sourceSymbol);
  const remainingSymbols = detectedSymbols.filter(symbol => !importedSymbols.has(symbol));
  const complete = detectedSymbols.length === 0 || remainingSymbols.length === 0;

  const confirmed = JSON.parse(file.confirmed_metadata_json || '{}') as Record<string, unknown>;
  const confirmedDatasets = (confirmed.datasets && typeof confirmed.datasets === 'object')
    ? confirmed.datasets as Record<string, unknown>
    : {};
  confirmed.datasets = {
    ...confirmedDatasets,
    [sourceSymbol ?? '__default__']: {
      instrument,
      timeframe,
      timezone: timezone ?? 'UTC',
      skipInvalidRows,
      rowCount: normalizedResult.rowCount,
      startTime: normalizedResult.startTime,
      endTime: normalizedResult.endTime,
    },
  };

  const originalExtension = file.input_format;
  const originalPath = path.join(MARKET_DATA_ORIGINALS_DIR, `${fileId}.${originalExtension}`);
  const originalStorageKey = `originals/${fileId}.${originalExtension}`;
  let originalMoved = false;
  try {
    if (complete) {
      await fs.promises.rename(stagedPath, originalPath);
      originalMoved = true;
    }

    const saveImport = db.transaction(() => {
      db.prepare(
        `INSERT INTO market_data_file_datasets (
          id, user_id, file_id, data_kind, instrument, source_symbol, timeframe,
          timezone, timestamp_unit, row_count, start_time, end_time, schema_version,
          normalized_storage_key
        ) VALUES (?, ?, ?, 'ohlcv', ?, ?, ?, ?, 'MILLIS', ?, ?, ?, 1, ?)`,
      ).run(
        datasetId,
        user.id,
        fileId,
        instrument,
        sourceSymbol,
        timeframe,
        timezone ?? 'UTC',
        normalizedResult.rowCount,
        normalizedResult.startTime,
        normalizedResult.endTime,
        normalizedStorageKey,
      );
      db.prepare(
        `UPDATE market_data_files
         SET import_status = ?, confirmed_metadata_json = ?, imported_at = ?, last_error = NULL,
             original_storage_key = ?
         WHERE id = ? AND user_id = ?`,
      ).run(
        complete ? 'ready' : 'needs_review',
        JSON.stringify(confirmed),
        complete ? new Date().toISOString() : null,
        complete ? originalStorageKey : file.original_storage_key,
        fileId,
        user.id,
      );
    });
    saveImport();
  } catch (error) {
    await fs.promises.rm(normalizedPath, { force: true }).catch(() => undefined);
    if (originalMoved) {
      await fs.promises.rename(originalPath, stagedPath).catch(() => undefined);
    }
    console.error('market data import transaction failed:', error);
    return c.json({ error: 'Failed to commit normalized market data.' }, 500);
  }

  return c.json({
    imported: true,
    fileId,
    dataset: {
      id: datasetId,
      instrument,
      sourceSymbol,
      timeframe,
      rowCount: normalizedResult.rowCount,
      startTime: normalizedResult.startTime,
      endTime: normalizedResult.endTime,
      normalizedStorageKey,
    },
    fileStatus: complete ? 'ready' : 'needs_review',
    remainingSymbols,
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
      datasets: db.prepare(
        `SELECT id, data_kind, instrument, source_symbol, timeframe, timezone,
                row_count, start_time, end_time, normalized_storage_key, created_at
         FROM market_data_file_datasets
         WHERE file_id = ? AND user_id = ?
         ORDER BY instrument, source_symbol`,
      ).all(row.id, user.id),
      detected_metadata_json: undefined,
      confirmed_metadata_json: undefined,
    })),
  });
});

// DELETE /api/market-data/files/:fileId — preview impact, then delete only this file's source-owned data.
marketData.delete('/api/market-data/files/:fileId', requiresLogin, async (c) => {
  const user = c.get('user');
  const db = c.get('db');
  const fileId = c.req.param('fileId');
  const file = db.prepare(
    `SELECT id, original_filename, input_format, import_status, original_storage_key
     FROM market_data_files WHERE id = ? AND user_id = ?`,
  ).get(fileId, user.id) as {
    id: string;
    original_filename: string;
    input_format: 'csv' | 'parquet';
    import_status: string;
    original_storage_key: string;
  } | undefined;
  if (!file) return c.notFound();

  const datasets = db.prepare(
    `SELECT id, instrument, source_symbol, timeframe, row_count, start_time, end_time, normalized_storage_key
     FROM market_data_file_datasets WHERE file_id = ? AND user_id = ?
     ORDER BY instrument, source_symbol`,
  ).all(fileId, user.id) as Array<{
    id: string;
    instrument: string;
    source_symbol: string | null;
    timeframe: string;
    row_count: number;
    start_time: string;
    end_time: string;
    normalized_storage_key: string;
  }>;

  let overlappingDatasetsRetained = 0;
  for (const dataset of datasets) {
    const overlap = db.prepare(
      `SELECT COUNT(*) AS count FROM market_data_file_datasets
       WHERE user_id = ? AND file_id <> ? AND instrument = ? AND timeframe = ?
         AND start_time <= ? AND end_time >= ?`,
    ).get(user.id, fileId, dataset.instrument, dataset.timeframe, dataset.end_time, dataset.start_time) as { count: number };
    overlappingDatasetsRetained += overlap.count;
  }

  const impact = {
    fileId,
    filename: file.original_filename,
    status: file.import_status,
    datasetCount: datasets.length,
    totalRows: datasets.reduce((sum, dataset) => sum + dataset.row_count, 0),
    datasets: datasets.map(({ normalized_storage_key, ...dataset }) => dataset),
    overlappingDatasetsRetained,
    note: 'Only data owned by this source file will be deleted. Overlapping datasets from other files remain available.',
  };
  if (c.req.query('confirm') !== 'true') {
    return c.json({ requiresConfirmation: true, impact }, 409);
  }

  const moved: Array<{ from: string; to: string }> = [];
  let databaseDeleted = false;
  const resolveStoragePath = (key: string, prefix: 'staging' | 'originals' | 'normalized'): string => {
    if (!key.startsWith(`${prefix}/`)) throw new Error('Stored market-data path failed validation.');
    const name = key.slice(prefix.length + 1);
    if (!name || path.basename(name) !== name || name.includes('..')) {
      throw new Error('Stored market-data path failed validation.');
    }
    const directory = prefix === 'staging' ? MARKET_DATA_STAGING_DIR
      : prefix === 'originals' ? MARKET_DATA_ORIGINALS_DIR : MARKET_DATA_NORMALIZED_DIR;
    return path.join(directory, name);
  };

  try {
    const originalPrefix = file.original_storage_key.startsWith('staging/') ? 'staging' : 'originals';
    const originalPath = resolveStoragePath(file.original_storage_key, originalPrefix);
    const originalTombstone = `${originalPath}.deleting`;
    await fs.promises.rename(originalPath, originalTombstone);
    moved.push({ from: originalPath, to: originalTombstone });

    for (const dataset of datasets) {
      const normalizedPath = resolveStoragePath(dataset.normalized_storage_key, 'normalized');
      const tombstone = `${normalizedPath}.deleting`;
      await fs.promises.rename(normalizedPath, tombstone);
      moved.push({ from: normalizedPath, to: tombstone });
    }

    const removeFile = db.transaction(() => {
      db.prepare('DELETE FROM market_data_files WHERE id = ? AND user_id = ?').run(fileId, user.id);
    });
    removeFile();
    databaseDeleted = true;
    await Promise.all(moved.map(item => fs.promises.rm(item.to, { force: true })));
    return c.json({ deleted: true, impact });
  } catch (error) {
    if (databaseDeleted) {
      // The DB cascade has completed; leave any failed cleanup as a tombstone
      // rather than restoring files that no longer have catalogue ownership.
      console.error('market data tombstone cleanup needs attention:', error);
      return c.json({ deleted: true, cleanupWarning: true, impact });
    }
    for (const item of moved.reverse()) {
      await fs.promises.rename(item.to, item.from).catch(() => undefined);
    }
    console.error('market data source deletion failed:', error);
    return c.json({ error: 'Failed to delete this market-data source. No trading data is affected.' }, 500);
  }
});

export default marketData;
