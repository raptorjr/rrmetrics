const React=require('react');
const {createPortal}=require('react-dom');
const {useLayoutEffect,useRef,useId,useContext,useState,useCallback,useEffect}=React;

// A native dialog gives us modal focus trapping, Escape handling and the top
// layer (including replay fullscreen), but every visible element is app-owned.
function AppModal({title,children,onCancel,busy=false,wide=false}){
  const ref=useRef(null),titleId=useId();
  useLayoutEffect(()=>{
    const dialog=ref.current,previous=document.activeElement;
    dialog.showModal();
    return ()=>{if(dialog.open)dialog.close();if(previous?.isConnected)previous.focus?.();};
  },[]);
  return createPortal(<dialog ref={ref} aria-labelledby={titleId} onCancel={e=>{e.preventDefault();if(!busy)onCancel?.();}}
    style={{position:'fixed',inset:0,margin:'auto',height:'fit-content'}}
    className={'max-w-[calc(100%-2rem)] max-h-[90dvh] overflow-y-auto rounded-xl border border-border bg-bg-surface text-text-primary shadow-xl p-5 backdrop:bg-black/60 '+(wide?'w-[680px]':'w-[440px]')}>
    <h3 id={titleId} className="text-lg font-semibold mb-3">{title}</h3>{children}
  </dialog>,document.fullscreenElement||document.body);
}
const ConfirmContext=React.createContext(null);
function ConfirmationProvider({children}){
  const [request,setRequest]=useState(null),pending=useRef(null);
  const confirm=useCallback((options)=>{
    if(pending.current)return Promise.resolve(false);
    return new Promise(resolve=>{
      pending.current=resolve;
      setRequest(typeof options==='string'?{message:options}:options);
    });
  },[]);
  const finish=answer=>{
    const resolve=pending.current;
    pending.current=null;setRequest(null);resolve?.(answer);
  };
  useEffect(()=>()=>{pending.current?.(false);pending.current=null;},[]);
  return <ConfirmContext.Provider value={confirm}>{children}{request&&<AppModal title={request.title||'Confirm action'} onCancel={()=>finish(false)}>
    <p className="text-sm text-text-secondary whitespace-pre-line">{request.message}</p>
    <div className="flex justify-end gap-2 mt-5">
      <button type="button" autoFocus className="rounded-lg border border-border bg-bg-input px-4 py-2 text-sm text-text-primary" onClick={()=>finish(false)}>Cancel</button>
      <button type="button" className={'rounded-lg px-4 py-2 text-sm font-semibold '+(request.danger?'bg-negative text-white':'bg-accent text-accent-text')} onClick={()=>finish(true)}>{request.confirmLabel||'Confirm'}</button>
    </div>
  </AppModal>}</ConfirmContext.Provider>;
}
function useConfirm(){const confirm=useContext(ConfirmContext);if(!confirm)throw Error('ConfirmationProvider is required');return confirm;}
module.exports={AppModal,ConfirmationProvider,useConfirm};
