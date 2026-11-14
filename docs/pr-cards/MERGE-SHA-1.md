# MERGE-SHA-1 — Return the verified merge SHA

## Owner approval 2026-11-12

Chris forwarded an agent report (2026-11-12 06:33 MST): merges were confirmed but `merge_commit` came back empty, forcing an extra branch lookup before checking CI on the merged commit. Chris's standing instruction is to fix tool shortcomings reported to him.

## Outcome and acceptance

Outcome: an empty or failed provider read is retried once and never judged; a confirmed merge returns the real merge commit SHA (writer answer, else the fresh PR read). Accepted by the new case in `tests/unit/workflows-pr-conveyor.test.js`.

## Drift check

Read-only change to the reply of `github_workflow_merge_when_green`; no write, permission or merge rule changes.
