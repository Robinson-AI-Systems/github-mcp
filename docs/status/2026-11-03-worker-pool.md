# 2026-11-03 — Worker pool (WORKER-POOL-1)

Owner request (via Vivienne): use Chris's other machines automatically when the main PC is busy. Built the native Git
worker pool: hosts from protected settings (`NATIVE_GIT_WORKER_URL`, `NATIVE_GIT_PREVIOUS_WORKER_URL`, new optional
`NATIVE_GIT_WORKER_POOL`), a stored owner adjustment `native_git.worker_pool` (disable / priority / limit only), live
signed status with a short cache, placement in every opener (preferred first, spill when paused, busy, full or offline,
plain retryable refusal with `no_operation_started` when all are), pinning for life, relay route `h.<host id>` (old `w`/`p`
kept), git remote keys recorded on their host, worker `active_workspaces` / `max_workspaces` (`NATIVE_GIT_MAX_WORKSPACES`)
and pool health in `github_server_status`. Card: [WORKER-POOL-1](../pr-cards/WORKER-POOL-1.md).

Verified here: `tests/unit/worker-pool.test.js` and the existing native-git, transfer-relay, git-remote, git-direct,
pc-worker, playground-run, repo-change and server-status suites; full `npm run check` on the assembled tree.
Not verified: any real second host (none configured yet), image build (no Docker daemon in the sandbox).

Next (after release): to use Dokploy as the spill host nothing new is needed (it is already the previous worker); to add
the Workshop machine, deploy the worker there and add it to `NATIVE_GIT_WORKER_POOL`; then `github_server_status` should
list both hosts, and pausing the PC should send the next open to the other host. Queue, Wake-on-LAN, other people's
machines and an owner edit surface are in ROADMAP.
