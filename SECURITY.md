# Security policy

## Reporting a problem

Please do not open a public issue for a security problem. Email **info@facyke.com** with what you found and where, how to reproduce it, and what an attacker could do with it. You will get a first reply within 5 working days.

## What is in scope

The code in this repository: the admin console, the demo gateway, the supervisor, the licence library and the deploy recipes. Past reviews are in `audits/`.

## Running it safely

- Never commit `.env`, `deploy/.env`, `registry/apps.hosted.json` or anything under `data/`. They are gitignored on purpose.
- Turn on the console's 2-step codes (`ADMIN_REQUIRE_TOTP=1`) before it listens beyond your own computer.
- Demo links are secrets: treat a link like a password, set a short expiry, and revoke it when the demo ends.
- Keep demo AI keys in a dedicated workspace with a spend limit, and rotate any key that is ever pasted somewhere public.

## Supported versions

Only `main` receives fixes.
