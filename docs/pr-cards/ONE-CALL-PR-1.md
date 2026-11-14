# ONE-CALL-PR-1: opening a PR takes one call

## Owner report 2026-11-14

"Opening a pull request: the first call says no confirmation is needed, then does nothing until the whole request is
sent again with a confirm flag. That is a wasted round trip every time."

## Cause and outcome

`github_workflow_open_pr` sent `confirm: args.confirm === true` to `github_pr_create`, i.e. `confirm: false` when the
caller left it out; for the owner the write core treats an explicit `confirm: false` as preview-only (and reports
`needsConfirmation: false`). The wrapper now passes `confirm`/`dryRun` only when given, so the writer's own policy decides:
one call for the owner, a preview only where confirmation is genuinely required. Same for the label follow-up and
`github_workflow_rerun_failed_ci`. Deliberate two-stage tools (merges, releases, find-and-act) are unchanged.

Accepted by `tests/unit/conn-fb-1.test.js` (one call opens; explicit `confirm: false` previews and sends nothing) and
`tests/unit/workflow-ci.test.js`.

## Also in this PR (found shipping it)

- FIXTURE-DB-1: a package-lock entry for the `pgpass` npm package written as source (its package path key followed by a version object) is a
  dependency, not a password; and under the push/write fixture opt-in a documented fake (`FAKE…` or an evident placeholder)
  assigned to a database password variable or connection field passes, exactly as for connection-string URIs. Reads still
  hide them. Accepted by `tests/unit/fixes-2026-11-14.test.js`.
