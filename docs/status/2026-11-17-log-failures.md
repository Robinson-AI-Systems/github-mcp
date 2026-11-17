# 2026-11-17: failing tests come with their reasons (LOG-FAILURES-1)

## What went wrong
A windows-door run failed with six tests. `github_actions_get_run_logs_summary` listed the tests, but its error lines held the reason for only one of them. To find why `Files_ListSearchAndRoots` failed, the agent paged the 150,000-character job log in 4,000-character windows. `github_actions_get_job_log` already had `search`, but nothing pointed to it.

## What changed
- **Run summaries:** each failed job now carries `test_failures`, one entry per failing test, with the lines that follow its marker (assertion, exception, first frames). The markers recognized are xUnit `[FAIL]`, dotnet `Failed ... [time]`, node:test `not ok`, vitest/jest, pytest `FAILED a::b`, and go `--- FAIL:`. Each job also carries a ready `search_log` call into its own log.
- **Job-log summaries:** they return `test_failures` too.
- **Tool description:** it now says to search before paging.

## Tests
`tests/unit/actions-read.test.js`, "failing tests with their reasons": the xUnit case from the real run, plus node:test, go and pytest, and a clean log.

## Follow-up: LOG-FAILURES-2 (PR #661)

The live check on windows-door run 44125265769 listed all 6 failing tests, but
every `reason` was empty. `dotnet test` prints xUnit's `[FAIL]` line and then
its own `Failed <test> [time]` block (Error Message, Stack Trace) for the same
test; the second line was skipped as a duplicate. A repeated marker for the same
test now continues that test's entry, so the reason (for example "relative path
is required") comes through. A unit test uses the exact PC-runner format.
