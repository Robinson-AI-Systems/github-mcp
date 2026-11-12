# OTHER-BASE-PUSH-1 — Merge into any base branch; silence the push-negotiation warning

## Owner approval 2026-11-12

Chris forwarded an agent report (2026-11-12 04:02 MST): merge-when-green will not merge a PR into a branch other than main, and pushes print "push negotiation failed". He added (04:04): there should be nothing GitHub Unleashed cannot do that can be done through another route (penpal PR #63 targets a working branch and the repo has no checks).

## Outcome and acceptance

Outcome: `github_workflow_merge_when_green` no longer refuses a PR whose base is not the default branch (GitHub's rules for that base and the guarded merge writer still apply); the git setup command turns `push.negotiate` off. Accepted by `tests/unit/merge-anyway-1.test.js`.

## Drift check

Only the default-branch-only blocker is removed. Closed, draft, wrong head and not-mergeable still stop the merge; CI, review and threads are unchanged; no credential or permission rule changes. Stack merging keeps its own retarget logic.
