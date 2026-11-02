# VIS-1 — Larger results visible to structured-only clients

## Owner approval 2026-11-01

Chris relayed an outside agent's report ("Anything over roughly 1 KB per response arrives as a summary with the content
omitted… a response-size setting on your server that could be raised") within the approved "finish the remaining work"
scope; it is a fix to the existing C-12 compact envelope, not new scope.

## Outcome and acceptance

Outcome: clients that show only `structuredContent` see ordinary file reads, logs and lists whole (up to the repo's 8 KB
result rule), and an explicitly requested whole file or line/byte window is never compacted. Accepted when
`tests/unit/result-envelope.test.js` and `tests/unit/code-read.test.js` prove the budget, the overflow omission, nested
calls and explicit windows, and the full JSON copy in `content[0].text` is unchanged.

## Drift check

No new tool, setting, credential, migration or spend. The canonical full JSON, RTC reconstruction, credential checks and
result handles are unchanged; only how much of the duplicate structured copy is kept changes.
