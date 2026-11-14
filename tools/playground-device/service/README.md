# Service definitions for the Playground host agent (PLAY-3)

How the agent runs as an always-on service, per platform. All forms run the
launcher shim (`../run.mjs run`), which starts the payload named by the
`agent-versions/current` pointer in the agent state directory (or the
installer-placed payload when there is no pointer) and rolls back
automatically if a new payload crash-loops. The shim sets
`RAS_PLAYGROUND_SUPERVISED=1` for the payload so the signed self-update path
is live; a hand-run foreground agent stays in charge of its own terminal and
never self-updates.

- **Windows (the PLAY-3 installer path):** `ras-playground-agent.service`
  runs as a *system* unit inside the installer-owned `PlaygroundWorker` WSL2
  distro, as the unprivileged `ras-playground` account. The distro is held
  open after the user's sign-in by `RobinsonPlayground-Keeper.xml`, a per-user
  scheduled task the installer registers (logon trigger, least privilege,
  `wsl.exe -d PlaygroundWorker --exec sleep infinity`). The unit is ordered
  after `docker.service` (Docker Engine inside the distro — Docker Desktop
  is never used) and *wants* it rather than requiring it, restarts always,
  and carries no start limit: a failed first Docker start at boot must
  never take the agent down with it or wedge it permanently
  (PLAY3-BOOT-RETRY-1 — at the 2026-11-11 boot exactly that failure left
  the agent waiting for a human while Docker recovered in seconds).
  `apply-provisioning.sh` converges the same settings onto installs whose
  base unit predates them, as the drop-in
  `ras-playground-agent.service.d/10-boot-retry.conf`.
- **Linux (hand-rolled hosts):** `ras-playground-agent.user.service` is a
  `systemd --user` unit. Install with the agent files in
  `~/.config/ras-playground/`, copy the unit to
  `~/.config/systemd/user/`, then `systemctl --user daemon-reload`,
  `systemctl --user enable --now ras-playground-agent` and
  `loginctl enable-linger $USER` so it survives sign-out.
- **Fleet container form (Workshop):** where the agent runs as a Docker
  container instead of under systemd, Docker itself is the supervisor and
  the container must be created with restart policy `always` — never
  `unless-stopped`, which leaves a stopped container down across a daemon
  restart. `always` is the container form of the systemd units'
  `Restart=always` and carries the same boot-retry contract.
- **macOS (hand-rolled hosts):** `com.robinsonaisystems.playground-agent.plist`
  is a launchd user agent. Replace `NODE_PATH_HERE` with the absolute path to
  a Node 22+ binary, place the agent files in `/Users/Shared/ras-playground/`,
  copy the plist to `~/Library/LaunchAgents/` and
  `launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.robinsonaisystems.playground-agent.plist`.
