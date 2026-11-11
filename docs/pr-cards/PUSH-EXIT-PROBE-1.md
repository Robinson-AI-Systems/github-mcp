# PUSH-EXIT-PROBE-1 — An unreachable push-exit probe backed by the worker's own report reads "degraded", not "down"

## Request (2026-11-11)

Owner go-ahead, 2026-11-11 09:01 MST (main chat, "do the first two"). Since the github instance moved onto the rack on
the owner's PC, `github_server_status` has reported `direct_git: down` all day. A crew discriminator that morning showed a
real push through the PC worker landing on GitHub and reading back clean. The gauge checks `GIT_DIRECT_ORIGIN/health`,
which is the PC's own Tailscale Funnel address, from inside the same PC. That connection would have to leave the machine
and come straight back (a hairpin), so it cannot connect, though the address answers from everywhere else.

The crew's in-container probes (2026-11-09) found no route at all from the rack instance to the push-exit listener
(127.0.0.1:47301): loopback, host.docker.internal, tailnet IP and name, bridge gateway and LAN address were all
unreachable. The only working route reaches the worker's API listener (47300), a different listener. So an
"internal route" setting could not truthfully check the push exit. This card takes the crew's drafted alternative.

## Outcome and acceptance

Outcome: when the push-exit probe gets no healthy answer, but the push exit is the primary host and that host's signed
capabilities (read in the same status call) report its direct git host on exactly `GIT_DIRECT_ORIGIN`, the gauge says
`degraded` with that reason and `corroborated_by: worker_report`, never `ok`. Every other failure stays `down`.
Accepted when the PUSH-EXIT-PROBE-1 test in `tests/unit/server-status.test.js` passes, the existing server-status,
push-exit and owner-host suites pass unchanged, and `ci` + `release-policy` are green at the exact head.

## Design

- `checkDirect` marks a probe with no healthy answer (timeout, error, non-200) internally; the mark never leaves the
  server.
- `corroborateDirect` (same file) turns it into `degraded` only when all hold: the push exit is the `primary` host (the
  host whose capabilities this read checked), the worker check is not `down`, the worker reports `ready: true`, and its
  `git_direct.origin` equals `GIT_DIRECT_ORIGIN`'s origin. The reason says plainly that the listener itself was not
  checked and a real push is the proof.
- No address, origin or key is returned. No new setting.

## Tests

`tests/unit/server-status.test.js` › "PUSH-EXIT-PROBE-1: an unanswered push-exit probe is degraded, not down, only when
the primary worker's signed report names that origin": healthy probe unchanged; 503 and timeout corroborated; worker
down, not ready, draining, different origin and no `git_direct` all stay `down`. Mutation-checked: with corroboration
disabled the test fails.

## Drift check

Builds on SRV-STATUS-1 and PUSH-EXIT-1 unchanged: same probe, placement, audience rule (WORKER-POOL-2), time budget and
no-address output. New: one `degraded` outcome with `corroborated_by` on `health.direct_git`. No GitHub request,
credential, permission, setting or database change.
