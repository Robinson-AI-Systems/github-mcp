#!/usr/bin/env bash
# WORKER-RESOLV-GUARD-1: the PC native Git worker must never run silently with a broken
# resolver (owner order, 2026-11-11, after the failure bit twice in one morning).
#
# The worker is host-networked, so a compose `dns:` pin does not govern it: its resolver is
# the /etc/resolv.conf Docker captured when the container started. When dockerd starts the
# container before WSL has populated the host resolver file, the capture is empty, every
# clone fails — and the loopback-only healthcheck kept reporting healthy. The rack's
# netcare does not cover this worker. This guard is the cover, in the same kit and the
# same shape as the between-jobs updater (WORKER-AUTOUPDATE-1):
#
#   1. Every timer cycle (2 min, and shortly after boot) it probes the worker's resolver
#      FROM INSIDE the worker container, timed: github.com and api.github.com must each
#      resolve within WORKER_RESOLV_GUARD_PROBE_TIMEOUT_MS (default 2500 ms — the same
#      names and timeout as the worker's own egress report in capabilities), and the
#      container's resolv.conf must carry a nameserver. An untimed answer is not a pass.
#   2. Healthy: the status file says so (with the probe time) and any pause this guard
#      owns is removed. Nothing else happens.
#   3. Poisoned: it first checks the HOST's own resolver file — while that is still empty
#      (the boot race itself), restarting the worker cannot help, so the cycle defers and
#      the next one retries. Otherwise it closes admission with the worker's own
#      owner-pause gate (marked worker-resolv-guard; the owner's and the updater's
#      pauses are never touched), waits for admitted work to finish — the updater's own
#      drain rule: no mutation.lock files and no established connections to the worker
#      ports, held for a short quiet window, capped at WORKER_RESOLV_GUARD_MAX_DRAIN_SECONDS
#      (default 900, the longest single operation the worker allows). Past the cap it
#      defers; a running job is never killed for a repair.
#   4. Drained: restart the worker through the kit's compose control (the route that
#      healed it by hand on 2026-11-11), wait for the local health endpoints, then
#      re-probe. Still poisoned: recreate the container once, wait, re-probe. Still
#      poisoned: stop healing, keep admission closed (new work fails over to the pool's
#      other host), set the state to attention and journal it loudly — an operator
#      repairs, then runs pc-worker resume. Healing is attempted at most
#      WORKER_RESOLV_GUARD_MAX_HEAL_ATTEMPTS times (default 3) for one poisoning.
#   5. Every detection, deferral and heal writes a receipt (JSON lines) and every cycle
#      refreshes a status file, so "can the worker resolve?" is one read:
#      pc-worker resolv-guard status.
#
# It does nothing while: the guard's own pause file exists (.resolv-guard-pause), the
# PC's RECLAIM flag is set (the owner's own use wins, always), the worker is
# owner-paused, an autoupdate run holds its lock or its admission pause, or another
# guard run holds the lock. It never touches any other container or service.
#
# Operator overrides (used by tests and repairs; leave unset in normal operation):
#   WORKER_RESOLV_GUARD_MAX_DRAIN_SECONDS   drain cap override
#   WORKER_RESOLV_GUARD_PROBE_TIMEOUT_MS    per-name probe timeout override
#   WORKER_RESOLV_GUARD_MAX_HEAL_ATTEMPTS   heal attempts per poisoning override
#   PC_WORKER_HOME                          worker home (default /srv/robinson-git)
set -uo pipefail

HOME_DIR="${PC_WORKER_HOME:-/srv/robinson-git}"
ENV_FILE="$HOME_DIR/.env"
STATE_DIR="$HOME_DIR/resolv-guard"
STATUS_FILE="$STATE_DIR/status.json"
RECEIPTS_FILE="$STATE_DIR/receipts.jsonl"
GUARD_PAUSE="$HOME_DIR/.resolv-guard-pause"
AUTOUPDATE_LOCK="$HOME_DIR/autoupdate/run.lock"
RECLAIM_FILE="${WORKER_RESOLV_GUARD_RECLAIM_FILE:-/mnt/c/VivienneHome/RECLAIM}"
PAUSE_MARKER="worker-resolv-guard"
UPDATER_MARKER="worker-autoupdate"
CONTAINER="robinson-git-native-git-1"
MAX_DRAIN_SECONDS="${WORKER_RESOLV_GUARD_MAX_DRAIN_SECONDS:-900}"
[[ "$MAX_DRAIN_SECONDS" =~ ^[0-9]+$ ]] || MAX_DRAIN_SECONDS=900
PROBE_TIMEOUT_MS="${WORKER_RESOLV_GUARD_PROBE_TIMEOUT_MS:-2500}"
[[ "$PROBE_TIMEOUT_MS" =~ ^[0-9]+$ ]] || PROBE_TIMEOUT_MS=2500
MAX_HEAL_ATTEMPTS="${WORKER_RESOLV_GUARD_MAX_HEAL_ATTEMPTS:-3}"
[[ "$MAX_HEAL_ATTEMPTS" =~ ^[0-9]+$ ]] || MAX_HEAL_ATTEMPTS=3
POLL_SECONDS=5
QUIET_POLLS=3
OVERDUE_SECONDS=21600   # a poisoning unhealed longer than 6 h is reported as overdue

mkdir -p "$STATE_DIR" 2>/dev/null || { echo "worker-resolv-guard: cannot create $STATE_DIR" >&2; exit 1; }
exec 9>"$STATE_DIR/run.lock"
if ! flock -n 9; then echo "worker-resolv-guard: another run is in progress; exiting."; exit 0; fi

now_iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }
now_s() { date +%s; }
journal() { printf '%s %s\n' "$(now_iso)" "$*"; logger -t worker-resolv-guard -- "$*" 2>/dev/null || true; }

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
  local state="$1" detail="$2" resolver="$3" probe_ms="$4" poisoned_since="$5"
  STATE="$state" DETAIL="$detail" RESOLVER="$resolver" PROBE_MS="$probe_ms" PS="$poisoned_since" \
  STATUS_FILE="$STATUS_FILE" python3 - <<'PYEOF'
import json, os, tempfile
from datetime import datetime, timezone
s = {
  "service": "robinson-git-worker-resolv-guard",
  "state": os.environ["STATE"],
  "detail": os.environ["DETAIL"],
  "resolver": os.environ["RESOLVER"] or None,
  "probe_ms": int(os.environ["PROBE_MS"]) if os.environ["PROBE_MS"].isdigit() else None,
  "poisoned_since": os.environ["PS"] or None,
  "checked_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
}
fd, tmp = tempfile.mkstemp(dir=os.path.dirname(os.environ["STATUS_FILE"]), prefix=".status-", suffix=".tmp")
with os.fdopen(fd, "w") as f: json.dump(s, f, indent=2); f.write("\n")
os.replace(tmp, os.environ["STATUS_FILE"])
PYEOF
}

receipt() {
  local result="$1" action="$2" note="$3"
  RESULT="$result" ACTION="$action" NOTE="$note" \
  RECEIPTS_FILE="$RECEIPTS_FILE" python3 - <<'PYEOF'
import json, os
from datetime import datetime, timezone
r = {
  "at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
  "result": os.environ["RESULT"],
  "action": os.environ["ACTION"] or None,
  "note": os.environ["NOTE"],
}
with open(os.environ["RECEIPTS_FILE"], "a") as f: f.write(json.dumps(r) + "\n")
PYEOF
}

# A receipt for the same outcome as last time is written once (the stamp file remembers);
# heal outcomes always write. Keeps a 2-minute cycle from filling the journal with copies.
last_note=""
receipt_once() {
  local stamp="$STATE_DIR/last-receipt"
  local key="$1|$2"
  local prev=""; [[ -f "$stamp" ]] && prev="$(cat "$stamp")"
  if [[ "$prev" != "$key" ]]; then receipt "$1" "$2" "$3"; printf '%s' "$key" > "$stamp"; fi
  last_note="$3"
}
clear_receipt_stamp() { rm -f "$STATE_DIR/last-receipt" 2>/dev/null || true; }

poisoned_since_for() {  # first time this poisoning was seen (kept in a small stamp file)
  local stamp="$STATE_DIR/poisoned-since"
  if [[ -f "$stamp" ]]; then cat "$stamp"; else now_iso | tee "$stamp"; fi
}
heal_attempts() { local f="$STATE_DIR/heal-attempts"; if [[ -f "$f" ]]; then cat "$f"; else echo 0; fi }
note_heal_attempt() { local n=$(( $(heal_attempts) + 1 )); printf '%s' "$n" > "$STATE_DIR/heal-attempts"; echo "$n"; }
clear_poisoning() { rm -f "$STATE_DIR/poisoned-since" "$STATE_DIR/heal-attempts" 2>/dev/null || true; clear_receipt_stamp; }

# PC-WORKER-2: a WSL Docker config that names Docker Desktop's credential store fails from
# SSH or service sessions. Use an empty config (anonymous pulls of public images) then.
docker_config_check() {
  local cfg="${DOCKER_CONFIG:-${HOME:-/root}/.docker}/config.json" store
  [[ -f "$cfg" ]] || return 0
  store="$(python3 -c 'import json,sys
try: print(json.load(open(sys.argv[1])).get("credsStore",""))
except Exception: print("")' "$cfg" 2>/dev/null)"
  if [[ -n "$store" ]] && ! command -v "docker-credential-$store" >/dev/null 2>&1; then
    DOCKER_CONFIG="$(mktemp -d)"; printf '{}\n' > "$DOCKER_CONFIG/config.json"; export DOCKER_CONFIG
  fi
}
compose() {
  docker_config_check
  docker compose --project-name robinson-git --env-file "$ENV_FILE" -f "$HOME_DIR/src/deploy/pc/compose.yaml" "$@"
}

container_state() {
  docker inspect -f '{{.State.Status}}' "$CONTAINER" 2>/dev/null || echo "absent"
}
local_health_ok() {
  curl -fsS --max-time 3 "http://127.0.0.1:${API_PORT}/health" >/dev/null 2>&1 \
    && curl -fsS --max-time 3 "http://127.0.0.1:${GIT_PORT}/health" >/dev/null 2>&1
}
wait_local_health() {  # up to ~60 s for both local health endpoints after a (re)start
  local i
  for i in $(seq 1 30); do local_health_ok && return 0; sleep 2; done
  return 1
}
host_resolver_ready() { grep -q '^nameserver' /etc/resolv.conf 2>/dev/null; }

# The probe, run INSIDE the worker container (its own network, its own captured
# resolv.conf): the container must carry a nameserver and both names the worker exists
# to reach must resolve inside the per-name timeout. Prints one JSON line:
# {"nameserver":bool,"ok":bool,"ms":int,"names":{...}}. Same names and timeout as the
# worker's own egress report (workers/native-git/egress.js); keep the two in step.
PROBE_JS='
const fs = require("node:fs");
const dns = require("node:dns/promises");
const NAMES = ["github.com", "api.github.com"];
const TIMEOUT = Number(process.env.WRG_PROBE_TIMEOUT_MS || 2500);
const timed = async (n) => { const s = Date.now(); let t; const limit = new Promise((_, rej) => { t = setTimeout(() => rej(new Error("timeout")), TIMEOUT); });
  try { const a = await Promise.race([dns.resolve4(n), limit]); return { ok: Array.isArray(a) && a.length > 0, ms: Date.now() - s }; }
  catch { return { ok: false, ms: Date.now() - s }; } finally { clearTimeout(t); } };
(async () => {
  let ns = false; try { ns = /^nameserver\s+\S+/m.test(fs.readFileSync("/etc/resolv.conf", "utf8")); } catch {}
  const start = Date.now();
  const rs = await Promise.all(NAMES.map(async (n) => [n, await timed(n)]));
  const names = Object.fromEntries(rs.map(([n, r]) => [n, r.ok ? "ok" : "down"]));
  const ok = ns && rs.every(([, r]) => r.ok);
  process.stdout.write(JSON.stringify({ nameserver: ns, ok, ms: Date.now() - start, names }) + "\n");
})();
'
PROBE_RESULT=""
PROBE_MS=""
probe_resolver() {  # 0 = healthy, 1 = poisoned, 2 = the probe itself could not run
  local out
  out="$(timeout 20 docker exec -e "WRG_PROBE_TIMEOUT_MS=$PROBE_TIMEOUT_MS" "$CONTAINER" node -e "$PROBE_JS" 2>/dev/null)" || return 2
  [[ "$out" == \{* ]] || return 2
  PROBE_RESULT="$out"
  PROBE_MS="$(printf '%s' "$out" | python3 -c 'import json,sys
try: print(json.load(sys.stdin).get("ms",""))
except Exception: print("")' 2>/dev/null)"
  if printf '%s' "$out" | grep -q '"ok":true'; then return 0; fi
  return 1
}

locks_present() { compgen -G "$DATA_DIR/git_*/mutation.lock" >/dev/null 2>&1; }
conns_present() { ss -Htn state established "( sport = :${API_PORT} or sport = :${GIT_PORT} )" 2>/dev/null | grep -q .; }
drained() { ! locks_present && ! conns_present; }

pause_owned=0
finished=0
cleanup_on_exit() {
  # If we die holding our own admission pause (and the run did not finish deliberately),
  # reopen admission rather than leave git service paused behind us.
  if [[ "$finished" != "1" && "$pause_owned" == "1" ]]; then
    if [[ -f "$PAUSE_FILE" ]] && grep -q "$PAUSE_MARKER" "$PAUSE_FILE" 2>/dev/null; then
      rm -f "$PAUSE_FILE"
      journal "ABORTED mid-run: removed our admission pause to leave the worker usable; see status."
    fi
    write_status "attention" "guard run aborted before completion; admission reopened" "" "" "" || true
    receipt "aborted" "" "run ended before completion; admission reopened" || true
  fi
}
trap cleanup_on_exit EXIT

autoupdate_busy() {
  # The updater mid-swap recreates the worker itself; never race it.
  if [[ -f "$AUTOUPDATE_LOCK" ]]; then exec 8<"$AUTOUPDATE_LOCK"; if ! flock -n 8; then return 0; fi; exec 8<&-; fi
  if [[ -f "$PAUSE_FILE" ]] && grep -q "$UPDATER_MARKER" "$PAUSE_FILE" 2>/dev/null; then return 0; fi
  return 1
}

main() {
  if [[ -e "$GUARD_PAUSE" ]]; then
    journal "skip: the resolver guard is paused ($GUARD_PAUSE exists)"
    write_status "paused" "guard paused by operator file; remove it or run: pc-worker resolv-guard resume" "" "" ""
    return 0
  fi
  if [[ -e "$RECLAIM_FILE" ]]; then
    journal "skip: the PC is reclaimed by its owner (RECLAIM flag set); the owner's use wins"
    write_status "reclaimed" "PC reclaimed by its owner; guard does nothing" "" "" ""
    return 0
  fi
  if [[ -e "$PAUSE_FILE" ]] && ! grep -q "$PAUSE_MARKER" "$PAUSE_FILE" 2>/dev/null; then
    if grep -q "$UPDATER_MARKER" "$PAUSE_FILE" 2>/dev/null; then
      journal "skip: the auto-updater holds admission (its swap owns the worker this cycle)"
      write_status "deferred" "auto-updater holds admission; guard defers this cycle" "" "" ""
    else
      journal "skip: the worker is owner-paused; a repair never overrides the owner's pause"
      write_status "owner_paused" "worker owner-paused; guard does nothing" "" "" ""
    fi
    return 0
  fi
  if autoupdate_busy; then
    journal "skip: an autoupdate run is in progress; guard defers this cycle"
    write_status "deferred" "autoupdate run in progress; guard defers this cycle" "" "" ""
    return 0
  fi
  if [[ "$(container_state)" != "running" ]]; then
    journal "skip: worker container is $(container_state), not running; leaving it to the operator"
    write_status "worker_not_running" "worker container is $(container_state)" "" "" ""
    return 0
  fi

  # --- Probe: the verdict everything else hangs on.
  local probe_rc=0
  probe_resolver || probe_rc=$?
  if [[ "$probe_rc" == "2" ]]; then
    journal "probe could not run inside the worker container (docker exec failed); retrying next cycle"
    write_status "check_failed" "the in-container resolver probe could not run; retrying next cycle" "" "" ""
    return 0
  fi
  if [[ "$probe_rc" == "0" ]]; then
    # Healthy. If a poisoning was being tracked, close it out loudly once.
    if [[ -f "$STATE_DIR/poisoned-since" ]]; then
      journal "RESOLVER HEALTHY again (probe ${PROBE_MS} ms); the poisoning is over"
      receipt "recovered" "" "resolver probe passes again (${PROBE_MS} ms)"
      clear_poisoning
    fi
    if [[ "$pause_owned" == "0" && -f "$PAUSE_FILE" ]] && grep -q "$PAUSE_MARKER" "$PAUSE_FILE" 2>/dev/null; then
      rm -f "$PAUSE_FILE"; journal "removed our leftover admission pause (the worker is healthy)"
    fi
    write_status "ok" "worker resolver resolves github.com and api.github.com inside the probe timeout" "ok" "$PROBE_MS" ""
    return 0
  fi

  # --- Poisoned. Record when this poisoning began, then work the repair ladder.
  local poisoned_since; poisoned_since="$(poisoned_since_for)"
  local pending_age=$(( $(now_s) - $(date -u -d "$poisoned_since" +%s 2>/dev/null || now_s) ))
  journal "POISONED: the worker's resolver fails its timed probe ($PROBE_RESULT)"
  receipt_once "detected" "" "worker resolver fails its timed in-container probe; first seen $poisoned_since"
  write_status "poisoned" "worker resolver fails its timed probe; repair ladder running" "down" "$PROBE_MS" "$poisoned_since"

  if ! host_resolver_ready; then
    # The boot race itself: WSL has not populated the host resolver file yet, so the
    # worker would capture the same empty file again. Wait for the next cycle.
    local note="the host resolver file has no nameserver yet (boot race); restarting the worker cannot help yet"
    (( pending_age > OVERDUE_SECONDS )) && note="$note; POISONED OVER ${OVERDUE_SECONDS}s — overdue"
    journal "DEFERRED: $note"
    receipt_once "deferred" "" "$note"
    write_status "deferred" "$note" "down" "$PROBE_MS" "$poisoned_since"
    return 0
  fi

  local attempts; attempts="$(heal_attempts)"
  if (( attempts >= MAX_HEAL_ATTEMPTS )); then
    journal "ATTENTION: healing was already attempted $attempts times for this poisoning; leaving it to the operator (pc-worker resolv-guard status)"
    write_status "attention" "resolver still poisoned after $attempts heal attempts; operator repair needed, then pc-worker resume" "down" "$PROBE_MS" "$poisoned_since"
    return 0
  fi

  # --- Close admission with our own marked pause; admitted work runs on.
  if [[ ! -e "$PAUSE_FILE" ]]; then
    ( umask 022; printf 'paused %s %s\n' "$(now_iso)" "$PAUSE_MARKER" > "$PAUSE_FILE" ) \
      || { journal "ERROR: could not write the admission pause file $PAUSE_FILE"; write_status "attention" "could not write admission pause" "down" "$PROBE_MS" "$poisoned_since"; return 1; }
  fi
  pause_owned=1
  journal "admission closed (owner-pause by $PAUSE_MARKER); waiting for admitted work to finish (cap ${MAX_DRAIN_SECONDS}s)"

  # --- Drain: the updater's own rule — quiet = no mutation locks and no established
  # connections to the worker ports, for QUIET_POLLS polls in a row.
  local waited=0 quiet=0
  while (( waited < MAX_DRAIN_SECONDS )); do
    if drained; then quiet=$((quiet+1)); else quiet=0; fi
    (( quiet >= QUIET_POLLS )) && break
    sleep "$POLL_SECONDS"; waited=$((waited+POLL_SECONDS))
  done
  if (( quiet < QUIET_POLLS )); then
    rm -f "$PAUSE_FILE"; pause_owned=0; finished=1
    local note="drain cap ${MAX_DRAIN_SECONDS}s reached with work still in flight; repair deferred, nothing was stopped"
    (( pending_age > OVERDUE_SECONDS )) && note="$note; POISONED OVER ${OVERDUE_SECONDS}s — overdue"
    journal "DEFERRED: $note"
    receipt_once "deferred" "" "$note"
    write_status "deferred" "$note" "down" "$PROBE_MS" "$poisoned_since"
    return 0
  fi
  journal "drained after ${waited}s; healing (attempt $((attempts+1)) of $MAX_HEAL_ATTEMPTS)"
  note_heal_attempt >/dev/null

  # --- Heal step 1: restart (the route that healed it by hand on 2026-11-11).
  compose restart native-git >/dev/null 2>&1 || journal "compose restart reported an error; checking the worker anyway"
  if wait_local_health; then
    probe_rc=0; probe_resolver || probe_rc=$?
    if [[ "$probe_rc" == "0" ]]; then
      rm -f "$PAUSE_FILE"; pause_owned=0; finished=1
      journal "HEALED by restart: the worker resolves again (probe ${PROBE_MS} ms); admission reopened"
      receipt "healed_restart" "restart" "resolver probe passes after a container restart (${PROBE_MS} ms); admission reopened"
      clear_poisoning
      write_status "ok" "resolver healed by a worker restart; admission open" "ok" "$PROBE_MS" ""
      return 0
    fi
  fi
  journal "restart did not heal the resolver; escalating to a recreate"

  # --- Heal step 2: recreate the container once (a fresh resolv.conf capture).
  compose up -d --no-build --force-recreate native-git >/dev/null 2>&1 || journal "compose recreate reported an error; checking the worker anyway"
  if wait_local_health; then
    probe_rc=0; probe_resolver || probe_rc=$?
    if [[ "$probe_rc" == "0" ]]; then
      rm -f "$PAUSE_FILE"; pause_owned=0; finished=1
      journal "HEALED by recreate: the worker resolves again (probe ${PROBE_MS} ms); admission reopened"
      receipt "healed_recreate" "recreate" "resolver probe passes after a container recreate (${PROBE_MS} ms); admission reopened"
      clear_poisoning
      write_status "ok" "resolver healed by a worker recreate; admission open" "ok" "$PROBE_MS" ""
      return 0
    fi
  fi

  # --- Still poisoned: stop healing, keep admission closed (new work fails over to the
  # pool's other host) and shout. The pause file is ours; an operator clears it with
  # pc-worker resume after repair.
  finished=1
  journal "CRITICAL: the worker's resolver is still poisoned after restart and recreate. Admission stays closed; git work fails over to the other pool host. The guard retries on later cycles up to $MAX_HEAL_ATTEMPTS attempts, then leaves it to the operator: repair, then pc-worker resume"
  receipt "heal_failed" "" "CRITICAL: resolver still poisoned after restart and recreate; admission left closed; guard retries up to the attempt cap"
  write_status "attention" "CRITICAL: resolver still poisoned after restart and recreate; admission left closed for operator repair" "down" "$PROBE_MS" "$poisoned_since"
  return 1
}

main "$@"
exit $?
