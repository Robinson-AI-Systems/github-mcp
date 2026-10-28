import { redact } from './util.js';
// Y-7b: code scanning default setup, secret-scanning custom patterns and Dependabot organization access.
//  - Private code-scanning may trigger charges for future active committers. A user with GitHub plan permission can
//    authorize it after an uncapped-cost disclosure; the developer's $0 testing rules do not forbid the user's action.
//  - A custom secret pattern is a regular expression. It is data, not a credential: it is sent only as `pattern`, and the
//    change log keeps names and counts, never the expression text.
//  - Dependabot repository access lets Dependabot read other private repositories, so adding repositories is an access change.
import { createHash } from 'node:crypto';
import { defineGithubWrite } from './define-github-write.js';
import { octo, ownerOf, refusal } from './github-write.js';
import { LOGIN, REPO_NAME } from './public-read.js';

const OWNER = { ...LOGIN, description: 'Connected account (default account)' };
const ID = { type: 'integer', minimum: 1 };
const repoTarget = (args, ctx) => {
  if (!args.repo) throw new TypeError('repo is required.');
  return { owner: ownerOf(args, ctx), repo: args.repo, scope: 'repo' };
};
const decl = (extra = {}) => ({ production: 'always', confirm: 'always', cred: 'I', profiles: ['full'], ...extra });
const sorted = (a) => [...(a ?? [])].sort();
const same = (a, b) => sorted(a).join('\u0000') === sorted(b).join('\u0000');

// ---- code scanning default setup -----------------------------------------------------------------------------------------------
const SETUP = '/repos/{owner}/{repo}/code-scanning/default-setup';
const readSetup = async (ctx, t) => {
  const gh = await octo(ctx, t.owner);
  const p = { owner: t.owner, repo: t.repo };
  const repo = (await gh.request('GET /repos/{owner}/{repo}', p)).data;
  const s = (await gh.request(`GET ${SETUP}`, p)).data ?? {};
  return { private: repo.private === true || ['private', 'internal'].includes(repo.visibility), setup: { state: s.state ?? 'not-configured', languages: s.languages ?? [], querySuite: s.query_suite ?? null, runnerType: s.runner_type ?? null, runnerLabel: s.runner_label ?? null, threatModel: s.threat_model ?? null } };
};
const codeScanning = defineGithubWrite({
  name: 'github_security_code_scanning_default_setup', area: 'security', audience: ['O'],
  description: 'Turn code scanning default setup on or off with language/query options; private paid activation warns of unbounded future charges.',
  properties: { owner: OWNER, repo: REPO_NAME, state: { type: 'string', enum: ['configured', 'not-configured'] }, languages: { type: 'array', maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 40 }, uniqueItems: true },
    querySuite: { type: 'string', enum: ['default', 'extended'] }, runnerType: { type: 'string', enum: ['standard', 'labeled'] }, runnerLabel: { type: 'string', maxLength: 100 }, threatModel: { type: 'string', enum: ['remote', 'remote_and_local'] } },
  required: ['repo', 'state'], declarations: decl({ spend: true }), target: repoTarget,
  read: (args, ctx, t) => readSetup(ctx, t),
  price: ({ args, before }) => args.state === 'configured' && before?.private && before.setup.state !== 'configured' ? null : 0,
  classify: ({ args }) => ({ production: args.state === 'configured' ? 'changes how the repository\'s code is scanned for vulnerabilities' : 'switching code scanning off removes protection' }),
  summarize: ({ args, target: t, before }) => `Code scanning default setup for ${t.owner}/${t.repo}: ${before.setup.state} -> ${args.state}${args.languages ? ` (languages ${args.languages.join(', ')})` : ''}${args.state === 'configured' && before.private ? ' - PAID private code scanning, future active-committer charges not capped' : ''}`,
  apply: async ({ args, ctx, target: t, before }) => {
    const s = before.setup;
    const wantsSame = s.state === args.state && (args.state === 'not-configured' || ((args.languages === undefined || same(args.languages, s.languages)) && (args.querySuite === undefined || args.querySuite === s.querySuite)
      && (args.runnerType === undefined || args.runnerType === s.runnerType) && (args.threatModel === undefined || args.threatModel === s.threatModel)));
    if (wantsSame) throw refusal('Default setup already matches; nothing to do.');
    return (await octo(ctx, t.owner)).request(`PATCH ${SETUP}`, { owner: t.owner, repo: t.repo, state: args.state,
      ...(args.languages ? { languages: args.languages } : {}), ...(args.querySuite ? { query_suite: args.querySuite } : {}), ...(args.runnerType ? { runner_type: args.runnerType } : {}),
      ...(args.runnerLabel ? { runner_label: args.runnerLabel } : {}), ...(args.threatModel ? { threat_model: args.threatModel } : {}) });
  },
  readAfter: ({ ctx, target: t }) => readSetup(ctx, t),
  verify: ({ args, after }) => after.setup.state === args.state && (args.languages === undefined || args.state === 'not-configured' || args.languages.every((l) => after.setup.languages.includes(l))),
  inverse: ({ before, target: t }) => (before.setup.state === 'configured'
    ? { tool: 'github_security_code_scanning_default_setup', args: { owner: t.owner, repo: t.repo, state: 'configured', languages: before.setup.languages, ...(before.setup.querySuite ? { querySuite: before.setup.querySuite } : {}) } }
    : { tool: 'github_security_code_scanning_default_setup', args: { owner: t.owner, repo: t.repo, state: 'not-configured' } }),
  present: ({ after }) => ({ defaultSetup: after.setup, note: 'GitHub starts the first scan in the background.' })
});

// ---- secret scanning custom patterns -------------------------------------------------------------------------------------------------------
const patternRoute = (t, one = false) => `${t.scope === 'org' ? '/orgs/{org}' : '/repos/{owner}/{repo}'}/secret-scanning/custom-patterns${one ? '/{pattern_id}' : ''}`;
const patternParams = (t) => (t.scope === 'org' ? { org: t.owner } : { owner: t.owner, repo: t.repo });
const patternTarget = (args, ctx) => {
  const scope = args.scope === 'repo' ? 'repo' : 'org';
  if (scope === 'repo' && !args.repo) throw new TypeError('scope repo needs repo.');
  return { owner: ownerOf(args, ctx), ...(scope === 'repo' ? { repo: args.repo } : {}), scope };
};
const shapePattern = (p) => (p ? { id: p.id, name: redact(String(p.name ?? '')).slice(0, 100), slug: p.slug ?? null, state: p.state ?? null, pushProtection: p.push_protection_enabled === true, version: p.custom_pattern_version ?? null,
  patternSha256: typeof p.pattern === 'string' ? createHash('sha256').update(p.pattern).digest('hex') : null } : null);
const listPatterns = async (ctx, t) => ((await (await octo(ctx, t.owner)).request(`GET ${patternRoute(t)}`, patternParams(t))).data ?? []);
const MATCH = { type: 'array', maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 500 } };
const patternSave = defineGithubWrite({
  name: 'github_security_secret_pattern_save', area: 'security', audience: ['O'],
  description: 'Create, edit or delete a custom secret-scanning pattern (regular expression) for an organization or repository. Deleting needs the name typed.',
  properties: { owner: OWNER, repo: REPO_NAME, scope: { type: 'string', enum: ['org', 'repo'], description: 'org (default) or repo' }, action: { type: 'string', enum: ['create', 'update', 'delete'] },
    patternId: ID, name: { type: 'string', minLength: 1, maxLength: 100 }, pattern: { type: 'string', minLength: 1, maxLength: 1000 }, startDelimiter: { type: 'string', maxLength: 100 }, endDelimiter: { type: 'string', maxLength: 100 },
    mustMatch: MATCH, mustNotMatch: MATCH, afterDelete: { type: 'string', enum: ['delete_alerts', 'resolve_alerts'], description: 'delete only; default resolve_alerts' } },
  required: ['action'], declarations: decl({ production: 'when-target' }), target: patternTarget,
  read: async (args, ctx, t) => {
    if (args.action === 'create' && (!args.name || !args.pattern)) throw refusal('A new pattern needs name and pattern.');
    if (args.action !== 'create' && !args.patternId) throw refusal(`${args.action} needs patternId.`);
    if (args.action === 'update' && args.pattern === undefined && args.startDelimiter === undefined && args.endDelimiter === undefined && !args.mustMatch && !args.mustNotMatch) throw refusal('Give at least one field to change.');
    const list = await listPatterns(ctx, t);
    const current = args.patternId ? list.find((p) => p.id === args.patternId) ?? null : null;
    if (args.action === 'delete' && current && current.name !== args.name) throw refusal('name must be exactly the pattern\'s current name.');
    return { current: shapePattern(current), clash: args.action === 'create' ? shapePattern(list.find((p) => String(p.name).toLowerCase() === args.name.toLowerCase())) : null, count: list.length };
  },
  classify: ({ args, before }) => (args.action === 'delete' && before?.current ? { production: `deleting pattern "${before.current.name}" ${args.afterDelete === 'delete_alerts' ? 'and ALL its alerts' : '(its alerts are resolved)'}; no undo` } : {}),
  summarize: ({ args, target: t, before }) => {
    const where = t.scope === 'org' ? t.owner : `${t.owner}/${t.repo}`;
    if (args.action === 'create') return `Create secret-scanning pattern "${args.name}" for ${where} (expression ${args.pattern.length} characters)`;
    if (!before.current) return `Pattern ${args.patternId} was not found`;
    return args.action === 'update' ? `Edit secret-scanning pattern "${before.current.name}" of ${where}` : `DELETE secret-scanning pattern "${before.current.name}" of ${where}; ${args.afterDelete === 'delete_alerts' ? 'its alerts are deleted' : 'its alerts are resolved'}; no undo`;
  },
  apply: async ({ args, ctx, target: t, before }) => {
    const gh = await octo(ctx, t.owner);
    const p = patternParams(t);
    if (args.action === 'create') {
      if (before.clash) throw refusal(`A pattern named "${args.name}" already exists (id ${before.clash.id}); nothing was created.`);
      return gh.request(`POST ${patternRoute(t)}`, { ...p, patterns: [{ name: args.name, pattern: args.pattern, ...(args.startDelimiter ? { start_delimiter: args.startDelimiter } : {}), ...(args.endDelimiter ? { end_delimiter: args.endDelimiter } : {}),
        ...(args.mustMatch ? { must_match: args.mustMatch } : {}), ...(args.mustNotMatch ? { must_not_match: args.mustNotMatch } : {}) }] });
    }
    if (!before.current) throw refusal('That pattern no longer exists; nothing was changed.', 404);
    if (args.action === 'update') {
      return gh.request(`PATCH ${patternRoute(t, true)}`, { ...p, pattern_id: args.patternId, custom_pattern_version: before.current.version,
        ...(args.pattern !== undefined ? { pattern: args.pattern } : {}), ...(args.startDelimiter !== undefined ? { start_delimiter: args.startDelimiter } : {}), ...(args.endDelimiter !== undefined ? { end_delimiter: args.endDelimiter } : {}),
        ...(args.mustMatch ? { must_match: args.mustMatch } : {}), ...(args.mustNotMatch ? { must_not_match: args.mustNotMatch } : {}) });
    }
    return gh.request(`DELETE ${patternRoute(t)}`, { ...p, patterns: [{ pattern_id: args.patternId, custom_pattern_version: before.current.version }], post_delete_action: args.afterDelete ?? 'resolve_alerts' });
  },
  readAfter: async ({ args, ctx, target: t, response }) => {
    const list = await listPatterns(ctx, t);
    const id = args.patternId ?? response?.data?.created_patterns?.[0]?.id;
    return { current: shapePattern(list.find((p) => p.id === id) ?? (args.action === 'create' ? list.find((p) => p.name === args.name) : null)) };
  },
  verify: ({ args, after }) => (args.action === 'delete' ? after.current === null
    : !!after.current && (args.action === 'create' ? after.current.name === args.name : true) && (args.pattern === undefined || after.current.patternSha256 === createHash('sha256').update(args.pattern).digest('hex'))),
  inverse: ({ args, after, target: t }) => (args.action === 'create' && after.current
    ? { tool: 'github_security_secret_pattern_save', args: { owner: t.owner, ...(t.repo ? { repo: t.repo } : {}), scope: t.scope, action: 'delete', patternId: after.current.id, name: after.current.name } }
    : null),
  present: ({ args, after }) => ({ action: args.action, pattern: after.current })
});

// ---- Dependabot organization access ---------------------------------------------------------------------------------------------------------------
const ACCESS = '/orgs/{org}/dependabot/repository-access';
const readAccess = async (ctx, t) => {
  const gh = await octo(ctx, t.owner);
  const ids = [];
  let level = null;
  for (let page = 1; page <= 10; page += 1) {
    const d = (await gh.request(`GET ${ACCESS}`, { org: t.owner, page, per_page: 100 })).data ?? {};
    level = d.default_level ?? level;
    const repos = d.accessible_repositories ?? [];
    ids.push(...repos.map((r) => r.id));
    if (repos.length < 100) break;
  }
  return { level, ids };
};
const dependabot = defineGithubWrite({
  name: 'github_security_dependabot_org_settings', area: 'security', audience: ['O'],
  description: 'Choose which repositories Dependabot may read across the organization and the default access level. Adding repositories widens access.',
  properties: { org: { ...LOGIN, description: 'Connected organization (default account)' }, addRepositoryIds: { type: 'array', maxItems: 100, items: ID, uniqueItems: true }, removeRepositoryIds: { type: 'array', maxItems: 100, items: ID, uniqueItems: true },
    defaultLevel: { type: 'string', enum: ['public', 'internal'] } },
  required: [], declarations: decl({ production: 'never', accessWidening: true }),
  target: (args, ctx) => {
    if (!args.addRepositoryIds?.length && !args.removeRepositoryIds?.length && !args.defaultLevel) throw new TypeError('Give repositories to add or remove, or a defaultLevel.');
    if (args.addRepositoryIds?.some((id) => args.removeRepositoryIds?.includes(id))) throw new TypeError('A repository cannot be both added and removed.');
    return { owner: ownerOf({ owner: args.org }, ctx), scope: 'org' };
  },
  read: (args, ctx, t) => readAccess(ctx, t),
  classify: ({ args, before }) => {
    const add = (args.addRepositoryIds ?? []).filter((id) => !before?.ids?.includes(id));
    return add.length || (args.defaultLevel === 'internal' && before?.level !== 'internal')
      ? { accessWidening: `Dependabot could read ${add.length ? `${add.length} more repositor${add.length === 1 ? 'y' : 'ies'}` : 'internal repositories'} to update dependencies` } : {};
  },
  summarize: ({ args, target: t, before }) => `Dependabot access in ${t.owner}: ${args.addRepositoryIds?.length ? `add ${args.addRepositoryIds.length}` : 'add none'}, ${args.removeRepositoryIds?.length ? `remove ${args.removeRepositoryIds.length}` : 'remove none'}${args.defaultLevel ? `, default level ${before.level} -> ${args.defaultLevel}` : ''}`,
  apply: async ({ args, ctx, target: t, before }) => {
    const add = (args.addRepositoryIds ?? []).filter((id) => !before.ids.includes(id));
    const rem = (args.removeRepositoryIds ?? []).filter((id) => before.ids.includes(id));
    const levelChange = args.defaultLevel && args.defaultLevel !== before.level;
    if (!add.length && !rem.length && !levelChange) throw refusal('Dependabot access already matches; nothing to do.');
    const gh = await octo(ctx, t.owner);
    let last = null;
    if (add.length || rem.length) last = await gh.request(`PATCH ${ACCESS}`, { org: t.owner, ...(add.length ? { repository_ids_to_add: add } : {}), ...(rem.length ? { repository_ids_to_remove: rem } : {}) });
    if (levelChange) last = await gh.request(`PUT ${ACCESS}/default-level`, { org: t.owner, default_level: args.defaultLevel });
    return last;
  },
  readAfter: ({ ctx, target: t }) => readAccess(ctx, t),
  verify: ({ args, after }) => (args.addRepositoryIds ?? []).every((id) => after.ids.includes(id)) && (args.removeRepositoryIds ?? []).every((id) => !after.ids.includes(id)) && (!args.defaultLevel || after.level === args.defaultLevel),
  inverse: ({ args, before, target: t }) => ({ tool: 'github_security_dependabot_org_settings', args: { org: t.owner,
    ...(args.addRepositoryIds?.length ? { removeRepositoryIds: args.addRepositoryIds.filter((id) => !before.ids.includes(id)) } : {}),
    ...(args.removeRepositoryIds?.length ? { addRepositoryIds: args.removeRepositoryIds.filter((id) => before.ids.includes(id)) } : {}),
    ...(args.defaultLevel && before.level ? { defaultLevel: before.level } : {}) } }),
  present: ({ after }) => ({ defaultLevel: after.level, accessibleRepositories: after.ids.length })
});

const writes = [codeScanning, patternSave, dependabot];
export const tools = writes.map((d) => d.tool);
export const handlers = Object.fromEntries(writes.map((d) => [d.tool.name, d.handler]));
