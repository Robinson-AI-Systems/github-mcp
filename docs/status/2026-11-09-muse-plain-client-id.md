# 2026-11-09: plain `muse` is the Client ID for Muse (MUSE-3)

Owner ruling (2026-11-09): every RAS MCP server, current and future, connects
to Muse with the Client ID `muse` and a blank Client Secret, for the general
public's ease of use. This is the Library design D-006 (`designs/ras-mcp-muse-connection.md`),
MC-8.

GitHub Unleashed keeps its fixed public Muse client (`pcl_meta_muse_…`).
Plain `muse` is now a nickname for it, swapped in on the request as it
arrives at the authorize, token and revoke doors (`applyMuseNickname` in
`src/oauth/routes.js`), so every later door sees the same client it always
has. The home page now tells Muse users to type `muse`, and mentions the
older long ID as still working.

Tests: `tests/unit/muse-nickname.test.js`; `tests/browser/home-page.test.js`
updated. Card: `docs/pr-cards/MUSE-3.md`. Not yet verified live: a fresh
Muse connect with Client ID `muse` after release.
