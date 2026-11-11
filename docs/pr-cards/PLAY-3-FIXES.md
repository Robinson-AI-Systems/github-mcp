# PLAY-3-FIXES — Step-6 live findings folded back into the installer

## Why this card exists

PLAY-3's step 6 ran the shipped installer for real on the owner's PC (instance #1) and the
Workshop (instance #2) on 2026-11-11 under the owner's recorded delegation. The live run found
six defects that no bench test had caught, because each one lives in the seam between the
installer and a real machine: a dead download URL, two preflight probes that misread a healthy
machine, a process-exit capture that reported success as failure, a scheduled-task template
Windows refuses, and a launcher that assumed its state directory already existed. This card is
the fix batch; the full evidence record is `docs/status/2026-11-11-play3-step6-closeout.md`.

## Scope

- `provision/provision-distro.ps1`: corrected Ubuntu WSL rootfs URL
  (`ubuntu-noble-wsl-amd64-24.04lts.rootfs.tar.gz`); `Invoke-WslTimeout` treats a null exit
  code with empty stderr as success (with a Refresh retry first) — null with stderr keeps the
  caller's failure vocabulary.
- `setup/preflight.mjs` + `setup/Setup.psm1` (kept in parity): F1 fires only when firmware
  virtualization is off AND no hypervisor is present; the F5 administrator probe reads local
  Administrators group membership by account name, with IsInRole as fallback.
- `service/RobinsonPlayground-Keeper.xml` + `setup/Setup.psm1`: the keeper task's principal
  carries `%USERID%`, substituted with the enrolling user's SID at registration.
- `run.mjs`: the launcher creates its state directory before writing crash/update reports.
- Tests: `tests/unit/play3-provision.test.js` covers the F1 hypervisor case both ways.

## Explicitly not in this card

- Wiring `merge-wslconfig.mjs` into the PowerShell flow (the sizing seam: `Invoke-PlaygroundSetup`
  passes a literal `'{}'` sizing JSON today). The merge is proven correct by hand on instance #1;
  the wiring is a designed change of its own, recorded as a named gap in the step-6 status note.
- Anything about enrollment or the production deploy: the delegated-approval tools shipped in
  HOST-DELEGATION-1; step 6's remaining legs are operational, not code.

## Acceptance

- Targeted unit tests green (play3-provision and the fleet-agent suites) and `npm run check`
  green at the PR head, with `ci` and `release-policy` green before merge — the repo's standing
  bar, unchanged.

## Drift check

Base: merged main `8e44f2d8` (PLAY-3 `793a68e4` + HOST-DELEGATION-1 `8e44f2d8`), re-read at the
close-out clone's head before patching. Every fix in this card traces to a step-6 live artifact
(the instance-#1 and instance-#2 install journals and the fleet-job ledger entries named in
`docs/status/2026-11-11-play3-step6-closeout.md`), not to a re-reading of the design: the design
says what the installer should do, the live run showed where the shipped code diverged from the
machines in front of it. No drift between the design and this card's scope; the one designed
behavior the code never implemented (the .wslconfig sizing merge) is recorded as a named gap in
the status note and is deliberately out of this card's scope.
