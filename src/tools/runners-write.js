// Y-6a: self-hosted runners and runner groups. Three rules matter:
//  - registration, removal and just-in-time tokens are SECRETS: the tool seals them in the one-time store and returns only
//    the private setup-page address; no token character ever reaches a result, a log or the change journal;
//  - letting public repositories (or every repository) use a self-hosted runner is a supply-chain risk, so it is off by
//    default and turning it on is an access change that asks first with a plain warning;
//  - a runner that is online and busy is never removed.
import { defineGithubWrite } from './define-github-write.js';
import { missing, octo, ownerOf, refusal } from './github-write.js';
import { ownerOneTimeStore } from './one-time-root.js';
import { LOGIN, REPO_NAME } from './public-read.js';
import { actionsBase, shapeRunner, shapeGroup } from './runners-read.js';

const OWNER = { ...LOGIN, description: 'Connected account (default account)' };
const SCOPE = { type: 'string', enum: ['org', 'repo'], description: 'org (default) or repo' };
const ID = { type: 'integer', minimum: 1 };
const LABEL = { type: 'string', minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9._:-]+$' };
const low = (s) => String(s ?? '').toLowerCase();
const target = (args, ctx) => {
  const scope = args.scope === 'repo' ? 'repo' : 'org';
  if (scope === 'repo' && !args.repo) throw new TypeError('scope repo needs repo.');
  return { owner: ownerOf(args, ctx), ...(scope === 'repo' ? { repo: args.repo } : {}), scope };
};
const orgTarget = (args, ctx) => ({ owner: ownerOf(args, ctx), scope: 'org' });
const base = (t) => actionsBase(t.scope, t.owner, t.repo);
const decl = (extra = {}) => ({ production: 'never', confirm: 'always', cred: 'I', profiles: ['full'], ...extra });
const getRunner = (ctx, t, id) => missing(async () => { const { prefix, params } = base(t); return (await (await octo(ctx, t.owner)).request(`GET ${prefix}/runners/{runner_id}`, { ...params, runner_id: id })).data; });
const customLabels = (runner) => (runner?.labels ?? []).filter((l) => typeof l === 'string' || l.type === 'custom').map((l) => (typeof l === 'string' ? l : l.name));

// ---- remove ---------------------------------------------------------------------------------------------------------
const runnerRemove = defineGithubWrite({
  name: 'github_runner_remove', area: 'actions', audience: ['O'],
  description: 'Remove a self-hosted runner from GitHub. A runner that is online and busy is refused. The machine itself is not touched.',
  properties: { owner: OWNER, repo: REPO_NAME, scope: SCOPE, runnerId: ID }, required: ['runnerId'],
  declarations: decl({ production: 'always' }), target,
  read: async (args, ctx, t) => ({ runner: await getRunner(ctx, t, args.runnerId) }),
  classify: ({ before }) => (before?.runner ? { production: `removing runner "${before.runner.name}" stops it from taking jobs until it is registered again` } : {}),
  summarize: ({ args, before }) => (before.runner ? `REMOVE self-hosted runner ${args.runnerId} "${before.runner.name}" (${before.runner.status}${before.runner.busy ? ', BUSY' : ''})` : `Runner ${args.runnerId} no longer exists`),
  apply: async ({ args, ctx, target: t, before }) => {
    if (!before.runner) throw refusal('The runner no longer exists; nothing was removed.', 404);
    if (before.runner.busy && before.runner.status === 'online') throw refusal(`Runner "${before.runner.name}" is online and busy with a job. Wait for it to finish or cancel the job first.`);
    const { prefix, params } = base(t);
    return (await octo(ctx, t.owner)).request(`DELETE ${prefix}/runners/{runner_id}`, { ...params, runner_id: args.runnerId });
  },
  readAfter: async ({ args, ctx, target: t }) => ({ runner: await getRunner(ctx, t, args.runnerId) }),
  verify: ({ after }) => after.runner === null,
  inverse: () => null,
  present: ({ args, before }) => ({ removed: args.runnerId, name: before.runner?.name ?? null, note: 'Register the machine again with github_runner_register to bring it back.' })
});

// ---- labels ---------------------------------------------------------------------------------------------------------
const setLabels = defineGithubWrite({
  name: 'github_runner_set_labels', area: 'actions', audience: ['O'],
  description: 'Replace the custom labels of a self-hosted runner (built-in labels are kept). Labels decide which jobs the runner takes.',
  properties: { owner: OWNER, repo: REPO_NAME, scope: SCOPE, runnerId: ID, labels: { type: 'array', maxItems: 50, items: LABEL, uniqueItems: true } }, required: ['runnerId', 'labels'],
  declarations: decl(), target,
  read: async (args, ctx, t) => {
    const runner = await getRunner(ctx, t, args.runnerId);
    if (!runner) throw refusal(`Runner ${args.runnerId} was not found.`, 404);
    return { labels: customLabels(runner), name: runner.name };
  },
  classify: () => ({}),
  summarize: ({ args, before }) => `Set custom labels of runner "${before.name}" to [${args.labels.join(', ')}] (today [${before.labels.join(', ')}])`,
  apply: async ({ args, ctx, target: t, before }) => {
    if ([...before.labels].sort().join('|') === [...args.labels].sort().join('|')) throw refusal('Those labels are already set; nothing to do.');
    const { prefix, params } = base(t);
    return (await octo(ctx, t.owner)).request(`PUT ${prefix}/runners/{runner_id}/labels`, { ...params, runner_id: args.runnerId, labels: args.labels });
  },
  readAfter: async ({ args, ctx, target: t }) => ({ labels: customLabels(await getRunner(ctx, t, args.runnerId)) }),
  verify: ({ args, after }) => [...after.labels].sort().join('|') === [...args.labels].sort().join('|'),
  inverse: ({ args, before, target: t }) => ({ tool: 'github_runner_set_labels', args: { owner: t.owner, ...(t.repo ? { repo: t.repo } : {}), scope: t.scope, runnerId: args.runnerId, labels: before.labels } }),
  present: ({ args, after }) => ({ runnerId: args.runnerId, labels: after.labels })
});

// ---- runner groups ----------------------------------------------------------------------------------------------------
const GROUP_ROUTE = '/orgs/{org}/actions/runner-groups/{runner_group_id}';
const getGroup = (ctx, t, id) => missing(async () => (await (await octo(ctx, t.owner)).request(`GET ${GROUP_ROUTE}`, { org: t.owner, runner_group_id: id })).data);
const listGroups = async (ctx, t) => ((await (await octo(ctx, t.owner)).request('GET /orgs/{org}/actions/runner-groups', { org: t.owner, per_page: 100 })).data.runner_groups ?? []);
const PUBLIC_WARNING = 'Public repositories can run code from anyone on a self-hosted runner. A stranger\'s pull request could execute on your machine.';
const groupSave = defineGithubWrite({
  name: 'github_runner_group_save', area: 'actions', audience: ['O'],
  description: 'Create or edit an organization runner group. Allowing public repositories or all repositories is an access change and asks first.',
  properties: { org: { ...LOGIN, description: 'Connected organization (default account)' }, groupId: ID, name: { type: 'string', minLength: 1, maxLength: 100 }, visibility: { type: 'string', enum: ['selected', 'all', 'private'] },
    repositoryIds: { type: 'array', maxItems: 100, items: ID, description: 'For a new group with visibility selected' }, allowsPublicRepositories: { type: 'boolean', description: 'default false' } },
  required: ['name'], declarations: decl({ accessWidening: true }),
  target: (args, ctx) => orgTarget({ owner: args.org }, ctx),
  read: async (args, ctx, t) => {
    const row = await ctx.db.getAccount(t.owner);
    if (row?.account_type !== 'Organization') throw refusal(`${t.owner} is not a connected organization.`);
    if (args.groupId) {
      const current = await getGroup(ctx, t, args.groupId);
      if (!current) throw refusal(`Runner group ${args.groupId} was not found.`, 404);
      if (args.repositoryIds) throw refusal('Use github_runner_group_set_access to change which repositories a group can use.');
      return { current, clash: null };
    }
    return { current: null, clash: (await listGroups(ctx, t)).find((g) => low(g.name) === low(args.name)) ?? null };
  },
  classify: ({ args, before }) => {
    const wasPublic = before?.current?.allows_public_repositories === true;
    const wasAll = before?.current?.visibility === 'all';
    if (args.allowsPublicRepositories === true && !wasPublic) return { accessWidening: PUBLIC_WARNING };
    if (args.visibility === 'all' && !wasAll) return { accessWidening: 'Every repository of the organization could use this group\'s runners.' };
    return {};
  },
  summarize: ({ args, target: t, before }) => (before.current ? `Edit runner group "${before.current.name}" of ${t.owner}${args.allowsPublicRepositories === undefined ? '' : ` (public repositories ${args.allowsPublicRepositories ? 'ALLOWED' : 'not allowed'})`}` : `Create runner group "${args.name}" in ${t.owner} (${args.visibility ?? 'private'}, public repositories ${args.allowsPublicRepositories ? 'ALLOWED' : 'not allowed'})`),
  apply: async ({ args, ctx, target: t, before }) => {
    const gh = await octo(ctx, t.owner);
    const body = { name: args.name, ...(args.visibility ? { visibility: args.visibility } : {}), allows_public_repositories: args.allowsPublicRepositories ?? before.current?.allows_public_repositories ?? false };
    if (before.current) return gh.request(`PATCH ${GROUP_ROUTE}`, { org: t.owner, runner_group_id: before.current.id, ...body });
    if (before.clash) throw refusal(`A runner group named "${args.name}" already exists (id ${before.clash.id}); nothing was created.`);
    if (args.visibility === 'selected' && !args.repositoryIds?.length) throw refusal('A group with visibility selected needs repositoryIds.');
    return gh.request('POST /orgs/{org}/actions/runner-groups', { org: t.owner, ...body, ...(args.visibility === 'selected' ? { selected_repository_ids: args.repositoryIds } : {}) });
  },
  readAfter: async ({ ctx, target: t, before, response }) => ({ group: await getGroup(ctx, t, before.current?.id ?? response?.data?.id) }),
  verify: ({ args, after }) => !!after.group && after.group.name === args.name && (args.visibility === undefined || after.group.visibility === args.visibility) && (args.allowsPublicRepositories === undefined || after.group.allows_public_repositories === args.allowsPublicRepositories),
  inverse: ({ before, after, target: t }) => (before.current
    ? { tool: 'github_runner_group_save', args: { org: t.owner, groupId: before.current.id, name: before.current.name, visibility: before.current.visibility, allowsPublicRepositories: before.current.allows_public_repositories === true } }
    : (after.group ? { tool: 'github_runner_group_delete', args: { org: t.owner, groupId: after.group.id, name: after.group.name } } : null)),
  present: ({ after }) => ({ group: shapeGroup(after.group), untrusted: true })
});

const groupDelete = defineGithubWrite({
  name: 'github_runner_group_delete', area: 'actions', audience: ['O'],
  description: 'Delete an organization runner group (its runners move back to the default group). Type its exact name as name. No undo.',
  properties: { org: { ...LOGIN, description: 'Connected organization (default account)' }, groupId: ID, name: { type: 'string', minLength: 1, maxLength: 100 } }, required: ['groupId', 'name'],
  declarations: decl({ production: 'always' }),
  target: (args, ctx) => orgTarget({ owner: args.org }, ctx),
  read: async (args, ctx, t) => {
    const current = await getGroup(ctx, t, args.groupId);
    if (current && current.name !== args.name) throw refusal('name must be exactly the runner group\'s current name.');
    if (current?.default) throw refusal('The default runner group cannot be deleted.');
    return { current };
  },
  classify: ({ before }) => (before?.current ? { production: `deleting runner group "${before.current.name}" cannot be undone` } : {}),
  summarize: ({ args, before }) => (before.current ? `DELETE runner group "${before.current.name}" (no undo; its runners return to the default group)` : `Runner group ${args.groupId} no longer exists`),
  apply: async ({ args, ctx, target: t, before }) => {
    if (!before.current) throw refusal('The runner group no longer exists; nothing was deleted.', 404);
    return (await octo(ctx, t.owner)).request(`DELETE ${GROUP_ROUTE}`, { org: t.owner, runner_group_id: args.groupId });
  },
  readAfter: async ({ args, ctx, target: t }) => ({ group: await getGroup(ctx, t, args.groupId) }),
  verify: ({ after }) => after.group === null,
  inverse: () => null,
  present: ({ args, before }) => ({ deleted: args.groupId, name: before.current?.name ?? null, restorable: false })
});

const accessRead = async (ctx, t, id) => {
  const gh = await octo(ctx, t.owner);
  const repos = (await gh.request('GET /orgs/{org}/actions/runner-groups/{runner_group_id}/repositories', { org: t.owner, runner_group_id: id, per_page: 100 })).data;
  const runners = (await gh.request('GET /orgs/{org}/actions/runner-groups/{runner_group_id}/runners', { org: t.owner, runner_group_id: id, per_page: 100 })).data;
  return { repositoryIds: (repos.repositories ?? []).map((r) => r.id).sort((a, b) => a - b), runnerIds: (runners.runners ?? []).map((r) => r.id).sort((a, b) => a - b) };
};
const groupAccess = defineGithubWrite({
  name: 'github_runner_group_set_access', area: 'actions', audience: ['O'],
  description: 'Set exactly which repositories and/or which runners belong to an organization runner group (the lists replace the current ones).',
  properties: { org: { ...LOGIN, description: 'Connected organization (default account)' }, groupId: ID, repositoryIds: { type: 'array', maxItems: 100, items: ID, uniqueItems: true }, runnerIds: { type: 'array', maxItems: 100, items: ID, uniqueItems: true } }, required: ['groupId'],
  declarations: decl({ accessWidening: true }),
  target: (args, ctx) => orgTarget({ owner: args.org }, ctx),
  read: async (args, ctx, t) => {
    if (!args.repositoryIds && !args.runnerIds) throw refusal('Give repositoryIds and/or runnerIds.');
    const group = await getGroup(ctx, t, args.groupId);
    if (!group) throw refusal(`Runner group ${args.groupId} was not found.`, 404);
    if (args.repositoryIds && group.visibility !== 'selected') throw refusal('Repository access can only be set on a group whose visibility is "selected".');
    return { group, current: await accessRead(ctx, t, args.groupId) };
  },
  classify: ({ args, before }) => {
    const add = (args.repositoryIds ?? []).filter((id) => !before?.current?.repositoryIds?.includes(id));
    return add.length ? { accessWidening: `${add.length} more repositor${add.length === 1 ? 'y' : 'ies'} could run jobs on "${before.group.name}" runners${before.group.allows_public_repositories ? '. ' + PUBLIC_WARNING : ''}` } : {};
  },
  summarize: ({ args, before }) => `Set access of runner group "${before.group.name}": ${args.repositoryIds ? `repositories ${before.current.repositoryIds.length} -> ${args.repositoryIds.length}` : 'repositories unchanged'}; ${args.runnerIds ? `runners ${before.current.runnerIds.length} -> ${args.runnerIds.length}` : 'runners unchanged'}`,
  apply: async ({ args, ctx, target: t, before }) => {
    const sameRepos = !args.repositoryIds || [...args.repositoryIds].sort((a, b) => a - b).join() === before.current.repositoryIds.join();
    const sameRunners = !args.runnerIds || [...args.runnerIds].sort((a, b) => a - b).join() === before.current.runnerIds.join();
    if (sameRepos && sameRunners) throw refusal('Those lists are already in place; nothing to do.');
    const gh = await octo(ctx, t.owner);
    let last = null;
    if (args.repositoryIds && !sameRepos) last = await gh.request('PUT /orgs/{org}/actions/runner-groups/{runner_group_id}/repositories', { org: t.owner, runner_group_id: args.groupId, selected_repository_ids: args.repositoryIds });
    if (args.runnerIds && !sameRunners) last = await gh.request('PUT /orgs/{org}/actions/runner-groups/{runner_group_id}/runners', { org: t.owner, runner_group_id: args.groupId, runners: args.runnerIds });
    return last;
  },
  readAfter: async ({ args, ctx, target: t }) => ({ current: await accessRead(ctx, t, args.groupId) }),
  verify: ({ args, after }) => (!args.repositoryIds || [...args.repositoryIds].sort((a, b) => a - b).join() === after.current.repositoryIds.join()) && (!args.runnerIds || [...args.runnerIds].sort((a, b) => a - b).join() === after.current.runnerIds.join()),
  inverse: ({ args, before, target: t }) => ({ tool: 'github_runner_group_set_access', args: { org: t.owner, groupId: args.groupId, ...(args.repositoryIds ? { repositoryIds: before.current.repositoryIds } : {}), ...(args.runnerIds ? { runnerIds: before.current.runnerIds } : {}) } }),
  present: ({ args, after }) => ({ groupId: args.groupId, repositories: after.current.repositoryIds.length, runners: after.current.runnerIds.length })
});

// ---- registration / removal / just-in-time tokens (secrets, one-time page only) -------------------------------------------
const secretStore = (ctx) => ownerOneTimeStore(ctx); // ONE-TIME-ROOT-1: the root store, where the setup page reveals
const KINDS = { registration: 'registration-token', remove: 'remove-token', jit: 'generate-jitconfig' };
const register = defineGithubWrite({
  name: 'github_runner_register', area: 'actions', audience: ['O'],
  description: 'Get a runner registration, removal or just-in-time token. It is never shown here: it is revealed once on the private setup page.',
  properties: { owner: OWNER, repo: REPO_NAME, scope: SCOPE, kind: { type: 'string', enum: ['registration', 'remove', 'jit'] }, name: { type: 'string', minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9._-]+$' },
    labels: { type: 'array', maxItems: 20, items: LABEL }, runnerGroupId: { ...ID, description: 'jit only: the runner group (default group is 1)' } },
  required: ['kind'],
  declarations: decl({ production: 'always', accessWidening: true }), target,
  read: async (args, ctx, t) => {
    secretStore(ctx); // no encryption key -> nothing is requested from GitHub
    if (args.kind === 'jit' && !args.name) throw refusal('A just-in-time runner needs a name.');
    const { prefix, params } = base(t);
    const runners = (await (await octo(ctx, t.owner)).request(`GET ${prefix}/runners`, { ...params, per_page: 100 })).data.runners ?? [];
    return { names: runners.map((r) => r.name) };
  },
  classify: ({ args }) => ({
    production: args.kind === 'remove' ? 'creates a token that lets a machine unregister a runner' : 'creates a secret that lets a machine become a runner for your workflows',
    accessWidening: args.kind === 'remove' ? false : 'Whoever holds this token can attach a machine that runs your repositories\' workflow code.'
  }),
  summarize: ({ args, target: t, before }) => `Create a ${args.kind} token for ${t.scope === 'org' ? t.owner : `${t.owner}/${t.repo}`}${args.kind === 'jit' ? ` for runner "${args.name}"` : ''}; it is revealed once on the private setup page, never in this chat${args.kind === 'jit' && before.names.includes(args.name) ? ' (a runner with that name already exists)' : ''}`,
  apply: async ({ args, ctx, target: t }) => {
    const { prefix, params } = base(t);
    const gh = await octo(ctx, t.owner);
    const store = secretStore(ctx);
    let secret; let runner = null; let expires = null;
    if (args.kind === 'jit') {
      const r = (await gh.request(`POST ${prefix}/runners/generate-jitconfig`, { ...params, name: args.name, runner_group_id: args.runnerGroupId ?? 1, labels: args.labels?.length ? args.labels : ['self-hosted'] })).data;
      secret = r.encoded_jit_config; runner = { id: r.runner?.id ?? null, name: r.runner?.name ?? args.name };
    } else {
      const r = (await gh.request(`POST ${prefix}/runners/${KINDS[args.kind]}`, params)).data;
      secret = r.token; expires = r.expires_at ?? null;
    }
    if (typeof secret !== 'string' || !secret) throw refusal('GitHub did not return the expected token.');
    const one = await store.issue({ account: t.owner, kind: `github-runner-${args.kind}-token`, secret });
    return { reveal: one.setupPath, runner, expires };
  },
  readAfter: async ({ args, ctx, target: t, response }) => {
    // A token that GitHub reports as already expired is useless: do not call that confirmed.
    const fresh = !response?.expires || Date.parse(response.expires) > ctx.now();
    if (args.kind !== 'jit') return { runner: null, fresh };
    const { prefix, params } = base(t);
    return { fresh, runner: response?.runner?.id ? (await missing(async () => (await (await octo(ctx, t.owner)).request(`GET ${prefix}/runners/{runner_id}`, { ...params, runner_id: response.runner.id })).data)) : null };
  },
  verify: ({ args, response, after }) => typeof response?.reveal === 'string' && after.fresh && (args.kind !== 'jit' || after.runner?.name === args.name),
  inverse: () => null,
  present: ({ args, response, target: t }) => ({
    kind: args.kind, scope: t.scope, reveal: response.reveal, expires: response.expires, secretExpiresInMinutes: 10,
    hint: args.kind === 'jit' ? 'Open the reveal address in your signed-in setup page, then run the runner with the JIT config.' : `Open the reveal address in your signed-in setup page, then on the machine run ./config.sh ${args.kind === 'remove' ? 'remove' : '--url <your address>'} --token <paste>.`
  })
});

const writes = [runnerRemove, setLabels, groupSave, groupDelete, groupAccess, register];
export const tools = writes.map((d) => d.tool);
export const handlers = Object.fromEntries(writes.map((d) => [d.tool.name, d.handler]));
export { shapeRunner };
