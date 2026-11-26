const React=require('react');
const {useState,useMemo}=React;
const {formatDateEST,formatTimeEST,getDisplayTimeZone}=require('../../utils/dateUtils');
const {replayHistoryRows,replayFillSide}=require('../../utils/replayTradeHistory');
const money=n=>(n<0?'-$':'$')+Math.abs(n).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
const price=n=>n.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:6});
const time=n=>{const date=new Date(n*1000);return formatDateEST(date)+' '+formatTimeEST(date);};
const PAGE_SIZE=25;
const control='rounded border border-border px-2 py-1 text-text-primary disabled:opacity-40';
function ReplayTradeHistory({trades}) {
  const rows=useMemo(()=>replayHistoryRows(trades),[trades]);
  const [page,setPage]=useState(0),[expanded,setExpanded]=useState(null);
  const pages=Math.max(1,Math.ceil(rows.length/PAGE_SIZE)),current=Math.min(page,pages-1);
  if(!rows.length)return <p className="py-3 text-sm text-text-secondary">No completed simulated trades yet.</p>;
  return <div className="space-y-2">
    <p className="text-xs text-text-secondary">Completed round trips · newest first · {getDisplayTimeZone()} · P/L before fees and slippage. Expand a trade to inspect every execution.</p>
    <div className="overflow-x-auto"><table className="w-full min-w-[870px] text-xs text-left tabular-nums">
      <thead><tr className="border-b border-border text-text-secondary">{['','Side','Entry time','Exit time','Avg entry','Avg exit','Total qty','P/L','R','Exit reason'].map((label,i)=><th key={i} scope="col" className="p-2">{label}</th>)}</tr></thead>
      <tbody>{rows.slice(current*PAGE_SIZE,(current+1)*PAGE_SIZE).map(trade=><React.Fragment key={trade.id}>
        <tr className="border-b border-border text-text-primary">
          <td className="p-2"><button type="button" className={control} aria-expanded={expanded===trade.id} aria-label={(expanded===trade.id?'Hide':'Show')+' executions for '+trade.id} onClick={()=>setExpanded(old=>old===trade.id?null:trade.id)}>{expanded===trade.id?'▾':'▸'} {trade.fills.length}</button></td>
          <td className={'p-2 font-semibold '+(trade.direction==='long'?'text-positive':'text-negative')}>{trade.direction.toUpperCase()}</td>
          <td className="p-2 whitespace-nowrap">{time(trade.entryTime)}</td><td className="p-2 whitespace-nowrap">{time(trade.exitTime)}</td>
          <td className="p-2">{price(trade.entryPrice)}</td><td className="p-2">{price(trade.exitPrice)}</td><td className="p-2">{trade.quantity}</td>
          <td className={'p-2 font-semibold '+(trade.pnl>0?'text-positive':trade.pnl<0?'text-negative':'text-text-primary')}>{money(trade.pnl)}</td>
          <td className="p-2">{trade.rMultiple==null?'—':trade.rMultiple.toFixed(2)}</td><td className="p-2">{trade.reason||'—'}</td>
        </tr>
        {expanded===trade.id&&<tr><td colSpan={10} className="p-3 bg-bg-input"><p className="font-semibold text-text-primary mb-2">Executions · recorded fill order</p>
          <table className="w-full text-xs text-left"><thead><tr className="text-text-secondary">{['#','Time','Type','Side','Quantity','Price','Reason'].map(label=><th scope="col" key={label} className="p-1">{label}</th>)}</tr></thead>
          <tbody>{trade.fills.map((fill,i)=><tr key={i} className="border-t border-border text-text-primary"><td className="p-1">{i+1}</td><td className="p-1">{time(fill.time)}</td><td className="p-1">{fill.kind==='entry'?'Entry':'Exit'}</td><td className="p-1">{replayFillSide(fill)}</td><td className="p-1">{fill.quantity}</td><td className="p-1">{price(fill.price)}</td><td className="p-1">{fill.reason||'—'}</td></tr>)}</tbody></table>
        </td></tr>}
      </React.Fragment>)}</tbody>
    </table></div>
    {pages>1&&<div className="flex items-center justify-end gap-2 text-xs text-text-secondary"><span>{current*PAGE_SIZE+1}–{Math.min((current+1)*PAGE_SIZE,rows.length)} of {rows.length}</span><button type="button" className={control} disabled={current===0} onClick={()=>{setPage(current-1);setExpanded(null);}}>Previous</button><button type="button" className={control} disabled={current===pages-1} onClick={()=>{setPage(current+1);setExpanded(null);}}>Next</button></div>}
  </div>;
}
module.exports=ReplayTradeHistory;
