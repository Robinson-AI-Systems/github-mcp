# VER-1 — Agents can see the live release

## Owner approval 2026-11-02

Chris asked in chat on 2026-11-02 14:28 MST: "Can you make it so the coding agents can see current version?"

## Outcome and acceptance

Outcome: `github_whoami` and the MCP server info tell an agent the exact deployed commit and where to read what changed.
Accepted when `tests/unit/pub-5d-front-door.test.js` covers the deployed, missing and malformed commit cases and
`tests/unit/read-pipeline.test.js` shows `server_release` on `github_whoami`.

## Drift check

Read-only metadata from Vercel's own build variable; no new setting, credential, tool or request.
