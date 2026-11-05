// U-1: curated tools preserve specialized guards; never permit universal bypass.
// Non-exhaustive examples beyond the patterns remain subject to conservative production classification.
// A route is not a family of operations: method and full path are part of the
// authority boundary. In particular a DELETE cannot instruct an agent to POST,
// and a metered or security-sensitive operation must never point at an
// unrelated weaker specialized tool. Keep these aligned with provider calls in
// the named writers; do not route generic operations that have no equivalent.
const exact = new Map([
  // CAP-4: these organization SAML endpoints require owner/Administration
  // approval and a bounded preflight; generic REST must not bypass the
  // dedicated exact-login/credential journal and independent readback.
  ['GET /orgs/{org}/credential-authorizations', 'github_org_saml_authorizations'],
  ['DELETE /orgs/{org}/credential-authorizations/{credential_id}', 'github_org_saml_revoke_authorization'],
  // CAP-4: App-owner JWT-only routes. Each is served by a native tool bound to
  // the enrolled App owner (never a tool-supplied JWT). The universal policy
  // already refuses every /app path; these entries record the exact native
  // dispatch for the capability inventory and API describe. `GET /app` is
  // deliberately NOT mapped: github_app_owner_identity returns a bounded
  // identity projection, not an equivalent of the raw route.
  ['GET /app/hook/config', 'github_app_webhook_configuration'],
  ['PATCH /app/hook/config', 'github_app_webhook_configuration_set'],
  ['GET /app/hook/deliveries', 'github_app_webhook_deliveries'],
  ['GET /app/hook/deliveries/{delivery_id}', 'github_app_webhook_deliveries'],
  ['POST /app/hook/deliveries/{delivery_id}/attempts', 'github_app_webhook_redeliver'],
  ['GET /app/installations/{installation_id}', 'github_app_owner_installation_grants'],
  ['GET /app/installation-requests', 'github_app_owner_installation_requests'],
  // O-4: budgets and Codespaces are separate guarded writes.
  ['POST /organizations/{org}/settings/billing/budgets', 'github_billing_save_budget'],
  ['PATCH /organizations/{org}/settings/billing/budgets/{budget_id}', 'github_billing_save_budget'],
  ['DELETE /organizations/{org}/settings/billing/budgets/{budget_id}', 'github_billing_delete_budget'],
  ['PUT /orgs/{org}/codespaces/access', 'github_codespace_set_org_access'],
  ['POST /repos/{owner}/{repo}/codespaces', 'github_codespace_create'],
  ['POST /user/codespaces/{codespace_name}/start', 'github_codespace_set_state'],
  ['POST /user/codespaces/{codespace_name}/stop', 'github_codespace_set_state'],
  ['DELETE /user/codespaces/{codespace_name}', 'github_codespace_delete'],
  // Paid Copilot seats: removal never shares the purchasing handler.
  ['POST /orgs/{org}/copilot/billing/selected_users', 'github_copilot_add_seats'],
  ['DELETE /orgs/{org}/copilot/billing/selected_users', 'github_copilot_remove_seats'],
  ['POST /orgs/{org}/copilot/billing/selected_teams', 'github_copilot_team_seats'],
  ['DELETE /orgs/{org}/copilot/billing/selected_teams', 'github_copilot_team_seats_remove'],
  ['PUT /orgs/{org}/copilot/coding-agent/permissions', 'github_copilot_agent_policy_set'],
  ['PUT /orgs/{org}/copilot/content_exclusion', 'github_copilot_content_exclusions_set'],
  // CAP-7 M2: deployment-record delete is served by the guarded named tool, never the universal door.
  ['DELETE /repos/{owner}/{repo}/deployments/{deployment_id}', 'github_deploy_delete'],
  ['PUT /orgs/{org}/copilot/coding-agent/permissions/repositories/{repository_id}', 'github_copilot_agent_repo_set'],
  ['DELETE /orgs/{org}/copilot/coding-agent/permissions/repositories/{repository_id}', 'github_copilot_agent_repo_set'],
  // PAR-4: enterprise writes with dedicated policy/scope/affected-repository
  // guards MUST NOT enter through universal REST. Exact method and route only:
  // global security config attach/default must run protectedInside() first.
  ['POST /enterprises/{enterprise}/code-security/configurations', 'github_enterprise_security_config_save'],
  ['PATCH /enterprises/{enterprise}/code-security/configurations/{configuration_id}', 'github_enterprise_security_config_save'],
  ['DELETE /enterprises/{enterprise}/code-security/configurations/{configuration_id}', 'github_enterprise_security_config_delete'],
  ['POST /enterprises/{enterprise}/code-security/configurations/{configuration_id}/attach', 'github_enterprise_security_config_apply'],
  ['PUT /enterprises/{enterprise}/code-security/configurations/{configuration_id}/defaults', 'github_enterprise_security_config_apply'],
  ['PUT /enterprises/{enterprise}/dependabot/repository-access/default-level', 'github_enterprise_dependabot_access_set'],
  ['PATCH /enterprises/{enterprise}/dependabot/repository-access', 'github_enterprise_dependabot_access_set'],
  ['PUT /enterprises/{enterprise}/actions/cache/retention-limit', 'github_enterprise_actions_settings_set'],
  ['PUT /enterprises/{enterprise}/actions/cache/storage-limit', 'github_enterprise_actions_settings_set'],
  ['POST /enterprises/{enterprise}/actions/oidc/customization/properties/repo', 'github_enterprise_actions_settings_set'],
  ['DELETE /enterprises/{enterprise}/actions/oidc/customization/properties/repo/{custom_property_name}', 'github_enterprise_actions_settings_set'],
  // Hosted runner capacity has independently guarded create, manage, scale.
  ['POST /orgs/{org}/actions/hosted-runners', 'github_hosted_runner_create'],
  ['PATCH /orgs/{org}/actions/hosted-runners/{hosted_runner_id}', 'github_hosted_runner_manage'],
  ['DELETE /orgs/{org}/actions/hosted-runners/{hosted_runner_id}', 'github_hosted_runner_manage'],
  // Y-7: private paid security policy is explicitly consented and verified.
  ['POST /orgs/{org}/code-security/configurations', 'github_security_config_save'],
  ['PATCH /orgs/{org}/code-security/configurations/{configuration_id}', 'github_security_config_save'],
  ['DELETE /orgs/{org}/code-security/configurations/{configuration_id}', 'github_security_config_delete'],
  ['POST /orgs/{org}/code-security/configurations/{configuration_id}/attach', 'github_security_config_attach'],
  ['PUT /orgs/{org}/code-security/configurations/{configuration_id}/defaults', 'github_security_config_default'],
  ['DELETE /orgs/{org}/code-security/configurations/detach', 'github_security_config_detach'],
  ['PATCH /repos/{owner}/{repo}/code-scanning/default-setup', 'github_security_code_scanning_default_setup'],
  ['PUT /repos/{owner}/{repo}/private-vulnerability-reporting', 'github_security_set_feature'],
  ['DELETE /repos/{owner}/{repo}/private-vulnerability-reporting', 'github_security_set_feature'],
  ['POST /orgs/{org}/secret-scanning/custom-patterns', 'github_security_secret_pattern_save'],
  ['POST /repos/{owner}/{repo}/secret-scanning/custom-patterns', 'github_security_secret_pattern_save'],
  ['PATCH /orgs/{org}/secret-scanning/custom-patterns/{pattern_id}', 'github_security_secret_pattern_save'],
  ['PATCH /repos/{owner}/{repo}/secret-scanning/custom-patterns/{pattern_id}', 'github_security_secret_pattern_save'],
  ['DELETE /orgs/{org}/secret-scanning/custom-patterns', 'github_security_secret_pattern_save'],
  ['DELETE /repos/{owner}/{repo}/secret-scanning/custom-patterns', 'github_security_secret_pattern_save'],
  ['PATCH /orgs/{org}/dependabot/repository-access', 'github_security_dependabot_org_settings'],
  ['PUT /orgs/{org}/dependabot/repository-access/default-level', 'github_security_dependabot_org_settings']
]);
for (const base of ['/orgs/{org}', '/users/{username}', '/user']) {
  const path = base + '/packages/{package_type}/{package_name}';
  exact.set('DELETE ' + path, 'github_package_delete');
  exact.set('DELETE ' + path + '/versions/{package_version_id}', 'github_package_delete_version');
  exact.set('POST ' + path + '/restore', 'github_package_restore_version');
  exact.set('POST ' + path + '/versions/{package_version_id}/restore', 'github_package_restore_version');
}
const maps=[
  [/^PUT \/repos\/\{owner\}\/\{repo\}\/pulls\/\{pull_number\}\/merge$/, 'github_pr_merge'],
  [/^POST \/repos\/\{owner\}\/\{repo\}\/merge-upstream$/, 'github_pr_merge'],
  [/^PUT \/repos\/\{owner\}\/\{repo\}\/actions\/secrets\//, 'github_secret_set'],
  [/^PUT \/orgs\/\{org\}\/actions\/secrets\//, 'github_secret_set'],
  [/^PUT \/repos\/\{owner\}\/\{repo\}\/dependabot\/secrets\//, 'github_secret_set'],
  [/^(?:POST|PUT|PATCH|DELETE) \/repos\/\{owner\}\/\{repo\}\/branches\/\{branch\}\/protection/, 'github_protection_set'],
  [/^(?:POST|PUT|PATCH|DELETE) \/repos\/\{owner\}\/\{repo\}\/rulesets/, 'github_ruleset_save'],
  [/^POST \/repos\/\{owner\}\/\{repo\}\/pulls$/, 'github_pr_create'],
  [/^PATCH \/repos\/\{owner\}\/\{repo\}\/pulls\/\{pull_number\}$/, 'github_pr_update'],
  [/^POST \/repos\/\{owner\}\/\{repo\}\/issues$/, 'github_issue_create'],
  [/^POST \/repos\/\{owner\}\/\{repo\}\/issues\/\{issue_number\}\/comments$/, 'github_issue_comment'],
  [/^PATCH \/repos\/\{owner\}\/\{repo\}$/, 'github_repo_update_settings'],
  [/^POST \/orgs\/\{org\}\/repos$/, 'github_repo_create'],
  [/^POST \/user\/repos$/, 'github_repo_create'],
  [/^POST \/repos\/\{owner\}\/\{repo\}\/releases$/, 'github_release_create'],
  [/^PATCH \/repos\/\{owner\}\/\{repo\}\/releases\//, 'github_release_update'],
  [/^DELETE \/repos\/\{owner\}\/\{repo\}\/git\/refs\//, 'github_branch_delete'],
  [/^(?:POST|PUT|PATCH|DELETE) \/(?:repos\/\{owner\}\/\{repo\}|orgs\/\{org\})\/actions\/permissions/, 'github_actions_set_settings']
];
export function curatedTool(op) {
  if (!op || !op.route) return null;
  return exact.get(op.route) ?? maps.find(([pattern])=>pattern.test(op.route))?.[1] ?? null;
}

/** Read-only list of every tool name this map points at (registry consistency test). */
export const handBuiltTargets=()=>Object.freeze([...new Set([...exact.values(), ...maps.map(([,tool])=>tool)])]);
