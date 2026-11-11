# Demo gateway
Gives one customer time-limited access to ONE product's isolated demo instance.

```text
npm run gateway                                   # start the gateway (port 4300)
npm run demo -- create --customer "Acme" --app imageapp --hours 48   # prints the customer link (shown once)
npm run demo -- create --customer "Acme" --app crm --max-uses 3 --device-lock   # optional limits
npm run demo -- list
npm run demo -- revoke <id>
```
- **Link limits (optional):** `--max-uses N` (or "Max opens" in the console) stops the link after N opens; `--device-lock` ("Lock to first browser") pins it to the browser that opens it first, so a forwarded link opened elsewhere is refused. The first browser is given a random cookie (only its hash is stored with the link), so the lock follows that browser and not its User-Agent text; someone who copies the cookie can still get in, so it is a strong deterrent rather than a guarantee. Revoking a link is the way to end it early.
- **Abuse protection:** link opens are limited per IP and per link, and an address that keeps presenting bad links is refused for a while. Repeated denials after a revocation are summarised in the audit log instead of filling it. Audit entries include the IP and browser.
- **Headers:** the gateway's own pages carry strict security headers (CSP, frame, referrer), and proxied responses get `nosniff` and a referrer policy unless the app set its own.
- Link format: `http://<product>.localhost:4300/d/<token>` (set `DEMO_BASE_HOST` / `DEMO_SCHEME=https` for a real domain).
- Only registry entries with `demoOf` and `demoReady: true` can be served. Set `demoReady` only after confirming the instance shares no data with production.
- A GET of a link never opens the demo or spends a use (mail scanners and chat previews fetch links). It shows a shared-demo notice (one instance per product is shared by all customers, so they are asked not to enter real personal data) and a button; the click is a POST and opens the demo. Next.js dev-only routes (`/__nextjs_*`) are answered by the gateway with a 404.
- Shared demos are reset to their seeded state (SEC-03). A registry demo instance with a `reset` block (steps run by `node supervisor/index.mjs reset <id>`) is reset automatically once every link that was opened for the product has been revoked or has expired (checked every `DEMO_RESET_CHECK_SECONDS`, default 60; `DEMO_AUTO_RESET=0` turns it off). While it runs, links for that product answer "being prepared". The admin console has a Reset data button for doing it on demand. Anything a customer entered, and any password they changed, goes back to the seed. ClaudeOS keeps its state in local files, so its reset restores a golden copy saved once with `node supervisor/snapshot.mjs take claudeos-demo` (do that again whenever you change how the demo should start). Production-mode demos are built first with `node supervisor/index.mjs build <id>`.
- **Private copy per link (SEC-03).** A registry demo instance with a `perLink` block (`max` seats, `portBase`, `idleMinutes`, per-copy `env`, `prepare` steps; `{inst}` is the copy's own data folder) gives every opened link its own copy of the demo: the first request after opening starts it (`node supervisor/index.mjs instance-start <id> <slot>`: a fresh folder under `data/instances/`, the prepare steps, then the processes on `portBase + slot*10 + n`), the customer sees a self-refreshing "Preparing your demo" page for a few seconds, and everything is routed to their copy only. A copy is stopped and its data deleted (`instance-stop`) when its link is revoked or expires, or when nobody has used it for `idleMinutes` (default 120; an open WebSocket counts as use; coming back after that starts a fresh copy). When all seats are taken the link answers "All demo seats are taken" without spending a use. Such a product has no shared data, so it is not reset and has no Reset button. Set up for ImageApp (4 seats), Airfinder (4) and ClaudeOS (3); each Streamlit copy uses a few hundred MB, so size `max` to the machine. This is for host processes (the local setup); the hosted Docker setup keeps shared demos with `deploy/reset-demos.sh`. The copies run as the same OS user as the dashboard: they are separated by data and ports, not sandboxed from each other.
- Opening a link (`/d/<token>`) is the only place the link token is used. The gateway then gives the browser a separate random session cookie, so the link itself can never be sent as a cookie to skip the use limit or device lock. The session is checked against its grant on every request: expiry and revocation apply immediately; a link works only on its own product's host. (Browsers that opened a link before this change need to open it once more.)
- Tokens are stored hashed in the database (`data/dashboard.db`); grants, entries, denials and revocations go to its audit table (kept 90 days, set `AUDIT_RETENTION_DAYS` to change). Old `demos.json` / `demo-access.log` are imported automatically the first time and kept as a backup; `npm run migrate` re-checks the import.
- Start the gateway and the demo instance from the Demos panel in the admin console (or `node supervisor/index.mjs start gateway` / `start imageapp-demo`).
- **WebSockets are supported** (Streamlit apps work through the gateway). An open socket is re-checked every few seconds, so revoking or expiring a grant also cuts off sockets that are already open. ClaudeOS and the RMM UI are *technically* able to run through it now, but stay `demoReady: false` until you have confirmed each one has its own demo data (ClaudeOS and RMM have no separate demo database yet).
- Code: `gateway.mjs` (the proxy, testable) and `server.mjs` (starts it). `npm test` runs it against a fake upstream.

## Settings (environment variables, all optional)
| Variable | Default | Meaning |
| --- | --- | --- |
| `GATEWAY_PORT` | 4300 | port to listen on |
| `DEMO_BASE_HOST`, `DEMO_SCHEME` | `localhost:<port>`, `http` | public host and scheme used in links |
| `TRUSTED_PROXIES` | none | comma-separated IPs of your reverse proxy. `X-Forwarded-For` is believed only from these; otherwise it is ignored (so nobody can spoof their IP to dodge the rate limit) |
| `GATEWAY_UPSTREAM_TIMEOUT_MS` | 60000 | a demo that stays silent this long gets a 504 |
| `GATEWAY_MAX_BODY_MB` | 50 | largest upload accepted (413 above it) |
| `GATEWAY_WS_RECHECK_MS` | 5000 | how often open WebSockets are re-validated |
| `GATEWAY_MAX_WS_PER_GRANT` | 20 | open WebSockets allowed per demo link |
| `GATEWAY_REQUESTS_PER_MINUTE` | 600 | requests per demo link per minute before a 429 (0 = no limit); caps how fast a link can drive an app that calls a paid API |
| `GATEWAY_REDEEM_PER_MINUTE` | 20 | link opens allowed per IP per minute |
| `GATEWAY_REDEEM_FAIL_LIMIT` | 10 | bad links per IP per 10 minutes before it is refused |
| `AUDIT_RETENTION_DAYS` | 90 | how long customer audit events are kept |
| `AUDIT_ADMIN_RETENTION_DAYS` | 365 | how long the owner's sign-in events (`admin-*`) are kept |
