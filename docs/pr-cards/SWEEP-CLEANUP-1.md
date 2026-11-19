# SWEEP-CLEANUP-1: automatic clean-up of Playground records and unused workspaces; merge wait; relay leftover removed

## Owner request 2026-11-19

Chris: do the separate job for the old records "and create/fix/improve the automated cleaning/clearing system for those",
"also include the cleaning/clearing of the unused workspaces", fix the three improvement items from REVIEW-1119, and fix
anything else found on the way.

## What was actually wrong (correcting REVIEW-1119)

REVIEW-1119 said the sweep spent its time on ~69 old closed records. It did not: `listPlaygroundIndexes` never returns
closed rows, so the REVIEW-1119 "skip finished rows" line could never run (removed here). The 20 s per run was **one** device
runtime (google-workspace-mcp, on potato) whose computer has been offline since 2026-11-18 22:45 UTC: the sweep waited the
full 20 s for its removal answer every minute. The 120 closed records were simply never deleted.

## Outcome and acceptance

- **Sweep never blocks on an offline computer**: device removal answers are checked for 1.5 s (`deviceWaitMs`), then again next minute.
- **A removal order is never waited on forever** (`disposeDeviceAllocation`): lapsed (7 days, including delivered-but-never-answered)
  while the computer is online → a fresh order; stayed offline, unpaired, removed or refused → the record closes as
  `cleanupEvidence: device_unconfirmed` with `unconfirmedReason`, shown by `github_playground_read allocation` as `cleanup: unconfirmed`.
- **Runtimes left behind are removed when their computer returns** (`orphanRuntimeOrders`, `src/fleet/host.js`): a check-in
  reporting a runtime whose record is closed or unknown gets one `allocation_down` order (re-sent only after it lapses).
- **Closed records are cleared** (`clearClosedAllocations`, end of each sweep): a week after closing, once the workspace record
  is gone, both the tenant record and its index row are deleted (25 per run; total in `playground_retention`). A record whose
  scope can no longer be loaded loses its index row only.
- **Unused workspaces on the Git machines** (`NativeGitWorker.prune`): expired workspaces are removed as before; a folder with
  missing or damaged metadata is now removed after 14 days (twice the longest lease) instead of never; one bad folder no
  longer aborts the whole pass (it used to throw on the first damaged `workspace.json`).
- **Workshop off without rewriting the pool list**: new `NATIVE_GIT_WORKER_OFF` (comma names; never the primary).
- **Relay leftover removed**: the `b.<host>` broker route and its `PLAYGROUND_INGRESS_IPV4`/`PLAYGROUND_POOLS` reads are gone;
  a workspace attached to a shared-pool runtime gets the Git-only fallback. Unused `playgroundDemandSince` (warm runtimes) removed.
- **merge_when_green waits longer** (MERGE-WAIT-3): up to `MERGE_WAIT_SECONDS` (default 70) in 45 s slices, reporting the total
  waited; the merge keeps its own 16 s.
- **Pairing refusals are plain**: `github_playground_host_pairing` reports the enrollment store's own refusals (for example a
  device enrolled under another connection) as `rejected`, not "outcome uncertain".
- Tests: new `sweep-cleanup.test.js` (8), worker prune orphans, `NATIVE_GIT_WORKER_OFF`, MERGE-WAIT-3 (2), pairing refusal,
  `listClosedPlaygroundIndexes`/`deleteSettingAt` in the database suite; transfer tests updated for the removed route.

## Drift check

No tool added or removed. Sweep reply gains `cleared`; merge wait reply's `waited_seconds` is the total; allocation reply may
show `cleanup: unconfirmed`; transfers to a shared-pool runtime are refused with the fallback.
