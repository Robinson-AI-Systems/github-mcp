# RETURNED-COUNT-1 and WORKSPACE-LIST-2: lists say how many rows they carry; the workspace list says where each workspace stands

## Owner request 2026-11-18

Chris, relaying two improvements found during a recovery: "a PR-list response reported 82 results but included only 13 inline; requesting fewer fields returned all 82. An explicit returned_count would make that easier to catch. Second, the workspace list would be more useful with a repository filter and branch, dirty-file, and ahead/behind information in each row."

## Outcome and acceptance

- **RETURNED-COUNT-1** (`src/tools/dispatch.js`, `withReturnedCount`): every read reply that carries a list (`items`) now has `returned_count` right after `count`. When the 8 KB reply limit cut the list, the reply also says `all_returned: false` and one plain `returned_note` ("Only 13 of 82 rows fit in this reply … make the call in kept_result.continue, or ask for fewer fields"). Before, the only sign was inside `kept_result.shown/of`. Applies to every list tool, not only `github_pr_list`, and to `github_get_result` pages.
- **WORKSPACE-LIST-2** (`src/tools/native-git.js`, `src/db.js`, `workers/native-git/engine.js`): `github_git_workspace_list` takes `owner` / `repo` filters (case-insensitive, applied in the query so paging stays correct) and, by default, each row carries `state`, `branch`, `head`, `dirty_files`, `conflicts`, `ahead` / `behind` / `upstream` (against the branch's tracking ref as of the workspace's last fetch), `github_head` and `github_relation` (GitHub's branch now), and `generation`. Reading a row never renews its lease (no-renew inspect with `includeRepository`). `details: false` gives the old quick list. The worker's inspect answer gains `tracking: {upstream, ahead, behind}`; an older worker simply leaves `ahead`/`behind` null.
- Tests: `tests/unit/read-pipeline.test.js` (whole list and cut list), `tests/unit/native-git-service.test.js` (row details on a real worker, dirty count after a new file, repository filter, `details: false`).

## Drift check

Tool behaviour: two reply fields on every list read; one tool's arguments and row fields. Tool count unchanged.
