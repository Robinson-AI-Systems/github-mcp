// G-4 deployment writes: dispatch and status updates with the ordinary nine-check
// contract, exact read-back, and production classification using GitHub facts.
import { defineGithubWrite } from './define-github-write.js';
import { missing, octo, ownerOf, refusal, slug } from './github-write.js';
import { productionReason } from './production-guard.js';

const OWNER = { type: 'string', maxLength: 39 };
const REPO = { type: 'string', minLength: 1, maxLength: 100 };
const REF = { type: 'string', minLength: 1, maxLength: 250 };
const ENV = { type: 'string', minLength: 1, maxLength: 100 };
const GET = 'GET /repos/{owner}/{repo}/deployments/{deployment_id}';
const CREATE = 'POST /repos/{owner}/{repo}/deployments';
const DELETE = 'DELETE /repos/{owner}/{repo}/deployments/{deployment_id}';
const STATUS = 'POST /repos/{owner}/{repo}/deployments/{deployment_id}/statuses';
const STATUSES = 'GET /repos/{owner}/{repo}/deployments/{deployment_id}/statuses';
const params = (t, id) => ({ owner: t.owner, repo: t.repo, ...(id ? { deployment_id: id } : {}) });
const get = async (ctx, t, id) => missing(async () =>
  (await (await octo(ctx, t.owner)).request(GET, params(t, id))).data);
const classify = async (ctx, t) => {
  const reason = await productionReason(ctx, t);
  return reason || (t.productionFlag ? 'this deployment is explicitly marked production' : null);
};
const environmentTarget = (args, ctx) => ({
  owner: ownerOf(args, ctx), repo: args.repo, ref: args.ref, environment: args.environment,
  productionFlag: args.productionEnvironment === true, scope: 'repo'
});
const readStatuses = async (ctx, t, id) =>
  (await (await octo(ctx, t.owner)).request(STATUSES, { ...params(t, id), per_page: 100, page: 1 })).data;

const deployCreate = defineGithubWrite({
  name: 'github_deploy_create', area: 'deploy', audience: ['B'],
  description: 'Create a deployment without auto-merging branches.',
  properties: {
    owner: OWNER, repo: REPO, ref: REF, environment: ENV,
    task: { type: 'string', minLength: 1, maxLength: 100 },
    description: { type: 'string', maxLength: 500 },
    transientEnvironment: { type: 'boolean' },
    productionEnvironment: { type: 'boolean' },
    requiredContexts: { type: 'array', minItems: 1, maxItems: 30, items: { type: 'string', minLength: 1, maxLength: 100 } }
  },
  required: ['repo', 'ref', 'environment'],
  declarations: { production: 'when-target', confirm: 'always', profiles: ['everyday', 'full'] },
  target: environmentTarget,
  read: async (_args, ctx, t) => ({
    repo: await missing(async () => (await (await octo(ctx, t.owner)).request(
      'GET /repos/{owner}/{repo}', params(t))).data)
  }),
  classify: async ({ ctx, target: t }) => ({ production: await classify(ctx, t) }),
  summarize: ({ args, before, target: t }) => before.repo
    ? `Request deployment of "${args.ref}" to "${args.environment}" in ${slug(t.owner, t.repo)}. GitHub will not auto-merge; required checks stay enabled. This dispatches a deployment event and cannot be rolled back automatically.`
    : `The repository ${slug(t.owner, t.repo)} does not exist.`,
  apply: async ({ args, before, ctx, target: t }) => {
    if (!before.repo) throw refusal('Repository not found.', 404);
    return (await octo(ctx, t.owner)).request(CREATE, {
      ...params(t), ref: args.ref, environment: args.environment,
      auto_merge: false, ...(args.task ? { task: args.task } : {}),
      ...(args.description ? { description: args.description } : {}),
      ...(args.transientEnvironment !== undefined ? { transient_environment: args.transientEnvironment } : {}),
      ...(args.productionEnvironment !== undefined ? { production_environment: args.productionEnvironment } : {}),
      ...(args.requiredContexts ? { required_contexts: args.requiredContexts } : {})
    });
  },
  readAfter: async ({ ctx, target: t, response }) =>
    response.status === 201 && Number.isInteger(response.data?.id)
      ? get(ctx, t, response.data.id) : null,
  verify: ({ args, after }) => !!after && after.ref === args.ref &&
    after.environment === args.environment && !!after.id,
  inverse: () => null,
  present: ({ after, response }) => ({
    ...(after ? { deployment_id: after.id, ref: after.ref, environment: after.environment,
      html_url: after.html_url } : { created: false, status: response?.status ?? null,
      note: 'No deployment ID was verified; a 202 response may mean GitHub only merged a branch. Do not replay blindly.' })
  })
});

const statusTarget = (args, ctx) => ({ owner: ownerOf(args, ctx), repo: args.repo,
  deploymentId: args.deploymentId, scope: 'repo' });

const deployStatus = defineGithubWrite({
  name: 'github_deploy_set_status', area: 'deploy', audience: ['B'],
  description: 'Set status from the recorded deployment ref and environment.',
  properties: {
    owner: OWNER, repo: REPO, deploymentId: { type: 'integer', minimum: 1 },
    state: { type: 'string', enum: ['error', 'failure', 'pending', 'in_progress', 'queued', 'success', 'inactive'] },
    description: { type: 'string', maxLength: 140 },
    targetUrl: { type: 'string', maxLength: 500 },
    logUrl: { type: 'string', maxLength: 500 },
    environmentUrl: { type: 'string', maxLength: 500 },
    autoInactive: { type: 'boolean' }
  },
  required: ['repo', 'deploymentId', 'state'],
  declarations: { production: 'when-target', profiles: ['everyday', 'full'] },
  target: statusTarget,
  read: async (args, ctx, t) => ({ deployment: await get(ctx, t, args.deploymentId) }),
  classify: async ({ ctx, before, target: t }) => ({
    production: before.deployment
      ? await classify(ctx, { ...t, ref: before.deployment.ref, environment: before.deployment.environment,
        productionFlag: before.deployment.production_environment === true })
      : 'the deployment could not be found or its production status checked'
  }),
  summarize: ({ args, before, target: t }) => before.deployment
    ? `Set deployment ${args.deploymentId} (${before.deployment.ref} → ${before.deployment.environment}) in ${slug(t.owner, t.repo)} to "${args.state}". This emits a deployment_status event and is not reversible.`
    : `Deployment ${args.deploymentId} does not exist in ${slug(t.owner, t.repo)}.`,
  apply: async ({ args, before, ctx, target: t }) => {
    if (!before.deployment) throw refusal('Deployment not found.', 404);
    return (await octo(ctx, t.owner)).request(STATUS, {
      ...params(t, args.deploymentId), state: args.state,
      ...(args.description ? { description: args.description } : {}),
      ...(args.targetUrl ? { target_url: args.targetUrl } : {}),
      ...(args.logUrl ? { log_url: args.logUrl } : {}),
      ...(args.environmentUrl ? { environment_url: args.environmentUrl } : {}),
      ...(args.autoInactive !== undefined ? { auto_inactive: args.autoInactive } : {})
    });
  },
  readAfter: async ({ args, ctx, target: t, response }) => {
    if (!Number.isInteger(response.data?.id)) return null;
    const statuses = await readStatuses(ctx, t, args.deploymentId);
    return statuses.find((x) => x.id === response.data.id) ?? null;
  },
  verify: ({ args, after }) => !!after && after.state === args.state &&
    (!args.description || after.description === args.description) &&
    (!args.targetUrl || after.target_url === args.targetUrl) &&
    (!args.logUrl || after.log_url === args.logUrl) &&
    (!args.environmentUrl || after.environment_url === args.environmentUrl),
  inverse: () => null,
  present: ({ args, after }) => ({ deployment_id: args.deploymentId, status_id: after?.id,
    state: after?.state, confirmed: !!after })
});

// CAP-7 M2: the family's missing symmetry leg (create existed, delete did not). Confirmation
// discipline mirrors github_actions_delete_run: always confirm, refuse before the call when the
// record is absent or not yet deletable, and verify from an independent read-back that it is gone.
// GitHub only deletes an inactive deployment, so an active latest status is refused up front with
// the one call that fixes it instead of surfacing GitHub's 422 after confirmation.
const deployDelete = defineGithubWrite({
  name: 'github_deploy_delete', area: 'deploy', audience: ['B'],
  description: 'Delete a deployment record permanently. The deployment must be inactive first (set its status to inactive). This cannot be undone.',
  properties: {
    owner: OWNER, repo: REPO, deploymentId: { type: 'integer', minimum: 1 }
  },
  required: ['repo', 'deploymentId'],
  declarations: { production: 'when-target', confirm: 'always', profiles: ['everyday', 'full'] },
  target: statusTarget,
  read: async (args, ctx, t) => {
    const deployment = await get(ctx, t, args.deploymentId);
    const statuses = deployment ? await readStatuses(ctx, t, args.deploymentId) : [];
    return { deployment, latest: statuses[0] ?? null };
  },
  // A missing deployment classifies as not-production: there is nothing to delete, apply refuses
  // 404 before any write, and a replayed delete (whose record is gone because it succeeded) must
  // still reach its stored receipt instead of tripping the production guard.
  classify: async ({ ctx, before, target: t }) => ({
    production: before.deployment
      ? await classify(ctx, { ...t, ref: before.deployment.ref, environment: before.deployment.environment,
        productionFlag: before.deployment.production_environment === true })
      : null
  }),
  summarize: ({ args, before, target: t }) => before.deployment
    ? `Permanently delete deployment ${args.deploymentId} (${before.deployment.ref} → ${before.deployment.environment}) in ${slug(t.owner, t.repo)}; this cannot be undone`
    : `Deployment ${args.deploymentId} does not exist in ${slug(t.owner, t.repo)}`,
  apply: async ({ args, before, ctx, target: t }) => {
    if (!before.deployment) throw refusal('Deployment not found.', 404);
    if (before.latest && before.latest.state !== 'inactive')
      throw refusal(`Deployment ${args.deploymentId} is still "${before.latest.state}"; GitHub only deletes inactive deployments. Set its status to inactive with github_deploy_set_status first, then delete it.`);
    return (await octo(ctx, t.owner)).request(DELETE, params(t, args.deploymentId));
  },
  readAfter: async ({ args, ctx, target: t }) =>
    (await get(ctx, t, args.deploymentId)) ? { deployment: 'still there' } : { deployment: 'gone' },
  verify: ({ after }) => after?.deployment === 'gone',
  inverse: () => null,
  present: ({ args, before }) => ({ deleted: true, deployment_id: args.deploymentId,
    environment: before.deployment?.environment, ref: before.deployment?.ref })
});

const defs = [deployCreate, deployStatus, deployDelete];
export const tools = defs.map((d) => d.tool);
export const handlers = Object.fromEntries(defs.map((d) => [d.tool.name, d.handler]));
