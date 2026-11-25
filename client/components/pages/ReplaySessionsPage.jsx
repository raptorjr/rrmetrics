const React = require('react');
const { useEffect, useState } = React;
const { authFetch } = require('../../helper');
const { getAvailableMarkets, getSessionMarkets } = require('../../utils/historicalReplay');
const Workspace = require('./BacktestingReplayWorkspace').default;
const { ReplayDateTimePicker, toDisplayDateTimeInput, fromDisplayDateTimeInput } = require('./BacktestingReplayWorkspace');
const { getDateFormat, getTimeFormat, getDisplayTimeZone, formatDateEST } = require('../../utils/dateUtils');
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
function ReplaySessionsPage() {
  const [sessions,setSessions] = useState([]), [datasets,setDatasets] = useState([]);
  const [active,setActive] = useState(null), [creating,setCreating] = useState(false), [busy,setBusy] = useState(true);
  const [error,setError] = useState(''), [filter,setFilter] = useState('all');
  const [name,setName] = useState(''), [description,setDescription] = useState(''), [balance,setBalance] = useState('50000');
  const [start,setStart] = useState(''), [end,setEnd] = useState('');
  const markets = getAvailableMarkets(datasets);
  const ranges = markets.flatMap(m=>m.datasets.filter(d=>d.timeframe===m.baseTimeframe).map(d=>({start:Date.parse(d.start_time),end:Date.parse(d.end_time)}))).filter(r=>Number.isFinite(r.start)&&Number.isFinite(r.end));
  const min = ranges.length ? toDisplayDateTimeInput(Math.min(...ranges.map(r=>r.start))) : undefined;
  const max = ranges.length ? toDisplayDateTimeInput(Math.max(...ranges.map(r=>r.end))) : undefined;
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
    const latest = ranges.slice().sort((a,b)=>b.end-a.end)[0];
    setStart(latest ? toDisplayDateTimeInput(latest.start) : '');
    setEnd(latest ? toDisplayDateTimeInput(latest.end) : '');
    setName('');setDescription('');setBalance('50000');setError('');setCreating(true);
  };
  const create = async e => {
    e.preventDefault(); if(busy||!eligible.length)return;
    setBusy(true);setError('');
    try {
      const {session} = await request('/api/backtesting/replay-sessions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,description,startingBalance:Number(balance),startTime:startTime.toISOString(),endTime:endTime.toISOString()})});
      setCreating(false);setSessions(previous=>[session,...previous.filter(s=>s.id!==session.id)]);setActive(session);
    } catch(e) {setError(e.message);} finally {setBusy(false);}
  };
  const resume = async id => {
    setBusy(true);setError('');
    try { const {session}=await request('/api/backtesting/replay-sessions/'+encodeURIComponent(id));setActive(session); }
    catch(e){setError(e.message);}finally{setBusy(false);}
  };
  const switchSession=async id=>{
    const {session}=await request('/api/backtesting/replay-sessions/'+encodeURIComponent(id));
    setActive(session);
  };
  if(active) return <Workspace key={active.id} session={active} sessions={sessions} onSwitchSession={switchSession} onExit={()=>{setActive(null);void load();}}/>;
  const filtered=sessions.filter(s=>filter==='all'||s.status===filter);
  return <div className="space-y-4">
    <div className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-semibold text-text-primary">Replay sessions</h2><p className="text-sm text-text-muted">Independent simulated accounts. Resume on any device.</p></div><button className={primary} disabled={busy||!ranges.length} onClick={openCreate}>+ Create session</button></div>
    {!ranges.length&&!busy&&<p className="text-sm text-text-muted">Import historical OHLCV data under Settings → Providers → Historical Futures to create a session.</p>}
    {error&&<div role="alert" className="text-sm text-negative">{error}</div>}
    {creating&&<div className="fixed inset-0 z-[1000] bg-black/60 flex items-center justify-center p-4"><form onSubmit={create} className="w-full max-w-xl max-h-[90dvh] overflow-y-auto bg-bg-surface border border-border rounded-xl p-5 space-y-4 shadow-xl">
      <h3 className="text-lg font-semibold text-text-primary">Create backtesting session</h3>
      <label className="block text-sm text-text-secondary">Session name<input className={input+' mt-1'} required maxLength={120} value={name} onChange={e=>setName(e.target.value)}/></label>
      <label className="block text-sm text-text-secondary">Description (optional)<textarea className={input+' mt-1'} maxLength={2000} rows={2} value={description} onChange={e=>setDescription(e.target.value)}/></label>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3"><div><label className="text-xs text-text-muted">Start · {getDisplayTimeZone()}</label><ReplayDateTimePicker value={start} onChange={setStart} min={min} max={max} dateFormat={getDateFormat()} timeFormat={getTimeFormat()}/></div><div><label className="text-xs text-text-muted">End · {getDisplayTimeZone()}</label><ReplayDateTimePicker value={end} onChange={setEnd} min={min} max={max} dateFormat={getDateFormat()} timeFormat={getTimeFormat()}/></div></div>
      <p className="text-xs text-text-muted">{eligible.length ? eligible.length+' available market(s) for this period. Select the execution market after opening.' : 'Choose a period fully covered by at least one imported base-resolution dataset.'}</p>
      <label className="block text-sm text-text-secondary">Starting balance ($)<input required type="number" min=".01" max="1000000000" step=".01" className={input+' mt-1'} value={balance} onChange={e=>setBalance(e.target.value)}/></label>
      <div className="flex flex-wrap gap-2">{[5000,10000,25000,50000,100000,250000].map(n=><button key={n} type="button" className={Number(balance)===n?primary:secondary} onClick={()=>setBalance(String(n))}>{n/1000}K</button>)}</div>
      {error&&<p role="alert" className="text-xs text-negative">{error}</p>}
      <div className="flex justify-end gap-2"><button type="button" className={secondary} disabled={busy} onClick={()=>setCreating(false)}>Cancel</button><button className={primary} disabled={busy||!name.trim()||!eligible.length||!(Number(balance)>0)}>Create session</button></div>
    </form></div>}
    <div className="bg-bg-surface border border-border rounded-xl overflow-hidden">
      <div className="flex gap-2 p-2 border-b border-border">{[['all','All'],['in_progress','In progress'],['completed','Completed']].map(([id,label])=><button key={id} className={'px-3 py-2 rounded text-sm '+(filter===id?'text-accent bg-bg-input':'text-text-muted')} onClick={()=>setFilter(id)}>{label}</button>)}</div>
      <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm text-left"><thead className="bg-bg-input text-text-muted text-xs"><tr>{['Session','Period','Starting balance','Balance','Realized P/L','Trades','Win %','Progress',''].map((label,i)=><th key={i} className="p-3">{label}</th>)}</tr></thead><tbody>{filtered.map(s=><tr key={s.id} className="border-t border-border text-text-primary"><td className="p-3"><strong>{s.name}</strong>{s.description&&<p className="text-xs text-text-muted max-w-[220px] truncate">{s.description}</p>}</td><td className="p-3 text-xs text-text-secondary">{formatDateEST(s.startTime)} – {formatDateEST(s.endTime)}</td><td className="p-3">{money(s.startingBalance)}</td><td className="p-3">{money(s.balance)}</td><td className={'p-3 '+(s.realizedPnl<0?'text-negative':'text-positive')}>{money(s.realizedPnl)}</td><td className="p-3">{s.tradeCount}</td><td className="p-3">{s.winRate.toFixed(1)}%</td><td className="p-3"><div className="flex items-center gap-2"><div className="w-16 h-1.5 rounded bg-bg-input"><div className="h-full rounded bg-accent" style={{width:s.progress+'%'}}/></div>{s.progress}%</div></td><td className="p-3"><button className={secondary} disabled={busy} onClick={()=>resume(s.id)}>{s.revision?'Resume':'Start'}</button></td></tr>)}</tbody></table></div>
      {!filtered.length&&<p className="p-6 text-center text-text-muted text-sm">{busy?'Loading sessions…':'No sessions in this view.'}</p>}
    </div>
  </div>;
}
module.exports = ReplaySessionsPage;
