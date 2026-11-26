// TradeCanvas restores each widget before the grid finishes moving the shared
// toolbar and sizing its cells. The retained first chart may still have its
// original single-chart dimensions at that point. Wait for layout and the
// deferred ResizeObserver callbacks, then explicitly size the visible charts
// and apply the saved view by cell index (never by symbol).
async function restoreReplayGridViews(grid,layout,isCurrent,nextFrame=()=>new Promise(resolve=>requestAnimationFrame(resolve))){
  await nextFrame();
  await nextFrame();
  if(!isCurrent())return false;
  const widgets=grid.getWidgets();
  for(const widget of widgets)widget.getChart().resize();
  await nextFrame();
  if(!isCurrent())return false;
  const current=grid.getWidgets();
  if(current.length!==widgets.length||current.some((widget,i)=>widget!==widgets[i]))return false;
  current.forEach((widget,index)=>{
    const cell=layout.cells[index],view=cell?.chart?.hostReplayView;
    // Old sessions and charts without revealed data may have no saved view.
    if(view&&widget.getSymbol()===cell.symbol&&widget.getTimeframe()===cell.timeframe){
      widget.getChart().restoreHostReplayView(view);
    }
  });
  return true;
}
module.exports={restoreReplayGridViews};
