# 2026-11-14 — merge waits out GitHub computing mergeability (MERGE-PENDING-1)

See docs/pr-cards/MERGE-PENDING-1.md. `github_workflow_merge_when_green` no longer refuses a clean, green PR in the seconds after its branch moves (GitHub `mergeable: null`); it reads again, and if still pending answers `mergeability_pending` instead of a fault.
