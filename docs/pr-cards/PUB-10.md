# PUB-10 — CIMD card clients: Claude and ChatGPT connect with their own ID cards

## Owner decision 2026-11-02 (in chat)

"Fix it" — the PenPal compatibility treatment, fleet-wide. Convicted live the same evening:
this server's authorize turned away Claude's real connect request
(`client_id=https://claude.ai/oauth/mcp-oauth-client-metadata`,
redirect `https://claude.ai/api/mcp/auth_callback`) and ChatGPT's real request
(`client_id=https://chatgpt.com/oauth/client.json`,
redirect `https://chatgpt.com/connector_platform_oauth_redirect`) with
`400 {"error":"invalid_request","error_description":"Unknown client or redirect address"}`,
while the Muse door (fixed public client) and the sign-up door both worked.

## Drift check before implementation

- Reuses PUB-6's public-connect flow whole (directory client rows, GitHub sign-in steps,
  tenant stores, code/token machinery); CIMD clients are an additional, separately routed
  kind admitted at `begin()`. Nothing in the Muse fixed door, registration, or tenant
  routing is rewritten.
- Unchanged hard limits: no real credential used from tests (fakes + mocked fetch only),
  no live write, no spend, no secret in code or docs; the one schema change is additive.

## Dossier — shape map (read before building)

- **How a knock is sorted** (`src/oauth/routes.js`): `pcl_`-prefixed ids go to the
  public-connect machinery (`isPublicClientId` in `src/tenancy/public-code.js` is a literal
  prefix test); tenant-shaped credentials go to tenant sign-in; everything else falls to
  `src/core/oauth-handlers.js`, whose only client knowledge was `db.getOAuthClient(client_id)`.
  No https client_id was ever fetched anywhere in the repo.
- **The public-connect flow** (`src/tenancy/public-connect.js`): `begin()` checks the request
  shape, loads the client row from the tenant directory (`gh_public_clients`), and opens a
  GitHub sign-in step. Codes are minted into the person's tenant store; at consent the client
  row is mirrored into that store (`mirrorOAuthClient`), and the token endpoint
  (`src/tenancy/oauth-token.js`) derives the tenant from the code/refresh selector and runs
  the core token handler against the tenant store — so a client whose row exists in the
  directory and mirrors cleanly needs no token-side changes beyond routing.
- **The stored-shape gates**: `gh_public_clients.client_id` carried a CHECK limiting ids to
  `pcl_…`, and the directory's get/touch methods repeated the same regex in code. Both are
  widened additively in this card (fresh CREATE + DROP/ADD CONSTRAINT on existing stores).
- **PenPal's proven implementation** (Robinson-AI-Systems/penpal `src/oauth.mjs`,
  `resolveCimdClient`): fetch the document with `redirect:'error'`, a short timeout and a
  size cap; refuse unless the document's `client_id` equals the address fetched; redirects
  must be valid; normalize to the same public-client record shape as registered clients;
  cache per process for an hour; every failure resolves to null (an ordinary refusal).
- **PenPal's convicted trap** (its PR #45, 2026-11-01): ChatGPT's live document headlines
  `token_endpoint_auth_method: "private_key_jwt"` (singular) but lists
  `["none","private_key_jwt"]` in `token_endpoint_auth_methods_supported` (plural). Reading
  only the singular field refuses ChatGPT. Acceptance here is the intersection rule:
  the document's supported methods (plural first, singular as fallback) intersected with
  this server's own methods must contain `none`; refuse only on an empty intersection.
  Full `private_key_jwt` support stays out of scope, exactly as on PenPal.
- **Live documents mirrored in fixtures** (fetched 2026-11-02): Claude's document —
  singular `"none"`, one redirect (`https://claude.ai/api/mcp/auth_callback`); ChatGPT's —
  singular `private_key_jwt`, plural `["none","private_key_jwt"]`, one redirect
  (`https://chatgpt.com/connector_platform_oauth_redirect`), plus `jwks_uri`/signing alg
  fields this card deliberately ignores.

## Design

- New `src/tenancy/cimd-client.js`: `isCimdClientId` (https URL only; no credentials or
  fragment; host never loopback/private/link-local — literal-host guard incl. IPv6 forms),
  and `resolveCimdClient` (PenPal's fetch pattern + the intersection rule + a one-hour
  per-process cache). The resolved display name is the document's **host** — the document's
  `client_name` is self-asserted, so consent names the host (Anthropic's CIMD guidance);
  the Approve page already prints app name + redirect host from the client row.
- `routes.js`: an https client_id routes to public authorize and to the tenant token
  endpoint alongside `pcl_` ids. Tenant-shaped routing is untouched.
- `public-connect.js` `begin()`: the shape check now admits `pcl_` **or** CIMD ids; a CIMD
  knock resolves its document first (any failure or a redirect outside the document is the
  ordinary refusal), then mirrors the document into `gh_public_clients` via the new
  `directory.ensureCimdPublicClient` (public `none` client, random unknown placeholder
  secret hash, host as the name; re-resolving refreshes the redirect list). Every later
  step — consent, code, mirror into the tenant store, token, refresh — is the existing
  public-connect machinery, byte-equivalent for the existing doors.
- Metadata: `client_id_metadata_document_supported: true` is advertised **only** when
  public connect is enabled on the deployment, and only in this PR — after the resolver
  and its tests exist. It was not advertised before (honest), and is never advertised
  where the resolver cannot run.
- Out of scope: `private_key_jwt` token authentication; CIMD on the legacy owner door
  (card clients belong to the public sign-in, like every other app client).

## Acceptance

1. [x] Claude's real knock passes authorize into the GitHub sign-in step; a redirect
   outside its document is refused (DB test: "admits Claude at authorize…").
2. [x] ChatGPT's real knock passes authorize — via the plural intersection, not the
   singular headline (DB test: "admits ChatGPT…"; unit tests pin the intersection rule).
3. [x] Claude completes consent → code → token → refresh presenting the URL client_id
   with no secret (DB test: "runs Claude through consent, code, token and refresh…").
4. [x] Negative controls: with document fetching failing, both knocks are refused (DB
   test); with the resolver block disabled, 3 of 4 DB tests fail (recorded in the status
   note); resolver unit tests refuse self-mismatch, unusable redirect lists, blocked
   hosts (never fetched), oversized/failed fetches, and an empty method intersection.
5. [x] No regression: PUB-6 public-connect + Muse DB suites (57 tests) and the OAuth
   unit suites (53 tests) pass unchanged; Muse's fixed door, the sign-up door and
   tenant routing are byte-equivalent in behavior.
6. [ ] Live re-probe of both doors after this reaches production (release is the daily
   train; no manual promotion in this card).

## Dangers

A fetched document is data, never authority: it can only name redirects the server then
checks byte-for-byte, the person still signs in with GitHub and taps Approve, and the
client is public (`none`) — there is no secret to leak and no owner credential involved.
The fetch is bounded (https only, no redirects, 5 s, 64 KB, blocked private hosts) so a
hostile client_id cannot aim the server at the LAN or hold a request open.

## Follow-up 2026-11-02: concurrent schema start (CHECK-RACE-1)

The client_id check widening ran as two statements (drop, then add). When several requests started the directory schema
at once, one failed with Postgres 42710 ("constraint already exists") and its sign-in registration answered 503 (seen
in the browser load smoke on main). It is now one `DO` block that swaps the check only while it is still the narrow
one and treats a concurrent winner as done. Proof: `tests/db/public-clients-check-race.test.js` (fails before, passes
after), browser load smoke 6/6 locally.
