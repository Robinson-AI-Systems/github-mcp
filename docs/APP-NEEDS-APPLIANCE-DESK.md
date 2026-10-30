# What Appliance Desk needs from GitHub, and which tool handles each

Re-audited 2026-10-15 against `christcr2012/appliance-desk` `main` at `20466bc50cead4d300523ee38382f34267a07f4d` (read only): `.github/workflows/ci.yml`,
`daily-live.yml`, `sandbox-publish.yml`, `perf.yml`, `git-housekeeping.yml`; `vercel.json` (`git.deploymentEnabled`); `AGENTS.md` "Verify, push,
review, merge"; `docs/PLAYBOOK.md` Steps 7 and 9; `docs/runbooks/SANDBOX-PUBLISH.md` (in the Appliance Desk repository, not this one); `docs/ARCHITECTURE.md` (CI section
and the owner-only GitHub settings line); `docs/OWNER-INPUTS.md` IN-67 and IN-68.

This is an **example project profile**, and the completeness check used to prove the GitHub MCP can do everything a real
project needs from GitHub. The server itself is a general development tool; profiles are optional and any project Chris
builds can have one (Batch P, `docs/designs/BATCH-P.md`; `github_profile_draft` drafts one from a codebase). This file is
also the template for future profiles.

**Rule for this file:** every row names the tool or workflow that covers it, or says plainly that GitHub has no API for it
and how the server guides Chris instead. Batch P turns this table into data (`known_projects`, seed `appliance-desk`)
and into one check, `github_workflow_app_readiness`. When the project's GitHub use changes, this file and the seed change in
the same PR (P-1 owns the seed). Row IDs G1–G20 are setup rows of this file; findings of the research audit are always
written "audit G<n>".

## What the project does on GitHub by itself (the MCP must not duplicate or fight it)

| The project… | Evidence | What the MCP does |
|---|---|---|
| Moves its production branch `live` up to a green `main`, fast-forward only, from `daily-live.yml` (daily 00:01 America/Denver schedule + manual run; checks `ci` = success from the `github-actions` app first) | `daily-live.yml` | `live` is a profile **production branch** and an **owned ref** (`managedBy: daily-live.yml`, no `agentMay`): every direct write to `live` is refused without `outsideProject`. To release, the server dispatches `daily-live.yml` on `main` (`github_actions_dispatch`, production, confirm) — it never pushes `live` itself |
| Rebuilds sandbox commits from `transfer/<id>` branches and pushes them to `ai/*` targets, then deletes the transfer branch (`sandbox-publish.yml`, on push to `transfer/**`) | `sandbox-publish.yml`, `docs/runbooks/SANDBOX-PUBLISH.md` (in the Appliance Desk repository, not this one) | `transfer/**` is an owned ref (`managedBy: sandbox-publish.yml`) with `agentMay: ['create-from-default', 'commit-files']`, so an agent can follow the runbook (create the branch from `main`, upload parts, `manifest.json` last) through `github_branch_create` and `github_content_push_files`; moving, force-updating or deleting a transfer branch needs `outsideProject` (BATCH-P amendment 2026-10-10) |
| Runs CI (`ci.yml`) on every PR, on pushes to `main`, nightly, and by hand with a `base` input; one final job named `ci` is the merge gate | `ci.yml` | Reads it (`github_check_get_ci_state`, `github_workflow_pr_status`); dispatches it on non-production refs without confirm (`github_actions_dispatch`); never edits the workflow file |
| Expects Codex's automated review on PR open, and resolves threads only after verifying the fix at the exact head | `AGENTS.md`, PLAYBOOK Step 7 | `github_workflow_review_threads` lists and resolves threads (Codex's comments are bot text: marked `untrusted`, treated as data) |
| Merges with merge commits at the expected head through `merge-async` | PLAYBOOK Step 9 | `github_pr_merge_async` / `github_workflow_merge_when_green` (exact head, `ci` green, merge commits, `bypass_rules` never sent) |

**Branch patterns:** `main` (default; production for code), `live` (production; Vercel tracks it once IN-68 there is
done), `ai/<tool>/<topic>` (work branches), `transfer/<id>` (sandbox publishing), `recovery/**` (named in `vercel.json`;
no previews). **Production environments:** none on GitHub today (deployments are Vercel's). **Required check:** `ci`.
**Workflows with write access:** `daily-live.yml` (promotion job `contents: write`, `checks: read`), `git-housekeeping.yml` (owner-gated job `contents: write`), and `sandbox-publish.yml`
(`contents: write`, `actions: write`); every other workflow `contents: read`. **Repository secrets:** none.

## Everything to set up on GitHub for the project, and who does it

| # | Need (source) | Today | Covered by | API or guided? |
|---|---|---|---|---|
| G1 | Repository `christcr2012/appliance-desk` is **public** (free Actions minutes and secret scanning) | Public since 2026-10-03 | `github_repo_get`; any visibility change is production + access-widening (`github_repo_set_visibility`) | API |
| G2 | `main` ruleset requires the `ci` check — and nothing else: no "Preview" deployment requirement, no Copilot review (Appliance Desk IN-67) | Done 2026-10-09 (Chris) | `github_ruleset_list`, `github_ruleset_get`; readiness fixes a missing `ci` (`github_ruleset_save`, confirm) and flags a deployment or Copilot requirement if one comes back | API |
| G3 | `main` blocks force pushes and deletion | Not verified | Readiness reads the ruleset (`github_branch_get` rules); fix with `github_ruleset_save` (production, confirm) | API |
| G4 | Merge commits allowed (merge method `merge`) | Allowed (merges use it) | `github_repo_get`; fix with `github_repo_update_settings` (merge options are production) | API |
| G5 | Merge only at the exact head with `ci` green (PLAYBOOK Step 9) | Process rule | `github_workflow_merge_when_green`, `github_pr_merge_async` | API |
| G6 | Stacks merge bottom-up, each PR retargeted to `main` first with fresh `ci` | Process rule | `github_workflow_merge_stack` (`github_pr_update` retarget) | API |
| G7 | Review threads (Codex) answered and resolved only after the fix is verified at the head | Process rule | `github_workflow_review_threads`, `github_review_list_threads`, `github_review_resolve_thread` | API |
| G8 | Production branch `live`, moved only by `daily-live.yml`; Vercel tracks `live` (Appliance Desk IN-68 — a Vercel setting, the Vercel MCP's job) | `live` exists, advanced only by checked daily promotion | Profile `productionBranches: ['live']`, owned ref; release by `github_actions_dispatch` of `daily-live.yml` on `main`; `github_branch_get` shows where `live` points | API (+ one Vercel setting) |
| G9 | `transfer/**` branches created and filled by agents, consumed by `sandbox-publish.yml` | Fallback route (a sandbox push key is the first choice) | Owned ref with `agentMay`; `github_branch_create`, `github_content_push_files`; `github_actions_get_run` shows the publish result | API |
| G10 | Work branches `ai/<tool>/<topic>`; merged branches cleaned up | Process rule | `github_branch_create`; `github_workflow_cleanup_branches` (by PR state; never `main`, `live`, or a `transfer/**` branch still in use) | API |
| G11 | `ci.yml`, `perf.yml`: `permissions: contents: read`, no repository secrets, never `pull_request_target` | Matches | Profile `workflows[]` with `maxPermissions` and `forbiddenTriggers`; readiness reads each file (`github_content_get`) and **reports** any drift — never edits workflow files | API (read) |
| G12 | `daily-live.yml` limited to `contents: write`, `checks: read`; triggers schedule, manual owner recovery, PR/push policy only | Matches | Same as G11 | API (read) |
| G13 | `sandbox-publish.yml` limited to `contents: write`, `actions: write`; trigger push to `transfer/**` only | Matches | Same as G11 | API (read) |
| G14 | No Actions, Dependabot or environment secrets (CI uses throwaway test values only) | None | `github_secret_list` (names only); readiness flags any secret that appears | API |
| G15 | Secret scanning and push protection on (the app's ARCHITECTURE lists them as an owner-only step) | Not verified | `github_security_get_settings`; `github_security_set_feature` (production, confirm; free on a public repo). GitHub does have an API for these on repositories the App administers, so the owner step is no longer needed once the App is installed | API |
| G16 | Fork pull request workflows need approval for **all** outside contributors | Not verified | `github_actions_get_settings`; `github_actions_set_settings` (production, confirm) | API |
| G17 | Default `GITHUB_TOKEN` permission read-only; workflows that need write declare it (G12, G13) | Not verified | `github_actions_get_settings`; `github_actions_set_settings` | API |
| G18 | The Vercel GitHub App is installed with access to this repository (preview and production builds; `git.deploymentEnabled` turns off `ai/**`, `transfer/**`, `recovery/**`) | Installed | `github_app_list_installations` (user token: installations on the personal account) reports it; Vercel's own settings are the Vercel MCP's job | API (read) |
| G19 | Access: owner only (Chris); a deploy key with write exists only if Chris keeps the sandbox push key | Not verified | `github_collab_list`, `github_deploykey_list`; readiness reports any write key and asks; adding access is access-widening (`github_collab_add`, `github_deploykey_add`) | API |
| G20 | Nightly CI on `main` and the daily checked release run are watched; failures explained | Process rule | `github_actions_list_runs`, `github_workflow_ci_failure_summary`, `github_workflow_weekly_digest` | API |

**Drift noticed in the project's own docs (not changed here; for Appliance Desk's agents):** `docs/ARCHITECTURE.md` line 9
still calls the repository "private" and says "`main` is production" (it is public since 2026-10-03, and production moves
to `live` with IN-68 there); its "owner-only settings GitHub requires a person to set" line (secret scanning, push
protection, fork-PR approval) can be done through this server's tools once its App is installed (G15, G16).

## The one-sentence checks Chris will use

- *"Is GitHub set up right for Appliance Desk?"* → `github_workflow_app_readiness(project: "appliance-desk")`: every row
  above as done / fixed with your OK / needs you (link and steps) / needs a decision.
- *"Release Appliance Desk."* → dispatches `daily-live.yml` on `main` after you confirm, then reports the run
  (`github_actions_get_run`).
- *"Merge PR 412 when it's green."* → `github_workflow_merge_when_green`.
