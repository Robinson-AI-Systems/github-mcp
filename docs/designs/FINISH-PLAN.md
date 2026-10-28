# FINISH PLAN — everything left to make Robinson GitHub MCP a finished product

> **Current governing owner decision (2026-10-27), implementation authorized 2026-10-28:**
> See [owner decision](../OWNER-DECISION-2026-10-27.md). It supersedes conflicting product gates below, including spend/production/notification/protected-resource restrictions on the owner's own connection. Builder operating restrictions remain builder-only; explicit delegated restrictions remain binding. Historical designs and evidence do not override this decision.
> Active remediation: [plan](AUTHORITY-PARITY-2026-10-28.md).

**Written 2026-10-23 at Chris's request** ("write the design and planning for everything still needed to finish this
product… in a way lesser coding models such as Sol 5.6 can implement at light to medium effort"). This file is the
single starting point for the remaining work. Each piece has its own complete card in `docs/pr-cards/` (FIN batch in
`docs/pr-cards/work-index.json`). The cards are written ahead of time on purpose, with exact files, steps, tests and a
finish checklist, so an implementer does not have to make design decisions. If a card and the code disagree, the code
is the truth: note the difference in the card's drift table and follow the card's intent.

Nothing in this plan is built yet. Status of each card lives in `work-index.json`.

## 1. Where the product stands (2026-10-23, main = 8ed877a)

**Working and released** (live at `https://github.robinsonaisystems.com`, Vercel production):
- 427 tools (`node -e "import('./src/tools/index.js').then(m=>console.log(m.registry.tools.length))"`): code, PRs,
  merges, CI, releases, issues, projects, governance, security, owner/admin, billing, developer tools, universal REST and
  GraphQL tools, RTC 1 doors for the optional Hub.
- Public sign-in (PUB-6, rebuilt 2026-10-23): app → GitHub → one **Approve** page → app; no cookies; `/connection`
  ("My connection") page; real-browser tests in CI (`tests/browser/`, job `browser`).
- Per-person isolated storage (PUB-1..PUB-3), self-serve delete, owner usage view, time zones, read-only option.
- God mode step 1 (GOD-1): one optional master token (credential kind `M`), add/replace/remove any time, expiry
  reminder in `github_whoami`, notifications (K) and packages (P) fall back to it, universal tools accept `cred:"M"`.
- Chris's own Claude and ChatGPT connectors were reconnected on the new address on 2026-10-23.

**Known gaps** (this plan closes them):

| Gap | Evidence | Card |
|---|---|---|
| ~25 personal-account tools (gists, SSH/GPG/signing keys, follow, star, watch, block, emails, profile, invitations, status) use the App's user sign-in `U`, but GitHub's own API description marks those operations "not available to GitHub Apps" (`x-github.enabledForGitHubApps: false`). None has real-account evidence. | `vendor/github-openapi/api.github.com.2026-03-10.json`; `docs/developer-evidence.json` has 0 rows for them | GOD-2 |
| No plain-English "what does my master token unlock right now" view. | `docs/designs/GOD-TOKEN.md` GOD-3 | GOD-3 |
| ~177 App-unreachable operations have no dedicated tool (only hand-built universal calls): Codespaces secrets and machines, your own account export (user migrations), Copilot Spaces, Classroom, Marketplace listing, hovercards, user project views, credential revoke. | `node scripts/capability-inventory.mjs --json` + the OpenAPI flag | GOD-4 |
| Enterprise operations (29 REST, plus enterprise GraphQL) have no tools; an Enterprise **trial** is active on `robinson-ai-scratch` (started 2026-10-23, 30 days, ends about **2026-11-22**). | `docs/OWNER-CHECKLIST.md` | ENT-1 (time-boxed) |
| Tools only act on accounts where the App is installed; the master token could reach any repository the person can (orgs where they are only a member, collaborator repos). | design gap | GOD-5 |
| 234 GraphQL mutations have no write specification, so no tool can use them (Projects, Discussions, Sponsors…). | capability report | GQL-1 |
| 56 real-account acceptance rows still waiting (`npm run session:status`). Most prerequisites now exist (live deploys, master token, enterprise trial). | session-status | ACC-1 |
| Hardening found during the sign-in rebuild: global open-step cap, per-tenant copy of App keys, App Setup/Webhook URLs still on the old Vercel address, docs drift (STATUS.md 2,300 lines, stale MASTER-ROADMAP lines). | `docs/ROADMAP.md` 2026-10-23 section | HARD-1 |
| PUB-4 (phone + desktop acceptance) and PUB-6 still marked IN_PROGRESS although their work is done. | work-index | ACC-1 closes them |
| Public launch items from the rollout plan Chris approved: load test, hosting-cost view with alert, App permission review, invite-only switch, served legal/security/support pages, and **clean-up for public people when they uninstall the App** (today only the owner's accounts are updated). | `docs/ROADMAP.md` rollout plan; `src/github/webhook.js` | LAUNCH-1 |
| The 2026-10-16 end-user authority audit (no developer-only $0/guide-only limit leaks into the product) is still marked open. | `docs/END-USER-AUTHORITY.md` | AUTH-1 |
| 1,176 operations have no credential decision and 65 have conflicting official information. | capability report | INV-1 |
| (Done 2026-10-23) Documentation-only PRs now skip the heavy test jobs; unit tests split three ways. | CI | HARD-1 B.3 |

**Added 2026-10-24 (Chris):** PUB-5 is now the public, free launch from Chris's website (no directory listing, no people
cap): `docs/pr-cards/PUB-5.md`, 4 PRs, about 10–14 h, after the FIN cards.

**Stays out** (not part of "finished"): ChatGPT/Claude directory listings (refused by policy for unofficial
connectors); GitHub Models (retired by GitHub); OAuth-app token management and
App-manifest conversion (need an OAuth app's own secret, not a person's token); linking a second, separate GitHub
login into one connection (ROADMAP, needs its own security design).

## 2. Order (fastest path to finished)

Do the cards in this order. One card = one PR unless the card says to split. Each PR still needs green `ci` and
`release-policy`, a self-review, and a `docs/status/` note (AGENTS.md).

| # | Card | Effort (Sol 5.6) | Why here | Owner needed? |
|---|---|---|---|---|
| 1 | **GOD-2 + GOD-3** (one PR) | medium | Biggest win: makes ~25 existing tools actually work and shows the person what God mode unlocks. | No (live check uses Chris's existing master token if added; otherwise recorded as waiting) |
| 2 | **ENT-1** | medium | Must be built, released AND accepted before the trial ends (~2026-11-22). | Chris adds the enterprise permissions to his master token once (checklist) |
| 3 | **ACC-1** (runs alongside, repeatable) | light | Turns released code into real evidence; closes PUB-4/PUB-6. | No (uses the saved connector) |
| 4 | **GOD-4** (may be 2 PRs: Codespaces+account export; Copilot Spaces+small reads) | light–medium | New tool families on the same pattern. | No |
| 5 | **GQL-1** (split into 3–4 PRs by family) | medium | Unlocks Projects, Discussions and the rest through GraphQL. | No |
| 6 | **GOD-5** | medium | Most powerful, most care: reach beyond installed accounts. Default design chosen below; Chris may change it. | Optional decision (checklist) |
| 7 | **LAUNCH-1** (3 PRs) | medium | Uninstall clean-up is a real gap; do PR A early (can go right after GOD-2/3). | Decisions: invite-only, support email, legal approval, cost alert, App permission change |
| 8 | **AUTH-1** (2 PRs) | medium | Makes sure users get everything GitHub allows, with honest warnings. | No |
| 9 | **INV-1** | light | Data work: every operation gets a credential decision. | No |
| 10 | **HARD-1** | light–medium | Hardening and docs tidy (B.3, the docs-only CI fast path, is already done). | One field in App settings |
| 11 | **GOD-6** (added 2026-10-24) | medium–high, one PR, 6–8 h | "Act as me": with a master token, GitHub records the person instead of the bot; App-only requests stay on the bot. Card: `docs/pr-cards/GOD-6.md`. | No (the switch defaults on) |
| 12 | **PAR-1** (added 2026-10-24) | light–medium, one PR, 3–4 h | Parity with GitHub's official MCP server (Copilot review, code quality, docs search, bulk project edits, stargazers). Card: `docs/pr-cards/PAR-1.md`. | No |

"Finished" = all eleven cards merged and released, ACC-1's ledger has a recorded outcome (passed, or a named
provider/plan limit) for every row, and `docs/STATUS.md` + this file say so.

## 3. Rules every card follows (read once)

1. Start: `git fetch origin main`, branch `ai/<tool>/<card>-<date>` from it, read `AGENTS.md`, then ONLY the card and
   the files it names. Do not read `vendor/` JSON whole; use `node scripts/openapi-find.mjs "<words>"` and
   `node scripts/graphql-find.mjs <Name>`.
2. Copy existing patterns; do not invent new frameworks. Every card names the file to copy from.
3. Tools: names start `github_`; read tools use `defineRead`, write tools use `defineGithubWrite` with full declarations
   (`production`, `confirm`, `cred`, `profiles`, plus `accessWidening`/`notifies`/`spend` when true). Listing
   description ≤160 characters. Add every new tool to `docs/TOOL-CATALOG.md` (`python3 scripts/count-catalog.py`).
4. Tests: every write tool runs `runWriteContract` (`test/helpers/write-contract.js`, nine checks); every GitHub call has
   a request-shape test against the fake GitHub (`test/helpers/fake-github.js` validates against the vendored
   description); SQL changes get a `tests/db/` test.
5. Never put a real token, key or secret anywhere. Fake values only: `ghp_FAKE…`, `ghu_FAKE…`, `-----BEGIN FAKE KEY-----`.
6. Before pushing: `npx eslint .`, the card's focused tests, then `BASE_SHA=$(git merge-base origin/main HEAD) npm run check`,
   and `npm run test:db` / `npm run test:browser` when the card touches SQL or sign-in pages. Push once; read CI as a
   decision (AGENTS.md "Working without stalling").
7. PR body: plain-English "What changed / How verified / Self-review" (use `docs/AI-PR-READ-FIRST.md` items for
   anything touching credentials, guards, production or access) and the card's acceptance checklist ticked with test names.
8. After merge: tick the card's checklist, set the card `MERGED` in `work-index.json`, add `docs/status/<date>-<card>.md`.

## 4. Card summaries (full detail in each card)

- **GOD-2 — master token for personal-account tools.** One helper chooses the credential for "your own account" tools:
  the master token when it is added and carries the needed scope, otherwise the user sign-in. Applied to the exact
  list of ~25 tools in the card. Read-only connections never use the master token (unchanged rule), so they keep `U`.
- **GOD-3 — "what my master token unlocks".** One pure function maps the token's recorded scopes to tool areas
  (unlocked / still locked and which permission would unlock it). Shown in `github_whoami` and on My connection.
- **GOD-4 — new tool families the App cannot reach:** Codespaces secrets (user, org, repo), Codespaces machine types,
  account export (user migrations), Copilot Spaces (spaces, collaborators, resources), Classroom reads, Marketplace
  listing reads, hovercards, user project views, credential revoke. All use the master token.
- **ENT-1 — enterprise tools during the trial:** enterprise discovery, code-security configurations, Dependabot
  repository access and alerts, Copilot coding-agent policy, Actions enterprise settings found in the pinned
  description, and enterprise audit log / members through GraphQL. Master token gains optional enterprise permissions.
- **GOD-5 — reach beyond installed accounts:** with the master token, a person can add "extra places" (an organization
  they belong to, or a single repository) on My connection. Tools may then target those places with credential `M`.
  Default: extra places start **read-only**; a person can switch one place to "changes allowed" on My connection; every
  change still goes through the normal preview/confirm/production/protection guards.
- **GQL-1 — GraphQL write specifications** for the 234 mutations without one, in priority order (Projects v2, Discussions,
  issues/PR extras, Sponsors and the rest), so the existing `github_graphql_write` tool can run them safely.
- **ACC-1 — acceptance sweep.** A repeatable session recipe that works through the 56 waiting rows on the live server
  with the saved connector and records results in `docs/developer-evidence.json`; closes PUB-4 and PUB-6.
- **LAUNCH-1 — public launch readiness:** uninstall/revoke clean-up for public people, invite-only switch, local load
  test, hosting-cost estimate with alert, limits page, served legal/security/support pages, App permission review.
- **AUTH-1 — end-user authority audit:** report every paid/production/destructive tool; remove developer-only refusals
  from the product; turn guide-only tools into real tools where GitHub has an API.
- **INV-1 — inventory:** credential decision and evidence for every operation; resolve source conflicts.
- **HARD-1 — hardening and tidy:** sign-in steps without a global row cap, one shared copy of the App keys, move the
  App's Setup/Webhook URLs to the new address (Chris clicks once; the webhook URL can be set by tool), trim STATUS.md
  into an archive, refresh MASTER-ROADMAP and the old design notes.

**Coverage check (2026-10-23):** this plan was compared against `docs/ROADMAP.md`, `docs/END-USER-AUTHORITY.md`,
`docs/implementation-contracts/REMAINING-WORK.md` (all its units are merged), the capability report and the acceptance
ledger. Anything not listed here is either done, or deliberately out (§1 "Stays out").

## 5. Owner items this plan creates (all on `docs/OWNER-CHECKLIST.md`, none blocks building)

1. Before ~2026-11-22: replace the master token once using the "with enterprise permissions" link (ENT-1 adds it).
2. Optional: say whether extra places (GOD-5) should start read-only (default) or allow changes.
3. HARD-1: paste the new Setup URL in the GitHub App settings (one field) when the agent asks.
4. LAUNCH-1: invite-only on/off, support email, legal approval, monthly cost alert amount, any App permission change.
5. Existing: pricing (unchanged).
