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
  systemctl enable ras-playground-agent 2>/dev/null || true
fi
date -u +%FT%TZ > "$MARKER"
echo "ras-playground provisioning converged"
