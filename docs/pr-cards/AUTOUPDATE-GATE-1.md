# AUTOUPDATE-GATE-1 — The PC worker updater swaps for real and checks the public path like a caller

## Request (2026-11-11)

At 14:45 MST the self-updater (WORKER-AUTOUPDATE-1) closed admission and tried to move to f604349. The operator
repair (Vivienne's crew) traced three defects that together closed git service for 84 minutes:

1. **The public gate probed from the wrong place.** `public_health_ok` curled the PC's own Funnel name from the WSL
   host. That name can resolve to the PC's own tailnet address, which refuses the device itself (the recorded
   hairpin class), so the gate failed in about 1 ms. From Windows, a container and the internet, the same URL
   answered 200. A good build failed, and so did its rollback, which left admission closed for operator repair.
2. **The swap never happened under the updater's pause.** install.sh skips starting the new image whenever the
   pause file exists, including the updater's own pause. Verification read only the `.env` record, so an update could
   be "verified" while the old container kept serving.
3. **No memory of a failed target.** Once resumed, the updater would re-close admission, fail the same gate and
   re-lock every cycle.

## Outcome and acceptance

- `public_health_ok` tries the host first, then the same request from inside the worker container (node fetch), which
  resolves and egresses like every other caller.
- install.sh starts the new image under the updater's own marked pause. The new container reads the same pause file, so
  admission stays closed until the updater verifies and reopens it. Only the owner's own pause means "do not start".
- `verify_build` requires the running container's `NATIVE_GIT_BUILD_COMMIT` to equal the target.
- A target that failed verification is written to `autoupdate/failed-target` and held (status `holding`) until `live`
  moves or an operator removes the file. A verified update clears it.

Accepted when the AUTOUPDATE-GATE-1 checks in `tests/unit/worker-autoupdate.test.js` pass, the WORKER-AUTOUPDATE-1
and resolver-guard suites pass unchanged, and `ci` + `release-policy` are green. Live acceptance: the next kit
install, then `pc-worker autoupdate resume`, then one real update cycle with receipt `updated`, a running build
equal to `live`, and admission reopened.

## Drift check

This changes deploy/pc only. No server code, settings or worker protocol changes, and the owner's pause still blocks
every start and every update.
