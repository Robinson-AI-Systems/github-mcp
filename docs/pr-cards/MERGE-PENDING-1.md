# MERGE-PENDING-1: a clean, green PR refused while GitHub was still computing mergeability

## Owner report 2026-11-14

`github_workflow_merge_when_green` with `waitForChecks: true` refused github-mcp #584 (clean, every check green)
with "GitHub did not confirm mergeability". The same call without `waitForChecks` merged a moment later.

## Cause

The PR's branch had just been updated. GitHub answers `mergeable: null` for a few seconds after that while it works
the answer out. The tool treated null like "no", and because it was a second blocker beside "checks not finished",
`waitForChecks` did not wait either.

## Outcome

Null is read as "not computed yet": the tool reads the PR again up to four times, two seconds apart, before judging,
and again after a check wait. Mergeability that is still pending does not stop `waitForChecks` from waiting on running
checks. If GitHub still has no answer after that, the reply is `mergeability_pending` ("nothing needs repairing, call
again"), not `not_ready`. A real `false` (conflicts) is never waited on and is refused as before. Accepted by
`tests/unit/conn-fb-1.test.js` (MERGE-PENDING-1 block).
