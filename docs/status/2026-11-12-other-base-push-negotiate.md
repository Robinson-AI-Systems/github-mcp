# 2026-11-12 — Merge into any base branch; push negotiation warning

- `github_workflow_merge_when_green` (and `github_workflow_merge_anyway`) no longer refuse a PR just because its base is not the default branch; the checks and rules of that base branch apply.
- `github_git_remote_setup` command now also runs `git config --global push.negotiate false`, so pushes stop printing "push negotiation failed; proceeding anyway".
