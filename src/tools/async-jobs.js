import { redact } from './util.js';
// Slow GitHub operations (Y-8): a tool that starts one hands back a job id at once; github_job_status asks GitHub ONE question per call and
// never waits or loops, so no request is held open. The finished result is kept as an ordinary result handle (github_get_result).
import { randomBytes } from 'node:crypto';
import { JOB_ID } from '../db.js';
import { GithubClientError } from '../github/errors.js';
import { downloadPublicAsset } from '../github/public-url.js';
import { defineGithubWrite } from './define-github-write.js';
import { defineRead } from './define-read.js';
import { plain, readerFor } from './github-read.js';

const SBOM_REPORT = 50 * 1024 * 1024;
const SBOM_UUID = /^[0-9a-fA-F-]{8,64}$/;
export const jobClient = (ctx) => ctx.connection.client_id;

/** Records a new pending job for this connection and returns its public view. */
export async function startJob(ctx, { kind, owner, repo = null, providerRef, ttlMinutes = 1440 }) {
  const id = `job_${randomBytes(8).toString('hex')}`;
  await ctx.db.createJob({ id, connection: jobClient(ctx), owner, repo, kind, providerRef, ttlMinutes });
  return { job_id: id, state: 'pending', kind, next: 'Call github_job_status with this job_id in a little while (about 10 seconds or more).' };
}

// One poller per kind. A poller makes at most one GitHub call and answers { state:'pending' }, { state:'ready', body, summary } or { state:'failed', detail }.
const POLLERS = {
  async autofix({ job, ctx }) {
    const { octokit } = await readerFor({ owner: job.owner }, ctx);
    const fix = (await octokit.request('GET /repos/{owner}/{repo}/code-scanning/alerts/{alert_number}/autofix', { owner: job.owner, repo: job.repo, alert_number: Number(job.provider_ref) })).data;
    if (fix.status === 'pending') return { state: 'pending' };
    if (fix.status === 'success') return { state: 'ready', body: { alert: Number(job.provider_ref), status: fix.status, description: fix.description, started_at: fix.started_at }, summary: `Autofix for alert ${job.provider_ref}` };
    return { state: 'failed', detail: fix.status === 'outdated' ? 'The suggested fix is outdated; start a new one.' : `GitHub could not produce a fix (${redact(String(fix.status)).slice(0, 40)}).` };
  },
  async sbom_report({ job, ctx }) {
    if (!SBOM_UUID.test(job.provider_ref)) return { state: 'failed', detail: 'The saved report id is not valid.' };
    const { octokit } = await readerFor({ owner: job.owner }, ctx);
    const response = await octokit.request('GET /repos/{owner}/{repo}/dependency-graph/sbom/fetch-report/{sbom_uuid}', { owner: job.owner, repo: job.repo, sbom_uuid: job.provider_ref, request: { redirect: 'manual' } });
    if (response.status === 202) return { state: 'pending' };
    const location = response.headers?.location;
    if (!location) return { state: 'failed', detail: 'GitHub finished the report but gave no place to read it.' };
    const { bytes } = await downloadPublicAsset(location, { maxBytes: SBOM_REPORT });
    let parsed;
    try { parsed = JSON.parse(bytes.toString('utf8')); } catch { return { state: 'failed', detail: 'The report was not readable JSON.' }; }
    return { state: 'ready', body: sbomSummary(parsed), summary: `SBOM report for ${job.owner}/${job.repo}` };
  }
};

/** The parts list of an SPDX document, trimmed to name and version (the raw document is large and mostly repeated text). */
export function sbomSummary(doc, max = 500) {
  const sbom = doc?.sbom ?? doc ?? {};
  const packages = Array.isArray(sbom.packages) ? sbom.packages : [];
  return { spdxVersion: sbom.spdxVersion ?? null, name: sbom.name ?? null, created: sbom.creationInfo?.created ?? null, package_count: packages.length,
    packages: packages.slice(0, max).map((p) => ({ name: p.name ?? null, version: p.versionInfo ?? null, license: p.licenseConcluded ?? null })), ...(packages.length > max ? { more_exist: true } : {}) };
}

const view = (job) => ({ job_id: job.id, kind: job.kind, state: job.state, ...(job.repo ? { repo: `${job.owner}/${job.repo}` } : {}), ...(job.detail ? { detail: job.detail } : {}),
  ...(job.result_handle ? { result_handle: job.result_handle, how: 'Read the result with github_get_result using this handle.' } : {}) });

/** Looks at a job once. Asks GitHub at most once, and not more than once every few seconds. */
export async function pollJob(ctx, id) {
  if (!JOB_ID.test(id ?? '')) throw new TypeError('A job id looks like job_ followed by 16 letters and digits.');
  const job = await ctx.db.getJob(id, jobClient(ctx));
  if (!job) throw new TypeError('There is no such job for this connection (it may have expired).');
  if (job.state !== 'pending') return view(job);
  const poller = POLLERS[job.kind];
  if (!poller) { const done = await ctx.db.finishJob(id, jobClient(ctx), { state: 'failed', detail: 'This kind of job is no longer supported.' }); return view(done ?? job); }
  if (!(await ctx.db.claimJobPoll(id, jobClient(ctx), 10))) return { ...view(job), note: 'Checked a moment ago; ask again in about 10 seconds.' };
  let outcome;
  try { outcome = await poller({ job, ctx }); } catch (error) {
    if (error instanceof TypeError) throw error;
    throw new TypeError(error instanceof GithubClientError ? error.message : 'GitHub could not be asked right now; the job is still waiting. Try again shortly.');
  }
  if (outcome.state === 'pending') return view(job);
  let resultHandle = null;
  if (outcome.state === 'ready') {
    resultHandle = `res_${randomBytes(16).toString('base64url')}`;
    await ctx.db.putResult({ handle: resultHandle, connection: jobClient(ctx), summary: outcome.summary ?? null, body: outcome.body });
  }
  const done = await ctx.db.finishJob(id, jobClient(ctx), { state: outcome.state, resultHandle, detail: outcome.detail ?? null });
  return view(done ?? job);
}

const status = defineRead({
  name: 'github_job_status', area: 'job', audience: ['B', 'Op'],
  description: 'Check a slow job you started: pending, ready (with a result handle) or failed. Asks GitHub once; never waits.',
  properties: { job_id: { type: 'string', maxLength: 30, description: 'The job_id you were given' } }, required: ['job_id'],
  guidance: 'Jobs last 24 hours. Ask again after about 10 seconds if the answer is pending.',
  handler: (args, ctx) => plain(() => pollJob(ctx, args.job_id))
});

const cancel = defineGithubWrite({
  name: 'github_job_cancel', area: 'job', audience: ['B', 'Op'],
  description: 'Stop tracking a pending slow job. GitHub may still finish its own work; only this server forgets it.',
  properties: { job_id: { type: 'string', maxLength: 30, description: 'The job_id you were given' } }, required: ['job_id'],
  declarations: { production: 'never', cred: '—', profiles: ['full'] },
  target: (args, ctx) => { if (!JOB_ID.test(args.job_id ?? '')) throw new TypeError('A job id looks like job_ followed by 16 letters and digits.'); return { owner: ctx.connection.default_account, scope: 'server' }; },
  read: async (args, ctx) => { const job = await ctx.db.getJob(args.job_id, jobClient(ctx)); return job ? { state: job.state, kind: job.kind } : null; },
  classify: () => ({}),
  summarize: ({ before }) => (before ? (before.state === 'pending' ? `Stop tracking this ${before.kind} job` : `This job is already ${before.state}`) : 'There is no such job for this connection'),
  apply: async ({ args, ctx, before }) => {
    if (!before) throw new GithubClientError('outside_scope', 'There is no such job for this connection.', { job: args.job_id });
    if (before.state !== 'pending') throw new GithubClientError('outside_scope', `The job is already ${before.state}.`, { job: args.job_id });
    await ctx.db.finishJob(args.job_id, jobClient(ctx), { state: 'failed', detail: 'Stopped by you.' });
  },
  readAfter: async ({ args, ctx }) => (await ctx.db.getJob(args.job_id, jobClient(ctx)))?.state ?? null,
  verify: ({ after }) => after === 'failed',
  present: ({ args }) => ({ stopped: args.job_id })
});

export const tools = [status.tool, cancel.tool];
export const handlers = { [status.tool.name]: status.handler, [cancel.tool.name]: cancel.handler };
