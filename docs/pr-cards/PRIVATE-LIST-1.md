# PRIVATE-LIST-1: a personal account's repo list includes its private repositories

## Owner request 2026-11-14

Listing Chris's personal account showed only public repositories (GET /users/{username}/repos is public-only for
everyone); a private archive repository was found only through search. Chris: fix it.

## Outcome and acceptance

`github_repo_list` for a personal account lists through the App installation on it (GET /installation/repositories,
private included), with the same type, sort and archived filters. When that route is not available to the credential it
falls back to the public route and marks the answer `public_only` with a note. Accepted by
`tests/unit/repos-read.test.js` (installation path, type filter, fallback note).

## Drift check

Changes: `src/tools/repos.js`; tests; docs.
