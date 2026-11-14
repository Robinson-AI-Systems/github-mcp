# PAUSE-ORIGIN-1 — A worker pause says who holds it

## Request (2026-11-11)

At 14:45 MST the PC worker's self-updater tried to move to the gen-25 build. The new build failed verification and
the rollback failed it too, so by design the updater left admission closed "for operator repair". Every agent was
then told "This worker is paused by its owner (the computer is in use)". Nobody was at the PC. The owner asked why
GitHub Unleashed was not using his machines, and his assistant spent a diagnosis pass separating the two.

## Outcome and acceptance

The admission pause file is shared by `pc-worker pause` (the owner), `worker-autoupdate.sh` and
`worker-resolv-guard.sh`. The two scripts write their marker inside the file. The worker now reads the marker:
`check()` answers `{reason: 'owner_paused', held_by: 'owner' | 'updater' | 'resolver_guard'}`. Every worker refusal
text (admission 429, git remote, direct host, upload, download), the pool status line ("pc paused (self-updater)")
and the control plane's message say who holds the pause. Only the owner's pause says "the computer is in use".
The reason code is unchanged, so placement, failover, retry timing and the pool's `paused` state behave as before.
An unreadable pause file counts as the owner's, so the worker never guesses that a pause is maintenance.
Accepted when `tests/unit/pause-origin.test.js` passes, the owner-pause, worker-pool, git-direct and git-remote
suites pass (one equality now includes `held_by: 'owner'`), and `ci` + `release-policy` are green.

## Drift check

There are no new settings, states or reason codes, and no script changes; the scripts already write their markers.
The remaining gap is that a one-host pool has nowhere to spill to. That is a deployment step (a second host in
`NATIVE_GIT_WORKER_POOL`), not this card.
