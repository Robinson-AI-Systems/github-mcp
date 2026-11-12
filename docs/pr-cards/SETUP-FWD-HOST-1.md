# SETUP-FWD-HOST-1: setup page redirect loop behind the rack gateway

## Owner approval 2026-11-12

Chris asked for the dev copy's own GitHub App (github-dev). Creating it through the setup page failed because, in production mode, `GET /api/github/setup` redirected to itself forever. Chris's standing instruction is to fix tool shortcomings found along the way.

## Outcome and acceptance

Outcome: behind a proxy that passes the browser's host as `X-Forwarded-Host` (the Development Rack gateway, or Vercel), the setup page compares that host with `PUBLIC_BASE_URL`. It serves the page and sets the CSRF cookie instead of looping. Accepted by `tests/unit/setup-canonical.test.js`.

## Drift check

Comparison-only change in `src/github/setup-canonical.js`. The redirect destination is still only `PUBLIC_BASE_URL`, and nothing else about setup changes: no credential, permission, write or merge rule. Status note: `docs/status/2026-11-12-setup-forwarded-host.md`.
