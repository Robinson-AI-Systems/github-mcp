import { redact } from './util.js';
// Y-3 (WU-Y3b): acting AS THE VIEWER on things the connected account does not own — following a person, watching a
// repository, public profile links and star lists. Every tool uses the user sign-in (credential U), reads the current
// state first, proves who the viewer is, and reads the result back. Following notifies the other person, so it goes
// through the people guard (an outsider needs confirmation). Nothing here ever writes to the TARGET account's data.
import { defineRead } from './define-read.js';
import { defineGithubWrite } from './define-github-write.js';
import { githubFor, graphql } from '../github/client.js';
import { plain } from './github-read.js';
import { ownerOf, refusal, missing, slug } from './github-write.js';
import { notifyOutsiders, becomesPublic } from './people-guard.js';
import { LOGIN, REPO_NAME } from './public-read.js';
import { personalCred } from '../github/personal-cred.js';

const AS = { ...LOGIN, description: 'Which of your connected accounts acts (default account)' };
const actorTarget = (args, ctx) => ({ owner: ownerOf(args, ctx), scope: 'user', kind: 'user-settings' });
// GOD-2: the master token acts as the person when it is added and covers `scope`; otherwise the user sign-in (U).
const userClient = async (ctx, owner, scope = 'user') => githubFor(ctx, { owner, cred: await personalCred(ctx, scope) });

/** The signed-in user, proven by GET /user with the user credential (never trusted from the arguments). */
async function viewer(ctx, target, scope = 'user') {
  const gh = await userClient(ctx, target.owner, scope);
  const me = (await gh.request('GET /user')).data;
  if (!me?.id || !me?.login || (me.type && me.type !== 'User')) throw refusal('Your GitHub user sign-in could not be verified. Authorize the GitHub App as yourself on the setup page.');
  return { gh, user: { id: me.id, login: me.login } };
}
const status204 = async (gh, route, params) => (await missing(async () => (await gh.request(route, params)).status)) === 204;

// ---- follow / unfollow -------------------------------------------------------------------------------------------
const follow = defineGithubWrite({
  name: 'github_user_follow', area: 'user', audience: ['Op', 'O'],
  description: 'Follow or unfollow a GitHub user or organization as you. Following notifies them, so a stranger needs your confirmation.',
  properties: { as: AS, username: { ...LOGIN, description: 'The person or organization' }, follow: { type: 'boolean', description: 'true to follow (default), false to unfollow' } },
  required: ['username'],
  declarations: { production: 'never', notifies: true, cred: 'U', profiles: ['everyday', 'full'] },
  target: actorTarget,
  read: async (args, ctx, target) => {
    const { gh, user } = await viewer(ctx, target);
    if (user.login.toLowerCase() === args.username.toLowerCase()) throw refusal('You cannot follow yourself.');
    return { user, following: await status204(gh, 'GET /user/following/{username}', { username: args.username }) };
  },
  classify: async ({ args, ctx }) => (args.follow === false ? {} : notifyOutsiders(ctx, { logins: [args.username] })),
  summarize: ({ args, before }) => `${args.follow === false ? 'Unfollow' : 'Follow'} ${args.username} as ${before.user.login} (today ${before.following ? 'following' : 'not following'})${args.follow === false ? '' : '; they will be notified'}`,
  apply: async ({ args, ctx, target, before }) => {
    const { gh, user } = await viewer(ctx, target);
    if (user.id !== before.user.id) throw refusal('The signed-in user changed.');
    if (before.following === (args.follow !== false)) throw refusal(`Already ${before.following ? 'following' : 'not following'} ${args.username}; nothing to do.`);
    return gh.request(`${args.follow === false ? 'DELETE' : 'PUT'} /user/following/{username}`, { username: args.username });
  },
  readAfter: async ({ args, ctx, target }) => {
    const { gh, user } = await viewer(ctx, target);
    return { user, following: await status204(gh, 'GET /user/following/{username}', { username: args.username }) };
  },
  verify: ({ args, before, after }) => after.user.id === before.user.id && after.following === (args.follow !== false) && before.following !== after.following,
  inverse: ({ args, target }) => ({ tool: 'github_user_follow', args: { as: target.owner, username: args.username, follow: args.follow === false } }),
  present: ({ args, after }) => ({ username: args.username, following: after.following })
});

// ---- watching a repository -----------------------------------------------------------------------------------------
const stateOf = (sub) => (!sub ? 'none' : sub.ignored ? 'ignoring' : sub.subscribed ? 'watching' : 'none');
const readSub = async (gh, args) => {
  const sub = await missing(async () => (await gh.request('GET /repos/{owner}/{repo}/subscription', { owner: args.owner, repo: args.repo })).data);
  return stateOf(sub);
};
const watch = defineGithubWrite({
  name: 'github_repo_watch', area: 'user', audience: ['Op'],
  description: 'Watch, ignore or stop watching any repository you can see, as you (user sign-in; no classic notifications token needed).',
  properties: { as: AS, owner: { ...LOGIN, description: 'Repository owner' }, repo: REPO_NAME, state: { type: 'string', enum: ['watching', 'ignoring', 'none'], description: 'watching, ignoring, or none (stop)' } },
  required: ['owner', 'repo', 'state'],
  declarations: { production: 'never', cred: 'U', profiles: ['everyday', 'full'] },
  target: actorTarget,
  read: async (args, ctx, target) => {
    const { gh, user } = await viewer(ctx, target, 'repo');
    return { user, state: await readSub(gh, args) };
  },
  classify: () => ({}),
  summarize: ({ args, before }) => `Set your watch state for ${slug(args.owner, args.repo)} to ${args.state} (today ${before.state})`,
  apply: async ({ args, ctx, target, before }) => {
    const { gh, user } = await viewer(ctx, target, 'repo');
    if (user.id !== before.user.id) throw refusal('The signed-in user changed.');
    if (before.state === args.state) throw refusal(`Already ${args.state}; nothing to do.`);
    const params = { owner: args.owner, repo: args.repo };
    return args.state === 'none'
      ? gh.request('DELETE /repos/{owner}/{repo}/subscription', params)
      : gh.request('PUT /repos/{owner}/{repo}/subscription', { ...params, subscribed: args.state === 'watching', ignored: args.state === 'ignoring' });
  },
  readAfter: async ({ args, ctx, target }) => {
    const { gh, user } = await viewer(ctx, target, 'repo');
    return { user, state: await readSub(gh, args) };
  },
  verify: ({ args, before, after }) => after.user.id === before.user.id && after.state === args.state,
  inverse: ({ args, before, target }) => ({ tool: 'github_repo_watch', args: { as: target.owner, owner: args.owner, repo: args.repo, state: before.state } }),
  present: ({ args, after }) => ({ repository: slug(args.owner, args.repo), state: after.state })
});

// ---- public social links ----------------------------------------------------------------------------------------------
const HTTPS_URL = { type: 'string', minLength: 12, maxLength: 200, pattern: '^https://[^\\s]+$' };
const readSocial = async (gh) => (await gh.request('GET /user/social_accounts')).data.map((s) => ({ provider: s.provider, url: s.url }));
const cleanUrls = (list, label) => {
  const urls = [...new Set((list ?? []).map(String))];
  for (const url of urls) {
    let parsed;
    try { parsed = new URL(url); } catch { throw refusal(`${label} "${redact(url).slice(0, 60)}" is not a valid https address.`); }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw refusal(`${label} "${redact(url).slice(0, 60)}" must be a plain https address.`);
  }
  return urls;
};
const setSocial = defineGithubWrite({
  name: 'github_user_set_social', area: 'user', audience: ['O'],
  description: 'Add or remove https links on your public GitHub profile (at most 4 in total) with a field-by-field read-back.',
  properties: { as: AS, add: { type: 'array', items: HTTPS_URL, maxItems: 4 }, remove: { type: 'array', items: HTTPS_URL, maxItems: 4 } },
  declarations: { production: 'always', confirm: 'always', accessWidening: true, cred: 'U', profiles: ['full'] },
  target: actorTarget,
  read: async (args, ctx, target) => {
    const add = cleanUrls(args.add, 'Link to add'); const remove = cleanUrls(args.remove, 'Link to remove');
    if (!add.length && !remove.length) throw refusal('Give at least one link to add or remove.');
    if (add.some((u) => remove.includes(u))) throw refusal('A link cannot be both added and removed.');
    const { gh, user } = await viewer(ctx, target);
    const links = await readSocial(gh);
    const have = new Set(links.map((l) => l.url));
    if (remove.some((u) => !have.has(u))) throw refusal('A link to remove is not on your profile.');
    if ([...have].filter((u) => !remove.includes(u)).length + add.filter((u) => !have.has(u)).length > 4) throw refusal('GitHub allows at most 4 social links.');
    return { user, links };
  },
  classify: () => becomesPublic({ what: 'The links being added to your profile' }),
  summarize: ({ args, before }) => `Profile links of ${before.user.login}: add ${(args.add ?? []).join(', ') || 'none'}; remove ${(args.remove ?? []).join(', ') || 'none'}`,
  apply: async ({ args, ctx, target, before }) => {
    const { gh, user } = await viewer(ctx, target);
    if (user.id !== before.user.id) throw refusal('The signed-in user changed.');
    const have = new Set(before.links.map((l) => l.url));
    const add = cleanUrls(args.add).filter((u) => !have.has(u)); const remove = cleanUrls(args.remove);
    if (remove.length) await gh.request('DELETE /user/social_accounts', { account_urls: remove });
    if (add.length) return gh.request('POST /user/social_accounts', { account_urls: add });
    return { status: 204, data: null, headers: {} };
  },
  readAfter: async ({ ctx, target }) => { const { gh, user } = await viewer(ctx, target); return { user, links: await readSocial(gh) }; },
  verify: ({ args, before, after }) => {
    const now = new Set(after.links.map((l) => l.url));
    return after.user.id === before.user.id && cleanUrls(args.add).every((u) => now.has(u)) && cleanUrls(args.remove).every((u) => !now.has(u));
  },
  inverse: ({ args, target }) => ({ tool: 'github_user_set_social', args: { as: target.owner, add: args.remove ?? [], remove: args.add ?? [] } }),
  present: ({ after }) => ({ links: after.links })
});

// ---- star lists --------------------------------------------------------------------------------------------------------------
const LISTS_QUERY = `query StarLists { viewer { id login lists(first: 50) { nodes { id name slug description isPrivate items(first: 100) { totalCount nodes { ... on Repository { id nameWithOwner } } } } } } }`;
const REPO_ID_QUERY = `query RepoNode($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { id nameWithOwner isPrivate } }`;
const createMutation = `mutation($name: String!, $description: String, $isPrivate: Boolean) { createUserList(input: {name: $name, description: $description, isPrivate: $isPrivate}) { list { id } } }`;
const updateMutation = `mutation($listId: ID!, $name: String, $description: String, $isPrivate: Boolean) { updateUserList(input: {listId: $listId, name: $name, description: $description, isPrivate: $isPrivate}) { list { id } } }`;
const deleteMutation = `mutation($listId: ID!) { deleteUserList(input: {listId: $listId}) { clientMutationId } }`;
const assignMutation = `mutation($itemId: ID!, $listIds: [ID!]!) { updateUserListsForItem(input: {itemId: $itemId, listIds: $listIds}) { lists { id } } }`;
const shapeList = (l) => ({ id: l.id, name: l.name, slug: l.slug, description: l.description ?? null, isPrivate: l.isPrivate === true, count: l.items?.totalCount ?? 0, repositories: (l.items?.nodes ?? []).filter(Boolean).map((n) => n.nameWithOwner) });
async function readLists(ctx, target) {
  const gh = await userClient(ctx, target.owner, 'repo');
  const v = (await graphql(gh, LISTS_QUERY)).viewer;
  if (!v?.id || !v?.login) throw refusal('Your GitHub user sign-in could not be verified. Authorize the GitHub App as yourself on the setup page.');
  const lists = (v.lists?.nodes ?? []).filter(Boolean);
  return { gh, viewer: { id: v.id, login: v.login }, lists };
}

const starListGet = defineRead({
  name: 'github_star_list_get', area: 'user', audience: ['Op', 'O'],
  description: 'Read your own GitHub star lists with their repositories (needs your user sign-in).',
  properties: { as: AS }, 
  handler: (args, ctx) => plain(async () => {
    const { viewer: v, lists } = await readLists(ctx, actorTarget(args, ctx));
    return { principal: v.login, lists: lists.map(shapeList) };
  })
});

const LIST_NAME = { type: 'string', minLength: 1, maxLength: 32 };
const starListManage = defineGithubWrite({
  name: 'github_star_list_manage', area: 'user', audience: ['Op', 'O'],
  description: 'Create, edit or delete one of your star lists, or put a repository into chosen lists. Deleting a list cannot be undone.',
  properties: { as: AS, action: { type: 'string', enum: ['create', 'update', 'delete', 'assign'] }, name: LIST_NAME, description: { type: 'string', maxLength: 160 }, isPrivate: { type: 'boolean' },
    listId: { type: 'string', minLength: 1, maxLength: 100, description: 'Your list id from github_star_list_get' },
    repo: { type: 'string', maxLength: 140, pattern: '^[A-Za-z0-9-]{1,39}/[A-Za-z0-9._-]{1,100}$', description: 'owner/name, for assign' },
    listIds: { type: 'array', items: { type: 'string', maxLength: 100 }, maxItems: 32, description: 'For assign: ALL of your lists the repository should be in (empty removes it from every list)' } },
  required: ['action'],
  declarations: { production: 'never', confirm: 'always', cred: 'U', profiles: ['full'] },
  target: actorTarget,
  read: async (args, ctx, target) => {
    const a = args.action;
    if (a === 'create' && !args.name) throw refusal('A name is required for a new list.');
    if (['update', 'delete'].includes(a) && !args.listId) throw refusal('listId is required.');
    if (a === 'update' && args.name === undefined && args.description === undefined && args.isPrivate === undefined) throw refusal('Say what to change.');
    if (a === 'assign' && (!args.repo || !Array.isArray(args.listIds))) throw refusal('assign needs repo and listIds.');
    const { gh, viewer: v, lists } = await readLists(ctx, target);
    const mine = new Set(lists.map((l) => l.id));
    if (['update', 'delete'].includes(a) && !mine.has(args.listId)) throw refusal('That list is not one of your own star lists.');
    if (a === 'assign') {
      if (args.listIds.some((id) => !mine.has(id))) throw refusal('Every list id must be one of your own star lists.');
      const [owner, name] = args.repo.split('/');
      const repo = (await graphql(gh, REPO_ID_QUERY, { owner, name })).repository;
      if (!repo?.id) throw refusal('That repository was not found or is not visible to you.');
      return { viewer: v, lists: lists.map(shapeList), repoId: repo.id, repoName: repo.nameWithOwner, memberOf: lists.filter((l) => (l.items?.nodes ?? []).some((n) => n?.id === repo.id)).map((l) => l.id) };
    }
    return { viewer: v, lists: lists.map(shapeList), current: lists.find((l) => l.id === args.listId) ? shapeList(lists.find((l) => l.id === args.listId)) : null };
  },
  classify: ({ args, before }) => (args.action === 'delete' ? { production: `deleting the star list "${before?.current?.name ?? 'unknown'}" cannot be undone` } : args.action === 'create' && args.isPrivate === false ? becomesPublic({ what: 'A public star list' }) : {}),
  summarize: ({ args, before }) => ({
    create: `Create ${args.isPrivate ? 'private' : 'public'} star list "${args.name}" for ${before.viewer.login}`,
    update: `Update star list "${before.current?.name}" (${Object.keys({ name: args.name, description: args.description, isPrivate: args.isPrivate }).filter((k) => args[k] !== undefined).join(', ')})`,
    delete: `DELETE star list "${before.current?.name}" with ${before.current?.count} repositories (cannot be undone)`,
    assign: `Put ${before.repoName} in ${args.listIds?.length} of your lists (today ${before.memberOf?.length})`
  })[args.action],
  apply: async ({ args, ctx, target, before }) => {
    const { gh, viewer: v } = await readLists(ctx, target);
    if (v.id !== before.viewer.id) throw refusal('The signed-in user changed.');
    if (args.action === 'create') return { data: (await graphql(gh, createMutation, { name: args.name, description: args.description ?? null, isPrivate: args.isPrivate ?? true })).createUserList };
    if (args.action === 'update') return { data: (await graphql(gh, updateMutation, { listId: args.listId, name: args.name ?? null, description: args.description ?? null, isPrivate: args.isPrivate ?? null })).updateUserList };
    if (args.action === 'delete') return { data: (await graphql(gh, deleteMutation, { listId: args.listId })).deleteUserList };
    return { data: (await graphql(gh, assignMutation, { itemId: before.repoId, listIds: args.listIds })).updateUserListsForItem };
  },
  readAfter: async ({ args, ctx, target, response }) => {
    const { lists, viewer: v } = await readLists(ctx, target);
    return { viewer: v, lists: lists.map(shapeList), createdId: response?.data?.list?.id ?? null,
      memberOf: args.action === 'assign' ? lists.filter((l) => (l.items?.nodes ?? []).some((n) => n?.nameWithOwner?.toLowerCase() === args.repo.toLowerCase())).map((l) => l.id) : null };
  },
  verify: ({ args, before, after }) => {
    if (after.viewer.id !== before.viewer.id) return false;
    const find = (id) => after.lists.find((l) => l.id === id);
    if (args.action === 'create') { const l = find(after.createdId); return !!l && l.name === args.name && (args.description === undefined || (l.description ?? '') === args.description) && l.isPrivate === (args.isPrivate ?? true); }
    if (args.action === 'update') { const l = find(args.listId); return !!l && (args.name === undefined || l.name === args.name) && (args.description === undefined || (l.description ?? '') === args.description) && (args.isPrivate === undefined || l.isPrivate === args.isPrivate); }
    if (args.action === 'delete') return !find(args.listId);
    return [...after.memberOf].sort().join('|') === [...args.listIds].sort().join('|');
  },
  inverse: ({ args, before, after, target }) => {
    const base = { as: target.owner };
    if (args.action === 'create' && after.createdId) return { tool: 'github_star_list_manage', args: { ...base, action: 'delete', listId: after.createdId } };
    if (args.action === 'update' && before.current) return { tool: 'github_star_list_manage', args: { ...base, action: 'update', listId: args.listId, name: before.current.name, description: before.current.description ?? '', isPrivate: before.current.isPrivate } };
    if (args.action === 'assign') return { tool: 'github_star_list_manage', args: { ...base, action: 'assign', repo: args.repo, listIds: before.memberOf } };
    return null; // delete: a deleted list cannot be restored
  },
  present: ({ args, after }) => ({ action: args.action, lists: after.lists.map((l) => ({ id: l.id, name: l.name, isPrivate: l.isPrivate, count: l.count })) })
});

const writes = [follow, watch, setSocial, starListManage];
export const tools = [...writes.map((d) => d.tool), starListGet.tool];
export const handlers = Object.fromEntries([...writes, starListGet].map((d) => [d.tool.name, d.handler]));
