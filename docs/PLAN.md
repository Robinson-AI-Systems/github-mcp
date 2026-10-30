# PLAN — remaining scope and acceptance

Order and state: [MASTER-ROADMAP](MASTER-ROADMAP.md), `docs/pr-cards/work-index.json`, [STATUS](STATUS.md). `AGENTS.md` owns
workflow rules; this file owns acceptance; designs own semantic decisions; cards own the next bounded implementation.

> **Precedence:** [owner decision 2026-10-27](OWNER-DECISION-2026-10-27.md) and [AUTHORITY-PARITY](designs/AUTHORITY-PARITY-2026-10-28.md)
> supersede any acceptance line below that restricts the owner's own connection (production guard and two-step enable,
> self-protection lists, message/own-people guard, spend guard default $0, mandatory green-check merges, bypass
> prohibitions, fixed write pacing, "preview by default"). Those lines record what was built and tested historically;
> they are not current product requirements and must not be re-added. Disclosure, journaling, replay protection,
> readback, credential/tenant isolation and restrictions on explicitly delegated passes remain required.
>
> **Docs audit 2026-10-16:** every checked box in Batches A–P, U, W is MERGED per `work-index.json` plus named tests in
> `tests/`; anything needing a live account stays an owner-run step in `GO-LIVE-CHECKLIST.md`. Older checkbox states for
> CAP and PUB below are snapshots; the work index is authoritative (CAP-1..CAP-5 and PUB-1..PUB-5 cards are MERGED there).

## CAP and PUB (status moved to the work index)

CAP-1..CAP-5 ([MAXIMUM-AUTHORITY](designs/MAXIMUM-AUTHORITY.md)) and PUB-1..PUB-6 ([PUBLIC-SCALE](designs/PUBLIC-SCALE.md),
`docs/pr-cards/PUB-*.md`) are MERGED in `work-index.json`; their acceptance lines (inventory and honest denominators,
Standard Full setup, additional-credential lifecycle, advanced gap closure, tenant isolation, delegated onboarding,
capacity, real mobile/desktop client acceptance, public launch) are tracked item by item in the acceptance ledger in
`docs/STATUS.md` (`npm run session:status`). Merged source is not live acceptance: the 2026-10-16 historical notes that
called PUB-5 blocked, or PUB-3 pending PR #267, are superseded by the PUB-5 public-launch approval of 2026-10-24 and the
merged cards. Do not infer completed acceptance from a checked box; read the ledger.

## Rules that apply to every batch

- Every write tool passes the nine write-contract checks (`docs/designs/BATCH-B.md` §3) through every door that exists
  (handler; `github_call` after C-2; HTTPS after R-2).
- Every GitHub request shape passes against the fake GitHub, which validates it against the vendored OpenAPI description
  (REST) or GraphQL schema at the pinned version `2026-03-10` (`npm run test:shapes`).
- Database code passes on throwaway Postgres; schema changes are additive and idempotent; related additive migrations may share a coherent PR with explicit ordering and upgrade/restore proof; split only for a concrete dependency, safety or reviewability reason.
- `npm run check` green: secret scan, docs check, index validation, catalog count (`scripts/count-catalog.py`), lint,
  write-safety, token budgets, core imports.
- No secret in code, docs, tests, logs, PR text or tool results (key-scan test). No tool takes or returns a credential or
  a secret value.
- Builder limits (AGENTS hard limits): no production write on Chris's real repositories outside the card flow, no access
  widening on a real account, no purchase, no real credential in tests; real-account writes only in the scratch organization (IN-06).
- Every tool name starts with `github_`; every tool is in `docs/TOOL-CATALOG.md` with the marks its code declares.
- Owner inputs are inputs, not things to invent: build the mechanism, keep the dependent behavior off, list the `IN-xx`.
- Money shown in dollars and cents, stored in cents; times stored UTC and shown in each person's own saved zone (UTC when none is saved).
- The PR description carries the card's acceptance checklist with evidence and a "Self-review" (AI-PR-READ-FIRST).

## Batch A — Foundation (`designs/BATCH-A.md`)

- [x] Node 24.x in `package.json` and every CI job; CI runs check, unit, database and request-shape jobs on every PR with a
  single `ci` gate; a deliberately failing test turned it red once. — A-1, PR #1 (red proof: https://github.com/Robinson-AI-Systems/github-mcp/actions/runs/38077330755; green run linked in the PR).
- [x] Connector login with default account, allowed accounts, mode (preview unless the account has production enabled),
  profile and listing; lockout after 5 tries in 15 minutes; tokens stored hashed; a refresh keeps every setting.
- [x] GitHub Apps created from manifests on the setup page; credentials stored only encrypted; nothing copied by hand;
  credential steps and production refused on non-production deployments; key-scan test passes.
- [x] One GitHub client: pinned `2026-03-10`, Octokit encodes every path (audit G8), request keys and replay, write slots
  shared across instances, rate state honoured inside the time budget (audit G19, G20).
- [x] OpenAPI description and GraphQL schema vendored with `SOURCE.md`; `scripts/openapi-find.mjs` and
  `scripts/graphql-find.mjs` answer in ≤20 lines.
- [x] One-time-secret page works (shown once, then gone); App webhooks verified and narrow.
- [x] `docs/DEPLOY.md` followable by Chris without a question.

## Batch B — Trust layer (`designs/BATCH-B.md`)

- [x] `defineWrite` with target/classify hooks, preview first line in plain English, confirm, read-back, change log,
  request-key replay, inverse; the nine write-contract checks exist and run.
- [x] Production guard (eight rules, failed read = production) and two-step production enable (tool + passphrase).
- [x] Self-protection (`pr-only`, `locked`) seeded per IN-08 and edited only on the setup page; project ownership with
  `outsideProject` and a profile's `agentMay` steps.
- [x] Access, message (own people per IN-13) and spend guards (monthly limit per account, default $0, IN-09).
- [x] Plain-English GitHub errors (permissions header, rule violations, 404 "or no access", stale head); result shaping
  hides secrets and marks untrusted text; profiles and downscoped installation tokens.
- [x] `check-writes` fails on undeclared writes, missing `dryRun`, missing price function, or a mismatch with TOOL-CATALOG.
- [x] Server tools (B-8 rows of TOOL-CATALOG) built and marked.

## Batch C — Cheap on context (`designs/BATCH-C.md`)

- [x] Summaries, `fields`, `detail`, text caps, handles (24 h, same connection only), annotations, structured output.
- [x] Catalog and compact listing; meta-tools dispatch into the wrapped handlers, so every guard applies (write-contract
  through `github_call`).
- [x] Budgets enforced in CI: compact <5,000 tokens, everyday catalog <22,000, descriptions ≤160 characters, schemas
  <1,500 tokens, default results ≤8 KB or a handle.

## Batch D — Repositories, code, branches and tags (`designs/BATCH-D.md`)

- [x] Every D-1 … D-3 tool in TOOL-CATALOG built and marked `built #n`.
- [x] No literal default branch (audit G4); file writes and ref moves are compare-and-swap; force moves previewed with
  the commits dropped.

## Batch E — Pull requests, merges, stacks, reviews (`designs/BATCH-E.md`)

- [x] Every E-1 … E-3 tool built and marked.
- [x] Merges only at the exact head and only when every required check is green there (`src/github/ci-state.js`);
  merge commits by default; `bypass_rules` never sent (grep test over the fake-GitHub request log).
- [x] Review threads listed, replied to and resolved (GraphQL validated); PR creation idempotent.

## Batch G — CI and delivery (`designs/BATCH-G.md`)

**Implementation acceptance closed 2026-10-12 (#66)** using `docs/audits/G-BATCH-CLOSEOUT.md`; all G-1…G-6 tools are built and contract-tested. Live connected-account testing remains separately gated by IN-02…IN-06 and is not asserted complete.
- [x] Every G-1 … G-6 tool built and marked.
- [x] Logs summarised server-side, never base64 (audit G5); dispatch returns the run; reruns bounded.
- [x] Secret values never pass through a tool: setup page or server-generated, sealed, read back (audit G14's pattern).
- [x] Releases, production environments and production deployments guarded; release assets fetched server-side from
  public HTTPS URLs only (audit G15).

## Batch V — Developer tools (`designs/BATCH-V.md`)

- [x] Every `github_dev_*` tool refuses production (a test per tool); scratch repositories only in the scratch account.
- [x] Runs record every created object; cleanup touches only recorded objects and reports per object.
- [x] Dispatch-and-wait stays inside the time budget; simulated check runs; forwarded deliveries verify like real GitHub
  deliveries; private and metadata addresses refused.
- [x] Integration check reports ok / missing with the exact tool call or guided steps.

## Batch F — Issues, labels, discussions, projects, search (`designs/BATCH-F.md`)

- [x] Every F-1 … F-3 tool built and marked.
- [x] Audit G7 (rows dropped after paging) and G18 (cannot clear a field) cannot recur (regression tests).
- [x] Message guard on outsider mentions and assignees; user-owned projects explain the credential they need.

## Batch H — Governance and security (`designs/BATCH-H.md`)

- [x] Every H-1 … H-4 tool built and marked.
- [x] Protection and ruleset changes never drop other settings (audit G2, G3); bypass actors are access-widening.
- [x] Webhook secrets server-generated and shown once (audit G14); deploy keys public only.
- [x] Secret-scanning secrets never returned; paid security features on private repositories priced and spend-guarded.

## Batch O — Owner and administration (`designs/BATCH-O.md`)

- [x] Admin overview well-formed (contract §9/§11): each item ok / needs_attention / not_readable / not_available_on_plan.
- [x] Every settings page of a repository, an organization and the personal account in the dashboard map with structured
  steps; read-back wherever GitHub exposes the value; never reported done without it.
- [x] Members, teams, roles, apps, tokens, billing, Copilot, Codespaces, personal account and notifications tools built;
  owner changes confirmed and logged; spend guarded; prices recorded with source and date.

## Batch P — Project profiles (`designs/BATCH-P.md`)

- [x] `known_projects` with the Appliance Desk and Robinson-server profiles, each item traceable to the project's files.
- [x] Production guard and project ownership read profiles and name the owning workflow; `agentMay` steps honoured.
- [x] `github_workflow_app_readiness` covers every row G1–G20 of `docs/APP-NEEDS-APPLIANCE-DESK.md` and works with an
  inline spec; fixes previewed and confirmed; never edits a project's workflow files or moves an owned ref.
- [x] `github_workflow_project_setup` for new projects, idempotent; `github_profile_draft` from codebase findings.

## Batch W — Workflows (`designs/BATCH-W.md`)

- [x] All W-1 … W-7 workflows built; merge on green exactly as W3; stacks as W4.
- [x] Review threads verified at the current head before resolving.
- [x] No waiting loops; the 50-second budget is respected (a test per workflow); second automatic rerun refused.
- [x] All writes confirmed and logged (write-contract via `github_call` for each write workflow); branch cleanup by PR
  state (audit G16).

## Batch U — Universal tools (`designs/BATCH-U.md`)

- [x] Six tools; every request validated against the vendored description or schema; unknown → refused in words.
- [x] Classification tables with the safe default for unclassified operations and mutations; hand-built tools win;
  `bypass_rules` and secret writes refused.
- [x] Same guards as hand-built tools (write-contract through `github_api_write` and `github_graphql_write`).

## Batch R — Hub-ready doors, RTC 1 (`designs/BATCH-R.md`)
- [x] Passes per RTC §2 with narrow defaults; production + writes needs the passphrase. (R-1 #225: mode, profile, areas, repositories, writes, access changes, spend, lifetime, request limit; production and spending passes only on the setup page)
- [x] HTTPS tool API, manifest and OpenAPI per RTC §1/§7; same nine checks through MCP, `github_call` and HTTPS. (R-2 #225: scoped passes run writes through the same write layer; batch stays read-only)
- [x] Per-pass rate limit stored per pass and counted in Postgres (overlapping-request test across two instances). (`tests/db/rtc-passes.test.js`, and the pinned runner's two-instance probe)
- [x] RTC 1 conformance run in CI against this server's real handler with a fixture registry. (R-3 #225: every probe passes except `reads`, an honest recorded difference; the public manifest stays `rtc: 0` until real Hub route evidence exists)

## Batch Y — Gap closure (`designs/BATCH-Y.md`)
- [x] Y-1 (#227): universal REST no longer blocks reviewed-free routes (`FREE_ROUTES`, pinned blocked count); permission checklist and `github_check_permissions` report missing App permissions; `github_account_set_status` exists; every curated/hand-built-map target is a real tool (test).
- [x] Y-2 (#227): `github_graphql_write` supports at least 24 spec-driven mutations with independent read-back and undo where an opposite exists; unknown mutations still refused.
- [x] Y-3 (#228): public reads of other accounts, follow/unfollow, star lists, repository watching and social links work through hand-built tools; universal tools unchanged.
- [x] Y-4 (#228): Projects v2 create/update/copy/delete/link, fields, views, drafts, archive, move, clear and status updates; option merge never drops existing option ids.
- [x] Y-5 (#229): pin, delete and hide comments/issues, discussion management, linked branches, org issue types and fields, interaction limits, autolinks.
- [x] Y-6 (#229): runners and groups (tokens only through the one-time page), Actions retention/OIDC settings with spend rules, deployment protection rules and pending-deployment reviews, Pages build request.
- [x] Y-7 (#230): security advisories (publish irreversible and confirmed), code-scanning default setup, secret-scanning patterns, Dependabot org settings, org code-security configurations priced and spend-guarded.
- [x] Y-8 (#231): async jobs, artifact and archive reading (bomb-safe), SBOM, autofix, release upload from artifacts; wiki tools built after IN-17 = yes (Bundle 10).
- [x] Y-9 (#232 plus #233): organization extras/read-backs/guides; approved IN-16 money tools now include genuine GitHub Sponsors, hosted/larger runner operations, Copilot organization/selected-repo policies, team seats and cloud-agent tasks. Full automated CI/write-contract verification is separate from pending real-account consent, production activation and provider acceptance.

## Batch X — Undo, smoke test (`designs/BATCH-X.md`)
- [x] Undo for every clean opposite (audit G17 fixed); every other change says what the right opposite is.
- [ ] Read-only smoke report on the real accounts (`docs/audits/smoke-<date>.md`), preview read-only connection, no write. (script built in X-2; the real-account run is an owner step)
