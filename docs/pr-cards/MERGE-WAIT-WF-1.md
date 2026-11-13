# MERGE-WAIT-WF-1: merge_when_green waits for workflows that have not reported yet

## Owner approval 2026-11-12

Chris asked for GitHub Unleashed to be fixed after `github_workflow_merge_when_green` merged PenPal #68 and #69 before their tests had started. His standing instruction is that every shortfall of this tool is reported and corrected.

## Outcome and acceptance

Outcome: when nothing is marked required (a plan that can't hold rulesets or branch protection), `ciState` judges every check that exists **and** every workflow run at the exact head commit. A queued or in-progress run keeps the commit not green, and so does a run that ended badly. A 404 (Actions off) counts as no runs. Any other unreadable answer is unknown, never green. Accepted by `tests/unit/ci-state-no-checks-configured.test.js` (the three "workflow runs" cases) and the existing merge suites.

## Drift check

This is a read-only addition to `src/github/ci-state.js`, and only in the all-checks basis. The required-checks basis, the merge writer, the guards, and every other tool are unchanged, so it can only make a merge wait longer, never sooner. Status note: `docs/status/2026-11-12-merge-waits-for-starting-workflows.md`. See the drift protocol (DRIFT-PROTOCOL checklist B).
