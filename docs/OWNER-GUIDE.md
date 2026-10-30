# Owner guide: what you can ask for

Plain things to say to Claude. Your own full connection does what you ask in one call: it tells you the effect and any known or unknown cost, does it, logs it, and reads the result back. GitHub's own permissions and repository rules still apply, and Claude passes along any refusal honestly. Rules: [OWNER-DECISION-2026-10-27](OWNER-DECISION-2026-10-27.md). What is live vs. waiting for the next daily release: [STATUS](STATUS.md). Tool names below are in the code today (498 tools: `src/tools/index.js`).

## Safety rules that stay

- Secrets, keys and tokens are typed only on the setup page. They never pass through chat or a tool.
- Read-only connections stay read-only. Passes you give other agents keep the limits you chose.
- Every change is logged; "Undo that" reverses it when a clean opposite exists.
- Stored GitHub keys are encrypted; one person's data is never visible to another.
- A setting can never lock you out of changing it.

## Connect and check

- Add the connector (phone steps too): [START-HERE](START-HERE.md).
- "Which GitHub accounts am I connected to?" (`github_list_accounts`, `github_whoami`): accounts, mode, profile, rate budget.
- Profiles on the sign-in page: **Read only** (208 tools, never changes GitHub), **Everyday** (295, routine changes, the default), **Full** (all 498, everything your real GitHub grant allows). Full needs no extra token.
- Mode is Preview or Production. Unverified: the sign-in page still refuses Production until it is switched on per account (`src/oauth/policy.js:71-75`); this conflicts with the 2026-10-27 decision and is being fixed.
- "Can this connection do X?" (`github_check_permissions`): says exactly which permission or extra token is missing, and may give a private setup link.

## Pull requests and CI

- "What's the state of PR 42?" CI at the latest commit, mergeable or not, reviews, open threads, next step.
- "Merge it when it's green." (`github_workflow_merge_when_green`): waits for your requested conditions. A direct merge (`github_pr_merge`) relays GitHub's rules; it can pass `overrideRules` with a reason only if you turned that on at My connection.
- "Merge the stack." Bottom up, fresh CI on each.
- "Why did CI fail?" The failing step and error lines, no giant log.
- "Rerun the failed jobs once." Refuses a second automatic retry.
- "Answer and resolve the review comments."
- "Approve the fork run for PR N." (`github_actions_approve_fork_run`): after you reviewed the contributor's PR.
- Branch, commit and PR in one request: `github_write_batch` (steps in order; use `dryRun:true` to preview). Bring `main` into a branch: `github_branch_merge`. Commit files incl. small binaries: `github_content_commit_git_data`.
- Read the full text of a file: `github_content_get` with `fullText`. If a file shows masked, `github_content_protection_check` explains why: [CONTENT-PROTECTION](CONTENT-PROTECTION.md).

## Repos, releases, security, org

- "Set up a standard repo": private, `main` protected by a rule requiring `ci`, merge commits, secret scanning, labels.
- "Prepare a release" / "Clean up old branches": draft first; cleanup only touches closed same-repo PR branches and never protected ones.
- "Review this repo's health, security and access."; "Who has access to my repos?"; "Review my GitHub organization."
- "Add Sam to the organization": shows the access first.
- "How much am I spending on GitHub this month?": dollars by product; unknown costs are never shown as zero.
- Two-factor and plan changes have no GitHub API, so you get exact numbered steps (`github_where_is_setting`).
- Paid features (private-repo code scanning, Copilot seats, etc.): the agent states the cost, may be unknown, then acts. GitHub bills; nothing is bought by builders or tests.
- Secret scanner settings per repo: `github_secret_scanner` ([SECRET-SCANNER](SECRET-SCANNER.md)). Guidance: `github_security_scan_guidance`.
- "Set the STRIPE_KEY secret": you get a link to type it on your setup page.

## Git workspaces and Playground

- Real Git in an isolated worker: clone, edit, commit, fetch, push, history, stash, worktrees. Start with `github_git_workspace_read` (operation `capabilities`). Details: [NATIVE-GIT-OPERATIONS](NATIVE-GIT-OPERATIONS.md).
- Robinson's Playground is the fuller coding workspace (install, build, test, preview): `github_playground_workspace`, `github_playground_read`. Goal sizes (8 CPU, 8 GiB, up to 150 GB) are requested ceilings, not guarantees. If resources run out, safe Git work continues and the rest waits or shrinks. See [CODING-WORKSPACES](CODING-WORKSPACES.md), [PLAYGROUND-OPERATIONS](PLAYGROUND-OPERATIONS.md).
- A workspace closes after 4 idle hours; activity renews it. No daily job limit and no fixed workspace count; only real server load limits work.
- Backups are not active and are not claimed.

## Test and developer tools

- "Give me a throwaway repo to test this workflow" / "Clean up that test run" (`github_dev_*`, `github_dev_cleanup`): work on the scratch organization only, with exact-run ownership.
- "Send my app a test webhook": a correctly signed replay.
- "What changed in GitHub through Claude this week?" (`github_recent_changes`).
- "Make a 24-hour read-only pass for Codex": shown once on your setup page. Pass limits are binding.

## My connection (public sign-in only)

At `/connection` you can see which accounts your agent uses, add accounts, make apps read-only, disconnect, set your time zone, add an optional master token (notifications, packages, gists, org settings; "Act as me" and "Allow overriding branch rules" switches), and delete your data. It works on a phone. Source: `src/tenancy/public-http.js`. If public sign-in is off, this page is not available (unverified which applies).

## Anything else on GitHub

`github_api_search`, `github_api_describe`, `github_api_read`, `github_api_write` reach the pinned GitHub REST surface. The same safety checks apply. Only 54 reviewed routes are treated as free; every other write is "unknown cost" and is disclosed. If GitHub or the credential cannot do it, you get a named gap and an alternative, never a fake success.

## Other clients

ChatGPT and Meta Muse steps are on the live home page (`src/brand/home-page.js`). Android ChatGPT custom-connector support: unverified.
