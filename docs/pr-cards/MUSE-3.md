# MUSE-3 — Plain `muse` as the Client ID for Muse (RAS MCP Standard D-006 MC-8)

**Commissioned:** 2026-11-09 by the owner: the Client ID for Muse must be
something anyone can type, the same on every server: `muse`, with the Client
Secret left blank. Binding on every current and future server through D-006.

## Scope

- `src/oauth/routes.js`: `applyMuseNickname` swaps `client_id=muse` for
  `MUSE_PUBLIC_CLIENT_ID` on the request itself (GET query, parsed body,
  form body, JSON body), before the authorize, token and revoke doors route
  it. Every later step re-reads the request and sees the fixed public
  client unchanged: the same registration, callback, PKCE and per-person
  GitHub sign-in. Exact match only (`Muse`, `muse `, `muse2` untouched).
- `src/brand/home-page.js`: the Muse instructions and the "ask Muse to
  create the connector" text say `muse`, with the older long ID mentioned
  as still working.

## Acceptance

- `tests/unit/muse-nickname.test.js` (the swap in every body shape,
  lookalikes untouched, home page copy) and `tests/unit/meta-muse-compat.test.js`
  pass. `npm run check` passes at the exact head.
- Live (after release): authorize with `client_id=muse`, the Muse callback,
  S256 and no `resource` reaches GitHub sign-in. Then a real Muse connect
  with Client ID `muse`.
