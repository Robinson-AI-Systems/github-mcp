# 2026-11-03 — Owner-only pool hosts (WORKER-POOL-2)

Owner decision (Chris, in chat): "Only my work on my PC." Built owner-only pool hosts: each native Git pool host has an
audience (`owner` or `shared`) from protected configuration only (optional `audience` field in `NATIVE_GIT_WORKER_POOL`);
by default the primary (the PC) is owner-only whenever another host is shared, so today's settings (PC primary, Dokploy
previous) need no change. Only the operator's own direct connector is the owner; public-connect, tenant and Marketplace
people, service passes and RTC/HTTPS door calls go to Dokploy. Placement, unpinned capability probes, git remote setup
(no PC direct address), the direct host's authorization (refuses keys from another host) and `github_server_status`
(audience per host; the PC shown to others as `owner_only`, no direct-git check) all follow it. Pinned workspaces and keys
keep their host and a non-owner one on the PC is counted and logged. Card: [WORKER-POOL-2](../pr-cards/WORKER-POOL-2.md).

Verified here: `tests/unit/worker-pool-owner-hosts.test.js`, the existing worker-pool (now as the owner), native-git,
transfer-relay, git-remote, git-direct, server-status, repo-change and pc-worker suites, the full unit suite in shards and
`npm run check` on the assembled tree. Not verified: live (needs the next release).

Next (after release): from a public-connect account, `github_git_workspace_open` should land on Dokploy and
`github_server_status` should list `pc` as `owner_only`; from Chris's own connector the PC stays first.
