# FLEET-3 — Dial-out host agent: anyone's own computers and servers as Playground hosts

## Owner approval 2026-11-01

Chris approved the dial-out host agent, "own machines first, then the shared pool", and stated the product must work for
**everyone who signs in**, not as his private toolset; his PC, Dokploy access and tailnet are just resources he happens to
have. Design: [RUNTIME-FLEET](../designs/RUNTIME-FLEET-2026-11-01.md) §2.1–2.2.

## Outcome and acceptance

Any signed-in person can add a computer or server they control from My connection with one command; after approval and an
automatic readiness check it becomes **Ready**, new workspaces are placed on it before the shared pool, signed commands
reach its runtime through outbound check-ins only, and revoking it stops and deletes its runtimes.

Accepted when (tests): (1) pairing without any tunnel origin writes an opaque device route and needs owner approval;
(2) the readiness check over check-ins promotes to `ready` only if Docker, Compose, a truly internal network and UID 1000
pass; (3) placement prefers a ready, recently checked-in machine of the same connection with enough capacity, otherwise the
shared pool, otherwise Git-only; (4) a signed coding claim travels mailbox → agent → loopback gateway → runtime unchanged
and its answer comes back; (5) a runtime the machine would expose is refused; an offline machine leaves the allocation
waiting; (6) revocation bumps the generation, the agent terminates and attests absence, the machine is shut out (410);
(7) replayed, forged, foreign-tenant and inactive-grant check-ins and unsigned orders are refused.

## Delivered (source)

- Control plane: `src/fleet/{protocol,mailbox,relay,host,scope,device-allocations}.js`, `api/fleet/checkin.js`,
  `api/fleet/report.js`; dial-out pairing in `src/playground/enrolled-hosts.js`; placement, dispose, inspect, resume in
  `src/playground/allocations.js`; device-aware availability/authority/preview; relay transport used by
  `src/playground/client.js` and `src/native-git/client.js` (`*.fleet.invalid` origins can never resolve on the network).
- Agent: `tools/playground-device/agent.mjs` (join, run, status, leave); setup guide at the top of
  `tools/playground-device/README.md`; My connection shows the join command, check-in time and capacity.
- Tests: `tests/unit/fleet-dial-out.test.js`.

## Not included / limits

Interactive browser preview on own machines (text preview works); device-native Git (FLEET-6) — attachment still uses the
100 MiB sealed transfer, relayed; one-click installers/services per OS; publishing the runtime image (FLEET-2). Live
acceptance needs a release plus a real paired machine (owner checklist).

## Drift check

Keeps PLAY-1's runtime contract (signed ≤90 s claims verified by the runtime, no credentials in runtimes, four volumes,
private network) and PLAY-2's fences (only the owner's own machines, owner approval, device-attested cleanup labelled as
such). Supersedes PLAY-2's public-tunnel requirement as the first transport, per the owner's approval.
