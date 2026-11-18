# Fork changes

This file records changes maintained in the `raptorjr/rrmetrics` fork. It is not the upstream project's changelog.

The fork keeps `main` aligned with upstream and develops additional work on `development`. To use the changes below, clone that branch:

```bash
git clone --branch development https://github.com/raptorjr/rrmetrics.git
```

## 2026-11-18

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

## Deployment notes

- Changes are developed on `development`; upstream's `main` branch is not the deployment target for these fork additions.
- Run the project's CI before deploying.
- Existing imported trades and raw execution history are not cleared by these changes.
- Automatic Topstep sync remains off until explicitly enabled in Settings.

## Maintenance

Add a dated entry here whenever a user-visible feature, importer/reconciliation behaviour, data migration, or operational requirement changes. Keep detailed usage and troubleshooting instructions in the relevant document under `docs/`.
