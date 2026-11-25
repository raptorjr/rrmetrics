const React=require('react');
const {useEffect,useRef,useState}=React;
const {authFetch}=require('../../helper');
const {defaultGoTo,loadGoTo,saveGoTo,displayGoToTime,formatGoToTime}=require('../../utils/replayGoTo');
const {getDisplayTimeZone,getTimeFormat}=require('../../utils/dateUtils');
const ClockTimeInput=require('../shared/ClockTimeInput');
const {parseClockTime,formatClockTime}=require('../../utils/clockTime');
const input='bg-bg-input border border-border rounded-lg px-2 py-1.5 text-sm text-text-primary';
function ReplayGoTo({openRef,onGoTo,replayTime}){
  const zone=getDisplayTimeZone(),timeFormat=getTimeFormat();
  const referenceMs=replayTime?replayTime*1000:Date.now();
  const [editReference,setEditReference]=useState(referenceMs);
  const [options,setOptions]=useState(defaultGoTo),[draft,setDraft]=useState([]);
  const [status,setStatus]=useState('loading'),[error,setError]=useState('');
  const [anchor,setAnchor]=useState(null);
  const dialog=useRef(null),menu=useRef(null),alive=useRef(false),generation=useRef(0);
  const refresh=async()=>{
    const request=++generation.current;setStatus('loading');setError('');
    try{const value=await loadGoTo(authFetch);if(!alive.current||request!==generation.current)return;setOptions(value);setStatus('ready');}
    catch(e){if(alive.current&&request===generation.current){setError(e.message);setStatus('load-error');}}
  };
  useEffect(()=>{alive.current=true;void refresh();return()=>{alive.current=false;++generation.current;};},[]);
  useEffect(()=>{
    openRef.current=button=>{const rect=button.getBoundingClientRect();setAnchor(previous=>previous?null:{left:Math.max(8,Math.min(rect.left,window.innerWidth-320)),top:rect.bottom+4,maxHeight:Math.max(80,window.innerHeight-rect.bottom-12)});};
    return()=>{openRef.current=null;};
  },[openRef]);
  useEffect(()=>{
    if(!anchor)return;
    const close=e=>{if(e.key==='Escape')setAnchor(null);};
    document.addEventListener('keydown',close);menu.current?.querySelector('button:not(:disabled)')?.focus();
    return()=>document.removeEventListener('keydown',close);
  },[anchor]);
  const configure=()=>{
    setAnchor(null);setEditReference(referenceMs);setDraft(options.map(x=>({...x})));setError('');dialog.current?.showModal();
  };
  const patch=(id,values)=>setDraft(old=>old.map(x=>x.id===id?{...x,...values}:x));
  const save=async()=>{
    if(status!=='ready')return;
    setStatus('saving');setError('');
    try{const saved=await saveGoTo(draft.map(({clockText,...option})=>option),authFetch);if(!alive.current)return;setOptions(saved);setStatus('ready');dialog.current?.close();}
    catch(e){if(alive.current){setError(e.message);setStatus('ready');}}
  };
  const close=()=>{if(status!=='saving')dialog.current?.close();};
  const builtIns=defaultGoTo().map(x=>x.id);
  const changeTime=(item,clockText)=>{
    const parsed=parseClockTime(clockText,timeFormat,false);
    patch(item.id,parsed?{clockText,time:formatClockTime(parsed,'24h',false),timeZone:zone}:{clockText});
  };
  const invalidTime=item=>item.clockText!==undefined&&!parseClockTime(item.clockText,timeFormat,false);
  const row=(item,custom=false)=>{
    const clockText=item.clockText??formatGoToTime(displayGoToTime(item,zone,editReference),timeFormat);
    return <div key={item.id} className="flex items-center gap-2 py-1.5">
    <input type="checkbox" aria-label={'Enable '+item.label} checked={item.enabled} disabled={status!=='ready'} onChange={e=>patch(item.id,{enabled:e.target.checked})} className="accent-accent"/>
    {custom?<input aria-label="Custom option name" maxLength={80} className={input+' min-w-0 flex-1'} value={item.label} disabled={status!=='ready'} onChange={e=>patch(item.id,{label:e.target.value})}/>:<span className="flex-1 text-sm">{item.label}</span>}
    <ClockTimeInput label={item.label+' time'} value={clockText} onChange={value=>changeTime(item,value)}
      timeFormat={timeFormat} includeSeconds={false} disabled={status!=='ready'} invalid={invalidTime(item)}
      placement={custom?'above':'below'} className="w-[144px] shrink-0"
      title={(item.timeZone||'America/New_York')!==zone?'Existing schedule anchored to '+(item.timeZone||'America/New_York')+'; editing anchors it to '+zone:zone}/>
    {custom&&<button type="button" aria-label={'Remove '+item.label} disabled={status!=='ready'} className="px-2 text-text-secondary hover:text-negative" onClick={()=>setDraft(old=>old.filter(x=>x.id!==item.id))}>×</button>}
  </div>;};
  return <>
    {anchor&&<><div className="fixed inset-0 z-[10001]" onPointerDown={()=>setAnchor(null)}/>
      <div ref={menu} className="fixed z-[10002] w-[312px] max-w-[calc(100vw-16px)] rounded-lg border border-border bg-bg-surface shadow-xl p-1 text-sm overflow-y-auto" style={anchor}>
        <p className="px-3 py-1 text-xs text-text-secondary">Next occurrence · {zone}</p>
        {status==='ready'&&options.filter(x=>x.enabled).map(item=><button key={item.id} type="button" className="w-full px-3 py-2 rounded text-left hover:bg-bg-input flex items-center justify-between gap-2" onClick={()=>{setAnchor(null);onGoTo?.(item);}}><span>{item.label}</span><span className="text-text-secondary tabular-nums">{formatGoToTime(displayGoToTime(item,zone,referenceMs),timeFormat)}</span></button>)}
        {status==='ready'&&!options.some(x=>x.enabled)&&<p className="px-3 py-2 text-text-secondary">No enabled destinations.</p>}
        {status==='loading'&&<p className="px-3 py-2 text-text-secondary">Loading settings…</p>}
        {status==='load-error'&&<button type="button" className="px-3 py-2 text-negative" onClick={refresh}>Could not load settings. Retry</button>}
        <button type="button" disabled={status!=='ready'} className="w-full text-left px-3 py-2 rounded border-t border-border hover:bg-bg-input disabled:opacity-40" onClick={configure}>⚙ Customize settings</button>
      </div></>}
    <dialog ref={dialog} aria-labelledby="rr-go-to-title" className="m-auto rounded-xl border border-border bg-bg-surface text-text-primary shadow-2xl p-0 overflow-y-auto backdrop:bg-black/60" style={{width:520,maxWidth:'calc(100% - 2rem)',maxHeight:'calc(100% - 2rem)'}} onCancel={e=>{if(status==='saving')e.preventDefault();}} onClick={e=>{if(e.target===e.currentTarget)close();}}>
      <div className="p-5 space-y-4">
        <div className="flex items-center justify-between"><h2 id="rr-go-to-title" className="text-lg font-semibold">Go to settings</h2><button type="button" aria-label="Close" disabled={status==='saving'} onClick={close}>×</button></div>
        <p className="text-xs text-text-secondary">Times shown in {zone}, using your display preferences and the replay date. Existing schedules keep their original timezone until you edit their time; edited and new times use {zone}. Go to pauses at the next available occurrence.</p>
        <section className="border-t border-border pt-3"><h3 className="text-sm font-semibold text-text-secondary mb-2">Next session</h3>{draft.filter(x=>['asian','london','new-york'].includes(x.id)).map(x=>row(x))}</section>
        <section className="border-t border-border pt-3"><h3 className="text-sm font-semibold text-text-secondary mb-2">Next day open</h3>{draft.filter(x=>x.id==='next-day').map(x=>row(x))}</section>
        <section className="border-t border-border pt-3"><div className="flex justify-between items-center mb-2"><h3 className="text-sm font-semibold text-text-secondary">Custom Go to options</h3><button type="button" disabled={status!=='ready'||draft.length>=24} className={input+' disabled:opacity-40'} onClick={()=>setDraft(old=>[...old,{id:'custom-'+Date.now().toString(36)+'-'+old.length,label:'Custom time',time:'09:30',enabled:true,timeZone:zone}])}>+ Add option</button></div>{draft.filter(x=>!builtIns.includes(x.id)).map(x=>row(x,true))}</section>
        {draft.some(invalidTime)&&<p role="alert" className="text-xs text-negative">Enter a valid time in {timeFormat==='24h'?'HH:mm':'hh:mm AM/PM'} format.</p>}
        {error&&<p role="alert" className="text-xs text-negative">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-border pt-3"><button type="button" disabled={status==='saving'} className={input} onClick={close}>Cancel</button><button type="button" disabled={status!=='ready'||draft.some(x=>!x.label.trim()||!x.time||invalidTime(x))} className="bg-accent text-accent-text rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-40" onClick={save}>{status==='saving'?'Saving…':'Save'}</button></div>
      </div>
    </dialog>
  </>;
}
module.exports=ReplayGoTo;
