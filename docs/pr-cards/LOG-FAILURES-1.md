# LOG-FAILURES-1: failing tests come with their reasons

## Owner request 2026-11-17

Chris asked for GitHub Unleashed to be fixed after the report that finding why one windows-door test failed meant paging a 150,000-character log.

## Outcome and acceptance

- **Run summaries.** `github_actions_get_run_logs_summary` returns `test_failures` for each failed job: one entry per failing test, with the lines after its marker.
  - Supported runners: xUnit, dotnet test, node:test, vitest/jest, pytest and go.
  - It also returns a ready `search_log` call (`github_actions_get_job_log` with `search`).
- **Job logs.** The `github_actions_get_job_log` summary returns `test_failures` as well, and its description says to search before paging.
- **Acceptance.** `tests/unit/actions-read.test.js`, "failing tests with their reasons".

## Drift check

Changes: `src/github/log-summary.js`, `src/tools/actions-read.js`, tests, docs.
