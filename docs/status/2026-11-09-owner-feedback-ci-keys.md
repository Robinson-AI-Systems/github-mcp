# 2026-11-09 — owner feedback: merge with no checks, CI step detail, git key renewal, push warning

What changed (plain English):

- **Repos with no checks can now be merged with "merge when green".** If a repository has no required checks, no commit statuses and no GitHub Actions workflow at all, CI is reported green with basis `no-checks-configured` and a plain note, instead of waiting forever. A failed read, any existing workflow, status or check run keeps the old careful answer. Reviews, conflicts and threads are still enforced. No `overrideRules` needed.
- **`github_workflow_pr_status` takes `steps: true`.** It then adds `ci_steps`: every CI job and step at the exact head with its result and seconds (read through `github_actions_list_runs` + `github_actions_get_run` with the new `includeSteps`), so a surprisingly fast pass can be checked from the same tool.
- **Git session keys renew themselves quietly.** A key that is really being used moves its expiry out to 8 hours from now (at most one write per 30 minutes), never earlier than before and never beyond 7 days after it was created. Revoked or already-expired keys are never renewed. The expired message now says so.
- **"push negotiation failed; proceeding anyway"** comes from the caller's own git (`push.negotiate` on), not from this service, and the push still lands. The setup result's `push_note` now says so and gives the one-line silencer (`git config push.negotiate false` inside the clone). Not changed in the user's global git config.

Verified: new unit tests (`ci-state-no-checks-configured`, PR status steps, key renewal in the store contract on the fake and on throwaway PostgreSQL) plus the existing git-remote and CI-state suites.

Not done / decide later: nothing blocked. Release is the daily job.
