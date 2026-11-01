# FLEET-4 — Several shared runtime pools (Dokploy instances, projects or servers)

## Owner approval 2026-11-01

Chris approved "using several Dokploy servers". People's own machines still come first (FLEET-3); this spreads the shared
pool. Design: [RUNTIME-FLEET](../designs/RUNTIME-FLEET-2026-11-01.md) §2.2.

## Outcome and acceptance

The operator can list several Dokploy targets — other Dokploy instances, other projects, or other servers inside one
multi-server Dokploy — and new shared-pool runtimes spread across them by weight, while every existing runtime stays on the
pool it started on. Accepted when: legacy settings behave as one `default` pool; pool lists with inline secrets, bad JSON or
bad ids are refused; placement is deterministic and weight-proportional, weight 0 drains; creation goes to the chosen
origin with its `serverId`; the row records its pool and later steps use that pool; removing a pool refuses its rows'
operations rather than moving them (`tests/unit/playground-pools.test.js`).

## Delivered (source)

`dokployPools`, `choosePool`, pool-aware `dokployConfig` and `serverId` on create (`src/playground/dokploy.js`); pool stored
on new rows and used by provision/inspect/dispose/resume, the manager sweep and the managed baseline; the provision tool no
longer requires a shared pool when the person has their own ready machine.

## Not included

Live capacity-aware choice across pools (best-effort mode has no capacity feed; admission still refuses on measured
pressure where a feed exists). Adding a second real pool is an operator step (owner checklist).

## Drift check

Keeps exact ownership pinning per provider/project/environment, the manager's narrow capability and all PLAY-1 isolation
checks; nothing moves an existing allocation between pools.
