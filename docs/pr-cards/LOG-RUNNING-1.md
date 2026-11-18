# LOG-RUNNING-1: a running job's log says "still running", not "expired"

## Found 2026-11-18

While watching a release, `github_actions_get_job_log` on a job that was still running answered "GitHub has no log for this job (expired or not uploaded)". GitHub only publishes a job's log when the job finishes, so the note sent callers looking for a problem that was not there.

## Outcome and acceptance

- A job that is queued, waiting or in progress answers `still_running: true` and a note to wait (github_check_wait or github_actions_get_run) and read again. Never-started and really missing logs keep their own notes.
- Acceptance: `tests/unit/actions-read.test.js`, the LOG-RUNNING-1 case.

## Drift check

No new tool, no change to who may do what; only the wording and one field.

## Also: RUNNER-DEADLOCK-1 (same morning)

With potato and the Workshop offline the org has one Actions runner. A release's promotion job waited for the newest `release-policy` check on main, but that newest copy was another release run's job, queued behind this very job on the only runner, so promotion sat until its 15-minute timeout (seen live on rack-mcp). `.github/release/promote-live.mjs` now goes by the newest finished run of each required check; a queued copy no longer holds it back, a newer failure still blocks it, and nothing passes without a finished success. Acceptance: `.github/release/promote-live.test.mjs`.
