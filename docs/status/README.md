# Status notes (one file per PR)

`docs/STATUS.md` is a short current-state page plus the release-acceptance queue; it is not a running log. Every PR records its status as its
**own file** here instead:

`docs/status/YYYY-MM-DD-<short-topic>.md` — a few lines: what merged or changed, branch/PR/head SHA if in progress,
what is blocked, what is next. The docs-drift check accepts any file in this folder in place of an edit to `docs/STATUS.md`.
Newest first when read with `ls -r docs/status`. When a note stops being current, leave it here (it is history); update the short lists in
`docs/STATUS.md` only when the live/merged/in-progress picture changes. Long historical STATUS entries are in
`docs/archive/STATUS-2026-10-30-history.md`.
