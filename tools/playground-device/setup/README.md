# Playground host setup (PLAY-3)

The installer a person actually runs on Windows, plus its testable logic.

- `setup.ps1` / `Setup.psm1` — the bootstrapper: probe → classify (F1–F14)
  → stay-awake → the ONE elevation batch → (one reboot, only when the WSL
  features were off, resumed at next sign-in by the resume task) → distro →
  payload → pairing-file join → service start. Journalls every step to
  `%LOCALAPPDATA%\RobinsonPlayground\journal.jsonl`; re-running resumes with
  0 repeated steps and 0 repeated decisions. Modes: `-Plan` (print the plan
  as JSON, change nothing), `-Pause`, `-Remove [-RestoreFeatures]`.
- `preflight.mjs` — the canonical, unit-tested classification of probe facts
  onto the F1–F14 vocabulary and its guidance pages. The PowerShell copy in
  `Setup.psm1` mirrors it (the bootstrapper cannot assume Node exists on the
  target PC) and is held to the same fixture outcomes.
- `pages/` — the screens: `index.html` (what this is, the download, the two
  decisions), `pairing.html` (check the fingerprint, approve), and one page
  per detour code.
- `../provision/` — the distro payload: cloud-init user data, the idempotent
  in-distro provisioning script, the `.wslconfig` merge writer (Node module,
  unit-tested; respects anything the user already set), and
  `provision-distro.ps1` (official Ubuntu WSL rootfs, SHA-256 pinned by the
  release, imported as `PlaygroundWorker`; every `wsl.exe` call under a hard
  timeout).

Nothing here touches Docker Desktop, the user's own distros, or any keeper
task but its own (`RobinsonPlayground-Keeper`).
