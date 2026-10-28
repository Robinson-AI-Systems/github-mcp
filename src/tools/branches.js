import { redact } from './util.js';
import { isOwnerConnection } from '../core/authority.js';
// Branch/tag tools read actual provider state. Full owner instructions reach
// GitHub, which enforces default-branch and protection rules. Explicit requested
// cleanup has its own closed-PR/head conditions; expectedHeadSha alone is an
// independent accuracy check and does not request the cleanup workflow.
import { listAll } from '../github/client.js';
import { isPlanLimit } from '../github/plan-limit.js';
import { defineRead } from './define-read.js';
import { defineGithubWrite } from './define-github-write.js';
import { OUTSIDE_PROJECT } from './protect-guard.js';
import { missing, octo, ownerOf, refusal, slug } from './github-write.js';
import { plain, readerFor } from './github-read.js';
import { matchesAny, productionReason } from './production-guard.js';

import { overridable } from './rule-override.js';
const OWNER = { type: 'string', maxLength: 39, description: 'GitHub account (default: the connection\'s default account)' };
const REPO = { type: 'string', minLength: 1, maxLength: 100 };
const NAME = { type: 'string', minLength: 1, maxLength: 250 };
const short = (sha) => String(sha ?? '').slice(0, 7);
const getRepo = async (ctx, owner, repo) => (await (await octo(ctx, owner)).request('GET /repos/{owner}/{repo}', { owner, repo })).data;
const refSha = (ctx, owner, repo, ref) => missing(async () => (await (await octo(ctx, owner)).request('GET /repos/{owner}/{repo}/git/ref/{ref}', { owner, repo, ref })).data.object.sha);
/** The commit a branch, tag or SHA names. */
const commitOf = (ctx, owner, repo, ref) => missing(async () => (await (await octo(ctx, owner)).request('GET /repos/{owner}/{repo}/commits/{ref}', { owner, repo, ref })).data.sha);
const branchTarget = (args, ctx, ref) => ({ owner: ownerOf(args, ctx), repo: args.repo, ref, scope: 'repo' });
const tagTarget = (args, ctx) => ({ owner: ownerOf(args, ctx), repo: args.repo, ref: args.tag, scope: 'repo', kind: 'tag' });
const productionOf = (ctx, target) => productionReason(ctx, target).then((production) => ({ production }));
const checkName = (name, what) => {
  if (!/^[^\s~^:?*[\\]+$/.test(name) || name.startsWith('/') || name.endsWith('/') || name.endsWith('.') || name.includes('..') || name.includes('//') || name.endsWith('.lock')) throw new TypeError(`"${redact(String(name)).slice(0, 60)}" is not a valid ${what} name.`);
  return name;
};

// ---- reads ----
export const branchList = defineRead({
  name: 'github_branch_list', area: 'branch', audience: ['B', 'Op'],
  description: 'List branch heads and protection; optionally filter by protected status.',
  properties: { owner: OWNER, repo: REPO, protected: { type: 'boolean', description: 'true: only protected branches; false: only unprotected; leave out for all' }, max: { type: 'integer', minimum: 1, maximum: 500, description: 'Default 100' } },
  required: ['repo'],
  summaryType: 'branch',
  handler: (args, ctx) => plain(async () => {
    const { owner, octokit } = await readerFor(args, ctx);
    // Only sent when the caller chose one: an empty `protected=` makes GitHub return nothing (audit G9).
    const { items, capped } = await listAll(octokit, 'GET /repos/{owner}/{repo}/branches', { owner, repo: args.repo, ...(typeof args.protected === 'boolean' ? { protected: args.protected } : {}) }, { max: args.max ?? 100 });
    return { count: items.length, ...(capped ? { more_exist: true } : {}), items };
  })
});

export const branchGet = defineRead({
  name: 'github_branch_get', area: 'branch', audience: ['B', 'Op'],
  description: 'One branch: its head commit, whether it is protected and every ruleset rule that applies to it.',
  properties: { owner: OWNER, repo: REPO, branch: NAME },
  required: ['repo', 'branch'],
  handler: (args, ctx) => plain(async () => {
    const { owner, octokit } = await readerFor(args, ctx);
    const p = { owner, repo: args.repo };
    const b = (await octokit.request('GET /repos/{owner}/{repo}/branches/{branch}', { ...p, branch: args.branch })).data;
    const repo = (await octokit.request('GET /repos/{owner}/{repo}', p)).data;
    let rules; let planNote = null;
    try {
      const found = (await octokit.request('GET /repos/{owner}/{repo}/rules/branches/{branch}', { ...p, branch: args.branch })).data;
      rules = (Array.isArray(found) ? found : []).map((r) => ({ type: r.type, ruleset: r.ruleset_source ?? r.ruleset_id }));
    } catch (error) { rules = isPlanLimit(error) ? [] : null; if (rules) planNote = 'Rules are not available for this repository on its GitHub plan, so none apply.'; }
    return { ...(planNote ? { rules_note: planNote } : {}), name: b.name, is_default: b.name === repo.default_branch, protected: b.protected, head: b.commit?.sha, message: b.commit?.commit?.message?.split('\n')[0], author: b.commit?.author?.login ?? b.commit?.commit?.author?.name,
      date: b.commit?.commit?.author?.date, rules: rules ?? { unknown: 'The rules for this branch could not be read.' }, html_url: b._links?.html };
  })
});

export const tagList = defineRead({
  name: 'github_tag_list', area: 'tag', audience: ['B', 'Op'],
  description: 'Tags of a repository with the commit each points to.',
  properties: { owner: OWNER, repo: REPO, max: { type: 'integer', minimum: 1, maximum: 500, description: 'Default 100' } },
  required: ['repo'],
  handler: (args, ctx) => plain(async () => {
    const { owner, octokit } = await readerFor(args, ctx);
    const { items, capped } = await listAll(octokit, 'GET /repos/{owner}/{repo}/tags', { owner, repo: args.repo }, { max: args.max ?? 100 });
    return { count: items.length, ...(capped ? { more_exist: true } : {}), items: items.map((t) => ({ name: t.name, sha: t.commit?.sha })) };
  })
});

// ---- branch changes ----
const branchCreate = defineGithubWrite({
  name: 'github_branch_create', area: 'branch', audience: ['B'],
  description: 'Create a branch from any branch, tag or commit (default: the repository\'s real default branch).',
  properties: { owner: OWNER, repo: REPO, branch: NAME, from: { ...NAME, description: 'Branch, tag or commit to start from (default: the default branch)' }, ...OUTSIDE_PROJECT },
  required: ['repo', 'branch'],
  declarations: { production: 'never' },
  target: (args, ctx) => branchTarget(args, ctx, checkName(args.branch, 'branch')),
  read: async (args, ctx, target) => {
    // Non-profiled branches keep the existing general-purpose source behavior.
    // Only an owned-ref create-from-default exception requires a separate
    // positive verification of the repository's actual default branch SHA.
    const profile=await ctx.db?.profileForRepository?.(target.owner,target.repo);
    const owned=profile?.ownedRefs?.some(o=>matchesAny(args.branch,[o.pattern])&&
      o.agentMay?.includes('create-from-default'));
    const defaultBranch=owned?(await getRepo(ctx,target.owner,target.repo)).default_branch:null;
    const defaultBranchSha=owned&&defaultBranch?
      await refSha(ctx,target.owner,target.repo,`heads/${defaultBranch}`):null;
    const from=args.from??(defaultBranch??(await getRepo(ctx,target.owner,target.repo)).default_branch);
    return {from,sha:await commitOf(ctx,target.owner,target.repo,from),
      ...(owned?{defaultBranch,defaultBranchSha}:{}),
      exists:(await refSha(ctx,target.owner,target.repo,`heads/${args.branch}`))!==null};
  },
  classify: () => ({}),
  summarize: ({ args, before, target }) => (before.exists ? `${args.branch} already exists in ${slug(target.owner, target.repo)}, so it cannot be created`
    : before.sha ? `Create branch ${args.branch} in ${slug(target.owner, target.repo)} from ${before.from} (${short(before.sha)})` : `${before.from} does not exist in ${slug(target.owner, target.repo)}, so a branch cannot start from it`),
  apply: async ({ args, ctx, before, target }) => {
    if (before.exists) throw refusal(`${args.branch} already exists.`);
    if (!before.sha) throw refusal(`There is no branch, tag or commit "${before.from}".`, 404);
    return (await octo(ctx, target.owner)).request('POST /repos/{owner}/{repo}/git/refs', { owner: target.owner, repo: target.repo, ref: `refs/heads/${args.branch}`, sha: before.sha });
  },
  readAfter: ({ args, ctx, target }) => refSha(ctx, target.owner, target.repo, `heads/${args.branch}`),
  verify: ({ before, after }) => after === before.sha,
  inverse: ({ args, target }) => ({ tool: 'github_branch_delete', args: { owner: target.owner, repo: target.repo, branch: args.branch } }),
  present: ({ args, after }) => ({ branch: args.branch, sha: after })
});

const branchRename = defineGithubWrite({
  name: 'github_branch_rename', area: 'branch', audience: ['B'],
  description: 'Rename a branch; GitHub retargets its open pull requests.',
  properties: { owner: OWNER, repo: REPO, branch: NAME, new_name: NAME, ...OUTSIDE_PROJECT },
  required: ['repo', 'branch', 'new_name'],
  declarations: { production: 'when-target', confirm: 'always', profiles: ['full'] },
  target: (args, ctx) => { checkName(args.new_name, 'branch'); return branchTarget(args, ctx, args.branch); },
  read: async (args, ctx, target) => ({ sha: await refSha(ctx, target.owner, target.repo, `heads/${args.branch}`), taken: (await refSha(ctx, target.owner, target.repo, `heads/${args.new_name}`)) !== null }),
  classify: ({ ctx, target }) => productionOf(ctx, target),
  summarize: ({ args, before, target }) => (before.taken ? `${args.new_name} already exists in ${slug(target.owner, target.repo)}` : before.sha ? `Rename branch ${args.branch} to ${args.new_name} in ${slug(target.owner, target.repo)}; open pull requests are retargeted` : `There is no branch ${args.branch} in ${slug(target.owner, target.repo)}`),
  apply: async ({ args, ctx, before, target }) => {
    if (!before.sha) throw refusal(`There is no branch ${args.branch}.`, 404);
    if (before.taken) throw refusal(`${args.new_name} already exists.`);
    return (await octo(ctx, target.owner)).request('POST /repos/{owner}/{repo}/branches/{branch}/rename', { owner: target.owner, repo: target.repo, branch: args.branch, new_name: args.new_name });
  },
  readAfter: ({ args, ctx, target }) => refSha(ctx, target.owner, target.repo, `heads/${args.new_name}`),
  verify: ({ before, after }) => after === before.sha,
  inverse: ({ args, target }) => ({ tool: 'github_branch_rename', args: { owner: target.owner, repo: target.repo, branch: args.new_name, new_name: args.branch } }),
  present: ({ args, after }) => ({ branch: args.new_name, sha: after })
});

// Cleanup carries its evidence to the writer boundary and repeats it immediately
// before DELETE. GitHub has no atomic compare-and-delete operation for references.
async function cleanupEvidence(args,ctx,target,sha){
  if(args.cleanupPrNumber===undefined)return;
  if(!args.expectedHeadSha||!args.cleanupPrNumber)throw refusal('Cleanup requires both exact head and closed PR evidence.');
  if(sha!==args.expectedHeadSha)throw refusal('Branch advanced since the cleanup plan; nothing deleted.');
  if(typeof ctx.db?.profileForRepository!=='function')throw refusal('Project ownership policy is unavailable.');
  await ctx.db.getSetting('production_names');
  const profile=await ctx.db.profileForRepository(target.owner,target.repo);
  if(profile?.ownedRefs?.some(x=>matchesAny(args.branch,[x.pattern])))throw refusal('Project-owned refs are never workflow cleanup targets.');
  if(await productionReason(ctx,target))throw refusal('Production, default, protected or unreadable refs are never cleanup targets.');
  const gh=await octo(ctx,target.owner),p={owner:target.owner,repo:target.repo};
  const pr=(await gh.request('GET /repos/{owner}/{repo}/pulls/{pull_number}',{...p,pull_number:args.cleanupPrNumber})).data;
  if(pr.state!=='closed'||pr.head?.ref!==args.branch||pr.head?.sha!==sha||
    pr.head?.repo?.full_name?.toLowerCase()!==`${target.owner}/${target.repo}`.toLowerCase())
    throw refusal('Closed PR does not prove ownership of this exact branch head.');
  const open=await listAll(gh,'GET /repos/{owner}/{repo}/pulls',{...p,state:'open',head:target.owner+':'+args.branch},{max:200});
  if(open.capped||open.items.length)throw refusal('Open PR inventory is incomplete or still uses the cleanup branch.');
}

const branchDelete = defineGithubWrite(overridable({
  name: 'github_branch_delete', area: 'branch', audience: ['B'],
  description: 'Delete a branch under GitHub permissions; optional expectedHeadSha detects concurrent changes.',
  properties: { owner: OWNER, repo: REPO, branch: NAME, expectedHeadSha: {type:'string',pattern:'^[a-f0-9]{40}$'}, cleanupPrNumber: {type:'integer',minimum:1}, ...OUTSIDE_PROJECT },
  required: ['repo', 'branch'],
  declarations: { production: 'when-target', confirm: 'always' },
  target: (args, ctx) => branchTarget(args, ctx, args.branch),
  read: async (args,ctx,target) => {
    const sha=await refSha(ctx,target.owner,target.repo,`heads/${args.branch}`);
    await cleanupEvidence(args,ctx,target,sha);
    return {sha,isDefault:(await getRepo(ctx,target.owner,target.repo)).default_branch===args.branch};
  },
  classify: ({ ctx, target }) => productionOf(ctx, target),
  summarize: ({ args, before, target }) => (before.sha
    ? `Delete branch ${args.branch} (at ${short(before.sha)}) from ${slug(target.owner, target.repo)}; it can be recreated from that commit` : `There is no branch ${args.branch} in ${slug(target.owner, target.repo)}`),
  apply: async ({ args, ctx, before, target }) => {
    if (before.isDefault && !isOwnerConnection(ctx.connection)) throw refusal(`${args.branch} is the default branch. Change the default branch first; this tool never deletes it.`);
    if (!before.sha) throw refusal(`There is no branch ${args.branch}.`, 404);
    if(args.expectedHeadSha){
      const fresh=await refSha(ctx,target.owner,target.repo,`heads/${args.branch}`);
      await cleanupEvidence(args,ctx,target,fresh);
      if(await refSha(ctx,target.owner,target.repo,`heads/${args.branch}`)!==args.expectedHeadSha)
        throw refusal('Branch advanced immediately before deletion.');
    }
    return (await octo(ctx, target.owner)).request('DELETE /repos/{owner}/{repo}/git/refs/{ref}', { owner: target.owner, repo: target.repo, ref: `heads/${args.branch}` });
  },
  readAfter: async ({ args, ctx, target }) => ((await refSha(ctx, target.owner, target.repo, `heads/${args.branch}`)) === null ? 'gone' : 'still there'),
  verify: ({ after }) => after === 'gone',
  inverse: ({ args, before, target }) => ({ tool: 'github_branch_create', args: { owner: target.owner, repo: target.repo, branch: args.branch, from: before.sha } }),
  present: ({ args }) => ({ deleted: args.branch })
}, { branchOf: (args) => args.branch }));

const branchMerge = defineGithubWrite(overridable({
  name: 'github_branch_merge', area: 'branch', audience: ['B'],
  description: 'Merge one branch into another directly, without a pull request.',
  properties: { owner: OWNER, repo: REPO, base: { ...NAME, description: 'The branch that receives the merge' }, head: { ...NAME, description: 'The branch (or commit) to merge in' }, commit_message: { type: 'string', maxLength: 2000 }, ...OUTSIDE_PROJECT },
  required: ['repo', 'base', 'head'],
  declarations: { production: 'when-target' },
  target: (args, ctx) => branchTarget(args, ctx, args.base),
  read: async (args, ctx, target) => ({ base: await refSha(ctx, target.owner, target.repo, `heads/${args.base}`),
    compare: await missing(async () => (await (await octo(ctx, target.owner)).request('GET /repos/{owner}/{repo}/compare/{basehead}', { owner: target.owner, repo: target.repo, basehead: `${args.base}...${args.head}` })).data) }),
  classify: ({ ctx, target }) => productionOf(ctx, target),
  summarize: ({ args, before, target }) => (before.compare ? `Merge ${args.head} into ${args.base} in ${slug(target.owner, target.repo)}: ${before.compare.ahead_by} commit(s) to bring in${before.compare.behind_by ? `, ${args.base} is ${before.compare.behind_by} ahead` : ''}`
    : `Merge ${args.head} into ${args.base} in ${slug(target.owner, target.repo)} (the two could not be compared)`),
  apply: async ({ args, ctx, before, target }) => {
    if (!before.base) throw refusal(`There is no branch ${args.base}.`, 404);
    return (await octo(ctx, target.owner)).request('POST /repos/{owner}/{repo}/merges', { owner: target.owner, repo: target.repo, base: args.base, head: args.head, ...(args.commit_message ? { commit_message: args.commit_message } : {}) });
  },
  readAfter: async ({ args, ctx, target, response }) => ({ sha: await refSha(ctx, target.owner, target.repo, `heads/${args.base}`), merged: response?.status === 201 ? response.data?.sha : null, nothing: response?.status === 204 }),
  verify: ({ after }) => after.nothing || (after.merged !== null && after.sha === after.merged),
  present: ({ after }) => (after.nothing ? { result: 'nothing to merge: the base already contains the head' } : { merge_commit: after.merged })
}, { branchOf: (args) => args.base }));

// ---- tags (always production) ----
const tagCreate = defineGithubWrite({
  name: 'github_tag_create', area: 'tag', audience: ['B'],
  description: 'Create lightweight or annotated Git tag at a ref or commit.',
  properties: { owner: OWNER, repo: REPO, tag: NAME, from: { ...NAME, description: 'Branch, tag or commit to tag (default: the default branch)' }, message: { type: 'string', maxLength: 2000, description: 'Makes it an annotated tag' }, ...OUTSIDE_PROJECT },
  required: ['repo', 'tag'],
  declarations: { production: 'always', confirm: 'always', profiles: ['full'] },
  target: (args, ctx) => { checkName(args.tag, 'tag'); return tagTarget(args, ctx); },
  read: async (args, ctx, target) => {
    const from = args.from ?? (await getRepo(ctx, target.owner, target.repo)).default_branch;
    return { from, sha: await commitOf(ctx, target.owner, target.repo, from), exists: (await refSha(ctx, target.owner, target.repo, `tags/${args.tag}`)) !== null };
  },
  classify: () => ({ production: 'it creates a tag' }),
  summarize: ({ args, before, target }) => (before.exists ? `Tag ${args.tag} already exists in ${slug(target.owner, target.repo)}` : before.sha
    ? `Create ${args.message ? 'annotated' : 'lightweight'} tag ${args.tag} on ${before.from} (${short(before.sha)}) in ${slug(target.owner, target.repo)}` : `${before.from} does not exist in ${slug(target.owner, target.repo)}`),
  apply: async ({ args, ctx, before, target }) => {
    if (before.exists) throw refusal(`Tag ${args.tag} already exists.`);
    if (!before.sha) throw refusal(`There is no branch, tag or commit "${before.from}".`, 404);
    const octokit = await octo(ctx, target.owner);
    const p = { owner: target.owner, repo: target.repo };
    let object = before.sha;
    if (args.message) object = (await octokit.request('POST /repos/{owner}/{repo}/git/tags', { ...p, tag: args.tag, message: args.message, object: before.sha, type: 'commit' })).data.sha;
    return octokit.request('POST /repos/{owner}/{repo}/git/refs', { ...p, ref: `refs/tags/${args.tag}`, sha: object });
  },
  readAfter: ({ args, ctx, target }) => refSha(ctx, target.owner, target.repo, `tags/${args.tag}`),
  verify: ({ after }) => typeof after === 'string' && after.length === 40,
  inverse: ({ args, target }) => ({ tool: 'github_tag_delete', args: { owner: target.owner, repo: target.repo, tag: args.tag } }),
  present: ({ args, before, after }) => ({ tag: args.tag, points_at: before.sha, ref_sha: after })
});

const tagDelete = defineGithubWrite({
  name: 'github_tag_delete', area: 'tag', audience: ['B'],
  description: 'Delete a tag. Releases built on it stay on GitHub as drafts of their own.',
  properties: { owner: OWNER, repo: REPO, tag: NAME, ...OUTSIDE_PROJECT },
  required: ['repo', 'tag'],
  declarations: { production: 'always', confirm: 'always', profiles: ['full'] },
  target: tagTarget,
  read: async (args, ctx, target) => ({ sha: await refSha(ctx, target.owner, target.repo, `tags/${args.tag}`) }),
  classify: () => ({ production: 'it deletes a tag' }),
  summarize: ({ args, before, target }) => (before.sha ? `Delete tag ${args.tag} (at ${short(before.sha)}) from ${slug(target.owner, target.repo)}` : `There is no tag ${args.tag} in ${slug(target.owner, target.repo)}`),
  apply: async ({ args, ctx, before, target }) => {
    if (!before.sha) throw refusal(`There is no tag ${args.tag}.`, 404);
    return (await octo(ctx, target.owner)).request('DELETE /repos/{owner}/{repo}/git/refs/{ref}', { owner: target.owner, repo: target.repo, ref: `tags/${args.tag}` });
  },
  readAfter: async ({ args, ctx, target }) => ((await refSha(ctx, target.owner, target.repo, `tags/${args.tag}`)) === null ? 'gone' : 'still there'),
  verify: ({ after }) => after === 'gone',
  present: ({ args }) => ({ deleted: args.tag })
});

const reads = [branchList, branchGet, tagList];
const writes = [branchCreate, branchRename, branchDelete, branchMerge, tagCreate, tagDelete];
export const tools = [...reads, ...writes].map((d) => d.tool);
export const handlers = Object.fromEntries([...reads, ...writes].map((d) => [d.tool.name, d.handler]));
