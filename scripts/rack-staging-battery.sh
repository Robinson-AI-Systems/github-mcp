#!/usr/bin/env bash
# Rack staging battery wrapper (bench-side): stands up a throwaway
# PostgreSQL cluster, then runs the S-1 proof and the S-2 git
# battery against it through the pg transport. Disposable: the
# cluster lives in a mktemp dir and is stopped on exit.
set -euo pipefail
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
if [ -z "${PGBIN}" ] && command -v initdb >/dev/null; then PGBIN="$(dirname "$(command -v initdb)")"; fi
[ -n "${PGBIN}" ] || { echo "no PostgreSQL binaries found"; exit 2; }
export PATH="$PGBIN:$PATH"
WORK="$(mktemp -d)"
PORT="${BATTERY_PG_PORT:-55441}"
cleanup() { pg_ctl -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; }
trap cleanup EXIT
initdb -D "$WORK/data" -U postgres --auth=trust >/dev/null
pg_ctl -D "$WORK/data" -o "-p $PORT -k $WORK -h 127.0.0.1" -l "$WORK/pg.log" -w start >/dev/null
createdb -h 127.0.0.1 -p "$PORT" -U postgres github_scratch
export DATABASE_URL="postgresql://postgres@127.0.0.1:$PORT/github_scratch"
echo "BATTERY pg: scratch cluster on 127.0.0.1:$PORT"
node scripts/rack-staging-proof.mjs
node scripts/rack-git-battery.mjs
echo "BATTERY WRAPPER PASS"
