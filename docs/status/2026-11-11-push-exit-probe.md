# 2026-11-11 — PUSH-EXIT-PROBE-1: the push-exit gauge stops reporting a false "down" on the rack

Owner go-ahead: Chris, 2026-11-11 09:01 MST (main chat, "do the first two": this fix and the Playground image pin).

**Problem.** Since the github instance moved onto the rack on the owner's PC, `github_server_status` has reported
`direct_git: down` ("did not report healthy") all day. A crew discriminator on 2026-11-11 showed a real push through the
PC worker landing on GitHub and reading back clean. The gauge checks `GIT_DIRECT_ORIGIN/health`, which is the PC's own
Tailscale Funnel address, from inside the same PC. That connection would have to leave the machine and come straight back
(a hairpin), so it cannot connect, though the same address answers from everywhere else.

**Change.** New optional setting `GIT_DIRECT_HEALTH_URL`: an internal `http(s)://…/health` route to the push exit's own
listener. When it is set, the gauge checks that route, reports `checked: internal_route`, and says plainly that the
public address could not be tested from the same machine. When it is unset, the public address is checked exactly as
before (`checked: public_address`). A malformed value is reported as `down` with the setting named, never guessed around.
The address is never returned.

**Tests.** `tests/unit/server-status.test.js` › "PUSH-EXIT-PROBE-1…": public default unchanged, internal route OK and
named without leaking the address or port, internal route failing is still `down`, five malformed values refused with
nothing fetched. The existing push-exit and owner-host suites pass unchanged.

**Not done here.** Setting the value on the rack, and checking the live gauge, happen after release. The internal route's
exact shape comes from the crew's rack evidence. A truly dead public Funnel will not show on this gauge while the internal
route is used; the worker auto-update's own public Funnel health check (`deploy/pc/worker-autoupdate.sh`) still covers it.
