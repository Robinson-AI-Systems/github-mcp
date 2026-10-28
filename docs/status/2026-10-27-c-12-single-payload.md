# 2026-10-27 — C-12 one-copy lossless MCP result envelopes (#428)

**State: implementation and tests committed to feature branch; CI, review, merge and live verification not yet claimed.**

Owner reports large PR bodies and tool schemas duplicated in both text content and structuredContent. The new core envelope packs only top-level, credential-screened, non-outputSchema read/runner responses when their exact JSON body exceeds 1600 bytes: complete JSON remains in content[0].text once, structuredContent holds small scalars/computed fields, omitted_fields and full_payload_location. Small replies and writes are unchanged. Nested calls remain full for workflow and batch execution. RTC/HTTPS reconstructs full canonical values from that same text before its independent 8 KiB-or-handle policy.

Tests authored: tests/unit/result-envelope.test.js, tests/unit/pulls-read.test.js, tests/unit/meta-tools.test.js. Tests for C-10 exact byte windows now decode full JSON text if metadata is compact. Synthetic fixture expected roughly half the combined payload bytes for large body/schema and no lost data. No successful run of those new tests is claimed until CI.

Next: required source check and exact-head CI plus release-policy, inspect all review comments, repair issues in one patch, merge only when green, then independently read back issue #428 as CLOSED/completed. The current source does not deploy automatically. Other issues #430–#433 and #435–#436 stay open.