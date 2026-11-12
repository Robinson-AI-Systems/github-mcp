# MERGE-ANYWAY-1 — Merge when green never waits forever, and can always be merged past on purpose

## Owner approval 2026-11-11

Chris reported in chat on 2026-11-11 20:43 MST: merge-when-green waits forever on a repository with no checks set up. He then said (20:46, 20:47): merge-when-green should only merge when green and stay the default, recommended tool, with a separate fallback that adds a little bump so merging without green is intentional.

## Outcome and acceptance

Outcome: merge-when-green stays green-only and recommended; a repository where no check will ever run for the commit (no workflows, or workflows that did not run in ten minutes) counts as having nothing to wait for, including inside `waitForChecks`. When only CI or review is missing, the answer lists warnings and names the fallback tool `github_workflow_merge_anyway`, which merges only with its acknowledge code and a specific written reason (20+ characters). Accepted when `tests/unit/ci-state-no-checks-configured.test.js` and `tests/unit/merge-anyway-1.test.js` cover each.

## Drift check

Hard facts (closed, draft, wrong head, not mergeable, wrong base) never get the merge-anyway offer. The existing guarded merge still checks the person, confirmation and GitHub's own decision. No credential or permission rule changes.
