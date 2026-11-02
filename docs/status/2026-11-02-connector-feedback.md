# 2026-11-02 — connector feedback from the fac-ultra build (CONN-FB-1)

Card: [CONN-FB-1](../pr-cards/CONN-FB-1.md). GitHub API side of the owner's coding-agent fix list; the native-workspace
items are another builder's card.

- New default-list read `github_check_wait`; `github_workflow_merge_when_green` gains `waitForChecks`.
- Extra places limited to named repositories: push_files, edit_files and review-thread checks work for the listed
  repositories (pinned GraphQL documents, same branch-rules check as REST). Other GraphQL stays refused.
- npm lockfiles (`pgpass` entries) are no longer refused as database passwords; refusals name line and rule.
- `meta.github_rate` lists only the acting account; unknown-argument errors list the valid ones; missing branches report
  `ref_not_found` in commit_list and the push/PR writers; open_pr previews are plain previews; PR results carry the
  essentials; run-log summary accepts pr/ref and shows the lines before a bare exit code; job-log continuation names
  match; content_get startLine alone; batch says how to get whole text; pr_list says merged.

Verified: `tests/unit/conn-fb-1.test.js` (fake GitHub validated against the vendored schema) and the full unit suite.
Not verified: a real call on the collaborator repository (needs a deployed release; acceptance queued, not a merge gate).
