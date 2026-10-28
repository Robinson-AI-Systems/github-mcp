# 2026-10-27 — C-11, canonical read aliases and direct-tool manifest (#429, #434)

**Current state: merged PR #438, exact-head `ci` and `release-policy` both green, review thread resolved.** Merge commit `a130e4cbfd6b59f39da76283232c226cac65d608`; issues #429 and #434 read back CLOSED/completed. No deployment/live acceptance claimed.

Scope chosen after merged PR #437 / issue #427 closed. One bundled outcome: the formerly inconsistent branch/ref and pull_number/number spellings now work in normal and wrapped tools without weakening argument schema or allowing conflicts, while a new github_tool_manifest reports profile-visible direct tools with stable deterministic per-contract digests and a revision changelog hash.

Acceptance tests are in tests/unit/code-read.test.js, tests/unit/pulls-read.test.js, and tests/unit/meta-tools.test.js, with fake GitHub shape checks. Key paths: src/tools/define-read.js, code-read.js, pulls-read.js, src/core/meta.js, and src/tools/meta.js. No GitHub writes, new credentials, spending, or production change. No real-world test is claimed. Exact-head ci, release-policy, and review all remain mandatory before merge; issues #429 and #434 must be explicitly read back as closed after merge.

Completed: PR #438 merged, exact-head required checks green, one reviewer finding fixed, thread resolved, issue closeout independently verified. Next independent outcome: #428 / C-12. Issue #428 and remaining #430–#433/#435–#436 remain open.
