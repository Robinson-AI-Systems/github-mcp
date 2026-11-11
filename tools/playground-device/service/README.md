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
  `wsl.exe -d PlaygroundWorker --exec sleep infinity`). The unit requires
  `docker.service` (Docker Engine inside the distro — Docker Desktop is never
  used) and restarts on failure.
- **Linux (hand-rolled hosts):** `ras-playground-agent.user.service` is a
  `systemd --user` unit. Install with the agent files in
  `~/.config/ras-playground/`, copy the unit to
  `~/.config/systemd/user/`, then `systemctl --user daemon-reload`,
  `systemctl --user enable --now ras-playground-agent` and
  `loginctl enable-linger $USER` so it survives sign-out.
- **macOS (hand-rolled hosts):** `com.robinsonaisystems.playground-agent.plist`
  is a launchd user agent. Replace `NODE_PATH_HERE` with the absolute path to
  a Node 22+ binary, place the agent files in `/Users/Shared/ras-playground/`,
  copy the plist to `~/Library/LaunchAgents/` and
  `launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.robinsonaisystems.playground-agent.plist`.
