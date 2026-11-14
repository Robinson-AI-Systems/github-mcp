# Setup page redirect loop behind the rack gateway (2026-11-12)

**What broke:** in production mode, `GET /api/github/setup` answered 302 to
its own URL forever and never set the `github_setup_csrf` cookie. This hit
both github and github-dev on the Development Rack. It blocked creating the
dev GitHub App, and it would block any new setup on the live server.

**Why:** the rack gateway forwards each request to the instance at its
internal address and passes the browser's host as `X-Forwarded-Host`.
`canonicalSetupUrl` compared the immediate `Host` (the internal address) with
`PUBLIC_BASE_URL`, so the two never matched.

**Fix:** compare the first `X-Forwarded-Host`, falling back to `Host`. The
forwarded value is only compared and never used as a destination; redirects
still go only to `PUBLIC_BASE_URL`. Covered by `tests/unit/setup-canonical.test.js`.
