# 2026-11-02 — agents can see the live release (VER-1)

Owner request: coding agents should see the current version. `github_whoami` now returns `server_release` (version
`<package>+<commit12>`, deployed commit, GitHub link, and how to list recent changes on `live`), and the MCP `initialize`
serverInfo version carries the same commit suffix. Tests: `tests/unit/pub-5d-front-door.test.js`,
`tests/unit/read-pipeline.test.js`. Next: release, then call `github_whoami` live and compare with the `live` branch head.
