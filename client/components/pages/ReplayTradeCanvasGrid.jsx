const React = require('react');
const { useEffect, useMemo, useRef, useState } = React;
const { ChartWidgetGrid } = require('@tradecanvas/chart/widget');
const { timeframeSeconds } = require('../../utils/historicalReplay');

const toBars = candles => candles.map(bar => ({
  time: bar.time * 1000,
  open: bar.open,
  high: bar.high,
  low: bar.low,
  close: bar.close,
  volume: Number(bar.volume || 0),
}));

const appendDataKeepingReplayViewport = (widget, additions, visibleBars, baseTimeframe) => {
  const chart = widget.getChart();
  const visible = chart.getVisibleTimeRange?.();
  if (typeof widget.appendDataBar === 'function') {
    additions.forEach(bar => widget.appendDataBar(bar));
  } else {
    widget.setData(visibleBars, baseTimeframe);
  }
  // Incremental updates can auto-scroll to the newest bar. Restore the
  // user's exact visible time range after the append.
  if (visible && typeof chart.setVisibleRange === 'function' && visible.to >= visible.from) {
    chart.setVisibleRange(visible.from, visible.to);
  }
};

const setDataKeepingReplayViewport = (widget, data, baseTimeframe, previousBars) => {
  const chart = widget.getChart();
  const visible = chart.getVisibleTimeRange?.();
  const previousLast = previousBars?.length ? previousBars[previousBars.length - 1].time : null;
  widget.setData(data, baseTimeframe);
  const nextLast = data.length ? data[data.length - 1].time : null;
  if (!visible || previousLast == null || nextLast == null
    || typeof chart.setVisibleRange !== 'function' || visible.to < visible.from) return;
  // Keep the viewport's distance from the replay edge and its zoom level.
  // This prevents backward/forward seeking from resetting the chart to its
  // default right-aligned range.
  const span = visible.to - visible.from;
  const distanceFromReplayEdge = previousLast - visible.to;
  const nextTo = nextLast - distanceFromReplayEdge;
  chart.setVisibleRange(nextTo - span, nextTo);
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
}) => {
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
    const cells = [{
      symbol: ticker,
      timeframe,
      theme: 'dark',
      ui: 'modern',
      trading: false,
      features: { replay: false, 'dock.watchlist': false, depthLadder: false },
      resampleTimeframes: true,
    }];
    const grid = new ChartWidgetGrid(hostRef.current, {
      layout: '1x1',
      layoutChoices,
      cells,
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
        if (barsRef.current.length) widget.setData(barsRef.current, baseTimeframeRef.current);
        setGridRevision(value => value + 1);
      },
    });
    gridRef.current = grid;
    grid.getWidgets().forEach(widget => {
      if (barsRef.current.length) widget.setData(barsRef.current, baseTimeframeRef.current);
    });
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
        if (previous.length && !identityChanged) {
          setDataKeepingReplayViewport(widget, visibleBars, baseTimeframe, previous);
        } else {
          widget.setData(visibleBars, baseTimeframe);
        }
      });
    } else if (visibleBars.length > previous.length) {
      const additions = visibleBars.slice(previous.length);
      grid.getWidgets().forEach(widget => {
        appendDataKeepingReplayViewport(widget, additions, visibleBars, baseTimeframe);
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
    grid.getWidgets().forEach((widget, index) => {
      const chart = widget.getChart();
      const oldIds = widget.__rrReplayDrawingIds || [];
      if (oldIds.length) chart.removeDrawings(oldIds);
      const ids = [];
      const anchorTime = visibleBars.length ? visibleBars[visibleBars.length - 1].time : Date.now();
      const addLevel = (price, label, color, time = anchorTime) => {
        if (price == null || !Number.isFinite(Number(price))) return;
        ids.push(chart.addDrawing({
          type: 'horizontalLine',
          anchors: [{ time, price: Number(price) }],
          style: { color, lineWidth: 1, lineStyle: 'dashed', text: label, textColor: color },
          locked: true,
          name: 'Replay · ' + label,
        }));
      };
      if (pendingOrder) addLevel(pendingOrder.triggerPrice, 'PENDING ENTRY', '#f59e0b');
      if (position) {
        addLevel(position.entryPrice, position.direction.toUpperCase() + ' ENTRY', '#60a5fa', (position.entryTime || 0) * 1000);
        addLevel(position.stopPrice, 'STOP', '#ef4444');
        addLevel(position.targetPrice, 'TARGET', '#22c55e');
      }
      widget.__rrReplayDrawingIds = ids;
    });
  }, [position, pendingOrder, visibleBars, gridRevision]);
  return (
    <div className="w-full h-[430px] min-w-0" ref={hostRef} data-active-chart={activeChart} />
  );
};

module.exports = ReplayTradeCanvasGrid;
module.exports.default = ReplayTradeCanvasGrid;
