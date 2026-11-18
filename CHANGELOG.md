# Changelog

All notable changes to the ProjectsDashboard. Follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/). Versions use `MAJOR.MINOR.PATCH`.

## [Unreleased]

### Added
- Scaling pass (see `docs/HOW-IT-WORKS.md`, section 14). Nothing changes for a running setup until it is restarted, and every default keeps today's behaviour: one query instead of two to find a customer's grant, the registry file checked once a second instead of on every request, private-copy seat table read from memory for a second, status probes capped at 32 at a time (`STATUS_CONCURRENCY`), audit indexes, an opt-in grant cache (`GATEWAY_GRANT_CACHE_MS`, off by default), and up to 50 private copies per product (was 9; no existing port moves).
- `tests/bench/gateway-bench.mjs`: a throughput benchmark for the gateway (not part of `npm test`).
- LICENSE, SECURITY.md, this changelog and a pull request template (project standard).
- Project standard and inventory (`docs/PROJECT-STANDARD.md`), and the per-deployment licence library (`licensing/`).

Earlier history is in the git log. The first tagged release will be `v0.1.0`, the version in `package.json`.
