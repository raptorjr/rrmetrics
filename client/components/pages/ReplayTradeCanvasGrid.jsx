const React = require('react');
const { useEffect, useRef, useState } = React;
const {createPortal}=require('react-dom');
const {readChartTheme,saveChartTheme,resolveChartTheme}=require('../../utils/replayChartTheme');
const { ChartWidgetGrid } = require('@tradecanvas/chart/widget');
const { replayChartIntervals } = require('../../utils/historicalReplay');
const { toReplayChartPosition, snapReplayPrice, replayPositionColors } = require('../../utils/backtestingReplay');
const { loadTradingDisplay, saveTradingDisplay, formatTradingAmounts, formatPendingDistance } = require('../../utils/replayTradingDisplay');
const ReplayGoTo = require('./ReplayGoTo');
const ReplayTradingSettings = require('./ReplayTradingSettings');
const { addReplayTradingSettingsButton } = require('../../utils/replayTradingToolbar');
const { authFetch } = require('../../helper');
const { replayMarketSymbol, catalogueSymbols, revealedCount, toChartBars, canTradeReplayChart, guardMenuItems, layoutSymbols, cleanReplayLayout, loadContextSeries, verifyContextSource } = require('../../utils/replayChartMarkets');

// The widget mutates its own base series when appending. Never give it
// the React replay snapshot or another chart's array.
const loadReplayData = (widget, bars, baseTimeframe, preserveViewport = true) => {
  const chart = widget.getChart();
  chart.setHostReplayViewport(preserveViewport);
  try {
    widget.setData(bars.slice(), baseTimeframe);
  } finally {
    chart.setHostReplayViewport(true);
  }
};

const ReplayTradeCanvasGrid = ({
  ticker, executionMarket, markets = [], historicalStart, historicalEnd,
  fullHeight, captureRef, pendingRef, restoreLayout, onReady, onRestoreError,
  timeframe,
  availableTimeframes,
  baseCandles,
  replayTime,
  baseTimeframe,
  position,
  pendingOrder,
  onActiveChartChange, onGoTo, jumpRevision=0,
  spec, currentPrice, chartMenuItems, onOrderModify, onOrderCancel, onPositionModify, onPositionClose,
}) => {
  const interactionRef = useRef(null);
  interactionRef.current = { chartMenuItems, onOrderModify, onOrderCancel, onPositionModify, onPositionClose };
  const hostRef = useRef(null);
  const goToRef = useRef(null);
  const settingsRef = useRef(null);
  const [labelUnits, setLabelUnits] = useState(['currency']);
  const savedUnitsRef = useRef(['currency']);
  const [settingsStatus, setSettingsStatus] = useState('loading');
  const [settingsError, setSettingsError] = useState('');
  const loadGeneration = useRef(0);
  const mountedRef = useRef(false);
  const refreshSettings = async () => {
    const generation = ++loadGeneration.current;
    setSettingsStatus('loading'); setSettingsError('');
    try {
      const units = await loadTradingDisplay(authFetch);
      if (!mountedRef.current || generation !== loadGeneration.current) return;
      savedUnitsRef.current = units; setLabelUnits(units); setSettingsStatus('ready');
    } catch {
      if (!mountedRef.current || generation !== loadGeneration.current) return;
      setSettingsStatus('load-error'); setSettingsError('Could not load saved settings. Retry to edit.');
    }
  };
  useEffect(() => {
    mountedRef.current = true;
    void refreshSettings();
    return () => { mountedRef.current = false; ++loadGeneration.current; };
  }, []);
  const openSettingsRef = useRef(null);
  openSettingsRef.current = () => {
    const dialog = settingsRef.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
    void refreshSettings();
  };
  const cancelSettings = () => {
    setLabelUnits(savedUnitsRef.current);
    setSettingsError('');
  };
  const saveSettings = async () => {
    if (settingsStatus !== 'ready') return;
    setSettingsStatus('saving'); setSettingsError('');
    try {
      const units = await saveTradingDisplay(labelUnits, authFetch);
      if (!mountedRef.current) return;
      savedUnitsRef.current = units; setLabelUnits(units); setSettingsStatus('ready');
      settingsRef.current?.close();
    } catch {
      if (!mountedRef.current) return;
      setSettingsStatus('ready'); setSettingsError('Could not save settings to RR Metrics. Retry before closing.');
    }
  };
  const gridRef = useRef(null);
  const restoredRef = useRef(false);
  const restoreStartedRef=useRef(false);
  const [gridRevision,setGridRevision]=useState(0);
  const [chartTheme,setChartTheme]=useState(()=>readChartTheme());
  const themeRef=useRef(chartTheme), expectedThemeRef=useRef(null);
  const contextWorkRef=useRef(new Map());
  const [contextError,setContextError]=useState('');
  const desiredTheme=()=>resolveChartTheme(themeRef.current,document.documentElement.dataset.theme);
  const applyTheme=()=>{const theme=desiredTheme();expectedThemeRef.current=theme;gridRef.current?.setTheme(theme);};
  const chooseTheme=value=>{themeRef.current=value;setChartTheme(value);saveChartTheme(value);applyTheme();};
  const [activeChart,setActiveChart]=useState(0);
  const cacheRef=useRef(new Map()),requestsRef=useRef(new Map()),widgetStateRef=useRef(new WeakMap());
  const drawingBankRef=useRef(Object.create(null));
  const liveRef=useRef(null);
  const executionSymbol=executionMarket?replayMarketSymbol(executionMarket):ticker;
  liveRef.current={executionSymbol,markets,baseCandles,baseTimeframe,replayTime,historicalStart,historicalEnd};
  const readIntervals=key=>{try{const value=JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(value)?value.filter(v=>typeof v==='string'):[];}catch{return [];}};
  const intervalOptions=market=>replayChartIntervals(market?.baseTimeframe||baseTimeframe||timeframe,
    market?.availableTimeframes||availableTimeframes,readIntervals('tcw:tf-favorites'),
    [...readIntervals('tcw:tf-custom'),...(restoreLayout?.cells?.map(cell=>cell.timeframe)||[])]);
  const marketFor=symbol=>liveRef.current.markets.find(m=>replayMarketSymbol(m)===symbol);
  const seriesFor=symbol=>{
    const live=liveRef.current;
    return symbol===live.executionSymbol
      ? {candles:live.baseCandles,baseTimeframe:live.baseTimeframe}
      : cacheRef.current.get(symbol);
  };
  const isExecution=widget=>canTradeReplayChart(widget,liveRef.current.executionSymbol,gridRef.current?.getWidgets()||[]);
  const syncData=(widget,force=false,jumped=false)=>{
    const symbol=widget.getSymbol(),series=seriesFor(symbol);
    if(!series?.baseTimeframe)return;
    const state=widgetStateRef.current.get(widget)||{};
    const count=revealedCount(series.candles,series.baseTimeframe,liveRef.current.replayTime);
    const same=state.candles===series.candles&&state.symbol===symbol&&state.base===series.baseTimeframe;
    const previous=same?state.count||0:0;
    if(force||jumped||!same||count<previous||(!previous&&count>0)){
      loadReplayData(widget,toChartBars(series.candles,0,count),series.baseTimeframe,same&&!force&&previous>0);
      if(jumped&&count)widget.getChart().scrollToEnd();
    }else if(count>previous){
      toChartBars(series.candles,previous,count).forEach(bar=>widget.appendDataBar(bar));
    }
    widgetStateRef.current.set(widget,{...state,symbol,candles:series.candles,base:series.baseTimeframe,count});
  };
  const loadMarket=async symbol=>{
    const cached=cacheRef.current.get(symbol);if(cached)return cached;
    if(requestsRef.current.has(symbol))return requestsRef.current.get(symbol);
    const market=marketFor(symbol);
    if(!market)throw Error('Historical chart market is unavailable: '+symbol);
    const live=liveRef.current;
    const work=loadContextSeries(market,live.historicalStart,live.historicalEnd,authFetch).then(series=>{
      cacheRef.current.set(symbol,series);return series;
    }).finally(()=>requestsRef.current.delete(symbol));
    requestsRef.current.set(symbol,work);return work;
  };
  const rememberDrawings=(widget,symbol)=>{
    if(symbol)drawingBankRef.current[symbol]=JSON.parse(JSON.stringify(widget.getChart().getDrawings()));
  };
  const applySymbol=(widget,symbol)=>{
    const chart=widget.getChart(),market=marketFor(symbol),old=widgetStateRef.current.get(widget)||{};
    if(old.symbol===symbol&&!old.loading)return;
    if(old.symbol&&old.symbol!==symbol&&restoredRef.current&&!old.loading)rememberDrawings(widget,old.symbol);
    const other=gridRef.current?.getWidgets().find(w=>w!==widget&&w.getSymbol()===symbol&&!widgetStateRef.current.get(w)?.loading);
    chart.setDrawings(JSON.parse(JSON.stringify(other?other.getChart().getDrawings():drawingBankRef.current[symbol]||[])));
    chart.setOrders([]);chart.setPositions([]);
    chart.setFeatures({trading:symbol===liveRef.current.executionSymbol});
    const source=seriesFor(symbol);
    // Clear the outgoing data before updating the allowed timeframe menu.
    // No chart may show another instrument's price under its new symbol.
    loadReplayData(widget,[],market?.baseTimeframe||liveRef.current.baseTimeframe||timeframe,false);
    const intervals=intervalOptions(market);
    void widget.setHostTimeframes(intervals.menu,intervals.initial);
    const token={symbol,loading:!source,previous:old.loading?old.previous:old.symbol};
    widgetStateRef.current.set(widget,token);
    if(source){
      syncData(widget,true);setGridRevision(v=>v+1);
      return;
    }
    setContextError('');setGridRevision(v=>v+1);
    const work=loadMarket(symbol).then(()=>{
      if(!gridRef.current?.getWidgets().includes(widget)||widgetStateRef.current.get(widget)!==token)return;
      widgetStateRef.current.set(widget,{...token,loading:false});
      syncData(widget,true);setGridRevision(v=>v+1);
    }).catch(async error=>{
      if(!gridRef.current?.getWidgets().includes(widget)||widgetStateRef.current.get(widget)!==token)return;
      setContextError(error.message||'Could not load historical chart data.');
      const fallback=token.previous&&seriesFor(token.previous)?token.previous:liveRef.current.executionSymbol;
      if(fallback!==symbol)await widget.setSymbol(fallback);
      else widgetStateRef.current.set(widget,{...token,loading:false});
    }).finally(()=>{
      if(contextWorkRef.current.get(widget)===work)contextWorkRef.current.delete(widget);
      if(gridRef.current)setGridRevision(v=>v+1);
    });
    contextWorkRef.current.set(widget,work);
    void work.catch(error=>{setContextError(error.message||'Could not restore previous chart.');});
  };
  const captureLayout=grid=>{
    if(!restoredRef.current)return null;
    if(grid.getWidgets().some(widget=>widgetStateRef.current.get(widget)?.loading))throw Error('Historical context chart is still loading. Retry after loading finishes.');
    const raw={...grid.captureLayout(),rrMultiSymbol:true};
    const sources={};
    for(const symbol of layoutSymbols(raw,liveRef.current.executionSymbol)){
      if(symbol===liveRef.current.executionSymbol)continue;
      const series=cacheRef.current.get(symbol);
      if(!series)throw Error('Missing historical context source: '+symbol);
      sources[symbol]={marketKey:series.market.key,baseTimeframe:series.baseTimeframe,fingerprint:series.fingerprint};
    }
    const layout=cleanReplayLayout(raw,liveRef.current.executionSymbol,liveRef.current.markets,drawingBankRef.current,grid.getWidgets().length,sources);
    drawingBankRef.current=Object.assign(Object.create(null),layout.rrDrawings);
    return layout;
  };
  const layoutChoices = [
    '1x1',
    '1x2', '2x1',
    '1x3', '3x1', '1+2', '2+1', '1/2', '2/1',
    '2x2',
    '1x4', '4x1', '1+3', '1/3',
  ];

  useEffect(() => {
    if (!hostRef.current) return undefined;
    // The widget's native ticket/account are disabled. Only its chart-level trading visuals emit intents to RR Metrics.
    const savedIntervals=restoreLayout?.cells?.map(cell=>cell.timeframe)||[];
    const intervals=replayChartIntervals(baseTimeframe||timeframe,availableTimeframes,readIntervals('tcw:tf-favorites'),[...readIntervals('tcw:tf-custom'),...savedIntervals]);
    const tradingOptions = { overlayContainer: hostRef.current.closest('[data-replay-workspace]') || undefined, trading: false, chartOptions: { features: { trading: true, tradingContextMenu: false, defaultTimeframeFavorites: intervals.defaults, timeframes: intervals.menu } } };
    const intervalOptions={timeframes:intervals.menu, timeframe:intervals.initial};
    const cells = [{
      symbol: executionSymbol, symbols: catalogueSymbols(markets),
      ...intervalOptions,
      theme: desiredTheme(),
      ui: 'modern',
      ...tradingOptions,
      // RR Metrics owns replay. Do not expose TradeCanvas's native replay
      // transport; retain the shared grid picker in the chart toolbar.
      features: { replay: false, 'toolbar.replay': false, fullscreen: false, 'toolbar.fullscreen': false, 'dock.watchlist': false, depthLadder: false, symbolSearch: true, symbolTyping: false, 'hotkeys.symbolSearch': true, 'toolbar.compare': false },
      resampleTimeframes: true,
    }];
    const grid = new ChartWidgetGrid(hostRef.current, {
      layout: '1x1',
      layoutChoices,
      cells,
      // Apply replay restrictions to every future chart, not just cells[0].
      widget: {
        symbol: executionSymbol, symbols: catalogueSymbols(markets), ...intervalOptions, theme: desiredTheme(), ui: 'modern', ...tradingOptions, resampleTimeframes: true,
        features: { replay: false, 'toolbar.replay': false, fullscreen: false, 'toolbar.fullscreen': false, 'dock.watchlist': false, depthLadder: false, symbolSearch: true, symbolTyping: false, 'hotkeys.symbolSearch': true, 'toolbar.compare': false },
      },
      // Replace the native Replay button with the layout picker in the active
      // chart toolbar. TradeCanvas moves it with the active chart; no extra bar.
      bar: false,
      layouts: false,
      sharedToolbar: true,
      layoutPickerInToolbar: true,
      sharedDrawingTools: true,
      sync: { symbol: false, interval: false, crosshair: true, time: false, drawings: true, replay: false },
      onChartSymbolChange: (widget,symbol)=>applySymbol(widget,symbol),
      onChartUnpark: widget=>{
        widget.setTheme(desiredTheme());
        const symbol=widget.getSymbol();
        const peers=gridRef.current?.getWidgets().filter(w=>w!==widget&&w.getSymbol()===symbol)||[];
        if(!peers.length&&Object.hasOwn(drawingBankRef.current,symbol))widget.getChart().setDrawings(JSON.parse(JSON.stringify(drawingBankRef.current[symbol])));
        setGridRevision(v=>v+1);
      },
      onChartMenuItems: (widget,context)=>isExecution(widget)?guardMenuItems(interactionRef.current.chartMenuItems(context),()=>isExecution(widget)):[],
      onActiveChange: index => {
        setActiveChart(index);
        if (onActiveChartChange) onActiveChartChange(index);
      },
      onChartAdd: widget => {
        const chart = widget.getChart();
        chart.setHostReplayViewport(true);
        // Follow the actual candle body colours by default; explicit user volume colours win.
        const matchVolumeColors=()=>{
          const up=chart.getStyleValue('series.candlestick.upColor'),down=chart.getStyleValue('series.candlestick.downColor');
          const existing=chart.getOverrides();
          if(typeof up==='string'&&typeof down==='string'&&(existing['volume.upColor']!==up||existing['volume.downColor']!==down))chart.applyOverrides({'volume.upColor':up,'volume.downColor':down});
        };
        matchVolumeColors();chart.on('styleChange',matchVolumeColors);chart.on('themeChange',matchVolumeColors);
        addReplayTradingSettingsButton(widget, () => openSettingsRef.current());
        const goToButton=widget.addToolbarButton({id:'rr-replay-go-to',label:'Go to',text:'Go to',side:'left',onClick:button=>{
          const anchor=button.getClientRects().length?button:button.closest('.tcw-toolbar')?.querySelector('.tcw-toolbar-more');
          goToRef.current?.(anchor||button);
        }});
        // The native host slots come after Indicators. Move only our button to
        // the interval/chart-type boundary; the shared toolbar carries it along.
        if(goToButton){
          const button=goToButton.element,toolbar=button.closest('.tcw-toolbar');
          const chartType=toolbar?.querySelector('[data-role="charttype"]')?.parentElement;
          if(chartType?.parentElement===toolbar){
            button.classList.remove('tcw-toolbar-overflow');button.removeAttribute('data-tcw-folded');
            toolbar.insertBefore(button,chartType);
          }
        }
        chart.setTradingConfig({ lineButtons: { reverse: false, trailStop: false, addStops: true, cancel: true, close: true, removeStops: true } });
        chart.on('orderModify', event => {if(isExecution(widget))interactionRef.current.onOrderModify(event.payload);});
        chart.on('orderCancel', event => {if(isExecution(widget))interactionRef.current.onOrderCancel(event.payload);});
        chart.on('positionModify', event => {if(isExecution(widget))interactionRef.current.onPositionModify(event.payload);});
        chart.on('positionClose', event => {if(isExecution(widget))interactionRef.current.onPositionClose(event.payload);});
        if(Object.hasOwn(drawingBankRef.current,widget.getSymbol()))chart.setDrawings(JSON.parse(JSON.stringify(drawingBankRef.current[widget.getSymbol()])));
        for(const event of ['drawingCreate','drawingUpdate','drawingRemove'])chart.on(event,()=>{
          if(restoredRef.current&&!widgetStateRef.current.get(widget)?.loading)rememberDrawings(widget,widget.getSymbol());
        });
        syncData(widget,true);
        setGridRevision(value => value + 1);
      },
    });
    gridRef.current = grid;
    expectedThemeRef.current=desiredTheme();
    const themeObserver=new MutationObserver(()=>{
      if(!restoredRef.current)return;
      const actual=hostRef.current?.querySelector('.tcw-root')?.dataset.tcwTheme;
      if((actual==='dark'||actual==='light')&&actual!==expectedThemeRef.current){
        themeRef.current=actual;expectedThemeRef.current=actual;setChartTheme(actual);saveChartTheme(actual);
      }
    });
    themeObserver.observe(hostRef.current,{attributes:true,subtree:true,attributeFilter:['data-tcw-theme']});
    const appObserver=new MutationObserver(()=>{if(themeRef.current==='app'&&restoredRef.current)applyTheme();});
    appObserver.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
    if(captureRef)captureRef.current=()=>captureLayout(grid);
    if(pendingRef)pendingRef.current=mode=>{
      const pending=()=>grid.getWidgets().some(w=>widgetStateRef.current.get(w)?.loading);
      if(mode!=='wait')return pending();
      return (async()=>{while(pending()){
        const work=grid.getWidgets().map(w=>contextWorkRef.current.get(w)).filter(Boolean);
        if(!work.length)throw Error('Historical chart could not finish loading. Choose an available symbol and retry.');
        await Promise.allSettled(work);
      }})();
    };
    return () => {
      themeObserver.disconnect();appObserver.disconnect();
      if(captureRef)captureRef.current=null;
      if(pendingRef)pendingRef.current=null;
      grid.destroy();
      gridRef.current = null;
    };
  }, []);

  const appliedJumpRef=useRef(jumpRevision);
  useEffect(()=>{
    const grid=gridRef.current;if(!grid)return;
    const jumped=appliedJumpRef.current!==jumpRevision;appliedJumpRef.current=jumpRevision;
    grid.getWidgets().forEach(widget=>{
      if(!widgetStateRef.current.get(widget)?.loading)syncData(widget,false,jumped);
    });
  },[baseCandles,baseTimeframe,replayTime,jumpRevision,gridRevision]);

  useEffect(()=>{
    const grid=gridRef.current;
    if(!grid||!executionMarket||!baseCandles.length||!baseTimeframe||!replayTime||restoreStartedRef.current)return;
    restoreStartedRef.current=true;
    const restore=async()=>{
      try{
        if(restoreLayout){
          const symbols=layoutSymbols(restoreLayout,executionSymbol);
          await Promise.all(symbols.filter(s=>s!==executionSymbol).map(async symbol=>{
            const series=await loadMarket(symbol);
            const savedSource=restoreLayout.rrContextSources?.[symbol];
            if(!savedSource)throw Error('Saved context source provenance is missing: '+symbol);
            verifyContextSource(series,savedSource);
          }));
          if(gridRef.current!==grid)return;
          const layout=cleanReplayLayout(restoreLayout,executionSymbol,markets,restoreLayout.rrDrawings||{},restoreLayout.cells.length,restoreLayout.rrContextSources||{});
          drawingBankRef.current=Object.assign(Object.create(null),layout.rrDrawings);
          await grid.restoreLayout(layout);
        }
        if(gridRef.current!==grid)return;
        applyTheme();restoredRef.current=true;setGridRevision(v=>v+1);onReady?.(true);
      }catch(e){if(gridRef.current===grid)onRestoreError?.('Could not restore saved chart layout: '+e.message);}
    };
    void restore();
  },[executionMarket,baseCandles,baseTimeframe,replayTime,restoreLayout]);
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    grid.getWidgets().forEach(widget => {
      const chart = widget.getChart();
      // Context charts are read-only with respect to the execution account.
      if(!isExecution(widget)){chart.setOrders([]);chart.setPositions([]);return;}
      chart.setTradingConfig({ pricePrecision: spec.decimals,
        positionColors: replayPositionColors(position, currentPrice, spec),
        positionLabel: ctx => {
          const label = formatTradingAmounts({ ...ctx, currentPrice }, spec, labelUnits);
          return (ctx.side === 'buy' ? 'Long' : 'Short') + (label ? ' ' + label : '');
        },
        protectiveAmountLabel: ctx => formatTradingAmounts({ ...ctx, currentPrice: snapReplayPrice(ctx.currentPrice, spec) }, spec, labelUnits),
        orderDetailLabel: (order, price) => formatPendingDistance(order, snapReplayPrice(price, spec), currentPrice, spec, labelUnits),
      });
      chart.setOrders(pendingOrder ? [{
        id: pendingOrder.id, side: pendingOrder.direction === 'long' ? 'buy' : 'sell',
        type: pendingOrder.type === 'stop_market' ? 'stop' : 'limit', price: pendingOrder.triggerPrice,
        quantity: pendingOrder.quantity, draggable: true,
      }] : []);
      chart.setPositions(position ? [toReplayChartPosition(position, spec)] : []);
    });
  }, [position, pendingOrder, gridRevision, currentPrice, spec, labelUnits, executionSymbol]);
  return (
    <>
      {/* The grid moves its active toolbar outside the widget's feature-scoped root. */}
      <style>{'[data-replay-workspace] .tcw-toolbar [data-role="fullscreen"] { display: none !important; }'}</style>
      <div className={fullHeight?"w-full flex-1 min-h-0 min-w-0":"w-full h-[430px] min-w-0"} ref={hostRef} data-active-chart={activeChart} />
      {gridRef.current?.getWidgets().map((widget,index)=>{
        const state=widgetStateRef.current.get(widget),cell=hostRef.current?.querySelectorAll('.tcw-grid-cell')[index];
        return state?.loading&&cell?createPortal(<div className="absolute inset-0 z-20 pointer-events-none flex items-center justify-center bg-bg-page/75"><div role="status" className="rounded-lg bg-bg-surface border border-border px-4 py-3 text-center text-sm text-text-primary shadow-lg"><div className="mx-auto mb-2 h-6 w-6 rounded-full border-2 border-accent border-t-transparent animate-spin"/>Loading {marketFor(state.symbol)?.label||state.symbol} historical data…</div></div>,cell,'loading-'+index):null;
      })}
      {contextError&&<div className="absolute bottom-3 left-3 z-40 max-w-[80%] rounded-lg border border-border bg-bg-surface px-3 py-2 text-xs shadow-lg" role="alert">{contextError}<button className="ml-2 underline" onClick={()=>setContextError('')}>Dismiss</button></div>}
      <ReplayGoTo openRef={goToRef} onGoTo={onGoTo} replayTime={replayTime}/>
      <ReplayTradingSettings dialogRef={settingsRef} units={labelUnits} onChange={setLabelUnits} spec={spec}
        chartTheme={chartTheme} onChartThemeChange={chooseTheme} status={settingsStatus} error={settingsError} onRetry={refreshSettings} onSave={saveSettings} onDiscard={cancelSettings} />
    </>
  );
};

module.exports = ReplayTradeCanvasGrid;
module.exports.default = ReplayTradeCanvasGrid;
