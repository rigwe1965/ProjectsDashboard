# Plan: staging load test for the gateway and database

Status: proposed, not started. Written 2026-11-18, after the scaling pass (PR #58, live commit `9ffa4c0`).

## 1. Why

The scaling pass was measured on one PC with an in-process benchmark (`tests/bench/gateway-bench.mjs`) and checked for correctness on the live server, but the live server has no "before" numbers and carries almost no load. This plan answers, on a copy that is safe to push hard:

1. How many requests per second can the gateway and Postgres sustain on a server like `facyke-prod` (CPX22: 2 vCPU, 4 GB), and where does it start to slow down (the "knee")?
2. Is the new code (`9ffa4c0`) really faster than the old (`201d2c3`) under the same load, with no new errors?
3. What is the first thing that breaks when load grows: the gateway process, the database connections, memory, or the network?
4. Do the safety properties still hold under load: revocation is immediate, rate limits work, a dead demo app gives a clean error, and the database recovering does not leave the gateway stuck?

It does **not** measure the real demo apps (ClaudeOS, RMM and so on). Those are heavy and are tested separately. The test uses a tiny stand-in demo app so that only the part we changed is measured.

## 2. Safety rules (non-negotiable)

- Never run it against production (`facyke-prod`, `*.demo.facyke.com`, `admin.facyke.com`). Staging has its own server, database and domain-free address.
- No real data and no real keys: fresh random passwords in staging's own `.env`, no Anthropic key (the guide stays off), no copy of the production database or `registry/apps.hosted.json`.
- Not reachable from the internet: plain HTTP on a private address, firewalled to the load generator's address only. No DNS, no certificates, nothing indexed.
- Rate limits are raised only in a staging override file (`deploy/docker-compose.loadtest.yml`, never deployed to production). The production compose file is not edited.
- Tear everything down the same day (section 9). Hourly billing makes this cheap.

## 3. Environment

| Role | Recommended | Why |
| --- | --- | --- |
| System under test | A temporary Hetzner Cloud server, same type and region as production (CPX22, Helsinki), Ubuntu 24.04, Docker | Same CPU, RAM and disk class, so the numbers transfer to production |
| Load generator | A second small temporary server in the same region (for example CX22), or your PC for a first rough run | The generator must not share CPU with the system under test. From your PC, home bandwidth and Wi-Fi will cap the result |

Cost: hourly billing, a few hours is well under EUR 1 for both servers. Remember to delete them.

Cheaper but less faithful alternative: run the stack on your PC with Docker (`docker-compose.local.yml`) and CPU and memory limits (2 CPUs, 4 GB). Good for checking the scripts work, not for capacity numbers.

What you do: create the two servers in your Hetzner account (project `facyke-staging`, not `facyke`), add your SSH key, and tell me the addresses. What I do: everything after that.

## 4. What gets built (all new, none touches production)

1. `deploy/docker-compose.loadtest.yml`: a staging-only override that raises the limits so the test is not stopped by its own protection (`GATEWAY_REQUESTS_PER_MINUTE=0`, `GATEWAY_REDEEM_PER_MINUTE=100000`, `GATEWAY_NO_SESSION_PER_MINUTE=100000`), turns on `METRICS_TOKEN`, sets `DEMO_SCHEME=http`, and adds the stand-in app.
2. A stand-in demo app: a few lines of Node in a small container, answering `/` and `/asset/N` with a fixed small body, `/post` echoing a body, and `/slow` after a delay. Registered in a staging-only registry as a demo-ready product.
3. `tests/bench/gateway-load.mjs`: the load generator. Zero dependencies, same style as `gateway-bench.mjs`. Takes the staging address, a file of demo links, a scenario name, and prints one JSON result per run (requests per second, p50, p95, p99, errors by type, status counts). Can ramp concurrency in steps.
4. `tests/bench/mint-links.sh`: creates N demo links on the staging gateway (`grants-cli create ... --max-uses 100000`) and writes them to a file.
5. `tests/bench/collect.sh`: samples `docker stats` and `pg_stat_activity` every 5 seconds into a CSV while a scenario runs.

These go through a normal PR (lint and unit tests apply to the scripts).

## 5. Setup steps

1. On the staging server: `git clone`, check out the commit under test, `cp deploy/.env.example deploy/.env`, fill with fresh random values (a script generates them), then `docker compose -f docker-compose.yml -f docker-compose.loadtest.yml up -d --build` (dashboard only, no `--profile apps`).
2. Firewall (`ufw`): allow SSH from your address and port 8080 only from the load generator.
3. Check `/_pd/healthz` returns 200 and the stand-in app answers through the gateway with one test link.
4. Mint 500 links. Open each once (one consent POST per link) to get its session cookie, and save the cookies. This mirrors how real customers hold sessions.
5. Record: server type, Docker version, commit SHA, Postgres version, and `DATABASE_POOL_MAX`.

## 6. Scenarios

All scenarios run for the stated time after a 30 second warm-up. Each is run three times; the median is reported.

| ID | What | Load | Time | Question it answers |
| --- | --- | --- | --- | --- |
| S1 | Steady small requests | 64 connections, 50 links, GET `/asset/N` | 5 min | Baseline requests per second and latency |
| S2 | Ramp | 16, 32, 64, 128, 256, 512 connections, 60 s each | 6 min | Where is the knee, and what fails first |
| S3 | Many links | 64 connections spread over all 500 links | 5 min | Does the database lookup scale with the number of links |
| S4 | Mixed | 90% GET, 10% POST of 20 KB | 5 min | Request bodies and proxy streaming |
| S5 | Revocation under load | S1 running, revoke 10 links through the console API | 2 min | Time from revoke to the first refusal (under 1 s with the cache off; at most the cache time with it on) |
| S6 | Link-open burst | 200 link opens per second, then steady | 2 min | Redeem path: rate limit table, session creation |
| S7 | Dead demo app | Stop the stand-in app during S1, then start it again | 3 min | Clean 503 and no stuck connections, recovery within 20 s |
| S8 | Database restart | `docker compose restart postgres` during S1 | 3 min | Errors stay brief; the gateway recovers without a restart |
| S9 | Soak | 32 connections | 30 min | Memory growth, connection leaks, the grant cache and seat-table maps |
| S10 | Grant cache on | S1 and S3 again with `GATEWAY_GRANT_CACHE_MS=3000` | 10 min | What the opt-in cache is worth on Postgres, and the revocation lag it adds |
| S11 | Open WebSockets (optional) | 200 sockets held open while S1 runs | 5 min | The five-second socket re-check cost |

## 7. What gets recorded

Per run: requests per second, p50/p95/p99 latency, error rate by status and by error type, and the load generator's own CPU (to make sure it was not the limit). Per scenario, from `collect.sh`: gateway and Postgres CPU and memory, number of Postgres connections against the pool limit of 10, and gateway log lines containing `error` or `timeout`. Everything goes in one results folder with the commit SHA in the name, so runs can be compared later.

## 8. Comparing old and new

Run the full plan twice on the same server, rebuilding between runs: first on `201d2c3` (before the scaling pass), then on `9ffa4c0` (or later). The old commit lacks `tests/bench/`, so the generator and scripts are copied in from the new one, which does not change gateway behaviour.

**Pass criteria for the scaling pass**

- S1 and S3: new throughput at least 1.3 times the old at the same concurrency, with p95 no worse.
- Zero unexpected errors in S1 to S4 (a refusal after a revoke or a 503 when the stand-in app is stopped is expected, anything else is not).
- S5: refusal within 1 second with the cache off.
- S7 and S8: recovery without restarting the gateway.
- S9: memory growth under 10% over 30 minutes after warm-up, and a flat connection count.
- S10: reported as a result, not a pass or fail. If the gain on Postgres is below 20%, the cache stays off in production.

The 1.3 times figure comes from the PC benchmarks (Postgres 1,540 to 2,491 requests per second, 1.6 times). The server is slower, so the bar is lower than the PC result. Adjust it after the first S1 run on the old commit if that run shows the test is dominated by something else.

**Capacity statement.** From S2, write one sentence: "On a CPX22, the gateway sustains N requests per second at p95 under X ms, and the first limit hit is Y." That sentence is the useful result, and the basis for deciding whether to move to a bigger server or more than one gateway.

## 9. Teardown

1. Copy the results folder off both servers (to the easystore drive, for example `I:\Facyke-LoadTests`).
2. Delete both Hetzner servers and any volumes, firewall rules and SSH keys created for the test.
3. Confirm in the Hetzner console that nothing is still billing in `facyke-staging`.
4. Record the numbers and the capacity statement in `docs/HOW-IT-WORKS.md` section 14 (Scaling) and in the project notes.

## 10. Risks and how they are handled

| Risk | Handling |
| --- | --- |
| A mistake points the generator at production | The generator takes the target only from a staging config file and refuses any address containing `facyke.com`; staging has no DNS name at all |
| The load generator is the bottleneck | Separate server; record its CPU; stop and rerun with a larger generator if it exceeds 70% |
| Results differ between runs | Three runs per scenario, median reported, same server, same commit, nothing else running |
| A forgotten server keeps billing | Teardown checklist, and a calendar reminder for the end of the day |
| Staging drifts from production | Same server type and compose file; the only differences are the override file and the stand-in app, both listed in section 4 |
| Postgres tuning hides the real limit | Use the stock settings production uses; try `DATABASE_POOL_MAX` changes only afterwards, as an extra experiment |

## 11. Effort and order

About half a day of work, plus the run time (roughly 1.5 hours per commit for S1 to S11 with three runs of the short scenarios).

1. Build the scripts and the override (PR, with lint and tests).
2. You create the two servers.
3. Setup and a smoke run (S1 only, one minute) on the new commit.
4. Full run on `201d2c3`, then on `9ffa4c0`.
5. Write up, tear down.

## 12. Open questions for the owner

- Two servers (recommended) or one server plus your PC as the generator?
- Is a short-lived `facyke-staging` Hetzner project acceptable, or should it live in the existing `facyke` project?
- Should S11 (WebSockets) be in the first run? It matters for ClaudeOS and RMM, which use sockets.
