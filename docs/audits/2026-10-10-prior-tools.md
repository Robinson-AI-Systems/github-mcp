# Gap check: every GitHub tool Chris built or planned before (2026-10-10)

Chris (2026-10-10): "check what tools I had built, or had planned, for these tool sets across my various Robinson's
Toolkit repositories and close any gaps … don't limit yourself to repos in my organization." This audit lists every
GitHub tool name that existed or was planned in any earlier toolkit, says where each one lives in this plan, and records
the gaps it closed. The research audit (`docs/audits/2026-10-10-research.md` §2) covered only the old toolkit's 311
names; this one covers all prior toolkits and three other projects. `docs/TOOLKIT-NAME-MAP.md` (D-1) is built from §3.

## 1. Sources read (read-only local clones)

The personal-account copies (`christcr2012/*-49bf1a39`, `*-4e33a1a0`) have the same HEAD as the organization copies, so
these clones cover both.

| Code | Repository and files | Commit |
|---|---|---|
| T | `robinsons-toolkit-mcp`: `registry/github.json` (311 tools), `handlers/github.js` | `6c590f9c7895ea3bf2ce9e5d37bf300f5bd03cff` |
| Td | `robinsons-toolkit-mcp`: `ClaudeBuildPlan.md` ("likely missing" list), `EXPANSION_ROADMAP.md`, `EXPANSION_INDEX.md`, `EXPANSION_QUICK_GUIDE.md`, `TOOLS_REFERENCE.md`, `README.md`, `Creation Docs/` | same |
| S | `robinsonai-mcp-servers`: `packages/robinsons-toolkit-mcp/src/categories/github/{tools,handlers}.ts`, `src/index.ts`, `src/all-tools.ts`, `src/tool-registry.ts` (240 tools) | `8d84fa13a6b6ccbb70a3d67e4a8df484ae710096` |
| Sf | same package: `github-tool-names.txt`, `github-definitions.txt`, `github-handlers.txt`, `temp-github-*.txt`, `github-name-migrations.json`, `github-parallel-tasks.json`, `github-api-coverage-analysis.md`, `GITHUB-COMPLETION-PLAN.md`, `analyze-github-names.cjs`, `generate-github-tasks.js` | same |
| Sd | same repository: package docs (`TOOL-NAMING-STANDARD.md`, `IMPLEMENTATION-PLAN.md`, `QUICK_REFERENCE.md`, …), every root-level `.md/.txt/.json`, `docs/`, `plans/`, `standalone/`, `packages/free-agent-mcp/src`, `packages/paid-agent-mcp/src` | same |
| Sp | `GITHUB-COMPLETION-PLAN.md` phase 2 (planned names without the `github_` prefix, normalized by adding it) and `github-api-coverage-analysis.md` | same |
| A | `robinsons-toolkit-api`: `TOOLS-REGISTRY.json`, `implemented-tools.txt`, `github-mcp-tools.txt` (225), `lib/github.js`, `api/github/`, `openapi-schema.json`, `openapi.yaml`, `CUSTOM-GPT-SCHEMA.json` | `d7f7d9f7c55041f9a8eafb4760a72c07048bce97` |

Method: every `github_<name>` token in those files was collected by script (regex `\bgithub_[a-z][a-z0-9_]*[a-z0-9]\b`),
plus the unprefixed planned names in `GITHUB-COMPLETION-PLAN.md`; noise was removed (§2); every remaining name was mapped
by hand (§3) and every mapped tool name checked against `docs/TOOL-CATALOG.md` by script.

## 2. Inventory summary

- **528 unique prior names** (built or planned) after removing 47 non-tool tokens (table below).
- By source (a name can have several): T 311 · A 365 · S 240 · Sf 250 · Sd 256 · Sp 65 · Td 40.
- 311 come from the old toolkit (T); **217 more** come only from the other toolkits: 57 built in
  `robinsonai-mcp-servers` but not in T, 93 built only in `robinsons-toolkit-api`, 67 planned only (never built).
- Renames normalized: the old names map straight to the new `github_<area>_<verb>` names; the 31 rename suggestions in
  `github-name-migrations.json` (42 names flagged `needs_review`, 31 with a suggested singular/plural name, never applied,
  several mangled such as `github_disable_automated_security_fixe`) are the same tools and are excluded below (with 16
  prose tokens) rather than counted twice.
- The "Added … COMPLETED 2025-11-12" claims in `github-api-coverage-analysis.md` (OIDC, Actions permissions, org secrets,
  11 self-hosted runner tools) have **no tool definitions** at that repository's HEAD; they are treated as planned.

**Outcome counts (528 names):**

| Outcome | Names | Meaning |
|---|---|---|
| Covered by a hand-built tool | 432 | Maps to one of 191 catalog tools (often several old names → one tool with an argument) |
| Covered by the universal tools | 59 | `github_api_*` / `github_graphql_*` with the same guards (Batch U) |
| Deliberately dropped | 34 | Removed by GitHub, Enterprise-only, or out of scope — reasons D1–D6 with evidence |
| **GAP → added** | 3 | New catalog tools (plus one more from a planned category, §4) |

### Excluded tokens (not tools)

| Token | Why excluded |
|---|---|
| `github_add_assignee` | unapplied rename suggestion in github-name-migrations.json (normalizes to github_add_assignees) |
| `github_add_cop` | prose/placeholder or counter-example in a naming guide, not a tool |
| `github_add_copilot_seat` | unapplied rename suggestion in github-name-migrations.json (normalizes to github_add_copilot_seats) |
| `github_add_label` | unapplied rename suggestion in github-name-migrations.json (normalizes to github_add_labels) |
| `github_compare_commit` | unapplied rename suggestion in github-name-migrations.json (normalizes to github_compare_commits) |
| `github_create_pr` | prose/placeholder or counter-example in a naming guide, not a tool |
| `github_create_repos` | prose/placeholder or counter-example in a naming guide, not a tool |
| `github_delete_workflow_run_log` | unapplied rename suggestion in github-name-migrations.json (normalizes to github_delete_workflow_run_logs) |
| `github_disable_automated_security_fixe` | unapplied rename suggestion in github-name-migrations.json (normalizes to github_disable_automated_security_fixes) |
| `github_disable_vulnerability_alert` | unapplied rename suggestion in github-name-migrations.json (normalizes to github_disable_vulnerability_alerts) |
| `github_enable_automated_security_fixe` | unapplied rename suggestion in github-name-migrations.json (normalizes to github_enable_automated_security_fixes) |
| `github_enable_vulnerability_alert` | unapplied rename suggestion in github-name-migrations.json (normalizes to github_enable_vulnerability_alerts) |
| `github_fetch` | prose/placeholder or counter-example in a naming guide, not a tool |
| `github_get_copilot_org_setting` | unapplied rename suggestion in github-name-migrations.json (normalizes to github_get_copilot_org_settings) |
| `github_get_repo_clone` | unapplied rename suggestion in github-name-migrations.json (normalizes to github_get_repo_clones) |
| `github_get_repo_stats_contributor` | unapplied rename suggestion in github-name-migrations.json (normalizes to github_get_repo_stats_contributors) |
| `github_get_repo_top_path` | unapplied rename suggestion in github-name-migrations.json (normalizes to github_get_repo_top_paths) |
| `github_get_repo_top_referrer` | unapplied rename suggestion in github-name-migrations.json (normalizes to github_get_repo_top_referrers) |
| `github_get_repo_view` | unapplied rename suggestion in github-name-migrations.json (normalizes to github_get_repo_views) |
| `github_get_required_status_check` | unapplied rename suggestion in github-name-migrations.json (normalizes to github_get_required_status_checks) |
| `github_list_issue_timelines` | unapplied rename suggestion in github-name-migrations.json (normalizes to github_list_issue_timeline) |
| `github_list_org_projects_v2s` | unapplied rename suggestion in github-name-migrations.json (normalizes to github_list_org_projects_v2) |
| `github_list_pull_requests_associated_with_commits` | unapplied rename suggestion in github-name-migrations.json (normalizes to github_list_pull_requests_associated_with_commit) |
| `github_list_user_followings` | unapplied rename suggestion in github-name-migrations.json (normalizes to github_list_user_following) |
| `github_mcp_1` | prose/placeholder or counter-example in a naming guide, not a tool |
| `github_mcp_2` | prose/placeholder or counter-example in a naming guide, not a tool |
| `github_mcp_3` | prose/placeholder or counter-example in a naming guide, not a tool |
| `github_new_issue` | prose/placeholder or counter-example in a naming guide, not a tool |
| `github_open_pull_request` | prose/placeholder or counter-example in a naming guide, not a tool |
| `github_owner` | prose/placeholder or counter-example in a naming guide, not a tool |
| `github_pr` | prose/placeholder or counter-example in a naming guide, not a tool |
| `github_pr_new` | prose/placeholder or counter-example in a naming guide, not a tool |
| `github_push` | prose/placeholder or counter-example in a naming guide, not a tool |
| `github_remove_assignee` | unapplied rename suggestion in github-name-migrations.json (normalizes to github_remove_assignees) |
| `github_remove_copilot_seat` | unapplied rename suggestion in github-name-migrations.json (normalizes to github_remove_copilot_seats) |
| `github_remove_pull_request_reviewer` | unapplied rename suggestion in github-name-migrations.json (normalizes to github_remove_pull_request_reviewers) |
| `github_repo` | prose/placeholder or counter-example in a naming guide, not a tool |
| `github_request_pull_request_reviewer` | unapplied rename suggestion in github-name-migrations.json (normalizes to github_request_pull_request_reviewers) |
| `github_rerun_failed_job` | unapplied rename suggestion in github-name-migrations.json (normalizes to github_rerun_failed_jobs) |
| `github_search_commit` | unapplied rename suggestion in github-name-migrations.json (normalizes to github_search_commits) |
| `github_search_issue` | unapplied rename suggestion in github-name-migrations.json (normalizes to github_search_issues) |
| `github_search_repositorie` | unapplied rename suggestion in github-name-migrations.json (normalizes to github_search_repositories) |
| `github_search_topic` | unapplied rename suggestion in github-name-migrations.json (normalizes to github_search_topics) |
| `github_search_user` | unapplied rename suggestion in github-name-migrations.json (normalizes to github_search_users) |
| `github_src` | prose/placeholder or counter-example in a naming guide, not a tool |
| `github_update_required_status_check` | unapplied rename suggestion in github-name-migrations.json (normalizes to github_update_required_status_checks) |
| `github_verb_noun` | prose/placeholder or counter-example in a naming guide, not a tool |

## 3. Mapping: every prior name → where it lives now

Origins use the codes in §1. Dropped reasons:

- **D1** — out of scope — GitHub Models is an AI inference service on its own host (models.github.ai), not repository/account work; AI model calls belong to the hub's model servers (ROADMAP)
- **D2** — Projects (classic) REST API retired 2025-04-01 (https://github.blog/changelog/2024-05-23-sunset-notice-projects-classic/); Projects v2 tools replace it
- **D3** — required workflows API retired by GitHub; rulesets "require workflows" replace it (research §2.2 G12)
- **D4** — legacy Copilot usage/metrics endpoints shut down 2026-03/04 (https://github.blog/changelog/2025-02-21-deprecation-of-beta-github-copilot-usage-api-endpoint , https://github.blog/changelog/2026-01-29-closing-down-notice-of-legacy-copilot-metrics-apis/); the new usage-metrics endpoints are reached by the universal tools (Copilot cancelled 2026-10-09)
- **D5** — organization audit-log REST endpoint is Enterprise Cloud only (research [S16], finding G13); github_admin_overview reports it as not_available_on_plan with the dashboard link
- **D6** — GitHub closed the workflow and workflow-run usage (timing) endpoints (https://github.blog/changelog/2025-02-02-actions-get-workflow-usage-and-get-workflow-run-usage-endpoints-closing-down); billable minutes come from github_billing_get_usage

| Prior name | Origins | Outcome | New home or reason |
|---|---|---|---|
| `github_add_assignees` | T,S,Sf,Sd,A | covered | `github_issue_set_assignees` |
| `github_add_collaborator` | T,S,Sf,Sd,A | covered | `github_collab_add` |
| `github_add_copilot_seats` | T,S,Sf,Sd,A | covered | `github_copilot_add_seats` |
| `github_add_labels` | T,S,Sf,Sd,A | covered | `github_issue_set_labels` |
| `github_add_labels_to_issue` | A | covered | `github_issue_set_labels` |
| `github_add_project_item` | S,Sf,Sd,A | covered | `github_project_set_item` |
| `github_add_team_member` | T | covered | `github_team_set_member` |
| `github_add_team_repo` | T | covered | `github_team_set_repo_access` |
| `github_add_team_repository` | A | covered | `github_team_set_repo_access` |
| `github_archive_repo` | Sd | covered | `github_repo_set_archived` |
| `github_cancel_workflow_run` | T,Td,S,Sf,Sd,A | covered | `github_actions_cancel_run` |
| `github_check_assignee` | A | universal | `github_api_*` / `github_graphql_*` |
| `github_check_collaborator` | T,S,Sf,Sd,A | covered | `github_collab_list` |
| `github_check_dependabot_enabled` | T | covered | `github_security_get_settings` |
| `github_check_following` | S,Sf,Sd,A | universal | `github_api_*` / `github_graphql_*` |
| `github_check_gist_star` | S,Sf,Sd,A | universal | `github_api_*` / `github_graphql_*` |
| `github_check_gist_starred` | A | universal | `github_api_*` / `github_graphql_*` |
| `github_check_org_membership` | S,Sf,Sd,A | covered | `github_org_list_members` |
| `github_check_pr_merged` | A | covered | `github_pr_get` |
| `github_check_pull_request_reviewability` | S,Sf,Sd,A | covered | `github_pr_get` |
| `github_check_starred` | T,A | covered | `github_repo_star` |
| `github_check_team_permissions` | A | covered | `github_team_get` |
| `github_close_issue` | T | covered | `github_issue_update` |
| `github_close_pull_request` | T | covered | `github_pr_close` |
| `github_compare_commits` | T,Td,S,Sf,Sd,A | covered | `github_commit_compare` |
| `github_convert_issue_to_pull_request` | S,Sf,Sd,A | universal | `github_api_*` / `github_graphql_*` |
| `github_create_autolink` | A | universal | `github_api_*` / `github_graphql_*` |
| `github_create_batch_embeddings` | Sp | dropped | D1 |
| `github_create_blob` | T,S,Sf,Sd,A | covered | `github_content_push_files` |
| `github_create_branch` | T,Td,S,Sf,Sd,A | covered | `github_branch_create` |
| `github_create_chat_completion` | Sp | dropped | D1 |
| `github_create_check_run` | T | covered | `github_check_create_run` |
| `github_create_codespace` | T,S,Sf,Sd,Sp,A | covered | `github_codespace_create` |
| `github_create_codespace_secret` | Sp | covered | `github_secret_set` |
| `github_create_comment_reaction` | A | covered | `github_issue_react` |
| `github_create_commit` | T,S,Sf,Sd,A | covered | `github_content_push_files` |
| `github_create_commit_comment` | T,S,Sf,Sd,A | covered | `github_commit_comment` |
| `github_create_commit_reaction` | T | universal | `github_api_*` / `github_graphql_*` |
| `github_create_commit_status` | T,S,Sf,Sd,A | covered | `github_status_create` |
| `github_create_completion` | Sp | dropped | D1 |
| `github_create_dependabot_secret` | Sp | covered | `github_secret_set` |
| `github_create_deploy_key` | T,S,Sf,Sd,A | covered | `github_deploykey_add` |
| `github_create_deployment` | T,Td,Sd | covered | `github_deploy_create` |
| `github_create_deployment_status` | T | covered | `github_deploy_set_status` |
| `github_create_discussion` | S,Sf,Sd,A | covered | `github_discussion_create` |
| `github_create_discussion_comment` | S,Sf,Sd,A | covered | `github_discussion_comment` |
| `github_create_embedding` | Sf,Sp | dropped | D1 |
| `github_create_environment` | Td | covered | `github_env_save` |
| `github_create_environment_variable` | T | covered | `github_variable_set` |
| `github_create_fork` | T,A | covered | `github_repo_fork` |
| `github_create_from_template` | Td | covered | `github_repo_create_from_template` |
| `github_create_gist` | T,S,Sf,Sd,A | covered | `github_gist_save` |
| `github_create_git_commit` | A | covered | `github_content_push_files` |
| `github_create_inference` | Sf | dropped | D1 |
| `github_create_issue` | T,S,Sf,Sd,A | covered | `github_issue_create` |
| `github_create_issue_comment` | T,S,Sf,Sd,A | covered | `github_issue_comment` |
| `github_create_issue_comment_reaction` | T | covered | `github_issue_react` |
| `github_create_issue_reaction` | T,A | covered | `github_issue_react` |
| `github_create_label` | T,S,Sf,Sd,A | covered | `github_label_save` |
| `github_create_milestone` | T,S,Sf,Sd,A | covered | `github_milestone_save` |
| `github_create_or_update_dependabot_secret` | A | covered | `github_secret_set` |
| `github_create_or_update_environment` | T,A | covered | `github_env_save` |
| `github_create_or_update_file` | T,S,Sf,Sd,A | covered | `github_content_put_file` |
| `github_create_or_update_repo_secret` | S,Sf,Sd,A | covered | `github_secret_set` |
| `github_create_org_embedding` | Sf | dropped | D1 |
| `github_create_org_inference` | Sf | dropped | D1 |
| `github_create_org_ruleset` | T | covered | `github_ruleset_save` |
| `github_create_org_secret` | Sp | covered | `github_secret_set` |
| `github_create_org_variable` | T,Sp | covered | `github_variable_set` |
| `github_create_pages_site` | T,A | covered | `github_pages_save` |
| `github_create_pr_review_comment_reaction` | T | covered | `github_issue_react` |
| `github_create_project` | S,Sf,Sd,A | dropped | D2 |
| `github_create_project_card` | A | dropped | D2 |
| `github_create_project_column` | A | dropped | D2 |
| `github_create_project_v2` | S,Sf,Sd,A | universal | `github_api_*` / `github_graphql_*` |
| `github_create_pull` | A | covered | `github_pr_create` |
| `github_create_pull_request` | T,Td,S,Sf,Sd,A | covered | `github_pr_create` |
| `github_create_pull_request_review` | T,S,Sf,Sd,A | covered | `github_review_create` |
| `github_create_pull_request_review_comment` | T,S,Sf,Sd,A | covered | `github_review_create` |
| `github_create_ref` | T,A | covered | `github_git_update_ref` |
| `github_create_release` | T,S,Sf,Sd,A | covered | `github_release_create` |
| `github_create_repo` | T,S,Sf,Sd,A | covered | `github_repo_create` |
| `github_create_repo_project` | A | dropped | D2 |
| `github_create_repo_ruleset` | T | covered | `github_ruleset_save` |
| `github_create_repo_secret` | Sf,Sd,Sp | covered | `github_secret_set` |
| `github_create_repo_variable` | T,Sp | covered | `github_variable_set` |
| `github_create_required_workflow` | T | dropped | D3 |
| `github_create_runner_registration_token` | T | universal | `github_api_*` / `github_graphql_*` |
| `github_create_streaming_completion` | Sp | dropped | D1 |
| `github_create_tag` | A | covered | `github_tag_create` |
| `github_create_team` | T,S,Sf,Sd,A | covered | `github_team_save` |
| `github_create_tree` | T,S,Sf,Sd,A | covered | `github_content_push_files` |
| `github_create_webhook` | T,S,Sf,Sd,A | covered | `github_webhook_save` |
| `github_create_workflow_dispatch` | T,S,Sf,Sd,A | covered | `github_actions_dispatch` |
| `github_delete_actions_cache` | Sp | covered | `github_cache_delete` |
| `github_delete_artifact` | T | covered | `github_artifact_delete` |
| `github_delete_autolink` | A | universal | `github_api_*` / `github_graphql_*` |
| `github_delete_branch` | T,Td,S,Sf,Sd,A | covered | `github_branch_delete` |
| `github_delete_branch_protection` | T,S,Sf,Sd,A | covered | `github_protection_remove` |
| `github_delete_codespace` | T,S,Sf,Sd,Sp,A | covered | `github_codespace_delete` |
| `github_delete_codespace_secret` | Sp | covered | `github_secret_delete` |
| `github_delete_comment_reaction` | A | covered | `github_issue_react` |
| `github_delete_commit_comment` | A | universal | `github_api_*` / `github_graphql_*` |
| `github_delete_dependabot_secret` | T | covered | `github_secret_delete` |
| `github_delete_deploy_key` | T,A | covered | `github_deploykey_delete` |
| `github_delete_discussion` | S,Sf,Sd,A | universal | `github_api_*` / `github_graphql_*` |
| `github_delete_environment` | T,A | covered | `github_env_delete` |
| `github_delete_environment_secret` | T | covered | `github_secret_delete` |
| `github_delete_environment_variable` | T | covered | `github_variable_delete` |
| `github_delete_file` | T,S,Sf,Sd,A | covered | `github_content_delete_file` |
| `github_delete_gist` | T,S,Sf,Sd,A | covered | `github_gist_delete` |
| `github_delete_invitation` | T,S,Sf,Sd,A | covered | `github_collab_manage_invitation` |
| `github_delete_issue_comment` | T,S,Sf,Sd,A | covered | `github_issue_edit_comment` |
| `github_delete_issue_reaction` | T,A | covered | `github_issue_react` |
| `github_delete_label` | T,S,Sf,Sd,A | covered | `github_label_delete` |
| `github_delete_milestone` | T,S,Sf,Sd,A | covered | `github_milestone_delete` |
| `github_delete_org_ruleset` | T | covered | `github_ruleset_delete` |
| `github_delete_org_secret` | T,Sp | covered | `github_secret_delete` |
| `github_delete_org_variable` | T | covered | `github_variable_delete` |
| `github_delete_package` | T,S,Sf,Sd,A | **GAP → added** | `github_package_delete` |
| `github_delete_package_version` | T,S,Sf,Sd,A | covered | `github_package_delete_version` |
| `github_delete_pages_site` | T,A | covered | `github_pages_disable` |
| `github_delete_project` | A | dropped | D2 |
| `github_delete_project_card` | A | dropped | D2 |
| `github_delete_project_column` | A | dropped | D2 |
| `github_delete_project_v2` | S,Sf,Sd,A | universal | `github_api_*` / `github_graphql_*` |
| `github_delete_pull_request_review_comment` | S,Sf,Sd,A | universal | `github_api_*` / `github_graphql_*` |
| `github_delete_ref` | T,A | covered | `github_branch_delete` |
| `github_delete_release` | T,S,Sf,Sd,A | covered | `github_release_delete` |
| `github_delete_release_asset` | T,S,Sf,Sd,A | **GAP → added** | `github_release_delete_asset` |
| `github_delete_repo` | T,S,Sf,Sd,A | covered | `github_repo_delete` |
| `github_delete_repo_invitation` | A | covered | `github_collab_manage_invitation` |
| `github_delete_repo_ruleset` | T | covered | `github_ruleset_delete` |
| `github_delete_repo_secret` | T,S,Sf,Sd,Sp,A | covered | `github_secret_delete` |
| `github_delete_required_workflow` | T | dropped | D3 |
| `github_delete_secret` | Td | covered | `github_secret_delete` |
| `github_delete_self_hosted_runner` | T | universal | `github_api_*` / `github_graphql_*` |
| `github_delete_subscription` | A | covered | `github_notify_set_subscription` |
| `github_delete_team` | T,S,Sf,Sd,A | covered | `github_team_delete` |
| `github_delete_webhook` | T,S,Sf,Sd,A | covered | `github_webhook_delete` |
| `github_delete_workflow_artifact` | Sp | covered | `github_artifact_delete` |
| `github_delete_workflow_run` | T,S,Sf,Sd,A | covered | `github_actions_delete_run` |
| `github_delete_workflow_run_logs` | S,Sf,Sd,A | covered | `github_actions_delete_run` |
| `github_disable_automated_security_fixes` | T,S,Sf,Sd,A | covered | `github_security_set_feature` |
| `github_disable_vulnerability_alerts` | T,S,Sf,Sd,A | covered | `github_security_set_feature` |
| `github_disable_workflow` | T,S,Sf,Sd,A | covered | `github_actions_set_workflow_enabled` |
| `github_dismiss_code_scanning_alert` | Sp | covered | `github_security_update_alert` |
| `github_dismiss_dependabot_alert` | Td | covered | `github_security_update_alert` |
| `github_dismiss_pull_request_review` | T,S,Sf,Sd,A | covered | `github_review_dismiss` |
| `github_download_artifact` | T,Td | covered | `github_artifact_get_link` |
| `github_download_job_logs` | S,Sf,Sd,A | covered | `github_actions_get_job_log` |
| `github_download_workflow_artifact` | Sp | covered | `github_artifact_get_link` |
| `github_download_workflow_job_logs` | T | covered | `github_actions_get_job_log` |
| `github_download_workflow_logs` | Sf,Sd | covered | `github_actions_get_run_logs_summary` |
| `github_download_workflow_run_logs` | T,S,Sf,Sd,A | covered | `github_actions_get_run_logs_summary` |
| `github_enable_automated_security_fixes` | T,S,Sf,Sd,A | covered | `github_security_set_feature` |
| `github_enable_vulnerability_alerts` | T,S,Sf,Sd,A | covered | `github_security_set_feature` |
| `github_enable_workflow` | T,S,Sf,Sd,A | covered | `github_actions_set_workflow_enabled` |
| `github_follow_user` | A | universal | `github_api_*` / `github_graphql_*` |
| `github_fork_gist` | T,S,Sf,Sd,A | universal | `github_api_*` / `github_graphql_*` |
| `github_full_pr_review` | T,Td | covered | `github_workflow_pr_status` |
| `github_generate_release_notes` | T,S,Sf,Sd,A | covered | `github_release_create` |
| `github_generate_repo_from_template` | T | covered | `github_repo_create_from_template` |
| `github_get_actions_cache` | Sp | covered | `github_cache_list` |
| `github_get_actions_permissions` | Sp | covered | `github_actions_get_settings` |
| `github_get_admin_enforcement` | S,Sf,Sd,A | covered | `github_protection_get` |
| `github_get_app` | T | covered | `github_app_list_installations` |
| `github_get_archive` | S,Sf,Sd,A | covered | `github_content_get_archive_link` |
| `github_get_artifact` | T | covered | `github_artifact_list` |
| `github_get_authenticated_user` | T,S,Sf,Sd,A | covered | `github_account_get` |
| `github_get_autolink` | A | universal | `github_api_*` / `github_graphql_*` |
| `github_get_blob` | T,S,Sf,Sd,A | universal | `github_api_*` / `github_graphql_*` |
| `github_get_branch` | T,S,Sf,Sd,A | covered | `github_branch_get` |
| `github_get_branch_protection` | T,S,Sf,Sd,A | covered | `github_protection_get` |
| `github_get_branch_signature_protection` | T | covered | `github_protection_get` |
| `github_get_check_run` | A | covered | `github_check_get_run` |
| `github_get_check_suite` | A | covered | `github_check_get_ci_state` |
| `github_get_clones` | A | covered | `github_repo_get_traffic` |
| `github_get_code_scanning_alert` | T,S,Sf,Sd,Sp,A | covered | `github_security_get_alert` |
| `github_get_codeowners_errors` | T | **GAP → added** | `github_content_check_codeowners` |
| `github_get_codespace` | T,S,Sf,Sd,Sp,A | covered | `github_codespace_list` |
| `github_get_codespace_machine` | Sp | covered | `github_codespace_create` |
| `github_get_collaborator_permission` | T,S,Sf,Sd,A | covered | `github_collab_list` |
| `github_get_combined_status` | T,A | covered | `github_check_get_ci_state` |
| `github_get_commit` | T,S,Sf,Sd,A | covered | `github_commit_get` |
| `github_get_commit_comment` | A | universal | `github_api_*` / `github_graphql_*` |
| `github_get_commit_object` | T | covered | `github_git_get_commit` |
| `github_get_commit_signature_verification` | S,Sf,Sd,A | covered | `github_commit_get` |
| `github_get_commit_status` | T,S,Sf,Sd,A | covered | `github_check_get_ci_state` |
| `github_get_community_profile` | Td,A | covered | `github_repo_get_insights` |
| `github_get_content` | T,S,Sf,Sd,A | covered | `github_content_get` |
| `github_get_contributors` | A | covered | `github_repo_get_insights` |
| `github_get_copilot_billing` | T | covered | `github_copilot_get_billing` |
| `github_get_copilot_org_settings` | S,Sf,Sd,A | covered | `github_copilot_get_billing` |
| `github_get_copilot_seat_details` | Sp | covered | `github_copilot_get_billing` |
| `github_get_copilot_seat_usage` | Sp | dropped | D4 |
| `github_get_copilot_usage` | S,Sf,Sd,A | dropped | D4 |
| `github_get_copilot_usage_metrics` | Sp | dropped | D4 |
| `github_get_dependabot_alert` | T,Sp,A | covered | `github_security_get_alert` |
| `github_get_dependabot_secret` | A | covered | `github_secret_list` |
| `github_get_deploy_key` | A | covered | `github_deploykey_list` |
| `github_get_discussion` | T,S,Sf,Sd,A | covered | `github_discussion_get` |
| `github_get_embedding_model` | Sp | dropped | D1 |
| `github_get_emojis` | A | universal | `github_api_*` / `github_graphql_*` |
| `github_get_environment` | T,Td,A | covered | `github_env_get` |
| `github_get_environment_variable` | T | covered | `github_variable_list` |
| `github_get_gist` | T,S,Sf,Sd,A | covered | `github_gist_get` |
| `github_get_git_commit` | A | covered | `github_git_get_commit` |
| `github_get_gitignore_template` | A | universal | `github_api_*` / `github_graphql_*` |
| `github_get_hosted_runner` | Sp | universal | `github_api_*` / `github_graphql_*` |
| `github_get_installation` | T | covered | `github_app_get_installation` |
| `github_get_issue` | T,S,Sf,Sd,A | covered | `github_issue_get` |
| `github_get_issue_event` | A | covered | `github_issue_list_timeline` |
| `github_get_label` | A | covered | `github_label_list` |
| `github_get_latest_pages_build` | T | covered | `github_pages_get` |
| `github_get_latest_release` | T,S,Sf,Sd,A | covered | `github_release_get` |
| `github_get_license` | A | covered | `github_repo_get_insights` |
| `github_get_milestone` | T,S,Sf,Sd,A | covered | `github_milestone_list` |
| `github_get_model` | Sp | dropped | D1 |
| `github_get_oidc_custom_sub_template` | Sp | universal | `github_api_*` / `github_graphql_*` |
| `github_get_org` | T,S,Sf,Sd,A | covered | `github_org_get` |
| `github_get_org_audit_log` | T | dropped | D5 |
| `github_get_org_codespace_settings` | Sp | covered | `github_codespace_set_org_access` |
| `github_get_org_membership` | A | covered | `github_org_list_members` |
| `github_get_org_ruleset` | T | covered | `github_ruleset_get` |
| `github_get_org_secret` | T | covered | `github_secret_list` |
| `github_get_org_variable` | T | covered | `github_variable_list` |
| `github_get_package` | T,S,Sf,Sd,A | covered | `github_package_list` |
| `github_get_package_version` | S,Sf,Sd,A | covered | `github_package_list` |
| `github_get_pages` | T,A | covered | `github_pages_get` |
| `github_get_pr_review_protection` | T | covered | `github_protection_get` |
| `github_get_project` | S,Sf,Sd,A | covered | `github_project_get` |
| `github_get_project_v2` | S,Sf,Sd,A | covered | `github_project_get` |
| `github_get_pull_request` | T,S,Sf,Sd,A | covered | `github_pr_get` |
| `github_get_pull_request_diff` | T,S,Sf,Sd,A | covered | `github_pr_get_diff` |
| `github_get_pull_request_merge_status` | S,Sf,Sd,A | covered | `github_pr_get` |
| `github_get_pull_request_patch` | S,Sf,Sd,A | covered | `github_pr_get_diff` |
| `github_get_pull_request_review` | S,Sf,Sd,A | covered | `github_review_list` |
| `github_get_pull_request_review_enforcement` | S,Sf,Sd,A | covered | `github_protection_get` |
| `github_get_rate_limit` | T | covered | `github_rate_status` |
| `github_get_readme` | A | covered | `github_content_get` |
| `github_get_ref` | T,S,Sf,Sd,A | covered | `github_git_get_ref` |
| `github_get_release` | T,S,Sf,Sd,A | covered | `github_release_get` |
| `github_get_release_asset` | T,S,Sf,Sd,A | covered | `github_release_get` |
| `github_get_release_by_tag` | T,S,Sf,Sd,A | covered | `github_release_get` |
| `github_get_repo` | T,S,Sf,Sd,A | covered | `github_repo_get` |
| `github_get_repo_clones` | T,S,Sf,Sd,A | covered | `github_repo_get_traffic` |
| `github_get_repo_community_profile` | T,S,Sf,Sd,A | covered | `github_repo_get_insights` |
| `github_get_repo_license` | T,S,Sf,Sd,A | covered | `github_repo_get_insights` |
| `github_get_repo_public_key` | A | covered | `github_secret_set` |
| `github_get_repo_readme` | T,Td,S,Sf,Sd,A | covered | `github_content_get` |
| `github_get_repo_ruleset` | T,A | covered | `github_ruleset_get` |
| `github_get_repo_secret` | A | covered | `github_secret_list` |
| `github_get_repo_stats_commit_activity` | S,Sf,Sd,A | covered | `github_repo_get_insights` |
| `github_get_repo_stats_contributors` | T,S,Sf,Sd,A | covered | `github_repo_get_insights` |
| `github_get_repo_subscription` | T | covered | `github_notify_set_subscription` |
| `github_get_repo_top_paths` | S,Sf,Sd,A | covered | `github_repo_get_traffic` |
| `github_get_repo_top_referrers` | T,S,Sf,Sd,A | covered | `github_repo_get_traffic` |
| `github_get_repo_views` | T,S,Sf,Sd,A | covered | `github_repo_get_traffic` |
| `github_get_required_status_checks` | T,S,Sf,Sd,A | covered | `github_protection_get` |
| `github_get_sarif_upload` | T | universal | `github_api_*` / `github_graphql_*` |
| `github_get_secret_scanning_alert` | Sp | covered | `github_security_get_alert` |
| `github_get_self_hosted_runner` | T | universal | `github_api_*` / `github_graphql_*` |
| `github_get_stats_commit_activity` | A | covered | `github_repo_get_insights` |
| `github_get_stats_contributors` | A | covered | `github_repo_get_insights` |
| `github_get_stats_participation` | A | covered | `github_repo_get_insights` |
| `github_get_stats_punch_card` | A | covered | `github_repo_get_insights` |
| `github_get_subscription` | A | covered | `github_notify_set_subscription` |
| `github_get_tag` | A | universal | `github_api_*` / `github_graphql_*` |
| `github_get_team` | T,S,Sf,Sd,A | covered | `github_team_get` |
| `github_get_thread` | A | covered | `github_notify_list` |
| `github_get_top_paths` | A | covered | `github_repo_get_traffic` |
| `github_get_top_referrers` | A | covered | `github_repo_get_traffic` |
| `github_get_topics` | A | covered | `github_repo_update_settings` |
| `github_get_tree` | T,S,Sf,Sd,A | covered | `github_content_get_tree` |
| `github_get_user` | T,S,Sf,Sd,A | universal | `github_api_*` / `github_graphql_*` |
| `github_get_views` | A | covered | `github_repo_get_traffic` |
| `github_get_webhook` | T,S,Sf,Sd,A | covered | `github_webhook_get` |
| `github_get_workflow` | T,S,Sf,Sd,A | covered | `github_actions_list_workflows` |
| `github_get_workflow_artifact` | Sp | covered | `github_artifact_list` |
| `github_get_workflow_job` | Sf,Sd | covered | `github_actions_get_run` |
| `github_get_workflow_job_logs` | Td | covered | `github_actions_get_job_log` |
| `github_get_workflow_run` | T,Td,S,Sf,Sd,A | covered | `github_actions_get_run` |
| `github_get_workflow_run_attempt` | T | covered | `github_actions_get_run` |
| `github_get_workflow_run_job` | T,S,Sf,Sd,A | covered | `github_actions_get_run` |
| `github_get_workflow_run_usage` | T | dropped | D6 |
| `github_get_workflow_usage` | T | dropped | D6 |
| `github_list_actions_cache` | Sp | covered | `github_cache_list` |
| `github_list_app_repos` | T | covered | `github_app_get_installation` |
| `github_list_artifacts` | Td,Sd | covered | `github_artifact_list` |
| `github_list_assignees` | A | universal | `github_api_*` / `github_graphql_*` |
| `github_list_autolinks` | A | universal | `github_api_*` / `github_graphql_*` |
| `github_list_branches` | T,S,Sf,Sd,A | covered | `github_branch_list` |
| `github_list_check_runs_for_commit` | T | covered | `github_check_get_ci_state` |
| `github_list_check_runs_for_ref` | A | covered | `github_check_get_ci_state` |
| `github_list_check_suites_for_ref` | A | covered | `github_check_get_ci_state` |
| `github_list_code_owners` | Td | covered | `github_content_get` |
| `github_list_code_scanning_alerts` | T,Td,S,Sf,Sd,Sp,A | covered | `github_security_list_alerts` |
| `github_list_code_scanning_analyses` | Sp,A | universal | `github_api_*` / `github_graphql_*` |
| `github_list_codespace_machines` | T,Sp | covered | `github_codespace_create` |
| `github_list_codespace_secrets` | Sp | covered | `github_secret_list` |
| `github_list_codespaces` | T,S,Sf,Sd,Sp,A | covered | `github_codespace_list` |
| `github_list_collaborators` | T,S,Sf,Sd,A | covered | `github_collab_list` |
| `github_list_comment_reactions` | A | covered | `github_issue_react` |
| `github_list_commit_comments` | T,S,Sf,Sd,A | covered | `github_commit_comment` |
| `github_list_commit_statuses` | S,Sf,Sd,A | covered | `github_check_get_ci_state` |
| `github_list_commits` | T,S,Sf,Sd,A | covered | `github_commit_list` |
| `github_list_copilot_metrics` | Sp | dropped | D4 |
| `github_list_copilot_seats` | T,S,Sf,Sd,A | covered | `github_copilot_get_billing` |
| `github_list_dependabot_alerts` | T,Td,Sp,A | covered | `github_security_list_alerts` |
| `github_list_dependabot_org_alerts` | T | covered | `github_security_list_alerts` |
| `github_list_dependabot_secrets` | T,Sp,A | covered | `github_secret_list` |
| `github_list_deploy_keys` | T,S,Sf,Sd,A | covered | `github_deploykey_list` |
| `github_list_deployment_statuses` | T | covered | `github_deploy_list` |
| `github_list_deployments` | T,Td | covered | `github_deploy_list` |
| `github_list_discussion_categories` | T,S,Sf,Sd,A | covered | `github_discussion_list` |
| `github_list_discussion_comments` | S,Sf,Sd,A | covered | `github_discussion_get` |
| `github_list_discussions` | T,S,Sf,Sd,A | covered | `github_discussion_list` |
| `github_list_environment_secrets` | T | covered | `github_secret_list` |
| `github_list_environment_variables` | T | covered | `github_variable_list` |
| `github_list_environments` | T,Td,A | covered | `github_env_list` |
| `github_list_followers` | A | universal | `github_api_*` / `github_graphql_*` |
| `github_list_following` | A | universal | `github_api_*` / `github_graphql_*` |
| `github_list_forks` | T,A | universal | `github_api_*` / `github_graphql_*` |
| `github_list_gist_commits` | S,Sf,Sd,A | covered | `github_gist_get` |
| `github_list_gist_forks` | Sp | universal | `github_api_*` / `github_graphql_*` |
| `github_list_gists` | T,S,Sf,Sd,A | covered | `github_gist_list` |
| `github_list_gitignore_templates` | A | universal | `github_api_*` / `github_graphql_*` |
| `github_list_hosted_runners` | Sp | universal | `github_api_*` / `github_graphql_*` |
| `github_list_installations` | T | covered | `github_app_list_installations` |
| `github_list_invitations` | T,S,Sf,Sd,A | covered | `github_collab_list` |
| `github_list_issue_comment_reactions` | T | covered | `github_issue_react` |
| `github_list_issue_comments` | T,S,Sf,Sd,A | covered | `github_issue_list_comments` |
| `github_list_issue_events` | T,S,Sf,Sd,A | covered | `github_issue_list_timeline` |
| `github_list_issue_reactions` | T,A | covered | `github_issue_react` |
| `github_list_issue_timeline` | T,S,Sf,Sd,A | covered | `github_issue_list_timeline` |
| `github_list_issues` | T,S,Sf,Sd,A | covered | `github_issue_list` |
| `github_list_labels` | T,S,Sf,Sd,A | covered | `github_label_list` |
| `github_list_languages` | A | covered | `github_repo_get_insights` |
| `github_list_milestones` | T,S,Sf,Sd,A | covered | `github_milestone_list` |
| `github_list_models` | Sf,Sp | dropped | D1 |
| `github_list_notifications` | T,A | covered | `github_notify_list` |
| `github_list_org_codespaces` | Sp | covered | `github_codespace_list` |
| `github_list_org_members` | T,S,Sf,Sd,A | covered | `github_org_list_members` |
| `github_list_org_projects_v2` | S,Sf,Sd,A | covered | `github_project_list` |
| `github_list_org_repos` | T,Sd | covered | `github_repo_list` |
| `github_list_org_rulesets` | T | covered | `github_ruleset_list` |
| `github_list_org_secrets` | T,Sp | covered | `github_secret_list` |
| `github_list_org_self_hosted_runners` | T | universal | `github_api_*` / `github_graphql_*` |
| `github_list_org_teams` | T,S,Sf,Sd,A | covered | `github_team_list` |
| `github_list_org_variables` | T,Sp | covered | `github_variable_list` |
| `github_list_orgs` | A | covered | `github_list_accounts` |
| `github_list_package_versions` | T,S,Sf,Sd,A | covered | `github_package_list` |
| `github_list_packages` | T,Td,S,Sf,Sd,A | covered | `github_package_list` |
| `github_list_pages_builds` | A | covered | `github_pages_get` |
| `github_list_popular_paths` | Td | covered | `github_repo_get_traffic` |
| `github_list_pr_associated_with_commit` | T | covered | `github_commit_list_prs` |
| `github_list_pr_commits` | A | covered | `github_pr_list_commits` |
| `github_list_pr_files` | A | covered | `github_pr_list_files` |
| `github_list_pr_review_comment_reactions` | T | covered | `github_issue_react` |
| `github_list_project_cards` | A | dropped | D2 |
| `github_list_project_columns` | A | dropped | D2 |
| `github_list_project_items` | S,Sf,Sd,A | covered | `github_project_list_items` |
| `github_list_projects` | S,Sf,Sd,A | covered | `github_project_list` |
| `github_list_pull_request_commits` | T,S,Sf,Sd,A | covered | `github_pr_list_commits` |
| `github_list_pull_request_files` | T,S,Sf,Sd,A | covered | `github_pr_list_files` |
| `github_list_pull_request_review_comments` | T,S,Sf,Sd,A | covered | `github_review_list_comments` |
| `github_list_pull_request_reviews` | T,S,Sf,Sd,A | covered | `github_review_list` |
| `github_list_pull_requests` | T,S,Sf,Sd,A | covered | `github_pr_list` |
| `github_list_pull_requests_associated_with_commit` | S,Sf,Sd,A | covered | `github_commit_list_prs` |
| `github_list_referring_sites` | Td | covered | `github_repo_get_traffic` |
| `github_list_refs` | A | covered | `github_git_get_ref` |
| `github_list_release_assets` | T,S,Sf,Sd,A | covered | `github_release_list` |
| `github_list_releases` | T,S,Sf,Sd,A | covered | `github_release_list` |
| `github_list_repo_activity` | T | covered | `github_repo_list_activity` |
| `github_list_repo_codespaces` | T,S,Sf,Sd,A | covered | `github_codespace_list` |
| `github_list_repo_contributors` | T,S,Sf,Sd,A | covered | `github_repo_get_insights` |
| `github_list_repo_invitations` | A | covered | `github_collab_list` |
| `github_list_repo_languages` | T,S,Sf,Sd,A | covered | `github_repo_get_insights` |
| `github_list_repo_projects` | A | dropped | D2 |
| `github_list_repo_rulesets` | T,A | covered | `github_ruleset_list` |
| `github_list_repo_secrets` | T,S,Sf,Sd,Sp,A | covered | `github_secret_list` |
| `github_list_repo_tags` | T,S,Sf,Sd,A | covered | `github_tag_list` |
| `github_list_repo_teams` | S,Sf,Sd,A | covered | `github_team_list` |
| `github_list_repo_topics` | T,Td,S,Sf,Sd,A | covered | `github_repo_update_settings` |
| `github_list_repo_variables` | T,Sp | covered | `github_variable_list` |
| `github_list_repos` | T,S,Sf,Sd,A | covered | `github_repo_list` |
| `github_list_requested_reviewers` | S,Sf,Sd,A | covered | `github_review_request_reviewers` |
| `github_list_required_workflows` | T | dropped | D3 |
| `github_list_runner_applications` | T | universal | `github_api_*` / `github_graphql_*` |
| `github_list_secret_scanning_alerts` | T,S,Sf,Sd,Sp,A | covered | `github_security_list_alerts` |
| `github_list_secret_scanning_locations` | Sp | universal | `github_api_*` / `github_graphql_*` |
| `github_list_secrets` | Td | covered | `github_secret_list` |
| `github_list_self_hosted_runners` | T | universal | `github_api_*` / `github_graphql_*` |
| `github_list_stargazers` | T,Td | universal | `github_api_*` / `github_graphql_*` |
| `github_list_starred` | A | universal | `github_api_*` / `github_graphql_*` |
| `github_list_tags` | A | covered | `github_tag_list` |
| `github_list_team_members` | T,S,Sf,Sd,A | covered | `github_team_get` |
| `github_list_teams` | A | covered | `github_team_list` |
| `github_list_traffic_clones` | Td | covered | `github_repo_get_traffic` |
| `github_list_traffic_views` | Td | covered | `github_repo_get_traffic` |
| `github_list_user_followers` | T,S,Sf,Sd,A | universal | `github_api_*` / `github_graphql_*` |
| `github_list_user_following` | T,S,Sf,Sd,A | universal | `github_api_*` / `github_graphql_*` |
| `github_list_user_gists` | S,Sf,Sd,A | covered | `github_gist_list` |
| `github_list_user_orgs` | S,Sf,Sd,A | covered | `github_list_accounts` |
| `github_list_user_repos` | T,S,Sf,Sd,A | covered | `github_repo_list` |
| `github_list_user_starred` | T | universal | `github_api_*` / `github_graphql_*` |
| `github_list_watchers` | T,A | universal | `github_api_*` / `github_graphql_*` |
| `github_list_webhook_deliveries` | S,Sf,Sd,A | covered | `github_webhook_list_deliveries` |
| `github_list_webhooks` | T,S,Sf,Sd,A | covered | `github_webhook_list` |
| `github_list_workflow_artifacts` | Sp | covered | `github_artifact_list` |
| `github_list_workflow_jobs` | Td,Sf,Sd | covered | `github_actions_get_run` |
| `github_list_workflow_run_artifacts` | T,S,Sf,Sd,A | covered | `github_artifact_list` |
| `github_list_workflow_run_jobs` | T,S,Sf,Sd,A | covered | `github_actions_get_run` |
| `github_list_workflow_runs` | T,Td,S,Sf,Sd,A | covered | `github_actions_list_runs` |
| `github_list_workflows` | T,S,Sf,Sd,A | covered | `github_actions_list_workflows` |
| `github_lock_issue` | T,S,Sf,Sd,A | covered | `github_issue_lock` |
| `github_mark_notifications_read` | T,A | covered | `github_notify_mark` |
| `github_mark_thread_read` | T,A | covered | `github_notify_mark` |
| `github_merge_branch` | T,S,Sf,Sd,A | covered | `github_branch_merge` |
| `github_merge_pull_request` | T,S,Sf,Sd,A | covered | `github_pr_merge` |
| `github_org_security_posture` | T | covered | `github_workflow_security_review` |
| `github_ping_webhook` | T,S,Sf,Sd,A | covered | `github_webhook_ping` |
| `github_release_from_tag` | T,Td | covered | `github_workflow_release` |
| `github_remove_admin_branch_protection` | T | covered | `github_protection_set` |
| `github_remove_assignees` | T,S,Sf,Sd,A | covered | `github_issue_set_assignees` |
| `github_remove_collaborator` | T,S,Sf,Sd,A | covered | `github_collab_remove` |
| `github_remove_copilot_seats` | T,S,Sf,Sd,A | covered | `github_copilot_remove_seats` |
| `github_remove_label` | T,S,Sf,Sd,A | covered | `github_issue_set_labels` |
| `github_remove_label_from_issue` | A | covered | `github_issue_set_labels` |
| `github_remove_org_member` | S,Sf,Sd,A | covered | `github_org_remove_member` |
| `github_remove_project_item` | S,Sf,Sd,A | covered | `github_project_remove_item` |
| `github_remove_pull_request_reviewers` | T,S,Sf,Sd,A | covered | `github_review_request_reviewers` |
| `github_remove_requested_reviewers` | A | covered | `github_review_request_reviewers` |
| `github_remove_team_member` | T | covered | `github_team_set_member` |
| `github_remove_team_repository` | A | covered | `github_team_set_repo_access` |
| `github_rename_branch` | T,S,Sf,Sd,A | covered | `github_branch_rename` |
| `github_replace_labels` | T,S,Sf,Sd,A | covered | `github_issue_set_labels` |
| `github_replace_labels_for_issue` | A | covered | `github_issue_set_labels` |
| `github_replace_repo_topics` | T,Td,S,Sf,Sd,A | covered | `github_repo_update_settings` |
| `github_replace_topics` | A | covered | `github_repo_update_settings` |
| `github_repo_contents` | Sd | covered | `github_content_get` |
| `github_repo_create` | Sd | covered | `github_repo_create` |
| `github_repo_delete` | Sd | covered | `github_repo_delete` |
| `github_repo_dependency_audit` | T | covered | `github_workflow_security_review` |
| `github_repo_get` | Sd | covered | `github_repo_get` |
| `github_repo_health_audit` | T,Td | covered | `github_workflow_repo_health` |
| `github_repo_list` | Sd | covered | `github_repo_list` |
| `github_repo_tree` | Sd | covered | `github_content_get_tree` |
| `github_repo_update` | Sd | covered | `github_repo_update_settings` |
| `github_request_pages_build` | T,A | covered | `github_pages_save` |
| `github_request_pull_request_reviewers` | T,S,Sf,Sd,A | covered | `github_review_request_reviewers` |
| `github_request_reviewers` | A | covered | `github_review_request_reviewers` |
| `github_rerun_failed_jobs` | T,S,Sf,Sd,A | covered | `github_actions_rerun` |
| `github_rerun_workflow` | T,Td,S,Sf,Sd,A | covered | `github_actions_rerun` |
| `github_restore_package` | S,Sf,Sd,A | covered | `github_package_restore_version` |
| `github_restore_package_version` | S,Sf,Sd,A | covered | `github_package_restore_version` |
| `github_safe_delete_merged_branches` | T | covered | `github_workflow_cleanup_branches` |
| `github_search_code` | T,S,Sf,Sd,A | covered | `github_search_github` |
| `github_search_commits` | T,S,Sf,Sd,A | covered | `github_search_github` |
| `github_search_issues` | T,S,Sf,Sd,A | covered | `github_search_github` |
| `github_search_models` | Sp | dropped | D1 |
| `github_search_repos` | Sd,A | covered | `github_search_github` |
| `github_search_repositories` | T,S,Sf,Sd,A | covered | `github_search_github` |
| `github_search_topics` | T,S,Sf,Sd,A | universal | `github_api_*` / `github_graphql_*` |
| `github_search_users` | T,S,Sf,Sd,A | covered | `github_search_github` |
| `github_set_actions_permissions` | Sp | covered | `github_actions_set_settings` |
| `github_set_admin_branch_protection` | T | covered | `github_protection_set` |
| `github_set_admin_enforcement` | S,Sf,Sd,A | covered | `github_protection_set` |
| `github_set_branch_signature_protection` | T | covered | `github_protection_set` |
| `github_set_oidc_custom_sub_template` | Sp | universal | `github_api_*` / `github_graphql_*` |
| `github_set_org_membership` | A | covered | `github_org_set_member_role` |
| `github_set_repo_subscription` | T | covered | `github_notify_set_subscription` |
| `github_set_secret` | Td | covered | `github_secret_set` |
| `github_set_subscription` | A | covered | `github_notify_set_subscription` |
| `github_setup_branch_protection` | T,Td | covered | `github_workflow_new_repo` |
| `github_star_gist` | T,S,Sf,Sd,A | universal | `github_api_*` / `github_graphql_*` |
| `github_star_repo` | T,A | covered | `github_repo_star` |
| `github_start_codespace` | T,S,Sf,Sd,Sp,A | covered | `github_codespace_set_state` |
| `github_stop_codespace` | T,S,Sf,Sd,Sp,A | covered | `github_codespace_set_state` |
| `github_submit_pull_request_review` | T,S,Sf,Sd,A | covered | `github_review_submit` |
| `github_sync_fork` | T,Td | covered | `github_repo_sync_fork` |
| `github_test_webhook` | S,Sf,Sd,A | covered | `github_webhook_ping` |
| `github_transfer_repo` | T,S,Sf,Sd,A | covered | `github_repo_transfer` |
| `github_trigger_workflow` | A | covered | `github_actions_dispatch` |
| `github_unfollow_user` | A | universal | `github_api_*` / `github_graphql_*` |
| `github_unlock_issue` | T,S,Sf,Sd,A | covered | `github_issue_lock` |
| `github_unstar_gist` | T,S,Sf,Sd,A | universal | `github_api_*` / `github_graphql_*` |
| `github_unstar_repo` | T,A | covered | `github_repo_star` |
| `github_unsubscribe_repo` | T | covered | `github_notify_set_subscription` |
| `github_update_authenticated_user` | S,Sf,Sd,A | covered | `github_account_update_profile` |
| `github_update_branch_protection` | T,S,Sf,Sd,A | covered | `github_protection_set` |
| `github_update_check_run` | T | covered | `github_check_update_run` |
| `github_update_code_scanning_alert` | T,S,Sf,Sd,Sp,A | covered | `github_security_update_alert` |
| `github_update_commit_comment` | A | universal | `github_api_*` / `github_graphql_*` |
| `github_update_copilot_org_settings` | Sp | universal | `github_api_*` / `github_graphql_*` |
| `github_update_dependabot_alert` | T,Sp,A | covered | `github_security_update_alert` |
| `github_update_discussion` | S,Sf,Sd,A | universal | `github_api_*` / `github_graphql_*` |
| `github_update_environment_variable` | T | covered | `github_variable_set` |
| `github_update_gist` | T,S,Sf,Sd,A | covered | `github_gist_save` |
| `github_update_invitation` | S,Sf,Sd,A | covered | `github_collab_manage_invitation` |
| `github_update_issue` | T,S,Sf,Sd,A | covered | `github_issue_update` |
| `github_update_issue_comment` | T,S,Sf,Sd,A | covered | `github_issue_edit_comment` |
| `github_update_label` | T,A | covered | `github_label_save` |
| `github_update_milestone` | T,S,Sf,Sd,A | covered | `github_milestone_save` |
| `github_update_org` | S,Sf,Sd,A | covered | `github_org_update_settings` |
| `github_update_org_ruleset` | T | covered | `github_ruleset_save` |
| `github_update_pages` | A | covered | `github_pages_save` |
| `github_update_pr_branch` | A | covered | `github_pr_update_branch` |
| `github_update_project` | A | dropped | D2 |
| `github_update_project_column` | A | dropped | D2 |
| `github_update_project_v2` | S,Sf,Sd,A | universal | `github_api_*` / `github_graphql_*` |
| `github_update_pull_request` | T,S,Sf,Sd,A | covered | `github_pr_update` |
| `github_update_pull_request_branch` | T,S,Sf,Sd,A | covered | `github_pr_update_branch` |
| `github_update_pull_request_review_comment` | S,Sf,Sd,A | universal | `github_api_*` / `github_graphql_*` |
| `github_update_pull_request_review_enforcement` | S,Sf,Sd,A | covered | `github_protection_set` |
| `github_update_ref` | T,Sf,A | covered | `github_git_update_ref` |
| `github_update_release` | T,S,Sf,Sd,A | covered | `github_release_update` |
| `github_update_release_asset` | T,S,Sf,Sd,A | universal | `github_api_*` / `github_graphql_*` |
| `github_update_repo` | T,S,Sf,Sd,A | covered | `github_repo_update_settings` |
| `github_update_repo_invitation` | A | covered | `github_collab_manage_invitation` |
| `github_update_repo_ruleset` | T | covered | `github_ruleset_save` |
| `github_update_required_status_checks` | S,Sf,Sd,A | covered | `github_protection_set_required_checks` |
| `github_update_secret_scanning_alert` | T,S,Sf,Sd,Sp,A | covered | `github_security_update_alert` |
| `github_update_team` | S,Sf,Sd,A | covered | `github_team_save` |
| `github_update_webhook` | T,S,Sf,Sd,A | covered | `github_webhook_save` |
| `github_upload_release_asset` | T | covered | `github_release_upload_asset` |
| `github_upload_sarif` | T | universal | `github_api_*` / `github_graphql_*` |

### Planned categories with no tool names (`github-api-coverage-analysis.md`, `GITHUB-COMPLETION-PLAN.md`)

| Planned category | Where it lives now |
|---|---|
| Repository caching; Actions cache | `github_cache_list`, `github_cache_delete` |
| Repository custom properties, rule suites, rules | `github_repo_*_custom_properties`, `github_ruleset_*`, `github_ruleset_list_rule_suites` |
| Issue dependencies, sub-issues | `github_issue_set_dependency`, `github_issue_set_sub_issue` |
| Organization issue types | universal (ROADMAP) |
| PR review requests and dismissals | `github_review_request_reviewers`, `github_review_dismiss` |
| Git refs management | `github_git_get_ref`, `github_git_update_ref`, `github_branch_*`, `github_tag_*` |
| Gist comments | universal |
| Actions permissions, OIDC subject templates | `github_actions_get_settings` / `github_actions_set_settings`; OIDC universal |
| Self-hosted runners, runner groups, hosted runners | universal (hosted runners classified as spend; ROADMAP) |
| Org API insights, artifact metadata, attestations, network configurations | universal (ROADMAP: SBOM and attestations) |
| Org blocking, outside collaborators, roles, security managers | `github_org_set_blocked`, `github_org_set_outside_collaborator`, `github_role_*` |
| Org personal access tokens | `github_tokenpolicy_*` |
| Org webhooks | `github_webhook_*` (organization scope) |
| Team discussions | universal |
| Deployments: branch policies, protection rules, statuses | `github_env_save`, `github_deploy_*` |
| Checks: runs and suites | `github_check_*` |
| Packages, Pages | `github_package_*`, `github_pages_*` |
| Codespaces: org settings, secrets, machines | `github_codespace_*`, `github_secret_*` (kind `codespaces`) |
| Copilot metrics, seat management | `github_copilot_*`; metrics dropped (D4) |
| **Dependency graph: dependency review** | **GAP → added `github_security_compare_dependencies`** |
| Dependency graph: dependency submission, SBOM export | universal (ROADMAP: SBOM) |
| Billing, metrics, activity, apps (phase 4) | `github_billing_*`, `github_repo_get_insights`, `github_repo_list_activity`, `github_notify_*`, `github_app_*` |
| Models catalog, embeddings, inference | dropped (D1) |

## 4. Gaps closed (added to `docs/TOOL-CATALOG.md`, designs and work index)

| New tool | Prior name(s) | Why it is a real gap | GitHub operation (2026-03-10) | Card |
|---|---|---|---|---|
| `github_content_check_codeowners` | `github_get_codeowners_errors` (T) | A repository can route every path to its owner in `.github/CODEOWNERS`; a broken line silently stops code-owner review rules from working. No new tool read it; `github_content_get` only returns the raw file | `GET /repos/{owner}/{repo}/codeowners/errors` ([docs](https://docs.github.com/en/rest/repos/repos#list-codeowners-errors)) | D-2 |
| `github_release_delete_asset` | `github_delete_release_asset` (T, S, A) | A wrong build attached to a release could only be removed by deleting the whole release. `github_release_update_asset` (rename/label) stays universal | `DELETE /repos/{owner}/{repo}/releases/assets/{asset_id}` | G-5 |
| `github_package_delete` | `github_delete_package` (T, S, A); restore: `github_restore_package` (S, A) | Clearing out an old container image or npm package took one call per version. Restore of a whole package folds into `github_package_restore_version` | `DELETE /orgs/{org}/packages/{type}/{name}`, `/user/…`, `/users/{username}/…`; restore `POST …/restore` (30 days; public packages over 5,000 downloads refused) ([docs](https://docs.github.com/en/rest/packages/packages#delete-a-package-for-an-organization), read 2026-10-10) | G-6 |
| `github_security_compare_dependencies` | planned category "Dependency Review" (Sp) | Dependabot can open many dependency PRs in one repository; before merging, an agent needs "which dependencies does this PR add or change, and are any vulnerable". Nothing in the catalog answered that | `GET /repos/{owner}/{repo}/dependency-graph/compare/{basehead}` (Contents read; private repos need Advanced Security/Code Security, otherwise 403 → `not_available_on_plan`) ([docs](https://docs.github.com/en/rest/dependency-graph/dependency-review), read 2026-10-10) | H-4 |

Totals after the gap check: **305 tools = 299 hand-built + 6 universal** (was 301 = 295 + 6), counted by
`python3 scripts/count-catalog.py`.

Not added (judged covered or not worth a hand-built tool): commit-comment and review-comment edit/delete, discussion
edit/delete, autolinks, forks/stargazers/watchers lists, followers, gist star/fork, SARIF upload and code-scanning
analyses, runner tools and OIDC templates — all reachable through the universal tools with the same guards, and the
ROADMAP rule ("hand-build when the change log shows repeated universal calls") applies.
