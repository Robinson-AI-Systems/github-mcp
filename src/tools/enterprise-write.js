import { isOwnerConnection } from '../core/authority.js';
// ENT-1 (writes): GitHub Enterprise settings through the person's master token (credential M). Every write proves the
// person administers the enterprise, previews and confirms like any production change, and is read back from GitHub.
// Not built: the Copilot coding-agent policy write (PUT/POST/DELETE .../copilot/policies/coding_agent). The pinned GitHub
// description has no operation that reads that policy, so a change could not be verified; it stays reachable through the
// universal REST tool and is listed as backlog (docs/ROADMAP.md).
import { defineGithubWrite } from './define-github-write.js';
import { refusal, ownerOf } from './github-write.js';
import { requireEnterprise, ENTERPRISE_SLUG } from '../github/enterprise-access.js';
import { SETTINGS, requestedMatches, shapeConfig, turnsOnPaid } from './security-config.js';
import { readActionsSettings } from './enterprise.js';
import { accessChange } from './people-guard.js';
import { protectedList } from './protect-guard.js';
import { graphql } from '../github/client.js';

const E = ENTERPRISE_SLUG;
const ID = { type: 'integer', minimum: 1 };
const entTarget = (args, ctx) => ({ owner: ownerOf({}, ctx), scope: 'org', kind: 'enterprise-settings', enterprise: args.enterprise });
const decl = (extra = {}) => ({ production: 'always', confirm: 'always', cred: 'M', profiles: ['full'], ...extra });
const adminClient = (ctx, t) => requireEnterprise(ctx, t.enterprise, { scope: 'admin:enterprise' });
const missing = async (run) => { try { return await run(); } catch (e) { if (e?.status === 404) return null; throw e; } };
const CONFIGS = 'enterprises/{enterprise}/code-security/configurations';
const getConfig = (gh, t, id) => missing(async () => (await gh.request(`GET /${CONFIGS}/{configuration_id}`, { enterprise: t.enterprise, configuration_id: id })).data);


// The undo of an edit restores EVERY field the edit changed (name, description, enforcement and nested settings). When any
// changed setting has no clean earlier value to put back, there is no undo (null) rather than a partial one.
const priorOf = (asked, was) => {
  if (was === undefined || was === null) return undefined;
  if (asked && typeof asked === 'object' && !Array.isArray(asked)) {
    if (typeof was !== 'object' || Array.isArray(was)) return undefined;
    const out = {};
    for (const [k, v] of Object.entries(asked)) { const prior = priorOf(v, was[k]); if (prior === undefined) return undefined; out[k] = prior; }
    return out;
  }
  return Array.isArray(asked) ? undefined : was;
};
function configInverse(args, before, t) {
  if (!before.current || !args.configurationId) return null;
  const restore = {};
  if (args.name !== undefined) restore.name = before.current.name;
  if (args.description !== undefined) {
    if (typeof before.current.description !== 'string') return null;
    restore.description = before.current.description;
  }
  if (args.settings) {
    const settings = {};
    for (const [k, v] of Object.entries(args.settings)) {
      const prior = priorOf(v, k === 'enforcement' ? before.current.enforcement : before.current.settings[k]);
      if (prior === undefined) return null;
      settings[k] = prior;
    }
    restore.settings = settings;
  }
  return { tool: 'github_enterprise_security_config_save', args: { enterprise: t.enterprise, configurationId: args.configurationId, ...restore } };
}

// ---- code-security configuration: create / edit ---------------------------------------------------------------------
const configSave = defineGithubWrite({
  name: 'github_enterprise_security_config_save', area: 'enterprise', audience: ['O'],
  description: 'Create or edit an enterprise code-security configuration; paid features carry an explicit future-cost warning.',
  properties: { enterprise: E, configurationId: ID, name: { type: 'string', minLength: 1, maxLength: 100 }, description: { type: 'string', maxLength: 255 }, settings: SETTINGS },
  required: ['enterprise'], declarations: decl({ spend: true }), target: entTarget,
  read: async (args, ctx, t) => {
    const gh = await adminClient(ctx, t);
    if (!args.configurationId) {
      if (!args.name) throw refusal('A new configuration needs a name.');
      const first = (await gh.request(`GET /${CONFIGS}`, { enterprise: t.enterprise, per_page: 100 })).data ?? [];
      return { current: null, clash: first.find((c) => String(c.name).toLowerCase() === args.name.toLowerCase())?.id ?? null };
    }
    if (args.name === undefined && args.description === undefined && !args.settings) throw refusal('Give at least one field to change.');
    return { current: shapeConfig(await getConfig(gh, t, args.configurationId)), clash: null };
  },
  price: ({ args }) => (turnsOnPaid(args.settings) ? null : 0),
  classify: () => ({ production: 'enterprise security settings apply to every organization the configuration is attached to' }),
  summarize: ({ args, target: t, before }) => (before.current
    ? `Edit enterprise code-security configuration "${before.current.name}" of ${t.enterprise}: ${Object.keys(args.settings ?? {}).join(', ') || 'name/description'}`
    : `Create enterprise code-security configuration "${args.name}" in ${t.enterprise}${turnsOnPaid(args.settings) ? ' with PAID features (attaching it to private repositories can incur future charges)' : ''}`),
  apply: async ({ args, ctx, target: t, before }) => {
    const gh = await adminClient(ctx, t);
    const body = { ...(args.name !== undefined ? { name: args.name } : {}), ...(args.description !== undefined ? { description: args.description } : {}), ...(args.settings ?? {}) };
    if (args.configurationId) {
      if (!before.current) throw refusal('That configuration was not found; nothing was changed.', 404);
      return gh.request(`PATCH /${CONFIGS}/{configuration_id}`, { enterprise: t.enterprise, configuration_id: args.configurationId, ...body });
    }
    if (before.clash) throw refusal(`A configuration named "${args.name}" already exists (id ${before.clash}); nothing was created.`);
    return gh.request(`POST /${CONFIGS}`, { enterprise: t.enterprise, ...body });
  },
  readAfter: async ({ args, ctx, target: t, response }) => {
    const id = args.configurationId ?? response?.data?.id;
    return { config: id ? shapeConfig(await getConfig(await adminClient(ctx, t), t, id)) : null };
  },
  verify: ({ args, after }) => !!after.config
    && (args.name === undefined || after.config.name === args.name)
    && (args.description === undefined || after.config.description === args.description)
    && (args.settings?.enforcement === undefined || after.config.enforcement === args.settings.enforcement)
    && Object.entries(args.settings ?? {}).filter(([k]) => k !== 'enforcement').every(([k, v]) => requestedMatches(v, after.config.settings[k])),
  inverse: ({ args, before, target: t }) => configInverse(args, before, t),
  present: ({ after }) => ({ configuration: after.config })
});

// ---- code-security configuration: delete ---------------------------------------------------------------------------
const configDelete = defineGithubWrite({
  name: 'github_enterprise_security_config_delete', area: 'enterprise', audience: ['O'],
  description: 'Delete an enterprise code-security configuration (name typed). Repositories using it are detached. No undo.',
  properties: { enterprise: E, configurationId: ID, name: { type: 'string', minLength: 1, maxLength: 100 } }, required: ['enterprise', 'configurationId', 'name'],
  declarations: decl(), target: entTarget,
  read: async (args, ctx, t) => {
    const current = shapeConfig(await getConfig(await adminClient(ctx, t), t, args.configurationId));
    if (current && current.name !== args.name) throw refusal('name must be exactly the configuration\'s current name.');
    return { current };
  },
  classify: ({ before }) => ({ production: `deleting enterprise configuration "${before?.current?.name ?? ''}" cannot be undone` }),
  summarize: ({ args, before }) => (before.current ? `DELETE enterprise code-security configuration "${before.current.name}"; repositories using it are detached; no undo` : `Configuration ${args.configurationId} no longer exists`),
  apply: async ({ args, ctx, target: t, before }) => {
    if (!before.current) throw refusal('The configuration no longer exists; nothing was deleted.', 404);
    return (await adminClient(ctx, t)).request(`DELETE /${CONFIGS}/{configuration_id}`, { enterprise: t.enterprise, configuration_id: args.configurationId });
  },
  readAfter: async ({ args, ctx, target: t }) => ({ config: await getConfig(await adminClient(ctx, t), t, args.configurationId) }),
  verify: ({ after }) => after.config === null,
  inverse: () => null,
  present: ({ args, before }) => ({ deleted: args.configurationId, name: before.current?.name ?? null, restorable: false })
});

// ---- code-security configuration: attach to all repositories / set the default for new ones -------------------------------
const defaultsOf = async (gh, t, id) => {
  const list = (await gh.request(`GET /${CONFIGS}/defaults`, { enterprise: t.enterprise })).data ?? [];
  return list.find((d) => d.configuration?.id === id)?.default_for_new_repos ?? 'none';
};
// Attaching a configuration to ALL repositories reaches repositories the per-repository gate never sees. So the enterprise's
// organizations are looked up and the attach is refused when a protected repository lives in one (or the list is too long to check).
const ORGS_QUERY = 'query($slug: String!) { enterprise(slug: $slug) { organizations(first: 100) { totalCount nodes { login } } } }';
export async function protectedInside(gh, ctx, t) {
  if (isOwnerConnection(ctx.connection)) return null;
  const entries = (await protectedList(ctx.db)).filter((e) => e.kind === 'repo');
  if (!entries.length) return null;
  const orgs = (await graphql(gh, ORGS_QUERY, { slug: t.enterprise }))?.enterprise?.organizations;
  const names = new Set((orgs?.nodes ?? []).map((n) => String(n.login).toLowerCase()));
  if (!orgs || (orgs.totalCount ?? 0) > names.size) return 'the enterprise has too many organizations to check them against the protected-resources list';
  const hit = entries.find((e) => names.has(String(e.target).split('/')[0]));
  return hit ? `${hit.target} is protected (${hit.level}) and sits inside this enterprise` : null;
}
const configApply = defineGithubWrite({
  name: 'github_enterprise_security_config_apply', area: 'enterprise', audience: ['O'],
  description: 'Attach an enterprise code-security configuration to all repositories, or set which new repositories get it by default.',
  properties: { enterprise: E, configurationId: ID, action: { type: 'string', enum: ['attach', 'set_default'] },
    scope: { type: 'string', enum: ['all', 'all_without_configurations'], description: 'attach: which repositories' },
    newRepos: { type: 'string', enum: ['all', 'none', 'private_and_internal', 'public'], description: 'set_default: which new repositories' } },
  required: ['enterprise', 'configurationId', 'action'], declarations: decl({ spend: true }),
  target: (args, ctx) => {
    if (args.action === 'attach' && !args.scope) throw new TypeError('attach needs a scope.');
    if (args.action === 'set_default' && !args.newRepos) throw new TypeError('set_default needs newRepos.');
    if ((args.action === 'attach' && args.newRepos) || (args.action === 'set_default' && args.scope)) throw new TypeError('Give scope only with attach and newRepos only with set_default.');
    return entTarget(args, ctx);
  },
  read: async (args, ctx, t) => {
    const gh = await adminClient(ctx, t);
    const current = shapeConfig(await getConfig(gh, t, args.configurationId));
    return { current, today: args.action === 'set_default' ? await defaultsOf(gh, t, args.configurationId) : null,
      blocked: args.action === 'attach' ? await protectedInside(gh, ctx, t) : null };
  },
  price: ({ before }) => (before?.current?.paid ? null : 0),
  classify: ({ args }) => ({ production: args.action === 'attach' ? `applies security settings to ${args.scope.replace(/_/g, ' ')} repositories across the enterprise` : 'changes the security settings every NEW repository in the enterprise starts with' }),
  summarize: ({ args, target: t, before }) => (!before.current ? `Configuration ${args.configurationId} was not found`
    : before.blocked ? `Refused: ${before.blocked}. Attaching to all repositories would change protected resources; attach per organization instead.`
    : args.action === 'attach' ? `Attach "${before.current.name}" to ${args.scope.replace(/_/g, ' ')} repositories of ${t.enterprise}${before.current.paid ? ' (PAID settings: private targets can incur future charges)' : ''}; GitHub applies it in the background`
      : `Make "${before.current.name}" the default for ${args.newRepos} new repositories of ${t.enterprise} (today: ${before.today})`),
  apply: async ({ args, ctx, target: t, before }) => {
    if (!before.current) throw refusal('That configuration was not found; nothing was changed.', 404);
    if (before.blocked) throw refusal(`${before.blocked}, so it will not be attached to all repositories. Attach it per organization instead.`, 403);
    const gh = await adminClient(ctx, t);
    if (args.action === 'attach') return gh.request(`POST /${CONFIGS}/{configuration_id}/attach`, { enterprise: t.enterprise, configuration_id: args.configurationId, scope: args.scope });
    if (before.today === args.newRepos) throw refusal(`It is already the default for ${args.newRepos} new repositories; nothing to do.`);
    return gh.request(`PUT /${CONFIGS}/{configuration_id}/defaults`, { enterprise: t.enterprise, configuration_id: args.configurationId, default_for_new_repos: args.newRepos });
  },
  readAfter: async ({ args, ctx, target: t, response }) => {
    const gh = await adminClient(ctx, t);
    if (args.action === 'set_default') return { today: await defaultsOf(gh, t, args.configurationId) };
    // Attaching is asynchronous. What can be proven now: GitHub accepted the request and reports no failed attachment.
    const failed = (await gh.request(`GET /${CONFIGS}/{configuration_id}/repositories`, { enterprise: t.enterprise, configuration_id: args.configurationId, status: 'failed', per_page: 1 })).data ?? [];
    return { accepted: response?.status === 202 || response?.status === 200, failed: failed.length };
  },
  verify: ({ args, after }) => (args.action === 'set_default' ? after.today === args.newRepos : after.accepted === true && after.failed === 0),
  inverse: ({ args, before, target: t }) => (args.action === 'set_default'
    ? { tool: 'github_enterprise_security_config_apply', args: { enterprise: t.enterprise, configurationId: args.configurationId, action: 'set_default', newRepos: before.today } } : null),
  present: ({ args, after }) => ({ configurationId: args.configurationId, action: args.action,
    ...(args.action === 'set_default' ? { defaultForNewRepos: after.today } : { note: 'GitHub accepted the request and reports no failed attachment so far; it attaches in the background, so check github_enterprise_security_configs for progress.' }) })
});

// ---- Dependabot repository access ---------------------------------------------------------------------------------------
const readAccess = async (gh, t) => {
  const repos = [];
  let level = null;
  for (let p = 1; p <= 20; p++) {
    const d = (await gh.request('GET /enterprises/{enterprise}/dependabot/repository-access', { enterprise: t.enterprise, per_page: 100, page: p })).data ?? {};
    level = d.default_level ?? level;
    const rows = (d.accessible_repositories ?? []).filter(Boolean);
    repos.push(...rows.map((r) => r.id));
    if (rows.length < 100) return { level, ids: repos, complete: true };
  }
  return { level, ids: repos, complete: false };
};
const IDS = { type: 'array', items: ID, minItems: 1, maxItems: 100, uniqueItems: true };
const dependabotAccess = defineGithubWrite({
  name: 'github_enterprise_dependabot_access_set', area: 'enterprise', audience: ['O'],
  description: 'Change which repositories Dependabot may access across the enterprise: default level, or repositories to add or remove.',
  properties: { enterprise: E, defaultLevel: { type: 'string', enum: ['public', 'internal'] }, addRepositoryIds: IDS, removeRepositoryIds: IDS },
  required: ['enterprise'], declarations: decl({ accessWidening: true }),
  target: (args, ctx) => {
    const lists = args.addRepositoryIds || args.removeRepositoryIds;
    if (!args.defaultLevel && !lists) throw new TypeError('Give defaultLevel, or repositories to add or remove.');
    if (args.defaultLevel && lists) throw new TypeError('Change the default level and the repository list in separate calls.');
    return entTarget(args, ctx);
  },
  read: async (args, ctx, t) => readAccess(await adminClient(ctx, t), t),
  classify: ({ args, target: t }) => ({
    production: args.defaultLevel ? 'changes which repositories Dependabot can read in every organization of the enterprise' : 'changes the list of repositories Dependabot can read across the enterprise',
    ...accessChange({ who: 'Dependabot', access: 'read access to repositories', where: t?.enterprise ?? 'the enterprise' }) }),
  summarize: ({ args, target: t, before }) => (args.defaultLevel
    ? `Set the default Dependabot repository access of ${t.enterprise} to ${args.defaultLevel} (today: ${before.level ?? 'unset'})`
    : `Dependabot access in ${t.enterprise}: add ${(args.addRepositoryIds ?? []).length}, remove ${(args.removeRepositoryIds ?? []).length} repositories (${before.ids.length} today)`),
  apply: async ({ args, ctx, target: t, before }) => {
    const gh = await adminClient(ctx, t);
    if (args.defaultLevel) {
      if (before.level === args.defaultLevel) throw refusal(`The default level is already ${args.defaultLevel}; nothing to do.`);
      return gh.request('PUT /enterprises/{enterprise}/dependabot/repository-access/default-level', { enterprise: t.enterprise, default_level: args.defaultLevel });
    }
    if (!before.complete) throw refusal('The current repository list is too long to check, so it cannot be changed safely.');
    return gh.request('PATCH /enterprises/{enterprise}/dependabot/repository-access', { enterprise: t.enterprise,
      ...(args.addRepositoryIds ? { repository_ids_to_add: args.addRepositoryIds } : {}), ...(args.removeRepositoryIds ? { repository_ids_to_remove: args.removeRepositoryIds } : {}) });
  },
  readAfter: async ({ ctx, target: t }) => readAccess(await adminClient(ctx, t), t),
  verify: ({ args, after }) => (args.defaultLevel ? after.level === args.defaultLevel
    : after.complete && (args.addRepositoryIds ?? []).every((id) => after.ids.includes(id)) && (args.removeRepositoryIds ?? []).every((id) => !after.ids.includes(id))),
  inverse: ({ args, before, target: t }) => (args.defaultLevel && before.level ? { tool: 'github_enterprise_dependabot_access_set', args: { enterprise: t.enterprise, defaultLevel: before.level } }
    : args.defaultLevel ? null : { tool: 'github_enterprise_dependabot_access_set', args: { enterprise: t.enterprise, ...(args.addRepositoryIds ? { removeRepositoryIds: args.addRepositoryIds.filter((id) => !before.ids.includes(id)) } : {}),
      ...(args.removeRepositoryIds ? { addRepositoryIds: args.removeRepositoryIds.filter((id) => before.ids.includes(id)) } : {}) } }),
  present: ({ after }) => ({ default_level: after.level, repositories: after.ids.length })
});

// ---- Actions settings ---------------------------------------------------------------------------------------------------
const actionsSet = defineGithubWrite({
  name: 'github_enterprise_actions_settings_set', area: 'enterprise', audience: ['O'],
  description: 'Change one enterprise Actions setting: cache retention days, cache storage limit (GB), or add/remove an OIDC custom property.',
  properties: { enterprise: E, cacheRetentionDays: { type: 'integer', minimum: 1, maximum: 365 }, cacheStorageGb: { type: 'integer', minimum: 1, maximum: 10000 },
    addOidcProperty: { type: 'string', minLength: 1, maxLength: 100 }, removeOidcProperty: { type: 'string', minLength: 1, maxLength: 100 } },
  required: ['enterprise'], declarations: decl(),
  target: (args, ctx) => {
    const given = ['cacheRetentionDays', 'cacheStorageGb', 'addOidcProperty', 'removeOidcProperty'].filter((k) => args[k] !== undefined);
    if (given.length !== 1) throw new TypeError('Change exactly one setting per call.');
    return entTarget(args, ctx);
  },
  read: async (args, ctx, t) => readActionsSettings(await adminClient(ctx, t), t.enterprise),
  classify: () => ({ production: 'enterprise-wide GitHub Actions settings apply to every organization and repository' }),
  summarize: ({ args, target: t, before }) => (args.cacheRetentionDays !== undefined ? `Set cache retention of ${t.enterprise} to ${args.cacheRetentionDays} days (today: ${before.cache_retention_days ?? 'unset'})`
    : args.cacheStorageGb !== undefined ? `Set cache storage limit of ${t.enterprise} to ${args.cacheStorageGb} GB (today: ${before.cache_storage_gb ?? 'unset'})`
      : args.addOidcProperty !== undefined ? `Add "${args.addOidcProperty}" to the OIDC token claims of ${t.enterprise}` : `Remove "${args.removeOidcProperty}" from the OIDC token claims of ${t.enterprise}`),
  apply: async ({ args, ctx, target: t, before }) => {
    const gh = await adminClient(ctx, t);
    const names = before.oidc_custom_properties.map((p) => p.name);
    if (args.cacheRetentionDays !== undefined) return gh.request('PUT /enterprises/{enterprise}/actions/cache/retention-limit', { enterprise: t.enterprise, max_cache_retention_days: args.cacheRetentionDays });
    if (args.cacheStorageGb !== undefined) return gh.request('PUT /enterprises/{enterprise}/actions/cache/storage-limit', { enterprise: t.enterprise, max_cache_size_gb: args.cacheStorageGb });
    if (args.addOidcProperty !== undefined) {
      if (names.includes(args.addOidcProperty)) throw refusal('That property is already included; nothing to do.');
      return gh.request('POST /enterprises/{enterprise}/actions/oidc/customization/properties/repo', { enterprise: t.enterprise, custom_property_name: args.addOidcProperty });
    }
    if (!names.includes(args.removeOidcProperty)) throw refusal('That property is not included; nothing to do.');
    return gh.request('DELETE /enterprises/{enterprise}/actions/oidc/customization/properties/repo/{custom_property_name}', { enterprise: t.enterprise, custom_property_name: args.removeOidcProperty });
  },
  readAfter: async ({ ctx, target: t }) => readActionsSettings(await adminClient(ctx, t), t.enterprise),
  verify: ({ args, after }) => (args.cacheRetentionDays !== undefined ? after.cache_retention_days === args.cacheRetentionDays
    : args.cacheStorageGb !== undefined ? after.cache_storage_gb === args.cacheStorageGb
      : args.addOidcProperty !== undefined ? after.oidc_custom_properties.some((p) => p.name === args.addOidcProperty)
        : !after.oidc_custom_properties.some((p) => p.name === args.removeOidcProperty)),
  inverse: ({ args, before, target: t }) => (args.cacheRetentionDays !== undefined && before.cache_retention_days ? { tool: 'github_enterprise_actions_settings_set', args: { enterprise: t.enterprise, cacheRetentionDays: before.cache_retention_days } }
    : args.cacheStorageGb !== undefined && before.cache_storage_gb ? { tool: 'github_enterprise_actions_settings_set', args: { enterprise: t.enterprise, cacheStorageGb: before.cache_storage_gb } }
      : args.addOidcProperty !== undefined ? { tool: 'github_enterprise_actions_settings_set', args: { enterprise: t.enterprise, removeOidcProperty: args.addOidcProperty } }
        : args.removeOidcProperty !== undefined ? { tool: 'github_enterprise_actions_settings_set', args: { enterprise: t.enterprise, addOidcProperty: args.removeOidcProperty } } : null),
  present: ({ after }) => ({ settings: after })
});

const writes = [configSave, configDelete, configApply, dependabotAccess, actionsSet];
export const tools = writes.map((d) => d.tool);
export const handlers = Object.fromEntries(writes.map((d) => [d.tool.name, d.handler]));
