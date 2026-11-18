# DOKPLOY-RETIRE-1: Dokploy removed from GitHub Unleashed

## Owner request 2026-11-17

"Button up dokploy and remove it from all of our stuff. It will no longer be available for our use." Chris chose to retire Dokploy support fully.

## Outcome and acceptance

- **No Dokploy code path remains.** Deleted: the provider, pools, warm runtimes, operator resource and network checks, telemetry admission and the manager service.
- **Runtimes run only on paired computers.** With none, provisioning says how to pair one, and the workspace stays Git-only.
- **Pool rows close.** A row left from the pool is closed in place and reported as retired.
- **The sweep keeps running.** It accepts `CRON_SECRET`, and the rack's project timer `playground-sweep` calls it every minute.
- **Acceptance:**
  - `tests/unit/playground-pool-retired.test.js`
  - `tests/unit/playground-sizing.test.js`
  - `tests/unit/server-status.test.js`
  - live: no Dokploy host or pool in `github_server_status`; the timer's `last_outcome` is `ran`.
    Checked 2026-11-18 ~11:09 UTC (LOG-FIXTURES-1 follow-up to the Second Shift review): `github_server_status` on
    release `4d1c7370ed68` lists `worker_pool.hosts` = `pc`, `workshop`, `potato` (all `audience: "owner"`), no Dokploy
    host or pool; Rack Control `rack_list_schedules` shows project timer `playground-sweep` with `last_outcome: "ran"`,
    HTTP 200, last run 2026-11-18T11:09:14Z.

## Drift check

Changes: `src/playground/*`, `src/fleet/device-allocations.js`, `src/tools/playground.js`, `src/tools/server-status.js`, `workers/coding-workspace/*`, tests, docs.
