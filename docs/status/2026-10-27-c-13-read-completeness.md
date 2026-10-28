# 2026-10-27 — C-13 read-completeness bundle (#430, #435, #436)

**State: scoped and planned, source not yet implemented or tested.**

Owner explicitly requested maximum *cohesive* work per PR because full CI and fixes are costly. Codebase drift inspection identified reusable existing layers: `src/tools/artifacts-read.js` + `src/github/public-url.js` + `src/core/zip-reader.js` for ZIP downloads; `db.putResult/getResult` and `github_get_result` for tenant-scoped byte windows; `defineRead`, `projectFields`, and `readReply` for selectors; `src/github/rate.js` and the request's credential-specific GitHub client for rate-limit observations. Do not invent a second archive service or a new rate fetch.

Plan and acceptance: `docs/pr-cards/C-13.md`. The following issues are OPEN and are NOT yet claimed implemented or tested: #430, #435, #436.

Verification gate: focused source and fake/real-DB tests, full check once on whole bundle, exact-head `ci` and `release-policy`, resolved review, merge, then separately verify every issue CLOSED/completed. Do not promote to production or claim live-client acceptance from merge alone.
