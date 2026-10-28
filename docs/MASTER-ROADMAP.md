# MASTER ROADMAP — the one handoff

**2026-10-28 agent-feedback closeout:** Issues #427–#436 are all independently closed/completed, with PRs #440–#443 merged under exact-head required CI and review gates. C-16 `github_write_batch` has accepted source and disposable-Postgres tests; it is **not** a claim of a new live deployment or real-client smoke test. See `docs/status/2026-10-28-mcp-feedback-closeout.md` and the normal policy-governed release plan. The FIN roadmap below remains the product's other-work roadmap.

## Start here (2026-10-23): the finish plan

**Everything left to finish the product is in [FINISH-PLAN](designs/FINISH-PLAN.md)**, with one ready-to-implement card
per piece (batch FIN in `docs/pr-cards/work-index.json`), in this order:
GOD-2 + GOD-3 (one PR) → ENT-1 (before the Enterprise trial ends ~2026-11-22) → ACC-1 (repeatable, alongside) →
GOD-4 → GQL-1 → GOD-5 → LAUNCH-1 → AUTH-1 → INV-1 → HARD-1. Cards are written for Sol 5.6 at light/medium effort; see
[SOL-GUIDE](pr-cards/SOL-GUIDE.md). Everything below this section is history kept for reference.

Older planning paragraphs (2026-10-12 to 2026-10-21) are kept in `docs/archive/STATUS-before-2026-10-20.md`.

## Order and why

| Stage | Batches | Why in this place | Owner gate |
|---|---|---|---|
| 1 Foundation | A | Nothing works without it: tests, login, GitHub Apps from manifests, one polite GitHub client | IN-02/IN-03/IN-04/IN-05 before A-5 can be tried for real |
| 2 Safety | B → C | Every later tool is built on the trust layer (production guard, self-protection, access/message/spend guards) and the context rules | IN-07, IN-08, IN-09, IN-12, IN-13 (defaults; none blocks building) |
| 3 The build conveyor | D → E → G | What Chris's own build process runs on every day: code, branches, PRs, merge at the exact head on green, review threads, CI with log summaries, releases | — |
| 4 Building with GitHub | V | Developer tools for any project: scratch repositories, test branches and PRs, dispatch and wait, simulated checks, webhook deliveries forwarded into apps under development, cleanup by run | IN-06 (scratch organization) before real use |
| 5 The rest of the repository | F → H | Issues and planning; then governance and security (protection, rulesets, webhooks, access, alerts) | IN-11 (optional notifications token) |
| 6 Owner side | O | Admin overview, members, teams, billing and spend, apps and tokens, personal account, every dashboard setting guided | IN-09, IN-11, IN-13 |
| 7 Projects and workflows | P → W | Optional project profiles (Appliance Desk and the Robinson servers first) and the one-sentence jobs | — |
| 8 Everything else | U → R | Universal REST and GraphQL access; the contract doors Robinson's Toolkit (the hub) uses to reach this server | IN-10 |
| 9 Close-out | X | Undo, read-only smoke test on the real accounts | IN-04, IN-05 |
| Production | GO-LIVE-CHECKLIST | Only after Chris turns production on per account | IN-07 |

## Implementing agent — paste this

> Read `docs/SESSION-START.md`, STATUS and the next card (plus its resume note `docs/pr-cards/<ID>.progress.md` if
> present). Find the cited design headings and named code/tests in bounded sections. Run the drift protocol checklist A
> against latest main. If no card exists, write one short card from the approved design (`docs/pr-cards/README.md`) with
> exact current paths, credential/secret/guard/production boundaries, meaningful tests and completion evidence. Routine
> details are yours to implement; a missing security, production, credential or schema decision needs a reviewed
> amendment, not a guess. Implement a coherent unit, run the targeted checks, push once. While checks run, implement only
> the eligible immediate successor. Write the self-review, fix blocking findings in one patch, refresh exact-head gates,
> merge when authorized and green. Update the card, STATUS and `work-index.json` as if merged. Continue while eligible
> work exists; stop only for a real gate, with committed work and the exact next action.

## Work coverage

`docs/pr-cards/work-index.json` is the machine-readable list (`python3 docs/pr-cards/validate-index.py`). **JIT** = covered
by the approved design; write the card when its predecessor is real. Tool counts are from `docs/TOOL-CATALOG.md`
(`python3 scripts/count-catalog.py`: 411 = 405 hand-built + 6 universal).

| Batch | Cards | Tools | Card status |
|---|---|---|---|
| A Foundation | A-1 repo, CI, fake GitHub · A-2 schema · A-3 login · A-4 GitHub client, vendored descriptions, finders · A-5 setup page, Apps from manifests, credential store, one-time secrets · A-6 DEPLOY.md | 2 | A-1 MERGED (#1); A-2 MERGED (#7); A-3 MERGED (#8, #9); A-4 MERGED (#10); A-5 split: A-5a MERGED (#11), A-5b READY; A-6 onward JIT |
| B Trust | B-1 safety layer · B-2 production guard · B-3 self-protection and ownership · B-4 access/message/spend · B-5 errors and shaping · B-6 profiles and downscoped tokens · B-7 check-writes · B-8 server tools | 11 | MERGED |
| C Context | C-1 small results · C-2 listing modes, meta-tools, budgets | 5 | MERGED |
| D Code | D-1 repositories · D-2 files, commits, git data · D-3 branches and tags | 44 | MERGED |
| E Pull requests | E-1 read/create/update · E-2 merge at exact head, auto-merge, stacks · E-3 reviews and threads | 24 | MERGED |
| G CI and delivery | G-1 Actions and log summaries · G-2 checks, statuses, artifacts, caches · G-3 secrets and variables · G-4 environments and deployments · G-5 releases · G-6 Pages and packages | 51 | MERGED |
| V Developer tools | V-1 scenarios, runs, scratch repos · V-2 cleanup · V-3 test branches, PRs, dispatch, check runs · V-4 test webhooks and forwarding · V-5 integration check | 15 | MERGED |
| F Issues and planning | F-1 issues · F-2 labels and milestones · F-3 discussions, projects, search | 32 | MERGED |
| H Governance and security | H-1 protection and rulesets · H-2 webhooks · H-3 collaborators and deploy keys · H-4 security features, alerts, Actions settings | 33 | MERGED |
| O Owner | O-1 admin overview, guided settings, dashboard map · O-2 org and members · O-3 teams and roles · O-4 billing, budgets, Copilot, Codespaces · O-5 apps and tokens · O-6 personal account · O-7 notifications and gists | 61 | MERGED |
| P Project profiles | P-1 `known_projects` + two seeds · P-2 app readiness · P-3 project setup + draft profile | 5 | MERGED |
| W Workflows | W-1 … W-7 (`designs/BATCH-W.md` §4 table) | 15 | MERGED |
| U Universal | U-1 REST · U-2 GraphQL | 6 | MERGED |
| R Hub-ready doors (RTC 1) | R-1 passes · R-2 HTTPS API, manifest, OpenAPI, shared rate limit · R-3 conformance in CI | 1 | MERGED #225 |
| X Close-out | X-1 undo · X-2 read-only smoke test | 1 | MERGED |
| Y Gap closure (designed 2026-10-16) | Y-1 unblock universal tools · Y-2 GraphQL write specs · Y-3 other people's data, follow, star lists · Y-4 Projects v2 lifecycle · Y-5 moderation, org issue types/fields · Y-6 runners, Actions admin · Y-7 security writes · Y-8 artifacts, archives, uploads, jobs, wiki · Y-9 org long tail, read-backs, guides | ~80 planned | Y-1 and Y-2 merged (#227), Y-3 and Y-4 merged (#228), Y-5 and Y-6 merged (#229), Y-7 merged (#230), Y-8 merged (#231); Y-9 source complete (#233); live permission upgrades and provider acceptance pending |
| PUB public-scale readiness | PUB-1 tenant isolation · PUB-2 delegated onboarding · PUB-3 capacity/abuse · PUB-4 mobile+desktop acceptance · PUB-5 independently approved publication gate | No new tools counted yet | PUB-1/2 **MERGED**; PUB-3 **source-complete, PR #267 pending review/merge**; PUB-4 **APPROVED**; PUB-5 **APPROVED** 2026-10-24 as the public free website launch (`docs/pr-cards/PUB-5.md`) |
| CAP maximum legitimate authority | CAP-1 inventory · CAP-2 Standard Full · CAP-3 additional credentials · CAP-4 advanced gap closure · CAP-5 acceptance | No new tools claimed | CAP-1 merged #272; CAP-2 source reconciled for PR #273 (final gates required); CAP-3..CAP-5 **APPROVED / NOT IMPLEMENTED** |
| **Total** | **83 cards** (78 previously indexed + 5 CAP) | **411 currently built or planned, PUB counts not claimed** | |
