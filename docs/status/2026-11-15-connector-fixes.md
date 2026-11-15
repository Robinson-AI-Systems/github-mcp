# 2026-11-15: repo_change continues after an applied upload; never-started jobs explain themselves

- Owner feedback 2026-11-15 (found while shipping development-rack #224):
  - `github_repo_change` with a workspace upload that had already been applied refused with "This upload was already
    applied", although the files were in the workspace. It only worked when `upload_id` was left out.
  - GitHub stopped every test job before it started (billing). `github_actions_get_run_logs_summary` said "no
    diagnostic lines", pointed at a job log, and that log tool answered "not found". GitHub's reason was only in the
    check run's annotations.
- Now:
  - `github_repo_change` confirms the upload's state is `applied` and commits the files already in the worktree.
  - Log summary and job log read the job's annotations when there is no log. A job with no runner and no steps is
    marked `never_started`, and the summary drops the dead `full_log` pointer.
- Tests: `tests/unit/repo-change.test.js`, `tests/unit/actions-read.test.js`.
- PR card: `docs/pr-cards/CONNECTOR-FIXES-1115.md`.
