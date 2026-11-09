# DISC-2 — CIMD grants at the tenant MCP door: classification parity

## Origin

Follow-on to DISC-1 (2026-11-09). Once the discovery documents shipped
and the fresh Muse connect could run, the connect completed — authorize,
consent, token exchange 200, tenant connector token row minted — but every
`/api/mcp` call with the issued tenant credential was refused
`401 {"error":"invalid_token"}`.

## Finding

The three doors classified a grant's client differently. The authorize
door (`src/tenancy/public-connect.js`) and the token door
(`src/tenancy/oauth-token.js`) both treat a client as public-registry when
it is a `pcl_` client OR a CIMD document client
(`isPublicClientId || isCimdClientId`). The tenant MCP route
(`src/tenancy/mcp-route.js`) used only `isPublicClientId`, so a grant whose
client_id is the CIMD document URL fell into the signed-client branch,
which requires the client_id to verify as a `tcl_` tenant credential — a
document URL never can — and resolution returned null. The token row's
`last_used_at` advanced on each refused call (the grant lookup precedes
the client check), pinning the refusal point from the store.

## Scope

- `src/tenancy/mcp-route.js`: classify through the exported
  `isPublicGrantClient` predicate (`isPublicClientId || isCimdClientId`),
  mirroring the other two doors. The public branch's registered +
  mirrored checks apply unchanged.
- `tests/unit/pub-2-routed-credential.test.js`: pin the predicate
  (pcl_ true, CIMD URLs true, tcl_/plain/empty false).
- Out of scope: the `api/mcp.js` public-usage metering hook still keys on
  `pcl_` only — a counting path, never a refusal.

## Acceptance

Targeted unit tests green; `npm run check` green at the exact head;
post-merge rack build + instance swap; the already-issued fresh-connect
credential answers `/api/mcp` (the platform's whoami proof) with doors,
documents and census unchanged.
