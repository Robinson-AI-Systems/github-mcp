# CONNECTOR-FIXES-1115: repo_change after an applied upload; GitHub's reason for jobs it never started

## Owner request 2026-11-15

Chris: report every connector shortcoming so it gets fixed. Two showed up while shipping development-rack #224.

## Outcome and acceptance

- REPO-CHANGE-APPLIED-1: `github_repo_change` given an `upload_id` that was already applied to that workspace
  (for example by `github_git_workspace_upload` apply) commits the files already in the worktree. Before, it refused
  the whole change with "This upload was already applied". Any other refusal still stops the change.
- JOB-NOT-STARTED-1: a job GitHub never started (billing, no matching runner) has no log, only annotations.
  - `github_actions_get_run_logs_summary` now gives GitHub's failure annotation as `error_lines`
    (`logs_source: annotations`, `never_started: true`), and leaves out the dead `full_log` pointer.
  - `github_actions_get_job_log` answers with the annotations instead of a bare "not found".

Accepted by `tests/unit/repo-change.test.js` (the new case fails on the old code) and
`tests/unit/actions-read.test.js` (two new cases).

## Drift check

Changes: `src/tools/repo-change.js`, `src/tools/actions-read.js`, the two test files, this card and
`docs/status/2026-11-15-connector-fixes.md`. No tool is added or renamed.
