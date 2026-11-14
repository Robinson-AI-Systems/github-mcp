# FIXTURE-EXCEPTION-1: owner push exceptions for one exact fake value in one file

## Owner approval 2026-11-13

Chris: "GitHub Unleashed's secret scanner is fully configurable. All you had to do was tweak it." A live attempt showed the gap. The scanner settings could add exact-blob exceptions to file reads, but the git push guard ignored suppressions entirely. Any edit to a test file holding deliberate fake credentials (PenPal's `test/acceptance.test.mjs`, which plants them to prove PenPal's own secret refusal) was refused, whatever the settings said.

## Outcome and acceptance

Outcome: a suppression may carry `pushException: true` and a `valueFingerprint`. The fingerprint is a hash of path, rule and the exact matched text, never the value itself. `github_content_protection_check` now reports each finding's `value_fingerprint`. The push and upload guard (`findingFor` → `blockingPushFindings`) drops exactly those findings. Edits elsewhere in the file keep the exception. A different value, a different file, a different rule, or a second credential added beside the excepted one is still refused. An over-long finding list is never thinned by exceptions.

Configuration needs a pinned verification through a new `push` door, and the push guard itself must show before = blocked and after = allowed for that value fingerprint. The push refusal now tells the agent the exact steps.

Accepted by `tests/unit/fixture-push-exceptions.test.js` plus the existing push-fixture and scanner-settings suites.

## Drift check

Changes:
- `src/github/file-protection.js`: value fingerprints, and the shared push filter.
- `src/github/scanner-policy.js`: two optional suppression fields, validated.
- `src/tools/scanner-verification.js`: the push door and coverage.
- `workers/native-git/upload.js` and `remote-hook.mjs`: pass settings to the guard.

Without push exceptions, behaviour is unchanged: findings are computed the same way and nothing is filtered. Built-in rules are never disabled. Status note: `docs/status/2026-11-13-fixture-push-exceptions.md`. See the drift protocol (DRIFT-PROTOCOL checklist B).
