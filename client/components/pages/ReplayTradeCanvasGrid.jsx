const React = require('react');
const { useEffect, useMemo, useRef, useState } = React;
const { ChartWidgetGrid } = require('@tradecanvas/chart/widget');
const { timeframeSeconds } = require('../../utils/historicalReplay');
const { calculateTradePnl, toReplayChartPosition } = require('../../utils/backtestingReplay');

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

const ReplayTradeCanvasGrid = ({
  ticker,
  timeframe,
  baseCandles,
  replayTime,
  baseTimeframe,
  position,
  pendingOrder,
  onActiveChartChange,
  spec, currentPrice, chartMenuItems, onOrderModify, onOrderCancel, onPositionModify, onPositionClose,
}) => {
  const interactionRef = useRef(null);
  interactionRef.current = { chartMenuItems, onOrderModify, onOrderCancel, onPositionModify, onPositionClose };
  const hostRef = useRef(null);
  const gridRef = useRef(null);
  const barsRef = useRef([]);
  const baseTimeframeRef = useRef(baseTimeframe);
  const dataIdentityRef = useRef('');
  const [gridRevision, setGridRevision] = useState(0);
  const lastExternalTimeframeRef = useRef(timeframe);
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
    const tradingOptions = { trading: false, chartOptions: { features: { trading: true, tradingContextMenu: false } }, chartMenuItems: context => interactionRef.current.chartMenuItems(context) };
    const cells = [{
      symbol: ticker,
      timeframe,
      theme: 'dark',
      ui: 'modern',
      ...tradingOptions,
      // RR Metrics owns replay. Do not expose TradeCanvas's native replay
      // transport; retain the shared grid picker in the chart toolbar.
      features: { replay: false, 'toolbar.replay': false, 'dock.watchlist': false, depthLadder: false },
      resampleTimeframes: true,
    }];
    const grid = new ChartWidgetGrid(hostRef.current, {
      layout: '1x1',
      layoutChoices,
      cells,
      // Apply replay restrictions to every future chart, not just cells[0].
      widget: {
        theme: 'dark', ui: 'modern', ...tradingOptions, resampleTimeframes: true,
        features: { replay: false, 'toolbar.replay': false, 'dock.watchlist': false, depthLadder: false },
      },
      // Replace the native Replay button with the layout picker in the active
      // chart toolbar. TradeCanvas moves it with the active chart; no extra bar.
      bar: false,
      layouts: false,
      sharedToolbar: true,
      layoutPickerInToolbar: true,
      sharedDrawingTools: true,
      sync: { symbol: false, interval: false, crosshair: true, time: false, drawings: false, replay: false },
      onActiveChange: index => {
        setActiveChart(index);
        if (onActiveChartChange) onActiveChartChange(index);
      },
      onChartAdd: widget => {
        const chart = widget.getChart();
        chart.setHostReplayViewport(true);
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
    return () => {
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
    if (!previous.length || identityChanged || !isAppend) {
      grid.getWidgets().forEach(widget => {
        loadReplayData(widget, visibleBars, baseTimeframe, previous.length > 0 && !identityChanged);
      });
    } else if (visibleBars.length > previous.length) {
      const additions = visibleBars.slice(previous.length);
      grid.getWidgets().forEach(widget => {
        additions.forEach(bar => widget.appendDataBar(bar));
      });
    }
    barsRef.current = visibleBars;
    dataIdentityRef.current = identity;
  }, [visibleBars, ticker, baseTimeframe]);

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    grid.getWidgets().forEach(widget => {
      if (widget.getSymbol() !== ticker) void widget.setSymbol(ticker);
    });
  }, [ticker]);

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid || lastExternalTimeframeRef.current === timeframe) return;
    lastExternalTimeframeRef.current = timeframe;
    void grid.getActiveWidget().setTimeframe(timeframe);
  }, [timeframe]);

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    grid.getWidgets().forEach(widget => {
      const chart = widget.getChart();
      // The replay state is authoritative, regardless of each chart's interval.
      chart.setTradingConfig({ pricePrecision: spec.decimals,
        positionLabel: ctx => {
          const pnl = calculateTradePnl({ direction: ctx.side === 'buy' ? 'long' : 'short', entryPrice: ctx.entryPrice, quantity: ctx.openQuantity }, currentPrice, spec.pointValue);
          return (ctx.side === 'buy' ? 'Long' : 'Short') + ' ' + (pnl < 0 ? '-$' : '+$') + Math.abs(pnl).toFixed(2);
        } });
      chart.setOrders(pendingOrder ? [{
        id: pendingOrder.id, side: pendingOrder.direction === 'long' ? 'buy' : 'sell',
        type: pendingOrder.type === 'stop_market' ? 'stop' : 'limit', price: pendingOrder.triggerPrice,
        quantity: pendingOrder.quantity, draggable: true,
      }] : []);
      chart.setPositions(position ? [toReplayChartPosition(position, spec)] : []);
    });
  }, [position, pendingOrder, gridRevision, currentPrice, spec]);
  return (
    <div className="w-full h-[430px] min-w-0" ref={hostRef} data-active-chart={activeChart} />
  );
};

module.exports = ReplayTradeCanvasGrid;
module.exports.default = ReplayTradeCanvasGrid;
