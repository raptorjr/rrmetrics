const ZONE='America/New_York';
const DEFAULT_GO_TO=[
  {id:'asian',label:'Start of Asian Session',time:'19:00',enabled:true},
  {id:'london',label:'Start of London Session',time:'02:00',enabled:true},
  {id:'new-york',label:'Start of New York Session',time:'08:00',enabled:true},
  {id:'next-day',label:'Next Day Open',time:'17:00',enabled:false},
];
const defaultGoTo=()=>DEFAULT_GO_TO.map(x=>({...x}));
const formatters=new Map();
function parts(ms,zone=ZONE){
  if(!formatters.has(zone))formatters.set(zone,new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}));
  return Object.fromEntries(formatters.get(zone).formatToParts(ms).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
}
function wallMs(p){return Date.UTC(p.year,p.month-1,p.day,p.hour||0,p.minute||0,p.second||0);}
function resolveWall(day,time,zone=ZONE){
  const [hour,minute]=time.split(':').map(Number);
  const date=new Date(day), target=Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate(),hour,minute);
  // Try both offsets surrounding a DST change. A nonexistent wall time is skipped;
  // on a repeated hour use its first occurrence.
  const candidates=[target-86400000,target,target+86400000].map(sample=>target-(wallMs(parts(sample,zone))-sample))
    .filter(ms=>wallMs(parts(ms,zone))===target).sort((a,b)=>a-b);
  return candidates[0]??null;
}
function lowerBound(bars,time,start){
  let lo=start,hi=bars.length;
  while(lo<hi){const mid=(lo+hi)>>1;if(bars[mid].time<time)lo=mid+1;else hi=mid;}
  return lo;
}
// Find the next scheduled NY time strictly ahead of the last revealed candle.
// Skip occurrences with no nearby data; do not jump to an unrelated later session.
function nextGoToIndex(bars,index,time,zone=ZONE){
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)||!bars[index]||index>=bars.length-1)return -1;
  const now=bars[index].time*1000,last=bars[bars.length-1].time*1000;
  const p=parts(now,zone),end=parts(last,zone);
  const startDay=Date.UTC(p.year,p.month-1,p.day),endDay=Date.UTC(end.year,end.month-1,end.day);
  for(let day=startDay;day<=endDay;day+=86400000){
    const target=resolveWall(day,time,zone);
    if(target===null||target<=now||target>last)continue;
    const next=lowerBound(bars,target/1000,index+1);
    // Allow a delayed opening (e.g. 17:00 preset with first futures bar at 18:00).
    if(next<bars.length&&bars[next].time-target/1000<=7200)return next;
  }
  return -1;
}
// Legacy schedules remain Eastern-time anchored. Show their next occurrence
// in the chosen display zone; edits are explicitly anchored to that zone.
function nextScheduledTime(option,referenceMs){
  const zone=option.timeZone||ZONE,p=parts(referenceMs,zone);
  const day=Date.UTC(p.year,p.month-1,p.day);
  for(let offset=0;offset<4;offset++){
    const target=resolveWall(day+offset*86400000,option.time,zone);
    if(target!==null&&target>=referenceMs)return target;
  }
  return null;
}
function displayGoToTime(option,displayZone,referenceMs){
  if((option.timeZone||ZONE)===displayZone)return option.time;
  const target=nextScheduledTime(option,referenceMs);
  if(target===null)return option.time;
  const p=parts(target,displayZone);
  return String(p.hour).padStart(2,'0')+':'+String(p.minute).padStart(2,'0');
}
function formatGoToTime(time,format){
  if(format==='24h')return time;
  const [h,m]=time.split(':').map(Number);
  return String(h%12||12).padStart(2,'0')+':'+String(m).padStart(2,'0')+' '+(h>=12?'PM':'AM');
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
module.exports={defaultGoTo,nextGoToIndex,loadGoTo,saveGoTo,displayGoToTime,formatGoToTime};
