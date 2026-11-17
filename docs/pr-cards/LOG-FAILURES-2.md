# LOG-FAILURES-2: dotnet test failures keep their reasons

## Found by the live check of LOG-FAILURES-1, 2026-11-17

On windows-door run 44125265769 the run summary listed all 6 failing tests, but every `reason` was empty.

## Outcome and acceptance

- **Cause.** `dotnet test` prints xUnit's `[FAIL]` line and then its own `Failed <test> [time]` block (Error Message, Stack Trace) for the same test. The second line was dropped as a duplicate, and reason gathering stopped at it.
- **Fix.** A repeated marker for the same test continues that test's entry; an entry with no reason takes the later block's reason.
- **Acceptance.** `tests/unit/actions-read.test.js`, "dotnet test: the xUnit [FAIL] line, then …", using the exact PC-runner format; then a live re-check of run 44125265769.

## Drift check

Changes: `src/github/log-summary.js`, tests, docs.
