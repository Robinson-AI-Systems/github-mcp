# Rack staging — transport seam + rack entrypoint (2026-11-08)

State: **staging complete** — branch `ai/vivienne/rack-staging` from main
`f21fad34` (the live pin). This PR is held open unmerged on purpose:
the rack move window merges it as its first act. Nothing here changes
production behavior — without `STORE_TRANSPORT=pg` (or a rack
Postgres hostname), every store client is the Neon driver's own
handle, exactly as before.

## What this delivers

- **S-1, the transport seam** (`src/db-transport.js`): every store
  construction site in `src/` and `api/` (20 `neon(` call sites plus
  every `rootSqlFactory` / `tenantSqlFactory` / `sqlFactory` default)
  now builds through `storeFactory`, which returns the Neon handle
  untouched on the neon path or a pooled `pg` handle on the pg path.
  The pg handle reproduces the Neon tagged-template contract exactly:
  lazy query objects carrying `{text, values}`, `.query()`,
  `.transaction([...])` in one database transaction, `.end()`.
  Per-tenant scoping is preserved with its proof: a tenant handle's
  queries run inside a transaction opened with the same
  transaction-local `set_config('search_path', …)` the Neon path
  runs, so `assertTenantSearchPath` holds unchanged. `pg` moves from
  devDependencies to dependencies.
- **S-2, the rack entrypoint** (`rack-server.mjs`): one Node process
  binding all 32 `api/` functions, the 19 vercel.json rewrites, and
  the Routing Middleware families `/git/*` + `/v1/transfer/*` as a
  pre-router with the proxy hop streamed (bodies never buffered —
  `skipMiddlewareRequestBody` preserved). Webhook functions
  (bodyParser:false) receive `req.rawBody`; all other functions
  receive the parsed body as Vercel presents it. The hourly
  marketplace sweep cron becomes the rack-side systemd timer
  `rack-github-sweep.timer` calling the same route. Release identity
  is pinned from `RACK_RELEASE_COMMIT` / `release-commit.txt`;
  `PLAYGROUND_BUILD_SOURCE_SHA` is carried and `PLAYGROUND_IMAGE`
  left unset, per the move dossier.
- **Store init** (`rack-init-store.mjs`): the registry migration
  command — boots the server's own additive self-migration (owner +
  tenancy directory + marketplace schemas) through the pg transport.
- **Tests**: `tests/unit/db-transport.test.js` (selection contract +
  lazy query shape) and `tests/unit/rack-server.test.js` (route
  table pinned against `vercel.json` itself: every function file
  bound, every rewrite reproduced).

## Verification

Recorded in the rack migration program's staging record
(`research_notes/rack-migration-program/github/staging-2026-11-08.md`
in the fleet workspace): unit suites and the boot-against-scratch
proof (self-migration + per-tenant schema creation + search_path
proof on a fresh rack-side Postgres through the pg transport) run on
a fleet bench; CI at the exact head is the merge gate for the window.

Verification summary: full unit suite 11,604/11,605 (sole failure a
base-pinned, environment-dependent ssh leg proven identical at the
untouched pin), db suite 287/287, shapes 26/26, the entrypoint git
battery (front door, contract, tokenless refusal, discovery, clone,
push, transfer refusal) green, and CI green at the exact head —
`ci`, release policy and the workspace-image workflow all success.
One seam fix landed during staging after CI's browser shards
exposed it: pg pools now swallow idle-client errors (an unhandled
pool 'error' would otherwise crash the process on a database
restart), and the hostname fallback was narrowed to the rack's own
hostname after CI's service database (bare hostname `postgres`)
collided with it — the rack enrollment declares
`STORE_TRANSPORT=pg` explicitly, so the move never relied on the
broader rule.

## Next

The move window (quiet period, sealed census, fence, route commit,
connector verification) — see the program's GitHub dossier/readiness.
