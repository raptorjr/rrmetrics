const {INSTRUMENT_SPECS,calculateTradePnl,calculateTradeStats}=require('./backtestingReplay');

// Standard futures replay convention: 18:00 New York starts the next
// trading date. Use the historical timestamp, not device time or UTC midnight.
// This is not a prop-firm-specific holiday/early-close calendar.
const dayFormatter=new Intl.DateTimeFormat('en-US',{
  timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'
});
function replayTradingDay(time){
  if(!Number.isFinite(time)||!Number.isFinite(new Date(time*1000).getTime()))return null;
  const p=Object.fromEntries(dayFormatter.formatToParts(new Date(time*1000)).map(part=>[part.type,part.value]));
  return new Date(Date.UTC(+p.year,+p.month-1,+p.day+(+p.hour>=18?1:0))).toISOString().slice(0,10);
}
const cents=n=>Math.round(n*100);

// Completed round trips are counted on their final exit day. Cash P/L is
// instead assigned to actual exit days, including partial reductions.
// Reconstruct using the same weighted open cost basis as the execution engine.
// A stored total remains authoritative; never invent a multi-day split when
// execution evidence cannot be reconciled with it.
function realizedByDay(trade,instrument,open=false){
  const fills=trade.fills||[],total=open?trade.realizedPnl:trade.pnl;
  const days=[...new Set(fills.filter(f=>f.kind==='exit').map(f=>replayTradingDay(f.time)))];
  if(!days.length)return {amounts:{},unknown:open&&total===0?[]:[replayTradingDay(trade.exitTime||trade.entryTime)]};
  if(days.length===1&&days[0]&&Number.isFinite(total))return {amounts:{[days[0]]:cents(total)},unknown:[]};
  const spec=INSTRUMENT_SPECS[instrument],amounts={};
  const fail=()=>({amounts:{},unknown:days});
  if(!spec||!Number.isFinite(total)||days.includes(null))return fail();
  let quantity=0,entryPrice=0,lastTime=-Infinity;
  for(const f of fills){
    if(!Number.isFinite(f.price)||!Number.isInteger(f.quantity)||f.quantity<=0||f.time<lastTime||!replayTradingDay(f.time))return fail();
    lastTime=f.time;
    if(f.kind==='entry'&&f.direction===trade.direction){
      entryPrice=(entryPrice*quantity+f.price*f.quantity)/(quantity+f.quantity);quantity+=f.quantity;
    }else if(f.kind==='exit'&&f.direction!==trade.direction&&quantity>=f.quantity){
      const day=replayTradingDay(f.time);
      amounts[day]=(amounts[day]||0)+calculateTradePnl({direction:trade.direction,entryPrice,quantity:f.quantity},f.price,spec.pointValue);
      quantity-=f.quantity;
    }else return fail();
  }
  if(quantity!==(open?trade.quantity:0)||cents(Object.values(amounts).reduce((sum,n)=>sum+n,0))!==cents(total))return fail();
  for(const day of days)amounts[day]=cents(amounts[day]||0);
  // Preserve the recorded total to the cent, including rounding residuals.
  amounts[days[days.length-1]]+=cents(total)-Object.values(amounts).reduce((sum,n)=>sum+n,0);
  return {amounts,unknown:[]};
}
function buildReplayStatistics(priorSessions,closedTrades,position,instrument){
  const priorTrades=priorSessions.flatMap(s=>s.trades);
  const days=new Map();
  const get=day=>{
    if(!days.has(day))days.set(day,{trades:[],cents:0,unknown:false});
    return days.get(day);
  };
  const add=(trade,symbol,open=false)=>{
    if(!open)get(replayTradingDay(trade.exitTime)).trades.push(trade);
    const {amounts,unknown}=realizedByDay(trade,symbol,open);
    for(const [day,amount] of Object.entries(amounts))get(day).cents+=amount;
    for(const day of unknown)get(day).unknown=true;
  };
  for(const s of priorSessions)for(const t of s.trades)add(t,s.instrument);
  for(const t of closedTrades)add(t,instrument);
  if(position)add(position,instrument,true);
  const session=calculateTradeStats(closedTrades),account=calculateTradeStats([...priorTrades,...closedTrades]);
  const openRealized=position?.realizedPnl??0;
  return {
    session:{...session,realizedPnl:session.netPnl+openRealized},
    account:{...account,realizedPnl:account.netPnl+openRealized},
    day:date=>{
      const d=days.get(date);
      return {...calculateTradeStats(d?.trades||[]),realizedPnl:d?.unknown?null:(d?.cents||0)/100};
    }
  };
}
module.exports={replayTradingDay,realizedByDay,buildReplayStatistics};
