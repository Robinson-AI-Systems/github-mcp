# CI-FAST-1 — parallel browsers, 60-second feedback targets, durable overrun records

**Owner direction 2026-10-27:** Appliance Desk's CI design is the reference for horizontally parallel, completely covered test suites. A passing test must stay green even when slower than the desired budget. Excess should be recorded and visibly warned about, not retried or failed merely for slowness. Thirty seconds is the desired test-phase target, **not a hard kill**; the full pipeline's 30-second wall-time is aspirational and must be measured separately. This is a new owner-approved CI policy replacing the earlier mandatory soft-budget failure behavior, while preserving genuine failure and hard timeout gates.

## Drift check and measured reference

- PR #425 merged at main `9aa792d` with all mandatory checks green; the pinned Playwright container executes all 3 browser files in **21.59 seconds** (Vitest: 21.00s), with runner setup separate. The former Ubuntu WebKit apt install had hung at 300 seconds twice.
- Current `browser` is one serial job with its own isolated throwaway PostgreSQL, its full suite takes <60 seconds when setup succeeds, and a 10-minute hard cap protects hung jobs.
- `scripts/ci-phase.mjs` currently **fails passing commands** beyond 180 seconds, and terminates a command after the target plus 30 seconds. This conflicts with the owner's new policy. Existing tests assert the old failure, so they must be updated together.
- Appliance Desk uses file-split browser shards, independent disposable databases, a single aggregate gate and checks for file assignment. This project has exactly three browser test files and can split them by file without concurrent use of one database.

## Acceptance criteria

1. [ ] Every browser spec belongs to exactly one stable of three parallel CI browser sections (sign-in, homepage, fair-use), including newly added specs (which must be assigned or CI fails). Each runs with a separate isolated disposable PostgreSQL service, both Chromium and WebKit available as needed, full existing assertions and `REQUIRE_ALL_BROWSERS`. All sections remain required through the existing `ci` aggregate. Hard job cap is at most 3 minutes and each section's aspirational test-execution target is 30 seconds (warn-only), with 60-second local feedback a secondary checkpoint.
2. [ ] All existing timed verification phases retain genuine failure, signal and hard-timeout detection, but **a passing over-target phase exits 0** and emits a named GitHub warning, precise duration, budget and overage. Hard watchdog is independent of the target (do not kill a passing phase at target+30 seconds).
3. [ ] Persist every phase duration and target/result as a structured, retained Actions artifact plus job summary (including over-target pass). Verify deterministic tests for subtarget, overtarget passing, real failure and timeout, and index coverage for browser file mapping. Repeated overruns are observable across runs; no automatic reruns due to timing alone.
4. [ ] Update the owner decision in `docs/SESSION-START.md` and `docs/DECISIONS.md`, keep the status/roadmap and work index accurate, preserve required topology tests, secrets checks, branches and source-only release policy. Verify all focused checks and **exact-head** `ci` + `release-policy`, disposition reviews and guarded merge. Deployment still requires scheduled `live` promoter.

## Boundaries

No skipped/quarantined tests, lowered assertions, orphaned files, skipped DB/browser engine, bypass of merged/required checks, expensive services, secrets, extra runtime permissions, or writes to `main`/`live`. A hard timeout or failed test remains a failure, even when the warning target is permissive.
