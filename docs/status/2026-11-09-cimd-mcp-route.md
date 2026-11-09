# 2026-11-09 — CIMD grants refused at the tenant MCP door: classification fix

**Symptom (live, owner's fresh connect):** the fresh Muse connect completed
end to end — authorize, consent, token exchange 200, a tenant connector token
row minted — yet every `/api/mcp` call with the issued tenant credential was
refused `401 {"error":"invalid_token"}`.

**Root cause:** the tenant MCP route (`src/tenancy/mcp-route.js`) classified a
grant's client as public-registry only when its id starts `pcl_`. The authorize
door (`public-connect.js`) and the token door (`oauth-token.js`) both classify
a client as public when it is a `pcl_` client OR a CIMD document client. A grant
issued to a CIMD client (client_id = the client document URL) therefore fell
into the signed-client branch, which demands the client_id verify as a `tcl_`
tenant credential; a document URL never can, so resolution returned null and
the MCP door answered `invalid_token`. The token row's `last_used_at` still
advanced (the grant lookup precedes the client check), which is how the refusal
point was pinned from the store.

**Fix:** `mcp-route.js` now classifies through `isPublicGrantClient`
(`isPublicClientId || isCimdClientId`), mirroring the other two doors; the
public branch's existing registered + mirrored checks then apply unchanged.
Pinned by a unit test in `tests/unit/pub-2-routed-credential.test.js`.

**Scope note:** the public usage metering hook in `api/mcp.js` still keys on
`pcl_` only; that is a counting path (never a refusal) and is deliberately not
changed here.
