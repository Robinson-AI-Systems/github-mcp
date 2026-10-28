import { isOwnerConnection } from '../core/authority.js';
// F-1: transfer an issue across two separately verified repositories.
// A transfer changes ownership and may notify watchers, so it always confirms.
import { graphql } from '../github/client.js';
import { defineGithubWrite } from './define-github-write.js';
import { missing, octo, ownerOf, refusal, slug } from './github-write.js';
import { protectedList, protectionVerdict } from './protect-guard.js';

const OWNER = { type: 'string', maxLength: 39 };
const REPO = { type: 'string', minLength: 1, maxLength: 100 };
const NUMBER = { type: 'integer', minimum: 1 };
const SAME = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const issueRoute = 'GET /repos/{owner}/{repo}/issues/{issue_number}';
const repoRoute = 'GET /repos/{owner}/{repo}';
const target = (args, ctx) => ({ owner: ownerOf(args, ctx), repo: args.repo, scope: 'repo' });
const destination = (args, t) => ({ owner: args.destinationOwner ?? t.owner, repo: args.destinationRepo, scope: 'repo' });
const TRANSFER = `mutation($issue: ID!, $destination: ID!, $createLabels: Boolean!) {
  transferIssue(input: { issueId: $issue, repositoryId: $destination, createLabelsIfMissing: $createLabels }) {
    issue { id number url repository { nameWithOwner } }
  }
}`;
const ownerRepoUrl = t => `https://api.github.com/repos/${t.owner}/${t.repo}`;
const verifiedDestination = (i, t, nodeId) =>
  i?.node_id === nodeId && Number.isSafeInteger(i?.number) && SAME(i.repository_url, ownerRepoUrl(t));

export const issueTransfer = defineGithubWrite({
  name: 'github_issue_transfer', area: 'issue', audience: ['Op'],
  description: 'Transfer an issue to another verified repository, with destination protection, confirmation and readback.',
  properties: { owner: OWNER, repo: REPO, number: NUMBER, destinationOwner: OWNER,
    destinationRepo: REPO, createLabelsIfMissing: { type: 'boolean' } },
  required: ['repo', 'number', 'destinationRepo'],
  declarations: { production: 'never', confirm: 'always', notifies: true },
  target: (args, ctx) => {
    const source = target(args, ctx), dest = destination(args, source);
    if (SAME(slug(source.owner, source.repo), slug(dest.owner, dest.repo)))
      throw new TypeError('Source and destination repositories must be different.');
    return source;
  },
  read: async (args, ctx, t) => {
    const dest = destination(args, t);
    if (!ctx.connection.accounts.some(a => SAME(a, dest.owner)))
      throw refusal('Destination account is outside the connected GitHub accounts.');
    // The normal write gates protect the source. Repeat the protected-resource
    // check for the destination, which would otherwise be invisible to them.
    const entries = isOwnerConnection(ctx.connection) ? [] : await protectedList(ctx.db);
    const decision = protectionVerdict({ entries, name: 'github_issue_transfer',
      args, target: dest, classification: {} });
    if (decision?.refuse) throw refusal(`Destination is protected: ${decision.refuse}`);
    const sourceOcto = await octo(ctx, t.owner), destOcto = await octo(ctx, dest.owner);
    const issue = await missing(async () => (await sourceOcto.request(issueRoute,
      { owner: t.owner, repo: t.repo, issue_number: args.number })).data);
    if (issue?.pull_request || (issue && !issue.node_id))
      throw refusal('The source cannot be transferred: it is a PR or lacks a verified issue node ID.');
    const alreadyMoved = !issue || issue.number !== args.number;
    const repository = await missing(async () => (await destOcto.request(repoRoute,
      { owner: dest.owner, repo: dest.repo })).data);
    if (!repository || !repository.node_id || repository.has_issues === false ||
        (repository.full_name && !SAME(repository.full_name, slug(dest.owner, dest.repo))))
      throw refusal('The destination does not exist, lacks verified identity, or has issues disabled.');
    // Keep an already-moved original number as a safe state to allow the
    // durable journal to answer an exact-key replay. A fresh key cannot move
    // an absent source again: apply explicitly refuses before mutation.
    return { issueNodeId: issue?.node_id ?? null, sourceTitle: issue?.title ?? null,
      alreadyMoved, destination: dest, destinationNodeId: repository.node_id };
  },
  classify: () => ({}),
  summarize: ({ args, before, target: t }) =>
    `Transfer issue #${args.number} from ${slug(t.owner,t.repo)} to ${slug(before.destination.owner,before.destination.repo)}.`
    + ` GitHub may notify issue subscribers; ${args.createLabelsIfMissing ? 'create matching labels if absent' : 'do not create missing labels'}.`,
  apply: async ({ ctx, target: t, args, before }) => {
    if (before.alreadyMoved)
      throw refusal('The source issue is absent or already transferred; no second transfer was sent.');
    const result = await graphql(await octo(ctx, t.owner), TRANSFER, {
      issue: before.issueNodeId, destination: before.destinationNodeId,
      createLabels: args.createLabelsIfMissing === true
    });
    const transferred = result?.transferIssue?.issue;
    if (!transferred?.number || !SAME(transferred.repository?.nameWithOwner,
      slug(before.destination.owner, before.destination.repo))) {
      // A completed GraphQL mutation may be irreversible. Treat this as
      // unconfirmed, never initiate a second transfer to guess its outcome.
      return { data: { transfer: transferred ?? null } };
    }
    return { data: { transfer: transferred } };
  },
  readAfter: async ({ ctx, before, response }) => {
    const result = response?.data?.transfer;
    if (!result?.number || !Number.isSafeInteger(result.number)) return null;
    const d = before.destination;
    return missing(async () => (await (await octo(ctx, d.owner)).request(issueRoute,
      { owner: d.owner, repo: d.repo, issue_number: result.number })).data);
  },
  verify: ({ before, after, response }) => verifiedDestination(after, before.destination, before.issueNodeId)
    && response?.data?.transfer?.id === before.issueNodeId
    && SAME(response?.data?.transfer?.repository?.nameWithOwner,
      slug(before.destination.owner, before.destination.repo))
    && after.number === response.data.transfer.number,
  inverse: () => null, // Moving back is a separate, separately authorized transfer.
  present: ({ before, after }) => ({ destination: slug(before.destination.owner, before.destination.repo),
    number: after?.number ?? null, html_url: after?.html_url ?? null,
    sourceIssueNodeId: before.issueNodeId })
});

export const tools = [issueTransfer.tool];
export const handlers = { [issueTransfer.tool.name]: issueTransfer.handler };
