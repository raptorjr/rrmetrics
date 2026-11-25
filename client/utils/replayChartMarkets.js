const { timeframeSeconds } = require('./historicalReplay');
const { normalizeOhlcvRows } = require('./backtestingReplay');

// The exact source contract is part of a chart's identity, even if two
// imported datasets have the same root instrument.
function replayMarketSymbol(market) {
  return market.sourceSymbol ? market.instrument+' ['+market.sourceSymbol+']' : market.instrument;
}
function catalogueSymbols(markets) {
  return markets.map(market=>({symbol:replayMarketSymbol(market),description:market.label,type:'futures'}));
}
function revealedCount(candles,baseTimeframe,replayTime) {
  const interval=timeframeSeconds(baseTimeframe);
  if(!interval||!replayTime)return 0;
  let lo=0,hi=candles.length;
  while(lo<hi){
    const mid=(lo+hi)>>1;
    if(candles[mid].time+interval<=replayTime)lo=mid+1;else hi=mid;
  }
  return lo;
}
function toChartBars(candles,start,end) {
  return candles.slice(start,end).map(bar=>({...bar,time:bar.time*1000,volume:Number(bar.volume||0)}));
}
function canTradeReplayChart(widget,executionSymbol,liveWidgets) {
  return Boolean(widget&&widget.getSymbol()===executionSymbol&&liveWidgets.includes(widget));
}
function guardMenuItems(items,allowed) {
  return items.map(item=>({...item,onSelect:()=>{if(allowed())item.onSelect?.();},
    ...(item.submenu?{submenu:guardMenuItems(item.submenu,allowed)}:{})}));
}
function layoutSymbols(layout,executionSymbol) {
  return [...new Set((layout?.cells||[]).map(cell=>layout.rrMultiSymbol?cell.symbol:executionSymbol))];
}

// Canonicalize by symbol, not across unrelated markets. Prefer a live chart
// over parked state (including an empty drawing list after deletion).
function cleanReplayLayout(layout,executionSymbol,markets,bank={},visibleCount=layout.cells.length,sources={}) {
  const allowed=new Set(markets.map(replayMarketSymbol));
  const cells=layout.cells.map(cell=>{
    const symbol=layout.rrMultiSymbol?cell.symbol:executionSymbol;
    if(!allowed.has(symbol))throw Error('Saved chart market is unavailable: '+symbol);
    return {...cell,symbol,chart:cell.chart?{...cell.chart,symbol,orders:[],positions:[]}:null};
  });
  const drawings=Object.assign(Object.create(null),bank);
  for(const symbol of new Set(cells.map(cell=>cell.symbol))){
    const same=cells.filter(cell=>cell.symbol===symbol&&cell.chart);
    const live=cells.slice(0,visibleCount).filter(cell=>cell.symbol===symbol&&cell.chart);
    const active=cells[layout.active];
    if(!layout.sync?.drawings){
      drawings[symbol]=[...new Map(same.flatMap(cell=>cell.chart.drawings||[]).map(d=>[d.id,d])).values()];
    }else if(active?.symbol===symbol&&active.chart&&layout.active<visibleCount){
      drawings[symbol]=active.chart.drawings||[];
    }else if(live.length){
      drawings[symbol]=live[0].chart.drawings||[];
    }else if(!Object.hasOwn(drawings,symbol)){
      drawings[symbol]=same[0]?.chart?.drawings||[];
    }
  }
  return {...layout,rrMultiSymbol:true,rrDrawings:drawings,rrContextSources:sources,
    sync:{...layout.sync,symbol:false,interval:false,drawings:true,replay:false},
    cells:cells.map(cell=>({...cell,chart:cell.chart?{...cell.chart,drawings:drawings[cell.symbol]||[]}:null}))};
}
async function loadContextSeries(market,start,end,request) {
  const params=new URLSearchParams({start:new Date(start).toISOString(),end:new Date(end).toISOString(),
    instrument:market.instrument,timeframe:market.baseTimeframe,sourceSymbol:market.sourceSymbol||'__none__'});
  const res=await request('/api/market-data/query?'+params.toString());
  const data=await res.json();
  if(!res.ok)throw Error(data.error||'Unable to load historical chart data.');
  const candles=normalizeOhlcvRows(data.bars||[]);
  if(candles.length<2||!/^[a-f0-9]{64}$/.test(data.fingerprint||''))throw Error('Historical chart data is incomplete.');
  return {market,candles,baseTimeframe:market.baseTimeframe,fingerprint:data.fingerprint};
}
function verifyContextSource(series,saved) {
  if(saved&&(series.market.key!==saved.marketKey||series.baseTimeframe!==saved.baseTimeframe||series.fingerprint!==saved.fingerprint)){
    throw Error('Historical context source has changed: '+series.market.label+'. Saved trades are preserved.');
  }
}
module.exports={replayMarketSymbol,catalogueSymbols,revealedCount,toChartBars,canTradeReplayChart,guardMenuItems,layoutSymbols,cleanReplayLayout,loadContextSeries,verifyContextSource};
