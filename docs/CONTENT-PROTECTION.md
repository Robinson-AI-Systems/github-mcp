# Content protection and false positives

Keep credential protection. A format match is a candidate, not proof that GitHub issued a working credential. Text reads redact candidates; byte reads refuse the complete file because allowing a token to be reconstructed across separate windows would defeat protection. Redacted text now explicitly reports `content_protection.content_exact=false`, and blocked byte reads name the diagnostic tool.

## Identify and correct a false positive

Call `github_content_protection_check` with the same owner, repository, file path and ref, or the immutable `blobSha` returned by the original read. It uses the same detector as redaction and returns the blob identity, detector revision, rule, one-based line/Unicode column and zero-based byte range. It returns no matched values, source snippets or content, and makes no provider-token-validity claim. It does not post a report or change the repository.

Inspect the named location in your own editor. Give your agent this value-free report and a harmless minimal reproduction. The correction belongs in the precise detector rule, with both negative source-code and positive credential regression tests. Recheck the same immutable blob through full text and byte windows after deployment. A source change naturally gets a new blob identity; no global allowlist is needed.

If a harmless fixture deliberately has the exact shape of a real credential and cannot be distinguished safely, use the response's local Git clone/cat-file argument arrays or your direct GitHub access to save exact bytes locally. Keep those bytes outside chat. The MCP does not accept a token as a tool argument, disable scanning for a whole repository, or automatically exempt a credential-shaped fixture merely because it says FAKE. This is an explicit fallback, not byte-exact MCP parity for that ambiguous file.

## Measured defect and correction, 2026-10-28

The prior RTC pattern matched any nonempty suffix after the pass prefix. Across 325 tracked files under `src/` and `api/` at source `4ea56dee`, it matched 20 occurrences, all harmless RTC table identifiers in `src/db.js`. The same public file contained 98,401 characters / 98,404 bytes: a live full-text read returned 98,275 characters, and byte windows correctly refused because the detector misclassified these identifiers. The official read and reviewed source matched exactly.

The issued RTC bearer format is a 43-character base64url suffix (`randomBytes(32)`); the HTTP authenticator requires exactly that format. Redaction now requires at least that issued length, retaining conservative redaction of an embedded/extended candidate. The measured 20 identifier matches become zero. Real full-length passes still redact in normal, retained, nested, error and property-name cases. Validation also stops reflecting truncated long argument names, since truncating a credential before redaction can leak its prefix.

This is a labeled local regression corpus, not a universal false-positive-rate estimate or a claim that every remaining GitHub/private-key matcher is perfect. The new diagnostics make remaining cases reproducible without exposing secrets. Other detector families remain active.

## Protection before shortening text

The shared detector runs on complete provider text before patch, comment, search-fragment, public-data, log, preview-summary or persistence caps. Shortening first can turn a real credential into a prefix the full-format detector cannot recognize. Boundary regressions cover 306 overlap positions at common caps, actual commit/comparison patch handlers, provider logs and journal summaries. The shared implementation lives in `src/github/content-protection.js`; output shaping and diagnostics reuse it. No-match results are explicitly not a clean-file verdict.

Search fragments and log excerpts may already have been shortened upstream. Those excerpts retain conservative RTC-prefix masking because a complete credential may no longer be visible. They are not byte-exact file reads; use the immutable full-file diagnostic/read for an exact source decision. This prevents fragment-prefix leakage without reinstating false-positive blocks on complete harmless source files.
