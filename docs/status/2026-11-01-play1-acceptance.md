# 2026-11-01 — PLAY-1 live acceptance run

Details and request keys: [PLAY-1 card, dated section](../pr-cards/PLAY-1.md). Passed live: cancel, replay (no
duplicate), PostgreSQL suite, browser suite (Chromium), text preview, dispose with independent provider readback.
Found and fixed in the same PR: stale replay state, confusing concurrent-attach error, brief post-attach recovery
window, and one out-of-memory command taking the whole runtime down. Not yet tested: opening the one-time preview link
in a real browser (needs a person or a browser tool; not a failure); idle-expiry cleanup run in progress
(`job_5369bc0a1bbe5b6f`, 3-minute lease). The memory fix needs a release before it can be re-tested live.

Update: idle-expiry cleanup passed live (`job_5369bc0a1bbe5b6f`). Found five Oct 30–31 allocations kept alive by the
sweep renewing their leases; fixed in the follow-up PR; they clear within ~4 h after release.

## Regression found live after the manual release (cbefa0be) and fixed

#516 made attach's source `inspect` non-renewing; the worker answers a non-renewing inspect without
`includeRepository` with metadata only, so new transfers were saved without `sourceHead`/`sourceStatus` and could
never verify ("Generation, ancestry, local changes … differs"), holding the source lock. Seen live on
`github_playground_run` (`golive-run-small-oom-1`, workspace `job_9354487193bf8eb5`). Fixed: request
`includeRepository` (still non-renewing), refuse an incomplete read, and heal transfers saved without a head (release
the lock, prepare again). Tests: `playground-attach-concurrency.test.js` (both new tests fail without the fix; the
mock now mirrors the worker).
