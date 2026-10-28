import { redact } from './util.js';
// Reviews and review threads, change side (E-3 part 2). Reviews and replies are messages: anything that mentions or reaches people
// outside Chris's own accounts needs confirm. Nothing here touches a branch, so none of it is production.
import { createHash } from 'node:crypto';
import { requestKey as githubRequestKey } from '../github/client.js';
import { graphql } from '../github/client.js';
import { defineGithubWrite } from './define-github-write.js';
import { missing, octo, ownerOf, refusal, slug } from './github-write.js';
import { notifyOutsiders } from './people-guard.js';

const OWNER = { type: 'string', maxLength: 39, description: 'GitHub account (default: the connection\'s default account)' };
const REPO = { type: 'string', minLength: 1, maxLength: 100 };
const NUMBER = { type: 'integer', minimum: 1, description: 'Pull request number' };
const BODY = { type: 'string', maxLength: 20000 };
const EVENT = { type: 'string', enum: ['COMMENT', 'APPROVE', 'REQUEST_CHANGES'] };
const REVIEW_ID = { type: 'integer', minimum: 1, description: 'Review id (from github_review_list)' };
const THREAD_ID = { type: 'string', minLength: 1, maxLength: 100, description: 'Review thread id (from github_review_list_threads)' };
const EXPECTED_HEAD = { type: 'string', pattern: '^[a-fA-F0-9]{40}$', description: 'Refuse if this PR head changed' };
const STATE_OF = { COMMENT: 'COMMENTED', APPROVE: 'APPROVED', REQUEST_CHANGES: 'CHANGES_REQUESTED' };
const prTarget = (args, ctx) => ({ owner: ownerOf(args, ctx), repo: args.repo, scope: 'repo' });
const p = (target, args) => ({ owner: target.owner, repo: target.repo, pull_number: args.number });
const getPr = async (ctx, target, args) => (await (await octo(ctx, target.owner)).request('GET /repos/{owner}/{repo}/pulls/{pull_number}', p(target, args))).data;
const getReview = (ctx, target, args, id) => missing(async () => (await (await octo(ctx, target.owner)).request('GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}', { ...p(target, args), review_id: id })).data);
/** GitHub refuses an App approving or blocking its own pull request; say so plainly. */
const ownPr = (error) => (/own pull request|can not (approve|request changes)/i.test(String(error?.message)) ? refusal('GitHub does not let the same account approve or block its own pull request. Ask someone else to review it, or leave a comment review instead.') : error);

const THREAD_QUERY = 'query($id: ID!) { node(id: $id) { ... on PullRequestReviewThread { id isResolved path pullRequest { number repository { nameWithOwner } } } } }';
const REPLY = 'mutation($input: AddPullRequestReviewThreadReplyInput!) { addPullRequestReviewThreadReply(input: $input) { comment { id url body } } }';
const RESOLVE = 'mutation($input: ResolveReviewThreadInput!) { resolveReviewThread(input: $input) { thread { id isResolved } } }';
const UNRESOLVE = 'mutation($input: UnresolveReviewThreadInput!) { unresolveReviewThread(input: $input) { thread { id isResolved } } }';
async function readThread(ctx, target, args) {
  const octokit = await octo(ctx, target.owner);
  const node = (await graphql(octokit, THREAD_QUERY, { id: args.threadId })).node;
  if (!node?.id) return null;
  const mine = String(node.pullRequest?.repository?.nameWithOwner ?? '').toLowerCase() === slug(target.owner, target.repo).toLowerCase() && (args.number === undefined || node.pullRequest?.number === args.number);
  return { id: node.id, resolved: node.isResolved, path: node.path, pr: node.pullRequest?.number, mine };
}
function reviewRequestKey(name) {
  return (ctx,args) => {
    if (!args.expectedHeadSha) return githubRequestKey(ctx,name,args);
    const intent = [ctx.connection.client_id ?? ctx.connection.pass_id,
      String(args.owner ?? ctx.connection.default_account).toLowerCase(),args.repo,args.number,
      args.threadId,args.expectedHeadSha,args.body ?? null,args.resolved !== false];
    return 'rmcp_' + name + '_' + createHash('sha256').update(JSON.stringify(intent)).digest('hex');
  };
}
async function verifyHead(ctx, target, args) {
  if (args.expectedHeadSha && (await getPr(ctx, target, args)).head?.sha !== args.expectedHeadSha)
    throw refusal('The PR head changed; re-read the review disposition before changing its thread.');
}
const needThread = (before, target) => {
  if (!before) throw refusal('There is no review thread with that id.', 404);
  if (!before.mine) throw refusal(`That thread belongs to another pull request, not this one in ${slug(target.owner, target.repo)}.`);
};

const reviewCreate = defineGithubWrite({
  name: 'github_review_create', area: 'review', audience: ['B'],
  description: 'Review a PR: comment, approve or request changes; absent an event, remain pending.',
  properties: { owner: OWNER, repo: REPO, number: NUMBER, body: BODY, event: { ...EVENT, description: 'Leave out to start a pending review you submit later' },
    commitId: { type: 'string', minLength: 40, maxLength: 40, description: 'Review this commit (default: the latest)' },
    comments: { type: 'array', maxItems: 50, items: { type: 'object', properties: { path: { type: 'string', maxLength: 1000 }, line: { type: 'integer', minimum: 1 }, side: { type: 'string', enum: ['LEFT', 'RIGHT'] }, body: { type: 'string', maxLength: 20000 } }, required: ['path', 'line', 'body'] } } },
  required: ['repo', 'number'],
  declarations: { production: 'never', notifies: true },
  target: (args, ctx) => {
    if (!args.body && !args.comments?.length && args.event !== 'APPROVE') throw new TypeError('A review needs a body or at least one inline comment (only an approval may be empty).');
    return prTarget(args, ctx);
  },
  read: async (args, ctx, target) => { const pr = await getPr(ctx, target, args); return { state: pr.state, head: pr.head?.sha, author: pr.user?.login }; },
  classify: ({ args, ctx, target }) => notifyOutsiders(ctx, { text: [args.body, ...(args.comments ?? []).map((c) => c.body)].join('\n'), repoOwner: target.owner }),
  summarize: ({ args, before, target }) => `${args.event ? { COMMENT: 'Comment on', APPROVE: 'Approve', REQUEST_CHANGES: 'Request changes on' }[args.event] : 'Start a pending review of'} pull request #${args.number} in ${slug(target.owner, target.repo)} (head ${String(args.commitId ?? before.head).slice(0, 7)})${args.comments?.length ? ` with ${args.comments.length} inline comment(s)` : ''}`,
  apply: async ({ args, ctx, target, before }) => {
    try {
      return await (await octo(ctx, target.owner)).request('POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews', { ...p(target, args), commit_id: args.commitId ?? before.head,
        ...(args.body ? { body: args.body } : {}), ...(args.event ? { event: args.event } : {}), ...(args.comments ? { comments: args.comments.map((c) => ({ path: c.path, line: c.line, body: c.body, ...(c.side ? { side: c.side } : {}) })) } : {}) });
    } catch (error) { throw ownPr(error); }
  },
  readAfter: ({ args, ctx, target, response }) => getReview(ctx, target, args, response.data.id),
  verify: ({ args, after }) => after?.state === (args.event ? STATE_OF[args.event] : 'PENDING'),
  present: ({ after }) => ({ review_id: after?.id, state: after?.state, html_url: after?.html_url })
});

const reviewSubmit = defineGithubWrite({
  name: 'github_review_submit', area: 'review', audience: ['B'],
  description: 'Submit a pending review as a comment, an approval or a request for changes.',
  properties: { owner: OWNER, repo: REPO, number: NUMBER, reviewId: REVIEW_ID, event: EVENT, body: BODY },
  required: ['repo', 'number', 'reviewId', 'event'],
  declarations: { production: 'never', notifies: true },
  target: prTarget,
  read: async (args, ctx, target) => ({ review: await getReview(ctx, target, args, args.reviewId) }),
  classify: ({ args, ctx, target }) => notifyOutsiders(ctx, { text: args.body, repoOwner: target.owner }),
  summarize: ({ args, before, target }) => (before.review?.state === 'PENDING' ? `Submit your pending review ${args.reviewId} on pull request #${args.number} in ${slug(target.owner, target.repo)} as ${args.event}`
    : `Review ${args.reviewId} on pull request #${args.number} is ${before.review ? before.review.state : 'not found'}, so it cannot be submitted`),
  apply: async ({ args, ctx, target, before }) => {
    if (!before.review) throw refusal(`There is no review ${args.reviewId} on pull request #${args.number}.`, 404);
    if (before.review.state !== 'PENDING') throw refusal(`Review ${args.reviewId} was already submitted (${before.review.state}).`);
    try {
      return await (await octo(ctx, target.owner)).request('POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}/events', { ...p(target, args), review_id: args.reviewId, event: args.event, ...(args.body ? { body: args.body } : {}) });
    } catch (error) { throw ownPr(error); }
  },
  readAfter: ({ args, ctx, target }) => getReview(ctx, target, args, args.reviewId),
  verify: ({ args, after }) => after?.state === STATE_OF[args.event],
  present: ({ after }) => ({ review_id: after?.id, state: after?.state })
});

const reviewDismiss = defineGithubWrite({
  name: 'github_review_dismiss', area: 'review', audience: ['B'],
  description: 'Dismiss an approval or change request with a message everyone can read.',
  properties: { owner: OWNER, repo: REPO, number: NUMBER, reviewId: REVIEW_ID, message: { type: 'string', minLength: 1, maxLength: 2000 } },
  required: ['repo', 'number', 'reviewId', 'message'],
  declarations: { production: 'never', confirm: 'always', notifies: true, profiles: ['full'] },
  target: prTarget,
  read: async (args, ctx, target) => ({ review: await getReview(ctx, target, args, args.reviewId) }),
  classify: ({ args, ctx, target, before }) => notifyOutsiders(ctx, { logins: before.review?.user?.login ? [before.review.user.login] : [], text: args.message, repoOwner: target.owner }),
  summarize: ({ args, before, target }) => (before.review && ['APPROVED', 'CHANGES_REQUESTED'].includes(before.review.state)
    ? `Dismiss ${before.review.user?.login}'s ${before.review.state} review ${args.reviewId} on pull request #${args.number} in ${slug(target.owner, target.repo)}: "${redact(args.message).slice(0, 80)}"`
    : `Review ${args.reviewId} on pull request #${args.number} is ${before.review ? before.review.state : 'not found'}; only an approval or a change request can be dismissed`),
  apply: async ({ args, ctx, target, before }) => {
    if (!before.review) throw refusal(`There is no review ${args.reviewId} on pull request #${args.number}.`, 404);
    if (!['APPROVED', 'CHANGES_REQUESTED'].includes(before.review.state)) throw refusal(`Review ${args.reviewId} is ${before.review.state}; only an approval or a change request can be dismissed.`);
    return (await octo(ctx, target.owner)).request('PUT /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}/dismissals', { ...p(target, args), review_id: args.reviewId, message: args.message });
  },
  readAfter: ({ args, ctx, target }) => getReview(ctx, target, args, args.reviewId),
  verify: ({ after }) => after?.state === 'DISMISSED',
  present: ({ after }) => ({ review_id: after?.id, state: after?.state })
});

const reviewReply = defineGithubWrite({
  name: 'github_review_reply', requestKey: reviewRequestKey('github_review_reply'), area: 'review', audience: ['B'],
  description: 'Reply in a review thread.',
  properties: { owner: OWNER, repo: REPO, number: NUMBER, threadId: THREAD_ID, body: { type: 'string', minLength: 1, maxLength: 20000 }, expectedHeadSha: EXPECTED_HEAD },
  required: ['repo', 'number', 'threadId', 'body'],
  declarations: { production: 'never', notifies: true },
  target: prTarget,
  read: async (args, ctx, target) => {
    await verifyHead(ctx, target, args);
    return readThread(ctx, target, args);
  },
  classify: ({ args, ctx, target }) => notifyOutsiders(ctx, { text: args.body, repoOwner: target.owner }),
  summarize: ({ args, before, target }) => (before?.mine ? `Reply in the review thread on ${before.path} of pull request #${args.number} in ${slug(target.owner, target.repo)}: "${redact(args.body).slice(0, 80)}"` : 'That review thread was not found on this pull request'),
  apply: async ({ args, ctx, target, before }) => {
    needThread(before, target);
    await verifyHead(ctx, target, args);
    return graphql(await octo(ctx, target.owner), REPLY, { input: { pullRequestReviewThreadId: args.threadId, body: args.body } });
  },
  readAfter: ({ response }) => response?.addPullRequestReviewThreadReply?.comment ?? null,
  verify: ({ args, after }) => after?.body === args.body,
  present: ({ after }) => ({ comment_id: after?.id, html_url: after?.url })
});

const reviewResolve = defineGithubWrite({
  name: 'github_review_resolve_thread', requestKey: reviewRequestKey('github_review_resolve_thread'), area: 'review', audience: ['B'],
  description: 'Resolve or reopen a review thread without changing an already matching state.',
  properties: { owner: OWNER, repo: REPO, number: NUMBER, threadId: THREAD_ID, resolved: { type: 'boolean', description: 'Default true; false reopens the thread' }, expectedHeadSha: EXPECTED_HEAD },
  required: ['repo', 'number', 'threadId'],
  declarations: { production: 'never' },
  target: prTarget,
  read: async (args, ctx, target) => {
    await verifyHead(ctx, target, args);
    return readThread(ctx, target, args);
  },
  classify: () => ({}),
  summarize: ({ args, before, target }) => {
    const want = args.resolved !== false;
    if (!before?.mine) return 'That review thread was not found on this pull request';
    return before.resolved === want ? `The thread on ${before.path} is already ${want ? 'resolved' : 'open'}; nothing to change` : `${want ? 'Resolve' : 'Reopen'} the review thread on ${before.path} of pull request #${args.number} in ${slug(target.owner, target.repo)}`;
  },
  apply: async ({ args, ctx, target, before }) => {
    needThread(before, target);
    await verifyHead(ctx, target, args);
    const want = args.resolved !== false;
    if (before.resolved === want) return { unchanged: true };
    return graphql(await octo(ctx, target.owner), want ? RESOLVE : UNRESOLVE, { input: { threadId: args.threadId } });
  },
  readAfter: ({ args, ctx, target }) => readThread(ctx, target, args),
  verify: ({ args, after }) => after?.resolved === (args.resolved !== false),
  inverse: ({ args, before, target }) => (before.resolved === (args.resolved !== false) ? null : { tool: 'github_review_resolve_thread', args: { owner: target.owner, repo: target.repo, number: args.number, threadId: args.threadId, resolved: before.resolved } }),
  present: ({ after }) => ({ thread: after?.id, resolved: after?.resolved })
});

const requestReviewers = defineGithubWrite({
  name: 'github_review_request_reviewers', area: 'review', audience: ['B'],
  description: 'Request reviews from people or teams, or take a request back with remove: true.',
  properties: { owner: OWNER, repo: REPO, number: NUMBER, reviewers: { type: 'array', maxItems: 15, items: { type: 'string', maxLength: 39 }, description: 'User logins' },
    teams: { type: 'array', maxItems: 15, items: { type: 'string', maxLength: 100 }, description: 'Team slugs of the repository\'s organization' }, remove: { type: 'boolean', description: 'Take the requests back instead' } },
  required: ['repo', 'number'],
  declarations: { production: 'never', notifies: true },
  target: (args, ctx) => {
    if (!args.reviewers?.length && !args.teams?.length) throw new TypeError('Name at least one reviewer or team.');
    return prTarget(args, ctx);
  },
  read: async (args, ctx, target) => {
    const data = (await (await octo(ctx, target.owner)).request('GET /repos/{owner}/{repo}/pulls/{pull_number}/requested_reviewers', p(target, args))).data;
    return { users: (data.users ?? []).map((u) => u.login), teams: (data.teams ?? []).map((t) => t.slug) };
  },
  classify: ({ args, ctx, target }) => (args.remove ? {} : notifyOutsiders(ctx, { logins: args.reviewers ?? [], repoOwner: target.owner })
    .then(async (r) => ({ notifies: [...r.notifies, ...(await notifyOutsiders(ctx, { logins: (args.teams ?? []).map((t) => `${target.owner}/${t}`) })).notifies] }))),
  summarize: ({ args, target }) => `${args.remove ? 'Take back review requests from' : 'Request a review from'} ${[...(args.reviewers ?? []), ...(args.teams ?? []).map((t) => `team ${t}`)].join(', ')} on pull request #${args.number} in ${slug(target.owner, target.repo)}`,
  apply: async ({ args, ctx, target }) => (await octo(ctx, target.owner)).request(`${args.remove ? 'DELETE' : 'POST'} /repos/{owner}/{repo}/pulls/{pull_number}/requested_reviewers`,
    { ...p(target, args), reviewers: args.reviewers ?? [], team_reviewers: args.teams ?? [] }),
  readAfter: async ({ args, ctx, target }) => {
    const data = (await (await octo(ctx, target.owner)).request('GET /repos/{owner}/{repo}/pulls/{pull_number}/requested_reviewers', p(target, args))).data;
    return { users: (data.users ?? []).map((u) => u.login.toLowerCase()), teams: (data.teams ?? []).map((t) => t.slug) };
  },
  verify: ({ args, after }) => (args.reviewers ?? []).every((u) => after.users.includes(u.toLowerCase()) !== (args.remove === true)) && (args.teams ?? []).every((t) => after.teams.includes(t) !== (args.remove === true)),
  inverse: ({ args, before, target }) => {
    const had = (list, mine) => (mine ?? []).filter((x) => (args.remove ? before[list].includes(x) : !before[list].includes(x)));
    const reviewers = had('users', args.reviewers); const teams = had('teams', args.teams);
    return reviewers.length || teams.length ? { tool: 'github_review_request_reviewers', args: { owner: target.owner, repo: target.repo, number: args.number, reviewers, teams, remove: !args.remove } } : null;
  },
  present: ({ after }) => ({ requested_users: after.users, requested_teams: after.teams })
});

// ---- ask Copilot to review a pull request (PAR-1) ----------------------------------------------------------------------------------------
// GraphQL `requestReviewsByLogin` with `botLogins` (verified in the pinned schema). GitHub's docs say REST with
// `copilot-pull-request-reviewer[bot]` also works, but REST can answer 201 while silently dropping the bot, so GraphQL is used.
// https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/copilot-code-review
const COPILOT_BOT = /^copilot-pull-request-reviewer/i;
const COPILOT_STATE = 'query($id: ID!) { node(id: $id) { ... on PullRequest { reviewRequests(first: 30) { nodes { requestedReviewer { __typename ... on Bot { login } } } } reviews(last: 20) { nodes { author { login } submittedAt } } } } }';
const REQUEST_COPILOT = 'mutation($input: RequestReviewsByLoginInput!) { requestReviewsByLogin(input: $input) { pullRequest { id } } }';
const NO_COPILOT = 'Copilot code review is not available on this repository (it needs a Copilot plan that includes code review, turned on for this account).';
async function copilotState(ctx, target, nodeId) {
  const node = (await graphql(await octo(ctx, target.owner), COPILOT_STATE, { id: nodeId })).node ?? {};
  const requested = (node.reviewRequests?.nodes ?? []).some((n) => n.requestedReviewer?.__typename === 'Bot' && COPILOT_BOT.test(n.requestedReviewer.login ?? ''));
  const times = (node.reviews?.nodes ?? []).filter((r) => COPILOT_BOT.test(r.author?.login ?? '')).map((r) => String(r.submittedAt ?? '')).sort();
  return { requested, reviews: times.length, lastReviewAt: times.at(-1) ?? null };
}
const requestCopilot = defineGithubWrite({
  name: 'github_review_request_copilot', area: 'review', audience: ['B'],
  description: 'Ask GitHub Copilot to review an open pull request. Needs a Copilot plan with code review; the review arrives in minutes.',
  properties: { owner: OWNER, repo: REPO, number: NUMBER },
  required: ['repo', 'number'],
  declarations: { production: 'never' },
  target: prTarget,
  read: async (args, ctx, target) => {
    const pr = await getPr(ctx, target, args);
    if (pr.state !== 'open') return { open: false, nodeId: pr.node_id, requested: false, reviews: 0, lastReviewAt: null };
    return { open: true, nodeId: pr.node_id, ...(await copilotState(ctx, target, pr.node_id)) };
  },
  classify: () => ({}),
  summarize: ({ args, before, target }) => (before.open ? `Ask Copilot to review pull request #${args.number} in ${slug(target.owner, target.repo)}${before.reviews ? ' again' : ''}` : `Pull request #${args.number} in ${slug(target.owner, target.repo)} is not open, so Copilot cannot review it`),
  apply: async ({ ctx, target, before }) => {
    if (!before.open) throw refusal('Copilot can only review an open pull request.');
    try {
      return await graphql(await octo(ctx, target.owner), REQUEST_COPILOT, { input: { pullRequestId: before.nodeId, botLogins: ['copilot-pull-request-reviewer'], union: true } });
    } catch (error) {
      if ([403, 404, 422].includes(error?.status) || /bot|copilot|could not resolve|not (found|available)/i.test(String(error?.message))) throw refusal(NO_COPILOT);
      throw error;
    }
  },
  readAfter: ({ ctx, target, before }) => copilotState(ctx, target, before.nodeId),
  verify: ({ before, after }) => after.requested || after.reviews > before.reviews || (after.lastReviewAt !== null && after.lastReviewAt !== before.lastReviewAt),
  inverse: () => null, // a review request to a bot cannot be taken back reliably
  present: ({ after }) => ({ copilot_requested: after.requested, note: 'Copilot usually posts its review within 3\u201310 minutes. Read the reviews again then.' })
});

const defs = [reviewCreate, reviewSubmit, reviewDismiss, reviewReply, reviewResolve, requestReviewers, requestCopilot];
export const tools = defs.map((d) => d.tool);
export const handlers = Object.fromEntries(defs.map((d) => [d.tool.name, d.handler]));
