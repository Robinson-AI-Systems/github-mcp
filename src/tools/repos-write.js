import { redact } from './util.js';
// Repositories, change side (D-1 part 2). Every tool is a `defineGithubWrite`: it reads the repository first, the guards classify the
// change (visibility and settings are production; making something public is an access change), the caller previews and confirms, one
// request is sent through `githubFor`, and the result is read back and compared with the intent.
import { defineGithubWrite } from './define-github-write.js';
import { missing, octo, ownerOf, refusal, slug } from './github-write.js';
import { personalCred } from '../github/personal-cred.js';
import { productionReason } from './production-guard.js';

const OWNER = { type: 'string', maxLength: 39, description: 'GitHub account (default: the connection\'s default account)' };
const REPO = { type: 'string', minLength: 1, maxLength: 100 };
const NAME = { type: 'string', minLength: 1, maxLength: 100, pattern: '^[A-Za-z0-9._-]+$' };
const BOOL = { type: 'boolean' };
const repoTarget = (args, ctx) => ({ owner: ownerOf(args, ctx), repo: args.repo, scope: 'repo', kind: 'repo-settings' });
const getRepo = async (ctx, owner, repo, cred = 'I') => (await (await octo(ctx, owner, cred)).request('GET /repos/{owner}/{repo}', { owner, repo })).data;
const readRepo = (args, ctx, target) => getRepo(ctx, target.owner, target.repo);
const afterRepo = ({ ctx, target }) => getRepo(ctx, target.owner, target.repo);
const label = (r) => (r.visibility ?? (r.private ? 'private' : 'public'));
const PUBLIC_RISK = 'anyone can read the code and its history, including old commits';
const isOrg = async (ctx, owner) => (await ctx.db.getAccount(owner))?.account_type === 'Organization';

// ---- create ----
const creationProps = {
  description: { type: 'string', maxLength: 350 }, homepage: { type: 'string', maxLength: 300 },
  visibility: { type: 'string', enum: ['private', 'public'], description: 'Default private; public is an access change' }
};
const createClassify = ({ args }) => (args.visibility === 'public' ? { accessWidening: `the new repository would be public: ${PUBLIC_RISK}` } : {});

const repoCreate = defineGithubWrite({
  name: 'github_repo_create', area: 'repo', audience: ['B'],
  description: 'Create a repository in an organization or user account (private by default; public asks first).',
  properties: { owner: OWNER, name: NAME, ...creationProps, auto_init: { ...BOOL, description: 'Add a README' }, gitignore_template: { type: 'string', maxLength: 60 }, license_template: { type: 'string', maxLength: 60 }, is_template: BOOL },
  required: ['name'],
  declarations: { production: 'never', accessWidening: true },
  target: (args, ctx) => ({ owner: ownerOf(args, ctx), repo: args.name, scope: 'repo' }),
  read: async (args, ctx, target) => missing(() => getRepo(ctx, target.owner, target.repo)),
  classify: createClassify,
  summarize: ({ args, before, target }) => (before ? `${slug(target.owner, args.name)} already exists, so it cannot be created` : `Create ${args.visibility === 'public' ? 'PUBLIC' : 'private'} repository ${slug(target.owner, args.name)}`),
  apply: async ({ args, ctx, before, target }) => {
    if (before) throw refusal(`${slug(target.owner, args.name)} already exists.`);
    const visibility = args.visibility ?? 'private';
    const body = Object.fromEntries(['name', 'description', 'homepage', 'auto_init', 'gitignore_template', 'license_template', 'is_template'].filter((k) => args[k] !== undefined).map((k) => [k, args[k]]));
    if (await isOrg(ctx, target.owner)) return (await octo(ctx, target.owner)).request('POST /orgs/{org}/repos', { org: target.owner, ...body, visibility });
    return (await octo(ctx, target.owner, 'U')).request('POST /user/repos', { ...body, private: visibility !== 'public' });
  },
  readAfter: async ({ args, ctx, target }) => missing(() => getRepo(ctx, target.owner, args.name)),
  verify: ({ args, after }) => !!after && after.name.toLowerCase() === args.name.toLowerCase() && label(after) === (args.visibility ?? 'private'),
  present: ({ after }) => ({ full_name: after?.full_name, visibility: after && label(after), html_url: after?.html_url, default_branch: after?.default_branch })
});

const repoCreateFromTemplate = defineGithubWrite({
  name: 'github_repo_create_from_template', area: 'repo', audience: ['B'],
  description: 'Create a new repository from a template repository (private by default; public asks first).',
  properties: { owner: OWNER, template_owner: { type: 'string', maxLength: 39 }, template_repo: REPO, name: NAME, description: { type: 'string', maxLength: 350 },
    visibility: creationProps.visibility, include_all_branches: BOOL },
  required: ['template_owner', 'template_repo', 'name'],
  declarations: { production: 'never', accessWidening: true },
  target: (args, ctx) => ({ owner: ownerOf(args, ctx), repo: args.name, scope: 'repo' }),
  read: async (args, ctx, target) => ({
    exists: !!(await missing(() => getRepo(ctx, target.owner, target.repo))),
    template: (await (await octo(ctx, target.owner)).request('GET /repos/{owner}/{repo}', { owner: args.template_owner, repo: args.template_repo })).data
  }),
  classify: createClassify,
  summarize: ({ args, before, target }) => (before.exists ? `${slug(target.owner, args.name)} already exists, so it cannot be created`
    : `Create ${args.visibility === 'public' ? 'PUBLIC' : 'private'} repository ${slug(target.owner, args.name)} from the template ${slug(args.template_owner, args.template_repo)}`),
  apply: async ({ args, ctx, before, target }) => {
    if (before.exists) throw refusal(`${slug(target.owner, args.name)} already exists.`);
    return (await octo(ctx, target.owner)).request('POST /repos/{template_owner}/{template_repo}/generate', {
      template_owner: args.template_owner, template_repo: args.template_repo, owner: target.owner, name: args.name, private: args.visibility !== 'public',
      ...(args.description ? { description: args.description } : {}), ...(args.include_all_branches ? { include_all_branches: true } : {}) });
  },
  readAfter: async ({ args, ctx, target }) => missing(() => getRepo(ctx, target.owner, args.name)),
  verify: ({ args, after }) => !!after && after.name.toLowerCase() === args.name.toLowerCase() && label(after) === (args.visibility ?? 'private'),
  present: ({ after }) => ({ full_name: after?.full_name, visibility: after && label(after), html_url: after?.html_url })
});

// ---- settings ----
const MERGE_FIELDS = ['allow_squash_merge', 'allow_merge_commit', 'allow_rebase_merge', 'allow_auto_merge', 'delete_branch_on_merge', 'allow_update_branch'];
const PLAIN_FIELDS = ['description', 'homepage', 'has_issues', 'has_projects', 'has_wiki', 'has_pull_requests', 'is_template', 'allow_forking', 'web_commit_signoff_required'];
const SETTING_FIELDS = [...PLAIN_FIELDS, ...MERGE_FIELDS];
const settingChanges = (args) => Object.fromEntries(SETTING_FIELDS.filter((f) => args[f] !== undefined).map((f) => [f, args[f]]));
const changedOnly = (args, before) => Object.entries(settingChanges(args)).filter(([k, v]) => (before[k] ?? null) !== v);
const sameTopics = (a = [], b = []) => a.length === b.length && [...a].sort().every((t, i) => t === [...b].sort()[i]);

const repoUpdateSettings = defineGithubWrite({
  name: 'github_repo_update_settings', area: 'repo', audience: ['B', 'O'],
  description: 'Update repository details, features and production merge options.',
  properties: { owner: OWNER, repo: REPO, description: { type: 'string', maxLength: 350 }, homepage: { type: 'string', maxLength: 300 },
    topics: { type: 'array', items: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,49}$' }, maxItems: 20 },
    has_issues: BOOL, has_projects: BOOL, has_wiki: BOOL, has_pull_requests: BOOL, is_template: BOOL, allow_forking: BOOL, web_commit_signoff_required: BOOL,
    allow_squash_merge: BOOL, allow_merge_commit: BOOL, allow_rebase_merge: BOOL, allow_auto_merge: BOOL, delete_branch_on_merge: BOOL, allow_update_branch: BOOL },
  required: ['repo'],
  declarations: { production: 'when-target', profiles: ['full'] },
  target: (args, ctx) => {
    if (!args.topics && !Object.keys(settingChanges(args)).length) throw new TypeError('Say what to change: a description, homepage, topics, a feature switch or a merge option.');
    return repoTarget(args, ctx);
  },
  read: readRepo,
  classify: async ({ args, ctx, target, before }) => (MERGE_FIELDS.some((f) => args[f] !== undefined && before?.[f] !== args[f]) ? { production: await productionReason(ctx, { ...target, kind: 'repo-settings' }) } : {}),
  summarize: ({ args, before, target }) => {
    const parts = changedOnly(args, before).map(([k, v]) => `${k.replaceAll('_', ' ')}: ${JSON.stringify(before[k] ?? null)} → ${JSON.stringify(v)}`);
    if (args.topics && !sameTopics(args.topics, before.topics)) parts.push(`topics: [${(before.topics ?? []).join(', ')}] → [${args.topics.join(', ')}]`);
    return parts.length ? `Change ${slug(target.owner, target.repo)}: ${parts.join('; ')}` : `${slug(target.owner, target.repo)} already has these settings`;
  },
  apply: async ({ args, ctx, before, target }) => {
    const octokit = await octo(ctx, target.owner);
    const body = Object.fromEntries(changedOnly(args, before));
    if (Object.keys(body).length) await octokit.request('PATCH /repos/{owner}/{repo}', { owner: target.owner, repo: target.repo, ...body });
    if (args.topics && !sameTopics(args.topics, before.topics)) await octokit.request('PUT /repos/{owner}/{repo}/topics', { owner: target.owner, repo: target.repo, names: args.topics });
  },
  readAfter: afterRepo,
  verify: ({ args, after }) => Object.entries(settingChanges(args)).every(([k, v]) => (after[k] ?? null) === v) && (!args.topics || sameTopics(args.topics, after.topics)),
  inverse: ({ args, before }) => {
    const back = Object.fromEntries(Object.keys(settingChanges(args)).filter((k) => before[k] !== undefined && before[k] !== null).map((k) => [k, before[k]]));
    if (args.topics) back.topics = before.topics ?? [];
    return Object.keys(back).length ? { tool: 'github_repo_update_settings', args: { owner: before.owner?.login, repo: before.name, ...back } } : null;
  },
  present: ({ after }) => ({ description: after.description, homepage: after.homepage, topics: after.topics })
});

// ---- one-field changes ----
const sameRepo = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const patch = async (ctx, target, body) => (await octo(ctx, target.owner)).request('PATCH /repos/{owner}/{repo}', { owner: target.owner, repo: target.repo, ...body });
const always = (reason) => () => ({ production: reason });

const repoSetVisibility = defineGithubWrite({
  name: 'github_repo_set_visibility', area: 'repo', audience: ['O'],
  description: 'Make a repository private or public. Public means anyone can read its code and full history.',
  properties: { owner: OWNER, repo: REPO, visibility: { type: 'string', enum: ['private', 'public'] } },
  required: ['repo', 'visibility'],
  declarations: { production: 'always', accessWidening: true, confirm: 'always', profiles: ['full'] },
  target: repoTarget, read: readRepo,
  classify: ({ args, before, target }) => ({ production: `it changes who can see ${slug(target.owner, target.repo)}`,
    ...(args.visibility === 'public' && before && label(before) !== 'public' ? { accessWidening: `${slug(target.owner, target.repo)} would become public: ${PUBLIC_RISK}` } : {}) }),
  summarize: ({ args, before, target }) => (label(before) === args.visibility ? `${slug(target.owner, target.repo)} is already ${args.visibility}`
    : `Making ${slug(target.owner, target.repo)} ${args.visibility}${args.visibility === 'public' ? `: ${PUBLIC_RISK}` : ' (stops anonymous access; forks and stars stay)'}`),
  apply: ({ args, ctx, target }) => patch(ctx, target, { visibility: args.visibility }),
  readAfter: afterRepo, verify: ({ args, after }) => label(after) === args.visibility,
  inverse: ({ before, target }) => ({ tool: 'github_repo_set_visibility', args: { owner: target.owner, repo: target.repo, visibility: label(before) } }),
  present: ({ after }) => ({ visibility: label(after) })
});

const repoSetDefaultBranch = defineGithubWrite({
  name: 'github_repo_set_default_branch', area: 'repo', audience: ['O'],
  description: 'Change default branch; clones, PRs and protection may be affected.',
  properties: { owner: OWNER, repo: REPO, branch: { type: 'string', minLength: 1, maxLength: 250 } },
  required: ['repo', 'branch'],
  declarations: { production: 'always', confirm: 'always', profiles: ['full'] },
  target: repoTarget,
  read: async (args, ctx, target) => ({ repo: await getRepo(ctx, target.owner, target.repo),
    branch: await missing(async () => (await (await octo(ctx, target.owner)).request('GET /repos/{owner}/{repo}/branches/{branch}', { owner: target.owner, repo: target.repo, branch: args.branch })).data) }),
  classify: always('it changes the default branch'),
  summarize: ({ args, before, target }) => (before.branch ? `Change the default branch of ${slug(target.owner, target.repo)} from "${before.repo.default_branch}" to "${args.branch}"`
    : `${slug(target.owner, target.repo)} has no branch called "${args.branch}", so it cannot become the default`),
  apply: async ({ args, ctx, before, target }) => { if (!before.branch) throw refusal(`There is no branch "${args.branch}".`); return patch(ctx, target, { default_branch: args.branch }); },
  readAfter: afterRepo, verify: ({ args, after }) => after.default_branch === args.branch,
  inverse: ({ before, target }) => ({ tool: 'github_repo_set_default_branch', args: { owner: target.owner, repo: target.repo, branch: before.repo.default_branch } }),
  present: ({ after }) => ({ default_branch: after.default_branch })
});

const repoRename = defineGithubWrite({
  name: 'github_repo_rename', area: 'repo', audience: ['O'],
  description: 'Rename a repository (GitHub keeps a redirect from the old name).',
  properties: { owner: OWNER, repo: REPO, new_name: NAME },
  required: ['repo', 'new_name'],
  declarations: { production: 'always', confirm: 'always', profiles: ['full'] },
  target: repoTarget, read: readRepo,
  classify: always('it renames a repository; links, clones and automation that use the old name rely on GitHub\'s redirect'),
  summarize: ({ args, target }) => `Rename ${slug(target.owner, target.repo)} to ${slug(target.owner, args.new_name)}`,
  apply: ({ args, ctx, target }) => patch(ctx, target, { name: args.new_name }),
  readAfter: ({ args, ctx, target }) => getRepo(ctx, target.owner, args.new_name), verify: ({ args, after }) => sameRepo(after.name, args.new_name),
  inverse: ({ args, target }) => ({ tool: 'github_repo_rename', args: { owner: target.owner, repo: args.new_name, new_name: target.repo } }),
  present: ({ after }) => ({ full_name: after.full_name })
});

const repoSetArchived = defineGithubWrite({
  name: 'github_repo_set_archived', area: 'repo', audience: ['O'],
  description: 'Archive (make read-only) or unarchive a repository.',
  properties: { owner: OWNER, repo: REPO, archived: BOOL },
  required: ['repo', 'archived'],
  declarations: { production: 'always', confirm: 'always', profiles: ['full'] },
  target: repoTarget, read: readRepo,
  classify: always('it archives or unarchives a repository'),
  summarize: ({ args, before, target }) => (before.archived === args.archived ? `${slug(target.owner, target.repo)} is already ${args.archived ? 'archived' : 'not archived'}`
    : `${args.archived ? 'Archive' : 'Unarchive'} ${slug(target.owner, target.repo)}${args.archived ? ' (read-only: no pushes, issues or pull requests until unarchived)' : ''}`),
  apply: ({ args, ctx, target }) => patch(ctx, target, { archived: args.archived }),
  readAfter: afterRepo, verify: ({ args, after }) => after.archived === args.archived,
  inverse: ({ args, target }) => ({ tool: 'github_repo_set_archived', args: { owner: target.owner, repo: target.repo, archived: !args.archived } }),
  present: ({ after }) => ({ archived: after.archived })
});

// ---- transfer and delete (destructive; no inverse) ----
const repoTransfer = defineGithubWrite({
  name: 'github_repo_transfer', area: 'repo', audience: ['O'],
  description: 'Transfer a repository to another owner. Destructive: this server cannot reverse it.',
  properties: { owner: OWNER, repo: REPO, new_owner: { type: 'string', minLength: 1, maxLength: 39 }, new_name: NAME },
  required: ['repo', 'new_owner'],
  declarations: { production: 'always', accessWidening: true, confirm: 'always', cred: 'U', profiles: ['full'] },
  target: repoTarget, read: readRepo,
  classify: ({ args, target }) => ({ production: `it moves ${slug(target.owner, target.repo)} out of this account`, accessWidening: `${args.new_owner} would own ${slug(target.owner, target.repo)} and control who can reach it` }),
  summarize: ({ args, before, target }) => `Transfer ${slug(target.owner, target.repo)} (${label(before)}, ${before.forks_count ?? 0} forks, ${before.stargazers_count ?? 0} stars) to ${args.new_owner}${args.new_name ? ` as ${args.new_name}` : ''}. This server cannot undo it`,
  apply: async ({ args, ctx, target }) => (await octo(ctx, target.owner, 'U')).request('POST /repos/{owner}/{repo}/transfer', { owner: target.owner, repo: target.repo, new_owner: args.new_owner, ...(args.new_name ? { new_name: args.new_name } : {}) }),
  readAfter: async ({ args, ctx, target }) => missing(async () => (await (await octo(ctx, target.owner, 'U')).request('GET /repos/{owner}/{repo}', { owner: args.new_owner, repo: args.new_name ?? target.repo })).data),
  verify: ({ args, after }) => !!after && sameRepo(after.owner?.login, args.new_owner),
  present: ({ after }) => ({ now_at: after?.full_name ?? 'pending: a transfer to a person must be accepted by them' })
});

const repoDelete = defineGithubWrite({
  name: 'github_repo_delete', area: 'repo', audience: ['O'],
  description: 'Delete a repository for good. Destructive: this server cannot bring it back.',
  properties: { owner: OWNER, repo: REPO },
  required: ['repo'],
  declarations: { production: 'always', confirm: 'always', profiles: ['full'] },
  target: repoTarget, read: readRepo,
  classify: always('it deletes a repository and everything in it'),
  summarize: ({ before, target }) => `DELETE ${slug(target.owner, target.repo)} (${label(before)}, ${before.size ?? 0} KB, ${before.open_issues_count ?? 0} open issues/PRs, ${before.forks_count ?? 0} forks). It cannot be undone by this server`,
  apply: async ({ ctx, target }) => (await octo(ctx, target.owner)).request('DELETE /repos/{owner}/{repo}', { owner: target.owner, repo: target.repo }),
  readAfter: async ({ ctx, target }) => ((await missing(() => getRepo(ctx, target.owner, target.repo))) === null ? 'gone' : 'still there'),
  verify: ({ after }) => after === 'gone',
  present: () => ({ deleted: true })
});

// ---- forks, custom properties, stars ----
const repoFork = defineGithubWrite({
  name: 'github_repo_fork', area: 'repo', audience: ['B'],
  description: 'Fork a repository into one of your accounts (uses your own sign-in).',
  properties: { source_owner: { type: 'string', maxLength: 39 }, source_repo: REPO, owner: { ...OWNER, description: 'Account that receives the fork (default account)' }, name: NAME, default_branch_only: BOOL },
  required: ['source_owner', 'source_repo'],
  declarations: { production: 'never', cred: 'U' },
  target: (args, ctx) => ({ owner: ownerOf(args, ctx), repo: args.name ?? args.source_repo, scope: 'repo' }),
  read: async (args, ctx, target) => ({ source: (await (await octo(ctx, target.owner, 'U')).request('GET /repos/{owner}/{repo}', { owner: args.source_owner, repo: args.source_repo })).data,
    existing: await missing(() => getRepo(ctx, target.owner, target.repo, 'U')) }),
  classify: () => ({}),
  summarize: ({ args, before, target }) => (before.existing ? `${slug(target.owner, target.repo)} already exists, so the fork cannot be created` : `Fork ${slug(args.source_owner, args.source_repo)} (${label(before.source)}) into ${slug(target.owner, target.repo)}`),
  apply: async ({ args, ctx, before, target }) => {
    if (before.existing) throw refusal(`${slug(target.owner, target.repo)} already exists.`);
    const org = await isOrg(ctx, target.owner);
    return (await octo(ctx, target.owner, 'U')).request('POST /repos/{owner}/{repo}/forks', { owner: args.source_owner, repo: args.source_repo, ...(org ? { organization: target.owner } : {}), ...(args.name ? { name: args.name } : {}), ...(args.default_branch_only ? { default_branch_only: true } : {}) });
  },
  readAfter: async ({ ctx, target }) => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const found = await missing(() => getRepo(ctx, target.owner, target.repo, 'U'));
      if (found) return found;
      await (ctx.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(1500);
    }
    return null;
  },
  verify: ({ after }) => !!after?.fork,
  present: ({ after }) => ({ full_name: after?.full_name, parent: after?.parent?.full_name })
});

const repoSyncFork = defineGithubWrite({
  name: 'github_repo_sync_fork', area: 'repo', audience: ['B'],
  description: 'Bring a fork\'s branch up to date with its upstream repository.',
  properties: { owner: OWNER, repo: REPO, branch: { type: 'string', maxLength: 250, description: 'Default: the fork\'s default branch' } },
  required: ['repo'],
  declarations: { production: 'when-target' },
  target: (args, ctx) => ({ owner: ownerOf(args, ctx), repo: args.repo, scope: 'repo', ...(args.branch ? { ref: args.branch } : {}) }),
  read: readRepo,
  classify: async ({ args, ctx, target, before }) => ({ production: await productionReason(ctx, { ...target, ref: args.branch ?? before?.default_branch }) }),
  summarize: ({ args, before, target }) => (before.fork ? `Sync ${slug(target.owner, target.repo)} branch "${args.branch ?? before.default_branch}" with ${before.parent?.full_name ?? 'its upstream'}` : `${slug(target.owner, target.repo)} is not a fork`),
  apply: async ({ args, ctx, before, target }) => {
    if (!before.fork) throw refusal(`${slug(target.owner, target.repo)} is not a fork.`);
    return (await octo(ctx, target.owner)).request('POST /repos/{owner}/{repo}/merge-upstream', { owner: target.owner, repo: target.repo, branch: args.branch ?? before.default_branch });
  },
  readAfter: ({ response }) => response?.data ?? null,
  verify: ({ after }) => ['fast-forward', 'merge', 'none'].includes(after?.merge_type),
  present: ({ after }) => ({ result: after?.merge_type, base_branch: after?.base_branch, message: after?.message })
});

const propertyList = (values) => Object.fromEntries((values ?? []).map((p) => [p.property_name, p.value]));
const sameValue = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const readProperties = async (ctx, target) => propertyList((await (await octo(ctx, target.owner)).request('GET /repos/{owner}/{repo}/properties/values', { owner: target.owner, repo: target.repo })).data);

const repoSetCustomProperties = defineGithubWrite({
  name: 'github_repo_set_custom_properties', area: 'repo', audience: ['O'],
  description: 'Set custom property values on a repository (an organization\'s own labels such as team or tier). null clears one.',
  properties: { owner: OWNER, repo: REPO, properties: { type: 'object', additionalProperties: true, description: 'name -> value (text, list of text, or null to clear); up to 30' } },
  required: ['repo', 'properties'],
  declarations: { production: 'never', profiles: ['full'] },
  target: (args, ctx) => {
    const entries = Object.entries(args.properties ?? {});
    if (!entries.length) throw new TypeError('Give at least one property to set.');
    if (entries.length > 30) throw new TypeError('At most 30 properties at a time.');
    const text = (v) => typeof v === 'string' && v.length <= 1000;
    for (const [name, value] of entries) {
      if (!/^[A-Za-z0-9_.-]{1,75}$/.test(name)) throw new TypeError(`"${redact(name).slice(0, 40)}" is not a valid property name.`);
      if (!(value === null || text(value) || (Array.isArray(value) && value.length <= 50 && value.every(text)))) throw new TypeError(`The value of "${name}" must be text, a list of text, or null.`);
    }
    return { owner: ownerOf(args, ctx), repo: args.repo, scope: 'repo' };
  },
  read: (args, ctx, target) => readProperties(ctx, target),
  classify: () => ({}),
  summarize: ({ args, before, target }) => `Set on ${slug(target.owner, target.repo)}: ${Object.entries(args.properties).map(([k, v]) => `${k}: ${JSON.stringify(before[k] ?? null)} → ${JSON.stringify(v)}`).join('; ')}`,
  apply: async ({ args, ctx, target }) => (await octo(ctx, target.owner)).request('PATCH /repos/{owner}/{repo}/properties/values', { owner: target.owner, repo: target.repo,
    properties: Object.entries(args.properties).map(([property_name, value]) => ({ property_name, value })) }),
  readAfter: ({ ctx, target }) => readProperties(ctx, target),
  verify: ({ args, after }) => Object.entries(args.properties).every(([k, v]) => sameValue(after[k], v)),
  inverse: ({ args, before, target }) => ({ tool: 'github_repo_set_custom_properties', args: { owner: target.owner, repo: target.repo, properties: Object.fromEntries(Object.keys(args.properties).map((k) => [k, before[k] ?? null])) } }),
  present: ({ after }) => ({ properties: after })
});

const repoStar = defineGithubWrite({
  name: 'github_repo_star', area: 'repo', audience: ['Op'],
  description: 'Star or unstar a repository as you (uses your own sign-in).',
  properties: { owner: { ...OWNER, description: 'Which of your accounts to act as (default account)' }, repo_owner: { type: 'string', maxLength: 39 }, repo: REPO, starred: { ...BOOL, description: 'true to star (default), false to unstar' } },
  required: ['repo_owner', 'repo'],
  declarations: { production: 'never', cred: 'U' },
  target: (args, ctx) => ({ owner: ownerOf(args, ctx), scope: 'user' }),
  read: async (args, ctx, target) => (await missing(async () => (await (await octo(ctx, target.owner, await personalCred(ctx, 'repo'))).request('GET /user/starred/{owner}/{repo}', { owner: args.repo_owner, repo: args.repo })).status)) === 204,
  classify: () => ({}),
  summarize: ({ args, before }) => `${args.starred === false ? 'Unstar' : 'Star'} ${slug(args.repo_owner, args.repo)} (today ${before ? 'starred' : 'not starred'})`,
  apply: async ({ args, ctx, target }) => (await octo(ctx, target.owner, await personalCred(ctx, 'repo'))).request(`${args.starred === false ? 'DELETE' : 'PUT'} /user/starred/{owner}/{repo}`, { owner: args.repo_owner, repo: args.repo }),
  readAfter: async ({ args, ctx, target }) => (await missing(async () => (await (await octo(ctx, target.owner, await personalCred(ctx, 'repo'))).request('GET /user/starred/{owner}/{repo}', { owner: args.repo_owner, repo: args.repo })).status)) === 204,
  verify: ({ args, after }) => after === (args.starred !== false),
  inverse: ({ args, target }) => ({ tool: 'github_repo_star', args: { owner: target.owner, repo_owner: args.repo_owner, repo: args.repo, starred: args.starred === false } }),
  present: ({ after }) => ({ starred: after })
});

const all = [repoCreate, repoCreateFromTemplate, repoUpdateSettings, repoSetVisibility, repoSetDefaultBranch, repoRename, repoSetArchived, repoTransfer, repoDelete, repoFork, repoSyncFork, repoSetCustomProperties, repoStar];
export const tools = all.map((d) => d.tool);
export const handlers = Object.fromEntries(all.map((d) => [d.tool.name, d.handler]));
