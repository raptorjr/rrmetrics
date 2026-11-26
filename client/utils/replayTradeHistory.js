// The persisted execution order is authoritative, including fills on the same bar.
function replayHistoryRows(trades) {
  return [...trades].reverse().sort((a,b)=>b.exitTime-a.exitTime);
}
function replayFillSide(fill) {
  return fill.direction==='long'?'Buy':'Sell';
}
module.exports={replayHistoryRows,replayFillSide};
