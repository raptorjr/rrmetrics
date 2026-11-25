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
- TradeCanvas candlestick charting with independently positioned and resampled multi-chart layouts. The host replay policy preserves horizontal anchors and follows new candles near 90% of the plot width.
- Generated synthetic demonstration candles for development/empty states only. They must never be presented as selectable historical markets.
- Play, pause, single-bar stepping, replay speed and pre-trade seeking.
- Simulated long/short market entries, configurable quick contract-size presets, optional stop-loss and take-profit levels, manual close and automatic stop/target exits.
- Simulated limit and stop-market entry orders with pending-order cancellation and interactive chart order lines. Limit orders fill at the limit or a better opening price; stop-market orders fill at the stop or worse when the market gaps through it.
- Single play/pause toggle and configurable replay speed.
- Basic closed-trade statistics and a trade history table.

Historical source files and normalized datasets are managed by the central Historical Futures provider. Replay sessions and simulated trades remain temporary unless a later persistence feature is explicitly implemented.

## Interactive chart orders

- Settings (the gear icon and Settings label beside the layout selector) in the active chart toolbar controls currency, points, ticks and percentage labels (multiple allowed). Shared across replay charts and devices, stored by the local user profile in SQLite, and display-only. Preferences load from the server before editing; changes preview immediately and Save & close persists them. Cancelling restores the last saved values; failed saves are shown and can be retried. Pending entries show distance from the last revealed market price; active position and protective labels show signed movement from entry. Currency uses total contracts; other units describe price movement. History overlays remain future work.

- Right-click a price on any chart to place market, limit or stop-market entries using the order panel's configurable quantity presets. The available pending types depend on the last revealed execution candle's close, not the chart's own timeframe.
- The open position entry line, tag and price-axis badge are green for positive unrealized P/L, red for negative and blue at zero. All charts use the last revealed execution price; SL/TP and pending-order colours are unchanged. The panel's Cancel pending order action is a filled red button.
- Drag a pending order to move its entry; drag the SL and TP buttons from an open position to create protective levels, or drag their existing lines to move them. New levels start at the entry line and follow the pointer; clicking without dragging does not place a protective order. The chart's close and cancel buttons route to RR Metrics. Changes synchronize across every chart and the order panel.
- The BE button moves or creates the stop at the entry price, leaving the target untouched. It is only available when the revealed market price permits the stop and it would not loosen existing protection. BE refers to gross entry-price breakeven, not net of fees or slippage.
- RR Metrics owns order state and simulation. TradeCanvas renders the interactive lines and emits intents; its order ticket, native replay and execution adapter are not used. All changed levels are rounded to the configured instrument's tick size and validated against the latest revealed execution price. The original risk for R-multiple is retained when a stop is subsequently moved or removed.
- One net position and one working entry/size-adjustment order are supported. The order panel places type first, prefills non-market prices from the last revealed close on type selection, keeps the draft fixed as replay moves, provides an explicit reset-to-market control, and validates each Buy/Sell button continuously against the latest revealed close (strictly above/below, not equal). Submission revalidates the same rules using the latest replay state, and uses the selected contract quantity for buy/sell. Same-side orders add at weighted average; opposite-side orders reduce or flatten, never reverse. Existing protective levels apply to remaining quantity. SL/TP are managed on the chart only. A whole round trip counts as one trade when flat; partial realized P/L is displayed separately while open. Fills are retained in the temporary trade record. Initial R risk is preserved, plus known risk of added contracts; R is unavailable if an exposure has unknown risk. BE uses the remaining average entry rounded toward protection to a valid tick. Reversing, trailing stops, commissions and persistent sessions remain deferred.

## Execution assumptions and limitations

- Market entries are simulated at the close of the last revealed candle. Limit and stop-market orders are evaluated against each subsequently revealed candle; pending orders do not fill on the candle in which they are placed. If an existing protective exit and a pending size adjustment touch in the same bar, protective exit takes priority and the working order is cancelled.
- Stop and target checks use the high/low of each subsequent candle.
- If a candle touches both stop and target, the stop is assumed to have executed first. This is a conservative bar-based assumption, not a reconstruction of actual intrabar sequence.
- Stop and target fills are simulated at their configured prices. Limit entries may receive a better fill at the candle open; stop-market entries account for gaps through the stop price. Intrabar sequencing, queue position, bid/ask spread, slippage, fees, commissions, partial fills and market depth are not yet modelled.
- P/L uses the selected instrument's point value and quantity in the entry label, SL/TP labels (including drag previews), and simulated results. It is a gross estimate before trading costs.
- The workspace uses the available Historical Futures catalogue; synthetic fixtures used in tests are not selectable historical markets.

## Data and replay roadmap

1. Centralize historical data ingestion, ownership, normalization and range queries under Settings → Providers → Historical Futures. **Implemented.**
2. Make replay selection catalogue-driven: available markets, actual base-resolution coverage and only supported/native-or-aggregatable timeframes. Automatically query data when the user's selection changes. **Implemented in the initial replay UI; date controls are now constrained to one continuous coverage interval. Runtime validation against each user's installed datasets remains necessary.**
3. Add multi-panel replay layouts with independent timeframes and one synchronized replay clock. **Initial 1/2/3-panel layouts added; context charts reveal data only through the current replay time.**
4. Add deterministic higher-timeframe aggregation from the best available lower-timeframe source. Respect exchange/session candle boundaries and never expose incomplete future information during replay. **UTC-bucket aggregation implemented; exchange-specific session boundary configuration remains follow-up work.**
5. Integrate tick replay and practical tick-driven execution using the project's agreed accuracy/complexity trade-off.
6. Consider persistent backtest sessions, trades, settings and statistics after the core practice workflow is established.

Provider-specific parsing must normalize into a common market-data contract.

Never commit user-purchased or provider-supplied historical datasets to this public repository. Keep test fixtures synthetic or otherwise explicitly redistributable.

## Durable replay sessions V1

Replay sessions are separate from the manual journal and broker data. Create a session with a covered historical period and starting balance. The first supported market is selected automatically; the source resolution drives the execution clock. The entire workspace opens edge-to-edge, with a compact account header and fullscreen. Save & exit waits for a revision-checked SQLite checkpoint; autosave polls meaningful state every 2.5 seconds. Completed round trips are stored separately and transactionally with checkpoints. Resume pauses at the saved candle and restores the captured grid and horizontal visible ranges; source fingerprint changes prevent resume. Independent symbols, market selection inside the chart, Dashboard account switching, manual vertical viewport verification and full browser round-trip tests remain outstanding. Do not reset or rewrite a durable trade history.
