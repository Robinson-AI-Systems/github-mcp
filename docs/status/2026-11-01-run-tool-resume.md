# 2026-11-01 — `github_playground_run` resumes through repeated calls

**Problem (live, release 9e9946d0):** a run stayed at `phase: provisioning`, `allocation_phase: deploying` with
`updated_at` frozen for 30+ minutes across identical calls, and compact clients only saw
`omitted_fields: ["summary","result"]`. Read-only check of the production database: the run's journal row was confirmed
and the run row had advanced on a replay (revision 6, 39 minutes after the first call) up to the attach error fixed in
#527/#528. So replays did call the state machine, but (1) a waiting step saved nothing, so the row looked frozen and a
stale `lastError`/`allocationPhase` stayed; (2) a first call cut off by the 60 s limit (a long step started near the end
of the 40 s budget) would leave the journal row unrecorded, after which every replay answered "outcome not recorded" and
never advanced; (3) concurrent calls could both take steps (start stayed exactly-once only by the runtime's request key);
(4) the large `result` was hidden from compact clients.

**Fix (branch `ai/claude/run-tool-resume`):**
- Write core (`src/core/write.js`): opt-in `resumeReplay` — a replay of a tool with an exactly-once state machine calls
  `refreshReplay` even when the first call's outcome was never journalled; a verified refresh completes that row. `apply`
  is never re-run. Opt-in `essentials` adds a bounded (≤1200 bytes) `progress` digest to applied and replayed results;
  `src/core/result-envelope.js` keeps `progress` in compact replies.
- Run (`src/playground/run.js`): an advance lease (CAS on the run row, longer than any call) so only one call takes
  steps; a new step only with ≥15 s budget left; one checkpoint per call (`lastAdvancedAt`, `waitingOn`, observed
  `allocationPhase`, clears a stale `lastError`); `runEssentials` digest.
- Tool (`src/tools/playground.js`): the intent comes from the arguments, so the replay continues the same run.

**Tests:** `tests/unit/playground-run.test.js` (completion through repeated calls on every door, concurrent calls start
once, lease read-only/expiry, cut-off first call healed, waiting run checkpoints, compact `progress`),
`tests/unit/write-core.test.js` (resumable replay contract). Write-contract checks still pass through all doors.

**Not done:** not live-verified; takes effect with the next daily release.
