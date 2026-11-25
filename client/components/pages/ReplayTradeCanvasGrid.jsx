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

const ReplayTradeCanvasGrid = ({
  ticker,
  timeframe,
  baseCandles,
  replayTime,
  baseTimeframe,
  position,
  pendingOrder,
  replayLayout,
  contextTimeframes = [],
  onActiveChartChange,
  onLayoutChange,
}) => {
  const hostRef = useRef(null);
  const gridRef = useRef(null);
  const barsRef = useRef([]);
  const baseTimeframeRef = useRef(baseTimeframe);
  const dataIdentityRef = useRef('');
  const [gridRevision, setGridRevision] = useState(0);
  const lastExternalTimeframeRef = useRef(timeframe);
  const contextTimeframesRef = useRef(contextTimeframes);
  const [activeChart, setActiveChart] = useState(0);

  useEffect(() => {
    contextTimeframesRef.current = contextTimeframes;
  }, [contextTimeframes.join('|')]);

  const visibleBars = useMemo(() => {
    if (!baseTimeframe || !replayTime) return [];
    const interval = timeframeSeconds(baseTimeframe);
    return toBars(baseCandles.filter(bar => bar.time + interval <= replayTime));
  }, [baseCandles, baseTimeframe, replayTime]);

  const layout = replayLayout === 'split3' ? '1x3' : replayLayout === 'split2' ? '1x2' : '1x1';

  useEffect(() => {
    if (!hostRef.current) return undefined;
    const defaultTimeframes = [timeframe, ...contextTimeframesRef.current];
    const cells = defaultTimeframes.map((tf, index) => ({
      symbol: ticker,
      timeframe: tf,
      theme: 'dark',
      ui: 'modern',
      trading: false,
      features: { replay: false, 'dock.watchlist': false, depthLadder: false },
      resampleTimeframes: true,
    }));
    const grid = new ChartWidgetGrid(hostRef.current, {
      layout,
      layoutChoices: ['1x1', '1x2', '1x3'],
      cells,
      bar: false,
      sharedToolbar: true,
      sharedDrawingTools: true,
      sync: { symbol: false, interval: false, crosshair: true, time: false, drawings: false, replay: false },
      onActiveChange: index => {
        setActiveChart(index);
        if (onActiveChartChange) onActiveChartChange(index);
      },
      onChartAdd: (widget, index) => {
        if (index > 0) {
          const desiredTimeframe = contextTimeframesRef.current[index - 1];
          if (desiredTimeframe && widget.getTimeframe() !== desiredTimeframe) {
            void widget.setTimeframe(desiredTimeframe);
          }
        }
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

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    if (grid.getLayout() !== layout) grid.setLayout(layout);
  }, [layout]);

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
      grid.getWidgets().forEach(widget => widget.setData(visibleBars, baseTimeframe));
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
    contextTimeframes.forEach((nextTimeframe, index) => {
      const chartIndex = index + 1;
      const widget = grid.getWidget(chartIndex);
      // A context chart becomes user-controlled when it is active. Do not
      // overwrite its independent timeframe when the replay selection changes.
      if (widget && grid.getActiveIndex() !== chartIndex && widget.getTimeframe() !== nextTimeframe) {
        void widget.setTimeframe(nextTimeframe);
      }
    });
  }, [contextTimeframes.join('|'), gridRevision]);

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
  const layoutOptions = [
    { value: 'single', label: '1', title: 'Single chart' },
    { value: 'split2', label: '2', title: 'Two charts' },
    { value: 'split3', label: '3', title: 'Three charts' },
  ];

  return (
    <div className="w-full min-w-0">
      <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-border bg-bg-surface">
        <div className="flex items-center gap-2 text-xs text-text-muted">
          <span className="font-medium text-text-secondary">Chart layout</span>
          <span>{replayLayout === 'single' ? 'Single' : replayLayout === 'split2' ? '2 charts' : '3 charts'}</span>
        </div>
        <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-bg-input p-1" role="group" aria-label="Chart layout">
          {layoutOptions.map(option => {
            const disabled = option.value === 'split2'
              ? contextTimeframes.length < 1
              : option.value === 'split3' && contextTimeframes.length < 2;
            return (
              <button
                key={option.value}
                type="button"
                title={option.title}
                aria-label={option.title}
                aria-pressed={replayLayout === option.value}
                disabled={disabled}
                onClick={() => onLayoutChange && onLayoutChange(option.value)}
                className={"min-w-8 h-7 rounded-md px-2 text-xs font-semibold transition-colors disabled:opacity-30 disabled:cursor-not-allowed " + (replayLayout === option.value ? 'bg-accent text-accent-text' : 'text-text-secondary hover:text-text-primary hover:bg-bg-surface')}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="w-full h-[430px] min-w-0" ref={hostRef} data-active-chart={activeChart} />
    </div>
  );
};

module.exports = ReplayTradeCanvasGrid;
module.exports.default = ReplayTradeCanvasGrid;
