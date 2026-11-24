# Manual Backtesting — Chart Replay

## Product direction

RR Metrics owns the backtesting tools and experience. Historical market data is optional and is purchased/licensed independently by each user. RR Metrics must not bundle or redistribute provider data.

Historical data is imported and managed centrally under Settings → Providers → Historical Futures, using a shared internal market-data interface so the replay engine is independent of the provider and source file format. The replay workspace must never ask users to upload, select, or manage source files. It consumes the available catalogue and handles data retrieval automatically.

### Replay workspace product requirements

- The user chooses a market/instrument and a historical date/time range from the data that is actually available to that user.
- Only instruments with usable historical data are offered. Do not show a hard-coded list of instruments that may have no data.
- Date-range controls are bounded by the selected market/source coverage. Show the actual available coverage and prevent selecting unavailable periods. If coverage has gaps, do not imply that the entire range is continuous.
- Offer only chart timeframes that can be served from the available data. This includes native stored timeframes and higher timeframes that RR Metrics can reliably aggregate from a lower timeframe. Never offer a timeframe that would require inventing missing resolution or unsupported downsampling.
- RR Metrics automatically chooses the appropriate source dataset(s), queries the selected range, and prepares the requested timeframe(s). Source selection and dataset IDs remain internal implementation details unless the user explicitly opens an advanced diagnostic view.
- Changing the market, date range, or timeframe updates the replay data automatically. There is no separate manual data-loading workflow in the normal path.
- The replay chart supports multi-panel layouts similar to TradingView: each panel can use its own supported timeframe, while all panels share one replay clock and reveal only information available at that replay instant.
- The primary execution chart is distinct from context charts. Orders, fills, stops and targets are managed against the chosen execution timeframe; other panels provide market context.
- All displayed dates and times respect the user's RR Metrics date, time and timezone preferences. Stored timestamps and query boundaries remain unmodified UTC instants.
- Keep the experience automatic and maintainable. Prefer straightforward, deterministic aggregation and execution assumptions over exchange-level simulation complexity.

## First implementation milestone

The first Chart Replay view is an interactive frontend prototype alongside the existing Backtesting session journal.

It currently supports:
- Candlestick charting using TradingView Lightweight Charts.
- Generated synthetic demonstration candles for development/empty states only. They must never be presented as selectable historical markets.
- Play, pause, single-bar stepping, replay speed and pre-trade seeking.
- Simulated long/short market entries, configurable quick contract-size presets, optional stop-loss and take-profit levels, manual close and automatic stop/target exits.
- Simulated limit and stop-market entry orders with pending-order cancellation and chart price markers. Limit orders fill at the limit or a better opening price; stop-market orders fill at the stop or worse when the market gaps through it.
- Single play/pause toggle and configurable replay speed.
- Basic closed-trade statistics and a trade history table.

Historical source files and normalized datasets are managed by the central Historical Futures provider. Replay sessions and simulated trades remain temporary unless a later persistence feature is explicitly implemented.

## Execution assumptions and limitations

- Market entries are simulated at the close of the last revealed candle. Limit and stop-market orders are evaluated against each subsequently revealed candle; pending orders do not fill on the candle in which they are placed.
- Stop and target checks use the high/low of each subsequent candle.
- If a candle touches both stop and target, the stop is assumed to have executed first. This is a conservative bar-based assumption, not a reconstruction of actual intrabar sequence.
- Stop and target fills are simulated at their configured prices. Limit entries may receive a better fill at the candle open; stop-market entries account for gaps through the stop price. Intrabar sequencing, queue position, bid/ask spread, slippage, fees, commissions, partial fills and market depth are not yet modelled.
- P/L uses the selected instrument's point value. It is a gross estimate before trading costs.
- The chart starts with synthetic demonstration data. It must be clearly labelled as synthetic and never presented as real historical market data.

## Data and replay roadmap

1. Centralize historical data ingestion, ownership, normalization and range queries under Settings → Providers → Historical Futures.
2. Make replay selection catalogue-driven: available markets, actual coverage and only supported/native-or-aggregatable timeframes. Automatically query data when the user's selection changes.
3. Add multi-panel replay layouts with independent timeframes and one synchronized replay clock.
4. Add deterministic higher-timeframe aggregation from the best available lower-timeframe source. Respect exchange/session candle boundaries and never expose incomplete future information during replay.
5. Integrate tick replay and practical tick-driven execution using the project's agreed accuracy/complexity trade-off.
6. Consider persistent backtest sessions, trades, settings and statistics after the core practice workflow is established.

Provider-specific parsing must normalize into a common market-data contract.

Never commit user-purchased or provider-supplied historical datasets to this public repository. Keep test fixtures synthetic or otherwise explicitly redistributable.
