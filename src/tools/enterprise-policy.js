// GQL-1 (enterprise settings): the enterprise-wide member policies and the enterprise profile, through the person's master
// token. Each call proves enterprise administration, discloses changes, journals and reads back from GitHub.
// Missing verified contracts remain for two-factor requirements/methods, deploy keys, repository projects and the
// repository-creation policy (five linked fields); these are engineering gaps, not additional owner authority limits.
import { defineGithubWrite } from './define-github-write.js';
import { refusal, ownerOf } from './github-write.js';
import { requireEnterprise, ENTERPRISE_SLUG } from '../github/enterprise-access.js';
import { graphql } from '../github/client.js';
import { protectedInside } from './enterprise-write.js';

const E = ENTERPRISE_SLUG;
const ON_OFF = ['ENABLED', 'DISABLED', 'NO_POLICY'];
/** key -> the GraphQL mutation, the field that reads it back, its allowed values, and how risky switching it on is. */
export const POLICIES = {
  members_can_change_repository_visibility: { mutation: 'updateEnterpriseMembersCanChangeRepositoryVisibilitySetting', read: 'membersCanChangeRepositoryVisibilitySetting', values: ON_OFF, widens: 'ENABLED', what: 'members can make repositories public or private' },
  members_can_delete_issues: { mutation: 'updateEnterpriseMembersCanDeleteIssuesSetting', read: 'membersCanDeleteIssuesSetting', values: ON_OFF, widens: 'ENABLED', what: 'members can delete issues' },
  members_can_delete_repositories: { mutation: 'updateEnterpriseMembersCanDeleteRepositoriesSetting', read: 'membersCanDeleteRepositoriesSetting', values: ON_OFF, widens: 'ENABLED', what: 'members can delete or transfer repositories' },
  members_can_invite_collaborators: { mutation: 'updateEnterpriseMembersCanInviteCollaboratorsSetting', read: 'membersCanInviteCollaboratorsSetting', values: ON_OFF, widens: 'ENABLED', what: 'members can invite outside collaborators' },
  members_can_update_protected_branches: { mutation: 'updateEnterpriseMembersCanUpdateProtectedBranchesSetting', read: 'membersCanUpdateProtectedBranchesSetting', values: ON_OFF, widens: 'ENABLED', what: 'repository admins can change branch protection' },
  members_can_view_dependency_insights: { mutation: 'updateEnterpriseMembersCanViewDependencyInsightsSetting', read: 'membersCanViewDependencyInsightsSetting', values: ON_OFF, widens: 'ENABLED', what: 'members can see dependency insights' },
  members_can_make_purchases: { mutation: 'updateEnterpriseMembersCanMakePurchasesSetting', read: 'membersCanMakePurchasesSetting', values: ['ENABLED', 'DISABLED'], widens: 'ENABLED', what: 'members can buy paid GitHub products', spend: true },
  organization_projects: { mutation: 'updateEnterpriseOrganizationProjectsSetting', read: 'organizationProjectsSetting', values: ON_OFF, what: 'organizations can use projects' },
  allow_private_repository_forking: { mutation: 'updateEnterpriseAllowPrivateRepositoryForkingSetting', read: 'allowPrivateRepositoryForkingSetting', values: ON_OFF, widens: 'ENABLED', what: 'private repositories can be forked' },
  default_repository_permission: { mutation: 'updateEnterpriseDefaultRepositoryPermissionSetting', read: 'defaultRepositoryPermissionSetting', values: ['NONE', 'READ', 'WRITE', 'ADMIN', 'NO_POLICY'], widensAbove: ['WRITE', 'ADMIN'], what: 'the default permission every member gets on organization repositories' }
};
const KEYS = Object.keys(POLICIES);
// These three do not change what anyone can do inside a repository; every other policy does, so it is refused while a
// protected repository sits inside the enterprise (same fail-closed rule as attaching a security configuration to everything).
const NOT_REPO_ACCESS = new Set(['organization_projects', 'members_can_view_dependency_insights', 'members_can_make_purchases']);
const FORKING = ['ENTERPRISE_ORGANIZATIONS', 'ENTERPRISE_ORGANIZATIONS_USER_ACCOUNTS', 'EVERYWHERE', 'SAME_ORGANIZATION', 'SAME_ORGANIZATION_USER_ACCOUNTS', 'USER_ACCOUNTS'];
const PROFILE_FIELDS = ['name', 'description', 'location', 'websiteUrl', 'securityContactEmail'];

const entTarget = (args, ctx) => ({ owner: ownerOf({}, ctx), scope: 'org', kind: 'enterprise-settings', enterprise: args.enterprise });
const decl = (extra = {}) => ({ production: 'always', confirm: 'always', cred: 'M', profiles: ['full'], ...extra });
const adminClient = (ctx, t) => requireEnterprise(ctx, t.enterprise, { scope: 'admin:enterprise' });

const POLICY_READ = `query EnterprisePolicies($slug: String!) { enterprise(slug: $slug) { id ownerInfo { ${[...new Set(KEYS.map((k) => POLICIES[k].read))].join(' ')} allowPrivateRepositoryForkingSettingPolicyValue } } }`;
const PROFILE_READ = 'query EnterpriseProfile($slug: String!) { enterprise(slug: $slug) { id name description location websiteUrl securityContactEmail } }';
async function readPolicies(gh, t) {
  const e = (await graphql(gh, POLICY_READ, { slug: t.enterprise }))?.enterprise;
  if (!e?.id) throw refusal(`GitHub did not return enterprise "${t.enterprise}".`);
  return { id: e.id, ...(e.ownerInfo ?? {}) };
}
async function readProfile(gh, t) {
  const e = (await graphql(gh, PROFILE_READ, { slug: t.enterprise }))?.enterprise;
  if (!e?.id) throw refusal(`GitHub did not return enterprise "${t.enterprise}".`);
  return e;
}

const policySet = defineGithubWrite({
  name: 'github_enterprise_policy_set', area: 'enterprise', audience: ['O'],
  description: 'Change one enterprise-wide member policy (repository deletion, visibility, forking, default permission, purchases...); read back.',
  properties: { enterprise: E, setting: { type: 'string', enum: KEYS }, value: { type: 'string', enum: [...new Set(KEYS.flatMap((k) => POLICIES[k].values))] },
    forkingPolicy: { type: 'string', enum: FORKING, description: 'Only for allow_private_repository_forking: where forks may go' } },
  required: ['enterprise', 'setting', 'value'], declarations: decl({ accessWidening: true, spend: true }),
  target: (args, ctx) => {
    const p = POLICIES[args.setting];
    if (!p.values.includes(args.value)) throw new TypeError(`${args.setting} accepts: ${p.values.join(', ')}.`);
    if (args.forkingPolicy && args.setting !== 'allow_private_repository_forking') throw new TypeError('forkingPolicy only applies to allow_private_repository_forking.');
    return entTarget(args, ctx);
  },
  read: async (args, ctx, t) => {
    const gh = await adminClient(ctx, t);
    const state = await readPolicies(gh, t);
    return { ...state, blocked: NOT_REPO_ACCESS.has(args.setting) ? null : await protectedInside(gh, ctx, t) };
  },
  price: ({ args }) => (POLICIES[args.setting].spend && args.value === 'ENABLED' ? null : 0),
  classify: ({ args }) => {
    const p = POLICIES[args.setting];
    const widens = args.value === p.widens || p.widensAbove?.includes(args.value);
    return { production: `an enterprise-wide policy: ${p.what}; it applies to every organization in the enterprise`,
      ...(widens || args.forkingPolicy ? { accessWidening: `${p.what}: set to ${args.value}${args.forkingPolicy ? ` with forks allowed to: ${args.forkingPolicy}` : ''} for the whole enterprise` } : {}) };
  },
  summarize: ({ args, target: t, before }) => (before.blocked
    ? `Refused: ${before.blocked}. This policy would change access to protected resources.`
    : `Set "${POLICIES[args.setting].what}" in ${t.enterprise} to ${args.value} (today: ${before[POLICIES[args.setting].read] ?? 'unknown'})`
      + (args.forkingPolicy ? `; forks may go to ${args.forkingPolicy} (today: ${before.allowPrivateRepositoryForkingSettingPolicyValue ?? 'unset'})` : '')),
  apply: async ({ args, ctx, target: t, before }) => {
    const p = POLICIES[args.setting];
    if (before.blocked) throw refusal(`${before.blocked}, so this policy will not be changed (it would change access to protected resources).`, 403);
    if (before[p.read] === args.value && (!args.forkingPolicy || before.allowPrivateRepositoryForkingSettingPolicyValue === args.forkingPolicy)) throw refusal(`That policy is already ${args.value}; nothing to do.`);
    const gh = await adminClient(ctx, t);
    const doc = `mutation EnterprisePolicySet($input: ${p.mutation[0].toUpperCase()}${p.mutation.slice(1)}Input!) { ${p.mutation}(input: $input) { clientMutationId } }`;
    return graphql(gh, doc, { input: { enterpriseId: before.id, settingValue: args.value, ...(args.forkingPolicy ? { policyValue: args.forkingPolicy } : {}) } });
  },
  readAfter: async ({ ctx, target: t }) => readPolicies(await adminClient(ctx, t), t),
  verify: ({ args, after }) => after[POLICIES[args.setting].read] === args.value
    && (!args.forkingPolicy || after.allowPrivateRepositoryForkingSettingPolicyValue === args.forkingPolicy),
  // The undo puts the old value back only when there was one and no forking policy was changed (that earlier policy value is a separate read).
  inverse: ({ args, before, target: t }) => {
    const prior = before[POLICIES[args.setting].read];
    return prior && !args.forkingPolicy ? { tool: 'github_enterprise_policy_set', args: { enterprise: t.enterprise, setting: args.setting, value: prior } } : null;
  },
  present: ({ args, after }) => ({ setting: args.setting, value: after[POLICIES[args.setting].read] })
});

const profileSet = defineGithubWrite({
  name: 'github_enterprise_profile_set', area: 'enterprise', audience: ['O'],
  description: 'Edit the enterprise profile: name, description, location, website or security contact email; read back.',
  properties: { enterprise: E, name: { type: 'string', minLength: 1, maxLength: 100 }, description: { type: 'string', maxLength: 500 }, location: { type: 'string', maxLength: 100 },
    websiteUrl: { type: 'string', maxLength: 200 }, securityContactEmail: { type: 'string', maxLength: 200 } },
  required: ['enterprise'], declarations: decl(),
  target: (args, ctx) => {
    if (!PROFILE_FIELDS.some((k) => args[k] !== undefined)) throw new TypeError('Give at least one profile field to change.');
    return entTarget(args, ctx);
  },
  read: async (args, ctx, t) => readProfile(await adminClient(ctx, t), t),
  classify: () => ({ production: 'the enterprise profile is shown publicly and to every member' }),
  summarize: ({ args, target: t }) => `Edit the profile of ${t.enterprise}: ${PROFILE_FIELDS.filter((k) => args[k] !== undefined).join(', ')}`,
  apply: async ({ args, ctx, target: t, before }) => {
    if (PROFILE_FIELDS.every((k) => args[k] === undefined || args[k] === before[k])) throw refusal('The profile already shows those values; nothing to do.');
    const gh = await adminClient(ctx, t);
    const input = { enterpriseId: before.id, ...Object.fromEntries(PROFILE_FIELDS.filter((k) => args[k] !== undefined).map((k) => [k, args[k]])) };
    return graphql(gh, 'mutation EnterpriseProfileSet($input: UpdateEnterpriseProfileInput!) { updateEnterpriseProfile(input: $input) { clientMutationId } }', { input });
  },
  readAfter: async ({ ctx, target: t }) => readProfile(await adminClient(ctx, t), t),
  verify: ({ args, after }) => PROFILE_FIELDS.every((k) => args[k] === undefined || after[k] === args[k]),
  // Every changed field must have had a value to put back; an empty earlier value cannot be restored (GitHub reads empty as "no change").
  inverse: ({ args, before, target: t }) => {
    const keys = PROFILE_FIELDS.filter((k) => args[k] !== undefined);
    return keys.every((k) => typeof before[k] === 'string' && before[k] !== '')
      ? { tool: 'github_enterprise_profile_set', args: { enterprise: t.enterprise, ...Object.fromEntries(keys.map((k) => [k, before[k]])) } } : null;
  },
  present: ({ after }) => ({ profile: { name: after.name, description: after.description, location: after.location, websiteUrl: after.websiteUrl, securityContactEmail: after.securityContactEmail } })
});

const writes = [policySet, profileSet];
export const tools = writes.map((d) => d.tool);
export const handlers = Object.fromEntries(writes.map((d) => [d.tool.name, d.handler]));
