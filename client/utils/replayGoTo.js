const ZONE='America/New_York';
const DEFAULT_GO_TO=[
  {id:'asian',label:'Start of Asian Session',time:'19:00',enabled:true},
  {id:'london',label:'Start of London Session',time:'02:00',enabled:true},
  {id:'new-york',label:'Start of New York Session',time:'08:00',enabled:true},
  {id:'next-day',label:'Next Day Open',time:'17:00',enabled:false},
];
const defaultGoTo=()=>DEFAULT_GO_TO.map(x=>({...x}));
const formatter=new Intl.DateTimeFormat('en-GB',{timeZone:ZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
function parts(ms){
  return Object.fromEntries(formatter.formatToParts(ms).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
}
function wallMs(p){return Date.UTC(p.year,p.month-1,p.day,p.hour||0,p.minute||0,p.second||0);}
function resolveWall(day,time){
  const [hour,minute]=time.split(':').map(Number);
  const date=new Date(day), target=Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate(),hour,minute);
  // Try both offsets surrounding a DST change. A nonexistent wall time is skipped;
  // on a repeated hour use its first occurrence.
  const candidates=[target-86400000,target,target+86400000].map(sample=>target-(wallMs(parts(sample))-sample))
    .filter(ms=>wallMs(parts(ms))===target).sort((a,b)=>a-b);
  return candidates[0]??null;
}
function lowerBound(bars,time,start){
  let lo=start,hi=bars.length;
  while(lo<hi){const mid=(lo+hi)>>1;if(bars[mid].time<time)lo=mid+1;else hi=mid;}
  return lo;
}
// Find the next scheduled NY time strictly ahead of the last revealed candle.
// Skip occurrences with no nearby data; do not jump to an unrelated later session.
function nextGoToIndex(bars,index,time){
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)||!bars[index]||index>=bars.length-1)return -1;
  const now=bars[index].time*1000,last=bars[bars.length-1].time*1000;
  const p=parts(now),end=parts(last);
  const startDay=Date.UTC(p.year,p.month-1,p.day),endDay=Date.UTC(end.year,end.month-1,end.day);
  for(let day=startDay;day<=endDay;day+=86400000){
    const target=resolveWall(day,time);
    if(target===null||target<=now||target>last)continue;
    const next=lowerBound(bars,target/1000,index+1);
    // Allow a delayed opening (e.g. 17:00 preset with first futures bar at 18:00).
    if(next<bars.length&&bars[next].time-target/1000<=7200)return next;
  }
  return -1;
}
const URL='/api/backtesting/go-to-settings';
async function loadGoTo(request){
  const res=await request(URL);if(!res.ok)throw Error('Could not load Go to settings.');
  const data=await res.json();return data.settings?.options??defaultGoTo();
}
async function saveGoTo(options,request){
  const res=await request(URL,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:1,options})});
  if(!res.ok){let data;try{data=await res.json();}catch{}throw Error(data?.error||'Could not save Go to settings.');}
  return (await res.json()).settings.options;
}
module.exports={defaultGoTo,nextGoToIndex,loadGoTo,saveGoTo};
