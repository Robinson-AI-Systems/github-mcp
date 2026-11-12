#!/usr/bin/env bash
# WORKER-AUTOUPDATE-1: keep the PC native Git worker current with the server's release branch,
# updating BETWEEN jobs instead of waiting for a long idle stretch (owner order, 2026-11-11).
#
# How it works, in order:
#   1. Compare the worker's build (SOURCE_COMMIT in /srv/robinson-git/.env) with the tip of the
#      release branch (`live` in Robinson-AI-Systems/github-mcp — the same ref install.sh installs
#      by default, and the commit github_server_status reports as the server's release).
#   2. If a newer build exists: close admission with the worker's own owner-pause file (marked as
#      ours), then wait for the work already admitted to finish — no mutation.lock files and no
#      established connections to the worker ports, held for a short quiet window. The wait is
#      capped (WORKER_AUTOUPDATE_MAX_DRAIN_SECONDS, default 900 = the longest single operation
#      the worker itself allows, a 15-minute clone). Past the cap the update DEFERS to a later
#      cycle; a running job is never killed for an update.
#   3. Swap with the existing control: pc-worker update --commit <target> (builds the new image
#      first, then recreates the container; settings in .env are kept and the MCP's current
#      control public key is re-fetched by install.sh, exactly like a manual update).
#   4. Verify: container healthy, both local health endpoints, the public Funnel health, the
#      pinned control key still matches the key the MCP serves, and the container still carries
#      the .env GitHub HTTP version. Any failure rolls back to the previous build automatically
#      (its image is still on disk) and journals the failure loudly.
#   5. Every attempt writes a receipt (JSON lines) and refreshes a status file, so "is the worker
#      current?" is one read: pc-worker autoupdate status.
#
# It does nothing while: the updater's own pause file exists (.autoupdate-pause), the PC's
# RECLAIM flag is set (the owner's own use wins, always), the worker is owner-paused or stopped,
# or another updater run holds the lock. It never touches any other container or service.
#
# Operator overrides (used by tests and repairs; leave unset in normal operation):
#   WORKER_AUTOUPDATE_TARGET_SHA   update to this exact commit instead of the live tip
#   WORKER_AUTOUPDATE_MAX_DRAIN_SECONDS   drain cap override
#   PC_WORKER_HOME                 worker home (default /srv/robinson-git)
set -uo pipefail

HOME_DIR="${PC_WORKER_HOME:-/srv/robinson-git}"
ENV_FILE="$HOME_DIR/.env"
REPO_URL="https://github.com/Robinson-AI-Systems/github-mcp.git"
RELEASE_REF="live"
STATE_DIR="$HOME_DIR/autoupdate"
STATUS_FILE="$STATE_DIR/status.json"
RECEIPTS_FILE="$STATE_DIR/receipts.jsonl"
# AUTOUPDATE-GATE-1: a target that failed verification is not retried every cycle (each retry closed
# admission again); the updater holds until the release branch moves or an operator clears this file.
FAILED_TARGET_FILE="$STATE_DIR/failed-target"
UPDATER_PAUSE="$HOME_DIR/.autoupdate-pause"
RECLAIM_FILE="${WORKER_AUTOUPDATE_RECLAIM_FILE:-/mnt/c/VivienneHome/RECLAIM}"
PAUSE_MARKER="worker-autoupdate"
WORKER_CONTAINER="robinson-git-native-git-1"
MAX_DRAIN_SECONDS="${WORKER_AUTOUPDATE_MAX_DRAIN_SECONDS:-900}"
[[ "$MAX_DRAIN_SECONDS" =~ ^[0-9]+$ ]] || MAX_DRAIN_SECONDS=900
POLL_SECONDS=5
QUIET_POLLS=3
DEFER_ALERT_SECONDS=21600   # an update pending longer than 6 h is reported as overdue

mkdir -p "$STATE_DIR" 2>/dev/null || { echo "worker-autoupdate: cannot create $STATE_DIR" >&2; exit 1; }
exec 9>"$STATE_DIR/run.lock"
if ! flock -n 9; then echo "worker-autoupdate: another run is in progress; exiting."; exit 0; fi

now_iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }
now_s() { date +%s; }
journal() { printf '%s %s\n' "$(now_iso)" "$*"; logger -t worker-autoupdate -- "$*" 2>/dev/null || true; }

env_value() {
  local key="$1" default="${2:-}" line value=""
  if [[ -f "$ENV_FILE" ]]; then
    while IFS= read -r line || [[ -n "$line" ]]; do
      [[ "$line" == "$key="* ]] && value="${line#*=}"
    done < "$ENV_FILE"
  fi
  value="${value%$'\r'}"
  if [[ -n "$value" ]]; then printf '%s' "$value"; else printf '%s' "$default"; fi
}

DATA_DIR="$(env_value PC_WORKER_DATA "$HOME_DIR/data")"
PAUSE_FILE="$DATA_DIR/.owner-pause"
API_PORT="$(env_value PC_WORKER_API_PORT 47300)"
GIT_PORT="$(env_value PC_WORKER_GIT_PORT 47301)"

# Atomic JSON status write (python3 for safe quoting; values are ours, never secrets).
write_status() {
  local state="$1" detail="$2" worker_build="$3" paired_build="$4" pending_since="$5" extra="${6:-}"
  STATE="$state" DETAIL="$detail" WB="$worker_build" PB="$paired_build" PS="$pending_since" EXTRA="$extra" \
  STATUS_FILE="$STATUS_FILE" python3 - <<'PYEOF'
import json, os, tempfile
from datetime import datetime, timezone
s = {
  "service": "robinson-git-worker-autoupdate",
  "state": os.environ["STATE"],
  "detail": os.environ["DETAIL"],
  "worker_build": os.environ["WB"] or None,
  "paired_build": os.environ["PB"] or None,
  "current": bool(os.environ["WB"]) and os.environ["WB"] == os.environ["PB"],
  "pending_since": os.environ["PS"] or None,
  "checked_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
}
extra = os.environ.get("EXTRA") or ""
if extra:
    try: s.update(json.loads(extra))
    except Exception: pass
fd, tmp = tempfile.mkstemp(dir=os.path.dirname(os.environ["STATUS_FILE"]), prefix=".status-", suffix=".tmp")
with os.fdopen(fd, "w") as f: json.dump(s, f, indent=2); f.write("\n")
os.replace(tmp, os.environ["STATUS_FILE"])
PYEOF
}

receipt() {
  local result="$1" from="$2" to="$3" pause_seconds="$4" note="$5"
  RESULT="$result" FROM="$from" TO="$to" PAUSE_SECONDS="$pause_seconds" NOTE="$note" \
  RECEIPTS_FILE="$RECEIPTS_FILE" python3 - <<'PYEOF'
import json, os
from datetime import datetime, timezone
r = {
  "at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
  "result": os.environ["RESULT"],
  "from_build": os.environ["FROM"] or None,
  "to_build": os.environ["TO"] or None,
  "admission_paused_seconds": int(os.environ["PAUSE_SECONDS"] or 0),
  "note": os.environ["NOTE"],
}
path = os.environ["RECEIPTS_FILE"]
# One object per line even if someone appended a line without its newline.
lead = ""
try:
  with open(path, "rb") as f:
    f.seek(0, 2)
    if f.tell() > 0:
      f.seek(-1, 2)
      lead = "" if f.read(1) == b"\n" else "\n"
except FileNotFoundError:
  pass
with open(path, "a") as f: f.write(lead + json.dumps(r) + "\n")
PYEOF
}

pending_since_for() {  # first time this target was seen pending (kept in a small stamp file)
  local target="$1" stamp="$STATE_DIR/pending-$target"
  if [[ -f "$stamp" ]]; then cat "$stamp"; else now_iso | tee "$stamp"; fi
}
clear_pending() { rm -f "$STATE_DIR"/pending-* 2>/dev/null || true; }

pause_owned=0
pause_started=0
finished=0
cleanup_on_exit() {
  # If we die holding our own admission pause (and the run did not finish deliberately),
  # reopen admission rather than leave git service paused behind us.
  if [[ "$finished" != "1" && "$pause_owned" == "1" ]]; then
    if [[ -f "$PAUSE_FILE" ]] && grep -q "$PAUSE_MARKER" "$PAUSE_FILE" 2>/dev/null; then
      rm -f "$PAUSE_FILE"
      journal "ABORTED mid-run: removed our admission pause to leave the worker usable; see status."
    fi
    write_status "attention" "updater run aborted before completion; admission reopened" "$(current_build)" "" "" || true
    receipt "aborted" "" "" 0 "run ended before completion; admission reopened" || true
  fi
}
trap cleanup_on_exit EXIT

current_build() { env_value SOURCE_COMMIT ""; }
container_state() {
  docker inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' robinson-git-native-git-1 2>/dev/null || echo "absent"
}
local_health_ok() {
  curl -fsS --max-time 3 "http://127.0.0.1:${API_PORT}/health" >/dev/null 2>&1 \
    && curl -fsS --max-time 3 "http://127.0.0.1:${GIT_PORT}/health" >/dev/null 2>&1
}
public_health_ok() {
  # AUTOUPDATE-GATE-2 (2026-11-11): the WSL host often cannot reach its own Funnel name (MagicDNS
  # answers with the PC's own tailnet address, which refuses the device itself: the hairpin class),
  # and the worker container is host-networked, so probing "from inside the container" is the same
  # vantage. Try, in order: the Funnel origin as the host resolves it; the same origin resolved by a
  # public DNS-over-HTTPS resolver (the address the internet uses, not the tailnet one); and the
  # canonical origins the MCP server calls (PC_WORKER_CANONICAL_ORIGINS, Cloudflare-fronted).
  local origin; origin="$(env_value PC_WORKER_PUBLIC_ORIGIN "")"
  local canonical; canonical="$(env_value PC_WORKER_CANONICAL_ORIGINS "https://gitworker.robinsonaisystems.com")"
  if [[ -n "$origin" ]]; then
    curl -fsS --max-time 10 "$origin/health" >/dev/null 2>&1 && return 0
    curl -fsS --max-time 10 --doh-url https://1.1.1.1/dns-query "$origin/health" >/dev/null 2>&1 && return 0
  fi
  local c
  for c in $canonical; do
    curl -fsS --max-time 10 "${c%/}/health" >/dev/null 2>&1 && return 0
  done
  return 1
}
key_pin_ok() {
  # The signing relationship: the control public key pinned in .env must equal the key the MCP
  # serves today (install.sh re-fetches it on every update; this proves the pin is not stale).
  local origin pinned served
  origin="$(env_value MCP_ORIGIN "")"; pinned="$(env_value NATIVE_GIT_CONTROL_PUBLIC_KEY "")"
  [[ -n "$origin" && -n "$pinned" ]] || return 1
  served="$(curl -fsS --proto =https --max-redirs 0 --max-time 15 "$origin/api/native-git-key" 2>/dev/null \
    | python3 -c 'import json,sys
try: print(json.load(sys.stdin).get("public_key",""))
except Exception: print("")' || true)"
  [[ -n "$served" && "$served" == "$pinned" ]]
}
http_version_ok() {
  # Worker env preservation: the container must carry the .env GitHub HTTP version (default HTTP/1.1).
  local want have
  want="$(env_value NATIVE_GIT_GITHUB_HTTP_VERSION "HTTP/1.1")"
  have="$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' robinson-git-native-git-1 2>/dev/null \
    | sed -n 's/^NATIVE_GIT_GITHUB_HTTP_VERSION=//p' | head -n 1)"
  [[ "$have" == "$want" ]]
}
# AUTOUPDATE-GATE-2: start the built image if the install script left the previous container running
# (an install.sh older than AUTOUPDATE-GATE-1 never starts under the updater's own pause; which
# install.sh runs is the one already in src/, so the first update after a kit refresh hit this).
ensure_running() {  # ensure_running <sha>
  local want="$1" i
  [[ "$(running_build)" == "$want" ]] && return 0
  journal "install left build $(running_build) running; starting $want under the updater's pause"
  docker compose --project-name robinson-git --env-file "$ENV_FILE" -f "$HOME_DIR/src/deploy/pc/compose.yaml" \
    up -d --no-build native-git >/dev/null 2>&1 || return 1
  for i in $(seq 1 45); do [[ "$(running_build)" == "$want" ]] && local_health_ok && return 0; sleep 2; done
  return 1
}
running_build() {
  docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$WORKER_CONTAINER" 2>/dev/null \
    | sed -n 's/^NATIVE_GIT_BUILD_COMMIT=//p' | head -n 1
}
locks_present() { compgen -G "$DATA_DIR/git_*/mutation.lock" >/dev/null 2>&1; }
conns_present() { ss -Htn state established "( sport = :${API_PORT} or sport = :${GIT_PORT} )" 2>/dev/null | grep -q .; }
drained() { ! locks_present && ! conns_present; }

verify_build() {  # verify_build <expected sha>; all gates must pass
  local want="$1" i
  [[ "$(current_build)" == "$want" ]] || { journal "verify: SOURCE_COMMIT is $(current_build), expected $want"; return 1; }
  # AUTOUPDATE-GATE-1: the RUNNING container must be the new build, not just the .env record.
  local running; running="$(running_build)"
  [[ "$running" == "$want" ]] || { journal "verify: the running container is build ${running:-unknown}, expected $want"; return 1; }
  for i in $(seq 1 30); do [[ "$(container_state)" == "running healthy" ]] && break; sleep 2; done
  [[ "$(container_state)" == "running healthy" ]] || { journal "verify: container state is $(container_state)"; return 1; }
  local_health_ok || { journal "verify: local health endpoints do not answer"; return 1; }
  key_pin_ok || { journal "verify: pinned control key does not match the key the MCP serves"; return 1; }
  http_version_ok || { journal "verify: container GitHub HTTP version differs from .env"; return 1; }
  # AUTOUPDATE-GATE-2: the public path is ADVISORY. It depends on Funnel/Cloudflare/DNS, not on the
  # build; a probe that cannot see the public path from this host failed the new build AND the
  # rollback on 2026-11-11 (twice) and closed admission for nothing. Everything the build controls is
  # gated above; reachability from outside is judged by the MCP server's signed check and the pool,
  # which skip an unreachable host.
  PUBLIC_PATH="verified"
  for i in $(seq 1 3); do public_health_ok && return 0; sleep 10; done
  PUBLIC_PATH="unverified from this host"
  journal "verify: WARNING public health did not answer from this host (advisory: a host-vantage limit, not a build gate; the server's signed check and the pool judge outside reachability)"
  return 0
}

main() {
  local current target
  current="$(current_build)"

  if [[ -e "$UPDATER_PAUSE" ]]; then
    journal "skip: updater is paused ($UPDATER_PAUSE exists)"
    write_status "paused" "updater paused by operator file; remove it or run: pc-worker autoupdate resume" "$current" "" ""
    return 0
  fi
  if [[ -e "$RECLAIM_FILE" ]]; then
    journal "skip: the PC is reclaimed by its owner (RECLAIM flag set); the owner's use wins"
    write_status "reclaimed" "PC reclaimed by its owner; updater does nothing" "$current" "" ""
    return 0
  fi
  if [[ -e "$PAUSE_FILE" ]]; then
    journal "skip: the worker is owner-paused; an update never overrides the owner's pause"
    write_status "owner_paused" "worker owner-paused; updater does nothing" "$current" "" ""
    return 0
  fi
  if [[ "$(container_state)" != "running healthy" ]]; then
    journal "skip: worker container is $(container_state), not running healthy; leaving it to the operator"
    write_status "worker_not_running" "worker container is $(container_state)" "$current" "" ""
    return 0
  fi

  if [[ -n "${WORKER_AUTOUPDATE_TARGET_SHA:-}" ]]; then
    target="$WORKER_AUTOUPDATE_TARGET_SHA"
    [[ "$target" =~ ^[0-9a-f]{40}$ ]] || { journal "ERROR: bad target override"; write_status "attention" "bad WORKER_AUTOUPDATE_TARGET_SHA" "$current" "" ""; return 1; }
    journal "target override in effect: $target"
  else
    target="$(timeout 30 git ls-remote "$REPO_URL" "refs/heads/$RELEASE_REF" 2>/dev/null | awk '{print $1}')"
    if [[ ! "$target" =~ ^[0-9a-f]{40}$ ]]; then
      journal "skip: could not read the $RELEASE_REF tip from $REPO_URL (network?); trying again next cycle"
      write_status "check_failed" "could not read the release branch tip" "$current" "" ""
      return 0
    fi
  fi

  if [[ -f "$FAILED_TARGET_FILE" && "$(cat "$FAILED_TARGET_FILE" 2>/dev/null)" == "$target" ]]; then
    journal "skip: $target already failed verification here; holding on $current until $RELEASE_REF moves or an operator removes $FAILED_TARGET_FILE"
    write_status "holding" "$target failed verification earlier; not retried until the release branch moves" "$current" "$target" ""
    return 0
  fi

  if [[ "$target" == "$current" ]]; then
    clear_pending
    write_status "current" "worker build matches the $RELEASE_REF release" "$current" "$target" ""
    return 0
  fi

  # Direction guard: update forwards only. If the release branch was rewound below the worker,
  # a human decided that; journal it and stay put.
  if git -C "$HOME_DIR/src" fetch --quiet origin 2>/dev/null \
     && git -C "$HOME_DIR/src" cat-file -e "$current^{commit}" 2>/dev/null \
     && git -C "$HOME_DIR/src" cat-file -e "$target^{commit}" 2>/dev/null \
     && git -C "$HOME_DIR/src" merge-base --is-ancestor "$target" "$current"; then
    journal "skip: $RELEASE_REF tip $target is BEHIND the worker build $current (branch rewound?); not downgrading"
    write_status "attention" "release branch is behind the worker build; not downgrading" "$current" "$target" ""
    return 0
  fi

  local pending_since; pending_since="$(pending_since_for "$target")"
  local pending_age=$(( $(now_s) - $(date -u -d "$pending_since" +%s 2>/dev/null || now_s) ))
  journal "update available: $current -> $target (pending since $pending_since)"
  write_status "update_pending" "newer release build exists; draining between jobs" "$current" "$target" "$pending_since"

  # --- Close admission with our own marked pause (the worker's own gate; admitted work runs on).
  ( umask 022; printf 'paused %s %s\n' "$(now_iso)" "$PAUSE_MARKER" > "$PAUSE_FILE" ) \
    || { journal "ERROR: could not write the admission pause file $PAUSE_FILE"; write_status "attention" "could not write admission pause" "$current" "$target" "$pending_since"; return 1; }
  pause_owned=1; pause_started=$(now_s)
  journal "admission closed (owner-pause by $PAUSE_MARKER); waiting for admitted work to finish (cap ${MAX_DRAIN_SECONDS}s)"

  # --- Drain: quiet = no mutation locks and no established connections, for QUIET_POLLS in a row.
  local waited=0 quiet=0
  while (( waited < MAX_DRAIN_SECONDS )); do
    if drained; then quiet=$((quiet+1)); else quiet=0; fi
    (( quiet >= QUIET_POLLS )) && break
    sleep "$POLL_SECONDS"; waited=$((waited+POLL_SECONDS))
  done
  if (( quiet < QUIET_POLLS )); then
    rm -f "$PAUSE_FILE"; pause_owned=0; finished=1
    local note="drained cap ${MAX_DRAIN_SECONDS}s reached with work still in flight; update deferred, nothing was stopped"
    (( pending_age > DEFER_ALERT_SECONDS )) && note="$note; PENDING OVER ${DEFER_ALERT_SECONDS}s — overdue"
    journal "DEFERRED: $note"
    receipt "deferred" "$current" "$target" "$(( $(now_s) - pause_started ))" "$note"
    write_status "deferred" "$note" "$current" "$target" "$pending_since"
    return 0
  fi
  journal "drained after ${waited}s; swapping to $target"

  # --- Swap with the existing control (build first, then recreate; .env settings are kept).
  local swap_log="$STATE_DIR/last-update.log"
  # AUTOUPDATE-GATE-2: keep THIS updater. A rollback reinstalls the kit from the previous commit,
  # which would replace the running updater with an older one (on 2026-11-11 that dropped the
  # failed-target hold and the next cycle retried the same target).
  cp -p "$0" "$STATE_DIR/updater.keep" 2>/dev/null || true
  if "$HOME_DIR/pc-worker" update --commit "$target" >"$swap_log" 2>&1; then
    journal "install.sh completed for $target"
    ensure_running "$target" || journal "the new build $target did not come up"
  else
    journal "install.sh FAILED for $target (see $swap_log); rolling back"
  fi

  if verify_build "$target"; then
    rm -f "$PAUSE_FILE" "$FAILED_TARGET_FILE"; pause_owned=0; finished=1; clear_pending
    local paused_total=$(( $(now_s) - pause_started ))
    journal "UPDATED: $current -> $target; admission reopened after ${paused_total}s paused"
    receipt "updated" "$current" "$target" "$paused_total" "health, control-key pin, env and running build verified; public path ${PUBLIC_PATH:-verified}"
    write_status "current" "updated and verified; admission open" "$target" "$target" ""
    return 0
  fi

  # --- Roll back automatically; the previous image is still on disk.
  journal "verification failed on $target; rolling back to $current"
  printf '%s\n' "$target" > "$FAILED_TARGET_FILE" 2>/dev/null || true
  local rb_log="$STATE_DIR/last-rollback.log"
  "$HOME_DIR/pc-worker" update --commit "$current" >"$rb_log" 2>&1 || journal "rollback install also reported failure (see $rb_log)"
  ensure_running "$current" || journal "the previous build $current did not come up"
  if [[ -s "$STATE_DIR/updater.keep" ]]; then
    install -m 755 "$STATE_DIR/updater.keep" "$HOME_DIR/.worker-autoupdate.sh.keep.tmp" \
      && mv "$HOME_DIR/.worker-autoupdate.sh.keep.tmp" "$HOME_DIR/worker-autoupdate.sh" \
      && journal "kept this updater across the rollback (the previous kit's updater was not restored)"
  fi
  if verify_build "$current"; then
    rm -f "$PAUSE_FILE"; pause_owned=0; finished=1
    local paused_total=$(( $(now_s) - pause_started ))
    journal "ROLLED BACK: worker is back on $current and verified; admission reopened. The failed update to $target needs a human look."
    receipt "rolled_back" "$current" "$target" "$paused_total" "new build failed verification; previous build restored and verified"
    write_status "attention" "update to $target failed verification and was rolled back to $current" "$current" "$target" "$pending_since"
    return 0
  fi
  # Rollback did not verify: keep admission closed (new work fails over to the pool's other host)
  # and shout. The pause file is ours; an operator clears it with pc-worker resume after repair.
  finished=1
  journal "CRITICAL: rollback to $current did not verify either. Admission stays closed; git work fails over to the other pool host. Repair, then: pc-worker resume"
  receipt "rollback_failed" "$current" "$target" "$(( $(now_s) - pause_started ))" "CRITICAL: neither build verified; admission left closed for operator repair"
  write_status "attention" "CRITICAL: rollback did not verify; admission left closed for operator repair" "$(current_build)" "$target" "$pending_since"
  return 1
}

main "$@"
exit $?
