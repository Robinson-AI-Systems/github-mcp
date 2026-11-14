# 2026-11-11 — PUSH-EXIT-PROBE-1: the push-exit gauge stops reporting a false "down" on the rack

Owner go-ahead: Chris, 2026-11-11 09:01 MST (main chat, "do the first two": this fix and the Playground image pin).

**Problem.** Since the github instance moved onto the rack on the owner's PC, `github_server_status` has reported
`direct_git: down` all day, while a crew discriminator showed real pushes landing. The gauge probes the PC's own Tailscale
Funnel address from inside the same PC, which cannot connect (a hairpin). The crew's probes found no route from the rack
instance to the push-exit listener at all, so a direct internal probe is not possible today.

**Change.** When that probe gets no healthy answer but the primary worker's signed capabilities (same read) report its
direct git host on exactly `GIT_DIRECT_ORIGIN`, the gauge says `degraded` with `corroborated_by: worker_report` and a
plain reason, never `ok`. Everything else stays `down`. An earlier draft of this PR added a `GIT_DIRECT_HEALTH_URL` setting;
it was dropped after the crew showed the only reachable route checks a different listener (47300, not 47301).

**Not done here.** A real probe of the push-exit listener from the rack would need its own tunnel door to 47301 (a tunnel
and DNS change with an exposure review), or the rack-internal route proposed in the 2026-11-11 rack audit.
