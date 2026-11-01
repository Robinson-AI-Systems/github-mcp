# FLEET-7 — Warm runtimes that switch on only under measured demand

## Owner approval 2026-11-01

Chris approved items 1–9 on 2026-11-01 with self-aware gates. Design and gates: [GATED-EXPANSION](../designs/GATED-EXPANSION-2026-11-01.md).

## Outcome and acceptance

Outcome: pre-started single-use runtimes cut start time, but only when measured demand and host headroom exceed stored thresholds; otherwise dormant, and they drain when demand falls. Never pre-binds credentials.

Accepted when the gate is implemented as code with tests for both the on and off decision, the feature works through every door it is offered on, and docs/TOOL-CATALOG.md describes it.

## Drift check

No gate raises spend, widens access or opens public sign-up by itself. Secrets never pass through a tool.

## Security design (written before code, 2026-11-01)

Hard rule: a warm runtime is never pre-bound to a workspace, connection, tenant or credential.

**Option (b) — a pre-started generic runtime that accepts one signed bind — was rejected** because it cannot be made
as strong as today's model without new trust paths:

- Today every allocation's identity is its binding. The plan bakes the binding into the compose name, all four volume
  names, both network names, every label, the executor's `CODING_WORKSPACE_BINDING`, the broker's
  `NATIVE_GIT_SINGLE_WORKSPACE_ID`/`NATIVE_GIT_SINGLE_BINDING`, the lifecycle callback (with tenant and identity) and the
  ingress host name. Provider ownership checks compare the composeFile byte for byte against the stored plan hash; the
  sweep, cleanup evidence (four exact volume names), network-isolation readback and enforcement records all key on it.
- Dokploy changes a compose's environment only by redeploying it, which restarts the containers, so a late bind through
  the provider saves nothing. A late bind through the runtime itself needs a new unauthenticated-until-bound endpoint
  inside an already running container, a second identity scheme for ownership/cleanup, and volumes and networks that
  existed (and were mountable) before any tenant owned them. Each of those is a weaker guarantee than today's.

**Option (a) — warm image — was implemented.** A warm runtime is a tenant-free *image holder*: one service using the
exact digest-pinned runtime image, `network_mode: none`, read-only, UID 1000, `cap_drop: ALL`, no-new-privileges,
0.05 CPU / 64 MiB, no environment, no volumes, no networks, no ports, no domains, no binding labels, no key, no
credential. It keeps the image on the pool's host (so a new allocation's containers start without a pull) and does
nothing else. No allocation code path reads, adopts, binds to or reuses it; every workspace keeps its own fresh,
single-use, per-binding allocation, unchanged. Pre-creating empty volumes was also rejected: allocation volumes are
named and labelled by binding and deleted with their compose (`deleteVolumes: true`); pre-created ones would have to be
`external`, which Dokploy does not delete with the compose, so cleanup would get weaker. Volume creation is milliseconds;
the image download is what is slow.

Isolation constraints honoured (docs/AI-PR-READ-FIRST.md):

- Principal/tenant binding: unchanged for allocations; holders carry no principal, so there is nothing to cross.
- No credential enters a holder, a tool argument or a result; the read output carries thresholds, counts and phases only.
- Revocation/expiry: unchanged; a holder has no authority to revoke.
- Writes: holders are created only by the trusted sweep (not a tool), with compare-and-set records written before every
  provider call, exact inventory recovery of a lost create, exact ownership checks before stop/delete and independent
  absence readback after delete.
- No spend: no plan, server or paid feature; defaults keep it dormant; the only cost when active is a 64 MiB idle process
  per warm image on an existing host.

## Gate (as built)

Off unless, per pool, demand (new pool allocations in the last 24 h ÷ 24, from the stored allocation index) ≥
`PLAYGROUND_WARM_MIN_ALLOCATIONS_PER_HOUR` (6) **and** a fresh (≤ 60 s, same project) host observation shows ≥ 8 GiB
memory, ≥ 50 GB disk and pressure ≤ 0.5. Size = min(max images 2, ceil(demand/6), images in use, running + whole 6 GB
images above the disk minimum). Drains when demand falls, headroom shrinks/goes stale or `PLAYGROUND_WARM_RUNTIMES=off`.
Any invalid setting = off. Details: [Playground operations](../PLAYGROUND-OPERATIONS.md#warm-runtimes-fleet-7-2026-11-01).

## Built 2026-11-01

- `src/playground/warm-runtimes.js`: `warmSettings`, `warmDecision` (pure gate), `warmHolderPlan`,
  `decideWarmRuntimes`, `reconcileWarmRuntimes` (sweep), `warmRuntimeStatus` (read output).
- `src/db.js` `playgroundDemandSince(since)` (read-only count over existing index rows; no schema change) and the same
  method in `test/helpers/fake-db.js`.
- `src/playground/manager.js`: the cleanup sweep runs the gate after allocation cleanup; a failure there never blocks
  cleanup. The response adds `warm {enabled, running, pending}`.
- `src/tools/playground.js`: `github_playground_read` `capabilities`/`availability` without `workspace_id` add
  `warm_runtimes`.

Tests (`tests/unit/playground-warm-runtimes.test.js`):

- defaults keep it dormant on today's single small shared host; off below each threshold and on only when demand AND
  headroom both exceed them; kill switch and fail-closed invalid settings; off when no digest-pinned image exists.
- pool sizing from demand, ranked by use, capped by max images, headroom and running holders.
- a warm runtime is never pre-bound (plan holds only the image; same for every tenant; cannot collide with an allocation
  name; refuses non-digest images).
- reconcile through the fake Dokploy (pinned operations/bodies): demand counting; dormant gate makes no calls; one create
  per round, deploy, running; drain with stop/exited/delete/absence readback when demand falls; drain when headroom
  shrinks or goes stale; kill switch; lost create recovered from exact inventory; never-appearing create dropped after
  ten minutes; tampered holder never deleted; pool `serverId` honoured and removed-pool holders preserved.
- sweep coverage: the cleanup sweep drains warm holders with no allocations left; a failing warm step never blocks cleanup.
- plain-words visibility through `github_playground_read` capabilities/availability.
- a workspace provision never adopts or touches a warm holder and uses the same image it keeps ready.
- `tests/db/settings.test.js` "FLEET-7 counts new pool allocations…" on real Postgres.

Not done / not claimed: no live measurement of the start-time saving (needs demand that does not exist yet); the gate
is dormant on today's host by design.
