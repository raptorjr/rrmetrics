// Presentation helpers: retain stable account identities and full account totals
// even when the session list is filtered.
function groupReplaySessions(sessions,filter='all'){
  const accounts=new Map();
  for(const session of sessions){
    if(!accounts.has(session.accountId))accounts.set(session.accountId,[]);
    accounts.get(session.accountId).push(session);
  }
  return [...accounts.entries()].map(([id,members])=>{
    const ordered=[...members].sort((a,b)=>a.sequence-b.sequence);
    const latest=ordered[ordered.length-1];
    const startingBalance=latest.accountStartingBalance;
    const tradeCount=ordered.reduce((sum,s)=>sum+s.tradeCount,0);
    const wins=ordered.reduce((sum,s)=>sum+Math.round(s.tradeCount*s.winRate/100),0);
    return {id,name:latest.accountName,latest,startingBalance,balance:latest.balance,
      realizedPnl:latest.balance-startingBalance,tradeCount,winRate:tradeCount?100*wins/tradeCount:0,
      sessionCount:ordered.length,sessions:ordered.filter(s=>filter==='all'||s.status===filter)};
  }).filter(group=>group.sessions.length);
}
function sessionDefaultName(account){return 'Session '+((account?.sequence||0)+1);}

// The picker uses ISO-like local wall-clock strings. Given a permitted hour or
// AM/PM period, choose the closest valid minute/hour rather than rejecting a
// change merely because the previously selected minute is outside the bounds.
function timeCandidate(date,hour,minute){
  return date+'T'+String(hour).padStart(2,'0')+':'+String(minute).padStart(2,'0')+':00';
}
function timeAllowed(value,min,max){return (!min||value>=min)&&(!max||value<=max);}
function allowedMinutes(date,hour,min,max){
  return Array.from({length:60},(_,i)=>i).filter(i=>timeAllowed(timeCandidate(date,hour,i),min,max));
}
function closestAllowedTime(date,hours,preferredHour,preferredMinute,min,max){
  const candidates=hours.flatMap(hour=>allowedMinutes(date,hour,min,max).map(minute=>({hour,minute,value:timeCandidate(date,hour,minute)})));
  const target=preferredHour*60+preferredMinute;
  return candidates.reduce((best,c)=>!best||Math.abs(c.hour*60+c.minute-target)<Math.abs(best.hour*60+best.minute-target)?c:best,null)?.value||null;
}
module.exports={groupReplaySessions,sessionDefaultName,timeCandidate,timeAllowed,allowedMinutes,closestAllowedTime};
