#!/usr/bin/env bash
# PC-WORKER-1: installs or updates the native Git worker on the owner's PC, inside WSL2 Ubuntu with
# Docker Engine. Non-interactive and idempotent: run it again to update, it changes only what differs.
# Runbook and every step explained: docs/PC-WORKER.md.
#
#   bash install.sh --mcp-origin https://<mcp-domain> [--commit <full-sha> | --ref live]
#                   [--control-key ed25519:...] [--public-origin https://<pc>.<tailnet>.ts.net]
#                   [--home /srv/robinson-git] [--configure-funnel]
#
# It never touches other containers, volumes or Tailscale daemons: only the compose project
# "robinson-git", the folder --home, and (with --configure-funnel) three HTTPS handlers on this PC's own
# Windows Tailscale node. It never calls a plain "tailscale" inside WSL.
set -euo pipefail

REPO_URL_DEFAULT="https://github.com/Robinson-AI-Systems/github-mcp.git"
TAILSCALE_DEFAULT="/mnt/c/Program Files/Tailscale/tailscale.exe"
WINDOWS_CURL="/mnt/c/Windows/System32/curl.exe"

step() { printf '\n== %s\n' "$*"; }
ok() { printf '   ok: %s\n' "$*"; }
note() { printf '   note: %s\n' "$*"; }
fail() { printf '   FAILED: %s\n' "$*" >&2; exit 1; }

usage() { sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; }

env_value() {
  local key="$1" line value=""
  [[ -f "$ENV_FILE" ]] || return 0
  while IFS= read -r line || [[ -n "$line" ]]; do [[ "$line" == "$key="* ]] && value="${line#*=}"; done < "$ENV_FILE"
  printf '%s' "${value%$'\r'}"
}
# Sets KEY=value in the .env file (replaces the line, or appends it). Values are never run as code.
set_env() {
  local key="$1" value="$2" tmp
  tmp="$(mktemp "$ENV_FILE.XXXXXX")"
  KEY="$key" VALUE="$value" awk 'BEGIN{k=ENVIRON["KEY"]; v=ENVIRON["VALUE"]; done=0}
    index($0, k "=")==1 { if (!done) { print k "=" v; done=1 } ; next } { print }
    END { if (!done) print k "=" v }' "$ENV_FILE" > "$tmp"
  chmod 600 "$tmp"; mv "$tmp" "$ENV_FILE"
}

# PC-WORKER-2: a WSL Docker config that names Docker Desktop's credential store (credsStore: desktop.exe)
# fails from SSH or service sessions. Use an empty config (anonymous pulls of the public base image) then.
docker_config_check() {
  local cfg="${DOCKER_CONFIG:-${HOME:-/root}/.docker}/config.json" store
  [[ -f "$cfg" ]] || return 0
  store="$(python3 -c 'import json,sys
try: print(json.load(open(sys.argv[1])).get("credsStore",""))
except Exception: print("")' "$cfg")"
  if [[ -n "$store" ]] && ! command -v "docker-credential-$store" >/dev/null 2>&1; then
    DOCKER_CONFIG="$(mktemp -d)"; printf '{}\n' > "$DOCKER_CONFIG/config.json"; export DOCKER_CONFIG
    printf '%s\n' "  note: credential store docker-credential-$store is not usable here; building with a clean Docker config"
  fi
}

compose() {
  docker_config_check
  docker compose --project-name robinson-git --env-file "$ENV_FILE" -f "$SRC/deploy/pc/compose.yaml" "$@"
}

json_field() { # json_field <python expression on d> ; reads JSON on stdin
  python3 -c 'import json,sys
d=json.load(sys.stdin)
try:
  v=eval(sys.argv[1],{"__builtins__":{}},{"d":d})
except Exception:
  v=""
print(v if isinstance(v,str) else "")' "$1"
}

main() {
  local home="/srv/robinson-git" mcp_origin="" control_key="" public_origin="" commit="" ref="live"
  local repo_url="$REPO_URL_DEFAULT" configure_funnel="no" ts=""
  while (( $# )); do
    case "$1" in
      --home) home="$2"; shift 2 ;;
      --mcp-origin) mcp_origin="${2%/}"; shift 2 ;;
      --control-key) control_key="$2"; shift 2 ;;
      --public-origin) public_origin="${2%/}"; shift 2 ;;
      --commit) commit="$2"; shift 2 ;;
      --ref) ref="$2"; shift 2 ;;
      --repo) repo_url="$2"; shift 2 ;;
      --tailscale) ts="$2"; shift 2 ;;
      --configure-funnel) configure_funnel="yes"; shift ;;
      -h|--help) usage; exit 0 ;;
      *) usage; fail "Unknown option: $1" ;;
    esac
  done
  SRC="$home/src"; ENV_FILE="$home/.env"; local data="$home/data"

  step "1/8 Prerequisites"
  [[ "$(id -u)" == "0" ]] || fail "Run as root inside WSL (from Windows: wsl -u root -e bash $0 ...)."
  for tool in git docker curl python3 awk; do command -v "$tool" >/dev/null || fail "$tool is not installed in WSL."; done
  docker info >/dev/null 2>&1 || fail "Docker Engine is not answering inside WSL (docker info failed)."
  docker compose version >/dev/null 2>&1 || fail "The docker compose plugin is missing (apt install docker-compose-plugin)."
  ok "git, docker $(docker version -f '{{.Server.Version}}' 2>/dev/null), $(docker compose version --short 2>/dev/null | sed 's/^/compose /'), curl, python3"
  case "$home" in /mnt/*) fail "--home must be on WSL's own ext4 disk, not under /mnt/ (Windows drives are slow and lose Linux permissions)." ;; esac
  [[ "$home" == /* ]] || fail "--home must be an absolute path."
  if [[ -z "$ts" && -f "$ENV_FILE" ]]; then ts="$(env_value PC_WORKER_TAILSCALE)"; fi
  ts="${ts:-$TAILSCALE_DEFAULT}"
  [[ "$(basename "$ts")" == "tailscale.exe" ]] || fail "Use the Windows tailscale.exe (PC_WORKER_TAILSCALE); a plain tailscale inside WSL may belong to another daemon."
  local ts_ok="no"
  if [[ -x "$ts" ]] && "$ts" status --json >/dev/null 2>&1; then ts_ok="yes"; ok "Windows Tailscale reachable: $ts"
  else note "Windows Tailscale is not reachable at $ts (needed only to find the public address and for --configure-funnel)."; fi

  step "2/8 Folders"
  mkdir -p "$home" "$data"
  chown 1000:1000 "$data"; chmod 700 "$data"
  ok "$home (source in src/, worker data in data/ owned by the container user 1000)"

  step "3/8 Source code"
  if [[ -d "$SRC/.git" ]]; then
    git -C "$SRC" remote set-url origin "$repo_url"
    git -C "$SRC" fetch --prune --quiet origin
    ok "fetched $repo_url"
  else
    git clone --quiet "$repo_url" "$SRC"
    ok "cloned $repo_url"
  fi
  if [[ -n "$commit" ]]; then
    [[ "$commit" =~ ^[0-9a-f]{40}$ ]] || fail "--commit must be a full 40-character commit id."
    git -C "$SRC" cat-file -e "$commit^{commit}" 2>/dev/null || fail "Commit $commit is not in $repo_url."
  else
    commit="$(git -C "$SRC" rev-parse --verify --quiet "origin/$ref^{commit}")" || fail "Branch $ref was not found."
  fi
  git -C "$SRC" -c advice.detachedHead=false checkout --quiet --force --detach "$commit"
  ok "checked out $commit"

  step "4/8 Settings ($ENV_FILE)"
  if [[ ! -f "$ENV_FILE" ]]; then
    install -m 600 "$SRC/deploy/pc/.env.example" "$ENV_FILE"
    ok "created from deploy/pc/.env.example"
  else
    chmod 600 "$ENV_FILE"; ok "kept existing values"
  fi
  [[ -n "$mcp_origin" ]] && set_env MCP_ORIGIN "$mcp_origin"
  mcp_origin="$(env_value MCP_ORIGIN)"
  if [[ -z "$control_key" ]] && [[ "$mcp_origin" =~ ^https://[A-Za-z0-9.-]+$ ]]; then
    control_key="$(curl -fsS --proto =https --max-redirs 0 --max-time 15 "$mcp_origin/api/native-git-key" 2>/dev/null | json_field 'd.get("public_key","")' || true)"
    [[ -n "$control_key" ]] && ok "fetched the public verification key from $mcp_origin/api/native-git-key"
  fi
  [[ -n "$control_key" ]] && set_env NATIVE_GIT_CONTROL_PUBLIC_KEY "$control_key"
  if [[ -z "$public_origin" && "$ts_ok" == "yes" ]]; then
    local dns; dns="$("$ts" status --json 2>/dev/null | json_field 'd["Self"]["DNSName"]' | tr -d '\r')"
    [[ -n "$dns" ]] && public_origin="https://${dns%.}"
  fi
  [[ -n "$public_origin" ]] && set_env PC_WORKER_PUBLIC_ORIGIN "$public_origin"
  set_env SOURCE_COMMIT "$commit"
  set_env PC_WORKER_DATA "$data"
  set_env PC_WORKER_TAILSCALE "$ts"
  local missing=()
  [[ "$(env_value MCP_ORIGIN)" =~ ^https://[A-Za-z0-9.-]+$ ]] || missing+=("MCP_ORIGIN (https://<mcp-domain>, or --mcp-origin)")
  [[ "$(env_value NATIVE_GIT_CONTROL_PUBLIC_KEY)" =~ ^ed25519:[A-Za-z0-9+/=]{40,}$ ]] || missing+=("NATIVE_GIT_CONTROL_PUBLIC_KEY (public; from <mcp>/api/native-git-key, or --control-key)")
  [[ "$(env_value PC_WORKER_PUBLIC_ORIGIN)" =~ ^https://[A-Za-z0-9-]+\.[A-Za-z0-9.-]+\.ts\.net$ ]] || missing+=("PC_WORKER_PUBLIC_ORIGIN (https://<pc>.<tailnet>.ts.net, or --public-origin)")
  if (( ${#missing[@]} )); then
    printf '   missing in %s:\n' "$ENV_FILE"; printf '     - %s\n' "${missing[@]}"
    fail "Fill these in (or pass the options) and run install.sh again."
  fi
  ok "required values present; commit $commit"

  step "5/8 Build the worker image"
  local api_port git_port
  api_port="$(env_value PC_WORKER_API_PORT)"; api_port="${api_port:-47300}"
  git_port="$(env_value PC_WORKER_GIT_PORT)"; git_port="${git_port:-47301}"
  compose config --quiet || fail "The compose file or .env is not valid (see the message above)."
  compose build --quiet native-git || fail "The image did not build."
  ok "image robinson-git-native:$commit"

  step "6/8 Start"
  local running; running="$(compose ps -q native-git 2>/dev/null || true)"
  for port in "$api_port" "$git_port"; do
    if [[ -z "$running" ]] && command -v ss >/dev/null && ss -Hltn "sport = :$port" | grep -q .; then
      fail "Port $port is already in use inside WSL. Pick free ports with PC_WORKER_API_PORT / PC_WORKER_GIT_PORT in $ENV_FILE."
    fi
  done
  # AUTOUPDATE-GATE-1: the self-updater closes admission with its own marked pause and then calls this
  # script; under THAT pause the new image must start (the new container reads the same pause file, so
  # admission stays closed until the updater verifies and reopens it). Only someone else's pause, the
  # owner's, means "do not start".
  if [[ -e "$data/.owner-pause" ]] && ! grep -q "worker-autoupdate" "$data/.owner-pause" 2>/dev/null; then
    note "The worker is paused by its owner; the new image is built but not started. Start it with: $home/pc-worker resume"
  else
    compose up -d --no-build native-git >/dev/null || fail "The container did not start. See: $home/pc-worker logs"
    local healthy="no"
    for _ in $(seq 1 45); do
      if curl -fsS --max-time 3 "http://127.0.0.1:$api_port/health" >/dev/null 2>&1 && curl -fsS --max-time 3 "http://127.0.0.1:$git_port/health" >/dev/null 2>&1; then healthy="yes"; break; fi
      sleep 2
    done
    [[ "$healthy" == "yes" ]] || fail "The worker did not answer on 127.0.0.1:$api_port and :$git_port within 90 s. See: $home/pc-worker logs"
    ok "worker API 127.0.0.1:$api_port/health and direct git 127.0.0.1:$git_port/health answer inside WSL"
    if [[ -x "$WINDOWS_CURL" ]]; then
      if "$WINDOWS_CURL" -fsS --max-time 5 "http://127.0.0.1:$git_port/health" >/dev/null 2>&1 && "$WINDOWS_CURL" -fsS --max-time 5 "http://127.0.0.1:$api_port/health" >/dev/null 2>&1; then
        ok "Windows reaches both ports through WSL localhost forwarding"
      else
        note "Windows could not reach 127.0.0.1:$git_port. Check .wslconfig: localhostForwarding=true (default) or networkingMode=mirrored, then wsl --shutdown. Funnel needs this."
      fi
    else
      note "Windows curl.exe is not reachable from WSL (interop off?); check from PowerShell: curl.exe http://localhost:$git_port/health"
    fi
  fi
  install -m 755 "$SRC/deploy/pc/pc-worker" "$home/pc-worker"
  ok "control script: $home/pc-worker (pause | resume | status | stop | logs)"
  # WORKER-AUTOUPDATE-1: the between-jobs self-updater. Installed only when this source carries
  # it (an older release simply leaves any installed updater untouched); the copy is atomic
  # (temp + rename) because install.sh itself runs under the updater during a swap.
  if [[ -f "$SRC/deploy/pc/worker-autoupdate.sh" ]]; then
    local au_tmp="$home/.worker-autoupdate.sh.tmp"
    install -m 755 "$SRC/deploy/pc/worker-autoupdate.sh" "$au_tmp" && mv "$au_tmp" "$home/worker-autoupdate.sh"
    ok "auto-updater: $home/worker-autoupdate.sh (checks every 10 min, updates between jobs; pc-worker autoupdate status)"
    if command -v systemctl >/dev/null 2>&1 && [[ -d /etc/systemd/system ]]; then
      install -m 644 "$SRC/deploy/pc/worker-autoupdate.service" /etc/systemd/system/worker-autoupdate.service
      install -m 644 "$SRC/deploy/pc/worker-autoupdate.timer" /etc/systemd/system/worker-autoupdate.timer
      systemctl daemon-reload >/dev/null 2>&1 || true
      if systemctl enable --now worker-autoupdate.timer >/dev/null 2>&1; then
        ok "auto-updater timer enabled (worker-autoupdate.timer)"
      else
        note "could not enable worker-autoupdate.timer; enable it with: systemctl enable --now worker-autoupdate.timer"
      fi
    else
      note "systemd not found; the auto-updater script is installed but its timer is not. Run it from any scheduler: $home/worker-autoupdate.sh"
    fi
  fi
  # WORKER-RESOLV-GUARD-1: the resolver guard (timed in-container probe, drain-first heal).
  # Same install discipline as the updater: only when this source carries it, atomic copy.
  if [[ -f "$SRC/deploy/pc/worker-resolv-guard.sh" ]]; then
    local guard_tmp="$home/.worker-resolv-guard.sh.tmp"
    install -m 755 "$SRC/deploy/pc/worker-resolv-guard.sh" "$guard_tmp" && mv "$guard_tmp" "$home/worker-resolv-guard.sh"
    ok "resolver guard: $home/worker-resolv-guard.sh (probes the worker's resolver every 2 min, heals at a job boundary; pc-worker resolv-guard status)"
    if command -v systemctl >/dev/null 2>&1 && [[ -d /etc/systemd/system ]]; then
      install -m 644 "$SRC/deploy/pc/worker-resolv-guard.service" /etc/systemd/system/worker-resolv-guard.service
      install -m 644 "$SRC/deploy/pc/worker-resolv-guard.timer" /etc/systemd/system/worker-resolv-guard.timer
      systemctl daemon-reload >/dev/null 2>&1 || true
      if systemctl enable --now worker-resolv-guard.timer >/dev/null 2>&1; then
        ok "resolver guard timer enabled (worker-resolv-guard.timer)"
      else
        note "could not enable worker-resolv-guard.timer; enable it with: systemctl enable --now worker-resolv-guard.timer"
      fi
    else
      note "systemd not found; the resolver guard script is installed but its timer is not. Run it from any scheduler: $home/worker-resolv-guard.sh"
    fi
  fi

  step "7/8 Tailscale Funnel"
  local origin; origin="$(env_value PC_WORKER_PUBLIC_ORIGIN)"
  if [[ "$configure_funnel" != "yes" ]]; then
    note "Not changed (pass --configure-funnel to set it up). The commands it would run are in docs/PC-WORKER.md."
  else
    [[ "$ts_ok" == "yes" ]] || fail "Windows tailscale.exe is not reachable; Funnel cannot be configured."
    local current host; host="${origin#https://}"
    current="$("$ts" funnel status --json 2>/dev/null | tr -d '\r' || true)"
    [[ -n "$current" ]] || current='{}'
    # Refuse to replace handlers this kit did not create (only "/", "/git" and "/health" on 443 are ours).
    local foreign
    foreign="$(printf '%s' "$current" | API="$api_port" GIT="$git_port" HOST="$host" python3 -c 'import json,os,sys
try: d=json.load(sys.stdin)
except Exception: d={}
ours={"/":"http://127.0.0.1:%s"%os.environ["API"],"/git":"http://127.0.0.1:%s/git"%os.environ["GIT"],"/health":"http://127.0.0.1:%s/health"%os.environ["GIT"]}
bad=[]
for hp,web in (d.get("Web") or {}).items():
  for mount,h in ((web or {}).get("Handlers") or {}).items():
    m=mount.rstrip("/") or "/"
    if hp!=os.environ["HOST"]+":443" or ours.get(m)!=(h or {}).get("Proxy"): bad.append(hp+mount)
for port in (d.get("TCP") or {}):
  if str(port)!="443": bad.append("tcp:"+str(port))
print(" ".join(bad))')"
    [[ -z "$foreign" ]] || fail "This node already serves other things ($foreign). Nothing was changed; remove or move them first (see docs/PC-WORKER.md)."
    "$ts" funnel --bg --yes --https=443 "http://127.0.0.1:$api_port" >/dev/null
    "$ts" funnel --bg --yes --https=443 --set-path=/git "http://127.0.0.1:$git_port/git" >/dev/null
    "$ts" funnel --bg --yes --https=443 --set-path=/health "http://127.0.0.1:$git_port/health" >/dev/null
    ok "443: /git and /health -> 127.0.0.1:$git_port (direct git); everything else -> 127.0.0.1:$api_port (worker API)"
    { "$ts" funnel status 2>/dev/null | tr -d '\r'; echo; } | sed 's/^/     /' || true
    if curl -fsS --max-time 15 "$origin/health" >/dev/null 2>&1; then ok "public check: $origin/health answers"
    else note "$origin/health does not answer from here yet (new Funnel names can take a few minutes). Check again: curl -fsS $origin/health"; fi
  fi

  step "8/8 Done"
  printf '   public worker address: %s\n' "$origin"
  printf '   built from commit:     %s\n' "$commit"
  cat <<EOF
   Vercel (production) settings for the MCP, names only (docs/PC-WORKER.md "Switch the MCP to the PC"):
     NATIVE_GIT_WORKER_URL           = $origin
     NATIVE_GIT_PREVIOUS_WORKER_URL  = <the current Dokploy worker origin>
     NATIVE_GIT_WORKER_CUTOVER_AT    = <UTC time of the switch, YYYY-MM-DDTHH:MM:SSZ>
     GIT_DIRECT_ORIGIN               = $origin
   Pause from Windows: wsl -u root -e $home/pc-worker pause
EOF
}

main "$@"
exit $?
