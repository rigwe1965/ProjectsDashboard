# Changelog

All notable changes to the ProjectsDashboard. Follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/). Versions use `MAJOR.MINOR.PATCH`.

## [Unreleased]

### Added
- Scaling pass (see `docs/HOW-IT-WORKS.md`, section 14). Nothing changes for a running setup until it is restarted, and every default keeps today's behaviour: one query instead of two to find a customer's grant, the registry file checked once a second instead of on every request, private-copy seat table read from memory for a second, status probes capped at 32 at a time (`STATUS_CONCURRENCY`), audit indexes, an opt-in grant cache (`GATEWAY_GRANT_CACHE_MS`, off by default), and up to 50 private copies per product (was 9; no existing port moves).
- `docs/build-book.mjs` (`npm run docs:book`): rebuilds `docs/ONBOARDING-BOOK.html` from the Markdown. Needs `npm i --no-save marked@14.1.4` once.
- Staging load test tooling (`deploy/docker-compose.loadtest.yml`, `deploy/loadtest/`, `tests/bench/gateway-load.mjs`, `mint-links.sh`, `collect.sh`, `revoke-links.sh`) and its plan, `docs/PLAN-staging-load-test.md`. For a temporary test server only, never for production. Onboarding book chapters 23 and 24 describe setting it up and deleting it.
- Staging load test results (`docs/PLAN-staging-load-test.md`, section 13): stable and error-free under load, but the scaling pass was **not faster** than the old code on a same-host Postgres (the 1.3 times bar was not met); the opt-in grant cache gave about 2.8 times. Driver scripts `tests/bench/run-all.sh` and `run-compare.sh` added.
- `tests/bench/gateway-bench.mjs`: a throughput benchmark for the gateway (not part of `npm test`).
- LICENSE, SECURITY.md, this changelog and a pull request template (project standard).
- Project standard and inventory (`docs/PROJECT-STANDARD.md`), and the per-deployment licence library (`licensing/`).

Earlier history is in the git log. The first tagged release will be `v0.1.0`, the version in `package.json`.
