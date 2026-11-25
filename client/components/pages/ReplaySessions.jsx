const React=require('react');
const {useState,useEffect,useRef}=React;
const {authFetch}=require('../../helper.js');
const {getAvailableMarkets}=require('../../utils/historicalReplay');
const {eligibleReplayMarkets,replayRequest}=require('../../utils/replaySessions');
const {ReplayDateTimePicker,toDisplayDateTimeInput,fromDisplayDateTimeInput}=require('./BacktestingReplayWorkspace');
const {getDisplayTimeZone,getDateFormat,getTimeFormat}=require('../../utils/dateUtils');
const Workspace=require('./BacktestingReplayWorkspace').default;
const money=n=>Number(n).toLocaleString(undefined,{style:'currency',currency:'USD',maximumFractionDigits:2});
const field='w-full bg-bg-input border border-border rounded-lg px-3 py-2 text-sm text-text-primary';
const button='px-3 py-2 rounded-lg bg-accent text-accent-text font-semibold text-sm disabled:opacity-40';
function ReplaySessions(){
  const [sessions,setSessions]=useState([]),[datasets,setDatasets]=useState([]),[session,setSession]=useState(null),[filter,setFilter]=useState('all'),[error,setError]=useState(''),[busy,setBusy]=useState(true);
  const [name,setName]=useState(''),[description,setDescription]=useState(''),[start,setStart]=useState(''),[end,setEnd]=useState(''),[balance,setBalance]=useState('50000');
  const dialog=useRef(null);
  const load=async()=>{setBusy(true);setError('');try{const [a,b]=await Promise.all([replayRequest(''),authFetch('/api/market-data/datasets')]);if(!b.ok)throw Error('Could not load historical catalogue.');const data=await b.json();setSessions(a.sessions);setDatasets(data.datasets||[]);}catch(e){setError(e.message);}finally{setBusy(false);}};
  useEffect(()=>{void load();},[]);
  const markets=getAvailableMarkets(datasets).filter(m=>['NQ','MNQ','ES','MES','GC','MGC'].includes(m.instrument));
  const ranges=markets.flatMap(m=>m.coverage.map(r=>({...r,label:m.label})));
  const min=ranges.length?Math.min(...ranges.map(r=>r.start)):null,max=ranges.length?Math.max(...ranges.map(r=>r.end)):null;
  const candidates=eligibleReplayMarkets(datasets,fromDisplayDateTimeInput(start)?.getTime(),fromDisplayDateTimeInput(end)?.getTime());
  const openCreate=()=>{setName('');setDescription('');setBalance('50000');setError('');const first=ranges[0];setStart(first?toDisplayDateTimeInput(first.start):'');setEnd(first?toDisplayDateTimeInput(first.end):'');dialog.current?.showModal();};
  const create=async e=>{e.preventDefault();setBusy(true);setError('');try{const data=await replayRequest('',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,description,startTime:fromDisplayDateTimeInput(start)?.toISOString(),endTime:fromDisplayDateTimeInput(end)?.toISOString(),startingBalance:Number(balance)})});dialog.current?.close();setSession(data.session);}catch(e){setError(e.message);}finally{setBusy(false);}};
  const resume=async id=>{setBusy(true);setError('');try{const data=await replayRequest('/'+id);setSession(data.session);}catch(e){setError(e.message);}finally{setBusy(false);}};
  if(session)return <Workspace key={session.id} session={session} onExit={()=>{setSession(null);void load();}}/>;
  return <div className="space-y-4">
    <div className="flex items-center justify-between"><h2 className="text-lg font-semibold text-text-primary">Replay sessions</h2><button className={button} disabled={busy||!ranges.length} onClick={openCreate}>+ Create session</button></div>
    {!ranges.length&&!busy&&<p className="text-sm text-text-muted">Import supported historical futures data before creating a session.</p>}
    {error&&<p role="alert" className="text-negative text-sm">{error} <button onClick={load}>Retry</button></p>}
    <div className="flex gap-3 text-sm">{[['all','All'],['active','In progress'],['completed','Completed']].map(([id,label])=><button key={id} onClick={()=>setFilter(id)} className={filter===id?'text-accent font-semibold':'text-text-muted'}>{label}</button>)}</div>
    <div className="overflow-x-auto bg-bg-surface rounded-xl border border-border"><table className="w-full text-sm min-w-[850px]"><thead className="text-text-muted text-left"><tr>{['','Name','Period','Starting balance','Balance','Realized P/L','Trades','Win %','Progress'].map((h,i)=><th key={i} className="p-3">{h}</th>)}</tr></thead><tbody>{sessions.filter(s=>filter==='all'||s.status===filter).map(s=><tr key={s.id} className="border-t border-border"><td className="p-3"><button className={button} disabled={busy} onClick={()=>resume(s.id)} aria-label={'Resume '+s.name}>▶</button></td><td className="p-3"><strong>{s.name}</strong><div className="text-xs text-text-muted">{s.description}</div></td><td className="p-3 text-xs">{new Date(s.startTime).toLocaleDateString()} – {new Date(s.endTime).toLocaleDateString()}</td><td className="p-3">{money(s.startingBalance)}</td><td className="p-3">{money(s.balance)}</td><td className={'p-3 '+(s.realizedPnl>=0?'text-positive':'text-negative')}>{money(s.realizedPnl)}</td><td className="p-3">{s.tradeCount}</td><td className="p-3">{s.tradeCount?s.winRate.toFixed(1)+'%':'—'}</td><td className="p-3"><progress value={s.progress} max="100" className="w-20"/><span className="ml-2">{s.progress}%</span></td></tr>)}</tbody></table>{!sessions.length&&<p className="p-5 text-text-muted text-sm">{busy?'Loading sessions…':'Create your first replay session.'}</p>}</div>
    <dialog ref={dialog} className="m-auto bg-bg-surface text-text-primary border border-border rounded-xl p-5 backdrop:bg-black/60" style={{width:560,maxWidth:'calc(100% - 2rem)',maxHeight:'calc(100% - 2rem)',overflow:'auto'}}>
      <form onSubmit={create} className="space-y-4"><h3 className="text-lg font-semibold">Create session</h3>
        <label className="block text-sm">Session name<input required maxLength={120} className={field} value={name} onChange={e=>setName(e.target.value)}/></label>
        <label className="block text-sm">Description (optional)<textarea maxLength={2000} className={field} value={description} onChange={e=>setDescription(e.target.value)}/></label>
        <div className="text-xs text-text-muted">Historical period · {getDisplayTimeZone()}</div>
        <div className="grid grid-cols-2 gap-2">{[[start,setStart,'Start'],[end,setEnd,'End']].map(([value,setter,label])=><div key={label}><div className="text-xs mb-1">{label}</div><ReplayDateTimePicker value={value} onChange={setter} min={min==null?undefined:toDisplayDateTimeInput(min)} max={max==null?undefined:toDisplayDateTimeInput(max)} dateFormat={getDateFormat()} timeFormat={getTimeFormat()}/></div>)}</div>
        <div className="text-xs text-text-muted">{candidates.length?'Available: '+candidates.map(m=>m.label).join(', '):'No supported market covers this entire period.'}</div>
        <label className="block text-sm">Starting balance ($)<input required type="number" min=".01" step=".01" className={field} value={balance} onChange={e=>setBalance(e.target.value)}/></label>
        <div className="flex flex-wrap gap-2">{[5000,10000,25000,50000,100000,250000].map(n=><button key={n} type="button" className={'px-3 py-1 rounded border border-border '+(Number(balance)===n?'text-accent':'text-text-muted')} onClick={()=>setBalance(String(n))}>{n/1000}K</button>)}</div>
        {error&&<p role="alert" className="text-negative text-sm">{error}</p>}
        <div className="flex justify-end gap-3"><button type="button" disabled={busy} onClick={()=>dialog.current?.close()}>Cancel</button><button className={button} disabled={busy||!name.trim()||!candidates.length||!(Number(balance)>0)||!(fromDisplayDateTimeInput(end)>fromDisplayDateTimeInput(start))}>Create session</button></div>
      </form>
    </dialog>
  </div>;
}
module.exports=ReplaySessions;
