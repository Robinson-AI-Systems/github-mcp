# CI-FAST-1 — parallel browsers, 30-second warn-only feedback targets, durable overrun records

**Owner direction 2026-10-27:** Appliance Desk's CI design is the reference for horizontally parallel, completely covered test suites. A passing test must stay green even when slower than the desired budget. Excess should be recorded and visibly warned about, not retried or failed merely for slowness. Thirty seconds is the desired test-phase target, **not a hard kill**; the full pipeline's 30-second wall-time is aspirational and must be measured separately. This is a new owner-approved CI policy replacing the earlier mandatory soft-budget failure behavior, while preserving genuine failure and hard timeout gates.

## Drift check and measured reference

- PR #425 merged at main `9aa792d` with all mandatory checks green; the pinned Playwright container executes all 3 browser files in **21.59 seconds** (Vitest: 21.00s), with runner setup separate. The former Ubuntu WebKit apt install had hung at 300 seconds twice.
- Current `browser` is one serial job with its own isolated throwaway PostgreSQL, its full suite takes <60 seconds when setup succeeds, and a 10-minute hard cap protects hung jobs.
- `scripts/ci-phase.mjs` currently **fails passing commands** beyond 180 seconds, and terminates a command after the target plus 30 seconds. This conflicts with the owner's new policy. Existing tests assert the old failure, so they must be updated together.
- Appliance Desk uses file-split browser shards, independent disposable databases, a single aggregate gate and checks for file assignment. This project has exactly three browser test files and can split them by file without concurrent use of one database.

## Acceptance criteria

1. [x] Every browser spec belongs to exactly one stable of three parallel CI browser sections (sign-in, homepage, fair-use), including newly added specs (which must be assigned or CI fails). Each runs with a separate isolated disposable PostgreSQL service, both Chromium and WebKit available as needed, full existing assertions and `REQUIRE_ALL_BROWSERS`. All sections remain required through the existing `ci` aggregate. Hard job cap is at most 3 minutes and each section's aspirational test-execution target is 30 seconds (warn-only), with 60-second local feedback a secondary checkpoint.
2. [x] All existing timed verification phases retain genuine failure, signal and hard-timeout detection, but **a passing over-target phase exits 0** and emits a named GitHub warning, precise duration, budget and overage. Hard watchdog is independent of the target (do not kill a passing phase at target+30 seconds).
3. [x] Persist every phase duration and target/result as a structured, retained Actions artifact plus job summary (including over-target pass). Verify deterministic tests for subtarget, overtarget passing, real failure and timeout, and index coverage for browser file mapping. Repeated overruns are observable across runs; no automatic reruns due to timing alone.
4. [x] Update the owner decision in `docs/SESSION-START.md` and `docs/DECISIONS.md`, keep the status/roadmap and work index accurate, preserve required topology tests, secrets checks, branches and source-only release policy. Verify all focused checks and **exact-head** `ci` + `release-policy`, disposition reviews and guarded merge. Deployment still requires scheduled `live` promoter.

## Boundaries

No skipped/quarantined tests, lowered assertions, orphaned files, skipped DB/browser engine, bypass of merged/required checks, expensive services, secrets, extra runtime permissions, or writes to `main`/`live`. A hard timeout or failed test remains a failure, even when the warning target is permissive.

## Implementation evidence and exact-head gates

The source implementation has mandatory per-file browser shard inventory checks and a 30-second warn-only timer for every main CI verification phase. Passing phases above their target still exit success; failures, SIGTERM and watchdog timeouts remain red. Required timing evidence is uploaded as 14-day JSONL Actions artifacts and written to the job summary. Three browser matrix jobs have separate disposable PostgreSQL services and a 3-minute hard runner timeout; aggregate `ci` still requires all shards. All outcomes remain **PENDING CI and review** until exact-head checks and captured artifact evidence are inspected. Entire hosted pipeline under 30 seconds cannot be promised from browser runtime measurements alone.

## Reconciled merger and observed evidence, 2026-10-28

Previously pending paragraphs above are historical checkpoints. PR #426 merged at `9315bcf4e114d4df54b78660bfd69d27508b549f`; final source `a10b22b0ac2890bd098a7e0e9d5ce2c3e2880575` passed ci run 40555316855 and Daily live policy run 40555316941, with the recursive-spec review resolved. Every unit/browser shard, DB, shapes, RTC, check and aggregate ci succeeded. Source is an ancestor of current main/live.

Independent log inspection: job 122369706574 browser-sign-in recorded 17.92 seconds, commandPassed=true and retained ci-timing-browser-sign-in artifact 12757091319 with 14-day retention. Job 122369706760 unit-1 recorded 74.19 seconds against target 30, commandPassed=true/status=passed, warning overage 44.19 seconds without restarting, and successfully uploaded ci-timing-unit-1 artifact 12756947033 with 14-day retention. Real failures still fail (including later #449's obsolete GraphQL-message assertions). Current CI continues separate PostgreSQL/browser families and required aggregation. The source, tests, exact-head checks, resolved review and guarded merger meet this card; no end-to-end 30-second hosted-runner promise is made. Further performance improvements require measured workload changes, not a timing-only failure or rerun.
