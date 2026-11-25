const React = require('react');
const { useEffect, useMemo, useRef, useState } = React;
const { ChartWidgetGrid } = require('@tradecanvas/chart/widget');
const { timeframeSeconds, replayChartIntervals } = require('../../utils/historicalReplay');
const { toReplayChartPosition, snapReplayPrice, replayPositionColors } = require('../../utils/backtestingReplay');
const { loadTradingDisplay, saveTradingDisplay, formatTradingAmounts, formatPendingDistance } = require('../../utils/replayTradingDisplay');
const ReplayGoTo = require('./ReplayGoTo');
const ReplayTradingSettings = require('./ReplayTradingSettings');
const { addReplayTradingSettingsButton } = require('../../utils/replayTradingToolbar');
const { authFetch } = require('../../helper');

const toBars = candles => candles.map(bar => ({
  time: bar.time * 1000,
  open: bar.open,
  high: bar.high,
  low: bar.low,
  close: bar.close,
  volume: Number(bar.volume || 0),
}));

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

// Native layout includes chart drawings, indicators and viewport. Orders belong only to the host.
function cleanReplayLayout(layout,ticker){
  // Old sessions had independent drawings: merge once, never discard existing lines.
  // After sync is enabled, active chart state is canonical, including deletions on parked cells.
  const drawings=layout.sync?.drawings
    ? (layout.cells[layout.active]?.chart?.drawings || [])
    : [...new Map(layout.cells.flatMap(cell=>cell.chart?.drawings || []).map(d=>[d.id,d])).values()];
  return {...layout,sync:{...layout.sync,symbol:true,drawings:true,replay:false},
    cells:layout.cells.map(cell=>({...cell,symbol:ticker,
      chart:cell.chart?{...cell.chart,symbol:ticker,drawings,orders:[],positions:[]}:null}))};
}
const ReplayTradeCanvasGrid = ({
  ticker,
  fullHeight, captureRef, restoreLayout, onReady, onRestoreError,
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
  const readyIdentityRef = useRef('');
  const tickerRef=useRef(ticker);tickerRef.current=ticker;
  const barsRef = useRef([]);
  const baseTimeframeRef = useRef(baseTimeframe);
  const dataIdentityRef = useRef('');
  const appliedJumpRef=useRef(jumpRevision);
  const [gridRevision, setGridRevision] = useState(0);
  // Read the widget's existing pinned intervals; no new browser preference is written.
  const readIntervals = key => {try{const value=JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(value)?value.filter(v=>typeof v==='string'):[];}catch{return [];}};
  const [activeChart, setActiveChart] = useState(0);

  const visibleBars = useMemo(() => {
    if (!baseTimeframe || !replayTime) return [];
    const interval = timeframeSeconds(baseTimeframe);
    return toBars(baseCandles.filter(bar => bar.time + interval <= replayTime));
  }, [baseCandles, baseTimeframe, replayTime]);

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
    const tradingOptions = { overlayContainer: hostRef.current.closest('[data-replay-workspace]') || undefined, trading: false, chartOptions: { features: { trading: true, tradingContextMenu: false, defaultTimeframeFavorites: intervals.defaults, timeframes: intervals.menu } }, chartMenuItems: context => interactionRef.current.chartMenuItems(context) };
    const intervalOptions={timeframes:intervals.menu, timeframe:intervals.initial};
    const cells = [{
      symbol: ticker,
      ...intervalOptions,
      theme: 'dark',
      ui: 'modern',
      ...tradingOptions,
      // RR Metrics owns replay. Do not expose TradeCanvas's native replay
      // transport; retain the shared grid picker in the chart toolbar.
      features: { replay: false, 'toolbar.replay': false, fullscreen: false, 'toolbar.fullscreen': false, 'dock.watchlist': false, depthLadder: false, symbolSearch: false, symbolTyping: false, 'hotkeys.symbolSearch': false },
      resampleTimeframes: true,
    }];
    const grid = new ChartWidgetGrid(hostRef.current, {
      layout: '1x1',
      layoutChoices,
      cells,
      // Apply replay restrictions to every future chart, not just cells[0].
      widget: {
        symbol: ticker, ...intervalOptions, theme: 'dark', ui: 'modern', ...tradingOptions, resampleTimeframes: true,
        features: { replay: false, 'toolbar.replay': false, fullscreen: false, 'toolbar.fullscreen': false, 'dock.watchlist': false, depthLadder: false, symbolSearch: false, symbolTyping: false, 'hotkeys.symbolSearch': false },
      },
      // Replace the native Replay button with the layout picker in the active
      // chart toolbar. TradeCanvas moves it with the active chart; no extra bar.
      bar: false,
      layouts: false,
      sharedToolbar: true,
      layoutPickerInToolbar: true,
      sharedDrawingTools: true,
      sync: { symbol: true, interval: false, crosshair: true, time: false, drawings: true, replay: false },
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
        widget.addToolbarButton({id:'rr-replay-go-to',label:'Go to',text:'Go to',side:'right',onClick:button=>{
          const anchor=button.getClientRects().length?button:button.closest('.tcw-toolbar')?.querySelector('.tcw-toolbar-more');
          goToRef.current?.(anchor||button);
        }});
        chart.setTradingConfig({ lineButtons: { reverse: false, trailStop: false, addStops: true, cancel: true, close: true, removeStops: true } });
        chart.on('orderModify', event => interactionRef.current.onOrderModify(event.payload));
        chart.on('orderCancel', event => interactionRef.current.onOrderCancel(event.payload));
        chart.on('positionModify', event => interactionRef.current.onPositionModify(event.payload));
        chart.on('positionClose', event => interactionRef.current.onPositionClose(event.payload));
        if (barsRef.current.length) loadReplayData(widget, barsRef.current, baseTimeframeRef.current, false);
        setGridRevision(value => value + 1);
      },
    });
    gridRef.current = grid;
    if(captureRef)captureRef.current=()=>restoredRef.current?cleanReplayLayout(grid.captureLayout(),tickerRef.current):null;
    return () => {
      if(captureRef)captureRef.current=null;
      grid.destroy();
      gridRef.current = null;
    };
  }, []);

  useEffect(() => { baseTimeframeRef.current = baseTimeframe; }, [baseTimeframe]);

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const previous = barsRef.current;
    const identity = ticker + '|' + baseTimeframe + '|' + (visibleBars[0]?.time || 'empty');
    const identityChanged = dataIdentityRef.current !== identity;
    const isAppend = !identityChanged && previous.length > 0
      && visibleBars.length >= previous.length
      && previous.every((bar, index) => visibleBars[index]?.time === bar.time);
    const jumped=appliedJumpRef.current!==jumpRevision;
    appliedJumpRef.current=jumpRevision;
    if (jumped || !previous.length || identityChanged || !isAppend) {
      grid.getWidgets().forEach(widget => {
        loadReplayData(widget, visibleBars, baseTimeframe, previous.length > 0 && !identityChanged);
        // Explicit Go to should show its destination, unlike ordinary playback.
        if(jumped)widget.getChart().scrollToEnd();
      });
    } else if (visibleBars.length > previous.length) {
      const additions = visibleBars.slice(previous.length);
      grid.getWidgets().forEach(widget => {
        additions.forEach(bar => widget.appendDataBar(bar));
      });
    }
    barsRef.current = visibleBars;
    dataIdentityRef.current = identity;
  }, [visibleBars, ticker, baseTimeframe, jumpRevision]);

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    grid.getWidgets().forEach(widget => {
      if (widget.getSymbol() !== ticker) void widget.setSymbol(ticker);
    });
  }, [ticker]);

  useEffect(() => {
    const grid=gridRef.current;
    if(!grid||!visibleBars.length||!baseTimeframe)return;
    const identity=ticker+'|'+baseTimeframe+'|'+visibleBars[0].time;
    if(readyIdentityRef.current===identity)return;
    readyIdentityRef.current=identity;
    const restore=async()=>{
      try{
        if(restoreLayout&&!restoredRef.current)await grid.restoreLayout(cleanReplayLayout(restoreLayout,ticker));
        if(gridRef.current!==grid)return;
        restoredRef.current=true;setGridRevision(v=>v+1);onReady?.(true);
      }catch(e){onRestoreError?.('Could not restore saved chart layout: '+e.message);}
    };
    void restore();
  },[visibleBars,ticker,baseTimeframe,restoreLayout]);

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    grid.getWidgets().forEach(widget => {
      const chart = widget.getChart();
      // The replay state is authoritative, regardless of each chart's interval.
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
  }, [position, pendingOrder, gridRevision, currentPrice, spec, labelUnits]);
  return (
    <>
      {/* The grid moves its active toolbar outside the widget's feature-scoped root. */}
      <style>{'[data-replay-workspace] .tcw-toolbar [data-role="fullscreen"] { display: none !important; }'}</style>
      <div className={fullHeight?"w-full flex-1 min-h-0 min-w-0":"w-full h-[430px] min-w-0"} ref={hostRef} data-active-chart={activeChart} />
      <ReplayGoTo openRef={goToRef} onGoTo={onGoTo}/>
      <ReplayTradingSettings dialogRef={settingsRef} units={labelUnits} onChange={setLabelUnits} spec={spec}
        status={settingsStatus} error={settingsError} onRetry={refreshSettings} onSave={saveSettings} onDiscard={cancelSettings} />
    </>
  );
};

module.exports = ReplayTradeCanvasGrid;
module.exports.default = ReplayTradeCanvasGrid;
