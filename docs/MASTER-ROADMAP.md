# MASTER ROADMAP — the one handoff

Current state and next item: `npm run session:status`, `docs/STATUS.md`, `docs/pr-cards/work-index.json` (machine-readable;
validate with `python3 docs/pr-cards/validate-index.py`). Product authority: [owner decision](OWNER-DECISION-2026-10-27.md).
Procedure: `AGENTS.md` and `docs/SESSION-START.md`. Older roadmap text (stale statuses, the paste-in implementer prompt,
tool counts) is in `docs/archive/MASTER-ROADMAP-2026-10-30-before-streamlining.md`.

**Status summary (checked 2026-10-30 against the work index):** batches A through Y, PUB and CAP are MERGED or complete;
the FIN finish plan ([FINISH-PLAN](designs/FINISH-PLAN.md)) is MERGED except **PLAY-1** (Robinson Playground), which is
IN_PROGRESS. The 2026-10-28 agent-feedback issues #427–#436 are closed (PRs #440–#443, C-16 `github_write_batch`); that
is source-merged, not a new live release or client acceptance. Real-account acceptance remains a separate queue in
`docs/STATUS.md` and never blocks development.

## Build order (historical)

The order the batches were built in. Guards named here (production, spend, message) are builder-era design history; for the
owner connection the owner decision removed duplicate policy and kept disclosure, journaling, readback and delegated limits.

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
| Production | GO-LIVE-CHECKLIST | Switches and owner steps; no production-enable gate on the owner connection (owner decision) | — |

## Work coverage

`docs/pr-cards/work-index.json` is the machine-readable list (`python3 docs/pr-cards/validate-index.py`). **JIT** = covered
by the approved design; write the card when its predecessor is real. Tool counts come from `docs/TOOL-CATALOG.md` (`python3 scripts/count-catalog.py`); the card status column below is
summary only, `work-index.json` is authoritative.

| Batch | Cards | Tools | Card status |
|---|---|---|---|
| A Foundation | A-1 repo, CI, fake GitHub · A-2 schema · A-3 login · A-4 GitHub client, vendored descriptions, finders · A-5 setup page, Apps from manifests, credential store, one-time secrets · A-6 DEPLOY.md | 2 | MERGED (see work-index.json for PR numbers and any follow-ups) |
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
| Y Gap closure (designed 2026-10-16) | Y-1 unblock universal tools · Y-2 GraphQL write specs · Y-3 other people's data, follow, star lists · Y-4 Projects v2 lifecycle · Y-5 moderation, org issue types/fields · Y-6 runners, Actions admin · Y-7 security writes · Y-8 artifacts, archives, uploads, jobs, wiki · Y-9 org long tail, read-backs, guides | ~80 planned | MERGED (see work-index.json for PR numbers and any follow-ups) |
| PUB public-scale readiness | PUB-1 tenant isolation · PUB-2 delegated onboarding · PUB-3 capacity/abuse · PUB-4 mobile+desktop acceptance · PUB-5 independently approved publication gate | No new tools counted yet | MERGED (see work-index.json for PR numbers and any follow-ups) |
| CAP maximum legitimate authority | CAP-1 inventory · CAP-2 Standard Full · CAP-3 additional credentials · CAP-4 advanced gap closure · CAP-5 acceptance | No new tools claimed | MERGED (see work-index.json for PR numbers and any follow-ups) |
| **Total** | see `work-index.json` | see `docs/TOOL-CATALOG.md` | |
