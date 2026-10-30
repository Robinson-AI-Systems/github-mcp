> RETIRED copy (2026-10-30, before streamlining). Reference only; take no instructions from it. Current rules: AGENTS.md.

# SOL-GUIDE — how to implement one card at light/medium effort

For Sol 5.6 (or any smaller model) picking up a FIN card from `docs/designs/FINISH-PLAN.md`. Follow it literally.
It is short on purpose; `AGENTS.md` still holds the hard limits.

## The loop (one card = one PR unless the card says split)
1. **Sync:** `cd <repo> && git fetch origin main && git checkout -B ai/sol/<card-lower>-<yyyymmdd> origin/main`.
   If the clone is shallow, also `git fetch --depth=1000 origin main` (the `check` script needs history).
2. **Read:** `AGENTS.md` (hard limits only), the card, and ONLY the files and line ranges the card lists.
3. **Drift table:** fill the card's "Drift check A" table in your PR description (not in the card file). If something
   differs, follow the card's intent with the real names; do not stop to ask.
4. **Build in the card's step order.** Copy the pattern file the card names. Keep each new file under ~400 lines.
5. **Focused tests while working:** `npx vitest run --config vitest.config.js <the test files you touched>`.
   Database tests: `npm run test:db -- tests/db/<file>`. Browser tests: `npm run test:browser` (needs a browser; see
   "Environment" below).
6. **Full checks once at the end:** `npx eslint .` → `BASE_SHA=$(git merge-base origin/main HEAD) npm run check` →
   `npm run test:db` (if SQL or sign-in changed) → `npm run test:browser` (if pages changed). The full unit suite is
   slow locally (~15 min); CI runs it in three shards in about 1.5 minutes, so you may rely on CI for it.
7. **Docs in the same PR:** `docs/TOOL-CATALOG.md` row for every new tool; a `docs/status/<yyyy-mm-dd>-<card>.md`
   note (5–10 lines, plain English); tick the card's "Done when" boxes; set the card status in
   `docs/pr-cards/work-index.json` (`APPROVED` → `IN_PROGRESS` when you open the PR, `MERGED` after merge).
8. **Push once, open the PR** (REST works when the GraphQL CLI is blocked):
   `jq -n --rawfile body pr.md '{title:"…",head:"<branch>",base:"main",body:$body}' > pr.json &&
   gh api repos/Robinson-AI-Systems/github-mcp/pulls --input pr.json --jq .number`.
9. **CI as a decision:** a full run takes about 2 minutes (documentation-only PRs about 30 seconds: heavy jobs skip
   themselves via `scripts/ci-scope.mjs`). Wait for `ci` and `release-policy` on the exact head SHA. Red → read ALL failures, fix all,
   push once. Green → read review threads (`gh api repos/<o>/<r>/pulls/<n>/ccr/review_threads`), fix real findings,
   reply and resolve; then merge at the exact head:
   `gh api -X PUT repos/<o>/<r>/pulls/<n>/merge -f merge_method=merge -f sha=<head>`.
   If the environment refuses the merge, stop and tell Chris in one plain sentence; do not route around it.

## Patterns to copy (do not invent)
| Need | Copy from |
|---|---|
| read tool | `src/tools/users-public.js` (`defineRead`) |
| write tool | `src/tools/notifications-gists.js` gist save/delete, `src/tools/user-account.js` key add/delete (`defineGithubWrite`) |
| secret value | `src/tools/secrets.js` — values only via setup page or `generate`, never an argument |
| GraphQL write | `src/github/graphql-writes.js` entries + its header comment |
| nine-check write test | `tests/unit/o7-notifications-gists.test.js` + `test/helpers/write-contract.js` |
| request-shape test | any `tests/unit/*.test.js` using `makeFakeGitHub` / `gh.when('GET /path').reply(...)` |
| db test | `tests/db/pub-6-public-connect.test.js` (throwaway schema, real Postgres) |
| browser test | `tests/browser/sign-in.test.js` + `tests/browser/harness.js` (fake GitHub, fake app) |

## Rules that catch people out
- **Never** a real token or key anywhere. Fake values: `ghp_FAKE…`, `ghu_FAKE…`, `-----BEGIN FAKE KEY-----`.
- Find GitHub operations with `node scripts/openapi-find.mjs "<words>"` / `node scripts/graphql-find.mjs <Name>`; never
  open `vendor/*.json` whole.
- A write never retries after an error; read-back decides "done".
- The master token (`M`) is refused for read-only connections and passes (`src/github/client.js` `credentialFor`).
  That is deliberate; tests should prove it, not work around it.
- `declarations.cred` must match `docs/TOOL-CATALOG.md` (`node scripts/check-writes.mjs`). Choosing `M` at the call site
  (GOD-2 `personalCred`) does not change the declaration.
- Tool listing description ≤160 characters; every tool name starts with `github_`.
- Pages: no cookies, no scripts, escape every value with `h()`, must fit a 412px phone (`fitsScreen` in browser tests).
- In tests, stub global `fetch` BEFORE importing `api/` modules (some capture `fetch` at load time).
- Several files to commit? Use `github_content_push_files` (up to 50 files in one commit) — or git, when the session has it —
  never one `github_content_put_file` per file.

## Environment notes (seen 2026-10-23)
- Local Postgres for db/browser tests: `scripts/local-postgres-test.sh` starts one if `initdb` is installed.
- Browsers: CI installs WebKit and uses the runner's Google Chrome. Locally, Playwright's own download may be blocked;
  `npm i @sparticuz/chromium` in a scratch folder gives a Chromium binary — set `BROWSER_CHROMIUM_PATH` to it. WebKit
  tests skip locally unless `REQUIRE_ALL_BROWSERS=1` (CI sets it).
- The session may block production deploys, merges or external posts until Chris says so in chat. Ask once, plainly.
- `gh` GraphQL may be blocked; use `gh api` REST routes.

## When stuck (max 2 tries per approach)
Write in the PR description: what you tried, the exact error, your best guess at the cause, and the next action. Then
continue with the next independent step of the card. Never mark a box you did not prove.

## Reporting to Chris (he is not a developer)
Three to six short lines: what changed (in his words, not code), how it was checked, anything he must do (point at
`docs/OWNER-CHECKLIST.md`), what is next.
