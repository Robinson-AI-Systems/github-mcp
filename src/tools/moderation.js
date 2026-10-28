import { isOwnerConnection } from '../core/authority.js';
// Y-5a: moderation tools — pin, hide, delete and edit text, close or delete discussions, delete issues, link branches.
// These act on text written by other people; restricted grants retain confirmation, repository text is returned as
// untrusted data, and deletions say plainly that they cannot be undone. The GraphQL tools reuse the reviewed Y-2 write
// specs (before/after selection, "already done" test, verification and opposite), so the rules live in one place.
import { graphql } from '../github/client.js';
import { defineGithubWrite } from './define-github-write.js';
import { missing, octo, ownerOf, refusal, slug } from './github-write.js';
import { notifyOutsiders, ownPeople } from './people-guard.js';
import { writeSpec, specReadQuery } from '../github/graphql-writes.js';
import { LOGIN, REPO_NAME, cap } from './public-read.js';

const OWNER = { ...LOGIN, description: 'Repository owner (default account)' };
const BASE = { owner: OWNER, repo: REPO_NAME };
const NUMBER = { type: 'integer', minimum: 1 };
const NODE = { type: 'string', minLength: 4, maxLength: 100, pattern: '^[A-Za-z0-9_=-]+$' };
const target = (args, ctx) => ({ owner: ownerOf(args, ctx), repo: args.repo, scope: 'repo' });
const low = (s) => String(s ?? '').toLowerCase();

const REPO_ISSUE = 'query ModIssue($o: String!, $n: String!, $num: Int!) { repository(owner: $o, name: $n) { id nameWithOwner viewerPermission pinnedIssues(first: 1) { totalCount } defaultBranchRef { target { oid } } issue(number: $num) { id number title } } }';
const REPO_DISCUSSION = 'query ModDiscussion($o: String!, $n: String!, $num: Int!) { repository(owner: $o, name: $n) { id nameWithOwner discussion(number: $num) { id number title } } }';
const NODE_SCOPE = 'query ModNode($id: ID!) { node(id: $id) { __typename id ... on IssueComment { repository { nameWithOwner } author { login } } ... on PullRequestReviewComment { repository { nameWithOwner } author { login } } ... on CommitComment { repository { nameWithOwner } author { login } } ... on DiscussionComment { discussion { id repository { nameWithOwner } } author { login } } } }';

/** One GraphQL write driven by a reviewed Y-2 spec. `build` turns the arguments into { mutation, input, node, resolved }. */
function specTool({ area = 'issue', name, description, properties, required, declarations, build, inverseOf, classifyMore, summarize, present, preflight }) {
  return defineGithubWrite({
    name, area, audience: ['Op', 'O'], description, properties: { ...BASE, ...properties }, required,
    declarations: { production: 'never', confirm: 'always', cred: 'I', profiles: ['full'], ...declarations }, target,
    read: async (args, ctx, t) => {
      const gh = await octo(ctx, t.owner);
      const plan = await build(args, gh, t, ctx);
      const spec = writeSpec(plan.mutation);
      if (!spec) throw refusal(`No reviewed write spec for ${plan.mutation}.`);
      const node = plan.nodeId ? (await graphql(gh, specReadQuery(spec), { id: plan.nodeId })).node : null;
      return { plan, node };
    },
    classify: classifyMore ?? (() => ({})),
    summarize,
    apply: async ({ args, ctx, target: t, before }) => {
      const gh = await octo(ctx, t.owner);
      const spec = writeSpec(before.plan.mutation);
      if (!before.node) throw refusal('The item no longer exists; nothing was changed.', 404);
      if (spec.already?.(before.plan.input, before.node)) throw refusal('Already in that state; nothing to do.');
      if (preflight) await preflight(args, before, gh, t);
      const m = before.plan.mutation;
      return { data: (await graphql(gh, `mutation Mod${m}($input: ${m[0].toUpperCase() + m.slice(1)}Input!) { ${m}(input: $input) { clientMutationId } }`, { input: before.plan.input }))[m] };
    },
    readAfter: async ({ ctx, target: t, before }) => {
      const gh = await octo(ctx, t.owner);
      const spec = writeSpec(before.plan.mutation);
      const node = (await graphql(gh, specReadQuery(spec), { id: before.plan.nodeId })).node;
      return { node: node ?? null };
    },
    verify: ({ before, after }) => {
      const spec = writeSpec(before.plan.mutation);
      return spec.verify(before.plan.input, after.node, before.node);
    },
    inverse: ({ args, before, after, target: t }) => {
      const spec = writeSpec(before.plan.mutation);
      const inv = spec.inverse?.(before.plan.input, before.node, after.node);
      return inv ? inverseOf(args, inv, t, before) : null;
    },
    present
  });
}

// ---- pin / unpin an issue ---------------------------------------------------------------------------------------------
const issuePin = specTool({
  name: 'github_issue_pin',
  description: 'Pin an issue to the top of a repository\'s issue list (at most 3), or unpin it.',
  properties: { number: NUMBER, pinned: { type: 'boolean', description: 'true to pin (default), false to unpin' } }, required: ['number'],
  declarations: { confirm: 'when-needed' },
  build: async (args, gh, t) => {
    const r = (await graphql(gh, REPO_ISSUE, { o: t.owner, n: t.repo, num: args.number })).repository;
    if (!r?.issue?.id) throw refusal(`Issue #${args.number} was not found.`, 404);
    return { mutation: args.pinned === false ? 'unpinIssue' : 'pinIssue', nodeId: r.issue.id, input: { issueId: r.issue.id }, pinned: r.pinnedIssues?.totalCount ?? null, title: r.issue.title };
  },
  preflight: async (args, before) => { if (args.pinned !== false && !(before.plan.pinned < 3)) throw refusal('This repository already has 3 pinned issues, the most GitHub allows. Unpin one first.'); },
  summarize: ({ args, before, target: t }) => `${args.pinned === false ? 'Unpin' : 'Pin'} issue #${args.number} "${cap(before.plan.title, 80)}" in ${slug(t.owner, t.repo)}`,
  inverseOf: (args, inv, t) => ({ tool: 'github_issue_pin', args: { owner: t.owner, repo: t.repo, number: args.number, pinned: inv.mutation === 'pinIssue' } }),
  present: ({ args, after }) => ({ number: args.number, pinned: after.node?.isPinned === true })
});

// ---- hide / show a comment --------------------------------------------------------------------------------------------
const CLASSIFIERS = ['ABUSE', 'OFF_TOPIC', 'OUTDATED', 'RESOLVED', 'DUPLICATE', 'SPAM'];
const commentOf = async (gh, id, t) => {
  const node = (await graphql(gh, NODE_SCOPE, { id })).node;
  const where = node?.repository?.nameWithOwner ?? node?.discussion?.repository?.nameWithOwner;
  if (!node || low(where) !== low(`${t.owner}/${t.repo}`)) throw refusal('That comment was not found in this repository.', 404);
  return node;
};
const commentHide = specTool({
  name: 'github_comment_hide',
  description: 'Hide a comment (spam, abuse, off topic, outdated, resolved, duplicate) or show it again. Works on issue, pull request, commit and discussion comments.',
  properties: { commentId: { ...NODE, description: 'Comment node id (from a read tool)' }, hidden: { type: 'boolean', description: 'true to hide (default), false to show' }, reason: { type: 'string', enum: CLASSIFIERS } }, required: ['commentId'],
  build: async (args, gh, t) => {
    const node = await commentOf(gh, args.commentId, t);
    const hide = args.hidden !== false;
    return { mutation: hide ? 'minimizeComment' : 'unminimizeComment', nodeId: node.id, author: node.author?.login ?? null, input: hide ? { subjectId: node.id, classifier: args.reason ?? 'OFF_TOPIC' } : { subjectId: node.id } };
  },
  summarize: ({ args, before, target: t }) => `${args.hidden === false ? 'Show' : `Hide (${args.reason ?? 'OFF_TOPIC'})`} a comment by ${before.plan.author ?? 'unknown'} in ${slug(t.owner, t.repo)}`,
  inverseOf: (args, inv, t) => ({ tool: 'github_comment_hide', args: { owner: t.owner, repo: t.repo, commentId: args.commentId, hidden: inv.mutation === 'minimizeComment', ...(inv.input.classifier ? { reason: inv.input.classifier } : {}) } }),
  present: ({ after }) => ({ hidden: after.node?.isMinimized === true, reason: after.node?.minimizedReason ?? null })
});

// ---- discussions ------------------------------------------------------------------------------------------------------
const ACTIONS = ['close', 'reopen', 'update', 'delete', 'answer', 'unanswer'];
const discussionManage = specTool({
  area: 'discussion',
  name: 'github_discussion_manage',
  description: 'Close, reopen, edit or delete a discussion, or mark / unmark a comment as its answer. Deleting cannot be undone.',
  properties: { number: NUMBER, action: { type: 'string', enum: ACTIONS }, reason: { type: 'string', enum: ['RESOLVED', 'OUTDATED', 'DUPLICATE'] }, title: { type: 'string', maxLength: 256 }, body: { type: 'string', maxLength: 60000 }, categoryId: NODE, commentId: { ...NODE, description: 'For answer / unanswer: the comment node id' } },
  required: ['number', 'action'], declarations: { production: 'when-target' },
  build: async (args, gh, t) => {
    const d = (await graphql(gh, REPO_DISCUSSION, { o: t.owner, n: t.repo, num: args.number })).repository?.discussion;
    if (!d?.id) throw refusal(`Discussion #${args.number} was not found.`, 404);
    const base = { title: d.title, discussionId: d.id };
    switch (args.action) {
      case 'close': return { ...base, mutation: 'closeDiscussion', nodeId: d.id, input: { discussionId: d.id, ...(args.reason ? { reason: args.reason } : {}) } };
      case 'reopen': return { ...base, mutation: 'reopenDiscussion', nodeId: d.id, input: { discussionId: d.id } };
      case 'update': {
        if (args.title === undefined && args.body === undefined && args.categoryId === undefined) throw refusal('Say what to change: title, body or categoryId.');
        return { ...base, mutation: 'updateDiscussion', nodeId: d.id, input: { discussionId: d.id, ...(args.title !== undefined ? { title: args.title } : {}), ...(args.body !== undefined ? { body: args.body } : {}), ...(args.categoryId !== undefined ? { categoryId: args.categoryId } : {}) } };
      }
      case 'delete': return { ...base, mutation: 'deleteDiscussion', nodeId: d.id, input: { id: d.id } };
      default: {
        if (!args.commentId) throw refusal('answer and unanswer need commentId.');
        const c = await commentOf(gh, args.commentId, t);
        if (c.__typename !== 'DiscussionComment' || c.discussion?.id !== d.id) throw refusal('That comment is not on this discussion.');
        return { ...base, mutation: args.action === 'answer' ? 'markDiscussionCommentAsAnswer' : 'unmarkDiscussionCommentAsAnswer', nodeId: c.id, input: { id: c.id } };
      }
    }
  },
  classifyMore: ({ args, before }) => (args.action === 'delete' ? { production: `deleting discussion "${cap(before?.plan?.title, 80)}" cannot be undone` } : args.action === 'update' ? { notifies: ['people following the discussion'] } : {}),
  summarize: ({ args, before }) => `${args.action === 'delete' ? 'DELETE' : args.action} discussion #${args.number} "${cap(before.plan.title, 80)}"${args.action === 'delete' ? ' (cannot be undone)' : ''}`,
  inverseOf: (args, inv, t, before) => {
    const tool = 'github_discussion_manage'; const o = { owner: t.owner, repo: t.repo, number: args.number };
    if (inv.mutation === 'reopenDiscussion') return { tool, args: { ...o, action: 'reopen' } };
    if (inv.mutation === 'closeDiscussion') return { tool, args: { ...o, action: 'close', ...(inv.input.reason ? { reason: inv.input.reason } : {}) } };
    if (inv.mutation === 'updateDiscussion') return { tool, args: { ...o, action: 'update', ...Object.fromEntries(['title', 'body', 'categoryId'].filter((k) => inv.input[k] !== undefined).map((k) => [k, inv.input[k]])) } };
    if (inv.mutation.includes('Answer')) return { tool, args: { ...o, action: inv.mutation.startsWith('mark') ? 'answer' : 'unanswer', commentId: before.plan.nodeId } };
    return null;
  },
  present: ({ args, after }) => ({ number: args.number, action: args.action, state: after.node === null ? 'deleted' : after.node })
});

// ---- delete an issue --------------------------------------------------------------------------------------------------
const issueDelete = specTool({
  name: 'github_issue_delete',
  description: 'Delete an issue permanently (repository admin). Optional confirmNumber checks the target; full owners can execute directly.',
  properties: { number: NUMBER, confirmNumber: NUMBER }, required: ['number'], declarations: { production: 'always' },
  build: async (args, gh, t, ctx) => {
    if ((args.confirmNumber !== undefined || !isOwnerConnection(ctx.connection)) && args.confirmNumber !== args.number) throw refusal('confirmNumber must equal the issue number.');
    const r = (await graphql(gh, REPO_ISSUE, { o: t.owner, n: t.repo, num: args.number })).repository;
    if (!r?.issue?.id) throw refusal(`Issue #${args.number} was not found.`, 404);
    return { mutation: 'deleteIssue', nodeId: r.issue.id, input: { issueId: r.issue.id }, title: r.issue.title, admin: r.viewerPermission === 'ADMIN' };
  },
  preflight: async (_args, before) => { if (!before.plan.admin) throw refusal('Deleting an issue needs repository admin rights, and this credential could not be confirmed as admin here.'); },
  classifyMore: ({ before }) => ({ production: `deleting issue "${cap(before?.plan?.title, 80)}" cannot be undone` }),
  summarize: ({ args, before }) => `DELETE issue #${args.number} "${cap(before.plan.title, 80)}" with all its comments (cannot be undone)`,
  inverseOf: () => null,
  present: ({ args, after }) => ({ number: args.number, deleted: after.node === null, restorable: false })
});

// ---- link / unlink a branch -------------------------------------------------------------------------------------------
const issueLinkBranch = specTool({
  name: 'github_issue_link_branch',
  description: 'Create a branch linked to an issue (from a commit, default: the default branch head), or unlink a branch from an issue. The branch itself is kept on unlink.',
  properties: { number: NUMBER, branch: { type: 'string', minLength: 1, maxLength: 200 }, sha: { type: 'string', pattern: '^[0-9a-f]{40}$' }, unlink: { type: 'boolean' } }, required: ['number', 'branch'],
  build: async (args, gh, t) => {
    const r = (await graphql(gh, REPO_ISSUE, { o: t.owner, n: t.repo, num: args.number })).repository;
    if (!r?.issue?.id) throw refusal(`Issue #${args.number} was not found.`, 404);
    if (args.unlink) {
      const linked = (await graphql(gh, 'query Linked($id: ID!) { node(id: $id) { ... on Issue { linkedBranches(first: 50) { nodes { id ref { name } } } } } }', { id: r.issue.id })).node?.linkedBranches?.nodes ?? [];
      const hit = linked.find((n) => n?.ref?.name === args.branch);
      if (!hit) throw refusal(`Branch ${args.branch} is not linked to issue #${args.number}.`);
      return { mutation: 'deleteLinkedBranch', nodeId: hit.id, input: { linkedBranchId: hit.id }, issueNodeId: r.issue.id, title: r.issue.title };
    }
    const oid = args.sha ?? r.defaultBranchRef?.target?.oid;
    if (!oid) throw refusal('The default branch has no commit to start from; give sha.');
    return { mutation: 'createLinkedBranch', nodeId: r.issue.id, input: { issueId: r.issue.id, name: args.branch, oid, repositoryId: r.id }, title: r.issue.title };
  },
  summarize: ({ args, before }) => `${args.unlink ? 'Unlink' : 'Create and link'} branch ${args.branch} ${args.unlink ? 'from' : 'to'} issue #${args.number} "${cap(before.plan.title, 80)}"`,
  inverseOf: (args, inv, t) => ({ tool: 'github_issue_link_branch', args: { owner: t.owner, repo: t.repo, number: args.number, branch: args.branch, unlink: inv.mutation === 'deleteLinkedBranch' } }),
  present: ({ args, after }) => ({ number: args.number, branch: args.branch, linked: !args.unlink && after.node !== null })
});

// ---- REST: delete a comment -------------------------------------------------------------------------------------------
const COMMENT_ROUTE = { issue: '/repos/{owner}/{repo}/issues/comments/{comment_id}', review: '/repos/{owner}/{repo}/pulls/comments/{comment_id}' };
const getComment = (gh, kind, t, id) => missing(async () => (await gh.request(`GET ${COMMENT_ROUTE[kind]}`, { owner: t.owner, repo: t.repo, comment_id: id })).data);
const commentDelete = defineGithubWrite({
  name: 'github_comment_delete', area: 'issue', audience: ['Op', 'O'],
  description: 'Delete an issue or pull request review comment. The preview shows its author and first 120 characters. Cannot be undone.',
  properties: { ...BASE, kind: { type: 'string', enum: ['issue', 'review'] }, commentId: { type: 'integer', minimum: 1 } }, required: ['kind', 'commentId'],
  declarations: { production: 'when-target', confirm: 'always', cred: 'I', profiles: ['full'] }, target,
  read: async (args, ctx, t) => ({ comment: await getComment(await octo(ctx, t.owner), args.kind, t, args.commentId) }),
  classify: async ({ before, ctx }) => {
    if (!before?.comment) return {};
    const { people } = await ownPeople(ctx);
    return people.has(low(before.comment.user?.login)) ? {} : { production: `deleting a comment written by ${before.comment.user?.login ?? 'someone else'} cannot be undone` };
  },
  summarize: ({ args, before }) => (before.comment
    ? `DELETE ${args.kind} comment ${args.commentId} by ${before.comment.user?.login ?? 'unknown'}: "${cap(before.comment.body, 120)}" (cannot be undone)` : `Comment ${args.commentId} no longer exists`),
  apply: async ({ args, ctx, target: t, before }) => {
    if (!before.comment) throw refusal('The comment no longer exists; nothing was deleted.', 404);
    return (await octo(ctx, t.owner)).request(`DELETE ${COMMENT_ROUTE[args.kind]}`, { owner: t.owner, repo: t.repo, comment_id: args.commentId });
  },
  readAfter: async ({ args, ctx, target: t }) => ({ comment: await getComment(await octo(ctx, t.owner), args.kind, t, args.commentId) }),
  verify: ({ after }) => after.comment === null,
  inverse: () => null,
  present: ({ args, before }) => ({ deleted: args.commentId, author: before.comment?.user?.login ?? null, excerpt: cap(before.comment?.body, 120), untrusted: true, restorable: false })
});

// ---- REST: pin / unpin an issue comment -------------------------------------------------------------------------------
const PIN_READ = 'query CommentPin($id: ID!) { node(id: $id) { ... on IssueComment { isPinned } } }';
const commentPin = defineGithubWrite({
  name: 'github_comment_pin', area: 'issue', audience: ['Op', 'O'],
  description: 'Pin an issue comment to the top of its issue, or unpin it.',
  properties: { ...BASE, commentId: { type: 'integer', minimum: 1 }, pinned: { type: 'boolean', description: 'true to pin (default), false to unpin' } }, required: ['commentId'],
  declarations: { production: 'never', confirm: 'when-needed', cred: 'I', profiles: ['full'] }, target,
  read: async (args, ctx, t) => {
    const gh = await octo(ctx, t.owner);
    const c = await getComment(gh, 'issue', t, args.commentId);
    if (!c) throw refusal(`Comment ${args.commentId} was not found.`, 404);
    return { nodeId: c.node_id, pinned: (await graphql(gh, PIN_READ, { id: c.node_id })).node?.isPinned === true };
  },
  classify: () => ({}),
  summarize: ({ args, before }) => `${args.pinned === false ? 'Unpin' : 'Pin'} comment ${args.commentId} (today ${before.pinned ? 'pinned' : 'not pinned'})`,
  apply: async ({ args, ctx, target: t, before }) => {
    if (before.pinned === (args.pinned !== false)) throw refusal(`Already ${before.pinned ? 'pinned' : 'not pinned'}; nothing to do.`);
    return (await octo(ctx, t.owner)).request(`${args.pinned === false ? 'DELETE' : 'PUT'} /repos/{owner}/{repo}/issues/comments/{comment_id}/pin`, { owner: t.owner, repo: t.repo, comment_id: args.commentId });
  },
  readAfter: async ({ ctx, target: t, before }) => ({ pinned: (await graphql(await octo(ctx, t.owner), PIN_READ, { id: before.nodeId })).node?.isPinned === true }),
  verify: ({ args, after }) => after.pinned === (args.pinned !== false),
  inverse: ({ args, target: t }) => ({ tool: 'github_comment_pin', args: { owner: t.owner, repo: t.repo, commentId: args.commentId, pinned: args.pinned === false } }),
  present: ({ args, after }) => ({ commentId: args.commentId, pinned: after.pinned })
});

// ---- REST: edit a pull request review comment ---------------------------------------------------------------------------
const reviewCommentEdit = defineGithubWrite({
  name: 'github_review_comment_edit', area: 'review', audience: ['Op', 'O'],
  description: 'Edit the text of a pull request review comment (only comments this connection\'s App wrote can be edited). Mentions of outsiders ask first.',
  properties: { ...BASE, commentId: { type: 'integer', minimum: 1 }, body: { type: 'string', minLength: 1, maxLength: 20000 } }, required: ['commentId', 'body'],
  declarations: { production: 'never', confirm: 'when-needed', notifies: true, cred: 'I', profiles: ['full'] }, target,
  read: async (args, ctx, t) => {
    const comment = await getComment(await octo(ctx, t.owner), 'review', t, args.commentId);
    if (!comment) throw refusal(`Review comment ${args.commentId} was not found.`, 404);
    return { comment };
  },
  classify: ({ args, ctx, target: t }) => notifyOutsiders(ctx, { text: args.body, repoOwner: t.owner }),
  summarize: ({ args, before }) => `Edit review comment ${args.commentId} by ${before.comment.user?.login ?? 'unknown'} (${before.comment.body?.length ?? 0} -> ${args.body.length} characters)`,
  apply: async ({ args, ctx, target: t, before }) => {
    if (before.comment.body === args.body) throw refusal('The comment already has that text; nothing to do.');
    return (await octo(ctx, t.owner)).request('PATCH /repos/{owner}/{repo}/pulls/comments/{comment_id}', { owner: t.owner, repo: t.repo, comment_id: args.commentId, body: args.body });
  },
  readAfter: async ({ args, ctx, target: t }) => ({ comment: await getComment(await octo(ctx, t.owner), 'review', t, args.commentId) }),
  verify: ({ args, after }) => after.comment?.body === args.body,
  inverse: ({ args, before, target: t }) => ({ tool: 'github_review_comment_edit', args: { owner: t.owner, repo: t.repo, commentId: args.commentId, body: before.comment.body } }),
  present: ({ args, after }) => ({ commentId: args.commentId, length: after.comment?.body?.length ?? 0, untrusted: true })
});

const writes = [issuePin, commentPin, commentDelete, commentHide, reviewCommentEdit, issueDelete, discussionManage, issueLinkBranch];
export const tools = writes.map((d) => d.tool);
export const handlers = Object.fromEntries(writes.map((d) => [d.tool.name, d.handler]));
