# ROADMAP — ideas not being built now

## 2026-10-27 — Coding-agent MCP usability backlog (#427–#436)

Owner approved the ten reported real-world improvements and requested implementation in priority order, with issues closed **only after their own acceptance tests pass and the implementing PR is merged**. Avoid one PR per issue where shared code and tests justify a bundle. **C-10 / #427 merged as PR #437 and verified closed** (exact 25 KB file bytes in no more than two calls, preserved compact defaults); **C-11 / #429 + #434 merged as PR #438 and issues closed** (canonical read aliases and direct manifest); **C-12 / #428 merged as PR #439 and issue closed** (single-copy large result envelopes); **C-13 / #430 + #435 + #436 implementation planned** (one complete read-path bundle); #430 shares the underlying retrieval service and can be grouped when safe. Other issues: **P0** #428 duplicate text/structuredContent payload and #429 parameter aliases; **P1** #430 repository snapshot archive handle, #431 guarded sequential write batch (separate mutation boundary), #432 failing CI diagnostics, #433 merge-arming introspection; **P2** #434 versioned manifest, #435 scoped rate-limit metadata, #436 universal field selectors. Respect user authority and genuine GitHub permissions while keeping compact summaries as defaults and complete, authenticated retrieval available on request. Close issues as part of merge closeout, with evidence; don't confuse branch code with verified completion.

## 2026-10-27 — CI-FAST-1 30-second warn-only feedback and parallel browser verification

Owner authorized a 30-second *soft* feedback target without punishing slow-but-passing tests. Required browser specs will be partitioned into independent Postgres-backed CI jobs, with one-to-one coverage checks. Store per-job measured durations and overrun notices in GitHub Actions summaries and 14-day artifacts. Actual failed tests, hard timeouts and the aggregate exact-head gate remain mandatory. End-to-end 30-second pipeline feedback remains aspirational and measured separately. [CI-FAST-1](pr-cards/CI-FAST-1.md).


## 2026-10-27 — C-9 authenticated MCP hot-path speedup

Owner requested competitive latency after a same-file client sample measured 302–513 ms official versus 1,879–2,022 ms through this MCP. The C-9 PR reuses fresh membership/pilot/marketplace and bearer validation **only inside the same HTTP request**, overlaps independent client/account reads, and preserves all write/tenant guards. No cross-request cache or new spend. Baseline is directional, not a controlled provider benchmark; deployment and real-speed improvement are unverified. See [C-9](pr-cards/C-9.md).


## 2026-10-27 — C-8 simple-call critical-path latency (implementation in review)

Owner feedback credits C-3..C-6 for dramatically less PR/CI rework but finds simple custom MCP requests slower than official GitHub. A small alternating, uncontrolled identity-read sample reproduced the direction, not the original exact timings. C-8 targets `github_whoami` duplicate/serial DB reads and the synchronous per-provider-request tenant telemetry SQL upsert, preserving real account authentication, per-tenant event counts, bounded rates, user authority, journaling, and per-request durability. Test the selected code with artificial delayed IO and real disposable PostgreSQL tenant isolation, then pass full exact-head CI, review and scheduled release. Only after live independently matches the new SHA may actual client response timing be reported as an observed improvement. Card: [C-8](pr-cards/C-8.md).

## 2026-10-27 — PAR-4 enterprise permission parity (engineering PR)

A concrete MCP-only veto was found: enterprise coding-agent policy mutations were advertised as universal REST alternatives in `src/tools/enterprise-write.js`, while `assertUniversalAuthority` rejected every `/enterprises/` route unconditionally. PAR-4 repairs only pinned `/enterprises/{enterprise}/...` routes with explicit `cred:M` and provider-verified, master-token ADMIN membership and scopes. Curated enterprise operations remain specialized; unknown-cost writes retain confirmation and user-selected caps. If GitHub has no matching GET, a provider-accepted write reports *unconfirmed* rather than inventing independent readback. Source merge, provider acceptance and daily live release are separate checkpoints (card: [PAR-4](pr-cards/PAR-4.md)).

## 2026-10-26 — Owner-authorized capability parity

Owner reports the official GitHub connector merged Cortiware after approval, but Robinson GitHub MCP declined the override. **Product requirement:** when an operation succeeds with the same underlying genuine GitHub authority, our MCP must not introduce an arbitrary veto. Preserve actual GitHub/provider grants, tenant isolation, user-chosen read-only/protected-list/spending policies, exact-head and once-only protections. Reproduce future official-connector parity gaps with fake-provider tests, classify whether a refusal is from GitHub or from our own implementation, and correct unnecessary MCP-only restrictions. Prioritize code and PR workflows, explicit owner/admin overrides, security scans, GitHub Actions and access control. This request does not authorize changing Cortiware or any real production resources. C-7 corrects the empty-rule override veto and missing override support in the common PR merge workflow.

**Private-repository proposal (2026-10-26; decision pending):** GitHub Free organization with 2,000 included private Actions minutes/month; GitHub billed API reports 36,527 organization-wide Linux minutes so far in October while public, $0 actual charges and a $0 Actions overage-prevention budget. These org-wide figures cannot be attributed entirely to this repo and are not a new monthly forecast. IMPORTANT: GitHub Free for organizations only supports branch protections/rulesets on public repos; private required-check enforcement needs GitHub Team or higher. Before making `github-mcp` private, choose a plan that preserves enforced required checks, estimate its steady-state CI separately, arrange David2024patton's new private contributor access, and understand that his existing public fork remains public and detached. No privacy, spending or access change is in this PR.

## Owner-approved completion expansion (2026-10-18): PUBLIC-SCALE, NOT PUBLISHED

The owner explicitly requires GitHub MCP to support **both mobile and desktop** and to be **architected and verified for potential permitted multi-user scale**, while **all plugins and public enrollment stay PRIVATE** until production readiness and a separate owner publication decision. This is a binding completion requirement, not permission to expose the existing global-admin single-owner setup to outside users. The indexed APPROVED (PUB-1..PUB-4) and publication-BLOCKED (PUB-5) security-first architecture and ordered PUB-1 through PUB-5 workstreams are in [PUBLIC-SCALE](designs/PUBLIC-SCALE.md). Before any implementation, write full PUB cards/acceptance into the work index and commit the prescribed plan, preserve all existing 57 original acceptance rows and developer $0/release policies. This cross-product expansion does not make original source-only tests or the new design a real-world acceptance pass. Neither the desktop direct plugin nor the Sites mobile candidate has passed dual-device acceptance.



Not approved scope. An item moves into a design only with Chris's approval (a dated DECISIONS entry). The usual signal
for hand-building something is repeated `github_api_*` / `github_graphql_*` calls for it in the change log.

- **Self-hosted and larger runners** (`github_runner_*`): hosted runners are spend; reached by the universal tools
  meanwhile (classified as spend).
- **Merge queue** tools: Chris merges with merge commits at the exact head and does not use a merge queue.
- **Copilot coding agent, Copilot review requests, Copilot Spaces, premium-request reports** as hand-built tools, if Chris
  returns to Copilot (cancelled 2026-10-09). Seat billing tools exist already (O-4).
- **Organization issue types, issue fields, autolinks, interaction limits, SBOM and attestations, migrations, Classroom**
  as hand-built tools.
- **GitHub Models:** retired July 30, 2026 according to [GitHub](https://docs.github.com/en/github-models); no new catalog/inference tools planned. This supersedes the historical D1 “belongs with Hub model servers” exclusion.
- **Enterprise features and maximum authority:** moved into approved [CAP-1..CAP-5](designs/MAXIMUM-AUTHORITY.md). A developer account lacking Enterprise does not exclude Enterprise users from the product. Provider plan/role/credential constraints are operation-specific.
- **Move a secret from another service into GitHub** (e.g. a Neon connection string or a Vercel token into an Actions
  secret) without it passing through chat: a hub workflow across servers, not built here.
- **Browser-assisted dashboard steps:** for settings GitHub has no API for, an agent with a browser follows
  `github_where_is_setting`'s structured steps while Chris watches; the server then reads back where possible.
- **Move to a newer REST API version** when GitHub publishes one after `2026-03-10` (its own card with a review of
  GitHub's breaking-changes page).
- **Reacting to repository events** (the App subscribing to push, pull request or check events, e.g. to tell Chris when
  CI fails on `main`): the server only handles installation events today.
- **A scheduled GitHub digest** (failing CI on default branches, new alerts, pending invitations, spend) once scheduled
  tasks are in regular use; `github_workflow_weekly_digest` is the on-demand version.
- **Port fixes back** to the Stripe and Workspace servers when a copied contract file is improved here (until the hub's
  `robinson-mcp-core` package exists).
- **More project profiles** (YardSync, Cortiware) when their repositories exist; `github_profile_draft` drafts them.

- Show a server-generated secret value once on the one-time-secret page when Chris asks (G-3 follow-up; today a generated value is never visible).


**2026-10-16:** the items in this file that Batch Y now plans (self-hosted/larger runners, merge queue, Copilot agent and Spaces, org issue types and fields, autolinks, interaction limits, SBOM/attestations, migrations) are scheduled in `docs/designs/BATCH-Y.md`; money-related ones wait for IN-16.

## Backlog carried from CAP-4 closeout (2026-10-22)

Not scheduled; each is built as a whole outcome only when an owner workflow asks: packages/registry streaming; credential
administration beyond SAML revocation; remaining GitHub App lifecycle routes (suspend/unsuspend, installation listing);
curated tools with write specifications for the 234 GraphQL mutations the inventory marks `blocked-missing-write-spec` (the universal tool does not cover them); enterprise audit/SCIM/IP policy once an enterprise principal exists.

## Approved by Chris 2026-10-23: public-friendly connection (scheduled before PUB-5, after testing is finished)

Order: finish the remaining acceptance testing first, then this, then PUB-5. Build it as one whole outcome, not slivers.

- **Simple connect flow for anyone:** Connect, Sign in with GitHub, pick the account, Approve. Mode, profile and tool listing default to safe **Two tiers (owner design 2026-10-23):** normal sign-in unlocks everything sign-in alone can authorize; an optional "God mode" step on the same screen collects the extra tokens/secrets for the rest. See `docs/DECISIONS.md`.
  choices and move to a settings page. No administrator passphrase for ordinary users. Today's owner form stays for the owner.
  Decided by Chris 2026-10-23: the simple flow is the normal way to connect. Today's owner form (account, mode, profile, tool listing, passphrase)
  becomes development-only: kept for building and testing, not shown to ordinary users, and out of the product's normal path.
- **GitHub App install inside the connect flow:** after "Sign in with GitHub", the server checks which accounts the person has already installed
  the App on; for an account without it, it sends them straight to GitHub's install screen (with "request user authorization during
  installation" so sign-in and install are one step) and returns them to finish connecting. Organizations whose owner must approve the install
  show a plain "waiting for your organization owner" state. Needs the App to be publicly installable (a GitHub App setting), which is a
  distribution step that needs Chris's explicit approval before it is switched on. Today's one-by-one "Create the GitHub App" step stays for the owner and self-hosting.
- **Easy place to add the extra tokens and secrets** that the standard GitHub sign-in cannot reach (for example the package token,
  notifications token, fine-grained tokens): a guided "Unlock more tools" page that says, in plain words, which tools each one opens, how to
  create it on GitHub step by step, accepts it on the protected page only (never through chat or a tool argument), shows what it unlocked,
  and lets the user remove it. Builds on the existing encrypted token vault and CAP-3 enrollment; the no-secret-through-a-tool rule stays.
- Acceptance: a first-time user on a phone connects without help, sees which tools are available and which need an extra token,
  adds one token, and sees those tools unlock; verified on real devices.

### Public App rollout plan (Chris approved the approach 2026-10-23; built after testing, before PUB-5)

Approach: one public GitHub App, opened gradually. Every item below is part of "done"; agents do all of it except the rows that only Chris can do
(listed in `docs/OWNER-CHECKLIST.md`).

1. **Connect flow and token page** (the two items above), with the owner form kept development-only.
2. **App settings completed for public use:** name, description, logo, homepage, support contact, setup and callback addresses, webhook address and
   secret, the smallest permission set that still works (extra permissions requested only when a person asks for those tools), "request user
   authorization during installation", and "installable by any account" switched on only at launch, with Chris's say-so.
3. **Key and secret safety:** the App private key, client secret and webhook secret held only in server settings, never logged; a documented,
   rehearsed way to replace each one fast; webhook signatures always checked.
4. **Capacity and cost:** load test with many simulated users; per-user limits and caps confirmed; a monthly hosting-cost view with an alert
   threshold; clear plain-words limits shown to users. Pricing is a later decision for Chris.
5. **Safety for strangers' accounts:** every action stays inside the person's own installation and the permissions they approved; a one-click
   "disconnect and delete my data" for users; removal of stored tokens when an App is uninstalled.
6. **Legal and trust pages:** terms of service, privacy policy, a security contact and a status/support page. Agents draft them; Chris decides and
   a lawyer should review (agents are not lawyers).
7. **Gradual opening:** invite-only first (a handful of people), watch errors, cost and support questions, then widen. Each step needs Chris's go-ahead.
8. **Honest acceptance:** a first-time user on a phone connects, installs the App, adds an extra token and sees tools unlock, checked on real
   devices, plus the load test result, before the setting is switched on.

## Remaining after PUB-6 (named, not built)
- Make the GitHub App publicly installable and turn on `GITHUB_PUBLIC_CONNECT` (needs Chris's go-ahead; see the rollout plan above).
- (Done 2026-10-23) The old "make changes" tick-box became an optional **Read-only** choice: changes are on by default, and a read-only connection refuses changes with wording that says how to reconnect.
- Fine-grained-token tenants (God mode currently offers the notifications and package keys).
- Revoke or delete a stranger's tenant and data by identity (today's revoke tools are keyed by account for the private pilot).
- Self-host the brand fonts (pages currently use system fonts) and a favicon `.ico`.
- Move the connector to `github.robinsonaisystems.com` (OAuth callbacks, App settings, existing clients; DNS row on the owner checklist).
- Real-device acceptance of the new flow (owner checklist, optional).

- (Done 2026-10-23) Self-serve "delete my data" page for public people: sign in with GitHub, confirm once, everything stored is removed.

## Owner-requested (2026-10-23) — status
- (Done 2026-10-23, GOD-1) God mode as one master token. Remaining God-mode work is planned in FIN cards GOD-2..GOD-5
  and ENT-1 (`docs/designs/FINISH-PLAN.md`).
- (Historical note) **God mode as ONE master token:** Chris's intent is a single classic GitHub token, typed on the God page (never into a chat), that unlocks everything the standard sign-in cannot: notifications, packages and every other classic-token-only operation — instead of today's separate "notifications token" / "package token" choices. Needs a design: one new credential kind that existing notification/package tools also accept, the token scopes to tell the person to tick, encrypted storage like the current keys, and tools for the remaining classic-only operations.
- **Linking a second, separate GitHub login** into one connection (security-sensitive: needs sign-in as both people). Today each GitHub person gets their own separate space.

- Link a second, separate GitHub login (for example a client's or an older work login) into one connection. Needs proof of both logins and a careful look at tenant isolation. Not built; one login with its personal account and organizations is covered.

## Found during the 2026-10-23 sign-in rebuild (now planned: stateless/cap → HARD-1 A.1, one App key copy → HARD-1 A.2)
- **Stateless sign-in steps:** every sign-in step is a database row under one global cap (200 open), so anyone opening many
  sign-in links could briefly fill it. Signing the step into the address itself (and recording only used ones) would remove the cap.
- **One copy of the App keys:** each person's area keeps its own sealed copy of the App's keys, refreshed at their next
  sign-in. Reading the single shared copy instead would make a key change reach everyone at once.
- **Second GitHub login in one connection** (above) would fit naturally on My connection once tenant merging is designed.

## Planned 2026-10-23 (batch FIN, see docs/designs/FINISH-PLAN.md)
GOD-2 personal tools on the master token · GOD-3 "what it unlocks" · ENT-1 enterprise tools (trial) · ACC-1 acceptance
sweep · GOD-4 new master-token families · GQL-1 GraphQL write specs · GOD-5 extra places · HARD-1 hardening and tidy.
Still NOT planned (stay here): ChatGPT/Claude directory listings (policy-blocked; PUB-5 is now the website launch); linking a second, separate GitHub login into one
connection; OAuth-app token management and App-manifest conversion (need an OAuth app's own secret).

## Found while building ENT-1 (2026-10-23)
- **Copilot coding-agent policy for an enterprise** (`PUT /enterprises/{enterprise}/copilot/policies/coding_agent` and
  `POST|DELETE .../coding_agent/organizations`): not a dedicated tool, because the pinned GitHub description has no operation
  that reads the policy back, so a change could not be verified. Still reachable through the universal REST tool (preview and
  confirm apply; read-back is not possible). Re-open when GitHub adds a read operation.
- **Enterprise membership changes** (invite or remove admins and members, create organizations, GraphQL) stay out of ENT-1 on
  purpose (access changes at enterprise scale); GQL-1 may add them with Chris's say-so.

## Monetization (later; Chris 2026-10-24: free for now, wants to monetize someday)
Nothing here is built. PUB-5 measures each person's daily calls and changes so any of these can be priced from real data.
- Free tier with the PUB-5 fair-use limits; a paid tier with higher limits, God-mode features or longer saved results.
- Team or organization plans (one bill for several people's connections).
- Payment through Stripe (Chris has a Stripe MCP) or GitHub Marketplace paid plans (GitHub requires a verified publisher
  and at least 100 installations before a paid plan; once a paid version exists outside the Marketplace, the Marketplace
  listing must offer one too).
- Getting people to use it: the official MCP Registry and GitHub Marketplace listings (PUB-5 PR D), the website button,
  a short demo video, posts in MCP communities, and a clear README on the public repository.

## Later options for GOD-6 "act as me" (not built)
A per-call "as the bot this once" choice; acting as the person for tools that narrow their token per call (needs a
URL-inside-target check like GOD-5's); fine-grained personal tokens as the "me" credential; the deliberate rule override on more tools (tags, branch rename,
update branch, universal tools).


## Owner-authorized 2026-10-26 — Meta Muse support (MUSE-1)

Owner requested compatibility with Meta Muse and an updated `github.robinsonaisystems.com` homepage. Work plan and acceptance: `docs/pr-cards/MUSE-1.md`. Existing standard MCP and independent OAuth provide the Muse Code connection; the consumer Muse custom-connector builder is a distinct platform flow that needs real-client acceptance before claiming it works. No directory submission, manual deployment, or production permission change is authorized by this request. Any future Meta Connector Platform application, verified consumer-Muse connection, or provider-specific adapter should be separately evidenced and approved if needed.

## 2026-10-26 — MUSE-2: Public Muse OAuth onboarding (in review)

Extend the PUB-6 tenant-authenticated public connector with OAuth public-client (`none`) registration, S256 PKCE without a shared secret, canonical audience default only when `resource` is absent, and confidential `client_secret_post` compatibility. Support the Android Muse form's static *public* Client ID bound to the observed Meta callback; all users still sign in with their own GitHub account. See `docs/pr-cards/MUSE-2.md` and `docs/status/2026-10-26-muse-2.md`. Completion requires real Postgres/unit/browser CI and independent Muse app acceptance; no Meta listing is claimed.

## 2026-10-26 — PAR-2, Muse-reported missing parity (approved, PR in progress)

The owner asked for dedicated readers for org issue types and issue fields and on-demand secret checks. The read endpoints exist already and are used by write tools; this adds discoverable bounded reads. The official GitHub MCP's `run_secret_scanning` is **remote-service only**, not in the public REST API. Our server-side file scanner covers selected already-hosted GitHub files with redacted, bounded common-token patterns. It cannot scan local/uncommitted edits, replace GitHub Secret Protection, provide GitHub's private detection coverage or create GitHub alerts; no new paid provider settings. See `docs/pr-cards/PAR-2.md` and `docs/status/2026-10-26-par-2.md`.

**Future security hardening (2026-10-26):** If pre-auth OAuth abuse measurements justify it, design a shared per-IP / per-client limiter on a bounded storage budget with privacy-conscious IP hashing, TTL/cleanup, tests for parallel/distributed calls and safe 429 Retry-After semantics. A per-instance Map is not a reliable Vercel-wide protection. Not required to merge input-boundary correctness and not authorized to add costly storage now.

## 2026-10-27 — C-16 guarded sequential write batching (#431)

Commit plan before implementation, then implement explicit 1–8 step `github_write_batch` with owner-authorized current per-operation write-contract behavior, ordered safe references, per-step evidence, durable Postgres intent+lease+replay protection and no automatic second submit of uncertain GitHub changes. Preserve read-only `github_batch`. Add deterministic fake and disposable-Postgres tests plus paperwork/CI and close #431 only after reviewed exact-head green merge. This is a separate bundle from #432/#433 CI operator reads and #435 credential-rate observations.
