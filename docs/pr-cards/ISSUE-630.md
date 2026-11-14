# ISSUE-630: push refusals for values already on GitHub

## Owner request 2026-11-14

Chris asked for the open actions and to-dos across the rack, Rack Control and GitHub Unleashed to be worked through. Issue #630 (filed 2026-11-12 from the yardsync session) was the one open issue. The same thing happened again on 2026-11-14 in development-rack: changing `backups.py` re-flagged four lines that were already on main.

## Outcome and acceptance

- **Already on GitHub.** For each refused value, the hook looks at the same path at each pushed ref's old tip (or the default branch for a new ref) in the mirror, scans it the same way, and compares value fingerprints. Values that were already there are marked `(already on <branch> before this push)`. When all of them were, the refusal says the push did not add them and what to do (remove the value in this push, rotate it if it is real, or ask for an exception).
- **What clears it.** The refusal says plainly that a new commit removing the value does not help, because every pushed commit is checked. It gives the route that rewrites nothing on GitHub: `git fetch`, `git reset --soft origin/<branch>`, remove the value, commit, push. Amend and rebase are still listed.
- **The exact exception call.** For the first finding, it prints a complete `github_secret_scanner` configure call: the repository, the current settings revision, one push-door verification case and one push-exception suppression with that value fingerprint. Reasons are left as placeholders and must be written without anything credential-shaped (SCANNER-CFG-1114).
- Nothing is value-revealing: fingerprints only.

Accepted by `tests/unit/push-refusal-630.test.js`. It runs real git through the real worker hook against a fake GitHub: a value seeded on main is marked as pre-existing; a fixing commit on top is still refused; the printed rebuild route is then pushed successfully; a value the push itself adds is not marked.

Not done from the issue: suggestion 4 (a default-branch sweep on first connect; `github_secret_scanner scan` covers on-demand paths today) and suggestion 5 (how the yardsync value first reached GitHub, which is not reproducible from here).

## Drift check

Changes: `workers/native-git/remote-hook.mjs`, tests, docs.
