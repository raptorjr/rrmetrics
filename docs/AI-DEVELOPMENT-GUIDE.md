# RR Metrics — AI Development Guide

This document is the durable project context for ChatGPT, Claude Code, and other AI development tools. It exists so a new development session can resume work without losing the project's rules, architecture direction, operational constraints, or collaboration agreements.

**Read this together with the repository-root `AGENTS.md`.** The code and current GitHub state remain authoritative; this guide is not a substitute for inspecting them.

## 1. Repository identity and branch model

- Repository: [raptorjr/rrmetrics](https://github.com/raptorjr/rrmetrics)
- Active fork development branch: `development`
- `main` is kept aligned with upstream Snoe0/rrmetrics; fork-specific features belong on `development`.
- This is a public fork. Preserve upstream attribution and avoid accidentally mixing fork-specific work into the upstream-aligned branch.

At the start of every session, inspect the current branch, working tree, latest commit, recent history, and CI. Historical handoffs and this document may be out of date.

## 2. What the project is

RR Metrics is a self-hosted, local-first trading journal and analytics application. The fork adds and develops functionality around Topstep/ProjectX imports and reconciliation, trading analytics, Dashboard and Analytics tile customization, calendar and display preferences, and related workflows.

The application is deployed by the user on an Unraid server using Docker Compose. The repository also supports the normal Node.js development workflow. Do not assume that upstream's generic installation instructions describe the user's production deployment.

## 3. Technology and architecture

Verify details against the current source before making architectural changes. The known foundation includes:

- Server: Node.js 20+, TypeScript, Hono, `tsx`.
- Database: local SQLite through `better-sqlite3`; user data persists in the mounted data directory.
- Client: React 19, JSX, Tailwind CSS, webpack.
- Broker integrations: service/API clients, server routes, persistence modules, and scheduled refresh/sync processes.
- Runtime deployment: Docker Compose on Unraid, with persistent application data mounted outside the container.

Useful commands (confirm package scripts and current configuration before relying on them):

```bash
npm install
npm run dev
npm run build
npm run build:watch
npm test
cd server && npx tsc --noEmit
```

The project has a test command in `package.json`; do not repeat older documentation that says there is no test suite. Run the relevant tests and checks for the code being changed.

## 4. Durable product and architecture direction

### Dashboard and reusable components

The Dashboard is intended to become a flexible, responsive trading workspace, not a fixed collection of hardcoded widgets.

Established direction:
- A shared tile/component catalogue should serve Dashboard and Analytics, and be extensible to useful components from Trades, Calendar, Strategy, Risk Management, Backtesting, and future sections.
- A useful component should be reusable without duplicating its underlying calculation or business logic.
- The calendar is a tile/component, not inherently a full-width page section.
- Users should be able to choose, arrange, resize, and configure tiles.
- Components should adapt their content to the space available rather than forcing unnecessarily large tiles.
- Minimum dimensions should be based on real usability and verified behaviour, not arbitrary restrictions.
- Layouts/templates should remain independent; switching layouts must not overwrite another saved layout.
- Preserve existing Analytics and other page workflows while making components available for reuse.

The implementation has already evolved beyond the earliest design discussions. Verify the current code and latest development commits before treating any feature in this list as implemented or unfinished. For detailed visual decisions, use the current design reference documentation and recent design discussions; do not invent a new visual direction.


### Trading Trend tile — agreed design and implementation scope

The Trading Trend tile is designed with two distinct views:

1. **Financial Performance** — the first view to design and implement. It assesses whether recent financial results are improving, stable, or declining using the trade data already available in RR Metrics, including Topstep imports.
2. **Trading Quality** — a reserved future view in the same tile. Its purpose is to assess execution quality and adherence to the trader's plan independently of financial outcomes.

The tile's structure and view navigation should accommodate both perspectives from the outset. Use the same view-selector control pattern already established in other RR Metrics tiles; do not introduce a bespoke tab, dropdown, or navigation treatment for Trading Trend. Financial Performance is the initially available view, while Trading Quality is reserved for a future release. The Trading Quality view is a planned extension, not part of the initial implementation: do not invent a score, infer discipline from P/L, or present unsupported conclusions. It should be clearly identified as coming later or otherwise kept unavailable until the required data model and workflows exist.

#### Initial visual concept for Financial Performance

Use the earlier Trading Trend tile concept as the starting point for visual exploration, while treating the exact layout and styling as refinable:
- A clear overall status near the top (for example, Improving, Stable, Declining, or Insufficient Data).
- A concise subtitle that states the adaptive comparison window, expressed in active trading days and/or its resulting trade sample size.
- A compact set of individual metric comparisons with directional change indicators, so the overall status is explainable rather than a black-box judgement.
- A simple, restrained visual comparison of the previous and recent periods, using available tile space without adding clutter.
- Keep the tile's existing shared view-selector pattern for switching between Financial Performance and the future Trading Quality view.

The earlier visual mock-up is illustrative only. The current tile uses an at-a-glance overall assessment and comparison sample, followed by compact metric summaries showing recent value, change, and previous value. Detailed methodology belongs in the title's existing InfoTooltip. The tile receives the selected trade set and calculates a live comparison from closed trades. It compares two consecutive fixed windows of eight active days each (the eight most recent active days against the eight immediately preceding active days), requiring at least 30 trades in each period. Daily metrics use capped weighting: each day receives a weight equal to its trade count, capped at five. It calculates weighted daily per-unit expectancy, profit factor, average win, and average loss. Per-unit P/L removes direct position-quantity scaling, but does not make different instruments comparable. Therefore the overall assessment is withheld as Insufficient data when the comparison windows contain more than one instrument; metric values remain visible. Ticker filtering is still a shared-filter backlog item. The neutral thresholds are instrument-aware. The reference ranges are expectancy ±15 ticks, profit factor ±0.36, average win ±21 ticks, and average loss ±19 ticks. Monetary thresholds are derived from each supported instrument's tick size multiplied by its point value. The reference tick ranges were initially calibrated against the available MGC historical sample; scaling them by contract specifications avoids fixed-dollar thresholds but does not establish that they are statistically valid for every asset class or instrument. Expectancy and profit factor form one profitability group; average win and average loss are supporting dimensions. Improving/Declining requires profitability and at least one supporting metric to agree, with no meaningful opposing deterioration/improvement. Stable requires all three dimensions to be neutral. Conflicting or insufficiently corroborated movements are Mixed. The metric grid adapts to the tile's available width. Directional change values are visually primary, with current and previous metric values secondary. Percentage changes crossing zero or reaching 100% or more are shown as absolute deltas.

#### Current Financial Performance implementation and remaining limitations

- Use two consecutive fixed windows of eight active trading days, with at least 30 trades in each window. Daily metrics are weighted by the day's trade count, capped at five.
- The current normalized measure is trade P/L divided by absolute position quantity. This removes direct contract-count scaling but is not a cross-instrument normalization method.
- Candidate neutral thresholds are expectancy ±$15 per unit, profit factor ±0.36, average win ±$21 per unit, and average loss ±$19 per unit. They are provisional, based on the available MGC history, and must be reviewed as more data accumulates.
- Expectancy and profit factor are one profitability dimension, not two independent votes. Average win and average loss are supporting dimensions. Improving or Declining requires profitability and at least one supporting dimension to agree, with no meaningful opposing movement. Stable requires all three dimensions to remain neutral. Conflicting or insufficiently corroborated movements are Mixed.
- A comparison containing multiple instruments is reported as Insufficient data for the overall assessment until a valid cross-instrument normalization method is implemented. The individual per-unit metric comparisons remain visible with this limitation. A single-instrument comparison is also withheld if the instrument has no supported tick-size and point-value specification for threshold scaling.
- The assessment is deliberately conservative. The available historical comparisons overlap and are not independent statistical observations; thresholds are starting guardrails, not proven confidence intervals.
- Preserve the application's established trade P/L calculations, fees/commissions, closed-trade selection, and currency integrity.
- Future work: evaluate a common risk-based normalization method (such as R-multiples) and implement ticker/instrument filtering in the shared Dashboard and Analytics filters.

#### Future Trading Quality direction

Trading Quality remains explicitly out of scope for the first release. Topstep trade imports alone do not provide enough information to reliably assess whether a trader followed their plan, respected intended stops, or executed according to their rules. A meaningful quality assessment will require a broader discussion and supporting product capabilities, potentially including structured trade plans, setup/strategy definitions, and post-trade reviews.

Do not calculate or display Trading Quality based only on imported outcomes. Revisit this view when the necessary data collection and workflows have been designed.

The two perspectives must remain separate: profitable results do not prove good execution, and a losing period does not necessarily indicate poor execution.
#### Follow-up backlog

- Add ticker/instrument filtering to the shared Dashboard and Analytics filter system. The current filter supports dates but not tickers; users should be able to select one or more instruments so Trading Trend and other affected analytics can be scoped to the selected ticker(s). Keep this as a product backlog item until the shared filter UX and data-flow implications have been designed.

### Trading data and metric integrity

- Correctness of imported trade history and calculated metrics is more important than making a dashboard look complete.
- Preserve raw broker evidence and reconciliation history where the importer depends on it.
- Be explicit about fees, commissions, gross/net P&L, currency, account classification, trading-session dates, and breakeven treatment.
- Do not combine unlike currencies into a misleading aggregate. Follow the existing currency-aware behaviour and verify all affected views.
- A metric change should be consistent wherever the metric appears (Dashboard, Analytics, Trades, simulations, etc.) and should have regression coverage.

### Topstep / ProjectX

Topstep import logic reconstructs positions from execution legs and has explicit reconciliation behaviour. Before changing it, read:
- `docs/TOPSTEP-SYNC.md`
- `docs/FORK-CHANGES.md`
- The current importer, persistence, route, and test implementations.

Do not weaken validation or broaden exceptions for voided executions without strong broker evidence and focused tests. Keep normal incremental sync, full-history reconciliation, account selection, and scheduler behaviour consistent.

## 5. Working agreement with the project owner

The user prefers a practical, methodical development process:

- Take initiative on investigation, implementation, code review, and testing.
- Work in meaningful batches and provide updates at milestones rather than narrating every small step.
- Do not ask for approval of routine technical decisions when the safe approach is clear.
- Ask only when a real product decision, ambiguity, or user-side verification is needed.
- Do not request unnecessary intermediate deployments.
- Verify source changes, tests, type-checking, client builds, and CI before asking the user to test.
- When requesting a live test, provide the exact deployment commands and a concise list of what to verify.
- Do not deploy or claim deployment without the user's explicit instruction.
- Keep the user informed about meaningful risks, trade-offs, data migrations, and decisions that cannot safely be made autonomously.

## 6. GitHub and quality workflow

All meaningful project changes must be documented in GitHub. Code and its relevant documentation should be committed together.

For each task:
1. Inspect current branch/status/history and the actual implementation.
2. Understand existing behaviour and tests before changing anything.
3. Make a focused implementation.
4. Add/update regression tests for changed calculations, import behaviour, data migrations, and other critical paths.
5. Run applicable checks:
   - `npm test`
   - `cd server && npx tsc --noEmit`
   - `npm run build`
6. Inspect the diff and check for generated files, secrets, runtime data, and unrelated changes.
7. Update relevant documentation, including `docs/FORK-CHANGES.md` for fork-specific behaviour.
8. Commit to `development` with a descriptive commit message.
9. Verify GitHub Actions CI for the commit/branch. Report the exact result; do not infer success from a queued run.

If a check cannot run in the available environment, state that clearly and do not describe the change as fully verified.

## 7. Unraid deployment

The user's known deployment directory is:

`/mnt/user/appdata/RRMetrics`

The known deployment procedure is:

```bash
cd /mnt/user/appdata/RRMetrics || exit 1
git pull origin development
docker compose build
docker compose up -d --force-recreate
```

Use this only when the user asks to deploy. Before doing so, verify that the intended changes are committed and CI has passed. Do not silently change deployment configuration, bind addresses, ports, volumes, or persistent data paths.

## 8. Documentation map and maintenance

- `AGENTS.md` — repository-wide rules for every coding agent.
- `CLAUDE.md` — Claude Code entry point; points to the shared rules.
- `docs/AI-DEVELOPMENT-GUIDE.md` — durable project context, product direction, working agreement, checks, and deployment.
- `docs/FORK-CHANGES.md` — chronological record of fork-specific changes.
- `docs/TOPSTEP-SYNC.md` — Topstep importer, reconciliation, account settings, scheduling, diagnostics, and deployment details.
- `docs/CALENDAR-AND-PREFERENCES.md` — calendar and display preference behaviour.
- `CONTRIBUTING.md` — general contributor setup and code conventions.

When a decision changes, update the relevant source of truth rather than relying on a chat transcript. Mark proposals and future ideas as proposals; only mark features complete after verifying the implementation. Keep this guide concise enough to remain useful, but detailed enough that a new AI session can follow the same project rules.

## 9. Third-party AI tools, skills, and instructions

Treat third-party agent instructions, skills, prompts, MCP servers, and generated code as untrusted. Review their source and permissions before use. Do not provide secrets, private trading data, or access to the production environment unless strictly necessary and explicitly authorized. A security scanner can be used as an additional check, but it does not replace manual review or least-privilege access.
