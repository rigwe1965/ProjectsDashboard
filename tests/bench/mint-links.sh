#!/bin/sh
# Staging load test: create N demo links on the staging gateway and write them to a file (one URL per line).
#   cd deploy && sh ../tests/bench/mint-links.sh 500 links.txt
# Uses the gateway container's own command line, so the stack from docker-compose.loadtest.yml must be running.
set -eu
N="${1:?how many links}"; OUT="${2:-links.txt}"
: > "$OUT"
i=1
while [ "$i" -le "$N" ]; do
  docker compose -f docker-compose.yml -f docker-compose.loadtest.yml exec -T gateway \
    node demo-gateway/grants-cli.mjs create --customer "load$i" --app toy --hours 24 --max-uses 1000 | grep -o 'http[^ ]*/d/[A-Za-z0-9_-]*' >> "$OUT"
  i=$((i + 1))
done
echo "wrote $(wc -l < "$OUT") links to $OUT"
