import { redact } from './util.js';
// GitHub Actions, change side (G-1 part 2): enable/disable a workflow, start one, rerun, cancel, delete a run, approve or reject a
// waiting deployment. A workflow is production when its file deploys to a production environment (read from the file at the ref
// being run), or when the ref itself is production; anything that cannot be read for certain counts as production.
import { createHash } from 'node:crypto';
import { requestKey as githubRequestKey } from '../github/client.js';
import { environmentsIn } from '../github/workflow-env.js';
import { defineGithubWrite } from './define-github-write.js';
import { OUTSIDE_PROJECT } from './protect-guard.js';
import { missing, octo, ownerOf, refusal, slug } from './github-write.js';
import { productionReason } from './production-guard.js';

const OWNER = { type: 'string', maxLength: 39, description: 'GitHub account (default: the connection\'s default account)' };
const REPO = { type: 'string', minLength: 1, maxLength: 100 };
const RUN = { type: 'integer', minimum: 1, description: 'Workflow run id' };
const WORKFLOW = { type: 'string', minLength: 1, maxLength: 250, description: 'Workflow file name (ci.yml) or id' };
const repoTarget = (args, ctx) => ({ owner: ownerOf(args, ctx), repo: args.repo, scope: 'repo' });
const p = (target) => ({ owner: target.owner, repo: target.repo });
const getWorkflow = (ctx, target, workflow) => missing(async () => (await (await octo(ctx, target.owner)).request('GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}', { ...p(target), workflow_id: workflow })).data);
const getRun = (ctx, target, runId) => missing(async () => (await (await octo(ctx, target.owner)).request('GET /repos/{owner}/{repo}/actions/runs/{run_id}', { ...p(target), run_id: runId })).data);

/** The reason a workflow run is production, or null: its file deploys to a production environment, or its ref is production. */
export async function workflowProduction(ctx, target, { path, ref, contentRef }) {
  const octokit = await octo(ctx, target.owner);
  let text;
  try {
    const file = (await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', { ...p(target), path, ref: contentRef ?? ref })).data;
    text = Buffer.from(file.content ?? '', file.encoding === 'base64' ? 'base64' : 'utf8').toString('utf8');
  } catch { return `the workflow file ${path} could not be read at ${ref}, so it is treated as production`; }
  const { names, unknown } = environmentsIn(text);
  if (unknown) return `the workflow ${path} deploys to an environment that cannot be read from the file, so it is treated as production`;
  for (const environment of names) {
    const reason = await productionReason(ctx, { ...p(target), environment, scope: 'repo' });
    if (reason) return `the workflow ${path} deploys to ${reason}`;
  }
  return ref ? productionReason(ctx, { ...p(target), ref, scope: 'repo' }) : null;
}

const setEnabled = defineGithubWrite({
  name: 'github_actions_set_workflow_enabled', area: 'actions', audience: ['B'],
  description: 'Enable or disable a workflow; deployment changes may affect production.',
  properties: { owner: OWNER, repo: REPO, workflow: WORKFLOW, enabled: { type: 'boolean' }, ...OUTSIDE_PROJECT },
  required: ['repo', 'workflow', 'enabled'],
  declarations: { production: 'when-target', profiles: ['full'] },
  target: repoTarget,
  read: async (args, ctx, target) => ({ workflow: await getWorkflow(ctx, target, args.workflow) }),
  classify: async ({ ctx, target, before }) => ({ production: before.workflow ? await workflowProduction(ctx, target, { path: before.workflow.path, ref: undefined }) : null }),
  summarize: ({ args, before, target }) => (before.workflow ? `${args.enabled ? 'Enable' : 'Disable'} workflow ${before.workflow.name} (${before.workflow.path}) in ${slug(target.owner, target.repo)}; it is ${before.workflow.state} now`
    : `There is no workflow ${args.workflow} in ${slug(target.owner, target.repo)}`),
  apply: async ({ args, ctx, target, before }) => {
    if (!before.workflow) throw refusal(`There is no workflow ${args.workflow}.`, 404);
    return (await octo(ctx, target.owner)).request(`PUT /repos/{owner}/{repo}/actions/workflows/{workflow_id}/${args.enabled ? 'enable' : 'disable'}`, { ...p(target), workflow_id: before.workflow.id });
  },
  readAfter: ({ args, ctx, target }) => getWorkflow(ctx, target, args.workflow),
  verify: ({ args, after }) => (args.enabled ? after?.state === 'active' : /^disabled/.test(after?.state ?? '')),
  inverse: ({ args, target, before }) => (before.workflow && (before.workflow.state === 'active') !== args.enabled ? { tool: 'github_actions_set_workflow_enabled', args: { owner: target.owner, repo: target.repo, workflow: args.workflow, enabled: !args.enabled } } : null),
  present: ({ after }) => ({ workflow: after?.name, state: after?.state })
});

const dispatch = defineGithubWrite({
  name: 'github_actions_dispatch', area: 'actions', audience: ['B', 'Op'],
  description: 'Dispatch a workflow on a ref; deployment may require production approval.',
  properties: { owner: OWNER, repo: REPO, workflow: WORKFLOW, ref: { type: 'string', minLength: 1, maxLength: 250, description: 'Branch or tag to run on (always named)' },
    inputs: { type: 'array', maxItems: 25, items: { type: 'object', properties: { name: { type: 'string', maxLength: 100 }, value: { type: 'string', maxLength: 2000 } }, required: ['name', 'value'] }, description: 'Workflow inputs' }, ...OUTSIDE_PROJECT },
  required: ['repo', 'workflow', 'ref'],
  declarations: { production: 'when-target' },
  target: (args, ctx) => ({ ...repoTarget(args, ctx), ref: args.ref }),
  read: async (args, ctx, target) => ({ workflow: await getWorkflow(ctx, target, args.workflow) }),
  classify: async ({ ctx, target, before, args }) => ({ production: before.workflow ? await workflowProduction(ctx, target, { path: before.workflow.path, ref: args.ref }) : null }),
  summarize: ({ args, before, target }) => (before.workflow ? `Start workflow ${before.workflow.name} (${before.workflow.path}) on ${args.ref} in ${slug(target.owner, target.repo)}${args.inputs?.length ? ` with ${args.inputs.length} input(s)` : ''}${before.workflow.state === 'active' ? '' : `; the workflow is ${before.workflow.state}, so GitHub will refuse`}`
    : `There is no workflow ${args.workflow} in ${slug(target.owner, target.repo)}`),
  apply: async ({ args, ctx, target, before }) => {
    if (!before.workflow) throw refusal(`There is no workflow ${args.workflow}.`, 404);
    return (await octo(ctx, target.owner)).request('POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches', { ...p(target), workflow_id: before.workflow.id, ref: args.ref,
      ...(args.inputs?.length ? { inputs: Object.fromEntries(args.inputs.map((i) => [i.name, i.value])) } : {}) });
  },
  readAfter: ({ ctx, target, response }) => (response?.data?.workflow_run_id ? getRun(ctx, target, response.data.workflow_run_id) : null),
  verify: ({ after }) => after !== null && after !== undefined,
  inverse: ({ target, after }) => (after?.id ? { tool: 'github_actions_cancel_run', args: { owner: target.owner, repo: target.repo, runId: after.id } } : null),
  present: ({ after }) => ({ run_id: after?.id, status: after?.status, html_url: after?.html_url })
});

const rerun = defineGithubWrite({
  name: 'github_actions_rerun',
  requestKey: (ctx,args) => args.expectedHeadSha && args.expectedWorkflowId
    ? 'rmcp_github_actions_rerun_' + createHash('sha256').update(JSON.stringify([
      ctx.connection.client_id ?? ctx.connection.pass_id,
      String(args.owner ?? ctx.connection.default_account).toLowerCase(),args.repo.toLowerCase(),
      args.expectedHeadSha,args.expectedWorkflowId])).digest('hex')
    : githubRequestKey(ctx,'github_actions_rerun',args),
  area: 'actions', audience: ['B', 'Op'],
  description: 'Rerun a workflow or failed jobs; production deployment reruns need approval.',
  properties: { owner: OWNER, repo: REPO, runId: RUN, mode: { type: 'string', enum: ['all', 'failed', 'job'], description: 'Default failed' }, jobId: { type: 'integer', minimum: 1, description: 'For mode job' },
    debugLogging: { type: 'boolean', description: 'Turn on step debug logs for this attempt' },
    expectedHeadSha: { type: 'string', pattern: '^[a-fA-F0-9]{40}$' },
    expectedWorkflowId: { type: 'integer', minimum: 1, description: 'Together with expectedHeadSha: one durable failed-job retry for this workflow/head' }, ...OUTSIDE_PROJECT },
  required: ['repo', 'runId'],
  declarations: { production: 'when-target' },
  target: (args, ctx) => {
    if ((args.expectedHeadSha === undefined) !== (args.expectedWorkflowId === undefined) ||
        (args.expectedHeadSha && args.mode !== 'failed'))
      throw new TypeError('Pinned once-only reruns require both expectedHeadSha and expectedWorkflowId and mode failed.');
    if ((args.mode === 'job') !== (args.jobId !== undefined)) throw new TypeError('Give jobId with mode "job", and only then.');
    return repoTarget(args, ctx);
  },
  read: async (args, ctx, target) => {
    const run = await getRun(ctx,target,args.runId);
    if(args.expectedHeadSha && (run?.head_sha !== args.expectedHeadSha || run?.workflow_id !== args.expectedWorkflowId))
      throw refusal('The workflow run identity changed; no retry is authorized by this preview.');
    return {run};
  },
  classify: async ({ args, ctx, target, before }) => ({ production: before.run ? await workflowProduction(ctx, target, { path: before.run.path, ref: before.run.head_branch, contentRef: args.expectedHeadSha }) : null }),
  summarize: ({ args, before, target }) => (before.run ? `Run ${args.mode === 'all' ? 'all jobs of' : args.mode === 'job' ? `job ${args.jobId} of` : 'the failed jobs of'} run ${args.runId} (${before.run.name}, attempt ${before.run.run_attempt}, ${before.run.conclusion ?? before.run.status}) in ${slug(target.owner, target.repo)}`
    : `There is no run ${args.runId} in ${slug(target.owner, target.repo)}`),
  apply: async ({ args, ctx, target, before }) => {
    if (!before.run) throw refusal(`There is no run ${args.runId}.`, 404);
    if (before.run.status !== 'completed') throw refusal(`Run ${args.runId} is still ${before.run.status}. Wait for it to finish, or cancel it, before running it again.`);
    if(args.expectedHeadSha){
      const fresh = await getRun(ctx,target,args.runId);
      if(fresh?.head_sha !== args.expectedHeadSha || fresh?.workflow_id !== args.expectedWorkflowId ||
          fresh?.status !== 'completed' || fresh?.conclusion !== 'failure' || fresh?.run_attempt !== before.run.run_attempt)
        throw refusal('The failed run changed or advanced since preview; no automatic retry was sent.');
    }
    const octokit = await octo(ctx, target.owner);
    const debug = args.debugLogging ? { enable_debug_logging: true } : {};
    if (args.mode === 'job') return octokit.request('POST /repos/{owner}/{repo}/actions/jobs/{job_id}/rerun', { ...p(target), job_id: args.jobId, ...debug });
    return octokit.request(`POST /repos/{owner}/{repo}/actions/runs/{run_id}/${args.mode === 'all' ? 'rerun' : 'rerun-failed-jobs'}`, { ...p(target), run_id: args.runId, ...debug });
  },
  readAfter: ({ args, ctx, target }) => getRun(ctx, target, args.runId),
  verify: ({ before, after }) => after !== null && (after.status !== 'completed' || after.run_attempt > before.run.run_attempt),
  inverse: ({ args, target }) => ({ tool: 'github_actions_cancel_run', args: { owner: target.owner, repo: target.repo, runId: args.runId } }),
  present: ({ before, after }) => ({ run_id: after?.id, attempt: after?.run_attempt, previous_attempt: before.run.run_attempt, status: after?.status })
});

const cancel = defineGithubWrite({
  name: 'github_actions_cancel_run', area: 'actions', audience: ['B', 'Op'],
  description: 'Cancel a run that is still going. Force-cancel (for a stuck run) needs confirm: true.',
  properties: { owner: OWNER, repo: REPO, runId: RUN, force: { type: 'boolean', description: 'Force-cancel a run that ignores a normal cancel' }, ...OUTSIDE_PROJECT },
  required: ['repo', 'runId'],
  declarations: { production: 'never' },
  target: repoTarget,
  read: async (args, ctx, target) => ({ run: await getRun(ctx, target, args.runId) }),
  classify: () => ({}),
  summarize: ({ args, before, target }) => (before.run ? `${args.force ? 'FORCE-cancel' : 'Cancel'} run ${args.runId} (${before.run.name}, ${before.run.status}) in ${slug(target.owner, target.repo)}${before.run.status === 'completed' ? '; it already finished, so nothing will change' : ''}`
    : `There is no run ${args.runId} in ${slug(target.owner, target.repo)}`),
  apply: async ({ args, ctx, target, before }) => {
    if (!before.run) throw refusal(`There is no run ${args.runId}.`, 404);
    if (before.run.status === 'completed') throw refusal(`Run ${args.runId} already finished (${before.run.conclusion}).`);
    if (args.force && args.confirm !== true) throw refusal('Force-cancel can leave jobs half-finished, so it needs confirm: true.');
    return (await octo(ctx, target.owner)).request(`POST /repos/{owner}/{repo}/actions/runs/{run_id}/${args.force ? 'force-cancel' : 'cancel'}`, { ...p(target), run_id: args.runId });
  },
  readAfter: ({ args, ctx, target }) => getRun(ctx, target, args.runId),
  verify: ({ after }) => after !== null && (after.status === 'completed' || after.status === 'in_progress' || after.status === 'queued' || after.conclusion === 'cancelled'),
  present: ({ after }) => ({ run_id: after?.id, status: after?.status, conclusion: after?.conclusion })
});

const deleteRun = defineGithubWrite({
  name: 'github_actions_delete_run', area: 'actions', audience: ['Op'],
  description: 'Delete a finished run, or only its logs. This cannot be undone.',
  properties: { owner: OWNER, repo: REPO, runId: RUN, logsOnly: { type: 'boolean', description: 'Delete only the logs and keep the run record' }, ...OUTSIDE_PROJECT },
  required: ['repo', 'runId'],
  declarations: { production: 'never', confirm: 'always', profiles: ['full'] },
  target: repoTarget,
  read: async (args, ctx, target) => ({ run: await getRun(ctx, target, args.runId) }),
  classify: () => ({}),
  summarize: ({ args, before, target }) => (before.run ? `Permanently delete ${args.logsOnly ? 'the logs of ' : ''}run ${args.runId} (${before.run.name}, ${before.run.conclusion ?? before.run.status}) in ${slug(target.owner, target.repo)}; this cannot be undone`
    : `There is no run ${args.runId} in ${slug(target.owner, target.repo)}`),
  apply: async ({ args, ctx, target, before }) => {
    if (!before.run) throw refusal(`There is no run ${args.runId}.`, 404);
    if (before.run.status !== 'completed') throw refusal(`Run ${args.runId} is still ${before.run.status}; cancel it and let it finish first.`);
    return (await octo(ctx, target.owner)).request(`DELETE /repos/{owner}/{repo}/actions/runs/{run_id}${args.logsOnly ? '/logs' : ''}`, { ...p(target), run_id: args.runId });
  },
  readAfter: async ({ args, ctx, target }) => (args.logsOnly ? { logs: 'deleted' } : ((await getRun(ctx, target, args.runId)) === null ? { run: 'gone' } : { run: 'still there' })),
  verify: ({ args, after }) => (args.logsOnly ? after.logs === 'deleted' : after.run === 'gone'),
  present: ({ args }) => ({ deleted: args.logsOnly ? 'logs' : 'run', run_id: args.runId })
});

const reviewPending = defineGithubWrite({
  name: 'github_actions_review_pending_deployment', area: 'actions', audience: ['Op'],
  description: 'Approve or reject a deployment waiting on an environment. Needs the owner\'s own sign-in: GitHub requires a person.',
  properties: { owner: OWNER, repo: REPO, runId: RUN, environments: { type: 'array', minItems: 1, maxItems: 10, items: { type: 'string', maxLength: 100 }, description: 'Environment names to review' },
    state: { type: 'string', enum: ['approved', 'rejected'] }, comment: { type: 'string', minLength: 1, maxLength: 2000 } },
  required: ['repo', 'runId', 'environments', 'state', 'comment'],
  declarations: { production: 'when-target', confirm: 'always', cred: 'U', profiles: ['full'] },
  target: repoTarget,
  read: async (args, ctx, target) => ({ pending: (await (await octo(ctx, target.owner, 'U')).request('GET /repos/{owner}/{repo}/actions/runs/{run_id}/pending_deployments', { ...p(target), run_id: args.runId })).data }),
  classify: async ({ args, ctx, target }) => {
    for (const environment of args.environments) {
      const reason = await productionReason(ctx, { ...p(target), environment, scope: 'repo' });
      if (reason) return { production: reason };
    }
    return {};
  },
  summarize: ({ args, before, target }) => {
    const ids = before.pending.filter((d) => args.environments.includes(d.environment?.name));
    return ids.length === args.environments.length ? `${args.state === 'approved' ? 'APPROVE' : 'REJECT'} the deployment of run ${args.runId} to ${args.environments.join(', ')} in ${slug(target.owner, target.repo)}: "${redact(args.comment).slice(0, 80)}"`
      : `Run ${args.runId} is not waiting on ${args.environments.filter((n) => !ids.some((d) => d.environment?.name === n)).join(', ')}`;
  },
  apply: async ({ args, ctx, target, before }) => {
    const ids = args.environments.map((name) => before.pending.find((d) => d.environment?.name === name)?.environment?.id);
    if (ids.some((id) => id === undefined)) throw refusal(`Run ${args.runId} is not waiting on every environment named.`);
    if (before.pending.some((d) => args.environments.includes(d.environment?.name) && d.current_user_can_approve === false)) throw refusal('The signed-in owner is not a required reviewer for one of these environments, so GitHub would refuse.');
    return (await octo(ctx, target.owner, 'U')).request('POST /repos/{owner}/{repo}/actions/runs/{run_id}/pending_deployments', { ...p(target), run_id: args.runId, environment_ids: ids, state: args.state, comment: args.comment });
  },
  readAfter: async ({ args, ctx, target }) => (await (await octo(ctx, target.owner, 'U')).request('GET /repos/{owner}/{repo}/actions/runs/{run_id}/pending_deployments', { ...p(target), run_id: args.runId })).data,
  verify: ({ args, after }) => !after.some((d) => args.environments.includes(d.environment?.name)),
  present: ({ args }) => ({ run_id: args.runId, reviewed: args.environments, state: args.state })
});

const defs = [setEnabled, dispatch, rerun, cancel, deleteRun, reviewPending];
export const tools = defs.map((d) => d.tool);
export const handlers = Object.fromEntries(defs.map((d) => [d.tool.name, d.handler]));
