# AUTOUPDATE-GATE-2: The self-updater can't lock itself out over the public path

## Request (2026-11-11 evening)

AUTOUPDATE-GATE-1 (#614) went live and the PC kit was refreshed. When Vivienne re-armed the updater, two cycles
failed and admission closed for 518 s (the pool carried the work). Her crew traced three faults:

1. The public probe still hairpinned. The worker container is host-networked, so #614's "probe from inside the
   container" uses the same vantage as the host.
2. Starting the new image was inconsistent. `pc-worker update` runs the install.sh already in `src/`, not the
   target's. The first update after a kit refresh therefore ran the pre-GATE-1 install.sh, which does not start
   under the updater's pause.
3. The failed-target hold was dropped. The rollback reinstalled the previous commit's kit, which replaced the
   running updater with an older one that has no hold, and the next cycle retried the same target.

## Outcome and acceptance

- The public check tries the Funnel origin, then the same origin resolved by public DoH (`--doh-url
  https://1.1.1.1/dns-query`), then `PC_WORKER_CANONICAL_ORIGINS` (default: the server's canonical worker origin).
- The public check is **advisory**. Everything the build controls is still gated: `.env` build, running container
  build, healthy state, local health, control-key pin and HTTP version. Outside reachability is judged by the MCP
  server's signed check and by the pool, which skips an unreachable host. The receipt records
  "public path unverified from this host" when the probe fails.
- `ensure_running` starts the built image itself if the install left the previous container running. This applies
  both to the update and to the rollback.
- The updater saves a copy of itself before the swap and puts itself back after a rollback, so its own safeguards
  survive.

Accepted when the AUTOUPDATE-GATE-2 checks in `tests/unit/worker-autoupdate.test.js` pass and `ci` + `release-policy`
are green. Live acceptance: kit refresh from live, then `pc-worker autoupdate resume`, then one cycle with receipt
`updated` and the running build equal to `live`.

## Drift check

This changes deploy/pc only, with one optional `.env` key. There are no server, protocol or settings changes, and the owner's own pause still
blocks every start and update. A worker whose build is wrong or unhealthy is still rolled back. Only the public-path probe
stopped being a gate.
