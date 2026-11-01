// CAP-6 tools: merge queue (read, enqueue, dequeue) and assigning Copilot's coding agent to an issue. Every write passes
// the nine write-contract checks through every door; every GraphQL document is validated by the fake GitHub against the
// pinned schema. Spend classification: every money-capable tool in a gated family is strict (asks everyone, refuses an
// unknowable cost) and its cost is never taken from the arguments.
import { describe, expect, it } from 'vitest';
import * as mq from '../../src/tools/merge-queue.js';
import * as assign from '../../src/tools/copilot-assign.js';
import { registry } from '../../src/tools/index.js';
import { familyOf } from '../../src/github/feature-gates.js';
import { defineWrite } from '../../src/core/write.js';
import { createDispatch } from '../../src/tools/dispatch.js';
import { makeWorld, parse, runWriteContract } from '../../test/helpers/write-contract.js';

const def = (m, name) => ({ tool: m.tools.find((t) => t.name === name), handler: m.handlers[name] });
const HEAD = 'a'.repeat(40);
const isMutation = (req) => /^\s*mutation/.test(String(req.body?.query ?? ''));
const pr = ({ queued = false, state = 'OPEN', draft = false, queueOn = true, head = HEAD } = {}) => ({ data: { repository: { pullRequest: {
  id: 'PR_kwDOqueue', number: 7, state, isDraft: draft, headRefOid: head, baseRefName: 'main', isMergeQueueEnabled: queueOn, isInMergeQueue: queued,
  mergeQueueEntry: queued ? { id: 'MQE_1', position: 2, state: 'QUEUED' } : null } } } });

// The pull request is read before, the mutation is sent, then it is read again.
function arrangeEnqueue(gh, outcome = 'ok') {
  let enqueued = false;
  gh.when('POST /graphql').reply(200, (req) => {
    if (isMutation(req)) { enqueued = true; return { data: { enqueuePullRequest: { mergeQueueEntry: { id: 'MQE_1', position: 2, state: 'QUEUED' } } } }; }
    return pr({ queued: enqueued && outcome === 'ok' });
  });
}
function arrangeDequeue(gh, outcome = 'ok') {
  let removed = false;
  gh.when('POST /graphql').reply(200, (req) => {
    if (isMutation(req)) { removed = true; return { data: { dequeuePullRequest: { mergeQueueEntry: { id: 'MQE_1', state: 'UNMERGEABLE' } } } }; }
    return pr({ queued: !(removed && outcome === 'ok') });
  });
}
runWriteContract({ label: 'CAP-6 github_merge_queue_enqueue', definition: def(mq, 'github_merge_queue_enqueue'),
  args: { repo: 'hello', number: 7, expectedHeadSha: HEAD }, arrange: arrangeEnqueue, needsConfirm: true, production: true });
runWriteContract({ label: 'CAP-6 github_merge_queue_dequeue', definition: def(mq, 'github_merge_queue_dequeue'),
  args: { repo: 'hello', number: 7 }, arrange: arrangeDequeue, needsConfirm: false });

const ISSUE = (assigned) => ({ data: { repository: { id: 'R_1', nameWithOwner: 'example-org/hello',
  suggestedActors: { nodes: [{ __typename: 'Bot', login: 'copilot-swe-agent', id: 'BOT_copilot' }] },
  issue: { id: 'I_kwDO7', number: 7, state: 'OPEN', title: 'Fix the footer', assignedActors: { nodes: assigned ? [{ __typename: 'Bot', login: 'copilot-swe-agent' }] : [] } } } } });
function arrangeAssign(gh, outcome = 'ok') {
  let sent = false;
  gh.when('POST /graphql').reply(200, (req) => {
    if (isMutation(req)) { sent = true; return { data: { addAssigneesToAssignable: { assignable: { id: 'I_kwDO7' } } } }; }
    return ISSUE(sent && outcome === 'ok');
  });
}
runWriteContract({ label: 'CAP-6 github_copilot_assign_issue', definition: def(assign, 'github_copilot_assign_issue'),
  args: { repo: 'hello', number: 7, instructions: 'Keep the change small.' }, arrange: arrangeAssign, profile: 'full', needsConfirm: true, strictSpend: true });

const call = (w, m, name, args) => m.handlers[name](args, w.ctx).then(parse);

describe('merge queue', () => {
  it('reads the queue: settings and entries, marked untrusted, with a valid document', async () => {
    const w = await makeWorld({ profile: 'read_only' });
    w.gh.when('POST /graphql').reply(200, { data: { repository: { nameWithOwner: 'example-org/hello', defaultBranchRef: { name: 'main' }, mergeQueue: {
      id: 'MQ_1', url: 'https://github.com/example-org/hello/queue/main', nextEntryEstimatedTimeToMerge: 300,
      configuration: { mergeMethod: 'MERGE', mergingStrategy: 'ALLGREEN', maximumEntriesToBuild: 5, maximumEntriesToMerge: 5, minimumEntriesToMerge: 1, minimumEntriesToMergeWaitTime: 5, checkResponseTimeout: 60 },
      entries: { totalCount: 1, nodes: [{ id: 'MQE_1', position: 1, state: 'AWAITING_CHECKS', jump: false, solo: false, enqueuedAt: '2026-11-01T10:00:00Z', estimatedTimeToMerge: 120,
        headCommit: { oid: HEAD }, enqueuer: { login: 'example-owner' }, pullRequest: { number: 7, title: 'Add footer', headRefOid: HEAD } }] } } } } });
    const out = await createDispatch({ credentials: w.credentials, fetch: w.gh.fetch, now: w.ctx.now }).call(null, { registry, name: 'github_merge_queue_get', args: { repo: 'hello' }, connection: w.connection, db: w.db }).then(parse);
    expect(out).toMatchObject({ enabled: true, branch: 'main', total: 1, complete: true, untrusted: true, configuration: { mergeMethod: 'MERGE' } });
    expect(out.entries[0]).toMatchObject({ position: 1, state: 'AWAITING_CHECKS', pullRequest: { number: 7 } });
    expect(w.gh.invalid).toEqual([]);
  });
  it('says plainly when a branch has no merge queue', async () => {
    const w = await makeWorld({ profile: 'read_only' });
    w.gh.when('POST /graphql').reply(200, { data: { repository: { nameWithOwner: 'example-org/hello', defaultBranchRef: { name: 'main' }, mergeQueue: null } } });
    const out = await createDispatch({ credentials: w.credentials, fetch: w.gh.fetch, now: w.ctx.now }).call(null, { registry, name: 'github_merge_queue_get', args: { repo: 'hello' }, connection: w.connection, db: w.db }).then(parse);
    expect(out).toMatchObject({ enabled: false, entries: [] });
    expect(out.note).toMatch(/Require merge queue/);
  });
  it('refuses, sending nothing, when the head moved, the PR is a draft, or the branch has no queue', async () => {
    for (const [reply, words] of [[pr({ head: 'b'.repeat(40) }), /moved/], [pr({ draft: true }), /draft/], [pr({ queueOn: false }), /no merge queue/], [pr({ state: 'MERGED' }), /merged/]]) {
      const w = await makeWorld({ mode: 'production', profile: 'full' });
      w.gh.when('POST /graphql').reply(200, reply);
      const out = await call(w, mq, 'github_merge_queue_enqueue', { repo: 'hello', number: 7, expectedHeadSha: HEAD, confirm: true });
      expect(out.status).toBe('refused_by_guard');
      expect(out.error).toMatch(words);
      expect(w.gh.calls.filter(isMutation)).toEqual([]);
    }
  });
  it('sends the exact expected head and jump only when asked; the preview says JUMPING', async () => {
    const w = await makeWorld({ mode: 'production', profile: 'full' });
    arrangeEnqueue(w.gh);
    const preview = await call(w, mq, 'github_merge_queue_enqueue', { repo: 'hello', number: 7, expectedHeadSha: HEAD, jump: true, dryRun: true });
    expect(preview.preview).toMatch(/JUMPING/);
    const out = await call(w, mq, 'github_merge_queue_enqueue', { repo: 'hello', number: 7, expectedHeadSha: HEAD, jump: true });
    expect(out.status).toBe('applied');
    const sent = w.gh.graphql.find((g) => /enqueuePullRequest/.test(g.query));
    expect(sent.variables.input).toEqual({ pullRequestId: 'PR_kwDOqueue', expectedHeadOid: HEAD, jump: true });
  });
  it('dequeue refuses a pull request that is not queued', async () => {
    const w = await makeWorld();
    w.gh.when('POST /graphql').reply(200, pr({ queued: false }));
    const out = await call(w, mq, 'github_merge_queue_dequeue', { repo: 'hello', number: 7, confirm: true });
    expect(out.error).toMatch(/not in the merge queue/);
    expect(w.gh.calls.filter(isMutation)).toEqual([]);
  });
});

describe('Copilot coding agent on an issue', () => {
  it('uses the user credential, the bot id GitHub offered, and never runs without confirmation, even for the owner', async () => {
    const w = await makeWorld({ mode: 'production', profile: 'full' });
    arrangeAssign(w.gh);
    const first = await call(w, assign, 'github_copilot_assign_issue', { repo: 'hello', number: 7 });
    expect(first).toMatchObject({ status: 'needs_confirmation', needsConfirmation: true });
    expect(first.preview).toMatch(/COST UNKNOWN/);
    expect(first.preview).toMatch(/billed by use/);
    const done = await call(w, assign, 'github_copilot_assign_issue', { repo: 'hello', number: 7, baseRef: 'main', confirm: true });
    expect(done).toMatchObject({ status: 'applied', result: { copilot_assigned: true } });
    const sent = w.gh.graphql.find((g) => /addAssigneesToAssignable/.test(g.query));
    expect(sent.variables.input).toEqual({ assignableId: 'I_kwDO7', assigneeIds: ['BOT_copilot'], agentAssignment: { baseRef: 'main' } });
    const mutation = w.gh.calls.find(isMutation);
    expect(mutation.headers.authorization).toMatch(/ghu_FAKE/);
    expect(w.gh.invalid).toEqual([]);
  });
  it('refuses plainly when Copilot is not offered in the repository', async () => {
    const w = await makeWorld({ mode: 'production', profile: 'full' });
    w.gh.when('POST /graphql').reply(200, { data: { repository: { ...ISSUE(false).data.repository, suggestedActors: { nodes: [] } } } });
    const out = await call(w, assign, 'github_copilot_assign_issue', { repo: 'hello', number: 7, confirm: true });
    expect(out.error).toMatch(/not available in example-org\/hello/);
    expect(w.gh.calls.filter(isMutation)).toEqual([]);
  });
});

describe('spend classification in the gated families', () => {
  const gatedSpend = registry.tools.filter((t) => familyOf(t.name) && t.declarations?.spend);
  it('every money-capable tool in a gated family is spend, priced by a function, strict and always confirmed', () => {
    expect(gatedSpend.map((t) => t.name).sort()).toEqual(['github_copilot_add_seats', 'github_copilot_agent_task_start', 'github_copilot_assign_issue',
      'github_copilot_team_seats', 'github_hosted_runner_create', 'github_hosted_runner_scale_up', 'github_review_request_copilot']);
    for (const t of gatedSpend) {
      expect(t.priced, t.name).toBe(true);
      expect(t.declarations, t.name).toMatchObject({ spend: true, strictSpend: true, confirm: 'always' });
    }
  });
  it('a strict spend tool refuses an unworkable cost for the owner too; an ordinary spend tool keeps the owner path', async () => {
    const make = (strictSpend) => defineWrite({ name: strictSpend ? 'github_fixture_strict' : 'github_fixture_plain', description: 'fixture',
      declarations: { production: 'never', spend: true, strictSpend, confirm: 'always' }, target: () => ({ owner: 'example-org', scope: 'org' }),
      read: async () => ({}), price: () => { throw new Error('no price'); }, classify: () => ({}), summarize: () => 'Fixture change',
      apply: async () => ({ ok: true }), readAfter: async () => ({ ok: true }), verify: () => true, requestKey: () => 'rmcp_fixture_key' });
    const w = await makeWorld({ mode: 'production', profile: 'full' });
    const strict = parse(await make(true).handler({ confirm: true }, w.ctx));
    expect(strict).toMatchObject({ status: 'refused_by_guard', refusedBy: 'spend' });
    expect(strict.error).toMatch(/could not be worked out/);
    const plain = parse(await make(false).handler({ confirm: true }, w.ctx));
    expect(plain.status).toBe('applied');
    expect(() => defineWrite({ name: 'github_fixture_bad', description: 'x', declarations: { production: 'never', strictSpend: true }, target: () => ({}), read: async () => ({}),
      classify: () => ({}), summarize: () => 'x', apply: async () => ({}), readAfter: async () => ({}), verify: () => true, requestKey: () => 'rmcp_x' })).toThrow(/strictSpend applies only to a spend tool/);
  });
  it('a request for Copilot review now discloses its usage billing and asks first, the owner included', async () => {
    const w = await makeWorld({ mode: 'production', profile: 'full' });
    w.gh.when('GET /repos/{owner}/{repo}/pulls/{pull_number}').reply(200, { number: 4, state: 'open', node_id: 'PR_kwDOcopilot' });
    w.gh.when('POST /graphql').reply(200, { data: { node: { reviewRequests: { nodes: [] }, reviews: { nodes: [] } } } });
    const out = parse(await registry.handlers.github_review_request_copilot({ repo: 'hello', number: 4 }, w.ctx));
    expect(out).toMatchObject({ status: 'needs_confirmation' });
    expect(out.preview).toMatch(/COST UNKNOWN/);
    expect(w.gh.calls.filter(isMutation)).toEqual([]);
  });
});
