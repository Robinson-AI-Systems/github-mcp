# FIXTURE-URI-1 — A documented fake connection-string password can be pushed

## Request (2026-11-11)

Found while applying the owner's 10:54 release ruling to neon-mcp. Its AGENTS.md security rules carry the documented
fake example (a `postgresql` connection string whose password is `FAKE`). Content protection treated it as a real
password on push, so no tool could edit any line of that file: every write was refused, and a write-back from a
redacted read would have corrupted the example. PUSH-FIXTURE-1/2 already allow documented FAKE GitHub tokens and
evident placeholder literals in pushed files. The connection-string rule did not honour that opt-in.

## Outcome and acceptance

Under the push/write opt-in only (`fixtures: 'allow'`), a connection-string password that is an evident placeholder
(same `isEvidentPlaceholder` rule: `FAKE…`/`fake…` without another credential prefix, or lowercase placeholder words)
is not a credential. Reads, redaction, scanner reports and tool arguments never pass the opt-in, so they still hide it.
Real passwords are refused on push as before. Accepted when the FIXTURE-URI-1 tests in
`tests/unit/placeholder-guard.test.js` pass, the push-fixture, protection, secrets and upload suites pass unchanged,
and `ci` + `release-policy` are green.

## Drift check

Extends PUSH-FIXTURE-2's placeholder rule to one more matcher (`database-uri-password`); no other rule, output or
setting changes.
