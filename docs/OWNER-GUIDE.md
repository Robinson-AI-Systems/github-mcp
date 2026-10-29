# Owner guide — what you can ask for

Current release checkpoint: audit/parity and scanner changes are live; switch/concurrency follow-through is verified on `0d752439`. Native Git runs on Render with four simultaneous workspace requests on the same plan; see [capacity proof](status/2026-10-29-native-git-capacity.md). Historical source/daily-release qualifiers below are dated delivery notes, not a current claim those merged tools are unavailable. Consult the latest [live evidence](status/2026-10-28-render-native-git-acceptance.md).

**Repository scanner profiles:** `github_secret_scanner` is the compact direct entry for settings, scan/preview, configure, rollback and profile offers. Each repository has independent settings. Changes require a reason and pinned before/after retests; exact file/finding exceptions are visible and version-bound. [Guide](SECRET-SCANNER.md) explains the baseline, receipts and limits. This is live; [dated acceptance](status/2026-10-28-render-native-git-acceptance.md) records repository tuning, rollback and worker policy tests.


> **Current authority and parity remediation (2026-10-28):** [requirements](OWNER-DECISION-2026-10-27.md), [delivery plan](designs/AUTHORITY-PARITY-2026-10-28.md). Full owner writes disclose/execute/journal/verify in one call; explicit delegated restrictions remain. Older dated statements about owner caps, production ceremony and mandatory merge gates are superseded. Source delivery and live acceptance remain separate.

**Developer workflows (2026-10-28 correction):** A full ordinary owner connection can create/seed/test/inspect/clean developer fixtures in either connection mode. Verified scratch App enrollment, exact run ownership and cleanup origin checks still apply. Explicit delegated/profile restrictions remain; changing connection mode is not required solely to use these tools.

**First-time fork contributors (FORK-CI-1; merged as #420, awaits daily live release):** after reviewing a contributor's PR, the full-profile owner can call `github_actions_approve_fork_run` with the exact PR, reviewed branch SHA, and pending workflow run ID. The MCP checks that the run actually belongs to that PR, including a GitHub-created merge commit, before forwarding approval. GitHub still requires the ordinary CI and review checks for a merge. No expensive/private workflow or production deployment is approved by this tool, and this is not permission to merge outside code without review.

**Owner override parity (C-7, available once normal daily release reaches this merge):** `github_pr_merge` and `github_workflow_merge_when_green` both support `overrideRules:true` plus a clear `overrideReason` and the existing confirmation. When the server detects no listed branch rules, it no longer turns your explicit request into an ordinary merge attempt. GitHub judges whether your personal credential is allowed to bypass a rule. Your explicit saved user policies, exact-head protection and once-only journal remain intact. Report any ordinary action only the official GitHub connector can complete as a parity defect for repair.

**Faster complete PR work (C-6, available after the normal scheduled live release):** creating a standard PR without labels now goes straight through its own already-guarded create tool, which checks for duplicates, verifies the branch, creates at most once, and reads the new PR back. This avoids the outer workflow repeating the same repository and PR lookup. Requested PR labels still use the independent guarded change after creation. For merging, the server can read unrelated PR metadata at the same time, while keeping exact-head CI and review requirements untouched. Speed figures from fake delay benchmarks are not promises of live response time.

**Faster PR checks (C-5, source delivery; live follows scheduled release):** checking an open pull request or asking its combined status can overlap independent CI, review and stack reads rather than unnecessarily waiting on each network call. GitHub protections, exact-head checks and review requirements still decide whether merging is safe. This is not a live speed guarantee; before/after verification starts with a controlled fake-provider benchmark and later the actual deployed client.

**Fast everyday workflow (C-4, available after normal daily live release):** already-authorized routine changes can be requested in a single call without an automatic preview round trip. Ask for a preview if you want one; the server still requests confirmation for risk-sensitive actions. `github_batch` processes up to 10 read-only operations with at most 3 independent reads in flight and returns answers in your original order; changes are never included in read batches. All access, spending, branch and replay safeguards remain in place.

**Everyday development shortcut (C-3, available after the normal daily live release):** the compact connector puts common repository, file, branch, commit, PR, CI and review-reading tools directly in the agent's initial tool list. Agents can call these tools without first searching for their names and loading schemas. This changes visibility only, not the permission/safety checks. Specialist tools remain searchable and the separate Hub interface stays lazy.

Plain-English things to say to Claude once each part is built. Each line names the batch that delivered it; all of these are built now (live acceptance varies per line; see STATUS). This file is updated as features ship. Anything that touches your real `main` branches, releases,
settings, access or spending always shows you a preview and waits for your OK.

| Say something like… | What happens | Batch |
|---|---|---|
| "Which GitHub accounts am I connected to?" | Your accounts, PREVIEW or PRODUCTION, what the server may do, how much GitHub rate budget is left, your spend limit | A/B |
| "What's the state of PR 42?" | CI at the latest commit (which checks are required), mergeable or not, reviews, open review threads, and the next step in one sentence | W |
| "Merge it when it's green." | Merges only if every required check passed on exactly the latest commit and no review thread is open; otherwise says what is missing | E/W |
| "Merge the stack." | Merges stacked PRs from the bottom up, waiting for fresh CI on each one after it is retargeted to `main` | W |
| "Rerun the failed jobs once." | Pins the failed workflow/head, delegates existing guards, refuses a second automatic retry; pending runs are checkpoints | W-4 |
| "Commit this official PDF form and the changed text files to my feature branch." | Use `github_content_commit_git_data` with base64-encoded binary bytes (up to 1.5 MB per file, 2 MB per commit), a named feature branch and observed `expectedHead`. The guarded writer creates a parented Git commit and will not force a branch update. Requires the new source to be merged and normally released first. | PAR-3 |
| "Bring main into my feature branch before I open the PR." | `github_branch_merge` merges the real branch histories on GitHub (feature branch as `base`, `main` as `head`) when GitHub can merge. Copying main's files into the feature tree alone is **not** a Git merge and can leave a misleading PR conflict. True overlapping conflicts still require resolution. | D-3 |
| "Review this repository's health, security and access." | Bounded observations with missing/plan-limited coverage kept explicit; no automatic fixes or grants | W-5 |
| "Prepare a release." / "Preview finished branch cleanup." | Draft first; separate exact-release publication. Cleanup needs closed same-repo PR/head proof and preserves protected/owned refs; every write remains independently guarded | W-6 |
| "Set up a standard repository." | Private by default, standard policies, one confirmed step at a time; paid private features remain owner review | W-7 |
| "Find this work." / "Give me a weekly digest." | Scoped mixed-object search; seven complete billing days of activity and observed usage, Denver dates, unknown costs never treated as zero | W-7 |
| "Why did CI fail?" | The failing job and step, the error lines, and whether `main` fails the same way — no giant log | G/W |
| "Answer and resolve the review comments." | Checks each fix on the latest commit, replies, resolves — one preview, one OK | E/W |
| "Cut a release." | Draft release with generated notes; publishes only after you say yes | G/W |
| "Clean up old branches." | Deletes only branches whose PR is merged or closed — never `main`, protected or project branches | W |
| "Set up a new repo for my project the standard way." | Private repo, `main` protected by a rule requiring `ci`, merge commits, secret scanning, labels — previewed first | W/P |
| "Is GitHub set up right for Appliance Desk?" | Every row of the Appliance Desk list: ok, fixed with your OK, or exactly what to click | P |
| "Set the STRIPE_KEY secret for this repo." | Gives you a link to type the value on your setup page — the value never goes through chat | G |
| "Give me a throwaway repo to test this workflow." / "Clean up that test run." | Developer scenarios and remote preflight exist; full run-owned write/cleanup acceptance remains open. Restored scratch OAuth can read, but the original quarantined run belongs to its prior connection. No live seed or deletion without verified cleanup baseline and exact authority. | V |
| "Send my app a test GitHub webhook." | Replays a real delivery into the app you are building, correctly signed | V |
| "Review my GitHub organization." | Members and two-factor, security features, apps and tokens, spending, anything needing attention | O |
| "Who has access to my repos?" | Members, outside collaborators, teams, deploy keys, apps and tokens; anything unusual flagged | O/W |
| "Add Sam to the organization." | Shows exactly what access Sam would get, asks you, sends the invitation | O |
| "How much am I spending on GitHub this month?" | Usage by product in dollars, budgets and how close each is | O |
| "Turn on two-factor for the org." / "Change my plan." | GitHub has no way to do these by API, so you get exact numbered steps, then it checks the result where it can | O |
| "Make this production change." | Full owner connection: same-call disclosure, execution, journal and verification; GitHub applies its own permissions | AUTH-1 |
| "What changed in GitHub through Claude this week?" | The change log | B |
| "Undo that." | Reverses the last change when it has a clean opposite; says plainly when it doesn't (for example a merge needs a revert PR) | X |
| "Make a 24-hour read-only pass for Codex." | A pass shown once on your setup page; the agent uses it through Robinson's Toolkit or the HTTPS API | R |
| "Can this connection perform this particular GitHub API action?" | Universal discovery can locate a pinned API operation, but the action may still need a different GitHub credential, scope, plan or guarded specialized tool; unknown and blocked are not successful execution | U/CAP-1 audit in progress |
| Anything else on GitHub | Universal tools search the pinned REST/GraphQL surfaces; only operations with supported credentials, scoped dispatch and all safety checks can actually run | U |


## My connection and your master token (plain words)
- **My connection** is a page on the live address (`/connection`). Anyone signed in can see which GitHub accounts their agent is connected to, change what it may do, or disconnect. It needs no code and works on a phone.
- **Delete my data** is on the same page: it removes the stored connection and settings for that person.
- **Master token (god mode)** is the one key that lets your own agent use every action you have allowed, including paid and admin ones. You type it on the setup page yourself; it is never put in a chat or a tool. If you lose it, replace it on the setup page and the old one stops working.

## Standard Full access diagnosis and explicit recovery — CAP-2 source reviewed for PR #273

The ordinary GitHub consent form already supports Full, with Everyday as its default. The new source describes Full as enabling requests allowed by a real provider grant and existing user policy, **not** creating provider permissions or bypassing approval. You may ask `github_check_permissions` with a `tool` such as `github_pr_merge` and a selected `account` to see recorded profile, credential, mode and resource/policy blockers. You can also include an exact pinned REST `operation` (for example `GET /repos/{owner}/{repo}`) to show audited GitHub credential documentation separately from your actual, unverified grant; a specific account and tool or area are required. Results showing no source blocker remain **unverified** until an authorized scoped provider call and independent readback. After a known blocker the response includes a concrete ordered recovery recipe, with separate client Full reauthorization, verified user consent, GitHub installation permission approval, production enablement and repository selection where applicable. GitHub's owner must separately approve any permission increase; no automated grant or tool argument can do it for them. Recheck the same operation afterward; unknown provider execution remains unknown until readback. Source CI/merge and deployed acceptance are independently tracked in STATUS.

## Operation readback: Standard versus additional authority

GitHub documents that ordinary App user and installation tokens can list packages for an organization through the REST API, so the optional package token is not automatically required for that read. Notifications, however, require a classic personal access token with a compatible scope. On the protected setup page, a new package or notifications token can be asked for one small matching API metadata read. Only a successful result records that exact read as observed at enrollment; it never proves the user's current permission or broader write/registry rights. Results remain restricted to the owner setup and do not grant delegated passes or other tenants access.

## What the new notification setup recheck actually shows

If your connected owner account lacks an enrolled notifications token, the exact `GET /notifications` diagnostic gives a protected setup link. Once GitHub has returned a successful notification-list read using the currently saved encrypted classic K credential, the same diagnostic returns `read-observed-at-enrollment` rather than telling you to enroll again. This is a historical capability read only: current permission, expired/revoked tokens, tenant ownership, read-only policy, confirmation, and present provider operation must still be enforced when called. A manual token may require GitHub's own secure UI and cannot be issued or pasted through an MCP chat argument.

## Private-member optional credentials — implementation status

Private pilot users are never allowed to borrow the owner server's classic P/K tokens or another tenant member's credentials. The source now reserves an encrypted, per-human, per-workspace K/P record with expiry and provider identity/resource metadata and replay-safe replacement, but it is **not connected to a private member setup form or live execution**. No customer should treat this as working tenant God Mode. The only current guided setup uses the owner-controlled protected page and requires that owner's independent verification. The future private member interface must obtain explicit GitHub issuance/approval, verify the current user and exact operation, seal the token inside that user's workspace, and confirm before/after capability without leaking the bearer.

## Ask the connected MCP how to activate missing optional access

Use `github_check_permissions` with your connected GitHub `account`, an exact pinned REST `operation` such as `GET /notifications`, and a registered `tool` or audited `area`. If GitHub only supports an extra classic token for that operation, the server may provide a link to its own protected setup. This is **a browser form**, not a token request in chat: the owner completes GitHub token issuance and passphrase/CSRF-verified credential entry, then rechecks the same operation. Private tenants and delegated service passes cannot receive the owner's setup link. An operation where ordinary GitHub App credentials are supported, such as listing organization Packages metadata, should not be called God-Mode-only. A provider GET observed during enrollment is historical and does not authorize later operations or override your chosen profile, production, spend, tenant or confirmation policy. Full agent-initiated callback return and broader optional credential scope enrollment are still incomplete.

## Optional credential evidence — CAP-3 draft

The protected owner setup already accepts package (P), notifications (K) and fine-grained (F) credentials and retains their values encrypted. CAP-3 source adds a separate record of the GitHub human's numeric identity **only when independently verified using that submitted credential**. A mismatch or a token replaced since verification is not trusted. You can ask `github_check_permissions` for a selected account and registered tool: the optional credential section distinguishes identity checked at enrollment from operation permission, which remains **not proven**. Removing P, K or F through the protected setup page clears the server-stored token and its recorded proof; separately revoke the original credential on GitHub if necessary. This is NOT active God Mode, does not acquire a GitHub PAT for you, and does not bypass installation permissions, private tenant membership, scopes, spending or production policy. The complete agent-started credential lifecycle is still under implementation.

## Capability inventory — source reviewed for PR #272, October 21, 2026

The CAP-1 source implementation adds `node scripts/capability-inventory.mjs --summary` and `--json` for a versioned operation-by-operation gap inventory. This is **not** an end-user authorization or proof of GitHub provider access. Separate statuses identify a real curated implementation, a merely eligible universal route, unknown credential or enterprise availability, and independent deployed acceptance. No percentage of GitHub functionality is claimed from the current named-tool count. Ordinary Full access recovery is CAP-2 source engineering; optional additional credential setup remains CAP-3 work; using this report does not enroll a token, start God Mode, or enable production.

## Private ChatGPT pilot connections — PUB-4 (2026-10-21)

**Source readiness is different from ChatGPT client acceptance.** The independently branded direct private **GitHub by Robinson AI Systems** plugin points to the native standalone `/api/mcp` and its service-issued OAuth. Installing the plugin or receiving a green MCP indicator does not mean ChatGPT has an authorized GitHub session. The standard DCR registration route is the existing **owner-admin** connector, not a private tenant enrollment endpoint; a verified private pilot client must be prebound to its exact GitHub App account by a trusted registration flow. Never ask a private tenant user for the developer's global ADMIN_PASSPHRASE. The pilot remains OFF absent protected enrollment.

The hosted/private **Robinson GitHub Cloud** Sites adapter is separate and its App-backed name, presentation and binding are not changed by editing the repository or the plugin archive. OpenAI currently describes custom MCP ChatGPT apps as web-only, so do not assume direct custom MCP works on Android/iOS; a real supported mobile-hosted connection still needs independent user/device tests. Keep the official GitHub connector until both real custom connections pass.

For each supported **desktop/web** and **Android/iOS** ChatGPT session, record its own `github_whoami` provider identity/account, PREVIEW or explicitly owner-enabled PRODUCTION connection mode, profile, bounded read, preview denial, approved run-owned scratch write/readback, refresh/reconnect, switch and revoke. An OAuth metadata page, application install, protected test or CI check cannot substitute for genuine separate provider/device observations. No owner production changes, public user installs, unscheduled release or paid activity are approved by these source fixes.

## Live testing status — 2026-10-12 UTC

The separate `robinson-ai-scratch` organization is owner-designated; its own custom App is installed, active on All repositories, with 41 recorded permissions, production OFF and spend $0. The custom server responded correctly to OAuth discovery and refused unauthenticated MCP calls, but no custom-MCP OAuth connection or scratch repo write has yet been completed. When testing resumes, connect **this server's** `/api/mcp` endpoint, not the platform's standard GitHub connector. First choose only the scratch account with mode `preview` and profile `read_only`; for guarded scratch writes use `everyday` only after cleanup/recovery is verified. Owner stopped testing for the day; no further owner action is requested now.

## Coding-agent development access (2026-10-13)

The implementing agent uses a renewable native OAuth connection, not a new copied RTC
pass for every retest. `rtool developer-connect ALIAS --profile full` prepares one mobile
link using the custom service. Choose the intended account/resources and authorize once;
return to chat without copying secrets. The agent reruns the command to finish privately,
then uses developer-check, developer-tools and developer-call. Existing original service
write previews, owner approvals and resource guards still apply. This developer workflow
does not reduce the finished product's tool capabilities.

On a managed POSIX cloud runner, configure RTOOL_DEVELOPER_VAULT_DIR to an absolute private
folder outside every Git checkout. The CLI creates a separate 0600 encryption key and
AES-GCM encrypted connection files in a 0700 folder; keep that private runner state for
resumes. OS credential managers remain the desktop default. Neither option places secrets
in chats, prompts, Git or shared artifacts. Initial provider consent or an expired/revoked
underlying authorization can still require a new owner sign-in. Source/tests are not
proof that the new deployed workflow has been exercised against the real provider.

**October 15 source/deployment distinction:** W-5/W-6 source merged in #217; W-7 merged in #218. These new tools require the normal checked release before they are live. The restored custom OAuth can perform approved scratch reads; the original run journal belongs to the old connection and remains quarantined pending its exact preflight/owner disposal gate. No production activation, spending or disposal is implied.

## Owner execution and paid administrative actions

A full owner connection executes authorized supported actions in one call, discloses the effect and known or unknown costs, journals the request and independently reads back the result. GitHub's actual permissions and policies decide provider access. Older production flags, protected-resource lists and server spending defaults do not add a second owner approval. Explicit previews, caller-selected accuracy checks, read-only connections and owner-issued restricted passes remain binding. This is product behavior; it does not authorize the implementation agent to spend or destroy real resources to test it.

The current owner-confirmation cleanup also removes duplicate target entry on project/issue/type/field deletion, advisory publication and budget deletion. Full owners can supply the exact target once; optional confirmTitle/confirmNumber/confirmGhsa/confirmBudgetId or organization-object name is checked if supplied. Restricted grants retain their confirmation requirements. Budget deletion discloses removal of spending protection and unknown future charges, sends once and verifies absence. Source/CI are not real-account acceptance of a destructive budget operation.

`github_codespace_set_org_access` uses GitHub's genuine PUT. For selected_members, name the complete replacement list; each user must be an active organization member. Full owners need no duplicate replaceSelectedUsers acknowledgement; explicit false prevents replacement. Restricted grants retain their acknowledgement and allowance requirements. GitHub has no documented policy GET endpoint, so HTTP 204 remains **unconfirmed** until the owner inspects saved settings at `https://github.com/organizations/OWNER/settings/codespaces`. Submitted values are not independent readback. Enabling access can incur unknown future compute/storage charges.

The content-protection correction is live and verified; see [exact-file evidence and false-positive correction steps](CONTENT-PROTECTION.md). The additional owner-confirmation cleanup must pass exact-head checks and release before its new omissions can be used live. Current acceptance and precise remaining prerequisites are in [the audit checkpoint](status/2026-10-28-audit-live-verification.md) and STATUS's existing queue. No claim of paid-provider acceptance is made from deployment alone.

## Pending Y-7/H-4 paid private security correction — source only

The earlier developer-spend interpretation incorrectly prevented even an authorized end user's agent from enabling private-repository code scanning, premium security features, or attaching paid organization security configurations to private repositories. The approved 2026-10-16 owner decision restores **actual guarded GitHub API execution** on these operations, rather than forcing the user to click through manually.

A private paid activation may bill GitHub **per active committer for continuing future usage**. The agent states the unknown maximum cost, shows the exact repository/configuration and intended setting, and requires real end-user delegated **PRODUCTION/full** approval and genuine provider plan entitlement. A **user-selected finite MCP spending ceiling, including $0, or a bounded service-pass allowance** forbids an operation whose future charge cannot be proven to fit. If no user-chosen product cap exists, GitHub permission and explicit confirmation can authorize the operation. Disabling paid features remains available even with a chosen $0 limit. Changes are logged and read back without assuming provider success.

This is a correction to Y-7/H-4 source and tests; it does not authorize this project's implementing agent to activate any real security products, spend GitHub money, change production configuration, or run live provider acceptance. Only a verified scheduled release plus separately authorized provider tests can establish the custom MCP's live behavior.

## Pending U-1/Y-1 universal paid-operation authority correction — not released

The four REST tools still use the pinned GitHub OpenAPI index: `github_api_search`, `github_api_describe`, `github_api_read`, and `github_api_write`. The 2026-10-16 correction permits a **properly authorized end user's** coding agent to call any otherwise eligible *non-curated* GitHub write—even if future use can cost money. A developer's $0/no-LIVE testing policy is not a user-selected product budget.

**Exactly 54 reviewed provider routes are classed as free.** Every other non-GET REST mutation is treated as **unknown future cost**, regardless of whether its name mentions billing. The agent presents the exact provider operation, connected account/repository, required PRODUCTION/full-mode confirmation, possible access/notification impact and the risk that GitHub can charge for subsequent usage without a known maximum. A user-selected **$0 or finite monthly product cap**, or finite scoped RTC pass allowance, refuses that unknown-cost operation. An owner with no user-selected product cap and genuine GitHub authorization can explicitly approve it through the guarded service. A 403 or plan restriction from GitHub remains a real refusal.

This broad route never bypasses a dedicated curated tool, actual GitHub credential scope, secret sealing/redaction, unsupported enterprise or App-JWT restrictions, protected resources or replay journal. A provider success without independent matching readback is always **unconfirmed**, never falsely reported as fully verified. The developer has not enabled production, spent any money or executed paid provider tests; merging source is not live-source acceptance.

## Package permission checks

The GitHub.com App permission is **Packages → Read and write**. There is no separate organization Packages switch in the observed App settings; the server must not send you to approve `organization_packages` merely because that name appears in GitHub's token schema. The corrected manifest and diagnostics omit that unavailable grant. Your already accepted Packages permission remains valid. The checker reports **capability unverified**, with zero missing package grants, until the package tools have a supported credential path and independent verification; it does not direct you back to settings.

An installation permission check verifies the recorded App grants. It does not prove that a package operation succeeded: GitHub still checks the credential, package/repository access and operation-specific requirements. Read, delete and restore acceptance remain separate; provider refusals must be reported accurately. The scratch App's personal OAuth authorization and available permission updates were completed on October 17. Production remains OFF and paid/destructive tests have their own authorization gates.

## Optional package authentication — October 18

Package tools now use a dedicated classic personal access token (`P`), enrolled only through the passphrase/CSRF-protected private setup page. Use `read:packages` for metadata, plus `delete:packages` for deletion and `write:packages` for restoration. Repository-scoped registries additionally need `repo`; do not select unrelated scopes. The token must belong to the connected personal account or the person already authorized for the organization. It is encrypted separately from notifications (`K`) and never accepted as a tool argument. Replace or remove it on setup; revoke it on GitHub if no longer needed. Package-level access, SSO and organization token policies still apply. Repository/permission-limited passes cannot use an un-narrowable classic token; read-only connections can list but cannot mutate. Package operations preserve production, preview, confirmation and independent readback guards. Universal REST requires explicit `cred: P` on supported org/user package routes; curated deletes/restores still require their specialized tool. A saved token or accepted App grant does not prove real package access.

The database upgrade is additive and rerunnable, adding four nullable dedicated package columns. Existing credentials and account policy remain intact. Rollback code can ignore these columns; remove the optional credential in setup before retiring the new path. Real package acceptance still requires owner enrollment and an exact disposable package fixture.

Private personal package metadata and version reads use authenticated `/user/packages` routes. These require an enrolled personal account whose stored token actor matches that account; an organization-associated token cannot silently expose its actor’s personal packages. Organization routes keep their explicit organization binding. Both supported version inventories accept bounded page parameters. Stored package tokens can be removed on protected production setup even when the encryption key is temporarily unavailable; enrollment still requires a configured key.

Owner overview now recognizes an already authorized personal GitHub identity. It verifies that identity through your enrolled U connection and shows only account ID/login and any readable 2FA/plan status. Missing, revoked or mismatched authorization is reported separately; withheld fields remain unknown. This does not complete a full personal security review or a guided browser setting change, and does not ask you to repeat valid OAuth consent.

A provider permission header lists an endpoint’s accepted grants; it does not by itself prove that your App is missing them. Error guidance now asks the agent to compare actual grants, credential support and resource access. Boolean metadata and known unavailable setting names are never presented as permissions for you to approve. Actual refusals remain visible, and valid existing OAuth should not be repeated merely to satisfy a fabricated permission label.


Sponsors reads verify whether the payer and recipient are people or organizations before querying GitHub. A verified missing Sponsors listing is shown as unavailable with no tiers. Starting a sponsorship still requires a real published tier, your configured spending authority and confirmation; public visibility or opting into maintainer email also honors your delegated access-change settings. These source changes take effect through the normal scheduled release.


## Upgrade a PREVIEW-only ChatGPT cloud-adapter connection (B-2 correction)

After a reviewed release includes this correction, open the existing protected production `/api/github/setup` page. Submit **Show my accounts** using your administrator passphrase to list the custom connector's IDs, profiles and modes. Under **Upgrade existing custom connection to PRODUCTION**, enter the exact **FULL/PREVIEW** custom ChatGPT connection ID and its sole GitHub account (already production-enabled). The server atomically changes its stored mode with the same bearer and refresh grants, verifies readback and logs access widening. Return to ChatGPT and run `github_whoami` to independently confirm. This avoids repeated ChatGPT sign-in and does not affect the official GitHub connector or authorize individual paid/destructive operations. Preview/non-full/mixed-account sessions fail closed. Deployment and real-world acceptance remain separately tracked.

The adapter's owner-requested label **GitHub by Robinson AI Systems** is not accomplished by this server correction. The current Sites-generated plugin is PRIVATE and the Plugin Creator updater explicitly prohibits App name/presentation changes; obtain a supported adapter presentation-edit workflow before claiming this rename is done.


### Mobile and desktop availability — not yet accepted

The **GitHub by Robinson AI Systems** direct MCP plugin uses the service-owned OAuth selection flow and is currently a PRIVATE desktop-capable candidate; its Codex desktop deep link is **not** an Android ChatGPT entry point. The existing **Robinson GitHub Cloud** ChatGPT Sites/cloud adapter is the mobile-capable candidate and exposes a separate ChatGPT account sign-in. They target the same independent GitHub MCP service, but they need individually verified authorization and tool-call readback before the official GitHub integration can be retired. No public plugin listing or open sign-up is authorized.

After the corrected source passes exact-head CI/review and reaches independently READY live production, the owner can inspect **Custom MCP connections** after passphrase login at the existing setup page. Expired access tokens with valid refresh grants remain identifiable. Only if the target shows FULL / PREVIEW and exactly the owner-approved production-enabled scratch account should the owner explicitly upgrade that existing adapter connection. The upgrade does **not** install or connect a new mobile/desktop client, replace an OAuth grant for a different user, alter GitHub permissions, or authorize a particular paid/destructive change. Verify `github_whoami` from both Android and desktop through each actual connected plugin. Preserve the official integration until both pass and the remaining production acceptance backlog is genuinely completed.


## Private scale work (PUB-1) is NOT a public registration page

The upcoming tenant directory is an internal, non-public storage foundation for future independent GitHub users. It has **no** customer account creation control, onboarding link or self-service passphrase. Your existing private owner setup, `robinson-ai-scratch` App, ChatGPT connections and normal scheduled releases stay unchanged. Neither an admin setup passphrase nor a typed GitHub email grants tenant access. When PUB-2 and PUB-4 eventually ship, customers must separately verify their GitHub identities and the correct tenant and mode through their own consent; a private Android/iOS and desktop web connection must each be independently proven by `github_whoami`. Keep both custom plugins PRIVATE and the official GitHub connector until that acceptance succeeds. Public Directory distribution remains blocked by IN-18 policy eligibility and requires your later explicit approval.


## PUB-2 private GitHub OAuth is being built, not ready for live sign-in

Draft [PR #264](https://github.com/Robinson-AI-Systems/github-mcp/pull/264) now includes a separate tenant OAuth path, mobile-sized profile/mode consent page, protected one-use GitHub callback and tenant-specific MCP access/refresh grants. Its simulated GitHub-provider and real throwaway PostgreSQL tests passed at the recorded source head. It is **not deployed, does not publicly enroll people, and has not been tested on your phone or a desktop ChatGPT client**. An actual owner-controlled tenant bootstrap and registered-client discovery still need engineering and review, and the private OAuth flag is OFF. You do not need to create additional keys, reconnect the official GitHub plugin or touch Vercel yet. Keep current owner and official connections intact and both custom plugins PRIVATE; publication requires another explicit decision after genuine real-world acceptance.


## PUB-2 source versus real-world acceptance (2026-10-19)

The private pilot in [PR #264](https://github.com/Robinson-AI-Systems/github-mcp/pull/264) is a **testing/early-access channel** for the actual multi-user GitHub MCP technology. The permanent production product should let each future customer authorize independently through GitHub without your administrator passphrase, scratch organization, or manually copied pilot credentials. GitHub OAuth, verified users, installation checks and tenant isolation are implemented in source, but **no real new user or Android/desktop connection has been accepted on the deployed service yet**. Before you disconnect the official GitHub connector, the checked scheduled release and genuine end-to-end privately connected device acceptance must pass. Keep the custom plugin PRIVATE and leave customer enrollment disabled until separate readiness and distribution approval.


## Private tenant fairness and emergency stop (PUB-3 source, NOT device acceptance)

Your original owner connection is unaffected by private pilot capacity safeguards. If you later enable an authorized private pilot, each enrolled user has an independent GitHub App authorization; one client repeatedly calling tools can be temporarily asked to wait instead of using another customer's shared capacity. The private pilot stores only anonymous aggregate activity counters for operations, not private repository contents or credentials. Its job/result handles expire within 24 hours and private results have bounded stored size.

The protected owner setup's **Revoke private pilot** action first disables all that pilot's access, then clears stored private session clients, pending codes, encrypted GitHub user grants, jobs and retained results from that tenant, without affecting a different tenant or your legacy credentials. If cleanup is interrupted, private access stays disabled and the owner can retry. This is a deliberate access-revocation and deletion operation, not a normal tool; it requires the existing protected setup confirmation and may remove pilot users' outstanding work, which is disclosed in the setup guide. It is not equivalent to uninstalling your official GitHub connector.

The source changes still need exact-head CI/review, scheduled live promotion and first-hand mobile and desktop connection testing. They do not authorize public listings, outside-user signups, paid capacity or production provider writes. PUB-5 public distribution remains separately blocked.


## Private per-tenant capacity and emergency stop (PUB-3 source verified, pending checked release)

The protected GitHub setup page will allow you to set a **separate client and whole-tenant request rate** for an already verified private scratch tenant. Each change still requires the existing origin check, CSRF, your administrator passphrase and explicit account confirmation; no customer receives that passphrase. Your account's legitimate GitHub tool permissions, approved production operations and spending preferences remain distinct from these fair-use server budgets. An over-busy private client receives an honest retry notice rather than disrupting a different tenant. Default private limits remain 120 requests/client/minute and 600 requests/tenant/minute; owner-selected overrides remain capped by conservative hosting ceilings until actual scale readiness is measured.

The existing **Revoke private pilot** setup action first stops access, then clears only that tenant's clients, codes, access grants, active jobs and retained results. If cleanup is interrupted, the tenant stays disallowed and the owner can retry. The isolated disposable PostgreSQL tests prove another tenant's data survives. PR #267 source checks pass, but this new documentation is **not** a live release; actual controlled private pilot, Android/desktop client and public-scale acceptance are still pending. Keep both custom plugins PRIVATE and leave the official GitHub connection installed until verification is complete.


### Private GitHub MCP: one verified account per mobile/desktop OAuth client (PUB-4 work in progress)

The native GitHub MCP and the private mobile-oriented hosted adapter should both use the same service-owned GitHub authorization. A standard OAuth client does not normally send an extra GitHub `account` field. New private clients are therefore bound to the **one exact GitHub App account** independently verified during provider login/registration; your mobile or desktop consent form can show mode/profile without exposing every tenant account. If more than one App installation is authorized, enroll a separate private client for another account rather than allowing an implicit cross-account switch. For older unbound clients, the service permits account inference only when exactly one eligible installation exists; ambiguous scope refuses.

This is source-level engineering in draft PUB-4, **not yet a completed or deployed mobile login**. Keep both custom plugins PRIVATE and keep the official GitHub integration connected until real Android/iOS and supported desktop/web sign-in, `github_whoami` mode/account/profile and guarded scratch provider operations have been accepted. The current Sites-backed adapter's display still reads `Robinson GitHub Cloud`; the allowed archive editor does not permit changing its App-backed name/presentation. Do not confuse that unresolved branding step or a Codex-only launch deep link with working Android connectivity.

### Private-tenant additional GitHub credentials (CAP-3 source candidate; not activated)

An enrolled private client can ask **github_check_permissions** for a *specific connected account* and `GET /notifications`. If a classic personal token would supply a documented additional read, the answer offers the server's private **Additional GitHub authority** page. It uses the client's registered HTTPS return address, not your global administrator page. GitHub itself must issue the token to that person: no AI chat or MCP tool asks for its value. The person pastes it only into the protected page, which verifies their existing GitHub numeric identity, the `notifications` OAuth scope and one harmless read before encrypting the token for this one workspace. The page returns a nonsecret result to the originating client; ask the same permissions tool again to inspect the recorded before/after status. This is *not* proof of live write authority and cannot override GitHub permissions, the connection profile or existing guardrails.

**Renew or remove:** reopen a fresh protected page from the same client's permission diagnostic. Saving another verified same-person token atomically replaces the matching kind only; a stale or interrupted form cannot overwrite it. Removing the stored grant requires proof from a currently valid same-person GitHub credential; revoke the PAT at GitHub separately. Membership revocation and owner emergency cleanup stop access irrespective of that browser step. If browser consent is interrupted or expires, restart from the original connected client; the previous independently authorized token remains intact. Package metadata readback may be recorded for a separate classic P grant, but ordinary App-supported package listing does not require an extra token. An actual ChatGPT device-specific callback, fresh GitHub permission after enrollment, enterprise authority or production activation is **not** proven by this source candidate.


**Using the added permission:** Once the protected private-member form records a verified K grant, run `github_notify_list` for that same connected account to read its personal notifications. The adapter decrypts the K credential only inside the server and verifies the exact allowed GitHub GET at request time. An independently enrolled P classic token permits an exact `github_api_read` of `GET /orgs/{org}/packages` for the same registered organization, although ordinary App clients may already read package metadata without one. Neither private K nor P can authorize marking notifications read, deleting/restoring packages, changing permissions, GraphQL, repository-scoped passes or any other route. Those actions need separately reviewed, properly gated authority. An expired, revoked, reallowlisted, overwritten or foreign-person token fails closed, with a new protected enrollment required where applicable. Provider/device tests remain pending; do not infer live access or a successful automatic ChatGPT callback from source-level proof alone.

## Connect Meta Muse or Muse Code

For **Muse Code**, open `https://github.robinsonaisystems.com`, find **Meta Muse Code** and copy the settings JSON into your Muse Code `mcp_servers` settings. Run `muse mcp login github-robinson` and sign in with GitHub in the browser, then `/mcp` to verify the available tools.

For the **Muse personal assistant**, the same page has a ready-to-paste custom connector request; Muse's consumer connector builder is different from Muse Code's native MCP support. A working consumer custom connector still requires a real Muse acceptance check; this service is not approved or listed in Meta's catalog. Do not paste GitHub tokens or passwords into the chat. Every app uses the same account permission and safety controls.

## Meta Muse — public users, no owner credentials (MUSE-2)

Any person can add `https://github.robinsonaisystems.com/api/mcp` to Muse once the MUSE-2 release is deployed. If Muse asks for a Client ID, the public identifier is `pcl_meta_muse_public_client_20261026_v1xyz`; leave Client Secret **empty**. This is a nonsecret identifier for Muse, not a shared login. Muse should open GitHub sign-in, let that person approve their own GitHub installation/accounts, and return them to Muse. Existing Claude/ChatGPT secret-backed registrations continue to work. Do not supply the service owner's passphrase, token or credentials to customers. Automatic registration is offered to clients that use it, but some actual Android Muse versions require this one public Client ID. Real Muse app acceptance is still pending.

### Enterprise universal REST parity (PAR-4; merged #423, normal live release pending)

For uncurated pinned `/enterprises/{enterprise}/...` operations, call `github_api_describe` and then `github_api_read` or `github_api_write` with the exact enterprise slug in `params.enterprise` and explicit `cred:"M"`. The server must independently verify that your enrolled master token has the needed enterprise scope and GitHub reports you as an administrator of that enterprise. Organization connections, a plain App installation credential, unverified slugs, and read-only or delegated passes cannot substitute for this proof. Universal writes still require full/PRODUCTION authority, preview and confirmation, spending approval and once-only execution. GitHub remains the final arbiter of policy permissions; an accepted API write lacking an independent read endpoint is reported `unconfirmed`, not certified complete. No live enterprise setting was changed to test this fix.


### Simple-call latency improvements (C-8, in reviewed source until daily release)

The official GitHub MCP can return a simple query faster even where Robinson GitHub MCP saves many separate PR/CI calls. A small alternating read sample from the authenticated ChatGPT connectors on October 27 measured official identity calls at 326/362/338 ms versus custom `github_whoami` at 1172/724/617 ms. These are *different* operations/connections and three samples, not an apples-to-apples SLA. C-8 avoids duplicated status/rate SQL reads in `github_whoami` and aggregates per-HTTP-request provider telemetry, with an awaited tenant-isolated flush and preserved error/latency counts. Existing account permissions, native credentials, tenant validation, rate caps, confirmations, PR checks and every live release control remain unchanged. Expect independent, comparable real-client measurements only after the reviewed commit reaches Vercel `live`; do not describe a source or artificial-delay benchmark as a production improvement.

### Sequential guarded writes in one MCP call (C-16 merged #443; live client acceptance pending)

Use the explicit `github_write_batch`, **not** the read-only `github_batch`, to perform a logical series of GitHub mutations in order. Supply a stable `batchKey`, `steps` naming the same original guarded write tools you would invoke directly, and `dryRun:true` for a no-write plan before applying with `confirm:true` where your chosen connection requires confirmation. The individual writer always owns permission checks, disclosures, GitHub authority and after-write readback; the batch does not supersede the account owner, agent pass, GitHub rules, or original write contract.

For branch → commit → PR in one request: step 0 calls `github_branch_create` with `repo,branch`; step 1 calls `github_content_commit_git_data` with `repo,branch,files,message,expectedHead:{"$from":0,"path":"sha"}`; step 2 calls `github_workflow_open_pr` with `repo,head,title`. The batch independently confirms the created PR and its last committed branch SHA before reporting that step applied. A retry with the same `batchKey` reuses durably confirmed receipts rather than repeating writes. On a refused or uncertain middle step, later steps do not run; inspect the itemized record and branch/PR head, reconcile any uncertain write before starting a **new key for only unfinished actions**. GitHub changes are not rolled back. The maximum 20 steps per MCP invocation and 43-second soft continuation bound are transport limits, not an authorization cap; use the same key to resume confirmed prefixes. No live GitHub write was run as part of this source change.

**Source and CI acceptance (2026-10-28):** PR #443 merged, both exact-head mandatory checks passed, both review threads resolved, issue #431 independently closed. Other original agent feedback issues #427–#436 are all also closed. The daily/controlled release policy and real client testing remain separate; do not assume the newly added tool has already appeared in a connected client's cached tool list until a checked deployment and reconnection make it available.

## Complete source reads and scanning alternatives (source remediation 2026-10-28)

Use `github_content_get` with `fullText: true` for full bounded source text. Default previews remain small; if the retained store fails, follow `continuation` using the immutable `blobSha` and exact byte windows until `complete`. Large prose has one authoritative JSON copy in `content[0].text`; structured metadata points to it.

`github_security_scan_files` checks only selected committed files using local patterns. For provider protection and repository coverage, call `github_security_scan_guidance`: it reads current settings and supplies exact native setup calls, official remote-MCP setup, and a Robinson Gitleaks workflow/local commands. Generated configuration is not an installed scan, existing alerts are not a fresh scan, and zero matches never certify a repository has no secrets.

For a masked source file or refused exact-byte read, use `github_content_protection_check`. It names the rule and location without exposing the matched value; see [content protection and false positives](CONTENT-PROTECTION.md) for correction and local retrieval steps.

## Native Git workspaces

The source expansion adds real native Git through an isolated portable worker: clone, inspect/edit, commit, fetch/push, history/conflict recovery, stash/worktrees and manual bisect. Start with github_git_workspace_read(operation=capabilities); it reports actual configured-worker readiness or setup guidance. Five tools and exact limits/unsupported advanced features are documented in [Native Git operations](NATIVE-GIT-OPERATIONS.md). A missing worker never masquerades as working native Git, and API git-data tools remain available. Initial Dokploy is portable through full state export/restore; the initial running container does not promise zero idle cost or autoscaling. See the dated checkpoint for source versus actual deployed acceptance.
