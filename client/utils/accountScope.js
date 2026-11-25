const {NO_ACCOUNTS,getTradeAccountKey}=require('./accountIdentity');
const replayKey=id=>'replay::'+id;
const emptyReplay=()=>({accounts:[],trades:[]});
function filterAccountDomain(trades,mode,selected,accountBrokers={}){
  const domain=(trades||[]).filter(t=>mode==='backtesting'?t.domain==='backtesting':t.domain!=='backtesting');
  if(selected.includes(NO_ACCOUNTS))return [];
  return selected.length?domain.filter(t=>selected.includes(getTradeAccountKey(t,accountBrokers))):domain;
}
function filterReplayAccounts(accounts,selected){
  return (accounts||[]).filter(a=>!selected.includes(NO_ACCOUNTS)&&(!selected.length||selected.includes(a.key)));
}
function analyticsPage(page){return page==='dashboard'||page==='analytics';}
function tradingPage(page){return ['trades','strategy','premarket','syncer','tradezella'].includes(page);}
module.exports={replayKey,emptyReplay,filterAccountDomain,filterReplayAccounts,analyticsPage,tradingPage};
