# 2026-10-27 — C-11, canonical read aliases and direct-tool manifest (#429, #434)

**Current state: source implemented on feature branch, full CI and review pending. No merge, issue closure or release yet.**

Scope chosen after merged PR #437 / issue #427 closed. One bundled outcome: the formerly inconsistent branch/ref and pull_number/number spellings now work in normal and wrapped tools without weakening argument schema or allowing conflicts, while a new github_tool_manifest reports profile-visible direct tools with stable deterministic per-contract digests and a revision changelog hash.

Acceptance tests are in tests/unit/code-read.test.js, tests/unit/pulls-read.test.js, and tests/unit/meta-tools.test.js, with fake GitHub shape checks. Key paths: src/tools/define-read.js, code-read.js, pulls-read.js, src/core/meta.js, and src/tools/meta.js. No GitHub writes, new credentials, spending, or production change. No real-world test is claimed. Exact-head ci, release-policy, and review all remain mandatory before merge; issues #429 and #434 must be explicitly read back as closed after merge.

Next: open PR once docs/validator are reconciled, inspect CI failures and reviews in one pass, fix, green-check, merge at exact head, then independently verify issue closeout. Issue #428 and remaining #430–#433/#435–#436 remain open.
