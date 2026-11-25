const React = require('react');
const { useState, useMemo } = React;
const { Popover, PopoverTrigger, PopoverContent } = require('../ui/popover');
const { Avatar, AvatarFallback } = require('../ui/avatar');
const { Check, ChevronsUpDown } = require('lucide-react');
const { cn } = require('../../lib/utils');
const { NO_ACCOUNTS, getTradeAccountEntries } = require('../../utils/accountIdentity');

const BROKER_ICONS = {
  tradovate: { icon: '/assets/img/tradovate.png', label: 'Tradovate' },
  ninjatrader: { icon: '/assets/img/ninjatrader.jpeg', label: 'NinjaTrader' },
  alpha_futures: { icon: '/assets/img/alphafutures.png', label: 'Alpha Futures' },
  apex_trader_funding: { icon: '/assets/img/apex.png', label: 'Apex Trader Funding' },
  tradeify: { icon: '/assets/img/tradeify.png', label: 'Tradeify' },
  my_funded_futures: { icon: '/assets/img/myfundedfutures.png', label: 'My Funded Futures' },
  lucid_trading: { icon: '/assets/img/lucidtrading.png', label: 'Lucid Trading' },
  top_one_futures: { icon: '/assets/img/toponefutures.png', label: 'Top One Futures' },
  fundednext_futures: { icon: '/assets/img/fundednext.png', label: 'FundedNext Futures' },
  blue_guardian: { icon: '/assets/img/blueguardian.png', label: 'Blue Guardian Futures' },
  robinhood: { icon: '/assets/img/robinhood.svg', label: 'Robinhood' },
  webull: { icon: '/assets/img/webull.svg', label: 'Webull' },
  projectx: { icon: '/assets/img/topstep.png', label: 'Topstep' },
  tradezella: { icon: null, label: 'TradeZella' },
  replay: { icon: null, label: 'Replay sessions' },
};

const AccountSwitcher = ({ trades, selectedAccounts, setSelectedAccounts, collapsed, accountBrokers, accountMode='trading', onAccountModeChange, replayAccounts=[], loading=false }) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const accountEntries = useMemo(() => accountMode==='backtesting'?replayAccounts:getTradeAccountEntries(trades || [], accountBrokers || {}), [trades, accountBrokers,accountMode,replayAccounts]);
  const accounts = accountEntries;

  const groups = useMemo(() => {
    const grouped = {};
    for (const account of accountEntries) (grouped[account.provider] ||= []).push(account);
    return Object.entries(grouped).sort((a, b) => {
      const labelA = BROKER_ICONS[a[0]]?.label || (a[0] === 'manual' ? 'Manual / Other' : a[0]);
      const labelB = BROKER_ICONS[b[0]]?.label || (b[0] === 'manual' ? 'Manual / Other' : b[0]);
      return labelA.localeCompare(labelB);
    });
  }, [accountEntries]);

  const isAllSelected = selectedAccounts.length === 0;
  const isNoneSelected = selectedAccounts.includes(NO_ACCOUNTS);
  const selectedSet = new Set(isAllSelected ? accounts.map(account => account.key) : selectedAccounts.filter(a => a !== NO_ACCOUNTS));

  const toggleAll = () => {
    setSelectedAccounts(isAllSelected ? [NO_ACCOUNTS] : []);
  };

  const selectAllAndClose = () => {
    setSelectedAccounts([]);
    setOpen(false);
  };

  const toggleAccount = (account) => {
    setSelectedAccounts(prev => {
      const next = new Set(prev.length === 0 ? accounts.map(item => item.key) : prev.filter(a => a !== NO_ACCOUNTS));
      if (next.has(account.key)) next.delete(account.key); else next.add(account.key);
      return next.size ? [...next] : [NO_ACCOUNTS];
    });
  };

  const toggleProvider = (providerAccounts) => {
    setSelectedAccounts(prev => {
      const next = new Set(prev.length === 0 ? accounts.map(item => item.key) : prev.filter(a => a !== NO_ACCOUNTS));
      const allInGroupSelected = providerAccounts.every(account => next.has(account.key));
      if (allInGroupSelected) providerAccounts.forEach(account => next.delete(account.key));
      else providerAccounts.forEach(account => next.add(account.key));
      return next.size ? [...next] : [NO_ACCOUNTS];
    });
  };

  const filteredGroups = groups.map(([key, list]) => [key, list.filter(account => !search || account.name.toLowerCase().includes(search.toLowerCase()))]).filter(([, list]) => list.length);
  const label = isAllSelected ? 'All Accounts' : isNoneSelected ? 'No Accounts' : selectedAccounts.length === 1 ? (accounts.find(account => account.key === selectedAccounts[0])?.name || '1 account') : `${selectedAccounts.length} of ${accounts.length} accounts`;

  const modeLabel=accountMode==='backtesting'?'Backtesting':'Trading';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button title={modeLabel+' · '+label} className={cn('flex items-center w-full px-3 py-2.5 rounded-lg border border-border bg-bg-input/50 hover:bg-bg-input transition-colors text-sm text-left', collapsed && 'justify-center px-2')}>
          <Avatar className="h-6 w-6 flex-shrink-0">
            <AvatarFallback className="text-[10px] font-semibold text-text-secondary bg-accent/15">{isAllSelected ? 'A' : isNoneSelected ? '0' : label.charAt(0).toUpperCase()}</AvatarFallback>
          </Avatar>
          {!collapsed && <><span className="ml-2 flex-1 min-w-0"><span className="block text-[10px] text-text-secondary">{modeLabel}</span><span className="block truncate text-text-primary font-medium">{label}</span></span><ChevronsUpDown className="w-3.5 h-3.5 text-text-tertiary flex-shrink-0 ml-1" /></>}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start" side="right" sideOffset={8}>
        <div className="border-b border-border px-3 py-2"><p className="text-text-secondary text-xs font-medium uppercase tracking-wider">Accounts</p></div>
        <div className="grid grid-cols-2 gap-1 p-2 border-b border-border">{['trading','backtesting'].map(mode=><button key={mode} type="button" disabled={!onAccountModeChange} aria-pressed={accountMode===mode} onClick={()=>{setSearch('');onAccountModeChange?.(mode);}} className={cn('px-2 py-1.5 rounded-md text-xs font-medium',accountMode===mode?'bg-accent text-accent-text':'bg-bg-input text-text-secondary hover:text-text-primary')}>{mode==='trading'?'Trading':'Backtesting'}</button>)}</div>
        {loading&&<p className="px-3 py-2 text-xs text-text-secondary">Loading accounts…</p>}
        {accounts.length >= 5 && <div className="border-b border-border px-3 py-2"><input type="text" placeholder="Search accounts..." value={search} onChange={e => setSearch(e.target.value)} className="w-full bg-transparent text-sm text-text-primary placeholder:text-text-tertiary outline-none" /></div>}
        <div className="max-h-[340px] overflow-y-auto p-1">
          <button disabled={loading||!onAccountModeChange} onClick={toggleAll} className={cn('flex items-center gap-2 w-full px-2 py-2 rounded text-sm text-left transition-colors hover:bg-bg-input', isAllSelected && 'bg-bg-input text-accent')}>
            <Avatar className="h-5 w-5 flex-shrink-0"><AvatarFallback className="text-[9px] font-bold bg-accent/15 text-accent">A</AvatarFallback></Avatar>
            <span className="flex-1 truncate font-medium">All Accounts</span>
            {isAllSelected && <Check className="w-3.5 h-3.5 text-accent flex-shrink-0" />}
          </button>
          <div className="h-px bg-border my-1" />
          {filteredGroups.length === 0 ? <div className="px-2 py-3 text-center text-text-tertiary text-xs">No accounts found</div> : filteredGroups.map(([provider, providerAccounts]) => {
            const broker = BROKER_ICONS[provider];
            const providerLabel = broker?.label || (provider === 'manual' ? 'Manual / Other' : provider);
            const checked = !isNoneSelected && providerAccounts.every(account => selectedSet.has(account.key));
            const some = !isNoneSelected && providerAccounts.some(account => selectedSet.has(account.key));
            return (
              <div key={provider} className="mt-1">
                <button disabled={loading||!onAccountModeChange} onClick={() => toggleProvider(providerAccounts)} className="flex items-center gap-2 w-full px-2 py-2 border-b border-border/70 text-left hover:bg-bg-input/60">
                  <span className={cn('w-4 h-4 rounded border flex items-center justify-center flex-shrink-0', checked ? 'bg-accent border-accent' : some ? 'border-accent bg-accent/20' : 'border-border')}>
                    {checked && <Check className="w-3 h-3 text-accent-text" />}
                    {!checked && some && <span className="w-2 h-0.5 bg-accent" />}
                  </span>
                  {broker?.icon ? <img src={broker.icon} alt="" className="w-4 h-4 object-contain" /> : <span className="w-4 h-4 rounded bg-[#6d4aff]/15 text-[#a895ff] text-[8px] font-bold flex items-center justify-center">{provider === 'tradezella' ? 'TZ' : providerLabel.slice(0,1)}</span>}
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary flex-1">{providerLabel}</span>
                  <span className="text-[10px] text-text-muted">{providerAccounts.length}</span>
                </button>
                {providerAccounts.map(account => (
                  <button key={account.key} disabled={loading||!onAccountModeChange} onClick={() => toggleAccount(account)} className={cn('flex items-center gap-2 w-full pl-8 pr-2 py-2 rounded text-sm text-left transition-colors hover:bg-bg-input', selectedSet.has(account.key) && !isNoneSelected && 'bg-bg-input')}>
                    <span className="flex-1 truncate text-text-secondary">{account.name}</span>
                    {selectedSet.has(account.key) && !isNoneSelected && <Check className="w-3.5 h-3.5 text-accent flex-shrink-0" />}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
        {!isAllSelected && <div className="border-t border-border p-1"><button disabled={loading||!onAccountModeChange} onClick={selectAllAndClose} className="w-full px-2 py-1.5 text-xs text-accent hover:bg-bg-input rounded transition-colors">Clear filter</button></div>}
      </PopoverContent>
    </Popover>
  );
};

module.exports = AccountSwitcher;
