## 2026-10-21 — CAP-3 existing private-user metadata binding (draft source only)

> **Current authority and parity remediation (2026-10-28):** [requirements](OWNER-DECISION-2026-10-27.md), [delivery plan](designs/AUTHORITY-PARITY-2026-10-28.md). Full owner writes disclose/execute/journal/verify in one call; explicit delegated restrictions remain. Older dated statements about owner caps, production ceremony and mandatory merge gates are superseded. Source delivery and live acceptance remain separate.

Draft #274 adds nullable JSONB `authority_binding` to the existing directory table `gh_tenant_user_authorizations`; no second bearer store is introduced. Idempotent initialization and the first trusted consent/refresh write ensure the additive column exists. Legacy reads use `to_jsonb` so an upgraded read does not require prior migration, copy ciphertext, or silently certify legacy authority. Consent/refresh seal tokens with the existing tenant/identity/account AAD; proof records bind ciphertext fingerprint, verified numeric human, membership/pilot epochs, account/App/installation, fixed GitHub.com host, expiry and exact `GET /user`/`user/<subject>` identity-read scope. Proof and ciphertext are replaced atomically; null-proof replacement cannot retain earlier verified status. `createTenantScopedCredentials.operationAuthority` reports only the exact stored/readback proof without decrypting and never authorizes provider dispatch. Additional credential kinds, protected/native upgrade enrollment and full resource readback remain unimplemented CAP-3 work. No migration has been applied to a real database by this engineering session; draft status and source/deployed acceptance remain separate.

## 2026-10-19 — PUB-3 PRIVATE tenant capacity and incident protection (source only)

Tenant runtime admission uses `src/tenancy/runtime-limits.js` on each separately verified PostgreSQL schema and does not alter the legacy owner connection. The tenant-scoped quota function `gh_claim_tenant_capacity` atomically reserves BOTH tenant and individual client capacity using an inner PL/pgSQL rollback savepoint, so a client over its own cap cannot starve another authorized user. Per-tenant minute MCP/OAuth admission happens before handling real private MCP or private token/GitHub-browser consent, while bounded daily job starts and retained JSON bytes are enforced through a tenant-only `createDb` facade. Limits are fair-use capacity controls, not permission/spend/production grants. Missing schema/function or revoked tenant returns a narrow failure and never falls back to the global owner's account.

Only aggregate event/outcome/latency buckets in fixed enums are recorded; signed client IDs are SHA-256 hashed for quota keys, not exposed. A best-effort 1/128 opportunity cleans bounded expired quota/aggregate metric records, while jobs/results already have 24h TTL and bounded expiry deletion. `src/tenancy/incident-cleanup.js`, the server-owned tenant directory and the protected owner setup emergency revoke coordinate tenant-scoped removal of pending auth codes, bearer sessions, clients, jobs/results and encrypted per-user U grants; no public or ordinary MCP user invokes this action. No customer credential, provider operation, scheduled release or public product setting is activated by this PR. Full acceptance requires real concurrent PostgreSQL and original safety suite, exact-head CI/review and later PRIVATE first-hand client testing.

# ARCHITECTURE — runtime facts, as built

This file describes what **exists**, and is updated in the same PR that ships it (DRIFT-PROTOCOL checklist B). What the
system is designed to become is in `docs/designs/`; do not copy design text here before it is built.

**Historical live overlay (2026-10-12 UTC; reviewed main #82):** Deployed to Vercel with a dedicated Neon database and the owner's custom GitHub App for `robinson-ai-scratch` installed, all-repositories and owner-designated scratch. The code creates 28 tables (`SCHEMA_TABLES`); 20 were verified on the live database at this date and the rest are created by `initSchema()` on first use after each release. The foundation paragraph formerly here described the A-3b historical state; check STATUS and the V-1 card for current implementation and pending custom OAuth-connected acceptance. As of 2026-10-18, the independently READY production deployment is still `f1397503`; scratch account-level production is ON by owner approval, but the existing native custom connection is PREVIEW and real production-classified writes still refuse until the reviewed mode-correction release plus private owner action. Public multi-tenant readiness is NOT implemented; see `docs/designs/PUBLIC-SCALE.md`.

## Dormant PUB-1 per-tenant storage foundation (source, not public live behavior)

`src/tenancy/directory.js` implements a separately initialized PRIVATE identity/tenant/membership registry (numeric provider-verifiable GitHub subject, opaque UUID tenant, owner/admin/member role and monotonic membership revision). Each tenant uses its own `gh_t_<UUIDhex>` PostgreSQL **schema** containing the existing service's ordinary 28 tables, so historic primary keys, account logins, hashes, project profiles, retained results, audit and run state are scoped automatically by the connection's per-query search namespace. The Neon HTTP connection uses the documented PostgreSQL startup `options=-c search_path=<exact-only-tenant-schema>` rather than unsafe pooled `SET search_path`. Before reading credentials, the store independently checks both `current_schema()` and `current_setting('search_path')`; unknown, absent, malformed or mismatched schemas fail closed and never fall back to `public`. The tenant directory and provisioner have **no public route**. PUB-2 must bind a real provider-verified numeric GitHub identity and tenant membership on **every** new request before this internal mechanism can be used by customers. Legacy owner data remains in the original namespace untouched; any production migration is a separate reviewed and consented event. PR #263 is private source implementation with real PostgreSQL proof at its corrected head. It remains subject to its final exact-head CI/review/merge and checked scheduled release; neither PUB-2 public login nor actual tenant traffic exists.

## PUB-2 — private tenant GitHub OAuth source implementation (not public live acceptance)

Source PR #264 adds a server-issued tenant-client `tcl_`, access `tac_` and refresh `trf_` routing format, scoped by per-tenant and per-identity membership epochs, with bearer hashes stored in the tenant's own PostgreSQL schema. A genuine GitHub provider `/user` and App installation check is required by the browser OAuth callback; state is browser-cookie bound, one-use and PKCE-protected. The service's standard `/api/oauth/authorize` detects pre-enrolled private clients and routes to the mobile-sized GitHub consent form **without exposing `ADMIN_PASSPHRASE`**; owner clients retain the original supported login. An owner-only, passphrase/CSRF-protected PRIVATE scratch pilot can create an isolated test tenant, register clients or allowlist a second verified GitHub identity. This controlled testing invitation path is **not** the final customer's onboarding model; future supported clients must use their own delegated GitHub authorization. Tenant U grants are encrypted per human and tenant, installation I credentials remain owner-scoped, and disabled/suspended/revoked identities fail closed. These are implemented source behaviors with full synthetic/disposable DB CI, not evidence that the live service has been released, a customer actually connected, mobile or desktop was accepted, or public GitHub permissions were granted.

## Infrastructure

| Piece | State |
|---|---|
| GitHub repository `Robinson-AI-Systems/github-mcp` | Public; plan and A-1 on `main`; changes only through `ai/*` PRs |
| Runtime | Node **24.x** (DECISIONS 2026-10-10; Vercel disabled Node 20 for new deployments on 2026-10-01): `package.json` `engines` `24.x`, `"type": "module"`, `actions/setup-node` `node-version: 24` in every CI job |
| Dependencies | Pinned exactly, `package-lock.json` committed; `npm ci`. Runtime: `@modelcontextprotocol/sdk` 1.32.1, `@neondatabase/serverless` 1.2.0, `@octokit/core` 7.0.8, `@octokit/plugin-paginate-rest` 16.0.0, `@octokit/plugin-throttling` 11.0.5, `@octokit/plugin-retry` 8.1.1, `@octokit/auth-app` 8.3.1, `@octokit/webhooks` 14.2.0, `libsodium-wrappers` 0.8.4, `ajv` 8.20.0, `ajv-formats` 3.0.1, `graphql` 17.0.2. Dev: `vitest` 5.0.3, `pg` 8.23.1, `eslint` 10.12.0, `gpt-tokenizer` 3.4.0 |
| GitHub Actions CI | `.github/workflows/ci.yml` on PR and main; read-only token, no secrets or pull_request_target. Independent `check`, two `unit` shards, disposable `db`, `shapes` and `rtc` families; aggregate **ci** requires all families. Both **ci** and **release-policy** are mandatory at the exact head. Current matrix, pins, timeouts and 180-second root phase budgets are guarded by `scripts/check-ci-layout.mjs`. |
| Test harness | `test/helpers/fake-github.js` (`makeFakeGitHub()` → `{ fetch, calls, unmatched, graphql, when, routes }`, passed to Octokit as `request.fetch`; A-1 route list, A-4 adds the vendored description and validation); `test/helpers/write-contract.js` (the nine write-contract checks through every door), `test/helpers/rtc-fixture.js` (a fixture registry served by the real RTC HTTPS handler for the pinned conformance runner), `test/helpers/http-harness.js`, `sample-writes.js`, `dev-ledger-fake.js`, `fixture-gates.js`; `test/helpers/fake-db.js` (`createFakeDb({ clock })`: key/value rows, `initSchema()`/`listTables()`, and the login store; `seedAccounts()` is its test seam for `gh_accounts`); `test/contract/oauth-contract.js` (one login-store contract run against the fake and real Postgres); `test/helpers/pg-neon-adapter.js` (isolated `github_mcp_test_*` schema, Neon-shaped tagged queries); `test/contract/db-contract.js`; `scripts/local-postgres-test.sh` (CI service via `TEST_DATABASE_URL`, else a temporary local cluster; localhost only) |
| Tool registry | `src/tools/index.js` exports the current registry and delegates to `createDispatch`; all read and write tool exposure follows profile and safety policies. 394 tools (388 hand-built + 6 universal) have shipped since the initial two read-only foundation tools; see `docs/TOOL-CATALOG.md` and source/CI for exact current counts. |
| Vercel project | `github-mcp` on existing paid team; independently READY production source `f1397503be40ab4cb2bbff70c19c43b146c7c6d3` at Oct 18 checkpoint, with later merged main `83d021e8fdb97fd6a75eb3bd52beff7b8c722321` **not yet deployed**. Canonical HTTPS origin unchanged. |
| Neon database | Independent project `green-surf-51243848` / database `github_mcp`, fixed 0.25 CU and 5-minute autosuspend; 20 application tables verified initialized on 2026-10-12; the code now declares 27 (see Database tables) |
| GitHub Apps | Custom `robinson-mcp-robinson-ai-scratch` App installed on `robinson-ai-scratch`, active All repositories with 41 matching stored permission entries. Separate normal organization/personal Apps still pending |
| GitHub credentials | Scratch App credentials remain encrypted in the service; real custom FULL/PREVIEW OAuth/refresh connection verified Oct 18 before owner PRODUCTION account switch. Existing session's mode remains PREVIEW pending separately approved upgrade on checked release. Never disclose/rotate `TOKEN_ENCRYPTION_KEY` without deliberate migration. |

## Environment variables

Never record values here. Vercel itself provides `VERCEL_ENV`.

| Variable | Read by | Meaning | Environments |
|---|---|---|---|
| `DATABASE_URL` | `productionSql()` in `src/db.js`, on first database use (never at import) | This server's own Neon database (IN-02) | Production only (DEPLOY.md Part 2; previews share the database and never offer production mode) |
| `PUBLIC_BASE_URL` | `publicOrigin()` in `src/core/http.js` | The server's HTTPS origin with no path, used for the OAuth issuer and the MCP resource; never taken from a request header. Missing or malformed → the OAuth endpoints answer 503 | Production, Preview |
| `ADMIN_PASSPHRASE` | the authorize handler in `src/core/oauth-handlers.js` | The login passphrase (IN-03). Missing → sign-in fails closed with 503 | Production, Preview |
| `TOKEN_ENCRYPTION_KEY` | `readEncryptionKey()` in `src/core/crypto.js`, through `createCredentials` (`src/github/credentials.js`) | A base64 32-byte key (AES-256-GCM) that encrypts every GitHub credential at rest (IN-03). Missing or malformed → nothing can be stored or read, and the message says what to set | Production |
| `VERCEL_ENV` (Vercel) | `src/oauth/policy.js` | `production` is the only value that allows production mode (A10) | set by Vercel |
| `VERCEL_GIT_COMMIT_SHA` (Vercel) | `rtcIdentity()` in `src/rtc/scope.js`; `api/index.js` | Build SHA shown by `/`, `/api/contract` and `/api/whoami`; self-reported, not independent deployment evidence | set by Vercel |

CI uses `TEST_DATABASE_URL` (db job, localhost) and `BASE_SHA` (check job, from the PR event). The owner-run acceptance scripts read `RTC_PUBLIC_ORIGIN`, `RTC_AUTH_PASS`, `RTC_PROVIDER_DEPLOYED_SHA`, `GITHUB_MCP_ORIGIN`, `GITHUB_MCP_ACCESS_TOKEN`, `GITHUB_MCP_DEPLOYED_SHA`, `GITHUB_MCP_SCRATCH_ACCOUNT`, `GITHUB_MCP_RUN_ID` and `GITHUB_MCP_RUN_REPO` (never committed, never printed).

## Database tables

Created by `createDb(sql).initSchema()` in `src/db.js` (A-2), one `CREATE … IF NOT EXISTS` per call, idempotent, no drops
and no data rows. `SCHEMA_TABLES` lists them in this order; columns are exactly those of `docs/designs/BATCH-A.md` §2.
Credentials are ciphertext (`*_enc`) or hashes (`*_hash`) only; `tests/db/schema.test.js` fails on any other
secret-looking column name.

| Table | Holds |
|---|---|
| `gh_apps` | The private GitHub App per account: App ID, slug, owner, client ID, encrypted client secret, private key and webhook secret, granted permissions |
| `gh_accounts` | One row per GitHub account Chris uses (login key): credential kind (`app` default), installation and status (`none` default), encrypted user, fine-grained and classic credentials with last four characters, plan, `production_enabled` (false), `spend_limit_cents` (0), default and scratch flags |
| `gh_installation_tokens` | Encrypted installation tokens per (installation, scope key) with expiry |
| `setup_states` | Short-lived setup-page states (manifest, user authorization) with an encrypted PKCE verifier |
| `oauth_clients` | Registered connector clients |
| `oauth_codes` | One-time authorization codes with the connection's default account, account list, mode (`preview`), profile (`everyday`), listing (`catalog`) |
| `oauth_tokens` | Hashed access and refresh tokens with the same connection fields, `kind` (`connector`), expiry, last use, revocation |
| `login_attempts` | Passphrase attempts per address (lockout counting) |
| `change_log` | One row per write attempt: who, where, tool, summary, before/after, dry-run, confirmation, production and access flags, spend, request key, GitHub request ID, inverse, undone-by |
| `one_time_secrets` | Ciphertext shown once on the setup page, with expiry and viewed time |
| `gh_rate_state` | Last known GitHub rate headers and `blocked_until` per (account, resource) |
| `gh_write_slots` | Next allowed write time per installation (write spacing across instances) |
| `gh_etag_cache` | ETags and bodies for polled reads per (account, URL key) |
| `protected_resources` | The protected list (B-3): kind (`repo`, `installation`), lowercase target (`owner/name`, an installation number, or `*` for this server's own Apps), level (`pr-only`, `locked`), reason |
| `secret_entry_requests` | A secret Chris will type on the setup page (G-3): who it is for and where it goes, 30-minute life, used once; never the value |
| `result_store` | Big results kept 24 hours behind a `res_…` handle for one connection (C-1); expired rows are cleared on the next write |
| `server_settings` | Owner settings as key and JSON value (B-2: the extra production names; later cards add theirs) |
| `known_projects` | Project profiles (P-1): what each project needs from GitHub |
| `rtc_pass_scopes` | A service pass's legacy scope row plus its stored `rate_limit_per_minute` (R-1) |
| `rtc_pass_grants` | A scoped pass's profile, mode, areas, repositories, change / access-change / spend permissions and Hub flag (R-1) |
| `rtc_pass_rate` | Per-pass request counting window shared by every server instance |
| `dev_runs`, `dev_run_objects`, `dev_run_intents` | Developer runs, every object a run created, and write intents for crash-safe cleanup (Batch V) |
| `dev_repo_birth_labels`, `dev_forwarders`, `dev_cleanup_executions` | Scratch-repo birth labels, webhook forwarders, cleanup execution ledger (Batch V) |

Login store (A-3a, `createDb(sql)` in `src/db.js`): codes, access tokens, refresh credentials and client secrets are stored
as SHA-256 hashes only; a code is deleted as it is consumed (single use); refresh is one atomic `UPDATE` on the same row for
the same client, so every connection setting (`CONNECTION_FIELDS`) stays as issued; `checkConnection` refuses a connection
with no accounts, a default account outside the list, or an unknown mode, profile or listing (`production` is still decided
by the login endpoint, A-3b). Failed logins are counted per address in `login_attempts` (5 in 15 minutes lock it).

Index: `change_log_request_key` on `change_log (request_key, at)` (replay lookup). Later batches add their own tables,
always `IF NOT EXISTS`, and list them here when they exist. The production Neon database now has 20 application tables initialized (IN-02); throwaway Postgres remains the CI acceptance test database.

## Endpoints

| Path | File | What |
|---|---|---|
| `/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource` | `api/well-known/*` via `vercel.json` rewrites | Fixed HTTPS metadata (S256 PKCE only, `client_secret_post`) |
| `/api/oauth/register` | `api/oauth/register.js` | Client registration (1–8 distinct HTTPS or localhost redirect URIs); the secret is returned once, stored hashed |
| `/api/oauth/authorize` | `api/oauth/authorize.js` | GET: account checkboxes + default, mode, profile, listing, passphrase. POST: passphrase (5 wrong in 15 minutes lock the address), then the choices; `production` only on the production deployment and only when every selected account has `production_enabled` |
| `/api/oauth/token` | `api/oauth/token.js` | `authorization_code` (single-use code, PKCE, copies every connection setting from the code) and `refresh_token` (atomic rotation on the same row, same client) |
| `/api/mcp` | `api/mcp.js` | Streamable HTTP MCP: bearer check (production token on a non-production deployment → 403), `tools/list` from the registry (394 tools, filtered by the connection's profile and listing), `tools/call` through the guarded dispatcher (production, protected-resource, people and spend gates; the write layer previews, confirms, reads back and logs) |
| `/` | `api/index.js` via `vercel.json` rewrite | Name, status, the registry's tool count and the build SHA; nothing secret |
| `/api/contract` | `api/contract.js` | Public RTC manifest (`rtc: 0`, not certified), self-reported build evidence |
| `/api/openapi.json` | `api/openapi.js` via `vercel.json` rewrite | Public OpenAPI 3.1 description of the HTTPS door (at most 30 operations) |
| `/api/whoami` | `api/whoami.js` | Pass-authenticated: profile, mode, areas, repositories, change/access/spend permissions |
| `/api/tools`, `/api/tools/{name}`, `/api/tools/_batch` | `api/tools/index.js`, `api/tools/[name].js` | Pass-authenticated tool listing, description, run (reads and, for passes that allow them, changes through the write layer) and read-only batch |
| `/api/results/{handle}` | `api/results/[handle].js` | Pages a retained large result; the handle belongs to one connection |
| `/api/developer/connect` | `api/developer/connect.js` | Developer-connection helper for the implementing agent (see `docs/pr-cards/DEVELOPER-CONNECTION.md`) |

Every OAuth or MCP failure that is not a clean refusal answers 503 `temporarily_unavailable` with no detail. The HTTPS tool API (Batch R, #225) is below.

| Path | File | What it does |
|---|---|---|
| `/api/github/setup` | `api/github/[action].js` | The owner's private page (A-5b). GET shows it, or finishes an App install (`?installation_id=`, read back from GitHub as the App). POST actions, each behind same-origin, CSRF token and passphrase: `status`, `start-app`, `start-user-auth`, `add-fine-grained`, `add-classic`, `reveal`. Credential steps need the production deployment and `TOKEN_ENCRYPTION_KEY` |
| `/api/github/manifest-callback` | same | GitHub returns the one-time code after App creation; converted once, keys stored encrypted, nothing secret shown |
| `/api/github/user-callback` | same | Owner authorization (PKCE S256); token exchanged server-side and stored encrypted |

| `/api/github/webhook` | `api/github/webhook.js` | GitHub App deliveries (A-5c). Raw body; `X-Hub-Signature-256` checked against the stored webhook secret of the App named in `X-GitHub-Hook-Installation-Target-ID` (bad or unknown → 401, nothing stored). Handles `installation` (created, deleted, suspend, unsuspend, new_permissions_accepted), `installation_repositories` and `github_app_authorization` (revoked → owner sign-in dropped); anything else is acknowledged and ignored. Installations on accounts that do not own the App are ignored |

One dynamic function serves the three (`src/github/routes.js`) to keep the setup surface in one place (the project is on a paid Vercel team; there are 16 function files); unknown names answer 404, failures 503 without detail.

## GitHub API version and descriptions

REST `X-GitHub-Api-Version: 2026-03-10` is pinned in `src/github/client.js` (`GITHUB_API_VERSION`, A-4) and sent on every call. The
matching descriptions are vendored: `vendor/github-openapi/api.github.com.2026-03-10.json` (rest-api-description @ 58b1e0c0, 1,232
operations) and `vendor/github-graphql/schema.docs.graphql` (github/docs @ be38ec5d); each has a `SOURCE.md` with URL, commit, sha256 and
date, and a test checks the hash. Search them with `node scripts/openapi-find.mjs "<words>"` (`--show "<METHOD /path>"`) and
`node scripts/graphql-find.mjs <name>`; never read them whole. Moving the version is its own card.

### Credentials (A-5a)

`src/github/credentials.js`: `token({ account, cred, scope })` returns the plain token for one request only. `cred I` is the App installation token (cached in
`gh_installation_tokens`, ciphertext, one row per downscoping) or the account's fine-grained token; `U` is the owner's user authorization (refreshed ten minutes before expiry);
`K` is the classic notifications token. Every stored value is AES-256-GCM ciphertext with a context naming its owner (`github-mcp/account/<login>/…`, `github-mcp/app/<id>/…`,
`github-mcp/installation/<id>/<scope>`). `src/core/one-time-secrets.js` holds secrets that may be shown once on the setup page (ten minutes, deleted by the read).

### GitHub client (A-4)

| Piece | Behaviour |
|---|---|
| `githubFor(ctx, { owner, cred, scope })` | One Octokit per request. `ctx = { connection, db, credentials, fetch?, now?, sleep?, budgetMs? }`; `credentials.token({ account, cred, scope })` is supplied by A-5. `cred` is `I` installation, `U` user or `K` fine-grained token |
| Writes | Never retried after an error; each waits for its `gh_write_slots` turn (1 s apart per account and credential kind, across instances; refused with `rate_limited` if the queue is over 5 s) |
| Reads | Retried twice on 5xx; `request: { etag: true }` sends `If-None-Match` from `gh_etag_cache` and returns the stored body on a 304 (`notModified: true`) |
| Rate limits | Every response's headers go to `gh_rate_state`; a spent budget or a `retry-after` on 403/429 blocks that account and resource; waits are honoured only inside the 20 s budget, otherwise `rate_limited` with the reset in the person's own time zone (UTC when none is saved) |
| `requestKey(ctx, tool, args)` | `rmcp_<tool>_<sha256>_<10-minute bucket>`; ignores `dryRun`, `confirm`, `fields`, `detail`; a caller `requestKey` replaces the arguments |

### Write layer (B-1)

Every change-making tool is built with `defineGithubWrite` (`src/tools/define-github-write.js` over the contract-generic `src/core/write.js`). It always runs, in
this order: connection and target checks (profile, account in the connection) -> read current state -> classify (production, access change, people notified, spend) ->
refuse what the connection's mode forbids (a production change on a preview connection, including when the state could not be read) -> the ordered guard gates
(`src/tools/gates.js`, `ctx.gates`) -> plain-English preview with marks (PRODUCTION, ACCESS CHANGE, NOTIFIES, COSTS) -> `dryRun` stops -> ask first when anything
needs confirmation -> claim the request key (`change_log_request_once`, a unique index; an identical request in the same 10 minutes is a replay) -> send once ->
read back and compare -> finish the row (inverse stored for undo). Refusals and previews are logged; a definite GitHub "no" frees the key, an uncertain outcome keeps it.
Tests for any write tool use `test/helpers/write-contract.js` (nine checks through every door).

### Production guard (B-2)

`src/tools/production-guard.js` decides what is production: an organization or user scope, tags, releases, repository settings, environments (by name, required
reviewers or wait timer), and refs (names, project-profile patterns, the default branch, a protected branch, any branch a ruleset applies to). Built-in names are
`production`, `prod`, `live`; the owner can only add more (`server_settings`). A failed read counts as production. The gate `productionEnabledGate` then refuses a
production change on a production connection unless the account's switch is on. The switch turns on in two steps: `github_enable_production` creates a single-use
10-minute waiting request (`setup_states`, purpose `enable_production`); the passphrase on the setup page consumes it. `github_disable_production` turns it off at once.

### Protected resources and project ownership (B-3)

`src/tools/protect-guard.js` runs after the production gate. The list (`protected_resources`, seeded once with the IN-08 default and edited only on the setup page) has two
levels: `locked` refuses every write; `pr-only` allows only the pull-request routine (an allow-list of tool names, away from default and protected branches) and merges by
the three merge tools with an exact `expectedHeadSha`. Anything else, and any unknown tool name, is refused. Project ownership asks `ctx.profileFor(owner, repo)` (Batch P) for
`ownedRefs`; a write to an owned ref is refused naming its workflow unless `outsideProject: true` (then it asks first); `agentMay` lets the project's own agent steps through.
A list that cannot be read refuses the change.

### People and spend guards (B-4)

`src/tools/people-guard.js`: "your own people" are connected accounts, their organization members (read from GitHub, cached 10 minutes; unreadable means outsiders),
`github-actions[bot]`, this server's App bots and extra names set on the setup page (`server_settings` key `own_people`). Tools call `notifyOutsiders` (mentions, assignees,
reviewers, repositories of unconnected accounts), `accessChange`, `invitation` and `becomesPublic` from `classify`; access changes and outsiders always ask first.
`src/tools/spend-guard.js` and `src/github/prices.js`: a spend tool's cost comes from the price table (each price has source URL and date), is refused at the default $0 limit,

and must fit the account's monthly limit (`gh_accounts.spend_limit_cents`) minus the month's spend (Denver calendar month, summed from `change_log.spend_cents`, rejected changes excluded).
Only the setup page raises the limit; `github_set_spend_limit` only lowers it.

`src/github/wiki-git.js` (Y-8d) is the only place that speaks git: an in-memory clone of `<repo>.wiki.git` over the injected fetch, restricted to that path, with transfer and size limits. `src/data/readbacks.js` (Y-9b) maps guided settings to GET routes and value pointers for `github_admin_check_setting`.

`gh_async_jobs` (Y-8): one row per slow GitHub operation a tool started (`job_` + 16 hex, owner connection, kind, provider reference, state pending/ready/failed/expired, result handle, 24-hour expiry). `github_job_status` asks GitHub at most once per call and at most every 10 seconds per job (`claimJobPoll`); a finished result is kept with `putResult`. Only the connection that started a job can see it. `src/core/zip-reader.js` opens artifacts and repository snapshots in memory with limits (50 MB zipped, 200 MB unpacked, 500 files; unsafe names, links, encrypted and zip64 refused). Download addresses GitHub hands out are fetched through `downloadPublicAsset` (public HTTPS only) and never returned.

`src/github/spend-classes.js` (Y-1): `FREE_ROUTES`, the reviewed-free set of universal REST routes (self-hosted runner and runner-group administration, OIDC customisation, deployment approvals, package delete/restore, Pages rebuild, artifact-metadata records). `classifyUniversal` keeps `spendRisk` true for any write whose text matches a spend word unless its exact `METHOD /path` is listed; `tests/unit/spend-classes.test.js` checks every key against the vendored description and pins both counts (54 free routes, 100 still-blocked writes).

`src/github/graphql-writes.js` (Y-2): `WRITE_SPECS`, one reviewed entry per GraphQL mutation (24): ownership scope (repo or org), the ID types each input may resolve to, the before/after selection, `already`/`verify` predicates, the inverse and the marks. `github_graphql_write` runs a spec-aware path (every ID resolved and type-checked into the enrolled account, spec read before and after, concurrent-change check, extra preflights: at most 3 pinned issues, repository admin for issue deletion); mutations without a spec keep the two legacy shapes or are refused. Specs never lower the generic access/notification marks. A spec with an inverse records `{tool: github_graphql_write, args}` for `github_undo_change`.

`src/tools/public-read.js`, `users-public.js` (Y-3): GET-only allowlist for reading other accounts' public data, actor credential U else I, identical answer for private and missing repositories. `src/tools/social-write.js` (Y-3): follow, watch, profile links and star lists as the signed-in user. `src/tools/projects-gql.js`, `projects-manage.js`, `projects-items.js` (Y-4): Projects v2 lifecycle over GraphQL; `loadProject` proves ownership from GitHub, `mergeOptions` keeps select-option ids.

`src/tools/moderation.js`, `org-planning.js` (Y-5): pin, delete and hide comments and issues, discussion management, linked branches, organization issue types and fields, interaction limits and autolinks. GraphQL tools reuse the Y-2 `WRITE_SPECS`; deletes are production-class with no undo; `mergeFieldOptions` keeps select-option ids. `src/tools/runners-read.js`, `runners-write.js`, `actions-limits.js` (Y-6): self-hosted runners and groups (public repositories opt-in, busy runners never removed), registration/removal/JIT tokens sealed in the one-time store (only the setup-page address is returned), Actions cache/artifact/OIDC limits (an increase is spend-classed at a placeholder cent, so it is blocked at a $0 limit), custom deployment protection rules and Pages build requests.

`src/tools/advisories.js`, `security-scanning-writes.js`, `security-config.js` (Y-7): security advisories (description text never leaves GitHub except as a SHA-256 in results and the change log; publish is public and irreversible and needs the GHSA id typed twice), code scanning default setup, custom secret-scanning patterns, Dependabot organization access, and organization code-security configurations. Paid features on private repositories are refused rather than priced: code scanning default setup refuses private repositories, and a configuration with paid settings is only attached to public repositories and cannot be the default for new private ones.

### Errors and result shaping (B-5)

`src/tools/errors.js` turns a GitHub failure into four parts (what happened, likely cause, what to do, one technical line with the request id); unknown errors keep the plain
status line. `src/tools/util.js` `shapeResult` runs on every result in `src/tools/dispatch.js`: secret-named fields and token- or key-shaped text become `[hidden]`; times gain
`_local` (the person's saved time zone, UTC when none is saved; set on the connect page or the setup page, kept in the `time_zone` setting); whole cents gain `_display`; text from people whose `author_association` is not OWNER, MEMBER or COLLABORATOR is marked `untrusted: true`; a production
connection's results start with `"mode": "PRODUCTION"`. The dispatcher still withholds anything credential-shaped that survives shaping.

### Profiles and downscoped tokens (B-6)

A connection's profile (`read_only`, `everyday`, `full`) decides which tools exist for it: read tools are visible to all, a write tool only to the profiles it lists
(`src/core/registry.js` `toolsForProfile`); `tools/list` shows only those and a hidden tool called by name answers "unknown". For `read_only`, the installation token is
minted with every permission the installation has at `read` (`workflows` and `profile` exist only at write and are left out); unknown installation permissions refuse the
token rather than send an empty list (which GitHub reads as "everything"). Fine-grained-token accounts cannot be narrowed. The home page prints `tools_by_profile`.

### Listing and the meta-tools (C-2)

`tools/list` is built by `toolsForListing(registry, profile, listing)` and `listedTool` (`src/core/registry.js`): `catalog` is every tool the profile may see, `compact` only tools marked `compact`; dangerous tools get PRODUCTION / SPENDS MONEY first and every tool is listed with its annotations. `?listing=` on the endpoint overrides the connection's choice. `github_call` / `github_batch` receive `ctx.callTool`, which is the dispatcher itself. `scripts/check-budgets.mjs` counts what is listed with `gpt-tokenizer`.

### Small results (C-1)

Read replies go through `readReply` in `src/tools/dispatch.js`: summary form (tools defined with `defineRead` and a `summaryType`; `detail: 'full'` for the whole object) → shaping (`shapeResult`) → `fields` (keeps `untrusted`, brings `_local` times) → the full result is kept if anything will be cut → text caps → 8 KB fit. Rules live in `src/core/result-rules.js` (4,000 characters, 400 log lines, 8,192 bytes, 20 per page, 100 max). `kept_result` in a reply carries the handle; `github_get_result` reads it for the same connection only and shrinks a page that would not fit.

### Connection tools and the write-safety check (B-7, B-8)

`github_list_connections` lists connector logins that use only accounts the caller also has; `github_revoke_connection` switches one off (only if all its accounts are the caller's) and `github_set_default_account` changes the default of the caller's own login. `src/db.js` `getAccessToken` records `last_used_at` at most once a minute. `github_recent_changes` reads `change_log` limited to the caller's accounts (`listChanges({ accounts })`). `defineWrite` accepts `price`; `scripts/check-writes.mjs` reads `docs/TOOL-CATALOG.md` and fails any drift (run by `npm run check` and CI).

### Diagnostics tools and data files (B-8b)

`src/tools/server-diagnostics.js` holds `github_check_permissions` (stored installation permissions against `src/data/permission-needs.js`), `github_rate_status` (database rate state plus a direct, unguarded `GET /rate_limit`) and `github_where_is_setting` (`src/data/dashboard-map.js`, plain-words search, `{org}` / `{user}` filled from the connection). The data files are plain frozen arrays; tests tie them to the App manifest and the tool catalog.

## GitHub App permissions

The owner-installed custom scratch App has 41/41 recorded installation permissions matching its App permission record as of 2026-10-12 (Y-1 added six more names to the manifest for Apps created later; the existing App gains them only when the owner approves them on github.com, see the GO-LIVE row and `github_where_is_setting` "app permissions"), active across All repositories (2026-10-12). No production write switch is enabled; other real-work account Apps are not yet installed. The desired manifest lives in `src/github/app-manifest.js` and `docs/DEPLOY.md`; do not conflate the ChatGPT standard GitHub connector's installation with this server.

## Developer scenario ledger (V-1 part 1, PR #65)

`dev_runs`, `dev_run_objects` and the immutable first-create observation table `dev_repo_birth_labels` are additive tables created by `createDb.initSchema()`; `createDevLedger(sql)` offers atomic account+connection-scoped run creation, exact object recording, and bounded lists. The same behavior is asserted for PostgreSQL and the fake. `src/dev/scenarios.js` is plan-only: six scratch-only executable scenarios and guarded private scratch creation exist in code with fake, database and request-shape tests; owner IN-06 designation is verified but authenticated custom-MCP read/write/cleanup acceptance is not. Unit CI uses two file-level shards under the unchanged aggregate `ci` gate.


## V-1 execution-intent journal (#67)

`src/dev/ledger.js` (mounted in `createDb(sql)`) now reserves each scenario step in additive `dev_run_intents` before any external call. Its `(run_id, step_id)` key gives exactly one worker a claim. A request that might have reached GitHub is marked `uncertain`, never automatically replayed. `completeDevIntent` is one PostgreSQL statement using data-modifying CTEs: mark the exact step `recorded` and insert the real returned GitHub ID in `dev_run_objects` atomically. Every operation checks account and connection; fake and isolated PostgreSQL share `runDevLedgerContract`. No real GitHub seed tool is enabled by the journal alone; IN-06 still gates live scratch work.


**#68 read exposure:** `src/tools/dev-runs-read.js` registers `github_dev_list_scenarios` and `github_dev_list_runs`. Scenario plans say `plan_only` and `execution_available: false` until a real safe seed exists. Run reads are scoped to the connected account and client ID, with bounded saved-object and claimed/uncertain/recorded-step details via `listDevIntents`; no GitHub API call or mutation. Scratch eligibility is derived solely from the server's `gh_accounts.is_scratch` and `account_type`, never asserted by caller arguments.


**V-1 scratch gate (#69).** `src/dev/scratch.js` trusts only `gh_accounts` metadata: `is_scratch`, Organization, a configured GitHub App and active installation across all repositories; production connections or enabled production switch refuse before a GitHub read. `src/dev/execute.js` is the shared one-winner step claim and object journal for GitHub mutations, with an uncertain state on unknown outcomes. `src/tools/dev-scratch-write.js` exposes guarded `github_dev_create_scratch_repo`; it creates a private, `rtc_run=<runId>`-described repository and records the returned exact `full_name`. Fixture App credentials are mocks for tests only; the owner has now enabled one real scratch account, but no real run-owned write has been executed.


**#70 scenario execution:** `src/tools/dev-seed-write.js` runs the first two approved scenarios (`repo-basic`, `failing-ci`) against actual pinned GitHub routes with shared owner-only scratch verification and one-winner step journal. Each creates a private run-labelled repository, a run-specific YAML workflow (manual `workflow_dispatch` only; no surprise CI billing) and either a labelled GitHub repository label or a `rtc/<runId>/failure-ref` branch pointing at the recorded workflow commit. Readback checks the file contents, repo visibility/marker, final object and all exact IDs in the scoped ledger. Later PRs added four more runnable scenarios (six total); `webhook-target` remains plan-only pending V-4. Owner IN-06 configuration is now verified; OAuth-connected scratch write and actual workflow dispatch are not.

## Verified runtime and connected-acceptance boundaries (2026-10-12 UTC; draft #83)

- Production HTTP responses from a temporary network-restricted Vercel sandbox: authorization-server OAuth discovery GET 200; protected-resource metadata GET 200; `/api/github/setup` GET 200; `/api/mcp` GET/JSON-RPC initialize POST without token 401 + proper Bearer resource-metadata challenge. **The landing-page `/` route incorrectly returns 404**, despite the code's intended `api/index.js` route (investigate Vercel routing and add regression).
- Neon state: `oauth_clients=0`, active `oauth_tokens=0`, `dev_runs=0`, `dev_run_objects=0`. GitHub App installation stored active, all repositories, 41 matching permissions, `is_scratch=true`, `production_enabled=false`, spend limit $0; owner audit confirms enablement. No actual custom MCP OAuth grant exists yet. Standard GitHub connector use to administer the repository does **not** prove the custom server works.
- The temporary Vercel sandbox was stopped after testing. **No external GitHub resources were created/modified/deleted** through the custom server. Do not perform a live scratch-repository test before owner-authorized preview OAuth and verified run-owned cleanup/recovery (V-2 cleanup unbuilt). Encryption key rotation after real App registration requires a migration/re-enrollment plan.

**#126 — first-create scratch-label observation is not a deletion grant.** After the exact scratch-repository POST and verified initial default-branch SHA, V-1 boundedly reads the initial labels. A single PostgreSQL CTE statement atomically saves this exact-ID metadata with the repository object and recorded intent; incomplete or ambiguous reads leave a non-replayable uncertain intent. The label API does not identify who created a label: a concurrently inserted foreign label could appear in this first inventory, so the observation does **not** allow V-2 to delete any unjournaled label or the parent repository. Fake and disposable PostgreSQL contracts verify isolation and immutability. Custom OAuth-connected acceptance remains unverified.

**#127 read-only first-create audit:** An exact connection-owned `github_dev_list_runs({runId})` response summarizes the immutable label observation, original commit and complete-journal binding. `includeBirthLabels:true` returns exact initial IDs, names, colors and descriptions, subject to existing result-handle budgets. The observational data never authorizes cleanup; a missing/incomplete journal, absent record or mismatch remains explicit. This tool performs no new GitHub calls or writes; independent remote readback and custom OAuth-connected TEST acceptance are still required.

**#128 live remote V-2 preflight:** The preview-only connection-scoped `github_dev_list_runs({runId,repo,remoteCleanupPreview:true})` reuses `readCleanupRun` and the full `inspectScratchArtifacts` remote inventory to reveal a precise blocker category without entering cleanup/freeze, writing GitHub or authorizing deletion. Any eventual cleanup independently repeats full checks under its own explicit owner approval; a passing non-atomic snapshot is not a clearance. Tests include the real fake-provider request surface; custom OAuth-connected proof remains separate.

**#129 first-read label identity drift:** Existing `github_dev_list_runs({runId,repo,remoteCleanupPreview:true,includeBirthLabels:true})` compares the first recorded numeric label IDs and metadata to an independent complete live listing plus the current default-branch SHA. Later label additions, missing IDs and same-ID edits are explicit, including same-name recreated labels. A matching baseline is **not GitHub creator proof** and grants no deletion authority; missing/incomplete/foreign snapshots still refuse cleanup. The report performs no mutations.

**#130 protected custom-service OAuth readiness:** Existing `POST /api/github/setup` `action=status` continues to require same-origin CSRF, rate-limited admin passphrase and locked-down CSP. It now reads aggregate registered dynamic OAuth clients, unrevoked *connector* tokens, unexpired access tokens and stored refresh credential counts, excluding RTC read-only passes, and shows a grounded next step and the exact public HTTPS MCP endpoint. No bearer, hash, client ID, private installation detail or credential is exposed on unauthenticated GET. These counts do not certify an OAuth connection, deployed version, production mode or custom-MCP run acceptance; owner must complete an approved external connector OAuth flow.

### V-2 exclusive cleanup executor (#132)

`dev_cleanup_executions` is an additive table with one primary-key row per `dev_runs.id`, a server-generated executor UUID and acquisition time. Both cleanup modes acquire it before lifecycle freeze or provider mutations. The row is scoped through the run account/connection; only the exact executor can release. Success and definite provider rejection release; transport errors, 408/5xx, database ambiguity or a crashed worker retain the row. There is no TTL or automatic takeover. `github_dev_list_runs` exposes acquisition time and recovery instructions only; remote cleanup preflight reports `CLEANUP_EXECUTION_UNRESOLVED`.

Recovery is an explicit owner-authorized administrative action after establishing the old invocation has stopped and independently reconciling every affected remote object and journal row. Do not delete the claim merely because it is old, reset the run to active, infer deletion from a 404 permission failure, or retry an uncertain DELETE blindly. No public unlock endpoint is implemented or implied. A retained claim blocks only that run, not independent roadmap work.

### RTC service identity and current HTTPS subset (#135)

The unauthenticated `/api/contract` and authenticated `/api/whoami` report safe self-identity, including canonical Vercel build SHA or null. This is not independently verified deployment evidence. Manifest `https_subset` describes only the existing preview/read_only, server/meta pass door; top-level catalog totals still describe standalone MCP. `src/rtc/scope.js` owns the shared actual selector for HTTP dispatch and subset counts; no provider credentials, state or canonical tools move to Hub or shared core. Full conformance remains rtc:0.

### RTC ordered batch retention (#144)

The restricted batch door validates every item against the canonical tool schema before
executing any read. It still rechecks current DB authority/rate per item. An aggregate
exceeding 8192 UTF-8 bytes is retained using the existing connection-owned 24-hour
result store, with a complete-row preview, count/shown, top-level handle and next
page=1/pageSize=1 for `/api/results/{handle}`. Original child handles remain in the
full ordered aggregate. Storage failure produces sanitized service_error/503.

## W workflow engineering — October 15

`workflows-health.js` composes bounded W-5 reviews; `workflows-release.js` composes guarded W-6 release/cleanup. `workflows-find.js` implements W-7 standard setup, scoped discovery and date-bound usage digest. `vulnerability-alerts.js` supplies the actual repository enabled-state/control prerequisite. Workflow provider operations stay in registered readers/writers through the shared dispatcher; result handles remain connection-owned. No new schema, environment variable or credential kind. Actual READY source and product acceptance remain separately recorded in STATUS/developer-evidence; this paragraph does not claim live rollout.

V-4/V-5: `dev_forwarders` is an additive table (id, account, connection, URL, events, AES-GCM ciphertext secret, optional run and repository). `src/dev/forward-sender.js` is the only code that contacts a developer-registered address: public HTTPS on 443, public DNS answers only, pinned address, no redirects, 10-second timeout, 1 MB limit, no retry. `src/tools/dev-forward-write.js` holds the forwarder tools and the scratch-only test webhook; `src/tools/dev-forward-read.js` lists forwarders; `src/tools/dev-integration.js` is the read-only integration checker.

V-1/V-2 (bundle 2): `src/dev/forwarders.js` holds the shared forwarder helpers (`registerForwarder`, `forwarderSecret`). The `webhook-target` seed registers a run-bound forwarder; `deleteDevRunForwarders` removes run-bound forwarders during cleanup after the repository is confirmed gone.

X-1/X-2: `src/tools/undo.js` is a registry runner (`github_undo_change`): it reads the change-log row, checks scope, confirmation, production mode and newer same-family changes, then calls `ctx.callTool` with the stored inverse. `scripts/smoke-readonly.mjs` selects read tools, passes only fixture arguments, hands the server a GET/query-only network function and renders `docs/audits/smoke-<date>.md`. Private vulnerability reporting is read from `GET …/private-vulnerability-reporting` and written with PUT/DELETE; an unreadable status stays null and a write refuses.

R-1/R-2/R-3: `src/rtc/pass-scope.js` holds the pure rules (`validateGrant`, `connectionFromPass`, `passRefusal`, `passTools`). Table `rtc_pass_grants` (additive) stores a pass's profile, mode, areas, repositories, write, access-change and spend permissions and Hub flag; `rtc_pass_scopes.rate_limit_per_minute` stores the request limit that `consumeRtcPassRate` reads in the same atomic statement. `createRtcPassGrant` creates the token row, legacy scope row and grant row in one statement. `src/rtc/http.js` authenticates a grant pass (account active; production needs production on), lists `passTools`, runs changes through the dispatcher and answers with `writeReply` (preview/needs-confirmation/applied/replayed with the change-log id; refusals 403 `refused_by_guard`; unknown outcomes 503). `createDispatch` applies `passRefusal` to every call including nested ones; `passAccessGate` and the per-pass spend cap sit in the gates; `githubFor` narrows installation tokens to a repository pass. The setup page action `create-scoped-pass` issues any pass; `github_create_pass` issues preview passes only. `test/helpers/rtc-fixture.js` serves a fixture registry through the real handler for the pinned runner.


### CAP-3 private optional browser enrollment source contract (2026-10-22)

`api/tenant/optional.js` renders HTTPS-only protected entry for a signed private tenant MCP client selected by `github_check_permissions`, never for RTC passes, non-tenant clients or the global owner credential pool. `src/tenancy/optional-setup.js` checks current tenant namespace/allowlist/membership, exact active App account, singleton registered client redirect and an allowlisted K/P operation. Root `gh_tenant_optional_setup_states` saves only SHA-256 state hash, client/account/kind, original registered return, CAS snapshot, active epochs and 10-minute expiry; atomic DELETE burns it before any GitHub request. The POST uses origin check, same-site HttpOnly cookie, a matching hidden one-use CSRF state, disabled caching and strict CSP. `src/tenancy/optional-credentials.js` verifies provider numeric `GET /user`, the exact harmless operation and GitHub-issued scope header before sealing the selected PAT with tenant/identity/account/kind/host AAD. Renewal and same-person revocation use SQL compare-and-swap; changed epoch, foreign account/resource or failed provider proof never authorizes a replacement. The registered callback receives status-only parameters, not any credential. The client must explicitly call permission diagnostics again to observe *historical* readback. K/P are not automatic unrestricted runtime fallback and provider writes are not retried after refusal. Root emergency cleanup deletes only affected pilot states.

The new form is disabled absent production, signed private pilot enrollment and the prior APP/tenant configuration. This is source implementation pending exact-head CI, real GitHub/device acceptance and separate production rollout, not evidence of a new live grant.


### CAP-3 final scoped optional HTTP read routing (source candidate)

The signed tenant MCP bearer creates `createTenantScopedCredentials` with no owner fallback. Only K/P grants with current tenant/member/pilot epochs, matching numeric GitHub principal, connected App account, exact operation/resource/host/scope, unexpired one-time proof and matching ciphertext SHA-256 are decrypted using tenant/actor/account/kind AAD. `src/github/client.js` calls `credentials.authorizeOptionalRequest` **on each actual expanded Octokit request**, before rate accounting, write spacing or transport. Private K is narrowly limited to `GET /user` (needed for live numeric identity) and `GET /notifications`; private P to `GET /orgs/{exact_account}/packages`. All writes and other reads are refused even with a physically wider PAT. RTC service passes cannot take private K/P. Owner legacy package path continues to use the old global package scope/route guard without change. These assertions are made *after* historical enrollment readback; actual GitHub execution still receives provider-side current permission checks. Browser completion status alone never guarantees that an actual read now works.

Outbound hosts besides the GitHub API (PAR-1): `docs.github.com` search for `github_docs_search` only (`src/github/docs-search.js`; read-only, no credentials, fixed origin and path, redirects refused, 8-second timeout, one retry).
