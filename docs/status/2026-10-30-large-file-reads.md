# 2026-10-30 — Easier whole-file and large-window reads

Prompted by a coding agent's real-use feedback: large files sometimes came back as a short preview. `github_content_get` now:
- adds a plain-words `read_all` note whenever text is cut short, with the exact call for the whole file (`fullText: true`, up to 1 MB) before the exact-byte (base64) fallback;
- allows line windows of up to 500 lines (was 100) and returns them whole (up to 48 KB) instead of re-cutting them to a preview;
- returns `complete` and `next_start_line` on line windows so an agent can read a big file in consecutive chunks without arithmetic.

Verified: `tests/unit/code-read.test.js` (300-line window with cursor, read_all note, range limits), plus replacement-parity and review-thread tests. Not changed: byte-window reads, content protection, the 1 MB ceiling.
