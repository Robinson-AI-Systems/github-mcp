# 2026-11-09 — `github_api_request` accepted as the common name for the read tool

`github_api_request` now works through `github_call`, `github_describe_tool` and `github_batch` and runs exactly `github_api_read` (any pinned GET). It is a name alias, not a new tool: the tool count, listings, write guards and credentials are unchanged, and it can never reach `github_api_write` (a change operation sent through it is refused by the read tool). Changes keep using `github_api_write` / `github_graphql_write`. Implemented in `src/tools/meta.js` (`TOOL_ALIASES`).
