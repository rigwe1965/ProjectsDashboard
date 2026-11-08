# Demo gateway
Gives one customer time-limited access to ONE product's isolated demo instance.

```
npm run gateway                                   # start the gateway (port 4300)
npm run demo -- create --customer "Acme" --app imageapp --hours 48   # prints the customer link (shown once)
npm run demo -- create --customer "Acme" --app crm --max-uses 3 --device-lock   # optional limits
npm run demo -- list
npm run demo -- revoke <id>
```
- **Link limits (optional):** `--max-uses N` (or "Max opens" in the console) stops the link after N opens; `--device-lock` ("Lock to first browser") pins it to the browser that opens it first, so a forwarded link opened elsewhere is refused. The device check uses the browser's User-Agent, so it deters casual sharing but is not a hard guarantee. Revoking a link is the way to end it early.
- **Abuse protection:** link opens are limited per IP and per link, and an address that keeps presenting bad links is refused for a while. Repeated denials after a revocation are summarised in the audit log instead of filling it. Audit entries include the IP and browser.
- **Headers:** the gateway's own pages carry strict security headers (CSP, frame, referrer), and proxied responses get `nosniff` and a referrer policy unless the app set its own.
- Link format: `http://<product>.localhost:4300/d/<token>` (set `DEMO_BASE_HOST` / `DEMO_SCHEME=https` for a real domain).
- Only registry entries with `demoOf` and `demoReady: true` can be served. Set `demoReady` only after confirming the instance shares no data with production.
- A GET of a link never opens the demo or spends a use (mail scanners and chat previews fetch links). It shows a shared-demo notice (one instance per product is shared by all customers, so they are asked not to enter real personal data) and a button; the click is a POST and opens the demo. Next.js dev-only routes (`/__nextjs_*`) are answered by the gateway with a 404.
- Opening a link (`/d/<token>`) is the only place the link token is used. The gateway then gives the browser a separate random session cookie, so the link itself can never be sent as a cookie to skip the use limit or device lock. The session is checked against its grant on every request: expiry and revocation apply immediately; a link works only on its own product's host. (Browsers that opened a link before this change need to open it once more.)
- Tokens are stored hashed in the database (`data/dashboard.db`); grants, entries, denials and revocations go to its audit table (kept 90 days, set `AUDIT_RETENTION_DAYS` to change). Old `demos.json` / `demo-access.log` are imported automatically the first time and kept as a backup; `npm run migrate` re-checks the import.
- Start the gateway and the demo instance from the Demos panel in the admin console (or `node supervisor/index.mjs start gateway` / `start imageapp-demo`).
- **WebSockets are supported** (Streamlit apps work through the gateway). An open socket is re-checked every few seconds, so revoking or expiring a grant also cuts off sockets that are already open. ClaudeOS and the RMM UI are *technically* able to run through it now, but stay `demoReady: false` until you have confirmed each one has its own demo data (ClaudeOS and RMM have no separate demo database yet).
- Code: `gateway.mjs` (the proxy, testable) and `server.mjs` (starts it). `npm test` runs it against a fake upstream.

## Settings (environment variables, all optional)
| Variable | Default | Meaning |
|---|---|---|
| `GATEWAY_PORT` | 4300 | port to listen on |
| `DEMO_BASE_HOST`, `DEMO_SCHEME` | `localhost:<port>`, `http` | public host and scheme used in links |
| `TRUSTED_PROXIES` | none | comma-separated IPs of your reverse proxy. `X-Forwarded-For` is believed only from these; otherwise it is ignored (so nobody can spoof their IP to dodge the rate limit) |
| `GATEWAY_UPSTREAM_TIMEOUT_MS` | 60000 | a demo that stays silent this long gets a 504 |
| `GATEWAY_MAX_BODY_MB` | 50 | largest upload accepted (413 above it) |
| `GATEWAY_WS_RECHECK_MS` | 5000 | how often open WebSockets are re-validated |
| `GATEWAY_MAX_WS_PER_GRANT` | 20 | open WebSockets allowed per demo link |
| `GATEWAY_REDEEM_PER_MINUTE` | 20 | link opens allowed per IP per minute |
| `GATEWAY_REDEEM_FAIL_LIMIT` | 10 | bad links per IP per 10 minutes before it is refused |
| `AUDIT_RETENTION_DAYS` | 90 | how long audit events are kept |
