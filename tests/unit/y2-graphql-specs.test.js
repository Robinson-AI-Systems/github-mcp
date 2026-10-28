import { describe, expect, it } from 'vitest';
import { createDispatch } from '../../src/tools/dispatch.js';
import { registry } from '../../src/tools/index.js';
import { mergeNamespaces } from '../../src/core/registry.js';
import * as g from '../../src/tools/universal-graphql.js';
import * as undo from '../../src/tools/undo.js';
import { makeWorld, parse, runWriteContract } from '../../test/helpers/write-contract.js';
import { WRITE_SPECS, inverseDocument } from '../../src/github/graphql-writes.js';

const REPO = 'example-org/hello';
const oid = 'a'.repeat(40);
// One row per reviewed mutation: the input, what each ID resolves to, the primary node before and after.
const ROWS = [
  ['pinIssue', { issueId: 'I1' }, { I1: 'Issue' }, { isPinned: false }, { isPinned: true }],
  ['unpinIssue', { issueId: 'I1' }, { I1: 'Issue' }, { isPinned: true }, { isPinned: false }],
  ['pinIssueComment', { issueCommentId: 'IC1' }, { IC1: 'IssueComment' }, { isPinned: false }, { isPinned: true }],
  ['unpinIssueComment', { issueCommentId: 'IC1' }, { IC1: 'IssueComment' }, { isPinned: true }, { isPinned: false }],
  ['lockLockable', { lockableId: 'L1', lockReason: 'SPAM' }, { L1: 'Issue' }, { locked: false, activeLockReason: null }, { locked: true, activeLockReason: 'SPAM' }],
  ['unlockLockable', { lockableId: 'L1' }, { L1: 'PullRequest' }, { locked: true, activeLockReason: 'TOO_HEATED' }, { locked: false, activeLockReason: null }],
  ['minimizeComment', { subjectId: 'C1', classifier: 'OFF_TOPIC' }, { C1: 'IssueComment' }, { isMinimized: false, minimizedReason: null }, { isMinimized: true, minimizedReason: 'off-topic' }],
  ['unminimizeComment', { subjectId: 'C1' }, { C1: 'DiscussionComment' }, { isMinimized: true, minimizedReason: 'spam' }, { isMinimized: false, minimizedReason: null }],
  ['closeDiscussion', { discussionId: 'D1', reason: 'RESOLVED' }, { D1: 'Discussion' }, { closed: false, stateReason: null }, { closed: true, stateReason: 'RESOLVED' }],
  ['reopenDiscussion', { discussionId: 'D1' }, { D1: 'Discussion' }, { closed: true, stateReason: 'OUTDATED' }, { closed: false, stateReason: 'REOPENED' }],
  ['updateDiscussion', { discussionId: 'D1', title: 'New', categoryId: 'CAT1' }, { D1: 'Discussion', CAT1: 'DiscussionCategory' },
    { title: 'Old', body: 'b', category: { id: 'CAT0' } }, { title: 'New', body: 'b', category: { id: 'CAT1' } }],
  ['updateDiscussionComment', { commentId: 'DC1', body: 'new' }, { DC1: 'DiscussionComment' }, { body: 'old' }, { body: 'new' }],
  ['deleteDiscussion', { id: 'D1' }, { D1: 'Discussion' }, { title: 't' }, null],
  ['deleteDiscussionComment', { id: 'DC1' }, { DC1: 'DiscussionComment' }, { body: 't' }, null],
  ['markDiscussionCommentAsAnswer', { id: 'DC1' }, { DC1: 'DiscussionComment' }, { isAnswer: false }, { isAnswer: true }],
  ['unmarkDiscussionCommentAsAnswer', { id: 'DC1' }, { DC1: 'DiscussionComment' }, { isAnswer: true }, { isAnswer: false }],
  ['convertPullRequestToDraft', { pullRequestId: 'PR1' }, { PR1: 'PullRequest' }, { isDraft: false }, { isDraft: true }],
  ['markPullRequestReadyForReview', { pullRequestId: 'PR1' }, { PR1: 'PullRequest' }, { isDraft: true }, { isDraft: false }],
  ['createLinkedBranch', { issueId: 'I1', repositoryId: 'R1', oid, name: 'fix-1' }, { I1: 'Issue', R1: 'Repository' },
    { linkedBranches: { totalCount: 0, nodes: [] } }, { linkedBranches: { totalCount: 1, nodes: [{ id: 'LB1', ref: { name: 'fix-1' } }] } }],
  ['deleteLinkedBranch', { linkedBranchId: 'LB1' }, { LB1: 'LinkedBranch' }, { ref: { name: 'fix-1' } }, null],
  ['updateIssueComment', { id: 'IC1', body: 'new' }, { IC1: 'IssueComment' }, { body: 'old' }, { body: 'new' }],
  ['deleteIssueComment', { id: 'IC1' }, { IC1: 'IssueComment' }, { body: 'old' }, null],
  ['deleteIssue', { issueId: 'I1' }, { I1: 'Issue' }, { title: 'x', number: 4 }, null],
  ['updateTeamReviewAssignment', { id: 'T1', enabled: true, algorithm: 'ROUND_ROBIN' }, { T1: 'Team' },
    { reviewRequestDelegationEnabled: false, reviewRequestDelegationAlgorithm: null, reviewRequestDelegationMemberCount: null, reviewRequestDelegationNotifyTeam: false },
    // GitHub applies the schema defaults (member count 1, notify team on) when they are not given, so the read-back shows them.
    { reviewRequestDelegationEnabled: true, reviewRequestDelegationAlgorithm: 'ROUND_ROBIN', reviewRequestDelegationMemberCount: 1, reviewRequestDelegationNotifyTeam: true }],
  // GQL-1 group 1: Projects v2 children and flags (the project must be owned by the enrolled account)
  ['updateProjectV2View', { viewId: 'V1', name: 'Board', layout: 'BOARD_LAYOUT' }, { V1: 'ProjectV2View' },
    { name: 'Table', filter: null, layout: 'TABLE_LAYOUT', updatedAt: 't1' }, { name: 'Board', filter: null, layout: 'BOARD_LAYOUT', updatedAt: 't2' }],
  ['updateProjectV2StatusUpdate', { statusUpdateId: 'S1', status: 'AT_RISK', body: 'Late' }, { S1: 'ProjectV2StatusUpdate' },
    { body: 'On time', status: 'ON_TRACK', startDate: null, targetDate: null }, { body: 'Late', status: 'AT_RISK', startDate: null, targetDate: null }],
  ['deleteProjectV2StatusUpdate', { statusUpdateId: 'S1' }, { S1: 'ProjectV2StatusUpdate' }, { body: 'x', status: 'ON_TRACK' }, null],
  ['deleteProjectV2Workflow', { workflowId: 'W1' }, { W1: 'ProjectV2Workflow' }, { name: 'Auto-add', enabled: true }, null],
  ['markProjectV2AsTemplate', { projectId: 'PJ1' }, { PJ1: 'ProjectV2' }, { template: false }, { template: true }],
  ['unmarkProjectV2AsTemplate', { projectId: 'PJ1' }, { PJ1: 'ProjectV2' }, { template: true }, { template: false }],
  ['updateProjectV2DraftIssue', { draftIssueId: 'DI1', title: 'New' }, { DI1: 'DraftIssue' }, { title: 'Old', body: 'b' }, { title: 'New', body: 'b' }],
  // GQL-1 group 2: discussion votes, review edits, viewed files, closing references, duplicates
  ['addUpvote', { subjectId: 'D1' }, { D1: 'Discussion' }, { viewerHasUpvoted: false, upvoteCount: 0 }, { viewerHasUpvoted: true, upvoteCount: 1 }],
  ['removeUpvote', { subjectId: 'DC1' }, { DC1: 'DiscussionComment' }, { viewerHasUpvoted: true, upvoteCount: 1 }, { viewerHasUpvoted: false, upvoteCount: 0 }],
  ['addDiscussionPollVote', { pollOptionId: 'PO1' }, { PO1: 'DiscussionPollOption' }, { viewerHasVoted: false, totalVoteCount: 0 }, { viewerHasVoted: true, totalVoteCount: 1 }],
  ['updatePullRequestReview', { pullRequestReviewId: 'RV1', body: 'new' }, { RV1: 'PullRequestReview' }, { body: 'old' }, { body: 'new' }],
  ['deletePullRequestReview', { pullRequestReviewId: 'RV1' }, { RV1: 'PullRequestReview' }, { body: 'x', state: 'PENDING' }, null],
  ['markFileAsViewed', { pullRequestId: 'PR1', path: 'a.js' }, { PR1: 'PullRequest' },
    { files: { nodes: [{ path: 'a.js', viewerViewedState: 'UNVIEWED' }] } }, { files: { nodes: [{ path: 'a.js', viewerViewedState: 'VIEWED' }] } }],
  ['unmarkFileAsViewed', { pullRequestId: 'PR1', path: 'a.js' }, { PR1: 'PullRequest' },
    { files: { nodes: [{ path: 'a.js', viewerViewedState: 'VIEWED' }] } }, { files: { nodes: [{ path: 'a.js', viewerViewedState: 'UNVIEWED' }] } }],
  ['addCloseIssueReferences', { issueId: 'I1', pullRequestIds: ['PR1'] }, { I1: 'Issue', PR1: 'PullRequest' },
    { closedByPullRequestsReferences: { nodes: [] } }, { closedByPullRequestsReferences: { nodes: [{ id: 'PR1' }] } }],
  ['removeCloseIssueReferences', { issueId: 'I1', pullRequestIds: ['PR1'] }, { I1: 'Issue', PR1: 'PullRequest' },
    { closedByPullRequestsReferences: { nodes: [{ id: 'PR1' }] } }, { closedByPullRequestsReferences: { nodes: [] } }],
  ['unmarkIssueAsDuplicate', { duplicateId: 'I1', canonicalId: 'I2' }, { I1: 'Issue', I2: 'Issue' }, { duplicateOf: { id: 'I2' } }, { duplicateOf: null }],
  // GQL-1 group 3: topics and deployments
  ['updateTopics', { repositoryId: 'R1', topicNames: ['api', 'mcp'] }, { R1: 'Repository' },
    { repositoryTopics: { nodes: [{ topic: { name: 'old' } }] } }, { repositoryTopics: { nodes: [{ topic: { name: 'mcp' } }, { topic: { name: 'api' } }] } }],
  ['deleteDeployment', { id: 'DP1' }, { DP1: 'Deployment' }, { environment: 'staging' }, null]
];

const scopeNode = (id, type, repo = REPO) => {
  if (type === 'Team') return { __typename: type, id, slug: 'core', organization: { login: repo.split('/')[0] } };
  const ownerObj = { login: repo.split('/')[0] };
  if (type === 'ProjectV2') return { __typename: type, id, owner: ownerObj };
  if (['ProjectV2View', 'ProjectV2StatusUpdate', 'ProjectV2Workflow'].includes(type)) return { __typename: type, id, project: { id: 'PJ1', owner: ownerObj } };
  if (type === 'DraftIssue') return { __typename: type, id, projectsV2: { nodes: [{ id: 'PJ1', owner: ownerObj }] } };
  if (type === 'LinkedBranch') return { __typename: type, id, ref: { repository: { nameWithOwner: repo } } };
  if (type === 'Repository') return { __typename: type, id, nameWithOwner: repo };
  return { __typename: type, id, repository: { nameWithOwner: repo } };
};

/** A tiny GitHub GraphQL: scope reads, the spec read (current state), preflights and the mutation that flips the state. */
function server(gh, row, { ownedBy = REPO, pinned = 0, permission = 'ADMIN', mismatch = false, drift = null } = {}) {
  const [mutation, input, types, before, after] = row;
  const spec = WRITE_SPECS.get(mutation);
  const state = { current: before, sent: 0, reads: 0 };
  const primaryType = types[input[spec.primary]];
  gh.when('POST /graphql').reply(200, (req) => {
    const q = req.body?.query ?? '';
    const id = req.body?.variables?.id;
    if (q.includes('UniversalResourceScope')) return { data: { node: types[id] ? scopeNode(id, types[id], ownedBy) : null } };
    if (q.includes('UniversalSpecRead')) {
      state.reads += 1;
      if (drift && state.reads === 2) state.current = drift;
      return { data: { node: state.current === null ? null : { __typename: primaryType, id, ...state.current } } };
    }
    if (q.includes('PinnedIssueLimit')) return { data: { repository: { pinnedIssues: { totalCount: pinned } } } };
    if (q.includes('RepositoryAdminCheck')) return { data: { repository: { viewerPermission: permission } } };
    if (/^\s*mutation\b/.test(q)) {
      state.sent += 1;
      if (!mismatch) state.current = after;
      return { data: { [mutation]: { clientMutationId: null } } };
    }
    return { data: {} };
  });
  return state;
}
const argsFor = (row, extra = {}) => ({
  mutation: inverseDocument(row[0]), variables: { input: row[1] }, owner: 'example-org',
  ...(WRITE_SPECS.get(row[0]).scope === 'org' ? {} : { repo: 'hello' }), ...extra
});
const run = (w, name, args, reg = registry) => createDispatch({ env: w.ctx.env, credentials: w.credentials, gates: w.ctx.gates, fetch: w.gh.fetch, now: w.ctx.now, sleep: w.ctx.sleep })
  .call(null, { registry: reg, name, args, connection: w.connection, db: w.db }).then(parse);
const world = () => makeWorld({ profile: 'full', mode: 'production', advanceClockOnSleep: true });
const mutations = (gh) => gh.calls.filter((c) => /^\s*mutation\b/.test(c.body?.query ?? ''));

describe('Y-2 every reviewed mutation, end to end on the fake GitHub (WU-Y2b)', () => {
  it('has a fixture row for each spec', () => {
    expect(ROWS.map((r) => r[0]).sort()).toEqual([...WRITE_SPECS.keys()].sort());
  });
  for (const row of ROWS) {
    const [mutation] = row;
    describe(mutation, () => {
      it('previews, then applies once and confirms by an independent re-read', async () => {
        const w = await world();
        const state = server(w.gh, row);
        const preview = await run(w, 'github_graphql_write', argsFor(row, { dryRun: true }));
        expect(preview.status, JSON.stringify(preview)).toBe('preview');
        expect(mutations(w.gh)).toHaveLength(0);
        const done = await run(w, 'github_graphql_write', argsFor(row, { confirm: true }));
        expect(done.status, JSON.stringify(done)).toBe('applied');
        expect(done.confirmed).toBe(true);
        expect(state.sent).toBe(1);
        expect(w.gh.invalid).toEqual([]);
      });
      it('reports a write the read-back does not show as unconfirmed', async () => {
        const w = await world();
        server(w.gh, row, { mismatch: true });
        const done = await run(w, 'github_graphql_write', argsFor(row, { confirm: true }));
        expect(done.confirmed).not.toBe(true);
        expect(await w.db.getChange?.(1).then((c) => c?.inverse ?? null)).toBeNull(); // no undo is recorded for an unconfirmed change
      });
      it('refuses ids that belong to another account and sends nothing', async () => {
        const w = await world();
        const state = server(w.gh, row, { ownedBy: 'other-org/hello' });
        const done = await run(w, 'github_graphql_write', argsFor(row, { confirm: true }));
        expect(done.status).not.toBe('applied');
        expect(state.sent).toBe(0);
      });
    });
  }
});

describe('Y-2 spec guards', () => {
  const pin = ROWS[0];
  it('refuses to pin a fourth issue (GitHub allows 3) before sending', async () => {
    const w = await world();
    const state = server(w.gh, pin, { pinned: 3 });
    const out = await run(w, 'github_graphql_write', argsFor(pin, { confirm: true }));
    expect(out.status).not.toBe('applied');
    expect(state.sent).toBe(0);
    const preview = await run(w, 'github_graphql_write', argsFor(pin));
    expect(JSON.stringify(preview)).toMatch(/3 pinned issues|BLOCKED/);
  });
  it('refuses a no-op (already pinned) instead of pretending it changed something', async () => {
    const w = await world();
    const state = server(w.gh, [pin[0], pin[1], pin[2], { isPinned: true }, { isPinned: true }]);
    const out = await run(w, 'github_graphql_write', argsFor(pin, { confirm: true }));
    expect(out.status).not.toBe('applied');
    expect(state.sent).toBe(0);
  });
  it('refuses when the item changed between the preview read and the send', async () => {
    const w = await world();
    const state = server(w.gh, pin, { drift: { isPinned: true } });
    const out = await run(w, 'github_graphql_write', argsFor(pin, { confirm: true }));
    expect(out.status).not.toBe('applied');
    expect(JSON.stringify(out)).toMatch(/changed since the preview|rejected|refused/i);
    expect(state.sent).toBe(0);
  });
  it('deleteIssue needs repository admin rights', async () => {
    const del = ROWS.find((r) => r[0] === 'deleteIssue');
    const w = await world();
    const state = server(w.gh, del, { permission: 'WRITE' });
    const out = await run(w, 'github_graphql_write', argsFor(del, { confirm: true }));
    expect(out.status).not.toBe('applied');
    expect(state.sent).toBe(0);
    const ok = await world();
    const okState = server(ok.gh, del);
    const done = await run(ok, 'github_graphql_write', argsFor(del, { confirm: true }));
    expect(done).toMatchObject({ status: 'applied', confirmed: true });
    expect(okState.sent).toBe(1);
    expect((await ok.db.getChange(1)).inverse).toBeNull();
  });
  it('an id of the wrong type is refused (a comment id where an issue is expected)', async () => {
    const w = await world();
    const state = server(w.gh, [pin[0], pin[1], { I1: 'IssueComment' }, pin[3], pin[4]]);
    const out = await run(w, 'github_graphql_write', argsFor(pin, { confirm: true }));
    expect(out.status).not.toBe('applied');
    expect(state.sent).toBe(0);
  });
  it('refuses an input key outside the reviewed spec and a mutation with no spec', async () => {
    const w = await world();
    server(w.gh, pin);
    const extra = await run(w, 'github_graphql_write', { ...argsFor(pin), variables: { input: { issueId: 'I1', clientMutationId: 'a', unknownThing: 1 } }, confirm: true }).catch((e) => ({ status: 'error', error: String(e) }));
    expect(extra.status).not.toBe('applied');
    const none = await run(w, 'github_graphql_write', {
      mutation: 'mutation A($input: AddAssigneesToAssignableInput!){ addAssigneesToAssignable(input:$input){ clientMutationId } }',
      variables: { input: { assignableId: 'I1', assigneeIds: ['U1'] } }, owner: 'example-org', repo: 'hello', confirm: true
    }).catch(() => ({ status: 'error' }));
    expect(none.status).not.toBe('applied');
    expect(mutations(w.gh)).toHaveLength(0);
  });
  it('the organization-level spec takes no repository', async () => {
    const team = ROWS.find((r) => r[0] === 'updateTeamReviewAssignment');
    const w = await world();
    server(w.gh, team);
    const out = await run(w, 'github_graphql_write', { ...argsFor(team, { confirm: true }), repo: 'hello' });
    expect(out.status).not.toBe('applied');
  });
});

describe('Y-2 undo (WU-Y2c)', () => {
  const reg = mergeNamespaces([undo, g]);
  it('pin, then undo, leaves the issue unpinned', async () => {
    const pin = ROWS[0];
    const w = await world();
    const state = server(w.gh, pin);
    const done = await run(w, 'github_graphql_write', argsFor(pin, { confirm: true }), reg);
    expect(done).toMatchObject({ status: 'applied', confirmed: true });
    expect(state.current).toEqual({ isPinned: true });
    const change = await w.db.getChange(1);
    expect(change.inverse).toMatchObject({ tool: 'github_graphql_write', args: { owner: 'example-org', repo: 'hello' } });
    expect(change.inverse.args.mutation).toContain('unpinIssue(input: $input)');
    // The fake now plays the opposite: unpin flips the state back.
    const unpin = ROWS[1];
    server(w.gh, [unpin[0], unpin[1], unpin[2], { isPinned: true }, { isPinned: false }]);
    const undone = await run(w, 'github_undo_change', { changeId: 1, confirm: true }, reg);
    expect(undone, JSON.stringify(undone)).toMatchObject({ status: 'applied', confirmed: true, undoing: { changeId: 1, runs: 'github_graphql_write' } });
    expect(mutations(w.gh).map((c) => c.body.query).join('\n')).toContain('unpinIssue');
  });
  it('a delete records no opposite and tells the caller what to do instead', async () => {
    const del = ROWS.find((r) => r[0] === 'deleteDiscussionComment');
    const w = await world();
    server(w.gh, del);
    const done = await run(w, 'github_graphql_write', argsFor(del, { confirm: true }), reg);
    expect(done.confirmed).toBe(true);
    expect(JSON.stringify(done)).toMatch(/cannot be restored/);
    expect((await w.db.getChange(1)).inverse).toBeNull();
    const refused = await run(w, 'github_undo_change', { changeId: 1, confirm: true }, reg);
    expect(refused.status).toBe('refused');
  });
});

// The three-door write contract for one spec-driven mutation (handler, MCP dispatch, github_call).
const pinRow = ROWS[0];
runWriteContract({
  label: 'Y-2 pinIssue through github_graphql_write',
  definition: { tool: g.tools[1], handler: g.handlers.github_graphql_write },
  args: argsFor(pinRow), profile: 'full', production: true, needsConfirm: true, accessWidening: true,
  notifies: ['example-org'], advanceClockOnSleep: true,
  arrange: (gh, outcome) => { server(gh, pinRow, { mismatch: outcome !== 'ok' }); }
});
