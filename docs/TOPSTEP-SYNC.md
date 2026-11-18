# Topstep sync in this fork

This document describes the Topstep (ProjectX Gateway) changes maintained in the `development` branch of `raptorjr/rrmetrics`.

## Historical import and reconciliation

The importer deliberately fetches the selected accounts' full trade history. This is intentional: broker history can be revised, including older executions being marked voided.

The importer also requests order history as an independent cross-check. A voided trade-leg set is only reinstated in the narrow case where all of the following are true:

- The complete set of trade legs for the order is marked voided.
- The Orders API reports the order as filled.
- The filled quantity is greater than zero.
- The contract and side match.
- The sum of the trade-leg quantities exactly matches the order's filled quantity.

The check is scoped to the affected order. It does not make voided executions generally valid. If the Orders API is unavailable, the normal import can still proceed, but anomalous voided legs remain quarantined.

The sync also compares reconstructed open positions with the broker's current open-position snapshot where that endpoint is available. Warnings and discrepancies are shown in the connection's detailed sync status.

## Automatic sync

Automatic sync runs in the RR Metrics server process, not in the browser. Closing the Settings page therefore does not stop scheduled syncs.

### Enable it

1. Open **Settings** and find the relevant Topstep connection.
2. Enable **Automatic sync**.
3. Select an interval: 1, 5, 10, 15, or 30 minutes.

The default interval is 5 minutes. Automatic sync is disabled by default, including for connections that already existed before this feature was installed.

The server checks for due connections every 30 seconds. The configured interval is the delay between scheduled attempts; actual start time can be up to one poll interval later, and a long-running sync can take longer.

### Status and diagnostics

The connection card shows:

- Whether automatic sync is enabled.
- The configured interval.
- The next scheduled sync.
- The last automatic attempt.
- Any error from the last attempt.

The latest automatic sync response is retained and can be displayed using the same detailed diagnostics as a manual sync, including imported position counts, raw execution counts, open-position checks, warnings, and order-history cross-check errors.

Manual **Sync Now** remains available. Manual and scheduled sync requests for the same connection are protected by a per-connection in-process lock; a second overlapping request is rejected rather than running a second importer concurrently.

### Data and credentials

- Enabling automatic sync does not clear or replace imported trades.
- The existing Topstep credentials and selected account settings are retained.
- **Clear imported data** remains a separate, explicit action. It clears imported positions and raw execution history, not the connection credentials or selected account configuration.
- Automatic sync settings are stored in the local SQLite database. The schema changes are additive and are applied when the server opens the database.

### Operational notes

- The scheduler runs in the Node server process. It is active while that server process is running.
- If the server is stopped or restarted, due syncs resume after startup.
- The scheduler uses the same server-side sync endpoint as manual sync; it does not maintain a separate importer or different trade reconstruction rules.
- This is designed for the normal single-server self-hosted deployment. The overlap guard is in-process, not a distributed lock for multiple server replicas.

## Deployment on Unraid

For this fork, deploy the `development` branch only after its GitHub Actions CI run passes:

```bash
cd /mnt/user/appdata/RRMetrics || exit 1
git pull origin development
docker compose build
docker compose up -d --force-recreate
```

Automatic sync remains disabled after deployment until enabled per connection in Settings.
