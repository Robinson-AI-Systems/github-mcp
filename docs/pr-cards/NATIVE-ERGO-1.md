# NATIVE-ERGO-1 — One-call change, native Git ergonomics and definite outcomes

## Owner request 2026-11-02

Feedback from Chris's coding agent after about twenty PRs on a collaborator's private repository (relayed by the
coordinator with the owner's fix list): "Too many steps for simple jobs. One file change took seven calls … It needs a
'commit and push this change' helper", "you can't add everything with `.`, remove several files at once", plus live
change-log evidence of refusals (`Option is not supported for fetch/merge/remove_file`, `expectedGeneration is not used by
operation begin`) and definite results logged as UNCONFIRMED (a merge with conflicts, a switch to a missing branch). This
card covers the native-workspace items 1, 2, 4, 5, 6, 10, 13, 14 (workspace tools), 16 and 21 of that list.

## Outcome and acceptance

Outcome: `github_repo_change` puts files and deletions (or an applied upload) on a new or existing branch, commits once,
pushes with a lease and readback, and optionally opens the PR, in one call from the default tool list; native Git accepts
the options agents naturally pass and reports conflicts and Git refusals as definite results with a plain next step.
Accepted when the tests below pass with real commits and pushes from a real local worker into a real local bare remote,
the nine write-contract checks pass through every door, and `ci` + `release-policy` are green at the exact head.

## Design

- **`github_repo_change`** (`src/tools/repo-change.js`, `defineGithubWrite`, Full profile, production-classified push):
  owner, repo, branch, base (default branch), files `[{path, content | base64}]` (≤ 100, ≤ about 1 MB each), deletePaths
  (≤ 100), message, pr `{title, body, draft}`, expectedHead, allowMoved, fresh, upload (`archive` | `git`), upload_id,
  workspace_id. Preflight (before anything is sent): argument checks with plain messages, credential-shaped content,
  repository authorization, GitHub's branch/base heads (`GET /repos/{owner}/{repo}/git/ref/{ref}`) and the expectedHead
  check. The step machine reuses this intent's workspace, a given one, a clean open one whose copy of the branch is absent
  or equal to GitHub's, or clones a Git-only one; positions the branch (fetch, switch, ff pull, or branch_create from
  `origin/<base>`); writes, deletes, stages every changed path, commits, pushes with `expectedHead` = the head it read;
  reads GitHub's ref back through the worker. Each native step has a key derived from the intent key (and workspace), and
  the intent's workspace/lease is recorded in a setting, so `resumeReplay` continues an interrupted change from the
  worker's receipts and never commits or pushes twice. The PR goes through `github_workflow_open_pr` via the dispatcher
  (its own journal, guards and readback; existing PR reused). Uses only operations every deployed worker runs.
- **Run ergonomics** (`src/native-git/commands.js`, shared with the worker): one normalization (`normalizeNativeOptions`)
  for add `.`/all, remove_file paths, fetch branch/branches/ref/remote/prune/tags, merge branch/message/noFastForward/
  fastForwardOnly, pull ref, switch create/from (and remote-tracking switch without `--no-guess`); top-level shortcuts and
  checked owner/repo; wrong options list the valid ones; new read `changed_files`.
- **Definite outcomes** (`src/native-git/outcomes.js`): conflict → applied with `outcome: "conflict"`, files and next
  step; worker `rejected`/`refused` and worker HTTP 400/404/422 → `rejected` with a next step and `details`
  (`next_generation`) via a small generic addition to `src/core/write.js` (`outcomeDetails` on a definite refusal). Stale
  generations say nothing changed and give the value to send. `next_generation` in every run result; `quiet`.
- **Upload**: begin ignores `expectedGeneration`; apply ignores mode/maxMegabytes, accepts `deletePaths` and `mirror`.
- **Older workers**: capabilities `native_options: "ergonomic-v1"` and `upload_apply: "delete-v1"` mark the new worker.
  Before it is redeployed the MCP sends add-all as explicit status paths and fetch-by-name as a full fetch; the other new
  options are refused plainly with a fallback before anything is sent.
- **Listing**: `github_repo_change` is in `COMPACT_DEVELOPER_TOOLS` with a names-and-types listing schema (limits and
  descriptions stay in the full schema and guidance); compact listing 5,994 / 6,000 tokens, no budget change.

## Items not done here

- #21 "run this for me" in the sandbox: the service cannot execute in the agent's sandbox; a short alias would need a new
  stored one-time mapping. Recorded in `docs/ROADMAP.md`.
- #14 for non-workspace tools and the generic validator text (`Unknown argument`, `operation is required`) belong to the
  parallel builder's scope.
- Protected `pr-only` repositories still refuse `github_repo_change` (as they refuse native run); widening the PR-only
  list is a safety-boundary change left to the owner.

## Tests

`tests/unit/repo-change.test.js` (write contract ×3 doors; new branch with written/binary/deleted files; replay; existing
branch reuse with expectedHead; moved branch refused; allowMoved; no_changes; interrupted push resumed with one commit;
PR through the guarded workflow; upload two-call path with deletions; plain refusals; compact listing) and
`tests/unit/native-git-ergonomics.test.js` (normalization; add `.`, several-path remove, shortcuts, quiet,
next_generation; fetch-by-name then switch; definite missing-branch refusal; real merge conflict; stale generation;
older-worker fallbacks; changed_files; upload deletePaths/mirror; a 30 MB archive through the relay and worker).

## Release

Source only until the daily release. The MCP side (compound tool, outcomes, shortcuts, add-all/fetch fallbacks) works
with the deployed worker. The worker-side options need the native Git worker image redeployed on Dokploy (and the
Playground runtime image for attached workspaces); see the status note.

## Drift check

Builds on PAR-2 native Git, GIT-UPLOAD-1 and SINGLE-DOMAIN-1 unchanged in their claims, signatures, leases and receipts;
no new credential, permission, database table or GitHub write route (the PR goes through the existing guarded workflow;
the one new GitHub read is `GET /repos/{owner}/{repo}/git/ref/{ref}`). Worker protocol stays 3; new capability flags only.
The compact listing budget stays 6,000 tokens. Generic core change: `outcomeDetails` on a definite refusal.
