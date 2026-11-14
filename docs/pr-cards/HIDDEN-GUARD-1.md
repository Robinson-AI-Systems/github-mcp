# HIDDEN-GUARD-1 — Never commit the redaction placeholder in place of real text

## Request (2026-11-11)

Owner, 2026-11-11 12:10 MST (main chat): "If we can permanently fix this 'hidden' problem so it doesn't happen in the
future, that would be great."

The failure, twice in development-rack: an agent edited `controller/rack_controller/executor.py` from a copy that came
through a redacting read (an archive download or file read), and pushed it back. The read had replaced
`{mig_pw}`, `{rt_pw}` and `{password}` inside three f-strings with the placeholder `[hidden]`, so the commit replaced
real code with the placeholder (2026-11-05 #4, repaired by hand in #5; again 2026-11-11 e5335e6). After the host
installed that commit, every new build's job database rejected its own login, and the first tracked rack-mcp release
failed. In neon-mcp the same day, an AGENTS.md edit was abandoned because the write-back would have corrupted a
protected value. Restoring the real lines through this server was refused by content protection, while the blanked copy
had passed. That asymmetry is the root cause.

## Outcome and acceptance

1. **Code interpolations are not credentials.** A database-URI password slot, or a password assignment, whose whole
   value is one template interpolation (`{name}`, `{name!r}`, `{name:fmt}`, `${NAME}`, `$NAME`, `%s`, `%(name)s`,
   `{{ name }}`) is source code. Reads no longer blank it and writes no longer refuse it. Real passwords are still
   matched and redacted exactly as before.
2. **A blanking change is refused everywhere it can be written.** A change is refused when a line it adds contains a
   placeholder (`[hidden]`, or the longer `[hidden …]` forms some fleet servers use) and a line it removes in the same
   place is that line with the placeholder spots holding other text. In other words, the change is exactly "redact this
   line". Checked at:
   - the native worker's `push` (`refuseBlanking`), the one step every native route passes through: archive and git
     uploads, `write_file`, `github_repo_change` and Playground commits. It reads only the commits the push would add.
   - `github_content_put_file`, `github_content_push_files` and `github_content_edit_files`, against the file's current
     text read raw from GitHub.

   The refusal names the paths and lines (never the replaced text) and says to edit from a byte-exact copy (a git-mode
   download or clone). Nothing is written.
3. New lines that legitimately contain the placeholder (redaction code, tests, docs), and placeholder lines already in a
   file, are never refused.

Accepted when `tests/unit/placeholder-guard.test.js` passes. It covers the exact e5335e6 lines, unified-diff parsing with
paths and line numbers, legitimate placeholder lines, interpolations neither flagged nor redacted, real passwords still
caught, and the worker refusing a real blanked commit while allowing an ordinary one. All existing protection, push-fixture,
code-write, scanner and native-git suites must pass unchanged, and `ci` + `release-policy` must be green at the exact head.

## Design notes

- `src/github/placeholder-guard.js`: pure functions (`isBlanking`, `blankedLines`, `blankedInDiff`,
  `blankingRefusalText`), bounded (4,000-character lines, 200,000 comparisons), no I/O.
- The worker diff (`git log -p -U0 <local> --not --remotes [remote head]`) passes through the worker's usual output
  redaction. A removed line that is itself a real secret is therefore not compared, and removing a real secret is
  allowed, as it should be. The interpolation fix keeps the code case (the actual failure) visible to the guard.
- `INTERPOLATION` (content protection) and `TEMPLATE` (assigned literals) are anchored whole-value matches. A literal
  that merely contains braces is still judged as before.

## Drift check

Builds on PUSH-FIXTURE-1/2 (fixture allowances unchanged) and GIT-UPLOAD-1 (upload scanning unchanged). New: one refusal
class (blanking) on the four write paths, and narrower credential matching for whole-value interpolations. No GitHub
request, credential, permission, setting or schema change.
