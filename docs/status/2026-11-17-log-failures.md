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

## Follow-up: LOG-FAILURES-3 and MERGE-WAIT-2 (owner request, 2026-11-17)

Chris asked that the two remaining problems be fixed, not just reported.

- **LOG-FAILURES-3.** The last failing test's reason picked up the test run's own summary and the CI step's end ("Results File: …", "Failed! - Failed: 6, Passed: 548 …", "##[error]Process completed …"). A reason now ends where a run summary or step end begins: dotnet, vitest/jest, node:test, pytest and go summaries, and GitHub's `##[error]` / `##[warning]` lines.
- **MERGE-WAIT-2.** `github_workflow_merge_when_green` with `waitForChecks` once answered "Checks are still running" after 1 second. The wait had stopped on purpose: a job (`check`) had already failed while the roll-up check (`ci`) had not reported. The merge tool ignored that and said "still running". It now answers `status: "checks_failed"` with `failed_runs`, and a ready `why_tool` call to `github_actions_get_run_logs_summary`, so the agent reads why at once instead of calling again.
