# merge_when_green waits for workflows that have not reported yet (2026-11-12)

- **Owner report:** on PenPal, whose plan can't hold rulesets or branch protection so nothing is required, `merge_when_green` merged #68 and #69 before their tests had started. A fast check had already passed, and the new `tests` workflow hadn't created its check runs yet.
- **Change:** in the all-checks basis, `ciState` now also reads the workflow runs at the exact head commit (`GET /actions/runs?head_sha=`).
  - A queued or in-progress run keeps the commit not green, and so does one that ended badly.
  - A 404 (Actions off) counts as no runs. Any other unreadable answer is unknown, never green.
- **Unchanged:** the required-checks basis.
- **Next:** none. It goes live with the next production release of github-mcp.
