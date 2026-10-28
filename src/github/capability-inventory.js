import { redact } from './content-protection.js';
// CAP-1: source-pinned capability census. This module NEVER issues a provider request,
// grants authority, or treats an API finder / tool count as actual GitHub coverage.
import {deriveRestCredentials, listedFor, NO_EVIDENCE, DERIVED_REVIEWED} from './credential-derivation.js';
import {restOperations} from './openapi-index.js';
import {githubGraphqlSchema} from './graphql-schema.js';
import {curatedTool} from './hand-built-map.js';
import {classifyUniversal, assertUniversalAuthority} from './operation-classes.js';
import {curatedGraphqlMutation} from './mutation-classes.js';
import {WRITE_SPECS, REFUSED_MUTATIONS} from './graphql-writes.js';
import {reviewedRestEvidence} from './capability-evidence.js';

/** GQL-1: GraphQL mutations whose job an existing hand-built tool already does. Coverage bookkeeping only: unlike the
 *  `curated` map in mutation-classes.js this does NOT stop `github_graphql_write` from running the mutation. */
export const COVERED_BY_TOOL = new Map([
  ['addProjectV2DraftIssue', 'github_project_add_draft'],
  ['archiveProjectV2Item', 'github_project_archive_item'],
  ['unarchiveProjectV2Item', 'github_project_archive_item'],
  ['clearProjectV2ItemFieldValue', 'github_project_clear_field'],
  ['convertProjectV2DraftIssueItemToIssue', 'github_project_convert_draft'],
  ['copyProjectV2', 'github_project_copy'],
  ['createProjectV2', 'github_project_create'],
  ['createProjectV2Field', 'github_project_field_save'],
  ['updateProjectV2Field', 'github_project_field_save'],
  ['deleteProjectV2Field', 'github_project_field_delete'],
  ['createProjectV2StatusUpdate', 'github_project_status_update'],
  ['createProjectV2View', 'github_project_view_save'],
  ['deleteProjectV2View', 'github_project_view_save'],
  ['deleteProjectV2', 'github_project_delete'],
  ['deleteProjectV2Item', 'github_project_delete_item'],
  ['linkProjectV2ToRepository', 'github_project_link'],
  ['unlinkProjectV2FromRepository', 'github_project_link'],
  ['linkProjectV2ToTeam', 'github_project_link'],
  ['unlinkProjectV2FromTeam', 'github_project_link'],
  ['updateProjectV2', 'github_project_update'],
  ['updateProjectV2ItemPosition', 'github_project_move_item'],
  ['addProjectV2ItemById', 'github_project_set_item'],
  ['updateProjectV2ItemFieldValue', 'github_project_set_item'],
  ['addAssigneesToAssignable', 'github_issue_set_assignees'],
  ['removeAssigneesFromAssignable', 'github_issue_set_assignees'],
  ['addBlockedBy', 'github_issue_set_dependency'],
  ['removeBlockedBy', 'github_issue_set_dependency'],
  ['addSubIssue', 'github_issue_set_sub_issue'],
  ['removeSubIssue', 'github_issue_set_sub_issue'],
  ['reprioritizeSubIssue', 'github_issue_set_sub_issue'],
  ['addLabelsToLabelable', 'github_issue_set_labels'],
  ['removeLabelsFromLabelable', 'github_issue_set_labels'],
  ['clearLabelsFromLabelable', 'github_issue_set_labels'],
  ['createLabel', 'github_label_save'],
  ['updateLabel', 'github_label_save'],
  ['deleteLabel', 'github_label_delete'],
  ['addReaction', 'github_issue_react'],
  ['removeReaction', 'github_issue_react'],
  ['closeIssue', 'github_issue_update'],
  ['reopenIssue', 'github_issue_update'],
  ['updateIssueIssueType', 'github_issue_update'],
  ['transferIssue', 'github_issue_transfer'],
  ['addComment', 'github_issue_comment'],
  ['addPullRequestReview', 'github_review_create'],
  ['submitPullRequestReview', 'github_review_submit'],
  ['dismissPullRequestReview', 'github_review_dismiss'],
  ['addPullRequestReviewThreadReply', 'github_review_reply'],
  ['resolveReviewThread', 'github_review_resolve_thread'],
  ['unresolveReviewThread', 'github_review_resolve_thread'],
  ['requestReviews', 'github_review_request_reviewers'],
  ['requestReviewsByLogin', 'github_review_request_reviewers'],
  ['rerequestReviews', 'github_review_request_reviewers'],
  ['updatePullRequestReviewComment', 'github_review_comment_edit'],
  ['deletePullRequestReviewComment', 'github_comment_delete'],
  ['enablePullRequestAutoMerge', 'github_pr_set_auto_merge'],
  ['disablePullRequestAutoMerge', 'github_pr_set_auto_merge'],
  ['updatePullRequestBranch', 'github_pr_update_branch'],
  ['createIssueType', 'github_org_issue_type_save'],
  ['updateIssueType', 'github_org_issue_type_save'],
  ['deleteIssueType', 'github_org_issue_type_delete'],
  ['createIssueField', 'github_org_issue_field_save'],
  ['updateIssueField', 'github_org_issue_field_save'],
  ['deleteIssueField', 'github_org_issue_field_delete'],
  ['setIssueFieldValue', 'github_issue_set_fields'],
  ['createIssueFieldValue', 'github_issue_set_fields'],
  ['updateIssueFieldValue', 'github_issue_set_fields'],
  ['approveDeployments', 'github_actions_review_pending_deployment'],
  ['rejectDeployments', 'github_actions_review_pending_deployment'],
  ['archiveRepository', 'github_repo_set_archived'],
  ['unarchiveRepository', 'github_repo_set_archived'],
  ['createCheckRun', 'github_check_create_run'],
  ['updateCheckRun', 'github_check_update_run'],
  ['createDeployment', 'github_deploy_create'],
  ['createDeploymentStatus', 'github_deploy_set_status'],
  ['createEnvironment', 'github_env_save'],
  ['updateEnvironment', 'github_env_save'],
  ['deleteEnvironment', 'github_env_delete'],
  ['createRef', 'github_branch_create'],
  ['deleteRef', 'github_branch_delete'],
  ['updateRef', 'github_git_update_ref'],
  ['createRepository', 'github_repo_create'],
  ['cloneTemplateRepository', 'github_repo_create_from_template'],
  ['mergeBranch', 'github_branch_merge'],
  ['setRepositoryInteractionLimit', 'github_interaction_limit_set'],
  ['setOrganizationInteractionLimit', 'github_interaction_limit_set'],
  ['setUserInteractionLimit', 'github_interaction_limit_set'],
  ['setRepositoryCustomPropertyValues', 'github_repo_set_custom_properties'],
  ['createRepositoryCustomProperty', 'github_org_custom_properties'],
  ['updateRepositoryCustomProperty', 'github_org_custom_properties'],
  ['deleteRepositoryCustomProperty', 'github_org_custom_properties'],
  ['promoteRepositoryCustomProperty', 'github_org_custom_properties'],
  ['followUser', 'github_user_follow'],
  ['unfollowUser', 'github_user_follow'],
  ['followOrganization', 'github_user_follow'],
  ['unfollowOrganization', 'github_user_follow'],
  ['updateSubscription', 'github_notify_set_subscription'],
  ['removeOutsideCollaborator', 'github_org_set_outside_collaborator'],
  ['updateTeamsRepository', 'github_team_set_repo_access'],
  ['deletePackageVersion', 'github_package_delete_version'],
  ['dismissRepositoryVulnerabilityAlert', 'github_security_update_alert'],
  ['createSponsorship', 'github_sponsor_set'],
  ['cancelSponsorship', 'github_sponsor_set'],
  ['updateOrganizationAllowPrivateRepositoryForkingSetting', 'github_org_update_settings'],
  ['updateRepositoryWebCommitSignoffSetting', 'github_repo_update_settings'],
  ['updateEnterpriseAllowPrivateRepositoryForkingSetting', 'github_enterprise_policy_set'],
  ['updateEnterpriseDefaultRepositoryPermissionSetting', 'github_enterprise_policy_set'],
  ['updateEnterpriseMembersCanChangeRepositoryVisibilitySetting', 'github_enterprise_policy_set'],
  ['updateEnterpriseMembersCanDeleteIssuesSetting', 'github_enterprise_policy_set'],
  ['updateEnterpriseMembersCanDeleteRepositoriesSetting', 'github_enterprise_policy_set'],
  ['updateEnterpriseMembersCanInviteCollaboratorsSetting', 'github_enterprise_policy_set'],
  ['updateEnterpriseMembersCanMakePurchasesSetting', 'github_enterprise_policy_set'],
  ['updateEnterpriseMembersCanUpdateProtectedBranchesSetting', 'github_enterprise_policy_set'],
  ['updateEnterpriseMembersCanViewDependencyInsightsSetting', 'github_enterprise_policy_set'],
  ['updateEnterpriseOrganizationProjectsSetting', 'github_enterprise_policy_set'],
  ['updateEnterpriseProfile', 'github_enterprise_profile_set']
]);

export const SOURCE = Object.freeze({
  checked: '2026-10-21',
  rest: Object.freeze({
    version: '2026-03-10',
    revision: '58b1e0c00b39b9e46c24dc4a0ba6a2669c90e9c1',
    url: 'https://github.com/github/rest-api-description/blob/58b1e0c00b39b9e46c24dc4a0ba6a2669c90e9c1/descriptions/api.github.com/api.github.com.2026-03-10.json'
  }),
  graphql: Object.freeze({
    version: 'schema-2026-10-09',
    revision: 'be38ec5d78e24172587e61b3c6ff40ace1865c71',
    url: 'https://github.com/github/docs/blob/be38ec5d78e24172587e61b3c6ff40ace1865c71/src/graphql/data/fpt/schema.docs.graphql'
  })
});

export const CREDENTIAL_KINDS = Object.freeze([
  'app_installation', 'app_user', 'oauth_app', 'fine_grained_pat',
  'classic_pat', 'app_jwt', 'git_ssh', 'workflow_token'
]);
export const STATES = Object.freeze([
  'missing', 'implemented-unverified', 'verified', 'provider-retired',
  'provider-UI-only', 'unresolved', 'refused-by-design'
]);
const SUPPORT = new Set(['supported', 'unsupported', 'unknown']);
const ROOT_TYPES = Object.freeze(['query', 'mutation']);
const REQUIRED_HOSTS = Object.freeze(['github.com', 'ghe.com', 'ghes']);
const OFFICIAL_AUTH =
  'https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps';
const GITHUB_APP_AUTH =
  'https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/about-authentication-with-a-github-app';
const GHE_DOCS =
  'https://docs.github.com/en/enterprise-cloud@latest/apps/using-github-apps/installing-a-github-app-on-your-enterprise';

// These are documented differences WITHIN current official reference pages,
// not grants. A schema operation or a family-wide auth sentence is insufficient
// to resolve contradictory per-operation credentials. Keep exact rows visible
// until a later reviewed change can prove the applicable provider contract.
const AUDIT_REFERENCE =
  'https://docs.github.com/en/enterprise-cloud@latest/rest/enterprise-admin/audit-log?apiVersion=2026-03-10';
const PACKAGE_REFERENCE =
  'https://docs.github.com/en/rest/packages/packages?apiVersion=2026-03-10';
function documentedConflicts(op) {
  const route = op.route ?? op.method + ' ' + op.path;
  const result = [];
  if (route === 'GET /enterprises/{enterprise}/audit-log') {
    result.push({
      id: 'enterprise-audit-token-contradiction', status: 'unresolved',
      credentialKinds: ['app_installation', 'app_user', 'oauth_app'],
      officialUrl: AUDIT_REFERENCE,
      explanation: 'The classic-PAT-only overview conflicts with the per-operation OAuth and App token claims; enterprise administration permission availability is also contradictory.'
    });
  }
  if (op.category === 'packages') {
    result.push({
      id: 'packages-rest-token-contradiction', status: 'resolved',
      credentialKinds: ['app_installation', 'app_user', 'oauth_app', 'fine_grained_pat'],
      officialUrl: PACKAGE_REFERENCE,
      explanation: 'The classic-PAT-only overview conflicts with per-operation App/OAuth/fine-grained support statements. This REST evidence does not cover registry authentication.',
      resolution: 'INV-1 (' + DERIVED_REVIEWED + '): the per-operation statements win. GitHub\'s per-operation endpoint lists decide the App and fine-grained token types, and each operation\'s own text decides the classic and OAuth app scopes. The page-level "classic token" sentence is kept as context only. Registry (docker/npm) authentication is a separate transport and is not covered by these REST decisions.'
    });
  }
  if (op.deprecated) {
    const stillListed = Object.keys(listedFor(route)).length > 0;
    result.push({
      id: 'deprecated-is-not-retired', status: 'resolved', credentialKinds: [],
      officialUrl: SOURCE.rest.url,
      explanation: 'Deprecated in pinned source; provider retirement or replacement has not been verified.',
      resolution: stillListed
        ? 'INV-1 (' + DERIVED_REVIEWED + '): deprecated, not retired. GitHub\'s own token lists (docs data of 2026-10-23) still include this operation, so it is treated as available until GitHub removes it.'
        : 'INV-1 (' + DERIVED_REVIEWED + '): deprecated and absent from GitHub\'s token lists. Retirement is not proven, so no credential is recorded as supported; only a live call can show whether it still answers.'
    });
  }
  return result;
}

// This is a cross-version applicability ledger, NOT a claim that the pinned
// GitHub.com operation is implemented on another host or GHES release.
function hostApplicability(key) {
  return [
    {key: key + '|github.com|2026-03-10', host: 'github.com',
      product: 'GitHub.com', version: '2026-03-10',
      disposition: 'source-pinned', evidence: SOURCE.rest.url},
    {key: key + '|ghe.com|unverified', host: 'ghe.com',
      product: 'GitHub Enterprise Cloud with data residency', version: 'unverified',
      disposition: 'unknown', evidence: GHE_DOCS},
    {key: key + '|ghes|3.20', host: 'ghes',
      product: 'GitHub Enterprise Server', version: '3.20',
      disposition: 'unknown',
      evidence: 'https://docs.github.com/en/enterprise-server@3.20/rest'},
    {key: key + '|ghes|3.22', host: 'ghes',
      product: 'GitHub Enterprise Server', version: '3.22',
      disposition: 'unknown',
      evidence: 'https://docs.github.com/en/enterprise-server@3.22/rest'}
  ];
}
function graphqlHosts(key) {
  const hosts = hostApplicability(key);
  hosts[0] = {...hosts[0], key: key + '|github.com|' + SOURCE.graphql.version,
    version: SOURCE.graphql.version, evidence: SOURCE.graphql.url};
  return hosts;
}
function unknownCredentials(interfaceName) {
  const entries = Object.fromEntries(CREDENTIAL_KINDS.map(kind => [kind, {
    disposition: 'unknown', evidence: null, permissions: null, scopes: null, reason: NO_EVIDENCE
  }]));
  if (interfaceName === 'graphql') {
    // App JWTs cannot call GraphQL (official GitHub App auth documentation).
    entries.app_jwt = {disposition: 'unsupported', evidence: GITHUB_APP_AUTH,
      permissions: null, scopes: null};
  }
  return entries;
}
function prerequisites() {
  // Unknown is different from none. A documented grant must be checked at the
  // exact operation/host/resource, rather than inferred from the family name.
  return {permissions: null, scopes: null, actorRole: 'unknown', plan: 'unknown',
    sso: 'unknown', installation: 'unknown', resourceSelection: 'unknown',
    preview: 'unknown'};
}
function baseline({key, interfaceName, family, effect, source, officialReference}) {
  return {
    key, interface: interfaceName, host: 'github.com',
    version: source.version, family, effect,
    evidence: {pinnedRevision: source.revision, officialUrl: officialReference,
      sourceUrl: source.url, checked: SOURCE.checked, conflicts: []},
    credentialSupport: unknownCredentials(interfaceName),
    prerequisites: prerequisites(),
    hostApplicability: interfaceName === 'graphql' ? graphqlHosts(key) : hostApplicability(key),
    implementation: {status: 'unresolved', route: null, tool: null,
      source: null, requestShapeTest: null, universalCandidate: false,
      reason: 'No exact provider dispatch plus request-shape proof recorded'},
    safety: {targetBound: 'unverified', tenantBound: 'unverified', secrets: 'unverified',
      spending: 'unknown', confirmation: 'unverified', replay: 'unverified',
      readback: 'unverified'},
    state: 'unresolved',
    delivery: {owner: 'CAP-4', dependencies: ['CAP-1', 'CAP-2', 'CAP-3'],
      priority: 'inventory-review', nextAction: 'Verify credential and guarded route against official operation contract',
      externalAcceptance: 'pending'}
  };
}
function restKey(op) {return 'rest:github.com@' + SOURCE.rest.version + ':' + op.route;}
function gqlKey(root, name) {
  return 'graphql:github.com@' + SOURCE.graphql.version + ':' + root + ':' + name;
}
function routeEligibility(op) {
  try {
    assertUniversalAuthority(op, {}, {});
    // The input shape, account binding and provider token still require proof.
    // A candidate is never counted as implemented solely for being dispatchable.
    return {candidate: op.method === 'GET' || ['POST','PUT','PATCH','DELETE'].includes(op.method),
      reason: 'Requires per-operation scoped request/credential/readback proof'};
  } catch (error) {
    return {candidate: false, reason: redact(String(error.message)).slice(0,240)};
  }
}
function restRecord(op, names) {
  const key = restKey(op);
  const rec = baseline({key, interfaceName: 'rest',
    family: op.category || 'uncategorized',
    effect: ['GET','HEAD','OPTIONS'].includes(op.method) ? 'read' : 'write',
    source: SOURCE.rest, officialReference: OFFICIAL_AUTH});
  rec.operation = {method: op.method, path: op.path, operationId: op.operationId || null,
    deprecated: Boolean(op.deprecated), summary: op.summary || ''};
  rec.evidence.conflicts = documentedConflicts(op);
  const reviewed = reviewedRestEvidence(op.route);
  if (reviewed) {
    rec.evidence.reviewedCredentials = {officialUrl: reviewed.officialUrl, checked: reviewed.reviewed};
    for (const [kind, decision] of Object.entries(reviewed.decisions)) {
      if (rec.evidence.conflicts.some(conflict => conflict.status === 'unresolved' && conflict.credentialKinds.includes(kind))) continue;
      rec.credentialSupport[kind] = {
        ...decision, evidence: reviewed.officialUrl, reviewed: reviewed.reviewed
      };
    }
    const supported = Object.values(rec.credentialSupport).some(value =>
      value.disposition === 'supported');
    if (supported) rec.delivery.nextAction =
      'Verify registered dispatch, effective account/permissions and exact request-shape test; source support alone is not user authorization';
  }
  // INV-1: decisions derived from GitHub's own per-operation lists and the operation's text fill every kind the hand review did not cover.
  const derived = deriveRestCredentials(op);
  for (const [kind, decision] of Object.entries(derived.decisions)) {
    if (reviewed?.decisions?.[kind]) continue;
    rec.credentialSupport[kind] = decision;
  }
  rec.evidence.conflicts.push(...derived.conflicts);
  const mapped = curatedTool(op);
  const route = routeEligibility(op);
  rec.implementation.universalCandidate = route.candidate;
  rec.implementation.reason = route.reason;
  if (mapped) {
    rec.implementation.route = 'curated';
    rec.implementation.tool = mapped;
    rec.implementation.source = 'src/github/hand-built-map.js';
    if (names.has(mapped)) {
      rec.implementation.status = 'implemented-unverified';
      rec.state = 'implemented-unverified';
      rec.delivery.nextAction = 'Verify curated tool exact request shape, credential kind and readback';
    } else {
      rec.implementation.reason = 'Orphan curated tool mapping: ' + mapped;
    }
  } else if (route.candidate) {
    rec.implementation.route = 'universal-candidate';
    rec.implementation.tool = op.method === 'GET' ? 'github_api_read' : 'github_api_write';
    rec.implementation.source = 'src/tools/universal.js';
  }
  const classified = classifyUniversal(op);
  rec.safety.spending = classified.spendRisk ? 'possible-or-unknown' : 'reviewed-route-or-read';
  rec.safety.notification = Boolean(classified.notifies);
  rec.safety.productionRisk = Boolean(classified.production);
  rec.safety.accessRisk = Boolean(classified.accessWidening);
  return rec;
}
function gqlRecord(root, field, names) {
  const key = gqlKey(root, field.name);
  const rec = baseline({key, interfaceName: 'graphql',
    family: 'graphql-' + root, effect: root === 'query' ? 'read' : 'write',
    source: SOURCE.graphql,
    officialReference: 'https://docs.github.com/en/graphql/guides/forming-calls-with-graphql'});
  rec.operation = {root, field: field.name, returnType: String(field.type),
    arguments: field.args.map(a => ({name: a.name, type: String(a.type)})),
    deprecated: Boolean(field.deprecationReason)};
  rec.implementation.route = 'universal-candidate';
  rec.implementation.tool = root === 'query' ? 'github_graphql_read' : 'github_graphql_write';
  rec.implementation.source = 'src/tools/universal-graphql.js';
  // GraphQL root schema existence alone is not scope proof: queries use
  // independent account/root controls; mutations need either a specialized
  // handler or the exact audited writeSpec. No writes are dispatched here.
  rec.implementation.reason = 'Root field exists; scope, credential and request shape remain unverified';
  if (root === 'mutation') {
    const curated = curatedGraphqlMutation(field.name);
    if (curated) {
      rec.implementation.route = 'curated';
      rec.implementation.tool = curated;
      rec.implementation.source = 'src/github/mutation-classes.js';
      if (names.has(curated)) {
        rec.implementation.status = 'implemented-unverified';
        rec.state = 'implemented-unverified';
        rec.delivery.nextAction = 'Verify curated mutation target ownership, request shape and independent readback';
      } else {
        rec.implementation.reason = 'Orphan curated tool mapping: ' + curated;
      }
    } else if (COVERED_BY_TOOL.has(field.name) && names.has(COVERED_BY_TOOL.get(field.name))) {
      rec.implementation.route = 'curated';
      rec.implementation.tool = COVERED_BY_TOOL.get(field.name);
      rec.implementation.source = 'src/github/capability-inventory.js';
      rec.implementation.status = 'implemented-unverified';
      rec.state = 'implemented-unverified';
      rec.implementation.reason = 'A dedicated tool already performs this mutation';
      rec.delivery.nextAction = 'Verify the dedicated tool against a real account';
    } else if (REFUSED_MUTATIONS.has(field.name)) {
      rec.implementation.route = 'refused-by-design';
      rec.implementation.status = 'refused-by-design';
      rec.state = 'refused-by-design';
      rec.implementation.reason = 'Missing verified ownership/readback contract; legacy refused-by-design classification is not a GitHub permission refusal. Historical note: ' + REFUSED_MUTATIONS.get(field.name);
      rec.delivery.nextAction = 'Implement the verified scoped contract; meanwhile use github_search_tools, github_api_search/github_api_describe or github_where_is_setting for supported alternatives and setup guidance';
    } else if (WRITE_SPECS.has(field.name)) {
      rec.implementation.universalCandidate = true;
      rec.implementation.reason = 'A reviewed GraphQL writeSpec exists; exact credential, ownership and request shape still require verification';
    } else {
      rec.implementation.route = 'blocked-missing-write-spec';
      rec.implementation.status = 'missing';
      rec.state = 'missing';
      rec.implementation.reason = 'No curated handler or guarded universal GraphQL writeSpec';
      rec.delivery.nextAction = 'Review provider contract and add a scoped guarded writeSpec or specialized operation';
    }
  }
  rec.safety.spending = root === 'mutation' ? 'possible-or-unknown' : 'none-from-read';
  rec.safety.productionRisk = root === 'mutation';
  rec.safety.accessRisk = root === 'mutation';
  rec.safety.notification = 'unknown';
  return rec;
}
// The independent Git, Packages registry and exposed MCP transports cannot be
// credited merely because their metadata has a REST endpoint.
export const NON_SCHEMA_WORKFLOWS = Object.freeze([
  {id: 'git-smart-http-fetch', interface: 'git', family: 'git-transport', effect: 'read',
    url: 'https://git-scm.com/docs/http-protocol'},
  {id: 'git-smart-http-push', interface: 'git', family: 'git-transport', effect: 'write',
    url: 'https://git-scm.com/docs/http-protocol'},
  {id: 'git-ssh-fetch', interface: 'git', family: 'git-transport', effect: 'read',
    url: 'https://docs.github.com/en/authentication/connecting-to-github-with-ssh'},
  {id: 'git-ssh-push', interface: 'git', family: 'git-transport', effect: 'write',
    url: 'https://docs.github.com/en/authentication/connecting-to-github-with-ssh'},
  {id: 'registry-package-download', interface: 'registry', family: 'package-transport', effect: 'read',
    url: 'https://docs.github.com/en/packages/learn-github-packages/introduction-to-github-packages'},
  {id: 'registry-package-publish', interface: 'registry', family: 'package-transport', effect: 'write',
    url: 'https://docs.github.com/en/packages/learn-github-packages/introduction-to-github-packages'},
  {id: 'mcp-tools-list', interface: 'mcp', family: 'mcp-protocol', effect: 'read',
    url: 'https://modelcontextprotocol.io/specification/2025-11-25/server/tools'},
  {id: 'mcp-tools-call', interface: 'mcp', family: 'mcp-protocol', effect: 'write',
    url: 'https://modelcontextprotocol.io/specification/2025-11-25/server/tools'}
]);
function workflowRecord(item) {
  const key = item.interface + ':github.com@unversioned:' + item.id;
  const rec = baseline({key, interfaceName: item.interface, family: item.family,
    effect: item.effect,
    source: {version: 'unversioned', revision: 'official-reference-' + SOURCE.checked, url: item.url},
    officialReference: item.url});
  // A protocol reference is not the pinned REST/GraphQL schema; keep its
  // version and evidence independent rather than claiming 2026-03-10 support.
  rec.hostApplicability[0] = {
    key: key + '|github.com|unversioned', host: 'github.com',
    product: 'GitHub.com', version: 'unversioned',
    disposition: 'official-reference-only', evidence: item.url
  };
  rec.operation = {workflow: item.id};
  rec.implementation.reason = 'No verified end-to-end protocol transport/readback evidence';
  rec.implementation.route = 'not-assessed';
  if (item.interface === 'mcp') {
    rec.implementation.source = 'src/runtime.js';
    rec.implementation.reason = 'Actual standalone transport not separately accepted by this inventory';
  }
  return rec;
}

export function sourceKeys({rest = restOperations(),
  schema = githubGraphqlSchema(), workflows = NON_SCHEMA_WORKFLOWS} = {}) {
  const keys = rest.map(restKey);
  for (const root of ROOT_TYPES) {
    const type = root === 'query' ? schema.getQueryType() : schema.getMutationType();
    for (const field of Object.values(type?.getFields() || {})) keys.push(gqlKey(root, field.name));
  }
  keys.push(...workflows.map(x => x.interface + ':github.com@unversioned:' + x.id));
  if (new Set(keys).size !== keys.length) throw new TypeError('Duplicate source operation key');
  return keys;
}
export function buildCapabilityInventory({
  rest = restOperations(), schema = githubGraphqlSchema(),
  workflows = NON_SCHEMA_WORKFLOWS, registryTools = [], annotations = []
} = {}) {
  if (!Array.isArray(registryTools)) throw new TypeError('Registry tool list is required');
  const names = new Set(registryTools.map(x => typeof x === 'string' ? x : x.name));
  const records = rest.map(op => restRecord(op, names));
  for (const root of ROOT_TYPES) {
    const type = root === 'query' ? schema.getQueryType() : schema.getMutationType();
    records.push(...Object.values(type?.getFields() || {}).map(field => gqlRecord(root, field, names)));
  }
  records.push(...workflows.map(workflowRecord));
  const map = new Map(records.map(x => [x.key, x]));
  if (map.size !== records.length) throw new TypeError('Duplicate built inventory rows');
  const applied = new Set();
  for (const annotation of annotations) {
    if (!annotation || !map.has(annotation.key))
      throw new TypeError('Orphan capability annotation: ' + String(annotation?.key));
    const annotationId = annotation.key + '/' + annotation.credential;
    if (applied.has(annotationId)) throw new TypeError('Duplicate capability annotation: ' + annotationId);
    applied.add(annotationId);
    const row = map.get(annotation.key);
    if (!CREDENTIAL_KINDS.includes(annotation.credential))
      throw new TypeError('Unknown credential kind for ' + annotation.key);
    if (!SUPPORT.has(annotation.disposition) || !annotation.evidence ||
        typeof annotation.evidence !== 'string' || !/^https:\/\//.test(annotation.evidence))
      throw new TypeError('Reviewed credential disposition requires official HTTPS evidence');
    const pinned = row.interface === 'rest' ? reviewedRestEvidence(
      row.operation.method + ' ' + row.operation.path)?.decisions?.[annotation.credential] : null;
    if (pinned && pinned.disposition !== annotation.disposition)
      throw new TypeError('Reviewed credential decision cannot be overridden: ' + annotationId);
    if (annotation.disposition === 'supported' && row.evidence.conflicts.some(
      conflict => conflict.status === 'unresolved' &&
        conflict.credentialKinds.includes(annotation.credential)))
      throw new TypeError('Unresolved credential conflict: ' + annotationId);
    // A second annotation must never rewrite exact pinned evidence. A later
    // supported-but-different contract needs an explicit reviewed source change.
    if (pinned) {
      if (JSON.stringify(annotation.permissions ?? null) !== JSON.stringify(pinned.permissions) ||
          JSON.stringify(annotation.scopes ?? null) !== JSON.stringify(pinned.scopes))
        throw new TypeError('Reviewed permission/scope contract cannot be overridden: ' + annotationId);
    } else {
      row.credentialSupport[annotation.credential] = {
        disposition: annotation.disposition, evidence: annotation.evidence,
        permissions: annotation.permissions ?? null, scopes: annotation.scopes ?? null
      };
    }
  }
  records.sort((a,b) => a.key.localeCompare(b.key, 'en'));
  return {format: 'capability-inventory/v1', source: SOURCE,
    registryToolCount: names.size, operations: records,
    summary: summarizeCapabilityInventory(records)};
}
export function summarizeCapabilityInventory(records) {
  const families = {};
  const statuses = Object.fromEntries(STATES.map(x => [x, 0]));
  let unknownCredentials = 0, unknownHostApplicability = 0, unresolvedConflictRows = 0, reviewedCredentialDecisions = 0;
  let derivedCredentialDecisions = 0, resolvedConflictRows = 0, operationsWithADecision = 0;
  for (const row of records) {
    const family = families[row.family] ||= {total: 0, byState: Object.fromEntries(STATES.map(x => [x,0])),
      universalCandidates: 0, credentialUnknowns: 0, unresolvedConflicts: 0};
    family.total++;
    family.byState[row.state]++;
    statuses[row.state]++;
    if (row.implementation.universalCandidate) family.universalCandidates++;
    if (row.evidence.conflicts.some(x => x.status === 'unresolved')) {
      family.unresolvedConflicts++;
      unresolvedConflictRows++;
    }
    const c = Object.values(row.credentialSupport).filter(x => x.disposition === 'unknown').length;
    family.credentialUnknowns += c;
    unknownCredentials += c;
    reviewedCredentialDecisions += Object.values(row.credentialSupport).filter(x => x.reviewed).length;
    derivedCredentialDecisions += Object.values(row.credentialSupport).filter(x => x.derived === true && x.disposition !== 'unknown').length;
    if (row.evidence.conflicts.length && row.evidence.conflicts.every(x => x.status === 'resolved')) resolvedConflictRows++;
    if (Object.values(row.credentialSupport).some(x => x.disposition !== 'unknown' && (x.derived === true || x.reviewed))) operationsWithADecision++;
    unknownHostApplicability += row.hostApplicability.filter(x => x.disposition === 'unknown').length;
  }
  return {totalOperations: records.length, byState: statuses,
    unknownCredentialDecisions: unknownCredentials,
    unverifiedHostApplicability: unknownHostApplicability,
    unresolvedConflictRows,
    resolvedConflictRows,
    reviewedCredentialDecisions,
    derivedCredentialDecisions,
    operationsWithADecision,
    // Unknown and unverified rows are deliberately NOT a functional coverage numerator.
    verifiedOperations: statuses.verified,
    coverageRatio: null,
    families: Object.fromEntries(Object.entries(families).sort(([a],[b]) => a.localeCompare(b,'en')))};
}
export function validateCapabilityInventory(inventory, options = {}) {
  if (inventory?.format !== 'capability-inventory/v1' || !Array.isArray(inventory.operations))
    throw new TypeError('Invalid capability inventory format');
  const keys = sourceKeys(options), expected = new Set(keys), seen = new Set();
  for (const row of inventory.operations) {
    if (!row?.key || seen.has(row.key)) throw new TypeError('Duplicate or empty inventory key');
    seen.add(row.key);
    if (!expected.has(row.key)) throw new TypeError('Orphan inventory row: ' + row.key);
    if (!STATES.includes(row.state) || !row.evidence?.officialUrl || !row.evidence?.sourceUrl ||
        !row.evidence?.pinnedRevision || !row.evidence?.checked ||
        !row.delivery?.owner || !row.delivery?.nextAction)
      throw new TypeError('Missing required disposition/evidence: ' + row.key);
    const requiredConflicts = row.interface === 'rest' ? documentedConflicts({
      route: row.operation?.method + ' ' + row.operation?.path,
      category: row.family, deprecated: row.operation?.deprecated
    }) : [];
    if (!Array.isArray(row.evidence.conflicts) ||
        requiredConflicts.some(required => !row.evidence.conflicts.some(actual =>
          actual.id === required.id && actual.status === required.status &&
          actual.officialUrl === required.officialUrl &&
          JSON.stringify(actual.credentialKinds) === JSON.stringify(required.credentialKinds))))
      throw new TypeError('Missing official credential conflict record: ' + row.key);
    if (row.evidence.conflicts.some(conflict =>
      !conflict || !['unresolved', 'resolved'].includes(conflict.status) ||
      (conflict.status === 'resolved' && (typeof conflict.resolution !== 'string' || conflict.resolution.length < 20)) ||
      !Array.isArray(conflict.credentialKinds) || typeof conflict.officialUrl !== 'string' ||
      !conflict.officialUrl.startsWith('https://')))
      throw new TypeError('Invalid credential conflict record: ' + row.key);
    if (row.evidence.conflicts.some(conflict => conflict.status === 'unresolved' && conflict.credentialKinds.some(kind =>
      row.credentialSupport?.[kind]?.disposition === 'supported')))
      throw new TypeError('Unresolved credential conflict cannot prove support: ' + row.key);
    const reviewed = row.interface === 'rest' ? reviewedRestEvidence(
      row.operation?.method + ' ' + row.operation?.path) : null;
    if (reviewed) {
      for (const [kind, contract] of Object.entries(reviewed.decisions)) {
        const conflict = row.evidence.conflicts.some(c => c.status === 'unresolved' && c.credentialKinds.includes(kind));
        const expected = conflict ? {disposition: 'unknown'} : contract;
        const actual = row.credentialSupport?.[kind];
        if (!actual || actual.disposition !== expected.disposition ||
            (!conflict && (actual.evidence !== reviewed.officialUrl ||
              actual.reviewed !== reviewed.reviewed ||
              JSON.stringify(actual.permissions) !== JSON.stringify(contract.permissions) ||
              JSON.stringify(actual.scopes) !== JSON.stringify(contract.scopes))))
          throw new TypeError('Missing or altered reviewed credential contract: ' + row.key + '/' + kind);
      }
    }
    for (const [kind, value] of Object.entries(row.credentialSupport ?? {})) {
      if (value?.disposition === 'unknown' && (typeof value.reason !== 'string' || !value.reason))
        throw new TypeError('Unknown credential without a reason: ' + row.key + '/' + kind);
      if (value?.disposition !== 'unknown' && value?.derived === true && !/^https:\/\//.test(String(value.evidence ?? '')))
        throw new TypeError('Derived credential decision without official evidence: ' + row.key + '/' + kind);
    }
    if (Object.keys(row.credentialSupport || {}).length !== CREDENTIAL_KINDS.length ||
        CREDENTIAL_KINDS.some(x => !SUPPORT.has(row.credentialSupport[x]?.disposition)))
      throw new TypeError('Incomplete credential inventory: ' + row.key);
    if (row.hostApplicability?.length !== 4 ||
        REQUIRED_HOSTS.some(x => !row.hostApplicability.some(v => v.host === x && v.key && v.disposition)) ||
        new Set(row.hostApplicability.map(x => x.key)).size !== row.hostApplicability.length)
      throw new TypeError('Incomplete host applicability: ' + row.key);
    if (row.state === 'verified' &&
        (!row.implementation?.requestShapeTest || row.implementation?.status !== 'verified'))
      throw new TypeError('False verified operation without a request-shape test');
    if (row.implementation?.route === 'curated' && row.state === 'unresolved' &&
        row.implementation?.reason?.startsWith('Orphan curated tool mapping'))
      throw new TypeError('Curated tool not registered: ' + row.key);
  }
  for (const key of keys) if (!seen.has(key)) throw new TypeError('Missing source operation: ' + key);
  const expectedSummary = summarizeCapabilityInventory(inventory.operations);
  if (JSON.stringify(expectedSummary) !== JSON.stringify(inventory.summary))
    throw new TypeError('Family summary or totals do not reconcile to operation records');
  if (inventory.summary.coverageRatio !== null)
    throw new TypeError('Unproven coverage ratio is forbidden');
  return expectedSummary;
}
