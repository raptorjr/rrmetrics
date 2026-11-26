# Provider verification and improved file imports

Status: approved development backlog; not implemented or certified by this document. Continue the existing replay, strategy and analytics roadmap; schedule the milestones below alongside it. Public release should accurately describe which integrations and capabilities are verified. See [PUBLIC-RELEASE-ROADMAP.md](PUBLIC-RELEASE-ROADMAP.md).

## Goals

- Verify and improve existing providers before expanding the list. Accuracy, traceability and data preservation outweigh the number of advertised integrations.
- Provide reliable, provider-specific CSV import as an alternative to API synchronization where exports permit it, starting with TopstepX so traders need not buy API access solely for journaling.
- Reuse the same account identities, normalized trade representation, journal and analytics when supported by the evidence. Maintain a clear distinction between source executions, closed trades, orders and market data.
- Reuse upload, validation, mapping, review, reconciliation, error reporting and import-history infrastructure across providers. Avoid creating another separate journal.

## Current integration inventory and verification

Source review confirms ProjectX/Topstep, Tradovate, Webull and Robinhood clients. Tradovate is also the shared API path for the existing NinjaTrader, Apex Trader Funding, Alpha Futures, Tradeify, My Funded Futures, Lucid Trading, Top One Futures, FundedNext Futures and Blue Guardian tiles. A shared implementation is not proof that every firm permits the same authentication, environments or data access. TradeZella CSV imports and Historical Futures market-data imports are separate existing paths.

Topstep API has real-world testing and reconciliation regression coverage from development on Babylon; retain and extend those tests. Exact verification scope must be confirmed against current implementation and evidence. Other providers must not be described as live-verified merely because upstream includes them.

Track verification by provider, import method, API version/export format, supported asset class and capability:
- Untested: implementation exists but evidence is insufficient.
- Sample-data verified: documented response or actual export fixtures independently validated and covered by automated regression tests.
- Sandbox verified: actual authenticated test/demo environment exercised where available.
- Live verified: actual supported provider connection and representative real exports or synchronization checked against independent source records. Record date, known limitations and test scope.

## Evidence and regression rules

Use official provider documentation and permitted sample responses first. Obtain actual anonymized exports whenever possible. Investigate sample fixtures and demo/sandbox availability for Tradovate, NinjaTrader, Webull and Robinhood; confirm current APIs and terms before relying on them. Do not commit private account data, credentials or third-party datasets without redistribution permission. Use synthetic fixtures derived from documented schemas when necessary and label their provenance. Record exact format/version and independent expected outcomes.

Other trading journals, including LuxAlgo, are not an authoritative reconstruction or calculation reference. Previous Topstep import testing with LuxAlgo did not produce reliable results for the project owner. Third-party fixtures may be considered only after checking provenance, licensing and format; do not copy their import logic or expected outputs without independent verification. Never tune results to match another journal. Use broker records and independently calculated expected trades, quantities, times, fees and P/L. Preserve contradictory evidence and report uncertain cases rather than fabricate missing executions.

Build permanent CI regression tests for long/short positions, scaling, partial fills, reversals, open positions, cancelled/rejected/voided orders where relevant, duplicate and overlapping exports, corrections, account resets and identities, currencies, commissions, timezone/session boundaries, pagination and incremental versus full imports. Test authorization, token expiry and refresh, network errors and transaction/retry safety. Reconcile balances and P/L only to the extent source evidence supports. Samples cannot verify actual login, permissions or live API behaviour.

## Improved CSV import

- Start with actual TopstepX Trades and Orders exports. Determine whether each export contains closed trades, executions, identifiers, timestamps, costs and account metadata; verify available history and export limitations. Do not assume an order is a fill or that both reports are necessary/sufficient for reconstruction.
- Recognize supported formats and variants using headers/schema rather than filenames alone; allow explicit provider/format selection and confirm ambiguous mappings. Retain generic/manual CSV import and existing TradeZella behaviour.
- Validate encodings, delimiters, decimal formats, units, timezone and account mapping. Preview recognized and rejected rows, import scope, duplicate/conflict counts and missing fields. Explicitly distinguish reported and calculated P/L, commissions, and unavailable values.
- Repeated whole-history and overlapping exports must be idempotent. Prefer stable provider/account/execution identifiers, preserve source evidence and file provenance, and handle duplicate rows versus genuinely identical independent fills. Never blindly match on display name or P/L.
- Support API and CSV for the same actual account without doubling or silently replacing historical trades. Develop reconciliation against real overlap examples; require confirmation for ambiguous matches, corrected history or account changes. Preserve manual annotations and unrelated accounts.
- Record import history (file fingerprint, provider, account, timestamp, counts, status, errors, mapping/version). Provide safe retry and review; distinguish undo of a file from deletion of shared reconciled records. Make changes transactional and scoped to the owning profile/account. A failed import must not leave a misleading partially successful history.
- Extend to Tradovate and native NinjaTrader formats once evidence exists; consider other providers, including Webull and Robinhood, based on actual supported export schemas. A broker tile may expose API, file import or both only when supported.

## Shared automatic folder monitoring

Start with manual uploads using the shared import pipeline. Next add optional provider/account-specific watched server folders, accessible through explicitly mounted container paths (e.g. a Windows SMB share on Unraid). The server monitors even when the browser is closed. Do not assume a browser on another machine grants server access to arbitrary local paths.

- Configurable allowed import roots, safe path validation and isolation, format filtering, complete/stable file checks, filesystem events plus startup/periodic rescans, queue and durable fingerprint-based idempotence.
- Never ingest temporary or partially written files; handle restarts and network shares. Show monitoring status, last import, errors and processed file history.
- Archive successfully imported files only when explicitly configured, with safe collision handling; retain failed originals for review. Do not automatically delete user files. Reuse the manual import validation/reconciliation pipeline; pause and request review for uncertain mappings.
- Later consider an optional Windows/local companion for users without shared folders: authorized folder selection, authenticated upload, durable retry queue and no unnecessary data access. Browser folder access is not a reliable background service. No companion implementation or distribution is approved yet.

## Proposed delivery order

1. Inspect real TopstepX exports and implement reliable manual CSV import with independent reconciliation tests, including overlap with API history.
2. Audit existing Tradovate-family integration, add independent API fixtures and verify each provider's authentication/permissions/configuration separately; add Tradovate and native NinjaTrader CSV import.
3. Shared import history, validation/mapping and optional server-side folder monitoring for verified file providers; extend the shared ingestion mechanism to compatible Historical Futures file workflows without confusing candles with trading records.
4. Verify Webull integration against current official supported API, response contracts and sandbox; modernize or clearly mark unsupported capabilities. Verify Robinhood integration and applicable terms; prefer official supported mechanisms where available and offer file import when appropriate. Do not encourage unsupported credential collection or unofficial access.
5. Publish honest provider verification status, supported formats and limitations, with regression tests in CI. Continue real-world validation as permitted. Consider companion app only after the server-side workflow is reliable.

No existing provider is removed and no new broker API or CSV import capability is claimed by this planning change.
