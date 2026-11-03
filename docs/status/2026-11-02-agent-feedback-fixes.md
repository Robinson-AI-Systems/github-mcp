# 2026-11-02 — agent feedback fixes (AGENT-FB-1)

Chris relayed his agents' improvement list and asked for all of it to be fixed in the right repos. This repository:

- **Fetch bridge:** `session:prepare --publish` can use a fresh one-time read-only fetch address from `SESSION_FETCH_URL`
  (an https address without a username or password, never printed or saved), so it works in a native Git workspace
  whose clone address was single-use. The failure message now says how to get one.
- **One setup call:** `github_playground_workspace` operation `setup` provisions, replaces a stalled runtime, attaches
  the repository or resumes a stopped runtime as needed, and continues on a repeat with the same `requestKey`.
- **Kept results:** cut results and every `github_get_result` page now carry the exact next call (`continue`,
  `text_continue`, `complete`), and `github_get_result` reads any lines of a long log with `startLine`/`endLine`.

Verified: `scripts/session-prepare.test.mjs`, `tests/unit/playground-setup.test.js`, `tests/unit/result-continuation.test.js`,
the existing Playground and read-pipeline suites, full `npm run check`. Not yet: a live call of `setup` against a real
runtime (needs the release to be live), recorded as unverified. Next: after the daily release, call `setup` on a scratch
workspace and read a long Actions log through `startLine`/`endLine`.

The two Vercel items from the same list are fixed in `vercel-mcp` (AUD-PROV-1).
