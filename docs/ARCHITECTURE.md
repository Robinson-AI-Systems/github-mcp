# ARCHITECTURE — runtime facts, as built

> **Current authority and parity remediation (2026-10-28):** [requirements](OWNER-DECISION-2026-10-27.md), [delivery plan](designs/AUTHORITY-PARITY-2026-10-28.md). Full owner writes disclose/execute/journal/verify in one call; explicit delegated restrictions remain. Older dated statements about owner caps, production ceremony and mandatory merge gates are superseded. Source delivery and live acceptance remain separate.

This file describes what **exists in source on `main`**, and is updated in the same PR that ships a change. Designs are in `docs/designs/`; do not copy design text here before it is built. Source merged, released (`live`), deployed and really accepted are four different claims; this file makes only the first unless it says otherwise. Live deployment, Neon and Vercel state is not recorded here (it was removed on 2026-10-30 as stale); read `docs/STATUS.md` and `docs/status/` for dated evidence.

## Private tenants and public sign-in (PUB-1..PUB-5, CAP-3)

**Storage (PUB-1).** `src/tenancy/directory.js` implements a separately initialized identity/tenant/membership registry (numeric provider-verifiable GitHub subject, opaque UUID tenant, owner/admin/member role, monotonic membership revision). Each tenant has its own `gh_t_<32 hex>` PostgreSQL **schema** holding the 29 ordinary tables of `SCHEMA_TABLES`, so account logins, hashes, project profiles, results, audit and run state are scoped by the connection's per-query search path. The Neon HTTP connection sets `options=-c search_path=<exact tenant schema>` at startup (never pooled `SET search_path`); before reading credentials the store checks both `current_schema()` and `current_setting('search_path')`, and unknown, malformed or mismatched schemas fail closed, never falling back to `public`. Legacy owner data stays in the original namespace.

**Sign-in (PUB-2, #264).** Adds a server-issued tenant-client `tcl_`, access `tac_` and refresh `trf_` routing format, scoped by per-tenant and per-identity membership epochs, with bearer hashes stored in the tenant's own PostgreSQL schema. A genuine GitHub provider `/user` and App installation check is required by the browser OAuth callback; state is browser-cookie bound, one-use and PKCE-protected. The service's standard `/api/oauth/authorize` detects pre-enrolled private clients and routes to the mobile-sized GitHub consent form **without exposing `ADMIN_PASSPHRASE`**; owner clients retain the original supported login. An owner-only, passphrase/CSRF-protected PRIVATE scratch pilot can create an isolated test tenant, register clients or allowlist a second verified GitHub identity. This controlled testing invitation path is **not** the final customer's onboarding model; future supported clients must use their own delegated GitHub authorization. Tenant U grants are encrypted per human and tenant, installation I credentials remain owner-scoped, and disabled/suspended/revoked identities fail closed. Routes: `api/tenant/oauth/authorize.js`, `api/tenant/oauth/callback.js`, `api/oauth/*`. The private-pilot machinery is on only when `GITHUB_PRIVATE_TENANT_PILOT=enabled` with `GITHUB_PILOT_APP_ID`, `GITHUB_TENANT_ROUTING_KEY` and `DATABASE_URL` set.

**Public connect (PUB-5/LAUNCH-1).** Off unless `GITHUB_PUBLIC_CONNECT=enabled` on the production deployment with the tenant machinery configured (`src/tenancy/public-connect.js`): registration then creates public clients (`pcl_`). Controls: `GITHUB_PUBLIC_INVITE_ONLY`, `GITHUB_PUBLIC_NEW_SIGNUPS=paused`, `GITHUB_PUBLIC_MAX_CLIENTS`, `GITHUB_PUBLIC_MAX_OPEN_FLOWS[_PER_CLIENT]`, usage limits (`PUBLIC_FREE_CALLS_PER_DAY` 5000, `PUBLIC_FREE_WRITES_PER_HOUR` 300, `PUBLIC_UNLIMITED_SUBJECTS`), cost estimate alert/pause (`PUBLIC_COST_*`), inactivity cleanup (`PUBLIC_INACTIVE_DAYS`, default 180) and trust pages (`LEGAL_APPROVED=yes`, `PUBLIC_SUPPORT_EMAIL`). Whether it is enabled on the live deployment: unverified.

**Capacity and incident protection (PUB-3).** Admission uses `src/tenancy/runtime-limits.js` on each separately verified PostgreSQL schema and does not alter the legacy owner connection. The tenant-scoped quota function `gh_claim_tenant_capacity` atomically reserves BOTH tenant and individual client capacity using an inner PL/pgSQL rollback savepoint, so a client over its own cap cannot starve another authorized user. Per-tenant minute MCP/OAuth admission happens before handling real private MCP or private token/GitHub-browser consent, while bounded daily job starts and retained JSON bytes are enforced through a tenant-only `createDb` facade. Limits are fair-use capacity controls, not permission/spend/production grants. Missing schema/function or revoked tenant returns a narrow failure and never falls back to the global owner's account. Only aggregate event/outcome/latency buckets in fixed enums are recorded; signed client IDs are SHA-256 hashed for quota keys, not exposed. A best-effort 1/128 opportunity cleans bounded expired quota/aggregate metric records, while jobs/results already have 24h TTL and bounded expiry deletion. `src/tenancy/incident-cleanup.js`, the server-owned tenant directory and the protected owner setup emergency revoke coordinate tenant-scoped removal of pending auth codes, bearer sessions, clients, jobs/results and encrypted per-user U grants; no public or ordinary MCP user invokes this action.

**Private user metadata binding and optional credentials (CAP-3).** Adds nullable JSONB `authority_binding` to the existing directory table `gh_tenant_user_authorizations`; no second bearer store is introduced. Idempotent initialization and the first trusted consent/refresh write ensure the additive column exists. Legacy reads use `to_jsonb` so an upgraded read does not require prior migration, copy ciphertext, or silently certify legacy authority. Consent/refresh seal tokens with the existing tenant/identity/account AAD; proof records bind ciphertext fingerprint, verified numeric human, membership/pilot epochs, account/App/installation, fixed GitHub.com host, expiry and exact `GET /user`/`user/<subject>` identity-read scope. Proof and ciphertext are replaced atomically; null-proof replacement cannot retain earlier verified status. `createTenantScopedCredentials.operationAuthority` reports only the exact stored/readback proof without decrypting and never authorizes provider dispatch. Additional credential kinds, protected/native upgrade enrollment and full resource readback remain unimplemented CAP-3 work. Additional credential kinds beyond K/P and protected/native upgrade enrollment: unverified / not implemented.

## Infrastructure

| Piece | State |
|---|---|
| Repository `Robinson-AI-Systems/github-mcp` | Public; changes only through `ai/*` PRs into `main`; `live` is advanced only by the daily workflow (`.github/RELEASE-POLICY.md`, `docs/HOSTING-COST-POLICY.md`) |
| Runtime | Node **24.x** (`package.json` `engines`, `"type": "module"`, `node-version: 24` in CI) |
| Dependencies | Pinned exactly, `package-lock.json` committed; `npm ci`. Runtime: `@modelcontextprotocol/sdk` 1.32.1, `@neondatabase/serverless` 1.2.0, `@octokit/core` 7.0.8, `@octokit/plugin-paginate-rest` 16.0.0, `@octokit/plugin-throttling` 11.0.5, `@octokit/plugin-retry` 8.1.1, `@octokit/auth-app` 8.3.1, `@octokit/webhooks` 14.2.0, `isomorphic-git` 1.44.2 and `memfs` 4.80.0 (wiki git, `src/github/wiki-git.js`), `libsodium-wrappers` 0.8.4, `ajv` 8.20.0, `ajv-formats` 3.0.1, `graphql` 17.0.2. Dev: `vitest` 5.0.3, `pg` 8.23.1, `eslint` 10.12.0, `gpt-tokenizer` 3.4.0, `playwright` 1.64.1 |
| GitHub Actions CI | `.github/workflows/ci.yml` on PR and push; read-only token, no secrets or `pull_request_target`. Jobs: `check`, `unit` (6 shards), `db` (disposable Postgres), `shapes`, `rtc`, `browser` (Playwright container, sharded); aggregate **`ci`** requires all. Both **`ci`** and **`release-policy`** are mandatory at the exact head. Layout, pins and timeouts are guarded by `scripts/check-ci-layout.mjs`. Other workflows: `daily-live.yml` (promotion to `live`), `coding-workspace-image.yml`, `native-git-image.yml` (image builds, no deploy), `git-housekeeping.yml`, `prune-merged-branches.yml` |
| Test harness | `test/helpers/fake-github.js` (`makeFakeGitHub()` → `{ fetch, calls, unmatched, graphql, when, routes }`, passed to Octokit as `request.fetch`; A-1 route list, A-4 adds the vendored description and validation); `test/helpers/write-contract.js` (the nine write-contract checks through every door), `test/helpers/rtc-fixture.js` (a fixture registry served by the real RTC HTTPS handler for the pinned conformance runner), `test/helpers/http-harness.js`, `sample-writes.js`, `dev-ledger-fake.js`, `fixture-gates.js`; `test/helpers/fake-db.js` (`createFakeDb({ clock })`: key/value rows, `initSchema()`/`listTables()`, and the login store; `seedAccounts()` is its test seam for `gh_accounts`); `test/contract/oauth-contract.js` (one login-store contract run against the fake and real Postgres); `test/helpers/pg-neon-adapter.js` (isolated `github_mcp_test_*` schema, Neon-shaped tagged queries); `test/contract/db-contract.js`; `scripts/local-postgres-test.sh` (CI service via `TEST_DATABASE_URL`, else a temporary local cluster; localhost only) |
| Tool registry | `src/tools/index.js` merges the tool modules (`mergeNamespaces`) and marks the compact listing set. **498 tools = 492 hand-built + 6 universal** (`docs/TOOL-CATALOG.md`, checked by `python3 scripts/count-catalog.py`). Compact `tools/list` exposes 26 tools (13 developer tools in `COMPACT_DEVELOPER_TOOLS`, the meta/workflow shortcuts and `github_secret_scanner`); `node scripts/check-budgets.mjs` measures 4,956 of 5,000 tokens compact and 10,875 of 22,000 for the largest everyday page (2026-10-30) |
| Hosting | Vercel (functions `api/**/*.js`, `maxDuration` 60; Git deployments only for `live`; `PLAYGROUND_RESOURCE_MODE=best_effort` set in `vercel.json`) and Neon Postgres (`DATABASE_URL`). One Vercel cron: `/api/marketplace/sweep` hourly at :17 (`vercel.json`). Project IDs, plan, compute size and current serving commit are deliberately not recorded here: unverified from source |
| Execution hosts | Native Git worker (`workers/native-git`) and the Playground (`workers/coding-workspace`, provisioned through Dokploy by `src/playground/`); see `docs/NATIVE-GIT-OPERATIONS.md`, `docs/PLAYGROUND-OPERATIONS.md`, `docs/CODING-WORKSPACES.md` |
| GitHub Apps and credentials | Per-account Apps are stored in `gh_apps`; credentials are AES-256-GCM ciphertext keyed by `TOKEN_ENCRYPTION_KEY` (never disclose or rotate without a migration; `TOKEN_ENCRYPTION_KEY_PREVIOUS` may list up to two older keys for decryption). Which Apps are installed in the live database: unverified |

## Environment variables

Never record values here. Vercel provides `VERCEL_ENV` and `VERCEL_GIT_COMMIT_SHA`. Names below were collected from `process.env`/`env.` reads in `src/`, `api/`, `scripts/` and `vercel.json` on 2026-10-30.

| Variable | Read by | Meaning |
|---|---|---|
| `DATABASE_URL` | `productionSql()` in `src/db.js` (first use, never at import) | This server's Neon database; previews share it and never offer production mode |
| `PUBLIC_BASE_URL` | `publicOrigin()` in `src/core/http.js` | HTTPS origin, no path (OAuth issuer, MCP resource, Playground control origin); never taken from a request header; missing or malformed makes OAuth answer 503 |
| `ADMIN_PASSPHRASE` | `src/core/oauth-handlers.js` | Owner sign-in passphrase; missing fails closed with 503 |
| `TOKEN_ENCRYPTION_KEY`, `TOKEN_ENCRYPTION_KEY_PREVIOUS` | `src/core/crypto.js` | Base64 32-byte AES-256-GCM key for every stored credential; previous = at most two decrypt-only keys. Also the root for the purpose-separated Ed25519 native-worker signing key (HKDF, `src/native-git/signing.js`) |
| `VERCEL_ENV`, `VERCEL_GIT_COMMIT_SHA` | `src/oauth/policy.js`, `src/rtc/scope.js`, `api/index.js` | Only `production` allows production mode; build SHA is self-reported and not independent deployment evidence |
| `GITHUB_STATELESS_INSTALLATION_TOKENS` | `src/github/credentials.js` | Installation-token format switch |
| `GITHUB_PERSONAL_RATE_RESERVE` | `src/github/act-as.js` | Requests held back from a person's own rate budget (default 100) |
| `GITHUB_PRIVATE_TENANT_PILOT`, `GITHUB_PILOT_APP_ID`, `GITHUB_PILOT_APP_CLIENT_ID`, `GITHUB_PILOT_APP_CLIENT_SECRET`, `GITHUB_TENANT_ROUTING_KEY` | `src/tenancy/*` | Private tenant machinery (`enabled`); the shared pilot App; routing-key for signed tenant bearers |
| `GITHUB_PUBLIC_CONNECT`, `GITHUB_PUBLIC_INVITE_ONLY`, `GITHUB_PUBLIC_NEW_SIGNUPS`, `GITHUB_PUBLIC_MAX_CLIENTS`, `GITHUB_PUBLIC_MAX_OPEN_FLOWS`, `GITHUB_PUBLIC_MAX_OPEN_FLOWS_PER_CLIENT` | `src/tenancy/public-connect.js`, `directory.js` | Public sign-in switches and caps |
| `PUBLIC_FREE_CALLS_PER_DAY`, `PUBLIC_FREE_WRITES_PER_HOUR`, `PUBLIC_UNLIMITED_SUBJECTS`, `PUBLIC_COST_PER_1K_CALLS_CENTS`, `PUBLIC_COST_ALERT_CENTS`, `PUBLIC_COST_PAUSE_CENTS`, `PUBLIC_INACTIVE_DAYS`, `PUBLIC_SUPPORT_EMAIL`, `LEGAL_APPROVED` | `src/tenancy/public-usage.js`, `usage-cost.js`, `public-inactive.js`, `trust-pages.js` | Public fair-use, cost estimate, cleanup and trust-page settings |
| `GITHUB_MARKETPLACE_CONNECT`, `GITHUB_MARKETPLACE_PLAN_ID`, `GITHUB_MARKETPLACE_WEBHOOK_SECRET`, `CRON_SECRET` | `src/marketplace/lifecycle.js` | Marketplace lifecycle (production only); `CRON_SECRET` (at least 32 chars) authenticates `/api/marketplace/sweep` |
| `NATIVE_GIT_WORKER_URL`, `NATIVE_GIT_PREVIOUS_WORKER_URL`, `NATIVE_GIT_WORKER_CUTOVER_AT`, `NATIVE_GIT_WORKER_DRAINING`, `NATIVE_GIT_WORKER_KEY` | `src/native-git/*`, `src/tools/native-git.js` | Native Git worker routing on the MCP side; `NATIVE_GIT_WORKER_KEY` is only the explicit legacy shared-key mode. Worker-side names: `docs/NATIVE-GIT-OPERATIONS.md` |
| `PLAYGROUND_*` | `src/playground/*` | Dokploy origin/key/project/environment, ingress IPv4, image or build SHA, resource mode, telemetry, drivers: see `docs/PLAYGROUND-OPERATIONS.md` |
| `CODING_*` | `workers/coding-workspace/*` | Runtime-side settings (binding, control public key, idle timeout, preview ports, lifecycle URL): see `docs/CODING-WORKSPACES.md` |

CI and scripts use `TEST_DATABASE_URL`, `BASE_SHA`, `CI_PHASE_LABEL`, `CI_TIMING_FILE`, `GITHUB_TOKEN`/`GITHUB_*` Actions variables, `LOAD_*` (`scripts/load-test-public.mjs`), `RTC_PUBLIC_ORIGIN`, `RTC_AUTH_PASS`, `RTC_PROVIDER_DEPLOYED_SHA`, `GITHUB_MCP_ORIGIN`, `GITHUB_MCP_ACCESS_TOKEN`, `GITHUB_MCP_DEPLOYED_SHA`, `GITHUB_MCP_SCRATCH_ACCOUNT`, `GITHUB_MCP_RUN_ID` and `GITHUB_MCP_RUN_REPO` (never committed, never printed).

## Database tables

`createDb(sql).initSchema()` in `src/db.js` creates the **29** tables of `SCHEMA_TABLES` (one `CREATE … IF NOT EXISTS` each, idempotent, no drops). Credentials are ciphertext (`*_enc`) or hashes (`*_hash`) only; `tests/db/schema.test.js` fails on any other secret-looking column name. Columns: `docs/designs/BATCH-A.md` §2 plus later additive changes in `src/db.js`.

| Table | Holds |
|---|---|
| `gh_apps` | The GitHub App per account: IDs, slug, owner, client ID, encrypted client secret, private key and webhook secret, granted permissions |
| `gh_accounts` | One row per GitHub account: credential kind, installation and status, encrypted user, fine-grained and classic credentials with last four characters, plan, `production_enabled`, `spend_limit_cents`, default and scratch flags |
| `gh_installation_tokens` | Encrypted installation tokens per (installation, scope key) with expiry |
| `setup_states` | Short-lived setup-page states with an encrypted PKCE verifier |
| `oauth_clients`, `oauth_codes`, `oauth_tokens` | Registered connector clients; one-time codes and hashed access/refresh tokens carrying the connection settings (accounts, mode, profile, listing, kind, expiry, revocation) |
| `rtc_pass_scopes`, `rtc_pass_grants`, `rtc_pass_rate` | RTC service passes: legacy scope row and rate limit, scoped grant (profile, mode, areas, repositories, change/access/spend permissions, Hub flag), shared request window |
| `login_attempts` | Passphrase attempts per address (5 in 15 minutes lock it) |
| `change_log` | One row per write attempt: who, where, tool, summary, before/after, dry-run, confirmation, flags, spend, request key, GitHub request ID, inverse, undone-by |
| `gh_write_batches` | `github_write_batch` runs: durable replay-safe outcomes per item |
| `one_time_secrets` | Ciphertext shown once on the setup page, with expiry and viewed time |
| `gh_rate_state`, `gh_write_slots`, `gh_etag_cache` | Rate headers and `blocked_until`; next allowed write time per installation; ETags and bodies for polled reads |
| `server_settings` | Owner settings and internal state as key and JSON value (also Playground manager/allocation state) |
| `protected_resources` | The protected list (`repo`, `installation`; levels `pr-only`, `locked`) |
| `known_projects` | Project profiles (what each project needs from GitHub) |
| `result_store` | Big results kept 24 hours behind a `res_…` handle for one connection |
| `gh_async_jobs` | Slow GitHub operations and native/Playground workspace jobs: owner connection, kind, provider reference, state, result handle, expiry |
| `secret_entry_requests` | A secret the owner will type on the setup page: who/where, 30-minute life, used once; never the value |
| `dev_runs`, `dev_run_objects`, `dev_run_intents`, `dev_repo_birth_labels`, `dev_forwarders`, `dev_cleanup_executions` | Developer scenario runs, created objects, crash-safe write intents, scratch-repo birth labels, webhook forwarders, cleanup executor ledger (Batch V) |

Created outside `SCHEMA_TABLES` by their own modules (all `IF NOT EXISTS`, in the root/directory schema): tenant directory `gh_tenants`, `gh_tenant_identities`, `gh_tenant_memberships`, `gh_tenant_oauth_flows`, `gh_tenant_user_authorizations`, `gh_tenant_optional_credentials`, `gh_tenant_optional_setup_states`, `gh_tenant_pilot_allowlist`, `gh_tenant_pilot_bootstraps`, `gh_public_clients`, `gh_public_flows`, `gh_public_installations`, `gh_public_invites`, `gh_public_usage_daily`, `gh_public_usage_hourly` (`src/tenancy/directory.js`); `gh_tenant_budget_windows`, `gh_tenant_runtime_metrics`, `gh_tenant_storage_slots` (`src/tenancy/runtime-limits.js`); `gh_marketplace_tenants`, `gh_marketplace_subscriptions`, `gh_marketplace_grants`, `gh_marketplace_deliveries`, `gh_marketplace_event_watermarks` (`src/marketplace/store.js`); `developer_oauth_handoffs`, `developer_handoff_limits` (`src/developer/handoff-store.js`).

Login store (`createDb(sql)`): codes, access tokens, refresh credentials and client secrets are stored as SHA-256 hashes only; a code is deleted as it is consumed; refresh is one atomic `UPDATE` on the same row for the same client, so every connection setting (`CONNECTION_FIELDS`) stays as issued; `checkConnection` refuses a connection with no accounts, a default outside the list, or an unknown mode, profile or listing. Index: `change_log_request_key` on `change_log (request_key, at)`. There is no migration directory: schema is code-defined and additive. Which tables exist in the live Neon database: unverified.

## Endpoints

`vercel.json` has 28 `api/**/*.js` function files; dynamic `api/github/[action].js` serves the setup surface. Unexpected failures answer 503 with no detail.

| Path | File | What |
|---|---|---|
| `/` | `api/index.js` (rewrite) | Name, status, tool count, build SHA, home page and brand icons (`/brand/icon-*.png`, `/favicon.*`); nothing secret |
| `/limits`, `/connection`, `/privacy`, `/terms`, `/security`, `/support` | `api/oauth/authorize.js` (rewrites with `?page=` / `?manage=1`) | Public trust pages and the signed-in "My connection" page |
| `/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource` | `api/well-known/*` | Fixed HTTPS metadata (S256 PKCE only, `client_secret_post`) |
| `/.well-known/security.txt` | `api/security-txt.js` | RFC 9116 file, `Expires` computed per response |
| `/api/oauth/register`, `/api/oauth/authorize`, `/api/oauth/token` | `api/oauth/*` | Client registration (1-8 HTTPS/localhost redirect URIs; public clients when public connect is on); authorize (owner passphrase, or tenant GitHub consent for pre-enrolled/public clients); token (single-use code with PKCE, atomic refresh rotation) |
| `/api/mcp` | `api/mcp.js` | Streamable HTTP MCP: bearer check (a production token on a non-production deployment is refused), `tools/list` from the registry filtered by profile and listing, `tools/call` through the guarded dispatcher; routes signed tenant bearers (`tac_`) to tenant schemas |
| `/api/contract`, `/api/whoami` | `api/contract.js`, `api/whoami.js` | Public RTC manifest (self-reported build evidence, not certification); pass-authenticated identity |
| `/api/openapi.json` | `api/openapi.js` (rewrite) | Public OpenAPI 3.1 description of the HTTPS door |
| `/api/tools`, `/api/tools/{name}`, `/api/tools/_batch` | `api/tools/*` | Pass-authenticated listing, description, run, read-only batch |
| `/api/results/{handle}` | `api/results/[handle].js` | Pages a retained large result; the handle belongs to one connection |
| `/api/github/setup`, `/api/github/manifest-callback`, `/api/github/user-callback` | `api/github/[action].js` | Owner setup page (same-origin, CSRF, passphrase for POST actions); App manifest and user-authorization callbacks; credential steps need production and `TOKEN_ENCRYPTION_KEY` |
| `/api/github/webhook` | `api/github/webhook.js` | GitHub App deliveries; raw body, `X-Hub-Signature-256` checked against the stored secret of the App named in `X-GitHub-Hook-Installation-Target-ID` (bad or unknown 401); handles `installation`, `installation_repositories`, `github_app_authorization`; the rest acknowledged and ignored |
| `/api/tenant/oauth/authorize`, `/api/tenant/oauth/callback`, `/api/tenant/optional` | `api/tenant/*` | Tenant GitHub consent and protected optional master-token form (cookie `gh_tenant_optional_state`, scoped to its path) |
| `/api/marketplace/mcp`, `/resource`, `/webhook`, `/sweep` | `api/marketplace/*` | Marketplace-account MCP door (`tac_` bearer, 404 unless `GITHUB_MARKETPLACE_CONNECT=enabled` in production), protected-resource metadata, signed webhook, cron-authenticated hourly sweep |
| `/api/native-git-key` | `api/native-git-key.js` | Public Ed25519 verification key to pin on the native Git worker; 503 `native_git_signing_not_configured` when unavailable |
| `/api/playground/preview`, `/lifecycle`, `/sweep` | `api/playground/*` | Playground private preview entry, signed lifecycle heartbeat, and the bearer-keyed maintenance sweep (`docs/PLAYGROUND-OPERATIONS.md`) |
| `/api/developer/connect` | `api/developer/connect.js` | Developer-connection handoff helper (`docs/pr-cards/DEVELOPER-CONNECTION.md`); machine protocol, never an MCP tool |

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

The desired manifest lives in `src/github/app-manifest.js` (`MANIFEST_PERMISSIONS`, repository and organization subsets; `Y1_ADDED_PERMISSIONS` are names added for Apps created after Y-1; an existing App gains them only when its owner approves them on github.com) and `docs/DEPLOY.md`. `github_check_permissions` compares stored installation permissions with `src/data/permission-needs.js`. The ChatGPT/provider GitHub connector\'s installation is a different thing from this server. Which Apps, permissions and repositories are installed in the live database: unverified (the 2026-10-12 "41/41 permissions" statement was removed as stale).

## Playground, native Git and Marketplace (source map)

- **Native Git (`src/native-git/`, `src/tools/native-git.js`, `workers/native-git/`):** the MCP signs short-lived Ed25519 worker leases (`WORKER_PROTOCOL = 3`, protocol 2 still accepted; `src/native-git/protocol.js`, `signing.js`) and the worker runs real Git per workspace. Details and operations: `docs/NATIVE-GIT-OPERATIONS.md`, `docs/NATIVE-GIT-BACKUP-RUNBOOK.md`.
- **Playground (`src/playground/`, `src/tools/playground.js`, `workers/coding-workspace/`):** `github_playground_workspace` provisions, attaches, resumes, previews or disposes a per-workspace Dokploy Compose allocation (`dokploy.js`, `allocations.js`); `github_playground_execute/read/cancel` talk to the runtime. A project manager (`manager.js`) advances provisioning and sweeps expired allocations. Details: `docs/PLAYGROUND-OPERATIONS.md`, `docs/CODING-WORKSPACES.md`.
- **Marketplace (`src/marketplace/`, `api/marketplace/*`):** free-plan lifecycle webhook, per-account protected-resource metadata and MCP door, hourly sweep. Dark unless `GITHUB_MARKETPLACE_CONNECT=enabled`; live status unverified.

## Developer scenario ledger (V-1 part 1, PR #65)

`dev_runs`, `dev_run_objects` and the immutable first-create observation table `dev_repo_birth_labels` are additive tables created by `createDb.initSchema()`; `createDevLedger(sql)` offers atomic account+connection-scoped run creation, exact object recording, and bounded lists. The same behavior is asserted for PostgreSQL and the fake. `src/dev/scenarios.js` is plan-only: six scratch-only executable scenarios and guarded private scratch creation exist in code with fake, database and request-shape tests; owner IN-06 designation is verified but authenticated custom-MCP read/write/cleanup acceptance is not. Unit CI uses two file-level shards under the unchanged aggregate `ci` gate.


## V-1 execution-intent journal (#67)

`src/dev/ledger.js` (mounted in `createDb(sql)`) now reserves each scenario step in additive `dev_run_intents` before any external call. Its `(run_id, step_id)` key gives exactly one worker a claim. A request that might have reached GitHub is marked `uncertain`, never automatically replayed. `completeDevIntent` is one PostgreSQL statement using data-modifying CTEs: mark the exact step `recorded` and insert the real returned GitHub ID in `dev_run_objects` atomically. Every operation checks account and connection; fake and isolated PostgreSQL share `runDevLedgerContract`. No real GitHub seed tool is enabled by the journal alone; IN-06 still gates live scratch work.


**#68 read exposure:** `src/tools/dev-runs-read.js` registers `github_dev_list_scenarios` and `github_dev_list_runs`. Scenario plans say `plan_only` and `execution_available: false` until a real safe seed exists. Run reads are scoped to the connected account and client ID, with bounded saved-object and claimed/uncertain/recorded-step details via `listDevIntents`; no GitHub API call or mutation. Scratch eligibility is derived solely from the server's `gh_accounts.is_scratch` and `account_type`, never asserted by caller arguments.


**V-1 scratch gate (#69).** `src/dev/scratch.js` trusts only `gh_accounts` metadata: `is_scratch`, Organization, a configured GitHub App and active installation across all repositories; production connections or enabled production switch refuse before a GitHub read. `src/dev/execute.js` is the shared one-winner step claim and object journal for GitHub mutations, with an uncertain state on unknown outcomes. `src/tools/dev-scratch-write.js` exposes guarded `github_dev_create_scratch_repo`; it creates a private, `rtc_run=<runId>`-described repository and records the returned exact `full_name`. Fixture App credentials are mocks for tests only; the owner has now enabled one real scratch account, but no real run-owned write has been executed.


**#70 scenario execution:** `src/tools/dev-seed-write.js` runs the first two approved scenarios (`repo-basic`, `failing-ci`) against actual pinned GitHub routes with shared owner-only scratch verification and one-winner step journal. Each creates a private run-labelled repository, a run-specific YAML workflow (manual `workflow_dispatch` only; no surprise CI billing) and either a labelled GitHub repository label or a `rtc/<runId>/failure-ref` branch pointing at the recorded workflow commit. Readback checks the file contents, repo visibility/marker, final object and all exact IDs in the scoped ledger. Later PRs added four more runnable scenarios (six total); `webhook-target` remains plan-only pending V-4. Owner IN-06 configuration is now verified; OAuth-connected scratch write and actual workflow dispatch are not.

## Developer-scenario follow-ups (V-1, historical 2026-10-12 acceptance boundaries removed)

The 2026-10-12 live-probe bullets (landing route 404, empty OAuth tables, temporary sandbox) were stale snapshots and were deleted; current acceptance evidence is in `docs/developer-evidence.json` and `docs/status/`. No scratch-repository live test runs without owner-authorized OAuth and verified run-owned cleanup.

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
