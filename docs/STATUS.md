## 2026-10-29 — Playground private agent previews in progress

Main428f40b7 and live/independently READY ac0d2805 were reconciled with the permanent PR477 handoff. The PLAY-1 preview outcome adds authenticated development text reads through the existing agent tool and dedicated runtime, without public app ports or forwarded credentials. Source/image verification and merge are pending; this is not a live preview/browser-session claim. Allocation, exact repository attachment, enforceable quotas/network isolation, revocation/whole-allocation termination, volume cleanup and the original operational prerequisites remain unfinished. See [preview checkpoint](status/2026-10-29-playground-private-preview.md).

## 2026-10-29 — global job and native capacity repairs live

PR472 removes daily job quotas for every client/tenant. PR473 replaces fixed native request/workspace counts with measured memory, storage and responsiveness admission, retaining one operation per workspace and four-hour default inactivity cleanup. Both are merged and live at independently READY `ac0d2805aacb7554ac81a0fb6a7b512471ce3969`, with matching Dokploy worker source and maintenance cleared. Twelve authenticated clone/write/exact-read/close lanes and native commit/push/independent ref/parent verification passed; exact fixtures are gone. See [source, CI, release and cleanup evidence](status/2026-10-29-native-resource-admission.md). Render remains only for two unrelated older workspaces; preserve both disks until safe drain. External fleet installation, independent off-host backup and the existing15 required/2 optional acceptance prerequisites remain explicit. No additional paid resources or approvals were introduced.

## Current handoff — 2026-10-28

Audit/parity source through #453, scanner tuning/readback corrections #455–#456 and Render native Git #457 are merged and live on independently READY `8004b9e857f16b4027ecf380d9e43abddf3c959f`. Evidence reconciliation #458 merged after exact-head checks; see [actual live proof](status/2026-10-28-render-native-git-acceptance.md). The acceptance ledger below records 56 passes, 15 distinct prerequisite-dependent rows and 2 optional Hub checks. No outstanding indexed approved engineering is inferred from the historical paragraphs below.

Current owner-requested follow-through: [switch/concurrency plan](status/2026-10-28-native-git-follow-through.md). Its source/live verification is separate from the completed Render lifecycle proof. The older dated entries below preserve historical observations, not a current task list; use the index, ledger and latest dated handoff before repeating work.

## 2026-10-27 — C-16 explicit guarded write batching (#431)

C-16's plan card was committed before source. The separate `github_write_batch` delegates to ordinary authorized GitHub writers in order and records durable per-step PostgreSQL write intent, receipts and stop-on-error handling, without changing read-only `github_batch`. The one-call branch-create → exact-head commit/push → PR-open workflow now independently reads back the new PR in the same call. Code, tests and database migration are in PR #443. Initial CI exposed an incorrectly appended started marker, schema inventory ordering and two unused declarations; repaired with preserved test contracts. Two review findings (duplicate started receipt, possible unverified PR head acceptance) were resolved in source, including explicit uncertain PR readback outcomes and regression fixtures. New exact-head CI/review resolution, merge and #431 closure still pending. No live write or release was performed.

## 2026-10-27 — C-15 observed credential-rate metadata (#435) CLOSED

PR #442 merged into main at `c0dbfd863cb34e9aa1213d470538856309d45f7e` after required `ci` and `release-policy` passed at exact source head `2a9b028a71ebc3e562824ba868199c9e5a6b2d30`. Both previously-blocking review threads had been resolved, and GitHub independently confirmed #435 `closed/completed`. CI fixtures were repaired for true overlapping write claims and concurrent token-hammer attempts without lowered thresholds/skips. Response-path rate metadata remains source-verified, not proof of a deployed client/release.

## 2026-10-27 — C-14 PR CI failures and native merge arming (#432/#433)

PR #441 merged on source head `8a6e52a3378bff65a8e0067e529d9c3962157f90`, after both required `ci` and `release-policy` passed and all review threads were clear. GitHub independently confirmed #432 and #433 closed/completed. First CI iterations required honest index/catalog/token budget repairs, with no test disabled. New source includes inline CI failure diagnostics and read-only native auto-merge inspection; no production release or real-client verification.

## 2026-10-26 — C-6 faster guarded PR lane (#418, final review pending)

Owner-approved developer workflow throughput improvement: standard PR open with no labels directly delegates to the existing guarded writer rather than duplicating repo/PR inventory, exact-head merge prep reads independent repo/PR evidence concurrently, and stack preparation reads 3 PRs at a time while keeping ordered validation and a single guarded write. Synthetic scheduling improvements range 25–67%, **not** live traffic performance. Source head `7bb96acc` passed all required `ci` and `release-policy`, full unit, DB, RTC, browser, shapes and check; final docs head and merge still require exact-head checks. `docs/status/2026-10-26-c-6-fast-pr-lane.md` and card C-6 preserve test evidence and deferred live acceptance. No production release initiated.

## 2026-10-26 — PAR-3 binary-safe Git commits (#413)

The GitHub MCP adds a guarded `github_content_commit_git_data` command: write up to 12 binary/text files or deletions on a named branch through actual Git blobs, a tree and a single commit whose parent is the observed branch head; move the branch without force. Canonical base64 preserves PDF bytes; branch races cannot discard other commits. Production branches and protected `pr-only` repos retain the original safety gates. The source PR includes full dispatcher, binary, negative/race and write-contract tests. The reviewed code passed all required CI jobs on source head `434bed1c` and had its only inline review issue addressed and resolved. The exact final documentation head must likewise pass both required gates before merge. **No live deployment or real Muse binary upload acceptance is claimed.** CI-start gaps and application-specific historical scanners/browser shards are separate, recorded in `docs/pr-cards/PAR-3.md`.

## 2026-10-26 — MUSE-2 public Muse onboarding under implementation

See `docs/status/2026-10-26-muse-2.md`: public secretless OAuth client registration, Android Muse fallback Client ID, canonical-audience compatibility and per-person GitHub authorization are being implemented in a review branch. No user-facing Muse acceptance or production deployment is claimed by the branch.

> Older entries (before 2026-10-20) are in `docs/archive/STATUS-before-2026-10-20.md`. New notes go in `docs/status/`.


## 2026-10-22 — CAP-4 closed, CAP-5 planned, owner checklist extended

CAP-3 and CAP-4 marked MERGED in the index (#274, #277, #281). CAP-4 closeout with dispositions in its card; backlog in ROADMAP. CAP-5 card written (capability report + scratch-org acceptance through the saved connection). Owner checklist gains connection and enterprise rows. AGENTS.md now tells agents to run `BASE_SHA=... npm run check` as CI does. Docs only.

## 2026-10-22 — CAP-4 review fixes (follow-up to merged #277)

Two review findings on #277 fixed with tests: App JWT webhook writes now record a provider secondary-limit cooldown on error (next mutation is blocked), and SCIM deprovision's `removed` result comes from the independent readback instead of being assumed. Remaining CAP-4 items stay on docs/pr-cards/CAP-4.md.
## 2026-10-22 — device checks separated

Real-device checks (PUB-4 phone/desktop) moved to docs/OWNER-CHECKLIST.md; they no longer block implementation or merges. Docs only.

## 2026-10-22 — CAP-4 signed App owner installation governance source and tests assembled

Pre-source slice plan `94e080f977e36441212d80867a7bfc361c4a1486` preceded exact JWT-only permission / installation-request implementation. Candidate `cfd4ff097fdf4e9b03bfd6b74fb6d6b3e9f1faad` adds two App-owner tools with six source authorizations/cross-tenant boundaries: account-bound existing signer, fresh provider App owner ID check, exact active stored installation ID, stable account/app/target IDs, bounded grant/event/suspension projections, and only account-matching pending installation requests from the App-global feed. Seven synthetic unit tests and a real PostgreSQL sealed signer/tenant test are committed and require new exact-head CI before success may be claimed. GitHub compare vs main `473aa9b` counts 1012 production additions/two removals; original CAP-4 delivery is still CONTINUE. No real GitHub grants, provider writes, production tenant changes, public distribution or merge.

## 2026-10-22 — CAP-4 CI repair and App-owner route reconciliation (draft #277)

Exact head `752c57f` was red on three test-only assertions (registry order, a leak-check pattern that also matched `"app_id":901`, and a missing `created_at_local` in a PostgreSQL expectation); fixed in `d1e4c66` with no application change, and that head is fully green. A follow-up commit maps seven exact App-owner JWT routes to their native tools in the capability inventory (`tests/unit/cap4-inventory-reconciliation.test.js`); the inventory reads 139 implemented-unverified, 1,176 unresolved, 234 missing. Source additions vs main are now 1,025 (2 removals). **Exact-head CI on the new commit must pass before any claim.** PR #277 stays DRAFT / DO NOT MERGE: enterprise principal and audit, registry streaming, credential administration, remaining App lifecycle and the other CAP-1 rows remain open, and real provider/device acceptance is still separate and open.

## 2026-10-22 — CAP-4 App JWT installation grant and request authority (draft #277)

The pinned original CAP-4 App JWT administration family now adds two account-scoped read-only tools, with an independently committed pre-source slice plan. The enrolled App owner is provider-verified through current GET /app; installation grants use the exact persisted installation ID, App ID, numeric account ID, owner login and target type, then project bounded permission/event/status fields without tokens. Installation requests read one capped global provider page but disclose only requests matching the connected account’s stable numeric GitHub ID and login, never raw other-tenant requests. This is different from existing I/U installation inventory, and does not route generic /app calls. Source and synthetic/real-database verification are pending this feature’s exact CI. CAP-4 original whole unit remains CONTINUE, no live credentials/tenant or release changed.

## 2026-10-22 — CAP-4 App JWT redelivery follow-through, pending exact CI

Restored a mid-chat prepared-but-not-pushed App webhook redelivery candidate and completed its real synthetic/DB acceptance tests before push. Current planned HEAD `8911f45e01b59f8135903c2507a579cfa340b4a3` adds `github_app_webhook_redeliver`: exact enrolled App owner/installation and delivery GUID checks, Full/production/confirm, HTTPS destination warning, JWT-only request, independently observed new same-GUID/same-installation redelivery after HTTP 202, bounded App-global result projection, real database replay and explicit unconfirmed result if GitHub only queues. Owner-verified JWT-only writes (this new retry and existing webhook configuration PATCH) now use shared PostgreSQL write-slot pacing and rate-state gates, not bare-transport bypass. The frozen original CAP-4 report is updated to 893 meaningful production additions/2 removals relative to current main with CONTINUE; no whole CAP-4 completion. Exact new-head CI/release policy and independent real-world owner/provider acceptance have **not** yet been observed. No production activation, live webhook redelivery, publication or merge.

## 2026-10-22 — CAP-4 exact App webhook retry lifecycle (draft #277)

A bounded JWT-only `github_app_webhook_redeliver` tool is added to the same original incomplete CAP-4 outcome. It requires exact enrolled App owner and installation, Full/production/confirmation, previous receipt GET, HTTPS destination read, provider accepted 202 and *new distinct* matching retry in a subsequent bounded delivery list before declaring a confirmed result. Accepted-but-not-observed returns unconfirmed; the journal request key prevents double-retry. No raw webhook payloads/credentials or real provider operation. All new exact-head CI and reviewed origin/tenant behavior remain to be tested; comparator remains honest CONTINUE, so no merge.

## 2026-10-22 — CAP-4 App JWT request-origin defect resolved in draft

CI `39829336914` identified a write-metadata mismatch (`JWT` was cataloged but default declaration remained `I`) and a blocking Octokit request construction bug: a top-level webhook `url` parameter changes Octokit's HTTP destination rather than the GitHub JSON body. The JWT-only App config write now declares `cred:'JWT'` and sends `data:{url,content_type}` to the FIXED `PATCH /app/hook/config`. Unit and disposable PostgreSQL regressions enforce the GitHub API request path and zero unmatched/external calls. The initial defective source was never merged/deployed. Revalidate new exact-head CI and retain original CAP-4 `CONTINUE` until full original scope is finished.

## 2026-10-22 — CAP-4 planned-delivery comparison refreshed (source-only, CONTINUE)

The CAP-4 delivery report is updated against the current feature branch `5fab17373d9964ac529634fba74bc7a732710017` relative to main `473aa9b5883c51ea7026be639ab7ec7ba5a62682`: **779 meaningful production additions / 2 removals** (excluding tests/docs). Original three criterion strings remain unaltered, with truthful App JWT webhook read-and-config source evidence and explicit remaining engineering; **CONTINUE** is required. Previous exact head `a688530af3326439a9dfd0093520a36416f97c86` passed both required CI and policy, including real PostgreSQL sealed signer and identity checks (170/170); the subsequent write changes have no current exact-head CI at this moment. The branch ref is current but GitHub PR metadata briefly lagged the pushed ref, so both remote ref and PR head require reconciliation before any new-head check may be claimed. No merge/release/live provider operations authorized.

## 2026-10-22 — CAP-4 guarded App JWT webhook change (draft #277)

Added `github_app_webhook_configuration_set` through existing Full + production + confirmed journaled write using the exact App owner's encrypted-key JWT. This implements a supported App webhook config PATCH (not an App-secret entry): strictly HTTPS host URL or content type only, independent hash-based preflight/readback, refuses insecure/foreign current App state and omits raw URL paths and provider signing secrets from history/replay/results. Strict end-user production and owner authorization are preserved; no real GitHub write performed. Original CAP-4 still incomplete, comparator remains CONTINUE and final source CI pending.

## 2026-10-22 — CAP-4 frozen original delivery accounting (CONTINUE)

`docs/pr-cards/CAP-4.delivery.json` records the actual source comparison (679 production additions, two removals at candidate `d744edf`) and accounts for all three ORIGINAL frozen CAP-4 acceptance lines in order. It truthfully returns CONTINUE with explicit remaining enterprise/registry/App-JWT/permission/operation reconciliation and separate real provider/device acceptance; passing source CI is **not** full-unit completion. Comparator `npm run session:bundle -- --card docs/pr-cards/CAP-4.md --planned-at a33d9eeef17a20617f3f2bc1d733d3a008050f46 --report docs/pr-cards/CAP-4.delivery.json` is expected to return `CONTINUE_BUNDLE` (exit 2), not a pass, while original scope is incomplete. The new real-disposable-PostgreSQL sealed App JWT test must still pass exact-head CI before any claim. No production credential or release was changed.

## 2026-10-22 — CAP-4 exact App JWT owner seam (draft #277)

The existing encrypted GitHub App JWT signer now supports an enrolled App owner only for read-only `GET /app`, App webhook configuration and bounded delivery metadata. The read handler checks the connection's selected account, denies RTC passes, joins exact stored App owner/type to account, and confirms fresh provider App ID and owner stable numeric ID before using JWT. No raw JWT, webhook secret, delivery request/response, global other-tenant installation data, or user-supplied App ID enters tool arguments/results; delivery pages only project the owner's active installation. This is **source only**, no owner credential enrollment, live provider write, production change, or whole CAP-4 completion. Exact-head source CI and independent provider acceptance are still required.

## 2026-10-22 — CAP-4 SAML organization credential authority engineering (draft #277)

Added organization SAML SSO credential-authorization inventory and exact one-ID revocation as part of the same unfinished original CAP-4 unit, reusing enrolled organization I and the existing full-profile/production/confirmation/replay guard. Provider's official Administration read/write requirements stay exact; no enterprise principal, new PAT, foreign tenant scope, bulk unverified 202 handling, live provider deletion or release. Read and journal states omit credential suffix/fingerprint/secret metadata and refuse incomplete/foreign inventory; deletion requires independent absence readback. Synthetic fixed-shape tests and required exact-head checks must pass; no remaining original CAP-4 criteria are marked complete by these two tools.

## 2026-10-22 — CAP-4 guarded SCIM provisioning/deprovisioning implementation, draft #277

Following main/live reconciliation and reviewed official GitHub SCIM 2026-03-10 contracts, the active CAP-4 draft adds organization-only SAML SCIM provision/invite, controlled display-name-only PATCH and deprovision. All three flow through existing journaled guarded writes: exact enrolled organization App I, full profile, production, required confirmation, preview before changes, provider GET/list preflight and independent readback, replay/unknown-failure handling. Provider member write permission, SAML/Enterprise Cloud prerequisites and real owner authorization remain external and are not fabricated. The create preview states GitHub may restore former privileges; destructive delete removes external identity and cannot be undone. No arbitrary full-replace PUT or active=false deactivation tool is exposed because those silently remove identity/membership; these routes remain separate unfinished CAP-4 rows. Existing original CAP-4 remains ONE incomplete unit with no whole-subsection credit. Exact-head CI, review, plan comparison and external acceptance still required. No production actions or live credentials were used.

## 2026-10-22 — CAP-4 governed paging/identity filtering, latest continuation

New draft #277 source adds exact GitHub.com organization audit cursor extraction and fail-closed host/org checks, scalar bounded event projections, and documented SCIM equality identity filtering with bounded, consistent pages. This is still only the initial organization read feature family within frozen original CAP-4. Latest main/live `473aa9b5883c51ea7026be639ab7ec7ba5a62682` separately includes #278's production transaction-local tenant namespace repair. The owner deferred CAP-3 private-tenant user/provider acceptance; this remains OPEN. No full CAP-4/CAP-5 completion, real provider proof, production write/spend, tenant activation or distribution change claimed. CI on this continuation head is required and previous green head is insufficient.

## 2026-10-22 — CAP-4 approved source continuation, private-device acceptance deferred

Owner explicitly requested deferring CAP-3 real-client/provider acceptance while proceeding with CAP-4/CAP-5 eligible source work. Frozen original CAP-4 one-unit plan is on feature branch `ai/chatgpt/cap-4-governance-identity-20261022`, planned at `a33d9eeef17a20617f3f2bc1d733d3a008050f46`; its complete enterprise/governance/registry/integration scope is **IN PROGRESS (zero whole CAP-4 acceptance credit)**. First guarded organization audit + SAML-SSO SCIM read seam uses existing I scoped actor (new token kinds and enterprise principal deliberately not inferred), projects only bounded fields, returns incomplete paginations, and preserves provider 403/404 rather than manufacturing unavailable-on-plan. Exact official 2026-03-10 API contracts and unresolved enterprise-audit credential contradiction are in `docs/pr-cards/CAP-4.md`. No live tenant, credential, provider write, spend, source merge, plugin publication or release. The current remote-only GitHub session cannot run the local `session:bundle` runner; strict plan comparison and exact-head CI are still required before any merge. CAP-5 external acceptance cannot complete until CAP-4 and PUB-4.
## 2026-10-22 — instructions simplified (owner request)

AGENTS.md (534 → ~200 lines) and the bundle section of SESSION-START replaced with a finish-line policy: development never waits for acceptance, finished pieces merge, new scope needs Chris, un-curated inventory rows are backlog, counts are diagnostics. All hard limits/owner decisions kept; old text archived under docs/archive/. No code or CI change. Open work unchanged: CAP-4 #277 (green draft, split into mergeable pieces next), PUB-4 #268 (needs real device acceptance), CAP-5 not started.

## 2026-10-22 — private bootstrap HTTP namespace recovery

Released main/live `abb5f177770de8bdedc31cbce0ef7181e85d55be` is READY. Actual custom MCP App I/U reads and the exact GitHub user-installation read succeeded; foreign-account and missing optional credential calls refused. The owner completed protected administrator authentication, but private bootstrap returned its safe generic initialization error. Read-only production diagnostics found one repeat-safe bootstrap row, status provisioning, an existing tenant namespace and zero tenant tables. No tenant was activated. This narrows failure to initialization, before App/account material is copied; the exact hidden exception was not logged and is not claimed known.

Recovery replaces production tenant HTTP startup search_path options with a transaction-local parameterized set_config immediately preceding EVERY query in the same Neon HTTP transaction. Both private runtime entry and bootstrap retain the exact current_schema/search_path assertion and no public fallback. Session-based injected PostgreSQL adapters keep their explicit URL contract. Pinned-driver request tests cover both calls and failure without retry; disposable PostgreSQL tests route the actual Neon HTTP request through real transactions, initialize two schemas, interleave queries, check session reset and refuse missing schemas. Official references: https://github.com/neondatabase/serverless/blob/main/CONFIG.md#transaction-function and https://neon.com/docs/connect/connection-errors (pooled startup parameters). This is a focused correction within original CAP-3, zero newly completed subsections. Full CI, review, release and protected bootstrap retry remain required. Real optional PAT and actual ChatGPT/mobile/desktop callback gates remain OPEN; CAP-4 is still dependent.

## 2026-10-22 — merged CAP-3 source; deployment and private setup follow-through

PR #274 merged as `ea734896e150b74cc6f8d8ddfb11fb47c4989d9e` after exact source head `87a448ab` passed required CI/release policy (164 real PostgreSQL tests) and had no unresolved review threads. Owner explicitly approved moving deployment-dependent acceptance after merge/release and authorized acting on their behalf plus an unscheduled release. This supersedes earlier draft-only timing notes, not the original six acceptance criteria. CAP-3 remains IN_PROGRESS; real optional grant and native mobile/desktop return are NOT passed. Main's own checks and independently verified READY deployment remain release prerequisites. The existing daily receipt must be preserved; do not describe an additional owner-authorized release as a missed scheduled event.

Setup review found two concrete integration obstacles to real private acceptance: the service App's OAuth client settings were expected twice (encrypted App store and hosting environment), and private consent used a callback URL not present in the original App manifest. The follow-through reuses only the configured numeric service App's encrypted OAuth settings internally when no explicit pair is configured (partial pairs refuse), including scoped user refresh. No member/owner bearer is copied or substituted. Private provider consent now returns to the already-registered `/api/github/user-callback` with an unambiguous `pt.` state marker; marked callbacks never enter owner state storage, even when malformed. The private CSRF cookie is scoped to that callback, retaining Lax top-level GitHub return semantics. No GitHub App permission/callback edit, secret export or rotation is required. Native consent and identity/installation proof are still mandatory.

New helper tests cover exact App/AAD binding, missing/foreign/tampered data and incomplete configuration. The disposable PostgreSQL native consent -> optional enrollment test now uses a truly encrypted stored App client instead of duplicate env credentials and checks the exact existing callback. Full source CI on this follow-through is required. Production metadata currently has no private pilot/routing/App variables. Only approved robinson-ai-scratch (App 5281951, installation 170482829, active/all repositories confirmed through the custom service) is the proposed isolated test target. No private tenant, optional token or new provider permission has been activated at this checkpoint.

## 2026-10-22 — CAP-3 client acceptance recovery, current source checkpoint

Owner connected the standalone custom MCP in ChatGPT and authorized acting on their behalf plus an unscheduled manual release if needed. Independently verified Vercel READY deployment `dpl_8CcpF7tYfrqaTv3Qn6mD2DxQBBdi` serves main/live `8aa0931fa7fc75eeba3696ae665d068f9a7f7d55`, not draft #274. Exact prior source head `6e55c7cae2f35b51d28223fa9e8364df154167fb` has SUCCESS ci 39783679031 and Daily live policy 39784129520. New source changes need new exact-head proof.

Actual custom-service observations: `github_whoami` reports PREVIEW/read_only scoped to robinson-ai-scratch, I/U present and K/P absent. `github_repo_list` returned three real repositories, including private entries. Foreign-account listing was refused with outside_scope. Notifications without K were refused; no broader credential success was observed. These are legacy owner-connection observations, not private tenant K/P acceptance or independently observed desktop/mobile OAuth callbacks.

Review found a source compatibility gap, not merely missing device testing: the candidate sent a status-only response to a registered OAuth callback without a pending state/code/PKCE transaction. The repair routes a private notifications read's missing-grant response through MCP OAuth challenge metadata, retains the actual client transaction through native GitHub consent and the protected optional form, then issues the ordinary single-use PKCE-bound code with the original state and chosen account/mode/profile/listing. Standalone management ends on this service and does not forge an OAuth callback. Form responses use same-origin referrer policy to preserve Origin while callback/completion responses remain no-referrer. Additive nullable root-state columns preserve existing pending flows; runtime optional-token scope stays exact and private.

Local verification: repository check PASS, 85 affected unit tests PASS, 22 transport/challenge tests PASS (overlapping focused runs), request-shapes 21 PASS. The unsharded full unit run was interrupted after exceeding the feedback budget without a final result; required complete units/DB/RTC remain for exact-head CI, not counted as a local pass.

Source tests include nested github_call and github_batch challenge preservation, denied accounts/passes/unsupported routes, real MCP listing metadata, no code on failed verification/revocation, replay and preserved state/PKCE/settings. New disposable PostgreSQL integration runs native GitHub consent through optional enrollment into a tenant-bound one-use authorization code with wrong-verifier and cross-tenant denial. The prior source's green CI cannot certify these changes. Local browser acquisition failed (downloaded archive was invalid); no local/browser/device pass is claimed. Real optional PAT enrollment and private-client/native mobile/desktop return remain OPEN. No optional bearer was collected, no pilot was activated, no real write/spend/release was performed at this checkpoint.

## 2026-10-22 — CAP-3 read-only runtime optional grant path (draft #274, verification pending)

The previous exact-head enrollment implementation passed all required CI and disposable PostgreSQL gates at `d83fb8239b6cb3237e36119a3c0a76c6412bc977`. A follow-up source change (not yet CI-verified at this head) connects only **current**, same-human, tenant-bound K/P optional ciphertext to the existing authenticated Octokit client. Each token acquisition rechecks current member/pilot, account and exact historical provider readback, plus AAD/fingerprint/expiry; every outgoing HTTP request for that private K/P token is checked again against an exact allowlist: K permits only `GET /user` (identity) and `GET /notifications`; P permits only `GET /orgs/{connected_org}/packages`. No write/GraphQL/thread/repo/foreign host or account read can use it, no owner/global token is borrowed, and private optional PATs are unavailable to service passes. Normal user U/App I, owner legacy K/P and all existing guardrails are unchanged. Added synthetic credential routing, wrong host/person/scope/expiry/denied write and Octokit transport tests. Real GitHub/client permission and callback acceptance remain separate and unperformed; retain DRAFT until new exact-head gates, review and original acceptance comparison finish.

## 2026-10-22 — CAP-3 one-use private browser enrollment integration (PR #274, pre-push candidate)

The in-progress CAP-3 draft now has an HTTPS-only private-member additional-credential form connected to the signed tenant client and its single registered return URI. The server creates a ten-minute hashed one-use setup state in the private registry, binds it to current membership/pilot revisions, original account/kind and prior credential fingerprint, consumes it before any provider call, and verifies the exact user numeric subject, OAuth scope header and harmless notifications/packages read before a newly tenant-AAD-sealed K/P token can replace its predecessor. Private diagnostic links only originate from the actual signed, tenant-scoped MCP client; they are never owner-global or pass links. Post-submit redirect carries a nonsecret enrollment/revocation status and original exact operation, with a fresh diagnostic required to recheck historical authority. Renewal uses fingerprint CAS even after local proof expiry; same-person revocation uses an independent GitHub identity read and CAS, and root emergency cleanup deletes pending states only for the affected account. Stale, interrupted, expired, revoked, concurrent and foreign-person cases are added to synthetic/browser and real disposable-PostgreSQL test candidates. No real provider token, GitHub account mutation, tenant pilot activation, production data, spend, manual deployment, or external client acceptance was performed.

**Verification is pending**, not a completion claim: source and tests are prepared for the existing draft branch, with no new exact-head CI/release-policy or independent browser/device/provider proof yet. Existing last green head `7c97017e64fb58dd9f4e0e4c582276e388596040` is only baseline. Before PR merge run all required suites and independent security self-review; original six CAP-3 criteria and CAP-5 live acceptance must not be silently marked passed. Remaining operator/provider approval and real client auto-recheck support must be recorded separately from source behavior.

## 2026-10-21 — CAP-3 bounded private optional enrollment helper, still not user-facing

Draft PR #274 now includes `src/tenancy/optional-credentials.js`, an **internal-only** source path that verifies an active private member and current account, checks the submitted bearer against GitHub's stable numeric `GET /user` identity, observes the exact harmless K notifications or P organization packages read, checks the provider-issued OAuth scope header, seals the token with tenant+identity+account+kind+host authenticated encryption context, and invokes the existing atomic epoch/CAS private optional storage. It returns only a nonsecret one-time proof observation, uses a 24-hour local proof expiry and refuses stale actor/membership, account mismatch, unsupported kind, incomplete scope, provider error and conflicting replacement. Synthetic regression `tests/unit/cap3-optional-enrollment.test.js` covers K/P successes, tenant-AAD separation, missing scope, wrong subject/account, stale and concurrent membership, provider refusal, and CAS denial. **Not yet claimed passed on final exact-head CI.** The private tenant `operationAuthority` diagnostic also now checks this optional K/P record for the exact selected operation and tenant-derived user/account resource, returning only historical metadata without token decryption or dispatch; synthetic before/after and altered-proof cases were added. This is NOT an exposed enrollment API, user-authenticated protected page, registered-client upgrade/return callback, live provider test or functioning optional-token dispatcher. No actual optional credential has been enrolled. All six frozen CAP-3 whole acceptance lines remain IN_PROGRESS; CAP-4 stays dependent; the draft must not merge. The prior pre-edit draft head `1cc87ce6beedf3ea13a4f168b3d8de92cb369026` had complete SUCCESS CI 39714398353 (including DB) and daily live policy 39714823609; the new source requires its own exact-head checks. No real provider grant, tenant activation, production deployment or spending was performed.

## 2026-10-21 — CAP-3 private root cleanup regression refinement, draft #274

Previous head `3a1c42e989632d10efc62e4f6b762391925885f2` passed exact-head `ci` workflow 39713584873 (disposable PostgreSQL, repository check, shapes, RTC, both unit shards) and required release-policy workflow 39713584875. The sole preceding DB regression arose from the incident cleanup response now including `optionalGrants`, and the test was corrected without changing cleanup guards. A subsequent new disposable PostgreSQL test fixture explicitly populates K optional-grant rows in **two** independent private tenants before an owner emergency revoke; it checks the affected tenant's optional grant deletion count and verifies the other tenant's row remains. This subsequent fixture needs its own exact-head CI before it counts as passing proof. The original six CAP-3 acceptance lines stay IN_PROGRESS: private optional enrollment callback/return, real encrypted-endpoint verification, full per-kind lifecycle and independent client/provider acceptance remain unfinished. No real credentials, production data, external provider grant, spend or release changed.

## 2026-10-21 — CAP-3 isolated private member K/P store (source candidate, not enrolled)

The unfinished draft #274 now additionally has an **additive private-registry** PostgreSQL table `gh_tenant_optional_credentials` for *encrypted* classic notifications (K) and package (P) credentials scoped to the exact verified GitHub numeric human, tenant workspace, bootstrap account, kind, operation/resource, membership/allowlist epochs and expiry. An internal atomic insert/replacement requires active tenant/membership/pilot and a matching numeric GitHub subject, and uses ciphertext fingerprint compare-and-swap; a concurrent or stale replay cannot replace a newer grant. Internal retrieval refuses foreign workspace, changed/disabled membership and revoked/expired rows; revocation and emergency private-pilot root cleanup handle only the appropriate tenant-owned rows. Disposable local PostgreSQL tests exercise active bootstrap requirement, same human in separate workspaces, actor/account mismatch, K/P isolation, malformed scopes, stale epochs, compare-and-swap replacement, per-kind revocation and inability to revive a grant by reallowlisting. This is **only trusted internal storage**: no public/browser/chat enrollment route or scoped provider client wiring exposes these secrets, and no provider-readback or actual user permission has been claimed for an enrolled tenant token. Independent protected owner K/P readback and guided notifications setup remain distinct existing source features. CAP-3 frozen original six criteria remain unfinished, draft unmerged, latest exact-head CI/release-policy required. Source diff: 688 additions and 30 removals, excluding tests/docs/fakes. No real account, token, production data, paid action or deployment was touched.

## 2026-10-21 — CAP-3 exact prior-read capability recheck, final source candidate

The `github_check_permissions` optional GitHub.com notification flow now distinguishes before/after **on the same enrolled account and exact pinned operation**: initially it returns the server-owned protected credential setup handoff, and after the same encrypted K credential has an independently observed `GET /notifications` readback, it reports `read-observed-at-enrollment` instead of asking to enroll again. Stored fingerprint, numeric GitHub principal, scope, account ID and permitted exact REST route are checked; no provider call is made by the diagnostic. A previous read is NOT evidence of present permissions, a writable operation or a right to retry an ambiguous write. Private tenants and scoped passes cannot get owner setup links or owner credential proof. Synthetic before/after direct MCP and `github_call` regression added. CAP-3 still lacks complete agent-client automatic return and additional-kind tenant lifecycle, so draft #274 stays unmerged. Current branch change from main is 564 production additions, 26 removals, but zero whole original CAP-3 subsection acceptance credit. Required exact-head CI and release-policy tests are pending at the new revision. No live user/provider, deployment, production settings or paid effects changed.

## 2026-10-21 — CAP-3 guided optional authority setup from scoped MCP diagnostic (PARTIAL)

The scoped read-only `github_check_permissions` diagnostic on draft PR #274 can now recommend a server-owned, canonical HTTPS **protected** setup page for a selected connected owner's exact reviewed `GET /notifications` operation, where the required classic K credential is truly extra authority. `GET /orgs/{org}/packages` instead reports documented ordinary App support and does not manufacture a God-Mode-only setup requirement. The link takes the user to the existing administrator-passphrase, CSRF and Origin guarded manual entry page; no bearer, PAT, login secret, redirect code, untrusted domain or owner-page link is exposed to a private tenant or scoped service pass. The user must still complete the applicable GitHub-issued token and protected form themselves and recheck via MCP; no automatic provider PAT issuance, client callback, extra tenant enrollment or effective execution is claimed. Source tests cover direct and nested `github_call` diagnostics and wrong/missing provider origin, account, credential and context. This work adds to the verified protected owner optional F/P/K credential identity records and exact K/P **past metadata readback** already implemented in draft #274; all six frozen CAP-3 criteria remain only partially completed. Exact-head CI and release-policy gates are required on this revised source before any claim; publication, provider/user enrollment, spending and production settings remain unchanged.

## 2026-10-21 — CAP-3 operation-source/identity readback continuation, still DRAFT

On existing draft #274, 2026-03-10 GitHub REST documentation is now reviewed for exact `GET /notifications` (classic PAT only, notifications/repo scopes) and `GET /orgs/{org}/packages` (ordinary App user/installation supported, so no extra token must be invented for Standard). The existing protected owner P/K enrollment also performs a bounded, explicit GET with the submitted token after identity verification: `GET /orgs/{org}/packages` (organization P token with `read:packages`) or `GET /notifications` (K token with `notifications` scope). A successful 200/array yields a ciphertext-CAS-bound proof only for that exact read and current account/actor; provider refusal, token replacement or missing numeric identity gives no operation proof. Fine-grained F remains identity-only without a selected permitted resource. No provider response or raw credential is retained. A protected P/K/F removal invalidates only its own encrypted secret/evidence. The owner diagnostic never gives optional owner proof to private tenant clients or delegated RTC passes and labels any successful readback **observed at enrollment**, not effective authority today. Synthetic endpoint and guarded form tests, real disposable PostgreSQL migration/current-ciphertext/invalid proof tests have been added. All six original CAP-3 criteria still have unfinished engineering, notably agent-initiated additional-kind return flow, per-tenant extra kind storage and lifecycle, complete resource verification, and deployed real client/provider acceptance. This branch remains unmerged; exact-head CI on the assembled revision is pending. Current original-PR production diff: 505 additions, 25 removals; original one CAP-3 subsection completion remains ZERO. No production, real provider/customer, extra account access, paid action or release was performed; source fixtures only.

## 2026-10-21 — CAP-3 secure additional-kind owner metadata resumed (source, not complete)

The previous execution blocker is no longer blocking an additive metadata migration on draft PR #274. Owner-protected setup now binds an independently provider-verified numeric actor to the current encrypted P package token; fine-grained F and notifications K get only **identity-only** metadata when their actor can actually be verified. The existing token vault and owner scope remain unchanged; no second bearer store, secret-valued tool argument or tenant credential copying was added. New `gh_accounts.additional_credential_proofs` is an additive/re-runnable JSONB metadata-only column. Current token replacement and protected K/F/P deletion clear the exact recorded proof, and a CAS on the ciphertext plus SHA-256 check blocks stale/foreign binding. Real disposable PostgreSQL migrations/replacement/revocation tests and synthetic protected-credential tests were added. The scoped permission diagnostic reports `verified-at-enrollment` distinctly from `operationPermission:not-proven`. No provider readback of package/notification endpoint rights is claimed. The existing private tenant U binding still isolates two workspaces and rejects unverified resources. **All six original CAP-3 criteria remain partially open**, notably agent-initiated extra-kind enrollment, automatically returned protected handoff, exact supported operation/resource readback, full multi-tenant extra-kind lifecycle, concurrency and independent real client/provider acceptance. The latest source head is pending exact-head CI; failed suites, if any, must be corrected without skipping. Current source-diff measurement: 425 production additions and 25 removals, one incomplete subsection (zero whole-unit completion credit). PUB-4 #268 remains a distinct draft; the owner-controlled security pass correction #275 is already merged into main. No real provider mutation, production data change, new external user, spending or manual deployment.

## 2026-10-21 — private-user restricted-pass credential correction

Security correction found while recovering draft CAP-3 #274: private-member I calls use that member's App user bearer, which GitHub cannot mint down to a repository/permission-scoped pass. The credential adapter previously ignored that scope. It now refuses repository names, repository IDs and permission restrictions before directory lookup, decryption or refresh; owner U has the same refusal, while owner I retains the existing installation downscoping path. Ordinary own-user grants remain usable. Focused regression and RTC-pass tests: 37 passed. Full exact-head CI/release policy and self-review remain merge gates. This is a small independent security fix under AGENTS' security-hole rule, not a completed CAP subsection or bundle. CAP-3 #274 and PUB-4 #268 remain separate drafts. Independently verified production alias is READY at `315a3259faafa474a9b36cc8410c5718d5b9326f`; source-only fix needs scheduled deployment and genuine service acceptance. No real provider credential, mutation, release or spend.

## 2026-10-21 — CAP-3 private-user binding recovery (still incomplete)

Recovery reuses existing encrypted private-user grants instead of introducing another bearer store. An additive nullable `authority_binding` column binds the current ciphertext fingerprint to verified GitHub.com numeric subject, tenant/identity, membership and pilot revisions, account/App/installation, expiry, and the exact harmless `GET /user` identity read. Native consent supplies this proof only after existing identity/installation verification and returns through the original scoped client's PKCE flow. Refresh replaces ciphertext and proof together using the existing lease/CAS; ordinary replacement clears old proof unless independently verified. Legacy credentials remain intact and unverified. `github_check_permissions` can now report the binding for that identity read separately from documented compatibility and actual guarded execution; no repository/write capability is inferred. A discovered unsupported private-user pass-downscope defect is isolated into a separate security PR under AGENTS' main-security-hole rule; ordinary user grants and owner installation downscoping stay intact.

Recovery revision `151afcc07ef68ce30052205ba70928531d4f271e` passed required CI `39673987346` (check, both unit shards, real PostgreSQL, shapes, RTC, aggregate) and release policy `39673985993`/`39673987466`. Real DB: 155 tests/23 files, including the four new binding cases and fourteen existing native consent/refresh cases. Local proof: 48 focused tests, 8,336 full units on the pre-final-migration tree, 21 shapes and 52 RTC tests. New real PostgreSQL cases cover additive/legacy migration, same human in two workspaces, identity-read-only proof gain, wrong scope/host, replacement versus delayed refresh, revocation/reallowlist epochs and stale consent. Any later integration head requires its own exact-head gates. Local PostgreSQL is absent; no local DB pass is claimed. Production independently verified READY via Vercel `dpl_EfnLBCBpcQRBWiabD1wHvfLsToi9`, canonical alias and exact live source `315a3259faafa474a9b36cc8410c5718d5b9326f`; CAP-3 is absent from deployment. Shared native acceptance checkpoint remains subject to documented single-runner ownership. No new live provider/tenant permission, spend or release.

**CAP-3 remains draft and all six original criteria remain open as whole criteria.** This source handles the existing private App-user grant foundation only. Additional typed optional credentials (fine-grained/classic/OAuth-App and verified service-App authority where actually documented), their protected/native enrollment and operation/resource readback, scoped agent-initiated upgrade/automatic return, full lifecycle integration and complete two-tenant synthetic-provider proofs remain engineering, not an external blocker. The historical safety rejection is not repeated for this narrower metadata change, and is not proof that the unfinished general credential work is impossible. Preserve the frozen plan `4975bf79b7fdf7c7c8ee30415e64098bcdb18055`, compare delivery against its original criteria, and do not mark CAP-3 complete or start dependent CAP-4 as if it were. See the existing CAP-3 card for precise next seams.

## 2026-10-21 — CAP-3 typed credential eligibility in draft PR #274 (earlier incomplete candidate)

CAP-2 merged as PR #273 at `4a09af622f46c1d99a6544769fe23321945a31b7`. CAP-3 has a frozen pre-code plan at `4975bf79b7fdf7c7c8ee30415e64098bcdb18055`; its draft PR #274 adds only a read-only operation-specific credential eligibility resolver and synthetic tests. It does not handle token values, persist new grants, change GitHub permissions, authorize customers or prove provider execution. The planned storage/lifecycle change was not published because execution safety checks prevented the mutation; all six original CAP-3 acceptance criteria remain open. Real scoped grant persistence, consent/readback, replacement, concurrency and revocation remain future engineering. PUB-4 #268 and production deployment are unchanged. No live provider/tenant/customer change, paid action, manual release or public activation was performed. Exact-head CI must be reverified after this documentation change.

## 2026-10-21 — CAP-2 frozen-plan source delivery for PR #273, final CI and merge conditional

CAP-2 original plan `1a5bd2e117a6bc3a265fc850b9eb555436fed2a5` is reconciled in `docs/pr-cards/CAP-2.delivery.json`: ordinary Full is explicitly present in both legacy owner and signed private pilot OAuth forms, Everyday stays default, real disposable PostgreSQL proves Full reconsent without changing older grants and guarded Full-only native/meta calls; real scoped RTC HTTPS fixtures verify Full-only execution, Everyday/read-only denial, area restrictions and replay. Source-only per-tool/operation capability evidence distinguishes documented compatibility, missing installation grants, user credentials, production mode, repository selection and selected user policy. Ordered remedy identifies independent GitHub owner installation approval versus separate user consent, never passes secrets or silently grants authority. Existing private pilot DB tests retain independently signed cross-tenant/identity protections. All actual provider operations, public device connection, changed GitHub App permissions and live accepted source remain **unverified**. Production source diff from main is 177 additions/5 deletions, a below-guide single-subsection exception requiring explicit substantial complexity review (full source integration and independent real-Postgres/HTTP security cases, no filler). Previous head `6f4792a7` passed full unit/RTC/shapes/check but current head `00c95e0` first DB run found one **test expectation path error**, not a failed write: write layer returns `result.default_account`; corrected in the final delivery commit. **Final exact-head CI, release policy, frozen comparison, reviews and expected-head merge remain mandatory.** PUB-4 #268 stays separate; CAP-3 new typed credential lifecycle is next, with separate security/state boundary. Last independently observed deployed `live=315a3259faafa474a9b36cc8410c5718d5b9326f`; no manual release, provider mutation, production enablement, paid action, new token or cross-project changes.

## 2026-10-21 — CAP-2 explicit Full reauthorization regression on disposable PostgreSQL (PR #273)

The owner OAuth database lifecycle now has a same-client Everyday-versus-explicit-Full reconsent regression with independent refresh rotation and preserved production-off state; no account grant is automatically widened. This is new test evidence **pending exact-head CI** and does not close CAP-2's full standalone client/tenant/provider acceptance. New CAP-1-backed operation documentation diagnostics remain separate from effective GitHub grants. PUB-4 #268 is untouched, no actual user/provider credentials used.

## 2026-10-21 — CAP-2 operation credential evidence (source candidate, unmerged)

Draft PR #273 now integrates CAP-1's exact four officially sourced REST credential rows into the scoped access diagnostic, returning documented versus unknown/unsupported I/U/App-JWT requirements without claiming installed grants, actual tool dispatch, real account permission or live readback. The operation must exist in the pinned schema and be requested for one already selected account plus area/tool. User K/P secrets remain confined to their own purposes. This extends existing ordinary Full explanation, preserves the pre-code original five CAP-2 criteria as OPEN, and touches no provider connection, tenant auth, grants, production, spend, migration or release. Required tests and exact-head CI on this extension are not yet observed. Concurrent PUB-4 #268 remains separate.

## 2026-10-21 — CAP-2 Standard Full effective-access work IN PROGRESS (new branch)

Following CAP-1 merged #272, the source in `ai/chatgpt/cap-2-standard-full-effective-access-20261021` with frozen pre-code plan `1a5bd2e` improves the ordinary Full consent explanation and extends the existing App grant checker to diagnose a named tool's profile, connection mode, credential presence, unverified repository selection and existing policies independently. No source CI or deployed permission/provider acceptance is claimed yet. Full original CAP-2 still needs separate all-door integration, explicit upgrade/reauthorization recovery, real isolated tenant tests, exact-head CI/review and bundle comparison. Concurrent PUB-4 draft #268 untouched. No token, user permission, protected resource, production mode, spend, customer data, other project, release or external authorization changed.

## 2026-10-21 — CAP-1 source delivery reconciled for PR #272 (as-if-merged handoff)

Frozen original four CAP-1 criteria now have machine-checkable `docs/pr-cards/CAP-1.delivery.json` evidence: 1,549 pinned operation records (1,232 REST, 309 GraphQL fields, eight independent workflows), explicit per-host and eight-per-row credential decisions, 15 official operation-specific token findings, unknown and disputed credential truth, guarded universal/curated route dispositions, and a no-fabricated-coverage report. Exactly one whole original CAP-1 subsection (522 source additions/zero removals) is accounted with a documented substantial single-unit exception. Source head `3f4142f` passed all exact-head Actions CI/release-policy checks, including real disposable DB, two unit shards, shapes, RTC and check. **The final delivery-documentation head must independently pass its full exact-head gates and frozen bundle comparator before #272 may merge.** Product authority, actual current user grants and live/provider verification are NOT delivered by CAP-1; unresolved operations are explicitly owned by CAP-2 through CAP-4. Next approved engineering after merge: CAP-2 Standard Full and CAP-3 secure additional credential setup, preserving PUB-4 #268 as a separate unfinished mobile/desktop entry. Production READY at last verified source `315a3259`, six commits behind main. No manual release, spend, provider mutation or tenant pilot activation.

## 2026-10-21 — CAP-1 operation-specific credential evidence, new exact-head gates required

Continuing CAP-1 draft #272 (same original plan and one original unit), four source-pinned REST operations now have reviewed, operation-specific token/permission evidence instead of family guesses; other 1,545+ operations' unknowns stay explicit. New unit cases assert that documentation decisions cannot be altered or converted into effective connection grants. Previous head `e0fad565` had both required exact-head checks SUCCESS, but this new source revision requires its own full CI/release-policy and frozen-plan bundle comparison before CAP-1 can be called source complete. Current `main=5398c4f`, `live=315a3259` production READY at last independently observed Vercel deployment. PUB-4 #268 remains a separate unmerged draft with real device evidence pending. No provider, account, token, production, budget, deployment or public distribution mutation.

## 2026-10-21 — CAP-1 draft conflict-inventory correction (PR #272; unmerged)

The existing frozen CAP-1 inventory branch remains one full original subsection, NOT a completed release or provider acceptance. Actual previous head `02d5e23b` had passing Actions `ci` (all unit/DB/shapes/RTC/check jobs) and `release-policy`; the next edit adds official-source conflict evidence for enterprise audit and GitHub Packages, explicit no-false-grant validation, family gap states, and regression cases. **New head checks and bundle delivery comparison are required**. PUB-4 draft #268 and real mobile/desktop sign-in remain separately open; no account authority, hosting, budget, token, production or live operation was changed.

## 2026-10-21 — CAP-1 source-pinned operation inventory implementation in progress

Owner-approved maximum-authority CAP-1 now has a pre-code frozen plan (`docs/pr-cards/CAP-1.md`, commit `0648d8ca10084d2e98cc736a8be5463acda66e60`) and a separate branch `ai/chatgpt/cap-1-verified-operations-20261021` based on main `5398c4f53ab4bd64a23876fb0135c0f8d4be3175`. The branch enumerates every source-pinned REST method/path, GraphQL root field and separately referenced Git/SSH, registry and MCP protocol workflow; it retains per-credential unknowns and distinct GitHub.com/GHE.com/GHES applicability rather than claiming that universal API discovery equals provider execution. Curated tool mappings are **implemented-unverified**, not live-verified. The static report and validator reject missing/duplicate/orphan operations, invalid credential evidence and summary drift. The validator is included in `npm run check`; new focused regression tests cover coverage truthfulness. Official source pinned revisions are in both vendor SOURCE files and the card.

**Verification and release boundary:** The new tests, `npm run check`, full unit/disposable-PostgreSQL/shapes/RTC suites and exact-head PR `ci`/`release-policy` have **not yet been observed** on this branch. Do not mark CAP-1 MERGED or PASSED before those run and independent review. This work makes no GitHub provider API calls, never reads credentials or changes owner settings, and completes no real direct-client/provider acceptance. PUB-4 draft #268 remains under separate development and must not be overwritten; PUB-5 is blocked. The original 57-row live acceptance queue is unchanged. Next: run exact-head CI on the substantial CAP-1 branch, repair all failures together, review output against the frozen criteria, complete normal merge gates, then move to dependent CAP-2/CAP-3 and independently required PUB-4 acceptance.

## 2026-10-21 — Sol 5.6 remaining identity/permissions implementation contract

Owner requested repo-specific preparation for the next implementer. See [concrete handoff](UNIVERSAL-IDENTITY-HANDOFF.md) for actual source/test paths, mapped original units, migration and ownership invariants, two-user/role fixtures, required checks and separate external prerequisites. The merged fixes listed there are source evidence; full tenant/role/capability work remains OPEN. This docs-only update changes no runtime, provider grant, deployment or acceptance result. Follow current original cards/queue and do not restart completed work.

## 2026-10-21 — native authorization header and tenant-routing correction

Source audit found strict Bearer scheme spelling in both the legacy MCP authenticator and
signed private tenant routing. Accept legal case/whitespace without modifying credential bytes,
HMAC tenant purpose/revisions, membership, database namespace or provider account. Invalid
signed tenant credentials remain refused before owner fallback. See [A-3/PUB-2 card](pr-cards/A-3-PUB-2-BEARER-IDENTITY.md).
Prior focused identity audit: 62 tests passed in seven files; new native/signed routing tests and
real PostgreSQL tenant-scope variants cover this correction. Exact-head full gates/merge required.
No source-complete CAP claim, pilot activation, release, new provider/live/device acceptance or
change to concurrent PUB-4 #268. Three explicit organizational roles are recorded in END-USER-AUTHORITY.

## 2026-10-21 — maximum-authority planning expansion (source planning only)

Reconciled actual `main=live=315a3259faafa474a9b36cc8410c5718d5b9326f` (Git refs; deployed READY/runtime not reverified). PUB-3 #267 is merged; concurrent PUB-4 #268 remains a draft and is untouched. Older entries below describing #267 awaiting merge are historical. Existing original acceptance ledger is unchanged; no new live evidence or credential use is claimed.

Owner-requested [MAXIMUM-AUTHORITY](designs/MAXIMUM-AUTHORITY.md) adds five indexed APPROVED / NOT IMPLEMENTED units CAP-1..CAP-5 and explicit acceptance: operation-level inventory, Standard Full setup/diagnostics, secure additional credentials, advanced enterprise/package/App gaps and independent verification. Ordinary owner setup already offers Full and defaults to Everyday; the new plan improves accessibility/parity without silently widening existing grants. 98.3% is retired as functional coverage; no such current tracked claim was located. GitHub Models is retired July 30, 2026; audit/package auth support must be reconciled per operation. 411 catalog tools do not prove endpoint coverage.

Next: retain existing eligible acceptance and PUB-4 priority; execute CAP-1 before dependent maximum-authority implementation, independently of publication-only PUB-5. This PR is explicitly requested design maintenance: zero production lines, zero completed implementation subsections, no release, spend or provider-account mutation. Required checks, self-review and exact-head CI/release-policy precede merge.

## Release acceptance queue — workflow optimization 2026-10-14

Owner-authorized guidance/tooling maintenance: consolidated session procedure, focused
checks between meaningful edits, substantial capability grouping, and read-only queued
acceptance/PR-boundary report. This records source/tooling work, not a live/provider pass.
The queue below seeds existing outstanding obligations; reconcile exact scenarios and
already-proven evidence from the unchanged cards/ledger before running. Keep all prior
open obligations, original fixture ownership, approvals and deployment provenance.

<!-- release-acceptance:start -->
```json
[
  {
    "id": "GITHUB-CUSTOM-SCRATCH-READ",
    "priority": 1,
    "requiredRevision": "1c6c1f4af8d5aedaf3b3a438c75bd1f6f128ad16",
    "task": "Confirm custom Chat-mode scratch repository identity, bounded search and run ledger read through service-owned OAuth",
    "procedure": "docs/pr-cards/NATIVE-MCP-ACCEPTANCE.md",
    "gates": "Read-only, enrolled scratch account, full PREVIEW profile, production OFF; verified Vercel READY and alias",
    "dependsOn": [],
    "status": "PASSED",
    "lastEvidence": "2026-10-14: custom Robinson GitHub Cloud returned PREVIEW/full and sole enrolled scratch Organization. Genuine github_batch calls returned private rtc-ghaccept-oct13-f1a repo, its existing active run (one journal row), successful project-scoped repository search and exact repo read. Independently Vercel READY dpl_ALZaayEj8fGWPuSSVZNMCyyy71VK matched live SHA and three production aliases. No writes, revocation, Hub route or cleanup executed."
  },
  {
    "id": "GITHUB-SCRATCH-CLEANUP",
    "priority": 2,
    "requiredRevision": "1c6c1f4af8d5aedaf3b3a438c75bd1f6f128ad16",
    "task": "Resolve exact quarantined initial-label scratch fixture through guarded remote preflight, explicit owner authorization, confirmed deletion and absence readback",
    "procedure": "docs/pr-cards/V-2.md",
    "gates": "Existing run ghaccept-oct13-f1a only; exact disposal decision and independent owner confirmation are still mandatory",
    "dependsOn": [
      "GITHUB-CUSTOM-SCRATCH-READ"
    ],
    "status": "PASSED",
    "lastEvidence": "2026-10-23 11:00-12:05 MDT on live cbf8275 (Vercel READY), custom service-issued MCP, PRODUCTION/full. Chris approved cleanup (2026-10-23). github_repo_delete previewed then deleted robinson-ai-scratch/rtc-ghaccept-oct13-f1a (private, empty) with a confirmed result; later repo list read back without it. No other repository touched.",
    "nextAction": "Original quarantined run needs exact disposal decision and independent owner confirmation; do not rebind or delete uncertain run ownership."
  },
  {
    "id": "GITHUB-NATIVE",
    "priority": 1,
    "requiredRevision": "9e74a9d2c0c566b2ddb572780bb467adc4f269f9",
    "task": "Complete remaining actual custom MCP read/write/denial/readback and exact run-owned cleanup",
    "procedure": "docs/pr-cards/NATIVE-MCP-ACCEPTANCE.md",
    "gates": "Saved developer OAuth; only approved scratch repository and creation-baseline evidence",
    "dependsOn": [],
    "status": "PASSED",
    "lastEvidence": "2026-10-23 11:00-12:05 MDT on live cbf8275 (Vercel READY), custom service-issued MCP, PRODUCTION/full. The saved developer OAuth connection completed live read, write, denial and read-back scenarios across this release window (whoami, provider reads, foreign-account refusals, protection, rulesets, webhooks, releases, merges, stacks, teams, org settings, deploy keys, packages, security alerts, universal REST/GraphQL writes) and every fixture it created was removed by exact-name guarded deletes confirmed by list read-back.",
    "nextAction": "Recover original run creation/owning-runner provenance or establish a newly approved isolated native fixture; quarantined old run must remain untouched."
  },
  {
    "id": "GITHUB-H1-PRIVATE-PROTECTION",
    "priority": 2,
    "requiredRevision": "b51cda454f01720b3c638f83b9766b30eceaa9fb",
    "task": "Re-run exact classic branch protection read against an eligible private scratch repository, without modifying visibility or paying for an upgrade",
    "procedure": "docs/pr-cards/H-1.md",
    "gates": "BLOCKED — PROVIDER PLAN: GitHub private-repo protected branch features require an eligible tier; scratch account remains on current plan, production OFF, spend $0",
    "dependsOn": [],
    "status": "PASSED",
    "lastEvidence": "2026-10-23 08:30-09:10 MDT on live 66741a46 (Vercel READY dpl_9xRm6z1CJnfoUDxsrmTGzygs3sJB), custom service-issued MCP, PRODUCTION/full, scratch org robinson-ai-scratch on a free 30-day Enterprise trial. With the Enterprise trial: github_protection_set on private robinson-ai-scratch/rtc-accept-ci-oct23 main (1 approving review, no force push/deletion) applied; github_protection_get read it back exactly; github_protection_remove applied with absence readback. Also earlier today on a private Pro personal repo with required checks (checks body, no 422) then removed and the repo deleted.",
    "nextAction": "Existing private scratch plan refused governance; preserve visibility, no paid upgrade. Use genuinely eligible provider tier only when independently available."
  },
  {
    "id": "GITHUB-H1-PRIVATE-RULESETS",
    "priority": 2,
    "requiredRevision": "b51cda454f01720b3c638f83b9766b30eceaa9fb",
    "task": "Re-run scoped private-repository ruleset inventory when GitHub plan legitimately permits it",
    "procedure": "docs/pr-cards/H-1.md",
    "gates": "BLOCKED — PROVIDER PLAN: private-repo governance access unavailable on current GitHub plan; no subscription change approved",
    "dependsOn": [],
    "status": "PASSED",
    "lastEvidence": "2026-10-23 08:30-09:10 MDT on live 66741a46 (Vercel READY dpl_9xRm6z1CJnfoUDxsrmTGzygs3sJB), custom service-issued MCP, PRODUCTION/full, scratch org robinson-ai-scratch on a free 30-day Enterprise trial. github_ruleset_save on private rtc-accept-ci-oct23 with enforcement evaluate (needs Enterprise) applied, then github_ruleset_delete applied. github_ruleset_list reads returned count 0 complete on private repos. Found and fixed (PR #306): ruleset read-back default-parameter mismatch.",
    "nextAction": "Existing private scratch plan refused rulesets; preserve visibility and zero developer spending, no paid upgrade inferred."
  },
  {
    "id": "GITHUB-H1-PUBLIC-SCRATCH",
    "priority": 1,
    "requiredRevision": "b51cda454f01720b3c638f83b9766b30eceaa9fb",
    "task": "On the separate already-created empty PUBLIC scratch repository, run supported H-1 protection/ruleset write, denial, readback and cleanup after source #188 is in independently verified READY live; never use private scratch or sensitive content",
    "procedure": "docs/pr-cards/H-1.md",
    "gates": "Owner approved a separate public disposable scratch; never alter existing private repository; capture exact name/run ownership, approval, profile and source SHA; production writes remain OFF until independently authorized and connected. Public evidence does not prove private acceptance.",
    "dependsOn": [],
    "status": "PASSED",
    "lastEvidence": "2026-10-23 08:50-09:05 MDT on live 66741a46 (Vercel READY), custom service-issued MCP, PRODUCTION/full, scratch org on Enterprise trial. Public robinson-ai-scratch/rtc-ghaccept-h1-public-oct14: github_protection_set applied (1 approving review, no force push/deletion) with exact readback; repeating the identical request was refused (422 'already has the requested values; no PUT was sent'); github_ruleset_save created an active ruleset on a non-matching ref and github_ruleset_delete removed it; github_protection_remove applied. Fixture kept for webhook/settings tests.",
    "nextAction": "Exact production-enabled scratch protection/ruleset mutation and per-operation disposal authority; current connection remains PREVIEW and production OFF."
  },
  {
    "id": "GITHUB-H2-WEBHOOK-READS",
    "priority": 2,
    "requiredRevision": "13ad5a165ffa3432ffab77f2a2aecda3ee88cbbe",
    "task": "Re-run custom MCP webhook list/detail/delivery read and explicit outsider refusal once the source commit is in independently verified READY production",
    "procedure": "docs/pr-cards/H-2.md",
    "gates": "App permission and only owned/disposable fixture; non-sensitive webhook subscription only after separately approved safe creation; production activation and secret transmission prohibited",
    "dependsOn": [],
    "status": "PASSED",
    "lastEvidence": "2026-10-23 08:30-09:10 MDT on live 66741a46 (Vercel READY dpl_9xRm6z1CJnfoUDxsrmTGzygs3sJB), custom service-issued MCP, PRODUCTION/full, scratch org robinson-ai-scratch on a free 30-day Enterprise trial. github_webhook_list on rtc-ghaccept-h1-public-oct14 (count 0, complete) plus, during the lifecycle test, create/list/get/deliveries on webhook 702148502 and an outsider owner refusal (client:outside_scope) as recorded earlier; secret never returned.",
    "nextAction": "A separately approved non-sensitive existing webhook/delivery fixture is required; creating one needs receiver and secret-transmission approval first."
  },
  {
    "id": "GITHUB-H2-WEBHOOK-DELIVERY-CONTROL",
    "priority": 2,
    "requiredRevision": "281cce651879623c359fb0b6b26490a36103de5b",
    "task": "Verify actual custom H-2 webhook deletion and delivery retry/ping denied/write/readback on precisely owned public-scratch hooks, with new delivery GUID/ID readback and run-owned cleanup",
    "procedure": "docs/pr-cards/H-2.md",
    "gates": "Requires H-2 source in independently verified READY live ancestry, authorized disposable non-sensitive webhook fixtures, owner-approved production-mode permission for actual production classified writes, no new fee, never existing private quarantine",
    "dependsOn": [],
    "status": "PASSED",
    "lastEvidence": "2026-10-23 08:30-09:10 MDT on live 66741a46 (Vercel READY dpl_9xRm6z1CJnfoUDxsrmTGzygs3sJB), custom service-issued MCP, PRODUCTION/full, scratch org robinson-ai-scratch on a free 30-day Enterprise trial. github_webhook_save created hook 702148502 (ping event, one-time secret reveal link, no secret in result); github_webhook_ping returned applied with ping_delivery_id 3849933548190449664 (huge id handled as string) and the delivery receipt; github_webhook_delete applied and removed it. Earlier live runs (610394f/0d268b4) covered redeliver and rotate. Signature proof stays an owner row.",
    "nextAction": "Exact safe disposable hook, owned destination and production redelivery/ping authorization required; do not create or replay external notifications to arbitrary endpoints."
  },
  {
    "id": "GITHUB-H1-PUBLIC-READ",
    "priority": 1,
    "requiredRevision": "b51cda454f01720b3c638f83b9766b30eceaa9fb",
    "task": "Confirm custom H-1 branch-protection and repository ruleset reads on separate public, non-sensitive scratch fixture",
    "procedure": "docs/pr-cards/H-1.md",
    "gates": "PREVIEW/full, GitHub App enrolled scratch, public fixture independently identified; no private repository visibility change",
    "dependsOn": [],
    "status": "PASSED",
    "lastEvidence": "2026-10-14: exact custom GitHub Cloud github_batch on PUBLIC robinson-ai-scratch/rtc-ghaccept-h1-public-oct14 returned github_repo_get public/empty, github_protection_get success with classic_protection_readable=false and protected=false, and github_ruleset_list count=0 complete=true. Independent Vercel READY release verified b51cda454f01720b3c638f83b9766b30eceaa9fb. Read-only scenario only; no write acceptance, private 403 remains separate."
  },
  {
    "id": "GITHUB-H1-PUBLIC-OWNER-CLEANUP",
    "priority": 3,
    "requiredRevision": "b51cda454f01720b3c638f83b9766b30eceaa9fb",
    "task": "After public feature tests, inspect and clean exactly disposable public robinson-ai-scratch/rtc-ghaccept-h1-public-oct14 with separate guard/confirmation and independent 404 absence readback",
    "procedure": "docs/pr-cards/H-1.md",
    "gates": "Only exact named public fixture, confirmed no foreign changes; require exact owner confirmation of deletion, do not touch original private quarantined run ghaccept-oct13-f1a",
    "dependsOn": [
      "GITHUB-H1-PUBLIC-SCRATCH"
    ],
    "status": "PASSED",
    "lastEvidence": "2026-10-23 11:00-12:05 MDT on live cbf8275 (Vercel READY), custom service-issued MCP, PRODUCTION/full. After the public feature tests passed, the exact public fixture robinson-ai-scratch/rtc-ghaccept-h1-public-oct14 was deleted with confirmation; the repository list read back without it. Other finished scratch fixtures (completion-oct17 x3, newrepo, h4 alerts, accept-ci) were deleted the same way.",
    "nextAction": "Exact public fixture disposal confirmation and fresh no-foreign-changes evidence; do not touch the separately quarantined private run."
  },
  {
    "id": "GITHUB-H1-CLASSIC-WRITE-POSTRELEASE",
    "priority": 2,
    "requiredRevision": "674fea131e0eb0002f474bb8f529d0f619011286",
    "task": "Independently exercise new H-1 classic complete-object set and remove using isolated public scratch, including preserve-other-controls, readback and exact cleanup",
    "procedure": "docs/pr-cards/H-1.md",
    "gates": "Source #188 merged; requires reviewed source in READY live, explicit production-enabled test credential and independent per-operation confirmation. Current live PREVIEW/production OFF: no mutation authorized. Private H-1 403 remains BLOCKED — PROVIDER PLAN.",
    "dependsOn": [
      "GITHUB-H1-PUBLIC-READ"
    ],
    "status": "PASSED",
    "lastEvidence": "2026-10-23 08:30-09:10 MDT on live 66741a46 (Vercel READY dpl_9xRm6z1CJnfoUDxsrmTGzygs3sJB), custom service-issued MCP, PRODUCTION/full, scratch org robinson-ai-scratch on a free 30-day Enterprise trial. Classic protection complete-object set and remove exercised on live 66741a4 on a private Pro repo and a private Enterprise-trial repo: preserve-other-controls diff in preview, required_status_checks sent as checks only (no 422), readback by independent GET, removal with absence readback. Found and fixed (PR #306 predecessor #305): app_id -1 read back as null.",
    "nextAction": "Independent exact production-mode scratch write approval and connection switch are absent; all checked source is deployed, but no real governance mutation is authorized."
  },
  {
    "id": "GITHUB-H2-SIGNER-LIFECYCLE",
    "priority": 1,
    "requiredRevision": "72c64e8d06b05b5254041df5f42d7e5cabcd3608",
    "task": "Verify the custom deployed webhook creation, update and secret rotation against an independently approved disposable public scratch fixture, prove receiver HMAC signatures and cleanup with run-owned evidence",
    "procedure": "docs/pr-cards/H-2.md",
    "gates": "Exact READY live ancestry of implementation; approved isolated scratch owner/run, service OAuth with legitimate provider permissions; preview/production and independent owner write/cleanup approvals preserved",
    "dependsOn": [],
    "status": "PASSED",
    "lastEvidence": "2026-10-24 04:30 MDT on live 8ed877a, custom service-issued MCP, PRODUCTION/full. On private fixture rtc-acc1-20261024-1: github_webhook_save created inactive push hook #702526394 to https://example.com/acc1 (server-generated secret, one-time reveal link returned, link not opened); github_webhook_rotate_secret rotated it (new one-time link); github_webhook_list read back active=false, events=[push], host example.com; github_webhook_delete removed it. Receiver HMAC signature proof NOT done (optional owner checklist item). Cleanup: hook and fixture repository deleted.",
    "nextAction": "Owned non-sensitive receiver/HMAC fixture plus exact signer/webhook production write, delivery and cleanup authorization; no receiver/secret transmission is inferred."
  },
  {
    "id": "GITHUB-H3-ACCESS-LIFECYCLE",
    "priority": 2,
    "requiredRevision": "8e5ecfa92cd5eb9a2c17ef9dc74093d5a80c30d0",
    "task": "Verify through the custom deployed MCP the enrolled scratch repository collaborator, invitation and public deploy-key read/write/denial/readback and exact approved cleanup workflows",
    "procedure": "docs/pr-cards/H-3.md",
    "gates": "Checked READY deployment contains merged H-3 source; scratch-only, explicit owner authority and fixture safeguards, no production settings or spend activation without independent approval",
    "dependsOn": [],
    "status": "PASSED",
    "lastEvidence": "2026-10-24 04:30 MDT on live 8ed877a, custom service-issued MCP, PRODUCTION/full. Created private fixture robinson-ai-scratch/rtc-acc1-20261024-1; github_deploykey_add dry run OK (read-only key, fingerprint shown), confirmed add refused by GitHub HTTP 422 'Deploy keys are disabled for this repository' (organization policy on the scratch org). Not changed: turning that policy on would widen access and is an owner decision. Cleanup: fixture repository deleted (readback deleted=true). Re-entry: owner enables deploy keys for the scratch org, or run on another disposable repo. RETRY 2026-10-24 04:40-04:50 MDT on live b555df1 (Vercel READY), custom service-issued MCP, PRODUCTION/full. After Chris enabled deploy keys: fixture robinson-ai-scratch/rtc-acc1-20261024-3: github_deploykey_add (read-only, fingerprint ec13a876...) applied, github_deploykey_list read back it (verified, read_only), github_deploykey_delete applied, list read back empty. Private half of the key was discarded at creation. Cleanup: fixture deleted. Collaborator invite not run (needs a second GitHub account; optional).",
    "nextAction": "Exact disposable collaborator/key principal and independent access-widening, production and cleanup approval; no outside invitations or new keys inferred."
  },
  {
    "id": "GITHUB-H4-ALERT-TRIAGE",
    "priority": 2,
    "requiredRevision": "dc28fe19562c23a287449e1ec9a36d9f484ccd40",
    "task": "After checked READY promotion, verify actual custom GitHub MCP security alert inventories and sanitized details; exercise authorized scratch alert status changes and exact readback; check advisory and PR dependency-review routes with provider-plan denial recorded separately",
    "procedure": "docs/pr-cards/H-4.md",
    "gates": "MCP-issued OAuth to enrolled account; real test alerts and legitimate permission/plan eligibility; production OFF and independent approval for any production-classified change",
    "dependsOn": [],
    "status": "PASSED",
    "lastEvidence": "2026-10-23 11:00-12:05 MDT on live cbf8275 (Vercel READY), custom service-issued MCP, PRODUCTION/full. On a new public scratch fixture robinson-ai-scratch/rtc-h4-alerts-oct23 (deliberately old lodash/minimist and one unsafe line): Dependabot inventory read complete (GitHub raised no Dependabot alert object in about 25 minutes, recorded as observed); a real code-scanning alert (critical js/code-injection) was listed, read in sanitized detail, dismissed with a reason and reopened through github_security_update_alert, each confirmed by read-back; secret inventory complete and empty; repository security advisories route 200; PR dependency-review compare route returned the real npm advisories (GHSA ids) for both packages. Plan denial for private repos recorded earlier. Fixture deleted afterwards.",
    "nextAction": "Real safe test alerts and exact dismissal/reopen authority are absent. Current public fixture has no Dependabot alerts, no code analysis and disabled secret scanning."
  },
  {
    "id": "GITHUB-H4-SETTINGS",
    "priority": 2,
    "requiredRevision": "4e02b5d339b7da9a3685b333dfc2ea6d29d8003e",
    "task": "After independently checked READY deployment, inspect security and all GitHub Actions settings through the real custom MCP, then run explicitly authorized isolated feature and policy write/readback/denial tests with exact fixture cleanup",
    "procedure": "docs/pr-cards/H-4.md",
    "gates": "Source and legitimate OAuth permission deployed; safe disposable scratch only, full-profile/production confirmation and owner approval where required, zero spend and private paid feature refusal unchanged",
    "dependsOn": [],
    "status": "PASSED",
    "lastEvidence": "2026-10-23 08:30-09:10 MDT on live 66741a46 (Vercel READY dpl_9xRm6z1CJnfoUDxsrmTGzygs3sJB), custom service-issued MCP, PRODUCTION/full, scratch org robinson-ai-scratch on a free 30-day Enterprise trial. Read Actions policy (5 sections) and security features on public rtc-ghaccept-h1-public-oct14; github_actions_set_settings retention 90->30->90 with 'other_policy_sections_preserved' and readback; github_security_set_feature dependabot_security_updates off->on->off with other features preserved. A workflow-permission write was refused by GitHub (HTTP 409, org policy). Found and fixed (PR #306): private-repo Actions read failed on the fork-approval 422.",
    "nextAction": "Exact production-authorized disposable security-settings fixture required; current scanning is disabled. Do not enable paid/private features to manufacture acceptance."
  },
  {
    "id": "GITHUB-O1-OWNER-OVERVIEW",
    "priority": 2,
    "requiredRevision": "41f1655e9b21f0deea8bec5b1303838a55db0b2f",
    "task": "After checked READY release of merged O-1 source, run real custom GitHub MCP organization/personal dashboard guidance, verification of exact org 2FA and bounded owner/security status; distinguish provider 403/plan and validate relevant UI links with actual owner/browser readback",
    "procedure": "docs/pr-cards/O-1.md",
    "gates": "Saved service-issued OAuth and enrolled org only; PREVIEW read-only, production OFF, no spend or destructive change; browser-only completion requires independent owner/browser confirmation",
    "dependsOn": [],
    "status": "PASSED",
    "lastEvidence": "2026-10-23 08:30-09:10 MDT on live 66741a46 (Vercel READY dpl_9xRm6z1CJnfoUDxsrmTGzygs3sJB), custom service-issued MCP, PRODUCTION/full, scratch org robinson-ai-scratch on a free 30-day Enterprise trial. github_admin_overview for robinson-ai-scratch returned plan enterprise, exact org checks (2FA requirement false flagged needs_attention, owners, default permission, members without 2FA 0, outside collaborators 0, apps, token requests, billing usage $0) with unreadable SSO/audit log shown as not_readable and the verified personal identity christcr2012. No changes.",
    "nextAction": "After source-bearing scheduled READY release of reviewed 41f1655e, verify actual enrolled U identity and the original guided UI controls. Native OAuth is currently valid; no repeat consent is justified by the old stub."
  },
  {
    "id": "GITHUB-O2-ORG-ADMIN",
    "priority": 2,
    "requiredRevision": "1c446eb49f3be52d06f2dd2c1d2f892c13cedbce",
    "task": "Verify new O-2 organization/member and invitation reads, owner settings preview/denial and safely authorized exact write/readback using genuine custom GitHub MCP",
    "procedure": "docs/pr-cards/O-2.md",
    "gates": "Only after reviewed O-2 source is in independently verified READY live ancestry; service-issued owner/admin permissions, production OFF until separately authorized, no access grant, invite, destructive action or paid capability without independent owner approval",
    "dependsOn": [],
    "status": "PASSED",
    "lastEvidence": "2026-10-23 09:00-09:12 MDT on live 310ada2 (Vercel READY), custom service-issued MCP, PRODUCTION/full, scratch org on Enterprise trial. github_org_update_settings set robinson-ai-scratch description (null -> text), applied and confirmed by independent read-back. Foreign-owner and unenrolled paths refused in tests; no invite, role or destructive org change made.",
    "nextAction": "Exact disposable organization policy/identity mutation and independent production/access approval; safe org reads report free plan and existing policy, not mutation acceptance."
  },
  {
    "id": "GITHUB-O3-TEAM-ROLES",
    "priority": 2,
    "requiredRevision": "f579f7f2b98bb07de69a78b7b833e72d353a917b",
    "task": "Check O-3 team/role read-only inventory and representative safely owner-approved exact team grants and role assignment readback against deployed custom GitHub MCP",
    "procedure": "docs/pr-cards/O-3.md",
    "gates": "Only after reviewed O-3 source appears in independently verified READY live ancestry with adequate org Members/Administration permissions; no actual access-widening, invitation, team deletion or org role mutation without independent owner confirmation, protected-resource approval and production policy",
    "dependsOn": [],
    "status": "PASSED",
    "lastEvidence": "2026-10-23 09:00-09:12 MDT on live 310ada2 (Vercel READY), custom service-issued MCP, PRODUCTION/full, scratch org on Enterprise trial. Created team rtc-o3-accept-oct23, set the org owner as a member (GitHub reads owners back as maintainer; accepted as correct), deleted the team; each step applied and confirmed, absence confirmed after delete.",
    "nextAction": "Complete nine-role and empty-team read now works. Exact named team/principal and independent grant/role/production confirmation still required."
  },
  {
    "id": "GITHUB-O4-BILLING-CODESPACES",
    "priority": 2,
    "requiredRevision": "a2c5c77e29fdc8a3a1fd8c756c4d72730613f28c",
    "task": "Read actual O-4 billed usage, budgets, Marketplace purchase state, Copilot seats and Codespaces through live custom GitHub MCP; separately verify any exact owner-approved U-credential or budget control",
    "procedure": "docs/pr-cards/O-4.md",
    "gates": "Requires deployed READY ancestry containing merged O-4 and verified real owner permissions; zero autonomous spend persists and paid or destructive actions need independent explicit owner approval. Two risky actions remain guided-only pending finite cost/readback capability.",
    "dependsOn": [],
    "status": "PASSED",
    "lastEvidence": "2026-10-17 live-source original O-4 READ acceptance: independently Vercel-confirmed READY/alias 20389ae0 (dpl_4VjLPk5SYik8BrdasY4JVJ8urNCH), includes required O-4 commit a2c5c77e. Fresh post-plan actual Robinson GitHub Cloud custom MCP full/PREVIEW, enrolled robinson-ai-scratch I+U (verified personal payer actor GitHub user id 227716942), production OFF: organization October 2026 billed usage complete $0/0 items; four explicit enforced $0 organization budgets (Codespaces, Packages, Actions, Git LFS); user-authorized Marketplace purchases complete 0; actual Copilot Business plan seats complete 0; organization and user Codespaces both complete 0. Foreign unenrolled personal billing owner returned client:outside_scope before provider. Separate standard GitHub principal readback matched actual Marketplace payer identity; Vercel source and reviewed O-4 ancestry checked. No writes, cost, alerts, credential changes or cleanup. Personal email/blocked-user scopes, user billing under unselected account, Copilot task or financial write/production tests are NOT claimed. Source authority repairs newer than live separately await deployment.",
    "nextAction": "READ criterion ACCEPTED. Continue separately queued exact, authorized O-4 budget/Codespaces and other paid controls; do not infer paid mutation or all personal account permissions from this read pass."
  },
  {
    "id": "GITHUB-W1-PR-STATUS",
    "priority": 2,
    "requiredRevision": "69017a50e9522dd15bc6b5bd432ad70239a96e20",
    "task": "Use a genuine service-issued custom GitHub MCP read-only principal to inspect a disposable PR's exact head, CI requirements and review/stack information; independently compare with provider state and confirm no writes.",
    "procedure": "docs/pr-cards/W-1.md",
    "gates": "Reviewed and merged W-1 source must be present in checked READY live ancestry; authorized account/scratch PR and working custom connection (reconnect currently required). PREVIEW read-only; no production or money action.",
    "dependsOn": [],
    "status": "PASSED",
    "lastEvidence": "2026-10-17 exact custom MCP PREVIEW/full scratch App I, Vercel independently READY live d49aebd6 (required W-1 69017a50 is ancestor, +136 commits). Custom github_dev_create_test_branch + github_dev_open_test_pr created isolated run completion-public-oct17 on approved public scratch; custom github_dev_set_check_run produced check id 117449425127 without Actions minutes. Actual github_workflow_pr_status PR #1 done=true exact head c51e80b09e5b975fcdfd2478e38c9b10e72bf8b3, base main, draft open, mergeable, ci success, zero unresolved threads, review none, stack none, can_request_merge=false as draft. Separately fetched GitHub REST PR #1, /commits/<exact-sha>/check-runs, /pulls/1/reviews through native GitHub connector: same head/base/draft, exactly one completed success ci check and zero reviews. Read-only result caused no write. Fixture creation/check were independently authorized PREVIEW scratch test writes; no merge, live account edit, paid job, old quarantine cleanup or deletion. Original W1 PR-status read acceptance fulfilled; separate W1 open/merge/provider write acceptance remains pending.",
    "nextAction": "Read proof accepted and preserved. Continue the separate W1-OPEN-PR idempotent execution after reviewed source correction is in checked READY live; draft must never be automatically merged or deleted."
  },
  {
    "id": "GITHUB-W1-OPEN-PR",
    "priority": 2,
    "requiredRevision": "69017a50e9522dd15bc6b5bd432ad70239a96e20",
    "task": "Verify the genuine custom workflow's idempotent open of an existing disposable scratch branch, independent readback, no duplicate PR, and safely approved separate missing-label application; capture notification/outsider denial and cleanup requirements.",
    "procedure": "docs/pr-cards/W-1.md",
    "gates": "W-1 code in checked READY live, restored service-issued authenticated connection and independently owner-authorized disposable scratch branch/PR. No outside notifications or actual mutation without specific owner approval; request keys, profile guard and cleanup permission remain independent.",
    "dependsOn": [
      "GITHUB-W1-PR-STATUS"
    ],
    "status": "PASSED",
    "lastEvidence": "2026-10-18 actual custom PREVIEW/full, independently READY 20389ae0. Workflow reused owned public fixture PR1 at c51e80b09e5b975fcdfd2478e38c9b10e72bf8b3, applied only existing documentation label with confirmation, then repeated as existing/no duplicate. Independent GitHub REST confirmed labels/head. Custom label removal restored only the baseline run label; independent readback matched exact head/base/open state. Reverse-direction proposed PR on those same owned branches: dry-run guarded writer named NOTIFIES octocat; unconfirmed writer returned needs_confirmation and workflow not_applied/needs_confirmation. No outsider intent was confirmed. Foreign-account workflow refused; underlying repo_get explicitly reported outside_scope stopped before GitHub. Independent all-state inventory still exactly one original PR with restored labels/head/base/state. Full original compound criterion fulfilled; detailed evidence in Sponsors correction card and STATUS dated entry. No payment, production activation, new PR or notification.",
    "nextAction": "Accepted: existing PR idempotence, guarded missing-label application, independent readback, exact label restoration, outsider notification preview and unconfirmed refusal, account-scope denial and unchanged all-state PR inventory. Preserve proof; no notification or duplicate PR cleanup is needed."
  },
  {
    "id": "GITHUB-W2-EXACT-MERGE",
    "priority": 2,
    "requiredRevision": "69017a50e9522dd15bc6b5bd432ad70239a96e20",
    "task": "Run the genuine MCP's green-head review/CI/expected-SHA refusal and dry-run checks, then perform a disposable scratch merge and readback only when owner independently authorizes the exact production-classified operation.",
    "procedure": "docs/pr-cards/W-2.md",
    "gates": "Reviewed W-2 commit included in checked READY live and genuine authenticated connection; producer currently production OFF. Explicit owner authorization and all real required checks for any actual production-classified scratch merge. Never bypass threads, CI or protected refs.",
    "dependsOn": [
      "GITHUB-W1-PR-STATUS"
    ],
    "status": "PASSED",
    "lastEvidence": "2026-10-23 08:30-09:10 MDT on live 66741a46 (Vercel READY dpl_9xRm6z1CJnfoUDxsrmTGzygs3sJB), custom service-issued MCP, PRODUCTION/full, scratch org robinson-ai-scratch on a free 30-day Enterprise trial. PR #6 on rtc-accept-ci-oct23: merge with expectedHeadSha 0000... refused (not_ready, 'Expected head does not match the latest actual head'); github_check_get_ci_state green at 2d60f5d6; merge at the exact head returned merged:true with fresh independent PR read; branch then cleaned up.",
    "nextAction": "Safe previews/refusals alone cannot pass; exact disposable merge plus production-enabled principal, fresh green checks and independent owner confirmation required."
  },
  {
    "id": "GITHUB-W2-STACK",
    "priority": 2,
    "requiredRevision": "69017a50e9522dd15bc6b5bd432ad70239a96e20",
    "task": "Test genuine ordered scratch stack read, branch chain refusal, one-at-a-time retarget, complete provider timeline, fresh CI after base_ref_changed, replay, merge stop/readback, with no writes until independently owner approved.",
    "procedure": "docs/pr-cards/W-2.md",
    "gates": "W-2 code in independently checked READY live ancestry, real service-issued connection and owner-authorized disposable multi-PR fixture. Retarget notifications, production-classified merges and cleanup require their own separate approvals; production OFF and $0 spending remain.",
    "dependsOn": [
      "GITHUB-W1-PR-STATUS",
      "GITHUB-W2-EXACT-MERGE"
    ],
    "status": "PASSED",
    "lastEvidence": "2026-10-23 08:50-09:05 MDT on live 66741a46 (Vercel READY), custom service-issued MCP, PRODUCTION/full, scratch org on Enterprise trial. rtc-accept-ci-oct23 stack PR #7 (stk-1 into main) and PR #8 (stk-2 into stk-1): github_workflow_merge_stack dryRun returned preview; confirmed run merged #7 at its exact head (merged_one); next invocation retargeted #8 to main (retargeted); the following call refused (not_ready, 'required CI checks not proven green') until fresh CI ran at the unchanged head; then merged #8 (merged_one); github_workflow_cleanup_branches deleted both branches with absence_confirmed. Both PRs read back closed/merged into main.",
    "nextAction": "Existing isolated three-PR stack available, but exact retarget/notification, one-at-a-time production merge and cleanup authorization remain separate prerequisites."
  },
  {
    "id": "GITHUB-W3-THREADS",
    "priority": 2,
    "task": "Verify actual custom review context, fixed/answered/superseded disposition preview, stale-head/discussion denial, guarded reply/resolve, readback and partial recovery on an approved disposable scratch PR.",
    "requiredRevision": "dd0c9abf5cf443c2749f37fe0b418ef35db21691",
    "procedure": "docs/pr-cards/W-3.md",
    "gates": "Reviewed W-3 source in READY live; restored service OAuth, isolated exact scratch PR/thread, independent owner permission for notifications and cleanup; production OFF and spend zero preserved.",
    "dependsOn": [],
    "status": "PASSED",
    "lastEvidence": "2026-10-17 Vercel READY d49aebd6 contains W-3 dd0c9abf5. Real custom MCP PREVIEW/full scratch App I: run completion-threads-oct17 PR #1 exact head 7a7d87fc4eaafd97fe052d7ecb54b02f0ae4cc44; 3 review threads (2 current, 1 outdated). Workflow inspected file context and denied false fixed claim on unchanged line and stale all-zero expected SHA. Valid answered/answered/superseded replies+resolutions previewed at exact head. Confirmed RPC returned call_outcome_unknown_do_not_replay, NOT retried. Fresh custom github_pr_get confirmed 3 threads/0 unresolved, github_review_list_threads 3/3 resolved, github_review_list_comments six originals/replies (all authored by the scratch App and exact PR). This proves live guarded reply, resolve, stale-head, invalid-disposition, readback and uncertain-result reconciliation. No production merge, paid Actions, outside target, cleanup or deletion. Detailed evidence: docs/pr-cards/W-3.md and docs/pr-cards/V-2.md.",
    "nextAction": "Original W-3 live read/write acceptance is proved; preserve response IDs and exact run ownership. Standalone V-2 cleanup remains separately gated and its current invalid label GET is fixed only in source until checked release."
  },
  {
    "id": "GITHUB-W4-CI-SUMMARY",
    "priority": 2,
    "task": "Compare actual custom failed-job/step/log/annotation evidence with the same workflow default-branch baseline, including absent/log-limited and pending cases.",
    "requiredRevision": "dd0c9abf5cf443c2749f37fe0b418ef35db21691",
    "procedure": "docs/pr-cards/W-4.md",
    "gates": "Reviewed W-4 source in READY live; restored service-issued connection and owned isolated workflow fixture; PREVIEW read-only, no actual retry or spend.",
    "dependsOn": [],
    "status": "PASSED",
    "lastEvidence": "2026-10-23 08:30-09:10 MDT on live 66741a46 (Vercel READY dpl_9xRm6z1CJnfoUDxsrmTGzygs3sJB), custom service-issued MCP, PRODUCTION/full, scratch org robinson-ai-scratch on a free 30-day Enterprise trial. github_workflow_ci_failure_summary on failing run 39898416815 (rtc-accept-ci-oct23) returned the failed job ci, failed step 'no FAIL marker', error lines, annotations (complete), likely_cause marked inference, untrusted:true, and compared with default-branch baseline run 39899877008 (same_failure_on_default:false). Read-only.",
    "nextAction": "An owned failed run, annotations/logs and matching default-branch baseline fixture is missing; current fixture inventory has zero workflow runs."
  },
  {
    "id": "GITHUB-W4-CI-RETRY",
    "priority": 2,
    "task": "Verify a single guarded failed-job retry and durable second-attempt/run-ID denial for the same workflow/head, including pending and production denial.",
    "requiredRevision": "dd0c9abf5cf443c2749f37fe0b418ef35db21691",
    "procedure": "docs/pr-cards/W-4.md",
    "gates": "Reviewed source in READY live; legitimate service OAuth, explicitly approved scratch Actions run, nonproduction workflow or independent production approval, complete failed jobs and exact head; no paid runner or spend authorization inferred.",
    "dependsOn": [],
    "status": "PASSED",
    "lastEvidence": "2026-10-23 08:30-09:10 MDT on live 66741a46 (Vercel READY dpl_9xRm6z1CJnfoUDxsrmTGzygs3sJB), custom service-issued MCP, PRODUCTION/full, scratch org robinson-ai-scratch on a free 30-day Enterprise trial. Guarded rerun of run 39898416815 at head 7e933f5d: first confirmed call applied once (queued); immediate second call returned status pending ('run still active, no rerun occurred'); after the run finished a further call returned retry_already_claimed (durable second-attempt denial, no automatic rerun). Production gate enforced.",
    "nextAction": "An explicitly approved existing failed scratch Actions run on exact head and nonpaid runner is required; current public fixture has zero runs. No new runner/minutes inferred."
  },
  {
    "id": "GITHUB-NATIVE-REVOCATION",
    "priority": 3,
    "task": "Verify disposable native service OAuth grant revocation and subsequent actual custom denial, independently of provider permissions and existing useful grants.",
    "requiredRevision": "5a0ca5d2992bc576c5fdcc88525fb1eb95943fc9",
    "procedure": "docs/audits/RTC-HUB-ADOPTION.md; docs/pr-cards/DEVELOPER-CONNECTION.md",
    "gates": "Source already deployed; requires a separately disposable service-issued OAuth grant, explicit authority to revoke that exact grant, and a functioning native runner. Existing uncertain shared grant must not be revoked as a test.",
    "dependsOn": [],
    "status": "BLOCKED",
    "lastEvidence": "2026-10-15 restored adapter: Reconnected useful service grant works; no separately disposable revocation grant available. Next: Disposable service-issued grant and exact revocation authority. Prepare authorized disposable grant; never revoke useful new connection as a test.",
    "nextAction": "A separately disposable native grant and explicit authority to revoke it; do not revoke the working shared developer OAuth connection."
  },
  {
    "id": "GITHUB-RTC-DIRECT",
    "priority": 3,
    "task": "Run the approved direct CLI HTTPS restricted server/meta read and denial scenario using a short-lived service-owned RTC pass; do not claim full RTC1.",
    "requiredRevision": "5a0ca5d2992bc576c5fdcc88525fb1eb95943fc9",
    "procedure": "docs/audits/RTC-HUB-ADOPTION.md; docs/pr-cards/DEVELOPER-CONNECTION.md",
    "gates": "Source already deployed. Need exact-origin short-lived read_only nonproduction service-issued RTC pass through protected owner setup/saved authorized runner. OAuth adapter token is not an RTC pass; RTC remains 0.",
    "dependsOn": [],
    "status": "BLOCKED",
    "lastEvidence": "2026-10-15 restored adapter: Working adapter OAuth is not an RTC pass; contract remains RTC0 restricted subset. Next: Exact-origin short-lived read-only nonproduction service-owned RTC pass. Use protected owner setup/authorized runner when approved; never substitute OAuth.",
    "nextAction": "Exact-origin short-lived read-only RTC pass through protected setup; current native OAuth is not an RTC pass. Reuse saved authorized pass if available, no token capture."
  },
  {
    "id": "GITHUB-RTC-RELAY",
    "priority": 3,
    "task": "Verify the approved encrypted Hub relay route to this exact service, independently of direct transport and Hub foundation readiness.",
    "requiredRevision": "5a0ca5d2992bc576c5fdcc88525fb1eb95943fc9",
    "procedure": "docs/audits/RTC-HUB-ADOPTION.md; docs/pr-cards/DEVELOPER-CONNECTION.md",
    "gates": "Service read-only subset is live; actual Hub health is foundation ready, federation not_configured, providerCallsEnabled=false, contractVersion=0, accessibleUpstreams=0. Hub namespaces denied RTC tool not granted to caller. Need configured authorized service grant/relay and compatible deployed Hub route.",
    "dependsOn": [],
    "status": "BLOCKED",
    "completionGate": false,
    "lastEvidence": "2026-10-23 owner decision (Chris): the Hub is responsible for discovering and connecting to this product; relay/sandbox routes are Hub-owned and are not tracked here. This server only has to keep following the Hub's published spec (docs/HUB-COMPATIBILITY.md).",
    "nextAction": "Optional Hub must be explicitly configured with upstream RTC pass and connection permission; observed federation not_configured/provider calls disabled. Standalone native MCP stays independent."
  },
  {
    "id": "GITHUB-RTC-SANDBOX",
    "priority": 3,
    "task": "Verify the separately approved genuine Sandbox route to the restricted service, independently of direct CLI and encrypted relay.",
    "requiredRevision": "5a0ca5d2992bc576c5fdcc88525fb1eb95943fc9",
    "procedure": "docs/audits/RTC-HUB-ADOPTION.md; docs/pr-cards/DEVELOPER-CONNECTION.md",
    "gates": "Live subset present; need authorized compatible Sandbox runner/project and short-lived scoped service RTC pass, provider-enforced zero spending, genuine direct route and cleanup/revocation authority. Hub federation currently not configured where route depends on Hub.",
    "dependsOn": [],
    "status": "BLOCKED",
    "completionGate": false,
    "lastEvidence": "2026-10-23 owner decision (Chris): the Hub is responsible for discovering and connecting to this product; relay/sandbox routes are Hub-owned and are not tracked here. This server only has to keep following the Hub's published spec (docs/HUB-COMPATIBILITY.md).",
    "nextAction": "Authorized compatible Sandbox project/runner plus direct scoped RTC pass and zero-spend enforcement/cleanup authority; no new paid Sandbox is provisioned."
  },
  {
    "id": "GITHUB-W5-REPO-HEALTH",
    "priority": 2,
    "status": "PASSED",
    "requiredRevision": "f150500d51be54f2b9026eaabd01e347bcc22256",
    "task": "Read actual isolated repo health, default protection/rules, CI sample, stale PRs, all alert kinds, features and Actions policy; compare independent provider evidence.",
    "procedure": "docs/pr-cards/W-5.md",
    "gates": "Reviewed source in READY live and enrolled disposable repository; read-only PREVIEW, preserve plan/permission gaps.",
    "dependsOn": [],
    "lastEvidence": "2026-10-23 09:00-09:12 MDT on live 310ada2 (Vercel READY), custom service-issued MCP, PRODUCTION/full, scratch org on Enterprise trial. github_workflow_repo_health read the fixture repository: nine evidence reads observed, plan/permission gaps (code scanning refused, secret scanning disabled, classic protection unreadable) reported as unknown/needs_attention, not inferred; no changes made.",
    "nextAction": "Fresh real workflow remains partial: zero CI runs, no code analysis and disabled secret scanning; exact observed state is preserved. Use approved populated/enabled fixture."
  },
  {
    "id": "GITHUB-W5-SECURITY-REVIEW",
    "priority": 2,
    "status": "PASSED",
    "requiredRevision": "f150500d51be54f2b9026eaabd01e347bcc22256",
    "task": "Compare real account-wide security severities, enabled features and open/resolved push-protection bypass inventory, including capped/unreadable sections.",
    "procedure": "docs/pr-cards/W-5.md",
    "gates": "Reviewed source in READY live, scoped service OAuth, legitimate non-sensitive alert fixtures; no feature activation or access widening.",
    "dependsOn": [],
    "lastEvidence": "2026-10-23 08:30-09:10 MDT on live 66741a46 (Vercel READY dpl_9xRm6z1CJnfoUDxsrmTGzygs3sJB), custom service-issued MCP, PRODUCTION/full, scratch org robinson-ai-scratch on a free 30-day Enterprise trial. github_workflow_security_review returned status partial with 16 findings (disabled features per repo) and an honest capped/unreadable section note; github_admin_review_security returned 10 ok / 2 needs_attention / 2 not_readable (SSO, audit log) without calling unreadable settings safe. No changes.",
    "nextAction": "Fresh real review remains partial: Dependabot inventory empty, code analysis absent and secret scanning explicitly disabled. Use legitimately enabled, separately authorized alert fixture."
  },
  {
    "id": "GITHUB-W5-ACCESS-REVIEW",
    "priority": 2,
    "status": "PASSED",
    "requiredRevision": "f150500d51be54f2b9026eaabd01e347bcc22256",
    "task": "Compare real member/outsider/team/app/token and repository collaborator/deploy-key coverage and unusual-access findings without changing access.",
    "procedure": "docs/pr-cards/W-5.md",
    "gates": "Reviewed source in READY live, scoped enrolled org/repository and legitimate provider read permission; no grant/invitation or token policy mutation.",
    "dependsOn": [],
    "lastEvidence": "2026-10-18 safe revalidation after new App grants, actual custom PREVIEW/full on independently READY 20389ae0: github_workflow_access_review exact approved public fixture returns done=true/complete=true/status=needs_attention. Members/outside collaborators, teams, installations, fine-grained tokens/requests, repo collaborators and deploy keys all observed complete: one owner/admin, zero outsiders/teams/tokens/requests/keys, one App installation all repositories. All-repository access warning remains intended review finding. Prior independent direct provider comparisons retained. No access mutation; existing pass revalidated, no new completion credit.",
    "nextAction": "Read-only W-5 access-review criterion accepted with observed needs_attention finding; owner may separately review existing all-repository scratch App selection. Do not convert finding to blanket missing product permission or automatically change it."
  },
  {
    "id": "GITHUB-W6-RELEASE",
    "priority": 2,
    "status": "PASSED",
    "requiredRevision": "f150500d51be54f2b9026eaabd01e347bcc22256",
    "task": "Verify genuine version preview, exact-tag draft creation, generated notes since previous tag and separately authorized draft ID publication/readback with replay/uncertainty refusal.",
    "procedure": "docs/pr-cards/W-6.md",
    "gates": "Reviewed source in READY live, disposable exact release/tag fixture, separately approved production operation/notifications and disposal; production remains OFF and spend zero.",
    "dependsOn": [],
    "lastEvidence": "2026-10-23 08:30-09:10 MDT on live 66741a46 (Vercel READY dpl_9xRm6z1CJnfoUDxsrmTGzygs3sJB), custom service-issued MCP, PRODUCTION/full, scratch org robinson-ai-scratch on a free 30-day Enterprise trial. github_workflow_release v0.0.1-accept: dryRun showed generated notes since the previous merges; confirmed draft created (release 421950813, draft:true); publish with that exact draftId returned status published with independent verification; then release deleted and tag deleted (github_release_delete, github_tag_delete) on the scratch repo.",
    "nextAction": "Exact disposable draft/tag lifecycle plus owner production/publish/cleanup approval; no release or publication is inferred from generic test authorization."
  },
  {
    "id": "GITHUB-W6-CLEANUP",
    "priority": 2,
    "status": "PASSED",
    "requiredRevision": "f150500d51be54f2b9026eaabd01e347bcc22256",
    "task": "Verify genuine complete retained branch/PR inventories, closed-PR exact head exclusions, guarded preview, separately authorized deletion and independent absence/readback.",
    "procedure": "docs/pr-cards/W-6.md",
    "gates": "Reviewed source in READY live, approved disposable run-owned branches/PRs, exact deletion confirmation and unchanged ownership baseline; never original quarantined repository cleanup.",
    "dependsOn": [],
    "lastEvidence": "2026-10-23 08:30-09:10 MDT on live 66741a46 (Vercel READY dpl_9xRm6z1CJnfoUDxsrmTGzygs3sJB), custom service-issued MCP, PRODUCTION/full, scratch org robinson-ai-scratch on a free 30-day Enterprise trial. Created branch ai/accept/w2-merge + PR #6, merged it at the exact head (see W2-EXACT-MERGE), then github_workflow_cleanup_branches: dryRun listed it and excluded main as default/protected; confirmed run deleted the branch and returned absence_confirmed:true.",
    "nextAction": "Exact disposable merged/closed branch target and independent destructive cleanup authority with fresh full inventory required; do not delete uncertain original run resources."
  },
  {
    "id": "GITHUB-W7-NEW-REPO",
    "priority": 2,
    "status": "PASSED",
    "requiredRevision": "59e81e0ae9f27ae01ce31ff74891a4e6579f5274",
    "task": "Exercise genuine standard repository planning and approved creation/configuration, including scoped durable recovery, main/rules/merge policy, free eligible security, Dependabot and Actions/fork defaults, idempotence, independent readbacks and exact disposal.",
    "procedure": "docs/pr-cards/W-7.md",
    "gates": "Reviewed source in READY live, exact disposable repository and independent production/access/notification/cleanup authority; private paid features remain separate and spend $0.",
    "dependsOn": [],
    "lastEvidence": "2026-10-23 09:00-09:12 MDT on live 310ada2 (Vercel READY), custom service-issued MCP, PRODUCTION/full, scratch org on Enterprise trial. github_workflow_new_repo on private robinson-ai-scratch/rtc-newrepo-accept-oct23 stepped through every independent default (ruleset, labels, merge policy, Dependabot alerts, Actions token policy); fork approval correctly treated as not applicable for a private repo (fixed in #307); final status partially_configured with private secret scanning left for owner review, spend $0.",
    "nextAction": "Exact independently approved disposable repository desired state, organization creation/production authority and cleanup scope; no security or paid defaults silently enabled."
  },
  {
    "id": "GITHUB-W7-FIND",
    "priority": 2,
    "status": "PASSED",
    "requiredRevision": "59e81e0ae9f27ae01ce31ff74891a4e6579f5274",
    "task": "Compare genuine scoped mixed repository/PR/issue/commit/run/release searches, continuation and capped/unreadable cases against owned disposable provider fixtures without writes.",
    "procedure": "docs/pr-cards/W-7.md",
    "gates": "Reviewed source in READY live, service-issued scoped read principal and owned fixture contents; no message, write or actual cleanup.",
    "dependsOn": [],
    "lastEvidence": "2026-10-17 live custom GitHub MCP PREVIEW/full scratch I, Vercel READY SHA d49aebd6: github_workflow_find query rtc on enrolled org returned both real scratch repos (one private, one public), six resource types repository/PR/issue/commit/run/release and real bounded complete empty arrays for other types; source sections all observed and done true. Independently compared scoped direct github_search_github query 'rtc org:robinson-ai-scratch' (total_count=2, incomplete_results=false), issue/PR repo-scoped provider search (0), direct actions runs and release list (0). max=1 on real two-result repo inventory produced partial/next_page=2; page 2 completed the second result. Unreadable nonexistent scratch repo fixture produced actual search HTTP 422, run/release HTTP 404, section not_readable and done false/partial rather than false clean. Foreign owner unconnected denied. No fixture creation/write, notification or spend.",
    "nextAction": "Real W-7 scoped find acceptance complete for two existing disposable empty fixtures with verified zero PR/issues/commits/runs/releases and actual pagination/denial/partial handling. Nonempty per-type scenarios remain available for future separate broader provider tests but were not invented or generated here."
  },
  {
    "id": "GITHUB-W7-DIGEST",
    "priority": 2,
    "status": "PASSED",
    "requiredRevision": "fe913a2517a27184c475434273fa6c83c63ca36d",
    "task": "Compare genuine seven-day account/repository activity, invitation and alert inventories plus actual date-bound usage charges, scope and Denver dates with independent provider readback.",
    "procedure": "docs/pr-cards/W-7.md",
    "gates": "Reviewed source in READY live, legitimate account and billing reads, user authorization only where actually needed; costs unknown if unexposed, no paid capacity or seat changes.",
    "dependsOn": [],
    "lastEvidence": "2026-10-23 08:30-09:10 MDT on live 66741a46 (Vercel READY dpl_9xRm6z1CJnfoUDxsrmTGzygs3sJB), custom service-issued MCP, PRODUCTION/full, scratch org robinson-ai-scratch on a free 30-day Enterprise trial. github_workflow_weekly_digest returned 79 sections for the last seven complete UTC billing days with Denver dates (Oct 15 6:00 PM to Oct 22 6:00 PM), actual billing days, invitations, PR/run observations, and explicit not_readable reasons for disabled Dependabot/code/secret alert inventories; kept result readable by handle. No changes.",
    "nextAction": "Nested billing fix is already deployed: all seven daily bills read complete at actual $0. Overall digest remains partial because scanning/alerts are disabled or inaccessible; use legitimately enabled/readable fixtures."
  },
  {
    "id": "GITHUB-U1-REST-READ",
    "priority": 2,
    "requiredRevision": "cf09aab182c7bc6d5e80196adb03f605731201a5",
    "task": "Independently exercise the deployed custom service github_api_search/describe/read for genuine pinned REST operation identity, validated path/query, scoped response and foreign-account denial against GitHub provider readback.",
    "procedure": "docs/pr-cards/U-1.md; docs/designs/BATCH-U.md",
    "gates": "U-1 source present in independently verified serving READY live ancestry; genuine connected service principal with permitted scratch read scope, no production or spend activation, no mutation. Compare provider response to exact scope/method and retained pagination proof.",
    "dependsOn": [],
    "status": "PASSED",
    "lastEvidence": "2026-10-16 genuine connected custom GitHub Cloud MCP acceptance: production Vercel alias github-mcp-chris-projects-de6cd1bf.vercel.app independently resolved READY dpl_FfGNUDzo7vwjExCgD5YYWZZt47Rv, serving live revision a79f08643241d727b38da87b7713728baad39746; required U-1 cf09aab182c7bc6d5e80196adb03f605731201a5 verified as live ancestor (ahead 2/behind 0). Real enrolled OAuth principal PREVIEW/full, I-only robinson-ai-scratch, production OFF, spend $0. github_api_search discovered pinned GitHub REST v2026-03-10 orgs/get, github_api_describe showed GET /orgs/{org} required path only; github_api_read GET 200 returned scoped org login robinson-ai-scratch, numeric org identity 341263172, free plan, 2FA false, default repo read. Independently fetched through specialized github_org_get and confirmed same org identity, plan, 2FA, default permission. Explicit foreign org path under enrolled account refused BEFORE provider call; unknown path/query parameter refused before provider call. No mutation, production activation, spend, secret or cleanup.",
    "nextAction": "ACCEPTED — genuine source-bearing READY custom-service pinned REST search/describe/read/negative-scope validation independently established. Any U-1 uncurated write still requires separate owner authority per GITHUB-U1-REST-WRITE."
  },
  {
    "id": "GITHUB-U1-REST-WRITE",
    "priority": 2,
    "requiredRevision": "cf09aab182c7bc6d5e80196adb03f605731201a5",
    "task": "Independently execute one authorized genuinely non-curated zero-spend scratch REST write through full production/resource/people/replay gates, confirm provider readback/uncertain-case behavior, restore fixture only under separately approved cleanup authority.",
    "procedure": "docs/pr-cards/U-1.md; docs/designs/BATCH-U.md",
    "gates": "Deployed eligible U-1, prerequisite genuine U-1 read, separately approved disposable scratch target and exact write/cleanup authorities, production-enabled full-profile principal only if expressly authorized, account spend $0 and no billed operation. Protected/curated targets never eligible.",
    "dependsOn": [
      "GITHUB-U1-REST-READ"
    ],
    "status": "PASSED",
    "lastEvidence": "2026-10-23 09:00-09:12 MDT on live 310ada2 (Vercel READY), custom service-issued MCP, PRODUCTION/full, scratch org on Enterprise trial. github_api_write created organization runner group rtc-u1-accept-oct23 (201, confirmed from the group list) and deleted it (204, confirmed by absence) on robinson-ai-scratch. No spend.",
    "nextAction": "Exact disposable non-curated operation and independent production/write/cleanup authority; preserve real readback/replay and scoped provider permissions."
  },
  {
    "id": "GITHUB-U2-GRAPHQL-READ",
    "priority": 2,
    "requiredRevision": "9271b64539d45c629de741fa6df63b8da5f8e1d7",
    "task": "Independently exercise the deployed custom service github_graphql_read against pinned schema with genuine scoped provider query, typed variables, fragment/alias and foreign-scope denial and bounded point/node results.",
    "procedure": "docs/pr-cards/U-2.md; docs/designs/BATCH-U.md",
    "gates": "Merged U-2 source in independently verified READY serving deployment, genuine service-issued OAuth and owner-authorized read-only scratch scope. No real mutation, account widening, production or spend activation.",
    "dependsOn": [],
    "status": "PASSED",
    "lastEvidence": "2026-10-18 actual custom service OAuth PREVIEW/full on independently verified Vercel READY 20389ae0. Typed owner/repo/first=3, fragment RepoFields and alias chosen returned exact owned public fixture, node R_kgDOVKA9YA, main and zero issues; independent GitHub REST matches node/scope/visibility. pointsEstimate=2, maximumNodes=24, connections=1, actual cost=1. Foreign owner, first=1001 and nested 100x100x100 rejected, last for >500 points/500000 nodes. Source pin corrected from squashed topic 02df1aab to actual PR #220 merge 9271b645: provider confirms merged=true and final head 02aacb49; entire final-head tree equals squash tree and GitHub compare verifies deployed ancestry (+156 commits). Prior d49 read proof is revalidated, not new bundle credit. No writes.",
    "nextAction": "Read acceptance revalidated on independently confirmed deployed source. Guarded real mutations remain separate; no production activation."
  },
  {
    "id": "GITHUB-U2-GRAPHQL-WRITE",
    "priority": 2,
    "requiredRevision": "9271b64539d45c629de741fa6df63b8da5f8e1d7",
    "task": "Independently exercise genuine approved scoped single non-curated zero-spend GraphQL mutation through full preview, guard, confirmation, durable replay and independent node readback; dispose fixture only under separate owner approval.",
    "procedure": "docs/pr-cards/U-2.md; docs/designs/BATCH-U.md",
    "gates": "Depends on U-2 genuine read and eligible READY source. Requires independently exact disposable node/repo ownership, owner-selected zero-charge mutation, separate production/access/notification approval as applicable, isolated saved principal and cleanup authority. Current PREVIEW production OFF remains untouched.",
    "dependsOn": [
      "GITHUB-U2-GRAPHQL-READ"
    ],
    "status": "PASSED",
    "lastEvidence": "2026-10-23 08:30-09:10 MDT on live 66741a46 (Vercel READY dpl_9xRm6z1CJnfoUDxsrmTGzygs3sJB), custom service-issued MCP, PRODUCTION/full, scratch org robinson-ai-scratch on a free 30-day Enterprise trial. github_graphql_write: updateRepository correctly refused ('specialist github_repo_update_settings must handle it'); addReaction refused (no independently verifiable readback); pinIssue then unpinIssue on a scratch issue applied with independentlyRead:true and observed isPinned true then false. Confirmed, replay-keyed, production gate enforced.",
    "nextAction": "Squash source pin is reconciled and read proof revalidated. Exact disposable mutation and production/write/cleanup authority still absent; no source-release blocker remains."
  },
  {
    "id": "GITHUB-Y9D-HOSTED-READ",
    "priority": 1,
    "requiredRevision": "1fa4298d69041d1bc988e2ee4f693cff954a76b3",
    "task": "On source-bearing READY live, read hosted runner pools, machine sizes and available images for an eligible enrolled scratch organization; record exact identity and no-write evidence.",
    "procedure": "docs/pr-cards/Y-9.md; docs/designs/BATCH-Y.md; docs/END-USER-AUTHORITY.md",
    "gates": "Read-only PREVIEW/full scratch account; independently verified deployed SHA/READY; required hosted-runner read App permissions IN-15 and an eligible org plan. No create, capacity change, static-IP activation or billable request.",
    "dependsOn": [],
    "status": "BLOCKED",
    "lastEvidence": "2026-10-28 actual custom MCP on independently READY 75b4d61b rechecked scratch hosted runners. GitHub returned 404: GitHub hosted runners are not supported for this organization. No paid entitlement, plan or settings changed. Eligible successful inventory remains unverified.",
    "nextAction": "UNVERIFIED, needs a paid plan or upgrade (owner rule 2026-10-24: recorded as untested, not a completion blocker). Provider now explicitly says hosted runners unsupported for this organization (404); existing plan is free. Use already eligible entitlement, without purchasing an upgrade."
  },
  {
    "id": "GITHUB-Y9D-COPILOT-ORG-READ",
    "priority": 1,
    "requiredRevision": "1fa4298d69041d1bc988e2ee4f693cff954a76b3",
    "task": "Read true Copilot organization agent policy, content exclusions, selected repositories and enrolled subscription/seat state, distinguishing disabled from insufficient permission or plan.",
    "procedure": "docs/pr-cards/Y-9.md; docs/designs/BATCH-Y.md; docs/END-USER-AUTHORITY.md",
    "gates": "Source-bearing READY live, current GitHub App organization permission grants IN-15, approved organization only; PREVIEW and no policy change, seat purchase, task start or exposure widening.",
    "dependsOn": [],
    "status": "PASSED",
    "lastEvidence": "2026-10-23 08:30-09:10 MDT on live 66741a46 (Vercel READY dpl_9xRm6z1CJnfoUDxsrmTGzygs3sJB), custom service-issued MCP, PRODUCTION/full, scratch org robinson-ai-scratch on a free 30-day Enterprise trial. github_copilot_agent_policy_get returned enabled_repositories all; github_copilot_get_billing returned plan business, 0 seats, seat management unconfigured, price verified; github_copilot_content_exclusions_get returned HTTP 404 which is reported as unavailable (no Copilot subscription), not as 'no exclusions'. No changes.",
    "nextAction": "Content-exclusion endpoint remains provider 404 despite newly accepted grants; policy all and selected-list not applicable succeeded. Verify actual feature/endpoint eligibility with GitHub."
  },
  {
    "id": "GITHUB-Y9D-SPONSORS-U-READ",
    "priority": 1,
    "requiredRevision": "098fdb8d43ed5fd7591aeecb2a86559d98bb0397",
    "task": "Prove real user payer identity, sponsorship relationship and advertised tier prices for an explicitly approved non-sensitive recipient without starting or canceling a payment.",
    "procedure": "docs/pr-cards/Y-9.md; docs/designs/BATCH-Y.md; docs/END-USER-AUTHORITY.md",
    "gates": "Reviewed source in READY live, actual GitHub U token granted by the owner to exact paying account, known approved recipient and complete sponsor tier inventory. No paid mutation or token capture.",
    "dependsOn": [],
    "status": "PASSED",
    "lastEvidence": "2026-10-24 04:25 MDT on live 8ed877a (contains 098fdb8), custom service-issued MCP, PRODUCTION/full. github_sponsor_get recipient christcr2012 as payer christcr2012 -> payer/recipient identity matches, active=null, sponsors_listing_available=false, tiers=[] (valid empty relationship, no NOT_FOUND). No payment or preference change. Cleanup: none needed.",
    "nextAction": "After the scheduled release includes 098fdb8d43ed5fd7591aeecb2a86559d98bb0397, rerun curated read for the same owned non-sensitive actor. Capture exact payer/recipient type, complete relationship and listing availability; a published tier fixture is separately needed to prove nonempty prices. Do not repeat valid OAuth or move money."
  },
  {
    "id": "GITHUB-Y9D-COPILOT-TASKS-U-READ",
    "priority": 1,
    "requiredRevision": "1fa4298d69041d1bc988e2ee4f693cff954a76b3",
    "task": "Read existing Copilot cloud-agent task records with verified GitHub U principal and repository scope; record real ownership and permission/plan limits.",
    "procedure": "docs/pr-cards/Y-9.md; docs/designs/BATCH-Y.md; docs/END-USER-AUTHORITY.md",
    "gates": "Source in deployed READY ancestry; actual separately consented U identity, exact authorized owned repository and appropriate Copilot plan/permission. No task start, premium usage or PR creation.",
    "dependsOn": [],
    "status": "PASSED",
    "lastEvidence": "2026-10-18 independently verified Vercel READY 20389ae0; actual custom MCP PREVIEW/full, scratch App I plus owner-consented U christcr2012. github_copilot_agent_tasks on approved public scratch repository returned tasks=[], complete=true. Separate universal github_api_read with explicit U called pinned GET /agents/repos/{owner}/{repo}/tasks: provider status=200, data.tasks=[], exact same repository scope. Independent GitHub REST verifies owned public repository identity. Foreign unconnected owner denied before provider. This proves empty existing inventory under U, not nonempty task detail, task creation, premium usage or policy writes.",
    "nextAction": "Original existing-task inventory read is accepted. Nonempty task-detail coverage can only be exercised if a legitimate existing task becomes available; no premium task should be started for this test."
  },
  {
    "id": "GITHUB-Y9D-SAFETY-DENIAL",
    "priority": 1,
    "requiredRevision": "1fa4298d69041d1bc988e2ee4f693cff954a76b3",
    "task": "Verify honest unknown-cost disclosure and explicit restricted-pass/read-only denials without a paid mutation. Full owner production-off and server cap flags are not authority refusals.",
    "procedure": "docs/pr-cards/Y-9.md; docs/designs/BATCH-Y.md; docs/END-USER-AUTHORITY.md",
    "gates": "Separately authorized read-only/narrow capped pass and legitimately eligible provider fixture; no paid mutation authorized.",
    "dependsOn": [
      "GITHUB-Y9D-HOSTED-READ"
    ],
    "status": "BLOCKED",
    "lastEvidence": "2026-10-26 evening MDT, custom service-issued GitHub MCP, PRODUCTION/full, live 12d108dc507a2ebf093fa5bbb94d812ea2d72993 and Vercel READY at github.robinsonaisystems.com. The required authentic narrow, user-capped and production-off connections are not in this saved full/PRODUCTION grant. The dependent hosted runner check remains provider/plan-limited (GITHUB-Y9D-HOSTED-READ BLOCKED). Prior source tests do not substitute for the required live denial matrix. No paid or production mutation was attempted.",
    "nextAction": "Issue a disposable deliberately restricted pass through protected setup, then run preview/denial only. Do not configure a cap on the full owner connection to recreate retired policy."
  },
  {
    "id": "GITHUB-Y9D-OWNER-AUTH-WRITES",
    "priority": 2,
    "requiredRevision": "1fa4298d69041d1bc988e2ee4f693cff954a76b3",
    "task": "Independently accept only owner-approved real-provider Y-9d mutation(s) with exact cost/security disclosure, single-send, replay, readback and cleanup where reversible; no blanket requirement to incur expense.",
    "procedure": "docs/pr-cards/Y-9.md; docs/designs/BATCH-Y.md; docs/END-USER-AUTHORITY.md",
    "gates": "Exact disposable operation/target/cost approval, current actual provider permission/entitlement, independently READY source and reversible cleanup where available. No product production-enabled/protected-list/second-owner-confirmation prerequisite. Builder no-spend and no real security-policy mutation without exact authorization remain binding.",
    "dependsOn": [
      "GITHUB-Y9D-HOSTED-READ",
      "GITHUB-Y9D-COPILOT-ORG-READ",
      "GITHUB-Y9D-SPONSORS-U-READ",
      "GITHUB-Y9D-COPILOT-TASKS-U-READ"
    ],
    "status": "BLOCKED",
    "lastEvidence": "2026-10-16: PR #233 source head 395a54e passed CI/contract fakes and merged. Live release, new App permission grants and genuine provider acceptance not yet proven.",
    "nextAction": "Exact paid runner/Copilot/Sponsors operation, target, chosen financial exposure and production authorization; actual personal U exists but does not authorize developer spending."
  },
  {
    "id": "GITHUB-O4-AUTH-PREVIEW",
    "priority": 1,
    "requiredRevision": "efe8e928991f0da72cf4e1db7d2d56f44fee0084",
    "task": "On independently verified READY source, use custom GitHub MCP PREVIEW/full with enrolled organization to prove exact budget/organization identity, Codespaces user membership, read-only limits and denied attempts to write without PRODUCTION; record zero provider mutations.",
    "procedure": "docs/pr-cards/O-4.md; docs/END-USER-AUTHORITY.md",
    "gates": "PREVIEW/full, enrolled scratch org and source-bearing READY alias, read-only accessible budget/security fixtures; no actual budget deletion, access change, paid action or production enablement.",
    "dependsOn": [],
    "status": "PASSED",
    "lastEvidence": "2026-10-17: Verified current main/live d49aebd6 and Vercel production READY dpl_BWfVi8NaNDpej18hcGW5qQKLwqGP at exact SHA. Real Robinson GitHub Cloud custom OAuth whoami PREVIEW/full connected robinson-ai-scratch I (U absent), production OFF and no explicit product spend cap; org identity free plus one member; existing four provider budgets ($0 each) complete, Codespaces inventory complete and empty. Real guarded github_billing_delete_budget(dryRun:true, existing exact budget ID twice) refused_by_guard mode PREVIEW; github_codespace_set_org_access(disabled,dryRun:true) likewise refused by mode. No provider mutations, purchases, access edits or fixture deletion.",
    "nextAction": "Accepted read/denial-only O-4 correction criterion. Separate real provider deletion and Codespaces policy mutation remain BLOCKED under GITHUB-O4-AUTH-BUDGET-WRITE and GITHUB-O4-AUTH-CODESPACES-WRITE."
  },
  {
    "id": "GITHUB-O4-AUTH-BUDGET-WRITE",
    "priority": 2,
    "requiredRevision": "efe8e928991f0da72cf4e1db7d2d56f44fee0084",
    "task": "Accept authorized disposable budget DELETE with exact target, unknown-future-charge disclosure, one-send/replay, absence readback and preservation of other budgets. Full owners need no repeated ID; restricted grants retain checks.",
    "procedure": "docs/pr-cards/O-4.md; docs/END-USER-AUTHORITY.md",
    "gates": "Historical disposable-budget destruction scenario. OWNER-CHECKLIST records the 2026-10-23 decision that provider not-found behavior was sufficient and no further budget testing was requested. Resume only if owner explicitly reopens an exact disposable budget test; never delete a real spending ceiling.",
    "dependsOn": [
      "GITHUB-O4-AUTH-PREVIEW"
    ],
    "status": "BLOCKED",
    "lastEvidence": "2026-10-28: source owner-confirmation correction is released READY 53df99ef, with exact-head source contract tests. No budget was deleted as a test. Owner 2026-10-23 no-further-budget-testing decision retained (OWNER-CHECKLIST); historical provider write acceptance is not relabeled passed or made a new owner task.",
    "nextAction": "After the cleanup is released, use an expressly disposable budget and approved deletion/cleanup scope; no real spending-protection deletion is inferred from code approval."
  },
  {
    "id": "GITHUB-O4-AUTH-CODESPACES-WRITE",
    "priority": 2,
    "requiredRevision": "efe8e928991f0da72cf4e1db7d2d56f44fee0084",
    "task": "Accept an exact approved selected-member policy replacement with active membership, one-send/replay and honest UNCONFIRMED 204 until independent UI readback. Full owner repeat acknowledgement is optional; restricted-grant requirements remain.",
    "procedure": "docs/pr-cards/O-4.md; docs/END-USER-AUTHORITY.md",
    "gates": "Reviewed owner-confirmation cleanup deployed READY, exact approved disposable organization/user policy and independent UI readback; no billable access widening inferred.",
    "dependsOn": [
      "GITHUB-O4-AUTH-PREVIEW"
    ],
    "status": "BLOCKED",
    "lastEvidence": "2026-10-17: Source engineering exact-head required ci, 2 unit shards, DB, RTC, shapes, check, release-policy verified green and merged. Production GitHub MCP READY still runs a79f0864; no actual provider write, spend, approval, production enablement or real-feature live acceptance occurred.",
    "nextAction": "Use only the expressly approved policy replacement and independent saved-policy inspection. Do not enable real users to satisfy an acceptance checkbox."
  },
  {
    "id": "GITHUB-Y7-AUTH-PREVIEW",
    "priority": 1,
    "requiredRevision": "c552ab893f63675fbc841818ccc702b4885ff693",
    "task": "On READY source verify legitimate private-security inventory and explicit dry-run/no-send behavior, restricted-grant denial, organization attachments and 100-entry completeness. Full-owner PREVIEW labels are not automatic write denials.",
    "procedure": "docs/pr-cards/Y-7.md; docs/pr-cards/H-4.md; docs/END-USER-AUTHORITY.md",
    "gates": "Read-only eligible scratch repository, existing authenticated GitHub entitlement, original private visibility, no purchased plan, no active paid feature toggle or deployment outside scheduled release.",
    "dependsOn": [],
    "status": "BLOCKED",
    "lastEvidence": "Earlier (2026-10-18): free-plan private security reads refused by GitHub with the plan reason; no purchase suggested. 2026-10-24 04:45 MDT on live 8ed877a, PRODUCTION/full, scratch org on the Enterprise trial, private fixture rtc-acc1-20261024-2: github_security_get_settings returned the full private security inventory (all disabled); github_security_list_alerts kind=code refused truthfully (HTTP 403 'Code Security must be enabled', names security events read), kind=dependabot without a repo refused locally. Fixture deleted. Not exercised: organization security attachments and the 100-entry case (needs paid-flagged organization configurations).",
    "nextAction": "Use already eligible private-security and 100-entry inventory fixtures, plus an explicit restricted grant. Provider feature/plan refusals remain genuine; do not buy eligibility."
  },
  {
    "id": "GITHUB-Y7-AUTH-PRIVATE-PAID-WRITE",
    "priority": 2,
    "requiredRevision": "0539a4d4ec3feaf24457f70d0df818647ced6bba",
    "task": "With independent exact owner consent, accept one disposable private paid security feature/configuration mutation including user-selected cap denial, explicit uncapped charge disclosure, single provider send, state readback and reversible cleanup.",
    "procedure": "docs/pr-cards/Y-7.md; docs/pr-cards/H-4.md; docs/END-USER-AUTHORITY.md",
    "gates": "Actual private feature entitlement, exact disposable target and explicit cost/feature approval, provider permissions and reversible cleanup. A chosen capped pass is required for capped-delegate denial. Full owners need no additional server production/protected/spend toggle. Builder no paid mutations without exact authorization remains binding.",
    "dependsOn": [
      "GITHUB-Y7-AUTH-PREVIEW"
    ],
    "status": "BLOCKED",
    "lastEvidence": "2026-10-17: Source engineering exact-head required ci, 2 unit shards, DB, RTC, shapes, check, release-policy verified green and merged. Production GitHub MCP READY still runs a79f0864; no actual provider write, spend, approval, production enablement or real-feature live acceptance occurred.",
    "nextAction": "Legitimate private paid-security entitlement and exact uncapped-cost/production/fixture authorization required; do not buy entitlement or alter original private visibility."
  },
  {
    "id": "GITHUB-U1-AUTH-PREVIEW",
    "priority": 1,
    "requiredRevision": "b9f22b8d00fd1b500a014221d04595a92d2c87ff",
    "task": "On independently verified READY source use custom API search/describe and PREVIEW write to distinguish 54 reviewed free operations from unknown-cost non-curated writes, confirm scope, schema, curated-first routing, owner-selected cap and zero actual provider mutation.",
    "procedure": "docs/pr-cards/Y-1.md; docs/pr-cards/U-1.md; docs/END-USER-AUTHORITY.md",
    "gates": "Read-only source-bearing custom MCP, enrolled scratch account, no actual payment, credential bypass, production activation or non-disposable target mutation.",
    "dependsOn": [],
    "status": "PASSED",
    "lastEvidence": "2026-10-18 actual custom PREVIEW/full on independently READY 20389ae0; Git ancestry proves b9f22b8 already deployed. API search/describe distinguishes reviewed-free noncurated runner-group DELETE (spendRisk=false) from noncurated interaction-limit PUT (spendRisk=true, unknown) and correctly routes budget DELETE to github_billing_delete_budget and hosted-runner DELETE to github_hosted_runner_manage. Curated budget attempt refuses specialized bypass. Valid free DELETE and unknown-cost PUT dry runs both refuse_by_guard mode PREVIEW before provider mutation. Foreign-owner path and noninteger runner-group ID rejected before dispatch. Actual whoami/admin overview agree production OFF, optional user cap not configured; no historical $0 is presented as a customer cap. No budget/policy changes or spending. This accepts safe auth-preview behavior, not paid execution or finite-cap mutation proof.",
    "nextAction": "Safe original auth-preview criterion accepted. Real metered operations, configured finite-cap execution and owner-authorized writes remain separate original acceptance tasks."
  },
  {
    "id": "GITHUB-U1-AUTH-METERED-WRITE",
    "priority": 2,
    "requiredRevision": "ee44da0e7b73f26dca247e0e17c3738796a9d3ec",
    "task": "Accept a genuine otherwise-eligible non-curated provider write with potentially unknown future cost, independent owner delegation, explicit billing warning, chosen spending cap/pass enforcement, no bypass of curated/secret endpoints, one-send journal and readback or honest UNCONFIRMED result.",
    "procedure": "docs/pr-cards/Y-1.md; docs/pr-cards/U-1.md; docs/END-USER-AUTHORITY.md",
    "gates": "Exact disposable operation/path/body and actual provider principal/entitlement. Existing read/write/revert proof retained; a separately issued explicit narrow or capped service pass is still required for its denial scenario. No implicit expense, customer-data mutation, production-toggle or protected-list clearance requirement on a full owner.",
    "dependsOn": [
      "GITHUB-U1-AUTH-PREVIEW"
    ],
    "status": "BLOCKED",
    "lastEvidence": "2026-10-23 on live 1ddf6ac, PRODUCTION/full: PUT /orgs/{org}/interaction-limits on robinson-ai-scratch previewed with the explicit COST UNKNOWN billing warning, confirmed and applied (GitHub 200); read-back honestly reported UNCONFIRMED (GitHub shows expires_at, not the expiry sent); DELETE reverted it (GitHub 204; its empty read-back was then accepted as confirmation by the fix in #317). Not yet shown: a chosen user spending cap or narrow pass actually enforced, which needs the owner to set a cap. Stays BLOCKED on that.",
    "nextAction": "Prior scratch write/revert evidence is retained. Remaining criterion requires a separate deliberately capped/narrow pass fixture, not reintroducing a server spending veto on the full owner. No paid operation authorized."
  },
  {
    "id": "GITHUB-G6-PACKAGE-AUTH",
    "priority": 1,
    "requiredRevision": "4fed65b97dd7f02c97b47edbecb7241b0cef489d",
    "task": "Verify dedicated supported package credential enrollment, exact-account read and guarded delete/restore with independent package readback, denial/replay and cleanup on an explicitly disposable fixture.",
    "procedure": "docs/pr-cards/PACKAGE-CREDENTIAL-CORRECTION.md; docs/pr-cards/G-6.md",
    "gates": "Reviewed source in independently verified READY deployed ancestry; owner enrolls genuine supported classic package token through protected setup, required scopes and package-level access; exact disposable package and separately authorized production write/cleanup. No token in chat, paid publication or real artifact destruction inferred.",
    "dependsOn": [],
    "status": "PASSED",
    "lastEvidence": "2026-10-23 11:10-11:25 MDT on live 1ddf6ac (Vercel READY), custom service-issued MCP, PRODUCTION/full. Chris enrolled a classic package token (write:packages + delete:packages) for christcr2012 on the protected setup page. github_package_list (user scope) read it. A throwaway npm package @christcr2012/rtc-tiny-package was published by a GitHub Actions workflow on christcr2012/rtc-h3-accept-oct23 branch pkg-test using the built-in workflow token (no personal token used, agents never held the package token) and appeared in the list with its one version. github_package_delete: first confirmed attempt hit a GitHub HTTP 500 and was reported 'uncertain' (state checked: package still present, nothing retried blindly); second confirmed attempt applied (deleted_version_count 1). github_package_restore_version restored the package (package_id 16200832) with readback; deleted again at cleanup; branch pkg-test deleted. Org-scope read for Robinson-AI-Systems needs the token on that account row and was refused cleanly (client:no_credentials).",
    "nextAction": "Release reviewed supported P source 4fed65b9, protected owner token enrollment and actual package access; exact disposable package production lifecycle needs independent write/disposal authority. No extra App permission solves it."
  },
  {
    "id": "GITHUB-B5-PERMISSION-GUIDANCE",
    "priority": 1,
    "requiredRevision": "e054d200471e04e6000692bf103506a55881a87a",
    "task": "On actual source-bearing custom MCP verify unsupported credential requests give truthful access guidance without recommending boolean/schema-only App grants, and compare genuine named permission requirements without asserting unfinished owner consent.",
    "procedure": "docs/pr-cards/PERMISSION-HEADER-TRUTH.md; docs/pr-cards/G-6.md",
    "gates": "Independently verified READY implementation source and genuine existing service OAuth; safe read/refusal only. Never remove legitimate permissions, fabricate provider evidence, activate production or spend to manufacture a denial. Distinguish an earlier curated argument refusal from execution of the provider-header translator.",
    "dependsOn": [],
    "status": "PASSED",
    "lastEvidence": "2026-10-18 post-plan genuine custom PREVIEW/full on independent READY Vercel live f1397503 (dpl_C3uAZsQN2NbZAVWzREFbH2V4chxH), enrolled robinson-ai-scratch I/U, production OFF. Actual scratch private Dependabot GET refused HTTP403 because alerts disabled, with accepted named vulnerability alerts(read); code scanning GET 403 because Advanced Security not enabled, with named security events(read). Both B-5 explanations say endpoint entries are NOT proof of missing grants; advise conditional comparison, not blanket consent. Independent github_check_permissions(security) returned missing=[]/permissions_ok=true, confirming refusal is provider feature/plan not unapproved App grant. Explicit GET /user/packages using P failed local client:no_credentials (separate missing P setup, no imaginary boolean/schema-only grant). Foreign repository owner refused client:outside_scope before GitHub. No raw headers fabricated, existing synthetic boolean parser tests are distinct. Zero writes, grants, spend, OAuth resets or fixture changes.",
    "nextAction": "ACCEPTED — genuine source-bearing provider permission-header formatter and credential/scope failure guidance validated after B-5 release, independently compared with real existing grants. Package delete/restore acceptance remains separately queued as GITHUB-G6-PACKAGE-AUTH; no further App grant is inferred."
  },
  {
    "id": "GITHUB-PRIVATE-USER-PASS-SCOPE",
    "priority": 1,
    "requiredRevision": "3df082605de3a91f3e32affd385e88ba90df95d2",
    "status": "BLOCKED",
    "task": "Historical private-pilot pass scope scenario was retired by public per-person OAuth. Verify equivalent explicit account/repository/permission restriction on the supported current grant path; do not recreate retired pilot mode.",
    "procedure": "docs/pr-cards/PUB-2.md — 2026-10-21 restricted private-user passes correction; tests/unit/private-user-pass-downscope.test.js for source cases.",
    "gates": "A disposable currently supported narrowed grant with exact account/repository scope; no reset or widening of existing grants.",
    "dependsOn": [],
    "lastEvidence": "Superseded 2026-10-24: the private-pilot sign-in was retired on 2026-10-23 (PUB-6 rebuild); public tenants are covered by tests/db/pub-6-public-connect.test.js and tests/unit/private-user-pass-downscope.test.js. No live run needed.",
    "nextAction": "Use a supported disposable narrowed OAuth/RTC grant for equivalent denial and ordinary own-account read. Historical private-pilot retirement is not a fabricated live pass."
  },
  {
    "id": "GITHUB-GOD2-PERSONAL-M",
    "priority": 1,
    "requiredRevision": "b555df19ff79dac90f720ff92d2c4ec8b05f92ec",
    "task": "Gist create/read-back/delete with the master token (secret gist on christcr2012).",
    "procedure": "docs/pr-cards/ACC-1.md",
    "gates": "Saved developer connection; scratch organization or disposable fixture only; no spend.",
    "dependsOn": [],
    "status": "PASSED",
    "lastEvidence": "2026-10-24 04:40-04:50 MDT on live b555df1 (Vercel READY), custom service-issued MCP, PRODUCTION/full. github_gist_save created secret gist 33d6defc... (verified, 1 file); github_gist_delete removed it (deleted=true). Cleanup: none left."
  },
  {
    "id": "GITHUB-GOD3-UNLOCKS",
    "priority": 1,
    "requiredRevision": "b555df19ff79dac90f720ff92d2c4ec8b05f92ec",
    "task": "github_whoami lists which areas the master token unlocks.",
    "procedure": "docs/pr-cards/ACC-1.md",
    "gates": "Saved developer connection; scratch organization or disposable fixture only; no spend.",
    "dependsOn": [],
    "status": "PASSED",
    "lastEvidence": "2026-10-24 04:40-04:50 MDT on live b555df1 (Vercel READY), custom service-issued MCP, PRODUCTION/full. github_whoami returned master_token.unlocks with 14 areas (Gists, Notifications, Packages, SSH keys, GPG, Profile, Stars, Classroom/Marketplace, Copilot Spaces, Codespaces, Account export, Org admin extras, Projects, Enterprise ENT-1), all unlocked:true."
  },
  {
    "id": "GITHUB-ENT1-READS",
    "priority": 1,
    "requiredRevision": "b555df19ff79dac90f720ff92d2c4ec8b05f92ec",
    "task": "Enterprise reads on the trial enterprise robinson-ai-systems.",
    "procedure": "docs/pr-cards/ACC-1.md",
    "gates": "Saved developer connection; scratch organization or disposable fixture only; no spend.",
    "dependsOn": [],
    "status": "PASSED",
    "lastEvidence": "2026-10-24 04:40-04:50 MDT on live b555df1 (Vercel READY), custom service-issued MCP, PRODUCTION/full. github_enterprise_list (1 enterprise), github_enterprise_overview (admin yes, 1 org), github_enterprise_security_configs (1 GitHub recommended config + defaults), github_enterprise_dependabot (alerts empty) all returned. github_enterprise_actions_settings returned HTTP 402 'valid payment method required': UNVERIFIED, needs a payment method or paid plan (owner rule 2026-10-24, not a blocker)."
  },
  {
    "id": "GITHUB-ENT1-CONFIG-LIFECYCLE",
    "priority": 1,
    "requiredRevision": "b555df19ff79dac90f720ff92d2c4ec8b05f92ec",
    "task": "Enterprise code-security configuration create and delete, free settings only.",
    "procedure": "docs/pr-cards/ACC-1.md",
    "gates": "Saved developer connection; scratch organization or disposable fixture only; no spend.",
    "dependsOn": [],
    "status": "PASSED",
    "lastEvidence": "2026-10-24 04:40-04:50 MDT on live b555df1 (Vercel READY), custom service-issued MCP, PRODUCTION/full. github_enterprise_security_config_save dry run, then create 'acc1-throwaway' (id 286906, dependency graph on, unenforced, paid=false); github_enterprise_security_config_delete removed it (deleted=286906). Attached to nothing. Cleanup: none left. Other ENT write tools (policy_set, profile_set, actions_settings_set, dependabot_access_set, config_apply) not run."
  },
  {
    "id": "GITHUB-GOD4-CODESPACES-SECRETS",
    "priority": 1,
    "requiredRevision": "b555df19ff79dac90f720ff92d2c4ec8b05f92ec",
    "task": "Personal Codespaces secret created with a generated value, listed, deleted.",
    "procedure": "docs/pr-cards/ACC-1.md",
    "gates": "Saved developer connection; scratch organization or disposable fixture only; no spend.",
    "dependsOn": [],
    "status": "PASSED",
    "lastEvidence": "2026-10-24 04:40-04:50 MDT on live b555df1 (Vercel READY), custom service-issued MCP, PRODUCTION/full. github_secret_set level user kind codespaces ACC1_THROWAWAY valueFrom generate (value hidden); github_secret_list showed it (value never shown); github_secret_delete removed it."
  },
  {
    "id": "GITHUB-GOD4-EXPORT",
    "priority": 1,
    "requiredRevision": "b555df19ff79dac90f720ff92d2c4ec8b05f92ec",
    "task": "Account export of one disposable repository, status, private link, archive delete.",
    "procedure": "docs/pr-cards/ACC-1.md",
    "gates": "Saved developer connection; scratch organization or disposable fixture only; no spend.",
    "dependsOn": [],
    "status": "PASSED",
    "lastEvidence": "2026-10-26 evening MDT, custom service-issued GitHub MCP, PRODUCTION/full, live 12d108dc507a2ebf093fa5bbb94d812ea2d72993 and Vercel READY at github.robinsonaisystems.com. Account export status for disposable archived migration 14960475 still shows a historical 'exported' record; github_account_export_delete(dryRun=true) independently reported 'archive ... already gone' (no mutation). github_account_export_link(14960475) returned HTTP 404. This confirms prior cleanup's absence, not a new delete or leaked download URL. Original archive creation, link and fixture disposal were verified 2026-10-24.",
    "nextAction": "No action needed; export record may persist after the archive is gone. Only retest if a new run creates a different disposable export."
  },
  {
    "id": "GITHUB-GOD4-SPACES",
    "priority": 1,
    "requiredRevision": "b555df19ff79dac90f720ff92d2c4ec8b05f92ec",
    "task": "Copilot Space create, list, delete.",
    "procedure": "docs/pr-cards/ACC-1.md",
    "gates": "Saved developer connection; scratch organization or disposable fixture only; no spend.",
    "dependsOn": [],
    "status": "PASSED",
    "lastEvidence": "2026-10-24 04:40-04:50 MDT on live b555df1 (Vercel READY), custom service-issued MCP, PRODUCTION/full. github_copilot_space_save created Space #1 'acc1-throwaway' (base_role no_access); github_copilot_space_list read it back; github_copilot_space_delete removed it (deleted=1)."
  },
  {
    "id": "GITHUB-GOD5-PLACE",
    "priority": 1,
    "requiredRevision": "b555df19ff79dac90f720ff92d2c4ec8b05f92ec",
    "task": "Add a read-only extra place with the master token, read OK, write refused, remove.",
    "procedure": "docs/pr-cards/ACC-1.md",
    "gates": "Saved developer connection; scratch organization or disposable fixture only; no spend.",
    "dependsOn": [],
    "status": "PASSED",
    "lastEvidence": "2026-10-24 06:30-06:48 MDT on live cb0ced6 (Vercel READY), custom service-issued MCP, PRODUCTION/full. Chris added Robinson-AI-Systems (no App) as an extra place on My connection (robinson-ai-scratch was correctly refused: App already installed). whoami showed allow_changes=false, whole account. Read OK: github_repo_list returned 15 repositories. Write refused: github_repo_create -> refused_by_guard 'extra place' (nothing created). After Chris allowed changes: create then delete of empty repo rtc-acc1-20261024-6 applied. After Chris pressed Remove: whoami no longer lists it and a read is refused (client:outside_scope). Full lifecycle done."
  },
  {
    "id": "GITHUB-GQL1-GROUPS",
    "priority": 1,
    "requiredRevision": "b555df19ff79dac90f720ff92d2c4ec8b05f92ec",
    "task": "One representative GraphQL mutation per group on a scratch fixture.",
    "procedure": "docs/pr-cards/ACC-1.md",
    "gates": "Saved developer connection; scratch organization or disposable fixture only; no spend.",
    "dependsOn": [],
    "status": "PASSED",
    "lastEvidence": "2026-10-24 04:55 MDT on live b555df1 (Vercel READY), PRODUCTION/full, fixture robinson-ai-scratch/rtc-acc1-20261024-5 (auto-init, 1 issue). github_graphql_write pinIssue (specced, repo scope): dry run, confirm, independent read isPinned=true; unpinIssue inverse isPinned=false. createRef and addReaction were refused by the universal door ('no independently verifiable readback ... use the specialized guarded tool') because curated tools own them: correct by design. Fixture deleted. Only one representative specced mutation was run; the other groups are covered by source and shape tests."
  },
  {
    "id": "GITHUB-HARD1-SIGNIN-NO-CAP",
    "priority": 1,
    "requiredRevision": "b555df19ff79dac90f720ff92d2c4ec8b05f92ec",
    "task": "Sign-in still works after the per-app cap change.",
    "procedure": "docs/pr-cards/ACC-1.md",
    "gates": "Saved developer connection; scratch organization or disposable fixture only; no spend.",
    "dependsOn": [],
    "status": "BLOCKED",
    "lastEvidence": "2026-10-26 evening MDT, custom service-issued GitHub MCP, PRODUCTION/full, live 12d108dc507a2ebf093fa5bbb94d812ea2d72993 and Vercel READY at github.robinsonaisystems.com. Saved MCP grant and browser CI prove continued connected access and synthetic sign-in coverage, not a genuinely new OAuth sign-in after the cap change. No disposable new app/client consent was performed.",
    "nextAction": "Prerequisite: a separately authorized new first-time live app sign-in through the Approve page (owner/browser step), or an existing independent consent run with documented timestamp and exact deployment; inspect result without revoking the working connector."
  },
  {
    "id": "GITHUB-GOD6-ACT-AS",
    "priority": 1,
    "requiredRevision": "08fbc15d1433ec0abce15fe7ce5eefd5a783790a",
    "task": "Act as me: with the master token on and the switch on, a write on a disposable scratch repo is sent as the person and the result says acting_as 'you'; an app-only call (check runs) stays on the app; switch off returns to the app; a read-only connection never uses the person's token.",
    "procedure": "docs/pr-cards/ACC-1.md",
    "gates": "Saved developer connection; scratch organization or disposable fixture named rtc-acc1-<date>-<n> only; never overrideRules on a real repository; no spend.",
    "dependsOn": [],
    "status": "BLOCKED",
    "lastEvidence": "2026-10-28 READY 53df99ef custom MCP: exact disposable private scratch repo created (journal 2762) and deleted (2772), both confirmed and acting_as christcr2012 (you); independent GET 404. The Act-as-me switch OFF, App-only check-run and separate read-only grant remain unverified. Useful current connector settings were not changed. 2026-10-29 on READY 454f6d4d: disposable repository creation acted as the person; App-only check creation independently read back app.slug=robinson-github-mcp and exact seed head, completed/success. Exact fixtures cleaned on READY c02b1998. OFF/read-only setting matrix still requires a separately disposable credential-setting fixture; this row remains incomplete.",
    "nextAction": "Prerequisite: a separately disposable secondary connection to test read-only and Act-as-me OFF/back ON on My connection. Retain independently verified App-only actor proof from 2026-10-29; do not change the useful current owner connection or repeat the completed App-only fixture."
  },
  {
    "id": "GITHUB-GOD6-RULE-OVERRIDE",
    "priority": 1,
    "requiredRevision": "08fbc15d1433ec0abce15fe7ce5eefd5a783790a",
    "task": "On an approved disposable scratch rules fixture, ordinary owner merge reaches GitHub; deliberate owner override discloses reason and GitHub decides permission. Explicit restricted-grant denials remain effective. No server protected-list veto or second owner confirmation is required.",
    "procedure": "Verify actual provider refusal/acceptance, actor, journal, one-send replay and independent merge readback on an exact authorized scratch fixture; separately use a deliberately restricted grant for denial.",
    "gates": "Approved disposable rule/PR fixture and separate deliberately restricted grant; do not alter the working connector or production rules as tests.",
    "dependsOn": [],
    "status": "BLOCKED",
    "lastEvidence": "2026-10-26 evening MDT, custom service-issued GitHub MCP, PRODUCTION/full, live 12d108dc507a2ebf093fa5bbb94d812ea2d72993 and Vercel READY at github.robinsonaisystems.com. Existing 2026-10-24 scratch PR proved normal merge denial, deliberate override preview, GitHub permission denial and later authorized bypass/merge; newly released C-7 fixes local empty-rule veto and preserves user approval. Missing protected-list denial is not inferred from tests, and no bypass was attempted against a real repository.",
    "nextAction": "Use the approved disposable rules fixture and restricted grant when supplied. Old server-list/extra-confirmation acceptance is superseded by the 2026-10-27 owner decision."
  },
  {
    "id": "GITHUB-PUB5-HEADERS-LIMITS",
    "priority": 1,
    "requiredRevision": "08fbc15d1433ec0abce15fe7ce5eefd5a783790a",
    "task": "Public launch protections on the live site: pages send CSP, nosniff and referrer headers; sign-in rejects non-S256 PKCE; a throwaway client's refresh token reused after rotation is refused and the family revoked; owner usage page shows per-person counts.",
    "procedure": "docs/pr-cards/ACC-1.md",
    "gates": "Saved developer connection; scratch organization or disposable fixture named rtc-acc1-<date>-<n> only; never overrideRules on a real repository; no spend.",
    "dependsOn": [],
    "status": "BLOCKED",
    "lastEvidence": "2026-10-28 independently READY 53df99ef: pages /, /privacy, /connection returned 200 with CSP/nosniff/same-origin referrer. Unauthenticated MCP initialize 401 with WWW-Authenticate. Disposable public client (no secret/token/sign-in): same request plain PKCE 403/no provider redirect, S256 302 to GitHub. Refresh-family replay and per-person usage remain unverified; do not mark the whole row passed.",
    "nextAction": "Use a disposable real OAuth client for non-S256 denial and refresh-family replay, plus authorized usage fixture. Never replay or revoke the working connector."
  },
  {
    "id": "GITHUB-AUDIT-EXACT-READ",
    "priority": 1,
    "requiredRevision": "75b4d61bf665c1d6a5a066950f53bd9fa4ae8790",
    "status": "PASSED",
    "dependsOn": [],
    "task": "Same immutable audit file: official/custom full text equality, exact byte reconstruction despite retention dependence, value-free false-positive diagnostic and single-copy large payload.",
    "procedure": "Read src/db.js at 4ea56dee via official/custom fullText, diagnose blob 75bafde9d8b812fc9d1c2e520114ebdfa53cd523, reconstruct four immutable byte windows and compare reviewed source/hash.",
    "gates": "Source-bearing independently verified serving READY release; ordinary authorized reads only.",
    "lastEvidence": "2026-10-28 READY 75b4d61b, checked manual release run 40700781978: official/custom 98401 characters identical; diagnostic 0 findings; four byte windows reconstruct 98404 bytes exactly equal to Git source, SHA256 68269a9f450c70294cef467f51c491d3176c7f2577b06c3177ad05e6f8efa131. One canonical full payload; prior 20 harmless RTC matches corrected. See docs/CONTENT-PROTECTION.md."
  },
  {
    "id": "GITHUB-NATIVE-GIT-WORKER",
    "requiredRevision": "53df99ef8b10d8c7351aa5eae4ee7cc867c8f228",
    "status": "PASSED",
    "priority": 1,
    "task": "Verify externally reachable signed native Git worker, then exact disposable clone/edit/commit/push/provider readback, stale-generation denial, immutable replay, conflict/recovery and disposal.",
    "procedure": "docs/NATIVE-GIT-OPERATIONS.md; docs/status/2026-10-29-dokploy-native-cutover.md; historical Render proof linked there",
    "gates": "Owner-approved Dokploy project and retained persistent volume; signed protocol-3 route and host continuity for old Render jobs; all-tenant inventory; exact run-owned private scratch fixture; no unrelated resource or useful-grant changes.",
    "lastEvidence": "READY ac0d2805aacb7554ac81a0fb6a7b512471ce3969 and matching Dokploy worker: PR472/473 remove daily quotas and fixed native request/workspace counts for all users. Signed resource-aware/null capacity, twelve live clones/writes/exact reads with four-hour idle renewal, native push4394 independently verified ref/commit/parent, all twelve closes, deletion4408 and independent404; no run-owned jobs remain. Four unrelated workspaces retained, two legacy Render. See docs/status/2026-10-29-native-resource-admission.md and sanitized per-lane proof; source, release and client evidence separated. External off-host backup/fleet installation remain unverified.",
    "dependsOn": []
  },
  {
    "id": "PLAYGROUND-COMMANDS",
    "priority": 1,
    "requiredRevision": "328828bde6996aba3009b97e24d707154fcb56b1",
    "task": "Use deployed agent-facing Playground execute/read/cancel on one exact isolated attached workspace; verify real file output, exit/log/status, replay, permission denial and cancellation.",
    "procedure": "docs/pr-cards/PLAY-1.md; docs/CODING-WORKSPACES.md",
    "gates": "Reviewed source deployed READY; separately isolated allocation and exact repository mount; operator-verified storage/network controls; protected binding/origin; authenticated disposable fixture only, no spending.",
    "dependsOn": [],
    "status": "BLOCKED",
    "lastEvidence": "Source328828b: ci40973062749, policy40973062690, native image40973062633 and coding image40973062634 passed. The image executed actual UID1000 commands through handler/dispatcher/github_call with real output, nonzero exit, logs, replay and cancellation. Live MCP independently remained READY ac0d2805; no attached live Playground allocation, repository mount or150GB quota was verified. Source/image tests are not actual provider/client acceptance."
  }
]
```
<!-- release-acceptance:end -->

## C-13 PR #440 repair — 2026-10-27
Custom GitHub MCP opened PR #440. The exact-head first CI failed due to missing catalog/docs inventory and registry list plus duplicate field projection on server response envelopes. Review noted binary credentials could pass the archive scanner; source and regression fixtures address it. Rate metadata #435 is NOT in #440, remains open. New exact-head CI, review resolution and merge are pending.

## 2026-10-28 authority/parity remediation

Owner-approved follow-up is tracked in [the active plan](designs/AUTHORITY-PARITY-2026-10-28.md) and `docs/status/2026-10-28-authority-parity.md`. Earlier completed cards and dated acceptance evidence are historical; they do not establish current parity or close this follow-up.


2026-10-29 Playground follow-through: owner-approved integrated coding scope is IN_PROGRESS under [PLAY-1](pr-cards/PLAY-1.md); command adapter source and real-image verification are tracked in [the connector checkpoint](status/2026-10-29-playground-connector.md). This is not a new live acceptance pass or a claim of completed provisioning/preview/lifecycle.

2026-10-29 Playground graceful fallback: see [current checkpoint](status/2026-10-29-playground-degradation.md). Source modes and durable pressure deferral are under verification; PLAY-1 integrated allocation/attachment/lifecycle remains incomplete.
