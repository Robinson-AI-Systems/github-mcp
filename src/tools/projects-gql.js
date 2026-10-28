import { redact } from './util.js';
// Y-4: shared pieces for the Projects v2 lifecycle tools (GraphQL only; REST has no way to create, copy, delete or
// restructure a project). A project is always named by its owner and number; the owner must be a connected account and
// GitHub itself must say the project belongs to that owner (never trusted from the arguments). Organizations use the
// installation credential, personal accounts the user sign-in (credential U).
import { githubFor, graphql } from '../github/client.js';
import { refusal, ownerOf } from './github-write.js';
import { LOGIN } from './public-read.js';

export const OWNER = { ...LOGIN, description: 'Connected account that owns the project (default account)' };
export const NUMBER = { type: 'integer', minimum: 1, description: 'Project number (as in the project address)' };
export const NODE_ID = { type: 'string', minLength: 4, maxLength: 100, pattern: '^[A-Za-z0-9_=-]+$' };
export const COLORS = ['BLUE', 'GRAY', 'GREEN', 'ORANGE', 'PINK', 'PURPLE', 'RED', 'YELLOW'];

export const projectTarget = (args, ctx) => ({ owner: ownerOf(args, ctx), scope: 'org', kind: 'project' });

/** The right credential for the owner: installation for an organization, the user sign-in for a person. */
export async function projectClient(ctx, owner) {
  const row = await ctx.db.getAccount(owner);
  if (!row) throw refusal('That project owner is not a connected account.');
  return { gh: await githubFor(ctx, { owner, cred: row.account_type === 'Organization' ? 'I' : 'U' }), accountType: row.account_type };
}

const FIELDS = `fields(first: 50) { nodes { __typename ... on ProjectV2FieldCommon { id name dataType }
  ... on ProjectV2SingleSelectField { options { id name description color } }
  ... on ProjectV2MultiSelectField { options: multiSelectOptions { id name description color } }
  ... on ProjectV2IterationField { configuration { duration startDay iterations { id title startDate duration } completedIterations { id title startDate duration } } } } }`;
export const PROJECT_BODY = `id number title shortDescription readme public closed url owner { __typename id ... on Organization { login } ... on User { login } }
  items(first: 1) { totalCount } ${FIELDS}
  views(first: 30) { nodes { id name layout } }
  repositories(first: 50) { nodes { id nameWithOwner } } teams(first: 50) { nodes { id slug } }`;
const PROJECT_QUERY = `query ProjectByNumber($login: String!, $number: Int!) { repositoryOwner(login: $login) { __typename id login ... on ProjectV2Owner { projectV2(number: $number) { ${PROJECT_BODY} } } } }`;
const BY_ID = `query ProjectById($id: ID!) { node(id: $id) { __typename ... on ProjectV2 { ${PROJECT_BODY} } } }`;
const OWNER_QUERY = `query ProjectOwner($login: String!) { repositoryOwner(login: $login) { __typename id login } }`;

export const shapeProject = (p) => ({
  number: p.number, id: p.id, title: p.title, description: p.shortDescription ?? null, readme: p.readme ? redact(String(p.readme)).slice(0, 2000) : null, public: p.public === true, closed: p.closed === true,
  url: p.url, owner: p.owner?.login ?? null, itemCount: p.items?.totalCount ?? 0,
  fields: (p.fields?.nodes ?? []).filter(Boolean).map((f) => ({ id: f.id, name: f.name, dataType: f.dataType })),
  views: (p.views?.nodes ?? []).filter(Boolean).map((v) => ({ id: v.id, name: v.name, layout: v.layout })), untrusted: true
});

const proveOwner = (project, owner) => {
  if (!project?.id || String(project.owner?.login ?? '').toLowerCase() !== owner.toLowerCase()) throw refusal('GitHub did not confirm that this project belongs to that connected account.');
  return project;
};

/** Reads one project by owner and number, proves who owns it, and returns the credentialed client with it. */
export async function loadProject(ctx, owner, number) {
  const { gh } = await projectClient(ctx, owner);
  const data = (await graphql(gh, PROJECT_QUERY, { login: owner, number })).repositoryOwner;
  if (!data?.projectV2) throw refusal(`Project #${number} was not found for ${owner}, or this connection cannot see it.`, 404);
  return { gh, project: proveOwner(data.projectV2, owner) };
}
/** Re-reads a project by its id (read-back after a write). A missing node is `null`. */
export async function reloadProject(ctx, owner, id) {
  const { gh } = await projectClient(ctx, owner);
  const node = (await graphql(gh, BY_ID, { id })).node;
  return node?.__typename === 'ProjectV2' ? proveOwner(node, owner) : null;
}
export async function ownerNode(ctx, login) {
  const { gh } = await projectClient(ctx, login);
  const o = (await graphql(gh, OWNER_QUERY, { login })).repositoryOwner;
  if (!o?.id || String(o.login).toLowerCase() !== login.toLowerCase()) throw refusal('GitHub did not confirm that account.');
  return { gh, id: o.id, type: o.__typename };
}
/** A second connected account named in the arguments (copy target, link repository owner) must also be enrolled. */
export async function requireEnrolled(ctx, login) {
  const row = await ctx.db.getAccount(login);
  if (!row) throw refusal(`${login} is not a connected account.`);
  return row;
}

const ITEM_QUERY = `query ProjectItem($id: ID!) { node(id: $id) { __typename ... on ProjectV2Item { id isArchived type project { id } content { __typename
  ... on DraftIssue { title } ... on Issue { title number repository { nameWithOwner } } ... on PullRequest { title number repository { nameWithOwner } } } } } }`;
/** One item by node id; it must belong to the given project, or null when it does not exist (anymore). */
export async function readItem(gh, projectId, itemId) {
  const node = (await graphql(gh, ITEM_QUERY, { id: itemId })).node;
  if (!node || node.__typename !== 'ProjectV2Item') return null;
  if (node.project?.id !== projectId) throw refusal('That item is not in this project.');
  return node;
}
export const itemTitle = (item) => item?.content?.title ?? '(redacted item)';
export const shapeItem = (item) => item && ({ id: item.id, type: item.type, archived: item.isArchived === true, title: itemTitle(item), content: item.content?.__typename ?? null, number: item.content?.number ?? null, repository: item.content?.repository?.nameWithOwner ?? null, untrusted: true });
