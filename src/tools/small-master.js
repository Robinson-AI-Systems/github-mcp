import { redact } from './util.js';
// GOD-4 B: small tools that need the person's own login (the master token): GitHub Classroom reads, the Marketplace listing of an
// App you own, a user's hovercard, and creating a view on one of your own user projects. A closed or unavailable GitHub answer is
// reported plainly instead of failing.
import { defineRead } from './define-read.js';
import { defineGithubWrite } from './define-github-write.js';
import { plain } from './github-read.js';
import { missing, refusal } from './github-write.js';
import { hasMaster, masterClient, masterReader, needMasterText, userTarget } from './master-only.js';

const ID = { type: 'integer', minimum: 1 };
const PAGE = { type: 'integer', minimum: 1, maximum: 100 };
const sentence = (status, what) => (status === 410 ? `GitHub has closed ${what} (it answers "410 Gone"), so nothing can be read.`
  : status === 401 ? `GitHub says ${what} needs a different kind of sign-in than your master token (a GitHub App's own key).`
    : `GitHub has no ${what} for this account (${status}).`);
const soft = async (run, what) => {
  try { return await run(); } catch (e) {
    if ([401, 403, 404, 410].includes(e?.status)) return { available: false, status: e.status, note: sentence(e.status, what) };
    throw e;
  }
};
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o?.[k] !== undefined).map((k) => [k, o[k]]));
const classroom = (name, description, route, params, properties, required, shape, what = 'the Classroom service') => defineRead({
  name, area: 'classroom', audience: ['O'], description, properties, required,
  handler: (args, ctx) => plain(async () => {
    const { gh } = await masterReader(ctx, 'repo', { identity: false });
    return soft(async () => {
      const data = (await gh.request(route, params(args))).data;
      return shape ? shape(data) : data;
    }, what);
  })
});
const classroomList = classroom('github_classroom_list', 'List your GitHub Classrooms. GitHub has closed this service, so an honest "not available" is the usual answer. Uses your master token.',
  'GET /classrooms', () => ({}), {}, []);
const classroomGet = classroom('github_classroom_get', 'Read one GitHub Classroom (closed by GitHub; usually answers "not available"). Uses your master token.',
  'GET /classrooms/{classroom_id}', (a) => ({ classroom_id: a.classroomId }), { classroomId: ID }, ['classroomId']);
const classroomAssignments = classroom('github_classroom_assignments', 'List the assignments of a GitHub Classroom (closed by GitHub; usually "not available"). Uses your master token.',
  'GET /classrooms/{classroom_id}/assignments', (a) => ({ classroom_id: a.classroomId }), { classroomId: ID }, ['classroomId']);
const classroomGrades = classroom('github_classroom_grades', 'Read the grades of one Classroom assignment (closed by GitHub; usually "not available"). Uses your master token.',
  'GET /assignments/{assignment_id}/grades', (a) => ({ assignment_id: a.assignmentId }), { assignmentId: ID }, ['assignmentId']);

const PLAN = ['id', 'number', 'name', 'description', 'monthly_price_in_cents', 'yearly_price_in_cents', 'price_model', 'has_free_trial', 'unit_name', 'state'];
const marketplace = defineRead({
  name: 'github_marketplace_listing', area: 'marketplace', audience: ['O'],
  description: 'Read the Marketplace plans of an App you own, the accounts on a plan, or one account\'s plan. Others get an honest "not available". Uses your master token.',
  properties: { planId: ID, accountId: ID, max: PAGE }, required: [],
  handler: (args, ctx) => plain(async () => {
    const { gh } = await masterReader(ctx, 'repo', { identity: false });
    return soft(async () => {
      if (args.accountId !== undefined) return { account: pick((await gh.request('GET /marketplace_listing/accounts/{account_id}', { account_id: args.accountId })).data, ['id', 'login', 'type', 'email', 'marketplace_purchase', 'marketplace_pending_change']) };
      if (args.planId !== undefined) return { accounts: ((await gh.request('GET /marketplace_listing/plans/{plan_id}/accounts', { plan_id: args.planId, per_page: args.max ?? 30 })).data ?? []).map((a) => pick(a, ['id', 'login', 'type', 'marketplace_purchase'])) };
      return { plans: ((await gh.request('GET /marketplace_listing/plans', { per_page: args.max ?? 30 })).data ?? []).map((p) => pick(p, PLAN)) };
    }, 'Marketplace listing');
  })
});

const hovercard = defineRead({
  name: 'github_user_hovercard', area: 'user', audience: ['B', 'O'],
  description: 'Read the public hovercard facts GitHub shows for a user, optionally in an organization, repository, issue or PR context. Uses your master token.',
  properties: { username: { type: 'string', minLength: 1, maxLength: 39, pattern: '^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$' },
    subjectType: { type: 'string', enum: ['organization', 'repository', 'issue', 'pull_request'] }, subjectId: ID }, required: ['username'],
  handler: (args, ctx) => plain(async () => {
    if ((args.subjectType === undefined) !== (args.subjectId === undefined)) throw new TypeError('subjectType and subjectId go together.');
    const { gh } = await masterReader(ctx, 'repo', { identity: false });
    const data = (await gh.request('GET /users/{username}/hovercard', { username: args.username, ...(args.subjectType ? { subject_type: args.subjectType, subject_id: args.subjectId } : {}) })).data;
    return { username: args.username, contexts: (data?.contexts ?? []).map((c) => ({ message: redact(String(c.message)).slice(0, 300), octicon: c.octicon })) };
  })
});

const VIEW = ['id', 'number', 'name', 'layout', 'filter', 'html_url', 'visible_fields'];
const viewCreate = defineGithubWrite({
  name: 'github_project_view_create', area: 'project', audience: ['B', 'O'],
  description: 'Create a view (table, board or roadmap) on one of your own user projects. Read back from GitHub. Uses your master token (project permission).',
  properties: { projectNumber: ID, name: { type: 'string', minLength: 1, maxLength: 100 }, layout: { type: 'string', enum: ['table', 'board', 'roadmap'] },
    filter: { type: 'string', maxLength: 500 }, visibleFields: { type: 'array', maxItems: 50, items: { type: 'integer', minimum: 1 } } },
  required: ['projectNumber', 'name', 'layout'],
  declarations: { production: 'always', confirm: 'always', cred: 'U', profiles: ['full'] }, target: userTarget('user-project'),
  read: async (args, ctx) => {
    if (!(await hasMaster(ctx, 'project'))) return { needsMaster: true };
    if (args.layout === 'roadmap' && args.visibleFields) throw refusal('visibleFields does not apply to a roadmap view.');
    const { gh, login } = await masterClient(ctx, 'project');
    const project = await missing(async () => (await gh.request('GET /users/{username}/projectsV2/{project_number}', { username: login, project_number: args.projectNumber })).data);
    return { login, project: project ? { number: project.number, title: project.title ?? null } : null };
  },
  classify: () => ({ production: 'changes one of your projects' }),
  summarize: ({ args, before }) => (before.needsMaster ? needMasterText('project') : before.project ? `Create ${args.layout} view "${args.name}" on your project ${args.projectNumber}${before.project.title ? ` (${before.project.title})` : ''}` : `You have no project number ${args.projectNumber}`),
  apply: async ({ args, ctx, before }) => {
    if (before.needsMaster) throw refusal(needMasterText('project'), 403);
    if (!before.project) throw refusal(`You have no project number ${args.projectNumber}.`, 404);
    const { gh, id, login } = await masterClient(ctx, 'project');
    if (login !== before.login) throw refusal('The master token owner changed; nothing was sent.');
    return gh.request('POST /users/{user_id}/projectsV2/{project_number}/views', { user_id: id, project_number: args.projectNumber, name: args.name, layout: args.layout,
      ...(args.filter !== undefined ? { filter: args.filter } : {}), ...(args.visibleFields ? { visible_fields: args.visibleFields } : {}) });
  },
  readAfter: async ({ args, ctx, response }) => {
    const { gh, login } = await masterClient(ctx, 'project');
    const number = response?.data?.number;
    const ok = number !== undefined && (await missing(async () => (await gh.request('GET /users/{username}/projectsV2/{project_number}/views/{view_number}/items', { username: login, project_number: args.projectNumber, view_number: number, per_page: 1 })).data)) !== null;
    return { reachable: ok, view: response?.data ? pick(response.data, VIEW) : null };
  },
  verify: ({ args, after }) => after.reachable && after.view?.name === args.name && after.view?.layout === args.layout,
  inverse: () => null,
  present: ({ after }) => ({ view: after.view, note: 'GitHub has no delete-view operation here; remove the view in the project\'s page if you do not want it.' })
});

const reads = [classroomList, classroomGet, classroomAssignments, classroomGrades, marketplace, hovercard];
export const tools = [...reads, viewCreate].map((d) => d.tool);
export const handlers = Object.fromEntries([...reads, viewCreate].map((d) => [d.tool.name, d.handler]));
