# 2026-11-01 — larger visible results (VIS-1)

Outside agent feedback: "anything over roughly 1 KB arrives as a summary with the content omitted."

Cause: the compact envelope (#428) dropped every string over 200 bytes and every object over 600 bytes from
`structuredContent` once a reply passed 1.6 KB. Clients such as Claude show only `structuredContent`, so file text, logs
and job lists vanished even though the full JSON was in `content[0].text`.

Change (`src/core/result-envelope.js`, `src/tools/dispatch.js`):
- `structuredContent` keeps whole fields up to an 8 KB budget (the repo's existing result rule), smallest first; only
  fields that do not fit are listed in `omitted_fields`. Read results are already fitted to 8 KB with a handle, so
  ordinary reads now arrive whole.
- A whole file (`fullText: true`) or a line/byte window the caller asked for explicitly is never compacted.

Verified: `tests/unit/result-envelope.test.js` (budget, overflow, nested), `tests/unit/code-read.test.js` (whole file and
400-line window stay visible), write-core and playground-run digests still survive a compacted reply.

Next: release, then read a large file live through a compact client.
