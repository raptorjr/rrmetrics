const {test}=require('node:test');
const assert=require('node:assert/strict');
const {restoreReplayGridViews}=require('./replayChartViewport');
function widget(symbol,timeframe,events){
 const chart={resize:()=>events.push(['resize',symbol]),restoreHostReplayView:view=>events.push(['restore',symbol,view.offset])};
 return {getChart:()=>chart,getSymbol:()=>symbol,getTimeframe:()=>timeframe};
}
test('each cell restores its own viewport after the entire grid has resized, including repeated symbols',async()=>{
 const events=[],widgets=[widget('NQ','1m',events),widget('GC','1m',events),widget('NQ','1m',events)];
 const layout={cells:[{symbol:'NQ',timeframe:'1m',chart:{hostReplayView:{offset:-30}}},{symbol:'GC',timeframe:'1m',chart:{hostReplayView:{offset:-180}}},{symbol:'NQ',timeframe:'1m',chart:{hostReplayView:{offset:-120}}}]};
 assert.equal(await restoreReplayGridViews({getWidgets:()=>widgets},layout,()=>true,async()=>events.push(['frame'])),true);
 assert.deepEqual(events,[['frame'],['frame'],['resize','NQ'],['resize','GC'],['resize','NQ'],['frame'],['restore','NQ',-30],['restore','GC',-180],['restore','NQ',-120]]);
});
test('legacy missing views and mismatched cells never apply a stale viewport',async()=>{
 const events=[],widgets=[widget('NQ','1m',events),widget('GC','5m',events),widget('NQ','1m',events)];
 const layout={cells:[{symbol:'NQ',timeframe:'1m',chart:{}},{symbol:'GC',timeframe:'1m',chart:{hostReplayView:{offset:2}}},{symbol:'GC',timeframe:'1m',chart:{hostReplayView:{offset:3}}}]};
 assert.equal(await restoreReplayGridViews({getWidgets:()=>widgets},layout,()=>true,async()=>{}),true);
 assert.ok(events.every(e=>e[0]==='resize'));
});
test('restoring a replaced or unmounted grid stops before applying views',async()=>{
 const events=[],widgets=[widget('NQ','1m',events)],layout={cells:[{symbol:'NQ',timeframe:'1m',chart:{hostReplayView:{offset:1}}}]};
 let frame=0;
 assert.equal(await restoreReplayGridViews({getWidgets:()=>widgets},layout,()=>frame<3,async()=>{frame++;}),false);
 assert.deepEqual(events,[['resize','NQ']]);
 frame=0;
 assert.equal(await restoreReplayGridViews({getWidgets:()=>widgets},layout,()=>false,async()=>{frame++;}),false);
 assert.deepEqual(events,[['resize','NQ']]);
});
