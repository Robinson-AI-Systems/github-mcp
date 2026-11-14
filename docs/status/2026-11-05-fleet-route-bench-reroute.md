# 2026-11-05 — Suite entry points route to the benches by construction (fleet-route)

Owner direction (Chris, 2026-11-05): bench execution is the default BY
CONSTRUCTION, not a per-job choice — the dispatcher only ever moved jobs
somebody dispatched, while most crew execution happened inline in agent
sessions and never became a job.

What changed in this repo (tooling only; no product code, no CI change):

- `scripts/fleet-route.mjs` (new): the shim. `package.json` now routes
  the heavy entry points — `check`, `test`, `test:db`, `test:browser`,
  `test:shapes`, `test:rtc` — through it; their original commands are
  preserved verbatim in the new `fleetRoute` map.
- On Vivienne's VM the shim hands the command to `fleet-run`
  (~/workspace/scripts/fleet-run): the exact working tree (uncommitted
  changes included) is snapshotted as a git bundle and placed through
  fleet-dispatch, streamed back, and exited with the placed run's exit
  code. The run leaves a ~/workspace/fleet-jobs/ ledger entry (repo,
  command, branch, snapshot, bench, unit, exit, duration).
- Placement order (updated 2026-11-14 to match fleet-dispatch as of
  2026-11-13): the rack route first (fleet.work), then the benches. An
  unpinned run retries the benches for up to 300 s before a VM fallback,
  and that fallback is recorded in the ledger — it is never silent.
- This shim never runs the suite on the VM by itself: if fleet-run is
  missing or fails to start, it exits non-zero. A local run happens only
  where the command already belongs (a bench via FLEET_ON_BENCH, GitHub
  Actions, a platform build) or as the explicit, loud, unledgered
  exception FLEET_RUN_LOCAL=1.
- The VM's ~/.npmrc script-shell (fleet-npm-shell, 2026-11-13) is an
  additional net that routes npm suites in any checkout via fleet-run;
  it does not replace this repo-level shim.
- Declared non-reroutables (local, with a printed notice): watch modes
  and interactive debugging flags (--watch, --ui, --debug, --inspect).
  Live-target scripts (smoke:readonly, test:load, the rtc evidence
  collectors) are not wrapped at all: they interrogate the production
  deployment, not this tree.

CI is untouched: in GitHub Actions the shim detects GITHUB_ACTIONS and
executes the original command directly, byte-for-byte the old behaviour.
