# DOOR-DB-1 — keyless doors answer without waking the database

## Owner approval 2026-11-03

Chris approved this fix on the morning of 2026-11-03 (relayed by his assistant Vivienne) after a read-only audit of
live build 648ba99c showed that every request to `/api/mcp` — even a keyless probe that is only refused — opened the
database and ran schema setup (about 32 `CREATE TABLE IF NOT EXISTS` statements) before answering. Each cold instance
hit by a health or refusal probe (the fleet watcher knocks every 5 minutes) woke the Neon store: roughly $19/month,
mostly from being woken by checks.

## Outcome and acceptance

Outcome: a request with no usable bearer on `/api/mcp`, the RTC doors (`/api/whoami`, `/api/tools`, `/api/tools/{name}`,
`/api/results/{handle}`) and the OAuth discovery documents (`/.well-known/oauth-protected-resource`,
`/.well-known/oauth-authorization-server`) gets exactly the answer it got before, without opening the database or
running schema setup. Accepted when `tests/unit/door-db-free.test.js` pins the old refusals byte for byte (status, header
order, body), proves zero database work on a cold instance (instrumented `createDb`, `initSchema` and Neon driver), and
proves that the first signed-in call still runs schema setup once, still looks the token up (unknown and revoked tokens
refused), that concurrent first calls share one setup, and that a failed setup is retried.

## What changed

- `src/core/mcp-auth.js`: `presentsMcpBearer(req)` (pure shape check) and `refuseMissingMcpBearer(res, env)` (the
  sign-in challenge). `requireMcpToken` sends the challenge through the same function, so the two cannot drift.
- `api/mcp.js`: before the store is opened, a request that is not tenant-routed, not on the Marketplace route and has no
  bearer-shaped `Authorization` is answered with that challenge. Any request that presents a bearer goes through the
  unchanged store-backed path (token lookup, revocation, tenant route, production refusal, usage limits).
- `src/rtc/http.js` / `src/rtc/entry.js`: `presentsRtcPass(req)`; without a pass-shaped bearer the same RTC handler runs
  over an empty store, so the refusal is byte-identical and the database is never opened.
- `src/oauth/routes.js`: the two discovery documents are built from configuration only and no longer open the store.
- Already DB-free and unchanged: `/` (home/JSON), brand images, `/.well-known/security.txt`, `/api/contract`,
  `/api/openapi.json`, `/status` and the other trust pages on the public sign-in, the Marketplace keyless refusal.

## Not changed

- Schema setup stays lazy and once per instance (`src/runtime.js` `getDb()`), not moved to deploy time; the first
  request that needs the store pays it, as before.
- A well-formed but wrong bearer still opens the store: telling a revoked token from a live one needs the lookup.
- Behaviour only differs when the store or configuration is broken: a keyless knock or a discovery-document request
  now gets its normal answer even if the database is down (it used to get the 503 "database is unavailable").

## Drift check

No new setting, credential, migration, tool or GitHub request. No response a working deployment sends changes: the
pinned refusals in `tests/unit/door-db-free.test.js` were captured from the code before this change and pass on both.
Before building on this card, confirm `api/mcp.js` still answers the keyless challenge before `getSecretsRuntime()` and
that `requireMcpToken` still sends it through `refuseMissingMcpBearer`.
