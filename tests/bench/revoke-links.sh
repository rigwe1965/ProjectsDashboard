#!/bin/sh
# Staging load test S5: revoke the first N grants of the list and print the time (epoch milliseconds) just before it started.
# Compare with "firstRefusals" printed by gateway-load.mjs (atMs) to get the time from revoke to first refusal.
#   cd deploy && sh ../tests/bench/revoke-links.sh 10
set -eu
N="${1:-10}"
C="docker compose -f docker-compose.yml -f docker-compose.loadtest.yml exec -T gateway node demo-gateway/grants-cli.mjs"
IDS=$($C list | head -n "$N" | cut -d' ' -f1)
echo "revoke started at epoch ms: $(date +%s)000"
for id in $IDS; do $C revoke "$id"; done
echo "revoke finished at epoch ms: $(date +%s)000"
