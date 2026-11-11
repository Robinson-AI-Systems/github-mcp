# SWEEP-ORPHAN-1 — The sweep retires cleanup-requested allocations whose provider app was never created

## What happened (live, 2026-11-11)

The deliberate-fire closure battery for SWEEP-REPIN-1/2 passed three of four items. The fourth —
the Nov-8 allocation `job_b4dc31759005e8d8`, stuck in phase `creating` with `cleanupRequested`
set — did not resolve, and the fire proved its blocker exactly. The record carries **no
composeId**, and the provider inventory contains **zero** apps matching its plan name
(`ras-pg-e195a6df41d59e9d71e439232394b48f`, exact or prefix): the provider app was never
created, so there is nothing at the provider to dispose and no handle to act on. In
`sweepAllocations` (`src/playground/manager.js`), a non-terminal record without a composeId can
only be adopted for disposal when inventory yields **exactly one** name match; with zero
matches it defers (`pending++`) every cycle, silently and forever — observed across 16 healthy
sweep cycles while the composeId-bearing af37 record disposed in the same window. No fire can
fix this; the record is orphaned by construction.

## Outcome and acceptance

Outcome: the sweep gains a narrow orphan-retirement path at the adoption seam. A non-terminal
record may be terminally disposed **without a provider action** only when ALL of these hold:
(i) `cleanupRequested` is true; (ii) the record has no composeId; (iii) a fresh provider
inventory read yields zero matches for its plan name (exact or prefix); (iv) the record arrived
through the same scope load and cleanup gate that gate the existing adoption path, so the same
ownership/tenant guards have passed. The terminal write is the same one `disposeAllocation`
makes for a never-allocated row (`phase: 'disposed'`, `disposed: true`, `disposedAt`,
`neverAllocated: true`), plus orphan journaling (`orphanRetired: true`,
`orphanReason: 'provider_inventory_zero_matches'`) so the closure is auditable by read-back;
later cycles close the native source through the ordinary disposed-record path.

Unchanged, as hard requirements: exactly-one-match adoption is untouched; more than one match
still defers; a record with a composeId never takes the new path; a no-composeId record without
`cleanupRequested` still defers; an inventory read failure defers (the read throws into the
row catch before any write), so nothing is ever retired on an unreadable inventory.

Accepted when: the new unit tests pass (fixtures modeled on the live stored record — phase
`creating`, `cleanupRequested`, revision 3, full plan, no composeId: zero matches retires with
the journaling and the index + cursor advance; zero matches without `cleanupRequested` defers;
two matches defer with no provider inspect; an inventory error defers; a composeId-bearing
record never consults inventory and disposes through the ordinary path with no orphan fields;
exactly one match still adopts and disposes), the existing playground manager/sweep suites stay
green, `ci` + `release-policy` are green at the exact head, and — after a release carrying the
fix — `job_b4dc31759005e8d8` reads back terminal `disposed` with the orphan journaling present,
the sweep cursor still advancing, and the manager record healthy. The release and read-back are
part of this card's closure step (owner-ordered with the sweep closure), not a separate fire:
no device is paused and no allocation is opened.

## Drift check

Confined to the adoption seam in `src/playground/manager.js` and its unit tests. No provider,
schema, authority, or disposal-path change; `disposeAllocation` itself is untouched (its
no-composeId refusal for uncertain creations still stands for every direct caller — the sweep's
retirement is justified only by the conjunction of cleanupRequested, a proven-empty fresh
inventory read, and the sweep's own scope/authority gates). No database record is hand-edited:
the orphaned record retires through the shipped code on its normal cycles, or this card does
not close.
