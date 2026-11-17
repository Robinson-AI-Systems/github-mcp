# LOG-FAILURES-3 and MERGE-WAIT-2: clean last reason; a failed job is not "still running"

## Owner request 2026-11-17

Chris: "fix the three problems you found instead of just reporting them". Two of them are in GitHub Unleashed.

## Outcome and acceptance

- **LOG-FAILURES-3.** A failing test's reason stops at the test run's own summary or the CI step's end (dotnet, vitest/jest, node:test, pytest, go, `##[error]`). Acceptance: `tests/unit/actions-read.test.js`, the dotnet case and "LOG-FAILURES-3: … run summaries end the last reason"; live re-check on windows-door run 44125265769.
- **MERGE-WAIT-2.** `github_workflow_merge_when_green` with `waitForChecks`: when the wait found a job that already failed (`failed_runs`), answer `checks_failed` with the job names and a `why_tool` call, never "Checks are still running". Acceptance: `tests/unit/conn-fb-1.test.js`, "MERGE-WAIT-2: …".

## Drift check

Changes: `src/github/log-summary.js`, `src/tools/workflows-merge.js`, tests, docs.
