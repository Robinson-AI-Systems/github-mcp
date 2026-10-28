import { redact } from './util.js';
// Pull requests, changes (E-1 part 2): create (idempotent, labelled), update (title, body, base, open/closed, with a preview of the
// commits a retarget will carry), set_draft (GraphQL), close, update_branch. None of these merges anything (that is E-2) and none
// touches production by itself; the pr-only rule for protected repositories lets this routine through (PR_ONLY_TOOLS). A pull request
// is addressed by number and re-read first, so a stale idea of its state is refused rather than acted on.
import { graphql } from '../github/client.js';
import { defineGithubWrite } from './define-github-write.js';
import { missing, octo, ownerOf, refusal, slug } from './github-write.js';
import { notifyOutsiders } from './people-guard.js';

const OWNER = { type: 'string', maxLength: 39, description: 'GitHub account (default: the connection\'s default account)' };
const REPO = { type: 'string', minLength: 1, maxLength: 100 };
const PR = { type: 'integer', minimum: 1, description: 'Pull request number' };
const TITLE = { type: 'string', minLength: 1, maxLength: 256 };
const BODY = { type: 'string', maxLength: 20000 };
const BRANCH = { type: 'string', minLength: 1, maxLength: 250 };
export const FOOTER = '<!-- rmcp tool=github_pr_create -->';
const short = (sha) => String(sha ?? '').slice(0, 7);
const target = (args, ctx) => ({ owner: ownerOf(args, ctx), repo: args.repo, scope: 'repo' });
const getPr = (ctx, t, number) => missing(async () => (await (await octo(ctx, t.owner)).request('GET /repos/{owner}/{repo}/pulls/{pull_number}', { owner: t.owner, repo: t.repo, pull_number: number })).data);
const prLabel = (t, number) => `pull request #${number} in ${slug(t.owner, t.repo)}`;
const brief = (pr) => (pr ? { number: pr.number, title: pr.title, state: pr.state, draft: pr.draft, merged: pr.merged, head: pr.head?.ref, head_sha: pr.head?.sha, base: pr.base?.ref, html_url: pr.html_url } : null);

/** Reads the pull request an operation is about; absent, merged or closed-when-it-must-be-open are plain refusals. */
function needOpen(pr, number) {
  if (!pr) throw refusal(`There is no pull request #${number}.`, 404);
  if (pr.merged) throw refusal(`Pull request #${number} is already merged.`);
  if (pr.state !== 'open') throw refusal(`Pull request #${number} is closed. Reopen it first (github_pr_update with state "open").`);
  return pr;
}

const prCreate = defineGithubWrite({
  name: 'github_pr_create', area: 'pr', audience: ['B'],
  description: 'Create a PR; reuse an existing open PR with the same head/base. Appends an audit footer.',
  properties: { owner: OWNER, repo: REPO, head: { ...BRANCH, description: 'Branch with the changes (or owner:branch for a fork)' }, base: { ...BRANCH, description: 'Branch to merge into (default: the repository\'s default branch)' },
    title: TITLE, body: BODY, draft: { type: 'boolean', description: 'Open as a draft' } },
  required: ['repo', 'head', 'title'],
  declarations: { production: 'never', notifies: true },
  target: (args, ctx) => { if (args.head === args.base) throw new TypeError('The head and base branch are the same.'); return target(args, ctx); },
  read: async (args, ctx, t) => {
    const octokit = await octo(ctx, t.owner);
    const base = args.base ?? (await octokit.request('GET /repos/{owner}/{repo}', { owner: t.owner, repo: t.repo })).data.default_branch;
    const head = args.head.includes(':') ? args.head : `${t.owner}:${args.head}`;
    if (head === `${t.owner}:${base}`) throw refusal('The head and base branch are the same.');
    const open = (await octokit.request('GET /repos/{owner}/{repo}/pulls', { owner: t.owner, repo: t.repo, state: 'open', head, base, per_page: 5 })).data;
    const branchExists = args.head.includes(':') ? true : (await missing(async () => (await octokit.request('GET /repos/{owner}/{repo}/git/ref/{ref}', { owner: t.owner, repo: t.repo, ref: `heads/${args.head}` })).data)) !== null;
    return { base, existing: open[0] ?? null, branchExists };
  },
  classify: ({ args, ctx, target: t }) => notifyOutsiders(ctx, { text: `${args.title}\n${args.body ?? ''}`, repoOwner: t.owner }),
  summarize: ({ args, before, target: t }) => (before.existing ? `${prLabel(t, before.existing.number)} is already open for ${args.head} into ${before.base}; it will be returned unchanged`
    : !before.branchExists ? `The branch ${args.head} does not exist in ${slug(t.owner, t.repo)}, so no pull request can be opened`
      : `Open ${args.draft ? 'a draft ' : 'a '}pull request in ${slug(t.owner, t.repo)}: ${args.head} into ${before.base}, titled "${redact(args.title).slice(0, 80)}"`),
  apply: async ({ args, ctx, before, target: t }) => {
    if (before.existing) return { data: before.existing, replayed: true };
    if (!before.branchExists) throw refusal(`There is no branch ${args.head}. Push it first.`, 404);
    const body = `${args.body ?? ''}${args.body ? '\n\n' : ''}${FOOTER}`;
    return (await octo(ctx, t.owner)).request('POST /repos/{owner}/{repo}/pulls', { owner: t.owner, repo: t.repo, title: args.title, head: args.head, base: before.base, body, ...(args.draft ? { draft: true } : {}) });
  },
  readAfter: ({ ctx, target: t, response }) => getPr(ctx, t, response.data.number),
  verify: ({ args, before, after }) => !!after && after.state === 'open' && after.head?.ref === args.head.split(':').pop() && after.base?.ref === before.base && (before.existing ? true : !!after.draft === !!args.draft),
  inverse: ({ target: t, after, response }) => (response.replayed ? null : { tool: 'github_pr_close', args: { owner: t.owner, repo: t.repo, number: after.number } }),
  present: ({ after, response }) => ({ ...brief(after), ...(response.replayed ? { replayed: true } : {}) })
});

const prUpdate = defineGithubWrite({
  name: 'github_pr_update', area: 'pr', audience: ['B'],
  description: 'Change a pull request\'s title, body, base branch (retarget) or state (open/closed). A retarget previews the commits it will then contain.',
  properties: { owner: OWNER, repo: REPO, number: PR, title: TITLE, body: BODY, base: BRANCH, expectedHeadSha: { type: 'string', pattern: '^[0-9a-fA-F]{40}$' }, state: { type: 'string', enum: ['open', 'closed'] } },
  required: ['repo', 'number'],
  declarations: { production: 'never', notifies: true },
  target: (args, ctx) => {
    if (['title', 'body', 'base', 'state'].every((k) => args[k] === undefined)) throw new TypeError('Say what to change: title, body, base or state.');
    return target(args, ctx);
  },
  read: async (args, ctx, t) => {
    const pr = await getPr(ctx, t, args.number);
    if(args.expectedHeadSha&&pr?.head?.sha!==args.expectedHeadSha)
      throw refusal('The PR head changed before the retarget could be planned. Read and confirm its new head.',409);
    let carries = null;
    if (pr && args.base && args.base !== pr.base?.ref) {
      const cmp = await missing(async () => (await (await octo(ctx, t.owner)).request('GET /repos/{owner}/{repo}/compare/{basehead}', { owner: t.owner, repo: t.repo, basehead: `${args.base}...${pr.head.sha}` })).data);
      carries = cmp ? { commits: cmp.ahead_by, behind: cmp.behind_by } : { unknown: `${args.base} was not found` };
    }
    return { pr: brief(pr), raw: pr ? { title: pr.title, body: pr.body ?? '', base: pr.base?.ref, state: pr.state } : null, carries };
  },
  classify: ({ args, ctx, target: t }) => notifyOutsiders(ctx, { text: `${args.title ?? ''}\n${args.body ?? ''}`, repoOwner: t.owner }),
  summarize: ({ args, before, target: t }) => {
    if (!before.pr) return `There is no pull request #${args.number} in ${slug(t.owner, t.repo)}`;
    const parts = [args.title !== undefined && 'title', args.body !== undefined && 'description', args.base && `base ${before.pr.base} -> ${args.base}${before.carries?.commits !== undefined ? ` (it will then carry ${before.carries.commits} commit${before.carries.commits === 1 ? '' : 's'})` : ''}`,
      args.state && `state -> ${args.state}`].filter(Boolean);
    return `Update ${prLabel(t, args.number)}: ${parts.join(', ')}`;
  },
  apply: async ({ args, ctx, before, target: t }) => {
    if (!before.pr) throw refusal(`There is no pull request #${args.number}.`, 404);
    if (before.pr.merged) throw refusal(`Pull request #${args.number} is already merged and can no longer be changed.`);
    if (before.carries?.unknown) throw refusal(`The branch ${args.base} does not exist, so the pull request cannot be retargeted to it.`, 404);
    return (await octo(ctx, t.owner)).request('PATCH /repos/{owner}/{repo}/pulls/{pull_number}', { owner: t.owner, repo: t.repo, pull_number: args.number,
      ...(args.title !== undefined ? { title: args.title } : {}), ...(args.body !== undefined ? { body: args.body } : {}), ...(args.base ? { base: args.base } : {}), ...(args.state ? { state: args.state } : {}) });
  },
  readAfter: ({ args, ctx, target: t }) => getPr(ctx, t, args.number),
  verify: ({ args, after }) => !!after && (args.title === undefined || after.title === args.title) && (args.body === undefined || (after.body ?? '') === args.body)
    && (!args.base || after.base?.ref === args.base) && (!args.state || after.state === args.state)
    && (!args.expectedHeadSha || after.head?.sha === args.expectedHeadSha),
  inverse: ({ args, before, target: t }) => (before.raw ? { tool: 'github_pr_update', args: { owner: t.owner, repo: t.repo, number: args.number,
    ...(args.title !== undefined ? { title: before.raw.title } : {}), ...(args.body !== undefined ? { body: before.raw.body } : {}), ...(args.base ? { base: before.raw.base } : {}), ...(args.state ? { state: before.raw.state } : {}) } } : null),
  present: ({ after }) => brief(after)
});

const prClose = defineGithubWrite({
  name: 'github_pr_close', area: 'pr', audience: ['B'],
  description: 'Close a pull request without merging it. The branch is kept.',
  properties: { owner: OWNER, repo: REPO, number: PR },
  required: ['repo', 'number'],
  declarations: { production: 'never', confirm: 'always' },
  target,
  read: async (args, ctx, t) => brief(await getPr(ctx, t, args.number)),
  classify: () => ({}),
  summarize: ({ args, before, target: t }) => (before ? `Close ${prLabel(t, args.number)} ("${redact(String(before.title)).slice(0, 60)}") without merging; the branch ${before.head} is kept` : `There is no pull request #${args.number} in ${slug(t.owner, t.repo)}`),
  apply: async ({ args, ctx, before, target: t }) => {
    needOpen(before ? { ...before, state: before.state } : null, args.number);
    return (await octo(ctx, t.owner)).request('PATCH /repos/{owner}/{repo}/pulls/{pull_number}', { owner: t.owner, repo: t.repo, pull_number: args.number, state: 'closed' });
  },
  readAfter: ({ args, ctx, target: t }) => getPr(ctx, t, args.number),
  verify: ({ after }) => after?.state === 'closed' && !after.merged,
  inverse: ({ args, target: t }) => ({ tool: 'github_pr_update', args: { owner: t.owner, repo: t.repo, number: args.number, state: 'open' } }),
  present: ({ after }) => brief(after)
});

const TO_DRAFT = 'mutation($id: ID!) { convertPullRequestToDraft(input: { pullRequestId: $id }) { pullRequest { isDraft } } }';
const TO_READY = 'mutation($id: ID!) { markPullRequestReadyForReview(input: { pullRequestId: $id }) { pullRequest { isDraft } } }';

const prSetDraft = defineGithubWrite({
  name: 'github_pr_set_draft', area: 'pr', audience: ['B'],
  description: 'Turn a pull request into a draft, or mark it ready for review.',
  properties: { owner: OWNER, repo: REPO, number: PR, draft: { type: 'boolean', description: 'true = draft, false = ready for review' } },
  required: ['repo', 'number', 'draft'],
  declarations: { production: 'never' },
  target,
  read: async (args, ctx, t) => { const pr = await getPr(ctx, t, args.number); return pr ? { ...brief(pr), node_id: pr.node_id } : null; },
  classify: () => ({}),
  summarize: ({ args, before, target: t }) => (!before ? `There is no pull request #${args.number} in ${slug(t.owner, t.repo)}` : before.draft === args.draft
    ? `${prLabel(t, args.number)} is already ${args.draft ? 'a draft' : 'ready for review'}; nothing to change` : `Mark ${prLabel(t, args.number)} as ${args.draft ? 'a draft' : 'ready for review'}`),
  apply: async ({ args, ctx, before, target: t }) => {
    needOpen(before, args.number);
    if (before.draft === args.draft) return { data: { unchanged: true } };
    return { data: await graphql(await octo(ctx, t.owner), args.draft ? TO_DRAFT : TO_READY, { id: before.node_id }) };
  },
  readAfter: ({ args, ctx, target: t }) => getPr(ctx, t, args.number),
  verify: ({ args, after }) => !!after && !!after.draft === args.draft,
  inverse: ({ args, before, target: t }) => (before.draft === args.draft ? null : { tool: 'github_pr_set_draft', args: { owner: t.owner, repo: t.repo, number: args.number, draft: before.draft } }),
  present: ({ after }) => brief(after)
});

const prUpdateBranch = defineGithubWrite({
  name: 'github_pr_update_branch', area: 'pr', audience: ['B'],
  description: 'Bring a pull request\'s branch up to date with its base (merges the base into it). Needs the head commit you last read.',
  properties: { owner: OWNER, repo: REPO, number: PR, expectedHeadSha: { type: 'string', minLength: 40, maxLength: 40, description: 'The pull request head you last read' } },
  required: ['repo', 'number', 'expectedHeadSha'],
  declarations: { production: 'never' },
  target,
  read: async (args, ctx, t) => brief(await getPr(ctx, t, args.number)),
  classify: () => ({}),
  summarize: ({ args, before, target: t }) => (!before ? `There is no pull request #${args.number} in ${slug(t.owner, t.repo)}` : before.head_sha !== args.expectedHeadSha
    ? `${prLabel(t, args.number)} has moved to ${short(before.head_sha)} (you expected ${short(args.expectedHeadSha)}); read it again first`
    : `Merge ${before.base} into ${before.head} so ${prLabel(t, args.number)} is up to date (head now ${short(before.head_sha)})`),
  apply: async ({ args, ctx, before, target: t }) => {
    needOpen(before, args.number);
    if (before.head_sha !== args.expectedHeadSha) throw refusal(`New commits arrived: the head is ${short(before.head_sha)}, not ${short(args.expectedHeadSha)}. Read the pull request again.`, 409);
    return (await octo(ctx, t.owner)).request('PUT /repos/{owner}/{repo}/pulls/{pull_number}/update-branch', { owner: t.owner, repo: t.repo, pull_number: args.number, expected_head_sha: args.expectedHeadSha });
  },
  readAfter: ({ args, ctx, target: t }) => getPr(ctx, t, args.number),
  // GitHub does the merge in the background and answers 202; the new head shows up shortly, so acceptance is what is confirmed here.
  verify: ({ response, after }) => !!after && response?.status === 202,
  inverse: () => null,
  present: ({ before, after }) => ({ ...brief(after), accepted: true, head_before: before.head_sha, note: 'GitHub is merging the base into the branch; read the pull request again for the new head.' })
});

const all = [prCreate, prUpdate, prClose, prSetDraft, prUpdateBranch];
export const tools = all.map((d) => d.tool);
export const handlers = Object.fromEntries(all.map((d) => [d.tool.name, d.handler]));
