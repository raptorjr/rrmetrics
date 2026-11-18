# Fork changes

This file records changes maintained in the `raptorjr/rrmetrics` fork. It is not the upstream project's changelog.

The fork keeps `main` aligned with upstream and develops additional work on `development`. To use the fork-specific features, clone that branch:

```bash
git clone --branch development https://github.com/raptorjr/rrmetrics.git
cd rrmetrics
```

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

## Deployment notes

- Fork-specific changes are developed on `development`; upstream's `main` branch is not the deployment target for these additions.
- Run the development-branch CI before deploying.
- The Topstep automatic-sync feature is opt-in and remains off until explicitly enabled in Settings.
- Read [Topstep sync](TOPSTEP-SYNC.md) for importer behaviour, reconciliation, account settings, scheduling, diagnostics, and Unraid deployment.
- Read [Calendar and display preferences](CALENDAR-AND-PREFERENCES.md) for the calendar views, tile customization, and time display settings.

## Documentation maintenance

Update this changelog whenever a user-visible feature, importer/reconciliation behaviour, data migration, or operational requirement changes. Keep detailed usage and troubleshooting instructions in the relevant document under `docs/`.
