# PLAY-3 step 6 — live execution record (2026-11-11)

Status note for PLAY-3 (steps 0–5, PR #599) and HOST-DELEGATION-1 (PR #600). Step 6 was executed
the same day under the owner's recorded delegation (2026-11-11 05:11 MST: step 6 handled on his
behalf; 05:27 the Workshop added as instance #2; 05:28 potato added as instance #3). This note is
the evidence record; per-instance implemented/verified labels are kept separate throughout.

## Release state

- main head `8e44f2d8` (PLAY-3 `793a68e4` + HOST-DELEGATION-1 `8e44f2d8`).
- The owner-authorized manual release ran through the repo's own machinery: `daily-live.yml`
  dispatch (run 43037863022, actor christcr2012, manual_release=true, expected_main_sha matched)
  after main's head CI was re-run green (one transient failure in
  native-git-transfer-attached.test.js, expected-410-got-200, passed on re-run). `live` =
  `8e44f2d8`; the promotion ceremony and its tag are recorded.
- **Blocker (named, not absorbed):** the rack-hosted production instance still served release
  `340cb102` at every poll through 07:45 MST, ~70 minutes after the ceremony. Production deploys
  through Rack Control; the executing seat holds no rack credential (no rack connector on this
  VM; the rack-api front on the PC answers key-gated). The delegated-approval tools
  (`github_playground_hosts`, `github_playground_host_pairing`) therefore do not answer in
  production yet, and every enrollment below stands at its join gate. The completion sequence
  once the deploy lands is ~15 minutes: pairing begin -> join (already-staged payloads) ->
  delegated approve with the recorded delegation note -> readiness read -> PLAY-2 allocation
  acceptance -> revocation drill -> the continuity reboot (last).

## Instance #1 — Chris's PC (DESKTOP-OL64ACP): installed, at the join gate

- General fast path taken: existing WSL2 detected, no feature step, no product reboot. Bench
  distro, Docker Desktop and the FleetKit keeper untouched, per the design's yardstick.
- Servicing reboot (mine, journaled first): preflight F3 was a TRUE positive (CBS RebootPending
  since the 2026-11-02 boot). Reboot issued 13:44:21Z; boot 13:45:11Z; hosting and the bench
  returned unattended; F3 cleared. This boot is NOT the continuity proof (the agent was not
  installed yet); the proof stays last in the sequence.
- Installed and verified in the new `PlaygroundWorker` distro: worker account `ras-playground`
  (docker group), Docker Engine 29.1.3 active, Node v22.23.4, `ras-playground-agent` unit
  enabled, payload + `agent-versions/fleet-agent/1` placed. The agent's pre-join behavior is
  correct (starts, reports not-joined, exits, systemd restarts).
- Keeper: `RobinsonPlayground-Keeper` registered and Running; the distro is held open.
  `RobinsonPlayground-Resume` registered. The elevation batch on this machine contained zero
  privileged actions; it was executed as a journaled delegated equivalent citing the owner's
  2026-11-11 05:11 MST instruction.
- Sizing: the existing `.wslconfig` already carried every managed key; the reference merge ran
  and changed nothing.

## Instance #2 — the Workshop (chris-agent-01, NixOS): installed, at the join gate (form deviation declared)

- The design's Linux form (systemd --user unit + linger) cannot be established with the access
  this seat holds there: no passwordless sudo, linger off, no reachable user manager bus.
  Declared deviation: the agent runs as a fenced Docker container `ras-playground-agent`
  (node:22 + docker CLI image built on the host), `--restart unless-stopped`, state in a bind
  mount, socket access only; nothing else on the host was disturbed, and a collision scan
  (ports, names, existing containers) ran first. The agent cycles pre-join with the correct
  not-joined message; the join runs inside the container against the persisted state.
- If owner-level access to the Workshop is later granted, the unit form can replace the
  container form without re-pairing (same device key custody location class: host state dir).

## Instance #3 — potato (Caleb's PC): not installed — machine off (fresh diagnosis, not history)

- Dispatcher probes failed; Tailscale shows the node `potato.tail41d4fa.ts.net` authorized and
  healthy at last contact, `lastSeen 2026-11-11T10:19:53Z` (03:19 MST) — powered off or asleep
  since before the workday, not the repaired 2026-11-04 faults and not the Nov 6–7 network
  outage. Wake-from-off is unproven. The install is the same Windows path as instance #1 and
  its keeper also answers potato's open WSL-powers-off-after-session-close item; it runs at the
  machine's first reachable window. Owner-wins evidence (indicator, pause, yield) is collected
  with that install, not before.

## Live findings folded into PLAY-3-FIXES (this PR)

1. Canonical rootfs URL 404'd (`-amd64-rootfs.tar.gz`); corrected to
   `ubuntu-noble-wsl-amd64-24.04lts.rootfs.tar.gz` (hash pin unchanged in mechanism; the staged
   instance-#1 image verified sha256 2a790896…9934).
2. F1 false positive: the firmware flag fired while a hypervisor was running and WSL2 worked.
   F1 now requires firmware-off AND no hypervisor present (preflight.mjs + PS mirror + tests).
3. F5 probe: IsInRole on a filtered token misread the Development account both ways across
   launches; the probe is now local Administrators membership by account name, IsInRole as
   fallback.
4. Invoke-WslTimeout: Start-Process left ExitCode null after fully successful wsl runs (the
   distro import and the payload chain both false-failed F14). Null + Refresh retry; null with
   empty stderr is success; null with stderr keeps the failure vocabulary.
5. Keeper XML template: the Principal carried no UserId — schtasks refused it ("Access is
   denied"). The template now carries `%USERID%`, substituted with the enrolling user's SID at
   registration (schema order: UserId before LogonType).
6. run.mjs: the launcher wrote its crash log into a state dir that might not exist yet
   (ENOENT on first run on the Workshop). saveCrashes/writeReport now create the dir.
7. **Named gap, not fixed here:** `merge-wslconfig.mjs` is wired nowhere in the PowerShell
   flow — `Invoke-PlaygroundSetup` passes a literal `'{}'` as the sizing JSON and the batch's
   write-wslconfig line is a comment claiming an unelevated merge that no code performs. The
   merge itself is correct and idempotent (proven by hand on instance #1); wiring it needs the
   sizing seam designed (unelevated merge before elevation; effect verified), as its own change.

## Step-1 spike fold-in (from the steps 0–5 run)

- Docker Engine surface: 23/23 PASS. Podman 6.1.3: 18/23, every non-compose call passing; its
  5 compose rows INCONCLUSIVE (the bench Compose CLI crashed against both backends —
  environmental). Podman stays deferred; Engine is the only v1 runtime.
- Finding: `localCompose()` does not validate service network attachments — an ingress placed
  only on an internal network can never publish its loopback port, so `up()` fails its own
  check and tears down. Allocation plans must give the ingress a non-internal attachment (or
  the agent should validate attachments before `up`).

## Degraded / not-run declarations

- The 8-cell Windows setup matrix was NOT run (no clean Windows VMs in the fleet); the Win11
  Pro/admin/virtualization-on cell was exercised for real on instance #1 instead.
- PowerShell parse of the edited module was not run on Windows in this PR's bench verification
  (Workshop is NixOS); the PS edits are single-expression substitutions in existing shapes, and
  CI's repo check is the gate that ran.
- PLAY-2/FLEET-3 live acceptance (allocation -> command -> results -> dispose on a real host)
  and the revocation drill remain owed; both are gated on the production deploy named above,
  not on any build work.
