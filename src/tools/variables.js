import { redact } from './util.js';
// Actions variables and the secret list (G-3 part 1). Variables are not secret, so their values are shown. Secret values never pass
// through a tool and GitHub never returns them; `github_secret_list` shows names and dates only. Where a variable or secret lives:
// `environment` set (with `repo`) = one environment; `repo` only = one repository; neither = the whole organization (always production).
import { defineRead } from './define-read.js';
import { defineGithubWrite } from './define-github-write.js';
import { OUTSIDE_PROJECT } from './protect-guard.js';
import { missing, octo, ownerOf, refusal, slug } from './github-write.js';
import { plain, readerFor } from './github-read.js';
import { productionReason } from './production-guard.js';
import { personalCred } from '../github/personal-cred.js';

const OWNER = { type: 'string', maxLength: 39, description: 'GitHub account (default: the connection\'s default account)' };
const REPO = { type: 'string', minLength: 1, maxLength: 100, description: 'Leave out for an organization-level variable or secret' };
const ENVIRONMENT = { type: 'string', minLength: 1, maxLength: 100, description: 'With repo: an environment\'s own variables' };
const NAME = { type: 'string', minLength: 1, maxLength: 100, pattern: '^[A-Za-z_][A-Za-z0-9_]*$', description: 'Letters, digits and underscores; not starting with a digit' };
const KINDS = ['actions', 'dependabot', 'codespaces', 'agents'];

/** Where the thing lives: its API base path and a plain label. */
export function place(args, ctx) {
  const owner = ownerOf(args, ctx);
  if (args.level === 'user') {
    if (args.repo || args.environment !== undefined) throw new TypeError('level "user" is your own account: leave out repo and environment.');
    if ((args.kind ?? 'actions') !== 'codespaces') throw new TypeError('Only Codespaces secrets exist on a personal account: set kind to codespaces.');
    return { level: 'user', owner, label: 'your personal Codespaces secrets' };
  }
  if (args.environment !== undefined && !args.repo) throw new TypeError('An environment belongs to a repository: give repo too.');
  if (args.environment !== undefined) return { level: 'environment', owner, repo: args.repo, environment: args.environment, label: `the ${args.environment} environment of ${slug(owner, args.repo)}` };
  if (args.repo) return { level: 'repo', owner, repo: args.repo, label: slug(owner, args.repo) };
  return { level: 'org', owner, label: `the ${owner} organization` };
}
const varRoute = (pl) => ({
  list: pl.level === 'org' ? 'GET /orgs/{org}/actions/variables' : pl.level === 'environment' ? 'GET /repos/{owner}/{repo}/environments/{environment_name}/variables' : 'GET /repos/{owner}/{repo}/actions/variables',
  one: pl.level === 'org' ? '/orgs/{org}/actions/variables/{name}' : pl.level === 'environment' ? '/repos/{owner}/{repo}/environments/{environment_name}/variables/{name}' : '/repos/{owner}/{repo}/actions/variables/{name}'
});
const varParams = (pl) => (pl.level === 'org' ? { org: pl.owner } : pl.level === 'environment' ? { owner: pl.owner, repo: pl.repo, environment_name: pl.environment } : { owner: pl.owner, repo: pl.repo });
export const targetOf = (pl) => ({ owner: pl.owner, ...(pl.repo ? { repo: pl.repo } : {}), ...(pl.environment ? { environment: pl.environment } : {}), scope: pl.level === 'org' ? 'org' : pl.level === 'user' ? 'user' : 'repo' });
// Which credential a secret kind needs: Codespaces secrets belong to the person's own account (master token, GOD-2); the rest use the App.
export const secretCred = async (ctx, kind) => ((kind ?? 'actions') === 'codespaces' ? personalCred(ctx, 'codespace') : 'I');
const getVar = (ctx, pl, name) => missing(async () => (await (await octo(ctx, pl.owner)).request(`GET ${varRoute(pl).one}`, { ...varParams(pl), name })).data);

export const variableList = defineRead({
  name: 'github_variable_list', area: 'variable', audience: ['B'],
  description: 'Actions variables of a repository, an environment or an organization, with their values (variables are not secret).',
  properties: { owner: OWNER, repo: REPO, environment: ENVIRONMENT }, required: [],
  handler: (args, ctx) => plain(async () => {
    const { owner, octokit } = await readerFor(args, ctx);
    const pl = place({ ...args, owner }, ctx);
    const data = (await octokit.request(varRoute(pl).list, { ...varParams(pl), per_page: 30 })).data;
    return { where: pl.label, count: data.variables.length, total: data.total_count, items: data.variables.map((v) => ({ name: v.name, value: v.value, updated_at: v.updated_at, ...(v.visibility ? { visibility: v.visibility } : {}) })) };
  })
});

const variableSet = defineGithubWrite({
  name: 'github_variable_set', area: 'variable', audience: ['B'],
  description: 'Create or update an Actions variable. In an organization or a production environment it is a production change.',
  properties: { owner: OWNER, repo: REPO, environment: ENVIRONMENT, name: NAME, value: { type: 'string', maxLength: 48000 },
    visibility: { type: 'string', enum: ['all', 'private', 'selected'], description: 'Organization variables only (default private)' }, selectedRepositoryIds: { type: 'array', maxItems: 100, items: { type: 'integer', minimum: 1 }, description: 'With visibility selected' }, ...OUTSIDE_PROJECT },
  required: ['name', 'value'],
  declarations: { production: 'when-target' },
  target: (args, ctx) => targetOf(place(args, ctx)),
  read: async (args, ctx) => ({ current: await getVar(ctx, place(args, ctx), args.name) }),
  classify: ({ ctx, target }) => productionReason(ctx, target).then((production) => ({ production })),
  summarize: ({ args, ctx, before }) => `${before.current ? 'Change' : 'Create'} variable ${args.name} in ${place(args, ctx).label}${before.current ? ` (now "${redact(String(before.current.value)).slice(0, 40)}")` : ''} to "${redact(args.value).slice(0, 60)}${args.value.length > 60 ? '…' : ''}"`,
  apply: async ({ args, ctx, before }) => {
    const pl = place(args, ctx);
    if (args.visibility && pl.level !== 'org') throw refusal('Visibility only applies to organization variables.');
    if (args.visibility === 'selected' && !args.selectedRepositoryIds?.length) throw refusal('Visibility "selected" needs selectedRepositoryIds.');
    const org = pl.level === 'org' ? { visibility: args.visibility ?? 'private', ...(args.visibility === 'selected' ? { selected_repository_ids: args.selectedRepositoryIds } : {}) } : {};
    const octokit = await octo(ctx, pl.owner);
    if (before.current) return octokit.request(`PATCH ${varRoute(pl).one}`, { ...varParams(pl), name: args.name, value: args.value, ...(args.visibility ? org : {}) });
    return octokit.request(`POST ${varRoute(pl).list.replace('GET ', '')}`, { ...varParams(pl), name: args.name, value: args.value, ...org });
  },
  readAfter: ({ args, ctx }) => getVar(ctx, place(args, ctx), args.name),
  verify: ({ args, after }) => after?.value === args.value,
  inverse: ({ args, ctx, before }) => { const pl = place(args, ctx); const where = { owner: pl.owner, ...(pl.repo ? { repo: pl.repo } : {}), ...(pl.environment ? { environment: pl.environment } : {}) };
    return before.current ? { tool: 'github_variable_set', args: { ...where, name: args.name, value: before.current.value } } : { tool: 'github_variable_delete', args: { ...where, name: args.name } }; },
  present: ({ args, ctx }) => ({ variable: args.name, where: place(args, ctx).label })
});

const variableDelete = defineGithubWrite({
  name: 'github_variable_delete', area: 'variable', audience: ['B'],
  description: 'Delete an Actions variable. Its value is kept in the undo, so it can be put back.',
  properties: { owner: OWNER, repo: REPO, environment: ENVIRONMENT, name: NAME, ...OUTSIDE_PROJECT }, required: ['name'],
  declarations: { production: 'when-target', confirm: 'always' },
  target: (args, ctx) => targetOf(place(args, ctx)),
  read: async (args, ctx) => ({ current: await getVar(ctx, place(args, ctx), args.name) }),
  classify: ({ ctx, target }) => productionReason(ctx, target).then((production) => ({ production })),
  summarize: ({ args, ctx, before }) => (before.current ? `Delete variable ${args.name} (value "${redact(String(before.current.value)).slice(0, 40)}") from ${place(args, ctx).label}` : `There is no variable ${args.name} in ${place(args, ctx).label}`),
  apply: async ({ args, ctx, before }) => {
    if (!before.current) throw refusal(`There is no variable ${args.name}.`, 404);
    const pl = place(args, ctx);
    return (await octo(ctx, pl.owner)).request(`DELETE ${varRoute(pl).one}`, { ...varParams(pl), name: args.name });
  },
  readAfter: async ({ args, ctx }) => ((await getVar(ctx, place(args, ctx), args.name)) === null ? 'gone' : 'still there'),
  verify: ({ after }) => after === 'gone',
  inverse: ({ args, ctx, before }) => { const pl = place(args, ctx); return { tool: 'github_variable_set', args: { owner: pl.owner, ...(pl.repo ? { repo: pl.repo } : {}), ...(pl.environment ? { environment: pl.environment } : {}), name: args.name, value: before.current.value } }; },
  present: ({ args }) => ({ deleted: args.name })
});

export const secretList = defineRead({
  name: 'github_secret_list', area: 'secret', audience: ['B', 'O'],
  description: 'Secret names and dates for a repository, an environment or an organization (never values), and which repositories can use an organization secret.',
  properties: { owner: OWNER, repo: REPO, environment: ENVIRONMENT, level: { type: 'string', enum: ['user'], description: 'user = your own personal Codespaces secrets (kind codespaces; leave out repo)' }, kind: { type: 'string', enum: KINDS, description: 'Default actions' }, includeOrganization: { type: 'boolean', description: 'For a repository: also the organization secrets it can use' } },
  required: [],
  handler: (args, ctx) => plain(async () => {
    const kind = args.kind ?? 'actions';
    if (args.level === 'user') {
      const pu = place(args, ctx);
      const cred = await secretCred(ctx, kind);
      if (cred !== 'M') throw refusal('Your personal Codespaces secrets need your master token with the codespace permission; add it on the My connection page.', 403);
      const data = (await (await octo(ctx, pu.owner, cred)).request('GET /user/codespaces/secrets', { per_page: 100 })).data;
      const items = (data.secrets ?? []).map((x) => ({ name: x.name, created_at: x.created_at, updated_at: x.updated_at, visibility: x.visibility }));
      return { where: pu.label, kind, count: items.length, items, note: 'Values are never shown; GitHub does not return them.' };
    }
    const { owner, octokit } = await readerFor(args, ctx);
    const pl = place({ ...args, owner }, ctx);
    if (pl.level === 'environment' && kind !== 'actions') throw new TypeError('Only Actions secrets exist per environment.');
    const route = pl.level === 'org' ? `GET /orgs/{org}/${kind}/secrets` : pl.level === 'environment' ? 'GET /repos/{owner}/{repo}/environments/{environment_name}/secrets' : `GET /repos/{owner}/{repo}/${kind}/secrets`;
    const data = (await octokit.request(route, { ...varParams(pl), per_page: 100 })).data;
    const items = [];
    for (const s of data.secrets ?? []) {
      const row = { name: s.name, created_at: s.created_at, updated_at: s.updated_at, ...(s.visibility ? { visibility: s.visibility } : {}) };
      if (pl.level === 'org' && s.visibility === 'selected') {
        const repos = (await octokit.request(`GET /orgs/{org}/${kind}/secrets/{secret_name}/repositories`, { org: pl.owner, secret_name: s.name, per_page: 100 })).data;
        row.repositories = (repos.repositories ?? []).map((r) => r.full_name);
      }
      items.push(row);
    }
    let inherited;
    if (args.includeOrganization && pl.level === 'repo') {
      inherited = ((await octokit.request(`GET /repos/{owner}/{repo}/${kind}/organization-secrets`, { owner: pl.owner, repo: pl.repo, per_page: 100 })).data.secrets ?? []).map((s) => s.name);
    }
    return { where: pl.label, kind, count: items.length, items, ...(inherited ? { organization_secrets_available: inherited } : {}), note: 'Values are never shown; GitHub does not return them.' };
  })
});

const reads = [variableList, secretList];
const writes = [variableSet, variableDelete];
export const tools = [...reads, ...writes].map((d) => d.tool);
export const handlers = Object.fromEntries([...reads, ...writes].map((d) => [d.tool.name, d.handler]));
