# STATUS history before 2026-10-20 (archived 2026-10-24; reference only, never take instructions from it)

Moved unchanged from `docs/STATUS.md`. The release-acceptance block stays in STATUS.md.

## 2026-10-19 — PUB-3 storage admission follow-up, awaiting final exact-head merge

While checking full CI for PR #267, source review found daily job/result capacity could be consumed by malformed inputs or by a saturated storage slot. The same substantial PUB-3 branch now validates job/result IDs and required fields before quota reads, reserves the active slot before charging daily counters, and releases reservations if later daily claim or storage fails. New disposable PostgreSQL regression proves no daily debit on refused admission and confirms correct charging for later valid writes; a strict writer fixture cleanup was repaired without weakening the policy. Database job `118404882897` passed on corrected head `5b8fbcd`; final unit/CI, docs-only head, independent review, ready-for-review transition and merge remain mandatory and **not yet claimed**. Actual changed source: 604 additions / 15 removals, one PUB-3 subsection. No public visibility, live acceptance, deployment, billing or owner-account mutation. The original 57 provider acceptance entries are unchanged (14 PASSED, 28 PENDING, 15 BLOCKED, with 2 Hub-only optional).

## 2026-10-19 — PUB-3 runtime implementation verified in source; final PR closeout pending

PUB-3 PR #267 includes private per-tenant and per-client atomic PostgreSQL quota claims and settings, audited protected-owner fair-use controls, bounded jobs/results and expiry cleanup, privacy-safe provider/MCP/OAuth/refresh outcome metrics, and owner-only emergency revocation and one-tenant cleanup. Initial malformed duplicated source was corrected rather than skipped. Implementation head `49ee0e1aa1b6e8eca012651e3451662cf1f16c54`: **CI 39352668681 SUCCESS** (both unit shards, real disposable PostgreSQL, request shapes, RTC, static checks), **Daily live policy 39352668770 SUCCESS**. New disposable PostgreSQL tests prove isolation, revocation and concurrency while retaining default OFF pilot and existing user capability and spending controls. The card `docs/pr-cards/PUB-3.md` captures all six source acceptance proof lines. **Final docs index/status head must independently pass CI and review before merge.** No deployment, paid capacity, public listing, new provider acceptance or outside-user enrollment is claimed.

PUB-1/2 merged in source, PUB-3 source ready for exact-head merge, PUB-4 real supported Android/iOS and desktop/web compatibility and end-to-end provider acceptance are the next approved work; PUB-5 publication policy/owner decision BLOCKED. Actual `live=f98b45c4e53a154b369d126c59cda35b7a1886fa` is behind `main=3c68af7dfe0a2352d53f490a395908bc3b2be260` at this checkpoint. Original 57-case provider acceptance remains 14 PASSED / 28 PENDING / 15 BLOCKED (2 Hub-only optional). Do not disconnect official GitHub plugin until the private custom connection works on BOTH platforms; do not bypass daily release or enable user production writes without exact independent approval.

## 2026-10-19 — PUB-3 private runtime safety work IN PROGRESS (source only)

Frozen original six-line PUB-3 acceptance plan committed in `docs/pr-cards/PUB-3.md` before changes, baseline `main=3c68af7dfe0a2352d53f490a395908bc3b2be260`, independently ready `live=f98b45c4e53a154b369d126c59cda35b7a1886fa`. Branch `ai/chatgpt/pub-3-runtime-capacity-20261019` adds dormant per-tenant PostgreSQL quota+aggregate metric tables on tenant provisioning, atomic all-or-nothing shared tenant/client request quota, admission at real private MCP and token/OAuth routes, 24-hour storage/job expiry clamps, safe result byte/job count budgets, and clean small-domain telemetry. These are service capacity/fair-use limits, not a developer $0 user capability restriction. Owner's legacy MCP route and entire GitHub production/approval/protected-source permissions are untouched. No public plugin listed, outside customer signed up, paid capacity provisioned, or production data migrated.

**PUB-3 still IN_PROGRESS, not an acceptance pass or merged feature** until all test and incident cleanup, exact-head CI/review/merge conditions are met; new `tests/db/pub-3-runtime.test.js` exercises real two-tenant concurrent PostgreSQL budgets/retention, `tests/unit/pub-3-runtime.test.js` validates fail-closed inputs. Current source tests/CI not yet complete at checkpoint; do not claim all six criteria pass. PUB-4 actual Android/desktop native acceptance remains separate, PUB-5 public distribution BLOCKED by IN-18; the original 57-case real provider queue retains 14 PASSED/28 PENDING/15 BLOCKED. Official GitHub integration stays connected until private replacement proves itself on both devices.

## 2026-10-19 — PUB-2 private OAuth source implementation: verified for merge; actual acceptance remains separate

The owner clarified that **implementation completion is not real-world acceptance**. PR #264's implemented source now provides the GitHub-verified private multi-user OAuth path: one-use GitHub browser consent and App installation checks; provider numeric identity; per-tenant/per-human encrypted U grant; independent tenant MCP client, code, access/refresh and revocation; private protected owner pilot provisioning, repeat-safe bootstrap and second-person allowlist; discoverable standard MCP authorize routing; fail-closed disabled pilot, suspended App, invalid tenant, user revocation and cross-tenant denial; and full original owner compatibility. Controlled owner invitations are **testing infrastructure**, NOT a permanent customer signup requirement. Private pilot and outside-user access remain disabled, and genuine future end users must complete their own delegated GitHub authorization with no developer passphrase.

Exact source head `bb2b8b134178221e82abad3332398f6ceccc23eb` **ci 39299501837 SUCCESS** (check, both unit shards, disposable PostgreSQL, shapes and RTC); **Daily live policy 39299501840 SUCCESS**. Full CI is implementation evidence, not a GitHub live/customer/device pass. Source documentation reconciliation requires another exact-head CI/review before merging PR #264, and the merged main must independently pass required checks. The original **57 provider acceptance criteria are still 14 PASSED / 28 PENDING / 15 BLOCKED**. PUB-3 tenant capacity/rate/incident engineering and PUB-4 actual ChatGPT Android/desktop OAuth acceptance remain separately approved and unimplemented; PUB-5 public Directory distribution stays BLOCKED by IN-18 third-party eligibility and separate owner approval. `live=f98b45c4` remains behind current `main=4a94f301`; no publication, production App installation, paid GitHub use, live release, or outside-user enrollment was enabled by this PR.

## 2026-10-19 — PUB-2 private tenant authorization security continuation

Owner-approved PUB-2 remains **DRAFT #264, NOT MERGED / NOT DEPLOYED / NOT COMPLETED**. Source changes after the previous green checkpoint now isolate each GitHub App user's encrypted U token by BOTH tenant and verified identity, reserve installation-wide I credentials for the tenant owner while routing invited members' ordinary tools through their own provider-restricted GitHub App U bearer, rotate expiring personal GitHub grants with a one-use PostgreSQL lease, verify provider identity and installed App again on renewal, and reject stale refresh claims without erasing newer sign-ins. Same-owner bootstrap is idempotent. Callback cookie parsing and suspended App refusal are repaired with disposable PostgreSQL security tests. **The reconciled pre-final head `2b74fe14` passed full CI and release policy; fresh exact-head CI for later U-token/callback improvements remains mandatory.** Private pilot stays OFF, custom mobile/desktop acceptance remains unverified, original real provider acceptance 14 PASSED / 28 PENDING / 15 BLOCKED. Merged `main` includes updated optional Hub-owned routing acceptance; standalone RTC1 compatibility remains mandatory. No production migration, outside-user enrollment, app publication, live release, or developer spending.

## 2026-10-18/19 — PUB-2 draft #264: private GitHub OAuth implementation expanded; INCOMPLETE

**Verified draft source head before docs:** `cbd9412e6ab86bd4c71574370b35312ac0ff9755`, GitHub Actions `ci 39182803768 SUCCESS` (both unit shards, real disposable PostgreSQL, shapes, RTC and check) and `Daily live policy 39182803752 SUCCESS`. The normal daily production release has NOT been triggered by this PR; `main=692c38550217c84b6afa5fc4840ea753be8e049f` and last independently verified `live=f1397503be40ab4cb2bbff70c19c43b146c7c6d3`. Original provider acceptance unchanged: **57 criteria, 14 PASSED / 28 PENDING / 15 BLOCKED**.

**Implemented in UNMERGED DRAFT, not publicly active:** HMAC-signed tenant+identity `tcl_` client, `tac_` access and `trf_` refresh credentials, independent signed client/token routing through only an approved tenant namespace, no fallback to the global owner database; single-use tenant GitHub OAuth browser state, mobile-sized private mode/profile form, secure CSRF, S256 PKCE, independently verified numeric GitHub `GET /user` identity and `/user/installations` App ownership, server-stored issuance of tenant-bound MCP authorization codes; private verified-client registration and per-tenant membership/allowlist. Actual GitHub user token values are never returned to the ChatGPT tool. PostgreSQL and mocked GitHub HTTP tests cover two tenants, nonce replay, wrong identity/installation, cross-tenant refresh, and immediate revocation.

**Still UNFINISHED PUB-2 engineering (0 new completed unit credit):** idempotent owner-passphrase-gated tenant/bootstrap and customer App provisioning, supported private client OAuth registration/discovery path for real ChatGPT clients, full owner lifecycle/cleanup, stronger concurrent refresh/code redemption and sign-out coverage, and final scoped end-to-end protocol/security review. Code will refuse absent `GITHUB_PRIVATE_TENANT_PILOT=enabled`, independent 32-byte HMAC secret, App client credentials and enrolled installation; these have NOT been configured or activated live. No outside-user enrollment, public plugin listing, paid test, live mutation or production data migration was done. PUB-3/PUB-4 remain unimplemented, PUB-5 public submission BLOCKED. Continue within **the same draft PR #264**, not new helper PRs; test exact final head and merge only when all original card acceptance lines pass.

## 2026-10-18 — PUB-2 private provider identity and pilot allowlist PARTIAL, in progress

Working branch `ai/chatgpt/pub-2-private-delegated-oauth-plan-20261018` contains pre-code frozen full card `docs/pr-cards/PUB-2.md` at `dc9e8c7bf18e03df7561a17c287d5d615af60a0b`; current `main=692c38550217c84b6afa5fc4840ea753be8e049f`, `live=f1397503be40ab4cb2bbff70c19c43b146c7c6d3`. Added `src/tenancy/github-identity.js` with genuine fixed-endpoint GitHub GET /user stable numeric subject verification and fail-closed private-pilot resolver, together with additive owner-only per-tenant pilot-allowlist storage in `src/tenancy/directory.js`. New focused `tests/unit/pub-2-pilot-identity.test.js` and genuine `tests/db/pub-2-pilot-identity.test.js` cover provider success/refusal, disabled pilot, two tenants, no cross-tenant permission, and allowlist/membership revocation. **No public route imports these helpers**, and GITHUB_PRIVATE_TENANT_PILOT is default disabled. **PUB-2 remains IN_PROGRESS and incomplete:** independent provider-verified OAuth registration, tenant-bound auth code/token/refresh routing, actual App/repo delegation, full HTTP contract, no legacy fallback and private end-to-end pilot are still unbuilt. No real provider acceptance, production deployment, mobile/desktop UI pass, public listing, customer enrollment or paid operation is claimed. Use one draft PR to run focused/CI checks and finish the same whole subsection before merge; do not split into helper PRs. Original 57 real provider acceptance stays **14 PASSED / 28 PENDING / 15 BLOCKED**.


## 2026-10-19 — Owner: Hub connection is NOT a GitHub MCP completion gate (source review pending)

The Hub initiates discovery, authorization, connection and routing. GitHub MCP must implement and verify the current [Hub connector specification](https://github.com/Robinson-AI-Systems/robinsons-toolkit-hub/blob/3cc7f4ad4332155d639125b23e8a5c4c13804a3d/docs/HUB-CONNECTION-SPEC.md) **on its standalone server**, including truthful RTC1 metadata, direct-service authentication/denial/revocation, bounded meta tools and independently deployed direct MCP and RTC conformance. A working Hub relay, Sandbox-mediated connection, Hub discovery or Hub-owned live sign-in is **not required** to complete this provider. Retain historical `GITHUB-RTC-RELAY` and `GITHUB-RTC-SANDBOX` as BLOCKED and separately optional (`completionGate:false`) without false passes or deleting them. Direct provider `GITHUB-RTC-DIRECT` remains required and BLOCKED pending genuine service-issued RTC acceptance. **Historical original queue unchanged: 57 entries, 14 PASSED, 28 PENDING, 15 BLOCKED; required provider queue 55, 14 PASSED, 28 PENDING, 13 BLOCKED** plus 2 optional Hub-only route checks. Owner decision changes only acceptance ownership, not tested contract truth, release, credentials, security or public distribution. Latest independently READY `main=live=f98b45c4e53a154b369d126c59cda35b7a1886fa`; Hub reviewed spec `3cc7f4ad4332155d639125b23e8a5c4c13804a3d`. PUB-2 #264 remains separate unfinished draft and does not become a pass.

## 2026-10-18 — PUB-1 private tenant boundary implementation IN PROGRESS (not accepted)

The approved **PUB-1** card is frozen at `docs/pr-cards/PUB-1.md` on branch `ai/chatgpt/pub-1-private-tenant-isolation-foundation-20261018` with baseline `2354b53279e1a5e2e02692c7f506d39217636fde`, before code. New `src/tenancy/directory.js` is a **dormant internal** directory for stable numeric GitHub subject identity, tenant membership revisions, and separately instantiated per-tenant PostgreSQL schema paths. It does **not** expose a new public OAuth route or onboard a new person. `tests/unit/pub-1-tenancy.test.js` tests malformed identity/URL and schema driver fallbacks; `tests/db/pub-1-tenancy.test.js` uses genuine throwaway Postgres to verify two tenants can overlap account/login/credential/client identifiers without shared OAuth refresh, retained results, jobs, replay keys, protected policies or cleanup. Both test files and the initial corrected head passed full CI 39159077607 including real PostgreSQL and both unit shards. Final source patch additionally checks all 28 tenant tables before activation, and requires a new exact-head green run/review before merge. This source is NOT deployed. Legacy root account/login data stays in its existing tables and no production migration, release, customer sign-up, GitHub provider mutation or new spending is authorized.

**Count:** PUB-1 source is **MERGED-as-if-in-PR / 1 implementation unit after exact-head green and merge**, with independent real PostgreSQL and security test evidence; PUB-2..PUB-4 APPROVED not implemented; PUB-5 BLOCKED on IN-18 external Directory eligibility and owner launch approval. Original 57 live acceptance rows remain **14 PASSED / 28 PENDING / 15 BLOCKED**, entirely distinct. Current independently READY `live=f1397503`; merged `main=2354b532` is ahead of live and not a deployment claim. Preserve the official GitHub app and PRIVATE custom candidates; genuine mobile/desktop PRODUCTION acceptance awaits the checked release and supported client flows.

## 2026-10-18 — P1 post-merge review correction: PUB work visible and early Directory policy gate

PR #261 merged with source-only design for user-mandated mobile+desktop and PRIVATE-first public-scale safety; its late automated review exposed two genuine handoff P1s: the canonical work-index still reported zero approved future units, and the public ChatGPT Plugin Directory policy was treated as a late step despite an express bar against unofficial third-party connector submissions. Follow-up `ai/chatgpt/public-scale-index-policy-corrections-20261018` corrects both: register PUB-1…PUB-4 **APPROVED but unimplemented** and PUB-5 **BLOCKED** in the authoritative index and validator, and frontload an IN-18 external policy/authorization gate. OpenAI's published guidelines refuse primarily unofficial third-party connectors; public Directory eligibility for GitHub by Robinson AI Systems is **not established**. A secure PRIVATE/workspace-first GitHub MCP can still be engineered, but do not publish or misrepresent GitHub endorsement. This correction is documentation/roadmap work, not production-scale code, a source release, a new provider acceptance pass or public publication authority. Existing original acceptance remains 14/57 passed. Exact-head CI, peer review and merge remain independently required.

## 2026-10-18 — B-2 connection repair merged; dual-platform/private public-scale still outstanding

**Actual source:** `main=83d021e8fdb97fd6a75eb3bd52beff7b8c722321`, incorporating reviewed corrective PR #260; exact-head `ci` and daily-live release policy succeeded, both reviewer threads resolved, and merged-main `ci` and daily-live policy succeeded. **Deployed:** independently READY production still serves `live=f1397503be40ab4cb2bbff70c19c43b146c7c6d3`; the new setup-page owner mode-upgrade action is **NOT YET LIVE**, and no actual new PRODUCTION/full custom session is attested. Original 57-criterion acceptance queue remains **14 PASSED / 28 PENDING / 15 BLOCKED**, unchanged. The scratch **account** is production-enabled by independent owner/passphrase action, but the last verified cloud-adapter **connection** is full/PREVIEW; no specific production-classified scratch write, paid operation, deletion or outside-user action was executed. A normal scheduled release (not manual promotion) and genuine custom `github_whoami` + provider readback on mobile/desktop remain necessary before acceptance.

**Owner completion expansion:** both mobile and desktop, PRIVATE plugins until owner approves public launch, and future public-scale multi-tenant safety are binding. Existing global-admin/GitHub-account data model is **not** safe for public onboarding. The owner's requirement and a proposed architecture for PUB-1…PUB-5 work are recorded in `docs/designs/PUBLIC-SCALE.md` on private-scale design branch `ai/chatgpt/private-public-scale-plan-20261018`, **DESIGN ONLY** with no publication, multi-tenant source implementation, new provider token, capacity purchase, synthetic acceptance claim or original roadmap subsection credit. The old direct desktop plugin and cloud Sites mobile adapter are confirmed PRIVATE and may coexist with official GitHub until fully replaced. Remaining gate: review new design, implement full isolation and client testing under additive plans, no outside production registrations.

## 2026-10-18 — B-2 corrective maintenance: existing custom ChatGPT adapter remains PREVIEW (not deployed)

Owner verified production ON for `robinson-ai-scratch`, but native custom ChatGPT OAuth remained full/PREVIEW because the separate Sites cloud adapter displays ChatGPT sign-in instead of underlying MCP OAuth choices. No manual release can fix that UI. This frozen B-2 maintenance branch `ai/chatgpt/b2-existing-connection-production-20261018` implements a password/CSRF-protected existing connector mode upgrade, narrow single-account/full-profile restrictions, atomic fake/Postgres storage, retained credentials, audit/readback and regression tests. **Source branch only, pending exact-head CI/review/merge/checked release and real acceptance; original 14 PASSED / 28 PENDING / 15 BLOCKED remain unchanged.** Official GitHub connector untouched; developer $0 spending/fixture/independent approval rules preserved. Owner also requests plugin label **GitHub by Robinson AI Systems**; plugin metadata update API disallows changing Sites-generated App name/presentation. Do not claim rename done.

## 2026-10-18 — Original B-5 real-world acceptance completed (one NEW criterion)

On independently Vercel READY `f1397503` and the real saved custom full/PREVIEW scratch OAuth, post-plan B-5 native provider-read tests produced genuine HTTP403 accepted-grant diagnostics: private Dependabot alerts disabled (vulnerability alerts read) and private code scanning unavailable without Advanced Security (security events read). The tool treated actual named entries as conditional endpoint requirements, **not proven missing App permissions**; direct `github_check_permissions(security)` confirmed there are no missing grants. Independent package P request refused securely as `client:no_credentials` (no supported package token enrolled), and foreign repository owner refused `client:outside_scope` before provider. No boolean/schema-only App grant was recommended, no owner consent was requested, and no real header body or credential was copied. The provider-header translator DID execute for both true 403s; package/foreign errors were earlier guards and are not misrepresented as provider-header tests.

This newly closes exactly `GITHUB-B5-PERMISSION-GUIDANCE` from PENDING to PASSED, yielding **14 PASSED / 28 PENDING / 15 BLOCKED of 57**, subject to reviewed permanent evidence merge. Frozen pre-work plan `a6852bb327a90b0f718d1ab85826c4f7f1479a2a`; code/source already merged and proven in prior CI, no new engineering/new source changes or extra roadmap-unit credit. Subsequent live probes: the full five-repository weekly digest has independently complete 7-day billed $0 Actions/Copilot usage but remains PARTIAL due private and public security-alert inventories disabled/unreadable; W-2 existing three-PR stack safe preview is NOT READY (draft/required CI missing); W-6 release correctly refuses production-classified creation in PREVIEW; W-6 cleanup preview excludes protected/unknown-control branches; W-7 repository setup dryRun stops at draft, creates nothing. All original multi-part criteria remain pending. No paid Actions, repo creation, merge, release, deletion, production switch, permission grant, package token entry or unapproved fixture cleanup.

## 2026-10-18 — READY release reconciliation, live acceptance and U refresh race recovery (#pending)

Checked current main/live `f1397503be40ab4cb2bbff70c19c43b146c7c6d3` and the independently READY production deployment `dpl_C3uAZsQN2NbZAVWzREFbH2V4chxH` with matching production aliases. Exact-main `ci`, `release-policy`, both unit shards, database, shapes and RTC checks succeeded; no open PR at initial inspection. This resolves the old source-only release queue gating without inventing original acceptance credit. The 57-row queue remains **13 PASSED / 15 BLOCKED / 29 PENDING** pending full criterion-specific readbacks and approvals.

Actual new custom PREVIEW/full service-issued evidence: verified org `robinson-ai-scratch`, U actor `christcr2012`, production OFF; guided user profile links correctly use that actual user. Personal account status is `ok` with matching authenticated U numeric identity; organization 2FA independently reads false, org overview properly distinguishes 12 ok / 2 attention / 4 unreadable / 2 unavailable-on-free-plan, and the guided UI still requires independent browser confirmation. Permissions are 23 areas satisfied, zero missing App grants, one package capability unverified: a P token is not enrolled, and real package list fails early `client:no_credentials` truthfully. Separate provider-header translator acceptance is not claimed. Sponsors first reported transient expired U, then same authorized payer/recipient returned a complete *empty* relationship and `sponsors_listing_available=false` with no payment. No published-tiers/price fixture; original Sponsors criterion remains pending. Exact public-scratch Actions/security reads now succeed; complete W-5 health/security workflow remains partial because there are zero CI runs and code/secret-scanning inventories are unreadable or disabled.

This new OAuth symptom exposed a plausible repeat-refresh race: old A-5 refresh both consumed one-use U refresh tokens concurrently and could clear auth after a losing call; Y-9 Sponsors independently verified the payer twice concurrently. A separately frozen pre-code plan `docs/pr-cards/A-5.md` commit `064ac051b1077b6b193add2b11733e9534e4b5f3` covers a service-wide atomic cross-instance claim, conditional encrypted-token finish/clear, transient provider non-revocation and one-payer verification. Source and focused fake + PostgreSQL contractual tests are on the pending maintenance branch `ai/chatgpt/completion-oauth-refresh-race-20261018`. This is **corrective maintenance, zero newly countable original roadmap subsections**; Initial PR #258 exact-head CI exposed only required catalog drift documentation and a non-secret schema allowlist entry (116 other PostgreSQL tests, both unit shards, RTC and shapes passed); Codex P1 required bounding the OAuth POST below its persisted lease. Those three issues are included in one corrective patch. Fresh exact-head CI, independent review and safe merge are still required. No operator OAuth reset, spend, non-scratch write, production activation, package credential, live disposition or fixture deletion has been performed.

## 2026-10-18 — O-1 personal navigation and end-user authority corrective completion PR #257 (source, not deployed)

On independently Vercel READY 20389ae0c667ec49d8ce80c5d48f4e2c42f7b2a2, the actual PREVIEW/full native custom MCP's user guide inventory resolved `{user}` to the enrolled scratch **organization** name, even though the enrolled U actor is `christcr2012`. Both guide doors were found to use that organization-as-person shortcut. Five historical owner dashboard guides also asserted developer-only never-purchase/sponsor/delete prohibitions as product restrictions, conflicting with docs/END-USER-AUTHORITY.md. PR #257 freezes this maintenance correction in plan commit `1a7d5d1a661c67abc88e4418c5f1dbcb8b89714e` and implements binding to the selected account's enrolled U identity, unavailable-identity null links, truthful guarded end-user-capability guides and focused regressions. This adds **zero** originally countable subsections or real acceptance passes. Local executor unavailable; full exact-head CI, security, RTC, shapes, database, review and merge remain independently required; a successful PR check is not deployed acceptance. 57 original queue rows remain **13 PASSED / 15 BLOCKED / 29 PENDING**. No new OAuth, package token, paid request, production switch, fixture disposal, outsider notification or manual release. Existing quarantined run untouched.

## 2026-10-18 — W-1 original compound acceptance completed

The actual custom PREVIEW/full service on independently READY 20389ae0 now proves the full existing GITHUB-W1-OPEN-PR criterion. Existing PR reuse and separately guarded label application/repeat/readback/restoration were followed by an outsider-mentioned proposed reverse PR: dry-run names NOTIFIES octocat, direct unconfirmed writer needs_confirmation, composed workflow not_applied/needs_confirmation. No notification or new PR was sent. Foreign-owner workflow refused and underlying repo read reports outside_scope before provider access. Independent all-state PR inventory remains exactly the original PR at the same head/base/open state and restored labels. Fifty-seven original criteria, thirteen PASSED and forty-four open; this accepts one existing criterion, zero new roadmap subsections/bundles.

Sponsors first complete CI cycle passed check, shapes, RTC, PostgreSQL and unit shard 1; shard 2 found seventeen new test expectations naming read rather than the existing earlier cost refusal. Core already refuses unverifiable cost before readFailed. The correction adds independent read rejection assertions and retains exact spend refusal/zero mutation proof; production guards are unchanged. No local run is claimed while the runner is offline.

## 2026-10-18 — Sponsors entity selection and genuine reversible write proof

Real curated Sponsors read failed because its document queried a user and organization at the same login; an organization-only U query succeeds with complete empty relationships. Frozen remote pre-code plan 5a2b07d509174cc430d6e08f2f05069cc91cb7f7 precedes source 098fdb8d43ed5fd7591aeecb2a86559d98bb0397, which verifies enrolled payer identity, selects entity-specific roots, handles verified absent listings, and preserves price/cadence/privacy readback. Public visibility and email opt-in use the existing access-change guard. Local runner disconnected before these edits; no local verification claimed. Required complete exact-head CI, review and merge remain mandatory. Correction earns zero new original subsection/bundle credit. Live remains independently READY 20389ae0; genuine corrected Sponsors acceptance remains queued.

Actual W-1 write acceptance also advanced: the custom workflow applied the existing documentation label to the owned public fixture PR, repeated safely without duplicate PR, and independently matched GitHub readback. Custom label removal then restored the exact original labels and head, independently confirmed. This does not close the compound notification/outsider-denial criterion. Three earlier corrections are merged: #253 package credentials, #254 personal authority, #255 truthful permission diagnostics. Fifty-seven criteria remain tracked, twelve fully passed; no package token, payment, production activation, manual release or outside notification occurred.

## 2026-10-18 — stop phantom permission approvals from provider metadata

A genuine live U package read was rendered as needing a nonexistent allows permissionless access write grant. B-5 source e054d200 now accepts only explicit permission levels, excludes nonselectable metadata/schema-only names, and treats accepted grant entries as requirements to compare rather than proof of missing consent. HTTP/request evidence, provider refusal, redaction and all write/rate guards remain. Stable full local units 8,192/212 and focused 30 passed; first earlier local run was invalidated by an in-progress source/test change and was not claimed as final proof. Frozen pre-code 5ccb26c/published d470755e. Package PR #253 merged 86bb77be and O-1 PR #254 merged 3ad6f298 with green exact-head gates and resolved review findings. Native U is valid; independently READY service remains 20389ae0, so all new source acceptance is queued. Fifty-seven criteria now tracked, twelve recorded passes; no new original subsection/bundle credit, production activation, credential enrollment, spending or manual release.

## 2026-10-18 — O-1 recognizes genuine enrolled personal authorization

The owner-requested completion pass reproduced an unconditional personal-status refusal despite valid U. The corrective branch now verifies GET /user under U for organization-associated and personal accounts, matches enrolled identity, returns minimal actual status and preserves denied/foreign/withheld fields honestly. No new owner OAuth, App grant, server setting, production or spending change. Frozen local plan 270374b, published identical 667c17d7, implementation c2bdb909; original O-1 already counted, zero new subsection/bundle credit. Local full 8,155 tests/210 files and focused 23 passed before integration. Package PR #253 is merged as 86bb77be, every exact-head gate green at f5f6d34a and both review threads resolved; remote branch was automatically deleted. Combined source checks, CI/review and source-bearing scheduled release remain required; live is still independently READY 20389ae0. Original guided UI acceptance stays open.

## 2026-10-18 — package private-user and credential-removal review correction

Independent PR #253 review found two P2 issues before merge: missing private personal authenticated package routes and package-token removal unnecessarily requiring an encryption key. Both are corrected with exact actor/account binding, numeric enrollment identity, protected keyless removal and provider-shape regressions. Self-review also requires curated routing for all twelve package delete/restore variants so the supported credential never unlocks weaker generic writes. Seven focused files pass 232 tests; corrected full unit suite passed 8,179/211 files, final focused 135 tests includes malformed-inventory refusal, and all 21 shapes passed. Fresh exact-head CI/review remains pending. No genuine package token or artifact mutation is involved.

## 2026-10-18 — pre-release package credential implementation and read acceptance

Owner-authorized release preparation continues on a645ae56 baseline. Dedicated package credential P adds protected actor/scope-verified enrollment/removal, encrypted additive persistence, exact account/package-route enforcement and existing guarded G-6 read/delete/restore integration. It does not request another GitHub App grant or weaken notifications K. Frozen engineering plan f8a14e3; corrective maintenance, zero new bundle credit. Local full unit verification passed 8,173 tests/211 files; all 21 request-shape tests and final focused 123 tests passed. Exact-head CI including database, review and merge remain required. Live remains independently verified READY 20389ae0, so this source is not deployed or accepted. Actual safe retests found Copilot policy all and selected-list not applicable, but content exclusions returned ambiguous 404. Genuine U task inventory is complete and empty; foreign account refused. GraphQL typed variables, alias and fragment matched the independently read repository node ID; full acceptance evidence and limits are tracked with the original queue. No production, premium task, paid or package mutation was performed.

## 2026-10-17 — GitHub.com package permission diagnostic correction

Owner-authorized scratch App permission updates and personal OAuth are complete: actual GitHub installation UI confirms available Packages read/write, merge queues, runners, artifact metadata, agent tasks and Copilot/admin grants; actual custom MCP reports U=true with user christcr2012, PREVIEW/full, production OFF. The remaining 23/24 warning is a source defect: `organization_packages` appears in the pinned token schema but is absent from the GitHub.com App settings. The corrective Y-1/B-8 branch removes that unavailable key from the App manifest, upgrade list and area needs, preserves genuine `packages` write requirements, and tests both positive and denied diagnostics. Review identified package handlers using installation credential I despite pinned provider routes marked unavailable to GitHub Apps; package diagnostics therefore report capability unverified separately from zero missing grants, rather than falsely declaring runtime readiness. No provider operation, credential policy, package mutation or live activation changes; no package live acceptance is claimed. Initial local verification: 8,143 unit tests, 21 request-shape tests and npm check passed; initial exact-head CI including database passed. Review patch: 132 focused tests and npm check passed again; fresh exact-head CI remains required. Frozen plan: c0a1102, `docs/pr-cards/Y1-PACKAGES-PERMISSION-CORRECTION.md`. Await exact-head CI/review/merge and normal scheduled deployment; real package operation acceptance remains separate. Original roadmap engineering is not recounted as a new bundle.

## 2026-10-17 — actual personal U + O-4 original read acceptance (pre-release, no writes)

After frozen plan `e556818bfd002cc7493eeecf39d727942cd5441a`, re-observed the existing custom GitHub MCP (full/PREVIEW; enrolled scratch organization I and newly authorized user U; production OFF) against independently confirmed READY alias/live `20389ae0c667ec49d8ce80c5d48f4e2c42f7b2a2`. Genuine GitHub billing, budgets, Marketplace, Copilot seats and organization/user Codespaces reads all returned complete real provider inventories with no spend; a foreign personal billing owner was denied `client:outside_scope`. Independent GitHub user identity corroborated the marketplace principal. Exactly original `GITHUB-O4-BILLING-CODESPACES` changes PENDING→PASSED with sanitized proof; the 55-row ledger becomes **10 PASSED / 15 BLOCKED / 30 PENDING**. Product finance authority fixes on main remain newer than live, all actual paid/security/production/cleanup tests remain separately gated, and no manual release was triggered. Genuine original read evidence is in `docs/pr-cards/O4-USER-READ-ACCEPTANCE-OCT17.md`; local checks unavailable via REST, exact-head CI/review required before accepting this source branch.

## 2026-10-17 — H-4/Y-9 owner-authority diagnostics, safe source candidate

During this continuation's acceptance-first check, independently verified main `a822d1d16da9e017b26b14d7a41a0932e1e21fd8`, production live `20389ae0c667ec49d8ce80c5d48f4e2c42f7b2a2` (Vercel READY `dpl_4VjLPk5SYik8BrdasY4JVJ8urNCH`), and genuine custom MCP PREVIEW/full scratch I, U absent, production OFF. The original live queue remains **9 PASSED / 15 BLOCKED / 31 PENDING**, no fresh complete live acceptance credited. Actual custom W-5 repo-health and security-review calls on owned public scratch returned partial, with unavailable code/secret inventories and no billed/provider changes. Newly observed H-4 dependency and Y-9 enterprise network-configuration sources mislabel generic GitHub 403/404 as definite plan failure; a scoped correction on `ai/chatgpt/completion-permission-entitlement-truth-20261017` preserves original permission/error diagnostics, fully pages organization network configuration inventories, and verifies requested network resource IDs after guarded writes. Plan frozen `27905bc40b3cde86b709ed6150ca2fd70b9b5fd2`; test, required CI/review and PR merge must be independently checked before claiming source completion. Original H-4 and Y-9 subsection engineering previously merged, no duplicate credit; release and production acceptance remain separate. No user permissions, spending, scratch resources or live settings were changed.

## 2026-10-17 — large-organization security configuration completion correction in source

After merging #248, a related Y-7/H-4 source correction implements GitHub's documented `after` cursor pagination for org code-security configurations and their attached repositories, avoiding a false 100-repository functional ceiling and requiring complete own-scope inventories before configuring private paid protections. Previously, the delete preflight converted unreadable attached-repo inventories to an empty array; the corrected operation must refuse unverified deletion. Explicit nested options, configuration description and enforcement changes now require provider readback rather than accepting an unchanged setting. Builder production/spend restrictions and user-selected caps remain independent, and the 55 original live acceptance rows are not automatically passed by this source work. Current branch: `ai/chatgpt/completion-org-security-config-cursor-20261017`; no release or live security provider write authorized.

## 2026-10-17 — security administration corrective source work

A new H-4/Y-7 product-authority correction closes the repository-security switch gap and replaces an invalid Dependabot security-updates PATCH with GitHub's documented status/read/enable/disable routes. The provider's independent GET distinguishes disabled from unreadable permissions and reports paused state; delegated bypass adds explicit access-widening classification; private billed toggles preserve user-chosen spending limits. This is source work on `ai/chatgpt/completion-security-authority-20261017`, not a newly passed external acceptance task. Both original H-4 and Y-7 engineering were previously merged and are not credited again; run original external acceptance only against checked READY source after merge/release.

## 2026-10-17 — billing and Copilot end-user capability correction in source

The owner confirmed that temporary developer spending and live-operation restrictions are not product defaults. A source-only remediation branch updates organization billing budget control and Copilot seats so the customer's delegated actions can proceed with clear cost uncertainty notices rather than requiring a static quote. Existing explicit user spending caps, service pass constraints, confirmation, production access and provider readbacks remain mandatory. Prior batch implementation is not recounted. This is not deployed or real provider acceptance until separately verified.

## 2026-10-17 — genuine W-3 review-thread acceptance and V-2 standalone cleanup provider defect

The original W-3 review-thread task is now independently PASSED on the actual checked deployed custom MCP: run-owned private PR #1, three current/outdated discussions, exact-head reply/resolve previews, falsely asserted fixed and stale-head refusals, real three-reply provider readback and zero unresolved after a timed-out/unknown RPC response **without replay**. Newly created fixtures are strictly scoped to `robinson-ai-scratch`; none were disposed without the required exact owner confirmation. Connected public V-2 cleanup remote preflight for `completion-public-oct17` found a genuinely existing run label absent because source used a **nonexistent GitHub GET** by issue-label name. Official read-only issue-label list shows the label; source correction in the same V-2/W-3 completion PR implements only the valid bounded GET, with negative/pagination tests. All original V-2 final live teardown and earlier quarantined cleanup acceptance remain unpassed; private Free-plan ruleset inventory remains unreadable and fails closed. Live release and separate destructive owner approval have not been assumed.

## 2026-10-17 — W-1 deployed PR-status original read acceptance, W-1/W-4 genuine provider source corrections (pre-release)

Original W-1 status task is now independently PASSED on checked READY d49aebd6 against separately run-owned public scratch PR #1; custom PREVIEW/full observation matches independent GitHub REST PR exact head, one successful simulated ci check-run, draft/no merge, no review threads, no stack and no provider read-side mutation. True test fixture writes used only scoped development tools (zero Actions minutes); three additional scratch PRs in a second separately labeled complete run were also created and verified by registry+provider, not merged. Run identifiers/fixtures are retained for exact cleanup approval, and original quarantined Oct 13 private fixture remains untouched. W-1 open PR live call exposed real 8-KB held full listing and normalized head/base incompatibility; W-4 CI summary real live call incorrectly said done:true on zero Actions runs. The corrective source on branch `ai/chatgpt/completion-workflow-live-contract-20261017` is frozen in original W-1 plan commit 7b132596c7d9eebb87aef7d360c101138ae655ee; only after full exact-head CI/review/merge can it await the normal scheduled release. No new source acceptance is asserted from deployment, no manual release. Source and original real acceptance remain separately accounted.

## 2026-10-17 — live owner spending/cost read accuracy repair (source candidate)

Main at planning 701b801ace9882ec050df3fe65cb858f447fe59a (post X-2 smoke-hardened PR #243); `live` and Vercel READY stay on older d49aebd6b13365401a8a863876b4a3151b7fa910. Current custom Robinson GitHub Cloud PREVIEW/full scratch I is genuine and did not require a user U or a production switch for its read checks. Its own `github_whoami` reports `spend_limit_explicit=false`, but the actual `github_admin_overview` displays spend ceiling $0 and text "Autonomous spending is $0", misleadingly mixing developer $0 with customer spend policy. `github_billing_get_usage` returned a legitimate complete zero-dollar provider response, yet the same overview always hard-coded `billing-usage` unreadable. The discrepancy is source-proven, not guessed and is not an invitation to spend.

Approved O-1 source maintenance frozen at 0727780a2322fac2f3dd354ad331e699f47cb39f on `ai/chatgpt/o1-live-owner-billing-truth-20261017`: reuse B-4 pure effective-limit logic (legacy unselected $0 remains **no product cap**, explicit user $0 remains enforced), O-4 canonical usage summary, and the existing O-1 read path to show true selected UTC monthly provider billed amount or unreadable. Tests cover default versus explicit cap, positive historical cap, genuine full zero/nonzero billed rows, permission denial, malformed dates and no provider writes. **No changes to saved spending policy, GitHub payments, production, App grants, fixture or releases.** Original O-1 previously merged (#197/#224) remains credited once; this below-volume financial/read correctness fix is independent additional authorized work, not fabricated 400–800 production lines. Await exact-head CI/review, merge and normal checked deployment; original full `GITHUB-O1-OWNER-OVERVIEW` acceptance remains PENDING for owner UI/manual confirmation.

Current original 55-row acceptance ledger unchanged at **7 PASSED, 15 BLOCKED, 33 PENDING**. Also independently checked existing installed scratch App permissions: 21/24 areas OK, 3 families missing four GitHub permission grants (Packages, organization Packages, organization self-hosted runners, merge queues). These are owner/GitHub installation permission prerequisites under already approved IN-15, **not** a reason for the developer to self-elevate the App or claim a pass. Real admin overview legitimately reported unconfigured org 2FA and plan-limited SSO/audit-log and incomplete private security coverage; no account setting was changed.

## 2026-10-17 — next authorized pre-release smoke integrity repair, unchanged acceptance queue

Verified actual current main at 7afea6689f5fd42990297db5a791b8f63701a0e1 (PRs #240–#242 merged), live at d49aebd6b13365401a8a863876b4a3151b7fa910, Vercel production dpl_BWfVi8NaNDpej18hcGW5qQKLwqGP exact source READY, no open PR at baseline. **Normal scheduled release not run manually.** The existing 55-row source-pinned acceptance ledger remains 7 PASSED / 15 BLOCKED / 33 PENDING; this X-2 implementation source **does not** add real account acceptance or flip any queue status.

Acceptance-first review: prior live three real READ passes for U2/W5/W7 retain independent evidence; multiple real private-plan provider feature probes and W5/weekly digest were incomplete (and stay so). U-1 exact curated routing fix from #240 and digest nested billing fix from #242 are **not yet in READY** and cannot be accepted from CI; original queue rows identify them. Actual Y9d hosted-runner plan, Copilot App permissions, and Sponsors personal U still require provider/owner preconditions. Protected scratch mutation, webhook fixture/cleanup, real org U, and optional Hub transport remain separately approval gated; no attempt to elevate permission, spend, run destructive acceptance or alter production. Record per-ID dispositions in the 55-row ledger rather than losing them to a top-N queue cap.

New eligible extra source work: ai/chatgpt/x2-smoke-integrity-20261017, plan commit fbd64b08489c79b3ae95fa1d013f4fdf9af9d379, closes verified X-2 **source** defects: a credential-bearing read audit could GET an arbitrary domain, accept opaque GraphQL, mark partial real read workflows PASS and persist unsanitized provider messages. The existing scripts all-tools smoke result is no longer allowed to imply complete coverage from an incomplete or unknown result. Added strict GitHub API-only read transport, AST one-query checks, redirect/token-URL denial, fixture scope validation and scrubbed evidence, plus realistic negative tests. Existing original X-2 previously delivered; this is a corrective engineering exception only, not a new original feature count. Full exact-head CI and independent self-review required before merging; real account smoke still requires its own safe owner-account connection and request-scoped evidence. No user bills, GitHub mutation, service grant or release.

## 2026-10-17 — additional pre-release W-7 weekly billed-usage source correction (verification candidate)

After completion PR #241 was exact-head green and merged, source `main=89bbfbf6b3a35673e43fcf05cfd631d5484e2df0`, live remains `d49aebd6b13365401a8a863876b4a3151b7fa910`, Vercel READY. The genuine custom MCP `github_billing_get_usage` returned verified zero-dollar day from GitHub with nested `usage:{items:[],complete:true,total_net_dollars:0}`, but real `github_workflow_weekly_digest` mislabeled all seven successful provider cost reads unknown. The bug was not a missing authorization: `src/tools/workflows-find.js` expected nonexistent flat `cost.items`/`cost.complete` while the actual registered `src/tools/billing-read.js` consistently provides `cost.usage.items`/`cost.usage.complete`.

Approved already-implemented W-7 source has a bounded corrective topic branch `ai/chatgpt/w7-digest-real-billing-shape-20261017`: frozen plan `04ad7cc1c64bd189aaeaa316e576ee7148892f6b`, implementation `fe913a2517a27184c475434273fa6c83c63ca36d`, real-shape regression `c16029a9b2cc6830e09c997bacdb334a917edf8b`. Net production **17 additions/5 deletions**, tests **43 additions/5 deletions**. Changed consumer validates nested usage, account identity, exact month and every day-specific line item; accepts actual complete empty zero spend but never substitutes $0 for incomplete/foreign/malformed provider bills. This is a source-only repair, **not a further normal-volume bundle**, not accepted/deployed, and no old W-7 engineering credit is recycled. Required exact-head CI/review/merge and later checked scheduled release/real-world acceptance remain ahead. No developer paid, live or credential changes executed. Genuine health/security review remained incomplete due lack of scanning/entitlement on existing scratch, and digest original acceptance `GITHUB-W7-DIGEST` stays PENDING until source is READY with legitimate readable billed/security coverage. Separate completed three-criterion read-only completion bundle from #241 remains recorded with 7 PASSED, 15 BLOCKED, 33 PENDING unchanged.

## 2026-10-17 — pre-release genuine standalone MCP read acceptance bundle (three original tasks)

Source at planning: main `6a99aba2de258c28bcdd884cc6fd07d9ce319579`, live `d49aebd6b13365401a8a863876b4a3151b7fa910`. Independently read Vercel production READY `dpl_BWfVi8NaNDpej18hcGW5qQKLwqGP` (matching live exact SHA, canonical alias); source-bearing ancestor U-2/W-5/W-7 already deployed. Actual private Robinson GitHub Cloud custom-MCP connection reports `robinson-ai-scratch` full/PREVIEW, I true, U false, production OFF. No GitHub changes, paid requests, production activation or authorization changes occurred.

Frozen completion acceptance plan commit `e23a9f23264ec9c742929853abbd3c021ca02c1f` in `docs/pr-cards/READONLY-CUSTOM-ACCEPTANCE-OCT17.md` selected three original queue tasks with baseline **PENDING**. New actual scoped provider observations:
- **U-2 GraphQL:** typed variable/fragment/alias owned public repository and `issues(first:2)` returned a bounded provider result (2 estimated points, 21 max nodes, zero real issues). An unconnected owner was refused, and unsafe deep nested pagination and oversized page values rejected before dispatch.
- **W-5 Access Review:** complete member/outsider/team/App/token/invitation/collaborator/deploy-key coverage for both scratch repositories; independently repeated provider collaborator, deploy-key and team reads. Found App installation scoped to all scratch repositories and correctly labeled it **needs_attention**, without making access changes or calling it clean.
- **W-7 Find:** both real scratch repos found, all six content types enumerated, and genuinely zero additional PR/issue/commit/Actions-run/release matches in those existing fixture repositories. Direct scoped GitHub searches and run/release reads corroborated empty inventories. One-item cap produced partial+page 2; unreadable nonexistent repo produced real 422/404 with `not_readable`/partial; foreign owner denied. No artificial data or live mutation.

Original queue statuses for precisely these three IDs moved PENDING→PASSED with fresh actual observations; all other 52 queue items and exact source revision pins remain unchanged. Queue now **7 PASSED, 15 BLOCKED, 33 PENDING (55 total)**. This is proposed as **one COMPLETION bundle** with 3 previously unmet original deployed real-world criteria, no new production code, no original engineering re-credit. Prior partial END-USER-AUTHORITY-LIVE plan stays incomplete/uncredited. Source `main` is ahead of live only for separate merged #240 exact-routing correction; it remains unavailable for current live U-1 routing reacceptance until next checked release. No manual/off-schedule release.

## 2026-10-17 — current exact-release custom acceptance and new routing defect

Independently reconciled GitHub `main=live=d49aebd6b13365401a8a863876b4a3151b7fa910`; Vercel production deployment `dpl_BWfVi8NaNDpej18hcGW5qQKLwqGP` READY with exact matching Git SHA and canonical live alias. Real *custom* Robinson GitHub Cloud service OAuth works on `robinson-ai-scratch`, PREVIEW/full, I credential, no U, production OFF. No real GitHub writes, purchases, live activation, added permissions, fixture deletion, off-cadence release or spend performed.

**Read/denial-first catch-up:** Closed only `GITHUB-O4-AUTH-PREVIEW` with complete $0 budget and empty Codespaces inventories, exact org/member and two real mode-denied provider writes. `GITHUB-Y7-AUTH-PREVIEW` now BLOCKED by private Free-plan entitlement (public and org config reads and mode denials genuinely observed); `GITHUB-U1-AUTH-PREVIEW` stays PENDING because the deployed universal API incorrectly routes pinned budget DELETE to budget SAVE and broad Codespaces/Copilot patterns conflate different safeguards. Hosted-runner acceptance was genuinely refused on the Free plan, Copilot org policy returned 403 for missing App permissions, and U-2 typed GraphQL read passed only a subset of its original criterion. Exact per-ID evidence is committed in the ledger. No other queue row was converted to PASSED from a schema fake or simple 403. Count now 4 PASSED, 15 BLOCKED, 36 PENDING (55 total).

**New corrective source:** `ai/chatgpt/authority-live-acceptance-20261017` freezes a separate engineering plan at `8302fc88d29287a0596863a82e2d98a4368355bf`, remaps exact method+path to actual specialized guarded provider tools for billing, Codespaces, Copilot, hosted runners and security, and adds regression tests. This is a NEW security/routing integration fix, not repeat credit for historical Y-1/O-4/Y-7. It must pass exact-head CI/review before merging, then its deployed routing must be independently re-accepted after the next release. The earlier completion-only read plan `0e52eb5495d904c0053d470b4c3ef305a0ff78e8` remains **incomplete** because all three frozen acceptance tasks did not PASS. Do not count it as a bundle.

## 2026-10-17 — owner-authority corrections merged; honest source/live split and acceptance handoff

Three independently planned *corrective engineering outcomes* are merged into `main` (not repeat delivery credit for original roadmap engineering): O-4 budget/Codespaces actual delegated writes **PR #236**, merge `efe8e928991f0da72cf4e1db7d2d56f44fee0084`; H-4/Y-7 paid private-security delegated provider features and organization code-security configurations **PR #237**, merge `0539a4d4ec3feaf24457f70d0df818647ced6bba`; Y-1/U-1 non-curated REST unknown-spend authority correction (54 strictly reviewed free write routes; others cost-unknown and governed by user/pass limits) **PR #238**, merge `ee44da0e7b73f26dca247e0e17c3738796a9d3ec`. The frozen corrective plan commits are recorded in `docs/pr-cards/O-4.md`, `docs/pr-cards/Y-7.md`, and `docs/pr-cards/Y-1.md`. Each exact-head aggregate `ci`, both unit shards, `check`, `shapes`, `db`, `rtc` and `release-policy` passed. Verified each merge with expected source head; no open PR or unresolved inline review thread remained. Codex review quota was exhausted, **not** silently treated as passed; documented substantive self-review and source-accounting exceptions are on PRs #236–238. The corrections are relatively compact source deltas with broad user-capability impact; neither historical original work nor documentation/test lines are credited as extra production work or falsely promoted to minimum-volume bundles.

Reconciled source `main=ee44da0e7b73f26dca247e0e17c3738796a9d3ec` against `live=a79f08643241d727b38da87b7713728baad39746` and independently queried Vercel production READY `dpl_FfGNUDzo7vwjExCgD5YYWZZt47Rv` (GitHub SHA matches live; aliases ready). **No new correction is deployed or real-provider accepted.** Production remains OFF, developer spending authorization $0; no production/billing/private security/Codespaces mutation, permissions elevation, off-schedule deployment or cleanup performed. Normal checked scheduled live promotion remains governed by repository release procedure; no authority to force publication assumed from a build merge.

Acceptance reconciliation: 48 historical source-pinned obligations (3 PASSED, 8 BLOCKED, 37 PENDING) were **preserved exactly**. This handoff adds 7 new source-pinned obligations for these actual corrected user capabilities: 3 read-only/non-writing preview checks PENDING after source-bearing READY, plus 4 real provider writes BLOCKED pending independent test-target/cost/permission/production authorization. The new ledger contains **55 rows (3 PASSED, 12 BLOCKED, 40 PENDING)**. No stale or historical evidence is relabeled as newly passed. Do all eligible no-write acceptance once live has the exact required revision; handle genuine blocker evidence while continuing other approved checks. The prior source-only staging notes below are historical checkpoints, superseded by this merged-source record. The developer's testing limits are separate from the authenticated end user's chosen tool authority.

## 2026-10-16 — Y-1/U-1 universal spend product-authority repair (source staging; no CI pass claimed)

Planned against real main `efe8e928991f0da72cf4e1db7d2d56f44fee0084` after corrective PR #236 merge. The frozen `docs/pr-cards/Y-1.md` owner-authority plan was committed first at `82456d2f165f6f529521aa212957dcf7af207863`. Historical original Y-1 #227/U-1 #219 source remains previously credited and is not counted again. New scope: remove source-level permanent denial of the historic 100 potentially priced universal provider routes, make **all unreviewed writes** cost unknown (not guessed free by risk-word absence), preserve 54 exact reviewed-free routes, actual chosen user and RTC pass limits, protected full-profile confirmation, validated scoped provider request, one-send journal and honest readback/unconfirmed reporting. Test exact pinned inventory, provider risk categories, cost-free allowlist, user-selected $0/finite limits and pass-cap controls. No live GitHub activity, new spend, production enablement, provider acceptance or external release occurred. Engineering branch `ai/chatgpt/owner-authority-universal-spend` is **not merged or CI-accepted** until explicit exact-head evidence/review. Existing acceptance queue remains open.
## 2026-10-16 — Y-7/H-4 private paid security authority corrective engineering (new work, not accepted)

Frozen source plan in `docs/pr-cards/Y-7.md`, initial planning-only commit `d1897afe1c0bb4dc84ccec5d67916c305a451477` based on main `e75afd8e38c166bff666fc5a53a73344f73dc463`. Original Y-7/H-4 implementations already merged; **do not recount their old line or subsection credit**. New source work removes outright product denial for private paid feature toggles, code-scanning default setup, and organization code-security save/attach/default. Replaces denial with unknown ongoing active-committer cost warnings, real provider actions/readback, user-selected spend and RTC pass gates, and security production consent. The provider's pinned configuration-attachment route is not pageable: the implementation reads its single supported up-to-100-result page and **fails closed** for a full page, rather than assume financially relevant private targets are absent. Existing guard denies true missing GitHub plan entitlement. Fake tests cover real user authorization, finite and zero caps, selected/private scope, readbacks and free protection disable. No paid test, live mutation, changed owner permission, production enablement, release or off-repo change performed.

This entry is a **pre-merge/source-only checkpoint**, not a CI pass, merged bundle, deployed acceptance or independently reviewed success. Current custom provider queue 45 of 48 not passed remains unchanged; release eligibility remains separately governed.

## 2026-10-16 — O-4 end-user authority repair (engineering branch; not accepted yet)

Frozen plan: `docs/pr-cards/O-4.md`, planning commit `784859cf2ff9a0e6e52f4f3431babf23183fceb9` after inspected main `e75afd8e38c166bff666fc5a53a73344f73dc463`. Implementing branch: `ai/chatgpt/owner-authority-o4-execution-v2`. Original O-4 source was already merged and must not be counted again. This is new corrective engineering required by the owner's explicit 2026-10-16 END-USER-AUTHORITY decision: replace two formerly browser-guided controls with real guarded GitHub APIs. Budget deletion performs exact DELETE with twice-named ID and independently proves absence plus preservation of other visible budgets. Organization Codespaces visibility performs actual PUT after exact org/membership checks; GitHub has no policy GET, so a provider 204 remains **unconfirmed** and must be independently inspected by owner, never falsely accepted as state readback. Both honor production authorization, full profile, protected resources, confirmation, durable replay, genuine user-chosen cost limits and uncertain metered exposure. Cost-reducing access disable remains eligible with a user $0 cap. No real billing deletion, Codespaces access change, spending, release, cleanup or production activation by developer took place.

Source and synthetic tests committed to the branch; **no local run, exact-head CI, independent review, merge or live provider acceptance has been claimed** at this checkpoint. Existing 48 acceptance queue rows (3 passed, 8 blocked, 37 pending) remain unchanged. Verified Vercel READY alias at `a79f08643241d727b38da87b7713728baad39746` while inspected main is 52 commits ahead, so new O-4 source and Y9D cannot be treated as deployed. Next: exact-head CI, all failure corrections, review/thread checks and guarded merge; after checked scheduled release append source-pinned O-4 provider acceptance. Old `ai/chatgpt/owner-authority-o4-remediation` was superseded before publication by the valid frozen-plan branch and has no PR.

## 2026-10-16 — Y-9d merged engineering and explicit deployed acceptance queue (bookkeeping, not a second implementation bundle)

PR #233 merged at `1fa4298d69041d1bc988e2ee4f693cff954a76b3` with source head `395a54e73d48a8c7bf39e1782368f7619787f899`: exact-head aggregate `ci` and `release-policy` passed; documented repository-required self-review addressed all six owner review objections, with no inline review threads. Automated Codex review was unavailable due to account quota and is not claimed. Scope: original remaining **Y-9/WU-Y9d**, five new source modules, 17 tools; 713 source additions and 23 source deletions compared with governing main at review. Y-9a/b/c remain credited only to #232. The source merge is not evidence of deployed, paid, owner-consented or RTC/Hub acceptance. Added six new source-pinned queue obligations here (four read-only credential/plan checks, one no-write denial, one explicit-owner-gated mutation); existing 42 checks and their dispositions are preserved. **No developer paid action, production activation, irreversible operation, cleanup or release has been authorized or performed.**

## 2026-10-16 — Y-9d as-if-merged engineering handoff (PR #233)

Y-9d completes approved Batch Y source capability for 17 new direct tools (411 total): real Sponsors payments/cancellations/preferences, hosted-runner creation and management, Copilot policies/selected repositories/content exclusion/team seats, and cloud-agent tasks. The developer/test actor has spent $0 and performed no live provider mutations. The shared budget logic now honors **end-user-chosen** financial limits instead of interpreting the developer's inherited default $0 as a user restriction. Verified-priced and explicitly unknown future metered risks are disclosed; production and true user/pass authorization gates remain. CI and review must be verified at the final exact PR head and recorded in the final merged PR comment; code-only source acceptance does **not** establish customer/provider acceptance. IN-15 plus new Y-9d GitHub App permissions, user OAuth, current deployment, production consent, real scratch/Hub RTC and the expanded 48-row acceptance backlog remain independently OPEN. Post-release acceptance is not assumed from this PR.

## 2026-10-16 — Y-9d financial capability repair (open engineering; PR #233 draft)

Owner corrected the product role boundary in merged policy PR #234. The current Y-9 branch implements candidate **real API execution** for hosted-runner creation, capacity increases, Copilot cloud-agent tasks, Sponsors, team seats, org cloud-agent permission policy and exclusion management. The shared write and spend path now distinguishes user-chosen limits from historical developer $0 defaults; unknown future metered exposure is described and confirmed instead of rejected by default. Restrictive RTC passes and explicit user spending caps still refuse out-of-policy operations. The new token for Copilot agent tasks must be U; GitHub installation I cannot launch them. **Do not claim this code accepted yet:** exact-head full CI, independent review, provider-shape and nine-write-contract proofs, actual App permission grants, deployment and live acceptance must precede completion. No actual billable or live GitHub actions were executed during implementation. IN-15 permission approval remains an owner go-live action.

## 2026-10-16 — Owner product-authority interpretation correction (documentation only)

Owner clarified developer-operating $0 spending/TEST/production-off restrictions are **not** intended product restrictions on end users or their coding agents. Added governing END-USER-AUTHORITY.md and pointed AGENTS/DECISIONS/Batch Y/owner inputs at it. GitHub MCP still needs actual Y-9d paid execution, migration of end-user spend guard defaults, authorized metered-unknown capability and regression/real-world acceptance; draft PR #233 cannot be merged as complete. This correction does not authorize spending, paid fixture runs or production activation by a developer agent.

## October 16, 2026 — Bundle 10: Y-8d wiki, Y-9a organization extras, Y-9b read-backs, Y-9c web-only guides (PR #232)

Chris answered yes to IN-15, IN-16 and IN-17 (recorded in `docs/OWNER-INPUTS.md`). **Wiki (Y-8d, 3 tools, 394 in total):** list, read and write repository wiki pages. GitHub has no wiki API, so the server talks git to the wiki in memory (two new pinned libraries, `isomorphic-git` and `memfs`); only the wiki address on github.com is reachable and the token never appears anywhere. The first page of a brand-new wiki must still be saved in the browser. **Organization extras (Y-9a, 5 tools):** security manager role for a team, hosted-compute network configurations (Enterprise Cloud only), and organization migrations (start and status; the archive holds private data so it is never fetched, status points to the browser download). **Read-backs (Y-9b):** `github_admin_check_setting` can now read back 9 more settings pages from GitHub (Actions permissions and retention, interaction limits, repository general flags, security features, Pages, member privileges and more) and only says "verified" when the value matches. **Guides (Y-9c):** 12 more browser-only settings (profile and organization pictures, social preview, pins, profile README, contribution visibility, recovery codes, project workflows, discussion categories, announcement banner, revoking a leaked token, tag protection).

Not built on purpose: reporting a leaked credential through a tool (the endpoint takes the secret itself).

Not claimed: no live acceptance of any Y tool; Chris still has to add the new App permissions on github.com (IN-15) before the user- and runner-permission tools can work.

Next: Y-9d, the money tools (Sponsors, larger hosted runners, Copilot administration), each with a price check, the spend limit and confirmation.

## October 16, 2026 — Bundle 9: Y-8 background jobs, artifacts, archives, SBOM, autofix (PR #231)

Y-8 of the gap-closure Batch Y (8 new tools, 386 in total). **Jobs:** slow GitHub work returns a job id; `github_job_status` checks once and never waits; `github_job_cancel` stops tracking. **Reading:** look inside a build artifact or a repository snapshot (list files, read one text file; binary files show size and SHA-256 only; zip bombs, unsafe names and links refused), and read a repository's software parts list (SBOM), directly or as a background report. **Autofix:** ask GitHub for a suggested fix for a code scanning alert, then commit it to a named branch (default branch counts as production). **Release upload** can now take a build artifact (whole zip or one file) as its source. **Wiki:** a browser-steps guide only, because GitHub has no wiki API and the two extra libraries need your approval (IN-17, default kept).

Not claimed: no live acceptance of any Y tool. The owner-inputs file still shows IN-15, IN-16 and IN-17 as open; Chris says he answered them, but the answers are not recorded anywhere this server can read, so defaults are used until he restates them.

Next: see Bundle 10 above.

## October 16, 2026 — Bundle 8: Y-7 security writes (PR #230)

Y-7 of the gap-closure Batch Y (12 new tools, 378 in total). **Advisories:** create or edit a draft security advisory, publish it (public, cannot be undone, GHSA id typed twice), request a CVE, and privately report a vulnerability to another project as you. The advisory text never appears in a result or the change log, only a fingerprint (SHA-256). **Scanning:** turn code scanning default setup on or off, create/edit/delete custom secret-scanning patterns for an organization or repository, and choose which repositories Dependabot may read. **Organization configurations:** create/edit a code-security configuration, attach it, make it the default for new repositories, detach it, delete it. Anything that would switch on paid security features for private repositories is refused (the cost cannot be calculated), so paid configurations only reach public repositories.

Not built on purpose: push-protection bypass review and advisory private forks (GitHub's pinned description has no such route) and autofix (waits for the Y-8 jobs table).

Not claimed: no live acceptance of any Y tool; the App's security permissions need your approval on github.com (IN-15).

Next: see Bundle 10 above.

## October 16, 2026 — Bundle 7: Y-5 moderation and organization planning objects, Y-6 runners and Actions administration (PR #229)

Y-5 and Y-6 of the gap-closure Batch Y, delivered as one PR (28 new tools, 366 in total). **Y-5 (16 tools):** pin and unpin issues and comments, delete or hide comments, edit review comments, delete issues (number typed twice), close/reopen/edit/delete discussions and mark answers, link or unlink branches, organization issue types and fields (select options keep their ids), issue field values, interaction limits and autolinks. Deletes always ask first, show the author and text as untrusted data and have no undo. **Y-6 (12 tools):** list and read self-hosted runners and groups; remove a runner (a busy one is refused), set labels, create/edit/delete runner groups (letting public repositories use a group is off by default and asks first with a warning), set group access; runner registration, removal and just-in-time tokens are sealed and revealed once on the private setup page (never in a chat or log); one tool to set cache retention, cache size, artifact/log retention and the OIDC subject template (raising a storage limit counts as spend and is blocked while the spend limit is $0); add or disable custom deployment protection rules (only apps GitHub lists), answer a waiting custom rule, and request a Pages rebuild. Not built on purpose: `github_deploy_review_pending` (an existing tool already does it).

Not claimed: no live acceptance of any Y tool. Answering a custom protection rule only works if this server's App owns that rule; new App permissions still need your approval on github.com (IN-15).

Next: see Bundle 8 above.

## October 16, 2026 — Bundle 6: Y-3 other people's data, follow, star lists; Y-4 Projects v2 lifecycle (PR #228)

Y-3 and Y-4 of the gap-closure Batch Y, delivered as one PR (27 new tools, 338 in total). **Y-3:** an agent can now read any public profile, a user's public repositories, followers, following and social links, and any public repository (README excerpt, contents, releases, issues, pull requests) through GET-only allowlisted routes; a private or missing repository gives the same answer. As the signed-in user (credential U) it can follow or unfollow a person (a stranger needs your confirmation because following notifies them), watch or ignore a repository, add or remove up to four https links on the profile, and create, edit, delete and fill star lists. **Y-4:** fifteen project-board tools: create (private), edit (making it public always asks first), copy, delete (exact title typed, production-class, no restore), link to a repository or team, fields (select options keep their ids unless you name the ones to remove), views (create/delete only; filters and charts stay web-only), drafts, convert to issue, archive, move, clear a field, remove an item and post status updates. Every tool reads first, proves GitHub says the project belongs to a connected account, sends one change and reads it back. Verified locally: `npm run check`, 409 new/updated unit tests plus the full suite, DB and shape suites.

Not claimed: no live acceptance of any Y tool; user-owned projects and the user-credential tools need the owner's GitHub sign-in (credential U).

Next: see Bundle 7 above.

## October 16, 2026 — Bundle 5: Y-1 unblock the universal tools, Y-2 spec-driven GraphQL writes (PR #227)

Y-1 and Y-2 of the gap-closure Batch Y, delivered as one PR. **Y-1:** a reviewed-free route table (`src/github/spend-classes.js`, 54 routes) lets the universal REST write reach self-hosted runner and runner-group administration, OIDC customisation, deployment approvals, package delete/restore, Pages rebuilds and artifact-metadata records; everything whose cost cannot be computed stays blocked (100 writes, pinned in a test). Six App permissions were added to the manifest for Apps created later, three new permission areas (`packages`, `runners`, `merge-queue`) and an `app-permissions-review` guided setting list exactly what you must approve on github.com for the existing App (IN-15; GO-LIVE row added). New tool `github_account_set_status` (your profile status, read back field by field) and a registry test that fails if any "use this tool" pointer names a tool that does not exist. **Y-2:** `github_graphql_write` now supports 24 reviewed mutations (pin/unpin issue and comment, lock/unlock, minimize/unminimize, discussion close/reopen/update/delete and answer marks, comment edit/delete, issue delete with an admin check, draft/ready for review, linked branches, team review assignment). Each proves ownership of every id, reads the item before and after, refuses a no-op or an item that changed since the preview, never lowers the access/notification marks, and records an undo (pin → `github_undo_change` → unpinned is tested); deletes say plainly they cannot be restored. Total tools 311. Not deployed, not provider-accepted; production remains OFF.

Next: see Bundle 6 above.

## October 16, 2026 — Documentation audit and gap-closure plan (Batch Y), docs/planning only (owner-requested)

Audited every status document against the code and fixed the drift: tool count (310), table count (27), HTTPS routes, dependencies, the stale "what is next" sections, ticked acceptance boxes for merged batches, card status lines, work-index readiness and PR numbers, and 71 Card cells in the catalog (`built #n`). A separate capability audit found roughly 40 things you can do on github.com that an agent cannot yet, plus six contradictions (the universal tools are narrower than advertised). `docs/designs/BATCH-Y.md` plans all of it with the hard logic written out, and cards Y-1…Y-9 are in the work index (APPROVED, not started). Owner decisions added: IN-15 (approve new App permissions on github.com), IN-16 (money tools: build or keep guided), IN-17 (wiki libraries). No code changed; production remains OFF.

Next: Y-1 (unblock the universal tools), then Y-2; owner-run acceptance (real-account smoke report, scratch write/cleanup, production activation, Hub route evidence) is still open.

## October 16, 2026 — Bundle 4: R-1 scoped passes, R-2 HTTPS door for them, R-3 conformance run (PR #225)

Owner answers (same day): IN-10 default is 120 requests per minute per pass (1–600 per pass); build write-capable passes now. A pass now carries its own limits: preview/production, read-only/everyday/full profile, changes allowed or not, access changes allowed or not, spend allowance, areas, repositories, lifetime (30 days; a year only for Robinson's Toolkit) and request limit. Production and spending passes can be made only on the setup page (passphrase); an agent may make a preview pass with no spending and no access changes (`github_create_pass`, shown once, undo = revoke). Limits are enforced in the database, at issuance, on every HTTPS call, in the shared dispatcher (so `github_call` and workflows are bound too), in the gates, and in the GitHub credential (repository passes get installation tokens limited to their repositories). Owner controls (production, spend, connections, secrets, passes) are never available to a pass. The HTTPS door runs a pass's changes through the same write layer and answers with the change-log number; batch stays read-only. The pinned Hub conformance runner now runs against the real handler with a fixture registry: every probe passes except `reads`, because this server never returns more than 8 KB in one reply. The public manifest stays `rtc: 0`. Not yet done: real Hub route evidence and live acceptance (owner/release queue). Next: nothing left in the approved roadmap order; remaining work is owner-run acceptance (real-account smoke report, IN-04/05/06 live proofs).

## October 16, 2026 — Bundle 3: X-1 undo, X-2 smoke report, H-4 reporting toggle, O-1 close-out (PR #224)

`github_undo_change` runs a change's stored clean opposite through the same guarded tool (refuses unknown, foreign, unconfirmed or overtaken changes; says what to do when there is no opposite). `scripts/smoke-readonly.mjs` produces the read-only smoke report (not yet run on a real account: owner step). `github_security_set_feature` and `github_security_get_settings` now cover private vulnerability reporting. H-4 and O-1 cards and index closed out; paid private security activation and live acceptance stay with the owner. Next: R-1..R-3 (passes, HTTPS doors, conformance), which change authentication and get their own bundle.

## October 16, 2026 — Bundle 2: V-1 webhook-target seed, V-2 forwarder cleanup, H-2/H-3 reconciliation (PR #223)

Merged on green: see PR #223. `webhook-target` is now an executable scenario (scratch repo + run-bound forwarder + test webhook, signing secret revealed once). Cleanup removes run-bound forwarders in both modes. H-2 (#189/#190/#193) and H-3 (#194) were already built; their cards, catalog rows and index status were stale and are now corrected. Live provider acceptance of V-1/V-2/H-2/H-3 stays in the release queue. Next: H-4 remainder and O-1 reconciliation, then R/X.

## October 16, 2026 — V-4 forwarding and V-5 integration check (PR #222), completing the developer CI and webhook loop

Owner direction (same day): deliver each bundle as ONE PR so the slow exact-head CI runs once; all full local gates run before the push. V-3 had already merged separately (#221); this PR carries the rest of the bundle. **V-4 whole subsection**: `github_dev_create_forwarder`, `github_dev_list_forwarders`, `github_dev_delete_forwarder`, `github_dev_forward_deliveries`, `github_dev_create_test_webhook`. A forwarder is a public-HTTPS target (re-checked after DNS and at every send; address pinned; redirects refused; no retry), with a server-generated signing secret kept only as ciphertext and shown once on the setup page. Forwarded deliveries re-send the real recorded payload with the original event, a fresh delivery ID and an `X-Hub-Signature-256` that `@octokit/webhooks` verifies. Timeouts are reported per delivery and never repeated. Test webhooks exist only in the scratch repository a run created (verified scratch organization, at most three per run); scratch cleanup now accepts webhooks recorded by exact ID and still refuses any other. Additive table `dev_forwarders` (20 per connection). **V-5 whole subsection**: `github_dev_check_integration`, read-only, each item ok / missing (exact fix) / unreadable, names only. Not deployed and not provider-accepted. V-1 (`webhook-target` seed) and V-2 (webhook/forwarder-object cleanup for repo-less forwarders) stay IN_PROGRESS for the next bundle.

## October 16, 2026 — V-3 run-owned test refs and CI (PR #221), V-4/V-5 follow in the same bundle

Bundle plan frozen at `05d2ece6ae7568c2bffb13e5e59342e1ec71c3d2` against main `9271b64539d45c629de741fa6df63b8da5f8e1d7` (V-3, V-4, V-5 as one dependency chain; delivered in two PRs because V-4 adds a migration and an outbound-network risk boundary). **V-3 whole subsection**: `github_dev_create_test_branch`, `github_dev_open_test_pr`, `github_dev_dispatch_and_wait`, `github_dev_set_check_run`. Runs are plain (no seed scenario), bound to one host repository, preview-only, capped at 40 recorded objects so cleanup can always list them; every GitHub write is one claimed durable step and an unknown outcome never replays. Dispatch waits at most 45 seconds and returns a handle; a later poll never dispatches twice. Checks are written only on commits the run created and only with the App credential. `github_dev_cleanup` (standalone mode) now also handles fixture files, workflow runs (cancel, delete the exact run, read absence back) and check runs (closed out and reported as retained because GitHub cannot delete them), and accepts a branch whose head is the run's own recorded fixture commit. No migration. Not deployed and not provider-accepted: connected acceptance needs the READY ancestry, an App-backed connection and fixture approval, all unchanged. V-1/V-2 stay IN_PROGRESS (webhook-target and webhook/forwarder cleanup need V-4).

## October 16, 2026 — U-2 Universal GraphQL implementation (candidate)

Approved U-2 source candidate on branch ai/u2-graphql-universal-20261016, frozen plan 0e4db1ac59d6cb5b77cc3bf90488d59ed4e521b9 against main a79f08643241d727b38da87b7713728baad39746. Runtime GraphQL schema parsing, typed variables, bounded point/node estimation, a full-profile one-mutation write with independent node/repo baseline, curated mutation precedence, fail-closed cost and secret classification, and synthetic three-door guard tests are engineering only until exact-head CI, review and merge. Runtime graphql is now a production dependency. U-1 source remains #219 and is not credited again. R-1 still approved and independent. New genuine-service GraphQL acceptance must await checked source-bearing READY deployment and the specific separate read/write authority; no new provider mutation, release, activation or spend is claimed. Source/CI outcome tracked in the PR permanent handoff.

### W source batch closeout — October 15

## 2026-10-15 — U-1 guarded REST candidate PR #219 (CI/review pending)

Approved U-1 whole scope: pinned REST index/search/describe/read/write, schema validation, curated first, production-classified always-confirmed non-curated writes, source/synthetic test fixtures and guarded journal. Frozen plan `ffd38c79ca744d93224025f4ee4ec4267c75aa9f` follows independently inspected main `f538baeb2a656e430865369ed69a150cd56c4644`. This is a candidate, **not a pass** until exact-head gates, review and merge. U-2 remains separate and unimplemented.

Independent non-engineering verification: Vercel deployment `dpl_BETtUL2QmmUXJwhNPRCiM9SjTDA7` READY at `ecf190d7f38b7b62f88b1ae6df830f9dcaaf7904`, 64 commits behind inspected main. Custom MCP whoami PREVIEW/full, scratch org installation enrolled, production OFF, spend $0. PR #218 preserves permanent 36 pending external acceptance tasks (38 total; 2 previously passed). W real-service acceptance awaits deployment; write/cleanup fixtures and RTC require independent approval and authority. No live write, cleanup or promotion performed in this PR.


DRIFT-PROTOCOL C: all W-1..W-7 handlers implemented; code, automated, live/service OAuth, Hub/RTC, revocation and cleanup remain distinct. Owner guidance/architecture/roadmap and IN-06 evidence are reconciled without changing authority. U-1 successor card is prepared, not implemented: pinned version/description verified (1,232 operations; all categorized; 24 notifying rather than historical 25), official version/changelog checked; client validation remains green. No API/vendor upgrade. Existing A-3/A-4 changes-since-design entries remain required by future U/R work, so no live guidance is retired. DECISIONS records the interval and count choices. This required batch closeout is folded into the substantive W-7 PR; source is byte-identical to the 5,526-pass tree.

## October 15 — additional approved W-7 engineering

The same owner request also authorized other ready approved work. W-7 now implements standard new-repository desired state, scoped mixed discovery (including repositories from the original catalog), and seven-day activity/billed-usage digest. Two missing curated repository vulnerability-alert tools provide actual enabled-state read/toggle with independent identity/readback; empty alert inventory is never used as the setting. P-3 exposes a typed conditional private-security step so unrelated defaults can finish without activating paid features or claiming plan entitlement.

Exact source `59e81e0ae9f27ae01ce31ff74891a4e6579f5274`. Genuine local pre-code plan `a9902d475bb27c92ff5e859f45db83a00b481a5c` was committed before implementation; terminal push lacks credentials, so the identical planning card/tree is published as `75a3661f86399ea1072e26afa37d23a023ee9471`. Git Data publication changes commit metadata/time; the original raw local commit is retained in the PR, not misrepresented as a later-created pre-code timestamp. Its inspected baseline is `a7343f606b743b84e312237c9ce3d98efe47feb7`; actual merged #217 main `2b75ef19bfc00da5e0f8b5262a495fbf6ef186be` is preserved as an additional source parent.

Source measurement for W-7 alone: 236 additions / 3 deletions (src only, not tests/docs/generated/check scripts). It is additional approved engineering, not an automatically counted second bundle from one card. The session has three whole original subsections (W-5/W-6/W-7), 607 source additions / 12 deletions, one counted primary bundle plus the additional W-7 work. Preserve actual per-PR rolling measurements; no padding or old-code/helper recount. No claim that remaining U/R/X/V or provider acceptance is finished.

W-5/W-6 #217 already merged as `2b75ef19bfc00da5e0f8b5262a495fbf6ef186be`, exact-head and final-main ci/release-policy green, full local 169 files / 5,473 tests plus shapes/check passed. Permanent handoff: https://github.com/Robinson-AI-Systems/github-mcp/pull/217#issuecomment-6203325469 . That source remains absent from READY live `ecf190d7f38b7b62f88b1ae6df830f9dcaaf7904`; no release requested while independently approved engineering remains.

W-7 focused proof: 63 passes across discovery, vulnerability-alert nine-contract, P-3 and registry suites. Full final source check/unit/shapes, exact-head CI (including disposable DB and RTC), review/merge and final-main proof remain mandatory. No real credential in tests; local PostgreSQL binaries absent, existing CI supplies isolated DB execution. Work-index merged row is as-if candidate merges, not proof of actual merge/live acceptance. Three new source-pinned queue rows remain PENDING. Queue 38 total, 2 historical passes retained, 36 outstanding. Current provider-specific observations and independent fixture/operation/plan/grant gates are preserved.

Self-review: find/digest call only registered readers, postfilter scope, retain denied/capped/timeout coverage, and never imply exhaustive absence from a bounded sample. Activity and date-verified integer-cent usage share seven complete UTC days; Denver display honors DST. Null/unreadable/wrong-date costs stay unknown; Actions SKUs mentioning Copilot are not double counted. Fixed invoices absent from usage are not estimated as charges. Standard setup reuses the durable draft checkpoint and whitelisted guarded writers, private by default, one confirmed child at a time with stable owner/repo intent keys. Unknown policies refuse, private paid security stays conditional owner review, and no profile is activated. Every existing production/access/message/spend/protected-resource gate remains; no privilege or secret path added.

Next original implementation scope is U-1/U-2, with the separately gated original V work and later R/X remaining. No new phase or general roadmap approval is required.

## October 15 — W-5/W-6 maintenance workflow bundle

Approved original whole subsections W-5 and W-6 are implemented together, with five new registered workflows: repository health, account security/access review, staged release and PR-evidenced branch cleanup. Exact implementation source `f150500d51be54f2b9026eaabd01e347bcc22256`; frozen pre-code planning commit `05fa8de8a97ad3c87a207f84988bf33f5021cec2` follows inspected main `5929eb2ac5d0b51350c137ff5cb0ed25c459a8d5`. Candidate branch `ai/codex/w5-w6-maintenance-workflows`; bundle counts only after required exact-head CI, self-review, expected-head merge and final-main verification. Work-index MERGED rows are written as-if this candidate merges, not evidence of actual merge or provider acceptance.

NEW source measurement: 371 additions / 9 deletions, excluding tests/docs/generated and check scripts. Actual is below the initial 650-line estimate and normal 400-line guide. Explicit SUBSTANTIAL_EXCEPTION review: two full original subsections integrate five new workflows, real retained-result pagination, per-section coverage and deadlines, writer-boundary closed-PR/head/protection checks, explicit release-version/account intent and separate exact-ID publication. Existing dispatch/client/guard/journal infrastructure is reused as required, never counted as new. No padding or card/helper recount. Full criterion delivery is in W-5/W-6 and the permanent PR handoff.

Acceptance first: main is newer, production independently remains READY `ecf190d7f38b7b62f88b1ae6df830f9dcaaf7904`. Genuine custom whoami succeeds after owner reconnect (PREVIEW/full, scratch org only, App credential, no U credential, production OFF, $0). Per-check actual read/denial observations from #214 comment 6199734878 remain valid on unchanged live/config; refreshed ledger removes the obsolete blanket auth blocker. Old run ownership refuses this new connection, private governance remains provider-plan 403, empty webhook/alert/access fixtures and independently scoped write/disposal approvals remain separate. Preserve original quarantine and optional RTC/Hub/Sandbox distinctions. No release requested while independent engineering remains.

Verification: first assembled tree passed 169 files / 5,466 tests; enum/account refinement tree passed 169 / 5,468. Final focused maintenance, branch, release and registry suite passed 249 checks, including 37 new workflow tests. Final complete unit/check/shapes and exact-head CI are required; local PostgreSQL binaries are absent, so required disposable DB proof must come from CI. No provider credential in tests. New source/acceptance is not live; five source-pinned queue rows are added, all PENDING. Queue now 35 total: 2 historical passes, 33 outstanding.

Self-review: registry-only orchestration, exact delegated arguments and result bounds remain enforced; missing or capped evidence is partial; no implicit repair. Branch cleanup excludes default/protected/rules/production/owned refs, verifies closed unchanged same-repo PR evidence inside the original writer and freshly checks absence after replay. Provider DELETE has no atomic expected-SHA parameter; remaining race is explicit. Release draft and publish stay separate, version is frozen before confirmation, generated notes use previous_tag_name only on generate-notes and retry keys bind the actual account. All underlying production, resource, access/message, spending and replay gates remain. No source changes to credential issuance or permission widening.

Next approved engineering remains W-7, then U/R/X and the separately gated V and provider completion work in existing order. This outcome adds no feature outside approved scope.

### Release-needed owner escalation — October 15

Owner permits manual-release requests only after every independently eligible
authorized task is finished and release would enable a concrete next completion task.
Record source gaps while continuing implementation, deployed acceptance, reviews,
merges, cleanup and records; prepare the exact checked target before asking.
The read-only planner distinguishes source absent from live, source already in live
but not serving, and unknown provenance/history. No manual release is preauthorized;
continue independent work and reassess acceptance after actual READY deployment.

## Owner-requested product completion workflow correction — October 15

The Google agent's repeated 0/1 exits exposed a shared code-only bundle assumption.
This repository now retains normal ENGINEERING workload guides and adds explicit
COMPLETION accounting for substantial NEW original acceptance/configuration proof,
possibly with zero production lines. The existing card freezes complete criteria
and exact queue IDs; committed ledger deltas must preserve source, scope and gates.
Old code, old passes, audits, isolated probes and pending/partial outcomes count zero.
No new phase/features or scope approval may be invented to meet a workload number.

N supplements the WHOLE workflow: perform every currently ready authorized obligation
in existing priority/dependency order even after N is reached. A planned substantial
acceptance outcome can count once, never excuse other ready acceptance or closeout.
Reconcile original requirements once; do not repeatedly audit already-proven code.
A future real-operation date or external sign-off does not prevent eligible source
work/synthetic proof. Only actual optional dependencies may be bypassed as optional.

This is scoped workflow maintenance, not a product audit or declaration that this
project is near completion. Existing roadmap, unfinished work, provider acceptance,
owner inputs, fixture ownership, release policy and authorization limits remain.
No queue row is marked PASSED, no provider call/release/activation/spending performed,
and zero product bundles claimed. Full exact-head/local checks, review/merge and
final-main verification remain required. See docs/pr-cards/SESSION-WORKFLOW.md.

### October 15, 2026 — W-3/W-4 review and CI recovery bundle

## Owner-requested execution efficiency / parallel CI maintenance — October 15

Preserve substantial outcome scope and complete acceptance. Consolidated local
capability/publication diagnosis and early real-boundary fixture preparation reduce
avoidable retries. Independent verification families run in parallel with original
required aggregate names; new topology/timeout regressions and measured 180-second
root phase budgets preserve fast feedback as coverage grows. No tests/assertions,
provider gates, immutable pins, releases or production behavior are waived.
Existing session/CI checks and final-main verification remain mandatory. This is
maintenance, zero product bundles or genuine deployed/provider acceptance. See
SESSION-START and the existing SESSION-WORKFLOW card for evidence and procedure.


**PR #214 closeout reconciliation:** #213 merged as d713486 while #214's first
exact head 6477abc passed all seven application/release gates (CI run 38776205986;
release-policy run 38776206005). Git's merge preserved both status records cleanly;
product src/tests remain byte-identical to the frozen 5,431-pass tree. Reconciled
#213's already-started-work exception honestly: cards preserve actual original
scope and criterion-level delivery, no synthetic pre-code commit or small-remainder
count. Remaining NEW engineering is empty; combined-head CI/review/merge remain
required before one W-3/W-4 bundle counts. No remote failure/cancellation; one
additional CI cycle is solely the required concurrent-main reconciliation.
Owner was given the exact custom adapter reconnect action in the active chat:
https://robinson-github-cloud.chris-tcr-2012.chatgpt.site/ . Responsible party: owner
for adapter consent; implementing runner rechecks whoami afterward. No underlying
App reset or shared rotating-checkpoint takeover. All scenario-specific approvals
and fixtures remain independent; no eligible read is deferred merely for main/live lag.

**Selected whole subsections:** W-3 and W-4, one coherent recovery stage of the
approved PR conveyor. Current source commit `dd0c9abf5cf443c2749f37fe0b418ef35db21691`; delivery only counts after
required exact-head checks, review and expected-head merge. W-3 verifies original
commented-line changes, binds a combined preview to current head/discussion, and
resumes guarded reply/resolve through durable per-intent child journals. W-4 reports
failed jobs/steps/errors/annotations and same-workflow default-branch comparisons;
one guarded automatic retry per workflow/head persists across run IDs and time windows.
Compact discovery/call reaches composed workflows while recursive meta calls stay refused.
No new DB schema, credential, permission, spending, account activation or manual release.

**Reconciliation:** baseline main `258d9773f832ef84bf2c41b56dc8eea22d995fca`;
#210 W-1/W-2 merged as `2507da78a072805dbef9281f513f290f4ba9c9f1`;
#211/#212 workflow maintenance preserved; no open PR at startup. Main/live differ:
Vercel production alias independently READY at `ecf190d7f38b7b62f88b1ae6df830f9dcaaf7904`,
deployment `dpl_BETtUL2QmmUXJwhNPRCiM9SjTDA7`. Scheduled daily-policy run
38762810771 (2026-10-15 15:43 UTC) completed successfully; this is not proof of
new deployed source. No batch-boundary promotion permitted or performed.

**Acceptance accounting:** all original 23 rows were evaluated, including hidden
rows: 2 prior genuine passes reused, 16 deployed candidates/external-gate rechecks,
4 W-1/W-2 checks await source release and one public cleanup awaits its acceptance
dependency plus independent exact deletion approval. Main being ahead never deferred
the 16 included checks. Actual custom whoami failed `renewal_outcome_unknown_reconnect_required`;
connection status `refresh_uncertain`, upstream reachable and issuer matching. The
saved native checkpoint belongs to its single coordinating runner; this runner has
no local grant. Do not race that runner's rotating tokens or infer revoked consent.
Next: reconcile uncertain refresh with the owning runner, then execute each scenario
under its existing permissions. Private governance remains plan-blocked by prior 403;
production-classified writes/notifications/access changes and exact quarantined
cleanup keep separate owner gates. Added 3 W-3/W-4 checks pinned to reviewed source.
The complete sanitized temporary acceptance accounting passed before implementation;
revalidate it against final queue/deployment before closeout. No provider pass invented.

**Verification:** focused workflow/reader/writer fixtures passed, including nine-check
E-3/G-1 contracts through existing doors, pinned-head races and durable replay beyond
ten minutes. Full checks/unit/shapes and exact-head Actions are required. Local DB
execution unavailable (`initdb` missing): require actual disposable-Postgres CI db
proof. Initial broad local run exposed registry/compact-list expectations; retained
compact listing and updated exact registry coverage, without loosening assertions.
Production source measurement: 459 additions / 28 deletions after final review;
exclude tests/docs/check scripts/generated files. Final PR/handoff carries final counts
and CI evidence. Rolling latest five source deliveries (this bundle, #210, #209, #207, #206): 367.8 added / 10.2 deleted production-source lines per PR; 7 complete subsections / 5 PRs = 1.4, below the planning average due to prior single-subsection deliveries. No padding or retrospective recount. Next approved engineering after merged bundle: W-5.

**Final backlog reconciliation:** four older obligations from the RTC adoption audit
and developer evidence are now explicit queue rows: native disposable-grant revocation,
direct restricted RTC CLI, encrypted relay and genuine Sandbox routes. Required source
`5a0ca5d2992bc576c5fdcc88525fb1eb95943fc9` is already in live ancestry: these are
NOT deferred because main is newer. A scoped service RTC pass is absent. Actual custom
Hub whoami succeeded in TEST/full/gateway with allowWrites=false; Hub health returned
foundation ready, federation not_configured, providerCallsEnabled=false, contractVersion=0,
accessibleUpstreams=0; hub_namespaces denied `RTC tool not granted to caller`.
Thus Hub foundation availability is verified, not any upstream route. Full RTC1 remains
unfinished R engineering. No account widening, shared grant revocation or paid runner.
Final queue: 30 total, 2 historical passes retained, 28 outstanding, each with exact
prerequisite and next action. The frozen source tree passed **168 files / 5,431 tests**;
shapes 15 passed; npm check passed. Earlier local run mixed an older loaded module with
a newly written deadline regression; freeze-first rerun passed without weakening it.
Git push had no terminal credential; connected Git Data API published verified blobs,
and fetched src/tests/scripts exactly match the tested tree. Source pin reconciled to
remote implementation `dd0c9abf5cf443c2749f37fe0b418ef35db21691`. Required remote
CI/db/review/merge evidence remains a pre-count gate.

### October 15, 2026 — W-1/W-2 coherent PR conveyor bundle, checked release-acceptance eligibility

## Owner-requested bundle scope accounting correction — October 15

Operational maintenance, zero product bundles/subsections: preserve an inspected
pre-code plan in the existing execution card, compare all original criteria with
actual new engineering, retain undersized completions as contributions, and require
explicit review of substantial-work exceptions. `session:bundle` checks frozen Git
plans and delivery accounting; `check:session` includes behavioral regressions.
Existing CI/review/merge gates remain required. No provider/deployed acceptance,
release, activation or spending is claimed. Existing work and acceptance queues
remain authoritative; their obligations are unchanged. See SESSION-START and
SESSION-WORKFLOW maintenance card for procedure, proof and publication boundary.


## Acceptance-first session tooling — October 15, 2026

Follow-up: deployment provenance is shared by planning and accounting and is
verified even for an empty queue. Unknown/missing/divergent refs fail closed;
the empty-queue native regression preserves partial-release support.

Owner-authorized cross-repository workflow repair: session status now presents
per-deployment acceptance actions before roadmap work, separately lists waiting
checks, and validates complete/stale-free temporary acceptance accounting.
SESSION-START is authoritative for sequencing and final closeout; push checkpoints
continue into required obligations. This maintenance completes no product bundle,
closes no provider/deployed acceptance, changes no release/approval gate, and
preserves concurrent roadmap work and existing evidence. Focused native script
regressions and required exact-head CI/review must pass before merge.


**Scope from the approved index:** W-1 (PR status and guarded idempotent open) + W-2 (exact-head green merge and bottom-up stack retarget/merge). The two related whole batch subsections form **one** usable implementation bundle, not four separate feature counts. Files: `src/tools/workflows-pr.js`, `src/tools/workflows-merge.js`, `src/github/ci-state.js`, `scripts/check-writes.mjs`, focused unit tests and W-1/W-2 JIT cards. Only existing E/G wrapped tools execute provider writes, with existing authorization, protected-resource, confirmation, readback, replay and production gates. Stack resumes one operation at a time and refuses old CI after a base change. PR [#210](https://github.com/Robinson-AI-Systems/github-mcp/pull/210) contains the one-bundle delivery. The work index inside this PR is written **as-if-merged** for the normal reviewed merge; actual counted completion requires exact-head green CI and successful PR merge, not this prose.

**Reconciled predecessor:** PR #209 already merged P-3 at main `2b2778ad5f9219ad2825e3e224effb4f17920fe0`; the previous index still reported P-3 IN_PROGRESS, now corrected to MERGED. Next engineering is W-3 only after this combined W-1/W-2 source and merge is verified. No manual Vercel release is authorized as part of this implementation session; checked daily policy still governs releases.

**Release and acceptance (do not skip while main is ahead):** Independently observed `live=ecf190d7f38b7b62f88b1ae6df830f9dcaaf7904`, Vercel production READY `dpl_BETtUL2QmmUXJwhNPRCiM9SjTDA7`. All 17 non-PASSED queue entries' required source SHAs were independently compared against this exact deployed SHA; every compare result was ahead with behind=0. Thus the release/code prerequisite is met for all 17, independent of newer main. Two preexisting queue entries retain genuine PASSED source/provider observations. The custom GitHub MCP connection currently returned `refresh_uncertain`, then `renewal_outcome_unknown_reconnect_required` on actual `github_whoami` and read-only tool search. This is an actual unresolved connection/serialized refresh evidence limitation, **not a reason to defer on revision mismatch**. Preserve source-specific re-entry, original per-operation owner grants, no automatic replay and no false acceptance pass. Investigate protected saved developer checkpoint with the authorized single HTTPS-capable runner; never print secrets. Two private H-1 tests remain legitimately plan-blocked (HTTP 403), even though source is live; scratch fixture cleanup still requires exact independent owner approval, and production-classified writes still require separate authorization. The permanent ledger below retains the original 19 items and appends four new W-1/W-2 future-release acceptance checks;  all eligible checks must be retried from the live revision once the service-issued principal is restored. No external approval, spending, production activation or destructive cleanup took place.

### October 15, 2026 — P-2 merged; P-3 setup/draft in progress

P-2 PR #207 merged at `ed095fbd3308f70c933d6d082d35e9c093bf9cdc` with final exact-head ci/release-policy, two unit shards, db, shape, lint/security gates green and all four review threads resolved. This is one full P-2 subsection, not an extra invented feature count. Next P-3 adds idempotent staged new-project setup and draft profile/document output. Parallel PR #208 carries separate approved owner bundle-workload guidance; preserve its changes. Do not conflate merged code with deployment/provider or owner acceptance.

### October 15, 2026 — owner-requested bundle/card/PR guidance alignment

Reviewed main ecf190d (#206); concurrent P-2 PR #207 remains separate and its
branch is untouched. The owner requested removing contradictory small-PR rules.
AGENTS, SESSION-START, PLAYBOOK, card template, throughput guide and G-4 example
now agree: cards define approved scope; related whole subsections form a bundle;
PR splits require concrete migration/dependency/safety/reviewability evidence.
Removed stale 500/800-line ceilings, blanket one-migration/one-risk-area rules
and the one-card-as-one-PR framing. Keep the existing 2–5 subsection / 400–800
production-line averages, no padding, and every independent safety/approval/test
boundary. Related additive migrations require ordering and upgrade/restore proof.
This explicitly requested documentation alignment completes no product subsection
or bundle and changes no application, CI, release, provider or activation behavior.
Required exact-head checks and applicable review disposition govern merge. Resume
actual main and the active implementing agent's current outcome, not this
maintenance checkpoint or a new five-PR quota. No provider acceptance claimed.

Reconciled the concurrent implementation merge without changing its source,
roadmap state, evidence or active agent branch.

### October 15, 2026 — P-2 no-shell CI polling stall corrected in active PR #207

Diagnosis: head `e40846b059b369b0809af183d2da8487b6093cc2` already had all required checks green, but repeated no-op status reads delayed disposition of four known review threads and merging. Added binding CI decision/transition procedure to AGENTS, SESSION-START and PLAYBOOK inside substantive PR #207; next action is exact-head checks on the new documentation-inclusive head, address four verified review threads, merge with expected SHA when CI and release-policy are green. This is not provider deployment or custom MCP acceptance. P-2 must not be counted until merged.

### October 15, 2026 — P-1 merged and P-2 readiness in implementation

P-1 PR #206 merged at ecf190d7f38b7b62f88b1ae6df830f9dcaaf7904 with green full exact-head CI and independent review-thread closure, completing one P-1 subsection. P-2 is now IN_PROGRESS: all G1–G20 readiness results and single-action guarded corrections; source is not yet deployed or provider-accepted. Personal/production privileges and spending remain unchanged.

### October 15, 2026 — O-7 merged; P-1 profiles under implementation

PR #205 merged at 810c06562013d15b811255beb026606ab82e7ea0 with exact-head CI, two unit shards, DB, shape, static/security and release-policy passes. One complete O-7 subsection. P-1 is IN_PROGRESS (not counted) until green and merged. Appliance Desk main re-audited: daily-live.yml replaces release.yml and live exists. No account mutation or deployment inferred.

### October 14, 2026 — O-6 merged; O-7 notifications and gists implementation underway

O-6 PR #204 merged at `c48934abab9477fa93929c1198d8082799dbc536` with green exact-head CI, release-policy, both unit shards, DB, shapes, security/catalog and write contracts: one completed approved subsection (nine catalog capabilities). O-7 has seven existing catalog operations and remains IN_PROGRESS until CI, full review and merge. Owner IN-11 optional classic notification token is not enrolled or bypassed; U-authorized gist operations can be implemented without that provider acceptance. No deployment or account mutation is inferred from merged source.

### October 14, 2026 — O-5 merged; O-6 personal-account implementation underway

**Source completion O-5**: PR #203 merged at `15cf2614938b62c7ae1dadbfdb0a0c0c4250f371` after full exact-head CI, both unit shards, shape, DB, catalog/write safety, and release-policy checks. It is one completed predefined subsection, with seven verified-source catalog capabilities. No provider/account mutation or released-version acceptance is inferred. **O-6** is the next existing subsection and is IN_PROGRESS only, with nine connected personal-account capabilities; no O-6 completion is claimed pending checks and merge.

### October 14, 2026 — O-4 reconciled as merged, O-5 Apps/token policy under implementation

O-4 PR #201 merged at 174484de6331d0068b7e7d80c56a1c00b9400be1 after predecessor #202's concrete-design update. Its source subsection is now MERGED in the authoritative work index. The next eligible one whole subsection is O-5: seven App installation and fine-grained token policy capabilities, including three guarded writes and four scoped reads. Its engineering and exact-head CI/review are pending; **zero O-5 subsections count complete** at this checkpoint. No provider changes or production release were made. Provider/account acceptance remains in the existing queue.

### October 14, 2026 — O-3 merged #200, O-4 billing and paid tools under implementation (#201)

**Completed source batch subsection O-3**: merged PR #200 at `f87eb4b7d35e38bbdd8e6ca588a6389a36e48703`; exact-head CI/release-policy green, nine guarded team/role capabilities. Together with O-2 #199, **2 complete source subsections** this session. Next approved O-4 is one whole subsection of 13 paid/billing/Copilot/Codespaces capabilities. Five current data reads, six guarded real writes, and two actionable manual owner workflows where cost is unbounded or the provider does not publish independent readback. This is not a completed O-4 subsection until exact-head CI/review/merge; no member, billing, spend, Codespace, release or production settings changed. Genuine O-2/O-3/O-4 provider acceptance remains queued until production READY ancestor and separate owner approvals.

## Owner-requested design detail — October 14, 2026

Completed a code-grounded remaining-design review in `docs/implementation-contracts/REMAINING-WORK.md` and linked
it from AGENTS. Concrete per-subsection state, input/output, failure/recovery,
file integration and test contracts supplement existing approved designs. No
runtime code, roadmap status/dependencies, acceptance queue, credentials,
resources, production switch or release changed. No completed product batch
subsection is claimed. Implementing sessions resume the authoritative roadmap
order, reconciling current main/concurrent cards and actual owner inputs first.
This dated design note is not a new implementation priority or replacement handoff.

### October 14, 2026 — O-2 merged #199, O-3 team and role source underway (#200)

**Completed batch subsection (source + merge gates): O-2**, merged at `2f2f99e7912c993a4396b4d32e2a191d9ca032d1` after green `ci` and `release-policy`; this is **one subsection** (not 12 separate tools). O-2's custom-provider/deployment acceptance remains separately queued. Next approved **whole subsection O-3** includes nine team/role owner tools, six write contracts plus three reads, with complete scope, provider readback and plan-limited denials. This PR is source work in progress, not a completed O-3 subsection before exact-head green and merge. No real account access changes, settings or spending occurred. Live READY ancestry remains behind these source changes; acceptance queue retains release and independent approval conditions.

### October 14, 2026 — O-2 organization and membership implementation (PR #199)

The approved O-2 **whole batch subsection** is being assembled as a single coherent source outcome, not counted by handler count. Twelve tool contracts provide bounded organization, membership and invitation reads plus confirmed/journalled owner settings, invitations, role changes, removals, outside collaborators, user blocks, custom property schemas and immutable-release rules. Tests exercise nine write tools through all existing dispatch doors, independent provider readback, negative ownership and exact request shapes. Pre-merge full checks and source review remain required, so O-2 is IN_PROGRESS, not yet a counted completed subsection. No real provider settings, access, billing, production activation or quarantined fixture changed. Live READY remains b51cda4 and does not contain these O-2 source changes. After a green exact-head merge, O-3 teams/roles is the next approved implementation subsection; external acceptance stays separately queued.

### Owner workflow clarification — October 14, 2026

PR workload is counted in whole predefined batch subsections from the approved
roadmap/design, never technical slices or packet checklist tasks. Partial
subsections count zero complete; retain all remaining engineering and separate
external acceptance. Session PR count and scope come only from the current
owner prompt, with no standing quota or PR-number alignment. Historical PR
counts below record earlier work and do not instruct future sessions.
This owner-requested maintenance changes guidance/report wording only; required
CI/review, security, provider, spending and release gates remain unchanged.
Focused reporting tests passed locally; exact-head full Actions gates are required
before merge. No product subsection, deployment or provider acceptance claimed.

### Owner-requested throughput measurement update — October 14, 2026

Focused maintenance: 400–800 changed production lines and 2–5 completely
integrated slices per substantive PR on rolling averages, with evidence-backed
exceptions and no padding. Existing session tooling now reports remaining
coarse roadmap units and IDs without conflating them with PR slices or live
acceptance. Source/CI/deployed/provider evidence remains separate.
No provider operation, release, approval or safety gate is changed.

Verification: all 61 focused session-tool tests passed locally across the five
updated repositories, including real disposable Git ancestry, unchanged queues,
partial/review/blocked/optional/planned counts, duplicate/unknown status rejection
and Google native-ledger parsing. Each actual index/ledger also loaded successfully.
Required exact-head Actions gates and reviews must pass before merge; this note
claims no deployed or genuine external-provider acceptance.

## October 14, 2026 — genuine custom public H-1 read evidence and fixture ownership

Confirmed separate public scratch fixture via actual custom GitHub MCP while current live b51cda4 was independently Vercel READY. Scoped public branch-protection and repo ruleset reads passed with no configured protection/rulesets; organization ruleset list is separately 403 due missing organization administration grant. Private H-1 calls are still **BLOCKED — PROVIDER PLAN** and cannot borrow public acceptance. New public fixture is retained for released H-1 writes and separately queued exact cleanup, never mistaken for pre-existing quarantined private run. Private cleanup exact target: `robinson-ai-scratch/rtc-ghaccept-oct13-f1a` under run `ghaccept-oct13-f1a`, not approved for deletion. No upgraded GitHub subscription, permission widening, production activation or spending.

## October 14, 2026 — H-2 delivery lifecycle controls (PR #190, exact-head CI and merge required)

New genuine webhook-delete, redelivery and ping operations complete the existing webhook delivery/cleanup control family at source: exact hook identification, public HTTPS target validation, service-owned confirmed write journal, independent 404 or unique new-delivery/GUID readback, unconfirmed asynchronous outcomes, confirmation and production classifications. Tests exercise three doors, provider request-shape validation, missing delivery identity, unsafe URL refusal, capped inventory and replay. No live webhook creation, deletion, delivery retry, production account activation or spending performed. No secret values in tools.

The H-2 parent outcome is **still IN_PROGRESS** until webhook save and signing-secret rotation are fully usable with server-generated 32-byte secrets and one-time private owner display. Follow the same owner gates; do not reduce catalog to fit test permissions. The October 14 release includes #187 but not these H-2 commits; all custom H-2 provider acceptance remains queued. H-1 public/blocked private governance acceptance is unchanged.

## October 14, 2026 — H-2 webhook observability source (PR #189, pending exact-head CI)

Added three real webhook read operations for repository and organization scopes: bounded list, exact detail and delivery history/inspection. Requests remain scoped to the enrolled connection, exact numeric hook/delivery identities are checked and secret-bearing hook configurations, callback path/query, request/response bodies and headers are not surfaced. Tests cover fake GitHub REST shapes, result redaction and refusals. Subsequent H-2 webhook mutations, service-generated signing keys, one-time private display, delivery replay and protected deletion still need separate complete implementation/acceptance. CI and merge cannot be treated as provider pass. Public scratch H-1 reads observed an empty true ruleset inventory and absent classic protection; private-repo HTTP 403 is still **BLOCKED — PROVIDER PLAN**. Owner-approved public fixture `robinson-ai-scratch/rtc-ghaccept-h1-public-oct14` is a separately disposable, non-sensitive test repository; preserve it for H-1 checks following checked release, and do not delete original private quarantine.

## October 14, 2026 — H-1 classic protection implementation and public/private evidence boundary (PR #188, source gates pending)

The active H-1 outcome now includes real guarded `github_protection_set` and `github_protection_remove` handlers and three-door behavioral contracts. Full read-merge-write preserves app-bound checks, review/dismissal/bypass membership, push restrictions and observable policy flags, refuses incomplete provider inventories, requires explicit baseline to create and independently reads back after a single confirmed write. The source PR still requires exact-head CI, review, merge and then checked live deployment for external provider acceptance; no production write has been made. This session's verified Vercel READY deployment dpl_BBJGByfds3nkkgStzP2oQKdUrDrk and alias github-mcp-xi.vercel.app point to existing main/live b51cda454f01720b3c638f83b9766b30eceaa9fb. Genuine custom connection PREVIEW/full read the original private scratch repository.

User direction: do not upgrade a GitHub plan or change the existing private fixture's visibility. Two existing private-repository H-1 custom reads returned GitHub HTTP 403 requiring public repo or upgraded plan, recorded as **BLOCKED — PROVIDER PLAN**, neither passed nor source-code failed. Public scratch tests need a separately created EMPTY disposable public run-owned repo, no secrets, separate published-version proof and guarded cleanup. Its success must not stand in for unavailable private-protection acceptance. Existing quarantined run ghaccept-oct13-f1a remains intact; deletion requires exact target identification and independent owner confirmation. Continue separately eligible substantial implementation without treating subscription limitations as project-wide blockers.

### Workflow maintenance handoff — owner publication approved

New offline session utility: eight behavioral tests passed, including actual Git ancestry, partial releases, unknown/failed deployments, rollback, dependency gating, invalid queues, PR alignment and bounded output. All repository queues validate. Existing source/status evidence is preserved; no provider acceptance or release was performed. Owner explicitly approved publication on October 14; publish the reviewed maintenance branch, require exact-head CI/reviews, and merge only when those gates pass. No extra production release is authorized by this approval. Full broad application suites on the shared runner were interrupted after resource/time-limit failures; do not claim them passed. Existing exact-head remote CI/review gates must pass before any main merge.

## October 14, 2026 — F-3 Projects v2 organization read workflow (PR #182)

Implemented three native, scoped GitHub REST tools: Projects v2 list, exact project detail with fields, and item listing with bounded field values. GitHub App installation reads are limited to enrolled organization owners; user-owned REST Projects v2 explicitly reject App installation/user credentials, so these tools fail closed with the GitHub-authorized classic/GraphQL path guidance rather than silently switching accounts. Project identity is verified before item enumeration and inventory caps are disclosed. Focused fake-provider request-shape/denial tests and full required exact-head CI are merge gates, not provider acceptance. F-3 still needs separately guarded project add/field edits/removals, and all deployed/provider acceptance remains queued.

## October 14, 2026 — F-3 Project membership and field write workflow (PR #183)

Adds confirmed and journalled project item membership, field updates and removal to complete the five Projects v2 catalog operations at source. Exact org/project/source/item ownership checks, finite enumerations, three-door write-contract tests, no production or cost changes. Source CI/merge are separate from queued genuine custom MCP provider write/readback/cleanup. F-3 source workflow complete when #183 merges; Projects saved views are deliberately deferred (no supported REST views list route).

## October 14, 2026 — H-1 exact protection and ruleset reads (PR #184)

Four genuine governance read tools added: classic branch protection (separating effective rulesets), scoped repo/org rule list/get/history and rule-suite evaluation diagnostics. All operations are bounded and describe enforcement without permission shortcuts. Projects field update readback explicitly requests updated field IDs, since default GitHub item GET does not include them. No deployed external proof claimed; next H-1 changes preserve owner approval, no production access, and the checked release cadence.

## October 14, 2026 — H-1 ruleset governance changes (PR #185)

Implements safeguarded complete ruleset create/update/delete and narrow required-check modifications. Whole ruleset writes preserve preexisting conditions, active rules, enforcement, source and bypass actors; inability to read bypass membership refuses updates. All changes are production classified, preview/confirmation/journal/replay gated. No owner production account activation, provider mutation or independent deployment acceptance claimed. Remaining H-1 classic protection whole-object set/remove is still outstanding. Session boundary #185, next #190.


<!-- Current repair also records no-change daily receipts: backups cannot publish later same-day development after a successful no-op. -->
## October 14 owner-requested daily release recovery repair — current

Owner request on October 14: investigate and repair missed daily releases across the MCP repositories and Appliance Desk, including the quoted owner-run checked recovery. This supersedes the prior scheduled-only/no-new-trigger restriction for missed-event recovery only. Primary 00:01 Denver remains; retries are 00:17, 01:17 and 05:37 Denver plus 12:43 UTC. Explicit recovery defaults OFF and requires both the original actor and the triggering actor to be christcr2012, main, true recovery input and elapsed midnight. Every path retains successful exact-main CI, ancestry, atomic once-per-Denver-day receipt and independent readback. No production-provider activation, spending, force push or preview build is authorized.

Local release safety tests pass. Merge requires exact-head application CI and review resolution. Source repair is separate from observed schedule execution and Vercel READY/alias proof; inspect actual daily run and receipt, do not equate main/live drift after a release with failure. These infrastructure PRs do not replace the existing substantive implementation batch.

## October 14, 2026 — missed scheduled release: no event, recovery schedule proposed in PR #179

Independent GitHub Actions run inventory for `Robinson-AI-Systems/github-mcp` returned **zero `event=schedule` runs** after the 00:01 America/Denver October 14 deadline. The existing `.github/workflows/daily-live.yml` was on the actual default `main`, its IANA `timezone` syntax is supported, and push/PR policy checks ran; therefore no scheduled promotion job existed to run `.github/release/promote-live.mjs`. `live` remains `5414978c433f9cf3ce26e8733f3dfc4cfb16e381`, with Vercel production READY at that same older SHA (observed deployment `dpl_39JZfpwEJDhcpSsDEJzuFNzJzcxZ`). Exact scheduler-side root cause is not observable via a nonexistent run; GitHub documents that schedules can be dropped under load or deactivated and that a cron-edit commit can reactivate an inactive schedule.

PR #179 preserves preferred 00:01 Denver and adds independently schedulable **00:19, 01:19 and 05:37 Denver** fallback windows with timezone-aware DST. Each is still `schedule` only, runs the unchanged exact-main checked promoter, and respects its **atomic one-per-Denver-day marker**, strict checks, fast-forward and remote readback. Push/PR events still cannot promote. Test the full matrix and actual post-merge schedule event; CI proving cron syntax is not evidence GitHub scheduled it. No manual `live` update, bypass, one-time promotion or production activation is authorized by this fix. If the following window fails to create any `schedule` run, inspect GitHub Actions workflow enabled state and scheduled actor, and escalate with the exact zero-run evidence; do not weaken the release policy.

## October 14, 2026 — F-3 native GitHub Discussions (PR #178)

Adds real GraphQL discussions list/get and guarded create/comment/chosen-answer tools. Creation resolves the exact category and repository node IDs from GitHub with complete category enumeration. A chosen answer verifies the selected comment belongs to the requested discussion before mutation, and each mutation independently reads back the actual discussion/comment GraphQL identity. Outsider notification guard applies to discussion text and authors; preview and durable journal remain standard. Three-door write-contract/GraphQL schema tests cover source, reply, answer and negative foreign identities. Search is already merged in #177; Projects v2 remains incomplete until later PRs. No native hosted OAuth acceptance or production changes are implied by CI.

## October 14, 2026 — F-3 cross-type GitHub search (PR #177)

Add `github_search_github` with actual GitHub pinned-version code, issue, PR, commit, repository and user search endpoints. Enforce issue/PR query distinction and provider-response filtering, page and 1000-result API bounds, disclose incomplete results and trim returned search fragments/messages. Six real request-shape tests exercise the right route, arguments, and capped projection. F-3 discussions/Projects v2 remain incomplete; no claim of source completion or native deployed connected acceptance. Production/off/spending/$0 policies unchanged.

## October 14, 2026 — F-2 cross-account labels synchronization completed in source (PR #176)

Adds `github_label_sync`: chooses a connected source repository, independently reads each connected destination, denies duplicates/foreign accounts/protected destinations, previews the complete per-repo create/update/delete plan (deletes opt-in only), requires confirmation and uses each destination's ordinary guarded, separately journalled label save/delete tool. Re-checks source and each destination inventory before mutation, reports per-resource partial outcomes, and independently compares all target inventories against source before confirming. Bounded 100 labels/repo, five destination repositories and 20 per-label changes per call; no silent truncation or unlimited work. Cross-account tests prove the actual destination credential selection and refusal cases. All 7 F-2 cataloged operations are now source-built when PR #176 passes/merges; independent hosted exact-revision, provider acceptance, Hub, revocation and cleanup remain unverified until exercised. Scheduled daily release only; production OFF, autonomous spend $0.

## October 14, 2026 — F-2 repository labels and milestones CRUD (PR #175)

Implement native GitHub REST label/milestone listing, guarded create/edit/rename and confirmed deletion. Color validation, repository-bound reads, rename collision refusal and exact readback are required; milestone closing and due dates are explicit, and no label or milestone deletion runs without confirmation. The sync operation is separately incomplete; do not mark F-2 complete until cross-account dry-run/execute and partial-result acceptance pass. GitHub request-shape checks and three-door write contracts provide automated evidence, not native deployed acceptance. No production promotion/activation or spending change.

## October 13, 2026 — live scratch acceptance revealed delayed GitHub default-label creation

Through the independently connected production custom MCP (deployed revision `5414978`, PREVIEW/full and production OFF), run `ghaccept-oct13-f1a` successfully created private run-marked `robinson-ai-scratch/rtc-ghaccept-oct13-f1a` with an exact durable repo record and provider readback. The cleanup remote preflight correctly refused deletion: the initial GitHub label observation was empty and ten GitHub organization defaults appeared later. No deletion occurred; the exact run/repo remain quarantined. Real cleanup acceptance remains NOT PROVEN. This PR prevents premature future birth snapshots with bounded, multi-read stable GitHub label observation (a permanently empty customized organization requires the entire stable observation window) after creation; it neither silently rewrites the historical run nor widens destructive permissions. Owner must separately resolve or authorize removal of the exact quarantined repo after safety review; preserve the prior absolute foreign-label deletion refusal. Source/CI validation and live acceptance stay separate.

## October 13, 2026 — F-1 full issues source workflow (transfer implementation awaiting acceptance)

The final F-1 operation `github_issue_transfer` now uses independently read GitHub GraphQL source issue and destination repository node IDs, checks both connected account scope and destination protection (source uses normal write gates), requires explicit confirmation, performs one journaled GitHub mutation and confirms the moved issue independently by exact destination REST readback. It disallows pull-request transfer, same-repo transfer and unsafe label creation defaults; foreign, pr-only and locked destinations refuse. Full write-contract across the three service doors and semantic/denial tests accompany the implementation. All 15 cataloged F-1 issue tools are now implemented at source when this PR merges. CI, scheduled checked production deployment, native connected provider-write/readback, Hub, revocation and run-owned cleanup remain separately unverified; F-1 real-world milestone acceptance stays IN_PROGRESS until genuinely observed. Existing production OFF and $0 spending remain unchanged.

## October 13, 2026 — F-1 reactions on issues and comments (implementation PR pending)

Added guarded `github_issue_react` for issues, issue comments and pull-request review comments: verified same-repository source ownership, reaction inventory, exact reaction ID/content before removal, one journaled mutation, readback by provider reaction ID or proven absence, and outsider-author notification confirmation. Three-door write-contract and negative ownership tests accompany it. F-1 remains IN_PROGRESS until transfer is delivered; source/CI and native custom provider acceptance are separate. Production remains OFF and spending $0.

## October 13, 2026 — F-1 linked issue relationships (PR #170, source pending checks)

After current main including merged #167 issue triage, #169 birth-label scratch-cleanup correction and #168 issue moderation, PR #170 adds native sub-issue creation/removal/reorder and blocked-by dependency add/remove. Both tools resolve exact parent and child issue identities through GitHub before acting, refuse self-links and unverified cross-repository IDs, reject truncated relation inventories, no-op when already linked/unlinked, send at most one mutation per guarded journal intent and require exact relationship readback. Reuses all service-owned auth, preview, protection, spend and confirmation gates; no production switch or scratch resource write. New exact GitHub shape and three-door write-contract tests accompany the source. F-1 stays IN_PROGRESS: transfer and reactions remain unfinished, and live custom provider acceptance is separate. The #169 default-label fix is preserved unmodified; genuine scratch create/readback/cleanup awaits exact checked main-to-live promotion.

## October 13, 2026 — F-1 issue moderation PR #168 (source in progress)

Building directly atop safely merged PR #167, this approved second F-1 implementation delivers issue/PR conversation locks, editing a comment with same-repository provenance verification, label add/remove/replace including explicit empty clearing, and assignee add/remove with full notification consent guard. Exact provider readback and shared three-door write-contract tests are included. F-1 continues IN_PROGRESS with four advanced relation/transfer/reaction tools not yet delivered. No live provider-write acceptance is inferred from tests; no scratch repo is created or cleaned. Current main already includes pager, nullable issue validator and PR #167 review repairs. Preserve standard production-OFF, $0-spend and V-2 cleanup gates.

Reconciled after independently merged scratch cleanup PR #169. The cleanup birth-label safety fix is retained without change.

## Scratch cleanup default-label blocker correction — October 14, 2026

Owner explicitly requested resolving the recurring initial-label cleanup refusal.
Confirmed whole-repository disposal now accepts the immutable first-create label
observation only when bound to the exact complete scoped create intent/repository
journal and independently unchanged by ID, name, color and description. No label
creator provenance is inferred. Initial labels are covered by explicit disposal of
their disposable parent, not standalone label deletion authority. Separately
journaled run labels retain their existing marker/readback checks. Missing baseline
runs retain the strict recorded-label-only path; no retroactive adoption.
Both post-freeze and immediately-pre-DELETE inventories recheck the baseline.
Added/changed/replaced/missing/duplicate labels, overlapping baseline/run labels,
foreign data, incomplete inventories, and protected/non-scratch targets still refuse.
Preview names the initial-label count and unverified creator provenance.
Targeted three-door write contracts and regression tests cover unchanged defaults,
drift/races and defaults plus fixture labels. Custom connection read verified PREVIEW,
scratch organization, production OFF, $0 spend and zero existing runs.
Source/CI, scheduled deployment, actual custom seed/readback/confirmed cleanup remain
separate; this change does not claim live cleanup before checked release.

## October 13, 2026 — F-1 review findings remediated before merge

Six independently filed PR #167 code-review findings were addressed in the same guarded issue workflow: GitHub issue types on create/update/list, verification of requested milestone rather than accepting a silent provider drop, nullable milestone validation for explicit clearing, normalized empty/null issue-body readback, supported duplicate closure reason and optional canonical duplicate issue ID, and preservation of contributor trust metadata on nested related issues. New targeted tests cover denied or unconfirmed readback, nullable/invalid schema types, and nested untrusted input. The exact PR head and checks must be revalidated after these review changes; no reviewer thread is considered resolved by merely editing the source.

## October 13, 2026 — MCP catalog cursor pagination enables F-1 without losing tools

Adding seven genuinely implemented issues handlers exposed an architectural limit: the otherwise complete everyday `tools/list` catalog exceeded the original 22,000-token message cap. This is an implementation capacity blocker, not permission to remove user functionality, drop tools from profiles or raise the cap. The native MCP endpoint now returns standard `nextCursor` pages of at most 40 complete schemas. Every accessible tool remains discoverable in order and callable independently, including through `github_search_tools`/`github_describe_tool`/`github_call`. Cursors bind the profile, listing type and registry fingerprint and reject stale/foreign/malformed offsets. The unchanged budget is now enforced on **every page** rather than on an unpaginated response. Offline full-coverage and actual HTTP tools/list continuation tests are in this same substantive F-1 PR. Deployment and real client continuation acceptance remain separate.

## October 13, 2026 — F-1 core issue triage implementation (PR #167, awaiting exact-head checks)

The actual custom Robinson GitHub Cloud connection was callable again: `github_whoami` reported PREVIEW/full and the approved `robinson-ai-scratch` account with GitHub App/all-repository selection, production OFF and $0 spending. Native `github_repo_list` returned zero actual scratch repositories; `github_dev_list_runs` returned zero journals. A request for the foreign `Robinson-AI-Systems` identity was denied as `client:outside_scope` before reaching GitHub. These are real, narrow custom transport/provider-read and identity-denial observations, not a permitted write or cleanup proof. Live `main` and `live` were independently read at `5a0ca5d2992bc576c5fdcc88525fb1eb95943fc9`; last Vercel deployment independently evidenced READY at that revision (`dpl_E2jb8VqWJyyxYnnfBGPsyTtsYdfL`). `docs/developer-evidence.json` now records actual deployed and authenticated native transport provenance while full provider, resource-denial, Hub, revocation and cleanup remain unverified.

V-1/V-2 genuine scratch seed/cleanup cannot yet safely complete: GitHub's unowned default labels have no independently provable creation attribution; existing fail-closed complete-inventory cleanup must NOT be weakened. No disposable repository was created, and no deletion was attempted. V-3/V-4/V-5 acceptance sequencing and authorization gates remain unchanged.

The approved Batch F design explicitly depends on Batch C, already merged; the `F-1 → V-5` index edge was historical scheduling rather than an actual API dependency, corrected in its dated F-1 card. This independently eligible F-1 slice adds seven usable native issue tools: list, get (optional relations), comments and timeline, create, update and comment. It includes bounded PR-filter refill, omitted-versus-cleared body, outsider notification classification, durable guarded writes and exact provider-readback logic with three-door contracts. Eight other F-1 operations remain unimplemented, so F-1 stays IN_PROGRESS. No production operation or provider fixture write is claimed. Next: exact-head CI, fix any errors, self-review/merge, then finish remaining issue-management operations or another approved complete workflow while genuine V-2 cleanup proof remains narrow.

## Native exact-run remote cleanup inventory — October 13, 2026

Approved V-2 cleanup remains blocked from real scratch acceptance until a native custom OAuth-connected identity and exact provider-side run evidence are independently demonstrated; default-label creation-time observation is not deletion provenance. The new operator-only `scripts/native-mcp-run-inventory.mjs` combines an actual native `/api/mcp` identity/provider read and foreign-account refusal with **read-only** scoped `github_dev_list_runs` journal and remote cleanup preflight. It refuses incomplete, truncated or foreign scope and reports a bounded blocker code such as `LABEL_PROVENANCE_UNVERIFIED` without raw token/provider content. No seed, run change, confirmation, remote deletion, production action, or Hub call occurs; even a passing remote snapshot remains non-atomic and cannot authorize deletion. Offline tests/CI establish only implementation readiness; a real run and live OAuth bearer are still absent from the coding-agent environment. To use, after independently verifying the exact Vercel deployed SHA and authorized existing run, supply the native OAuth bearer through protected environment storage and execute `npm run mcp:run-inventory`. Do not count this as actual provider or cleanup acceptance until genuine results are recorded.

## Native custom-MCP OAuth/provider acceptance probe — October 13, 2026

The original service-owned native `/api/mcp` endpoint exists and is independent of standard GitHub connectors. The explicit operator-only `scripts/native-mcp-evidence.mjs` now prepares a guarded way to check a genuinely authenticated OAuth connection on the independently pinned Vercel deployment: native `initialize`, `tools/list`, exact scratch identity, real provider `github_repo_list` read and refusal of foreign account. A separate `revoked` invocation checks an actually revoked same bearer. It requires a securely available previously issued native OAuth bearer in `GITHUB_MCP_ACCESS_TOKEN` plus exact independent Vercel SHA in `GITHUB_MCP_DEPLOYED_SHA`; no token is passed in CLI arguments or printed. The preflight checks exact public service build before sending any bearer. Native full write/readback, separate resource and identity denial, Hub, cleanup, and genuine token-refresh evidence remain independent and unverified. Unit fake transports and source inclusion do **not** establish live acceptance. No authenticated run was performed in this session because the authorized custom OAuth bearer is not available through the coding-agent tool environment. Never substitute standard GitHub connector operations or owner setup-page configuration for this acceptance.

## Public root readiness correction — October 13, 2026

Observed against the exact live Vercel deployment (source `abdb685f`): anonymous `/` returned HTTP 200 with hard-coded `status: setup-required` despite the verified scratch App owner setup. That status cannot observe owner configuration and is therefore misleading. The approved root-route fix reports only that the HTTP process answered (`service-online`), declares custom/provider acceptance unassessed, and gives the Vercel source SHA as explicitly self-reported/unverified (null when absent or malformed). It does not query or disclose owner accounts, issue credentials, grant a pass, activate production or claim OAuth/Hub/provider acceptance. The root-route unit regression covers neutral status, source SHA validation and no private account data. Actual CI, scheduled deployment and authenticated service acceptance must be checked separately.

## Git branch hygiene completed — October 13, 2026

**OWNER-APPROVED HOUSEKEEPING COMPLETE; MCP PROVIDER ACCEPTANCE UNCHANGED.** GitHub Actions `38474294944` successfully deleted **147** branches whose exact tips were already in `main` (zero refusals). Following fail-closed, diagnosed repairs, actual archive run `38477439595` successfully preserved all **15** remaining distinct-history tips in the intentional non-production `archive/legacy-ai-2026-10-13` ref at commit `b01f6f913446829df0a122329a098b2e9e092fcd`, then deleted all **15** original `ai/*` refs (zero refusals). Independently read back the archive's **16 ordered parents** (the archival baseline main plus 15 original tips), and identical archived/base-main file tree `07333bb1292ad17bf20eca61f3f82f2e9de49e10`. Remote branch inventory after the run contained **only `main`, `live`, and the intentional archive** before the final temporary cleanup PR branch. No open or draft PRs at that checkpoint; #161 final main application CI/policy verified separately. GitHub does not contain orphaned working branches now. This does **not** mean all 15 old branch versions were merged into product code: they are intentionally archived without bringing obsolete source changes into `main`. Existing eligible roadmap and authentic custom-service acceptance stay unchanged.

The permanent `prune-merged-branches.yml` workflow (SHA-pinned privileged Actions, project-pinned API, open-PR checks, ancestry and exact source-tip deletion lease) will remove new `ai/*` branches only after their work is merged into `main`. The final housekeeping PR **retires the one-use `archive-legacy-branches.yml` privileged workflow, its runner and tests, and updates its own acceptance evidence**. The archive is historical preservation, **never** a PR source to merge into `main`, and must not be deleted. Do not claim this last removal is verified until final PR CI and hosted remote refs check. Actual `main` to `live` promotions retain the checked daily release mechanism; no manual deployment is authorized. The custom GitHub MCP genuine OAuth/provider/Hub/revocation/cleanup acceptance remains separately unverified as recorded below.

Earlier cancelled/failed branch-archive attempts, their diagnosed causes and exact remediation are preserved in [the completed branch hygiene audit](audits/BRANCH-HYGIENE-2026-10-13.md). They are historical, **not active blockers or pending cleanup**.

## Review corrections — 2026-10-13

Developer connection retries retain encrypted codes until expiry, concurrent starts use an atomic trusted-IP quota, and backend failures remain retryable. Google consent preserves the requested profile and supports actual native code length. Windows protected credentials fit bounded chunks; cloud refresh locks recover after process exit. Evidence requires every layer and genuine custom-service read/write/denial/readback observations. Production functionality remains intact. Local regression checks passed; exact-head CI, deployed connection, provider, Hub, revocation and cleanup proofs remain separate.

## Reusable developer OAuth and evidence boundary — 2026-10-13

Owner authorized replacing repeated manual pass setup with renewable implementing-agent
connections. Production product capabilities remain unchanged; full developer TEST/preview
profiles retain original server write/financial/resource guards. Native OAuth owner consent
hands authorization back to protected client storage via PKCE plus an encrypted mobile callback.
The rtool developer client reuses/refreshes that connection and invokes the actual custom MCP.
The completion recovery review records catalog/runtime differences, obsolete recipes and
a finite path to finish the intended products without introducing blanket limitations.
Source/automated/deployed/provider/Hub/revocation/cleanup evidence remain separately tracked
in developer-evidence.json. Standard connectors remain development infrastructure aids only.
New handoff/client regressions and mandatory provenance checks are part of this PR; exact-head
CI, reviewed release and real owner consent/provider acceptance remain pending. Managed cloud clients use an explicit private encrypted developer vault; desktops may use
the OS keyring. Never place credentials in a prompt, Git or plaintext credential file. This is an implementation checkpoint, not full real-world acceptance.
See pr-cards/DEVELOPER-CONNECTION.md. No production provider activation or paid resource change.

**Setup checkpoint — 2026-10-13:** Stage-aware setup verified: scratch GitHub App active, production OFF, zero MCP sessions; existing database/admin/encryption settings converted to Production Secrets without rotation. Real-work account Apps remain separate; next acceptance is genuine scratch OAuth/read/denial/revocation after exact checked deployment. All six release workflows target 00:01 America/Denver, Vercel tracks live, Basic queued builds and disabled automatic previews verified. No scheduled release event observed yet; owner authorized one manual release after green checks. Saved configuration, deployed exact revision and authentic connected acceptance remain separate.

**Owner release timing update — 2026-10-13:** Daily checked main-to-live release now targets 00:01 America/Denver using GitHub native timezone support, so both daylight and standard time remain 12:01 a.m. All exact-head CI, atomic daily-marker, fast-forward, preview/build-cost and independent live/provider approval gates remain unchanged. Owner separately approved one manual release after this setup work completes; schedule syntax/CI, actual deployment and connected acceptance remain distinct evidence. GitHub scheduling can be delayed; no guaranteed start time is claimed.

# STATUS

## October 14, 2026 — O-1 guided owner admin and verified settings overview source

Added the complete major repository/organization/personal dashboard settings
family index and four native owner workflow reads: structured paged guides,
GitHub-backed organization 2FA readback, per-account administration diagnostics
and bounded security review. Signals distinguish ok, attention, provider
unreadable and unavailable GitHub plan without optimistic conversions. Existing
`github_where_is_setting` now supports enrolled-owner repository substitutions.
Tests cover unique setting pages, operator confirmation limitation, fake provider
shape, no writes, permission limits and $0 server status. Required full
exact-head CI, review, merge and later READY deployed-version external acceptance
remain separate; no GitHub administration setting was changed.


## October 14, 2026 — H-4 security/Actions settings source

New native security-feature and Actions settings read/write tools complete
the remaining H-4 catalog rows at source. A verified repository identity
and named-field PATCH preserve security feature settings; private premium
activation refuses without a verified billable-committer count and explicit
owner budget, including the current $0 policy. Actions policy update merges
only one named section after reading the full baseline (workflow token,
allowed actions and pinning, fork approvals, selected allowlist or retention),
and independently verifies all other settings. Five-section provider
readback, refusal, replay and all three-door contracts are mandatory
CI checks. Deployment, authenticated provider write/denial and fixture
cleanup remain unverified, so H-4 stays IN_PROGRESS. No external settings
were changed, nor production enabled.



## October 14, 2026 — H-4 security triage and dependency read source staged

The first H-4 source integration now provides read/list of Dependabot, Code
Scanning and Secret Scanning alerts, repository/global advisories and
pull-request/commit-based dependency comparison. A guarded security alert status
change uses kind-specific reasons and independent sanitized readback. Literal
secret-scanning credential material and metadata must never enter any result
or durable write journal. The new tests include three-door mutation contracts,
secret non-disclosure, source-correct fake GitHub requests and plan-limited
dependency-review 403 mapping. H-4 remains IN_PROGRESS: paid security feature
controls and Actions settings are next, and no provider/live acceptance is
claimed before checked READY source deployment. Existing production OFF/$0
limits and owner approvals remain unchanged.


## October 14, 2026 — H-3 collaborator and deploy-key source under review

Implemented full H-3 source for collaborators, pending invitation management, and
public-only SSH deploy-key lifecycle. The seven native operations include bounded
privacy-preserving inventories, permission/invitation readbacks, direct membership
checks, duplicate key detection, per-operation approval/production/access guards,
and private-key header refusal without logging inputs. Five mutation contracts
are under test through the three regular tool doors. No source is a deployed
provider acceptance pass: wait for exact-head CI/review/merge, checked READY release
and separately authorized live scratch access/cleanup tests. Production and spend
remain disabled. Approved parent card H-3 remains IN_PROGRESS until proven.


## October 14, 2026 — H-2 webhook create/update and signing-key rotation implementation

Added real `github_webhook_save` and `github_webhook_rotate_secret` with
server-generated signing keys, an encrypted ten-minute one-time private setup-page
reveal, readback and event/destination verification. Changed existing webhook saves
explicitly rotate the signer; callers are warned to update their receivers. Keys and
unredacted callback paths do not enter the tool result or change journal.
Three-door safety and provider-shape tests are required before merging; genuine
connected GitHub, receiver HMAC acceptance, and fixture cleanup remain separately
queued for the next checked READY release. No live writes, credential expansion,
production activation, or spend permission is inferred.
 — current work, blockers and next action

## Current gateway recovery disposition — 2026-10-12

Owner requested cross-repository architecture/planning correction. Prioritize independently usable provider tools
and existing approved RTC/isolation acceptance; do not wait for K-3 publication or force internal code adoption.
Hub agent owns fixed broker surface, registry, routing, grant mapping, cache, forwarding audit and scale testing.
This service agent owns authenticated RTC/mode/resource isolation, original direct-MCP parity and safe deployed
read/denial/revocation evidence. A public manifest, reference conformance or private-core rehearsal is not proof
of actual hosted acceptance. Full provider roadmap and existing external gates remain; no card is closed here.
Next: reconcile current implementation/concurrency and existing RTC acceptance gaps, obtain exact deployed
revision and authorized short-lived read_only non-production pass securely, and run the supported harmless read
and denials through Hub when available. Never alias preview to TEST without real isolation or expose credentials.

Updated 2026-10-12. **The foundation is built (A-1, PR #1), its database schema exists (A-2, PR #7), the connector login is built (A-3a, PR #8; A-3b, PR #9) the GitHub client exists (A-4, PR #10) the encrypted credential store exists (A-5a, PR #11) and the private setup page exists (A-5b, PR #12) the App webhook and first two tools exist (A-5c, PR #13) the deployment guide is written (A-6, PR #15) the write safety layer exists (B-1, PR #16) the production guard with the two-step production switch exists (B-2, PR #18) the protected list with project ownership exists (B-3, PR #19) the people and spend guards exist (B-4, PR #20) plain-English errors with result shaping exist (B-5, PR #21) and profiles with downscoped tokens exist (B-6, PR #22):** Node 24
package with a committed lockfile, a fake GitHub for tests, the check scripts, throwaway-Postgres database tests, CI with
required GitHub Actions `ci` and `release-policy` merge gates, `src/db.js` creating the 13 foundation tables plus the owner settings table and storing connector logins, the OAuth endpoints and `/api/mcp` (two read-only tools, `github_whoami` and `github_list_accounts`), and `src/github/client.js` (pinned API version, request keys, write spacing, rate blocks, ETag cache) with GitHub's REST and GraphQL descriptions vendored, and `src/github/credentials.js` (encrypted Apps, installation tokens, user authorization, pasted tokens) with one-time secrets. Two read-only tools were the initial baseline. The actual server is now deployed to Vercel with an isolated Neon database and encrypted environment configuration; the custom scratch App was installed; owner-designated setup is complete, but connected acceptance remains pending. Nothing here authorizes changes to Chris's real repositories.

## Next

- **#155 C-1/RTC saved-result offset metadata preservation (MERGED; all seven exact-head checks passed; final merge pending):** An offset for continuing long text previously advanced *all* strings recursively, silently blanking short IDs, titles and nested labels beside the long field. Only over-budget strings are now advanced. Regression proves short metadata remains intact and long text continues with truthful truncation note. All final-main/review/live/connected/custom OAuth/Hub/revocation/cleanup acceptance remain independent. Card: RESULT-OFFSET-METADATA.md.

- **#154 JSON projection own-property integrity (MERGED; seven exact-head checks passed):** C-1 field selection previously assigned parsed JSON's own `__proto__` property through JavaScript's inherited prototype setter, hiding that field and changing the projected result prototype. The merge now preserves own JSON keys as data without walking inherited keys. Unit regression proves nested selected keys, unchanged object prototypes and no global pollution. This is service-owned result correctness, not a shared-core/Hub dependency or external custom-service acceptance. Card: RESULT-OWN-KEYS.md.

- **#153 RTC HTTP last-mile credential screening (MERGED; seven exact-head checks passed):** Independently check every successful direct restricted HTTPS response (including small inline values and saved-result summary metadata) for credential-shaped data before sending it; unsafe responses yield sanitized 503, never 200 or saved unredacted content. Canonical MCP and already-screened batches are unchanged; controlled negative tests cover both missing guards. External authenticated acceptance and checked live release remain separate. Card: RTC-INLINE-SECRET-SCREEN.md.

- **#152 RTC shortened read integrity (MERGED; seven exact-head checks passed):** Canonical read fallback can transparently mark that it had to omit content when 24h result storage fails. Restricted HTTPS now treats that condition as sanitized 503 rather than claiming a complete 200 response without a retrievable handle; successful canonical handles are unchanged. Real-dispatcher/fake-store regression verifies both paths. Standalone MCP fallback remains independent. No external authenticated or deployment acceptance claimed. Card: RTC-REQUIRED-RETENTION.md.

- **#151 original RTC scratch identity binding (MERGED; seven exact-head checks passed):** Refuse a midflight change of scratch account or pass client identity even when the replacement scope is independently valid, before releasing a successful result or continuing a batch. No extra rate unit on final check or denied next read; fake transport regression covers both drift cases. No production/provider mutations, live release, external custom-MCP OAuth/pass/Hub/revocation or cleanup acceptance. Card: RTC-AUTHORITY-BINDING.md.


- **#150 RTC postread authority revalidation (implementation; CI pending):** Successful restricted HTTPS responses now recheck the service-issued pass and scratch owner after each in-flight read, including the last batch child, without charging a second rate unit. Revocation, expiry, scratch removal and readback failures withhold previously computed payloads and return existing sanitized refusal/status; pre-dispatch and per-child gates remain intact. No real credential, release, prod/write/spend, Hub/core requirement or external acceptance claim. Verify seven exact-head and postmerge main jobs, independent genuine live/OAuth/pass/Hub/cleanup gates.

- **#149 bounded RTC discovery metadata (implementation; CI pending):** Catalog search and individual descriptions may include input schemas too large for the C-1 8192-byte wire budget. Preserve every complete selected entry under the existing connection-owned 24-hour store, send a bounded truthful prefix with counts/next/handle, and retain large single tool descriptions. Malformed, foreign and storage-failure paths remain guarded; zero widened tool scope or provider changes. Automated and genuine connected/deployed acceptance stay distinct.

- **#148 RTC single scoped result lookup (implementation; CI pending):** Replace #145's doubled connection-owned presence/canonical result reads with one canonical DB lookup and trusted typed not-found signal. Preserve 404 absent/foreign, sanitized 503 on storage/dispatch outage, malformed 400 and bearer 401; remove two-read disappearance race without trusting provider error text. Existing standalone readable failure message and guarded dispatcher stay intact. No production/pass/provider access changes. Test and final-main/deployed/custom connected evidence remain independently gated.

- **#147 RTC read envelope integrity (source implementation pending exact-head CI):** Canonical C-1 output can fit the 8 KiB budget before the restricted HTTPS `ok/result/mode/handle` wrapper pushes the wire response beyond it. Bound complete direct and batch-child successful HTTP replies; retain complete already-shaped oversize results under the original RTC connection's existing 24-hour result store, reuse canonical handles and avoid infinitely nesting retained pages. Undefined structuredContent becomes sanitized 503; explicit null remains valid. New fake-transport/real retained-page regressions cover UTF-8, authorized paging, other-owner denial and storage failure. No scope/write/production/credential or scheduling changes. Next: exact-head check, review, merge, final-main checks; live and genuine OAuth/pass/Hub/cleanup acceptance remain distinct.

- **#145 RTC retained-result failure truthfulness (implementation; exact-head and merged-main evidence remain separate):** A known-format saved-result request first checks only this RTC connection's owned handle. Absent/foreign handles return identical 404, while database outage, canonical handler failures and disappearing results return sanitized 503 rather than false 404; malformed queries remain 400. Real dispatcher/fake-store regressions cover owned paging, ownership, storage/provider errors and no leaked internals. No production, pass scope or deployment change. Next eligible independent work: review result-retrieval efficiency and any evidenced RTC hardening gap, while rechecking the real OAuth/read/denial/revocation and scratch evidence gates. This text describes intended source behavior, **not** live pass acceptance.

- **#144 complete RTC batch integrity (MERGED; evidence on PR):** Canonical schema
  checks run for every item before dispatch. Independently bounded read outputs no
  longer combine into an unbounded batch: full UTF-8 envelope stays <=8192 bytes,
  or persists all ordered results/child handles under one connection-owned 24h
  handle and returns complete-prefix rows/count/continuation. Storage failure is
  sanitized 503, never silent truncation. Next: retained-result error taxonomy.

- **#143 credential-safe RTC output (MERGED; checks recorded on PR):** Repairs
  missing RTC-pass shape detection in result shaping/whole-output checks and error
  replies. Deep/key-shaped credentials are withheld before retention; errors scrub
  clipped fragments. Source scanning rejects exact RTC wire values without FAKE
  exemption. Real-dispatcher regressions use generated ephemeral values only.
- **2026-10-13 reverified baseline:** main/live #142 at
  `184c2b0dc9330a117c4f33c5cb98abb73b9ebb91`; all seven main application/release gates
  passed. Linked Vercel production alias independently resolves READY at the same
  exact source. `rtc:public-evidence` with Node proxy support passed manifest,
  OpenAPI and missing-pass 401. This is the separately owner-authorized manual
  release recorded on #142; no scheduled run is observed. Secure authorized RTC
  pass unavailable here; no authenticated read/revocation/OAuth/Hub/cleanup proof.
  Next independent work: complete batch validation/aggregate response budgets,
  then accurate retained-result errors. Keep all external acceptance open.

- **#141 protected RTC connection evidence (source in PR #141; exact-head/merge evidence tracked on PR):** Adds a manual, no-credentials-in-arguments acceptance probe. Before sending a securely supplied environment pass, require the pinned Vercel production origin and #138's complete public exact-revision preflight. In a read phase, prove pass-only preview/read_only whoami, server/meta-limited catalog, metadata refusal of prohibited write and nested meta wrapper, and harmless server read; after owner revokes outside the script, a separately invoked revocation phase requires real `pass_revoked`/401. No script writes, revokes, deploys or claims actual acceptance without a live run. Tests use only fakes. Live #142 is now independently verified; an external issued pass remains unavailable.

- **#140 RTC read failure integrity (MERGED; exact-head and final-main CI passed):** The restricted HTTPS dispatch previously reported every provider/guard error as HTTP 400 invalid_args and treated output missing structuredContent as HTTP 200 null. Reuse the standalone dispatcher argument validator to return 400 only for malformed args, emit sanitized 503 service_error for unavailable/invalid dispatch replies and preserve explicit legitimate null reads. Fake adapter tests cover direct/batch, secret-free errors and no dispatch for invalid args. No wider surface or authentication/approval changes.

- **#139 RTC registry-meta area escape (MERGED; exact-head and final-main CI passed):** The existing restricted HTTPS selector accepted `usesRegistry` meta helpers, including `github_batch`, which could invoke read tools outside the pass's server/meta area without independent nested pass-rate checks. Exclude every registry-consuming wrapper from HTTP dispatch/discovery, and keep equivalent explicit scoped HTTPS search/describe/batch routes. Real dispatcher tests exercise the old standalone nested capability, then prove restricted HTTP refuses it without side effects. Standalone OAuth MCP registry remains intact. RTC0, live deployment and authenticated acceptance stay open.

- **#138 credential-free deployed RTC evidence (MERGED; exact-head and final-main CI passed):** A bounded explicit operator probe checks the public manifest, OpenAPI, missing-bearer 401 and reported build against a caller-supplied independently observed Vercel revision. Redirects and non-HTTPS targets are denied, no credentials or provider writes are used. Reports claim no RTC1, authenticated custom OAuth, Hub or cleanup acceptance. Current live branch/deployment still points to #109; scheduled release unobserved. No production activation or TEST relabel.

- **#137 RTC POST length correctness (MERGED; exact-head and final-main CI passed):** Both tool and batch POST reject malformed/over-32 KiB Content-Length even if parsed JSON is small. Decoded-size bound remains. Missing length has no independently verified raw-byte bound: do not claim full raw-stream enforcement. Regression tests cover malformed, repeated and huge declarations with zero dispatch. No scope, write, production or deployment change; external acceptance remains pending.

- **#136 — usable restricted RTC OpenAPI:** Declares exact path parameters, public/pass security, direct tool argument bodies, finite read-only batch shape, paging/fields limits, result/error envelopes and Retry-After. Shared request validators remain unchanged; tests validate schemas against real adapter responses and malformed batches. Public description stays <=8 KiB and eight operations; RTC0 and external acceptance remain unverified.

- **#135 — truthful service identity and HTTPS subset (MERGED; all seven exact-head checks passed):** Public contract distinguishes the unchanged full standalone MCP catalog from the actual server/meta-only preview/read_only HTTPS pass surface. Dispatch and metadata share one allowlist; no writes/passthrough enter that subset. Public/authenticated identity reports only canonical Vercel build SHA when available, explicitly self-reported/unverified. Invalid or absent build metadata yields null. RTC remains 0; no new authority or acceptance. Also corrects the demonstrated final-main rate-fixture failure: slot tests use PostgreSQL transaction time and independently assert unchanged reservation on refusal; expiry tests retain real time, all existing thresholds remain.

- **#134 — service-owned two-process RTC evidence (MERGED; exact-head all seven checks passed):** Actual restricted HTTP adapters in two child processes use separate PostgreSQL connections to one disposable schema. Overlapping reads must yield exactly 60 successes and four `rate_limited` denials; both workers must then observe pass revocation and removed scratch designation. No provider credentials, real TEST relabeling or deployment. Exact-head CI database job verified `rtc-cross-process.test.js` and all 98 database tests; manifest remains rtc:0 and full/deployed acceptance remains open.
- **Architecture recovery #133 reconciled:** standalone OAuth MCP and provider-owned tools/credentials/dispatch/state/approvals/results remain intact. Optional Hub uses external RTC; optional shared-core adoption is not a gate. Earlier unpublished description-selection work is saved on its local branch and is not merged, deployed or counted as implementation progress. Remaining work is reprioritized to service-owned RTC compatibility and safe nonproduction evidence.

- **#132 — exclusive V-2 cleanup execution:** One account/connection-scoped persistent executor claim serializes different request keys for the same run. Verified completion/definite rejection releases only that executor; uncertain provider/DB outcomes or a crashed worker retain the claim. No TTL takeover. Existing read tools disclose only acquisition time and required owner-authorized recovery, never the executor identity. Shared fake/Postgres and separate-connection database tests; connected acceptance remains unverified.

- **#131 — standalone cleanup identity readback (MERGED; all seven exact-head checks successful):** PR closure revalidates exact draft/head/base/body and numeric identity; issue closure and labeling retain exact number/body/title/type. Changed readback stops later mutations and leaves the journal unfinished. Fake-provider regressions; connected acceptance remains open.
- **Rechecked 2026-10-12:** main #130 has all seven checks successful, no open PRs/issues or submitted #130 reviews. No scheduled promotion run yet; live build remains #109. Read-only database probe still shows zero custom OAuth clients, active connector tokens and development runs; birth-label table absent. No exposed custom-MCP connection here. No manual release, production activation or IN-06 re-request.

- **Active capability: V-1/V-2 usable scratch scenarios with reliable cleanup.**
  Six scratch-only scenarios have code and fake-provider/CI tests. Required real
  acceptance remains: run one explicitly authorized fixture *through the custom
  MCP OAuth connection*, verify immutable journal and remote GitHub readback,
  then perform **separately authorized** cleanup with independent absence proof.
  Exact resource inventories, default labels, uncertain writes, permissions and
  changed commits must refuse destruction. RTC 1 and Toolkit Hub D-4 remain
  separate external acceptance; no simulated tests count as connected proof.
- **Delivered and independently CI-verified #126–#129:** #126 stores bounded immutable first-observed numeric GitHub label identities with original repository SHA; #127 exposes connection-owned journal evidence; #128 runs remote cleanup preflight read-only and reports blockers while leaving all destructive gates intact; #129 compares exact observed/live label IDs and metadata for later drift. None establishes creator provenance or grants repository deletion. Details and exact-main evidence are in the permanent PR handoffs.
- **PR #130 — protected custom-MCP OAuth setup readiness:** Adds an owner-authenticated account/client status showing aggregate dynamic OAuth registration, active/expired connector sessions and next-action instructions. Counts exclude RTC passes and reveal no secret, client ID or token. A valid stored session is not live custom-MCP acceptance. See PR #130 exact-head/final-main CI and permanent handoff for verified merge state.
- **Actual live environment evidence (2026-10-12):** Direct read-only Neon query returned 0 OAuth clients, 0 active connector tokens and 0 development runs; the new #126 birth-label table was absent on the existing deployment schema. Vercel production evidence still pointed at an older main commit, with checked scheduled promotion—not manual deploy—the only authorized live update. No custom OAuth-connected TEST fixture or cleanup took place. IN-06 scratch App/organization designation was already completed; do not repeat those owner setup requests.
- **Next eligible work:** When the checked scheduled promotion reaches current main and an owner-approved external custom-MCP OAuth connection exists, prove one nonproduction scratch seed through the **custom server**, exact durable journal and independent remote inventory. Obtain separate cleanup approval and independent owner evidence before any whole-repository removal. Re-evaluate every deferred item and advance other approved independent work instead of stalling on missing external proof.

### Deferred / conditional work — maintained acceptance and re-entry queue

| Current state | Exact blocker / dependency | Evidence and automatic re-entry trigger | Next eligible action |
| --- | --- | --- | --- |
| **IN-06 scratch setup VERIFIED; genuine V-1/V-2 connected acceptance UNVERIFIED.** `robinson-ai-scratch` App installed/all repos, owner-designated scratch, production OFF and spend $0. | No confirmed custom MCP OAuth-connected test session/secure TEST credentials accessible in this coding-agent context. Real destructive cleanup additionally requires explicit scope/approval. Depends on V-1 seed/V-2 deletion safety. The owner already completed the App/scratch designation and ended testing for the day. | Automatically requeue when the custom-service connection can authenticate and the permitted nonproduction scratch scope is demonstrable. Do **not** re-request IN-06 setup; obtain separate authorization only if the proposed destructive cleanup exceeds existing confirmed scope. | Check service identity/commit; seed one genuine scenario via custom MCP, read journal and independently enumerate GitHub objects; perform only specifically permitted cleanup, verify absence, record remaining IDs and route. |
| **GitHub default labels block whole-repository deletion** (correct fail-closed behavior). | #126 stores immutable first-create ID/SHA observations and #129 independently detects later label-ID drift. GitHub returns no label creator/timestamp; a foreign actor could still race the first read. Matching IDs, names, colors or unchanged SHA do not confer cleanup ownership. Depends on V-1 initial-snapshot design and V-2 bounded verification. | Requeue when independently captured initial baseline records exactly which labels GitHub created before any other mutation and corresponding authorization is sound. Names, default colors, marker tags and guesses never qualify. | Design, implement and adversarially test baseline proof and independent comparison; refuse whole-repo deletion until proven. |
| **RTC 1 / Hub D-4 deployed connected acceptance UNVERIFIED.** Reference/fake conformance exists; RTC currently advertises rtc:0. | Consumer TEST identity contract and actual isolated service mode/endpoint, protected credentials, direct/relay/Sandbox and revocation readback not proven. Depends on agreed Hub consumer contract and nonprod protected ingress. | Requeue eligible integration when actual deployed service commit, scoped TEST identity, credentials and Hub access are available; never fix preview/test mismatch by relabeling or relaxing authorization. | Prove deployed HTTPS subset, custom OAuth, Hub direct and restricted relay, Sandbox and revoked-token denial separately; keep certification open otherwise. |
| **V-3/V-4 successor capabilities and webhook-target plan-only.** | Work-index V-2 dependency is not accepted; dispatch/webhook execution not yet approved to skip the prerequisite. | Requeue after V-1/V-2 completion or a specifically approved documented dependency exception. | Implement the next truly eligible V-card slice; don't skip or silently turn plans into runs. |
| **Hosting and owner-backup runtime checks outstanding.** Settings saved, not deployment/runtime acceptance. | First scheduled checked main→live promotion unverified; #142 manual live source/public subset verified separately; IN-03 owner passphrase backup incomplete. Depends on scheduled workflow and protected owner credentials. | Requeue when scheduled run and actual live build/commit evidence exist, or when owner securely confirms backup through existing owner process. | Observe scheduled promotion without manual deploy/preview or Neon keepalive; retain production OFF, Basic queued builds, 0.25 CU / five-minute autosuspend and $0 autonomous spend. |

**Deferred-work rule:** At every session start, and after new owner input, dependency merges,
environment changes or external test evidence, check each row against
`docs/OWNER-INPUTS.md` and live repo state. When a re-entry condition becomes true,
put its next action immediately back into the eligible work order and update
STATUS/index within the next substantive PR. Distinguish implemented, automated
tests, deployed runtime, connected custom OAuth, Hub routes/revocation and cleanup
at each handoff; never erase a blocker by deferring it indefinitely.


- **#123 — truthful finite scenario progress/preview (MERGED; final-main CI verified):** Read-only progress rejects correctly counted but wrong type distributions; cleanup preview refuses run scenarios whose records violate finite bounds. No writes, external verification still false. #122 merged at ccaeac5cdf48d5889b2031b6ba0cf8a04adf140e; main CI database-job infrastructure rerun pending.

- **#122 — finite V-1 scenario resources (MERGED; exact-head CI verified):** In private-scratch cleanup, enforce one executable scenario and a strict maximum count for each planned object type. Partially seeded runs remain eligible for guarded reconciliation, but unplanned types, duplicates in excess of scenario bounds and plan-only webhook resources cannot become deletion authority merely through journal entries. Shares the seed executor allowlist, includes no-mutation regression. #121 safely merged at 673da81823d950f4f51bac93bd9aaf47032131a6; all seven final main CI checks passed.

- **#121 — V-2 reverse inventory proof (MERGED; exact-head CI verified):** The scratch cleanup preflight checks every recorded branch, PR, issue, tag, release and ruleset against the complete independent remote inventory, in addition to prior listed-to-journal checks. Missing or ambiguous records refuse deletion on both preflights; fake adversarial regressions. #120 final main CI and handoff verified at f05d946f5a7551b32aba2348a9d9eb1739efa299. No custom OAuth or live scratch acceptance.

- **Next session #121–#125:** #120's exact-head and final-main CI and permanent handoff verified. RTC 1 still deliberately advertises rtc:0; genuine Toolkit Hub direct/private-relay/Sandbox and owner-issued read-only pass revocation need actual protected evidence, not the standard GitHub connector. V-1/V-2 live OAuth-connected scenario and scratch create/cleanup remain unverified. GitHub-created initial default labels and all foreign artifacts now block destructive cleanup unless a verified journal baseline exists; do not guess safe names or weaken preflight. Preserve production OFF, $0 spend, hosting policy, explicit owner gates, and scheduled daily checked main→live only.


- **#115 — protect foreign milestones/deployments (MERGED; exact-head and final main CI verified):** The private scratch delete preflight now scans all repository milestones (including closed), deployments and deployment environments twice; any foreign artifact, truncated listing, inconsistent counts or denied GitHub read blocks deletion. Adversarial fake GitHub tests; no live cleanup acceptance. RTC 1/D-4, OAuth and production remain gated. Four-PR numbering cycle #112–#115 ends with this PR when safely merged and main CI verifies; next session is five PRs #116–#120.

- **#120 — V-2 exact Actions workflow ownership (MERGED; exact-head and final-main CI verified):** Independently enumerate enabled/disabled Actions workflow definitions before each scratch repository deletion check. Require exact journaled V-1 workflow path, unique numeric ID, active status and consistent total count; unrecorded/changed/inaccessible definitions fail closed. Offline fake provider regressions. No real cleanup/OAuth or RTC 1 certification.

- **#119 — V-2 Actions run/artifact deletion preflight (MERGED; exact-head and final-main CI verified):** Both destructive scratch checks require independently read zero total_count and empty lists for Actions workflow runs and artifacts. Missing, inaccessible or inconsistent inventories refuse deletion; unit fixtures cover positive and malicious cases. V-1 never dispatches CI in current scenarios. No connected real scratch acceptance.

- **#118 — V-2 complete scratch-label preflight (MERGED; exact-head and final-main CI verified):** Scratch deletion now enumerates all live repository labels twice, refuses any unjournaled, duplicate, missing, capped or unreadable labels, and verifies recorded labels' identities before DELETE. Default GitHub labels not explicitly recorded will block cleanup; no unverified baseline is silently trusted. Adversarial fake provider tests added. No connected destructive test, production or spending authorization.

- **#117 — RTC HTTPS request budget (implementation; exact-head CI pending):** Enforce a 32 KiB UTF-8 size ceiling on the complete JSON POST body before tool/batch dispatch, reject unexpected batch envelope fields, and retain clean 400 invalid_args failures instead of executing oversized payloads. Unit tests cover multibyte bytes, oversized single/batch calls, unknown keys and normal calls. No new write authority, live acceptance or spending.

- **#116 — RTC discovery and batched result integrity (MERGED; exact-head and final-main CI verified):** Reject malformed or unbounded tool discovery fields instead of coercing ambiguous query values. Preserve the existing connection-owned saved-result handle for each oversized read in a successful RTC batch, with regression tests. No new tool authority, certification, connected Hub acceptance, OAuth acceptance, production activation or spending. #115's verified merge status reconciled below.

- **#114 — scratch PR point-of-close integrity (MERGED; exact-head and final main CI verified):** Retain each exact preflight PR identity, and check fresh per-PR GET before optional close plus immediate after-close readback for unchanged run-owned draft, head SHA, base, repository and body. Refuse drift before destructive deletion, with fake-GitHub adversarial tests. No connected real scratch or RTC 1 certification claim.

- **#113 — RTC result retrieval query semantics (MERGED; exact-head and final main CI verified):** HTTPS `GET /api/results/{handle}` now validates and forwards `page`, `pageSize`, comma/repeated `fields` and `offset` to the existing connection-owned guarded result handler. Bad request shapes fail before dispatch; no cross-connection handle disclosure or broader authorization. Unit regressions added. RTC 1 and genuine D-4 routes remain unverified; no spending/production changes.

- **#112 — RTC batch authorization continuity (MERGED; exact-head and final main CI verified):** Each read in an HTTPS batch after the first independently rechecks the current pass, exact scratch organization, nonproduction limits and shared rate budget before dispatch. A revoked/expired or narrowed pass terminates the remaining reads rather than reusing a stale connection. Whole-batch malformed arguments fail before any read. Fake-HTTP adversarial tests cover mid-batch revocation, expiry, scratch removal and exhaustion. This is offline verification only: manifest remains rtc:0, no full RTC 1, D-4 live route, OAuth-connected or real scratch acceptance claim. Exact-head `ci` + `release-policy` and post-merge main CI remain mandatory.

- **2026-10-12 — live-only hosting-cost checkpoint, prepared in substantive PR #110:** Existing GitHub branch protection requires exact-head Actions `ci` plus `release-policy` on PRs into `main`; no force/deletion. PR #111 independently merged the daily checked `main → live` schedule, `live`-only Vercel production tracking, disabled auto-previews and release policy. Saved Basic/queued build and Neon 0.25 CU / 300-second autosuspend settings are recorded in `docs/HOSTING-COST-POLICY.md`; first real scheduled promotion and Basic build performance are NOT yet observed. No manual deployment, added resources, spending, production activation or custom OAuth acceptance authorized. #110 was subsequently merged with exact-head and final main CI verified; this earlier pre-merge checkpoint is retained as context.


- **#110 — atomic RTC pass-area scope and result retrieval (MERGED; CI verified in #110 handoff):** A same-statement transaction binds each owner-issued pass to persisted immutable read-only server/meta areas with allow_writes false, production_access false, money limit 0 and database CHECK constraints. Every HTTPS request independently refuses missing/altered scope. Dispatcher-owned large result handles are normalized to the RTC top-level handle, with result retention remaining connection-scoped. Expanded Postgres and HTTP regressions. Manifest still rtc:0; full RTC1 and real D-4 acceptance not yet proven.

- **#109 — pinned Hub RTC conformance CI (MERGED; CI verified in #110 handoff):** Vendored reviewed Hub RTC runner/fake with locked source SHA. The existing shapes job executes Hub named wire-level probes against reference and this server's local pass-only HTTP adapter. Intentional rtc:0 manifest fails as not certified; tests verify honest skip/failure, expired/revoked/missing bearer refusals, and that CI does not misreport passing RTC 1. Live D-4 remains unverified.

- **#108 — RTC HTTPS read-only gateway (MERGED; CI verified in #110 handoff):** Public adoption manifest and OpenAPI path; pass-only whoami, tool search/describe/call/batch and result routes. Each read checks live scratch designation, revocation, expiry, profile and shared DB rate. Only server/meta read-only tools are permitted. Manifest deliberately returns rtc:0 until RTC 1 conformance and D-4 acceptance are actually proven; no production, spending or provider mutation.

- **#107 — RTC pass foundation + submitted-review safety (MERGED; CI verified in #110 handoff):** Owner passphrase/CSRF-protected setup issues only short-lived preview/read_only passes for independently designated scratch organizations, displayed once via the existing encrypted one-time secret page and revocable by ID. Database stores hashed passes, enforces atomic per-pass rate limits, and the MCP OAuth door still rejects pass kind. HTTPS RTC read-only tools are not yet exposed; hub D-4 real routes remain unverified. Scratch cleanup also refuses non-run submitted PR reviews.

- **#107 — foreign submitted-review safeguard (MERGED; CI verified in #110 handoff):** Scratch deletion now enumerates formal PR reviews per recorded draft and refuses any submitted review or incomplete pagination. Inline run comments are separate and do not authorize destroying approval decisions. Added no-DELETE regression and fixture coverage; no real scratch/OAuth acceptance.

- **#106 — bounded all-runs selection (MERGED; CI verified in #110 handoff):** Read-only cleanup previews now return an explicit at-most-five-run selection with separately reported blocked/excess IDs and incomplete-page warnings. Every selected run still requires a fresh preflight and separately confirmed write; no bulk deletion or remote proof is claimed. Custom OAuth acceptance and real scratch cleanup remain unverified.

- **2026-10-12 — #105 foreign scratch comment isolation (MERGED after exact-head CI):** Before private scratch deletion, boundedly list issue comments and PR review comments. V-1 never creates issue comments, so any presence refuses deletion; review comments require recorded exact IDs, unchanged commit/path/body and a journaled run PR. Reject missing, foreign, changed or truncated results. This is mock-only and not custom OAuth acceptance.

- **2026-10-12 — #104 scratch label & association validation (MERGED after exact-head CI):** Before deleting a private scratch repo, independently verify every journaled run label's exact name, marker and color, plus run PR-label associations against recorded PR/label IDs. Missing or changed identities refuse deletion. Fake regression and all three write doors; no custom OAuth acceptance.

- **2026-10-12 — #103 scratch default-branch integrity (MERGED after CI):** Deletion now requires the original recorded run repository tip SHA (#102), permitting only the exact run-owned committed workflow on default thereafter. Unjournaled default-branch work and old missing-origin ledgers fail closed before DELETE, with fake positive/negative tests. No real scratch operations.

- **#102 CI correction:** Account-scoped seed ref fixture now accepts initial default ref and the later test branch, and tool catalog records immutable origin. No new authority.

- **2026-10-12 — #102 scratch initial commit journal (MERGED after exact-head CI):** Both private scratch repository creation doors now independently read and durably record their initial default-branch commit SHA inside the existing atomic run intent. Invalid GitHub ref/readback remains uncertain, not blindly replayed. Fake request-shape and no-duplicate tests; this is offline only, not connected acceptance.

- **2026-10-12 — #101 standalone cleanup identity (MERGED after CI):** Host cleanup refuses a missing recorded branch SHA and any recorded PR with mismatched numeric ID, merged_at, non-draft state (even closed), foreign base repository or altered head SHA. Fake three-door negative regressions protect host repos. No live credentials or scratch actions.

- **2026-10-12 — #100 finite pagination boundary (MERGED after gated CI):** Shared GitHub pagination now has a maximum of 10000 items, an independent bounded-page cap, and refuses malformed list data and reports non-exhaustive inventory on a repeated empty or tiny linked page. This prevents infinite preflight pagination from stalling or incorrectly completing scratch deletion. No connected OAuth acceptance or real scratch deletion claimed.

- **2026-10-12 — #99 scratch draft-PR identity preflight (MERGED after exact-head CI):** Scratch deletion now requires each listed PR to remain an unmerged draft with exact run footer, recorded numeric identity, unchanged own branch SHA, same private repository head/base, and default or run-owned base. Adversarial fake cases refuse retargeted and ready-for-review PRs. Custom OAuth and real deletions remain unverified.

- **2026-10-12 — #98 repository ruleset/webhook cleanup isolation (MERGED after gated CI):** Before private scratch deletion, enumerate local rulesets and repository webhooks in bounded reads. Refuse any webhook until V-4's verified cleanup exists; only the exact journaled required-ci ruleset with unchanged active branch-policy rules may be destroyed with its parent. Fake positive/negative tests; no live acceptance.

- **2026-10-12 — #97 scratch tag/release isolation (MERGED after gated CI):** Scratch deletion preflight now enumerates bounded Git tags and releases before both destructive checks. It refuses foreign or retargeted tags, published releases, unknown release IDs and release assets, with fake negative regression coverage. No connected OAuth acceptance or real deletion.

- **2026-10-12 — #96 exact per-branch tip evidence (MERGED after exact-head CI):** Scratch repository deletion now binds each run-owned branch to its own recorded creation commit, matching fixture-file commit, or exact recorded review revision. A SHA from another run-owned branch/file cannot authorize deletion. Adversarial fake-GitHub tests block cross-branch and cross-file substitutions before DELETE. Offline only; OAuth acceptance and all-runs deletion remain unverified.

- **Historical plan #106–#110 (completed):** PRs #101–#105 implement stricter V-1/V-2 origin, branch, label and comment ownership checks; verify live main and final post-merge CI, late review threads, and the permanent #105 handoff first. V-1/V-2 remain IN_PROGRESS: custom GitHub MCP OAuth-connected acceptance, actual owner-scoped scratch create/delete, and safe confirmed all-runs cleanup remain UNVERIFIED. Continue approved implementation in dependency order, without treating standard GitHub connector CI as custom-MCP acceptance. Production stays disabled, $0 spend; live credentials/destructive actions require their separate owner approval gates. Merge exactly five new PRs #106–#110, maintain repository docs, stop with next prompt.

- **2026-10-12 — #95 scratch deletion isolation (MERGED, CI green):** Before a whole scratch repository is deleted, inspect bounded live branch, PR and issue inventories and refuse unjournaled or changed resources, including on repeated pre-delete check. Require an exact rather than prefix run marker on scratch creation readback. All checks use fake GitHub, never actual custom connected credentials. No production/spend authority changes.

- **2026-10-12 — #94 stable paginated run inventory (MERGED; exact-head and post-merge CI green):** Adds a strict opaque, account-scoped keyset cursor to the existing read-only run inventory. The all-runs cleanup preview remains journal-only, explicitly non-atomic and never enables deletion; malformed/foreign cursors are refused. Disposable Postgres and fake pagination contracts cover equal timestamp run ordering.

- **2026-10-12 — #93 bounded all-runs inventory (MERGED; exact-head and post-merge CI green):** Adds scoped total-run counts and evidence-only `github_dev_list_runs({cleanupPreview:true})` readiness for up to 20 runs at a time. It identifies unresolved intents and truncated per-run journals without remote provider calls, approval, deletion or false claims of exhaustive scans. All-runs deletion remains unimplemented.

- **2026-10-12 — #92 intent/object reconciliation (MERGED; exact-head and post-merge CI green):** Run intent reads now include the actual run ID; cleanup reports and execution refuse recorded intents with missing, mismatched or duplicate object identities. Fake/Postgres contracts and adversarial planner/report tests establish the linkage. No owner-connected provider acceptance, production change or spending.

- **2026-10-12 — #91 journal collision safety (MERGED; exact-head and post-merge CI green):** Intent completion now records success only when its unique run-object row was actually inserted; a collision leaves the step pending and blocks cleanup instead of falsely completing it. Shared fake/Postgres tests exercise racing steps and already-recorded identities. No live GitHub acceptance, new authority or scratch mutation.

- **2026-10-12 — V-2 #90 exact run-marker isolation:** Corrected a cleanup ownership weakness: prefix matching could mistake a longer run ID's marker for the shorter run. Scratch seeding and cleanup, standalone PR/issue cleanup, draft verification and review fixture checks now require an exact run marker: a bounded description token or complete `<!-- rtc_run=<id> -->` footer. Adversarial tests refuse lookalike repositories, PRs and issues before mutations. No OAuth, production, spend or live scratch authority changed; V-2 all-runs and remaining resource types are still pending.

- **2026-10-12 — V-2 #89 durable per-object report:** Both `github_dev_list_runs(runId)` and confirmed `github_dev_cleanup` now use a shared evidence-only cleanup report: exact owned IDs, per-object journal state, pending/uncertain steps, truncated or conflicting rows, remaining count and explicit safe-resume guidance. Report never claims remote absence or OAuth acceptance from ledger flags; confirmed write separately reports fresh remote verification for that call. No new external permissions or mutating API paths.

- **2026-10-12 — V-2 #88 exact issue cleanup:** For existing host repositories, added a guarded close-only path for run-journaled issues. It verifies exact run footer and issue-not-PR identity, requires the pre-existing `rtc-cleaned` label, closes with GitHub's `not_planned` reason and confirms both state and label before journaling cleanup. No issue deletion or host repository changes outside recorded run items. Partial outcomes remain visible for retry; no connected acceptance.

- **2026-10-12 — V-2 #87 recorded label cleanup:** Existing confirmed cleanup now handles a run-owned label and exact PR-label association in a pre-existing repository. Labels require run marker and collision-free usage scan; any unrecorded issue/PR usage refuses deletion. Associations are removed only by their recorded PR number/label and independently read back. Non-run labels and host repository stay intact. Real connected cleanup remains untested.

- **2026-10-12 — V-2 #86 standalone cleanup:** Extend the existing guarded `github_dev_cleanup` to a recorded test-branch/PR-only run in an existing host repository. Reads GitHub production/protection rules for exact `rtc/<run>/` branches, refuses changed SHA/foreign refs or PRs, closes exact run PRs then removes only owned refs, with readback and per-object scoped ledger updates. Host repository is never deleted in this mode. Unsupported standalone resource types still refuse; no connected scratch or real-host acceptance.

- **2026-10-12 — V-2 #85 guarded scratch cleanup:** Added `github_dev_cleanup` through the normal confirm-always write pipeline, exact private run-marker verification, atomic run freeze, recorded PR closure/readback, repository delete/readback and per-object durable completion. Owner-verified scratch and preview-only connection remain mandatory. CI fake transport and readback tests; **no live OAuth or scratch deletion acceptance**. V-2 non-repository cleanup and all-runs remain for later.

- **2026-10-12 — V-2 #84 cleanup foundation:** Connection-scoped atomic cleanup freeze blocks new writes; exact-object completion and run close require verified per-object cleanup. A pure ID-only planner refuses ambiguous, incomplete, foreign or uncertain inventories. No live deletion or external mutation. Next: guarded V-2 execution and independent GitHub readback.

- **2026-10-12 — #83 root routing repair:** The Vercel deployment previously returned 404 for `/` because `api/index.js` is served at `/api`; the `/` rewrite now explicitly targets `/api/index`. A unit regression checks the rewrite and unauthenticated information response. This is informational HTTP routing, not proof of connected OAuth or scratch writes. All production/spending gates remain intact.

### Verified live checkpoint — 2026-10-12 UTC; carried draft PR #83 (NOT MERGED)

- **Infrastructure:** Custom Vercel project `github-mcp` on existing Pro team; reviewed production main `343b26777af1f57f6e98fdbf625e496ebb1c8800` (merged #82); canonical URL `https://github-mcp-chris-projects-de6cd1bf.vercel.app`. Dedicated Neon project `green-surf-51243848`, database `github_mcp`, fixed 0.25 CU, autosuspend after five minutes, 20 initialized application tables. Project-scoped encrypted environment settings are configured; **never expose secrets or casually rotate `TOKEN_ENCRYPTION_KEY` after credential enrollment.**
- **Owner scratch setup COMPLETE, external connected acceptance OPEN:** In the custom service DB, Organization `robinson-ai-scratch` has its own custom App `robinson-mcp-robinson-ai-scratch`, active All-repositories installation, 41/41 stored permissions matching the App's recorded set, `is_scratch=true`, `production_enabled=false`, spend limit $0, and an owner-confirmed `setup_set_scratch` audit record. This is **NOT** an installation in, or token from, ChatGPT's standard GitHub plugin.
- **Real HTTP smoke (temporary restricted Vercel sandbox):** OAuth authorization-server discovery **200** with correct issuer, protected-resource discovery **200**, `/api/github/setup` GET **200**. Unauthenticated `/api/mcp` GET and JSON-RPC POST each correctly **401** with OAuth Bearer challenge. Informational home page `/` returned **404** (confirmed routing defect to fix and regress-test). Sandbox stopped after testing. **No external GitHub resources were mutated.**
- **Zero connected-test evidence:** `oauth_clients=0`, active OAuth tokens=0, `dev_runs=0`, `dev_run_objects=0`. No authenticated custom MCP `github_list_accounts`/`github_whoami`, run-owned GitHub write or cleanup. Do **not** substitute the standard GitHub connector or bypass OAuth. An owner-authorized custom preview connection choosing only `robinson-ai-scratch` and `profile=read_only` is the initial read check; `profile=everyday` is needed for guarded scratch writes. **V-2 cleanup is not built**; verify a safe run-owned cleanup/recovery path before creating a real disposable repository. No additional owner action requested today; owner stopped testing.
- **Roadmap:** V-1 IN_PROGRESS: six real scratch-only seed scenarios implemented under fake/SQL/request-shape tests; `webhook-target` remains plan-only awaiting V-4 forwarders. V-2 run-owned cleanup remains unimplemented. Production accounts, irreversible changes and spending retain independent gates.
- **Carry-forward accounting:** Draft PR **#83** (`ai/gpt6/setup-visible-feedback`) holds mobile form feedback plus documentation. **Leave #83 unmerged in this session.** Next session must **add to and finish #83 as PR 1 of its five** (verify current main, CI/reviews, reconcile routing issue), then merge four additional substantial PRs. Do not count #81/#82 again or open a duplicate #83.


- **2026-10-12 — setup feedback visibility (#83):** The owner completed mobile forms without seeing confirmation because the reusable form resets on each response and the feedback appears at the top of a long page; database audit found two failed administrator logins, zero successful logins and zero apps/accounts. All internal setup forms now navigate to the accessible `#setup-feedback` heading on their server-rendered POST response (no JavaScript); success and failure display a clearly labeled `Setup response:`. The GitHub manifest POST retains its GitHub URL and all credential, CSRF, same-origin and setup-state protections remain unchanged. The owner must use the `ADMIN_PASSPHRASE` from Vercel (or privately replace it and redeploy).


- **2026-10-12 — mobile setup URL diagnostic (#82):** Owner reported `Origin check failed` during GitHub App setup. Vercel production `PUBLIC_BASE_URL` is correct; the form page also set `Referrer-Policy: no-referrer`, which causes HTML navigation POSTs to emit `Origin: null` under browser standards. Change the form page policy to `same-origin` (external sites still receive no Referer), canonicalize alternate production setup GET requests to the configured HTTPS origin before minting the Strict CSRF cookie, leave POST's exact-Origin requirement intact and provide a helpful 403 browser-link explanation. The secret/CSRF/passphrase guards are unchanged. Test alias redirects and malicious/absent Origin. Owner can also open the canonical link in external Chrome.


- **IN-06 account onboarding next:** Vercel project `github-mcp` on existing Pro team is READY on reviewed main `343b267`; isolated Neon project `green-surf-51243848` uses a 0.25-CU fixed compute with five-minute idle suspension. The owner created `robinson-ai-scratch`; secure scratch designation through the private setup page is introduced in #81. The owner has now installed the custom scratch App and enabled scratch mode. Password-manager backup status is unverified; OAuth connected write/cleanup acceptance remains pending. GitHub account production remains OFF.
- **Batch G implementation COMPLETE:** G-1 through G-6 are built (#39–#64); acceptance evidence and limitations are in `docs/audits/G-BATCH-CLOSEOUT.md` (#66). **Next V-1:** the #67 durable step-intent journal, then remaining V-1 scenario work, preserving per-object recording, safe replay, and IN-06-gated scratch isolation. PRs #69–#70 already built guarded scratch creation and two real scenarios; #71 adds a third. Batch V remains IN_PROGRESS.
- Batches A, B, C, D finished. Real GitHub steps need IN-02…IN-05 (`docs/DEPLOY.md`).
- **Known follow-ups:** port the empty-passphrase fix in `secretsMatch` to stripe-mcp and the hub core (other repos: tell Chris, do not edit); the scratch App's 41 stored installation permissions match its recorded requested set; custom MCP connected execution is untested.
- **Answered 2026-10-10 (Chris):** IN-00 — plan approved ("I approve the plans"); IN-01 — **no automated review** ("I don't want the automated review at this time"); the repository stays public as Chris created it; the implementer self-reviews every diff.
- **Queue:** A → B → C → D → E → G → V → F → H → O → P → W → U → R → X (`MASTER-ROADMAP.md`).

## Environment

- Repo: `Robinson-AI-Systems/github-mcp` (public), default branch `main`. Every change goes through an `ai/*` branch and
  a PR; the `ci` check is the merge gate.
- Runtime: Node 24.x (`package.json` engines, every CI job). GitHub REST API version to pin: `2026-03-10` (still the
  newest on 2026-10-10).
- Dev commands (all finish by themselves): `npm ci`, `npm run check`, `npm test` (unit), `npm run test:db` (throwaway
  Postgres: CI service, or local binaries — works as root), `npm run test:shapes` (Octokit against the fake GitHub).
- Vercel/Neon deployed and custom scratch GitHub App installed (IN-02/IN-03 and scratch portion of IN-04/IN-05); personal and normal org Apps still pending.

## Recent changes (newest first)

**2026-10-12 — Owner-only IN-06 scratch designation (PR #81):** Server-side database refuses scratch flag unless an organization has an active all-repo GitHub App and production OFF. The passphrase+same-origin+CSRF protected setup page performs independent live App installation checks, requires typing the exact org name twice, audits the change, and supports revocation. Fake/throwaway PostgreSQL and HTTP tests cover foreign identities, selected/suspended installations, personal/token accounts, stale or absent credentials and preview mode. This is owner setup infrastructure, NOT connected acceptance or permission to use a real credential without IN-06.


**2026-10-12 — V-1 run evidence and anti-replay diagnostics (PR #80):** `github_dev_list_runs` now reports evidence-only progress and concrete next actions from scoped durable IDs/intents. It never mistakes a truncated page, foreign/mismatched ID, uncertain/pending step, cleanup or unrecognized scenario for completion; even complete journals explicitly disclaim live acceptance. No GitHub writes or production changes. Six real V-1 seeds exist; webhook-target remains plan-only awaiting V-4 secure forwarder dependencies and IN-06. V-1 remains IN_PROGRESS.


**2026-10-12 — V-1 real review-thread seed (PR #79):** Sixth runnable scratch-only scenario creates a private fixture repo, labelled draft PR, three exact original-commit inline comments and mapped GraphQL review threads. A recorded Contents CAS revision changes only the final annotated line; independent readback verifies two current threads and one truly outdated, all 13 exact objects and source content. No live scratch use or CI dispatch. `webhook-target` remains plan-only pending V-4 forwarder/secret dependencies and IN-06.


**2026-10-12 — V-1 exact review fixture revision (PR #78):** Added recorded-scratch-branch Contents compare-and-swap updates for one run-owned review fixture. Original branch HEAD and file blob must match before mutation; new commit is independently journaled and read back, with stale/mismatch/replay tests. Enables a genuinely outdated third review thread in the next scenario. No live GitHub writes; IN-06 pending.


**2026-10-12 — V-1 exact thread ID mapping (PR #77):** Bounded GraphQL review-thread enumeration maps durably recorded numeric inline comment IDs to actual thread node IDs. Refuses incomplete pagination and ambiguous matches; verifies exact identity and `isOutdated` independently. The full scenario remains pending, as does IN-06 owner-gated live acceptance.


**2026-10-12 — V-1 review-comment foundation (PR #76):** Added strictly run-owned inline PR comment creation with exact recorded PR/head SHA, persisted numeric IDs and independent original-line/commit readback. Refuses foreign/stale PR targets and uncertain automatic replay. Does not misidentify a review comment as a GraphQL thread; GraphQL thread mapping follows. IN-06/live acceptance pending.


**2026-10-12 — V-1 real three-level draft PR stack (PR #75):** `github_dev_seed('stack-of-three')` now executes only in verified private scratch Organizations and journals 14 objects: repository, run label, three branches, three committed run files, three linked draft PRs and three label associations. No merges or CI dispatch. Independent readback verifies every PR/base/head, exact SHA, marker, file, branch ref, label and durable object. All three write doors are covered with fake GitHub request validation; live connected acceptance still requires IN-06. `pr-with-threads` and `webhook-target` remain plan-only.


**2026-10-12 — V-1 run-owned draft PR and label primitives (PR #74):** Draft PR creation now requires a recorded run-owned branch and file commit, verifies the remote head's exact SHA and persists the GitHub PR number; reusable helpers also journal one run label and its per-PR association. Fail-closed negative tests protect replay/foreign refs/mismatched responses. No connected account used. Next: compose the three-PR scenario in V-1.


**2026-10-12 — V-1 shared run-owned fixture helpers (PR #73):** Reusable strict `rtc/<runId>` branch and run-specific Contents API mutation helpers claim before a GitHub write, journal exact returned commit IDs, and block uncertain replay. Existing failing-ci seed now uses them and verifies branch SHA. Added durable fixture-file object type, fake request-shape and negative tests for unsafe refs/paths. No real GitHub scratch account touched. Next: executable stacked draft PR scenario.


**2026-10-12 — V-1 protected-main scratch fixture (PR #72):** Fourth real scenario creates a private scratch repository and active default-branch ruleset requiring `ci`; the precise GitHub ruleset ID is journaled and its enforcement/conditions checked on independent readback. Three scenarios remain plan-only. No connected account used; IN-06 remains pending.


**2026-10-12 — V-1 draft release train (PR #71):** Third real scenario builds a run-owned private scratch repo, three Git tags pinned to its initial commit, and a real draft v0.3.0 release. Five exact object IDs, tag SHAs and readback are journaled; nothing is dispatched or published. Four scenarios remain plan-only. IN-06 still blocks live connected acceptance.


**2026-10-12 — V-1 first real scenario seeds (PR #70):** `github_dev_seed` now builds `repo-basic` and `failing-ci` on the real GitHub API, each as three explicitly tracked objects: private run-marked scratch repo; run-specific workflow file committed via Contents API; run label or `rtc/<runId>/failure-ref` branch. Every step uses one-winner claims and exact object recording. Workflows have `workflow_dispatch` only: no Actions run or cost is triggered automatically, so live green/fail acceptance awaits separately approved dispatch (V-3). Reads verify private repo and workflow contents; fake transport exercises real request shapes, nine contract checks across all three doors, retries, scope and partial failure. Five other V-1 blueprints remain plan-only and IN-06 still gates real-account usage. Continue V-1 next session; do not claim end-to-end live CI validation.


**2026-10-12 — V-1 guarded scratch create (PR #69):** `github_dev_create_scratch_repo` sends a private GitHub repository create through the normal write/preview/permission pipeline, only after server-side IN-06 verification of a dedicated scratch Organization, an active all-repos GitHub App, and preview mode. `runDevMutationOnce` reserves a deterministic step and journals the exact returned repository `full_name` before any further mutation; uncertain outcomes cannot be replayed. Tests exercise all three tool doors, fail-closed non-scratch/production cases, and object recording. No live scratch org was created or touched. Next: apply real named scenario seeds using this shared runner.


**2026-10-12 — V-1 inspection tools (PR #68):** `github_dev_list_scenarios` returns truthful seven named **plan-only** blueprints, with an optional deterministic per-run plan and real scratch-account verification. `github_dev_list_runs` shows only the caller's account/connection runs, exact created-object ledger and claimed/uncertain/recorded step status with strict bounds; read dispatch never calls GitHub. Fake and PostgreSQL share a new bounded intent-list contract. No seed or scratch creation is enabled; IN-06 remains pending. Next: guarded scratch create/seed.


**2026-10-12 — V-1 durable execution-intent journal (PR #67):** A scoped, atomic `dev_run_intents` ledger claims each scenario step before outbound GitHub writes; concurrent workers cannot claim the same step. Uncertain outcomes never automatically replay; recording the exact created ID and completing an intent happen in one PostgreSQL statement. Fake and disposable PostgreSQL run the same behavior and concurrency assertions. No GitHub seed/scratch write tool is exposed; IN-06 remains pending. Next: expose safe run/scenario inspection and develop guarded scratch operations.


**2026-10-12 — Batch G phase-gate closeout (PR #66):** Cross-checked every G-1…G-6 tool catalog row, merged implementation PRs and PLAN acceptance. Implementation complete; no live account, deployment, App or production acceptance has been claimed. `docs/audits/G-BATCH-CLOSEOUT.md` records evidence and pending owner-dependent smoke tests. Current priority V-1, IN-06 still pending.


**2026-10-12 — PR #65 (V-1 foundation + efficiency):** Durable account/connection-scoped run/object ledger and contract tests, deterministic plan-only blueprints, bounded task brief, two unit test shards with the same aggregate `ci`, shared fake-sleep injection across write-contract dispatcher doors (without changing production pacing), and permanent coherent-PR/anti-stall guidance. No V-1 GitHub seed or scratch writes exposed; IN-06 remains gated. Schema tests derive migration counts from declared tables; shared-contract dispatcher sleep has a regression test; complete fake organization membership avoids retryable 501 responses while 403-denial tests remain. Post-merge CI wall-time measurement pending.


**2026-10-11 — G-6 package recovery (PR #64):** Owner-scoped restore for an exact deleted version or an entire package, 30-day and reused-namespace warnings, production confirmation and independent 204/readback. G-6 tools completed; Batch G verification/closeout and V-1 follow. No live restoration.


**2026-10-11 — G-6 whole-package deletion (PR #63):** Requires a complete bounded version inventory, names number of versions in destructive preview, refuses known public download threshold and incomplete lists, checks state again before deletion and verifies absence. No live package changed.


**2026-10-11 — G-6 package-version deletion (PR #62):** Scope-specific org/user package reads, stable version identity, destructive confirmation, GitHub's public >5,000-download refusal and independent deletion readback. No real package deleted.


**2026-10-11 — G-6 Pages writes (PR #61):** Guarded Pages creation, source/domain/HTTPS updates and disable; read-before/write/recheck/read-back; publication classified production, private-repo exposure classified access-widening. Updates preserve omitted fields. No live site changed.


**2026-10-11 — G-6 Pages and packages reads (PR #60):** Corrected unsupported user-version `page/per_page` query parameters after exact CI failure, documented truthful incomplete user-version results, and tightened permanent no-shell slow-CI anti-stall guidance in AGENTS/SESSION-START.  Token-budget reconciliation compacts optional field-filter metadata (no behavior change).  Added read-only Pages configuration/build inspection and org/user package discovery with bounded version metadata and permission-preserving errors. Next: G-6 guarded writes. No changes to Pages or packages were made.


**2026-10-11 — G-5 asset upload (PR #59):** Authenticated binary upload to GitHub's exact release upload host with bounded public HTTPS source, duplicate/immutability/published-state protections, nine-contract checks and asset read-back. G-5 complete, G-6 next. No live asset changed.


**2026-10-11 — G-5 public asset download boundary (PR #58):** Public HTTPS URLs only, pinned validated DNS A record, redirect and private-network refusal, streamed size/timeout caps. Unit fixtures prove denied metadata addresses, redirects and oversize responses. Integration into upload follows; no live download occurred.


**2026-10-11 — G-5 generated release notes preview (PR #57):** An optional create-preview asks GitHub to calculate notes without creating a release or tag. Failures and contradictory body inputs fail closed; GitHub remains the source of generated notes on actual create. No live releases changed.


**2026-10-11 — G-5 release asset deletion (PR #56):** Confirmed per-release asset membership, immutable protection, draft/published production classification, race recheck and read-back of deletion. No real assets were removed. Next: secure upload and generated notes.


**2026-10-11 — G-5 part 2, guarded release lifecycle (PR #55):** `github_release_create/update/delete` use guarded request-key writes. Creation defaults to draft with generated notes; publishing requires production approval; published immutable releases refuse changes. Read-back verifies identities and preserved fields; release deletion leaves the Git tag. No live releases changed. G-5 remains IN_PROGRESS for assets and generated notes.


**2026-10-11 — G-5 part 1, release reads (PR #54):** `github_release_list` pages release metadata and `github_release_get` retrieves by exact ID, tag or latest published release. Both include draft/prerelease status, asset counts/metadata and public download links, never asset bytes. No release publication or tag change. G-5 remains IN_PROGRESS for guarded lifecycle and asset tools.


**2026-10-11 — G-4 part 3c, environment deployment branch/tag patterns (PR #53):** `github_env_policy_create/update/delete` are separately guarded from environment PUT. Require custom-policy mode and verified prior policy state, prevent duplicates and incomplete list interpretation, classify existing environment protection, demand confirmation and report only verified read-back. Full-profile owner tools, production and access guards retained. G-4 complete. Next: G-5 release reads, lifecycle and assets.


**2026-10-11 — G-4 part 3b, guarded deployments (PR #52):** `github_deploy_create` prevents GitHub auto-merges, preserves required checks, guards existing/proposed production targets and verifies a created ID; 202 cannot masquerade as a deployment. `github_deploy_set_status` derives environment/ref from GitHub, guards production and verifies the exact new status ID. Three-door write contracts and denial fixtures added. No live deployment or credentials. Next: separate branch/tag policies; G-4 remains IN_PROGRESS.

**2026-10-11 — G-4 part 3a, deployment reads (PR #51):** `github_deploy_list` lists deployment records with bounded paging, ref/environment/task/SHA filters and each deployment's latest status (or explicit null). `includeLatestStatus: false` avoids extra calls. No deployment is created, status changed or production action taken. Next: guarded deployment writes and separate environment branch/tag policy CRUD; G-4 remains IN_PROGRESS.

**2026-10-11 — G-4 part 2, environment settings (PR #50):** `github_env_save` preserves omitted reviewers, wait timers and branch-policy mode, verifies read-back and refuses unsupported custom rules; `github_env_delete` is confirm-always, irreversible, and retains existing production safeguards. No deployment is started. Next: G-4 part 3, deployments and separate branch/tag patterns.

**2026-10-11 — G-4 part 1, environments reads (PR #49):** list environments with truthful paging/protection metadata and optional secrets/variables *counts only*; get environment reviewers, wait timers and distinct branch/tag patterns, preserving unknown protections as visible. No mutations or secret values. Next: environment settings writes (#50) and deployments.

**2026-10-11 — E-2 part 2, pull request stacks (PR #48):** `github_pr_list_stacks` pages or inspects ordered stacks; `github_pr_stack_manage` creates, adds or un-stacks, verifies the exact PR branch chain and read-back, never merges or edits branches. Batch E is complete; G-4 (environment settings, deployments) is next.

**2026-10-11 — Implementation detail for faster Sol 5.6 execution (planning):**
`docs/implementation-contracts/IMPLEMENTATION-DETAIL.md` defines concrete JIT packets; `TOOL-RECIPES.md` maps
inspected helpers and test contracts; `REMAINING-WORK.md` adds edit sequences and regression anchors for the 41
non-merged units at baseline `ed60e19`; `G-4-PACKET.md` supplies a worked request/state/test map. Entry points link
them. No implementation card, queue, index status, owner input, runtime code or CI gate changed. E-2 (#46) and
G-3 part 2 (#45) were in flight at inspection; their implementers reconcile this guidance at the PR boundary.

**2026-10-11 — G-3 part 2, secrets (PR #45):** `github_secret_set` (Chris types the value on the private setup page via a link, or the server generates one), `github_secret_delete`, `github_secret_set_repo_access`; new table `secret_entry_requests`; values are sealed with GitHub's public key on the server and never stored, logged or shown to Claude. G-3 is complete; G-4 (environments and deployments) is next.

**2026-10-11 — G-3 part 1, variables and the secret list (PR #44):** `github_variable_list`, `_set`, `_delete` (repository, environment or organization; the old value is kept for undo) and `github_secret_list` (names and dates only, never values). Sealed secret entry through the setup page (part 2) is next; G-3 stays in progress until then.

**2026-10-11 — G-2 part 2, check, status, artifact and cache changes (PR #43):** `github_check_create_run` / `_update_run` (GitHub App only; a token is told so plainly), `github_status_create` (undo restores the previous state), `github_artifact_delete`, `github_cache_delete` (by id or exact key). Found and fixed a real bug class: a DELETE's extra parameters were sent as a body that GitHub ignores. G-2 is complete.

**2026-10-11 — G-2 part 1, check, artifact and cache reads (PR #42):** `github_check_get_ci_state` (the Batch E helper as a tool: each check and status, required or not, overall green / red / pending / unknown), `github_check_get_run` (with annotations), `github_artifact_list`, `github_artifact_get_link` (link only, never the file), `github_cache_list`. Creating checks and statuses and deleting artifacts/caches follow in part 2.

**2026-10-11 — G-1 part 2, Actions changes (PR #41):** `github_actions_set_workflow_enabled`, `_dispatch` (returns the run; production when the workflow file deploys to a production environment, or cannot be read), `_rerun`, `_cancel_run` (force needs confirm), `_delete_run`, `_review_pending_deployment` (owner's own sign-in). G-1 is complete.

**2026-10-11 — G-1 part 1, Actions reads (PR #39):** `github_actions_list_workflows/list_runs/get_run`, `github_actions_get_job_log` and `_get_run_logs_summary` (short form only: failed steps first, error lines, last lines; long encoded text never returned), `_list_pending_deployments`. Starting, rerunning, cancelling and approving follow in part 2.

**2026-10-11 — E-3 part 2, review changes (PR #38):** `github_review_create/submit/dismiss`, `github_review_reply`, `github_review_resolve_thread` (also reopens; no-op when already in that state), `github_review_request_reviewers`. Messages reaching outsiders ask first; an account approving its own pull request gets a plain explanation. E-3 is complete.

**2026-10-11 — E-3 part 1, review reads (PR #37):** `github_review_list`, `github_review_list_threads` (resolved/outdated, file and lines, latest comment; open threads only on request), `github_review_list_comments`. Review writes (create, submit, dismiss, reply, resolve, request reviewers) follow in part 2.

**2026-10-11 — D-3 branches and tags (PR #33):** `github_branch_list/get`, `github_tag_list` (reads; an empty `protected=` is never sent), `github_branch_create` (starts from the repository's real default branch), `_rename`, `_delete` (the default branch is always refused; the undo recreates it at the recorded commit), `_merge`, `github_tag_create` (lightweight or annotated) and `_delete` (tags are always production). Batch D is complete.

**2026-10-11 — D-2 part 2, file and ref changes (PR #32):** `github_content_put_file` / `_delete_file` (branch always named; refused if the file changed since the preview; undo restores the previous text), `github_content_push_files` (GitHub-signed commit, branch head checked), `github_commit_comment` (notifies mentioned outsiders), `github_git_update_ref` (compare-and-swap; dropping commits needs force and the preview counts them). D-2 is complete.

**2026-10-11 — D-2 part 1, code and commit reads (PR #30):** `github_content_get` (text, directory listing, binary files show size and link only, long text kept behind a handle), `github_content_get_tree` (real default branch, glob filter, GitHub's truncation reported), `github_content_get_archive_link` (the redirect link only), `github_content_check_codeowners` (line, column, kind and a plain fix; 'no CODEOWNERS file' is not 'no errors'), `github_commit_list/get/compare/list_prs` (patches cut at 1,500 characters per file), `github_git_get_ref`, `github_git_get_commit`. D-1 is merged (#27, #29).

**2026-10-11 — D-1 part 2, repository changes (PR #29):** create, create from template, settings (merge options are production), visibility (public names its risk), default branch, rename, archive, transfer, delete, fork, sync fork, custom properties, star. Delete and transfer cannot be undone; the others record how to undo them. All nine write-contract checks pass through every door for every tool. D-1 is complete.

**2026-10-11 — D-1 part 1, repository reads (PR #27):** `github_repo_list` (organization or user, archived filter, capped), `github_repo_get` (merge options, rules on the real default branch, custom properties), `github_repo_find` (searches only this connection's accounts; typed `user:`/`org:` qualifiers are stripped), `github_repo_get_insights` (GitHub's 202 'still computing' asked at most 3 times), `github_repo_get_traffic`, `github_repo_list_activity`, `github_repo_get_custom_properties`. Read tools now receive the credentials (before, only writes did). Tests: 13 new, 650 unit total green.

**2026-10-10 — C-2 listing modes, meta-tools, budgets (PR #26):** a connection now gets either the full catalog or a compact list (4 meta-tools, whoami, the result reader — 816 tokens today); the other listing can be asked for with `?listing=` on the endpoint. `github_search_tools`, `github_describe_tool`, `github_call` (runs any tool you may use, through exactly the same safety checks — every write-contract test now also runs through it) and `github_batch` (reads only). Budgets are enforced in CI with a pinned tokenizer; dangerous tools are listed with PRODUCTION / SPENDS MONEY first; every tool must declare its audience, checked against the catalog. Batch C is complete.

**2026-10-10 — C-1 small results (PR #25):** every read result is shaped, then cut to size: long text is cut at 4,000 characters (logs keep their last 400 lines), a result over 8 KB becomes a preview, and anything cut is kept whole for 24 hours behind a `res_…` handle that only the same connection can read with the new `github_get_result` (pages, fields, more text). 29 summary forms for GitHub objects, `defineRead` for new read tools, a 16th table `result_store`.

**2026-10-10 — B-8b diagnostics (PR #24):** `github_check_permissions` (compares each App installation's permissions with what 21 tool areas need and names the exact permission to add; fine-grained-token accounts are reported, not guessed), `github_rate_status` (what the server last saw, any block, and GitHub's live numbers; works even while a block is in force), `github_where_is_setting` (16 seeded settings GitHub has no API for, with link, numbered steps, what you should see and a read-back check where one exists). Batch B is complete.

**2026-10-10 — B-7 check-writes + first half of B-8 (PR #23):** the write-safety check now compares every registered tool with its row in the tool catalog (production, access, notify, spend, confirm, credential, profile) and fails a tool with no row or a spend tool with no price function; `defineWrite` takes a `price` function that decides what a paid change costs (a failure refuses). New tools: `github_list_connections`, `github_recent_changes` (reads), `github_set_default_account`, `github_revoke_connection` (writes, full profile). `github_set_spend_limit` is now confirm-always and full-profile as the catalog said. Connection "last used" is recorded. Not built yet: B-8b.

**2026-10-10 — A-5a credential store (PR #11):** every GitHub credential is encrypted at rest with AES-256-GCM (`TOKEN_ENCRYPTION_KEY`), each value sealed with a context that ties
it to its account, App, installation and scope, so a copied ciphertext cannot be reused elsewhere; a wrong or missing key gives a plain message and never a secret. `createCredentials`
supplies the client's `token({ account, cred, scope })`: installation tokens minted with a hand-signed App JWT, cached until five minutes before expiry and downscoped per connection (each
scope its own token); the owner's user token refreshed ten minutes before expiry (a lost refresh race uses the other instance's new tokens, a refused refresh asks for sign-in again); a
fine-grained token for accounts that use one (cannot be narrowed — says so); the classic notifications token only for `K`. `storeApp` keeps the manifest flow's key, client secret and
webhook secret as ciphertext. One-time secrets (ten minutes, read-and-delete) and setup states (single use, bound to a purpose) are stored. `listAccounts` never returns ciphertext.
Also fixed A-4's test helper: nested body schemas now validate and JSON bodies are no longer type-coerced. Tests: 174 unit, database and request-shape suites green. No setup page yet (A-5b);
no real credential exists.

**2026-10-10 — A-4 GitHub client (PR #10):** `src/github/client.js` is the only file that imports `@octokit/*`. `githubFor(ctx, { owner, cred, scope })`
refuses an account outside the connection (`outside_scope`) or without a credential (`no_credentials`), sends `X-GitHub-Api-Version: 2026-03-10` on
every call, never retries a write (or a GraphQL mutation) after an error, spaces writes one second apart per installation across instances
(`claimWriteSlot`, one atomic statement), records GitHub's rate headers per account and resource and refuses calls while blocked with the
reset time in Denver time (`rate_limited`), honours `retry-after` only inside a 20-second budget, and can cache a polled read by ETag
(`request: { etag: true }`; a 304 returns the stored body). `requestKey` gives writes their retry-proof key; `listAll` follows `Link` to a cap and
says when it stopped. Vendored: GitHub's REST description for 2026-03-10 (rest-api-description @ 58b1e0c0, 1,232 operations) and GraphQL schema
(github/docs @ be38ec5d), each with `SOURCE.md`; `scripts/openapi-find.mjs` and `scripts/graphql-find.mjs` search them. The fake GitHub now knows every
operation and rejects any request that does not match the description (including unknown body fields) or any GraphQL document that does not match the
schema. The secret scan skips only the two vendored data files (their examples contain token-shaped text). Tests: 138 unit, 38 database, 15 request-shape.
No real GitHub call was made; no credential exists.

**2026-10-10 — A-3b connector login endpoints (PR #9):** `api/oauth/{register,authorize,token}`, `api/well-known/*` (rewritten
from `/.well-known/*` by `vercel.json`), `api/mcp.js`, `api/index.js`. Contract-generic `src/core/{http,oauth-handlers,mcp-auth,
mcp-server}.js` take an injected policy; the GitHub rules are in `src/oauth/policy.js`: the authorize page lists the accounts
(checkboxes + default), mode, profile, listing and the passphrase; **production is refused unless the deployment is the production
one and every selected account has `production_enabled`**; settings are examined only after the passphrase is right; a missing
`ADMIN_PASSPHRASE` fails closed; the code → token grant copies every connection setting from the issuing row, refresh rotates on the
same row. `/api/mcp` authenticates the bearer and lists the registry's tools (none yet); every `tools/call` is refused by the default
dispatcher until Batch B supplies a guarded one. `src/runtime.js` creates the schema once per instance. Tests: handler round trips,
production refusals, lockout, escaping, MCP over a local HTTP server, and one full flow on throwaway Postgres.
Nothing was run against a deployed server (none exists; IN-02).

**2026-10-10 — A-3a connector login store (PR #8):** `src/core/oauth.js` (copied from `stripe-mcp` @ 90a49c0: token hashing,
PKCE S256, redirect validation, client address, 5-failures-in-15-minutes lockout) with one fix — an empty submitted
passphrase used to crash the login check instead of counting as wrong (port back to the source and the hub core).
`src/db.js` gained `checkConnection` (refuses a connection with no accounts, a default outside the list, or an unknown
mode, profile or listing) and the store: clients, single-use codes, access tokens, atomic refresh on the same row for the
same client, revocation, login-attempt counting, `listAccountsForLogin`. Codes, tokens and client secrets are hashed. Fake
database mirrors it; one shared contract (`test/contract/oauth-contract.js`) runs against the fake and real Postgres.
Tests: `tests/unit/oauth-core.test.js`, `tests/unit/oauth-store.test.js`, `tests/db/oauth.test.js`. No endpoints yet (A-3b).

**2026-10-10 — A-2 foundation schema (PR #7):** `src/db.js` — `SCHEMA_TABLES` (13 tables), `CONNECTION_FIELDS` and
`connectionSettings(row)`, `productionSql()` (lazy Neon client, plain error when `DATABASE_URL` is missing, nothing at
import time), `createDb(sql)` → `{ initSchema(), listTables() }`; `initSchema()` runs the §2 `CREATE … IF NOT EXISTS`
statements one per call, in order (idempotent, no drops, no data). Fake database gained `initSchema`/`listTables`.
Tests: `tests/unit/schema.test.js`, `tests/db/schema.test.js` (exact table set, idempotence, defaults, keys, no plaintext
secret column). The two expiry timestamps `user_token_expires_at` / `user_refresh_expires_at` are allow-listed in that
scan. No Neon database exists yet (IN-02); nothing was run against a real one.

**2026-10-10 — CI cadence (docs + CI config PR #5):** never push while a PR's CI run is in progress (SESSION-START §6,
PLAYBOOK Step 5); obsolete PR runs are cancelled, runs on `main` never are. Next action unchanged.

**2026-10-10 — A-1 foundation merged (PR #1):** `package.json` (Node 24.x, pinned dependencies, lockfile), ESLint,
three Vitest suites (unit, db, shapes), `scripts/check-secrets.mjs` (scans tracked files for GitHub tokens, PEM keys,
non-local database URLs, Neon/Vercel identifiers, committed `.env`), `check-docs-updated`, `check-writes` and
`check-budgets` (starting form), `check-core-imports`, `count-catalog.py` and the index validator in `npm run check`;
`scripts/local-postgres-test.sh`; `test/helpers/fake-github.js`; CI jobs check, unit, db, shapes and the aggregate `ci`.
A deliberately failing test turned `unit` and `ci` red once (https://github.com/Robinson-AI-Systems/github-mcp/actions/runs/38077330755), then was removed; the final run is green at the
exact head (linked in PR #1). Actions pinned to `actions/checkout@v7` and `actions/setup-node@v7` (Node 24 runtimes). Cards A-2 and A-3
written.


**2026-10-10 — Gap check against prior toolkits (local commit):** every GitHub tool name Chris built or planned in
`robinsons-toolkit-mcp`, `robinsonai-mcp-servers` and `robinsons-toolkit-api` (528 names) mapped to this plan in
`docs/audits/2026-10-10-prior-tools.md`: 432 covered by hand-built tools, 59 by the universal tools, 34 dropped with
evidence (GitHub retired the endpoint, Enterprise-only, or out of scope), and 4 gaps added — `github_content_check_codeowners`,
`github_release_delete_asset`, `github_package_delete`, `github_security_compare_dependencies`. Catalog now 305 tools
(299 hand-built + 6 universal). Historical external project inventories are outside the scope of this MCP record.

**2026-10-10 — Plan completed (local commits):** process and acceptance files (PLAN, MASTER-ROADMAP, STATUS,
AI-PR-READ-FIRST, ARCHITECTURE, GO-LIVE-CHECKLIST, DECISIONS, ROADMAP, OWNER-GUIDE), the Appliance Desk profile
(`APP-NEEDS-APPLIANCE-DESK.md`, rows G1–G20), drift protocol and archive index. The catalog counter moved to
`scripts/count-catalog.py`; profile tools renamed `github_profile_*` so they no longer share a prefix with GitHub
Projects tools; a dated amendment lets a profile allow its own agent steps on an owned branch (Appliance Desk's
`transfer/**`).

**2026-10-10 — Plan written (initial commits):** AGENTS, START-HERE, SESSION-START, PLAYBOOK, research audit (GitHub API,
credentials, old toolkit's 311 tools and 20 bugs, official connector comparison), 15 batch designs, TOOL-CATALOG (301 tools:
295 hand-built + 6 universal, every name `github_…`), owner inputs IN-00 … IN-14, work index (64 cards since the old-toolkit decision note was dropped) with validator,
first card A-1.

## Blocked

Nothing in engineering. IN-00 and IN-01 answered; owner inputs IN-02 … IN-13 (`OWNER-INPUTS.md`; IN-14 answered: not needed)
are open and none blocks A-4.

## Unverified (each has an owner card)

- Paid security feature prices per active committer (O-4 §0 row O4) — read GitHub's pricing page before O-4 and H-4 merge.
- Whether Appliance Desk's `main` ruleset also blocks force pushes and deletion (APP-NEEDS row G3) — P-2 reads it.
- That `2026-03-10` is still the newest REST version when A-4 starts (BATCH-A §0 row A2).

### Session RTC/runtime reconciliation — October 12 Denver / October 13 UTC
Architecture recovery #133 and its handoff are reconciled; actual #134 main is `fcc1993687043a9dbad33903968e2886444ac7c7`. Read-only public `/api/contract` on the observed service alias still reports the old RTC0 metadata with no build revision. Vercel production metadata still identifies #109 `e52a6708beb2aca1c1c194b892a965c06fd37cb1`; no scheduled promotion observed. No manual deployment, protected owner pass retrieval, authenticated custom-MCP call, real fixture or cleanup was performed. The earlier zero OAuth clients/tokens/runs database evidence has not been re-probed as a keepalive. IN-06 stays answered.

- **#134 final-main failure investigated:** new `rtc-cross-process.test.js` passed again, but pre-existing `rate-contract.js` expected a queue wait >=5900 ms after a database round trip; observed 5879 ms. This was latency in a wall-clock fixture, not a rate-limit violation. #135 pins only slot-test time with a real database transaction and adds exact persisted timestamp/readback assertions. No rerun, skip, relaxed threshold or provider guard change. #135 exact-head CI independently verified the remedy; final-main and final batch checks remain mandatory.

### Reconciled session outcome and eligible next work
Five substantive implementation PRs in this session: #131 standalone cleanup identity, #132 exclusive cleanup execution, #134 two-process RTC rate/revocation, #135 truthful subset/build evidence and demonstrated CI correction, #136 usable bounded OpenAPI. Concurrent #133 is owner-requested architecture planning and is not counted as a substantive implementation PR. The description-selection draft and proposed journal-freeze successor were not published after owner reprioritization.

Next: verify scheduled live source and compare public/authenticated build identity against provider metadata; obtain owner-issued scoped nonproduction service pass/OAuth through the protected existing flow, then record genuine read/denial/revocation and supported Hub routes separately. Shared-core adoption and internal dispatcher uniformity are not gates. Where external proof is absent, inspect approved service-owned RTC profile/area/guarded-write compatibility and original provider roadmap, preserving prerequisite/owner gates. Current HTTPS server/meta read-only scope must not be silently widened to unblock tests. V-1/V-2, RTC1 and real Hub acceptance remain open.

- **#135 final-main recovered:** `18ea274ce043c1f50a9a7e2c6281a021ad3e4a28` has all seven application/release-policy checks successful. Existing timing thresholds and the new exact queue-reservation assertion passed. Public hosted `/api/whoami` without a pass returned HTTP 401 with `permission`; this confirms unauthenticated denial on the older deployment only, not authenticated custom acceptance or deployed new source.


---
# Moved from docs/MASTER-ROADMAP.md on 2026-10-24

## Gateway dependency correction — 2026-10-12

RTC interface work and authorized nonproduction Hub route acceptance are independent of K-3 package adoption.
Follow current STATUS/index and service isolation/owner gates. Optional reuse must not block provider capability
or require replacing service-owned dispatch/state. Hub's H-1–H-3 work belongs in its repository.

Written 2026-10-10 for an empty repository. [STATUS](STATUS.md) holds current state; [PLAN](PLAN.md) holds acceptance.

## What is next

**Owner-approved maximum authority expansion (2026-10-21):** [MAXIMUM-AUTHORITY](designs/MAXIMUM-AUTHORITY.md) registers CAP-1..CAP-5 as approved; CAP-1 inventory merged #272; CAP-2 ordinary Full/profile recovery source reviewed under PR #273 (final gates required; no live/provider permission claim): operation inventory, Standard Full access, additional credential enrollment, advanced capability gaps and independent acceptance. Full is available without God Mode; extra credentials only unlock genuinely credential-dependent authority. Existing acceptance/PUB-4 retain priority; publication-only PUB-5 does not block CAP. 98.3% is not a functional coverage measure. GitHub Models is retired, not planned.

**Private-first public-scale expansion (owner 2026-10-18):** PUB-1 and PUB-2 are MERGED, PUB-3 is source-complete in PR #267 pending final exact-head CI/review/merge, and PUB-4 is APPROVED, NOT IMPLEMENTED in `docs/pr-cards/work-index.json`, while PUB-5 is **BLOCKED** pending third-party publication eligibility and explicit owner publication approval. The existing 57-row real-world acceptance queue still takes priority under SESSION-START. Follow `docs/designs/PUBLIC-SCALE.md` and write one JIT card before implementing each PUB unit, bundling related completed cards. OpenAI's current Plugin Directory guidelines do not approve primarily unofficial third-party connectors, so **do not assume this GitHub MCP can be publicly listed under any name**. Private/workspace distribution and standalone MCP use remain the safe engineering target while authorized alternatives are evaluated.



**Next after Y-9 (#233) is merged:** Batch Y approved engineering is complete (Y-1–Y-9), while provider/RTC and owner-run real-account acceptance remains open. Required work includes the real-account read-only smoke report (`scripts/smoke-readonly.mjs`), installing/upgrading GitHub App permissions (IN-15 and Y-9d additions), user U authorization, OAuth-connected scratch writes and authorized cleanup, per-account production activation, and independently deployed direct RTC1 provider conformance using its own service-issued grant; Hub-owned discovery, relay and Sandbox routes are optional integration evidence, not provider completion gates. Also continue the separate `docs/END-USER-AUTHORITY.md` product-wide audit: previous developer-only limits may still affect older feature paths. These items must not be silently marked passed from synthetic CI or from this source merge. `npm run session:status` prints the live queue.

A-1 (repository, fake GitHub, CI, checks) merged in PR #1; A-2 (foundation schema) in PR #7; A-3 (connector login) in PRs #8 and #9; A-4 (GitHub client) in PR #10; A-5a (credential store) in PR #11; A-5b (setup page) in PR #12; A-5c (webhook, `github_whoami`, `github_list_accounts`) in PR #13; A-6 (`docs/DEPLOY.md`) in PR #15; B-1 (write safety layer) in PR #16; B-2 (production guard and switch) in PR #18; B-3 (protected list and project ownership) in PR #19; B-4 (people and spend guards) in PR #20; B-5 (errors and result shaping) in PR #21; B-6 (profiles and downscoped tokens) in PR #22. Plan approved by Chris
(IN-00, 2026-10-10).

