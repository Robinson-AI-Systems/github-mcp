# BUILD-FB-1114: fixes from a project build (scanner false alarms, one-call allow, repo search, merge-when-green)

## Owner request 2026-11-14

An agent building a new project (cleaning-desk) from the rack's starter reported: the scanner refused a sign-in
form's password box and the starter's "Reset your password" email line (every project from that starter is refused on
first push); adding the exceptions took four tries because each refusal named one more field and there was no
describe; repo search defaulted into a linked account it cannot read and refused; one search tool wants `text`, the
other `query`; and private repos on the free organization plan have no branch rules, so "merge only when green" is
enforced by nothing. Chris: fix these.

## Outcome and acceptance

- **No false alarms on ordinary app code.** Wording (a reset-password email line) and password-naming literals
  (the new-password and current-password autocomplete tokens) are not credentials; real connection strings and high-entropy assignments still
  are. Starter files from the rack's template library scan clean.
- **One call to allow a false positive.** `github_secret_scanner` action `allow` {repo, path, blobSha, reason} builds the
  exact push exceptions (path + blob + value fingerprint) and their verification from the guard's own findings at the
  current revision; owner only. Action `describe` lists every action's arguments with an example. Missing arguments are
  named all at once.
- **Repo search keeps going.** Default account first; an account that cannot be searched is skipped and named.
- **Either argument name.** `github_repo_find` and `github_search_github` take `text` or `query`; repository summaries
  carry `name`.
- **Merge only when green, even with no branch rules.** Where GitHub reports rules unavailable on the repository's plan,
  `github_pr_merge` enforces green for the owner too; `github_workflow_merge_anyway` stays the deliberate exception.

Accepted by `tests/unit/fixes-2026-11-14.test.js`.

## Drift check

Changes: `src/github/content-protection.js`, `src/github/ci-state.js`, `src/tools/security-scanner-settings.js`,
`src/tools/repos.js`, `src/tools/argument-aliases.js`, `src/tools/summaries.js`, `src/tools/pulls-merge.js`; docs.

## Follow-up

`describe` was compact-by-default after a live check showed ~20 KB; `args.action` returns one action's full
arguments (accepted by the same test file).
