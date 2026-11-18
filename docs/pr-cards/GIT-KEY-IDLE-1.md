# GIT-KEY-IDLE-1: git session keys survive the idle time they were asked for; a lapsed key names its renewal

## Owner request 2026-11-17

From another agent, via Chris: "the sign-in expires after a few idle hours and I have to renew it by hand each time.
It would be smoother if it renewed itself, or if the failed pull pointed straight at the renewal step."

## Outcome and acceptance

- A key renewed itself on each use, but only for 8 hours, whatever lifetime it was asked for. A session paused
  overnight came back to a lapsed key. Now the idle window is the key's requested lifetime (`hours` accepts 1–24; the idle window is never
  less than 8, so a shorter request still idles for 8; corrected 2026-11-18 after the Second Shift review), and it is stored on the key (`idle_hours`). The 7-day cap from creation is unchanged.
- An expired key's `remote:` line names the exact renewal call, built only from the key's own row
  (`github_git_remote_setup {"owner":…,"repo":…,"access":…,"hours":24}`), and says the clone and remote stay as
  they are.
- The tool's guidance and `hours` description say to ask for 24 when work may pause for hours.

Accepted by `tests/unit/git-remote.test.js` (a 24-hour key used at hour 20 still works at hour 43 and lapses after a
full idle day with the renewal call; fails on the old code), `tests/unit/git-remote-edge.test.js` (window bounds,
exact call), and the store contract (idle window kept; out-of-range refused).

## Drift check

Changes: `src/db.js` (column + create/get), `src/git-remote/keys.js`, `src/git-remote/authorize.js`,
`src/tools/git-remote.js` (guidance), fake DB, store contract, tests, this card, status note, TOOL-CATALOG note.
