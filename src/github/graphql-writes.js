// Y-2: spec-driven GraphQL writes. One reviewed entry per mutation says how ownership is proven, what the "before"
// and "after" read looks like, how to tell the change really happened, and what the opposite is. A mutation without
// an entry stays refused by `github_graphql_write` ("use the specialised tool"), exactly as in U-2.
//
// Pure data and pure functions only: nothing here talks to GitHub. `src/tools/universal-graphql.js` runs the reads.
//
// WriteSpec fields:
//   scope      'repo' (every id must resolve into owner/repo) or 'org' (ids must resolve into the enrolled organization)
//   primary    input key holding the node that is read before and after
//   ids        input key -> node types that key may resolve to. Any other ID-typed key is refused.
//   changes    non-ID input keys that are real changes; every key not listed here, in `ids` or `clientMutationId` is refused
//   before     GraphQL selection run on the primary node ("... on Issue { isPinned }"), before and after the write
//   already    (input, before) => true when the node is already in the requested state (nothing to do: refused)
//   verify     (input, after, before) => true only if `after` shows the requested change. For deletes `after` is null.
//   deleted    true when success means the node no longer exists
//   inverse    null, or (input, before, after) => { mutation, input } that restores the previous state
//   preflight  optional name of an extra read-only check implemented by the caller ('pinned-issue-limit', 'repo-admin')
//   cls        { accessWidening, notifies, destructive } — the reviewed marks, recorded for the owner's review. They can only
//              make a write MORE cautious (`destructive`); the generic "access + notifies" marks are never lowered by a
//              spec (Batch Y decision Y4: a lowering needs an owner decision and a DECISIONS entry).
//   undoHint   plain-English opposite for changes with no inverse
const norm = (text) => String(text ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const MINIMIZE_CLASSIFIERS = ['ABUSE', 'OFF_TOPIC', 'OUTDATED', 'RESOLVED', 'DUPLICATE', 'SPAM'];
const classifierFor = (reason) => MINIMIZE_CLASSIFIERS.find((c) => norm(c) === norm(reason)) ?? null;
const CLOSE_REASONS = ['RESOLVED', 'OUTDATED', 'DUPLICATE'];
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const given = (input, key) => Object.hasOwn(input, key) && input[key] !== undefined;

const COMMENT_TYPES = ['IssueComment', 'DiscussionComment', 'PullRequestReviewComment', 'CommitComment'];
const quiet = Object.freeze({ accessWidening: false, notifies: false, destructive: false });
const notifying = Object.freeze({ accessWidening: false, notifies: true, destructive: false });
const destructive = Object.freeze({ accessWidening: false, notifies: false, destructive: true });

const closingIds = (node) => new Set((node?.closedByPullRequestsReferences?.nodes ?? []).map((n) => n?.id));
const topicsOf = (node) => (node?.repositoryTopics?.nodes ?? []).map((n) => n?.topic?.name).filter(Boolean).sort();
const restorable = (input, before, keys) => keys.some((k) => given(input, k)) && keys.every((k) => !given(input, k) || before?.[k] != null);
const priorOf = (input, before, keys) => Object.fromEntries(keys.filter((k) => given(input, k)).map((k) => [k, before[k]]));

/** @type {Map<string, object>} */
export const WRITE_SPECS = new Map([
  ['pinIssue', {
    scope: 'repo', primary: 'issueId', ids: { issueId: ['Issue'] }, changes: [], before: '... on Issue { isPinned }',
    already: (_i, b) => b?.isPinned === true, verify: (_i, a) => a?.isPinned === true, preflight: 'pinned-issue-limit',
    inverse: (i) => ({ mutation: 'unpinIssue', input: { issueId: i.issueId } }), cls: quiet
  }],
  ['unpinIssue', {
    scope: 'repo', primary: 'issueId', ids: { issueId: ['Issue'] }, changes: [], before: '... on Issue { isPinned }',
    already: (_i, b) => b?.isPinned !== true, verify: (_i, a) => a?.isPinned === false,
    inverse: (i) => ({ mutation: 'pinIssue', input: { issueId: i.issueId } }), cls: quiet
  }],
  ['pinIssueComment', {
    scope: 'repo', primary: 'issueCommentId', ids: { issueCommentId: ['IssueComment'] }, changes: [], before: '... on IssueComment { isPinned }',
    already: (_i, b) => b?.isPinned === true, verify: (_i, a) => a?.isPinned === true,
    inverse: (i) => ({ mutation: 'unpinIssueComment', input: { issueCommentId: i.issueCommentId } }), cls: quiet
  }],
  ['unpinIssueComment', {
    scope: 'repo', primary: 'issueCommentId', ids: { issueCommentId: ['IssueComment'] }, changes: [], before: '... on IssueComment { isPinned }',
    already: (_i, b) => b?.isPinned !== true, verify: (_i, a) => a?.isPinned === false,
    inverse: (i) => ({ mutation: 'pinIssueComment', input: { issueCommentId: i.issueCommentId } }), cls: quiet
  }],
  ['lockLockable', {
    scope: 'repo', primary: 'lockableId', ids: { lockableId: ['Issue', 'PullRequest', 'Discussion'] }, changes: ['lockReason'],
    before: '... on Lockable { locked activeLockReason }',
    already: (i, b) => b?.locked === true && (!given(i, 'lockReason') || b.activeLockReason === i.lockReason),
    verify: (i, a) => a?.locked === true && (!given(i, 'lockReason') || a.activeLockReason === i.lockReason),
    inverse: (i) => ({ mutation: 'unlockLockable', input: { lockableId: i.lockableId } }), cls: quiet
  }],
  ['unlockLockable', {
    scope: 'repo', primary: 'lockableId', ids: { lockableId: ['Issue', 'PullRequest', 'Discussion'] }, changes: [],
    before: '... on Lockable { locked activeLockReason }',
    already: (_i, b) => b?.locked !== true, verify: (_i, a) => a?.locked === false,
    inverse: (i, b) => ({ mutation: 'lockLockable', input: { lockableId: i.lockableId, ...(b?.activeLockReason ? { lockReason: b.activeLockReason } : {}) } }),
    cls: quiet
  }],
  ['minimizeComment', {
    scope: 'repo', primary: 'subjectId', ids: { subjectId: COMMENT_TYPES }, changes: ['classifier'],
    before: '... on Minimizable { isMinimized minimizedReason }',
    already: (_i, b) => b?.isMinimized === true,
    verify: (i, a) => a?.isMinimized === true && (a.minimizedReason == null || norm(a.minimizedReason) === norm(i.classifier)),
    inverse: (i) => ({ mutation: 'unminimizeComment', input: { subjectId: i.subjectId } }), cls: quiet
  }],
  ['unminimizeComment', {
    scope: 'repo', primary: 'subjectId', ids: { subjectId: COMMENT_TYPES }, changes: [],
    before: '... on Minimizable { isMinimized minimizedReason }',
    already: (_i, b) => b?.isMinimized !== true, verify: (_i, a) => a?.isMinimized === false,
    inverse: (i, b) => (classifierFor(b?.minimizedReason)
      ? { mutation: 'minimizeComment', input: { subjectId: i.subjectId, classifier: classifierFor(b.minimizedReason) } } : null),
    cls: quiet
  }],
  ['closeDiscussion', {
    scope: 'repo', primary: 'discussionId', ids: { discussionId: ['Discussion'] }, changes: ['reason'], before: '... on Discussion { closed stateReason }',
    already: (_i, b) => b?.closed === true, verify: (i, a) => a?.closed === true && (!given(i, 'reason') || a.stateReason === i.reason),
    inverse: (i) => ({ mutation: 'reopenDiscussion', input: { discussionId: i.discussionId } }), cls: quiet
  }],
  ['reopenDiscussion', {
    scope: 'repo', primary: 'discussionId', ids: { discussionId: ['Discussion'] }, changes: [], before: '... on Discussion { closed stateReason }',
    already: (_i, b) => b?.closed !== true, verify: (_i, a) => a?.closed === false,
    inverse: (i, b) => ({ mutation: 'closeDiscussion', input: { discussionId: i.discussionId, ...(CLOSE_REASONS.includes(b?.stateReason) ? { reason: b.stateReason } : {}) } }),
    cls: quiet
  }],
  ['updateDiscussion', {
    scope: 'repo', primary: 'discussionId', ids: { discussionId: ['Discussion'], categoryId: ['DiscussionCategory'] },
    changes: ['title', 'body', 'categoryId'], before: '... on Discussion { title body category { id } }',
    already: (i, b) => ['title', 'body'].every((k) => !given(i, k) || b?.[k] === i[k]) && (!given(i, 'categoryId') || b?.category?.id === i.categoryId),
    verify: (i, a) => ['title', 'body'].every((k) => !given(i, k) || a?.[k] === i[k]) && (!given(i, 'categoryId') || a?.category?.id === i.categoryId),
    inverse: (i, b) => ({ mutation: 'updateDiscussion', input: { discussionId: i.discussionId,
      ...(given(i, 'title') ? { title: b?.title } : {}), ...(given(i, 'body') ? { body: b?.body } : {}),
      ...(given(i, 'categoryId') ? { categoryId: b?.category?.id } : {}) } }), cls: notifying
  }],
  ['updateDiscussionComment', {
    scope: 'repo', primary: 'commentId', ids: { commentId: ['DiscussionComment'] }, changes: ['body'], before: '... on DiscussionComment { body }',
    already: (i, b) => b?.body === i.body, verify: (i, a) => a?.body === i.body,
    inverse: (i, b) => ({ mutation: 'updateDiscussionComment', input: { commentId: i.commentId, body: b?.body } }), cls: notifying
  }],
  ['deleteDiscussion', {
    scope: 'repo', primary: 'id', ids: { id: ['Discussion'] }, changes: [], before: '... on Discussion { title }', deleted: true,
    verify: (_i, a) => a === null, inverse: null, cls: destructive,
    undoHint: 'A deleted discussion cannot be restored. Create a new discussion with github_discussion_create.'
  }],
  ['deleteDiscussionComment', {
    scope: 'repo', primary: 'id', ids: { id: ['DiscussionComment'] }, changes: [], before: '... on DiscussionComment { body }', deleted: true,
    verify: (_i, a) => a === null, inverse: null, cls: destructive,
    undoHint: 'A deleted discussion comment cannot be restored. Post the comment again with github_discussion_comment.'
  }],
  ['markDiscussionCommentAsAnswer', {
    scope: 'repo', primary: 'id', ids: { id: ['DiscussionComment'] }, changes: [], before: '... on DiscussionComment { isAnswer }',
    already: (_i, b) => b?.isAnswer === true, verify: (_i, a) => a?.isAnswer === true,
    inverse: (i) => ({ mutation: 'unmarkDiscussionCommentAsAnswer', input: { id: i.id } }), cls: quiet
  }],
  ['unmarkDiscussionCommentAsAnswer', {
    scope: 'repo', primary: 'id', ids: { id: ['DiscussionComment'] }, changes: [], before: '... on DiscussionComment { isAnswer }',
    already: (_i, b) => b?.isAnswer !== true, verify: (_i, a) => a?.isAnswer === false,
    inverse: (i) => ({ mutation: 'markDiscussionCommentAsAnswer', input: { id: i.id } }), cls: quiet
  }],
  ['convertPullRequestToDraft', {
    scope: 'repo', primary: 'pullRequestId', ids: { pullRequestId: ['PullRequest'] }, changes: [], before: '... on PullRequest { isDraft }',
    already: (_i, b) => b?.isDraft === true, verify: (_i, a) => a?.isDraft === true,
    inverse: (i) => ({ mutation: 'markPullRequestReadyForReview', input: { pullRequestId: i.pullRequestId } }), cls: quiet
  }],
  ['markPullRequestReadyForReview', {
    scope: 'repo', primary: 'pullRequestId', ids: { pullRequestId: ['PullRequest'] }, changes: [], before: '... on PullRequest { isDraft }',
    already: (_i, b) => b?.isDraft === false, verify: (_i, a) => a?.isDraft === false,
    inverse: (i) => ({ mutation: 'convertPullRequestToDraft', input: { pullRequestId: i.pullRequestId } }), cls: notifying
  }],
  ['createLinkedBranch', {
    scope: 'repo', primary: 'issueId', ids: { issueId: ['Issue'], repositoryId: ['Repository'] }, changes: ['name', 'oid'],
    before: '... on Issue { linkedBranches(first: 50) { totalCount nodes { id ref { name } } } }',
    already: (i, b) => given(i, 'name') && (b?.linkedBranches?.nodes ?? []).some((n) => n?.ref?.name === i.name),
    verify: (i, a, b) => {
      const was = new Set((b?.linkedBranches?.nodes ?? []).map((n) => n?.id));
      const added = (a?.linkedBranches?.nodes ?? []).filter((n) => n?.id && !was.has(n.id));
      return added.length === 1 && (!given(i, 'name') || added[0].ref?.name === i.name);
    },
    inverse: (_i, b, a) => {
      const was = new Set((b?.linkedBranches?.nodes ?? []).map((n) => n?.id));
      const added = (a?.linkedBranches?.nodes ?? []).filter((n) => n?.id && !was.has(n.id));
      return added.length === 1 ? { mutation: 'deleteLinkedBranch', input: { linkedBranchId: added[0].id } } : null;
    }, cls: quiet
  }],
  ['deleteLinkedBranch', {
    scope: 'repo', primary: 'linkedBranchId', ids: { linkedBranchId: ['LinkedBranch'] }, changes: [], before: '... on LinkedBranch { ref { name } }', deleted: true,
    verify: (_i, a) => a === null, inverse: null, cls: quiet,
    undoHint: 'Link the branch to the issue again with github_graphql_write createLinkedBranch (the branch itself is not deleted).'
  }],
  ['updateIssueComment', {
    scope: 'repo', primary: 'id', ids: { id: ['IssueComment'] }, changes: ['body'], before: '... on IssueComment { body }',
    already: (i, b) => b?.body === i.body, verify: (i, a) => a?.body === i.body,
    inverse: (i, b) => ({ mutation: 'updateIssueComment', input: { id: i.id, body: b?.body } }), cls: notifying
  }],
  ['deleteIssueComment', {
    scope: 'repo', primary: 'id', ids: { id: ['IssueComment'] }, changes: [], before: '... on IssueComment { body }', deleted: true,
    verify: (_i, a) => a === null, inverse: null, cls: destructive,
    undoHint: 'A deleted comment cannot be restored. Post it again with github_issue_comment.'
  }],
  ['deleteIssue', {
    scope: 'repo', primary: 'issueId', ids: { issueId: ['Issue'] }, changes: [], before: '... on Issue { title number }', deleted: true,
    preflight: 'repo-admin', verify: (_i, a) => a === null, inverse: null, cls: destructive,
    undoHint: 'A deleted issue cannot be restored. Open a new issue with github_issue_create.'
  }],
  ['updateTeamReviewAssignment', {
    scope: 'org', primary: 'id', ids: { id: ['Team'] }, changes: ['enabled', 'algorithm', 'teamMemberCount', 'notifyTeam'],
    before: '... on Team { reviewRequestDelegationEnabled reviewRequestDelegationAlgorithm reviewRequestDelegationMemberCount reviewRequestDelegationNotifyTeam }',
    already: (i, b) => b?.reviewRequestDelegationEnabled === i.enabled && (!given(i, 'algorithm') || b.reviewRequestDelegationAlgorithm === i.algorithm)
      && (!given(i, 'teamMemberCount') || b.reviewRequestDelegationMemberCount === i.teamMemberCount)
      && (!given(i, 'notifyTeam') || b.reviewRequestDelegationNotifyTeam === i.notifyTeam),
    verify: (i, a) => a?.reviewRequestDelegationEnabled === i.enabled && (!given(i, 'algorithm') || a.reviewRequestDelegationAlgorithm === i.algorithm)
      && (!given(i, 'teamMemberCount') || a.reviewRequestDelegationMemberCount === i.teamMemberCount)
      && (!given(i, 'notifyTeam') || a.reviewRequestDelegationNotifyTeam === i.notifyTeam),
    inverse: (i, b) => ({ mutation: 'updateTeamReviewAssignment', input: { id: i.id, enabled: b?.reviewRequestDelegationEnabled === true,
      ...(given(i, 'algorithm') && b?.reviewRequestDelegationAlgorithm ? { algorithm: b.reviewRequestDelegationAlgorithm } : {}),
      ...(given(i, 'teamMemberCount') && b?.reviewRequestDelegationMemberCount != null ? { teamMemberCount: b.reviewRequestDelegationMemberCount } : {}),
      ...(given(i, 'notifyTeam') && b?.reviewRequestDelegationNotifyTeam != null ? { notifyTeam: b.reviewRequestDelegationNotifyTeam } : {}) } }),
    cls: quiet
  }],
  // GQL-1 group 1: Projects v2 children and flags with no dedicated tool. Ownership: the project must belong to the enrolled account.
  ['updateProjectV2View', {
    scope: 'org', primary: 'viewId', ids: { viewId: ['ProjectV2View'] }, changes: ['name', 'filter', 'layout'],
    before: '... on ProjectV2View { name filter layout }',
    already: (i, b) => ['name', 'filter', 'layout'].every((k) => !given(i, k) || b?.[k] === i[k]),
    verify: (i, a) => ['name', 'filter', 'layout'].every((k) => !given(i, k) || a?.[k] === i[k]),
    // A value that was empty before cannot be put back (GitHub reads an empty input as "no change"), so there is no automatic undo then.
    inverse: (i, b) => restorable(i, b, ['name', 'filter', 'layout']) ? { mutation: 'updateProjectV2View', input: { viewId: i.viewId, ...priorOf(i, b, ['name', 'filter', 'layout']) } } : null,
    cls: quiet, undoHint: 'The earlier value was empty, so it cannot be restored automatically. Set the view again on github.com. (Which columns a view shows is not changed here.)'
  }],
  ['updateProjectV2StatusUpdate', {
    scope: 'org', primary: 'statusUpdateId', ids: { statusUpdateId: ['ProjectV2StatusUpdate'] }, changes: ['body', 'status', 'startDate', 'targetDate'],
    before: '... on ProjectV2StatusUpdate { body status startDate targetDate }',
    already: (i, b) => ['body', 'status', 'startDate', 'targetDate'].every((k) => !given(i, k) || b?.[k] === i[k]),
    verify: (i, a) => ['body', 'status', 'startDate', 'targetDate'].every((k) => !given(i, k) || a?.[k] === i[k]),
    inverse: (i, b) => restorable(i, b, ['body', 'status', 'startDate', 'targetDate'])
      ? { mutation: 'updateProjectV2StatusUpdate', input: { statusUpdateId: i.statusUpdateId, ...priorOf(i, b, ['body', 'status', 'startDate', 'targetDate']) } } : null,
    cls: notifying, undoHint: 'A value that was empty before cannot be put back automatically. Edit the status update again.'
  }],
  ['deleteProjectV2StatusUpdate', {
    scope: 'org', primary: 'statusUpdateId', ids: { statusUpdateId: ['ProjectV2StatusUpdate'] }, changes: [],
    before: '... on ProjectV2StatusUpdate { body status }', deleted: true, verify: (_i, a) => a === null, inverse: null, cls: destructive,
    undoHint: 'A deleted project status update cannot be restored. Post it again with github_project_status_update.'
  }],
  ['deleteProjectV2Workflow', {
    scope: 'org', primary: 'workflowId', ids: { workflowId: ['ProjectV2Workflow'] }, changes: [],
    before: '... on ProjectV2Workflow { name enabled }', deleted: true, verify: (_i, a) => a === null, inverse: null, cls: destructive,
    undoHint: 'A deleted project automation cannot be restored. Create it again in the project settings on github.com.'
  }],
  ['markProjectV2AsTemplate', {
    scope: 'org', primary: 'projectId', ids: { projectId: ['ProjectV2'] }, changes: [], before: '... on ProjectV2 { template }',
    already: (_i, b) => b?.template === true, verify: (_i, a) => a?.template === true,
    inverse: (i) => ({ mutation: 'unmarkProjectV2AsTemplate', input: { projectId: i.projectId } }), cls: quiet
  }],
  ['unmarkProjectV2AsTemplate', {
    scope: 'org', primary: 'projectId', ids: { projectId: ['ProjectV2'] }, changes: [], before: '... on ProjectV2 { template }',
    already: (_i, b) => b?.template !== true, verify: (_i, a) => a?.template === false,
    inverse: (i) => ({ mutation: 'markProjectV2AsTemplate', input: { projectId: i.projectId } }), cls: quiet
  }],
  ['updateProjectV2DraftIssue', {
    scope: 'org', primary: 'draftIssueId', ids: { draftIssueId: ['DraftIssue'] }, changes: ['title', 'body'],
    before: '... on DraftIssue { title body }',
    already: (i, b) => ['title', 'body'].every((k) => !given(i, k) || b?.[k] === i[k]),
    verify: (i, a) => ['title', 'body'].every((k) => !given(i, k) || a?.[k] === i[k]),
    inverse: (i, b) => restorable(i, b, ['title', 'body'])
      ? { mutation: 'updateProjectV2DraftIssue', input: { draftIssueId: i.draftIssueId, ...priorOf(i, b, ['title', 'body']) } } : null,
    cls: quiet
  }],
  // GQL-1 group 2: discussion votes, review edits, viewed files, closing references, duplicates.
  ['addUpvote', {
    scope: 'repo', primary: 'subjectId', ids: { subjectId: ['Discussion', 'DiscussionComment'] }, changes: [],
    before: '... on Votable { viewerHasUpvoted upvoteCount }',
    already: (_i, b) => b?.viewerHasUpvoted === true, verify: (_i, a) => a?.viewerHasUpvoted === true,
    inverse: (i) => ({ mutation: 'removeUpvote', input: { subjectId: i.subjectId } }), cls: quiet
  }],
  ['removeUpvote', {
    scope: 'repo', primary: 'subjectId', ids: { subjectId: ['Discussion', 'DiscussionComment'] }, changes: [],
    before: '... on Votable { viewerHasUpvoted upvoteCount }',
    already: (_i, b) => b?.viewerHasUpvoted !== true, verify: (_i, a) => a?.viewerHasUpvoted === false,
    inverse: (i) => ({ mutation: 'addUpvote', input: { subjectId: i.subjectId } }), cls: quiet
  }],
  ['addDiscussionPollVote', {
    scope: 'repo', primary: 'pollOptionId', ids: { pollOptionId: ['DiscussionPollOption'] }, changes: [],
    before: '... on DiscussionPollOption { viewerHasVoted totalVoteCount }',
    already: (_i, b) => b?.viewerHasVoted === true, verify: (_i, a) => a?.viewerHasVoted === true, inverse: null, cls: quiet,
    undoHint: 'GitHub has no way to take back a poll vote through the API. Change the vote on github.com.'
  }],
  ['updatePullRequestReview', {
    scope: 'repo', primary: 'pullRequestReviewId', ids: { pullRequestReviewId: ['PullRequestReview'] }, changes: ['body'],
    before: '... on PullRequestReview { body }', already: (i, b) => b?.body === i.body, verify: (i, a) => a?.body === i.body,
    inverse: (i, b) => ({ mutation: 'updatePullRequestReview', input: { pullRequestReviewId: i.pullRequestReviewId, body: b?.body ?? '' } }), cls: notifying
  }],
  ['deletePullRequestReview', {
    scope: 'repo', primary: 'pullRequestReviewId', ids: { pullRequestReviewId: ['PullRequestReview'] }, changes: [],
    before: '... on PullRequestReview { body state }', deleted: true, verify: (_i, a) => a === null, inverse: null, cls: destructive,
    undoHint: 'A deleted pending review cannot be restored. Write it again with github_review_create.'
  }],
  ['markFileAsViewed', {
    scope: 'repo', primary: 'pullRequestId', ids: { pullRequestId: ['PullRequest'] }, changes: ['path'],
    before: '... on PullRequest { files(first: 100) { nodes { path viewerViewedState } } }',
    already: (i, b) => (b?.files?.nodes ?? []).find((f) => f?.path === i.path)?.viewerViewedState === 'VIEWED',
    verify: (i, a) => (a?.files?.nodes ?? []).find((f) => f?.path === i.path)?.viewerViewedState === 'VIEWED',
    inverse: (i) => ({ mutation: 'unmarkFileAsViewed', input: { pullRequestId: i.pullRequestId, path: i.path } }), cls: quiet
  }],
  ['unmarkFileAsViewed', {
    scope: 'repo', primary: 'pullRequestId', ids: { pullRequestId: ['PullRequest'] }, changes: ['path'],
    before: '... on PullRequest { files(first: 100) { nodes { path viewerViewedState } } }',
    // A file missing from the first 100 is unknown (large pull request), never "already unviewed".
    already: (i, b) => { const f = (b?.files?.nodes ?? []).find((x) => x?.path === i.path); return Boolean(f) && f.viewerViewedState !== 'VIEWED'; },
    verify: (i, a) => { const f = (a?.files?.nodes ?? []).find((x) => x?.path === i.path); return Boolean(f) && f.viewerViewedState !== 'VIEWED'; },
    inverse: (i) => ({ mutation: 'markFileAsViewed', input: { pullRequestId: i.pullRequestId, path: i.path } }), cls: quiet
  }],
  ['addCloseIssueReferences', {
    scope: 'repo', primary: 'issueId', ids: { issueId: ['Issue'], pullRequestIds: ['PullRequest'] }, changes: [],
    before: '... on Issue { closedByPullRequestsReferences(first: 50, includeClosedPrs: true) { nodes { id } } }',
    already: (i, b) => { const have = new Set((b?.closedByPullRequestsReferences?.nodes ?? []).map((n) => n?.id)); return (i.pullRequestIds ?? []).every((id) => have.has(id)); },
    verify: (i, a) => { const have = new Set((a?.closedByPullRequestsReferences?.nodes ?? []).map((n) => n?.id)); return (i.pullRequestIds ?? []).every((id) => have.has(id)); },
    // Undo removes only the links this call created, never ones that were already there.
    inverse: (i, b) => { const had = closingIds(b), added = [].concat(i.pullRequestIds ?? []).filter((id) => !had.has(id));
      return added.length ? { mutation: 'removeCloseIssueReferences', input: { issueId: i.issueId, pullRequestIds: added } } : null; }, cls: quiet
  }],
  ['removeCloseIssueReferences', {
    scope: 'repo', primary: 'issueId', ids: { issueId: ['Issue'], pullRequestIds: ['PullRequest'] }, changes: [],
    before: '... on Issue { closedByPullRequestsReferences(first: 50, includeClosedPrs: true) { nodes { id } } }',
    already: (i, b) => { const have = new Set((b?.closedByPullRequestsReferences?.nodes ?? []).map((n) => n?.id)); return (i.pullRequestIds ?? []).every((id) => !have.has(id)); },
    verify: (i, a) => { const have = new Set((a?.closedByPullRequestsReferences?.nodes ?? []).map((n) => n?.id)); return (i.pullRequestIds ?? []).every((id) => !have.has(id)); },
    // Undo adds back only the links this call removed.
    inverse: (i, b) => { const had = closingIds(b), removed = [].concat(i.pullRequestIds ?? []).filter((id) => had.has(id));
      return removed.length ? { mutation: 'addCloseIssueReferences', input: { issueId: i.issueId, pullRequestIds: removed } } : null; }, cls: quiet
  }],
  ['unmarkIssueAsDuplicate', {
    scope: 'repo', primary: 'duplicateId', ids: { duplicateId: ['Issue'], canonicalId: ['Issue'] }, changes: [],
    before: '... on Issue { duplicateOf { id } }',
    already: (i, b) => b?.duplicateOf?.id !== i.canonicalId, verify: (i, a) => a?.duplicateOf?.id !== i.canonicalId, inverse: null, cls: notifying,
    undoHint: 'To mark it as a duplicate again, close the issue as a duplicate with github_issue_update (state closed, stateReason duplicate, duplicateIssueId).'
  }],
  // GQL-1 group 3: repository topics and deployments.
  ['updateTopics', {
    scope: 'repo', primary: 'repositoryId', ids: { repositoryId: ['Repository'] }, changes: ['topicNames'],
    before: '... on Repository { repositoryTopics(first: 100) { nodes { topic { name } } } }',
    already: (i, b) => same(topicsOf(b), [...i.topicNames].sort()), verify: (i, a) => same(topicsOf(a), [...i.topicNames].sort()),
    inverse: (i, b) => ({ mutation: 'updateTopics', input: { repositoryId: i.repositoryId, topicNames: topicsOf(b) } }), cls: quiet
  }],
  ['deleteDeployment', {
    scope: 'repo', primary: 'id', ids: { id: ['Deployment'] }, changes: [], before: '... on Deployment { environment }',
    deleted: true, verify: (_i, a) => a === null, inverse: null, cls: destructive,
    undoHint: 'A deleted deployment record cannot be restored. Create a new one with github_deploy_create.'
  }]
]);

/** Legacy unsupported-mutation inventory (GQL-1). The exported name and inventory label are retained for compatibility.
 * These entries are implementation gaps or retired-provider routes, not an authority above the owner.
 * Old risk descriptions below are historical context, not current provider-permission claims.
 * Runtime guidance names supported-tool, REST and exact-setting alternatives; missing verified contracts remain backlog. */
export const REFUSED_MUTATIONS = new Map([
  ['updateProjectV2Collaborators', 'It replaces the whole collaborator list of a project, which can silently remove or widen access. Change who can see a project on github.com.'],
  ['createProjectV2IssueField', 'The new field cannot be proven to belong to your account by a read before it is created.'],
  ['deleteIssueFieldValue', 'Clearing a value is not offered: the field belongs to the organization and cannot be proven yours by a read. Set a new value with github_issue_set_fields.'],
  ['addRelatesTo', 'GitHub offers no way to read related-issue links back, so the change could not be confirmed. Mention the issue in a comment instead.'],
  ['removeRelatesTo', 'GitHub offers no way to read related-issue links back, so the change could not be confirmed.'],
  ['enqueuePullRequest', 'Merging goes only through github_pr_merge at an exact, checked head commit; the merge queue cannot be used to skip that.'],
  ['dequeuePullRequest', 'GitHub offers no merge-queue read for a pull request, so removal could not be confirmed. Use github_pr_set_auto_merge or close the pull request.'],
  ['revertPullRequest', 'It creates a new branch and pull request whose owner cannot be proven beforehand. Revert with github_content_push_files, then github_pr_create.'],
  ['applyPendingIssueSuggestions', 'It applies suggested issue edits chosen by an actor id. Make the edits yourself with github_issue_update, github_issue_set_labels or github_issue_set_assignees.'],
  ['rejectPendingIssueSuggestions', 'It discards suggested issue edits chosen by an actor id and cannot be read back. Edit the issue directly instead.'],
  ['addPullRequestReviewComment', 'It adds to a pending review that is not readable first. Put the comments in one github_review_create call.'],
  ['addPullRequestReviewThread', 'It adds to a pending review that is not readable first. Put the comments in one github_review_create call.'],
  ['addProjectCard', 'Classic projects were retired by GitHub. Use Projects v2 (the github_project_* tools).'],
  ['addProjectColumn', 'Classic projects were retired by GitHub. Use Projects v2 (the github_project_* tools).'],
  ['cloneProject', 'Classic projects were retired by GitHub. Use Projects v2 (the github_project_* tools).'],
  ['convertProjectCardNoteToIssue', 'Classic projects were retired by GitHub. Use Projects v2 (the github_project_* tools).'],
  ['createProject', 'Classic projects were retired by GitHub. Use Projects v2 (the github_project_* tools).'],
  ['deleteProject', 'Classic projects were retired by GitHub. Use Projects v2 (the github_project_* tools).'],
  ['deleteProjectCard', 'Classic projects were retired by GitHub. Use Projects v2 (the github_project_* tools).'],
  ['deleteProjectColumn', 'Classic projects were retired by GitHub. Use Projects v2 (the github_project_* tools).'],
  ['importProject', 'Classic projects were retired by GitHub. Use Projects v2 (the github_project_* tools).'],
  ['linkRepositoryToProject', 'Classic projects were retired by GitHub. Use Projects v2 (the github_project_* tools).'],
  ['moveProjectCard', 'Classic projects were retired by GitHub. Use Projects v2 (the github_project_* tools).'],
  ['moveProjectColumn', 'Classic projects were retired by GitHub. Use Projects v2 (the github_project_* tools).'],
  ['unlinkRepositoryFromProject', 'Classic projects were retired by GitHub. Use Projects v2 (the github_project_* tools).'],
  ['updateProject', 'Classic projects were retired by GitHub. Use Projects v2 (the github_project_* tools).'],
  ['updateProjectCard', 'Classic projects were retired by GitHub. Use Projects v2 (the github_project_* tools).'],
  ['updateProjectColumn', 'Classic projects were retired by GitHub. Use Projects v2 (the github_project_* tools).'],
  ['acceptTopicSuggestion', 'GitHub retired topic suggestions. Set topics with github_graphql_write updateTopics.'],
  ['declineTopicSuggestion', 'GitHub retired topic suggestions. Set topics with github_graphql_write updateTopics.'],
  ['acceptEnterpriseAdministratorInvitation', 'Enterprise membership, administrators, identity provider and organization moves change who controls the whole enterprise and are done by an enterprise owner on github.com.'],
  ['acceptEnterpriseMemberInvitation', 'Enterprise membership, administrators, identity provider and organization moves change who controls the whole enterprise and are done by an enterprise owner on github.com.'],
  ['addEnterpriseOrganizationMember', 'Enterprise membership, administrators, identity provider and organization moves change who controls the whole enterprise and are done by an enterprise owner on github.com.'],
  ['addEnterpriseSupportEntitlement', 'Enterprise membership, administrators, identity provider and organization moves change who controls the whole enterprise and are done by an enterprise owner on github.com.'],
  ['cancelEnterpriseAdminInvitation', 'Enterprise membership, administrators, identity provider and organization moves change who controls the whole enterprise and are done by an enterprise owner on github.com.'],
  ['cancelEnterpriseMemberInvitation', 'Enterprise membership, administrators, identity provider and organization moves change who controls the whole enterprise and are done by an enterprise owner on github.com.'],
  ['createEnterpriseOrganization', 'Enterprise membership, administrators, identity provider and organization moves change who controls the whole enterprise and are done by an enterprise owner on github.com.'],
  ['grantEnterpriseOrganizationsMigratorRole', 'Enterprise membership, administrators, identity provider and organization moves change who controls the whole enterprise and are done by an enterprise owner on github.com.'],
  ['revokeEnterpriseOrganizationsMigratorRole', 'Enterprise membership, administrators, identity provider and organization moves change who controls the whole enterprise and are done by an enterprise owner on github.com.'],
  ['inviteEnterpriseAdmin', 'Enterprise membership, administrators, identity provider and organization moves change who controls the whole enterprise and are done by an enterprise owner on github.com.'],
  ['inviteEnterpriseMember', 'Enterprise membership, administrators, identity provider and organization moves change who controls the whole enterprise and are done by an enterprise owner on github.com.'],
  ['regenerateEnterpriseIdentityProviderRecoveryCodes', 'Enterprise membership, administrators, identity provider and organization moves change who controls the whole enterprise and are done by an enterprise owner on github.com.'],
  ['removeEnterpriseAdmin', 'Enterprise membership, administrators, identity provider and organization moves change who controls the whole enterprise and are done by an enterprise owner on github.com.'],
  ['removeEnterpriseIdentityProvider', 'Enterprise membership, administrators, identity provider and organization moves change who controls the whole enterprise and are done by an enterprise owner on github.com.'],
  ['removeEnterpriseMember', 'Enterprise membership, administrators, identity provider and organization moves change who controls the whole enterprise and are done by an enterprise owner on github.com.'],
  ['removeEnterpriseOrganization', 'Enterprise membership, administrators, identity provider and organization moves change who controls the whole enterprise and are done by an enterprise owner on github.com.'],
  ['removeEnterpriseSupportEntitlement', 'Enterprise membership, administrators, identity provider and organization moves change who controls the whole enterprise and are done by an enterprise owner on github.com.'],
  ['setEnterpriseIdentityProvider', 'Enterprise membership, administrators, identity provider and organization moves change who controls the whole enterprise and are done by an enterprise owner on github.com.'],
  ['transferEnterpriseOrganization', 'Enterprise membership, administrators, identity provider and organization moves change who controls the whole enterprise and are done by an enterprise owner on github.com.'],
  ['updateEnterpriseAdministratorRole', 'Enterprise membership, administrators, identity provider and organization moves change who controls the whole enterprise and are done by an enterprise owner on github.com.'],
  ['updateEnterpriseOwnerOrganizationRole', 'Enterprise membership, administrators, identity provider and organization moves change who controls the whole enterprise and are done by an enterprise owner on github.com.'],
  ['abortQueuedMigrations', 'Migrations move whole repositories and their data between accounts. Start an export with github_org_migration_start; other migration steps are done on github.com.'],
  ['abortRepositoryMigration', 'Migrations move whole repositories and their data between accounts. Start an export with github_org_migration_start; other migration steps are done on github.com.'],
  ['createMigrationSource', 'Migrations move whole repositories and their data between accounts. Start an export with github_org_migration_start; other migration steps are done on github.com.'],
  ['grantMigratorRole', 'Migrations move whole repositories and their data between accounts. Start an export with github_org_migration_start; other migration steps are done on github.com.'],
  ['revokeMigratorRole', 'Migrations move whole repositories and their data between accounts. Start an export with github_org_migration_start; other migration steps are done on github.com.'],
  ['startOrganizationMigration', 'Migrations move whole repositories and their data between accounts. Start an export with github_org_migration_start; other migration steps are done on github.com.'],
  ['startRepositoryMigration', 'Migrations move whole repositories and their data between accounts. Start an export with github_org_migration_start; other migration steps are done on github.com.'],
  ['createIpAllowListEntry', 'IP allow lists can lock every person out of the organization or enterprise. Change them on github.com.'],
  ['deleteIpAllowListEntry', 'IP allow lists can lock every person out of the organization or enterprise. Change them on github.com.'],
  ['updateIpAllowListEntry', 'IP allow lists can lock every person out of the organization or enterprise. Change them on github.com.'],
  ['addVerifiableDomain', 'Verifiable domains control who can see members email addresses and need DNS changes only the owner can make. Do this on github.com.'],
  ['approveVerifiableDomain', 'Verifiable domains control who can see members email addresses and need DNS changes only the owner can make. Do this on github.com.'],
  ['deleteVerifiableDomain', 'Verifiable domains control who can see members email addresses and need DNS changes only the owner can make. Do this on github.com.'],
  ['regenerateVerifiableDomainToken', 'Verifiable domains control who can see members email addresses and need DNS changes only the owner can make. Do this on github.com.'],
  ['verifyVerifiableDomain', 'Verifiable domains control who can see members email addresses and need DNS changes only the owner can make. Do this on github.com.'],
  ['createSponsorships', 'Sponsorship listings, tiers and bulk sponsoring move money or publish prices. Sponsor one person at a time with github_sponsor_set, which enforces the spend limit.'],
  ['createSponsorsListing', 'Sponsorship listings, tiers and bulk sponsoring move money or publish prices. Sponsor one person at a time with github_sponsor_set, which enforces the spend limit.'],
  ['createSponsorsTier', 'Sponsorship listings, tiers and bulk sponsoring move money or publish prices. Sponsor one person at a time with github_sponsor_set, which enforces the spend limit.'],
  ['publishSponsorsTier', 'Sponsorship listings, tiers and bulk sponsoring move money or publish prices. Sponsor one person at a time with github_sponsor_set, which enforces the spend limit.'],
  ['retireSponsorsTier', 'Sponsorship listings, tiers and bulk sponsoring move money or publish prices. Sponsor one person at a time with github_sponsor_set, which enforces the spend limit.'],
  ['updatePatreonSponsorability', 'Sponsorship listings, tiers and bulk sponsoring move money or publish prices. Sponsor one person at a time with github_sponsor_set, which enforces the spend limit.'],
  ['updateSponsorshipPreferences', 'Sponsorship listings, tiers and bulk sponsoring move money or publish prices. Sponsor one person at a time with github_sponsor_set, which enforces the spend limit.'],
  ['accessUserNamespaceRepository', 'It exists for GitHub staff and migrations and cannot be proven to belong to your account.'],
  ['createAttributionInvitation', 'It claims commits that another account made and cannot be undone or read back first.'],
  ['addPullRequestCreationCapBypassUsers', 'It lets people skip the pull request creation limit, which widens access. Change it on github.com.'],
  ['removePullRequestCreationCapBypassUsers', 'It changes who may skip the pull request creation limit. Change it on github.com.'],
  ['replaceActorsForAssignable', 'It swaps the whole assignee list, including Copilot agents. Use github_issue_set_assignees to add or remove people.'],
  ['archivePullRequest', 'GitHub offers no way to read the archived state of a pull request, so the change could not be confirmed.'],
  ['unarchivePullRequest', 'GitHub offers no way to read the archived state of a pull request, so the change could not be confirmed.'],
  ['createCheckSuite', 'Check suites are created by GitHub for each commit. Create a check run with github_check_create_run instead.'],
  ['rerequestCheckSuite', 'Re-running checks is done by re-running the workflow run with the Actions tools.'],
  ['updateCheckSuitePreferences', 'It decides which Apps may start checks automatically. Change it on github.com.'],
  ['updateRefs', 'It moves many branches or tags at once, and could force-update them. Use github_git_update_ref one reference at a time.'],
  ['pinEnvironment', 'An environment cannot be proven to belong to your repository from its id alone, and pinning is cosmetic. Pin on github.com.'],
  ['reorderEnvironment', 'An environment cannot be proven to belong to your repository from its id alone, and the order is cosmetic. Reorder on github.com.'],
  ['updateNotificationRestrictionSetting', 'It limits where notification emails may go for a whole organization. Change it on github.com.'],
  ['updateOrganizationWebCommitSignoffSetting', 'Not offered by a tool yet; change it on github.com.'],
  ['createUserList', 'Star lists are personal bookmarks without an ownership scope here. Manage them on github.com.'],
  ['deleteUserList', 'Star lists are personal bookmarks without an ownership scope here. Manage them on github.com.'],
  ['updateUserList', 'Star lists are personal bookmarks without an ownership scope here. Manage them on github.com.'],
  ['updateUserListsForItem', 'Star lists are personal bookmarks without an ownership scope here. Manage them on github.com.'],
]);

export const writeSpec = (mutation) => WRITE_SPECS.get(mutation) ?? null;

/** The selection run on the primary node, before and after the write. */
export const specReadQuery = (spec) => `query UniversalSpecRead($id: ID!) { node(id: $id) { __typename id ${spec.before} } }`;

/** Name of GraphQL's input type for a mutation: pinIssue -> PinIssueInput. */
export const inputTypeName = (mutation) => mutation[0].toUpperCase() + mutation.slice(1) + 'Input';

/** The GraphQL document that runs one recorded inverse; the input travels as a typed variable. */
export function inverseDocument(mutation) {
  return `mutation ${mutation[0].toUpperCase() + mutation.slice(1)}Undo($input: ${inputTypeName(mutation)}!) { ${mutation}(input: $input) { clientMutationId } }`;
}

/**
 * Checks a request's `input` object against its spec. Throws a plain TypeError for anything the spec does not cover.
 * @returns {{ primaryId: string, ids: {name:string,value:string}[], changes: Record<string,unknown> }}
 */
export function specInput(spec, mutation, input, idEntries) {
  const allowed = new Set([...Object.keys(spec.ids), ...spec.changes, 'clientMutationId']);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new TypeError(`GraphQL ${mutation} input "${key}" is not covered by its reviewed write spec; use the specialised tool or ask for it to be added.`);
  }
  for (const entry of idEntries) {
    if (!Object.hasOwn(spec.ids, entry.name)) {
      throw new TypeError(`GraphQL ${mutation} input "${entry.name}" is an ID the reviewed write spec does not cover.`);
    }
  }
  const primary = idEntries.find((e) => e.name === spec.primary);
  if (!primary) throw new TypeError(`GraphQL ${mutation} needs ${spec.primary}.`);
  return {
    primaryId: primary.value, ids: idEntries,
    changes: Object.fromEntries(spec.changes.filter((k) => given(input, k)).map((k) => [k, input[k]]))
  };
}

/** True when two read snapshots of the primary node differ (concurrent-change protection). */
export const snapshotChanged = (a, b) => !same(a, b);
