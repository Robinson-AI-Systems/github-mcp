# 2026-11-01 — PLAY-1 live acceptance run

Details and request keys: [PLAY-1 card, dated section](../pr-cards/PLAY-1.md). Passed live: cancel, replay (no
duplicate), PostgreSQL suite, browser suite (Chromium), text preview, dispose with independent provider readback.
Found and fixed in the same PR: stale replay state, confusing concurrent-attach error, brief post-attach recovery
window, and one out-of-memory command taking the whole runtime down. Not yet tested: opening the one-time preview link
in a real browser (needs a person or a browser tool; not a failure); idle-expiry cleanup run in progress
(`job_5369bc0a1bbe5b6f`, 3-minute lease). The memory fix needs a release before it can be re-tested live.

Update: idle-expiry cleanup passed live (`job_5369bc0a1bbe5b6f`). Found five Oct 30–31 allocations kept alive by the
sweep renewing their leases; fixed in the follow-up PR; they clear within ~4 h after release.
