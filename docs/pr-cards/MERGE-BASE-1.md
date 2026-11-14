# MERGE-BASE-1: merging into another branch in one call

## Owner report 2026-11-14

"Merging a pull request that targets a branch other than main takes two calls. The safety check is sensible, but the
first call could accept the branch name up front."

## Outcome

It already could (`mergeIntoBranch`), but nothing on the tool said so: agents learned it from the first refusal. The
argument is now described on both merge tools (and in the tool description), and `base` is accepted as an alias, so an
agent merging into a release or parent branch does it in one call. The check itself is unchanged: a missing or wrong
branch name still stops before any wait or write. Accepted by `tests/unit/workflows-pr-conveyor.test.js`.
