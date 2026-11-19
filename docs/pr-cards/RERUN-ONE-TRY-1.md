# RERUN-ONE-TRY-1: re-running failed CI takes one call and reports honestly

## Owner request 2026-11-19

Chris: "Fix these, and any other problems you find along the way: GitHub Unleashed's re-run tool: re-running the failed test took three tries. The tool only reports one missing setting at a time, so each try turned up the next one. It then said 'unconfirmed' even though GitHub had accepted the re-run."

## Outcome and acceptance

- **ALL-MISSING-1** (`src/core/validate.js`): every tool now names all missing required arguments at once ("runId and expectedHeadSha are required."), and an unknown argument beside them ("Not arguments of this tool: pr.") because that is usually the cause.
- **RERUN-PR-1** (`src/tools/workflows-ci.js`): `github_workflow_rerun_failed_ci` takes `pr` (the failed run at the PR's current head is found) or `runId`; `expectedHeadSha` is optional and defaults to that head, so the head guard still holds. Several failed workflows → `choose_run` with their ids; none → `nothing_to_rerun`.
- **SETTLE-1** (`src/core/write.js`, `github_actions_rerun`): a write can declare that its result shows up late. The read-back then repeats (5 tries, 1.5 s apart, about 6 s) instead of stopping at the first old-looking read; if the change still has not shown up, the answer is `accepted` with what to check later, not `unconfirmed`. The re-run workflow tool says "GitHub accepted the retry ... do not rerun again".
- **MERGE-CONFLICT-WORDS-1** (`src/tools/workflows-merge.js`, found while merging this PR): a PR with conflicts was refused by `github_workflow_merge_when_green` as "GitHub did not confirm mergeability", while `github_workflow_pr_status` said "Resolve merge conflicts". It now says the PR has merge conflicts with its base, that GitHub runs no pull-request checks until they are resolved, and the next step (rebase or merge the base, push, call again).
- Tests: validate-extra-map (+1), write-core (+1), workflow-ci (+2), workflows-pr-conveyor (+1); the 39 test files that check these messages: 1,752/1,752.

## Drift check

No tool added or removed. One argument added to `github_workflow_rerun_failed_ci` (pr; runId and expectedHeadSha no longer both required), wording of missing-argument refusals, and a new `accepted` write status.
