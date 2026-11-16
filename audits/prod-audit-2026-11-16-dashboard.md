# Production audit: Dashboard (showcase + console + gateway), 2026-11-16

Scope: facyke.com (showcase), admin.facyke.com (owner console), *.demo.facyke.com (gateway), and the host `facyke-prod`.
Method: read the code, ran the test suites, probed the live site with harmless requests, inspected the server read-only.
No code, configuration or data was changed by this audit.

## Security
| Check | Result |
|---|---|
| `npm audit --omit=dev` | 0 vulnerabilities |
| Public files (`/.env`, `/.git/config`, `/server.mjs`, `/package.json`, `/data/`, `/registry/apps.json`, `/deploy/.env`) | all 404 |
| Showcase headers | CSP (`default-src 'none'`), HSTS, nosniff, X-Frame-Options DENY, referrer policy |
| HTTP -> HTTPS, www -> apex | 308 / 301 |
| Console, no session: `/api/demos`, POST `/api/apps/crm/stop` | 401 |
| Console POST `/login` with a foreign Origin | 403 |
| Console with a forged Host | Caddy answers an empty 200; the console is not reached (it also has its own Host allow-list) |
| Gateway, bogus link token / no cookie | 401; `/_pd/tls-ask` from outside 404; unknown demo subdomain gets no certificate |
| Console sign-in code (read, not changed) | scrypt (N=2^17), TOTP with replay protection, per-IP and overall rate limits, hashed DB sessions, `__Host-` HttpOnly SameSite=Strict cookie, same-origin check on every POST, nonce CSP |
| Gateway redeem code (read, not changed) | GET never spends a use, POST does; rate limits; device lock; link token differs from the session cookie |
| Server | open ports 22/80/443 only; ufw and fail2ban active; SSH key-only, root off, MaxAuthTries 3; `deploy/.env` mode 600; no container mounts the Docker socket or is privileged; only Caddy publishes ports |

## Links and buttons
Crawled facyke.com in Chrome: 11 pages, all 200; no broken internal links or anchors. External links all answer 200:
cal.com booking page (event slug `fackye`, page title "facyke"), Gmail and Outlook compose links; the `mailto:` link is well formed.
Console buttons (app card, Log dialog, Activity panel, Details, Sign out) are covered by `tests/browser-ui.mjs`: 11 of 11 steps pass.

## Tests
`npm test` with DEMO_BRAND_NAME / DEMO_BOOKING_URL unset: 437 tests, 436 pass, 0 fail, 1 skipped.
(With those variables set, one branding test fails; that is the test reading the environment, not a defect.)
`npm run test:browser:ui`: 11 of 11 passed. `npm run lint`: clean.

## Accounts
The console has ONE owner account (password + 2-step code), already set by the owner. There is no sign-up, no user list and no
role system, so "create other users" does not apply. Nothing was created or changed.

## Not verified
- The signed-in console on the live site (no credentials available to me); covered only by the local browser test.
- No live brute-force or load testing (it would lock the real owner's IP out).
- Not every gateway file was re-read line by line; earlier audits (audits/*.md) cover them.
- 5 Ubuntu packages are upgradable on the server; none were applied (no reboot is pending).

## Outstanding / recommendations
- None are security-critical. Optional: apply the 5 pending package upgrades in a quiet window; add `includeSubDomains` to HSTS (not changed: it would also bind the demo subdomains).
