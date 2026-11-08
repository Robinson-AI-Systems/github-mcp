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
PORT="${BATTERY_PG_PORT:-$(( 20000 + RANDOM % 20000 ))}"
# Bench jobs run as root; PostgreSQL refuses to run as root, so the
# cluster is owned and run by the postgres system user.
chown postgres:postgres "$WORK" 2>/dev/null || chown nobody "$WORK"
PGUSER_NAME="$(stat -c %U "$WORK")"
aspg() { runuser -u "$PGUSER_NAME" -- env PATH="$PGBIN:/usr/bin:/bin" HOME="$WORK" "$@"; }
cleanup() { aspg pg_ctl -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; }
trap cleanup EXIT
aspg initdb -D "$WORK/data" -U postgres --auth=trust >/dev/null
aspg pg_ctl -D "$WORK/data" -o "-p $PORT -k $WORK -h 127.0.0.1" -l "$WORK/pg.log" -w start >/dev/null || { cat "$WORK/pg.log" 2>/dev/null | tail -15; exit 3; }
createdb -h 127.0.0.1 -p "$PORT" -U postgres github_scratch
export DATABASE_URL="postgresql://postgres@127.0.0.1:$PORT/github_scratch"
echo "BATTERY pg: scratch cluster on 127.0.0.1:$PORT"
node scripts/rack-staging-proof.mjs
BATTERY_RC=0
timeout 90 node scripts/rack-git-battery.mjs || BATTERY_RC=$?
TRACE=$(ls -td /tmp/rack-git-battery-*/clone-trace.txt 2>/dev/null | head -1)
[ -n "$TRACE" ] && { echo '--- clone trace ---'; cat "$TRACE"; }
exit $BATTERY_RC
echo "BATTERY WRAPPER PASS"
