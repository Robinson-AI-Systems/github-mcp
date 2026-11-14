# SWEEP-REPIN-2 — The sweep manager drift classifier tolerates the provider's proven compose normalization

## What happened (live, 2026-11-11)

SWEEP-REPIN-1 shipped and released, and the deliberate-fire closure test (owner-ordered,
2026-11-11) forced the first real pool-allocation ensure since the fix. The ensure reached the
manager's drift check and refused: `Manager compose changed outside its sweep key; no mutation
was sent.` Pool provisioning stayed blocked — not by the key (the fingerprint path worked) but
by the classifier's masked comparison. The fire crew replicated the provider's exact ownership
read of the stored manager compose from inside the server: every ownership field matches, and
the masked comparison (everything except the sweep-key slot) differs in exactly one field — the
stored compose carries **no `healthcheck`** on the manager service, while the expected compose
built by `ensureProjectManager` carries `healthcheck: {disable: true}`. The provider's read-back
normalizes the no-op healthcheck away. SWEEP-REPIN-1's tests modeled the stored compose with the
field present, so the gap was invisible to them: fixture blindness, again.

## Outcome and acceptance

Outcome: `managerKeyDrift` treats provider normalization as a known, enumerated class. The one
proven normalization — a missing `healthcheck` where the other side carries exactly
`{disable: true}`, in either direction — no longer classifies `other`. A record whose only
masked differences are the sweep key and/or that normalization classifies `stale` and takes the
existing re-pin path (`compose.update` + redeploy), whose update also writes the expected compose
back, healthcheck included. The safety property is unchanged and absolute: a healthcheck of any
other shape, or any second difference beside the normalization, still classifies `other` and the
ensure throws before any mutation.

Accepted when: the new unit tests pass (classifier: live-shaped fixture missing the healthcheck
→ `stale` with a matching or a rotated key; `{disable: false}` or a real healthcheck → `other`;
normalization plus a foreign field → `other`; end-to-end: a legacy record with the live-shaped
stored compose re-pins and the expected compose is written back; the same shape with a foreign
change still refuses with zero provider calls), `ci` + `release-policy` are green at the exact
head, and — after a release carrying the fix and a re-run of the deliberate fire — the sweep
cursor advances past revision 31113 and the queued disposal (af37) completes through the sweep.
The release and fire re-run are a separate owner-ordered step after this card merges; they are
not part of this PR.

## Drift check

Confined to the classifier in `src/playground/manager.js` (SWEEP-REPIN-1's own seam) and its
unit tests. No provider, schema, authority, or attestation change; the re-pin path, the
fingerprint mechanism, and the refusal error are untouched. No other provider normalization is
tolerated: only the healthcheck absence is evidenced (from the live stored compose), and any
future normalization must be proven from a live read-back and enumerated the same way before it
joins the list.
