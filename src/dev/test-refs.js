import { isOwnerConnection } from '../core/authority.js';
// V-3 shared guards for run-owned test refs on any allowed repository. A V-3 run is a plain run (no seed
// scenario) bound to ONE host repository; fixture ref/ownership restrictions remain, and it
// stops before the cleanup inventory (50 rows) could become truncated.
import { RUN_ID } from './ledger.js';
import { missing, octo, refusal } from '../tools/github-write.js';

export const MAX_TEST_OBJECTS = 40;
export const TEST_NAME = /^[a-z][a-z0-9-]{0,40}$/;
export const SHA = /^[a-f0-9]{40}$/;
const eq = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();

export const branchOf = (runId, name) => `rtc/${runId}/${name}`;
export const fileOf = (runId, name) => `rtc/${runId}/${name}.md`;
// GitHub label names stop at 50 characters; "rtc-run-" plus the run ID must fit.
export const labelOf = (runId) => `rtc-run-${runId}`;
export function assertRunName(runId) {
  if (!RUN_ID.test(runId ?? '') || labelOf(runId).length > 50) {
    throw new TypeError('Run IDs for test refs are 3–42 lowercase letters, digits or hyphens, starting with a letter.');
  }
}
export function previewOnly(ctx) {
  if (!isOwnerConnection(ctx.connection) && ctx.connection?.mode !== 'preview') throw new TypeError('Developer tools never change production connections.');
}
export const runIdentity = (ctx, { owner, repo, runId }) => ({
  runId, account: owner, connection: ctx.connection.client_id, owner, repo
});

/**
 * Read the host repository and the run's recorded state. Refuses a run bound to a seed scenario or to a
 * different repository, an inactive run, an archived host, and a run that has no room left to be cleaned up.
 */
export async function readTestRun(ctx, { owner, repo, runId, needRoom = 1 }) {
  previewOnly(ctx);
  if (!ctx.connection.accounts?.some((a) => eq(a, owner))) throw new TypeError('The account is not in this connection.');
  const connection = ctx.connection.client_id;
  const [run, host] = await Promise.all([
    ctx.db.getDevRun({ id: runId, account: owner, connection }),
    missing(async () => (await (await octo(ctx, owner)).request('GET /repos/{owner}/{repo}', { owner, repo })).data)
  ]);
  if (!host) throw refusal(`There is no repository ${owner}/${repo}.`, 404);
  if (!eq(host.full_name, `${owner}/${repo}`) || host.archived || host.disabled) {
    throw refusal('The host repository is archived, disabled or not the expected one.');
  }
  let objects = [];
  if (run) {
    if (run.status !== 'active') throw refusal('This run is no longer active; start a new run.');
    if (run.scenarios?.length) throw refusal('This run belongs to a seeded scenario; test refs need their own run.');
    objects = await ctx.db.listDevObjects({ runId, account: owner, connection, limit: 50 });
    if (objects.some((o) => o.repo != null && !eq(o.repo, repo))) {
      throw refusal('A run keeps its test refs in exactly one repository.');
    }
    if (objects.length + needRoom > MAX_TEST_OBJECTS) {
      throw refusal(`A run holds at most ${MAX_TEST_OBJECTS} recorded objects so cleanup can always list them all; start a new run.`);
    }
  }
  return { host, run, objects };
}
export const recorded = (objects, type, id, repo) => objects.find((o) => o.object_type === type && o.object_id === id && eq(o.repo, repo));

// A guard that says "no" is reported in plain words (preview and apply), not as an unreadable state.
export async function deniable(fn) {
  try { return await fn(); } catch (error) {
    if (error instanceof TypeError || error?.status === 404 || error?.status === 422) return { denied: String(error.message) };
    throw error;
  }
}
