# Plan: staging load test for the gateway and database

Status (updated 2026-11-18, evening): scripts built (PR #59); two temporary servers were created, the stack was set up and a smoke run passed; the full run on the new code was started and only the first scenarios (S1, S2) are on record; the old-commit comparison was not run; the owner reports the servers deleted. See section 13 and onboarding book chapter 23. Written 2026-11-18, after the scaling pass (PR #58, live commit `9ffa4c0`).

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
| System under test | A temporary Hetzner Cloud server, same type and region as production (CPX22, Helsinki), Ubuntu 26.04.1 (what production runs), Docker | Same CPU, RAM and disk class, so the numbers transfer to production |
| Load generator | A second small temporary server in the same region (for example CX22), or your PC for a first rough run | The generator must not share CPU with the system under test. From your PC, home bandwidth and Wi-Fi will cap the result |

Cost: hourly billing, a few hours is well under EUR 1 for both servers. Remember to delete them.

Cheaper but less faithful alternative: run the stack on your PC with Docker (`docker-compose.local.yml`) and CPU and memory limits (2 CPUs, 4 GB). Good for checking the scripts work, not for capacity numbers.

What you do: create the two servers in your Hetzner account (project `facyke-staging`, not `facyke`), add your SSH key, and tell me the addresses. What I do: everything after that.

## 4. What gets built (all new, none touches production)

1. `deploy/docker-compose.loadtest.yml`: a staging-only override that raises the limits so the test is not stopped by its own protection (`GATEWAY_REQUESTS_PER_MINUTE=0`, `GATEWAY_REDEEM_PER_MINUTE=100000`, `GATEWAY_NO_SESSION_PER_MINUTE=100000`), turns on `METRICS_TOKEN`, sets `DEMO_SCHEME=http`, publishes the gateway on port 8080 (no Caddy, no console), and adds the stand-in app (`deploy/loadtest/standin.mjs`, registry `deploy/loadtest/apps.loadtest.json`).
2. A stand-in demo app: a few lines of Node in a small container, answering `/` and `/asset/N` with a fixed small body, `/post` echoing a body, and `/slow` after a delay. Registered in a staging-only registry as a demo-ready product.
3. `tests/bench/gateway-load.mjs`: the load generator. Zero dependencies, same style as `gateway-bench.mjs`. Takes the staging address, a file of demo links, a scenario name, and prints one JSON result per run (requests per second, p50, p95, p99, errors by type, status counts). Can ramp concurrency in steps.
4. `tests/bench/mint-links.sh`: creates N demo links on the staging gateway (`grants-cli create ... --max-uses 1000`, the most the product allows; a link open uses one, so S6 spreads its opens over all links) and writes them to a file.
5. `tests/bench/collect.sh`: samples `docker stats` and `pg_stat_activity` every 5 seconds into a CSV while a scenario runs.

These go through a normal PR (lint and unit tests apply to the scripts).

## 5. Setup steps

1. On the staging server: `git clone`, check out the commit under test, `cp deploy/.env.example deploy/.env`, fill with fresh random values (a script generates them), then `docker compose -f docker-compose.yml -f docker-compose.loadtest.yml up -d --build` (dashboard only, no `--profile apps`).
2. Firewall: `ufw` does **not** cover ports that Docker publishes, so close port 8080 with Docker's own chain instead (rules in onboarding book chapter 23, part B, step 4): ACCEPT the generator's address, DROP everything else, with `--ctorigdstport 8080` and `--ctdir ORIGINAL`. The rules are lost on reboot. Test from a third address and from the generator.
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
| S5 | Revocation under load | S1 running, revoke 10 links with `tests/bench/revoke-links.sh` (the console is not run in staging; the revoke path is the same database write) | 2 min | Time from revoke to the first refusal (under 1 s with the cache off; at most the cache time with it on) |
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

Do this only after the results are safely copied off the servers.

**A. Save the results**
1. Results are in `~/ProjectsDashboard/deploy/results/` (collect CSVs) and the generator's JSON output file on each server.
2. Copy them to the PC, then to the easystore drive, for example `I:\Facyke-LoadTests\<date>-<commit>\`.
3. Open a few files and check they are not empty. After deletion they cannot be recovered.

**B. Delete the servers (Hetzner console)**
1. Open console.hetzner.cloud and the **`facyke-staging`** project. Check the project name at the top. Never do this in `facyke`, where `facyke-prod` lives.
2. Servers: there should be exactly two, `lt-sut` and `lt-gen`.
3. For each: server, Actions menu, **Delete**, type the name to confirm. Do not use "Power off": a powered-off server is still billed.
4. Check the Servers list is empty.

**C. Remove everything else created for the test**
1. Volumes: empty (none are created).
2. Snapshots and backups: empty (none are enabled).
3. Firewalls created in this project: delete.
4. Primary IPs and floating IPs: none left; an unassigned IP is billed, so delete it.
5. SSH key in this project: remove (optional, it is only a copy of the public key).

**D. Confirm nothing is billing**
1. Check the project's Costs tab or the account's Billing page: no resource running. Charges stop when a server is deleted.
2. Optionally delete the `facyke-staging` project (Project, Settings, Delete). A project with resources cannot be deleted, so success also proves it is empty.

**E. Close the loop**
1. Record the numbers and the capacity statement in `docs/HOW-IT-WORKS.md` section 14 (Scaling) and in the project notes.
2. Check production was not touched: `https://admin.facyke.com` and a demo link work as before.

**Safety:** set a calendar alarm for the end of the test day. If unsure which project you are in, stop: the project name `facyke-staging` and the server names `lt-sut` and `lt-gen` must all match.

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
- Should S11 (WebSockets) be in the first run? (Not built yet: the generator does not open sockets; say so if you want it.) It matters for ClaudeOS and RMM, which use sockets.

## 13. What happened (18 November 2026)

- **Built:** the override file, stand-in app, load generator and scripts (PR #59, open).
- **Servers:** project `facyke-staging`, `lt-sut` and `lt-gen`, Ubuntu 26.04.1. The first pair had no SSH key and was recreated. The Hetzner firewall and private network were not attached, so port 8080 was closed with a Docker `DOCKER-USER` rule.
- **Smoke run:** 5 links, 16 connections, 10 s: 22,670 requests, all 200, 2,266 requests/s, p95 12.5 ms.
- **Full run on the new code (S1 to S11, label `new-65efc49`):** on record only S1 (3 runs: 2,420 / 2,364 / 2,143 requests/s, p95 41 / 41 / 47 ms at 64 connections) and one S2 ramp (2,139/s at 32 connections up to a plateau near 2,300/s at 64, then 1,640 to 1,810/s at 128 to 512, p95 388 ms at 512), all HTTP 200, zero errors. S3 to S10 results are not recorded in this repository.
- **Not done:** the run on `201d2c3`, so the 1.3 times pass bar (section 8) is unproven, and no capacity sentence has been written.
- **Teardown:** reported done by the owner. Confirm in the Hetzner console (Servers list empty, Costs tab flat).
