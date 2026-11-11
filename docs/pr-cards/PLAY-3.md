# PLAY-3 — The always-on host service form and the grandma-proof installer

## Owner approval 2026-11-11

Chris ordered the build directly ("Build PLAY-3 now", 2026-11-11), after the design had waited since
2026-11-08. Design: the PLAY-3 design of 2026-11-08 (Robinson Agent Platform goal workspace,
`play3-design-2026-11-08.md`), judged against the grandma-proof Windows setup plan of 2026-10-31
(owner clarification #3 to PLAY-2). PLAY-1 is accepted (2026-11-01); PLAY-2/FLEET-3 are built as
source. What was missing is this card: the installer and the service form. Today the host agent is a
foreground program a person starts by hand and keeps running in a terminal, and the shipped guide
tells a Windows user to arrive with Docker Desktop already working, which the yardstick rules out.

## Settled by the design (not re-opened by the build)

- **Service form:** the agent runs as a systemd service inside a dedicated installer-owned WSL2
  distro (`PlaygroundWorker`), held open by a per-user Windows logon keeper task
  (`RobinsonPlayground-Keeper`, the FleetKit-WSL-KeepAlive pattern). Not a Windows service; not a
  task-run agent on Windows. Linux hand-rolled hosts use a `systemd --user` unit; macOS a launchd
  plist. Availability is from the user's sign-in; pre-logon availability is out of scope for v1.
- **Runtime:** Docker Engine inside the distro. Docker Desktop is out — never touched, never used,
  never required; a user's own install is left alone. Podman is deferred behind a filed 100%
  compatibility proof (step 1 evidence).
- **Custody:** PLAY-2/FLEET-3 semantics unchanged. Device Ed25519 key generated inside the distro,
  never leaves it; no long-lived bearer — authority re-derived from the live Full grant at every
  check-in; rotation is re-pairing; revocation terminates.
- **Updates:** the agent self-updates from a signed advertisement on the check-in response
  (verified against the control key pinned at join): drain → hash-verify → atomic pointer flip →
  supervisor restart → receipt check-in reporting the new version; automatic rollback to the
  retained previous version on a crash-loop. Runtime images keep the PLAY-1 digest-pin contract.
- **Installer yardstick:** 2 human decisions, 0 typed commands, ≤45 min total / ≤5 min attention,
  one batched UAC elevation containing every privileged act, ≤1 reboot only if WSL features were
  just enabled, journal-resumable with 0 repeated steps and 0 repeated decisions. Failure
  vocabulary F1–F14 carried in enrollment-status responses.

## Build steps and acceptance

- **Step 0 — Card + connector re-verification.** This card; PLAY-2/FLEET-3 cards and the
  host-agent code re-read through the restored connector and reconciled against the design's
  citations. *Done 2026-11-11: drift NONE — `docs/pr-cards/PLAY-2.md`, `docs/pr-cards/FLEET-3.md`,
  `tools/playground-device/{agent,pair,install}.mjs` and `README.md`, plus the build surface
  `api/fleet/checkin.js`, `src/fleet/host.js`, `src/native-git/signing.js` and
  `tests/unit/fleet-dial-out.test.js`, are byte-identical at main `340cb102` to the staging copies
  the design was read from.*
- **Step 1 — Runtime evidence spike.** The agent's exact runtime call surface run on a bench WSL
  distro against Docker Engine and against Podman's Docker-compatible layer; per-call pass/fail
  table filed either way. Engine must pass 100%; Podman blocks nothing.
- **Step 2 — The service form.** systemd units (distro system unit + Linux `--user` unit), macOS
  launchd plist, keeper-task definition; the launcher shim with versioned payload directories and
  crash-loop rollback; startup reconciliation in the agent; the check-in `agentUpdate`
  advertisement (control plane) + verify/drain/apply/rollback in the agent; adversarial unit
  tests (bad signature, bad hash, downgrade, busy-host refusal). Bench battery: kill the agent
  three ways and prove check-in recovery; signed test update applied with a live allocation;
  forced bad update rolled back automatically.
- **Step 3 — Distro provisioning payload.** Cloud-init user data (worker account with locked
  password, systemd, Docker Engine + Compose v2, Node 22, unattended security updates, agent
  bundle placement), the `.wslconfig` merge-respecting writer, hard timeouts on every `wsl` call.
  Bench battery: provision from zero with features on and off, no interactive first-run, engine is
  a service, keeper pattern revives a terminated distro, clean uninstall, idempotent re-provision.
- **Step 4 — Windows bootstrapper + setup page.** Pre-flight (F1–F14), journal, the one elevation
  batch (exactly the design's list), resume + keeper task registration, stay-awake handling,
  distro install, in-distro join driving, pause/remove, clean uninstall with feature-state
  restore; setup-page screens (download, pairing phrase, BIOS/AV/S-mode detours); README rewritten
  (Docker Desktop out of the Windows path). Battery: dry-run/plan mode, forced F-detections,
  traced single-UAC elevation audit, interruption drill with 0 repeats.
- **Step 5 — The 8-cell matrix + clean-machine walkthrough.** Yardstick §7 matrix (Home × Pro ×
  admin × standard × virtualization on/off) on clean-snapshot VMs plus the page-only walkthrough.
  Any cell not run is reported as not run.
- **Step 6 — Instance #1 live acceptance (owner moments).** The shipped installer on the owner's
  PC through the general fast path (WSL2 detected: no feature step, no reboot; existing distros,
  Docker Desktop and the FleetKit keeper untouched), the owner's pairing approval (~1 minute, his
  by design), readiness to `ready`, then the PLAY-2/FLEET-3 acceptance battery on the real machine
  — which also collects PLAY-2's still-owed live acceptance — plus the unattended reboot-cycle
  proof at the owner's chosen moment.
- **Step 7 — Close-out.** Delivery note on this card, STATUS/roadmap updates, owner guide
  rewritten to the installer reality, the design marked built-with-deviations (any deviation
  named).

## Not in PLAY-3

The hosted fallback's pricing (PLAY-2 §G — a later product decision); device-native Git / the
100 MiB attachment question (FLEET-6); interactive browser preview on own machines; Windows 10;
ARM64; pre-logon availability; Podman adoption (step 1 evidence, later card if it earns it). The
setup app's code-signing certificate is an operator purchase decided separately; interim builds
use the narrated SmartScreen path, labelled, and instance #1 acceptance does not need it.

## Drift check

Keeps PLAY-1's runtime contract and PLAY-2's fences exactly: the agent surface
(`github_playground_execute` / `read` / `cancel`) does not change, no new tool family, enrollment
remains the user's own act under their own connection, and the device key never enters an MCP
argument, a runtime container or a log. The `agentUpdate` advertisement is additive and optional
on the existing check-in response; the agent protocol version is unchanged.
