# Manual Backtesting — Chart Replay

## Product direction

RR Metrics owns the backtesting tools and experience. Historical market data is optional and is purchased/licensed independently by each user. RR Metrics must not bundle or redistribute provider data.

Historical data providers should eventually be configured under Settings → Providers, using a shared internal market-data interface so the replay engine is independent of the provider and source file format.

## First implementation milestone

The first Chart Replay view is an interactive frontend prototype alongside the existing Backtesting session journal.

It currently supports:
- Candlestick charting using TradingView Lightweight Charts.
- Generated synthetic demonstration candles for NQ, MNQ, ES, MES, GC and MGC.
- CSV upload for OHLCV candles using timestamp/time, open, high, low, close and optional volume columns.
- Play, pause, single-bar stepping, replay speed and pre-trade seeking.
- Simulated long/short entries, contract quantity, optional stop-loss and take-profit levels, manual close and automatic stop/target exits.
- Basic closed-trade statistics and a trade history table.

Uploaded CSV data and simulated trades are held in browser memory only. They are not persisted. The first prototype does not import Parquet directly and does not include a server-side historical data manager.

## Execution assumptions and limitations

- Entries are simulated at the close of the last revealed candle.
- Stop and target checks use the high/low of each subsequent candle.
- If a candle touches both stop and target, the stop is assumed to have executed first. This is a conservative bar-based assumption, not a reconstruction of actual intrabar sequence.
- Stop and target fills are simulated at their configured prices. Gaps, queue position, bid/ask spread, slippage, fees, commissions, partial fills and market depth are not yet modelled.
- P/L uses the selected instrument's point value. It is a gross estimate before trading costs.
- The chart starts with synthetic demonstration data. It must be clearly labelled as synthetic and never presented as real historical market data.

## Data handling roadmap

1. Use small CSV candle samples to validate chart replay and the user experience.
2. Add a durable local data catalogue and user-controlled historical data import.
3. Add Parquet ingestion and efficient server-side range queries. Evaluate DuckDB or another Node-compatible reader before selecting the production storage/query architecture.
4. Add tick replay and tick-sequenced simulated execution.
5. Add persistent backtest sessions, trades, settings and statistics.
6. Add provider adapters under Settings → Providers. Provider-specific parsing must normalize into a common market-data contract.

Never commit user-purchased or provider-supplied historical datasets to this public repository. Keep test fixtures synthetic or otherwise explicitly redistributable.
