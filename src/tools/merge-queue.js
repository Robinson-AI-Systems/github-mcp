// CAP-6 merge queue (owner-approved 2026-11-01): read a branch's queue, add a pull request at an exact head commit, or
// take it out again. GraphQL only (GitHub has no REST merge-queue API); every document is checked against the pinned
// schema by the fake GitHub. Listed only for organizations where a merge queue is on (src/github/feature-gates.js).
// Titles and logins are other people's text: returned as data, marked untrusted.
import { defineRead } from './define-read.js';
import { defineGithubWrite } from './define-github-write.js';
import { plain, readerFor } from './github-read.js';
import { graphql } from '../github/client.js';
import { octo, ownerOf, refusal, slug } from './github-write.js';

const OWNER = { type: 'string', minLength: 1, maxLength: 39, description: 'Connected account (default account)' };
const REPO = { type: 'string', minLength: 1, maxLength: 100, pattern: '^[A-Za-z0-9_.-]+$' };
const NUMBER = { type: 'integer', minimum: 1, description: 'Pull request number' };
const SHA = { type: 'string', pattern: '^[a-fA-F0-9]{40}$', description: 'The exact head commit you checked; refused if the pull request moved' };
const BRANCH = { type: 'string', minLength: 1, maxLength: 255, description: 'Base branch (default: the default branch)' };

const QUEUE = `query($owner: String!, $name: String!, $branch: String, $first: Int!) { repository(owner: $owner, name: $name) {
  nameWithOwner defaultBranchRef { name }
  mergeQueue(branch: $branch) { id url nextEntryEstimatedTimeToMerge
    configuration { mergeMethod mergingStrategy maximumEntriesToBuild maximumEntriesToMerge minimumEntriesToMerge minimumEntriesToMergeWaitTime checkResponseTimeout }
    entries(first: $first) { totalCount nodes { id position state jump solo enqueuedAt estimatedTimeToMerge headCommit { oid } enqueuer { login } pullRequest { number title headRefOid } } } } } }`;
const PR_STATE = `query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { pullRequest(number: $number) {
  id number state isDraft headRefOid baseRefName isMergeQueueEnabled isInMergeQueue mergeQueueEntry { id position state } } } }`;
const ENQUEUE = 'mutation($input: EnqueuePullRequestInput!) { enqueuePullRequest(input: $input) { mergeQueueEntry { id position state } } }';
const DEQUEUE = 'mutation($input: DequeuePullRequestInput!) { dequeuePullRequest(input: $input) { mergeQueueEntry { id state } } }';

const shapeEntry = (e) => ({ id: e?.id ?? null, position: e?.position ?? null, state: e?.state ?? null, jump: e?.jump === true, solo: e?.solo === true,
  enqueuedAt: e?.enqueuedAt ?? null, estimatedSecondsToMerge: e?.estimatedTimeToMerge ?? null, headSha: e?.headCommit?.oid ?? null,
  enqueuer: e?.enqueuer?.login ?? null, pullRequest: e?.pullRequest ? { number: e.pullRequest.number, title: e.pullRequest.title, headSha: e.pullRequest.headRefOid } : null });

const queueGet = defineRead({
  name: 'github_merge_queue_get', area: 'pr', audience: ['B', 'O', 'Op'],
  description: 'Read a branch merge queue: whether it is on, its settings, and the queued pull requests with position, state and head.',
  properties: { owner: OWNER, repo: REPO, branch: BRANCH, max: { type: 'integer', minimum: 1, maximum: 50, description: 'Entries to read (default 20)' } },
  required: ['repo'],
  handler: (args, ctx) => plain(async () => {
    const { owner, octokit } = await readerFor(args, ctx);
    const repo = (await graphql(octokit, QUEUE, { owner, name: args.repo, branch: args.branch ?? null, first: args.max ?? 20 }))?.repository;
    if (!repo) throw new TypeError(`Repository ${slug(owner, args.repo)} was not found.`);
    const branch = args.branch ?? repo.defaultBranchRef?.name ?? null;
    const q = repo.mergeQueue;
    if (!q) return { repository: repo.nameWithOwner, branch, enabled: false, entries: [], total: 0,
      note: `No merge queue is on for ${branch ?? 'that branch'}. A branch ruleset with "Require merge queue" turns one on; until then merge with github_pr_merge.` };
    const nodes = q.entries?.nodes ?? [];
    return { repository: repo.nameWithOwner, branch, enabled: true, url: q.url, nextEstimatedSecondsToMerge: q.nextEntryEstimatedTimeToMerge ?? null,
      configuration: q.configuration ?? null, total: q.entries?.totalCount ?? nodes.length, entries: nodes.map(shapeEntry),
      complete: (q.entries?.totalCount ?? nodes.length) <= nodes.length, untrusted: true };
  })
});

const prTarget = (args, ctx) => ({ owner: ownerOf(args, ctx), repo: args.repo, scope: 'repo' });
async function prState(ctx, t, number) {
  const pr = (await graphql(await octo(ctx, t.owner), PR_STATE, { owner: t.owner, name: t.repo, number }))?.repository?.pullRequest;
  if (!pr) throw refusal(`Pull request #${number} was not found in ${slug(t.owner, t.repo)}.`, 404);
  return { id: pr.id, number: pr.number, state: pr.state, draft: pr.isDraft === true, head: pr.headRefOid, base: pr.baseRefName,
    queueOn: pr.isMergeQueueEnabled === true, queued: pr.isInMergeQueue === true, entry: pr.mergeQueueEntry ? { id: pr.mergeQueueEntry.id, position: pr.mergeQueueEntry.position, state: pr.mergeQueueEntry.state } : null };
}

const enqueue = defineGithubWrite({
  name: 'github_merge_queue_enqueue', area: 'pr', audience: ['B', 'O'],
  description: 'Add a pull request to its branch merge queue at the exact head you checked; the queue merges it once required checks pass.',
  properties: { owner: OWNER, repo: REPO, number: NUMBER, expectedHeadSha: SHA, jump: { type: 'boolean', description: 'Put it at the front, ahead of every queued pull request (default false)' } },
  required: ['repo', 'number', 'expectedHeadSha'],
  declarations: { production: 'always' }, target: prTarget,
  read: async (args, ctx, t) => {
    const pr = await prState(ctx, t, args.number);
    if (pr.state !== 'OPEN') throw refusal(`Pull request #${args.number} is ${pr.state.toLowerCase()}, so it cannot join a merge queue.`);
    if (pr.draft) throw refusal(`Pull request #${args.number} is a draft. Mark it ready for review first.`);
    if (!pr.queueOn) throw refusal(`${slug(t.owner, t.repo)} has no merge queue on ${pr.base}. Merge with github_pr_merge instead.`);
    if (pr.head.toLowerCase() !== args.expectedHeadSha.toLowerCase()) throw refusal(`Pull request #${args.number} moved: its head is now ${pr.head.slice(0, 12)}, not ${args.expectedHeadSha.slice(0, 12)}. Check the new commit first.`);
    return pr;
  },
  classify: ({ before }) => ({ production: `the merge queue merges it into ${before?.base ?? 'its base branch'} once the required checks pass` }),
  summarize: ({ args, before, target: t }) => (before.queued
    ? `Pull request #${args.number} in ${slug(t.owner, t.repo)} is already in the merge queue (position ${before.entry?.position ?? '?'})`
    : `Add pull request #${args.number} (head ${before.head.slice(0, 12)}) to the merge queue of ${slug(t.owner, t.repo)} on ${before.base}${args.jump ? ', JUMPING ahead of every queued pull request' : ''}`),
  apply: async ({ args, ctx, target: t, before }) => {
    if (before.queued) throw refusal(`Pull request #${args.number} is already queued at position ${before.entry?.position ?? '?'}; nothing was sent.`);
    return graphql(await octo(ctx, t.owner), ENQUEUE, { input: { pullRequestId: before.id, expectedHeadOid: args.expectedHeadSha, ...(args.jump ? { jump: true } : {}) } });
  },
  readAfter: ({ args, ctx, target: t }) => prState(ctx, t, args.number),
  verify: ({ after }) => after.queued === true || after.state === 'MERGED',
  inverse: ({ args, target: t }) => ({ tool: 'github_merge_queue_dequeue', args: { owner: t.owner, repo: t.repo, number: args.number } }),
  present: ({ after }) => ({ number: after.number, queued: after.queued, merged: after.state === 'MERGED', position: after.entry?.position ?? null, state: after.entry?.state ?? null,
    note: 'Read progress with github_merge_queue_get; GitHub merges it when its checks pass.' })
});

const dequeue = defineGithubWrite({
  name: 'github_merge_queue_dequeue', area: 'pr', audience: ['B', 'O'],
  description: 'Take a pull request out of its merge queue so it is not merged; the pull request stays open.',
  properties: { owner: OWNER, repo: REPO, number: NUMBER },
  required: ['repo', 'number'],
  declarations: { production: 'never' }, target: prTarget,
  read: (args, ctx, t) => prState(ctx, t, args.number),
  classify: () => ({}),
  summarize: ({ args, before, target: t }) => (before.queued
    ? `Take pull request #${args.number} out of the merge queue of ${slug(t.owner, t.repo)} (now position ${before.entry?.position ?? '?'}, ${String(before.entry?.state ?? 'queued').toLowerCase()})`
    : `Pull request #${args.number} in ${slug(t.owner, t.repo)} is not in the merge queue`),
  apply: async ({ args, ctx, target: t, before }) => {
    if (!before.queued) throw refusal(`Pull request #${args.number} is not in the merge queue; nothing was sent.`);
    return graphql(await octo(ctx, t.owner), DEQUEUE, { input: { id: before.id } });
  },
  readAfter: ({ args, ctx, target: t }) => prState(ctx, t, args.number),
  verify: ({ after }) => after.queued === false,
  inverse: ({ args, before, target: t }) => (before.state === 'OPEN' ? { tool: 'github_merge_queue_enqueue', args: { owner: t.owner, repo: t.repo, number: args.number, expectedHeadSha: before.head } } : null),
  present: ({ after }) => ({ number: after.number, queued: after.queued, state: after.state })
});

const defs = [enqueue, dequeue];
export const tools = [queueGet.tool, ...defs.map((d) => d.tool)];
export const handlers = { [queueGet.tool.name]: queueGet.handler, ...Object.fromEntries(defs.map((d) => [d.tool.name, d.handler])) };
