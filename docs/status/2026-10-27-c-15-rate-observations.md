# 2026-10-27 — C-15 rate visibility (#435)

Branch: `ai/chatgpt/c-15-scoped-rate-metadata-20261027`, plan-first commit `6964289526d7098a7ac43467946b93259f418a49`. Adds per-request observed rate headers to final tool response meta and shares only this collector across same-dispatch nested tool calls. Separates rate-pacing/cache keys by actual credential kind, preserving existing app identity for legacy observations. Cached preflight blocks never masquerade as a fresh provider budget. No extra provider calls, production mutation or release.

Tests, full exact-head CI, PR review/merge and independent issue readback are not yet verified. Do not claim #435 complete until those gates pass.

## Final checked disposition

PR #442 exact final source head `2a9b028a71ebc3e562824ba868199c9e5a6b2d30` passed `ci` and `release-policy`; no unresolved review threads. Custom guarded merge confirmed merged; issue #435 independently read `closed/completed`. Main commit `c0dbfd863cb34e9aa1213d470538856309d45f7e`. No release or real-world client acceptance asserted.
