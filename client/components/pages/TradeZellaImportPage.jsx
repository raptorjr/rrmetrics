const React = require('react');
const { useState } = React;
const Papa = require('papaparse');
const { authFetch } = require('../../helper.js');

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'CHF', 'JPY'];

const TradeZellaImportPage = ({ triggerReload }) => {
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [selected, setSelected] = useState([]);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const scanFile = async (file) => {
    setBusy(true); setError(''); setPreview(null); setResult(null);
    setFileName(file.name);
    Papa.parse(file, {
      header: true, skipEmptyLines: true,
      complete: async (parsed) => {
        if (parsed.errors.length) {
          setError('Could not read the CSV: ' + parsed.errors[0].message);
          setBusy(false); return;
        }
        try {
          const [savedResponse, previewResponse] = await Promise.all([
            authFetch('/api/tradezella/accounts'),
            authFetch('/api/tradezella/preview', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ rows: parsed.data }),
            }),
          ]);
          const savedData = await savedResponse.json();
          const previewData = await previewResponse.json();
          if (!previewResponse.ok) throw new Error(previewData.error || 'Could not scan this export.');
          const saved = new Map((savedData.accounts || []).map(a => [a.sourceAccountName, a]));
          const nextAccounts = previewData.accounts.map(a => {
            const old = saved.get(a.accountName);
            return {
              ...a,
              displayName: old?.displayName || a.displayName || a.accountName,
              currencyCode: old?.currencyCode || a.currencyCode || 'USD',
              isEval: old ? !!old.isEval : !!a.isEval,
            };
          });
          setRows(parsed.data);
          setAccounts(nextAccounts);
          setSelected(nextAccounts.map(a => a.accountName));
          setPreview(previewData);
        } catch (err) { setError(err.message || 'Scan failed.'); }
        setBusy(false);
      },
      error: (err) => { setError(err.message || 'Could not read the CSV.'); setBusy(false); },
    });
  };

  const updateAccount = (name, key, value) => setAccounts(prev => prev.map(a =>
    a.accountName === name ? { ...a, [key]: value } : a
  ));

  const runImport = async () => {
    setBusy(true); setError(''); setResult(null);
    try {
      const chosen = accounts.filter(a => selected.includes(a.accountName));
      const settings = chosen.map(a => ({
        sourceAccountName: a.accountName, displayName: a.displayName,
        currencyCode: a.currencyCode, isEval: a.isEval,
      }));
      const response = await authFetch('/api/tradezella/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows, selectedAccounts: selected, accounts: settings }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Import failed.');
      setResult(data); triggerReload();
    } catch (err) { setError(err.message || 'Import failed.'); }
    setBusy(false);
  };

  const total = accounts.filter(a => selected.includes(a.accountName)).reduce((sum, a) => sum + a.tradeCount, 0);
  const number = (value) => Number(value || 0).toLocaleString();

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <div className="text-xs uppercase tracking-wider text-text-muted font-semibold mb-2">Import tools</div>
        <h1 className="text-2xl font-semibold text-text-primary">TradeZella Import</h1>
        <p className="text-sm text-text-secondary mt-1">Scan an export, review account mapping and duplicate detection, then import only the accounts you choose.</p>
      </div>

      {error && <div className="rounded-lg border border-negative/30 bg-negative/10 text-negative px-4 py-3 text-sm">{error}</div>}

      {!preview && (
        <section className="rounded-xl border border-border bg-bg-surface p-6">
          <div className="flex items-start gap-4">
            <div className="rounded-lg bg-accent/10 text-accent p-3"><span className="text-xl">⇧</span></div>
            <div className="flex-1">
              <h2 className="font-semibold text-text-primary">Upload TradeZella CSV</h2>
              <p className="text-sm text-text-secondary mt-1 mb-4">The file is scanned first. No trades are added until you confirm the import.</p>
              <label className="inline-flex items-center gap-2 rounded-lg bg-accent text-accent-text px-4 py-2.5 text-sm font-medium cursor-pointer hover:brightness-110">
                {busy ? 'Scanning…' : 'Choose CSV file'}
                <input type="file" accept=".csv,text/csv" className="hidden" disabled={busy} onChange={e => e.target.files?.[0] && scanFile(e.target.files[0])} />
              </label>
            </div>
          </div>
        </section>
      )}

      {preview && !result && (
        <>
          <section className="rounded-xl border border-border bg-bg-surface p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="font-semibold text-text-primary">File scan</h2>
                <p className="text-xs text-text-muted mt-1">{fileName} · {number(preview.validTrades)} valid trades · {number(preview.skippedRows)} skipped rows</p>
              </div>
              <button className="text-sm text-text-secondary hover:text-text-primary underline" onClick={() => { setPreview(null); setRows([]); setAccounts([]); setSelected([]); }}>Choose another file</button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                ['Accounts', accounts.length],
                ['Selected trades', total],
                ['Already imported', accounts.filter(a => selected.includes(a.accountName)).reduce((n,a)=>n+a.alreadyImported,0)],
                ['Needs review', accounts.filter(a => selected.includes(a.accountName)).reduce((n,a)=>n+a.needsReview,0)],
              ].map(([label, value]) => <div key={label} className="rounded-lg bg-bg-page border border-border p-3"><div className="text-xs text-text-muted">{label}</div><div className="text-xl font-semibold text-text-primary mt-1">{number(value)}</div></div>)}
            </div>
          </section>

          <section className="rounded-xl border border-border bg-bg-surface p-5">
            <div className="flex items-center justify-between mb-4">
              <div><h2 className="font-semibold text-text-primary">Accounts to import</h2><p className="text-xs text-text-muted mt-1">Choose accounts and set their RR Metrics account details.</p></div>
              <button className="text-xs text-accent" onClick={() => setSelected(selected.length === accounts.length ? [] : accounts.map(a => a.accountName))}>{selected.length === accounts.length ? 'Deselect all' : 'Select all'}</button>
            </div>
            <div className="space-y-3">
              {accounts.map(a => {
                const checked = selected.includes(a.accountName);
                return <div key={a.accountName} className={`rounded-lg border p-4 ${checked ? 'border-accent/50 bg-accent/5' : 'border-border'}`}>
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                    <label className="flex items-center gap-3 text-sm font-medium text-text-primary cursor-pointer">
                      <input type="checkbox" checked={checked} onChange={e => setSelected(prev => e.target.checked ? [...prev, a.accountName] : prev.filter(x => x !== a.accountName))} />
                      <span>{a.accountName}</span>
                      <span className="text-xs text-text-muted font-normal">{number(a.tradeCount)} trades</span>
                    </label>
                    <div className="flex flex-wrap gap-3 text-xs">
                      <span className="text-positive">{number(a.alreadyImported)} already in RR</span>
                      <span className="text-accent">{number(a.newTrades)} new</span>
                      <span className={a.needsReview ? 'text-negative' : 'text-text-muted'}>{number(a.needsReview)} review</span>
                    </div>
                  </div>
                  {checked && <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <label className="text-xs text-text-secondary">Display name
                      <input value={a.displayName} onChange={e => updateAccount(a.accountName, 'displayName', e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-bg-page px-3 py-2 text-sm text-text-primary" />
                    </label>
                    <label className="text-xs text-text-secondary">Currency
                      <select value={a.currencyCode} onChange={e => updateAccount(a.accountName, 'currencyCode', e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-bg-page px-3 py-2 text-sm text-text-primary">{CURRENCIES.map(c => <option key={c}>{c}</option>)}</select>
                    </label>
                    <label className="flex items-center gap-2 text-sm text-text-primary self-end pb-2"><input type="checkbox" checked={a.isEval} onChange={e => updateAccount(a.accountName, 'isEval', e.target.checked)} /> Evaluation account</label>
                  </div>}
                </div>;
              })}
            </div>
          </section>

          <section className="rounded-xl border border-border bg-bg-surface p-5">
            <h2 className="font-semibold text-text-primary mb-2">Import safeguards</h2>
            <ul className="list-disc pl-5 space-y-1 text-sm text-text-secondary">
              <li>Exact and consolidated position matches are linked to existing RR trades instead of duplicated.</li>
              <li>Rows with uncertain matches are held for review and are not imported automatically.</li>
              <li>Original TradeZella account names are retained in the import source mapping.</li>
              <li>Currency is not included in the export; confirm the currency for each account above.</li>
            </ul>
            <div className="flex flex-wrap items-center justify-between gap-3 mt-5 pt-4 border-t border-border">
              <div className="text-sm text-text-secondary">{number(total)} source trades in selected accounts</div>
              <button disabled={busy || !selected.length || selected.some(name => { const a=accounts.find(x=>x.accountName===name); return !a || !a.displayName.trim(); })} onClick={runImport} className="rounded-lg bg-accent text-accent-text px-5 py-2.5 text-sm font-semibold disabled:opacity-40">{busy ? 'Importing…' : 'Import selected accounts'}</button>
            </div>
          </section>
        </>
      )}

      {result && <section className="rounded-xl border border-border bg-bg-surface p-6">
        <h2 className="text-lg font-semibold text-text-primary">Import complete</h2>
        <p className="text-sm text-text-secondary mt-1 mb-5">The selected source accounts have been processed.</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[['Imported', result.imported],['Linked to existing',result.linked],['Already imported',result.alreadyImported],['Held for review',result.needsReview]].map(([label,value])=><div key={label} className="rounded-lg bg-bg-page border border-border p-3"><div className="text-xs text-text-muted">{label}</div><div className="text-xl font-semibold text-text-primary mt-1">{number(value)}</div></div>)}
        </div>
        <button className="mt-5 rounded-lg border border-border px-4 py-2 text-sm text-text-primary hover:bg-bg-page" onClick={() => { setPreview(null); setRows([]); setAccounts([]); setSelected([]); setResult(null); }}>Import another export</button>
      </section>}
    </div>
  );
};

module.exports = TradeZellaImportPage;
