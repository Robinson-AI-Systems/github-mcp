# SWEEP-REPIN-1 — sweep manager derived-key repair (2026-11-11)

Status note for `docs/pr-cards/SWEEP-REPIN-1.md`. Built 2026-11-11 under the owner's standing
rack-repair program, from the same morning's live diagnosis: the Playground maintenance sweep
had not advanced since 2026-11-10 16:08:05Z (cursor revision 31113) because the manager's
derived sweep key went stale at the 2026-11-10 `TOKEN_ENCRYPTION_KEY` rotation and
`ensureProjectManager` returned early on a `running` manager, so nothing ever refreshed it.

## What changed

- `src/playground/manager.js`: provisioning records `keyFingerprint` (a hash of the derived
  sweep key, never the key). The running path compares it with the current derivation; on a
  mismatch it reads the provider's stored compose, classifies the difference with
  `managerKeyDrift` (only the sweep-key slot may differ), re-pins through the provider update
  path plus a redeploy, and returns to `running` with the new fingerprint. Any other compose
  difference refuses mutation. Legacy records without a fingerprint are proven the same way
  and backfilled (or re-pinned when stale). A matching fingerprint returns with zero provider
  calls.
- `src/playground/dokploy.js`: the provider gains `stored` (ownership-verified compose read
  without the file comparison) and `update` (`compose.update`, re-verified by a full inspect).
- `docs/KEY-ROTATION.md` §5: both derived-key dependents are now named with their recovery —
  the PC git worker re-pin and the sweep manager — closing the procedure gap owed since the
  2026-11-10 worker break.
- `tests/unit/playground-manager-repin.test.js`: rotation → re-pin → sweep authenticates with
  the new key only and the cursor advances; matching key → zero provider calls; legacy record
  backfilled, then re-pinned after a later rotation; compose changed outside the key slot →
  refused.

## Release state

- Merged to `main` only; rides the nightly train — no manual release was authorized or run
  for this card.
- **Live closure is therefore still owed** (do not read this note as the sweep being fixed
  live): after the train carries the fix and the first pool allocation ensure runs, verify —
  sweep cursor `playground_sweep_cursor` advances past revision 31113 with a fresh timestamp;
  a sweep cycle executes; the disposal-requested allocation af37 completes teardown through
  the sweep (record terminal/disposed, ingress route gone, no container/network residue);
  the allocation stuck in `creating` since 2026-11-08 is resolved by the sweep or its exact
  blocking state is reported.
