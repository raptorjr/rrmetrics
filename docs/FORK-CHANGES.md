## Replay workspace refinements

- Shared Dashboard and Analytics now accept isolated replay accounts through a read-only projection; Trading/Backtesting selector, SQLite-backed independent selections, Statistics navigation, and read-only backtesting calendar. No simulated trades inserted into the real journal.

- Replay session row actions: Rename and confirmed Delete, using owner/revision-checked APIs and cascading only the selected replay account's trades. Documented future Statistics navigation and user-confirmed multi-symbol acceptance.

- Create-session historical range shortcuts and eligible market names; viewport-bounded calendar popup outside the dialog scroll container, minute-precision date/time selection with inward-rounded coverage.

- Independent chart symbols and contract-specific historical context, per-symbol timeframe menus and drawings, and exact-origin execution guards. Restore context source fingerprints without mixing contracts or exposing future bars.

- Extracted the trade editor clock field into a shared time picker; Go to uses the same field and dropdown with minute precision, while trade editing keeps seconds.

- Positioned Go to before candle type and aligned its display and time controls with user timezone and 12/24-hour preferences, preserving existing timezone-anchored schedules until edited.

- Added configurable New York-time Go to destinations in the shared chart toolbar, SQLite-backed profile preferences, forward-only execution-safe jumps and immediate clearing of the restored status once ready.

- Grouped and centered replay session selector/account metrics with stable header columns during autosave; disabled individual chart fullscreen. Leading play action in the replay list, replay-first tabs, accurate manual-journal description and one centered Start Session action.

- Replay polish: session selector with save-before-switch, centered account values, quieter save status, one replay progress readout, visible BE styling, restart clears drawings, chart display starts at a compatible favourite, source intervals in menu, and candle-matched default volume colours.

- Brighter labels, centered playback controls, simulated-time speed, explicit loading state, bottom-aligned statistics, and revision-checked Restart retaining layout and indicators. Same-symbol drawings synchronize, new charts keep the correct instrument, chart viewports are captured/restored independently and native dialogs follow the workspace fullscreen. Existing broker trades untouched.

## 2026-11-25 — Persistent replay sessions (first version)

- Added isolated virtual replay accounts with create/list/resume, SQLite checkpoint revisions and append-only completed trade records. Historical source fingerprint prevents silent substitution. Full-window workspace, compact balance/equity header, Save & exit and workspace fullscreen; collapse trade history and statistics. One execution instrument per session; multi-symbol and shared analytics are deferred. Browser restoration verification required.

## 2026-11-25

### Interactive chart replay trading

- Restored the visible Settings label alongside the gear, made Cancel pending order a filled button, and colour the open-position entry line/tag/axis badge by unrealized P/L (green/red/blue at zero) on every chart. SL/TP and pending-order colours remain independent.

- Removed the redundant contract counter. Limit/stop entry shows current market price and an explicit reset-to-market button; Buy/Sell availability follows the latest revealed price without changing the entered draft. Final submission uses the same validator.

- Compact order panel: type and seeded limit/stop price first, quantity controls then always-available buy/sell while no order is working, chart-only SL/TP, smaller Close position and BE to its right. Gear and Settings label in the chart toolbar. Weighted-average adds, partial exits and complete round-trip accounting with one working adjustment, no implicit reversal, and protection-first ambiguous candle handling.

- Keep the Trading settings button visible in the active native toolbar by excluding it from TradeCanvas automatic overflow folding. Retains the existing shared layout selector and settings persistence.

- Added a dedicated Trading settings dialog on the active chart toolbar. Currency, points, ticks and percentage can be combined; preferences are shared across charts and devices, saved in the SQLite database with explicit save confirmation. Pending orders show market distance, not P/L. No simulation or statistics changes.

- Corrected SL/TP dollar labels to use the same futures point value and contract quantity as simulated execution, including drag previews. No execution or statistics changes.

- New SL/TP drags start directly at the position entry rather than jumping to a preset distance. Clicking without dragging does not create a protective order.

- Added native TradeCanvas position and pending-order lines, draggable entry, SL and TP levels, chart cancel/close actions and synchronized order state on every replay chart.
- Added right-click market, limit and stop-market order entry with quantity submenus, contextual position management and a BE button in the existing panel.
- Validate changed prices against the last revealed execution candle and snap them to instrument ticks. Preserve original risk for R-multiple after BE or profitable stop changes.
- Keep the host replay engine authoritative, the layout picker and viewport behavior unchanged, and TradeCanvas dependencies pinned to exact fork commits. No live trading or database changes.

## 2026-11-24


### Manual chart replay — first frontend milestone

- Added a Chart Replay view alongside the existing Backtesting Session Journal; existing session and trade logging workflows remain available.
- Added TradingView Lightweight Charts candlestick charting, synthetic demonstration candles, and CSV OHLCV upload for local replay experiments.
- Added candle-by-candle playback, pause, speed controls, pre-trade seeking, simulated long/short entries, contract quantity, stop-loss and take-profit levels, manual close, and automatic bar-based exits.
- Added temporary closed-trade history and basic win-rate, net P/L, and profit-factor statistics.
- Replay uploads and simulated trades are held in browser memory only; no market data or replay trades are persisted yet. No provider-supplied data is committed to the repository.
- Documented execution assumptions and limitations, including conservative stop-first handling when both stop and target are touched in one candle, and the current absence of fees, slippage, partial fills, and tick-sequenced execution.
- Added the initial replay design and roadmap in `docs/BACKTESTING-REPLAY.md`.

### Independent responsive dashboard layouts

- Added separate saved tile sizes and positions for each dashboard at the 8-, 4-, and 2-column breakpoints. Moving or resizing tiles at one width no longer changes the arrangement saved for another width.
- Tile visibility and order remain shared across breakpoints, so hiding, showing, adding, or reordering a tile is consistent on all screen sizes.
- Existing dashboards retain their saved layout as the 8-column desktop layout. Initial 4- and 2-column arrangements are generated from that layout and persisted when the collection is saved; subsequent edits are breakpoint-specific.
- Added automated layout tests for collision-free placement, legacy dashboard migration, and independent saved positions.
- Corrected initial server loading so a delayed response selects the breakpoint that is active when loading completes, even if the browser width changed during the request.
- Kept minimum-area resize corrections aligned to whole breakpoint columns, preventing fractional logical widths at narrow sizes.
- Fixed the dashboard's breakpoint ref initialization order so the component no longer reads the breakpoint state before it is initialized.

# Fork changes

## 2026-11-24

### Server-side dashboard persistence

- Added a SQLite-backed dashboard settings API, scoped to the local user and each page's storage key so Dashboard and Analytics layouts remain separate.
- Existing browser dashboard collections and legacy templates are migrated on first server load when no server collection exists. The browser copy remains as a fallback.
- Server data is authoritative after migration. Dashboard editing waits for a successful load, and failed saves display a warning while retaining the local backup.
- The collection API validates dashboard structure, names, count, and payload size. Existing installations receive the new table through the normal idempotent schema initialization.
- Remote access is intended through the user's private Tailscale network; Tailscale is network access control, not application-level authentication.


### Dashboard selector and management

- Replaced the single Edit dashboard control with a named dashboard selector and popup list.
- Added per-dashboard actions for renaming, editing tiles, and deleting dashboards, with confirmation before deletion and protection against deleting the final dashboard.
- Added dashboard creation from a starter layout, a blank layout, or a copy of the current dashboard.
- Each dashboard now stores its own tile layout. Existing single-dashboard layouts are retained, and legacy saved layout templates are migrated into separate dashboards on first load.


### Trading Trend — conservative overall assessment

- Added an overall Financial Performance assessment with five possible states: Improving, Stable, Declining, Mixed, and Insufficient data.
- Grouped Expectancy and Profit Factor into one profitability dimension so correlated metrics do not count as separate votes. Average win and average loss provide supporting evidence.
- Replaced fixed dollar neutral ranges with instrument-aware thresholds. Reference ranges are expectancy ±15 ticks, profit factor ±0.36, average win ±21 ticks, and average loss ±19 ticks; monetary thresholds are scaled using the selected instrument's tick size and point value. The reference tick ranges were initially calibrated against available MGC history and remain provisional, not statistically validated for every instrument or asset class.
- Withhold the overall assessment when an instrument lacks a supported tick-size/point-value specification, as well as when comparison windows contain multiple instruments.
- Improving/Declining requires profitability and at least one supporting metric to agree, without meaningful opposing deterioration/improvement. Stable requires all dimensions to be neutral; conflicting or insufficiently corroborated movements are Mixed.
- Suppressed the overall classification for comparison windows containing multiple instruments because per-unit P/L is not cross-instrument normalization. Metric comparisons remain visible.
- Added scenario tests for improving, declining, stable, mixed, conflicting metrics, missing data, and the latest observed pattern.

This file records changes maintained in the `raptorjr/rrmetrics` fork. It is not the upstream project's changelog.

The fork keeps `main` aligned with upstream and develops additional work on `development`. To use the fork-specific features, clone that branch:

```bash
git clone --branch development https://github.com/raptorjr/rrmetrics.git
cd rrmetrics
```

## 2026-11-23

### Trading Trend tile — remove redundant instrument label

- Removed the ticker label from the tile footer. Instrument selection belongs in the shared filtering experience rather than being displayed as passive metadata.
- Added a follow-up backlog item to support ticker/instrument filtering in the shared Dashboard and Analytics filters; the current filter only supports dates.

### Trading Trend — fixed comparison windows and capped daily weighting

- Replaced adaptive trade-count windows with two consecutive fixed windows of eight active trading days: the eight most recent active days and the eight immediately preceding active days.
- Require at least 30 trades in each eight-day period before displaying metric comparisons.
- Replaced equal daily weighting with capped daily weighting. Each day is weighted by its trade count, capped at five, so low-volume days contribute less while high-volume days cannot dominate.
- Apply the weighting consistently to daily expectancy, profit factor, average win, and average loss. Actual trade counts remain visible.

### Trading Trend tile — simplified visual prototype

- Simplified the tile to an at-a-glance overall trend and comparison sample, followed by compact metric summaries showing recent value, change, and previous value.
- Moved the methodology explanation into the existing InfoTooltip beside the tile title; removed the in-tile methodology link and expandable section.
- Retained the shared view selector and reserved Trading Quality as a disabled future view.
- The tile now calculates live metric values from the selected trades. It estimates target sample size from the latest four active days, builds two comparison samples from complete active days (minimum four days and 20 trades per period), and calculates daily-weighted per-unit expectancy, profit factor, average win, and average loss. The metric grid adapts to the tile's available width. Directional change values are primary and green/red; current and previous metric values are secondary. Changes crossing zero or reaching 100% or more are shown as absolute deltas rather than exaggerated percentages when the previous value is close to zero. Direct position-quantity scaling is removed, but cross-instrument normalization is not solved; mixed-instrument samples are flagged. Overall Improving/Stable/Declining classification is intentionally withheld until normalization and neutral thresholds are validated.

### Trading Trend tile — adaptive sampling and daily weighting

- Rejected a fixed 20-trade comparison sample as the sole sizing method. Estimate typical trading frequency from the average number of trades across the latest 3–4 active trading days, excluding zero-trade days from that frequency calculation.
- Use the estimated average to derive an adaptive trade sample; the 3–4 days are a frequency-calibration window, not a fixed trend-measurement window.
- Prevent a high-volume scalping day from dominating the result: calculate normalized performance at the active-day level and give active days equal influence in the period comparison, rather than allowing days with more trades to receive more weight simply due to volume.
- A minimum trade sample is required before assigning a trend status. The minimum, target-equivalent duration, exact comparison-window construction, and treatment of days with very few trades remain open design details.

### Trading Trend tile — normalized performance direction

- Confirmed that the initial Financial Performance view will use normalized performance as its trend basis, rather than raw monetary P/L or a separate raw-financial-results view.
- The purpose is to compare trading performance without contract size alone making a larger-position period appear better. The calendar and existing financial views already provide context about actual monetary results over recent days and weeks.
- Normalization must be based on reliable execution-level data and account for partial exits, changing position sizes, and instrument-specific tick/point values where applicable. Simple division by contract count must not be assumed to be sufficient.
- Per-contract normalization does not by itself make different instruments directly comparable. A common risk-based measure such as R-multiples should be evaluated before cross-instrument comparisons are finalized.
- Exact calculation rules, sample sufficiency, thresholds, and aggregation remain to be designed. No Trading Trend implementation is included in this documentation change.


- Corrected the metric grid to use the tile's available width rather than viewport breakpoints. It now auto-fits as many metric cards as the tile can accommodate (minimum card width 220px), so a narrow tile on a large desktop no longer forces four cramped columns. Cards expand into available height without an internal vertical scrollbar.
### Trading Trend tile — initial scope clarified

- Defined the tile structure to accommodate two separate views: **Financial Performance** and **Trading Quality**.
- The initial release will implement Financial Performance only, using existing reliable trade data. Its proposed comparison is 20 recent closed trades versus the preceding 20, pending validation of methodology and sample sufficiency.
- Trading Quality is reserved as a future view in the same tile. It is not to be inferred from Topstep P/L or execution imports; meaningful assessment requires additional structured data and product workflows such as trade plans, strategy/setup definitions, and reviews.
- The two perspectives must remain distinct. Financial trend calculations, thresholds, and aggregation rules still require design before implementation.
- The tile must use the same view-selector control pattern already used by other RR Metrics tiles, rather than introducing a new navigation style.
- Recorded the earlier visual concept as the starting point: a clear overall trend status, visible comparison window, individual metric direction indicators, and a restrained period-comparison visual. Exact layout and styling remain open to refinement.


### RR Trading Score tooltip formatting

- Fixed the RR Trading Score information tooltip so the intended paragraph break renders as a real line break instead of displaying the literal `\n\n` characters.

### Account selector all-or-none toggle

- Changed the **All Accounts** row in the account selector to act as a toggle.
- When all accounts are selected, clicking **All Accounts** deselects every account.
- When any subset or no accounts are selected, clicking **All Accounts** selects every account.
- The existing **No Accounts** state is used when all accounts are deselected, preserving the distinction between no filter (all accounts) and an explicit empty selection.
- The selector remains open after clicking **All Accounts**, matching individual account and broker-group selection.
- The **Clear filter** action continues to close the selector.

## 2026-11-19

### Topstep historical account integrity

- Retained raw executions and saved account settings for accounts that are deselected or no longer appear in the current broker account list.
- Scoped voided-order reconciliation refreshes to accounts whose Orders history was successfully queried, preserving previously corroborated overrides for deselected accounts and accounts with failed Orders queries.
- Added tests for retaining, refreshing, and clearing per-account override evidence.

## 2026-11-18

### Topstep execution reconstruction

- Added deterministic reconstruction of positions from ProjectX execution legs, separated by account and contract.
- Combined multiple entries and partial exits into a single position with quantity-weighted entry and exit prices.
- Split reversals into a closed position and a new position in the opposite direction.
- Aggregated gross P&L, fees, and commissions across execution legs and calculated net P&L after costs.
- Used fill IDs when available and order IDs as the fallback execution grouping key; later versions of the same trade ID replace earlier versions during rebuild.
- Added sequence validation and warning-based quarantine. When an instrument's history becomes inconsistent, later positions and uncertain open balances are not published as if they were reliable.
- Added automated reconstruction tests covering partial exits, multiple fills, reversals, cost aggregation, voided records, and unsafe sequences.

### Topstep import reconciliation

- Added an Orders API cross-check for historical executions.
- Added a narrow reconciliation rule for the case where all trade legs for an order are marked voided but the broker order history confirms a filled order and an exact matching fill quantity.
- Kept other voided execution legs quarantined; the change does not globally accept voided records.
- Kept sync resilient when the optional order-history cross-check is unavailable.
- Restored and retained detailed per-connection sync diagnostics and the imported-data clear control.

### Topstep incremental sync

- Changed normal manual and scheduled syncs to fetch only the rolling last 24 hours of trades and orders.
- Kept the initial import as a full-history fetch, then automatically performs a full-history reconciliation every seven days.
- Added an explicit **Full reconciliation** action for users who want to run a full-history pass before the weekly schedule.
- Incremental broker responses are upserted into retained local raw execution history; position reconstruction continues to use the complete locally stored history.
- Persisted broker-verified voided-order overrides so incremental rebuilds do not accidentally drop older executions previously corroborated by the Orders API.
- Added a visible last-full-reconciliation timestamp and reset it when imported data is explicitly cleared or the selected account / copy-trading lead selection changes.

### Topstep automatic sync

- Added server-side automatic syncing for each Topstep connection.
- Automatic sync is opt-in and disabled by default; existing connections are not silently enabled.
- Added selectable intervals: 1, 5, 10, 15, or 30 minutes (default 5 minutes).
- Added last-attempt, next-run, and last-error status to the connection settings.
- Persisted the latest automatic sync result so diagnostics remain available after a page refresh.
- Reuses the existing ProjectX sync importer and reconciliation path rather than introducing a second import implementation.
- Added a per-connection in-process lock to avoid overlapping manual and scheduled sync requests.
- Added additive SQLite migrations so existing installations gain the new settings without replacing their database.

### Topstep account management

- Replaced the connection-wide Eval classification control with per-account classification: Evaluation, Express Funded (XFA), Live Funded, and Other / Practice.
- Added an optional friendly display name for each account while retaining the original Topstep account ID and broker name for matching.
- Account selection and classification are managed inline in the Topstep integration panel.
- Added additive SQLite storage for per-account settings. Saving account settings does not immediately rewrite existing imported rows; the next sync rebuilds the imported projection using the saved account names and Eval classification.
- Evaluation is reflected in RR Metrics' existing `is_eval` trade flag. XFA and Live Funded are retained as distinct account types in connection settings but currently map to non-Eval in the existing trade model.

### Customizable Dashboard and Analytics metric tiles

- Added a shared metric-tile customization component used by Dashboard and Analytics.
- Users can show or hide supported metric tiles, drag them into a preferred order, and reset each page to its original layout.
- Dashboard and Analytics preferences are stored independently in browser local storage.
- Existing default tile sets are preserved for users who have not customized either page.
- Tile customization changes presentation only; metric calculations, trade data, filters, and charts remain unchanged.

### Display preferences

- Added a global 12-hour / 24-hour time format preference in Settings → Preferences. The selected format is saved in browser local storage.
- Added a display time zone preference with Automatic browser detection and manual IANA time zone selection. The preference is saved in browser local storage.
- Shared trade date/time display formatting uses the selected time zone and format. Trading-session calculations and market-day grouping remain anchored to America/New_York; only displayed timestamps are converted.

### Calendar yearly view

- Added a Yearly view alongside Daily, Heatmap, and Monthly in the calendar.
- Added monthly P&L, Win rate, and Trades metric modes, with color intensity to compare months and years.
- Added year totals and clickable month cells that open the selected month in Daily view.
- Monthly and yearly statistics use the calendar's existing trade-date grouping. Win rate excludes breakeven trades and is calculated from decisive trades.
- The Yearly view's GitHub Actions CI run passed; interactive verification in the Babylon self-hosted installation is still pending.

### Consistent metric tiles and explanations

- Standardized shared metric-card styling across Dashboard, Analytics, and Trades, using Dashboard as the visual reference.
- Extracted the Dashboard Avg Win / Loss visualization into a shared component and reused it in Analytics and Trades so the ratio, comparison bar, amounts, spacing, and help text match.
- Added a consistent, keyboard- and touch-accessible question-mark tooltip to metric cards. Explanatory copy is shown in the tooltip rather than taking up permanent tile space.
- Added concise definitions for Profit Factor, Expectancy, Drawdown, Breakeven Rate, Sharpe / Sortino, Kelly risk, and other metrics where a definition helps interpretation.

### Trades tracking views and overview tiles

- Added Day, Week, and All tracking views to the Trades page, with All remaining the default view to preserve the existing trade-table workflow.
- Day and Week group trades by the New York trading-session date. Group summaries show net P&L, trade count, win rate, and profit factor, and can be expanded or collapsed to review the underlying trades.
- Added customizable overview tiles to the All view, reusing the shared Dashboard / Analytics tile customization component. The default tiles show net P&L, profit factor, win rate, and average win/loss; additional trade metrics can be enabled and reordered.
- Existing filters, sorting, table columns, trade editing, bulk actions, and CSV export remain available across the views.
- Aggregate monetary metrics are withheld when multiple currencies are present rather than combining unlike currencies. Individual trade monetary values use their recorded currency code.

### Account and trade currency foundation

- Added an ISO currency code to each trade record, with an additive SQLite migration that assigns existing trades USD to preserve the current RR Metrics assumption.
- Added a per-account P&L currency selector to Topstep account settings (USD, EUR, GBP, CAD, AUD, CHF, JPY). Existing Topstep accounts default to USD and retain their saved classification and display name.
- Imported Topstep positions now inherit the selected account currency, and subsequent reconciliations update the trade currency alongside P&L and fee fields.
- The Yearly calendar formats P&L using the currency code instead of assuming a dollar sign. If a month or year contains more than one currency, its P&L cell displays “Mixed currencies” instead of presenting an invalid combined amount.
- This is the currency metadata and display foundation. Currency conversion into a single reporting currency is a separate follow-up; mixed-currency totals are deliberately not converted or combined for display.

### TradeZella CSV import and matching

- Added a dedicated TradeZella CSV importer with account selection, persistent source-account mapping, friendly names, currency and Evaluation settings.
- Matching first uses the explicitly mapped RR account, then checks other RR accounts for possible cross-account duplicates. A possible match outside the selected account is held for review, including trades already linked to another TradeZella source account, so umbrella exports such as Practice do not silently duplicate Topstep history.
- Source fingerprints are retained so repeat imports do not create duplicates.
- Supports aggregated matching in both directions only when the matching RR position or group is unique. If multiple individual trades, aggregate candidates, or partial-position groups satisfy the rules, affected rows are held for review rather than linked arbitrarily.
- Supports one TradeZella row matching multiple RR trades only when entry/exit boundaries, signed net quantity, gross/net P&L, fees and commissions reconcile uniquely.
- Reversal episodes whose signed net direction conflicts with the TradeZella side remain in review; matching absolute quantities alone is not sufficient evidence.
- Uncertain matches are held and not imported as new trades. The detailed per-trade review table used during importer validation has been removed from the user interface; the preview and import summary expose counts only.

## Deployment notes

- Fork-specific changes are developed on `development`; upstream's `main` branch is not the deployment target for these additions.
- Run the development-branch CI before deploying.
- The Topstep automatic-sync feature is opt-in and remains off until explicitly enabled in Settings.
- Read [Topstep sync](TOPSTEP-SYNC.md) for importer behaviour, reconciliation, account settings, scheduling, diagnostics, and Unraid deployment.
- Read [Calendar and display preferences](CALENDAR-AND-PREFERENCES.md) for the calendar views, tile customization, and time display settings.

## Documentation maintenance

Update this changelog whenever a user-visible feature, importer/reconciliation behaviour, data migration, or operational requirement changes. Keep detailed usage and troubleshooting instructions in the relevant document under `docs/`.


### Responsive dashboard breakpoint observer fix

- Fixed the grid-width observer so it attaches after the dashboard finishes loading and the grid element is mounted. This allows wide desktop screens to select the 8-column layout instead of remaining at the initial 2-column state.
- Added a regression test to ensure the observer effect is tied to `dashboardReady`.
