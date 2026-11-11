# Plan: MCP server and per-link analytics

Status: proposal, nothing built yet. Written 2026-11-11 after the audit fixes (HEAD 6aecb51).

## Why these two

- Interactive-demo products sell on two things: engagement data per prospect, and being easy to drive. This project already has the hard part (time-limited links, private copy per link, reset, audit log) but shows the owner almost nothing about what a customer did with a link.
- Indie control planes are moving to "MCP server first, dashboard as a thin panel". An MCP server lets an AI assistant create a link, check who opened it and revoke it, using code that already exists.
- Both are small because they sit on existing pieces: `createGrants(store)`, `store.audit`, the gateway's `forward()` and the console's route table.

## Part 1: per-link analytics

### What exists today
- The audit log records `enter` (a use is counted, with ip and user agent), `denied`, `ws-open`, `ws-closed`.
- It does NOT record what a customer did after entering: no page views, no time spent, no return visits except as repeated `enter`.
- Adding an audit row per proxied request is wrong: it would flood the table and the retention pruning.

### Design
A separate, small rollup, not the audit log.

1. **New table `grant_activity`** (both stores, same pattern as `grant_sessions`; created with `IF NOT EXISTS`, so old databases upgrade in place):
   - `grant_id`, `day` (UTC date), `requests`, `first_at`, `last_at`, `active_seconds`, `top_paths` (JSON, at most 10 path prefixes with counts), `ws_seconds`.
   - Primary key `(grant_id, day)`.
2. **Collector in the gateway** (`demo-gateway/activity.mjs`, new):
   - `record(grantId, path)` is called from `forward()` in `proxy.mjs`, after a request is allowed. It only updates an in-memory map.
   - A timer (every 30 s, and on shutdown next to the existing `process.exit` path) flushes the map with one upsert per grant. So the cost is one write per active link per 30 s, not one per request.
   - Active time: a gap of more than 5 minutes between requests starts a new visit; time inside a visit is summed. WebSocket open time is added from the existing `ws-open`/`ws-closed` hooks.
   - Paths are stored as the first two path segments only, never the query string (it can hold personal data). Static assets (`.js`, `.css`, images, fonts) are not counted as page views.
3. **Read side** in `lib/store`: `activity.forGrant(id)`, `activity.summary(sinceDays)`. Contract-tested on SQLite and (when `TEST_DATABASE_URL` is set) Postgres.
4. **Console**:
   - `GET /api/demos` rows gain `visits`, `lastActiveAt`, `activeMinutes`, `topPages`, `engagement` (`none` / `opened` / `engaged` / `returned`).
   - `engagement`: `none` = never entered; `opened` = entered, under 1 min active; `engaged` = 1 min or more; `returned` = active on 2 or more days.
   - One new column in the links table plus a small detail panel per link. No chart library.
5. **Privacy and retention**:
   - Same retention setting as the audit log (`num()` rules from F-18, 0 ignored); pruned with it.
   - `grants.forget` (already deletes a link's audit rows) also deletes its `grant_activity` rows.
   - Document what is collected in `docs/` and in the demo gateway README. The security page from the roadmap can link to this.

### Tests
- Collector: batching (1,000 requests, 1 flush), visit splitting at the 5-minute gap, asset exclusion, query string never stored.
- Store contract: upsert adds to an existing day, `forGrant`, prune, forget.
- Console: engagement states, 401 without a session, `ADMIN_APP_CONTROL=off` still shows analytics.
- Gateway: a request that is denied or rate-limited is not recorded.

### Effort and risk
- About 1 to 1.5 days. Main risk is the gateway hot path, so the collector must be a memory-only map update with no awaits; a test pins that.
- Not an app change: nothing in CRM, ImageApp and the others is touched.

## Part 2: MCP server

### Scope
A local MCP server over stdio, run by the owner's AI assistant on the same machine: `node mcp/server.mjs`. No new dependency: the protocol is JSON-RPC 2.0 with `initialize`, `tools/list` and `tools/call`, about 150 lines by hand. (If the official SDK is preferred, it is one dependency; decide at build time.)

### Tools
Read-only, always on:
| Tool | Does | Backed by |
|---|---|---|
| `list_apps` | name, port, status | supervisor status, same as the console's `/api/apps` |
| `list_demo_links` | links with state, uses, expiry, engagement | `loadGrants` + analytics |
| `link_activity` | one link's visits, pages, active minutes | `activity.forGrant` |
| `recent_events` | last N audit events, owner-only events included | `store.audit.list` |
| `demo_state` | which demos are resetting, failed, seats in use | `productState`, `listInstances` |

Changing things, off unless `MCP_WRITE=1`:
| Tool | Does | Guard |
|---|---|---|
| `create_demo_link` | customer, app, hours, maxUses, deviceLock | same validation as the console (`createGrant`); returns the link once |
| `revoke_demo_link` | revoke by id | `revokeGrant` |
| `reset_demo` | reset one product's demo | `runReset`; refused while a reset is running |

Never exposed: app start/stop, env values, `.env` contents, password and 2-step settings, forget (it destroys audit history), snapshot/restore.

### Safety
- Every write is audited with `by: 'mcp'` (the `who` argument that `createGrant` and `revokeGrant` already take), so the activity page shows what the assistant did.
- `create_demo_link` returns the link only in that one response; the stored token is a hash, as now. The tool description tells the assistant not to repeat the link anywhere except to the owner.
- Text returned from the database (customer names, user agents) is untrusted data: wrapped as quoted data in the results so an attacker-chosen customer name cannot act as an instruction. A test uses a customer name containing "ignore previous instructions".
- Per-tool input checks reuse the existing validation (`HttpError` becomes an MCP tool error, no stack traces).
- Rate limit on writes (for example 20 per minute) so a looping assistant cannot create thousands of links.
- stdio only for now. A remote (HTTP) transport needs its own bearer-token auth and the console's origin rules; leave it for the hosting work (see the deferred hosting note).

### Tests
- Protocol: `initialize`, `tools/list` shows read tools only without `MCP_WRITE`, unknown tool and bad JSON give proper JSON-RPC errors, never a crash.
- Each tool against an in-memory SQLite store (the existing tests already build one).
- Writes audited with `by: 'mcp'`; `MCP_WRITE` unset refuses with a clear message.
- Injection test as above; no tool result contains a token hash, env value or password hash.

### Effort and risk
- About 1 day after Part 1 (it reuses `link_activity`).
- Risk: an assistant with `MCP_WRITE=1` can create links that reach customers. That is why writes are opt-in, audited and rate limited, and why revoke is included.

## Order of work (one commit each, tests gating every commit)
1. Store: `grant_activity` table, `activity` methods, contract tests (SQLite, Postgres when available).
2. Gateway collector + flush + shutdown flush + tests.
3. Console API and UI column and detail panel + tests.
4. Retention and forget integration + docs on what is collected.
5. MCP server read tools + protocol tests.
6. MCP write tools behind `MCP_WRITE`, audit, rate limit, injection test.
7. Docs: README section, `docs/HOW-IT-WORKS.md`, a sample MCP config snippet for Claude Code.

## Open questions for the owner
- Should customers be told that activity is recorded? Recommended yes: one line on the existing "Open your demo" notice page.
- Keep the IP address in activity rows? Recommended no: the audit log already has it per `enter`; the rollup needs only the link id.
- SDK or hand-written protocol for MCP? Recommended hand-written to keep the project dependency-free.
