# 2026-11-10: worker-down wording and "checks still running"

Owner feedback: (1) git setup refused for 20+ minutes with "all workspace hosts busy, primary unavailable"; (2) after a change was sent without git, checks took ~7 minutes to start and the merge tool answered a bare "not ready".

## What changed
- When no workspace host answered at all (every host unavailable or switched off), the refusal now says so, says the worker may be off or restarting, and names the routes that need no worker (`github_content_push_files`, `github_pr_create`, `github_workflow_merge_when_green`). Reason code is unchanged (`native_hosts_busy`). A mix that includes a busy or paused host keeps the old busy wording.
- `github_workflow_merge_when_green` answers `checks_running` (not `not_ready`) when the only blocker is required checks that have not finished and none has failed. It says nothing needs repairing and how to wait.

## Not fixable in code
- The worker itself runs on the owner's PC; when it is down it has to be restarted there.
- GitHub can take several minutes to start checks on a commit made through the API.
