# 2026-11-10: a failed job is reported while the run is still going

Owner follow-up on PR #595: when the quick `check` job failed, `github_check_wait` kept answering "still running" for about 4 minutes because the required roll-up `ci` only reports after every job ends, and `github_actions_get_run_logs_summary` said "no run has failed" because the run itself was unfinished.

## What changed
- `github_check_wait` returns at once when a check run at the head has already failed while a required check has not reported yet (the roll-up pattern). The answer stays `still_running` but adds `failed_runs` and says to read why now. A failed run on its own never makes the answer red.
- `github_actions_get_run_logs_summary` (with `pr` or `ref`) now also explains a failed job inside a run that is still in progress.
