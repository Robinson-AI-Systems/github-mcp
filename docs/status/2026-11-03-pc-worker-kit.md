# 2026-11-03 — PC worker kit (PC-WORKER-1)

Owner decision: the PC is the primary native Git worker; Dokploy stays the previous worker. Built `deploy/pc/`
(compose file, `.env.example`, `install.sh`, `pc-worker`), the worker's owner-pause switch (`<storage>/.owner-pause`
refuses new work with `no_operation_started`; admitted work finishes), clearer control-plane messages for a paused or
stopped PC, and the runbook [PC-WORKER](../PC-WORKER.md). Card: [PC-WORKER-1](../pr-cards/PC-WORKER-1.md).

Verified here: unit tests (`tests/unit/pc-worker-owner-pause.test.js` plus the existing native-git, git-direct,
server-status and repo-change suites), shellcheck, `docker compose config`, and both scripts end to end against a fake
docker and fake `tailscale.exe`. Not verified here: an image build and container run (no Docker daemon in the sandbox),
and anything on the real PC, Tailscale or Vercel.

Next (owner-side operator, then agent): run the installer inside WSL as root, then with `--configure-funnel`; switch the
four Vercel settings (`NATIVE_GIT_WORKER_URL`, `NATIVE_GIT_PREVIOUS_WORKER_URL`, `NATIVE_GIT_WORKER_CUTOVER_AT`,
`GIT_DIRECT_ORIGIN`) with the next release; `github_server_status`, one `github_git_remote_setup`, live acceptance on
the scratch repository. Steps: [GO-LIVE-CHECKLIST](../GO-LIVE-CHECKLIST.md) "PC worker".
