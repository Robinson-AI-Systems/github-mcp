# CHECK-WAIT-EARLY-1 — A failed job is reported before the whole run ends

## Owner approval 2026-11-10

Chris asked in chat on 2026-11-10 10:28 MST for the gap reported on PR #595 to be fixed: a red `check` job took about 4 minutes to surface because the wait tool and the log summary both waited for the run to finish.

## Outcome and acceptance

Outcome: `github_check_wait` hands back the failed run names at once when a required roll-up has not reported, and `github_actions_get_run_logs_summary` explains a failed job in an unfinished run. Accepted when `tests/unit/conn-fb-1.test.js` covers both.

## Drift check

Read-only tools; no permission, credential, write or request change. A failed run never turns the overall answer red by itself, so merge decisions are unchanged.
