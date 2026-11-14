# 2026-11-11 — Merge when green: no endless waiting; deliberate merge-anyway fallback

- `github_workflow_merge_when_green` stays strictly green-only and is the recommended merge tool.
- `ciState` also treats "workflows exist but none ran for the commit in ten minutes, nothing required" as nothing to wait for (`basis: no-checks-configured`, `no_ci_reason`), and `waitForChecks` no longer reports `checks_running` after the wait proved there is no CI.
- When only CI, review or review threads are missing, `not_ready` carries `warnings` with suggestions and names `github_workflow_merge_anyway`.
- New `github_workflow_merge_anyway`: lists the warnings and an `acknowledge` code tied to that exact head and those warnings; merging happens only when called again with the code and a specific `reason` (20+ characters, recorded). Hard blockers (closed, draft, wrong head, not mergeable, wrong base) are never skipped.
