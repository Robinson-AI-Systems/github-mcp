#!/bin/sh
# PLAY-3 §3 step 3 — converge the PlaygroundWorker distro to its provisioned
# state. Idempotent: safe to run on first boot (from cloud-init), on every
# re-provision, and after an engine death. Runs as root inside the distro.
# Provisions OS state only; agent payload files are placed (and replaced)
# separately by the installer over the versioned agent-versions contract.
set -eu
MARKER=/var/lib/ras-playground/provisioned
mkdir -p /var/lib/ras-playground /home/ras-playground/.config/ras-playground

# Worker account: present, password locked, in the docker group.
if ! id ras-playground >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash ras-playground
fi
passwd -l ras-playground >/dev/null 2>&1 || true
chown -R ras-playground:ras-playground /home/ras-playground

# Packages (skip the network entirely when already converged).
need_pkgs=""
command -v docker >/dev/null 2>&1 || need_pkgs="$need_pkgs docker.io"
docker compose version >/dev/null 2>&1 || need_pkgs="$need_pkgs docker-compose-v2"
# The allocation build uses a remote git build context: the classic-builder
# fallback needs a local git binary, and BuildKit needs the buildx plugin.
# Without both, the first allocation_up order is refused on the device.
docker buildx version >/dev/null 2>&1 || need_pkgs="$need_pkgs docker-buildx"
command -v git >/dev/null 2>&1 || need_pkgs="$need_pkgs git"
[ -x /usr/bin/unattended-upgrade ] || need_pkgs="$need_pkgs unattended-upgrades"
if [ -n "$need_pkgs" ]; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  # shellcheck disable=SC2086
  apt-get install -y -qq $need_pkgs ca-certificates curl
fi
usermod -aG docker ras-playground

# Node 22+ (agent requirement). NodeSource is the recorded supply route:
# Ubuntu's archive nodejs is too old for the agent (needs >= 22).
node_major=$(node -e 'console.log(process.versions.node.split(".")[0])' 2>/dev/null || echo 0)
if [ "$node_major" -lt 22 ]; then
  export DEBIAN_FRONTEND=noninteractive
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
fi

printf 'APT::Periodic::Update-Package-Lists "1";\nAPT::Periodic::Unattended-Upgrade "1";\n' > /etc/apt/apt.conf.d/20auto-upgrades-playground
systemctl enable --now docker 2>/dev/null || service docker start || true
systemctl enable unattended-upgrades 2>/dev/null || true
# The agent unit is enabled by the installer once payload files are placed;
# enable here too when present so recovery converges without Windows help.
if [ -f /etc/systemd/system/ras-playground-agent.service ]; then
  # Boot-retry convergence (PLAY3-BOOT-RETRY-1): restate the agent unit's
  # boot-retry settings as a drop-in so an install whose base unit predates
  # them converges in place. Wants= keeps Docker ordered but non-fatal, and
  # StartLimitIntervalSec=0 stops a start limit from wedging the agent
  # permanently after a bad boot. The base unit in
  # service/ras-playground-agent.service carries the same settings; the
  # drop-in only ever agrees with it. Mechanism note (corrected 2026-11-12):
  # the drop-in's empty Requires= line does NOT by itself clear a Requires=
  # carried by an older base unit — on systemd 255 the reset alone left the
  # old unit's Requires in effect during the #610 live proof. The end state
  # is correct because the shipped base unit carries Wants= itself; the
  # drop-in's job is restating the settings so the kit agrees with itself,
  # and its Requires= line is kept for the record, not relied on as the cure.
  # Why: at the 2026-11-11 boot a failed
  # first dockerd start (an iptables chain race, recovered in seconds)
  # failed the agent's Requires-linked start job with result 'dependency'
  # and nothing retried it — the agent waited for a human.
  mkdir -p /etc/systemd/system/ras-playground-agent.service.d
  cat > /etc/systemd/system/ras-playground-agent.service.d/10-boot-retry.conf <<'DROPIN'
# PLAY-3 boot-retry convergence — written by apply-provisioning.sh.
# Mirrors service/ras-playground-agent.service; see that file for why.
[Unit]
Requires=
Wants=docker.service
StartLimitIntervalSec=0
DROPIN
  # SECOND-SHIFT-610: a failed daemon-reload leaves systemd running the OLD
  # unit while the new drop-in sits on disk — the exact silently-unrepaired
  # state this script exists to converge. Refuse the converged marker rather
  # than claim a repair that did not take; the next provision run retries.
  if ! systemctl daemon-reload 2>/dev/null; then
    echo "apply-provisioning: systemctl daemon-reload failed after writing the boot-retry drop-in; NOT marking provisioning converged" >&2
    exit 1
  fi
  systemctl enable ras-playground-agent 2>/dev/null || true
fi
date -u +%FT%TZ > "$MARKER"
echo "ras-playground provisioning converged"
