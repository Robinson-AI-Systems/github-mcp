# 2026-10-30 — Line-number edits for large files

`github_content_edit_files` now accepts `lineEdits` per file (replace, insert or delete whole lines by number) alongside
find-and-replace. For agents with no native Git or terminal, this makes edits to files of hundreds of kilobytes cheap:
read a 100-line window with `github_content_get` (`startLine`/`endLine`), then edit those lines by number without
quoting long unique anchors. Numbers refer to the file as it is at the branch head the preview read; edits must not
overlap; an optional `expectFirstLine` refuses the edit if the line is not what the agent expected. Line edits apply
first, then find-and-replace. The existing `expectedHead` guard still refuses if the branch moved.

Verified: unit tests in `tests/unit/code-write.test.js` (apply, insert, delete, stale/overlap/past-end/backwards refusals).
Not done: the Playground terminal/runtime (PLAY-1) is still blocked on the Docker address-pool fix on the host.
