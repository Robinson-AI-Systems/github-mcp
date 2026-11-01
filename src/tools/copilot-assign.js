// CAP-6: assign Copilot's coding agent to an issue (owner-approved 2026-11-01). GitHub then works on the issue in its own
// branch and opens a pull request. Since 2026-06-01 Copilot is billed by use (AI credits) and the agent also uses GitHub
// Actions minutes, so a session has no fixed price: the tool is classified spend with an explicitly unknown price, every
// connection (the owner's own included) confirms first, and a price that cannot be worked out refuses (strictSpend).
// A GitHub user token is used, as GitHub requires for assigning Copilot. Listed only where Copilot is present.
import { defineGithubWrite } from './define-github-write.js';
import { githubFor, graphql } from '../github/client.js';
import { ownerOf, refusal, slug } from './github-write.js';

const OWNER = { type: 'string', minLength: 1, maxLength: 39, description: 'Connected account (default account)' };
const REPO = { type: 'string', minLength: 1, maxLength: 100, pattern: '^[A-Za-z0-9_.-]+$' };
const BOT = /^copilot(-swe-agent)?$/i;

const STATE = `query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { id nameWithOwner
  suggestedActors(capabilities: [CAN_BE_ASSIGNED], first: 5, loginNames: "copilot-swe-agent") { nodes { __typename login ... on Bot { id } } }
  issue(number: $number) { id number state title assignedActors(first: 20) { nodes { __typename ... on Bot { login } ... on User { login } } } } } }`;
const ASSIGN = 'mutation($input: AddAssigneesToAssignableInput!) { addAssigneesToAssignable(input: $input) { assignable { ... on Issue { id } } } }';

const userClient = (ctx, t) => githubFor(ctx, { owner: t.owner, cred: 'U', scope: { repositories: [t.repo] } });
async function issueState(ctx, t, number) {
  const repo = (await graphql(await userClient(ctx, t), STATE, { owner: t.owner, name: t.repo, number }))?.repository;
  if (!repo) throw refusal(`Repository ${slug(t.owner, t.repo)} was not found.`, 404);
  if (!repo.issue) throw refusal(`Issue #${number} was not found in ${slug(t.owner, t.repo)}.`, 404);
  const agent = (repo.suggestedActors?.nodes ?? []).find((a) => a?.__typename === 'Bot' && BOT.test(String(a.login)) && a.id) ?? null;
  const assignees = (repo.issue.assignedActors?.nodes ?? []).map((a) => String(a?.login ?? '')).filter(Boolean);
  return { repositoryId: repo.id, repository: repo.nameWithOwner, agentId: agent?.id ?? null, issueId: repo.issue.id, number: repo.issue.number,
    state: repo.issue.state, title: repo.issue.title, assignees, copilotAssigned: assignees.some((l) => BOT.test(l)) };
}

const assign = defineGithubWrite({
  name: 'github_copilot_assign_issue', area: 'copilot', audience: ['B', 'O'],
  description: 'Assign Copilot\'s coding agent to an open issue; it works in its own branch and opens a pull request. Billed by use, so it always asks first.',
  properties: { owner: OWNER, repo: REPO, number: { type: 'integer', minimum: 1, description: 'Issue number' },
    baseRef: { type: 'string', minLength: 1, maxLength: 255, description: 'Branch Copilot starts from (default: the default branch)' },
    instructions: { type: 'string', minLength: 1, maxLength: 4000, description: 'Extra instructions for Copilot (data, shown to Copilot only)' } },
  required: ['repo', 'number'],
  declarations: { production: 'never', spend: true, strictSpend: true, confirm: 'always', cred: 'U', profiles: ['full'] },
  target: (args, ctx) => ({ owner: ownerOf(args, ctx), repo: args.repo, scope: 'repo' }),
  read: async (args, ctx, t) => {
    const s = await issueState(ctx, t, args.number);
    if (s.state !== 'OPEN') throw refusal(`Issue #${args.number} is closed, so Copilot cannot be assigned to it.`);
    if (!s.agentId) throw refusal(`Copilot's coding agent is not available in ${s.repository} (it needs a Copilot plan with the coding agent turned on for this repository).`);
    return s;
  },
  // Usage-billed (AI credits since 2026-06-01, plus Actions minutes): GitHub publishes no price per session.
  price: () => null,
  classify: () => ({}),
  summarize: ({ args, before }) => (before.copilotAssigned
    ? `Copilot is already assigned to issue #${args.number} in ${before.repository}`
    : `Assign Copilot's coding agent to issue #${args.number} "${String(before.title).slice(0, 120)}" in ${before.repository}${args.baseRef ? ` from ${args.baseRef}` : ''}; it opens a pull request and is billed by use (Copilot AI credits and GitHub Actions minutes, no fixed price)`),
  apply: async ({ args, ctx, target: t, before }) => {
    if (before.copilotAssigned) throw refusal(`Copilot is already assigned to issue #${args.number}; nothing was sent.`);
    const agentAssignment = { ...(args.baseRef ? { baseRef: args.baseRef } : {}), ...(args.instructions ? { customInstructions: args.instructions } : {}) };
    return graphql(await userClient(ctx, t), ASSIGN, { input: { assignableId: before.issueId, assigneeIds: [before.agentId], ...(Object.keys(agentAssignment).length ? { agentAssignment } : {}) } });
  },
  readAfter: ({ args, ctx, target: t }) => issueState(ctx, t, args.number),
  verify: ({ after }) => after.copilotAssigned === true,
  inverse: () => null, // unassigning does not reliably stop a session that already started
  present: ({ after }) => ({ issue: after.number, repository: after.repository, copilot_assigned: after.copilotAssigned,
    note: 'Copilot opens a pull request when it has a first change; read it with github_pr_list.', billing: 'Billed by use (AI credits and Actions minutes); no total is guaranteed.' })
});

export const tools = [assign.tool];
export const handlers = { [assign.tool.name]: assign.handler };
