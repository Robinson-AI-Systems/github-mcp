# SCANNER-CFG-1114: scanner configure says why it refused

## Owner request 2026-11-14

An agent adding push exceptions for four false positives in development-rack got "The current state could not be read, so nothing was sent. Try again in a moment." twice. Chris: fix the scanner, don't work around it.

## Outcome and acceptance

- **The real reason.** The read step runs the request's own checks (settings validation, verification cases). When one of those refuses, the write layer now answers with that message: `refusedBy: request`, `reason_code: invalid_request`, `retryable: false`, in any connection mode; a dry run shows it as its warning. Real read failures (network, a fault in this server, GitHub errors) still read as "could not be read".
- **Which field.** "Scanner settings accept rule structure, never credential values" now names the field path holding credential-shaped text (e.g. `addSuppressions[0].reason`), never the text.
- **One name.** A verification case accepts `valueFingerprint` as well as `fingerprint`; two different values are refused.

Accepted by `tests/unit/scanner-configure-1114.test.js`.

## Drift check

Changes: `src/core/write.js`; `src/github/scanner-policy.js`; `src/tools/scanner-verification.js`; docs.
