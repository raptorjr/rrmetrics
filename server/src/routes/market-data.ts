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
import { inspectTickParquet, normalizeTickParquet } from '../services/market-data-ticks';
import { readTickParquetRange } from '../services/market-data-query';
import { readOhlcvParquetRange } from '../services/market-data-query';

type HonoEnv = {
  Bindings: Env;
  Variables: AuthContext;
};

const marketData = new Hono<HonoEnv>();
const MAX_MARKET_DATA_UPLOAD_BYTES = 100 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(['csv', 'parquet']);

async function inspectParquetMarketData(buffer: Uint8Array, filename: string) {
  try {
    const inspection = await inspectOhlcvParquet(buffer, filename);
    return { ...inspection, dataKind: 'ohlcv' as const };
  } catch (ohlcvError) {
    try {
      return await inspectTickParquet(buffer, filename);
    } catch {
      throw ohlcvError;
    }
  }
}

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
      ? { ...inspectOhlcvCsv(buffer, file.name), dataKind: 'ohlcv' }
      : await inspectParquetMarketData(buffer, file.name);
  } catch (error) {
    return c.json({
      error: error instanceof Error ? error.message : 'Unable to inspect market-data file.',
      code: extension === 'parquet' ? 'PARQUET_INSPECTION_FAILED' : 'CSV_INSPECTION_FAILED',
    }, 422);
  }
  if (inspection.validRowCount === 0) {
    return c.json({ error: 'No valid OHLCV rows were found.', inspection }, 422);
  }

  const potentialOverlaps = new Map<string, {
    datasetId: string;
    fileId: string;
    filename: string;
    instrument: string;
    sourceSymbol: string | null;
    timeframe: string;
    startTime: string;
    endTime: string;
    rowCount: number;
  }>();
  if (inspection.detectedTimeframe && inspection.startTime && inspection.endTime
    && (inspection.detectedInstrument || inspection.detectedSymbols?.length)) {
    const sourceSymbols: Array<string | null> = inspection.detectedSymbols?.length
      ? inspection.detectedSymbols : [null];
    for (const sourceSymbol of sourceSymbols) {
      const overlaps = db.prepare(
        `SELECT d.id AS dataset_id, d.file_id, d.instrument, d.source_symbol, d.timeframe,
                d.start_time, d.end_time, d.row_count, f.original_filename
         FROM market_data_file_datasets d
         JOIN market_data_files f ON f.id = d.file_id AND f.user_id = d.user_id
         WHERE d.user_id = ? AND f.import_status = 'ready'
           AND d.data_kind = ? AND d.timeframe = ? AND d.start_time <= ? AND d.end_time >= ?
           AND (? IS NULL OR d.instrument = ?)
           AND d.source_symbol IS ?`,
      ).all(
        user.id,
        inspection.dataKind || 'ohlcv',
        inspection.detectedTimeframe,
        inspection.endTime,
        inspection.startTime,
        inspection.detectedInstrument,
        inspection.detectedInstrument,
        sourceSymbol,
      ) as Array<{
        dataset_id: string;
        file_id: string;
        instrument: string;
        source_symbol: string | null;
        timeframe: string;
        start_time: string;
        end_time: string;
        row_count: number;
        original_filename: string;
      }>;
      for (const overlap of overlaps) {
        potentialOverlaps.set(overlap.dataset_id, {
          datasetId: overlap.dataset_id,
          fileId: overlap.file_id,
          filename: overlap.original_filename,
          instrument: overlap.instrument,
          sourceSymbol: overlap.source_symbol,
          timeframe: overlap.timeframe,
          startTime: overlap.start_time,
          endTime: overlap.end_time,
          rowCount: overlap.row_count,
        });
      }
    }
  }
  const inspectionWithOverlaps = {
    ...inspection,
    potentialOverlaps: [...potentialOverlaps.values()],
    warnings: potentialOverlaps.size
      ? [...inspection.warnings, `${potentialOverlaps.size} existing source dataset(s) overlap this file's instrument, contract and date range. Both sources will be retained; choose a source explicitly when querying overlapping ranges.`]
      : inspection.warnings,
  };

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
      JSON.stringify(inspectionWithOverlaps),
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
    inspection: inspectionWithOverlaps,
    requiresReview: true,
  }, 201);
});

// GET /api/market-data/datasets — available source-owned OHLCV datasets.
marketData.get('/api/market-data/datasets', requiresLogin, async (c) => {
  const user = c.get('user');
  const db = c.get('db');
  const instrument = c.req.query('instrument')?.trim().toUpperCase() || null;
  const timeframe = c.req.query('timeframe')?.trim() || null;
  const sourceSymbol = c.req.query('sourceSymbol')?.trim().toUpperCase() || null;
  const dataKind = c.req.query('dataKind') === 'ticks' ? 'ticks' : 'ohlcv';
  const datasets = db.prepare(
    `SELECT d.id, d.file_id, d.data_kind, d.instrument, d.source_symbol, d.timeframe,
            d.timezone, d.row_count, d.start_time, d.end_time, d.created_at,
            f.original_filename, f.provider_id, f.imported_at
     FROM market_data_file_datasets d
     JOIN market_data_files f ON f.id = d.file_id AND f.user_id = d.user_id
     WHERE d.user_id = ? AND f.import_status = 'ready' AND d.data_kind = ?
       AND (? IS NULL OR d.instrument = ?)
       AND (? IS NULL OR d.timeframe = ?)
       AND (? IS NULL OR d.source_symbol = ?)
     ORDER BY d.instrument, d.timeframe, d.source_symbol, d.start_time`,
  ).all(
    user.id,
    dataKind,
    instrument, instrument,
    timeframe, timeframe,
    sourceSymbol, sourceSymbol,
  );
  return c.json({ datasets });
});

// GET /api/market-data/query — provider-independent, source-aware OHLCV range query.
marketData.get('/api/market-data/query', requiresLogin, async (c) => {
  const user = c.get('user');
  const db = c.get('db');
  const instrument = c.req.query('instrument')?.trim().toUpperCase() || null;
  const timeframe = c.req.query('timeframe')?.trim() || null;
  const sourceSymbol = c.req.query('sourceSymbol')?.trim().toUpperCase() || null;
  const datasetId = c.req.query('datasetId')?.trim() || null;
  const startValue = c.req.query('start');
  const endValue = c.req.query('end');
  const startTime = startValue ? Date.parse(startValue) : Number.NaN;
  const endTime = endValue ? Date.parse(endValue) : Number.NaN;
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime < startTime) {
    return c.json({ error: 'Provide a valid start and end timestamp for the market-data query.' }, 400);
  }
  if (!datasetId && (!instrument || !timeframe)) {
    return c.json({ error: 'Instrument and timeframe are required unless a datasetId is selected.' }, 400);
  }

  const baseQuery = `SELECT d.id, d.file_id, d.instrument, d.source_symbol, d.timeframe,
      d.row_count, d.start_time, d.end_time, d.normalized_storage_key,
      f.original_filename, f.provider_id
    FROM market_data_file_datasets d
    JOIN market_data_files f ON f.id = d.file_id AND f.user_id = d.user_id
    WHERE d.user_id = ? AND f.import_status = 'ready' AND d.data_kind = 'ohlcv'`;
  const datasets = datasetId
    ? db.prepare(`${baseQuery} AND d.id = ?`).all(user.id, datasetId) as Array<any>
    : db.prepare(
      `${baseQuery}
       AND d.instrument = ? AND d.timeframe = ?
       AND d.start_time <= ? AND d.end_time >= ?
       AND (? IS NULL OR d.source_symbol = ?)
       ORDER BY d.start_time`,
    ).all(
      user.id, instrument, timeframe,
      new Date(endTime).toISOString(), new Date(startTime).toISOString(),
      sourceSymbol, sourceSymbol,
    ) as Array<any>;

  if (!datasets.length) return c.json({ error: 'No matching historical market-data datasets were found.' }, 404);
  if (datasetId && ((instrument && datasets[0].instrument !== instrument)
    || (timeframe && datasets[0].timeframe !== timeframe)
    || (sourceSymbol && datasets[0].source_symbol !== sourceSymbol))) {
    return c.json({ error: 'The selected dataset does not match the requested instrument/timeframe/source symbol.' }, 400);
  }

  const sourceSymbols = [...new Set(datasets.map(dataset => dataset.source_symbol ?? '__none__'))];
  if (!datasetId && !sourceSymbol && sourceSymbols.length > 1) {
    return c.json({
      error: 'Multiple contract/source symbols are available. Select a sourceSymbol or datasetId; contracts are never silently merged.',
      code: 'SOURCE_SYMBOL_REQUIRED',
      sourceSymbols: sourceSymbols.map(value => value === '__none__' ? null : value),
      datasets: datasets.map(dataset => ({
        id: dataset.id,
        sourceSymbol: dataset.source_symbol,
        startTime: dataset.start_time,
        endTime: dataset.end_time,
      })),
    }, 409);
  }

  if (!datasetId && datasets.length > 1) {
    const ordered = [...datasets].sort((a, b) => a.start_time.localeCompare(b.start_time));
    for (let index = 1; index < ordered.length; index += 1) {
      if (ordered[index].start_time <= ordered[index - 1].end_time) {
        return c.json({
          error: 'Overlapping source datasets are available. Select a datasetId to avoid silently resolving conflicting candles.',
          code: 'SOURCE_OVERLAP_REQUIRES_SELECTION',
          datasets: ordered.map(dataset => ({
            id: dataset.id,
            fileId: dataset.file_id,
            filename: dataset.original_filename,
            sourceSymbol: dataset.source_symbol,
            startTime: dataset.start_time,
            endTime: dataset.end_time,
          })),
        }, 409);
      }
    }
  }

  const bars = [];
  const startIso = new Date(startTime).toISOString();
  const endIso = new Date(endTime).toISOString();
  try {
    for (const dataset of datasets) {
      const storageKey = String(dataset.normalized_storage_key);
      if (!storageKey.startsWith('normalized/')) throw new Error('Normalized market-data path failed validation.');
      const name = storageKey.slice('normalized/'.length);
      if (!name || path.basename(name) !== name || name.includes('..')) {
        throw new Error('Normalized market-data path failed validation.');
      }
      const normalizedPath = path.join(MARKET_DATA_NORMALIZED_DIR, name);
      const rows = await readOhlcvParquetRange(normalizedPath, startTime, endTime);
      bars.push(...rows);
    }
  } catch (error) {
    console.error('market data range query failed:', error);
    return c.json({ error: 'Unable to read one or more normalized market-data datasets.' }, 500);
  }

  bars.sort((a, b) => a.timestamp - b.timestamp);
  if (bars.length > 200_000) {
    return c.json({ error: 'The selected range is too large. Narrow the date range and try again.' }, 413);
  }

  return c.json({
    instrument: datasets[0].instrument,
    timeframe: datasets[0].timeframe,
    sourceSymbol: sourceSymbol ?? datasets[0].source_symbol,
    startTime: startIso,
    endTime: endIso,
    totalBars: bars.length,
    sources: datasets.map(dataset => ({
      datasetId: dataset.id,
      fileId: dataset.file_id,
      filename: dataset.original_filename,
      sourceSymbol: dataset.source_symbol,
      startTime: dataset.start_time,
      endTime: dataset.end_time,
      rowCount: dataset.row_count,
    })),
    bars,
  });
});

// GET /api/market-data/ticks/query — source-aware tick-event range query.
marketData.get('/api/market-data/ticks/query', requiresLogin, async (c) => {
  const user = c.get('user');
  const db = c.get('db');
  const instrument = c.req.query('instrument')?.trim().toUpperCase() || null;
  const sourceSymbol = c.req.query('sourceSymbol')?.trim().toUpperCase() || null;
  const datasetId = c.req.query('datasetId')?.trim() || null;
  const startValue = c.req.query('start');
  const endValue = c.req.query('end');
  const startTime = startValue ? Date.parse(startValue) : Number.NaN;
  const endTime = endValue ? Date.parse(endValue) : Number.NaN;
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime < startTime) {
    return c.json({ error: 'Provide a valid start and end timestamp for the tick query.' }, 400);
  }
  if (!datasetId && !instrument) {
    return c.json({ error: 'Instrument is required unless a datasetId is selected.' }, 400);
  }

  const baseQuery = `SELECT d.id, d.file_id, d.instrument, d.source_symbol, d.timeframe,
      d.row_count, d.start_time, d.end_time, d.normalized_storage_key,
      f.original_filename, f.provider_id
    FROM market_data_file_datasets d
    JOIN market_data_files f ON f.id = d.file_id AND f.user_id = d.user_id
    WHERE d.user_id = ? AND f.import_status = 'ready'
      AND d.data_kind = 'ticks' AND d.timeframe = 'tick'`;
  const datasets = datasetId
    ? db.prepare(`${baseQuery} AND d.id = ?`).all(user.id, datasetId) as Array<any>
    : db.prepare(
      `${baseQuery}
       AND d.instrument = ?
       AND d.start_time <= ? AND d.end_time >= ?
       AND (? IS NULL OR d.source_symbol = ?)
       ORDER BY d.start_time`,
    ).all(
      user.id, instrument,
      new Date(endTime).toISOString(), new Date(startTime).toISOString(),
      sourceSymbol, sourceSymbol,
    ) as Array<any>;

  if (!datasets.length) return c.json({ error: 'No matching historical tick datasets were found.' }, 404);
  if (datasetId && ((instrument && datasets[0].instrument !== instrument)
    || (sourceSymbol && datasets[0].source_symbol !== sourceSymbol))) {
    return c.json({ error: 'The selected tick dataset does not match the requested instrument/source symbol.' }, 400);
  }

  const symbols = [...new Set(datasets.map(dataset => dataset.source_symbol ?? '__none__'))];
  if (!datasetId && !sourceSymbol && symbols.length > 1) {
    return c.json({
      error: 'Multiple tick source symbols are available. Select a sourceSymbol or datasetId.',
      code: 'SOURCE_SYMBOL_REQUIRED',
      sourceSymbols: symbols.map(value => value === '__none__' ? null : value),
      datasets: datasets.map(dataset => ({
        id: dataset.id, sourceSymbol: dataset.source_symbol,
        startTime: dataset.start_time, endTime: dataset.end_time,
      })),
    }, 409);
  }

  if (!datasetId && datasets.length > 1) {
    const ordered = [...datasets].sort((a, b) => a.start_time.localeCompare(b.start_time));
    for (let index = 1; index < ordered.length; index += 1) {
      if (ordered[index].start_time <= ordered[index - 1].end_time) {
        return c.json({
          error: 'Overlapping tick source datasets are available. Select a datasetId to avoid silently merging event streams.',
          code: 'SOURCE_OVERLAP_REQUIRES_SELECTION',
          datasets: ordered.map(dataset => ({
            id: dataset.id, fileId: dataset.file_id, filename: dataset.original_filename,
            sourceSymbol: dataset.source_symbol, startTime: dataset.start_time, endTime: dataset.end_time,
          })),
        }, 409);
      }
    }
  }

  const ticks = [];
  try {
    for (const dataset of datasets) {
      const storageKey = String(dataset.normalized_storage_key);
      if (!storageKey.startsWith('normalized/')) throw new Error('Normalized tick path failed validation.');
      const name = storageKey.slice('normalized/'.length);
      if (!name || path.basename(name) !== name || name.includes('..')) {
        throw new Error('Normalized tick path failed validation.');
      }
      const normalizedPath = path.join(MARKET_DATA_NORMALIZED_DIR, name);
      ticks.push(...await readTickParquetRange(normalizedPath, startTime, endTime));
    }
  } catch (error) {
    console.error('market data tick range query failed:', error);
    return c.json({ error: 'Unable to read one or more normalized tick datasets.' }, 500);
  }

  ticks.sort((a, b) => {
    const left = BigInt(a.timestampNs);
    const right = BigInt(b.timestampNs);
    if (left < right) return -1;
    if (left > right) return 1;
    return a.sequence - b.sequence;
  });
  if (ticks.length > 2_000_000) {
    return c.json({ error: 'The selected range contains too many tick events. Narrow the date range and try again.' }, 413);
  }

  return c.json({
    dataKind: 'ticks',
    instrument: datasets[0].instrument,
    sourceSymbol: sourceSymbol ?? datasets[0].source_symbol,
    startTime: new Date(startTime).toISOString(),
    endTime: new Date(endTime).toISOString(),
    totalTicks: ticks.length,
    sources: datasets.map(dataset => ({
      datasetId: dataset.id, fileId: dataset.file_id, filename: dataset.original_filename,
      sourceSymbol: dataset.source_symbol, startTime: dataset.start_time,
      endTime: dataset.end_time, rowCount: dataset.row_count,
    })),
    ticks,
  });
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
      ? { ...inspectOhlcvCsv(buffer, file.original_filename), dataKind: 'ohlcv' }
      : await inspectParquetMarketData(buffer, file.original_filename);
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
  if (sourceSymbol && detectedSymbols.length > 0 && !detectedSymbols.includes(sourceSymbol)) {
    return c.json({ error: 'The selected source symbol was not detected in this file.' }, 400);
  }

  const instrument = typeof confirmation.instrument === 'string' && confirmation.instrument.trim()
    ? confirmation.instrument.trim().toUpperCase()
    : inspection.detectedInstrument;
  const timeframe = typeof confirmation.timeframe === 'string' && confirmation.timeframe.trim()
    ? confirmation.timeframe.trim()
    : inspection.detectedTimeframe;
  if (!instrument) return c.json({ error: 'Confirm the canonical instrument before importing.' }, 400);
  const validTimeframe = inspection.dataKind === 'ticks'
    ? timeframe === 'tick'
    : Boolean(timeframe && /^\d+(?:s|m|h|d)$/.test(timeframe));
  if (!validTimeframe) {
    return c.json({
      error: inspection.dataKind === 'ticks'
        ? 'Tick datasets must use the tick timeframe.'
        : 'Confirm a supported timeframe (for example 1m or 5m) before importing.',
    }, 400);
  }

  const timezone = typeof confirmation.timezone === 'string' && confirmation.timezone.trim()
    ? confirmation.timezone.trim()
    : inspection.timezone === 'explicit' ? 'UTC'
      : inspection.timezoneNeedsConfirmation ? null : inspection.timezone ?? 'UTC';
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

  const claim = db.prepare(
    `UPDATE market_data_files SET import_status = 'inspecting'
     WHERE id = ? AND user_id = ? AND import_status = ?`,
  ).run(fileId, user.id, file.import_status);
  if (claim.changes !== 1) {
    return c.json({ error: 'This source file is already being processed. Try again when the current operation finishes.' }, 409);
  }

  const datasetId = generateId();
  const temporaryPath = path.join(MARKET_DATA_NORMALIZED_DIR, `${datasetId}.tmp.parquet`);
  const normalizedPath = path.join(MARKET_DATA_NORMALIZED_DIR, `${datasetId}.parquet`);
  const normalizedStorageKey = `normalized/${datasetId}.parquet`;
  let normalizedResult: { rowCount: number; startTime: string; endTime: string; sourceSymbol?: string | null };
  try {
    if (inspection.dataKind === 'ticks') {
      normalizedResult = await normalizeTickParquet(buffer, temporaryPath, {
        sourceSymbol,
        timezone,
        skipInvalidRows,
        detectedSymbols: inspection.detectedSymbols,
      });
    } else if (file.input_format === 'csv') {
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
    const message = error instanceof Error ? error.message : 'Failed to normalize the source dataset.';
    db.prepare(
      `UPDATE market_data_files SET import_status = ?, last_error = ?
       WHERE id = ? AND user_id = ? AND import_status = 'inspecting'`,
    ).run(file.import_status, message, fileId, user.id);
    return c.json({
      error: message,
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
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      ).run(
        datasetId,
        user.id,
        fileId,
        inspection.dataKind || 'ohlcv',
        instrument,
        sourceSymbol,
        timeframe,
        timezone ?? 'UTC',
        inspection.dataKind === 'ticks' ? inspection.timestampUnit : 'MILLIS',
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
    db.prepare(
      `UPDATE market_data_files SET import_status = ?, last_error = ?
       WHERE id = ? AND user_id = ? AND import_status = 'inspecting'`,
    ).run(file.import_status, error instanceof Error ? error.message : 'Import transaction failed.', fileId, user.id);
    console.error('market data import transaction failed:', error);
    return c.json({ error: 'Failed to commit normalized market data.' }, 500);
  }

  return c.json({
    imported: true,
    fileId,
    dataset: {
      id: datasetId,
      dataKind: inspection.dataKind || 'ohlcv',
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
    `SELECT id, data_kind, instrument, source_symbol, timeframe, row_count, start_time, end_time, normalized_storage_key
     FROM market_data_file_datasets WHERE file_id = ? AND user_id = ?
     ORDER BY instrument, source_symbol`,
  ).all(fileId, user.id) as Array<{
    id: string;
    data_kind: 'ohlcv' | 'ticks';
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
       WHERE user_id = ? AND file_id <> ? AND data_kind = ? AND instrument = ? AND timeframe = ?
         AND source_symbol IS ? AND start_time <= ? AND end_time >= ?`,
    ).get(user.id, fileId, dataset.data_kind, dataset.instrument, dataset.timeframe, dataset.source_symbol, dataset.end_time, dataset.start_time) as { count: number };
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

  if (!['needs_review', 'failed', 'ready'].includes(file.import_status)) {
    return c.json({ error: 'This source file is currently being processed and cannot be deleted yet.' }, 409);
  }
  const deletionClaim = db.prepare(
    `UPDATE market_data_files SET import_status = 'deleting'
     WHERE id = ? AND user_id = ? AND import_status = ?`,
  ).run(fileId, user.id, file.import_status);
  if (deletionClaim.changes !== 1) {
    return c.json({ error: 'This source file changed while deletion was being confirmed. Refresh and try again.' }, 409);
  }

  const previousStatus = file.import_status;
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
    db.prepare(
      `UPDATE market_data_files SET import_status = ?
       WHERE id = ? AND user_id = ? AND import_status = 'deleting'`,
    ).run(previousStatus, fileId, user.id);
    console.error('market data source deletion failed:', error);
    return c.json({ error: 'Failed to delete this market-data source. No trading data is affected.' }, 500);
  }
});

export default marketData;
