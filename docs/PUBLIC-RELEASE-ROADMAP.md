# Public release and Unraid Community Applications

Status: approved long-term product goal; planning only. Do not publish a container, create a public release, or submit to Community Applications without explicit approval. Current development on Babylon continues as before. This is a preparation checklist, not a certification of legal compliance or security.

## Product direction

Make the fork installable using the normal Unraid Apps interface without Docker Compose, local builds or command-line setup. Retain self-hosted, local-first data ownership, SQLite persistence and ordinary Docker portability for non-Unraid users. Preserve upstream attribution and keep the upstream-aligned main branch separate. TradeCanvas is the standard market-chart engine for replay, price charts and future live trading; prefer reuse across other charting needs when suitable. Existing purpose-built statistical graphics may remain until an appropriate migration is tested. Do not reintroduce retired chart dependencies or erase genuine historical notices.

## Release gates

- [ ] Audit original RR Metrics Apache-2.0 requirements (including prominent modified-file notices, retained upstream notices, licence copy, any applicable NOTICE file) and TradeCanvas MIT licence/copyright notices.
- [ ] Audit exact dependency tree and distributed assets (including images, logos, fonts and chart packages); collect required licence and attribution notices for both source and built container. Generate a third-party notice inventory and SBOM; inspect bundled frontend and actual container contents.
- [ ] Review name/logo and trademark rights, upstream attribution and non-endorsement; choose public branding before publication. Apache/MIT copyright permissions do not grant trademark rights.
- [ ] Add About / Open Source Licences in Settings, including version, source links, original authors/contributors, fork attribution and applicable third-party notices.
- [ ] Review the [provider verification and import roadmap](PROVIDER-IMPORT-ROADMAP.md); verify advertised integrations against documented formats and independent regression expectations, distinguish sample/sandbox/live verification, and explicitly label or disable unverified/unsupported capabilities before release.
- [ ] Review applicable broker/API terms for distributing integrations, credentials, authentication and usage limits; do not imply official endorsement or approval.
- [ ] Review market-data licences. Historical files remain user-supplied/licensed; never ship private or unlicensed data in examples or images. Use original synthetic fixtures where necessary.
- [ ] Security review: application authentication and authorization (current private-network assumptions are not public exposure protection), secrets encryption/storage, session handling, uploads, API validation, dependency and container vulnerability scanning, backup/restore, migration safety, least privilege and safe default network binding. Document private-network deployment and do not encourage exposing an unauthenticated service.
- [ ] Inspect Docker build context and final layers; exclude runtime databases, user uploads, API credentials, private data and host-specific configuration. Provide portable environment variables, persistent data mapping, nonprivileged runtime where compatible and health checks.
- [ ] Replace temporary pkg.pr.new TradeCanvas previews with durable versioned packages or immutable reproducible release artifacts, retaining exact tested pins and licence notices.
- [ ] Establish versioning and release notes, tested stable channel and optional development image; proposed stable branch and versioned tags, latest points only to approved stable releases. Keep main upstream-aligned. Publish reproducibly built images to a public registry (proposed GHCR), including supported architectures, provenance and vulnerability checks.
- [ ] Test clean install, persistent volume, upgrades from prior versions, rollback limitations, backups and migration from existing Docker Compose installations. Verify no accidental loss of user data.
- [ ] Create Unraid Docker XML template with sensible configurable port, persistent appdata path, image/tag, WebUI link, icon, support/source links and clear install instructions. Verify current Community Applications submission criteria at https://ca.unraid.net/submit before submission.
- [ ] Prepare support documentation, issue reporting, security contact, troubleshooting, release/update instructions and data backup guidance.
- [ ] Obtain explicit user approval, publish stable image and submit the application to Unraid Community Applications. Approval by Unraid is not guaranteed.

## Current audit notes

RR Metrics root licence is Apache-2.0 and TradeCanvas root licence is MIT; both allow redistribution subject to their conditions. A complete legal, asset, dependency, security and broker-terms audit remains outstanding. The existing README attributes upstream. Historical changelog entries are retained. Source scan of current client/server JavaScript/TypeScript and public HTML found no active Lightweight Charts or KLineCharts imports or references; the lockfile showed Fancy Canvas only depended on by Lightweight Charts. Removed these three unused packages without changing chart rendering or the existing TradeCanvas package pin. Statistical graphics are not automatically replaced by a market chart engine. Recheck licence obligations for the final shipped artifact rather than assuming dependency removal erases prior attribution duties.
