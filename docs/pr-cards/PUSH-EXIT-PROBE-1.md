# PUSH-EXIT-PROBE-1 — The push-exit gauge can check an internal route, so it stops saying "down" on the rack

## Request (2026-11-11)

Owner go-ahead, 2026-11-11 09:01 MST (main chat, "do the first two"). Since the github instance moved onto the rack on
the owner's PC, `github_server_status` has reported `direct_git: down` all day. A crew discriminator that morning showed a
real push through the PC worker landing on GitHub and reading back clean. The gauge checks `GIT_DIRECT_ORIGIN/health`,
which is the PC's own Tailscale Funnel address, from inside the same PC. That connection would have to leave the machine
and come straight back (a hairpin), so it cannot connect, though the address answers from everywhere else.

## Outcome and acceptance

Outcome: on the rack, the gauge reports the push exit's real state and says how it checked. Accepted when the
PUSH-EXIT-PROBE-1 test in `tests/unit/server-status.test.js` passes, the existing server-status, push-exit and
owner-host suites pass unchanged, and `ci` + `release-policy` are green at the exact head.

## Design

- **Setting** `GIT_DIRECT_HEALTH_URL` (MCP, optional, owner-protected): an `http(s)://…/health` route to the push exit's
  own listener. Path exactly `/health`; no credentials, query or fragment.
- **Gauge** (`checkDirect` in `src/tools/server-status.js`): set → fetch only that route (same budget,
  `redirect: 'error'`) and report `checked: internal_route` plus a note that the public address cannot be tested from the
  same machine. Unset → unchanged public check, `checked: public_address`. Malformed → `down`, setting named, nothing
  fetched. The address is never returned.
- **Trade-off:** while the internal route is used, a dead public Funnel does not show on this gauge. The PC worker's
  auto-update keeps its own public Funnel health check (`deploy/pc/worker-autoupdate.sh`).

## Tests

`tests/unit/server-status.test.js` › "PUSH-EXIT-PROBE-1: with GIT_DIRECT_HEALTH_URL it checks the internal route, says so,
and never shows the address".

## Drift check

Builds on SRV-STATUS-1 and PUSH-EXIT-1 unchanged: same check placement, audience rule (WORKER-POOL-2), time budget and
no-address output. New: one optional protected setting and the `checked` / `note` fields on `health.direct_git`. No
GitHub request, credential, permission or database change.
