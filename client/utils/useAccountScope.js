const React=require('react');
const {useState,useRef,useEffect}=React;
const {authFetch}=require('../helper');
const {NO_ACCOUNTS}=require('./accountIdentity');
const {emptyReplay}=require('./accountScope');
const url='/api/backtesting/account-view';
const defaults=()=>{
  let trading=[];try{const saved=JSON.parse(localStorage.getItem('rrmetrics_selectedAccounts'));if(Array.isArray(saved))trading=saved.filter(x=>typeof x==='string'&&x.length>0&&x.length<=512&&!x.startsWith('replay::')).slice(0,10000);}catch{}
  if(trading.includes(NO_ACCOUNTS))trading=[NO_ACCOUNTS];
  return {version:1,mode:'trading',trading,backtesting:[]};
};
async function request(url,options){
  const res=await authFetch(url,options),data=await res.json();
  if(!res.ok)throw Error(data.error||'Request failed.');
  return data;
}
function useAccountScope(page){
  const [settings,setSettings]=useState(defaults),settingsRef=useRef(settings);
  const [ready,setReady]=useState(false),[loadError,setLoadError]=useState(''),[saveError,setSaveError]=useState('');
  const [reload,setReload]=useState(0),[refresh,setRefresh]=useState(0);
  const queue=useRef(Promise.resolve()),generation=useRef(0);
  useEffect(()=>{
    let active=true;setReady(false);setLoadError('');
    request(url).then(async data=>{
      if(!active)return;
      const next=data.settings||(await request(url+'?initialize=1',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(defaults())})).settings;
      if(!active)return;
      settingsRef.current=next;setSettings(next);setReady(true);
    }).catch(e=>{if(active)setLoadError(e.message);});
    return()=>{active=false;};
  },[reload]);
  const persist=next=>{
    const seq=++generation.current;
    queue.current=queue.current.catch(()=>{}).then(async()=>{
      try{await request(url,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(next)});if(seq===generation.current)setSaveError('');}
      catch(e){if(seq===generation.current)setSaveError(e.message);}
    });
  };
  const update=fn=>{
    if(!ready)return;
    const next=fn(settingsRef.current);
    if(JSON.stringify(next)===JSON.stringify(settingsRef.current))return;
    settingsRef.current=next;setSettings(next);persist(next);
  };
  const setSelection=(mode,value)=>update(old=>({...old,[mode]:typeof value==='function'?value(old[mode]):value}));
  const setMode=mode=>{if(mode!==settingsRef.current.mode||mode==='backtesting')setRefresh(n=>n+1);update(old=>({...old,mode}));};
  const selectReplay=id=>{update(old=>({...old,mode:'backtesting',backtesting:['replay::'+id]}));setRefresh(n=>n+1);};
  // Tag responses with the requested page/mode, so no previous-mode result is
  // displayed while a fresh request is pending. Errors never fall back to trading.
  const key=page+'|'+settings.mode+'|'+refresh+'|'+reload;
  const [replay,setReplay]=useState({key:'',data:emptyReplay(),error:''});
  useEffect(()=>{
    if(!ready||settings.mode!=='backtesting')return;
    let active=true;
    request('/api/backtesting/replay-analytics').then(data=>{
      if(active)setReplay({key,data,error:''});
    }).catch(e=>{if(active)setReplay({key,data:emptyReplay(),error:e.message});});
    return()=>{active=false;};
  },[key,ready,settings.mode]);
  const current=replay.key===key;
  return {settings,ready,loadError,saveError,update,setSelection,setMode,selectReplay,
    retryLoad:()=>setReload(n=>n+1),retrySave:()=>persist(settingsRef.current),refreshReplay:()=>setRefresh(n=>n+1),
    replay:current?replay.data:emptyReplay(),replayLoading:settings.mode==='backtesting'&&!current,replayError:current?replay.error:''};
}
module.exports=useAccountScope;
