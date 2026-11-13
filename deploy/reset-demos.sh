#!/usr/bin/env bash
# Put the hosted customer demos back to their seeded state, so what one customer entered never reaches the next.
#
#   cd deploy && ./reset-demos.sh                     reset every demo that is due (see below)
#   ./reset-demos.sh crm airfinder                    only those products
#   ./reset-demos.sh --force crm                      reset now, even if a customer link is still active
#   ./reset-demos.sh --dry-run                        say what would happen, change nothing
#   ./reset-demos.sh --apps imageapp airfinder        (a product) name your own: crm imageapp airfinder claudeworkspace claudeos
#
# A demo is "due" when a link was opened for it since its last reset AND no opened link is still active (every one has been
# revoked or has expired), the same rule the local setup uses. While a reset runs, the gateway answers "being prepared" for
# that demo's links. Every reset is recorded in the console's Activity view.
#
# Run it from cron or a systemd timer every few minutes, for example:   */10 * * * *  cd /srv/projects-dashboard/deploy && ./reset-demos.sh
# It needs the stack to be running (docker compose up -d --profile apps) and docker access on this host: the containers
# themselves have none, which is why the reset is driven from outside.
#
# What each reset does:
#   crm              re-runs the CRM's seed against the demo database (wipes it, recreates the sample business and users)
#   imageapp         recreates the container, which empties the upload folder
#   claudeos         deletes the demo database and vector files, seeds the agents and the demo admin again, clears the forced password change
#   airfinder        deletes the demo database, seeds the sample data again, clears the forced password change
#   claudeworkspace  empties the demo Supabase project's customer data and extra accounts, resets the two demo passwords,
#                    then re-seeds the vehicles (needs CW_DEMO_ADMIN_* / CW_DEMO_CUSTOMER_* in .env)
set -eu
# Git Bash on Windows rewrites arguments that look like Unix paths (the "/pd-reset.sh" mount below became C:/.../Git/pd-reset.sh); on Linux this does nothing.
export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL="*"
cd "$(dirname "$0")"

FORCE=0; DRY=0; PRODUCTS=()
for a in "$@"; do
  case "$a" in
    --force) FORCE=1 ;;
    --dry-run) DRY=1 ;;
    --apps) ;;
    -*) echo "Unknown option: $a" >&2; exit 2 ;;
    *) PRODUCTS+=("$a") ;;
  esac
done
[ ${#PRODUCTS[@]} -gt 0 ] || PRODUCTS=(crm imageapp airfinder claudeworkspace claudeos)

DC=(docker compose --profile apps)
state() { "${DC[@]}" exec -T gateway node supervisor/demo-reset-state.mjs "$@"; }

recipe() {
  case "$1" in
    crm)
      "${DC[@]}" run --rm --no-deps crm-migrate seed ;;
    imageapp)
      "${DC[@]}" up -d --no-deps --force-recreate imageapp-demo ;;
    airfinder)   # runs inside `if`, where `set -e` is switched off, so each step is checked by hand. Stopping must succeed (the reset must not run
                 # under a live app); after that the demo is started again WHATEVER the reset did, so a failed reset never leaves it stopped.
      "${DC[@]}" stop airfinder-demo || return 1
      local ok=0
      "${DC[@]}" run --rm --no-deps -v "$PWD/apps/airfinder/reset.sh:/pd-reset.sh:ro" airfinder-demo sh /pd-reset.sh || ok=1
      "${DC[@]}" up -d --no-deps airfinder-demo || ok=1
      return $ok ;;
    claudeos)    # same shape as airfinder: stop, re-seed inside the image, start again whatever the reset did
      "${DC[@]}" stop claudeos-demo || return 1
      local ok=0
      MSYS_NO_PATHCONV=1 "${DC[@]}" run --rm --no-deps -v "$PWD/apps/claudeos/reset.sh:/pd-reset.sh:ro" -v "$PWD/apps/claudeos/seed_namespaces.py:/pd-seed-namespaces.py:ro" claudeos-demo sh /pd-reset.sh || ok=1
      "${DC[@]}" up -d --no-deps claudeos-demo || ok=1
      return $ok ;;
    claudeworkspace)
      "${DC[@]}" --profile reset run --rm --no-deps cw-reset &&
      "${DC[@]}" run --rm --no-deps claudeworkspace-web node /app/seed_demo.mjs ;;
    *) echo "Unknown product: $1" >&2; return 2 ;;
  esac
}

status=0
for p in "${PRODUCTS[@]}"; do
  case "$p" in crm|imageapp|airfinder|claudeworkspace|claudeos) ;; *) echo "Unknown product: $p" >&2; status=2; continue ;; esac
  why=$(state due "$p" 2>/dev/null || true)
  if [ "$FORCE" = 0 ] && [ "$why" != "due" ]; then echo "$p: not reset ($why)"; continue; fi
  if [ "$DRY" = 1 ]; then echo "$p: would be reset (${why:-forced})"; continue; fi
  if ! started=$(state begin "$p"); then echo "$p: a reset is already running" >&2; status=1; continue; fi
  echo "$p: resetting..."
  if recipe "$p"; then state end "$p" ok "$started" >/dev/null; echo "$p: reset"
  else state end "$p" fail "$started" >/dev/null; echo "$p: reset FAILED (see the output above; it is retried in 10 minutes)" >&2; status=1; fi
done
exit $status
