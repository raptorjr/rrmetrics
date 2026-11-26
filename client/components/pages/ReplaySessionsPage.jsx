const React = require('react');
const { useEffect, useState, useRef, useLayoutEffect } = React;
const { createPortal } = require('react-dom');
const { authFetch } = require('../../helper');
const { replaySessionRangeChoices, getSessionMarkets, continuationRanges, earliestContinuationRange } = require('../../utils/historicalReplay');
const Workspace = require('./BacktestingReplayWorkspace').default;
const ReplayTradeHistory = require('../shared/ReplayTradeHistory');
const { ReplayDateTimePicker, toDisplayDateTimeInput, fromDisplayDateTimeInput } = require('./BacktestingReplayWorkspace');
const { getDateFormat, getTimeFormat, getDisplayTimeZone, formatDateEST, formatTimeEST } = require('../../utils/dateUtils');
const money = n => (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
const input = 'w-full bg-bg-input border border-border rounded-lg px-3 py-2 text-sm text-text-primary';
const primary = 'bg-accent text-accent-text px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-40';
const secondary = 'bg-bg-input border border-border text-text-primary px-3 py-2 rounded-lg text-sm disabled:opacity-40';
async function request(url, options) {
  const response = await authFetch(url, options);
  const data = await response.json();
  if (!response.ok) throw Error(data.error || 'Request failed.');
  return data;
}
function SessionActions({session,disabled,onAction,onStatistics,onHistory}){
  const trigger=useRef(null),menu=useRef(null);
  const [open,setOpen]=useState(false),[style,setStyle]=useState({visibility:'hidden'});
  useLayoutEffect(()=>{
    if(!open)return;
    const rect=trigger.current.getBoundingClientRect(),width=160,height=menu.current.offsetHeight;
    setStyle({left:Math.max(8,Math.min(rect.right-width,window.innerWidth-width-8)),
      top:rect.bottom+height+12<=window.innerHeight?rect.bottom+4:Math.max(8,rect.top-height-4),width});
    menu.current.querySelector('button')?.focus();
  },[open]);
  useEffect(()=>{
    if(!open)return;
    const close=e=>{if(!trigger.current?.contains(e.target)&&!menu.current?.contains(e.target))setOpen(false);};
    const key=e=>{if(e.key==='Escape'){setOpen(false);trigger.current?.focus();}};
    const move=e=>{if(!(e.target instanceof Node)||!menu.current?.contains(e.target))setOpen(false);};
    document.addEventListener('pointerdown',close);document.addEventListener('keydown',key);
    window.addEventListener('scroll',move,true);window.addEventListener('resize',move);
    return()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',key);window.removeEventListener('scroll',move,true);window.removeEventListener('resize',move);};
  },[open]);
  useEffect(()=>{if(disabled)setOpen(false);},[disabled]);
  const action=kind=>{setOpen(false);onAction(kind,session);};
  return <>
    <button ref={trigger} type="button" title="Session actions" aria-label={'Actions for '+session.name} aria-expanded={open}
      disabled={disabled} onClick={()=>{if(!open)setStyle({visibility:'hidden'});setOpen(v=>!v);}}
      className="inline-flex w-9 h-9 items-center justify-center rounded-lg text-text-secondary hover:bg-bg-input hover:text-text-primary focus-visible:outline focus-visible:outline-2 disabled:opacity-40">
      <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>
    </button>
    {open&&createPortal(<div ref={menu} style={style} className="fixed z-[1100] rounded-lg border border-border bg-bg-surface shadow-xl p-1 text-sm" role="group" aria-label="Session actions">
      {onStatistics&&<button type="button" onClick={()=>{setOpen(false);onStatistics(session.accountId);}} className="w-full flex items-center gap-2 rounded px-3 py-2 text-left text-text-primary hover:bg-bg-input"><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M3 3v18h18M7 16l4-5 4 3 5-8"/></svg>Statistics</button>}
      <button type="button" onClick={()=>{setOpen(false);onHistory(session.id);}} className="w-full flex items-center gap-2 rounded px-3 py-2 text-left text-text-primary hover:bg-bg-input"><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h8"/></svg>Trade history</button>
      <button type="button" onClick={()=>action('rename')} className="w-full flex items-center gap-2 rounded px-3 py-2 text-left text-text-primary hover:bg-bg-input"><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z"/></svg>Rename</button>
      {session.sessionCount===1&&<button type="button" onClick={()=>action('delete')} className="w-full flex items-center gap-2 rounded px-3 py-2 text-left text-negative hover:bg-bg-input"><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5m4-5v5"/></svg>Delete</button>}
    </div>,document.body)}
  </>;
}
function ReplaySessionsPage({onStatistics}) {
  const [sessions,setSessions] = useState([]), [datasets,setDatasets] = useState([]);
  const [active,setActive] = useState(null), [creating,setCreating] = useState(false), [busy,setBusy] = useState(true);
  const [error,setError] = useState(''), [filter,setFilter] = useState('all');
  const [history,setHistory]=useState(null);
  const [accountId,setAccountId]=useState(''),[accountName,setAccountName]=useState('');
  const [name,setName] = useState(''), [description,setDescription] = useState(''), [balance,setBalance] = useState('50000');
  const [start,setStart] = useState(''), [end,setEnd] = useState('');
  const [action,setAction]=useState(null),[renameName,setRenameName]=useState(''),[actionError,setActionError]=useState(''),[actionBusy,setActionBusy]=useState(false);
  const actionLock=useRef(false),actionDialog=useRef(null);
  const ranges = replaySessionRangeChoices(datasets);
  const latestAccounts=sessions.filter(s=>!s.sealed);
  const continuing=latestAccounts.find(s=>s.accountId===accountId);
  const selectableRanges=continuing?continuationRanges(ranges,continuing.lastReplayTime).map(r=>({...r,eligibleLabels:getSessionMarkets(datasets,r.start,r.end).map(m=>m.label)})):ranges;
  const chooseAccount=id=>{
    setAccountId(id);setError('');
    const account=latestAccounts.find(s=>s.accountId===id);
    const choices=account?continuationRanges(ranges,account.lastReplayTime):ranges;
    const selected=account?earliestContinuationRange(choices):choices[0];
    setStart(selected?toDisplayDateTimeInput(selected.start):'');
    setEnd(selected?toDisplayDateTimeInput(selected.end):'');
  };
  const continuationValid=!accountId || !!(continuing?.canContinue && start && fromDisplayDateTimeInput(start)?.getTime()>Date.parse(continuing.lastReplayTime));
  const chooseRange=range=>{setStart(toDisplayDateTimeInput(range.start));setEnd(toDisplayDateTimeInput(range.end));};
  const rangeTime=ms=>formatDateEST(new Date(ms))+' '+formatTimeEST(new Date(ms));
  const min = selectableRanges.length ? toDisplayDateTimeInput(Math.min(...selectableRanges.map(r=>r.start))) : undefined;
  const max = selectableRanges.length ? toDisplayDateTimeInput(Math.max(...selectableRanges.map(r=>r.end))) : undefined;
  const startTime = fromDisplayDateTimeInput(start), endTime = fromDisplayDateTimeInput(end);
  const eligible = startTime && endTime && endTime>startTime ? getSessionMarkets(datasets,startTime.getTime(),endTime.getTime()) : [];
  const load = async () => {
    setBusy(true);setError('');
    try {
      const [a,b] = await Promise.all([request('/api/backtesting/replay-sessions'),request('/api/market-data/datasets')]);
      setSessions(a.sessions);setDatasets(b.datasets || []);
    } catch(e) {setError(e.message);} finally {setBusy(false);}
  };
  useEffect(()=>{void load();},[]);
  const openCreate = () => {
    const latest = ranges[0];
    setStart(latest ? toDisplayDateTimeInput(latest.start) : '');
    setEnd(latest ? toDisplayDateTimeInput(latest.end) : '');
    setName('');setDescription('');setBalance('50000');setAccountId('');setAccountName('');setError('');setCreating(true);
  };
  const create = async e => {
    e.preventDefault(); if(busy||!eligible.length||!continuationValid)return;
    setBusy(true);setError('');
    try {
      const {session} = await request('/api/backtesting/replay-sessions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,description,...(continuing?{accountId,previousSessionId:continuing.id,previousRevision:continuing.revision}:{accountName:accountName.trim()||name,startingBalance:Number(balance)}),startTime:startTime.toISOString(),endTime:endTime.toISOString()})});
      setCreating(false);setSessions(previous=>[session,...previous.map(s=>s.accountId===session.accountId?{...s,sealed:true,canContinue:false,sessionCount:session.sessionCount,status:'completed'}:s)]);setActive(session);
    } catch(e) {setError(e.message);} finally {setBusy(false);}
  };
  const openAction=(kind,session)=>{
    setActionError('');setRenameName(session.name);setAction({kind,session});
  };
  useEffect(()=>{
    if(action&&!actionDialog.current?.open)actionDialog.current?.showModal();
  },[action]);
  const closeAction=()=>{
    if(actionLock.current)return;
    actionDialog.current?.close();setAction(null);
    if(actionError)void load();
  };
  const confirmAction=async e=>{
    e.preventDefault();
    if(!action||actionLock.current)return;
    const {kind,session}=action;
    if(kind==='rename'&&!renameName.trim())return;
    actionLock.current=true;setActionBusy(true);setActionError('');
    try{
      const result=await request('/api/backtesting/replay-sessions/'+encodeURIComponent(session.id),
        {method:kind==='rename'?'PATCH':'DELETE',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({revision:session.revision,...(kind==='rename'?{name:renameName.trim()}: {})})});
      if(kind==='rename')setSessions(old=>old.map(s=>s.id===session.id?result.session:s));
      else setSessions(old=>old.filter(s=>s.id!==session.id));
      actionDialog.current?.close();setAction(null);
    }catch(e){setActionError(e.message);}
    finally{actionLock.current=false;setActionBusy(false);}
  };
  const resume = async id => {
    setBusy(true);setError('');
    try { const {session}=await request('/api/backtesting/replay-sessions/'+encodeURIComponent(id));if(session.sealed){setHistory(session);return;}setActive(session); }
    catch(e){setError(e.message);}finally{setBusy(false);}
  };
  const openHistory=async id=>{
    setBusy(true);setError('');
    try{const {session}=await request('/api/backtesting/replay-sessions/'+encodeURIComponent(id));setHistory(session);}
    catch(e){setError(e.message);}finally{setBusy(false);}
  };
  const switchSession=async id=>{
    const {session}=await request('/api/backtesting/replay-sessions/'+encodeURIComponent(id));
    if(session.sealed)throw Error('This session is sealed. Open its trade history from the session list.');
    setActive(session);
  };
  if(active) return <Workspace key={active.id} session={active} sessions={sessions.filter(s=>!s.sealed)} onSwitchSession={switchSession} onExit={()=>{setActive(null);void load();}}/>;
  if(history)return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold text-text-primary">{history.name} · Trade history</h2><p className="text-sm text-text-muted">{history.accountName} · Session {history.sequence} · Saved executions, read-only</p></div><button type="button" className={secondary} onClick={()=>{setHistory(null);void load();}}>← Replay sessions</button></div>
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{[['Session starting balance',money(history.startingBalance)],['Saved balance',money(history.balance)],['Session realized P/L',money(history.realizedPnl)],['Completed trades',history.tradeCount]].map(([label,value])=><div key={label} className="rounded-xl border border-border bg-bg-surface p-3"><div className="text-xs text-text-secondary">{label}</div><div className="text-lg font-semibold text-text-primary tabular-nums">{value}</div></div>)}</div>
    <div className="rounded-xl border border-border bg-bg-surface p-3"><p className="text-xs text-text-secondary mb-3">Balance and realized P/L include partial exits on any still-open position. The history below contains only completed trades; unrealized P/L is excluded.</p><ReplayTradeHistory trades={history.trades}/></div>
  </div>;
  const filtered=sessions.filter(s=>filter==='all'||s.status===filter);
  return <div className="space-y-4">
    <div className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-semibold text-text-primary">Replay sessions</h2><p className="text-sm text-text-muted">Trade multiple historical sessions on the same virtual account.</p></div><button className={primary} disabled={busy||!ranges.length} onClick={openCreate}>+ Create session</button></div>
    {!ranges.length&&!busy&&<p className="text-sm text-text-muted">Import historical OHLCV data under Settings → Providers → Historical Futures to create a session.</p>}
    {error&&<div role="alert" className="text-sm text-negative">{error}</div>}
    {action&&<dialog ref={actionDialog} onCancel={e=>{e.preventDefault();closeAction();}} aria-labelledby="session-action-title" className="m-auto w-[440px] max-w-[calc(100%-2rem)] rounded-xl border border-border bg-bg-surface text-text-primary shadow-xl p-5 backdrop:bg-black/60"><form onSubmit={confirmAction} className="space-y-4"><h3 id="session-action-title" className="text-lg font-semibold">{action.kind==='rename'?'Rename session':'Delete session?'}</h3>{action.kind==='rename'?<label className="block text-sm text-text-secondary">Session name<input autoFocus required maxLength={120} className={input+' mt-1'} value={renameName} disabled={actionBusy} onChange={e=>setRenameName(e.target.value)}/></label>:<div className="text-sm space-y-2"><p>Delete <strong className="break-words">{action.session.name}</strong>?</p><p className="text-text-secondary">This permanently removes the virtual account, its {action.session.tradeCount} completed trade(s), saved orders, positions and chart state. Imported historical data and other accounts are not affected.</p></div>}{actionError&&<p role="alert" className="text-sm text-negative">{actionError}</p>}<div className="flex justify-end gap-2"><button autoFocus={action.kind==='delete'} type="button" className={secondary} disabled={actionBusy} onClick={closeAction}>Cancel</button><button type="submit" disabled={actionBusy||(action.kind==='rename'&&!renameName.trim())} className={action.kind==='delete'?'border border-current text-negative rounded-lg px-4 py-2 text-sm font-semibold hover:bg-bg-input disabled:opacity-40':primary}>{actionBusy?'Working…':action.kind==='rename'?'Save':'Delete session'}</button></div></form></dialog>}
    {creating&&<div className="fixed inset-0 z-[1000] bg-black/60 flex items-center justify-center p-4"><form onSubmit={create} className="w-full max-w-xl max-h-[90dvh] overflow-y-auto bg-bg-surface border border-border rounded-xl p-5 space-y-4 shadow-xl">
      <h3 className="text-lg font-semibold text-text-primary">Create backtesting session</h3>
      <label className="block text-sm text-text-secondary">Virtual account<select className={input+' mt-1'} value={accountId} onChange={e=>chooseAccount(e.target.value)}><option value="">Create a new virtual account</option>{latestAccounts.map(s=><option key={s.accountId} value={s.accountId} disabled={!s.canContinue}>{s.accountName} · {money(s.balance)}{s.canContinue?'':' · Not ready to continue'}</option>)}</select></label>
      {!accountId&&<label className="block text-sm text-text-secondary">Account name (optional)<input className={input+' mt-1'} maxLength={120} value={accountName} placeholder="Use session name" onChange={e=>setAccountName(e.target.value)}/></label>}
      {continuing&&<div className="rounded-lg border border-border bg-bg-input p-3 text-xs text-text-secondary">Carry forward <strong className="text-text-primary">{money(continuing.balance)}</strong> into session {continuing.sequence+1}. Earlier dates are unavailable because this account has already traded through {formatDateEST(continuing.lastReplayTime)} {formatTimeEST(continuing.lastReplayTime)}. The prior session will become read-only.{!selectableRanges.length?<p className="mt-1 text-warning">No later historical range is available. Import newer data to continue this account.</p>:<p className="mt-1">The date range starts at the earliest selectable minute in the available coverage; you may choose a later period.</p>}</div>}
      <label className="block text-sm text-text-secondary">Session name<input className={input+' mt-1'} required maxLength={120} value={name} onChange={e=>setName(e.target.value)}/></label>
      <label className="block text-sm text-text-secondary">Description (optional)<textarea className={input+' mt-1'} maxLength={2000} rows={2} value={description} onChange={e=>setDescription(e.target.value)}/></label>
      <section className="space-y-2"><div className="flex items-center justify-between gap-2"><h4 className="text-sm font-semibold text-text-primary">Available historical data</h4><span className="text-xs text-text-secondary">{getDisplayTimeZone()}</span></div><p className="text-xs text-text-secondary">Select a range to fill the dates below. You can then shorten the period.</p><div className="max-h-40 overflow-y-auto rounded-lg border border-border divide-y divide-border">{selectableRanges.map(range=>{const selected=startTime?.getTime()===range.start&&endTime?.getTime()===range.end;return <button key={range.key} type="button" aria-pressed={selected} onClick={()=>chooseRange(range)} className={'w-full text-left px-3 py-2 space-y-1 hover:bg-bg-input '+(selected?'bg-bg-input text-accent':'text-text-primary')}><div className="flex items-center justify-between gap-2"><strong className="text-sm">{range.sourceLabels.join(', ')}</strong><span className="text-xs text-text-secondary">{selected?'Selected':'Use range →'}</span></div><div className="text-xs text-text-secondary tabular-nums">{rangeTime(range.start)} – {rangeTime(range.end)}</div><div className="text-xs text-text-secondary">Available: {range.eligibleLabels.join(', ')}</div></button>;})}</div></section>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3"><div><label className="text-xs text-text-muted">Start · {getDisplayTimeZone()}</label><ReplayDateTimePicker value={start} onChange={setStart} min={min} max={max} dateFormat={getDateFormat()} timeFormat={getTimeFormat()}/></div><div><label className="text-xs text-text-muted">End · {getDisplayTimeZone()}</label><ReplayDateTimePicker value={end} onChange={setEnd} min={min} max={max} dateFormat={getDateFormat()} timeFormat={getTimeFormat()}/></div></div>
      {!accountId&&ranges.length>0&&<p className="text-xs text-text-secondary">For longer account progression, choose an earlier period. Later imported OHLCV coverage ends at {rangeTime(Math.max(...ranges.map(r=>r.end)))} (coverage varies by market and may contain gaps).</p>}
      <div className="text-xs text-text-secondary space-y-1"><p>{eligible.length?'Available for the entire selected period:':'Choose a period fully covered by at least one imported base-resolution dataset.'}</p>{eligible.length>0&&<div className="flex flex-wrap gap-1.5">{eligible.map(m=><span key={m.key} className="rounded border border-border bg-bg-input px-2 py-1 text-text-primary">{m.label} · {m.baseTimeframe}</span>)}</div>}{eligible.length>0&&<p>Select the execution instrument after opening the session.</p>}</div>
      {!accountId&&<><label className="block text-sm text-text-secondary">Starting balance ($)<input required type="number" min=".01" max="1000000000" step=".01" className={input+' mt-1'} value={balance} onChange={e=>setBalance(e.target.value)}/></label>
      <div className="flex flex-wrap gap-2">{[5000,10000,25000,50000,100000,250000].map(n=><button key={n} type="button" className={Number(balance)===n?primary:secondary} onClick={()=>setBalance(String(n))}>{n/1000}K</button>)}</div></>}
      {error&&<p role="alert" className="text-xs text-negative">{error}</p>}
      <div className="flex justify-end gap-2"><button type="button" className={secondary} disabled={busy} onClick={()=>setCreating(false)}>Cancel</button><button className={primary} disabled={busy||!name.trim()||!eligible.length||!selectableRanges.length||!continuationValid||(!accountId&&!(Number(balance)>0))}>Create session</button></div>
    </form></div>}
    <div className="bg-bg-surface border border-border rounded-xl overflow-hidden">
      <div className="flex gap-2 p-2 border-b border-border">{[['all','All'],['in_progress','In progress'],['completed','Completed']].map(([id,label])=><button key={id} className={'px-3 py-2 rounded text-sm '+(filter===id?'text-accent bg-bg-input':'text-text-muted')} onClick={()=>setFilter(id)}>{label}</button>)}</div>
      <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm text-left"><thead className="bg-bg-input text-text-muted text-xs"><tr>{['','Virtual account / Session','Period','Starting balance','Balance','Realized P/L','Trades','Win %','Progress',''].map((label,i)=><th key={i} className="p-3">{label}</th>)}</tr></thead><tbody>{filtered.map(s=><tr key={s.id} className="border-t border-border text-text-primary"><td className="p-3 w-12"><button type="button" className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-bg-input border border-border text-accent hover:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-40" disabled={busy||s.sealed} onClick={()=>resume(s.id)} title={s.sealed?'Sealed session':(s.revision?'Resume ':'Start ')+s.name} aria-label={s.sealed?'Sealed session':(s.revision?'Resume ':'Start ')+s.name}><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 4.5v15l12-7.5z"/></svg></button></td><td className="p-3"><strong>{s.accountName}</strong><p className="text-xs text-text-secondary">{s.sequence}. {s.name}{s.sealed?' · Sealed':''}</p>{s.description&&<p className="text-xs text-text-muted max-w-[220px] truncate">{s.description}</p>}</td><td className="p-3 text-xs text-text-secondary">{formatDateEST(s.startTime)} – {formatDateEST(s.endTime)}</td><td className="p-3">{money(s.startingBalance)}</td><td className="p-3">{money(s.balance)}</td><td className={'p-3 '+(s.realizedPnl<0?'text-negative':'text-positive')}>{money(s.realizedPnl)}</td><td className="p-3">{s.tradeCount}</td><td className="p-3">{s.winRate.toFixed(1)}%</td><td className="p-3"><div className="flex items-center gap-2"><div className="w-16 h-1.5 rounded bg-bg-input"><div className="h-full rounded bg-accent" style={{width:s.progress+'%'}}/></div>{s.progress}%</div></td><td className="p-3 w-12 text-right"><SessionActions session={s} disabled={busy||actionBusy||!!action} onAction={openAction} onStatistics={onStatistics} onHistory={openHistory}/></td></tr>)}</tbody></table></div>
      {!filtered.length&&<p className="p-6 text-center text-text-muted text-sm">{busy?'Loading sessions…':'No sessions in this view.'}</p>}
    </div>
  </div>;
}
module.exports = ReplaySessionsPage;
