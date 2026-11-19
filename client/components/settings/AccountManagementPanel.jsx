const React = require('react');
const { useEffect, useState } = React;
const { authFetch } = require('../../helper.js');
const { BROKER_CONFIGS } = require('../../hooks/useBrokerConnection');
const { getTradePL } = require('../../utils/analytics');

const AccountManagementPanel = ({ triggerReload }) => {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [drafts, setDrafts] = useState({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);

  const load = async () => {
    setLoading(true); setError('');
    try {
      const response = await authFetch('/api/account/managed-accounts');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not load accounts.');
      setAccounts(data.accounts || []);
      setDrafts(Object.fromEntries((data.accounts || []).map(a => [a.id, a.name])));
    } catch (err) { setError(err.message || 'Could not load accounts.'); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const bulkAct = async (action) => {
    const selected = accounts.filter(account => selectedIds.includes(account.id));
    if (!selected.length) return;
    const verb = action === 'clear' ? 'clear trades for' : 'delete';
    if (!window.confirm(`${action === 'clear' ? 'Clear trades for' : 'Delete'} ${selected.length} selected account(s)? ${action === 'clear' ? 'Account settings will remain.' : 'Their local account settings and imported trade history will be removed.'}`)) return;
    setBusy('bulk'); setError(''); setNotice('');
    let completed = 0; const failures = [];
    for (const account of selected) {
      try {
        const response = await authFetch('/api/account/managed-accounts/action', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: account.id, action }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Action failed');
        completed += 1;
      } catch (error) { failures.push(`${account.name}: ${error.message}`); }
    }
    setNotice(`${action === 'clear' ? 'Cleared trades for' : 'Deleted'} ${completed} of ${selected.length} selected accounts.`);
    if (failures.length) setError(failures.join(' · '));
    setSelectedIds([]);
    await load(); triggerReload(); setBusy('');
  };

  const exportSelected = async () => {
    const selected = accounts.filter(account => selectedIds.includes(account.id));
    if (!selected.length) return;
    setBusy('export'); setError(''); setNotice('');
    try {
      const response = await authFetch('/api/getTrades');
      const data = await response.json();
      if (!response.ok || data.error) throw new Error(data.error || 'Could not load trades for export.');
      const accountNames = new Set(selected.flatMap(account => [account.name, account.sourceName].filter(Boolean).map(String)));
      const rows = (data.trades || []).filter(trade => accountNames.has(String(trade.account || 'Manual')));
      if (!rows.length) throw new Error('No trades were found for the selected accounts.');
      const headers = ['Account', 'Date', 'Ticker', 'Side', 'Quantity', 'Entry Price', 'Exit Price', 'Enter Time', 'Exit Time', 'Gross P/L', 'Fees', 'Commissions', 'Net P/L', 'Comments'];
      const quote = value => '"' + String(value ?? '').replace(/"/g, '""') + '"';
      const csvRows = rows.map(trade => [
        trade.account, trade.exitTime, trade.ticker, Number(trade.quantity) >= 0 ? 'Long' : 'Short',
        Math.abs(Number(trade.quantity) || 0), trade.enterPrice, trade.exitPrice,
        trade.enterTime, trade.exitTime, trade.grossPL, trade.fees, trade.commissions,
        getTradePL(trade), trade.comments,
      ].map(quote).join(','));
      const blob = new Blob([[headers.map(quote).join(','), ...csvRows].join('\n')], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `rr-metrics-${providerLabel(expandedProvider).toLowerCase().replace(/[^a-z0-9]+/g, '-')}-accounts-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      setNotice(`Exported ${rows.length} trades from ${selected.length} selected account(s).`);
    } catch (err) {
      setError(err.message || 'Could not export selected accounts.');
    } finally {
      setBusy('');
    }
  };

  const rename = async (account) => {
    const displayName = (drafts[account.id] || '').trim();
    if (!displayName || displayName === account.name) return;
    setBusy(account.id); setError(''); setNotice('');
    try {
      const response = await authFetch('/api/account/managed-accounts/action', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: account.id, action: 'rename', displayName }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not rename account.');
      setNotice(`Renamed account to ${displayName}.`);
      await load(); triggerReload();
    } catch (err) { setError(err.message || 'Could not rename account.'); }
    setBusy('');
  };

  const groups = accounts.reduce((out, account) => {
    const key = account.provider || 'Other';
    (out[key] ||= []).push(account);
    return out;
  }, {});
  const [expandedProvider, setExpandedProvider] = useState(null);
  const visibleAccounts = expandedProvider && groups[expandedProvider] ? groups[expandedProvider] : [];
  const toggleProvider = provider => { setExpandedProvider(current => current === provider ? null : provider); setSelectedIds([]); };
  const toggleVisibleSelection = checked => setSelectedIds(checked ? visibleAccounts.map(account => account.id) : []);
  const providerLabel = provider => {
    const normalized = String(provider || '').trim().toLowerCase().replace(/[ _-]+/g, '');
    if (['projectx', 'toptep', 'topstep'].includes(normalized)) return 'Topstep';
    if (normalized === 'tradezella') return 'TradeZella';
    const configured = Object.values(BROKER_CONFIGS).find(config =>
      config.key.toLowerCase().replace(/[ _-]+/g, '') === normalized
      || config.label.toLowerCase().replace(/[ _-]+/g, '') === normalized
    );
    return configured?.label || String(provider || 'Other').split(/[_\s-]+/).map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
  };
  const providerIcon = provider => {
    const label = providerLabel(provider);
    if (label === 'Topstep') return '/assets/img/topstep.png';
    if (label === 'TradeZella') return null;
    const normalized = String(provider || '').trim().toLowerCase().replace(/[ _-]+/g, '');
    const configured = Object.values(BROKER_CONFIGS).find(config =>
      config.key.toLowerCase().replace(/[ _-]+/g, '') === normalized
      || config.label.toLowerCase().replace(/[ _-]+/g, '') === normalized
    );
    return configured?.icon || null;
  };
  const providers = Object.keys(groups).sort((a, b) => providerLabel(a).localeCompare(providerLabel(b)));

  return (
    <div className="space-y-5">
      <p className="text-text-secondary text-sm">
        Manage accounts and their trade history across your connected providers. Account records remain available independently of broker connections.
      </p>
      {error && <div className="p-3 rounded-lg text-sm bg-negative/10 border border-negative/30 text-negative">{error}</div>}
      {notice && <div className="p-3 rounded-lg text-sm bg-positive/10 border border-positive/30 text-positive">{notice}</div>}
      {loading ? <div className="bg-bg-surface border border-border rounded-xl p-6 text-sm text-text-secondary">Loading accounts…</div>
        : accounts.length === 0 ? <div className="bg-bg-surface border border-border rounded-xl p-8 text-center">
          <div className="text-text-primary font-medium">No accounts found</div>
          <p className="text-text-secondary text-sm mt-1">Accounts will appear here when they have been configured or imported.</p>
        </div>
        : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
              {providers.map(provider => {
                const isExpanded = expandedProvider === provider;
                const count = groups[provider].length;
                return (
                  <button
                    key={provider}
                    onClick={() => toggleProvider(provider)}
                    className={`bg-bg-surface border rounded-xl p-4 flex flex-col items-center gap-2 text-center transition-all cursor-pointer ${
                      isExpanded ? 'border-accent ring-1 ring-accent/20' : 'border-border hover:border-accent/40 hover:bg-bg-page/50'
                    }`}
                  >
                    {providerIcon(provider) ? (
                      <img src={providerIcon(provider)} alt={providerLabel(provider)} className="w-10 h-10 rounded-lg object-contain" />
                    ) : (
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center font-bold text-sm tracking-tight ${providerLabel(provider) === 'TradeZella' ? 'bg-[#6d4aff]/15 border border-[#8b72ff]/30 text-[#a895ff]' : 'bg-bg-page border border-border text-text-primary font-semibold'}`}>
                        {providerLabel(provider) === 'TradeZella' ? 'TZ' : providerLabel(provider).slice(0, 2).toUpperCase()}
                      </div>
                    )}
                    <span className="text-text-primary font-semibold text-sm leading-tight">{providerLabel(provider)}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-text-secondary/10 text-text-secondary">
                      {count} {count === 1 ? 'account' : 'accounts'}
                    </span>
                  </button>
                );
              })}
            </div>
            {expandedProvider && groups[expandedProvider] && (
              <section className="bg-bg-surface border border-border rounded-xl p-5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div><h3 className="text-text-primary font-semibold">{providerLabel(expandedProvider)} accounts</h3><span className="text-xs text-text-secondary">{visibleAccounts.length} {visibleAccounts.length === 1 ? 'account' : 'accounts'}</span></div>
                  <label className="flex items-center gap-2 text-xs text-text-secondary"><input type="checkbox" checked={visibleAccounts.length > 0 && visibleAccounts.every(account => selectedIds.includes(account.id))} onChange={e => toggleVisibleSelection(e.target.checked)} className="w-4 h-4 rounded border-border text-accent focus:ring-accent" />Select all</label>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 bg-bg-page/50 border border-border rounded-lg p-3">
                  <span className="text-xs text-text-secondary">{selectedIds.length} {selectedIds.length === 1 ? 'account' : 'accounts'} selected</span>
                  <div className="flex gap-2">
                    <button onClick={exportSelected} disabled={!selectedIds.length || !!busy} className="px-3 py-2 rounded-lg border border-border text-text-secondary text-xs font-medium disabled:opacity-40" title="Download a CSV file containing trades from the selected accounts.">Export CSV</button>
                    <button onClick={() => bulkAct('clear')} disabled={!selectedIds.length || !!busy} className="px-3 py-2 rounded-lg border border-warning/40 text-warning text-xs font-medium disabled:opacity-40" title="Remove imported trades and stored source history for the selected accounts. The accounts and their settings will be kept.">Clear</button>
                    <button onClick={() => bulkAct('delete')} disabled={!selectedIds.length || !!busy} className="px-3 py-2 rounded-lg border border-negative/40 text-negative text-xs font-medium disabled:opacity-40" title="Permanently remove the selected accounts, their saved settings and imported trade history. This does not disconnect broker connections.">Delete</button>
                  </div>
                </div>
                {groups[expandedProvider].map(account => (
                  <div key={account.id} className={`border rounded-lg p-4 space-y-3 transition-all ${selectedIds.includes(account.id) ? 'border-accent ring-1 ring-accent/20' : 'border-border'}`}>
                    <div className="grid grid-cols-1 sm:grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
                      <label className="flex items-center gap-2 text-xs text-text-secondary"><input type="checkbox" checked={selectedIds.includes(account.id)} onChange={e => setSelectedIds(prev => e.target.checked ? [...prev, account.id] : prev.filter(id => id !== account.id))} className="w-4 h-4 rounded border-border text-accent focus:ring-accent" />Select</label>
                      <div className="min-w-0">
                        <div className="text-text-primary text-sm font-medium">{account.name}</div>
                        <div className="text-text-tertiary text-xs mt-1">Source account: {account.sourceName}</div>
                        {(account.accountType || account.currencyCode) && (
                          <div className="text-text-tertiary text-xs mt-1">
                            {[account.accountType === 'evaluation' ? 'Evaluation' : account.accountType === 'xfa' ? 'XFA' : account.accountType === 'live_funded' ? 'Live funded' : null, account.currencyCode].filter(Boolean).join(' · ')}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-3 text-xs text-text-secondary sm:justify-end">
                        <span>{Number(account.importedTrades || 0).toLocaleString()} trades</span>
                        {account.linkedTrades > 0 && <span>{Number(account.linkedTrades).toLocaleString()} linked matches</span>}
                        {account.rawExecutions > 0 && <span>{Number(account.rawExecutions).toLocaleString()} raw executions</span>}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-end gap-2">
                      <label className="flex-1 min-w-[180px] text-xs text-text-secondary">Display name
                        <input value={drafts[account.id] ?? account.name} onChange={e => setDrafts(prev => ({...prev,[account.id]:e.target.value}))}
                          className="mt-1 w-full px-3 py-2 bg-bg-input border border-border rounded-lg text-sm text-text-primary" />
                      </label>
                      <button onClick={() => rename(account)} disabled={!!busy || !(drafts[account.id] || '').trim() || drafts[account.id] === account.name}
                        className="px-3 py-2 rounded-lg bg-accent text-accent-text text-sm font-medium disabled:opacity-40">Save name</button>
                    </div>
                  </div>
                ))}
              </section>
            )}
          </>
        )}
      {expandedProvider && <div className="bg-bg-surface border border-border rounded-xl p-5">
        <h3 className="text-text-primary font-semibold mb-2">What these actions do</h3>
        <ul className="list-disc pl-5 space-y-1 text-sm text-text-secondary">
          <li><strong>Clear trades</strong> removes the account's imported trades and stored source history while retaining the account and its settings.</li>
          <li><strong>Delete account</strong> also removes the saved account identity/settings. It does not disconnect the broker connection.</li>
          <li>Trades linked to an existing journal trade are unlinked, not deleted.</li>
          <li>Other accounts and broker connections are left untouched.</li>
        </ul>
      </div>}
    </div>
  );
};

module.exports = AccountManagementPanel;
