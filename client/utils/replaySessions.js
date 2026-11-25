const { getAvailableMarkets,isRangeWithinCoverage } = require('./historicalReplay');
const supported=new Set(['NQ','MNQ','ES','MES','GC','MGC']);
function eligibleReplayMarkets(datasets,start,end) {
  return getAvailableMarkets(datasets).filter(m=>supported.has(m.instrument)&&m.coverage.some(c=>isRangeWithinCoverage(start,end,c)));
}
function replayAccountBalance(start,closed,position,unrealized) {
  const realized=(closed||[]).reduce((s,t)=>s+Math.round(t.pnl*100),0)+Math.round((position?.realizedPnl??0)*100);
  const balance=Math.round(start*100)+realized;
  return { realized:realized/100,balance:balance/100,equity:(balance+Math.round(unrealized*100))/100 };
}
function verifyReplaySource(checkpoint,fingerprint,bars,marketKey,baseTimeframe) {
  if(!checkpoint)return true;
  return checkpoint.fingerprint===fingerprint&&checkpoint.marketKey===marketKey&&checkpoint.baseTimeframe===baseTimeframe&&checkpoint.barCount===bars.length&&bars[checkpoint.currentIndex]?.time===checkpoint.currentTime&&bars[checkpoint.currentIndex]?.close===checkpoint.currentPrice;
}
async function replayRequest(path,options) {
  const {authFetch}=require('../helper.js');
  const response=await authFetch('/api/backtesting/replay-sessions'+path,options);
  const data=await response.json();
  if(!response.ok){const err=new Error(data.error||'Session request failed.');err.status=response.status;throw err;}
  return data;
}
module.exports={eligibleReplayMarkets,replayAccountBalance,verifyReplaySource,replayRequest};
