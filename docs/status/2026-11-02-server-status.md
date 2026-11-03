# 2026-11-02 — github_server_status (SRV-STATUS-1)

Owner request (20:48 MST): keep VER-1 `server_release` and add one compact tool for build version, deployment time,
recent release notes, worker versions and health. Built `github_server_status` (compact list, every audience) in
`src/tools/server-status.js`; `github_whoami` keeps `server_release` and points to the new tool. The native Git worker's
signed capabilities gain `build_commit` (Dockerfile build argument `SOURCE_COMMIT`). Compact read listings drop string
length limits to stay under the 6,000-token budget (5,583 now).

Verified: `tests/unit/server-status.test.js` (13 tests), `tests/shapes/server-status-shapes.test.js`, full `npm run
check`. Not yet: release and a live call; the worker reports its commit only after a redeploy with `SOURCE_COMMIT`
set to the live commit. Next: after the daily release, call `github_server_status` live and compare `release.commit`
and `deployed_at` with the `live` head.
