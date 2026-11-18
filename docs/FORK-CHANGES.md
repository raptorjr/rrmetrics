# Fork changes

This file records changes maintained in the `raptorjr/rrmetrics` fork. It is not the upstream project's changelog.

The fork keeps `main` aligned with upstream and develops additional work on `development`. To use the changes below, clone that branch:

```bash
git clone --branch development https://github.com/raptorjr/rrmetrics.git
```

## 2026-11-18

### Topstep account management

- Replaced the connection-wide Eval classification control with per-account classification: Evaluation, Express Funded (XFA), Live Funded, and Other / Practice.
- Added an optional friendly display name for each account while retaining the original Topstep account ID and broker name for matching.
- Kept account selection and account classification visible inline in the Topstep integration panel rather than behind a separate Settings button.
- The available account list is fetched from Topstep after connecting and refreshed with connection status.
- Added additive SQLite storage for per-account settings. Existing imported trade rows are not rewritten just by saving account settings; the next sync rebuilds the imported projection using the saved account names and Eval classification.
- Evaluation is reflected in RR Metrics' existing `is_eval` trade flag. XFA and Live Funded are stored as distinct account types, but both currently map to non-Eval in the existing trade model.

### Topstep incremental sync

- Changed normal manual and scheduled syncs to fetch only the rolling last 24 hours of trades and orders.
- Kept the initial import as a full-history fetch, then automatically performs a full-history reconciliation every seven days.
- Added an explicit **Full reconciliation** action for users who want to run a full-history pass before the weekly schedule.
- Incremental broker responses are upserted into the retained local raw execution history; position reconstruction continues to use the complete locally stored history.
- Persisted broker-verified voided-order overrides so incremental rebuilds do not accidentally drop older executions that were previously corroborated by the Orders API.
- Added a visible last-full-reconciliation timestamp and reset it when imported data is explicitly cleared or the selected account / copy-trading lead selection changes.

### Topstep automatic sync

- Added server-side automatic syncing for each Topstep connection.
- Automatic sync is opt-in and disabled by default; existing connections are not silently enabled.
- Added selectable intervals: 1, 5, 10, 15, or 30 minutes (default 5 minutes).
- Added last-attempt, next-run, and last-error status to the connection settings.
- Persisted the latest automatic sync result so the existing detailed diagnostics can be shown after a page refresh.
- Reuses the existing `POST /api/projectx/sync` importer and reconciliation path rather than introducing a second import implementation.
- Added a per-connection in-process lock to avoid overlapping manual and scheduled sync requests.
- Added additive SQLite migrations so existing installations gain the new settings without replacing their database.

### Topstep import reconciliation

- Added an Orders API cross-check for historical executions.
- Added a narrow reconciliation rule for the specific case where all trade legs for an order are marked voided but the broker order history confirms a filled order and an exact matching fill quantity.
- Kept other voided execution legs quarantined; the change does not globally accept voided records.
- Kept the sync resilient when the optional order-history cross-check is unavailable.
- Restored and retained the detailed per-connection sync diagnostics and the imported-data clear control.

### Customizable Dashboard and Analytics metric tiles

- Added a shared metric-tile customization component used by Dashboard and Analytics.
- Users can show or hide supported metric tiles, drag them into a preferred order, and reset each page to its original layout.
- Dashboard and Analytics preferences are stored independently in browser local storage.
- Existing default tile sets are preserved for users who have not customized either page.
- The change affects presentation only; metric calculations, trade data, filters, charts, and other analytics sections remain unchanged.

## Deployment notes

- Changes are developed on `development`; upstream's `main` branch is not the deployment target for these fork additions.
- Run the project's CI before deploying.
- Existing imported trades and raw execution history are not cleared by these changes.
- Automatic Topstep sync remains off until explicitly enabled in Settings.

## Maintenance

Add a dated entry here whenever a user-visible feature, importer/reconciliation behaviour, data migration, or operational requirement changes. Keep detailed usage and troubleshooting instructions in the relevant document under `docs/`.

### Time format preference
- Added a global 12-hour / 24-hour time format preference in Settings → Preferences.
- The selected format is saved in browser local storage and is used by shared trade-time formatting, including the calendar day detail popup. The default remains 12-hour to preserve existing display behaviour.
