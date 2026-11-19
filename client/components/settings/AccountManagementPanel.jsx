const React = require('react');
const { useEffect, useState } = React;
const { authFetch } = require('../../helper.js');
const { BROKER_CONFIGS } = require('../../hooks/useBrokerConnection');

const AccountManagementPanel = ({ triggerReload }) => {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [drafts, setDrafts] = useState({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

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

  const act = async (account, action) => {
    if (action === 'clear' && !window.confirm(
      `Clear all trades for "${account.name}"? The account and its settings will remain. The source history will also be cleared so those trades cannot be reconstructed by the next sync.`
    )) return;
    if (action === 'delete' && !window.confirm(
      `Delete "${account.name}" completely? This removes its saved account settings and local trade history. The broker connection itself will remain connected.`
    )) return;
    setBusy(account.id); setError(''); setNotice('');
    try {
      const response = await authFetch('/api/account/managed-accounts/action', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: account.id, action }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Account action failed.');
      setNotice(action === 'clear'
        ? `Cleared ${Number(data.removedTrades || 0).toLocaleString()} trades from ${account.name}.`
        : `Deleted ${account.name} and its local trade history.`);
      await load(); triggerReload();
    } catch (err) { setError(err.message || 'Account action failed.'); }
    setBusy('');
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
    if (label === 'TradeZella') return '/assets/img/tradezella.svg';
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
      <div className="flex justify-end">
        <button onClick={load} disabled={loading || !!busy} className="px-3 py-2 rounded-lg border border-border text-text-primary text-sm disabled:opacity-50">{loading ? 'Loading…' : 'Refresh accounts'}</button>
      </div>
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
                    onClick={() => setExpandedProvider(isExpanded ? null : provider)}
                    className={`bg-bg-surface border rounded-xl p-4 flex flex-col items-center gap-2 text-center transition-all cursor-pointer ${
                      isExpanded ? 'border-accent ring-1 ring-accent/20' : 'border-border hover:border-accent/40 hover:bg-bg-page/50'
                    }`}
                  >
                    {providerIcon(provider) ? (
                      <img src={providerIcon(provider)} alt={providerLabel(provider)} className="w-10 h-10 rounded-lg object-contain" />
                    ) : (
                      <div className="w-10 h-10 rounded-lg bg-bg-page border border-border flex items-center justify-center text-text-primary font-semibold text-sm">
                        {providerLabel(provider).slice(0, 2).toUpperCase()}
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
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-text-primary font-semibold">{providerLabel(expandedProvider)} accounts</h3>
                  <span className="text-xs text-text-secondary">{groups[expandedProvider].length} {groups[expandedProvider].length === 1 ? 'account' : 'accounts'}</span>
                </div>
                {groups[expandedProvider].map(account => (
                  <div key={account.id} className="border border-border rounded-lg p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="text-text-primary text-sm font-medium">{account.name}</div>
                        <div className="text-text-tertiary text-xs mt-1">Source account: {account.sourceName}</div>
                      </div>
                      <div className="flex flex-wrap gap-3 text-xs text-text-secondary">
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
                      <button onClick={() => act(account, 'clear')} disabled={!!busy}
                        className="px-3 py-2 rounded-lg border border-warning/40 text-warning text-sm disabled:opacity-40">Clear trades</button>
                      <button onClick={() => act(account, 'delete')} disabled={!!busy}
                        className="px-3 py-2 rounded-lg border border-negative/40 text-negative text-sm disabled:opacity-40">Delete account</button>
                    </div>
                  </div>
                ))}
              </section>
            )}
          </>
        )}
      <div className="bg-bg-surface border border-border rounded-xl p-5">
        <h3 className="text-text-primary font-semibold mb-2">What these actions do</h3>
        <ul className="list-disc pl-5 space-y-1 text-sm text-text-secondary">
          <li><strong>Clear trades</strong> removes the account's imported trades and stored source history while retaining the account and its settings.</li>
          <li><strong>Delete account</strong> also removes the saved account identity/settings. It does not disconnect the broker connection.</li>
          <li>Trades linked to an existing journal trade are unlinked, not deleted.</li>
          <li>Other accounts and broker connections are left untouched.</li>
        </ul>
      </div>
    </div>
  );
};

module.exports = AccountManagementPanel;
