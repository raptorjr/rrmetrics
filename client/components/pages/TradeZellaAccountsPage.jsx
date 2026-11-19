const React = require('react');
const { useEffect, useState } = React;
const { authFetch } = require('../../helper.js');

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'CHF', 'JPY'];

const TradeZellaAccountsPage = ({ triggerReload }) => {
  const [accounts, setAccounts] = useState([]);
  const [rrAccounts, setRrAccounts] = useState([]);
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = async () => {
    setBusy(true);
    setError('');
    try {
      const response = await authFetch('/api/tradezella/accounts');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not load TradeZella accounts.');
      setAccounts((data.accounts || []).map(a => ({ ...a, isEval: !!a.isEval })));
      setRrAccounts(data.rrAccounts || []);
    } catch (err) { setError(err.message || 'Could not load accounts.'); }
    setBusy(false);
  };

  useEffect(() => { load(); }, []);

  const update = (name, key, value) => setAccounts(prev => prev.map(a =>
    a.sourceAccountName === name ? { ...a, [key]: value } : a
  ));

  const save = async (account) => {
    setSaving(account.sourceAccountName);
    setError('');
    setNotice('');
    try {
      const response = await authFetch('/api/tradezella/accounts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accounts: [{
          sourceAccountName: account.sourceAccountName,
          displayName: account.displayName,
          currencyCode: account.currencyCode,
          isEval: account.isEval,
          matchAccount: account.matchAccount || null,
        }] }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not save account settings.');
      setNotice(`Saved settings for ${account.displayName}.`);
    } catch (err) { setError(err.message || 'Could not save account settings.'); }
    setSaving('');
  };

  const remove = async (account) => {
    const confirmed = window.confirm(
      `Remove TradeZella account "${account.displayName}" (${account.sourceAccountName})?\n\nThis permanently deletes trades imported by TradeZella for this account and removes its source links and settings. Existing RR trades from Topstep or other sources that were only linked as matches will NOT be deleted.`
    );
    if (!confirmed) return;
    setSaving(account.sourceAccountName);
    setError('');
    setNotice('');
    try {
      const response = await authFetch(`/api/tradezella/accounts/${encodeURIComponent(account.sourceAccountName)}`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not remove this account.');
      setAccounts(prev => prev.filter(a => a.sourceAccountName !== account.sourceAccountName));
      setNotice(`Removed ${account.displayName}: ${Number(data.removedTrades || 0).toLocaleString()} imported trades deleted and ${Number(data.removedLinks || 0).toLocaleString()} source links cleared. Existing matched RR trades were kept.`);
      triggerReload();
    } catch (err) { setError(err.message || 'Could not remove account.'); }
    setSaving('');
  };

  const number = value => Number(value || 0).toLocaleString();

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <div className="text-xs uppercase tracking-wider text-text-muted font-semibold mb-2">Import tools</div>
        <h1 className="text-2xl font-semibold text-text-primary">TradeZella Accounts</h1>
        <p className="text-sm text-text-secondary mt-1">Manage imported TradeZella accounts, account settings and imported trade history.</p>
      </div>

      {error && <div className="rounded-lg border border-negative/30 bg-negative/10 text-negative px-4 py-3 text-sm">{error}</div>}
      {notice && <div className="rounded-lg border border-positive/30 bg-positive/10 text-positive px-4 py-3 text-sm">{notice}</div>}

      <section className="rounded-xl border border-border bg-bg-surface p-5">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="font-semibold text-text-primary">Managed accounts</h2>
            <p className="text-xs text-text-muted mt-1">Original source names are retained even when you change the display name.</p>
          </div>
          <button onClick={load} disabled={busy || !!saving} className="rounded-lg border border-border px-3 py-2 text-sm text-text-primary hover:bg-bg-page disabled:opacity-40">{busy ? 'Loading…' : 'Refresh'}</button>
        </div>

        {busy ? <p className="text-sm text-text-muted py-6">Loading accounts…</p>
          : accounts.length === 0 ? <div className="rounded-lg border border-dashed border-border p-8 text-center">
            <p className="text-sm font-medium text-text-primary">No TradeZella accounts yet</p>
            <p className="text-xs text-text-muted mt-1">Accounts will appear here after you import or save them from a CSV scan.</p>
          </div>
          : <div className="space-y-3">
            {accounts.map(account => (
              <div key={account.sourceAccountName} className="rounded-lg border border-border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                  <div>
                    <div className="font-medium text-text-primary">{account.displayName}</div>
                    <div className="text-xs text-text-muted mt-1">TradeZella source: {account.sourceAccountName}</div>
                  </div>
                  <div className="flex flex-wrap gap-4 text-xs">
                    <span className="text-positive">{number(account.importedTrades)} imported</span>
                    <span className="text-text-secondary">{number(account.linkedTrades)} linked to existing RR trades</span>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <label className="text-xs text-text-secondary">Display name
                    <input value={account.displayName} onChange={e => update(account.sourceAccountName, 'displayName', e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-bg-page px-3 py-2 text-sm text-text-primary" />
                  </label>
                  <label className="text-xs text-text-secondary">Currency
                    <select value={account.currencyCode} onChange={e => update(account.sourceAccountName, 'currencyCode', e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-bg-page px-3 py-2 text-sm text-text-primary">{CURRENCIES.map(c => <option key={c}>{c}</option>)}</select>
                  </label>
                  <label className="text-xs text-text-secondary">Match against existing RR account
                    <select value={account.matchAccount || ''} onChange={e => update(account.sourceAccountName, 'matchAccount', e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-bg-page px-3 py-2 text-sm text-text-primary">
                      <option value="">No matching — import as new</option>
                      {rrAccounts.map(name => <option key={name} value={name}>{name}</option>)}
                    </select>
                  </label>
                  <label className="flex items-center gap-2 text-sm text-text-primary"><input type="checkbox" checked={account.isEval} onChange={e => update(account.sourceAccountName, 'isEval', e.target.checked)} /> Evaluation account</label>
                </div>
                <div className="flex flex-wrap justify-end gap-2 mt-4 pt-3 border-t border-border">
                  <button disabled={!!saving || !account.displayName.trim()} onClick={() => save(account)} className="rounded-lg bg-accent text-accent-text px-4 py-2 text-sm font-medium disabled:opacity-40">{saving === account.sourceAccountName ? 'Working…' : 'Save settings'}</button>
                  <button disabled={!!saving} onClick={() => remove(account)} className="rounded-lg border border-negative/40 text-negative px-4 py-2 text-sm font-medium hover:bg-negative/10 disabled:opacity-40">Remove account and imported trades</button>
                </div>
              </div>
            ))}
          </div>}
      </section>

      <section className="rounded-xl border border-border bg-bg-surface p-5">
        <h2 className="font-semibold text-text-primary mb-2">Removal safeguards</h2>
        <ul className="list-disc pl-5 space-y-1 text-sm text-text-secondary">
          <li>Only trades created by the TradeZella importer are deleted.</li>
          <li>Topstep/ProjectX trades and manually entered trades are never deleted by this action.</li>
          <li>Links to existing RR trades are cleared, but the matched RR trades themselves are kept.</li>
          <li>Removing an account also removes its saved settings. You can add it again by scanning a CSV.</li>
        </ul>
      </section>
    </div>
  );
};

module.exports = TradeZellaAccountsPage;
