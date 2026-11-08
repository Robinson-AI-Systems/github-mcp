# RACK-1 — Rack staging: pg transport seam + rack entrypoint

## Origin

The rack migration program (fleet workspace, `research_notes/
rack-migration-program/github/dossier.md` + `readiness.md`,
2026-11-08): GitHub Unleashed moves from Vercel + Neon to the
Development Rack, last of the MCP fleet. The move's staging
conditions C-1 (transport seam, L) and C-2 (rack entrypoint
including the middleware families, L) are this card. C-3 (closure
sweeps on a faithful clone) ran with the staging and is recorded in
the program's staging record.

## Scope

- `src/db-transport.js`: `storeFactory` — the one construction
  point for every store client. Neon handle untouched on the neon
  path; pooled `pg` handle on the pg path reproducing the Neon
  tagged-template contract exactly (lazy `{text, values}` query
  objects, `.query()`, `.transaction([...])`, `.end()`), with
  per-tenant `search_path` scoping applied transaction-locally so
  `assertTenantSearchPath` holds. Selection: `STORE_TRANSPORT`
  explicit wins; `*.neon.tech` and unlisted hosts keep Neon (the
  repo's suites pin the Neon HTTP serializer against fixture
  hosts); the rack Postgres hostnames select pg.
- Every construction site rerouted: `src/db.js` `productionSql()`,
  `api/mcp.js`, the tenancy factories (`mcp-route`, `directory`
  incl. `createTenantSql` + its two schema openers,
  `client-registration`, `github-consent`, `oauth-token`,
  `owner-bootstrap`, `private-invite`, `public-connect`,
  `incident-cleanup`, `optional-setup`), `src/github/routes.js`,
  `src/github/setup-page.js`, `src/fleet/scope.js`,
  `src/playground/index.js`, `api/developer/connect.js`,
  `api/marketplace/{sweep,webhook}.js`, `api/playground/enroll.js`.
  `pg` promoted to dependencies.
- `rack-server.mjs`: binds all 32 `api/` functions + the 19
  vercel.json rewrites + the Routing Middleware families
  (`/git/*`, `/v1/transfer/*`) as a pre-router with streamed proxy
  hops (bodies never buffered); webhooks receive `req.rawBody`;
  client-IP headers pass through untouched for login-lockout
  accounting; release pin from `RACK_RELEASE_COMMIT` /
  `release-commit.txt`; hourly sweep cron → rack systemd timer
  `rack-github-sweep.timer` (enrollment, not code).
- `rack-init-store.mjs`: the registry migration command (boots the
  additive self-migration: owner + directory + marketplace).
- Tests: `tests/unit/db-transport.test.js`,
  `tests/unit/rack-server.test.js` (route table pinned against
  vercel.json itself).

## Acceptance

- Repo suites green at the exact head (`ci` + `release-policy`),
  including `test:db` against Postgres through the fleet's bench
  route.
- Boot proof: the server boots against a fresh scratch Postgres
  through the pg transport; self-migration creates the 52 public
  tables; a per-tenant schema is created and its `search_path`
  proof passes (staging battery, program record).
- Git battery through the rack entrypoint against a fixture
  repository: clone + push (staging battery, program record).
- Production behavior without the switch is byte-identical: the
  neon branch returns the driver's own handle and no default
  changes until `STORE_TRANSPORT=pg` is set by the rack enrollment.

## Disposition

STAGED, held open unmerged by design: the move window merges this
PR as its first act under the program's quiet period. The window
itself (sealed census, fence, route commit, connector
verification, retirements) is program work, not this card.
