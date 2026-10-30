# FINISH PLAN — what was left to finish Robinson GitHub MCP, and what remains

> Product authority: [owner decision](../OWNER-DECISION-2026-10-27.md) supersedes conflicting product gates below;
> plan: [AUTHORITY-PARITY](AUTHORITY-PARITY-2026-10-28.md). Builder limits stay in `AGENTS.md`.

Written 2026-10-23 at Chris's request so smaller models (Sol 5.6) could finish the product from ready cards. Per
`docs/pr-cards/work-index.json` (batch FIN, checked 2026-10-30) every card in it is MERGED except **PLAY-1** (Robinson
Playground integrated coding workspaces, IN_PROGRESS; PRs 476 and 480; recovery notes in `docs/status/2026-10-30-playground-*.md`).
The original gap table, per-card summaries and order are in `docs/archive/FINISH-PLAN-2026-10-30-before-streamlining.md`;
the cards in `docs/pr-cards/` hold the current scope. For live state use `npm run session:status`, `docs/STATUS.md` and
the work index, not this page.

## Cards (all merged unless noted)

GOD-2/GOD-3 (master token for personal-account tools, "what my token unlocks") · GOD-4 (new tool families the App cannot
reach) · ENT-1 (enterprise tools; the trial on `robinson-ai-scratch` ends about 2026-11-22, so any enterprise acceptance
must be run before then or recorded as untested) · GOD-5 (extra places) · GOD-6 (act as me) · GQL-1 (GraphQL write specs)
· ACC-1 (repeatable acceptance sweep) · LAUNCH-1 · AUTH-1 · INV-1 · HARD-1 · PAR-1..PAR-4 (parity with the official MCP
server) · **PLAY-1 (open)**. "Finished" means all approved cards merged and released, every acceptance row has a recorded
outcome (passed, or a named provider/plan limit), and `docs/STATUS.md` says so.

Stays out: ChatGPT/Claude directory listings (refused by policy for unofficial connectors), GitHub Models (retired),
OAuth-app token management and App-manifest conversion, linking a second GitHub login into one connection (needs its own
security design).

## Rules every card follows (short form; AGENTS.md and SOL-GUIDE hold the full text)

1. Branch `ai/<tool>/<card>-<date>` from `origin/main`; read `AGENTS.md`, then ONLY the card and the files it names. Query
   `vendor/` with `node scripts/openapi-find.mjs` / `graphql-find.mjs`, never whole.
2. Copy existing patterns; names start `github_`; reads use `defineRead`, writes `defineGithubWrite` with full declarations
   (`production`, `confirm`, `cred`, `profiles`, plus `accessWidening`/`notifies`/`spend` when true); every tool in
   `docs/TOOL-CATALOG.md`.
3. Tests: `runWriteContract` (nine checks) per write tool; request-shape test per GitHub call; `tests/db/` for SQL.
4. Fake secrets only. Before pushing: `npx eslint .`, focused tests, `BASE_SHA=$(git merge-base origin/main HEAD) npm run
   check`, plus `test:db` / `test:browser` when SQL or pages changed. Push once; read CI as a decision (SESSION-START §4).
5. PR body: plain-English What changed / How verified / Self-review, acceptance ticked with test names. After merge: tick
   the card, set it `MERGED` in `work-index.json`, add a `docs/status/` note.

## Owner items (all on `docs/OWNER-CHECKLIST.md`; none blocks building)

Replace the master token with the enterprise-permission link before ~2026-11-22 (ENT-1); optionally choose whether GOD-5
extra places start read-only (default) or allow changes; HARD-1 App Setup URL field; LAUNCH-1 invite-only on/off, support
email, legal approval, cost-alert amount, App permission change. Check that file for what is still open.
