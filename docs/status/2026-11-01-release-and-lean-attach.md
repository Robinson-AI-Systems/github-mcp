# 2026-11-01 — Manual release, worker redeploy, lean attachment

**Released (Chris asked, 06:54 MST):** manual checked release of main `a3c47f916b08` to `live` (daily-live run 41313581390,
success). Vercel production deployment `dpl_C5Cxpa7MgraxeuTVrZPmoSryfS3a` READY, aliased to github.robinsonaisystems.com.
Native Git worker redeployed on Dokploy from `live` (deployment zQPGrP5b, done; volume kept). Live checks through the
released MCP: Git-only open (`runtime: none` → `runtime_not_requested`, no allocation) and a full clone of this repository
both succeeded and were closed. A real paired machine and a medium build are still to be tried.

**FLEET-6 (source, this PR):** lean attachment — see [card](../pr-cards/FLEET-6.md).
