<!-- Native MCP tools/list catalog is complete across standard nextCursor pages (40 tools/page). Its original 22,000-token ceiling applies to each complete response; meta search/describe/call remain available independently. Implemented in F-1 PR #167 with real issue capabilities. -->

> **Current authority and parity remediation (2026-10-28):** [requirements](OWNER-DECISION-2026-10-27.md), [delivery plan](designs/AUTHORITY-PARITY-2026-10-28.md). Full owner writes disclose/execute/journal/verify in one call; explicit delegated restrictions remain. Older dated statements about owner caps, production ceremony and mandatory merge gates are superseded. Source delivery and live acceptance remain separate.
# Tool catalog

**C-13 pinned ZIP and universal read selectors (2026-10-27, PR #440):** `github_content_snapshot` fetches a repository ZIP at an exact commit SHA into the existing 24-hour tenant-scoped result store. `github_get_result({handle,byteOffset,byteLength})` returns ≤32768 original bytes in base64 with total length, next offset, SHA-256 and EOF; a metadata-only read never returns ZIP base64. ZIPs are checked against path, entry count, expansion, symlink and credential scanner limits before storage. Generic read tools gain dotted `fields` projection; server tools retain their existing handler-owned selectors. Rate metadata #435 is not implemented by this PR; no release or real-client acceptance is claimed.

**C-12 large-result efficiency (historical 2026-10-27 delivery):** Historical delivery: long prose/schema/file data is available once in the complete JSON text response; small scalar metadata and normal structured collections remain in `structuredContent`. When `full_payload_location` is `content[0].text`, parse that JSON to retrieve the omitted large text field without further calls. Small results, credential protection, authorization, RTC result handles and write responses are unchanged. No deployment is implied by the PR.

**C-7 owner override parity:** `github_pr_merge` and `github_pr_merge_async` now submit an explicitly requested bypass with the authenticated person's credential even when best-effort rule discovery reports none. The compact `github_workflow_merge_when_green` accepts `overrideRules` and `overrideReason` and uses the same guarded writer. Ordinary merges still enforce CI/reviews; a deliberate bypass may pass local preflight only so GitHub can decide. Confirmations, scoped credentials, explicit protected-resource policies, exact-head and once-only safeguards are unchanged. Provider rejection is not silently retried as the App.

**C-6 fastest safe PR conveyor (2026-10-26):** `github_workflow_open_pr` delegates a no-label request directly to the existing guarded `github_pr_create`, removing redundant workflow-level repository/default-base and open-PR inventory reads. The writer remains the sole authority for permissions, notifications, branch existence, duplicate/replay handling and independently confirmed readback. Label-bearing requests retain the staged guarded path. `github_workflow_merge_when_green` checks independent PR and repository metadata concurrently; `github_workflow_merge_stack` reads chain members in groups of at most 3, validates them in order before any write, and still merges at most one checked PR per call. Run `node scripts/benchmark-pr-conveyor.mjs` for *synthetic* scheduling evidence; no production speed outcome is implied.

**C-5 measured PR/CI critical-path optimization (2026-10-26):** `github_pr_get` now overlaps authorized review-thread reading with live, exact-head CI evidence; `ciState` overlaps independent GitHub rules/protection/check/status reads (up to four simultaneous provider reads; check-run pages still sequential when needed); `github_workflow_pr_status` reads stack membership alongside PR status. No checks, branch rules, profile gates, confirmation, request key or result-size constraints were removed. Run `node scripts/benchmark-pr-critical-path.mjs` for a *synthetic* reproducible serial/concurrent comparison, not a production speed claim.

**C-4 routine gateway efficiency (owner approved 2026-10-26):** `github_describe_tool` and `github_search_tools` clarify that `dryRun` is optional for ordinary, preauthorized writes; a first normal call is sufficient when the guarded writer decides no special confirmation is needed. Operations that return `needs_confirmation` still require a reviewed, authorized follow-up. `github_batch` runs only independent reads, at most 3 at a time (10 total), preserving authorization, rate limits, original order, individual results, and bounded output. This does not relax the existing write contract or change the lazy RTC Hub catalog.

**C-3 developer-first compact listing (owner request 2026-10-26):** the standalone MCP shows 13 common repository/code/PR/CI tools directly, alongside the original meta and workflow shortcuts, within the original one-page/5,000-token contract. The rest of this catalog is still reachable through search and direct calls. This is listing metadata only: no new permissions, tool implementations, write gates, context budget increase, or RTC Hub behavior change. Membership lives in `src/tools/index.js` and is covered by listing and endpoint tests.

OAuth credential maintenance (A-5/Y-9, PR #258): user authorization refresh is cross-instance claimed and bounded; the existing `github_sponsor_get` read verifies the payer once for its typed relationship and tier inventories. No tool, credential permission, safety category, catalog count or end-user capability changed.

Restricted preview RTC successful replies revalidate service pass and scratch ownership at send time (#150), without an extra rate unit. Restricted preview RTC search/describe tool metadata is size-bounded to 8192 UTF-8 bytes. Oversized catalog pages and schemas are retained whole under connection-owned 24-hour result handles (#149), without expanding independent MCP tool authority.

Every tool this server will have, by area — the product scope. The implementing model builds exactly these; anything
else goes in `docs/ROADMAP.md` and the PR report, and universal tools (last section) provide guarded access only where their actual credential, classification and request support permits. Endpoint-level completeness remains unproven; see [MAXIMUM-AUTHORITY](designs/MAXIMUM-AUTHORITY.md). Counts are checked by `python3 scripts/count-catalog.py` (run by `npm run check` and CI since A-1, #1). When a
tool merges, its Card cell gains `built #<PR>`. Built so far: **491 cataloged tools** (every row below is in the registry, `src/tools/index.js`; `scripts/count-catalog.py` and `scripts/check-writes.mjs` fail the build if a tool and its row disagree)
and holds the two A-5 tools, the B-3 protected-list reader the two B-2 production-switch tools and the B-4 spend-limit tool. Since B-5 every result of these tools is shaped (`src/tools/util.js`) and failures are explained by `src/tools/errors.js`. Since B-6 a connection sees only the tools its profile allows (`tools/list` and by-name calls). Every write tool below is built with `defineGithubWrite` (B-1, #16, `src/tools/define-github-write.js`) and pass the nine write-contract checks (`test/helpers/write-contract.js`); the two B-2 tools are the first (`src/tools/server.js`).

**Safety metadata and scoped behavior:** `—` reads only; `P` supports optional dryRun; `D` describes destructive effects; `Prod`/`Prod*` describe production scope; `A`/`A*` describe access changes; `M` describes notifications; `$`/`$*` describe billing. `C` retains the restricted-profile confirmation declaration checked against source. On a full ordinary owner connection these marks are disclosure, not automatic confirmation or refusal. Explicitly restricted profiles/passes retain their chosen mode, access and spend limits. GitHub applies provider rules; journal/replay/readback and credential isolation apply to everyone.

**Origin:** `C` the old toolkit had it (`robinsons-toolkit-mcp` namespace `github`; port to the new conventions, never
copy code) · `F` the old toolkit had it **with a bug or a missing guard**, fixed here (`docs/audits/2026-10-10-research.md`
§2) · `N` new.
**Cred** (which credential GitHub accepts for it, `docs/designs/BATCH-A.md` A5): `I` the GitHub App installation token
(default) · `U` Chris's user authorization of the App (personal settings and a few user-only operations) · `I,U` either ·
`P` the optional classic package token (package routes only) · `K` the optional classic token (notifications only) · `—` no GitHub call.
**Audience** (contract §3): `B` builder · `O` owner/administrator · `Op` day-to-day operator.
**Profile:** `R` read_only and up · `E` everyday and up · `F` full only.

**Names:** every tool starts with the service prefix `github_` (`github_<area>_<verb>`; DECISIONS 2026-10-10), so it
never collides with the Vercel or Neon server's tools in the same chat; `scripts/count-catalog.py` enforces it.


## Server about itself (`github_*`) — 25

Card(s): A-5, B-2, B-3, B-8, C-1, C-2, R-1, O-1, X-1. Meta-tools, connection and safety settings. Compact listing (`docs/designs/BATCH-C.md`) starts here.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `github_whoami` | Which GitHub accounts this connection can use, mode (PREVIEW/PRODUCTION), profile, credential types present, API version, rate budget left (read concurrently), who calls act as (`acting_as`: you or the app), spend limit; for public sign-ins also the My connection page link | — | N | I | B,O,Op | R | A-5 built #13 |
| `github_master_token_link` | Private one-use link (10 minutes) to add or remove your optional master token, with plain steps; no reconnecting | — | N | — | B,O,Op | R | PUB-6 built |
| `github_credential_revoke` | Private one-use link (10 minutes) to cancel leaked GitHub tokens on a protected page; takes no token and returns none | — | N | — | B,O,Op | R | GOD-4 |
| `github_list_accounts` | Accounts (orgs and users) connected to the server: app installation, repo selection, user authorization, optional classic token, production on/off | — | N | I | O | R | A-5 built #13 |
| `github_set_default_account` | Which account a tool uses when `owner` is omitted | P | N | — | O | F | B-8 built #23 |
| `github_check_permissions` | Inspect App grants, per-tool layers, pinned operation compatibility and private-user identity-read grant proof; actual operation execution remains unverified | — | N | — | O,B | R | B-8 built #24; CAP-3 binding draft #274 |
| `github_rate_status` | Primary and secondary rate-limit state per account (from `GET /rate_limit` `resources.*` and recent response headers) | — | F | I | Op,B | R | B-8 built #24 |
| `github_list_connections` | Connector logins and passes: account scope, mode, profile, expiry, last used | — | N | — | O | R | B-8 built #23 |
| `github_revoke_connection` | Switch a connection or pass off at once | C | N | — | O | F | B-8 built #23 |
| `github_enable_production` | Allow production-mode connections for one account (needs the passphrase on the setup page as a second step) | C·A | N | — | O | F | B-2 built #18 |
| `github_disable_production` | Stop production-mode connections for one account immediately | C | N | — | O | F | B-2 built #18 |
| `github_set_spend_limit` | Lower the monthly spend this server may add for an account (raising it is only possible on the setup page) | C | N | — | O | F | B-8 built #20 |
| `github_list_protected_resources` | The repositories and installations this server refuses to change (its own repo, other Robinson servers) and at what level | — | N | — | O,B | R | B-3 built #19 |
| `github_recent_changes` | What was changed through this server (filter by repo, tool, account, date; previews hidden unless asked) | — | N | — | O,Op | R | B-8 built #23 |
| `github_undo_change` | Undo one change-log entry when it has a clean opposite; says plainly when it does not | C | N | I | Op | E | X-1 built #224 |
| `github_search_tools` | Find tools by plain words (and audience); one line each with safety marks | — | N | — | B,O,Op | R | C-2 built #26 |
| `github_tool_manifest` | Stable profile-scoped direct-tool names, interface versions and change hashes | — | N | — | B,O,Op | R | C-11 #434 |
| `github_describe_tool` | Full instructions and arguments for one tool | — | N | — | B,O,Op | R | C-2 built #26 |
| `github_call` | Run any tool in the profile by name, through the same guards | as the tool | N | — | B,O,Op | R | C-2 built #26 |
| `github_batch` | Up to 10 read calls in one round trip | — | N | — | B,O,Op | R | C-2 built #26 |
| `github_write_batch` | 1–20 sequential owner-authorized guarded writes, confirmed scalar references, durable replay-safe and itemized stop-on-error outcomes | as the tool | N | I | B,Op | E | C-16 #431 |
| `github_get_result` | Page through kept results; explicit `byteOffset`/`byteLength` returns up to 32 KiB of original retained file bytes as base64 | — | N | — | B,O,Op | R | C-1 built #25; RTC scoped single read #148 |
| `github_create_pass` | Make a short-lived preview pass for the HTTPS API and Robinson's Toolkit (read-only unless changes are allowed; $0; no access changes; shown once on the setup page) | C | N | — | O | F | R-1 built #225 |
| `github_where_is_setting` | Structured steps (link, numbered actions, expected result, read-back check) for any GitHub setting with no API | — | N | — | O | R | B-8 built #24 |
| `github_admin_overview` | Bounded owner/org security review, true optional user-selected MCP spend cap (legacy default $0 is uncapped), actual verified monthly GitHub billed usage or unreadable, enrolled U personal identity, explicit plan/permission gaps | — | N | I,U | O | R | O-1 built #197/#224; current provider-read correction |

## Repositories (`github_repo_*`) — 22

Card(s): D-1.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `github_repo_list` | Repositories of an org or user (type, visibility, sort, archived filter) | — | C | I | B,Op | R | D-1 built #27 |
| `github_repo_get` | One repo: visibility, default branch, merge settings, protection summary, security features, custom properties | — | C | I | B,O,Op | R | D-1 built #27 |
| `github_repo_get_vulnerability_alerts` | Independently read Dependabot vulnerability-alert enabled state, not alert count | — | N | I | B,O | R | W-7 built #218 |
| `github_repo_set_vulnerability_alerts` | Enable or disable free Dependabot alerts with identity and independent readback | C·Prod | N | I | B,O | F | W-7 built #218 |
| `github_repo_find` | Plain-words search across Chris's accounts (name, topic, description) | — | N | I | Op | R | D-1 built #27 |
| `github_repo_create` | New repository in an org or user account (private by default; public is access-widening) | P·A* | F | I | B | E | D-1 built #29 |
| `github_repo_create_from_template` | New repository from a template repository | P·A* | C | I | B | E | D-1 built #29 |
| `github_repo_update_settings` | Description, homepage, topics, features (issues, wiki, projects), merge options, delete-branch-on-merge, auto-merge allowed | P·Prod* | F | I | B,O | F | D-1 built #29 |
| `github_repo_set_visibility` | Make a repository private or public (public = access-widening) | C·Prod·A* | F | I | O | F | D-1 built #29 |
| `github_repo_set_default_branch` | Change the default branch | C·Prod | F | I | O | F | D-1 built #29 |
| `github_repo_rename` | Rename a repository (GitHub keeps a redirect) | C·Prod | N | I | O | F | D-1 built #29 |
| `github_repo_set_archived` | Archive (read-only) or unarchive a repository | C·Prod | F | I | O | F | D-1 built #29 |
| `github_repo_transfer` | Transfer a repository to another owner | C·D·Prod·A | F | U | O | F | D-1 built #29 |
| `github_repo_delete` | Delete a repository (cannot be undone by this server) | C·D·Prod | F | I | O | F | D-1 built #29 |
| `github_repo_get_insights` | Languages, contributors, community profile and commit activity in one summary (retries GitHub's 202 'computing' answer) | — | C | I | Op | R | D-1 built #27 |
| `github_repo_get_traffic` | Views, clones, top referrers and paths for the last 14 days | — | C | I | Op,O | R | D-1 built #27 |
| `github_repo_list_activity` | Pushes, force pushes, branch creations and deletions, merges — who and when | — | C | I | Op,O | R | D-1 built #27 |
| `github_repo_fork` | Fork a repository into an account | P | C | U | B | E | D-1 built #29 |
| `github_repo_sync_fork` | Bring a fork's branch up to date with its upstream | P·Prod* | C | I | B | E | D-1 built #29 |
| `github_repo_get_custom_properties` | Custom property values on a repository | — | N | I | O | R | D-1 built #27 |
| `github_repo_set_custom_properties` | Set custom property values on a repository | P | N | I | O | F | D-1 built #29 |
| `github_repo_star` | Star or unstar a repository as Chris (uses your master token when added) | P | C | U | Op | E | D-1 built #29 |

## Files, commits and git data (`github_content_*, github_commit_*, github_git_*`) — 23

Card(s): D-2.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `github_git_workspace_open` | Clone a repository into a connection-bound native Git worker workspace; returns HEAD, generation and expiry | P | N | I | B,O,Op | F | PAR-2 |
| `github_git_workspace_read` | Inspect native Git capabilities, history, conflicts, refs, receipts and exact protected file windows | — | N | I | B,O,Op | R | PAR-2 |
| `github_git_workspace_run` | Execute typed native Git operations with generation/replay protection, conflict recovery and independently verified push | P·D·Prod* | N | I | B,O,Op | F | PAR-2 |
| `github_git_workspace_close` | Dispose only the owned local workspace, verify absence and retain immutable disposal replay | P·D·Prod* | N | I | B,O,Op | F | PAR-2 |
| `github_git_workspace_list` | Page current connection workspaces with fresh repository access checks and explicit omissions/cursor | — | N | I | B,O,Op | R | PAR-2 |
| `github_content_get` | A file or directory at any ref; compact text by default, byte-exact base64 via `byteOffset`/`byteLength` (up to 32 KiB per explicit call) and a retained handle for overflow | — | F | I | B,Op | R | D-2 built #30 |
| `github_content_protection_check` | Explain matching rules and locations without values; provide a safe false-positive report and exact local-Git retrieval guidance | — | N | I | B,O,Op | R | PAR-2 |
| `github_content_get_tree` | Whole-repo file list at a ref (recursive tree), filtered by a glob | — | C | I | B | R | D-2 built #30 |
| `github_content_put_file` | Create or update one file with a commit (checks the file's current version first) | P·Prod* | F | I | B | E | D-2 built #32 |
| `github_content_delete_file` | Delete one file with a commit | C·Prod* | C | I | B | E | D-2 built #32 |
| `github_content_commit_git_data` | Commit binary PDFs and text through Git blobs, base tree, exact-parent commit and non-force branch advance (up to 2 MB) | P·Prod* | N | I | B | E | PAR-3 |
| `github_content_push_files` | Commit several file changes at once on a branch, signed by GitHub (GraphQL `createCommitOnBranch`, expected head checked) | P·Prod* | N | I | B | E | D-2 built #32 |
| `github_content_edit_files` | Edit files by find-and-replace (text must match exactly once unless `all`) and commit on a branch, signed by GitHub; sends only the changed text | P·Prod* | N | I | B | E | D-2 follow-up built |
| `github_content_get_archive_link` | Safe queryless archive URL or GitHub page when signed redirect withheld (all detail modes) | — | N | I | B | R | D-2 built #30 |
| `github_content_check_codeowners` | Problems GitHub found in a CODEOWNERS file on a branch (bad lines, unknown users or teams), in plain words | — | C | I | B,O | R | D-2 built #30 |
| `github_commit_list` | Commits on a branch or path, by author or date | — | C | I | B,Op | R | D-2 built #30 |
| `github_commit_get` | One commit: message, author, files changed with stats (patch capped) | — | C | I | B,Op | R | D-2 built #30 |
| `github_commit_compare` | Compare two refs: ahead/behind, commits, files (patches capped) | — | C | I | B,Op | R | D-2 built #30 |
| `github_commit_list_prs` | Pull requests that contain a commit | — | C | I | B,Op | R | D-2 built #30 |
| `github_commit_comment` | Comment on a commit (optionally on a line) | P·M | C | I | B | E | D-2 built #32 |
| `github_git_get_ref` | One ref (branch or tag pointer) and its target | — | C | I | B | R | D-2 built #30 |
| `github_git_update_ref` | Move a branch to another commit; force moves need `force: true` and are refused on production branches without a production connection | C·Prod* | F | I | B | F | D-2 built #32 |
| `github_git_get_commit` | Low-level commit object (tree, parents, verification) | — | C | I | B | R | D-2 built #30 |

## Branches and tags (`github_branch_*, github_tag_*`) — 9

Card(s): D-3.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `github_branch_list` | Branches with head SHA, protected flag and whether rules apply | — | F | I | B,Op | R | D-3 built #33 |
| `github_branch_get` | One branch: head commit, protection, and every ruleset rule that applies (`GET /rules/branches/{branch}`) | — | C | I | B,Op | R | D-3 built #33 |
| `github_branch_create` | New branch from any ref (default: the repo's default branch, not a guessed `main`) | P | F | I | B | E | D-3 built #33 |
| `github_branch_rename` | Rename a branch (open PRs are retargeted by GitHub) | C·Prod* | C | I | B | F | D-3 built #33 |
| `github_branch_delete` | Delete a branch (default branch always refused; protected needs production) | C·D·Prod* | F | I | B | E | D-3 built #33 |
| `github_branch_merge` | Merge one branch into another directly (no PR) | P·Prod* | C | I | B | E | D-3 built #33 |
| `github_tag_list` | Tags with their commits | — | C | I | B,Op | R | D-3 built #33 |
| `github_tag_create` | Create a lightweight or annotated tag | C·Prod | N | I | B | F | D-3 built #33 |
| `github_tag_delete` | Delete a tag | C·D·Prod | N | I | B | F | D-3 built #33 |

## Pull requests (`github_pr_*`) — 15

Card(s): E-1, E-2.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `github_pr_list` | Pull requests by state, base, head branch, author, label | — | C | I | B,Op | R | E-1 (built #35) |
| `github_pr_get` | One PR: state, draft, head SHA, mergeable, review decision, required checks at head, unresolved thread count | — | C | I | B,Op | R | E-1 (built #35) |
| `github_pr_get_diff` | The PR's diff (capped; handle for the rest) | — | C | I | B | R | E-1 (built #35) |
| `github_pr_list_files` | Files changed with additions/deletions (patches capped) | — | C | I | B | R | E-1 (built #35) |
| `github_pr_list_commits` | Commits in the PR | — | C | I | B | R | E-1 (built #35) |
| `github_pr_create` | Open a pull request (draft option; body footer records the tool and run) | P·M | C | I | B | E | E-1 (built #40) |
| `github_pr_update` | Title, body, base branch (retarget), state open/closed | P·M | F | I | B | E | E-1 (built #40) |
| `github_pr_set_draft` | Convert to draft or mark ready for review (GraphQL) | P | N | I | B | E | E-1 (built #40) |
| `github_pr_close` | Close without merging (head branch kept) | C | C | I | B | E | E-1 (built #40) |
| `github_pr_update_branch` | Bring the PR branch up to date with its base (expected head SHA checked) | P | C | I | B | E | E-1 (built #40) |
| `github_pr_merge` | Merge at an exact head SHA; refuses unless every required check is green at that SHA; production base needs a production connection | C·Prod* | F | I | B | E | E-2 (built #46) |
| `github_pr_merge_async` | Same as `github_pr_merge` using GitHub's asynchronous merge (returns merged / failed / pending); `bypass_rules` only with GOD-6's `overrideRules` (reason, preview, confirm, as you) | C·Prod* | N | I | B | E | E-2 (built #46) |
| `github_pr_set_auto_merge` | Turn auto-merge on (merges when GitHub's rules pass) or off (GraphQL) | C·Prod* | N | I | B | E | E-2 (built #46) |
| `github_pr_list_stacks` | Pull request stacks in a repo, or one stack with its PRs in order | — | N | I | B | R | E-2 built #48 |
| `github_pr_stack_manage` | Create a stack, add PRs to it, or unstack PRs | P | N | I | B | E | E-2 built #48 |

## Reviews and review threads (`github_review_*`) — 10

Card(s): E-3.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `github_review_list` | Reviews on a PR (state, author, submitted at) | — | C | I | B,Op | R | E-3 built #37 |
| `github_review_list_threads` | Review threads with resolved/outdated state, file and line, every comment (GraphQL) | — | N | I | B | R | E-3 built #37 |
| `github_review_list_comments` | Inline review comments (REST), filterable by file | — | C | I | B | R | E-3 built #37 |
| `github_review_create` | Start or submit a review: comment, approve or request changes, with inline comments | P·M | C | I | B | E | E-3 built #38 |
| `github_review_submit` | Submit a pending review | P·M | C | I | B | E | E-3 built #38 |
| `github_review_dismiss` | Dismiss a review with a message | C·M | C | I | B | F | E-3 built #38 |
| `github_review_reply` | Reply in a review thread | P·M | C | I | B | E | E-3 built #38 |
| `github_review_resolve_thread` | Resolve or unresolve a review thread (GraphQL) | P | N | I | B | E | E-3 built #38 |
| `github_review_request_reviewers` | Request or remove reviewers (users or teams) | P·M | C | I | B | E | E-3 built #38 |
| `github_review_request_copilot` | Ask GitHub Copilot to review an open pull request (needs a Copilot plan with code review; the review arrives in minutes; cannot be taken back, so no undo) | P | N | I | B | E | PAR-1 built |

## Issues (`github_issue_*`) — 15

Card(s): F-1.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `github_issue_list` | Issues by state, label, assignee, milestone, type (pull requests excluded by query, not by dropping rows) | — | F | I | B,Op | R | F-1 built #167 |
| `github_issue_get` | One issue with sub-issue and dependency summary | — | C | I | B,Op | R | F-1 built #167 |
| `github_issue_create` | New issue (labels, assignees, milestone, type) | P·M | C | I | B,Op | E | F-1 built #167 |
| `github_issue_update` | Title, body, state with reason, milestone, type | P·M | F | I | B,Op | E | F-1 built #167 |
| `github_issue_lock` | Lock or unlock conversation | P | C | I | Op | E | F-1 built #168 |
| `github_issue_list_comments` | Comments on an issue or PR | — | C | I | B,Op | R | F-1 built #167 |
| `github_issue_comment` | Comment on an issue or PR | P·M | C | I | B,Op | E | F-1 built #167 |
| `github_issue_edit_comment` | Edit a comment | P·M | C | I | B,Op | E | F-1 built #168 |
| `github_issue_list_timeline` | Everything that happened to an issue (events, references, cross-links) | — | C | I | Op | R | F-1 built #167 |
| `github_issue_set_labels` | Add, remove or replace labels on an issue or PR | P | F | I | B,Op | E | F-1 built #168 |
| `github_issue_set_assignees` | Add or remove assignees | P·M | C | I | Op | E | F-1 built #168 |
| `github_issue_set_sub_issue` | Add, remove or reorder a sub-issue | P | N | I | Op | E | F-1 built #170 |
| `github_issue_set_dependency` | Add or remove a 'blocked by' link | P | N | I | Op | E | F-1 built #170 |
| `github_issue_transfer` | Move an issue to another repository (GraphQL) | C·M | N | I | Op | E | F-1 built final PR |
| `github_issue_react` | Add or remove a reaction on an issue, comment or review comment | P·M | C | I | Op | E | F-1 built #172 |

## Labels and milestones (`github_label_*, github_milestone_*`) — 7

Card(s): F-2.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `github_label_list` | Labels in a repository | — | C | I | B,Op | R | F-2 built #175 |
| `github_label_save` | Create or update a label by name | P | C | I | B,Op | E | F-2 built #175 |
| `github_label_delete` | Delete a label (removes it from every issue) | C | C | I | Op | E | F-2 built #175 |
| `github_label_sync` | Copy labels across connected accounts, preview exact changes and require explicit approval for deletion | C | N | I | O,Op | F | F-2 built #176 |
| `github_milestone_list` | Milestones with progress | — | C | I | Op | R | F-2 built #175 |
| `github_milestone_save` | Create, update or close a milestone | P | C | I | Op | E | F-2 built #175 |
| `github_milestone_delete` | Delete a milestone | C | C | I | Op | E | F-2 built #175 |

## Discussions, projects and search (`github_discussion_*, github_project_*, github_search_*`) — 11

Card(s): F-3.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `github_discussion_list` | Discussions in a repository by category (GraphQL) | — | C | I | Op | R | F-3 built #178 |
| `github_discussion_get` | One discussion with its comments and answer (GraphQL) | — | C | I | Op | R | F-3 built #178 |
| `github_discussion_create` | Start a discussion (GraphQL) | P·M | N | I | Op | E | F-3 built #178 |
| `github_discussion_comment` | Comment on a discussion or mark a comment as the answer (GraphQL) | C·M | N | I | Op | E | F-3 built #178 |
| `github_project_list` | Projects (v2) of an org or user | — | N | I,U | Op | R | F-3 built #182 |
| `github_project_get` | One project: fields, views, item counts | — | N | I,U | Op | R | F-3 built #182 |
| `github_project_list_items` | Items in a project with field values | — | N | I,U | Op | R | F-3 built #182 |
| `github_project_set_item` | Add an issue/PR to a project or set an item's field value | C | N | I | Op | E | F-3 built #183 |
| `github_project_remove_item` | Remove an item from a project | C | N | I | Op | E | F-3 built #183 |
| `github_project_set_items` | Edit field values on up to 40 items of an organization project in one call; stops at the first failure and says what was done | C | N | I | Op | E | PAR-1 built |
| `github_search_github` | Search code, issues, pull requests, commits, repositories or users with GitHub's search syntax (type chosen by argument); text from strangers and every commit message is marked `untrusted`; find organizations with type users and `type:org` in the query | — | C | I | B,Op | R | F-3 built #177 |

## Actions: workflows, runs, jobs and logs (`github_actions_*`) — 13

Card(s): G-1.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `github_actions_list_workflows` | Workflows in a repository with state and file path | — | C | I | B,Op | R | G-1 built #39 |
| `github_actions_set_workflow_enabled` | Enable or disable a workflow | P·Prod* | C | I | B | F | G-1 built #41 |
| `github_actions_dispatch` | Start a workflow (`workflow_dispatch`) on a ref with inputs; returns the run (API 2026-03-10) | P·Prod* | F | I | B,Op | E | G-1 built #41 |
| `github_actions_list_runs` | Runs by workflow, branch, event, status, actor, head SHA | — | C | I | B,Op | R | G-1 built #39 |
| `github_actions_get_run` | One run: status, conclusion, jobs and steps, attempt, billable timing | — | C | I | B,Op | R | G-1 built #39 |
| `github_actions_get_job_log` | A job's log: failed steps first, tail lines, error lines; never a raw base64 dump | — | F | I | B,Op | R | G-1 built #39 |
| `github_actions_get_run_logs_summary` | Download a run's log archive server-side and return failing steps, error lines and annotations | — | F | I | B,Op | R | G-1 built #39 |
| `github_actions_rerun` | Re-run a whole run, only its failed jobs, or one job | P·Prod* | C | I | B,Op | E | G-1 built #41 |
| `github_actions_approve_fork_run` | Approve one reviewed public fork PR CI run, including GitHub's synthetic PR merge SHA; never bypass checks | C·Prod* | N | U | B,Op | F | FORK-CI-1 |
| `github_actions_cancel_run` | Cancel a run (force-cancel needs confirm) | P | C | I | B,Op | E | G-1 built #41 |
| `github_actions_delete_run` | Delete a run, or only its logs | C·D | C | I | Op | F | G-1 built #41 |
| `github_actions_list_pending_deployments` | Runs waiting for an environment approval | — | N | I | Op | R | G-1 built #39 |
| `github_actions_review_pending_deployment` | Approve or reject a waiting deployment | C·Prod* | N | U | Op | F | G-1 built #41 |

## Checks, statuses, artifacts and caches (`github_check_*, github_status_*, github_artifact_*, github_cache_*`) — 10

Card(s): G-2.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `github_check_get_ci_state` | CI state at a commit or PR head: every check run and status, which are required by rules, overall green/red/pending | — | N | I | B,Op | R | G-2 built #42 |
| `github_check_get_run` | One check run with output summary and annotations | — | C | I | B | R | G-2 built #42 |
| `github_check_create_run` | Create a check run on a commit (GitHub App only) | P | C | I | B | E | G-2 built #43 |
| `github_check_update_run` | Update or complete a check run | P | C | I | B | E | G-2 built #43 |
| `github_status_create` | Set a commit status (pending/success/failure/error) with a context | P | C | I | B | E | G-2 built #43 |
| `github_artifact_list` | Artifacts of a run or repository with size and expiry | — | C | I | B | R | G-2 built #42 |
| `github_artifact_get_link` | Artifact metadata and safe GitHub navigation; signed links never pass through chat | — | F | I | B | R | G-2 built #42 |
| `github_artifact_delete` | Delete an artifact | C·D | C | I | Op | E | G-2 built #43 |
| `github_cache_list` | Actions caches and total cache usage for a repository | — | N | I | B,Op | R | G-2 built #42 |
| `github_cache_delete` | Delete caches by key or ID | C | N | I | B | E | G-2 built #43 |

## Secrets and variables (`github_secret_*, github_variable_*`) — 7

Card(s): G-3. Covers Actions, Dependabot, Codespaces and agent secrets at repository, environment and organization level, and (GOD-4) your own personal Codespaces secrets with `level: user` and `kind: codespaces` — those use your master token (codespace permission) and are refused in plain words without it. **Secret values never pass through a tool:** Chris types them on the setup page, or the server generates them.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `github_secret_list` | Secret names, kind, scope, last updated, which repos can use an org secret (never values) | — | F | I | B,O | R | G-3 built #44 |
| `github_secret_set` | Create or update a secret; the value is typed by Chris on the setup page (link returned) or generated by the server; encrypted with the scope's public key | C·Prod* | N | I | B,O | F | G-3 built #45 |
| `github_secret_delete` | Delete a secret | C·D·Prod* | C | I | B,O | F | G-3 built #45 |
| `github_secret_set_repo_access` | Choose which repositories may use an organization secret | C·A·Prod | N | I | O | F | G-3 built #45 |
| `github_variable_list` | Variables with values (variables are not secret) | — | C | I | B | R | G-3 built #44 |
| `github_variable_set` | Create or update a variable | P·Prod* | F | I | B | E | G-3 built #44 |
| `github_variable_delete` | Delete a variable | C·Prod* | C | I | B | E | G-3 built #44 |

## Environments and deployments (`github_env_*, github_deploy_*`) — 10

Card(s): G-4.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `github_env_list` | Environments with protection rules, branch policies and counts of secrets/variables | — | C | I | B,O | R | G-4 built #49 |
| `github_env_get` | One environment in full (reviewers, wait timer, branch and tag policies, custom rules) | — | C | I | B,O | R | G-4 built #49 |
| `github_env_save` | Create or update an environment, its protection rules and branch policies | C·Prod* | F | I | B,O | F | G-4 built #50 |
| `github_env_delete` | Delete an environment (its secrets and variables go with it) | C·D·Prod* | C | I | O | F | G-4 built #50 |
| `github_env_policy_create` | Add a custom branch/tag deployment pattern | C·A·Prod* | C | I | O | F | G-4 built #53 |
| `github_env_policy_update` | Rename an existing deployment branch/tag pattern | C·A·Prod* | C | I | O | F | G-4 built #53 |
| `github_env_policy_delete` | Remove a deployment branch/tag pattern | C·A·Prod* | C | I | O | F | G-4 built #53 |
| `github_deploy_list` | Deployments with their latest status, by environment and ref | — | C | I | B,Op | R | G-4 built #51 |
| `github_deploy_create` | Create a deployment for a ref and environment | C·Prod* | C | I | B | E | G-4 built #52 |
| `github_deploy_set_status` | Add a status to a deployment (in progress, success, failure, inactive) | P·Prod* | C | I | B | E | G-4 built #52 |

## Releases (`github_release_*`) — 7

Card(s): G-5.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `github_release_list` | Releases with tag, draft/prerelease flags and asset counts | — | C | I | B,Op | R | G-5 built #54 |
| `github_release_get` | One release by ID, tag or 'latest', with assets | — | C | I | B,Op | R | G-5 built #54 |
| `github_release_create` | Create a release (draft by default) with optional generated-notes preview; publishing creates the tag | C·Prod·M | F | I | B | F | G-5 built #55 |
| `github_release_update` | Edit notes, name, flags; publish a draft | C·Prod·M | C | I | B | F | G-5 built #55 |
| `github_release_delete` | Delete a release (Git tag preserved) | C·D·Prod | C | I | B | F | G-5 built #55 |
| `github_release_upload_asset` | Attach a file to a release from a public URL (downloaded server-side, size-capped; no bytes in chat) | P·Prod* | F | I | B | F | G-5 built #59 |
| `github_release_delete_asset` | Remove a file attached to a release (a wrong or outdated build); production when the release is published | C·D·Prod* | C | I | B | F | G-5 built #56 |

## Pages and packages (`github_pages_*, github_package_*`) — 7

Card(s): G-6.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `github_pages_get` | Pages site settings, custom domain, HTTPS state and the latest build | — | C | I | B,O | R | G-6 built #60 |
| `github_pages_save` | Turn on Pages or change source branch/path, custom domain, HTTPS | C·Prod·A* | C | I | B,O | F | G-6 built #61 |
| `github_pages_disable` | Turn off a Pages site | C·D·Prod | C | I | O | F | G-6 built #61 |
| `github_package_list` | Packages of an org or user with versions | — | C | P | B | R | G-6 built #60 |
| `github_package_delete_version` | Delete a package version (restorable for 30 days) | C·D·Prod | C | P | B | F | G-6 built #62 |
| `github_package_delete` | Delete a whole package with all its versions (restorable for 30 days; GitHub refuses public packages with over 5,000 downloads) | C·D·Prod | C | P | B | F | G-6 built #63 |
| `github_package_restore_version` | Restore a deleted package or package version (within 30 days) | C·Prod | C | P | B | F | G-6 built #64 |

## Developer tools (`github_dev_*`) — 15

Full ordinary owners can use developer workflows in either connection mode. Verified scratch enrollment and exact run provenance remain required; explicit passes and other profiles retain their selected restrictions.

Card(s): V-1 … V-5. The owner alone can enable an exact Organization as `is_scratch` through the authenticated setup page after live All-repositories App verification; no connection/tool argument can elevate this flag. Preview-only (contract §10): every `github_dev_*` tool refuses production targets before reading anything, records every object it creates in a run, and tags it `rtc_run=<runId>` (`docs/designs/BATCH-V.md`).

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `github_dev_list_scenarios` | Named scenarios github_dev_seed can build (e.g. repo-with-failing-ci, open-pr-with-review-threads, release-train) | — | N | — | B | R | V-1 built #68 |
| `github_dev_seed` | Build a scenario in the scratch account or on test branches: repos, branches, commits, PRs, issues, labels, workflow files; preview lists every object | P | N | I | B | E | V-1 built #70–#80; initial scratch SHA #102; exact marker #90; resume commit provenance #124; first-create label evidence #126 (no deletion authority; six scratch scenarios; webhook-target pending V-4) |
| `github_dev_list_runs` | Connection-scoped runs and birth labels, plus opt-in remote cleanup/first-label identity drift diagnostics (no deletion authority), and paged previews | — | N | — | B | R | V-1 built #65/#223; V-2 built #84/#223 |
<!-- #106: all-runs cleanup preview includes at-most-five run proposals; each still needs fresh verification and explicit per-run confirmation. -->
| `github_dev_create_scratch_repo` | Throwaway repository in the scratch account, tagged with the run | P | N | I | B | E | V-1 built #69; initial scratch SHA #102; exact verified same-run replay #125; origin label evidence #126 (not deletion authority); delayed-default-label stabilization with zero-default support #174 |
| `github_dev_cleanup` | Clean confirmed run-owned scratch repositories, or exact unprotected standalone test PRs/branches; reject foreign scratch resources, enforce a single executable scenario's finite resource types/counts, then independently verify ownership before deletion; never delete host repositories; standalone PR associations use complete paged GitHub issue-label GET, not a nonexistent GET by label name | C | N | I | B | E | V-2 built #85–#90; two-way resource inventory #121; finite scenario limits #122; exclusive executor #132; connected scratch acceptance pending |
| `github_dev_create_test_branch` | Branch `rtc/<run>/<name>` from any ref in an allowed repo (never production) | P | N | I | B | E | V-3 built #221 (run-owned only; one repository per run; cleanup-compatible) |
| `github_dev_open_test_pr` | Draft PR from a test branch, labelled with the run | P | N | I | B | E | V-3 built #221 (commits one run file; recorded label; never merges) |
| `github_dev_dispatch_and_wait` | Start a workflow on a test ref and wait up to 45 s; returns the run, or a handle to check later | P | N | I | B | E | V-3 built #221 (resume never re-dispatches; production workflows refused) |
| `github_dev_set_check_run` | Create or complete a check run on a run-created commit to simulate a passing/failing check | P | N | I | B | E | V-3 built #221 (App credential only; cleanup closes it out, GitHub cannot delete it) |
| `github_dev_create_test_webhook` | Webhook in a scratch repo pointing at an app under development (public HTTPS only; secret shown once on the setup page) | P | N | I | B | E | V-4 built (scratch repositories only, at most three per run; recorded for cleanup; signs with the forwarder secret or a new one shown once) |
| `github_dev_create_forwarder` | Register an app-under-development URL and a signing secret (shown once) to replay GitHub deliveries into | P | N | I | B | E | V-4 built (target re-checked after DNS and at every send; 20 per connection; secret shown once, kept encrypted) |
| `github_dev_list_forwarders` | Forwarders with target and last use | — | N | — | B | R | V-4 built (host names only) |
| `github_dev_delete_forwarder` | Remove a forwarder | C | N | I | B | E | V-4 built |
| `github_dev_forward_deliveries` | Send real past webhook deliveries to a forwarder with a valid `X-Hub-Signature-256`; reports each status code | P | N | I | B | E | V-4 built (up to 10 per call; fresh delivery ID; redirects refused; a timeout is reported, never repeated) |
| `github_dev_check_integration` | Is GitHub set up for an app being built (app permissions, webhook events, secrets present, workflows, rules)? Exact steps for anything missing | — | N | I | B | R | V-5 built (read-only; names only, never secret values; unreadable is never reported as missing) |

## Branch protection and rulesets (`github_protection_*, github_ruleset_*`) — 9

Card(s): H-1.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `github_protection_get` | Classic branch protection on a branch, in plain words | — | C | I | B,O | R | H-1 built #184 |
| `github_protection_set` | Change branch protection by reading it first and changing only what was asked (GitHub's PUT replaces everything) | C·A·Prod | F | I | O | F | H-1 built #188 |
| `github_protection_set_required_checks` | Add or remove required status checks, keeping the rest | C·Prod | F | I | B,O | F | H-1 built #185 |
| `github_protection_remove` | Remove branch protection | C·A·D·Prod | C | I | O | F | H-1 built #188 |
| `github_ruleset_list` | Rulesets of a repository or organization with enforcement and targets | — | C | I | B,O | R | H-1 built #184 |
| `github_ruleset_get` | One ruleset in plain words, optionally with its history | — | C | I | B,O | R | H-1 built #184 |
| `github_ruleset_save` | Create or update a ruleset (read-merge-write for updates) | C·A·Prod | F | I | O | F | H-1 built #185 |
| `github_ruleset_delete` | Delete a ruleset | C·D·Prod | C | I | O | F | H-1 built #185 |
| `github_ruleset_list_rule_suites` | Recent rule evaluations: which push or merge was blocked by which rule, and why | — | N | I | B,O | R | H-1 built #184 |

## Webhooks (`github_webhook_*`) — 8

Card(s): H-2.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `github_webhook_list` | Repository or organization webhooks (URL host, events, active; secrets never shown) | — | C | I | B,O | R | H-2 built #189 |
| `github_webhook_get` | One webhook's configuration and recent delivery health | — | C | I | B,O | R | H-2 built #189 |
| `github_webhook_save` | Create or update a webhook; a new signing secret is generated and shown once on the setup page | C·Prod | F | I | B,O | F | H-2 built #193 |
| `github_webhook_delete` | Delete a webhook | C·D·Prod | C | I | O | F | H-2 built #190 |
| `github_webhook_list_deliveries` | Recent deliveries (status, event, duration), or one delivery's request/response (payload capped) | — | N | I | B,Op | R | H-2 built #189 |
| `github_webhook_redeliver` | Redeliver one past delivery | C·Prod* | N | I | B,Op | E | H-2 built #190 |
| `github_webhook_ping` | Send a confirmed ping to a public HTTPS webhook, with delivery readback | C·Prod* | C | I | B | E | H-2 built #190 |
| `github_webhook_rotate_secret` | Replace a webhook's signing secret (new one shown once on the setup page) | C·Prod | N | I | O | F | H-2 built #193 |

## Collaborators and deploy keys (`github_collab_*, github_deploykey_*`) — 7

Card(s): H-3.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `github_collab_list` | Collaborators with permission and how they got it, plus pending invitations | — | C | I | O,Op | R | H-3 built #194 |
| `github_collab_add` | Invite a collaborator or change their permission | C·A·M·Prod | F | I | O | F | H-3 built #194 |
| `github_collab_remove` | Remove a collaborator | C·Prod | C | I | O | F | H-3 built #194 |
| `github_collab_manage_invitation` | Change or cancel a pending repository invitation | C·A·Prod | C | I | O | F | H-3 built #194 |
| `github_deploykey_list` | Deploy keys with read-only/write flag and last use | — | C | I | O | R | H-3 built #194 |
| `github_deploykey_add` | Add a deploy key (public key only; write access is access-widening and production) | C·A·Prod* | F | I | O | F | H-3 built #194 |
| `github_deploykey_delete` | Remove a deploy key | C·Prod | C | I | O | F | H-3 built #194 |

## Security features and alerts; Actions settings (`github_security_*, github_actions_*settings`) — 11

Card(s): H-4.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `github_security_get_settings` | Read verified repo security features including AI detection, non-provider patterns, delegated dismissal/bypass, private reporting and dedicated Dependabot enabled/paused state | — | F | I | O,B | R | H-4 built #195/#196/#224 |
| `github_security_set_feature` | Enable/disable all provider-supported repo security switches: direct security_and_analysis PATCH, Dependabot PUT/DELETE and private-reporting PUT/DELETE, with paid/private notices, bypass access consent and exact independent readback | C·$*·Prod | F | I | O | F | H-4 built #195/#196/#224 |
| `github_security_list_alerts` | Dependabot, code scanning or secret scanning alerts for a repo or org (kind chosen by argument) | — | C | I | O,B,Op | R | H-4 built #195/#196/#224 |
| `github_security_scan_files` | Inspect up to 12 chosen GitHub-hosted files for common secret patterns; redacted locations only, not GitHub's full proprietary scan or local uncommitted changes | — | N | I | B,O,Op | R | PAR-2 |
| `github_security_scan_guidance` | Inspect provider secret protection and prepare Robinson repository CI/local scanning plus official remote-engine connection steps | — | N | I | B,O,Op | R | PAR-2 |
| `github_security_get_alert` | One alert in plain words (secret scanning: the secret itself is never returned) | — | F | I | O,B | R | H-4 built #195/#196/#224 |
| `github_security_update_alert` | Dismiss, resolve or reopen an alert with a reason | C·Prod | C | I | O,B | E | H-4 built #195/#196/#224 |
| `github_security_list_advisories` | Repository security advisories, or global advisories by package | — | C | I | O,B | R | H-4 built #195/#196/#224 |
| `github_security_compare_dependencies` | Dependencies added, removed or changed between two commits or branches (a PR), with known vulnerabilities and licences; distinguish explicit provider plan refusal from missing App permission | — | N | I | B,O | R | H-4 built #195/#196/#224 |
| `github_actions_get_settings` | Repository Actions settings: allowed actions, default token permissions, fork PR approval, retention | — | N | I | O,B | R | H-4 built #195/#196/#224 |
| `github_actions_set_settings` | Change repository Actions settings | C·Prod·A | N | I | O | F | H-4 built #195/#196/#224 |

## Owner: organization and members (`github_org_*`) — 13

Card(s): O-2.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `github_org_get` | Organization profile, plan, seats, settings (default permission, who may create repos/pages/forks, 2FA requirement state) | — | C built #199 | I | O | R | O-2 built #199 |
| `github_org_update_settings` | Change organization profile and member privileges (each field previewed; widening privileges is access-widening) | C·Prod·A* | N built #199 | I | O | F | O-2 built #199 |
| `github_org_list_members` | Members with role and 2FA state; outside collaborators on request | — | C built #199 | I | O | R | O-2 built #199 |
| `github_org_invite_member` | Invite someone by username or email with a role and teams | C·A·M | N built #199 | I | O | F | O-2 built #199 |
| `github_org_list_invitations` | Pending and failed invitations | — | N built #199 | I | O | R | O-2 built #199 |
| `github_org_cancel_invitation` | Cancel a pending invitation | C·M | N built #199 | I | O | F | O-2 built #199 |
| `github_org_set_member_role` | Make a member an owner or a member | C·A* | N built #199 | I | O | F | O-2 built #199 |
| `github_org_remove_member` | Remove a member (they lose access to private repositories) | C·D | N built #199 | I | O | F | O-2 built #199 |
| `github_org_set_outside_collaborator` | Convert a member to outside collaborator, or remove an outside collaborator | C | N built #199 | I | O | F | O-2 built #199 |
| `github_org_set_blocked` | Block or unblock a user for the organization; list blocked users | P | N built #199 | I | O | F | O-2 built #199 |
| `github_org_custom_properties` | Read or define the organization's custom properties (schema) | P | N built #199 | I | O | F | O-2 built #199 |
| `github_org_set_notification_restriction` | Set organization notification domain restrictions with independent readback | C·A·Prod | N | I | O | F | GQL-1 |
| `github_org_set_immutable_releases` | Require immutable releases for all or selected repositories | C·Prod | N built #199 | I | O | F | O-2 built #199 |

## Owner: teams and roles (`github_team_*, github_role_*`) — 9

Card(s): O-3.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `github_team_list` | Teams with privacy, parent and member counts | — | C built #200 | I | O | R | O-3 built #200 |
| `github_team_get` | One team: members and roles, repositories and permissions | — | C built #200 | I | O | R | O-3 built #200 |
| `github_team_save` | Create or update a team (name, description, privacy, parent) | P | C built #200 | I | O | F | O-3 built #200 |
| `github_team_delete` | Delete a team | C·D | C built #200 | I | O | F | O-3 built #200 |
| `github_team_set_member` | Add a member, change member/maintainer role, or remove | C·A*·M | C built #200 | I | O | F | O-3 built #200 |
| `github_team_set_repo_access` | Give, change or remove a team's access to a repository | C·A* | C built #200 | I | O | F | O-3 built #200 |
| `github_role_list` | Organization roles and custom repository roles (where the plan has them), with who holds each | — | N built #200 | I | O | R | O-3 built #200 |
| `github_role_assign` | Give a user or team an organization role | C·A | N built #200 | I | O | F | O-3 built #200 |
| `github_role_remove` | Take an organization role away from a user or team | C | N built #200 | I | O | F | O-3 built #200 |

## Owner: billing, budgets, Copilot and Codespaces (`github_billing_*, github_copilot_*, github_codespace_*`) — 14

Card(s): O-4. The developer's $0/production-OFF TEST rule does not limit an end user's separately delegated authority. Known-price changes disclose the sourced estimate. `$*` includes future metered/unknown charges: disclose an uncapped exposure, confirm, honor explicit user-chosen spend ceilings and RTC pass allowances, and never infer policy GET verification from a Codespaces 204. Current source repair is pending exact-head CI/merge and subsequent live provider acceptance.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `github_billing_get_usage` | Usage and cost for an org or user by product (Actions, Packages, Codespaces, Copilot, LFS) and period, in dollars; premium requests on request | — | N built #201 | I,U | O | R | O-4 built #201 |
| `github_billing_list_budgets` | Organization budgets with amount, spent so far and whether usage stops at the limit | — | N built #201 | I | O | R | O-4 built #201 |
| `github_billing_save_budget` | Create or modify a verified provider budget, including unenforced settings through informed owner authorization | C·$*·Prod | N built #201 | I | O | F | O-4 built #201 |
| `github_billing_delete_budget` | Delete an exact verified budget with owner one-call execution, unknown-cost disclosure and independent absence readback | C·D·$*·Prod | N built #201 | I | O | F | O-4 built #201; authority repair pending |
| `github_billing_list_marketplace` | Marketplace apps Chris pays for (plan, price, next billing date); buying is guided only because GitHub has no purchase API (provider UI only) | — | N built #201 | U | O | R | O-4 built #201 |
| `github_copilot_get_billing` | Copilot plan, seat counts and seat assignments with last activity | — | C built #201 | I | O | R | O-4 built #201 |
| `github_copilot_add_seats` | Assign Copilot seats with a verified plan price, or disclose unknown recurring pricing under user delegation | C·$·A·M·Prod | F built #201 | I | O | F | O-4 built #201 |
| `github_copilot_remove_seats` | Remove Copilot seats at cycle end even if the provider plan's price is not published | C·Prod | C built #201 | I | O | F | O-4 built #201 |
| `github_codespace_list` | Codespaces of the user or org with machine, state and who pays (uses your master token when added) | — | C built #201 | I,U | O,B | R | O-4 built #201 |
| `github_codespace_list_machines` | Machine types a codespace of yours could be switched to (cores, memory, storage) (uses your master token when added) | — | N | I,U | O,B | R | GOD-4 |
| `github_codespace_create` | Create a codespace for a repo and branch (hourly compute plus storage) (uses your master token when added) | C·$·Prod | C built #201 | U | O,B | F | O-4 built #201 |
| `github_codespace_set_state` | Start (billed) or stop (saves money) a codespace (uses your master token when added) | C·$*·Prod* | C built #201 | U | O,B | F | O-4 built #201 |
| `github_codespace_delete` | Delete a codespace (unpushed work is lost) (uses your master token when added) | C·D·Prod | C built #201 | U | O,B | F | O-4 built #201 |
| `github_codespace_set_org_access` | PUT organization-paid Codespaces access with exact selected-user membership, owner one-call execution and restricted-grant allowances, and explicit UNCONFIRMED 204 until owner UI verifies saved policy | C·A·$*·Prod | N built #201 | I | O | F | O-4 built #201; authority repair pending |

## Owner: apps and fine-grained tokens (`github_app_*, github_tokenpolicy_*`) — 7

Card(s): O-5. Source built in PR #203 with scoped metadata projections, U-credential installation repository changes and three-door guarded PAT approval/revocation. Live custom-MCP acceptance remains pending release and owner authorization; raw token values are never surfaced. Some GitHub plans/credential types do not permit these operations, and the server fails closed rather than claiming unsupported write success.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `github_app_list_installations` | GitHub Apps installed on an org or on Chris's account, with permissions and repo selection | — | C | I,U | O | R | O-5 built #203 |
| `github_app_get_installation` | One installation: permissions, events, selected repositories, suspended state | — | C | I,U | O | R | O-5 built #203 |
| `github_app_set_installation_repos` | Add or remove a repository from an app installation | C·Prod·A* | N | U | O | F | O-5 built #203 |
| `github_tokenpolicy_list_requests` | Pending requests from fine-grained tokens to access the organization | — | N | I | O | R | O-5 built #203 |
| `github_tokenpolicy_review_request` | Approve or deny a fine-grained token's access request | C·Prod·A* | N | I | O | F | O-5 built #203 |
| `github_tokenpolicy_list_tokens` | Fine-grained tokens that can reach the organization, with owner, repositories and expiry | — | N | I | O | R | O-5 built #203 |
| `github_tokenpolicy_revoke_access` | Revoke a fine-grained token's access to the organization | C·Prod | N | I | O | F | O-5 built #203 |

## Owner: personal account (`github_account_*`) — 14

Card(s): O-6. Source built in PR #204 with verified user-auth principal, real profile/email/public-key/block/invitation operations and full guarded-write lifecycle. Needs a user authorization (`U`); installation tokens cannot reach personal settings. Raw public key material is accepted only for additions but never returned in inventory. Provider acceptance and real email confirmation remain separate.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `github_account_get` | Chris's profile, plan, organizations, emails (primary/verified/visibility) and two-factor state (uses your master token when added) | — | C | U | O | R | O-6 built #204 |
| `github_account_update_profile` | Name, bio, company, blog, location, hireable, social handle (uses your master token when added) | C·Prod | N | U | O | F | O-6 built #204 |
| `github_account_manage_email` | Add or remove an email address, or set primary email visibility (uses your master token when added) | C·Prod·A*·M* | N | U | O | F | O-6 built #204 |
| `github_account_list_keys` | SSH authentication keys, SSH signing keys and GPG keys (fingerprints only) (uses your master token when added) | — | N | U | O | R | O-6 built #204 |
| `github_account_add_key` | Add an SSH, signing or GPG public key (uses your master token when added) | C·Prod·A | N | U | O | F | O-6 built #204 |
| `github_account_delete_key` | Delete an SSH, signing or GPG key (uses your master token when added) | C·Prod | N | U | O | F | O-6 built #204 |
| `github_account_set_blocked` | Block or unblock a user; list blocked users (uses your master token when added) | C·Prod | N | U | O | F | O-6 built #204 |
| `github_account_list_invitations` | Repository invitations waiting for Chris (uses your master token when added) | — | N | U | O | R | O-6 built #204 |
| `github_account_respond_invitation` | Accept or decline a repository invitation (uses your master token when added) | C·Prod·A* | N | U | O | F | O-6 built #204 |
| `github_account_set_status` | Set or clear your profile status: emoji, message (80 characters), expiry and busy indicator; read back field by field (uses your master token when added) | C | N | U | O | F | Y-1 built #227 |
| `github_account_export_status` | Your account exports: one export's state, or the recent list (uses your master token when added) | — | N | U | B,O | R | GOD-4 |
| `github_account_export_link` | Account export metadata and safe GitHub navigation; signed redirect withheld, no archive bytes | — | N | U | B,O | R | GOD-4 |
| `github_account_export_start` | Start exporting your own repositories to an archive; never locks repositories (uses your master token when added) | C·Prod | N | U | B,O | F | GOD-4 |
| `github_account_export_delete` | Delete a finished export archive from GitHub; cannot be undone (uses your master token when added) | C·D·Prod | N | U | B,O | F | GOD-4 |

## Owner: notifications and gists (`github_notify_*, github_gist_*`) — 7

Card(s): O-7. Source built in PR #205. Notifications require optional classic token (`K`, notifications scope); owner input IN-11 is **not** auto-approved or token-enrolled. Without K, return setup guidance only. All inbox/subscription writes are production-confirmed, user-scoped and journaled. Gists use user authorization (`U`), independently verified owner and bounded file contents. Provider/real-use acceptance awaits separate release and permissions.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `github_notify_list` | Unread (or all) notifications, by repository and reason | — | C | K | Op | R | O-7 built #205; CAP-3 private notifications OAuth reauthorization candidate #274 (live acceptance open) |
| `github_notify_mark` | Mark one thread, a repository or everything as read or done | C·Prod | C | K | Op | E | O-7 built #205 |
| `github_notify_set_subscription` | Watch, ignore or unsubscribe from a thread or repository | C·Prod | C | K | Op | E | O-7 built #205 |
| `github_gist_list` | Chris's gists (uses your master token when added) | — | C | U | B | R | O-7 built #205 |
| `github_gist_get` | One gist's files (size-capped) (uses your master token when added) | — | C | U | B | R | O-7 built #205 |
| `github_gist_save` | Create or update a gist (public gists are access-widening) (uses your master token when added) | C·Prod·A* | C | U | B | E | O-7 built #205 |
| `github_gist_delete` | Delete a gist (uses your master token when added) | C·Prod | C | U | B | F | O-7 built #205 |

## Owner and administration: guided settings (`github_admin_*`) — 3

Card(s): O-1. Every GitHub settings page is in the dashboard map (`src/data/dashboard-map.js`); settings with no API return structured steps from `github_where_is_setting` (contract §11).

O-1 source correction PR #257: user-profile links in both guided entrypoints derive the chosen account's enrolled personal OAuth principal, never its organization name. Unknown/mismatched personal identity returns a null link; navigation and manual-only settings never prove a completed change. The owner guide describes guarded end-user paid and destructive capability accurately instead of importing developer-only spending/deletion restrictions.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `github_admin_list_guided_settings` | Paginate structured repository, organization and user dashboard guides with explicit manual or provider verification | — | N | — | O | R | O-1 built #197/#224 |
| `github_admin_check_setting` | Verify supported organization 2FA directly; unsupported settings explicitly require manual confirmation | — | N | I,U | O | R | O-1 built #197/#224 |
| `github_admin_review_security` | Review bounded enrolled organization access and security findings without misclassifying denied reads as passing | — | N | I,U | O | R | O-1 built #197/#224 |

## Moderation and organization planning objects (`github_comment_*, github_org_issue_*`) — 18

Card(s): Y-5. Acts on text written by other people, so hiding and deleting always ask first and previews quote the text as untrusted data. GraphQL tools reuse the reviewed Y-2 write specs. Issue types and fields are organization-wide: every change asks first and deletes need the exact name and have no undo. Select-field options keep their ids unless named in `removeOptions`.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `github_issue_pin` | Pin an issue to the top of a repository (at most 3) or unpin it | P | N | I | Op,O | F | Y-5 |
| `github_comment_pin` | Pin an issue comment or unpin it | P | N | I | Op,O | F | Y-5 |
| `github_comment_delete` | Delete an issue or review comment (preview shows author and first 120 characters; no undo) | C·D·Prod* | N | I | Op,O | F | Y-5 |
| `github_comment_hide` | Hide a comment (spam, abuse, off topic, ...) or show it again | C | N | I | Op,O | F | Y-5 |
| `github_review_comment_edit` | Edit a pull request review comment | P·M* | N | I | Op,O | F | Y-5 |
| `github_issue_delete` | Permanently delete an issue (admin; optional target confirmation for full owners; no undo) | C·D·Prod | N | I | Op,O | F | Y-5 |
| `github_discussion_manage` | Close, reopen, edit or delete a discussion, or mark an answer | C·D·Prod* | N | I | Op,O | F | Y-5 |
| `github_issue_link_branch` | Create a branch linked to an issue or unlink one | C | N | I | Op,O | F | Y-5 |
| `github_org_list_issue_types` | List a connected organization's issue types with IDs, descriptions, colors and enabled flags; bounded | — | N | I | B,O,Op | R | PAR-2 |
| `github_org_issue_type_save` | Create or edit an organization issue type | C | N | I | O | F | Y-5 |
| `github_org_issue_type_delete` | Delete an organization issue type (optional name accuracy check for full owners; no undo) | C·D·Prod | N | I | O | F | Y-5 |
| `github_org_list_issue_fields` | List connected organization issue fields, types, visibility and select options; bounded | — | N | I | B,O,Op | R | PAR-2 |
| `github_org_issue_field_save` | Create or edit an organization issue field; select options keep their ids | C | N | I | O | F | Y-5 |
| `github_org_issue_field_delete` | Delete an organization issue field and its values (optional name accuracy check for full owners; no undo) | C·D·Prod | N | I | O | F | Y-5 |
| `github_issue_set_fields` | Set organization issue field values on an issue | P·M | N | I | Op,O | F | Y-5 |
| `github_interaction_limit_set` | Limit who may comment or open issues on a repository or organization for a time, or lift it | C | N | I | O | F | Y-5 |
| `github_repo_autolink_save` | Add an autolink reference (key prefix to URL template) to a repository | C | N | I | O | F | Y-5 |
| `github_repo_autolink_delete` | Delete an autolink reference from a repository | C | N | I | O | F | Y-5 |

## Projects v2 lifecycle (`github_project_*`) — 15

Card(s): Y-4. GraphQL only. A project is named by owner and number; GitHub must confirm it belongs to a connected account. Organizations use the installation credential, personal accounts the user sign-in. Deletes need the exact title or are production-class and have no undo. Select-option edits resend every existing option with its id.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `github_project_create` | Create an empty private project board for a connected account, optionally linked to a repository | C | N | I,U | Op,O | F | Y-4 |
| `github_project_update` | Change a project's title, description, readme, visibility or closed state | P·A* | N | I,U | Op,O | F | Y-4 |
| `github_project_copy` | Copy a project (fields, views, optionally draft items) under a new title | C | N | I,U | Op,O | F | Y-4 |
| `github_project_delete` | Delete a project and its items (optional title accuracy check for full owners; no restore) | C·D·Prod | N | I,U | O | F | Y-4 |
| `github_project_link` | Link or unlink a project to a repository or team | C | N | I,U | Op,O | F | Y-4 |
| `github_project_field_save` | Create or edit a project field; select options keep their ids unless removed by name | C | N | I,U | Op,O | F | Y-4 |
| `github_project_field_delete` | Delete a custom field and its values (preview counts items holding a value) | C·D·Prod | N | I,U | O | F | Y-4 |
| `github_project_view_save` | Add a table, board or roadmap view, or delete a view | C·Prod* | N | I,U | Op,O | F | Y-4 |
| `github_project_add_draft` | Add a draft item, optionally assigned | C·M* | N | I,U | Op,O | F | Y-4 |
| `github_project_convert_draft` | Turn a draft item into an issue in a connected repository | C | N | I,U | Op,O | F | Y-4 |
| `github_project_archive_item` | Archive or restore a project item | P | N | I,U | Op,O | F | Y-4 |
| `github_project_move_item` | Move an item to the top or after another item | P | N | I,U | Op,O | F | Y-4 |
| `github_project_clear_field` | Clear one field value on an item | P | N | I,U | Op,O | F | Y-4 |
| `github_project_delete_item` | Remove an item from a project (values lost; no undo) | C·D·Prod | N | I,U | Op,O | F | Y-4 |
| `github_project_status_update` | Post a project status update (on track, at risk, ...) | C·M | N | I,U | Op,O | F | Y-4 |

## Public profiles, following and star lists (`github_user_*, github_public_*, github_repo_watch, github_star_*`) — 13

Card(s): Y-3. Reads are GET-only through an allowlist, use the user sign-in when present, mark free text untrusted and answer the same for private and missing repositories. Writes act as the signed-in user (`U`).

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `github_user_get` | Read any public user or organization profile: name, bio, counts, links (free text untrusted) | — | N | I,U | B,O,Op | R | Y-3 |
| `github_user_list_repos` | List a user's or organization's public repositories | — | N | I,U | B,O,Op | R | Y-3 |
| `github_user_list_social` | Social links on a public profile | — | N | I,U | B,O,Op | R | Y-3 |
| `github_user_list_followers` | Public followers of a user or organization | — | N | I,U | B,O,Op | R | Y-3 |
| `github_user_list_following` | People a user publicly follows | — | N | I,U | B,O,Op | R | Y-3 |
| `github_public_repo_get` | A public repository of any account with a capped README excerpt | — | N | I,U | B,O,Op | R | Y-3 |
| `github_public_repo_list` | Contents, releases, issues or pull requests of any public repository (untrusted text) | — | N | I,U | B,O,Op | R | Y-3 |
| `github_repo_list_stargazers` | The people who starred a PUBLIC repository, with the total and optionally when each starred | — | N | I,U | B,O,Op | R | PAR-1 built |
| `github_star_list_get` | Your own star lists with their repositories (uses your master token when added) | — | N | U | Op,O | R | Y-3 |
| `github_user_follow` | Follow or unfollow a user or organization as you (uses your master token when added) | P·M* | N | U | Op,O | E | Y-3 |
| `github_repo_watch` | Watch, ignore or stop watching a repository as you (uses your master token when added) | P | N | U | Op | E | Y-3 |
| `github_user_set_social` | Add or remove https links on your public profile (max 4) (uses your master token when added) | C·Prod·A | N | U | O | F | Y-3 |
| `github_star_list_manage` | Create, edit or delete a star list, or put a repository into lists (uses your master token when added) | C·D | N | U | Op,O | F | Y-3 |

## Project profiles (`github_profile_*`) — 3

Card(s): P-1 … P-3. P-1 implementation in PR #206: additive, versioned known_projects persistence, two seeded policies and actual guard integration. These are read-only user tools, not granted GitHub write authority. Optional (docs/designs/BATCH-P.md). The readiness and setup workflows are listed under Workflows.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `github_profile_list` | Project profiles the server knows (Appliance Desk, the Robinson servers, drafts) | — | N | — | B,O | R | P-1 built #206 |
| `github_profile_get` | One profile: repos, production branches and environments, required checks, workflows with write access, owned settings | — | N | — | B,O | R | P-1 built #206 |
| `github_profile_draft` | Turn what an agent found in a codebase (workflows, branches, environments, required checks) into a draft profile and APP-NEEDS text | — | N | — | B,O | R | P-3 built #209 |

## Workflows (`github_workflow_*`) — 18

Card(s): P-2, P-3, W-1 … W-7. P-2 built in PR #207 as a non-read-only composed workflow: inspection is read-only, but a single explicitly named repair invokes an existing independently guarded write. Never claim unverified process rows or unreadable provider settings are healthy. Whole jobs in one call, answered in plain English with `structuredContent` (`docs/designs/BATCH-W.md`). W-3/W-4 add verified review disposition and CI recovery workflows; their genuine deployed acceptance remains queued. W-1 and W-2 were implemented together in PR #210; status is read-only, while open/merge workflows delegate to the existing journaled and independently guarded writers. A staged PR open or stack progresses one write at a time and requires a fresh call for the next step.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `github_workflow_pr_status` | Everything about a PR in one answer: CI at head (required vs optional), mergeable, review decision, unresolved threads, stack position, next action | — | N | I | B,Op | R | W-1 built #210 |
| `github_workflow_open_pr` | Idempotently find an existing PR from bounded normalized head/base inventory without duplicating it; create only through guarded writer, then add missing labels separately | P·M | N | I | B | E | W-1 built #210 |
| `github_workflow_merge_when_green` | Merge at the exact head SHA only when required checks are green there and no review thread is unresolved; otherwise says what is missing | C·Prod* | F | I | B | E | W-2 built #210 |
| `github_workflow_merge_stack` | Merge a stack bottom-up: retarget each PR to the default branch, require fresh green CI at its head, merge; stops at the first PR that is not ready | C·Prod* | N | I | B | E | W-2 built #210 |
| `github_workflow_review_threads` | Unresolved review threads with file context; after fixes, reply and resolve each one verified at the current head | P·M | N | I | B | E | W-3 built #214 |
| `github_workflow_merge_automation_status` | Read GitHub-native auto-merge arming, connection-scoped exact-head receipt where known, and pending CI/review constraints; do not infer arming from mergeability | — | N | I | B,Op | R | C-14 #433 |
| `github_workflow_ci_failure_summary` | Diagnose actual head-specific CI runs: failed jobs, steps, errors, annotations and matching default-branch failures; zero/capped runs never count as a completed diagnosis | — | N | I | B,Op | R | W-4 built #214 |
| `github_workflow_rerun_failed_ci` | Re-run only failed jobs once; refuses a second automatic re-run of the same failure (two-strikes rule) | P | N | I | B,Op | E | W-4 built #214 |
| `github_workflow_repo_health` | Protection and rules, CI pass rate, open PRs and staleness, security alerts, secret scanning/push protection, Actions settings | — | F | I | O,Op | R | W-5 built #217 |
| `github_workflow_security_review` | Open alerts across an org or account by severity, features off, push protection bypasses | — | F | I | O | R | W-5 built #217 |
| `github_workflow_access_review` | Who can reach what: members, outside collaborators, teams, deploy keys, apps, fine-grained tokens; flags anything unusual | — | N | I | O | R | W-5 built #217 |
| `github_workflow_release` | Cut a release from a tag or branch head with generated notes; draft first, publish with confirm | C·Prod·M | F | I | B | F | W-6 built #217 |
| `github_workflow_cleanup_branches` | Branches whose PR merged or closed (merge-commit and squash both detected), never default/protected/profile branches; preview then confirm | C | F | I | B,Op | E | W-6 built #217 |
| `github_workflow_new_repo` | Create a repository the standard way: default branch, ruleset requiring `ci`, secret scanning and push protection, merge commits only, delete branch on merge | C·A* | N | I | B,O | F | W-7 built #218 |
| `github_workflow_find` | Find anything from plain words: repo, PR, issue, run, release, commit | — | N | I | Op | R | W-7 built #218 |
| `github_workflow_weekly_digest` | Seven complete UTC billing days, with Denver dates: merged PRs, CI failure rate, open alerts, pending invitations and verified actual Actions/Copilot billed usage; incomplete or mismatched bills stay unknown, never guessed $0 | — | N | I,U | O,Op | R | W-7 built #218 |
| `github_workflow_app_readiness` | Is GitHub set up for a profiled project (or an inline spec)? Each row done / fixed with confirm / needs you (steps) / needs a decision | P | N | I | B,O | R | P-2 built #207 |
| `github_workflow_project_setup` | Set up GitHub for a new project from a short description: repo, rules, environments, labels, security features; idempotent | C·A* | N | I | B,O | F | P-3 built #209 |

## Batch Y-9d financial and Copilot operations (`github_y9_*`) — 17

Y-9d is approved by IN-16. Every mutating call uses the existing production, pass, permission, protection, confirmation, cost and journal gates. Hosted-runner creation and agent task starting use supported GitHub APIs under delegated user authority, a truthful unbounded future metered cost warning and ordinary protected writes; no developer TEST acceptance spends money. Genuine live acceptance is tracked separately.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `github_copilot_agent_policy_get` | Read selected/none/all cloud-agent access state | — | N | I | O,Op | R | Y-9 |
| `github_copilot_agent_policy_set` | Change Copilot cloud-agent organization repository access with a metered-use warning for expansion | C·Prod·A* | F | I | O | F | Y-9 |
| `github_copilot_agent_repos_list` | Read verified selected repositories allowed for Copilot cloud agent | — | N | I | O,Op | R | Y-9 |
| `github_copilot_agent_repo_set` | Allow or deny individual organization repositories for Copilot cloud agent, with authorization | C·Prod·A* | F | I | O | F | Y-9 |
| `github_copilot_content_exclusions_get` | Read current Copilot excluded repository paths | — | N | I | O,Op | R | Y-9 |
| `github_copilot_content_exclusions_set` | Replace Copilot exclusions with guarded readback and access-change warning | C·Prod·A* | F | I | O | F | Y-9 |
| `github_copilot_team_seats` | Assign actual team seats with known quoted pricing or disclosed unknown recurring charges and confirmation | C·Prod·A*·$ | F | I | O | F | Y-9 |
| `github_copilot_team_seats_remove` | Remove team-assigned seats without requiring permission to spend | C·Prod | F | I | O | F | Y-9 |
| `github_sponsor_get` | Read verified sponsorship relationship and published tiers | — | N | U | O | R | Y-9 |
| `github_sponsor_set` | Start a priced sponsorship from verified GitHub tier with spend guard | C·Prod·A*·M*·$ | F | U | O | F | Y-9 |
| `github_sponsor_change` | Cancel a sponsorship or change email/privacy preferences without new spending | C·Prod·A* | F | U | O | F | Y-9 |
| `github_hosted_runner_list` | Read GitHub-hosted runner pools, concurrency, size and capacity | — | N | I | O,Op | R | Y-9 |
| `github_hosted_runner_manage` | Rename, reduce concurrency or remove hosted runner, verified | C·Prod | F | I | O | F | Y-9 |
| `github_hosted_runner_create` | Create a real hosted-runner pool with cost exposure warning and user authorization | C·Prod·$ | F | I | O | F | Y-9 |
| `github_hosted_runner_scale_up` | Increase hosted-runner capacity with metered usage notice and confirmed delegated authority | C·Prod·$ | F | I | O | F | Y-9 |
| `github_copilot_agent_tasks` | Read authorized cloud-agent tasks from GitHub | — | N | U | B,O,Op | R | Y-9 |
| `github_copilot_agent_task_start` | Launch authorized metered Copilot coding-agent task with usage warning and U credential | C·Prod·$ | F | U | B,O | F | Y-9 |

## Everything else on GitHub: the universal tools (`github_api_*, github_graphql_*`) — 6

Card(s): U-1, U-2.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `github_api_search` | Find REST operations by plain words: method, path, summary, and whether it reads, writes, is production, widens access, notifies people or spends | — | N | — | B,O,Op | R | U-1 built #219 |
| `github_api_describe` | Parameters for one operation, trimmed, from GitHub's own description at the pinned version | — | N | — | B,O,Op | R | U-1 built #219 |
| `github_api_read` | Any eligible pinned GET; Enterprise slug reads require explicit M and current provider-verified enterprise-admin membership | — | N | I,U,P,M | B,O,Op | R | U-1 (PAR-4) |
| `github_api_write` | Execute eligible pinned non-curated REST writes; Enterprise slug writes require explicit M, provider-verified admin and current scope; unknown cost needs confirmation/user-cap checks | C·$*·Prod*·A*·M* | N | I,U,P,M | B,O,Op | F | U-1 (PAR-4) |
| `github_graphql_read` | Pinned-schema validated single GraphQL query, typed variables, scoped aliases/fragments/nodes and 500-point/500,000-node cap before sending | — | N | I,U | B,O,Op | R | U-2 built #220 |
| `github_graphql_write` | One reviewed GraphQL mutation (24 specs: pins, locks, minimize, discussions, linked branches, issue comments and delete, draft state, team review assignment; plus the legacy title and project-field shapes) with ownership proof, before/after read, owner-authorized journal and a recorded undo where one exists | C·Prod·A·M | N | I,U | B,O,Op | F | U-2 built #220 |

How `github_api_write` and `github_graphql_write` stay safe (`docs/designs/BATCH-U.md`):

- **Always `confirm: true`**, `dryRun` supported; the preview names the operation in plain words, the exact
  parameters, and the object as it is now when the path names one.
- **Only what GitHub describes.** Every request is checked against the vendored OpenAPI description (REST) or the
  vendored schema (GraphQL) at the pinned version; unknown operations, parameters or fields are refused in words.
- **Classification table** (`src/github/operation-classes.js`): production, access-widening, notifies-people and spend
  marks for every operation, seeded from GitHub's own `x-github.triggersNotification` flags and the guard rules of
  B-2/B-4. **An unlisted operation that creates, deletes, transfers, invites, enables, assigns seats or changes
  settings is treated as production + access-widening until classified** — the safe default.
- **Hand-built tools win**: if a hand-built tool covers the operation, the universal tool refuses and names it.
- **Enterprise permission parity (PAR-4):** only pinned `/enterprises/{enterprise}/...` routes with explicit `cred:M`, valid slug and current GitHub ADMIN membership verified through `requireEnterprise` can run. Reads require `read:enterprise`, writes `admin:enterprise`, full/PRODUCTION confirmation and the user's actual spending policy. These routes are NOT available to App-only, foreign, read-only or delegated-pass contexts. When GitHub publishes no matching GET, a 2xx write receipt remains **unconfirmed**.
- **Never** `bypass_rules` (except GOD-6's deliberate `overrideRules` on the merge and file-write tools), never a secret value in a request (secret endpoints are refused; use `github_secret_set`), never
  a raw credential in a result.
- **What the universal tools cannot do (Y-1, stated plainly).** They act only on accounts this connection owns (a
  person or organization that is not enrolled is refused; following, starring and reading other accounts are Y-3).
  They send and receive JSON only: no raw/binary media types, custom headers, other base URLs or uploads (Y-8).
  A write whose route text matches a spend word (runners, retention, deployments, pages, packages, codespaces, Copilot,
  billing, code security, Marketplace) is refused with the spend message unless that exact route is in the reviewed
  free list (`src/github/spend-classes.js`: self-hosted runner and runner-group administration, OIDC customisation,
  deployment approvals, package delete/restore, Pages rebuild, artifact-metadata records). Hosted runners, retention
  and storage limits, Codespaces, Copilot and code-security configurations stay blocked because their cost cannot be
  computed. Gist routes (`/gists/*`) have no `/user` prefix, so they need the user credential (`cred: U`); the default
  installation credential cannot reach them. GraphQL writes are limited to the reviewed mutation specs in `src/github/graphql-writes.js`
  (Y-2: pinIssue/unpinIssue, pinIssueComment/unpinIssueComment, lockLockable/unlockLockable, minimizeComment/unminimizeComment,
  closeDiscussion/reopenDiscussion, updateDiscussion, updateDiscussionComment, deleteDiscussion, deleteDiscussionComment,
  markDiscussionCommentAsAnswer/unmark…, convertPullRequestToDraft/markPullRequestReadyForReview, createLinkedBranch/
  deleteLinkedBranch, updateIssueComment, deleteIssueComment, deleteIssue, updateTeamReviewAssignment) and the two legacy shapes
  (a string `title` change, one ProjectV2 field value). Any other mutation is refused with "use the specialised tool".
- Same production guard, self-protection, profile ownership, change log, read-back (`confirmed: null` when nothing
  can be read back), passes need `allow_writes`, `full` profile only.

## Things GitHub has no API for

Handled by `github_where_is_setting` with structured steps and, where GitHub lets the value be read, a read-back
(`github_admin_check_setting`); never faked: requiring two-factor authentication for an organization; SAML single sign-on
(Enterprise Cloud); changing the plan or buying seats for the plan; buying Marketplace apps; personal password, passkeys
and recovery codes; creating a GitHub App or OAuth app by hand (the setup page uses the manifest flow instead);
OAuth app access policy; fine-grained token policy for the organization; Copilot policies at the personal level;
notification email routing; the personal security log; Sponsors; deleting the organization or the account; transferring
an organization; scheduled reminders; interaction limits beyond 6 months. The full page-by-page map is built in O-1.

## Self-hosted runners and Actions administration (`github_runner_*, github_actions_set_limits`) — 12

Card(s): Y-6. Runner registration, removal and just-in-time tokens are sealed in the one-time store: the tool returns only the private setup-page address, never the token. Letting public repositories use a self-hosted runner is off by default and asks first with a plain warning. A busy runner is never removed. Raising a cache, size or artifact/log limit counts as spend (cost cannot be calculated) and is blocked while the spend limit is $0. `github_deploy_review_pending` is not built: `github_actions_review_pending_deployment` already does it.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `github_runner_list` | List self-hosted runners or runner groups of an organization or repository | — | N | I | B,O,Op | R | Y-6 |
| `github_runner_get` | One runner (status, busy, labels) without any token | — | N | I | B,O,Op | R | Y-6 |
| `github_runner_remove` | Remove a self-hosted runner from GitHub (busy runners refused) | C·Prod | N | I | O | F | Y-6 |
| `github_runner_set_labels` | Replace the custom labels of a runner | C | N | I | O | F | Y-6 |
| `github_runner_group_save` | Create or edit an organization runner group; public repositories or all repositories ask first | C·A | N | I | O | F | Y-6 |
| `github_runner_group_delete` | Delete a runner group (name typed; no undo) | C·Prod | N | I | O | F | Y-6 |
| `github_runner_group_set_access` | Set which repositories and runners belong to a group | C·A | N | I | O | F | Y-6 |
| `github_runner_register` | Registration, removal or JIT token, revealed once on the private setup page | C·A·Prod | N | I | O | F | Y-6 |
| `github_actions_set_limits` | Set cache retention, cache size, artifact/log retention or the OIDC subject template (raising storage is spend) | C·$ | N | I | O | F | Y-6 |
| `github_env_protection_rule_save` | Add or disable a custom deployment protection rule (only listed apps) | C·Prod* | N | I | O | F | Y-6 |
| `github_deploy_review_custom_rule` | Approve or reject a deployment waiting on a custom rule (only the owning App) | C·Prod | N | I | O | F | Y-6 |
| `github_pages_build_request` | Request a Pages rebuild | P | N | I | Op,O | F | Y-6 |

## Security writes (`github_security_advisory_*, github_security_config_*`) — 12

Card(s): Y-7. Advisory text never appears in a result or the change log (only a SHA-256); publishing is public and irreversible and needs the GHSA id typed twice. Paid security features on private repositories are refused, not priced: code scanning default setup refuses private repositories and a configuration with paid settings only attaches to public repositories (`docs/DECISIONS.md` 2026-10-16). Not built: push-protection bypass review and advisory private forks (no route in the pinned description), and autofix (waits for the Y-8 jobs table).

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `github_security_advisory_save` | Create a draft security advisory or edit one (text stays private; results show only a hash) | P·Prod*·M* | N | I | O | F | Y-7 |
| `github_security_advisory_publish` | Publish a draft advisory: PUBLIC, no undo, optional GHSA accuracy check for full owners | C·Prod | N | I | O | F | Y-7 |
| `github_security_advisory_request_cve` | Request a CVE for an advisory (cannot be withdrawn) | C·Prod | N | I | O | F | Y-7 |
| `github_security_report_vulnerability` | Privately report a vulnerability to another repository as you | C·M | N | U | O | F | Y-7 |
| `github_security_code_scanning_default_setup` | Configure or disable code scanning even on paid private repos with actual user consent and unknown-cost disclosure | C·$*·Prod | N | I | O | F | Y-7 |
| `github_security_secret_pattern_save` | Create, edit or delete a custom secret-scanning pattern for an organization or repository | C·Prod* | N | I | O | F | Y-7 |
| `github_security_dependabot_org_settings` | Set which repositories Dependabot may read and the default access level | C·A | N | I | O | F | Y-7 |
| `github_security_config_save` | Create or edit provider-verified org code-security configurations across cursor-paginated inventories, including 100+ private paid repositories; full nested/enforcement readback and informed consent | C·$*·Prod* | N | I | O | F | Y-7 |
| `github_security_config_attach` | Attach code-security configurations, including private paid targets with uncapped-price notice and user cap enforcement | C·$*·Prod | N | I | O | F | Y-7 |
| `github_security_config_default` | Choose security defaults for future public/private repos, including billed features with clear future-cost warning | C·$*·Prod | N | I | O | F | Y-7 |
| `github_security_config_detach` | Detach the configuration from named repositories | C·Prod | N | I | O | F | Y-7 |
| `github_security_config_delete` | Delete a verified configuration (exact name, no undo) only with complete cursor-paginated attached-repository inventory; unreadable/capped lists never silently count as empty | C·Prod | N | I | O | F | Y-7 |

## Background jobs, archives and autofix (`github_job_*, github_artifact_read, github_content_read_archive, github_security_*sbom*, github_code_scanning_autofix_*`) — 9

Card(s): Y-8. A slow GitHub operation returns a `job_id` at once; `github_job_status` asks GitHub once per call (not more than every 10 seconds) and never waits, and the finished result is kept as an ordinary result handle. Artifacts and repository snapshots are opened on the server (50 MB zipped, 200 MB unpacked, 500 files, no unsafe names or links); binary files show only name, size and SHA-256 and the signed download address is never returned. `github_release_upload_asset` also accepts a build artifact (`artifactId`, optional `entry`) as its source. Wiki editing is in its own section below.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `github_job_status` | Check a slow job you started (pending, ready with a result handle, or failed) | — | N | — | B,Op | R | Y-8 |
| `github_job_cancel` | Stop tracking a pending slow job | P | N | — | B,Op | F | Y-8 |
| `github_artifact_read` | List the files of a build artifact or read one text file | — | N | I | B,Op | R | Y-8 |
| `github_content_read_archive` | List or read files inside a repository snapshot at a ref | — | N | I | B,Op | R | Y-8 |
| `github_content_snapshot` | Pin an exact GitHub commit and return a tenant-scoped ZIP result handle for binary byte windows and checksum verification | — | N | I | B,Op | R | C-13 |
| `github_security_export_sbom` | The software parts list (SBOM) of a repository | — | N | I | B,Op | R | Y-8 |
| `github_security_sbom_report_start` | Ask GitHub to build an SBOM report in the background (job) | — | N | I | B,Op | R | Y-8 |
| `github_code_scanning_autofix_start` | Ask GitHub to suggest a fix for a code scanning alert (job) | P | N | I | B,Op | F | Y-8 |
| `github_code_scanning_autofix_commit` | Commit a ready suggested fix to a named branch | C·Prod* | N | I | B,Op | F | Y-8 |

## Wiki (`github_wiki_*`) — 3

Card(s): Y-8 (WU-Y8d), owner decision IN-17 = yes (2026-10-16). GitHub has no wiki API, so the server speaks git to `<repo>.wiki.git` in memory only (`isomorphic-git` + `memfs`, pinned), through the injected fetch: only that path on github.com is reachable, redirects are refused, the installation token is the HTTP password and never appears in a URL, result or log. Limits: 200 pages, 5 MB, 1 MB per page, 20 MB transfer. The first page of a new wiki must be saved in the browser (guide `repo-wiki-edit`).

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `github_wiki_list` | List the pages of a repository wiki with sizes | — | N | I | B,Op | R | Y-8 |
| `github_wiki_read` | Read one wiki page (text capped, SHA-256 of the whole) | — | N | I | B,Op | R | Y-8 |
| `github_wiki_write` | Create or replace a wiki page (one commit pushed; result shows size and hash, not text) | C | N | I | B,Op | F | Y-8 |

## Organization administration extras (`github_org_security_manager_set, github_org_network_config_*, github_org_migration_*`) — 5

Card(s): Y-9 (WU-Y9a). Organization-level, so every write is production-class and confirmed. Network configurations need Enterprise Cloud and answer `not_available_on_plan` otherwise. A migration archive holds private data: the server never downloads or relays it (status points to the browser download). `github_credential_report_leak` is not built (the endpoint receives the secret itself; a guide covers revoking on github.com).

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `github_org_security_manager_set` | Give a team the organization security manager role, or remove it | C·Prod·A | N | I | O | F | Y-9 |
| `github_org_network_config_list` | List fully paginated hosted-compute network configurations (Enterprise Cloud); preserve exact GitHub permission/plan errors | — | N | I | O,Op | R | Y-9 |
| `github_org_network_config_save` | Create or edit a hosted-compute network configuration, verifying primary and failover resource IDs after a guarded write | C·Prod | N | I | O | F | Y-9 |
| `github_org_migration_start` | Start exporting organization repositories (locking is opt-in) (uses your master token when added) | C·Prod | N | I | O | F | Y-9 |
| `github_org_migration_status` | State of an organization migration and where to download the archive (uses your master token when added) | — | N | I | O,Op | R | Y-9 |

## CAP-4 governed organization and App JWT lifecycle (`github_org_audit_read, github_org_scim_*, github_org_saml_*, github_app_*`) — 15

Card(s): CAP-4. Read-only, account-bound organization audit and SAML-SSO SCIM identity visibility. Cursor output is verified against exact GitHub.com organization and SCIM equality filters are constrained to provider-documented fields. GitHub plan/role/SSO/permission is verified by provider; 403/404 are not guessed plan limitations. Enterprise-managed-user SCIM and enterprise audit are distinct unresolved authority paths. Each page is bounded; SCIM emails and raw audit fields are not echoed.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `github_org_audit_read` | Read an exact enrolled organization's bounded, projected audit page with optional cursor | — | N | I | O | R | CAP-4 |
| `github_org_scim_list` | Read a paginated organization SCIM identity summary and report incomplete inventory | — | N | I | O | R | CAP-4 |
| `github_org_scim_get` | Read one matching organization SCIM identity without raw private provider fields | — | N | I | O | R | CAP-4 |
| `github_org_scim_provision` | Provision and invite a precise SAML organization identity, preserving provider-specific prior privileges notices | C·Prod·A·M | N | I | O | F | CAP-4 |
| `github_org_scim_set_display_name` | Change one exact SCIM display name with retained-identity readback | C·Prod | N | I | O | F | CAP-4 |
| `github_org_scim_deprovision` | Deprovision exact identity and organization membership after independent absence readback | C·D·Prod | N | I | O | F | CAP-4 |
| `github_org_saml_authorizations` | List one bounded SAML SSO authorizations page with sensitive token metadata suppressed | — | N | I | O | R | CAP-4 |
| `github_org_saml_revoke_authorization` | Revoke one exact SAML SSO credential ID with confirmed provider absence | C·D·Prod | N | I | O | F | CAP-4 |
| `github_app_owner_identity` | Check the exact stored owner App identity using JWT-only GET /app without returning credentials | — | N | JWT | O | R | CAP-4 |
| `github_app_owner_installation_grants` | Verify JWT-only enrolled installation permission/event grants against exact provider App and account identity | — | N | JWT | O | R | CAP-4 |
| `github_app_owner_installation_requests` | Inspect only selected account’s pending App installation requests from a bounded JWT-only global feed | — | N | JWT | O | R | CAP-4 |
| `github_app_webhook_configuration` | Inspect owned App webhook host/TLS/content type; omit signing secret and URL credentials | — | N | JWT | O | R | CAP-4 |
| `github_app_webhook_deliveries` | Inspect exact enrolled App installation deliveries, suppress bodies, headers and other tenants | — | N | JWT | O | R | CAP-4 |
| `github_app_webhook_configuration_set` | Change exact owner App HTTPS webhook destination or content type through confirmed, journaled JWT-only write | C·Prod·A·M | N | JWT | O | F | CAP-4 |
| `github_app_webhook_redeliver` | Redeliver an exact owned App webhook event; only confirm a distinct provider-observed retry, never HTTP 202 alone | C·Prod·M | N | JWT | O | F | CAP-4 |

## GitHub Enterprise (`github_enterprise_*`) — 16

Card(s): ENT-1. Every tool uses the person's **master token** (credential `M`, with enterprise permissions) and only for an enterprise the person administers (`github_enterprise_list`); nothing is sent for any other slug. Not available on read-only connections or passes. Writes are always production-class and confirmed, and are read back from GitHub. Not built: the Copilot coding-agent policy write, because GitHub's description has no operation that reads that policy back; it stays reachable through the universal REST tool. Membership changes (admins, members, organizations) are not in this set.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `github_enterprise_list` | List the GitHub Enterprises you administer (slug and name) | — | N | M | O | R | ENT-1 |
| `github_enterprise_overview` | Name, created date, admins, member count and organizations of an enterprise you administer | — | N | M | O | R | ENT-1 |
| `github_enterprise_security_configs` | Read enterprise code-security configurations, their defaults, one configuration, or its repositories | — | N | M | O | R | ENT-1 |
| `github_enterprise_dependabot` | Read enterprise Dependabot alerts (untrusted text) or which repositories Dependabot may access | — | N | M | O | R | ENT-1 |
| `github_enterprise_copilot_metrics` | Read an enterprise Copilot usage report (1-day or latest 28-day) | — | N | M | O | R | ENT-1 |
| `github_enterprise_actions_settings` | Read enterprise Actions cache limits and OIDC custom-property inclusions | — | N | M | O | R | ENT-1 |
| `github_enterprise_security_config_save` | Create or edit an enterprise code-security configuration; paid features carry a future-cost warning; full read-back | C·$*·Prod | N | M | O | F | ENT-1 |
| `github_enterprise_security_config_delete` | Delete an enterprise code-security configuration (exact name, no undo); read-back proves it is gone | C·Prod | N | M | O | F | ENT-1 |
| `github_enterprise_security_config_apply` | Attach a configuration to all repositories, or set which new repositories get it by default | C·$*·Prod | N | M | O | F | ENT-1 |
| `github_enterprise_dependabot_access_set` | Change Dependabot's default repository access level, or add or remove repositories it may access | C·A·Prod | N | M | O | F | ENT-1 |
| `github_enterprise_actions_settings_set` | Change one enterprise Actions setting: cache retention, cache storage limit, or an OIDC custom property | C·Prod | N | M | O | F | ENT-1 |
| `github_enterprise_policy_set` | Change enterprise two-factor, IP allow-list, deploy-key, repository creation or member policy; provider-admin proof and readback | C·$·A·Prod | N | M | O | F | GQL-1 |
| `github_ip_allowlist_list` | Page verified organization or enterprise IP allow-list entries with honest cursors | — | N | I,M | O | R | GQL-1 |
| `github_ip_allowlist_save` | Create or update an exact owner IP entry, preserving omitted values and confirming readback | C·A·Prod | N | I,M | O | F | GQL-1 |
| `github_ip_allowlist_delete` | Delete a verified owner IP entry and independently confirm absence | C·D·A·Prod | N | I,M | O | F | GQL-1 |
| `github_enterprise_profile_set` | Edit the enterprise profile: name, description, location, website or security contact email; read back | C·Prod | N | M | O | F | GQL-1 |

## Master-token families: Copilot Spaces, Classroom, Marketplace and more (`github_copilot_space_*, github_classroom_*, ...`) — 17

Card(s): GOD-4 (part B). Every tool here uses your master token (the permission named in the tool), and answers in plain words when it is missing. Copilot Spaces are your own (`{username}` is always the token's owner). GitHub has closed the Classroom service, so those four reads usually answer "not available" honestly. Not built here: `github_credential_revoke` (needs its own protected one-use token page; listed as the remaining part of GOD-4).

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `github_copilot_space_list` | List your Copilot Spaces (uses your master token) | — | N | U | B,O | R | GOD-4 |
| `github_copilot_space_get` | One Space with collaborators and resources (uses your master token) | — | N | U | B,O | R | GOD-4 |
| `github_copilot_space_collaborators` | Who can use a Space and their role (uses your master token) | — | N | U | B,O | R | GOD-4 |
| `github_copilot_space_resources` | Resources attached to a Space, or one by id (uses your master token) | — | N | U | B,O | R | GOD-4 |
| `github_copilot_space_save` | Create or edit one of your Spaces (uses your master token) | C·Prod | N | U | B,O | F | GOD-4 |
| `github_copilot_space_delete` | Delete a Space; cannot be undone (uses your master token) | C·D·Prod | N | U | B,O | F | GOD-4 |
| `github_copilot_space_set_collaborator` | Give a person or team a role on a Space (uses your master token) | C·Prod·A | N | U | B,O | F | GOD-4 |
| `github_copilot_space_remove_collaborator` | Remove a person or team from a Space (uses your master token) | C·Prod | N | U | B,O | F | GOD-4 |
| `github_copilot_space_set_resource` | Attach or change a Space resource (uses your master token) | C·Prod | N | U | B,O | F | GOD-4 |
| `github_copilot_space_remove_resource` | Detach a resource from a Space (uses your master token) | C·Prod | N | U | B,O | F | GOD-4 |
| `github_classroom_list` | Your Classrooms (GitHub closed the service; usually "not available") (uses your master token) | — | N | U | O | R | GOD-4 |
| `github_classroom_get` | One Classroom (usually "not available") (uses your master token) | — | N | U | O | R | GOD-4 |
| `github_classroom_assignments` | A Classroom's assignments (usually "not available") (uses your master token) | — | N | U | O | R | GOD-4 |
| `github_classroom_grades` | An assignment's grades (usually "not available") (uses your master token) | — | N | U | O | R | GOD-4 |
| `github_marketplace_listing` | Marketplace plans/accounts of an App you own, else honest "not available" (uses your master token) | — | N | U | O | R | GOD-4 |
| `github_user_hovercard` | A user's public hovercard facts, optionally in a context (uses your master token) | — | N | U | B,O | R | GOD-4 |
| `github_project_view_create` | Create a view on one of your user projects (uses your master token) | C·Prod | N | U | B,O | F | GOD-4 |

## Code quality and GitHub help (`github_code_quality_*, github_docs_search`) — 4

Card(s): PAR-1. Code Quality findings come from GitHub's own analysis (not marked untrusted); a 404/403 answers in plain words that the feature is not on or not visible. Setup scans may use Actions minutes, so turning it on is a `$*` change that warns the future cost is not capped. `github_docs_search` calls only `docs.github.com` search, sends no credential and nothing about the person, and is the one deliberate exception to "GitHub only through `src/github/client.js`".

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `github_code_quality_list` | Code Quality findings (maintainability and reliability) in a repository, open or dismissed, with a cursor for more | — | N | I | B,O,Op | R | PAR-1 built |
| `github_code_quality_get` | One finding by number, or with `setup: true` the repository's Code Quality setup | — | N | I | B,O | R | PAR-1 built |
| `github_code_quality_setup` | Turn Code Quality on or off for a repository, or change languages, runner or AI findings; read back; undo restores the previous setup | C·$*·Prod | N | I | O | F | PAR-1 built |
| `github_docs_search` | Search GitHub's own help pages (docs.github.com): titles, links, short snippets; no credential | — | N | — | B,O,Op | R | PAR-1 built |

## Totals

**Totals:** 491 tools: 485 hand-built + 6 universal (`github_api_*`, `github_graphql_*`), plus guided settings for every
dashboard-only owner setting. By profile (lowest profile that has the tool): read_only 158, everyday adds 83
(everyday lists 240), full adds 113 (full lists 396). In compact mode (`docs/designs/BATCH-C.md`) an agent
loads only about 25 tools up front (meta-tools, whoami, universal search, workflows) and reaches the rest through
`github_search_tools` / `github_call`.

| Section | Tools |
| --- | --- |
| Server about itself | 25 |
| Repositories | 22 |
| Files, commits and git data | 23 |
| Branches and tags | 9 |
| Pull requests | 15 |
| Reviews and review threads | 10 |
| Issues | 15 |
| Labels and milestones | 7 |
| Discussions, projects and search | 11 |
| Actions: workflows, runs, jobs and logs | 13 |
| Checks, statuses, artifacts and caches | 10 |
| Secrets and variables | 7 |
| Environments and deployments | 10 |
| Releases | 7 |
| Pages and packages | 7 |
| Developer tools | 15 |
| Branch protection and rulesets | 9 |
| Webhooks | 8 |
| Collaborators and deploy keys | 7 |
| Security features and alerts; Actions settings | 11 |
| Owner: organization and members | 13 |
| Owner: teams and roles | 9 |
| Owner: billing, budgets, Copilot and Codespaces | 14 |
| Owner: apps and fine-grained tokens | 7 |
| Owner: personal account | 14 |
| Owner: notifications and gists | 7 |
| Owner and administration: guided settings | 3 |
| Moderation and organization planning objects | 18 |
| Self-hosted runners and Actions administration | 12 |
| Security writes | 12 |
| Background jobs, archives and autofix | 8 |
| Wiki | 3 |
| Organization administration extras | 5 |
| CAP-4 governed organization and App JWT lifecycle | 15 |
| Projects v2 lifecycle | 15 |
| Public profiles, following and star lists | 13 |
| Project profiles | 3 |
| Workflows | 18 |
| Everything else on GitHub: the universal tools | 6 |
| Batch Y-9d financial and Copilot operations | 17 |
| GitHub Enterprise | 16 |
| Master-token families: Copilot Spaces, Classroom, Marketplace and more | 17 |
| Code quality and GitHub help | 4 |
| **Total** | **491** |

<!-- #108: experimental RTC HTTPS reader bridges only server/meta read tools using existing guarded dispatch; RTC 1 certification is not claimed. -->

<!-- #110: RTC pass-issued server/meta reads have persistent immutable no-writes / $0 scopes; large result handle is top-level for Hub SDK. Full RTC 1 remains incomplete. -->

RTC output safety (#143): every canonical tool reply/error uses shared provider/RTC redaction; remaining credential-shaped deep values or keys are refused before result retention. No catalog or grant expansion.

Scratch cleanup: confirmed repository disposal includes unchanged creation-bound initial labels; it never asserts their creator or authorizes standalone default-label deletion. See pr-cards/SCRATCH-CONTAINER-LABELS.md.

Package credential routing: G-6 personal metadata/version/lifecycle tools use the authenticated `/user/packages` namespace with verified enrolled personal actor; organization tools retain `/orgs/{org}/packages`. All org, named-user and authenticated-user package delete/restore routes are curated-first in universal REST and cannot bypass specialized guards. Removal through protected setup does not require decrypting a stored token.

O-1 personal-status read uses genuine enrolled U for GET /user, checks exact stored identity and exposes only id/login plus optional 2FA/plan. Missing/revoked/foreign U remains unreadable, never replaced by I. Omitted personal settings remain unknown; this is not a full personal security review or completion of guided browser controls.

B-5 provider permission hints: only explicit read/write/admin entries are eligible. Permissionless boolean metadata and the known unselectable organization_packages key never become approval instructions. Genuine entries are compared conditionally with actual grants, target access and supported token types; an integration refusal alone does not prove missing owner consent. HTTP/request details and actual denial are retained.


**C-8 request-path latency (source-only until checked release):** `github_whoami` concurrently reads independent enrolled account rate evidence, obtains master-token status once per request and reuses the personal rate lookup. The authenticated tenant MCP provider wrapper buffers coarse, anonymous provider outcome/latency events per HTTP request, then awaits one tenant-isolated PostgreSQL upsert in route cleanup instead of one telemetry write after **every** GitHub HTTP response. It does not cache GitHub checks or permissions, change login/admission controls, skip telemetry, or alter the response/result/guard contract. Synthetic benchmarks are not production latency evidence. See `docs/pr-cards/C-8.md`.

**C-15 credential-scoped GitHub rate observations (#435):** Read, write, and nested responses may have compact `meta.github_rate.items` with observed `account`, credential kind, GitHub resource, remaining budget where not expired, reset time, primary/secondary cooldown and `source` (`fresh` for this operation's headers, `cached` for an existing DB throttle). Unknown rates are omitted. Actual GitHub App, personal login, God Mode, optional package, notifications and U token budgets use independent database keys; no rate-only GitHub calls are added. A composed workflow may report multiple credential/resource observations; never treat a prior quota as current merely because it was cached.

**C-16 guarded sequential write batch (#431):** `github_write_batch` is separate from read-only `github_batch` and executes 1–20 ordered delegated writes per call, with stable `batchKey` and per-step `confirm`/`dryRun`. Prior *confirmed* outputs can be referenced only as bounded safe scalars such as `{"$from":0,"path":"sha"}` for exact-head commit preconditions. PostgreSQL `gh_write_batches` retains a SHA-256 intent and scoped active lease plus only safe per-item receipts, never original source, credentials or raw arguments; completed writes replay without GitHub writes, a stale pending outcome requires explicit reconciliation and a new plan for remaining actions. Each inner writer executes with its original user-delegated authority, profiles, gates, journal and fresh readback. This is not an atomic transaction/rollback. The 20-item and 43-second call bounds are only transport/continuation limits, not account permissions or irreversible caps.

## 2026-10-28 replacement contract update

Large text, lists and object payloads have one full JSON copy in `content[0].text`; compact structured metadata declares `full_payload_location` and `omitted_fields`. Navigation and small status/identity fields remain structured. Nested dispatch and schema-declared outputs retain complete structured data; RTC reconstructs the full canonical payload before its own size checks. Small replies retain compatibility.

`github_content_get` accepts `fullText`, immutable `blobSha` continuation and `branch` as an alias for `ref`. PR reads/writes accept `pull_number` as an alias for canonical `number`; conflicting values fail before provider requests. `github_security_scan_guidance` supplies repo-specific native/official-engine setup and a Robinson repository scanner workflow without claiming installation or equivalent detection.

Owner setup continuation (2026-10-28): merge/PR/release workflows reconstruct declared canonical payloads; guarded merge refusals preserve their status/reason instead of unknown. Owner connection setup and protected secret entry follow the current authority specification; legacy account production flags remain restricted-grant compatibility fields. No new public tool is added in this continuation.
