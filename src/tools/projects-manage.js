import { isOwnerConnection } from '../core/authority.js';
// Y-4a: the Projects v2 container — create, edit, copy, delete and link a project to a repository or team.
// Every tool reads the project first, proves GitHub says it belongs to a connected account, makes ONE mutation and
// reads the project back. Full owners execute directly; restricted grants retain confirmation. Deletion has no undo.
import { graphql } from '../github/client.js';
import { defineGithubWrite } from './define-github-write.js';
import { refusal } from './github-write.js';
import { becomesPublic } from './people-guard.js';
import { LOGIN } from './public-read.js';
import { OWNER, NUMBER, projectTarget, loadProject, reloadProject, ownerNode, requireEnrolled, shapeProject } from './projects-gql.js';

const TITLE = { type: 'string', minLength: 1, maxLength: 256 };
const REPO_REF = { type: 'string', maxLength: 140, pattern: '^[A-Za-z0-9-]{1,39}/[A-Za-z0-9._-]{1,100}$', description: 'owner/name of a repository of a connected account' };
const norm = (v) => (v ?? '').toString();

// ---- create ---------------------------------------------------------------------------------------------------------
const TITLES_QUERY = 'query ProjectTitles($login: String!) { repositoryOwner(login: $login) { ... on ProjectV2Owner { projectsV2(first: 100) { nodes { number title } } } } }';
const create = defineGithubWrite({
  name: 'github_project_create', area: 'project', audience: ['Op', 'O'],
  description: 'Create an empty private Projects v2 board for a connected account, optionally linked to one of its repositories.',
  properties: { owner: OWNER, title: TITLE, repo: REPO_REF },
  required: ['title'],
  declarations: { production: 'never', confirm: 'always', cred: 'I,U', profiles: ['full'] },
  target: projectTarget,
  read: async (args, ctx, target) => {
    const o = await ownerNode(ctx, target.owner);
    const titles = (await graphql(o.gh, TITLES_QUERY, { login: target.owner })).repositoryOwner?.projectsV2?.nodes ?? [];
    const clash = titles.find((p) => p?.title === args.title) ?? null;
    let repositoryId = null;
    if (args.repo) {
      const [ro, rn] = args.repo.split('/');
      await requireEnrolled(ctx, ro);
      repositoryId = (await graphql(o.gh, 'query RepoNode($o: String!, $n: String!) { repository(owner: $o, name: $n) { id } }', { o: ro, n: rn })).repository?.id;
      if (!repositoryId) throw refusal('That repository was not found or is not visible to this connection.');
    }
    return { ownerId: o.id, repositoryId, clash };
  },
  classify: () => ({}),
  summarize: ({ args, target }) => `Create a private project "${args.title}" for ${target.owner}${args.repo ? ` linked to ${args.repo}` : ''}`,
  apply: async ({ args, ctx, target, before }) => {
    const o = await ownerNode(ctx, target.owner);
    if (before.clash) throw refusal(`A project titled "${args.title}" already exists for ${target.owner} (#${before.clash.number}); nothing was created.`);
    if (o.id !== before.ownerId) throw refusal('The project owner changed.');
    return { data: (await graphql(o.gh, 'mutation($ownerId: ID!, $title: String!, $repositoryId: ID) { createProjectV2(input: {ownerId: $ownerId, title: $title, repositoryId: $repositoryId}) { projectV2 { id number } } }', { ownerId: before.ownerId, title: args.title, repositoryId: before.repositoryId })).createProjectV2 };
  },
  readAfter: async ({ ctx, target, response }) => (response?.data?.projectV2?.id ? reloadProject(ctx, target.owner, response.data.projectV2.id) : null),
  verify: ({ args, after }) => !!after && after.title === args.title && after.public === false,
  inverse: ({ args, target, after }) => (after ? { tool: 'github_project_delete', args: { owner: target.owner, number: after.number, confirmTitle: args.title } } : null),
  present: ({ after }) => shapeProject(after)
});

// ---- update ---------------------------------------------------------------------------------------------------------
const KEYS = ['title', 'shortDescription', 'readme', 'public', 'closed'];
const update = defineGithubWrite({
  name: 'github_project_update', area: 'project', audience: ['Op', 'O'],
  description: 'Change a project\'s title, short description, readme, visibility (public asks first) or closed state, with a field-by-field read-back.',
  properties: { owner: OWNER, number: NUMBER, title: TITLE, shortDescription: { type: 'string', maxLength: 500 }, readme: { type: 'string', maxLength: 20000 }, public: { type: 'boolean' }, closed: { type: 'boolean' } },
  required: ['number'],
  declarations: { production: 'never', confirm: 'when-needed', accessWidening: true, cred: 'I,U', profiles: ['full'] },
  target: projectTarget,
  read: async (args, ctx, target) => {
    if (!KEYS.some((k) => args[k] !== undefined)) throw refusal('Say what to change: title, shortDescription, readme, public or closed.');
    const { project } = await loadProject(ctx, target.owner, args.number);
    return { project, noop: KEYS.every((k) => args[k] === undefined || norm(project[k]) === norm(args[k])) };
  },
  classify: ({ args, before }) => (args.public === true && before?.project?.public !== true ? becomesPublic({ what: `Project "${before?.project?.title}" and everything on it` }) : {}),
  summarize: ({ args, before }) => `Update project #${args.number} "${before.project.title}": ${KEYS.filter((k) => args[k] !== undefined).join(', ')}`,
  apply: async ({ args, ctx, target, before }) => {
    const { gh, project } = await loadProject(ctx, target.owner, args.number);
    if (before.noop) throw refusal('The project already has those values; nothing to do.');
    if (project.id !== before.project.id) throw refusal('The project changed.');
    const input = { projectId: project.id };
    for (const k of KEYS) if (args[k] !== undefined) input[k] = args[k];
    return { data: (await graphql(gh, 'mutation($input: UpdateProjectV2Input!) { updateProjectV2(input: $input) { projectV2 { id } } }', { input })).updateProjectV2 };
  },
  readAfter: ({ ctx, target, before }) => reloadProject(ctx, target.owner, before.project.id),
  verify: ({ args, after }) => !!after && KEYS.every((k) => args[k] === undefined || norm(after[k]) === norm(args[k])),
  inverse: ({ args, before, target }) => ({ tool: 'github_project_update', args: { owner: target.owner, number: args.number, ...Object.fromEntries(KEYS.filter((k) => args[k] !== undefined).map((k) => [k, k === 'public' || k === 'closed' ? before.project[k] === true : norm(before.project[k])])) } }),
  present: ({ after }) => shapeProject(after)
});

// ---- copy -----------------------------------------------------------------------------------------------------------
const copy = defineGithubWrite({
  name: 'github_project_copy', area: 'project', audience: ['Op', 'O'],
  description: 'Copy a project (fields, views, optionally draft items) into a connected account under a new title. The copy is private.',
  properties: { owner: OWNER, number: NUMBER, title: TITLE, toOwner: { ...LOGIN, description: 'Connected account that receives the copy (default: same owner)' }, includeDraftIssues: { type: 'boolean' } },
  required: ['number', 'title'],
  declarations: { production: 'never', confirm: 'always', cred: 'I,U', profiles: ['full'] },
  target: projectTarget,
  read: async (args, ctx, target) => {
    const { project } = await loadProject(ctx, target.owner, args.number);
    const to = args.toOwner ?? target.owner;
    await requireEnrolled(ctx, to);
    const o = await ownerNode(ctx, to);
    return { project, toOwner: to, toOwnerId: o.id };
  },
  classify: () => ({}),
  summarize: ({ args, before }) => `Copy project #${args.number} "${before.project.title}" to ${before.toOwner} as "${args.title}"${args.includeDraftIssues ? ' with its draft items' : ''}`,
  apply: async ({ args, ctx, target, before }) => {
    const { gh, project } = await loadProject(ctx, target.owner, args.number);
    if (project.id !== before.project.id) throw refusal('The project changed.');
    return { data: (await graphql(gh, 'mutation($input: CopyProjectV2Input!) { copyProjectV2(input: $input) { projectV2 { id number } } }', { input: { projectId: project.id, ownerId: before.toOwnerId, title: args.title, includeDraftIssues: args.includeDraftIssues === true } })).copyProjectV2 };
  },
  readAfter: ({ ctx, before, response }) => (response?.data?.projectV2?.id ? reloadProject(ctx, before.toOwner, response.data.projectV2.id) : null),
  verify: ({ args, after }) => !!after && after.title === args.title,
  inverse: ({ args, before, after }) => (after ? { tool: 'github_project_delete', args: { owner: before.toOwner, number: after.number, confirmTitle: args.title } } : null),
  present: ({ after }) => shapeProject(after)
});

// ---- delete ---------------------------------------------------------------------------------------------------------
const del = defineGithubWrite({
  name: 'github_project_delete', area: 'project', audience: ['O'],
  description: 'Delete a project and its items permanently. Optional confirmTitle checks the current title; full owners can execute directly.',
  properties: { owner: OWNER, number: NUMBER, confirmTitle: TITLE },
  required: ['number'],
  declarations: { production: 'always', confirm: 'always', cred: 'I,U', profiles: ['full'] },
  target: projectTarget,
  read: async (args, ctx, target) => {
    const found = await loadProject(ctx, target.owner, args.number).catch((e) => { if (e?.status === 404) return null; throw e; });
    if (found && (args.confirmTitle !== undefined || !isOwnerConnection(ctx.connection)) && found.project.title !== args.confirmTitle) throw refusal('confirmTitle must be exactly the project\'s current title.');
    return { project: found?.project ?? null };
  },
  classify: ({ before }) => (!before?.project ? {} : { production: `deleting project "${before?.project?.title}" with ${before?.project?.items?.totalCount ?? 0} items cannot be undone` }),
  summarize: ({ args, before }) => !before.project ? `Project #${args.number} no longer exists` : `DELETE project #${args.number} "${before.project.title}" with ${before.project.items?.totalCount ?? 0} items (restore is not possible)`,
  apply: async ({ args, ctx, target, before }) => {
    if (!before.project) throw refusal('The project no longer exists; nothing was deleted.', 404);
    const { gh, project } = await loadProject(ctx, target.owner, args.number);
    if (project.id !== before.project.id || project.title !== before.project.title) throw refusal('The project changed.');
    return { data: (await graphql(gh, 'mutation($projectId: ID!) { deleteProjectV2(input: {projectId: $projectId}) { projectV2 { id } } }', { projectId: project.id })).deleteProjectV2 };
  },
  readAfter: async ({ ctx, target, before }) => (before.project ? (await reloadProject(ctx, target.owner, before.project.id)) : null) ?? { deleted: true },
  verify: ({ after }) => after?.deleted === true,
  inverse: () => null,
  present: ({ args, before }) => ({ deleted: true, number: args.number, title: before.project?.title ?? null, items: before.project?.items?.totalCount ?? 0, restorable: false })
});

// ---- link / unlink --------------------------------------------------------------------------------------------------
const linked = (project, kind, id) => (kind === 'repo' ? project.repositories : project.teams)?.nodes?.some((n) => n?.id === id) === true;
const link = defineGithubWrite({
  name: 'github_project_link', area: 'project', audience: ['Op', 'O'],
  description: 'Link a project to a repository or an organization team (or unlink it). Linking makes the project show on that repository or team.',
  properties: { owner: OWNER, number: NUMBER, repo: REPO_REF, team: { type: 'string', minLength: 1, maxLength: 100, description: 'Team slug in the owner organization' }, link: { type: 'boolean', description: 'true to link (default), false to unlink' } },
  required: ['number'],
  declarations: { production: 'never', confirm: 'always', cred: 'I,U', profiles: ['full'] },
  target: projectTarget,
  read: async (args, ctx, target) => {
    if (!!args.repo === !!args.team) throw refusal('Give exactly one of repo or team.');
    const { gh, project } = await loadProject(ctx, target.owner, args.number);
    let kind; let id; let name;
    if (args.repo) {
      const [ro, rn] = args.repo.split('/');
      await requireEnrolled(ctx, ro);
      id = (await graphql(gh, 'query RepoNode($o: String!, $n: String!) { repository(owner: $o, name: $n) { id } }', { o: ro, n: rn })).repository?.id;
      kind = 'repo'; name = args.repo;
    } else {
      id = (await graphql(gh, 'query TeamNode($o: String!, $s: String!) { organization(login: $o) { team(slug: $s) { id } } }', { o: target.owner, s: args.team })).organization?.team?.id;
      kind = 'team'; name = `${target.owner}/${args.team}`;
    }
    if (!id) throw refusal('That repository or team was not found or is not visible to this connection.');
    const now = linked(project, kind, id);
    return { project, kind, id, name, now };
  },
  classify: () => ({}),
  summarize: ({ args, before }) => `${args.link === false ? 'Unlink' : 'Link'} project #${args.number} "${before.project.title}" ${args.link === false ? 'from' : 'to'} ${before.kind} ${before.name}`,
  apply: async ({ args, ctx, target, before }) => {
    const { gh, project } = await loadProject(ctx, target.owner, args.number);
    if (before.now === (args.link !== false)) throw refusal(`Already ${before.now ? 'linked' : 'not linked'}; nothing to do.`);
    if (project.id !== before.project.id) throw refusal('The project changed.');
    const unlink = args.link === false;
    const m = before.kind === 'repo' ? (unlink ? 'unlinkProjectV2FromRepository' : 'linkProjectV2ToRepository') : (unlink ? 'unlinkProjectV2FromTeam' : 'linkProjectV2ToTeam');
    const key = before.kind === 'repo' ? 'repositoryId' : 'teamId';
    return { data: (await graphql(gh, `mutation($projectId: ID!, $id: ID!) { ${m}(input: {projectId: $projectId, ${key}: $id}) { clientMutationId } }`, { projectId: project.id, id: before.id }))[m] };
  },
  readAfter: ({ ctx, target, before }) => reloadProject(ctx, target.owner, before.project.id),
  verify: ({ args, before, after }) => !!after && linked(after, before.kind, before.id) === (args.link !== false),
  inverse: ({ args, target }) => ({ tool: 'github_project_link', args: { owner: target.owner, number: args.number, ...(args.repo ? { repo: args.repo } : { team: args.team }), link: args.link === false } }),
  present: ({ args, before, after }) => ({ project: after.number, [before.kind]: before.name, linked: linked(after, before.kind, before.id), requested: args.link !== false })
});

const writes = [create, update, copy, del, link];
export const tools = writes.map((d) => d.tool);
export const handlers = Object.fromEntries(writes.map((d) => [d.tool.name, d.handler]));
