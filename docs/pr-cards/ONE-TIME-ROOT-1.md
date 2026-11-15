# ONE-TIME-ROOT-1 — one-time secrets are issued in the root store the setup page reveals from

## Owner report 2026-11-15

Chris reported in chat that every runner registration reveal link failed: five `github_runner_register` mints across two
of his connections, by direct POST and in the real browser, inside the ten-minute window and with the correct
administrator passphrase, all answered "This one-time secret was used, expired, or does not exist." Three passphrase
pastes were spent on it. He asked that the next thing he hears be that his runners are registered.

## Outcome and acceptance

Outcome: a one-time secret issued through any of the owner's connections — including his claude.ai connections, which are
tenant-routed (RELAY-OWNER-1) — is revealed once on the private setup page. Accepted when `tests/unit/one-time-root.test.js`
shows that a runner token minted from a tenant-scoped context is absent from the tenant schema and consumed exactly once
by the root page store, that a root-connection context behaves as before, and that the helper's handle choice is the
root one; and when `tests/unit/runners-limits.test.js` stays green.

## What changed

- Cause: the issuers (`src/tools/runners-write.js`, `src/tools/webhooks-save.js`, `src/dev/forwarders.js`) built the
  one-time store on `ctx.db`. For a tenant-routed connection that is the tenant's own schema, so the secret went into that
  schema's `one_time_secrets`; the setup page's runtime (`src/runtime.js`) consumes from the root schema and found
  nothing. The passphrase check runs before the lookup, so the first "incorrect passphrase" answer was unrelated.
- `src/tools/one-time-root.js`: `ownerOneTimeStore(ctx, { encryptionKey })` builds the store on `rootAllocationDb(ctx)` —
  the root handle the Playground index and the git-remote index already use. The three issuers call it; dead imports
  removed. Nothing about who can reveal changes: the page still needs the administrator passphrase and the issuing tools
  stay owner-audience.
- `docs/TOOL-CATALOG.md` row for `github_runner_register`; status note `docs/status/2026-11-15-one-time-root.md`.

## Follow-up (not in this card)

Machine-bound secrets (runner tokens for the owner's own benches) should reach the machine directly over a sealed channel
to Rack Control, with one approval in chat and no owner paste. Recorded in `docs/ROADMAP.md`.

## Drift check

Before building on this card, confirm every `createOneTimeStore` call outside `src/runtime.js` goes through
`ownerOneTimeStore` (`grep -rn createOneTimeStore src/tools src/dev`), and that the setup page's reveal still consumes from
the root runtime store.
