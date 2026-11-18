# Topstep sync in this fork

This document describes the Topstep (ProjectX Gateway) changes maintained in the `development` branch of `raptorjr/rrmetrics`.

## Execution reconstruction, partial exits, and costs

Topstep's execution history is treated as a sequence of execution legs, not as a one-row-per-order trade list. The importer rebuilds positions separately for each account and contract.

- Multiple entries are combined into one position using quantity-weighted entry price.
- Partial exits are accumulated until the position is closed.
- A reversal is split into the closing of the old position and the opening of a new position in the opposite direction.
- Execution identifiers are used to group related legs; the broker's fill identifier is preferred when present, with order identity used as the fallback.
- Fees and commissions are accumulated across opening and closing legs. The reconstructed journal P&L is net of both costs.
- Updated copies of an execution replace older copies with the same account/trade ID, so broker corrections and voided-state changes can be applied during rebuilds.

The importer validates the execution sequence. If an instrument's history contains an unmatched close, conflicting side, or another unsafe sequence, it reports a warning and quarantines later reconstructed positions for that instrument rather than inventing a plausible-looking result. Positions completed before the first inconsistency can be retained. An uncertain open balance is not published as a reconstructed open position; the broker's open-position snapshot remains the authority for current exposure.

The raw execution history is retained locally so positions can be rebuilt after incremental syncs. The importer does not silently discard anomalous records to make the journal appear complete; inspect the detailed sync diagnostics when warnings are reported.

## Incremental sync and historical reconciliation

Topstep sync uses a rolling 24-hour window for normal operation. This applies to both manual **Sync Now** and scheduled automatic syncs.

- **Initial sync:** fetches full available history (from 2020-01-01) to build the local execution history and imported positions. Adding or removing selected accounts, or changing the copy-trading lead account, also resets the checkpoint so the next sync performs a full import for the new account selection.
- **Normal syncs:** fetch trades and orders from the last 24 hours. The overlap catches delayed fills and recent broker corrections without repeatedly downloading years of history.
- **Weekly reconciliation:** the first sync after seven days since the last full-history pass automatically fetches full history again.
- **Manual full reconciliation:** the **Full reconciliation** action explicitly requests all available history, regardless of the weekly schedule. It asks for confirmation because it uses more API requests.

Incremental responses are merged into the locally stored execution history by account and trade ID. Position reconstruction still uses the complete local history, not only the recent 24-hour response. Older raw executions are retained and are not deleted by an incremental sync. The locally stored history remains the source used to rebuild journal positions.

The connection status shows when the last full-history reconciliation occurred. Clearing imported data resets that checkpoint, so the next sync performs a new initial full import.

## Historical correction and order reconciliation

Broker history can be revised, including older executions being marked voided. The weekly full-history reconciliation is retained to detect those older corrections; normal 24-hour syncs do not repeatedly download the complete history.

The importer also requests order history as an independent cross-check. A voided trade-leg set is only reinstated in the narrow case where all of the following are true:

- The complete set of trade legs for the order is marked voided.
- The Orders API reports the order as filled.
- The filled quantity is greater than zero.
- The contract and side match.
- The sum of the trade-leg quantities exactly matches the order's filled quantity.

The check is scoped to the affected order. It does not make voided executions generally valid. If the Orders API is unavailable, the normal import can still proceed, but anomalous voided legs remain quarantined.

The sync also compares reconstructed open positions with the broker's current open-position snapshot where that endpoint is available. Warnings and discrepancies are shown in the connection's detailed sync status.

## Topstep accounts and account-level settings

After connecting, RR Metrics fetches the accounts available to the supplied Topstep credentials and displays them directly in the Topstep integration panel. The list is refreshed from Topstep when connection status is loaded.

For each account, the user can:

- Select whether that account should be included in imports.
- Classify it as **Evaluation**, **Express Funded (XFA)**, **Live Funded**, or **Other / Practice**.
- Set an optional friendly display name. The original Topstep account ID and name remain the broker identity used for matching; the friendly name is used for the account label on imported trades.

These settings are saved per account, not per Topstep login. This allows one login to contain Evaluation and funded accounts without applying one global Eval switch to every account.

RR Metrics currently stores the Evaluation distinction in its existing boolean trade field (`is_eval`). Evaluation accounts are marked as Eval; XFA, Live Funded, and Other / Practice are marked as non-Eval. The more specific account type is retained in the Topstep connection settings for account-level configuration and future use, while the existing trade model does not yet distinguish XFA from Live Funded as separate trade flags.

Older connections may still have the legacy connection-level Eval flag. When no per-account settings have been saved yet, that legacy flag and the existing account-name `EV` heuristic provide a compatibility fallback. Once account settings are saved, the explicit per-account classification takes precedence.

Account selection, account type, and friendly names are edited inline in the Topstep panel; there is no separate Topstep **Settings** button for these controls. Copy-trading options remain available separately.

## Automatic sync

Automatic sync runs in the RR Metrics server process, not in the browser. Closing the Settings page therefore does not stop scheduled syncs.

### Enable it

1. Open **Settings** and find the relevant Topstep connection.
2. Enable **Automatic sync**.
3. Select an interval: 1, 5, 10, 15, or 30 minutes.

The default interval is 5 minutes. Automatic sync is disabled by default, including for connections that already existed before this feature was installed.

The server checks for due connections every 15 seconds. The configured interval is the delay after a sync completes; actual start time can be up to one poll interval later. The attempt start time and in-progress state are persisted before the importer starts, so the UI does not keep showing an old overdue schedule while a sync is running.

### Status and diagnostics

The connection card shows:

- Whether automatic sync is enabled.
- The configured interval.
- The next scheduled sync.
- The last automatic attempt.
- Any error from the last attempt.

When an automatic sync completes while RR Metrics is open, the app shows a brief notification with the number of newly imported journal trades, or that Topstep is up to date. The count is based on newly created imported trade records, not the total number of historical positions reconstructed or raw execution legs fetched. Detailed diagnostics remain available after a manual sync in the Settings connection panel; the previous automatic-sync result is not repeated there.

Manual **Sync Now** remains available. Scheduled sync requests have a two-minute timeout; timed-out requests record an error and release the scheduler lock so later attempts can proceed. The request is also aborted where supported. The in-progress marker is recovered after a server restart if it has been left stale for longer than the timeout. Manual and scheduled sync requests for the same connection remain protected by a per-connection in-process lock.

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
