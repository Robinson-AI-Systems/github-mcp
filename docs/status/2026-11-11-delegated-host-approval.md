# Delegated Playground host approval (PLAY-3 amendment, 2026-11-11)

Owner instruction (Chris, main chat, 2026-11-11 05:11 MST): step 6 of PLAY-3 is to be handled
on his behalf today — his PC enrolled as instance #1 under his own GitHub Unleashed account,
with the pairing approval carried by his recorded delegation rather than by a click he cannot
make while away.

## What the approval act is (investigated in the built code)

`createEnrolledHostStore(...).approve(deviceId)` — a compare-and-set on the tenant settings row
flipping `pending_confirm` → `pending_canary`. Before this change its only caller was the My
connection page action, gated by the one-use GitHub-authenticated manage flow. No MCP tool or
API route could reach it, and the device side (`claim`, via `api/playground/enroll`) can only
prove the device key — by design it cannot approve.

## The amendment

- `github_playground_host_pairing` (write) + `github_playground_hosts` (read): begin / approve /
  revoke / list for the **calling connection's own** hosts. Scope is resolved exactly the way
  the page flow resolves it — the verified tenant + identity on the caller's tenant database
  (`playgroundScope`) and the caller's own client, which must be a Full connection (the same
  filter the page applies). A caller can only ever see or approve its own connection's devices.
- The store's `approve()` now always records provenance on the host record: the page records
  `{via:'my-connection'}`; this route records `{via:'owner-delegated-agent', clientId, at, note}`
  where `note` is the caller-supplied delegation note naming the owner instruction the approval
  rests on. `list()` exposes it on both routes.
- Anti-self-approval is unchanged and structural: the device holds no MCP credential and cannot
  call these tools; a pairing still cannot progress without the device first proving its key
  (`pending_confirm`), and approval from any other tenant, client or profile is refused.
- The pairing code returned by `begin` is a one-time, ten-minute owner-side secret, delivered
  only into the owner's own tool result — the same disclosure the My connection page makes to
  the owner — and is consumed by the owner-run install step on the machine being enrolled.

Tests: `tests/unit/play3-delegated-approval.test.js` — full begin → claim → approve cycle with
provenance, approval-before-claim refused, non-Full and foreign-client callers refused, foreign
tenant scope blind, browser-path provenance intact, delegated revoke.

## Release note

Step 6 uses this the day it is live; merging alone does not change production. The owner ordered
step 6 completed today (2026-11-11), which is the authority for promoting this change with the
PLAY-3 build on the same day rather than waiting for the nightly train.
