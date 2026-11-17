# 2026-11-17 — DOKPLOY-RETIRE-1: Dokploy removed from GitHub Unleashed

**Why.** Chris: "we need to button up dokploy and remove it from all of our stuff. It will no longer be available for our use." David is reclaiming the Dokploy server (dash.alphaflux.net). Chris chose to retire Dokploy support fully.

**Live, before this change.**
- Production settings: removed `PLAYGROUND_DOKPLOY_ORIGIN/_PROJECT_ID/_ENVIRONMENT_ID/_API_KEY` and `PLAYGROUND_INGRESS_IPV4`.
- `NATIVE_GIT_WORKER_POOL` rebuilt without the `dokploy` host (pc 10, workshop 30, potato 900 with cap 2, all owner).
- Production restarted (rack generation 71). Server status: worker pool pc, workshop, potato; no Playground pool or manager.

**Code.**
- Deleted the Dokploy provider and pools (`dokploy.js`), warm runtimes, the operator resource/network policy, telemetry admission, compose read-back parsing and the manager worker.
- The workspace plan moved to `compose-plan.js` (used by device placement); it carries no provider address.
- `allocations.js` places runtimes only on paired computers. With none it answers plainly: "Pair one of your own computers or servers with github_playground_host_pairing". A row left from the pool is closed in place (`retiredPool: true`).
- Availability and authority treat a pool row as retired (`shared_pool_retired`, cleanup requested). Operator-supplied runtimes with signed observations are unchanged.
- The sweep keeps cleaning up and now accepts the deployment's `CRON_SECRET`. The rack's project timer calls it every minute, replacing the Dokploy manager that used to.
- Server status no longer reports a Playground pool or manager.

**Tests.**
- New: `tests/unit/playground-pool-retired.test.js`.
- Sizing is checked on the plan itself.
- Removed the tests that drove a fake Dokploy server. Paired-computer placement stays covered end to end by `fleet-dial-out`.
