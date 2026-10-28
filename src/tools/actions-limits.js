import { redact } from './util.js';
// Y-6b: Actions limits, custom deployment protection rules and Pages builds.
//  - Raising a cache or artifact/log limit means GitHub may store more, which can cost money. The server cannot calculate
//    that bill, so an increase is treated as spend (blocked while the spend limit is $0); lowering or keeping a value is free.
//  - A custom deployment protection rule can only be added for an app GitHub lists as available for that environment.
//  - Answering a custom rule only works for the App that owns the rule; GitHub refuses anyone else, and the tool says so.
import { defineGithubWrite } from './define-github-write.js';
import { missing, octo, ownerOf, refusal } from './github-write.js';
import { LOGIN, REPO_NAME } from './public-read.js';

const OWNER = { ...LOGIN, description: 'Connected account (default account)' };
const SCOPE = { type: 'string', enum: ['org', 'repo'], description: 'org (default) or repo' };
const ENV = { type: 'string', minLength: 1, maxLength: 255 };
const target = (args, ctx) => {
  const scope = args.scope === 'repo' ? 'repo' : 'org';
  if (scope === 'repo' && !args.repo) throw new TypeError('scope repo needs repo.');
  return { owner: ownerOf(args, ctx), ...(scope === 'repo' ? { repo: args.repo } : {}), scope };
};
const repoTarget = (args, ctx) => {
  if (!args.repo) throw new TypeError('repo is required.');
  return { owner: ownerOf(args, ctx), repo: args.repo, scope: 'repo' };
};

// ---- limits ---------------------------------------------------------------------------------------------------------
// Each setting: read route, write route, request field, read field. Cache routes live under /organizations/, others /orgs/.
const SETTINGS = {
  cacheRetentionDays: { org: '/organizations/{org}/actions/cache/retention-limit', repo: '/repos/{owner}/{repo}/actions/cache/retention-limit', field: 'max_cache_retention_days', unit: 'days', spends: true },
  cacheStorageGb: { org: '/organizations/{org}/actions/cache/storage-limit', repo: '/repos/{owner}/{repo}/actions/cache/storage-limit', field: 'max_cache_size_gb', unit: 'GB', spends: true },
  artifactLogRetentionDays: { org: '/orgs/{org}/actions/permissions/artifact-and-log-retention', repo: '/repos/{owner}/{repo}/actions/permissions/artifact-and-log-retention', field: 'days', unit: 'days', spends: true },
  oidcSubject: { org: '/orgs/{org}/actions/oidc/customization/sub', repo: '/repos/{owner}/{repo}/actions/oidc/customization/sub', spends: false }
};
const pathParams = (t) => (t.scope === 'repo' ? { owner: t.owner, repo: t.repo } : { org: t.owner });
const readSetting = async (ctx, t, name) => {
  const s = SETTINGS[name];
  const data = await missing(async () => (await (await octo(ctx, t.owner)).request(`GET ${s[t.scope]}`, pathParams(t))).data);
  if (!data) return null;
  if (name === 'oidcSubject') return { useDefault: data.use_default ?? false, includeClaimKeys: [...(data.include_claim_keys ?? [])].sort(), useImmutableSubject: data.use_immutable_subject ?? false };
  return { value: data[s.field], max: data.maximum_allowed_days ?? null };
};
const sameOidc = (a, b) => !!a && !!b && a.useDefault === b.useDefault && a.useImmutableSubject === b.useImmutableSubject && a.includeClaimKeys.join() === b.includeClaimKeys.join();
const wantedOidc = (args, now) => ({
  useDefault: args.oidcUseDefault ?? now?.useDefault ?? false,
  includeClaimKeys: [...(args.oidcIncludeClaimKeys ?? now?.includeClaimKeys ?? [])].sort(),
  useImmutableSubject: args.oidcUseImmutableSubject ?? now?.useImmutableSubject ?? false
});
const increases = (args, before) => {
  const s = SETTINGS[args.setting];
  return s.spends && Number.isInteger(args.value) && Number.isInteger(before?.now?.value) && args.value > before.now.value;
};

const setLimits = defineGithubWrite({
  name: 'github_actions_set_limits', area: 'actions', audience: ['O'],
  description: 'Set one Actions limit: cache days, cache GB, artifact/log days or the OIDC subject template. Raising a storage limit counts as spend.',
  properties: {
    owner: OWNER, repo: REPO_NAME, scope: SCOPE,
    setting: { type: 'string', enum: Object.keys(SETTINGS) },
    value: { type: 'integer', minimum: 1, maximum: 10000, description: 'Days or GB for the first three settings' },
    oidcUseDefault: { type: 'boolean', description: 'oidcSubject: use GitHub\'s default template (repo scope only)' },
    oidcIncludeClaimKeys: { type: 'array', maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 64 }, uniqueItems: true },
    oidcUseImmutableSubject: { type: 'boolean' }
  },
  required: ['setting'],
  declarations: { production: 'never', confirm: 'always', spend: true, cred: 'I', profiles: ['full'] }, target,
  read: async (args, ctx, t) => {
    if (args.setting === 'oidcSubject') {
      if (args.oidcUseDefault === undefined && !args.oidcIncludeClaimKeys && args.oidcUseImmutableSubject === undefined) throw refusal('Give at least one OIDC option to change.');
      if (t.scope === 'org' && args.oidcUseDefault !== undefined) throw refusal('oidcUseDefault is a repository-only option.');
    } else if (!Number.isInteger(args.value)) throw refusal('value is required for this setting.');
    return { now: await readSetting(ctx, t, args.setting) };
  },
  price: ({ args, before }) => (increases(args, before) ? 1 : 0),
  classify: ({ args, before }) => (increases(args, before) ? {} : {}),
  summarize: ({ args, before, target: t }) => {
    const s = SETTINGS[args.setting];
    const where = t.scope === 'repo' ? `${t.owner}/${t.repo}` : t.owner;
    if (args.setting === 'oidcSubject') return `Change the OIDC subject template of ${where}: ${JSON.stringify(wantedOidc(args, before.now))} (today ${JSON.stringify(before.now)})`;
    return `Set ${args.setting} of ${where} to ${args.value} ${s.unit} (today ${before.now?.value ?? 'unknown'})${increases(args, before) ? ' - an INCREASE: cost not calculable, blocked while the spend limit is $0' : ''}`;
  },
  apply: async ({ args, ctx, target: t, before }) => {
    const s = SETTINGS[args.setting];
    const gh = await octo(ctx, t.owner);
    if (args.setting === 'oidcSubject') {
      const want = wantedOidc(args, before.now);
      if (sameOidc(want, before.now)) throw refusal('The OIDC template already matches; nothing to do.');
      return gh.request(`PUT ${s[t.scope]}`, { ...pathParams(t), include_claim_keys: want.includeClaimKeys, use_immutable_subject: want.useImmutableSubject, ...(t.scope === 'repo' ? { use_default: want.useDefault } : {}) });
    }
    if (before.now?.value === args.value) throw refusal(`${args.setting} is already ${args.value}; nothing to do.`);
    if (before.now?.max && args.value > before.now.max) throw refusal(`GitHub allows at most ${before.now.max} days here.`);
    return gh.request(`PUT ${s[t.scope]}`, { ...pathParams(t), [s.field]: args.value });
  },
  readAfter: async ({ args, ctx, target: t }) => ({ now: await readSetting(ctx, t, args.setting) }),
  verify: ({ args, before, after }) => (args.setting === 'oidcSubject' ? sameOidc(after.now, wantedOidc(args, before.now)) : after.now?.value === args.value),
  inverse: ({ args, before, target: t }) => {
    if (!before.now) return null;
    const scope = { owner: t.owner, ...(t.repo ? { repo: t.repo } : {}), scope: t.scope };
    if (args.setting === 'oidcSubject') return { tool: 'github_actions_set_limits', args: { ...scope, setting: 'oidcSubject', ...(t.scope === 'repo' ? { oidcUseDefault: before.now.useDefault } : {}), oidcIncludeClaimKeys: before.now.includeClaimKeys, oidcUseImmutableSubject: before.now.useImmutableSubject } };
    return { tool: 'github_actions_set_limits', args: { ...scope, setting: args.setting, value: before.now.value } };
  },
  present: ({ args, before, after }) => ({ setting: args.setting, before: before.now, after: after.now })
});

// ---- custom deployment protection rules -----------------------------------------------------------------------------
const RULES = '/repos/{owner}/{repo}/environments/{environment_name}/deployment_protection_rules';
const listRules = async (ctx, t, env) => (await (await octo(ctx, t.owner)).request(`GET ${RULES}`, { owner: t.owner, repo: t.repo, environment_name: env })).data.custom_deployment_protection_rules ?? [];
const listApps = async (ctx, t, env) => (await (await octo(ctx, t.owner)).request(`GET ${RULES}/apps`, { owner: t.owner, repo: t.repo, environment_name: env })).data.available_custom_deployment_protection_rule_integrations ?? [];
const ruleSave = defineGithubWrite({
  name: 'github_env_protection_rule_save', area: 'deployments', audience: ['O'],
  description: 'Add or disable a custom deployment protection rule on an environment. Only an app GitHub lists as available can be added.',
  properties: { owner: OWNER, repo: REPO_NAME, environment: ENV, action: { type: 'string', enum: ['add', 'disable'] }, integrationId: { type: 'integer', minimum: 1, description: 'add: the app id' }, ruleId: { type: 'integer', minimum: 1, description: 'disable: the rule id' } },
  required: ['repo', 'environment', 'action'],
  declarations: { production: 'when-target', confirm: 'always', cred: 'I', profiles: ['full'] }, target: repoTarget,
  read: async (args, ctx, t) => {
    if (args.action === 'add' && !args.integrationId) throw refusal('add needs integrationId.');
    if (args.action === 'disable' && !args.ruleId) throw refusal('disable needs ruleId.');
    const rules = await listRules(ctx, t, args.environment);
    if (args.action === 'disable') return { rules, rule: rules.find((r) => r.id === args.ruleId) ?? null };
    return { rules, app: (await listApps(ctx, t, args.environment)).find((a) => a.id === args.integrationId) ?? null, has: rules.find((r) => r.app?.id === args.integrationId) ?? null };
  },
  classify: ({ args }) => (/^(prod|production|live)$/i.test(args.environment) ? { production: `changes the deployment gate of the "${args.environment}" environment` } : {}),
  summarize: ({ args, before }) => (args.action === 'add'
    ? `Add custom protection rule from app "${before.app?.slug ?? args.integrationId}" to environment "${args.environment}"`
    : `Disable custom protection rule ${args.ruleId}${before.rule ? ` (app "${before.rule.app?.slug}")` : ' (not found)'} on environment "${args.environment}"`),
  apply: async ({ args, ctx, target: t, before }) => {
    const gh = await octo(ctx, t.owner);
    const base = { owner: t.owner, repo: t.repo, environment_name: args.environment };
    if (args.action === 'add') {
      if (!before.app) throw refusal(`App ${args.integrationId} is not available as a custom protection rule for this environment. Install the app and check its rule support first.`);
      if (before.has) throw refusal(`App "${before.app.slug}" already has a rule here (id ${before.has.id}); nothing to do.`);
      return gh.request(`POST ${RULES}`, { ...base, integration_id: args.integrationId });
    }
    if (!before.rule) throw refusal('That rule no longer exists; nothing was disabled.', 404);
    return gh.request(`DELETE ${RULES}/{protection_rule_id}`, { ...base, protection_rule_id: args.ruleId });
  },
  readAfter: async ({ args, ctx, target: t }) => ({ rules: await listRules(ctx, t, args.environment) }),
  verify: ({ args, after }) => (args.action === 'add' ? after.rules.some((r) => r.app?.id === args.integrationId) : !after.rules.some((r) => r.id === args.ruleId)),
  inverse: ({ args, before, after, target: t }) => {
    const base = { owner: t.owner, repo: t.repo, environment: args.environment };
    if (args.action === 'add') { const r = after.rules.find((x) => x.app?.id === args.integrationId); return r ? { tool: 'github_env_protection_rule_save', args: { ...base, action: 'disable', ruleId: r.id } } : null; }
    return before.rule?.app?.id ? { tool: 'github_env_protection_rule_save', args: { ...base, action: 'add', integrationId: before.rule.app.id } } : null;
  },
  present: ({ args, after }) => ({ environment: args.environment, rules: after.rules.map((r) => ({ id: r.id, enabled: r.enabled, app: r.app?.slug ?? null })) })
});

// ---- answering a custom rule ----------------------------------------------------------------------------------------
const reviewCustom = defineGithubWrite({
  name: 'github_deploy_review_custom_rule', area: 'deployments', audience: ['O'],
  description: 'Approve or reject a deployment waiting on a custom protection rule. Works only when this server\'s App owns that rule; GitHub refuses otherwise.',
  properties: { owner: OWNER, repo: REPO_NAME, runId: { type: 'integer', minimum: 1 }, environment: ENV, state: { type: 'string', enum: ['approved', 'rejected'] }, comment: { type: 'string', maxLength: 1000 } },
  required: ['repo', 'runId', 'environment', 'state'],
  declarations: { production: 'always', confirm: 'always', cred: 'I', profiles: ['full'] }, target: repoTarget,
  read: async (args, ctx, t) => {
    const run = await missing(async () => (await (await octo(ctx, t.owner)).request('GET /repos/{owner}/{repo}/actions/runs/{run_id}', { owner: t.owner, repo: t.repo, run_id: args.runId })).data);
    return { run: run ? { id: run.id, status: run.status, conclusion: run.conclusion ?? null } : null };
  },
  classify: ({ args }) => ({ production: `${args.state === 'approved' ? 'lets' : 'stops'} a waiting deployment to "${args.environment}"` }),
  summarize: ({ args, before }) => (before.run ? `${args.state.toUpperCase()} the custom-rule check for run ${args.runId} on "${args.environment}"${args.comment ? ` (comment: ${redact(args.comment).slice(0, 80)})` : ''}` : `Run ${args.runId} was not found`),
  apply: async ({ args, ctx, target: t, before }) => {
    if (!before.run) throw refusal('That workflow run was not found.', 404);
    if (before.run.status !== 'waiting') throw refusal(`Run ${args.runId} is ${before.run.status}, not waiting; there is nothing to answer.`);
    return (await octo(ctx, t.owner)).request('POST /repos/{owner}/{repo}/actions/runs/{run_id}/deployment_protection_rule', { owner: t.owner, repo: t.repo, run_id: args.runId, environment_name: args.environment, state: args.state, ...(args.comment ? { comment: args.comment } : {}) });
  },
  readAfter: async ({ args, ctx, target: t }) => {
    const run = await missing(async () => (await (await octo(ctx, t.owner)).request('GET /repos/{owner}/{repo}/actions/runs/{run_id}', { owner: t.owner, repo: t.repo, run_id: args.runId })).data);
    return { run: run ? { id: run.id, status: run.status } : null };
  },
  verify: ({ after }) => !!after.run && after.run.status !== 'waiting',
  inverse: () => null,
  present: ({ args, after }) => ({ runId: args.runId, state: args.state, runStatus: after.run?.status ?? null, note: 'Only the App that owns the rule can answer it; a refusal from GitHub means it belongs to another App.' })
});

// ---- Pages build ------------------------------------------------------------------------------------------------------
const pagesBuild = defineGithubWrite({
  name: 'github_pages_build_request', area: 'pages', audience: ['Op', 'O'],
  description: 'Ask GitHub to rebuild a repository\'s Pages site from its current source. Free; github_pages_get shows the latest build.',
  properties: { owner: OWNER, repo: REPO_NAME }, required: ['repo'],
  declarations: { production: 'never', confirm: 'when-needed', cred: 'I', profiles: ['full'] }, target: repoTarget,
  read: async (args, ctx, t) => ({ latest: await missing(async () => { const d = (await (await octo(ctx, t.owner)).request('GET /repos/{owner}/{repo}/pages/builds/latest', { owner: t.owner, repo: t.repo })).data; return { status: d.status, created_at: d.created_at ?? null }; }) }),
  classify: () => ({}),
  summarize: ({ target: t, before }) => `Request a Pages rebuild of ${t.owner}/${t.repo} (latest build: ${before.latest?.status ?? 'none'})`,
  apply: async ({ ctx, target: t, before }) => {
    if (before.latest && ['building', 'queued'].includes(before.latest.status)) throw refusal('A Pages build is already running; nothing to do.');
    return (await octo(ctx, t.owner)).request('POST /repos/{owner}/{repo}/pages/builds', { owner: t.owner, repo: t.repo });
  },
  readAfter: async ({ ctx, target: t }) => ({ latest: await missing(async () => ({ status: (await (await octo(ctx, t.owner)).request('GET /repos/{owner}/{repo}/pages/builds/latest', { owner: t.owner, repo: t.repo })).data.status })) }),
  verify: ({ before, after }) => !!after.latest && ['queued', 'building'].includes(after.latest.status) || (!!after.latest && after.latest.status !== before.latest?.status),
  inverse: () => null,
  present: ({ after }) => ({ requested: true, latestStatus: after.latest?.status ?? null })
});

const writes = [setLimits, ruleSave, reviewCustom, pagesBuild];
export const tools = writes.map((d) => d.tool);
export const handlers = Object.fromEntries(writes.map((d) => [d.tool.name, d.handler]));
