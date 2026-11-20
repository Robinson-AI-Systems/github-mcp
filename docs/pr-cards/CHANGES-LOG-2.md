# CHANGES-LOG-2: github_recent_changes shows real times and labels interrupted changes

## Owner report 2026-11-20

"GitHub Unleashed confirmed a branch deletion only partly at the start of the brief outage." The outage was Windows
Update restarting the PC (10:29 and 10:31 PM MST, 2026-11-19). The server stopped after sending a branch deletion
(cleaning-desk `route-refusal-figures`) and before recording its result; the branch is in fact gone. Reading the log
also showed every entry's time as `{}`.

## Outcome and acceptance

- Each entry carries `at` (ISO UTC) and `at_local` (Denver), instead of `{}`.
- An entry still `PENDING` (no recorded result) more than 10 minutes after it was sent reads `INTERRUPTED:` with
  `interrupted: true` and a note: it may or may not have happened; read the target; repeating the call with the same
  requestKey is safe.
- Test in `tests/unit/connection-tools.test.js`.

## Drift check

No tool added or removed; `github_recent_changes` reply adds `at_local`, `interrupted`, `note`.
