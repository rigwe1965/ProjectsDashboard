#!/bin/bash
# NOTE: if the log stops after "links on generator", the ssh that starts collect.sh did not return (it cost 17 to 27 minutes on 18 Nov 2026).
# Kill that ssh client on this machine (collect.sh is already running on the server) and the driver continues.
# Staging only: set SUT=<staging server address> first. Never point this at production.
# Staging load test driver: runs on lt-gen, drives lt-sut over ssh. Usage: run-all.sh <label>   (label = commit under test)
set -u
LABEL="${1:-new}"
SUT="${SUT:?set SUT to the staging server address}"
TARGET=$SUT:8080
R=/root/results; mkdir -p "$R"
OUT="$R/$LABEL.jsonl"
LOG="$R/$LABEL-driver.log"
GEN=/root/ProjectsDashboard/tests/bench/gateway-load.mjs
sut() { ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new deploy@$SUT "$@"; }
C="cd ProjectsDashboard/deploy && docker compose -f docker-compose.yml -f docker-compose.loadtest.yml"
say() { echo "$(date -u +%FT%TZ) $*" | tee -a "$LOG"; }
mark() { say "START $*"; echo "{\"label\":\"$*\",\"at\":\"$(date -u +%FT%TZ)\"}" >> "$OUT"; }
load() { node "$GEN" --target=$TARGET --links=/root/links.txt --out="$OUT" "$@" >> "$LOG" 2>&1; }
waitgw() { for i in $(seq 1 30); do sut "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/_pd/healthz" | grep -q 200 && return 0; sleep 2; done; say "gateway did not come back"; return 1; }

say "driver start label=$LABEL"
{ sut "cd ProjectsDashboard && git rev-parse HEAD && cd deploy && docker --version && docker compose version --short && docker compose -f docker-compose.yml -f docker-compose.loadtest.yml exec -T postgres postgres --version && nproc && free -m | sed -n 2p"; node --version; } > "$R/$LABEL-env.txt" 2>&1

say "minting 500 links"
sut "cd ProjectsDashboard/deploy && sh ../tests/bench/mint-links.sh 500 /tmp/links.txt" >> "$LOG" 2>&1
sut "cat /tmp/links.txt" > /root/links.txt
say "links on generator: $(wc -l < /root/links.txt)"

sut "cd ProjectsDashboard/deploy && mkdir -p results && set -a && . ./.env && set +a && setsid nohup sh ../tests/bench/collect.sh results/$LABEL.csv >/dev/null 2>&1 < /dev/null &"
sleep 8

for i in 1 2 3; do mark "S1 run $i"; load --scenario=get --connections=64 --use=50 --warmup=30 --duration=300; done
for i in 1 2 3; do mark "S2 run $i"; load --scenario=ramp --use=50 --warmup=5 --duration=60; done
for i in 1 2 3; do mark "S3 run $i"; load --scenario=spread --connections=64 --warmup=30 --duration=300; done
for i in 1 2 3; do mark "S4 run $i"; load --scenario=mixed --connections=64 --use=50 --warmup=30 --duration=300; done

mark "S6 burst"; load --scenario=burst --rate=200 --warmup=10 --duration=120

mark "S7 dead demo app"
load --scenario=get --connections=32 --use=50 --duration=180 &
sleep 60; say "stopping stand-in"; sut "$C stop standin" >> "$LOG" 2>&1
sleep 30; say "starting stand-in"; sut "$C start standin" >> "$LOG" 2>&1
wait
mark "S7 recovery check"; load --scenario=get --connections=8 --use=50 --duration=10

mark "S8 database restart"
load --scenario=get --connections=32 --use=50 --duration=180 &
sleep 60; say "restarting postgres"; sut "$C restart postgres" >> "$LOG" 2>&1
wait
mark "S8 recovery check"; load --scenario=get --connections=8 --use=50 --duration=10

mark "S9 soak"; load --scenario=get --connections=32 --use=50 --warmup=30 --duration=1800

say "S10: cache on (3000 ms)"
sut "$C stop gateway >/dev/null 2>&1; GATEWAY_GRANT_CACHE_MS=3000 docker compose -f docker-compose.yml -f docker-compose.loadtest.yml up -d gateway" >> "$LOG" 2>&1
waitgw
mark "S10 cache on, S1 shape"; load --scenario=get --connections=64 --use=50 --warmup=30 --duration=300
mark "S10 cache on, S3 shape"; load --scenario=spread --connections=64 --warmup=30 --duration=300

say "S5: cache off again, revoke under load"
sut "$C up -d --force-recreate gateway" >> "$LOG" 2>&1
waitgw
mark "S5 revoke under load"
load --scenario=get --connections=32 --use=50 --duration=120 &
sleep 60; sut "cd ProjectsDashboard/deploy && sh ../tests/bench/revoke-links.sh 10" 2>&1 | tee -a "$LOG" >> "$OUT"
wait

sut "pkill -f collect.sh"
say "ALL DONE"
touch "$R/$LABEL.done"
