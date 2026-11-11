# WORKER-RESOLV-GUARD-1 — The PC native Git worker never runs silently with a broken resolver

## Owner decision 2026-11-11 (in chat, via the day's work)

Twice in one morning (the 06:45 state and the 09:37 boot) the PC native Git worker came up
with an empty `/etc/resolv.conf` capture: dockerd started the host-networked container
before WSL had populated the host resolver file. Every clone failed, while the worker's
loopback-only healthcheck — and therefore `github_server_status` — kept reporting the
worker healthy. The rack's netcare does not cover this worker (it is not a rack instance).
Chris's standing rule from the second incident: a check that "answers" without a latency
is not a pass where timeouts are the failure mode. This card makes the worker's resolver
state a timed, first-class health signal, and gives the PC kit a guard that heals a
poisoned capture at a job boundary instead of leaving the breakage to be found by the
next failed clone.

## Outcome and acceptance

Outcome: (1) the worker continuously probes its own resolver from inside its own
network — `github.com` and `api.github.com`, each with a 2500 ms timeout, every 30 s —
and reports the verdict (status + round-trip ms) in its signed capabilities; its
`/health` answers 503 while the verdict is down, so Docker's own health stops saying
healthy too. (2) `github_server_status` flips the worker leg to `down` with a plain
reason when the worker's own verdict is down; an `unknown` verdict (probe not yet run)
and older workers that report no verdict are never failed on it. (3) A host-side guard
in `deploy/pc` (systemd timer, 2 min, first run 1 min after boot) probes the worker's
resolver from inside the container on the same names/timeout; on a poisoned verdict it
closes admission with the worker's own owner-pause gate (marked `worker-resolv-guard`),
drains on the auto-updater's exact rule (no mutation locks, no established connections,
900 s cap, then defer — a running job is never killed), heals by container restart, then
one recreate, re-probing after each; failure keeps admission closed, sets `attention`,
and is journaled loudly. Receipts + a one-read status file land in
`/srv/robinson-git/resolv-guard/`; `pc-worker resolv-guard status` prints them.
Accepted when the unit tests pass, `ci` + `release-policy` are green at the exact head,
and on Chris's PC: the guard is installed with its timer active, its first cycles report
the healthy worker `ok` with a probe time, and a real clone through the connector
(open → ready → dispose) passes with the guard live.

## Design (and why)

- **The probe lives in the worker's context, not the server's.** The 2026-11-11 DNS
  outage proved a server-side or host-side probe can pass while the container's own
  resolver path is poisoned (different namespaces, sequential failover). Only a
  resolution attempted with the worker's own captured resolv.conf measures the thing
  that breaks clones. The monitor caches its verdict in the background (30 s interval),
  so capabilities never wait on DNS; the verdict is at most one interval old.
- **Timed, or it is not a check.** Each name gets an explicit 2500 ms budget inside the
  probe; a hang is a failure with the elapsed time recorded, never an eventual answer.
  The guard's in-container probe repeats the same names, timeout and resolv.conf
  nameserver check, so the kit can heal a worker that predates the in-worker monitor.
- **A compose `dns:` pin is not the fix.** The worker is host-networked (PC-WORKER-2);
  Docker's per-container DNS settings do not govern a host-networked container's
  resolver — the captured file does. The guard therefore fixes the capture (restart,
  then recreate) instead of pinning an address that would be ignored.
- **The drain is the updater's drain.** One job-boundary discipline for the whole kit:
  same locks/connections quiet rule, same 900 s cap (the longest single operation the
  worker allows), same marked-pause ownership, same receipts/status shape, same
  stand-downs (RECLAIM, owner pause, own pause file, a held run lock). The guard also
  defers while an autoupdate run holds its lock or its admission pause — the updater's
  swap owns the worker in that window.
- **Host resolver first.** While WSL's own resolv.conf still has no nameserver (the
  boot race itself), restarting the worker would capture the same empty file; the guard
  defers to the next 2-minute cycle instead of churning the container.
- **Bounded healing.** At most 3 heal attempts per poisoning, then `attention` with
  admission closed — new work fails over to the pool's other host — until an operator
  repairs and runs `pc-worker resume`. A guard that restarts forever would be its own
  outage.
- **Owner first, as always.** Nothing here overrides the owner's pause, the RECLAIM
  flag, or a stopped worker: a stopped container is left to the operator, exactly as
  the updater leaves it.

## Files

`workers/native-git/egress.js` (new: the timed egress monitor),
`workers/native-git/server.js` (monitor wiring; `egress` in signed capabilities;
`/health` 503 while down), `src/tools/server-status.js` (worker leg believes the
worker's verdict; verdict in the full workers view), `deploy/pc/worker-resolv-guard.sh`
+ `.service` + `.timer` (new), `deploy/pc/pc-worker` (`resolv-guard` subcommand),
`deploy/pc/install.sh` (install/enable step), `tests/unit/worker-egress.test.js`,
`tests/unit/worker-resolv-guard.test.js`, `tests/unit/server-status.test.js` (worker-leg
cases), `docs/PC-WORKER.md` (runbook section).

## Drift check

Builds on PC-WORKER-1 (install kit, `pc-worker`, the `.owner-pause` admission gate),
PC-WORKER-2 (host networking — the reason a `dns:` pin cannot be the fix),
WORKER-AUTOUPDATE-1 (the drain/verify/receipts discipline this guard mirrors, and whose
lock/pause it defers to) and SRV-STATUS-1 (the status surface that now consumes the
worker's verdict). New: the worker's `egress` capabilities field (additive; protocol
stays 3, older servers ignore it, older workers simply report none), the guard script
and its systemd units under `deploy/pc/`, the `pc-worker resolv-guard` subcommand, the
guard's own pause file (`.resolv-guard-pause`) and state folder
(`/srv/robinson-git/resolv-guard/`). No tool schema change (the status response only
gains fields), no database change, no routing change.
