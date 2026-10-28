import { redact } from './util.js';
// F-1: issue creation, editing and conversation, using the existing guarded, journalled
// GitHub write pipeline (preview, identity, people, idempotency, readback).
import { defineGithubWrite } from './define-github-write.js';
import { missing, octo, ownerOf, refusal, slug } from './github-write.js';
import { notifyOutsiders } from './people-guard.js';

const OWNER = { type: 'string', maxLength: 39 };
const REPO = { type: 'string', minLength: 1, maxLength: 100 };
const NUMBER = { type: 'integer', minimum: 1 };
const TITLE = { type: 'string', minLength: 1, maxLength: 256 };
const BODY = { type: 'string', maxLength: 20000 };
const MENTION_BODY = { type: 'string', minLength: 1, maxLength: 20000 };
const target = (args, ctx) => ({ owner: ownerOf(args, ctx), repo: args.repo, scope: 'repo' });
const issueRoute = 'GET /repos/{owner}/{repo}/issues/{issue_number}';
const getIssue = (ctx, t, number) => missing(async () => (
  await (await octo(ctx, t.owner)).request(issueRoute, { owner: t.owner, repo: t.repo, issue_number: number })
).data);
const expectIssue = (issue, number) => {
  if (!issue) throw refusal(`Issue #${number} does not exist.`, 404);
  if (issue.pull_request) throw refusal(`#${number} is a pull request; use the pull-request tools.`);
  return issue;
};
const brief = (i) => ({
  number: i.number, title: i.title, state: i.state, state_reason: i.state_reason,
  body: i.body, labels: (i.labels ?? []).map(l => typeof l === 'string' ? l : l.name),
  assignees: (i.assignees ?? []).map(a => a.login), milestone: i.milestone?.number ?? null, type: i.type?.name ?? i.type ?? null, html_url: i.html_url
});

export const issueCreate = defineGithubWrite({
  name: 'github_issue_create', area: 'issue', audience: ['B', 'Op'],
  description: 'Open an issue with labels, assignees, milestone and guarded notifications.',
  properties: { owner: OWNER, repo: REPO, title: TITLE, body: BODY,
    labels: { type: 'array', maxItems: 30, items: { type: 'string', minLength: 1, maxLength: 100 } },
    assignees: { type: 'array', maxItems: 10, items: { type: 'string', minLength: 1, maxLength: 39 } },
    milestone: NUMBER, type: { type: 'string', minLength: 1, maxLength: 100 } },
  required: ['repo', 'title'],
  declarations: { production: 'never', notifies: true },
  target,
  read: async (args, ctx, t) => {
    const repo = (await (await octo(ctx, t.owner)).request('GET /repos/{owner}/{repo}', { owner: t.owner, repo: t.repo })).data;
    if (repo.has_issues === false) throw refusal('Issues are disabled in this repository.');
    return { exists: true, has_issues: repo.has_issues };
  },
  classify: ({ args, ctx, target: t }) => notifyOutsiders(ctx, { text: `${args.title}\n${args.body ?? ''}`, logins: args.assignees ?? [], repoOwner: t.owner }),
  summarize: ({ args, target: t }) => `Create an issue in ${slug(t.owner, t.repo)}: "${redact(args.title).slice(0, 90)}"${args.assignees?.length ? ` and notify ${args.assignees.join(', ')}` : ''}`,
  apply: ({ args, ctx, target: t }) => octo(ctx, t.owner).then(o => o.request('POST /repos/{owner}/{repo}/issues', { owner: t.owner, repo: t.repo, title: args.title,
    ...(args.body !== undefined ? { body: args.body } : {}),
    ...(args.labels !== undefined ? { labels: args.labels } : {}),
    ...(args.assignees !== undefined ? { assignees: args.assignees } : {}),
    ...(args.milestone !== undefined ? { milestone: args.milestone } : {}),
    ...(args.type !== undefined ? { type: args.type } : {}) })),
  readAfter: ({ ctx, target: t, response }) => getIssue(ctx, t, response.data.number),
  verify: ({ args, after }) => !!after && !after.pull_request && after.title === args.title
    && (args.body === undefined || (after.body ?? '') === args.body)
    && (args.milestone === undefined || (after.milestone?.number ?? null) === args.milestone)
    && (args.type === undefined || (after.type?.name ?? after.type ?? null) === args.type)
    && (args.labels === undefined || args.labels.every(n => (after.labels ?? []).some(l => l.name === n || l === n)))
    && (args.assignees === undefined || args.assignees.every(n => (after.assignees ?? []).some(a => a.login?.toLowerCase() === n.toLowerCase()))),
  inverse: () => null, // GitHub issues cannot be deleted; closing is not a complete inverse.
  present: ({ after }) => brief(after)
});

export const issueUpdate = defineGithubWrite({
  name: 'github_issue_update', area: 'issue', audience: ['B', 'Op'],
  description: 'Update issue title, body, state, state reason or milestone; omitted fields stay unchanged.',
  properties: { owner: OWNER, repo: REPO, number: NUMBER, title: TITLE, body: BODY,
    state: { type: 'string', enum: ['open', 'closed'] },
    stateReason: { type: 'string', enum: ['completed', 'not_planned', 'duplicate', 'reopened'] },
    duplicateIssueId: NUMBER, type: { type: 'string', minLength: 1, maxLength: 100 },
    milestone: { type: ['integer', 'null'], minimum: 1 } },
  required: ['repo', 'number'],
  declarations: { production: 'never', notifies: true },
  target: (args, ctx) => {
    if (!['title', 'body', 'state', 'milestone', 'type'].some(k => Object.hasOwn(args, k))) throw new TypeError('Provide at least one field to update.');
    if (args.stateReason && !args.state) throw new TypeError('stateReason needs an explicit state.');
    if (args.state === 'open' && args.stateReason && args.stateReason !== 'reopened') throw new TypeError('Opening an issue uses reopened.');
    if (args.state === 'closed' && args.stateReason === 'reopened') throw new TypeError('Closing an issue needs completed, not_planned or duplicate.');
    if (args.duplicateIssueId !== undefined && args.stateReason !== 'duplicate') throw new TypeError('duplicateIssueId requires stateReason duplicate.');
    return target(args, ctx);
  },
  read: (args, ctx, t) => getIssue(ctx, t, args.number).then(i => expectIssue(i, args.number)),
  classify: ({ args, ctx, target: t }) => notifyOutsiders(ctx, { text: `${args.title ?? ''}\n${args.body ?? ''}`, repoOwner: t.owner }),
  summarize: ({ args, target: t }) => `Update issue #${args.number} in ${slug(t.owner, t.repo)} (${Object.keys(args).filter(k => ['title', 'body', 'state', 'milestone', 'type'].includes(k)).join(', ')})`,
  apply: ({ args, ctx, target: t }) => octo(ctx, t.owner).then(o => o.request('PATCH /repos/{owner}/{repo}/issues/{issue_number}', { owner: t.owner, repo: t.repo, issue_number: args.number,
    ...(args.title !== undefined ? { title: args.title } : {}),
    ...(args.body !== undefined ? { body: args.body } : {}),
    ...(args.state !== undefined ? { state: args.state } : {}),
    ...(args.stateReason !== undefined ? { state_reason: args.stateReason } : {}),
    ...(args.duplicateIssueId !== undefined ? { duplicate_issue_id: args.duplicateIssueId } : {}),
    ...(args.type !== undefined ? { type: args.type } : {}),
    ...(args.milestone !== undefined ? { milestone: args.milestone } : {}) })), 
  readAfter: ({ args, ctx, target: t }) => getIssue(ctx, t, args.number),
  verify: ({ args, after }) => !!after && !after.pull_request &&
    (args.title === undefined || after.title === args.title) &&
    (args.body === undefined || (after.body ?? '') === args.body) &&
    (args.state === undefined || after.state === args.state) &&
    (args.stateReason === undefined || after.state_reason === args.stateReason) &&
    (args.type === undefined || (after.type?.name ?? after.type ?? null) === args.type) &&
    (args.milestone === undefined || (after.milestone?.number ?? null) === args.milestone),
  inverse: () => null,
  present: ({ after }) => brief(after)
});

export const issueComment = defineGithubWrite({
  name: 'github_issue_comment', area: 'issue', audience: ['B', 'Op'],
  description: 'Post a comment to an issue or PR and verify its exact body afterward.',
  properties: { owner: OWNER, repo: REPO, number: NUMBER, body: MENTION_BODY },
  required: ['repo', 'number', 'body'],
  declarations: { production: 'never', notifies: true },
  target,
  read: async (args, ctx, t) => {
    const i = await getIssue(ctx, t, args.number);
    if (!i) throw refusal(`Issue or PR #${args.number} does not exist.`, 404);
    return { number: i.number, state: i.state };
  },
  classify: ({ args, ctx, target: t }) => notifyOutsiders(ctx, { text: args.body, repoOwner: t.owner }),
  summarize: ({ args, target: t }) => `Comment on #${args.number} in ${slug(t.owner, t.repo)}: "${redact(args.body).slice(0,90)}"`,
  apply: ({ args, ctx, target: t }) => octo(ctx, t.owner).then(o => o.request('POST /repos/{owner}/{repo}/issues/{issue_number}/comments', { owner: t.owner, repo: t.repo, issue_number: args.number, body: args.body })),
  readAfter: ({ ctx, target: t, response }) => octo(ctx, t.owner).then(o => o.request('GET /repos/{owner}/{repo}/issues/comments/{comment_id}', { owner: t.owner, repo: t.repo, comment_id: response.data.id })).then(r => r.data),
  verify: ({ args, after, response }) => !!after && after.id === response.data.id && after.body === args.body,
  inverse: () => null,
  present: ({ after }) => ({ id: after.id, body: after.body, author: after.user?.login, html_url: after.html_url })
});

export const issueLock = defineGithubWrite({
  name: 'github_issue_lock', area: 'issue', audience: ['Op'],
  description: 'Lock or unlock conversation on an issue or PR; verify locked status.',
  properties: { owner: OWNER, repo: REPO, number: NUMBER, locked: { type: 'boolean' },
    reason: { type: 'string', enum: ['off-topic', 'too heated', 'resolved', 'spam'] } },
  required: ['repo', 'number', 'locked'],
  declarations: { production: 'never' },
  target: (args, ctx) => {
    if (!args.locked && args.reason !== undefined) throw new TypeError('Only a lock may specify a reason.');
    return target(args, ctx);
  },
  read: async (args, ctx, t) => {
    const i = await getIssue(ctx, t, args.number);
    if (!i) throw refusal(`Issue or PR #${args.number} does not exist.`, 404);
    if (i.locked && args.locked && args.reason && i.active_lock_reason !== args.reason)
      throw refusal('Already locked with a different reason; no change made. Unlock separately before applying a new lock reason.');
    return { locked: !!i.locked, reason: i.active_lock_reason };
  },
  classify: () => ({}),
  summarize: ({ args, target: t }) => `${args.locked ? 'Lock' : 'Unlock'} #${args.number} in ${slug(t.owner, t.repo)}`,
  apply: async ({ args, ctx, target: t, before }) => {
    if (before.locked === args.locked) return { unchanged: true };
    const route = `${args.locked ? 'PUT' : 'DELETE'} /repos/{owner}/{repo}/issues/{issue_number}/lock`;
    return (await octo(ctx, t.owner)).request(route, { owner: t.owner, repo: t.repo, issue_number: args.number,
      ...(args.locked && args.reason ? { lock_reason: args.reason } : {}) });
  },
  readAfter: ({ args, ctx, target: t }) => getIssue(ctx, t, args.number),
  verify: ({ args, after }) => !!after && !!after.locked === args.locked && (!args.locked || !args.reason || after.active_lock_reason === args.reason),
  inverse: ({ args, before, target: t }) => before.locked === args.locked ? null : ({ tool: 'github_issue_lock', args: { owner: t.owner, repo: t.repo, number: args.number, locked: !args.locked } }),
  present: ({ args, after }) => ({ number: args.number, locked: !!after.locked, active_lock_reason: after.active_lock_reason ?? null })
});

const commentRoute = 'GET /repos/{owner}/{repo}/issues/comments/{comment_id}';
const getComment = (ctx, t, id) => missing(async () => (await (await octo(ctx, t.owner)).request(commentRoute,
  { owner: t.owner, repo: t.repo, comment_id: id })).data);
const belongsToRepo = (c, t) => {
  const prefix = `https://api.github.com/repos/${t.owner}/${t.repo}/issues/`;
  return typeof c?.issue_url === 'string' && c.issue_url.toLowerCase().startsWith(prefix.toLowerCase())
    && /^[0-9]+$/.test(c.issue_url.slice(prefix.length));
};

export const issueEditComment = defineGithubWrite({
  name: 'github_issue_edit_comment', area: 'issue', audience: ['B', 'Op'],
  description: 'Edit an existing issue or PR comment within the exact selected repository.',
  properties: { owner: OWNER, repo: REPO, commentId: NUMBER, body: MENTION_BODY },
  required: ['repo', 'commentId', 'body'],
  declarations: { production: 'never', notifies: true },
  target,
  read: async (args, ctx, t) => {
    const c = await getComment(ctx, t, args.commentId);
    if (!c) throw refusal('Comment does not exist.', 404);
    if (!belongsToRepo(c, t)) throw refusal('Comment ownership cannot be verified for this repository.');
    return { id: c.id, body: c.body, issue_url: c.issue_url };
  },
  classify: ({ args, ctx, target: t }) => notifyOutsiders(ctx, { text: args.body, repoOwner: t.owner }),
  summarize: ({ args, target: t }) => `Edit comment #${args.commentId} in ${slug(t.owner, t.repo)}`,
  apply: ({ args, ctx, target: t }) => octo(ctx, t.owner).then(o => o.request('PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}',
    { owner: t.owner, repo: t.repo, comment_id: args.commentId, body: args.body })),
  readAfter: ({ args, ctx, target: t }) => getComment(ctx, t, args.commentId),
  verify: ({ args, after, target: t }) => !!after && after.id === args.commentId && after.body === args.body && belongsToRepo(after, t),
  inverse: ({ before, target: t }) => ({ tool: 'github_issue_edit_comment', args: { owner: t.owner, repo: t.repo, commentId: before.id, body: before.body } }),
  present: ({ after }) => ({ id: after.id, body: after.body, html_url: after.html_url })
});

const normalizeLabels = i => (i.labels ?? []).map(l => typeof l === 'string' ? l : l.name);
const normalized = v => [...new Set(v.map(x => String(x).toLowerCase()))].sort();
export const issueSetLabels = defineGithubWrite({
  name: 'github_issue_set_labels', area: 'issue', audience: ['B', 'Op'],
  description: 'Add, remove or replace issue or PR labels; verify the resulting exact label set.',
  properties: { owner: OWNER, repo: REPO, number: NUMBER, mode: { type: 'string', enum: ['add','remove','replace'] },
    labels: { type: 'array', minItems: 0, maxItems: 30, items: { type: 'string', minLength: 1, maxLength: 100 } } },
  required: ['repo', 'number', 'mode', 'labels'],
  declarations: { production: 'never' },
  target: (args, ctx) => {
    if (args.mode !== 'replace' && args.labels.length === 0) throw new TypeError('Empty labels are only valid for replace (clear all).');
    return target(args, ctx);
  },
  read: async (args, ctx, t) => {
    const i = await getIssue(ctx, t, args.number);
    if (!i) throw refusal(`Issue or PR #${args.number} does not exist.`, 404);
    return { number: i.number, labels: normalizeLabels(i) };
  },
  classify: () => ({}),
  summarize: ({ args, target: t }) => `${args.mode} ${args.labels.length} label(s) on #${args.number} in ${slug(t.owner, t.repo)}`,
  apply: async ({ args, ctx, target: t, before }) => {
    const o = await octo(ctx, t.owner), p = { owner: t.owner, repo: t.repo, issue_number: args.number };
    if (args.mode === 'replace' && args.labels.length === 0) return o.request('DELETE /repos/{owner}/{repo}/issues/{issue_number}/labels', p);
    if (args.mode === 'replace') return o.request('PUT /repos/{owner}/{repo}/issues/{issue_number}/labels', { ...p, labels: args.labels });
    if (args.mode === 'add') return o.request('POST /repos/{owner}/{repo}/issues/{issue_number}/labels', { ...p, labels: args.labels });
    // One atomic provider request per journaled intent. Do not partially delete
    // multiple labels and then incorrectly classify a failed later DELETE as no-op.
    const remove = new Set(normalized(args.labels));
    const remainder = before.labels.filter(name => !remove.has(name.toLowerCase()));
    if (remainder.length === before.labels.length) return { unchanged: true };
    const latest = await getIssue(ctx, t, args.number);
    if (!latest || JSON.stringify(normalized(normalizeLabels(latest))) !== JSON.stringify(normalized(before.labels)))
      throw refusal('Issue labels changed since preview. Review the new labels before changing them.');
    return remainder.length === 0
      ? o.request('DELETE /repos/{owner}/{repo}/issues/{issue_number}/labels', p)
      : o.request('PUT /repos/{owner}/{repo}/issues/{issue_number}/labels', { ...p, labels: remainder });
  },
  readAfter: ({ args, ctx, target: t }) => getIssue(ctx, t, args.number),
  verify: ({ args, before, after }) => {
    if (!after) return false;
    const got = normalized(normalizeLabels(after)), requested = normalized(args.labels);
    if (args.mode === 'replace') return JSON.stringify(got) === JSON.stringify(requested);
    if (args.mode === 'add') return requested.every(x => got.includes(x)) && normalized(before.labels).every(x => got.includes(x));
    const remaining = normalized(before.labels).filter(x => !requested.includes(x));
    return JSON.stringify(got) === JSON.stringify(remaining);
  },
  inverse: () => null,
  present: ({ args, after }) => ({ number: args.number, labels: normalizeLabels(after) })
});

export const issueSetAssignees = defineGithubWrite({
  name: 'github_issue_set_assignees', area: 'issue', audience: ['Op'],
  description: 'Add or remove issue assignees with outsider-notification preview and exact readback.',
  properties: { owner: OWNER, repo: REPO, number: NUMBER, mode: { type: 'string', enum: ['add','remove'] },
    assignees: { type: 'array', minItems: 1, maxItems: 10, items: { type: 'string', minLength: 1, maxLength: 39 } } },
  required: ['repo', 'number', 'mode', 'assignees'],
  declarations: { production: 'never', notifies: true },
  target,
  read: async (args, ctx, t) => {
    const i = expectIssue(await getIssue(ctx, t, args.number), args.number);
    return { number: i.number, assignees: (i.assignees ?? []).map(a => a.login) };
  },
  classify: ({ args, ctx, target: t }) => args.mode === 'add'
    ? notifyOutsiders(ctx, { logins: args.assignees, repoOwner: t.owner })
    : notifyOutsiders(ctx, { repoOwner: t.owner }),
  summarize: ({ args, target: t }) => `${args.mode} assignees ${args.assignees.join(', ')} for #${args.number} in ${slug(t.owner, t.repo)}`,
  apply: ({ args, ctx, target: t }) => octo(ctx, t.owner).then(o => o.request(`${args.mode === 'add' ? 'POST' : 'DELETE'} /repos/{owner}/{repo}/issues/{issue_number}/assignees`,
    { owner: t.owner, repo: t.repo, issue_number: args.number, assignees: args.assignees })),
  readAfter: ({ args, ctx, target: t }) => getIssue(ctx, t, args.number),
  verify: ({ args, before, after }) => {
    if (!after) return false;
    const got = normalized((after.assignees ?? []).map(a => a.login)), requested = normalized(args.assignees);
    return args.mode === 'add'
      ? requested.every(x => got.includes(x)) && normalized(before.assignees).every(x => got.includes(x))
      : requested.every(x => !got.includes(x)) && got.every(x => normalized(before.assignees).includes(x));
  },
  inverse: () => null,
  present: ({ args, after }) => ({ number: args.number, assignees: (after.assignees ?? []).map(a => a.login) })
});

const all = [issueCreate, issueUpdate, issueComment, issueLock, issueEditComment, issueSetLabels, issueSetAssignees];
export const tools = all.map(d => d.tool);
export const handlers = Object.fromEntries(all.map(d => [d.tool.name, d.handler]));
