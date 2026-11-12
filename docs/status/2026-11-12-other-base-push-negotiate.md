# 2026-11-12 — Merge into any base branch; push negotiation warning

- `github_workflow_merge_when_green` (and `github_workflow_merge_anyway`) no longer refuse a PR just because its base is not the default branch; the checks and rules of that base branch apply.
- `github_git_remote_setup` command now also runs `git config --global push.negotiate false`, so pushes stop printing "push negotiation failed; proceeding anyway".
- Follow-up the same day (owner request 04:18 MST): merging into any branch but the default needs a deliberate step. Without `mergeIntoBranch: "<that branch>"` the answer is `needs_branch_confirmation` (nothing is checked or written); a name that does not match the PR's base is refused the same way. Applies to `github_workflow_merge_when_green` and `github_workflow_merge_anyway`.
