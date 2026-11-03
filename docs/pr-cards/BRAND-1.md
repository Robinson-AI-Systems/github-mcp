# BRAND-1 — GitHub Unleashed product mark on the public pages

## Owner direction 2026-11-02

Chris's Unleashed brand spec (docs/UNLEASHED-BRAND-SPEC.md) assigns each product its own mark: the Break-Out ring
with this product's Arctic `#4DDFFF` shard (docs/unleashed-github.png). Both MCP servers' pages must show their own
product mark, not only the shared company R.

## Outcome and acceptance

Outcome: the shared page header (`brandHeader` in src/brand/brand.js) — used by the home/instructions page and the
My connection page — shows the GitHub Unleashed mark, served as /brand/unleashed-github.png through the same
base64-asset route as the existing icons (src/brand/assets.js, api/index.js, vercel.json rewrite). The company R
stays as the favicon and the MCP server icon; page text and per-client instructions are unchanged.
Accepted when tests/unit/root-route.test.js serves the mark route with PNG bytes, tests/unit/pub-5d-front-door.test.js
shows the mark on the home page, and tests/db/pub-6-public-connect.test.js shows it on the connection page while the
server icon stays /brand/icon-256.png.

## Drift check

Presentation only: no new tool, setting, credential, request shape or data change. The mark is the approved file
from the brand spec, resized to a 256px export; the master-gradient line mark is not used as a product mark.
