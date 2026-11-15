# CHECK-PARITY-1 and PREVIEW-REASON-1: local check matches CI; refused previews say so

## Owner request 2026-11-14

Chris asked for two problems reported that evening to be fixed.

## Outcome and acceptance

- **CHECK-PARITY-1.** `npm run check` passed changes that CI's docs rule then failed, which cost two extra CI rounds on
  2026-11-14. A local run used to skip the rule (no `BASE_SHA`) or compare only committed work. Locally, the base now
  defaults to where the branch left `origin/main`, and uncommitted and new files count. CI, which runs on a clean
  checkout with `GITHUB_ACTIONS` set, behaves exactly as before. Accepted by `tests/unit/check-scripts.test.js`, which
  runs the script in real throwaway git repositories.
- **PREVIEW-REASON-1.** A preview whose read step refused on purpose (its own safe message, for example content
  protection) said "(its current state could not be read)" with `reason_code: preflight_read_failed`. It now says it
  was refused before anything was sent and carries the refusal's own code (`content_protection`). Real read failures
  are unchanged. Accepted by `tests/unit/content-scan-1.test.js`.

## Drift check

Changes: `scripts/check-docs-updated.mjs`, `src/core/write.js`, tests, docs.
