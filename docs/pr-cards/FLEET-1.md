# FLEET-1 — Right-sized Playground runtimes and Git-only workspaces

## Owner request 2026-11-01

Chris asked to "scale workspace/runtime environments so that much smaller projects use much smaller spaces that still
allow them to complete their work at very short time periods", alongside the wider multi-host design in
[RUNTIME-FLEET](../designs/RUNTIME-FLEET-2026-11-01.md). FLEET-1 is the first, independently useful outcome.

## Outcome and acceptance

An agent can open a Git-only workspace that queues no Playground allocation, or choose a small/medium/large runtime whose
whole allocation never exceeds that class or the protected operator ceilings. Accepted when: (1) `runtime: none` opens a
workspace with `playground.reason = runtime_not_requested` and no allocation; (2) a `small` allocation's planned compose
totals ≤ 2 CPU / 2 GiB and the class is recorded and reported; (3) an existing allocation keeps its class; (4) with no class
and no `PLAYGROUND_DEFAULT_SIZE`, the plan is byte-identical to the original 8 CPU / 8 GiB plan; (5) the `size` argument
passes the nine write-contract checks through every door.

## Delivered (source)

- `src/playground/sizing.js` — classes small 2/2 GiB, medium 4/4 GiB, large 8/8 GiB; protected `PLAYGROUND_DEFAULT_SIZE`
  (default `large`); classes only lower ceilings.
- `src/playground/allocations.js` — `enqueueAllocation(…, {size})` and `ensureAllocation(…, {size})` store an immutable
  `size` on new rows; legacy rows unchanged; `inspectAllocation` reports `runtime_size`.
- `github_git_workspace_open.runtime` (`auto|none|small|medium|large`), `github_playground_workspace` `size` on provision.
- Availability's egress limitation now matches the allocation's network profile (gateway proxy on
  `dedicated-ingress-v2`, offline only on older `dedicated-internal-v1`).
- Tests: `tests/unit/playground-sizing.test.js`, `tests/unit/playground-workspace-size-contract.test.js`,
  `tests/unit/native-git-service.test.js` (Git-only open), `tests/unit/playground-best-effort.test.js` (egress text).

## Not included

No resize of a live allocation, no slim image, no warm pool, no new host types — those are FLEET-2…6 in `docs/ROADMAP.md`.
Changing the production default size is an owner/operator setting (`docs/OWNER-CHECKLIST.md`). Live acceptance of a
small runtime on the Dokploy host waits for PLAY-1's live pass and a release.

## Drift check

Extends PLAY-1's allocation planning only by lowering ceilings; does not change PLAY-1's security contract, PLAY-2's
fences, the RTC dialect or any owner default. If PLAY-1 live corrections conflict, PLAY-1's operational record governs.
