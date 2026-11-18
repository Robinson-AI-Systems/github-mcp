# 2026-11-18 — RETURNED-COUNT-1 and WORKSPACE-LIST-2

Owner feedback from a recovery session: a PR list said `count: 82` but carried 13 rows (the 8 KB reply limit), and only `kept_result` said why; and the workspace list needed a repository filter and per-row state.

- Every list reply now has `returned_count` beside `count`, and `all_returned: false` plus a plain `returned_note` when rows were cut.
- `github_git_workspace_list`: `owner`/`repo` filters; per row branch, head, dirty files, conflicts, ahead/behind the tracking ref, GitHub's head; never renews a lease; `details: false` for names only.
- Card: `docs/pr-cards/RETURNED-COUNT-1.md`.
