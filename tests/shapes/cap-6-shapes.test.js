// CAP-6 request shapes: every REST request and GraphQL document the feature gates and the new tools send goes through
// the real scoped Octokit to the fake GitHub, which validates it against the vendored OpenAPI description and GraphQL
// schema (a document with an unknown field, argument or type is recorded in `invalid`).
import { beforeEach, describe, expect, it } from 'vitest';
import { createDispatch } from '../../src/tools/dispatch.js';
import { registry } from '../../src/tools/index.js';
import { clearFeatureCache, decideAccount } from '../../src/github/feature-gates.js';
import { makeWorld, parse } from '../../test/helpers/write-contract.js';

const HEAD = 'c'.repeat(40);
const run = (w, name, args) => createDispatch({ credentials: w.credentials, fetch: w.gh.fetch, now: w.ctx.now, gates: w.ctx.gates, featureGates: true })
  .call(null, { registry, name, args, connection: w.connection, db: w.db });
const mutation = (q) => /^\s*mutation/.test(String(q ?? ''));
beforeEach(() => clearFeatureCache());

function arrange(gh) {
  let queued = false; let assigned = false;
  gh.when('GET /orgs/{org}/actions/runners').reply(200, { total_count: 0, runners: [] });
  gh.when('GET /orgs/{org}/actions/hosted-runners').reply(200, { total_count: 0, runners: [] });
  gh.when('GET /orgs/{org}/copilot/billing').reply(200, { plan_type: 'business', seat_breakdown: { total: 1 } });
  gh.when('POST /graphql').reply(200, (req) => {
    const q = String(req.body.query);
    if (q.includes('organization(login')) return { data: { organization: { repositories: { nodes: [{ name: 'hello', mergeQueue: { id: 'MQ_1' } }] } } } };
    if (q.includes('enqueuePullRequest')) { queued = true; return { data: { enqueuePullRequest: { mergeQueueEntry: { id: 'MQE', position: 1, state: 'QUEUED' } } } }; }
    if (q.includes('dequeuePullRequest')) { queued = false; return { data: { dequeuePullRequest: { mergeQueueEntry: { id: 'MQE', state: 'UNMERGEABLE' } } } }; }
    if (q.includes('addAssigneesToAssignable')) { assigned = true; return { data: { addAssigneesToAssignable: { assignable: { id: 'I_1' } } } }; }
    if (q.includes('mergeQueue(branch')) return { data: { repository: { nameWithOwner: 'example-org/hello', defaultBranchRef: { name: 'main' }, mergeQueue: { id: 'MQ_1', url: 'https://github.com/x', nextEntryEstimatedTimeToMerge: null, configuration: null, entries: { totalCount: 0, nodes: [] } } } } };
    if (q.includes('pullRequest(number')) return { data: { repository: { pullRequest: { id: 'PR_1', number: 3, state: 'OPEN', isDraft: false, headRefOid: HEAD, baseRefName: 'main', isMergeQueueEnabled: true, isInMergeQueue: queued, mergeQueueEntry: queued ? { id: 'MQE', position: 1, state: 'QUEUED' } : null } } } };
    if (q.includes('suggestedActors') && q.includes('issue(number')) return { data: { repository: { id: 'R_1', nameWithOwner: 'example-org/hello', suggestedActors: { nodes: [{ __typename: 'Bot', login: 'copilot-swe-agent', id: 'BOT_1' }] },
      issue: { id: 'I_1', number: 3, state: 'OPEN', title: 'T', assignedActors: { nodes: assigned ? [{ __typename: 'Bot', login: 'copilot-swe-agent' }] : [] } } } } };
    return { data: null };
  });
}

describe('CAP-6 shapes against the pinned schemas', () => {
  it('organization probes, merge-queue read/enqueue/dequeue and the Copilot assignment are all schema-valid', async () => {
    const w = await makeWorld({ mode: 'production', profile: 'full' });
    arrange(w.gh);
    const decision = await decideAccount(w.ctx, 'example-org');
    expect(Object.values(decision.families).map((f) => f.state)).toEqual(['on', 'on', 'on', 'on']);
    expect(parse(await run(w, 'github_merge_queue_get', { repo: 'hello', branch: 'main', max: 5 })).enabled).toBe(true);
    expect(parse(await run(w, 'github_merge_queue_enqueue', { repo: 'hello', number: 3, expectedHeadSha: HEAD })).status).toBe('applied');
    expect(parse(await run(w, 'github_merge_queue_dequeue', { repo: 'hello', number: 3 })).status).toBe('applied');
    expect(parse(await run(w, 'github_copilot_assign_issue', { repo: 'hello', number: 3, baseRef: 'main', instructions: 'Small change.', confirm: true })).status).toBe('applied');
    expect(w.gh.unmatched).toEqual([]);
    expect(w.gh.invalid).toEqual([]);
    expect(w.gh.graphql.filter((g) => mutation(g.query)).map((g) => /(\w+)\(input/.exec(g.query)[1])).toEqual(['enqueuePullRequest', 'dequeuePullRequest', 'addAssigneesToAssignable']);
  });
  it('the personal-account Copilot probe is schema-valid', async () => {
    const w = await makeWorld({ packageUser: true });
    w.gh.when('POST /graphql').reply(200, { data: { user: { repositories: { nodes: [] } } } });
    expect((await decideAccount(w.ctx, 'example-org')).families.copilot.state).toBe('off');
    expect(w.gh.graphql.length).toBe(1);
    expect(w.gh.invalid).toEqual([]);
  });
});
