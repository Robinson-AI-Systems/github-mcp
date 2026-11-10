# WORKER-DOWN-MSG-1 — A down worker is reported as down, and unfinished checks as waiting

## Owner approval 2026-11-10

Chris reported in chat on 2026-11-10 10:00 MST that git setup refused for over 20 minutes ("all workspace hosts busy, primary unavailable") and that, for a change sent without git, checks took about 7 minutes to start while the merge tool answered "not ready".

## Outcome and acceptance

Outcome: when no workspace host answers at all, the refusal says so and names the routes that need no worker; `github_workflow_merge_when_green` answers `checks_running` (not `not_ready`) when the only blocker is required checks that have not finished. Accepted when `tests/unit/worker-pool.test.js` covers the unreachable wording (including its length limit and a mix with a busy host) and `tests/unit/conn-fb-1.test.js` covers the `checks_running` answer.

## Drift check

Wording and one new status value only; no tool, credential, permission or request change. Reason code `native_hosts_busy` is unchanged. The worker itself runs on the owner's PC and is not changed here.
