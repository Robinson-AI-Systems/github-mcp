# 2026-11-09 — unknown tool names now suggest the right tool

A report said "a general read-only GitHub request" was missing because `github_call` with `github_api_request` answered "Unknown or unavailable tool". That tool never existed under that name: the general read-only request is `github_api_read` (any pinned GET; find the operation with `github_api_search`, parameters with `github_api_describe`), already reachable through `github_call` with `{operation: "GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs", params: {...}}`. Checked live on 2026-11-09: it returned the run's jobs.

Changed: `github_call` unknown-tool errors now add "Did you mean: …" with up to three close tool names the connection can actually see (synonyms such as request/get/fetch → read). Read-only connections are never offered write tools. No new tool was added, so no duplicate of `github_api_read` exists to keep in step.
