# 2026-11-09 — Muse discovery documents (DISC-1)

In progress: branch `ai/vivienne/muse-discovery-docs` from main
`6658585a`. Serves `/.well-known/muse-client.json` (the CIMD client
document Muse's fresh-connect flow fetches; Muse publishes none of
its own) and the scoped protected-resource document at
`/.well-known/oauth-protected-resource/api/mcp`, on both the Vercel
shape (vercel.json rewrites + an `api/well-known/muse-client.js`
function) and the rack entrypoint, parity-pinned by the S-2 contract
test.

Forensic note: neither path exists anywhere in git history — the
hosted copy never served them either. The original fleet connection
used the fixed `pcl_` public client, so the gap stayed invisible
until the owner's fresh connect on 2026-11-09. Not a rack-move loss.

Next: checks green at the exact head → merge → owner-route release →
rack image + production instance swap → outside read-back of both
URLs (200 + bodies) with the front door, contract counts and store
census unchanged. The tenant routing key / token door are explicitly
out of scope for this pass.
