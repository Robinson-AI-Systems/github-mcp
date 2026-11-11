# 2026-11-11 — HIDDEN-GUARD-1: the redaction placeholder can no longer replace real code

**What happened.** Edits made from redacted reads of development-rack's `executor.py` were pushed back with the literal
placeholder `[hidden]` where three code interpolations had been (2026-11-05 and 2026-11-11). After the host installed the
second one, every new rack build's job database rejected its own login. The real lines could not be restored through this
server, because content protection treated `{mig_pw}` as a password, while it accepted the blanked copy.

**What changed.**
- Content protection no longer treats a whole-value code interpolation (`{pw}`, `${PW}`, `$PW`, `%s`, `{{ pw }}`) as a
  credential. Reads stop blanking such code, and its restore is accepted. Real passwords are matched as before.
- Every write path refuses a change that turns an existing line into its placeholder form: the native worker's push
  (all native routes), `github_content_put_file`, `github_content_push_files` and `github_content_edit_files`. The refusal
  names paths and lines, never values.

**Still true.** Archive downloads and file reads remain redacted. Edit from a git-mode download or clone when a file has
credential-shaped content.

Card: `docs/pr-cards/HIDDEN-GUARD-1.md`. Repair of the damaged file: development-rack #63.

**FIXTURE-URI-1 (same day).** A documented fake connection-string password (`FAKE`, as AGENTS.md files require) is
now allowed in pushed files; reads still hide it. It had made neon-mcp's AGENTS.md uneditable through any tool.
