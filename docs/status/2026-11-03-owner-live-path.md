# 2026-11-03 — owner recognised on the live public-connect path (RELAY-OWNER-1 follow-up)

- Problem: after RELAY-OWNER-1 went live and `OPERATOR_GITHUB_USER_ID` was set, Chris's claude.ai connection still saw
  the PC host as `owner_only` and got the service-domain git URL.
- Cause: two database wrappers on the MCP path (`withTenantStorageLimits`, `requestScopedVerifiedAccess`) rebuild the
  database with an object spread, which drops the unlisted verified GitHub id.
- Fix: `keepVerifiedSubject` carries it across both wrappers; new real-path test in `tests/db/pub-6-public-connect.test.js`.
- Not done: no release (the daily job ships it); real acceptance is Chris's next `github_server_status` after release.
