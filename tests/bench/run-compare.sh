#!/bin/bash
# NOTE: if the log stops after "links on generator", the ssh that starts collect.sh did not return (it cost 17 to 27 minutes on 18 Nov 2026).
# Kill that ssh client on this machine (collect.sh is already running on the server) and the driver continues.
# Staging only: set SUT=<staging server address> first. Never point this at production.
# Old-vs-new comparison, runs on lt-gen and drives lt-sut. Short version: S1 and S3 only.
set -u
OLD="${OLD:-201d2c3}"; NEW="${NEW:-65efc49}"
SUT="${SUT:?set SUT to the staging server address}"; TARGET=$SUT:8080
R=/root/results; mkdir -p "$R"
OUT="$R/compare.jsonl"; LOG="$R/compare-driver.log"
GEN=/root/ProjectsDashboard/tests/bench/gateway-load.mjs
sut() { ssh -n -o BatchMode=yes -o StrictHostKeyChecking=accept-new deploy@$SUT "$@"; }
CD="cd ProjectsDashboard/deploy"
DC="docker compose -f docker-compose.yml -f docker-compose.loadtest.yml"
say() { echo "$(date -u +%FT%TZ) $*" | tee -a "$LOG"; }
mark() { say "START $*"; echo "{\"label\":\"$*\",\"at\":\"$(date -u +%FT%TZ)\"}" >> "$OUT"; }
load() { node "$GEN" --target=$TARGET --links=/root/links.txt --out="$OUT" "$@" >> "$LOG" 2>&1; }
waitgw() { for i in $(seq 1 40); do sut "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/_pd/healthz" | grep -q 200 && return 0; sleep 3; done; say "gateway did not come back"; return 1; }
version() { sut "$CD && $DC exec -T gateway grep -c getWithGrant /app/demo-gateway/gateway.mjs" 2>&1 | tail -1; }

say "compare start (old=$OLD new=$NEW)"
say "minting 500 fresh links"
sut "$CD && sh ../tests/bench/mint-links.sh 500 /tmp/links2.txt" >> "$LOG" 2>&1
sut "cat /tmp/links2.txt" > /root/links.txt
say "links on generator: $(wc -l < /root/links.txt)"

sut "( $CD && set -a && . ./.env && set +a && mkdir -p results && setsid nohup sh ../tests/bench/collect.sh results/compare.csv >/dev/null 2>&1 < /dev/null & )" > /dev/null 2>&1 < /dev/null
sleep 5

say "switching lt-sut to OLD $OLD"
sut "cd ProjectsDashboard && git checkout -q $OLD && git checkout $NEW -- deploy/docker-compose.loadtest.yml deploy/loadtest tests/bench && git log --oneline -1" >> "$LOG" 2>&1
sut "$CD && $DC up -d --build gateway standin" >> "$LOG" 2>&1
waitgw
say "gateway has getWithGrant matches (old=0, new>0): $(version)"
sleep 10
for i in 1 2; do mark "OLD S1 run $i"; load --scenario=get --connections=64 --use=50 --warmup=30 --duration=300; done
for i in 1 2; do mark "OLD S3 run $i"; load --scenario=spread --connections=64 --warmup=30 --duration=300; done

say "switching lt-sut back to NEW $NEW"
sut "cd ProjectsDashboard && git checkout -q -f $NEW && git log --oneline -1" >> "$LOG" 2>&1
sut "$CD && $DC up -d --build gateway standin" >> "$LOG" 2>&1
waitgw
say "gateway has getWithGrant matches (old=0, new>0): $(version)"
sleep 10
mark "NEW control S1"; load --scenario=get --connections=64 --use=50 --warmup=30 --duration=300
mark "NEW control S3"; load --scenario=spread --connections=64 --warmup=30 --duration=300

sut "pkill -f '[c]ollect.sh'" > /dev/null 2>&1
say "COMPARE DONE"
touch "$R/compare.done"
