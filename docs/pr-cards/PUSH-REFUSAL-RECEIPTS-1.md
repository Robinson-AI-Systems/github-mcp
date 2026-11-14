# PUSH-REFUSAL-RECEIPTS-1: push exceptions for a refused file that never reached GitHub

## Owner approval 2026-11-13

A push to development-rack was refused for random test sign-in fields in a new checker file. The owner exception (FIXTURE-EXCEPTION-1) could not be granted, because `check` and the push-door verification read the blob from GitHub, and the push guard refuses that very blob. Chris was offered two choices: switch the rule off for the repository, or fix the scanner. He chose "Fix the scanner first."

## Outcome and acceptance

Outcome: when the push guard refuses credential-shaped content, it reports value-free receipts: path, blob SHA, rule, line and value fingerprint. They are never values or source. The control plane keeps them per repository, for 7 days, up to 200.
- The refusal message prints the blob SHA and value fingerprints.
- `github_content_protection_check` answers a refused blob's findings from its receipts when GitHub has no such blob.
- `github_security_scanner_configure` verifies a push exception for a refused blob through the push door from the receipt, using the guard's own exception rule (path + rule + value fingerprint).
- Other doors still need the blob on GitHub. An unrecorded blob or a wrong fingerprint is refused.
- The next push is still re-scanned byte for byte.

Accepted by `tests/unit/push-refusal-receipts.test.js`, which includes parity with `blockingPushFindings`, together with the FIXTURE-EXCEPTION-1 suite.

## Drift check

Changes:
- `src/github/push-refusals.js` (new);
- `workers/native-git/upload.js` (value fingerprints on refused findings);
- `workers/native-git/remote-hook.mjs` (receipts and a clearer refusal);
- `src/git-remote/api.js` (store the receipts);
- `src/tools/scanner-verification.js` and `src/tools/code-read.js` (receipt fallbacks for refused blobs).

Pushes without findings, and exceptions for blobs that are on GitHub, behave as before. Status note: `docs/status/2026-11-13-push-refusal-receipts.md`.
