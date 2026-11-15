# 2026-11-15: one-time secrets are issued where the setup page reveals them (ONE-TIME-ROOT-1)

- Owner report 2026-11-15: every `github_runner_register` reveal link — five mints, two connections, direct POST and the real
  browser, inside the 10-minute window, correct passphrase — answered "This one-time secret was used, expired, or does not
  exist." Three owner passphrase pastes were spent on it.
- Cause: the owner's connections from claude.ai are tenant-routed (RELAY-OWNER-1), so a tool's `ctx.db` is the tenant's own
  schema. `github_runner_register`, `github_webhook_save`/`rotate_secret` and the dev forwarders built their one-time store on
  `ctx.db`, so the secret went into the tenant schema's `one_time_secrets`; the setup page (root runtime) consumes from the
  root schema and found nothing. The passphrase check runs before the lookup, so the first "incorrect passphrase" answer was
  unrelated and the link behind it would have failed the same way.
- Now: `src/tools/one-time-root.js` `ownerOneTimeStore(ctx)` builds the store on `rootAllocationDb(ctx)` — the same root handle
  the Playground index and git-remote already use — and the three issuers use it. Nothing about who can reveal changes: the
  page still needs the administrator passphrase, the issuing tools stay owner-audience, and a non-tenant context behaves as
  before.
- Tests: `tests/unit/one-time-root.test.js` — a tenant-scoped context's runner token is absent from the tenant schema and
  consumed exactly once by the root page store; the root-connection path is unchanged; the helper's handle choice.
  `tests/unit/runners-limits.test.js` still green.
- Needs a release to reach production: the owner's self-hosted runner registration (development-rack RUNNER-1) is waiting on it.
