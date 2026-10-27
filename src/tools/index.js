import * as universal from './universal.js';
import * as universalGraphql from './universal-graphql.js';
import * as workflowFind from './workflows-find.js';
import * as vulnerabilityAlerts from './vulnerability-alerts.js';
import * as workflowHealth from './workflows-health.js';
import * as workflowRelease from './workflows-release.js';
import { mergeNamespaces } from '../core/registry.js';
import * as server from './server.js';
import * as diagnostics from './server-diagnostics.js';
import * as meta from './meta.js';
import * as repos from './repos.js';
import * as reposWrite from './repos-write.js';
import * as codeRead from './code-read.js';
import * as codeWrite from './code-write.js';
import * as gitDataCommit from './git-data-commit.js';
import * as branches from './branches.js';
import * as reviews from './reviews.js';
import * as reviewsWrite from './reviews-write.js';
import * as actionsRead from './actions-read.js';
import * as actionsWrite from './actions-write.js';
import * as actionsForkApproval from './actions-fork-approval.js';
import * as checksRead from './checks-read.js';
import * as orgAdminExtras from './org-admin-extras.js';
import * as accountExport from './account-export.js';
import * as copilotSpaces from './copilot-spaces.js';
import * as smallMaster from './small-master.js';
import * as y9Copilot from './y9-copilot.js';
import * as y9CopilotRepos from './y9-copilot-repos.js';
import * as y9Sponsors from './y9-sponsorship.js';
import * as y9Hosted from './y9-hosted-runners.js';
import * as y9AgentTasks from './y9-agent-tasks.js';
import * as enterprise from './enterprise.js';
import * as enterpriseWrite from './enterprise-write.js';
import * as enterprisePolicy from './enterprise-policy.js';
import * as wiki from './wiki.js';
import * as autofix from './autofix.js';
import * as asyncJobs from './async-jobs.js';
import * as artifactsRead from './artifacts-read.js';
import * as checksWrite from './checks-write.js';
import * as variables from './variables.js';
import * as secrets from './secrets.js';
import * as environmentsRead from './environments-read.js';
import * as environmentsWrite from './environments-write.js';
import * as environmentsPolicies from './environments-policies.js';
import * as deploymentsRead from './deployments-read.js';
import * as deploymentsWrite from './deployments-write.js';
import * as releasesRead from './releases-read.js';
import * as releasesWrite from './releases-write.js';
import * as releasesAssets from './releases-assets.js';
import * as pagesRead from './pages-read.js';
import * as packagesRead from './packages-read.js';
import * as pagesWrite from './pages-write.js';
import * as packagesWrite from './packages-write.js';
import * as packagesRestore from './packages-restore.js';
import * as pullsRead from './pulls-read.js';
import * as issuesRead from './issues-read.js';
import * as issuesWrite from './issues-write.js';
import * as issuesRelationsWrite from './issues-relations-write.js';
import * as issuesReactionsWrite from './issues-reactions-write.js';
import * as issuesTransferWrite from './issues-transfer-write.js';
import * as labels from './labels.js';
import * as milestones from './milestones.js';
import * as labelsSync from './labels-sync.js';
import * as searchGitHub from './search.js';
import * as discussions from './discussions.js';
import * as projectsRead from './projects-read.js';
import * as projectsWrite from './projects-write.js';
import * as governanceRead from './governance-read.js';
import * as governanceWrite from './governance-write.js';
import * as protectionWrite from './protection-write.js';
import * as webhooksRead from './webhooks-read.js';
import * as webhooksActions from './webhooks-actions.js';
import * as webhooksSave from './webhooks-save.js';
import * as accessRead from './access-read.js';
import * as accessWrite from './access-write.js';
import * as securityRead from './security-read.js';
import * as securityScanFiles from './security-scan-files.js';
import * as securityAlertsWrite from './security-alerts-write.js';
import * as securitySettingsRead from './security-settings-read.js';
import * as securitySettingsWrite from './security-settings-write.js';
import * as adminGuided from './admin-guided.js';
import * as adminOverview from './admin-overview.js';
import * as orgRead from './org-read.js';
import * as orgGovernanceRead from './org-governance-read.js';
import * as orgScimWrite from './org-scim-write.js';
import * as orgSaml from './org-saml-authorizations.js';
import * as appJwtRead from './app-jwt-read.js';
import * as appJwtInstallGovernance from './app-jwt-installation-governance.js';
import * as appJwtWrite from './app-jwt-write.js';
import * as orgWrite from './org-write.js';
import * as teamRoleRead from './team-role-read.js';
import * as teamRoleWrite from './team-role-write.js';
import * as billingRead from './billing-read.js';
import * as billingWrite from './billing-write.js';
import * as billingGuided from './billing-guided.js';
import * as appsTokens from './apps-tokens.js';
import * as userAccount from './user-account.js';
import * as projectsManage from './projects-manage.js';
import * as projectsItems from './projects-items.js';
import * as runnersRead from './runners-read.js';
import * as runnersWrite from './runners-write.js';
import * as actionsLimits from './actions-limits.js';
import * as advisories from './advisories.js';
import * as securityScanningWrites from './security-scanning-writes.js';
import * as securityConfig from './security-config.js';
import * as moderation from './moderation.js';
import * as orgPlanning from './org-planning.js';
import * as orgIssueDiscovery from './org-issue-discovery.js';
import * as usersPublic from './users-public.js';
import * as socialWrite from './social-write.js';
import * as notificationsGists from './notifications-gists.js';
import * as profiles from './profiles.js';
import * as appReadiness from './app-readiness.js';
import * as projectSetup from './project-setup.js';
import * as workflowPr from './workflows-pr.js';
import * as workflowMerge from './workflows-merge.js';
import * as workflowReview from './workflows-review.js';
import * as workflowCi from './workflows-ci.js';
import * as devRunsRead from './dev-runs-read.js';
import * as devScratchWrite from './dev-scratch-write.js';
import * as devSeedWrite from './dev-seed-write.js';
import * as devTestWrite from './dev-test-write.js';
import * as devCiWrite from './dev-ci-write.js';
import * as devForwardWrite from './dev-forward-write.js';
import * as devForwardRead from './dev-forward-read.js';
import * as devIntegration from './dev-integration.js';
import * as devCleanupWrite from './dev-cleanup-write.js';
import * as pullsWrite from './pulls-write.js';
import * as pullsMerge from './pulls-merge.js';
import * as pullsStacks from './pulls-stacks.js';
import * as codeQuality from './code-quality.js';
import * as docsSearch from './docs-search.js';
import * as undo from './undo.js';

// Tool modules are added here as their cards land.
const baseRegistry = mergeNamespaces([meta, server, undo, diagnostics, devRunsRead, devScratchWrite, devSeedWrite, devTestWrite, devCiWrite, devForwardWrite, devForwardRead, devIntegration, devCleanupWrite, repos, reposWrite, codeRead, codeWrite, gitDataCommit, branches, pullsRead, issuesRead, issuesWrite, issuesRelationsWrite, issuesReactionsWrite, issuesTransferWrite, labels, milestones, labelsSync, searchGitHub, discussions, projectsRead, projectsWrite, projectsManage, projectsItems, moderation, orgPlanning, orgIssueDiscovery, runnersRead, runnersWrite, actionsLimits, advisories, securityScanningWrites, securityConfig, governanceRead, governanceWrite, protectionWrite, webhooksRead, webhooksActions, webhooksSave, accessRead, accessWrite, securityRead, securityScanFiles, securityAlertsWrite, securitySettingsRead, securitySettingsWrite, adminGuided, adminOverview, orgRead, orgGovernanceRead, orgScimWrite, orgSaml, appJwtRead, appJwtInstallGovernance, appJwtWrite, orgWrite, teamRoleRead, teamRoleWrite, billingRead, billingGuided, billingWrite, appsTokens, userAccount, usersPublic, codeQuality, docsSearch, socialWrite, notificationsGists, profiles, appReadiness, projectSetup, workflowHealth, workflowRelease, workflowFind, vulnerabilityAlerts, workflowPr, workflowMerge, workflowReview, workflowCi, pullsWrite, pullsMerge, pullsStacks, reviews, reviewsWrite, actionsRead, actionsWrite, actionsForkApproval, checksRead, asyncJobs, artifactsRead, autofix, wiki, orgAdminExtras, accountExport, copilotSpaces, smallMaster, y9Copilot, y9CopilotRepos, y9Sponsors, y9Hosted, y9AgentTasks, checksWrite, variables, secrets, environmentsRead, environmentsWrite, environmentsPolicies, deploymentsRead, deploymentsWrite, releasesRead, releasesWrite, releasesAssets, pagesRead, packagesRead, pagesWrite, packagesWrite, packagesRestore, universal, universalGraphql, enterprise, enterpriseWrite, enterprisePolicy]);

// C-3: standalone compact connector exposes everyday code/PR/CI tools directly. The
// complete catalog, lazy RTC/Hub protocol and every tool's actual authorization stay unchanged.
// Keep this set bounded by the existing 5,000-token compact tools/list budget.
export const COMPACT_DEVELOPER_TOOLS = Object.freeze([
  'github_repo_get',
  'github_content_get',
  'github_content_push_files',
  'github_content_commit_git_data',
  'github_branch_create',
  'github_commit_list',
  'github_pr_list',
  'github_pr_get',
  'github_pr_list_files',
  'github_pr_create',
  'github_actions_get_run_logs_summary',
  'github_check_get_ci_state',
  'github_review_list_threads'
]);
const directNames = new Set(COMPACT_DEVELOPER_TOOLS);
if (directNames.size !== COMPACT_DEVELOPER_TOOLS.length ||
    COMPACT_DEVELOPER_TOOLS.some(name => !baseRegistry.tools.some(tool => tool.name === name))) {
  throw new Error('Curated compact developer tools must be distinct, registered GitHub tools.');
}
// Do not mutate the frozen read/write declarations. This only sets listing metadata;
// actual calls still reach the exact same guarded handlers and per-profile checks.
const conciseReadSchema = (schema) => schema?.properties
  ? { ...schema, properties: Object.fromEntries(Object.entries(schema.properties).map(([key, spec]) =>
    [key, typeof spec.description === 'string' && spec.description.length > 18
      ? { ...spec, description: spec.description.slice(0, 15).trimEnd() + '…' } : spec])) }
  : schema;
export const registry = {
  ...baseRegistry,
  tools: baseRegistry.tools.map(tool => {
    const compact = directNames.has(tool.name) || tool.compact === true;
    if (!compact) return tool;
    return Object.freeze({ ...tool, compact: true,
      ...(tool.writes !== true && tool.inputSchema?.properties
        ? { compactSchema: conciseReadSchema(tool.inputSchema) } : {}) });
  })
};
