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
UPDATER_PAUSE="$HOME_DIR/.autoupdate-pause"
RECLAIM_FILE="${WORKER_AUTOUPDATE_RECLAIM_FILE:-/mnt/c/VivienneHome/RECLAIM}"
PAUSE_MARKER="worker-autoupdate"
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
with open(os.environ["RECEIPTS_FILE"], "a") as f: f.write(json.dumps(r) + "\n")
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
ensure_started() {
  # install.sh builds the new image but, while our admission pause is up, deliberately does
  # NOT start it (its step 6: "the worker is paused by its owner; the new image is built but
  # not started"). The swap therefore has to start the container itself once the build is in
  # place, with the pause still held so no work is admitted mid-verify. Found live 2026-11-11:
  # without this, verify chased a container that was never recreated and the public-health
  # gate was blamed for it.
  local want="$1" cur="" i
  cur="$(docker inspect -f '{{.Config.Image}}' robinson-git-native-git-1 2>/dev/null || true)"
  if [[ "$cur" == "robinson-git-native:$want" && "$(container_state)" == running* ]]; then return 0; fi
  ( cd "$HOME_DIR/src" && docker compose --project-name robinson-git --env-file "$ENV_FILE" \
      -f deploy/pc/compose.yaml up -d --no-build native-git ) >/dev/null 2>&1 || return 1
  for i in $(seq 1 15); do
    cur="$(docker inspect -f '{{.Config.Image}}' robinson-git-native-git-1 2>/dev/null || true)"
    [[ "$cur" == "robinson-git-native:$want" ]] && return 0
    sleep 2
  done
  return 1
}

public_health_ok() {
  local origin; origin="$(env_value PC_WORKER_PUBLIC_ORIGIN "")"
  [[ -n "$origin" ]] || return 1
  curl -fsS --max-time 10 "$origin/health" >/dev/null 2>&1 && return 0
  # WSL cannot always reach this host's own Funnel name (mirrored networking refuses the
  # loopback to its own public name instantly, while the name answers fine publicly — found
  # live 2026-11-11: both update attempts failed this gate on a healthy old build). The
  # Windows side of the same machine exercises the same public route; accept its answer.
  local wincurl="/mnt/c/Windows/System32/curl.exe"
  [[ -x "$wincurl" ]] || return 1
  "$wincurl" -fsS --max-time 10 "$origin/health" >/dev/null 2>&1
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
locks_present() { compgen -G "$DATA_DIR/git_*/mutation.lock" >/dev/null 2>&1; }
conns_present() { ss -Htn state established "( sport = :${API_PORT} or sport = :${GIT_PORT} )" 2>/dev/null | grep -q .; }
drained() { ! locks_present && ! conns_present; }

# Builds must never depend on the Docker Desktop integration share (its read-only ISO can go
# unreadable while the Engine stays healthy; found live 2026-11-11, when every plugin binary on
# the share failed with EIO and no image could build). The kit's own Docker config carries its
# own buildx (seeded by preflight_build_env below) and no credential store.
KIT_DOCKER_CONFIG="$STATE_DIR/docker"
seed_plugin() {  # seed_plugin <name> <repo> <version> <asset>
  local name="$1" repo="$2" v="$3" asset="$4" dst base
  dst="$KIT_DOCKER_CONFIG/cli-plugins/$name"
  if [[ ! -x "$dst" ]]; then
    base="https://github.com/$repo/releases/download"
    curl -fsSL --max-time 180 -o "$dst.tmp" "$base/$v/$asset" || return 1
    curl -fsSL --max-time 30 -o "$STATE_DIR/$name.checksums" "$base/$v/checksums.txt" || return 1
    ( cd "$STATE_DIR" && echo "$(grep "$asset\$" "$name.checksums" | awk '{print $1}')  $dst.tmp" | sha256sum -c - >/dev/null ) || return 1
    mv "$dst.tmp" "$dst"
  fi
  chmod 755 "$dst"
}
seed_plugins() {
  # The kit Docker config must be SELF-CONTAINED: install.sh's prerequisite check runs
  # `docker compose version`, and a config carrying buildx alone fails it (found live
  # 2026-11-11, second attempt). Seed both plugins the install path needs, each verified
  # against its release checksums.
  mkdir -p "$KIT_DOCKER_CONFIG/cli-plugins"
  printf '{}\n' > "$KIT_DOCKER_CONFIG/config.json"
  seed_plugin docker-buildx docker/buildx v0.29.1 buildx-v0.29.1.linux-amd64 || return 1
  seed_plugin docker-compose docker/compose v2.40.3 docker-compose-linux-x86_64 || return 1
}
kit_plugins_ok() {
  DOCKER_CONFIG="$KIT_DOCKER_CONFIG" docker buildx version >/dev/null 2>&1 \
    && DOCKER_CONFIG="$KIT_DOCKER_CONFIG" docker compose version >/dev/null 2>&1
}
preflight_build() {
  # A worker image must be buildable BEFORE admission closes; if the build machinery itself is
  # broken, defer loudly and leave git service completely untouched.
  if docker buildx version >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then return 0; fi
  journal "preflight: the ambient docker plugins are not runnable; seeding the kit plugins and retrying"
  seed_plugins || return 1
  kit_plugins_ok || return 1
  export DOCKER_CONFIG="$KIT_DOCKER_CONFIG"
}

verify_build() {  # verify_build <expected sha>; all gates must pass
  local want="$1" i
  [[ "$(current_build)" == "$want" ]] || { journal "verify: SOURCE_COMMIT is $(current_build), expected $want"; return 1; }
  ensure_started "$want" || { journal "verify: container for $want could not be started"; return 1; }
  # The container IMAGE is the ground truth of what is running (capabilities report it too):
  # a receipt may only name a build updated when the live container runs that build.
  [[ "$(docker inspect -f '{{.Config.Image}}' robinson-git-native-git-1 2>/dev/null)" == "robinson-git-native:$want" ]] \
    || { journal "verify: live container image is not $want"; return 1; }
  for i in $(seq 1 30); do [[ "$(container_state)" == "running healthy" ]] && break; sleep 2; done
  [[ "$(container_state)" == "running healthy" ]] || { journal "verify: container state is $(container_state)"; return 1; }
  local_health_ok || { journal "verify: local health endpoints do not answer"; return 1; }
  key_pin_ok || { journal "verify: pinned control key does not match the key the MCP serves"; return 1; }
  http_version_ok || { journal "verify: container GitHub HTTP version differs from .env"; return 1; }
  for i in $(seq 1 5); do public_health_ok && break; sleep 12; done
  public_health_ok || { journal "verify: public Funnel health does not answer"; return 1; }
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

  if ! preflight_build; then
    journal "DEFERRED: the Docker build machinery on this PC is broken (buildx not runnable); update deferred BEFORE closing admission, git service untouched"
    receipt "deferred" "$current" "$target" 0 "build machinery preflight failed (docker buildx not runnable); deferred before admission closed"
    write_status "attention" "docker buildx is not runnable on this PC; update deferred before admission closed" "$current" "$target" "$(pending_since_for "$target")"
    return 0
  fi
  if [[ -n "${DOCKER_CONFIG:-}" ]]; then journal "builds will use the kit Docker config ($DOCKER_CONFIG)"; fi

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
  if "$HOME_DIR/pc-worker" update --commit "$target" >"$swap_log" 2>&1; then
    journal "install.sh completed for $target"
  else
    journal "install.sh FAILED for $target (see $swap_log); rolling back"
  fi

  if verify_build "$target"; then
    rm -f "$PAUSE_FILE"; pause_owned=0; finished=1; clear_pending
    local paused_total=$(( $(now_s) - pause_started ))
    journal "UPDATED: $current -> $target; admission reopened after ${paused_total}s paused"
    receipt "updated" "$current" "$target" "$paused_total" "health, control-key pin, env and public path verified"
    write_status "current" "updated and verified; admission open" "$target" "$target" ""
    return 0
  fi

  # --- Roll back automatically; the previous image is still on disk.
  journal "verification failed on $target; rolling back to $current"
  local rb_log="$STATE_DIR/last-rollback.log"
  "$HOME_DIR/pc-worker" update --commit "$current" >"$rb_log" 2>&1 || journal "rollback install also reported failure (see $rb_log)"
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
