# Demo gateway
Gives one customer time-limited access to ONE product's isolated demo instance.

```
npm run gateway                                   # start the gateway (port 4300)
npm run demo -- create --customer "Acme" --app imageapp --hours 48   # prints the customer link (shown once)
npm run demo -- list
npm run demo -- revoke <id>
```
- Link format: `http://<product>.localhost:4300/d/<token>` (set `DEMO_BASE_HOST` / `DEMO_SCHEME=https` for a real domain).
- Only registry entries with `demoOf` and `demoReady: true` can be served. Set `demoReady` only after confirming the instance shares no data with production.
- The cookie is re-checked on every request: expiry and revocation apply immediately; a link works only on its own product's host.
- Tokens are stored hashed (`data/demos.json`); entries and denials are logged to `data/demo-access.log`.
- Start the gateway and the demo instance from the Demos panel in the admin console (or `node supervisor/index.mjs start gateway` / `start imageapp-demo`).
- Not supported yet: WebSockets (Streamlit apps), so ClaudeOS and the RMM UI are not demo-ready.
