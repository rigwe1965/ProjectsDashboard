#!/usr/bin/env bash
# Put a dedicated, spend-limited Anthropic key into the hosted demos (ClaudeOS and/or RMM).
#
#   ./set-demo-key.sh claudeos         # asks for the key (typed hidden, never printed or logged)
#   ./set-demo-key.sh rmm
#   ./set-demo-key.sh both             # same key for both demos
#
# What it does: checks the key against the Anthropic API, backs up .env, writes the key,
# recreates only the affected demo container(s), and waits until they are healthy.
# The key is read from the terminal (or from DEMO_KEY in the environment), never from arguments,
# so it does not end up in shell history or `ps`.
set -euo pipefail
cd "$(dirname "$0")"

target="${1:-}"
case "$target" in
  claudeos) vars=(CLAUDEOS_ANTHROPIC_API_KEY); services=(claudeos-demo) ;;
  rmm)      vars=(RMM_ANTHROPIC_API_KEY);      services=(rmm-demo-api) ;;
  both)     vars=(CLAUDEOS_ANTHROPIC_API_KEY RMM_ANTHROPIC_API_KEY); services=(claudeos-demo rmm-demo-api) ;;
  *) echo "usage: $0 claudeos|rmm|both" >&2; exit 2 ;;
esac
[ -f .env ] || { echo "no deploy/.env here" >&2; exit 1; }

key="${DEMO_KEY:-}"
if [ -z "$key" ]; then
  read -r -s -p "Anthropic demo key (hidden): " key; echo
fi
case "$key" in sk-ant-*) ;; *) echo "That does not look like an Anthropic key (should start with sk-ant-)." >&2; exit 1 ;; esac

# 1. The key must work before it replaces anything.
status=$(curl -s -o /dev/null -w '%{http_code}' https://api.anthropic.com/v1/models \
  -H "x-api-key: $key" -H "anthropic-version: 2023-06-01")
if [ "$status" != "200" ]; then
  echo "Anthropic rejected the key (HTTP $status). Nothing was changed." >&2; exit 1
fi
echo "Key accepted by Anthropic."

# 2. Back up, then replace (or add) the lines.
backup=".env.bak-$(date +%Y%m%d-%H%M%S)"
cp -p .env "$backup"; chmod 600 "$backup"
for v in "${vars[@]}"; do
  tmp=$(mktemp); chmod 600 "$tmp"
  grep -v "^${v}=" .env > "$tmp" || true
  printf '%s=%s\n' "$v" "$key" >> "$tmp"
  cat "$tmp" > .env; rm -f "$tmp"
done
echo "Updated ${vars[*]} (backup: $backup)."

# 3. Recreate only the demo containers that read the key.
docker compose --profile apps up -d --no-deps --force-recreate "${services[@]}" >/dev/null
for s in "${services[@]}"; do
  for _ in $(seq 1 30); do
    state=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "pd-$s" 2>/dev/null || echo missing)
    [ "$state" = healthy ] || [ "$state" = running ] && break
    sleep 3
  done
  echo "$s: $state"
done
echo "Done. Old key lines are only in $backup; delete it once you are happy (it holds the previous key)."
