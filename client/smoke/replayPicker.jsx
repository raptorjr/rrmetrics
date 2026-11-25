const React = require('react');
const { createRoot } = require('react-dom/client');
const ReplayTradeCanvasGrid = require('../components/pages/ReplayTradeCanvasGrid').default;
require('../styles/globals.css');

const start = 1794186000;
const candles = Array.from({ length: 120 }, (_, i) => ({
  time: start + i * 60, open: 27000 + i, high: 27004 + i,
  low: 26996 + i, close: 27001 + i, volume: 100,
}));
createRoot(document.getElementById('app')).render(
  <ReplayTradeCanvasGrid ticker="NQ" timeframe="1m" baseTimeframe="1m"
    baseCandles={candles} replayTime={start + 60 * 80} />
);
