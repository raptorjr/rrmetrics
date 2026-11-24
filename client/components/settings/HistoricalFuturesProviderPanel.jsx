const React = require('react');
const { useState, useEffect } = React;
const { authFetch } = require('../../helper.js');

const TIME_ZONE_OPTIONS = (() => {
  try {
    if (typeof Intl.supportedValuesOf === 'function') {
      return [...new Set(['UTC', ...Intl.supportedValuesOf('timeZone')])].sort((a, b) => a.localeCompare(b));
    }
  } catch {}
  return ['UTC', 'Europe/Oslo', 'Europe/Stockholm', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles'];
})();

const INSTRUMENT_ROOTS = ['MNQ', 'NQ', 'MES', 'ES', 'MGC', 'GC', 'MYM', 'YM', 'M2K', 'RTY', 'MCL', 'CL', '6E', '6B', '6J'];
const instrumentFromSymbol = (symbol) => INSTRUMENT_ROOTS.find(root => symbol?.startsWith(root)) || '';

const formatBytes = (bytes) => {
  if (!Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};
const formatDate = (value) => value ? new Date(value).toLocaleString() : '—';
const formatNumber = (value) => Number(value || 0).toLocaleString();

const statusLabel = (status) => ({
  ready: 'Ready',
  needs_review: 'Needs review',
  inspecting: 'Processing',
  deleting: 'Deleting',
  failed: 'Failed',
}[status] || status || 'Unknown');

const HistoricalFuturesProviderPanel = () => {
  const [provider, setProvider] = useState(null);
  const [files, setFiles] = useState([]);
  const [selectedFileId, setSelectedFileId] = useState(null);
  const [inspection, setInspection] = useState(null);
  const [uploadFiles, setUploadFiles] = useState([]);
  const [form, setForm] = useState({
    instrument: '',
    timeframe: '',
    timezone: '',
    sourceSymbol: '',
    skipInvalidRows: false,
  });
  const [deletePrompt, setDeletePrompt] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadFiles = async (providerId) => {
    if (!providerId) {
      setFiles([]);
      return [];
    }
    const response = await authFetch(`/api/market-data/providers/${providerId}/files`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to load historical data files.');
    setFiles(data.files || []);
    return data.files || [];
  };

  const loadProvider = async () => {
    try {
      const response = await authFetch('/api/market-data/providers');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to load providers.');
      const current = (data.providers || []).find(item => item.provider_type === 'historical_futures') || null;
      setProvider(current);
      if (current) await loadFiles(current.id);
    } catch (err) {
      setError(err.message || 'Unable to load Historical Futures.');
    }
  };

  useEffect(() => { loadProvider(); }, []);

  const selectedFile = files.find(file => file.id === selectedFileId) || null;
  const datasets = selectedFile?.datasets || [];
  const detectedSymbols = inspection?.detectedSymbols || [];
  const remainingSymbols = detectedSymbols.filter(symbol => !datasets.some(dataset => dataset.source_symbol === symbol));
  const timezoneRequired = Boolean(inspection?.timezoneNeedsConfirmation);
  const invalidRows = Number(inspection?.invalidRowCount || 0);
  const needsSymbolChoice = detectedSymbols.length > 1;
  const canImport = Boolean(
    selectedFile &&
    ['needs_review', 'failed'].includes(selectedFile.import_status) &&
    form.instrument.trim() &&
    (inspection?.dataKind === 'ticks' ? form.timeframe === 'tick' : /^\d+(s|m|h|d)$/.test(form.timeframe.trim())) &&
    (!timezoneRequired || form.timezone) &&
    (!invalidRows || form.skipInvalidRows) &&
    (!needsSymbolChoice || form.sourceSymbol),
  );

  const selectFile = (file) => {
    setSelectedFileId(file.id);
    const metadata = file.detectedMetadata || {};
    const symbols = metadata.detectedSymbols || [];
    const imported = (file.datasets || []).map(dataset => dataset.source_symbol).filter(Boolean);
    const nextSymbol = symbols.find(symbol => !imported.includes(symbol)) || symbols[0] || '';
    setInspection(metadata);
    setForm({
      instrument: metadata.detectedInstrument || instrumentFromSymbol(nextSymbol),
      timeframe: metadata.detectedTimeframe || '',
      timezone: metadata.timezone === 'explicit' ? 'UTC' : (metadata.timezone || ''),
      sourceSymbol: nextSymbol,
      skipInvalidRows: false,
    });
    setError('');
    setNotice('');
  };

  const handleUpload = async () => {
    if (!uploadFiles.length || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    let uploaded = 0;
    let currentProviderId = provider?.id || null;
    let lastFileId = null;
    try {
      for (const file of uploadFiles) {
        const body = new FormData();
        body.append('file', file);
        const response = await authFetch('/api/market-data/files/inspect', { method: 'POST', body });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || `Unable to inspect ${file.name}.`);
        currentProviderId = data.file.providerId;
        lastFileId = data.file.id;
        setProvider({ id: currentProviderId, provider_type: 'historical_futures', display_name: 'Historical Futures' });
        uploaded += 1;
      }
      setProvider({ id: currentProviderId, provider_type: 'historical_futures', display_name: 'Historical Futures' });
      const refreshed = await loadFiles(currentProviderId);
      const latest = refreshed.find(file => file.id === lastFileId);
      if (latest) selectFile(latest);
      setUploadFiles([]);
      setNotice(`Inspected ${uploaded} file${uploaded === 1 ? '' : 's'}. Review the detected metadata before importing.`);
    } catch (err) {
      setError(err.message || 'Upload failed.');
      if (currentProviderId) {
        setProvider({ id: currentProviderId, provider_type: 'historical_futures', display_name: 'Historical Futures' });
        await loadFiles(currentProviderId).catch(() => undefined);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleImport = async () => {
    if (!selectedFile || !canImport || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await authFetch(`/api/market-data/files/${selectedFile.id}/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instrument: form.instrument.trim(),
          timeframe: form.timeframe.trim(),
          timezone: form.timezone || undefined,
          sourceSymbol: form.sourceSymbol || undefined,
          skipInvalidRows: form.skipInvalidRows,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Import failed.');
      const refreshed = await loadFiles(provider.id);
      const updated = refreshed.find(file => file.id === selectedFile.id);
      if (updated) {
        setSelectedFileId(updated.id);
        setInspection(updated.detectedMetadata || inspection);
        const next = data.remainingSymbols?.[0] || '';
        setForm(previous => ({
          ...previous,
          sourceSymbol: next,
          instrument: next ? (updated.detectedMetadata?.detectedInstrument || instrumentFromSymbol(next) || previous.instrument) : previous.instrument,
        }));
      }
      setNotice(`Imported ${formatNumber(data.dataset.rowCount)} ${data.dataset.dataKind === 'ticks' ? 'tick events' : 'bars'} for ${data.dataset.instrument}${data.dataset.sourceSymbol ? ` (${data.dataset.sourceSymbol})` : ''}.${data.remainingSymbols?.length ? ` ${data.remainingSymbols.length} source symbol(s) remain to be imported.` : ''}`);
    } catch (err) {
      setError(err.message || 'Import failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleDeletePreview = async (file) => {
    setBusy(true);
    setError('');
    try {
      const response = await authFetch(`/api/market-data/files/${file.id}`, { method: 'DELETE' });
      const data = await response.json();
      if (response.status === 409 && data.requiresConfirmation) {
        setDeletePrompt({ file, impact: data.impact });
      } else if (!response.ok) {
        throw new Error(data.error || 'Unable to prepare source deletion.');
      }
    } catch (err) {
      setError(err.message || 'Unable to prepare source deletion.');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deletePrompt || busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await authFetch(`/api/market-data/files/${deletePrompt.file.id}?confirm=true`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Source deletion failed.');
      if (selectedFileId === deletePrompt.file.id) {
        setSelectedFileId(null);
        setInspection(null);
      }
      await loadFiles(provider.id);
      setNotice('The selected source file and its owned datasets were deleted. Other overlapping sources were retained.');
      setDeletePrompt(null);
    } catch (err) {
      setError(err.message || 'Source deletion failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {error && <div className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>}
      {notice && <div className="rounded-lg border border-positive/30 bg-positive/10 px-4 py-3 text-sm text-positive">{notice}</div>}

      <div className="rounded-xl border border-border bg-bg-page/40 p-4 space-y-3">
        <div>
          <h4 className="text-sm font-semibold text-text-primary">Add historical market data</h4>
          <p className="mt-1 text-xs text-text-tertiary">Upload CSV or Parquet OHLCV files. Original files and normalized datasets remain independently traceable.</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
          <input
            type="file"
            multiple
            accept=".csv,.parquet"
            onChange={event => setUploadFiles(Array.from(event.target.files || []))}
            className="block w-full text-sm text-text-secondary file:mr-3 file:rounded-lg file:border file:border-border file:bg-bg-surface file:px-3 file:py-2 file:text-xs file:font-medium file:text-text-primary"
          />
          <button
            onClick={handleUpload}
            disabled={!uploadFiles.length || busy}
            className="shrink-0 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-accent-text disabled:opacity-50"
          >
            {busy ? 'Working…' : `Inspect ${uploadFiles.length || ''} file${uploadFiles.length === 1 ? '' : 's'}`}
          </button>
        </div>
        <p className="text-[11px] text-text-tertiary">Maximum 100 MB per file. Uploading only stages the file; nothing is imported until you confirm the metadata.</p>
      </div>

      <div className="rounded-xl border border-border bg-bg-surface overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border">
          <div>
            <h4 className="text-sm font-semibold text-text-primary">Source files</h4>
            <p className="text-xs text-text-tertiary">{files.length} file{files.length === 1 ? '' : 's'} · each file owns its own datasets</p>
          </div>
          <button onClick={() => provider?.id && loadFiles(provider.id)} disabled={!provider?.id || busy} className="text-xs text-accent hover:underline disabled:opacity-50">Refresh</button>
        </div>
        {files.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-text-tertiary">No historical files have been uploaded yet.</div>
        ) : (
          <div className="divide-y divide-border">
            {files.map(file => (
              <div key={file.id} className={`px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3 ${selectedFileId === file.id ? 'bg-bg-page/50' : ''}`}>
                <button onClick={() => selectFile(file)} className="min-w-0 flex-1 text-left">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium text-text-primary">{file.original_filename}</span>
                    <span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${file.import_status === 'ready' ? 'bg-positive/10 text-positive' : file.import_status === 'failed' ? 'bg-danger/10 text-danger' : 'bg-warning/10 text-warning'}`}>{statusLabel(file.import_status)}</span>
                  </div>
                  <div className="mt-1 text-xs text-text-tertiary">
                    {file.input_format.toUpperCase()} · {formatBytes(file.file_size_bytes)} · uploaded {formatDate(file.created_at)}
                  </div>
                  {file.last_error && (
                    <div className="mt-1 text-xs text-danger">{file.last_error}</div>
                  )}
                  {file.datasets?.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {file.datasets.map(dataset => (
                        <span key={dataset.id} className="rounded-md border border-border bg-bg-page px-2 py-1 text-[10px] text-text-secondary">
                          {dataset.instrument}{dataset.source_symbol ? ` · ${dataset.source_symbol}` : ''} · {dataset.timeframe} · {formatNumber(dataset.row_count)} {dataset.data_kind === 'ticks' ? 'events' : 'bars'}
                        </span>
                      ))}
                    </div>
                  )}
                </button>
                <button onClick={() => handleDeletePreview(file)} disabled={busy} className="shrink-0 rounded-lg border border-border px-3 py-2 text-xs font-medium text-text-secondary hover:border-danger/40 hover:text-danger disabled:opacity-50">Delete source</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {selectedFile && inspection && (
        <div className="rounded-xl border border-border bg-bg-surface overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h4 className="text-sm font-semibold text-text-primary">Review import</h4>
                <p className="mt-0.5 text-xs text-text-tertiary">{selectedFile.original_filename}</p>
              </div>
              <span className="text-xs text-text-tertiary">{inspection.format?.toUpperCase()} · {formatNumber(inspection.rowCount)} rows</span>
            </div>
          </div>
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                [inspection.dataKind === 'ticks' ? 'Valid events' : 'Valid rows', formatNumber(inspection.validRowCount)],
                [inspection.dataKind === 'ticks' ? 'Invalid events' : 'Invalid rows', formatNumber(inspection.invalidRowCount)],
                ['Data type', inspection.dataKind === 'ticks' ? 'Tick events' : 'OHLCV bars'],
                ['Detected timeframe', inspection.detectedTimeframe || 'Unknown'],
                ['Coverage', inspection.startTime && inspection.endTime ? `${new Date(inspection.startTime).toLocaleDateString()} – ${new Date(inspection.endTime).toLocaleDateString()}` : 'Unknown'],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg bg-bg-page/60 p-3">
                  <div className="text-[10px] uppercase tracking-wide text-text-tertiary">{label}</div>
                  <div className="mt-1 text-sm font-semibold text-text-primary">{value}</div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="space-y-1.5">
                <span className="text-xs font-medium text-text-secondary">Canonical instrument</span>
                <input value={form.instrument} onChange={event => setForm(previous => ({ ...previous, instrument: event.target.value.toUpperCase() }))} placeholder="e.g. NQ" className="w-full rounded-lg border border-border bg-bg-page px-3 py-2 text-sm text-text-primary" />
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-medium text-text-secondary">Timeframe</span>
                <input value={form.timeframe} disabled={inspection.dataKind === 'ticks'} onChange={event => setForm(previous => ({ ...previous, timeframe: event.target.value }))} placeholder="e.g. 1m" className="w-full rounded-lg border border-border bg-bg-page px-3 py-2 text-sm text-text-primary disabled:opacity-70" />
              </label>
              {needsSymbolChoice && (
                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-text-secondary">Source symbol · {remainingSymbols.length} remaining</span>
                  <select value={form.sourceSymbol} onChange={event => setForm(previous => ({ ...previous, sourceSymbol: event.target.value, instrument: instrumentFromSymbol(event.target.value) || previous.instrument }))} className="w-full rounded-lg border border-border bg-bg-page px-3 py-2 text-sm text-text-primary">
                    {remainingSymbols.map(symbol => <option key={symbol} value={symbol}>{symbol}</option>)}
                  </select>
                </label>
              )}
              {timezoneRequired && (
                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-text-secondary">Source timezone · required</span>
                  <select value={form.timezone} onChange={event => setForm(previous => ({ ...previous, timezone: event.target.value }))} className="w-full rounded-lg border border-border bg-bg-page px-3 py-2 text-sm text-text-primary">
                    <option value="">Select timezone…</option>
                    {TIME_ZONE_OPTIONS.map(zone => <option key={zone} value={zone}>{zone}</option>)}
                  </select>
                </label>
              )}
            </div>

            {inspection.invalidRowCount > 0 && (
              <label className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs text-text-secondary">
                <input type="checkbox" checked={form.skipInvalidRows} onChange={event => setForm(previous => ({ ...previous, skipInvalidRows: event.target.checked }))} className="mt-0.5" />
                <span>Import the valid rows and skip {formatNumber(inspection.invalidRowCount)} invalid/duplicate rows. This is an explicit decision; no invalid rows are silently discarded.</span>
              </label>
            )}

            {inspection.potentialOverlaps?.length > 0 && (
              <div className="rounded-lg border border-warning/30 bg-warning/5 p-3 space-y-2">
                <div className="text-xs font-semibold text-text-primary">Potential source overlaps</div>
                <p className="text-xs text-text-secondary">These datasets cover overlapping dates for the same instrument, timeframe and source symbol. Both files will remain stored independently; Chart Replay will require explicit source selection where the ranges overlap.</p>
                <ul className="space-y-1">
                  {inspection.potentialOverlaps.map(item => (
                    <li key={item.datasetId} className="text-xs text-text-secondary">
                      <span className="font-medium text-text-primary">{item.filename}</span> · {item.instrument}{item.sourceSymbol ? ' · ' + item.sourceSymbol : ''} · {item.timeframe} · {formatDate(item.startTime)} – {formatDate(item.endTime)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {inspection.warnings?.length > 0 && (
              <div className="space-y-1">
                {inspection.warnings.map((warning, index) => <p key={index} className="text-xs text-warning">{warning}</p>)}
              </div>
            )}
            {inspection.errors?.length > 0 && (
              <details className="rounded-lg border border-border p-3">
                <summary className="cursor-pointer text-xs font-medium text-text-secondary">Inspection errors ({inspection.errors.length})</summary>
                <ul className="mt-2 space-y-1 text-xs text-text-tertiary">
                  {inspection.errors.map((item, index) => <li key={index}>{item}</li>)}
                </ul>
              </details>
            )}
            {inspection.dataKind === 'ticks' && inspection.sample?.length > 0 && (
              <div className="overflow-x-auto">
                <div className="mb-2 text-xs font-medium text-text-secondary">Tick preview · first valid events</div>
                <table className="w-full text-xs">
                  <thead><tr className="text-text-tertiary border-b border-border">
                    <th className="py-2 pr-3 text-left">Timestamp</th>
                    <th className="py-2 px-2 text-right">Price</th>
                    <th className="py-2 px-2 text-right">Size</th>
                    <th className="py-2 px-2 text-right">Bid size</th>
                    <th className="py-2 px-2 text-right">Ask size</th>
                    <th className="py-2 px-2 text-right">Trades</th>
                    <th className="py-2 pl-2 text-left">Symbol / exchange</th>
                  </tr></thead>
                  <tbody>{inspection.sample.slice(0, 5).map((tick, index) => (
                    <tr key={index} className="border-b border-border/60 text-text-secondary">
                      <td className="py-2 pr-3 whitespace-nowrap">{formatDate(new Date(tick.timestamp).toISOString())}</td>
                      {[tick.price, tick.size, tick.bidSize, tick.askSize, tick.tradeCount].map((value, i) => <td key={i} className="py-2 px-2 text-right tabular-nums">{value == null ? '—' : Number(value).toLocaleString()}</td>)}
                      <td className="py-2 pl-2 whitespace-nowrap">{tick.sourceSymbol || '—'}{tick.exchange ? ' / ' + tick.exchange : ''}</td>
                    </tr>
                  ))}</tbody>
                </table>
                <p className="mt-2 text-[11px] text-text-tertiary">Nanosecond timestamps and event order are retained. Repeated timestamps are not deduplicated or converted into candles.</p>
              </div>
            )}
            {inspection.dataKind !== 'ticks' && inspection.sample?.length > 0 && (
              <div className="overflow-x-auto">
                <div className="mb-2 text-xs font-medium text-text-secondary">Preview · first valid rows</div>
                <table className="w-full text-xs">
                  <thead><tr className="text-text-tertiary border-b border-border">
                    <th className="py-2 pr-3 text-left">Timestamp</th><th className="py-2 px-2 text-right">Open</th><th className="py-2 px-2 text-right">High</th><th className="py-2 px-2 text-right">Low</th><th className="py-2 px-2 text-right">Close</th><th className="py-2 pl-2 text-right">Volume</th>
                  </tr></thead>
                  <tbody>{inspection.sample.slice(0, 5).map((bar, index) => (
                    <tr key={index} className="border-b border-border/60 text-text-secondary">
                      <td className="py-2 pr-3 whitespace-nowrap">{formatDate(new Date(bar.timestamp).toISOString())}</td>
                      {[bar.open,bar.high,bar.low,bar.close,bar.volume].map((value, i) => <td key={i} className="py-2 px-2 text-right tabular-nums">{value == null ? '—' : Number(value).toLocaleString()}</td>)}
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}

            {selectedFile.import_status !== 'ready' && (
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-border">
                <p className="text-xs text-text-tertiary">Each source symbol becomes a separate dataset owned by this file.</p>
                <button onClick={handleImport} disabled={!canImport || busy} className="rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-accent-text disabled:opacity-50">
                  {busy ? 'Importing…' : 'Confirm and import dataset'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {deletePrompt && (
        <div className="rounded-xl border border-danger/30 bg-danger/5 p-4 space-y-3">
          <div>
            <h4 className="text-sm font-semibold text-text-primary">Confirm source deletion</h4>
            <p className="mt-1 text-xs text-text-secondary">This removes only the selected file and the datasets it owns. Other source files remain intact.</p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <div><div className="text-text-tertiary">Datasets</div><div className="font-semibold text-text-primary">{formatNumber(deletePrompt.impact.datasetCount)}</div></div>
            <div><div className="text-text-tertiary">Rows</div><div className="font-semibold text-text-primary">{formatNumber(deletePrompt.impact.totalRows)}</div></div>
            <div><div className="text-text-tertiary">Overlapping sources retained</div><div className="font-semibold text-text-primary">{formatNumber(deletePrompt.impact.overlappingDatasetsRetained)}</div></div>
            <div><div className="text-text-tertiary">File</div><div className="font-semibold text-text-primary truncate">{deletePrompt.impact.filename}</div></div>
          </div>
          {deletePrompt.impact.datasets?.length > 0 ? (
            <ul className="space-y-1 rounded-lg border border-border bg-bg-surface p-3">
              {deletePrompt.impact.datasets.map(dataset => (
                <li key={dataset.id} className="text-xs text-text-secondary">
                  <span className="font-medium text-text-primary">{dataset.instrument}{dataset.source_symbol ? ' · ' + dataset.source_symbol : ''}</span> · {dataset.timeframe} · {formatNumber(dataset.row_count)} rows · {formatDate(dataset.start_time)} – {formatDate(dataset.end_time)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-text-tertiary">This is a staged upload with no normalized datasets yet.</p>
          )}
          <div className="flex justify-end gap-2">
            <button onClick={() => setDeletePrompt(null)} className="rounded-lg border border-border px-3 py-2 text-xs text-text-secondary">Cancel</button>
            <button onClick={handleDeleteConfirm} disabled={busy} className="rounded-lg bg-danger px-3 py-2 text-xs font-medium text-white disabled:opacity-50">Delete file and owned datasets</button>
          </div>
        </div>
      )}
    </div>
  );
};

module.exports = HistoricalFuturesProviderPanel;
