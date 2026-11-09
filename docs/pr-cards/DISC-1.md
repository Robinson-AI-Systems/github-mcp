# DISC-1 — Muse discovery documents: muse-client.json + scoped protected-resource

## Origin

The 2026-11-08 rack move (GitHub Unleashed now serves from the
Development Rack). On 2026-11-09 the owner disconnected the old Muse
connector entry himself and asked for a fresh one. The fresh-connect
tap failed app-side with zero register/authorize requests reaching
the server, and direct public probes of the rack copy showed two
discovery gaps:

- `GET /.well-known/muse-client.json` → 404
- `GET /.well-known/oauth-protected-resource/api/mcp` → 404 (the
  RFC 9728 path-scoped form of the protected-resource document)

## Finding (forensic)

Neither document was lost in the move. Git history carries no
handler, rewrite or route for either path at any point: the hosted
copy ran this same code and never served them. The fleet's original
Muse connection was made through the fixed public client
(`src/tenancy/muse-client.js`, the `pcl_` identifier the home page
tells people to enter by hand), so the missing metadata document
never blocked it. The fresh connect exercises the CIMD path
(`client_id_metadata_document_supported` is advertised once
GITHUB_PUBLIC_CONNECT is enabled, and the authorize door already
resolves CIMD clients through `src/tenancy/cimd-client.js`), which
needs the server-hosted document. Pre-existing gap, not a move loss;
the two plain env flags and the tenant routing key were the move's
actual assembly losses and are tracked in the window record.

## Scope

- `src/core/oauth-handlers.js`: a storeless `museClient` handler
  serving the Muse client document, built from the configured
  public origin — `client_id` = the document's own URL,
  `client_name` "Muse", grant types authorization_code +
  refresh_token, the one hosted callback
  `https://agent.meta.ai/api/hatch/oauth/callback`,
  response_types ["code"], token_endpoint_auth_method "none" —
  the same shape the Vercel sibling serves live (VMCP-024).
- `api/well-known/muse-client.js`: the function binding;
  `src/oauth/routes.js` marks the handler storeless (DOOR-DB-1).
- Scoped protected-resource: the existing path-agnostic
  `resourceMetadata` handler answers at
  `/.well-known/oauth-protected-resource/api/mcp` with the same body
  as the root document — a rewrite in `vercel.json` and in
  `rack-server.mjs`, kept in parity by the S-2 contract test.
- Tests: the document's exact contents + GET-only shape pinned in
  `tests/unit/oauth-handlers.test.js`; both new rewrites pinned in
  `tests/unit/rack-server.test.js` beside the parity checks.

## Drift check

Baselines re-verified before composing: the discovery surface was
probed live on the rack copy (root documents 200, the two new paths
404) and the code was read at main `6658585a` — no handler, rewrite
or history entry exists for either path, and the sibling servers'
live documents (Vercel's muse-client.json) were read back as the
shape reference. This card changes no tool, widens no access, raises
no spend, and touches neither the token door nor any credential
path; the new handler is storeless configuration output, like the
two existing discovery documents.

## Acceptance

CI (`ci` + `release-policy`) green at the exact head; merged;
released through the repo's owner route under the owner's standing
acceleration order (one clean release per finished fix, 2026-11-08);
the rack production instance swapped to the new pin; public GETs of
both new URLs answer 200 with the expected bodies, the root
documents and the {514, 291, 24} contract unchanged, and the store
census unchanged.
