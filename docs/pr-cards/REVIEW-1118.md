# REVIEW-1118: Second Shift review of 2026-11-18, all 12 findings acted on

## Owner request 2026-11-18

Chris: "PenPal". Vivienne's Review Second Shift re-run (second-shift-20261118-104356.md: 7 github-mcp PRs, 2 High,
8 Medium, 2 Low) was waiting there. Every finding is fixed or answered with evidence below.

## Outcome and acceptance

- **LOG-FAILURES-4 (findings 1, 2 — High).** No silent cap: `testFailureReport` returns the real count
  (`tests_failing`) and how many are not listed (`tests_cut`), and the job-log and run-summary tools add a `tests_note`
  when some are cut. Failures from every log text of a job are merged by runner and test (the entry with a reason wins),
  not only the first text that had any. Acceptance: `tests/unit/actions-read.test.js`, the LOG-FAILURES-4 cases.
- **ARCHIVED-ERR-2 (finding 3).** `archived_repository` only for a 403 whose message holds GitHub's whole sentence
  "Repository was archived so is read-only". Evidence in `docs/pr-cards/AGENT-FB-1117.md`. Acceptance:
  `tests/unit/errors.test.js`.
- **Evidence for live claims (findings 4, 11, 12).** `DOKPLOY-RETIRE-1.md` records the 2026-11-18 live reads
  (`github_server_status`: hosts pc, workshop, potato, all owner; `rack_list_schedules`: `playground-sweep`
  `last_outcome: ran`). `DECISIONS.md` (NO-SHARED-HOST-1) names the source files for the pool, the owner check and the
  refusal. `LOG-FAILURES-3.md` points at the saved raw log of run 44125265769.
- **RETIRED-POOL-VIEW-1 (finding 5).** A workspace row closed when the pool was retired now reads `retired_pool: true`,
  `cleanup: "manual_by_server_owner"` and a note, never a bare "disposed" that looks like a checked teardown.
  `DECISIONS.md` says so. Acceptance: `tests/unit/playground-pool-retired.test.js`.
- **LOG-FIXTURES-1 (findings 6–9).** Real logs, saved verbatim in `tests/fixtures/logs/`: dotnet/xUnit (windows-door
  run 44125265769), vitest 5.1.1, node:test TAP and spec (node 22.23.4), pytest 9.1.1 (normal and `-q`), go 1.24.7
  (normal and `-v`). They found five real gaps, now fixed:
  - node:test TAP reasons began with YAML bookkeeping (`---`, `duration_ms`, `type`, `failureType`, `error: |-`);
  - node's spec reporter (`✖ name (1.2ms)`) was not recognised at all;
  - pytest's reason was the run's tally line, not the one-line reason on the `FAILED … - reason` line;
  - `go test -v` prints a test's messages before `--- FAIL`, so the reason was the next test's `=== RUN` lines;
  - summary lines of these runners (`ℹ tests`, `1 failed, 1 passed in`, `=== RUN`, `--- PASS`) now end a reason.
  Acceptance: `tests/unit/actions-read.test.js`, the LOG-FIXTURES-1 cases.
- **GIT-KEY-IDLE-1 docs (finding 10).** The card and catalog now say what the code does: `hours` accepts 1–24, and the
  idle window is never less than 8 hours.
- **Unproven items answered.** The `operator` mark is server-side only (`operatorConnection()` in
  `src/core/authority.js`, applied by the operator's own database route). REPLAY-STALE-1's cross-tool case is
  intentional and bounded (written into `AGENT-FB-1117.md`).

- **DIFF-PAGES-1 (Vivienne's ask, same night).** `github_pr_get_diff` can page a long diff: `maxChars` (200–3500,
  default 3000 once paging), then `textOffset` + `expectedDiffHash` from the returned `continue` call. Each page states
  `total_chars`, `diff_hash` and `complete`; a diff that changed between pages (a new push) is refused rather than
  mixed. Without these arguments the tool answers as before. Acceptance: `tests/unit/pulls-read.test.js`, DIFF-PAGES-1.
- **Map refreshed** (relational-map rule, adopted 2026-11-18): log summaries and the retired-pool rows.

## Drift check

No migration, no new tool, no change to who may do what. Only answers get more honest and more complete.
