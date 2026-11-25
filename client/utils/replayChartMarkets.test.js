const {test}=require('node:test');
const assert=require('node:assert/strict');
const {replayMarketSymbol,revealedCount,toChartBars,canTradeReplayChart,guardMenuItems,layoutSymbols,cleanReplayLayout,loadContextSeries,verifyContextSource}=require('./replayChartMarkets');
const markets=[{instrument:'MGC',sourceSymbol:'MGCZ6',key:'MGC::MGCZ6',label:'MGCZ6',baseTimeframe:'10s'},{instrument:'MNQ',sourceSymbol:'MNQZ6',key:'MNQ::MNQZ6',label:'MNQZ6',baseTimeframe:'1m'},{instrument:'MGC',sourceSymbol:'MGCG7',key:'MGC::MGCG7',label:'MGCG7',baseTimeframe:'1m'}];
const [gold,nasdaq,otherGold]=markets.map(replayMarketSymbol);
test('all markets reveal only fully elapsed source bars at the common timestamp',()=>{
  const data=[0,10,20,30,60,120].map(time=>({time,open:1,high:2,low:1,close:2,volume:1}));
  assert.equal(revealedCount(data,'10s',25),2);
  assert.equal(revealedCount(data,'1m',25),0);
  assert.equal(revealedCount(data,'1m',60),1);
  assert.deepEqual(toChartBars(data,0,2).map(b=>b.time),[0,10000]);
  assert.notEqual(gold,otherGold);
});
test('saved layouts keep symbol-specific drawings and exclude host execution overlays',()=>{
  const cell=(symbol,id)=>({symbol,timeframe:'1m',chart:{drawings:[{id}],orders:[{id:'order'}],positions:[{}]}});
  const raw={rrMultiSymbol:true,active:0,sync:{drawings:true},cells:[cell(gold,'gold'),cell(nasdaq,'nasdaq'),cell(gold,'stale'),cell(otherGold,'contract')]};
  const saved=cleanReplayLayout(raw,gold,markets,{},2,{[nasdaq]:{fingerprint:'a'}});
  assert.equal(saved.sync.symbol,false);
  assert.deepEqual(saved.cells.map(c=>c.chart.drawings.map(d=>d.id)),[['gold'],['nasdaq'],['gold'],['contract']]);
  assert.deepEqual(saved.cells[0].chart.orders,[]);
  assert.deepEqual(layoutSymbols(saved,gold),[gold,nasdaq,otherGold]);
  const legacy=cleanReplayLayout({...raw,rrMultiSymbol:false},gold,markets);
  assert.ok(legacy.cells.every(c=>c.symbol===gold));
  assert.throws(()=>cleanReplayLayout(raw,gold,markets.slice(0,2)),/unavailable/);
});
test('context and parked charts cannot issue execution intents or reuse stale menu actions',()=>{
  let symbol=gold,count=0;
  const widget={getSymbol:()=>symbol},other={getSymbol:()=>nasdaq},live=[widget,other];
  const allowed=()=>canTradeReplayChart(widget,gold,live);
  const actions=guardMenuItems([{label:'Buy',onSelect:()=>count++,submenu:[{label:'1 contract',onSelect:()=>count++}]}],allowed);
  actions[0].onSelect();symbol=nasdaq;actions[0].submenu[0].onSelect();assert.equal(count,1);
  symbol=gold;live.splice(0,1);actions[0].onSelect();assert.equal(count,1);
  assert.equal(canTradeReplayChart(other,gold,live),false);
});
test('context requests use exact contract and validate saved provenance',async()=>{
  let url;
  const series=await loadContextSeries(markets[1],'2026-11-01','2026-11-02',async input=>{
    url=input;return {ok:true,json:async()=>({fingerprint:'a'.repeat(64),bars:[{timestamp:'2026-11-01T01:00:00Z',open:1,high:2,low:1,close:2},{timestamp:'2026-11-01T01:01:00Z',open:1,high:2,low:1,close:2}]})};
  });
  assert.equal(new URLSearchParams(url.split('?')[1]).get('sourceSymbol'),'MNQZ6');
  assert.equal(series.candles.length,2);
  assert.doesNotThrow(()=>verifyContextSource(series,{marketKey:markets[1].key,baseTimeframe:'1m',fingerprint:'a'.repeat(64)}));
  assert.throws(()=>verifyContextSource(series,{marketKey:markets[1].key,baseTimeframe:'1m',fingerprint:'b'.repeat(64)}),/changed/);
});


test('drawings from a parked symbol survive separately from an active symbol',()=>{
  const raw={rrMultiSymbol:true,active:0,sync:{drawings:true},cells:[{symbol:gold,chart:{drawings:[]}},{symbol:nasdaq,chart:{drawings:[{id:'older'}]}}]};
  const saved=cleanReplayLayout(raw,gold,markets,{[nasdaq]:[{id:'latest'}]},1);
  assert.deepEqual(saved.cells[0].chart.drawings,[]);
  assert.deepEqual(saved.cells[1].chart.drawings,[{id:'latest'}]);
});
