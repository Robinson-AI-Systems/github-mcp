# REVIEW-1119: Second Shift review 2026-11-19 (13 findings on PR #663, DOKPLOY-RETIRE-1)

## Outcome and acceptance

- **Real bug fixed.** `github_playground_read` operation `capabilities` without a `workspace_id` still called
  `warmRuntimeStatus`, deleted with the Dokploy pool, so it threw a ReferenceError (live since 2026-11-17). It now answers the
  setup guidance without `warm_runtimes`. New test in `playground-tools.test.js`; it fails on the old code with that exact error.
- **The whole class is now caught by lint.** `eslint.config.js` adds `no-undef` (with Node globals) for `src/`, `api/`,
  `workers/`, `scripts/`, `tools/` and the root scripts. Across the repository this was the only undefined name.
- **Sweep stops re-reading finished rows.** The rack's `playground-sweep` timer took about 20 s of its 20 s budget every
  minute re-checking all 121 stored rows. A row whose runtime and workspace are both gone (`phase: disposed`,
  `sourceDisposed: true`; 51 of them in production on 2026-11-19) is now skipped without loading its scope; the reply adds
  `skipped`. New test in `playground-pool-retired.test.js`.

## Findings answered without a code change (evidence)

- **High 1 (retired rows marked disposed).** Already labelled honestly by REVIEW-1118: the row reads `retired_pool: true`,
  `cleanup: manual_by_server_owner`, "not a checked teardown". `disposed: true` means the row is closed, which the sweep
  needs to stop. Production check 2026-11-19 ~11:20 UTC: **no row has ever been closed this way** (`retiredPool` is unset on
  all 121 index rows); every pool row was disposed by the old checked teardown before the retirement.
- **High 2 (stale membership/namespace).** False alarm. `namespaceMissing` and `membershipValid` are set by
  `allocationScope` / `orphanAllocationContext` (`src/playground/lifecycle.js`, `src/playground/index.js`) when the context
  is built; the removed `refreshAdmission` only refreshed the telemetry admission feed and never touched them.
- **High 3 (CRON_SECRET).** Same contract the deployment already uses for the Marketplace sweep
  (`src/marketplace/lifecycle.js`: at least 32 characters, timing-safe compare), held only by the deployment and the rack's
  project timer (`rack-server.mjs`), documented in `docs/ARCHITECTURE.md` and `docs/KEY-ROTATION.md`. The sweep only
  advances or removes allocations whose own authority says so.
- **Medium 4–8, Low 10 (unverified live claims).** Captured 2026-11-19 ~11:20 UTC: `github_server_status` reports workers
  pc, workshop, potato only, no Playground pool or manager, release `1ad8d381`; Rack Control `rack_project_health github`
  shows timer `playground-sweep` (every 60 s) `last_outcome: ran`, HTTP 200, route generation 79. Production database: 121
  allocation index rows, 120 `disposed`, 1 `deleting` (a device runtime on a paired computer, not the pool); no open pool
  row, so the sweep has nothing of Dokploy's left to tear down. The DOKPLOY-RETIRE-1 card already carries the 2026-11-18 check.
- **Medium 9 (hand-seeded fixture).** A leftover pool row can no longer be created by any code path (that is the point of
  the retirement), so seeding the stored shape is the faithful fixture; it matches the production rows' fields.
- **Low 11 (“gone from the code”).** `grep -ri dokploy src` shows only comments, with one exception now named in
  `docs/PLAYGROUND-OPERATIONS.md`: the transfer relay's broker route (`src/native-git/relay.js`) still reads
  `PLAYGROUND_INGRESS_IPV4` / `PLAYGROUND_POOLS`. Both settings were removed from production, so the route is inert.
- **Low 12 (deleted budget test).** The retired-pool close path is covered by `playground-pool-retired.test.js`.
- **Low 13 (secret-looking value).** The deleted fixture used `FAKE_PROJECT_KEY` and example hosts: a placeholder.

## Drift check

No tool added or removed. `github_playground_read` capabilities reply (no `warm_runtimes`), sweep reply adds `skipped`, lint rule.
