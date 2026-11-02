# 2026-11-02 — PG-STUCK-1: stuck Playground runtimes are replaced

- **What changed:** a shared-pool Playground runtime that failed to start (Dokploy `error`) or made no provisioning or
  attachment progress for 45 minutes (`PLAYGROUND_STUCK_AFTER_MINUTES`) is removed by the sweep or by the next
  provision/attach/run, keeping the person's Git workspace, and a fresh runtime replaces it on the next provision, attach
  or run (after 3 failures in a row it is reported instead). Status reads and rejected calls no longer extend a
  workspace's idle lease. Attach answers say exactly what is happening and the one next call. `github_git_workspace_close`
  waits for runtime deletion or says "call again with the same arguments", and the same call finishes an unconfirmed close.
- **Verified:** unit tests (`playground-stuck`, `native-git-lease-activity`, run replacement tests) plus every existing
  Playground and native Git suite and write-contract check through every door. Not verified: against live Dokploy.
- **Live effect after release:** the five stuck Appliance Desk runtimes (created 2026-10-30/31, far past 45 minutes) are
  marked `runtime_stuck` and removed by the next sweeps (manager every 30 s); their workspaces stay open until their idle
  lease runs out (no longer renewed by status reads).
- **Branch/PR:** `ai/claude/playground-stuck-allocations` (see the PR for head SHA and CI).
- **Next:** after release, read the five allocation rows (expect `phase: disposed`, `runtimeOnly: true`) and confirm the
  composes are gone in Dokploy.
