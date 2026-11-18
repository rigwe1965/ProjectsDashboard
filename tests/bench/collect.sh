#!/bin/sh
# Staging load test: every 5 seconds append gateway and Postgres CPU/memory, the Postgres connection count and the gateway's
# request counter to a CSV, until stopped with Ctrl+C. Run it on the staging server next to the stack while a scenario runs.
#   cd deploy && sh ../tests/bench/collect.sh results/S1-run1.csv
set -eu
OUT="${1:-collect.csv}"; mkdir -p "$(dirname "$OUT")"
C="docker compose -f docker-compose.yml -f docker-compose.loadtest.yml"
TOKEN="${METRICS_TOKEN:-loadtest-metrics-token}"
echo "time,gateway_cpu,gateway_mem,postgres_cpu,postgres_mem,pg_connections,requests_total" > "$OUT"
while true; do
  G=$(docker stats --no-stream --format '{{.CPUPerc}},{{.MemUsage}}' "$($C ps -q gateway)" | sed 's/ \/ [^,]*//')
  P=$(docker stats --no-stream --format '{{.CPUPerc}},{{.MemUsage}}' "$($C ps -q postgres)" | sed 's/ \/ [^,]*//')
  K=$($C exec -T postgres psql -U dashboard -d dashboard -Atc "select count(*) from pg_stat_activity where datname='dashboard'")
  R=$(curl -fsS -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8080/_pd/metrics | grep '^pd_gateway_requests_total' | awk '{s+=$NF} END{print s+0}')
  echo "$(date -u +%FT%TZ),$G,$P,$K,$R" >> "$OUT"
  sleep 5
done
