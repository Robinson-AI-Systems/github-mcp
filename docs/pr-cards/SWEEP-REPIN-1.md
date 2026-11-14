# SWEEP-REPIN-1 — The Playground sweep manager re-pins itself after a signing-key rotation

## What happened (live diagnosis, 2026-11-11)

The Playground maintenance sweep stopped advancing on 2026-11-10 at 16:08 UTC and stayed
frozen (cursor `playground_sweep_cursor` revision 31113) even though the manager container on
the Dokploy pool host was running and posting a sweep every 30 seconds. Every call was refused:
the manager authenticates with a key derived from the server signing key, baked into its
Dokploy compose at provisioning on 2026-10-30, and the 2026-11-10 `TOKEN_ENCRYPTION_KEY`
rotation changed the derivation — the identical mechanism that broke the PC git worker until it
was re-pinned. The manager was never re-pinned: provisioning returned early whenever the
recorded phase read `running`, so no release since the rotation ever refreshed its key. Dead
allocations queued behind the dead sweep, including a disposal-requested test allocation
(af37) whose runtime had already exited.

## Outcome and acceptance

Outcome: `ensureProjectManager` notices the drift itself. Provisioning records a fingerprint
(a hash) of the derived sweep key — never the key — and the running path compares it with the
key derived from the current signing key. On a mismatch it reads the provider's stored compose
through a new ownership-verified `stored` read, classifies the difference (`managerKeyDrift`):
only the sweep-key slot may differ. A key-only difference is repaired through the provider's
own `compose.update` plus a redeploy, and the record returns to `running` with the new
fingerprint; any other difference refuses mutation, exactly like the existing ownership checks.
A matching fingerprint returns with zero provider calls (no redeploy churn). Records written
before fingerprints existed take the same provider proof and are backfilled, or re-pinned when
their key is stale.

Accepted when: the new unit tests pass (rotation → re-pin → sweep authenticates with the new
key only and the cursor advances; matching key → no provider calls; legacy record backfilled;
compose changed outside the key slot → refused), `ci` + `release-policy` are green at the exact
head, and — once a release carrying the fix is live and a manager ensure has run — the live
sweep cursor advances past revision 31113 and the queued disposal (af37) completes through the
sweep. The live half rides the nightly train; no manual release is part of this card.

## Drift check

Builds on the existing Playground manager provisioning (`src/playground/manager.js`) and the
Dokploy pool provider (`src/playground/dokploy.js`): the `compose.update` operation the
provider uses everywhere else becomes an allowed op for this provider too, behind the same
ownership checks as `create`/`inspect`. New: the `keyFingerprint` field on the manager record
(a hash, never key material), the `managerKeyDrift` classifier, and the provider's
`stored`/`update` pair. No tool schema, database migration, routing, authority, or attestation
change; the sweep key stays derived from the signing key with the same cleanup-only scope.

## Design (and why)

- **Detection lives on the existing touchpoint.** `ensureProjectManager` already runs on every
  pool allocation ensure, so the first allocation after a rotation heals the manager with no
  new scheduler and no manual step — the same shape as the worker, whose update path re-fetches
  and re-pins the current public key (`docs/PC-WORKER.md`).
- **The key itself is never stored.** The manager record gains only `keyFingerprint`, a SHA-256
  of the derived key (which is itself a hash of a signature). The capability is still
  regenerated only in trusted memory and still appears only inside the provider compose.
- **Repair is fenced by the same ownership rules as everything else.** The provider's `stored`
  read verifies every ownership field except the file; `update` re-verifies, replaces the file,
  and proves the replacement with a full inspect. A compose changed in any other way is
  refused, not overwritten.
- **No new credentials, no widened scope.** The sweep key stays derived and cleanup-only,
  exactly as designed; nothing about the Playground authority or attestation model changes.
- **Docs:** `docs/KEY-ROTATION.md` §5 now names both derived-key dependents (the PC worker
  re-pin and this manager) with their recovery checks, so the next rotation cannot silently
  kill either.
