import {createHash} from 'node:crypto';
import {redactExcerpt} from '../github/content-protection.js';
// GitHub Actions, read side (G-1 part 1): workflows, runs, one run with its jobs, job and run log summaries, runs waiting for approval.
// Logs are summarised, never dumped (BATCH-G G1): failed steps first, error lines, the last lines; the rest stays on GitHub.
import { readZip, summarizeLog, textOfBody } from '../github/log-summary.js';
import { defineRead } from './define-read.js';
import { plain, readerFor } from './github-read.js';

const OWNER = { type: 'string', maxLength: 39, description: 'GitHub account (default: the connection\'s default account)' };
const REPO = { type: 'string', minLength: 1, maxLength: 100 };
const RUN = { type: 'integer', minimum: 1, description: 'Workflow run id' };
const MAX = { type: 'integer', minimum: 1, maximum: 300, description: 'Default 30' };
const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;
/** Pages a GitHub list that wraps its items in an object (`{ total_count, workflow_runs: [...] }`) by page number, up to `max` items. */
async function listWrapped(octokit, route, params, key, max) {
  const items = [];
  let total = null;
  for (let page = 1; items.length < max; page += 1) {
    const data = (await octokit.request(route, { ...params, per_page: 100, page })).data;
    total = data.total_count ?? total;
    const batch = data?.[key] ?? [];
    items.push(...batch);
    if (batch.length < 100 || items.length >= (data.total_count ?? Infinity)) break;
  }
  return { items: items.slice(0, max), capped: items.length > max || (total !== null && total > items.length) };
}
const jobBrief = (j) => ({ id: j.id, name: j.name, status: j.status, conclusion: j.conclusion, started_at: j.started_at, completed_at: j.completed_at, runner: j.runner_name,
  failed_steps: (j.steps ?? []).filter((s) => s.conclusion === 'failure').map((s) => ({ number: s.number, name: s.name })), html_url: j.html_url,
  check_run_id: /\/check-runs\/(\d+)$/.test(j.check_run_url ?? '') ? Number(j.check_run_url.match(/\/check-runs\/(\d+)$/)[1]) : null });

export const actionsListWorkflows = defineRead({
  name: 'github_actions_list_workflows', area: 'actions', audience: ['B', 'Op'], summaryType: 'workflow',
  description: 'Workflows of a repository with their state and file path.',
  properties: { owner: OWNER, repo: REPO, max: MAX }, required: ['repo'],
  handler: (args, ctx) => plain(async () => {
    const { owner, octokit } = await readerFor(args, ctx);
    const { items, capped } = await listWrapped(octokit, 'GET /repos/{owner}/{repo}/actions/workflows', { owner, repo: args.repo }, 'workflows', args.max ?? 30);
    return { count: items.length, ...(capped ? { more_exist: true } : {}), items };
  })
});

export const actionsListRuns = defineRead({
  name: 'github_actions_list_runs', area: 'actions', audience: ['B', 'Op'], summaryType: 'run',
  description: 'Workflow runs, newest first; filter by workflow, branch, event, status, actor or head commit.',
  properties: { owner: OWNER, repo: REPO, workflow: { type: 'string', maxLength: 250, description: 'Workflow file name (ci.yml) or id' }, branch: { type: 'string', maxLength: 250 },
    event: { type: 'string', maxLength: 50 }, status: { type: 'string', maxLength: 30, description: 'queued, in_progress, completed, waiting, success, failure, cancelled …' },
    actor: { type: 'string', maxLength: 39 }, headSha: { type: 'string', minLength: 7, maxLength: 40 }, max: MAX },
  required: ['repo'],
  handler: (args, ctx) => plain(async () => {
    const { owner, octokit } = await readerFor(args, ctx);
    const filters = { ...(args.branch ? { branch: args.branch } : {}), ...(args.event ? { event: args.event } : {}), ...(args.status ? { status: args.status } : {}),
      ...(args.actor ? { actor: args.actor } : {}), ...(args.headSha ? { head_sha: args.headSha } : {}) };
    const route = args.workflow ? 'GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs' : 'GET /repos/{owner}/{repo}/actions/runs';
    const { items, capped } = await listWrapped(octokit, route, { owner, repo: args.repo, ...(args.workflow ? { workflow_id: args.workflow } : {}), ...filters }, 'workflow_runs', args.max ?? 30);
    return { count: items.length, ...(capped ? { more_exist: true } : {}), items };
  })
});

export const actionsGetRun = defineRead({
  name: 'github_actions_get_run', area: 'actions', audience: ['B', 'Op'],
  description: 'One workflow run: status, conclusion, attempt, timing, and every job with its failed steps.',
  properties: { owner: OWNER, repo: REPO, runId: RUN }, required: ['repo', 'runId'],
  handler: (args, ctx) => plain(async () => {
    const { owner, octokit } = await readerFor(args, ctx);
    const p = { owner, repo: args.repo, run_id: args.runId };
    const run = (await octokit.request('GET /repos/{owner}/{repo}/actions/runs/{run_id}', p)).data;
    const { items: jobs, capped } = await listWrapped(octokit, 'GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs', { ...p, filter: 'latest' }, 'jobs', 100);
    return { id: run.id, workflow_id: run.workflow_id, path: run.path, jobs_complete: !capped, name: run.name, title: run.display_title, event: run.event, status: run.status, conclusion: run.conclusion, branch: run.head_branch, head_sha: run.head_sha,
      run_number: run.run_number, run_attempt: run.run_attempt, actor: run.actor?.login, created_at: run.created_at, updated_at: run.updated_at, html_url: run.html_url, jobs: jobs.map(jobBrief) };
  })
});

export const actionsGetJobLog = defineRead({
  name: 'github_actions_get_job_log', area: 'actions', audience: ['B', 'Op'],
  description: 'Read a job log summary or full redacted text in hash-pinned character windows; no missing earlier lines.',
  aliases: {jobId:['job_id']},
  properties: { owner: OWNER, repo: REPO, jobId: { type: 'integer', minimum: 1 }, tailLines: { type: 'integer', minimum: 10, maximum: 2000, description: 'Last lines to keep (default 400)' },
    fullText:{type:'boolean',description:'Return a redacted log window instead of the tail summary.'},
    textOffset:{type:'integer',minimum:0},maxChars:{type:'integer',minimum:1,maximum:4000},
    expectedLogHash:{type:'string',pattern:'^[a-f0-9]{64}$'} },
  required: ['repo', 'jobId'],
  handler: (args, ctx) => plain(async () => {
    const { owner, octokit } = await readerFor(args, ctx);
    const p = { owner, repo: args.repo, job_id: args.jobId };
    const job = (await octokit.request('GET /repos/{owner}/{repo}/actions/jobs/{job_id}', p)).data;
    const res = await octokit.request('GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs', p);
    const text=textOfBody(res.data);
    if(args.fullText===true){
      if(args.tailLines!==undefined)throw new TypeError('fullText cannot be combined with tailLines.');
      if(Buffer.byteLength(text)>50*1024*1024)throw new TypeError('This log exceeds the 50 MB complete-read limit.');
      const safe=redactExcerpt(text).replace(/[A-Za-z0-9+/=]{200,}/g,'[long encoded text removed]'),hash=createHash('sha256').update(safe).digest('hex'),offset=args.textOffset??0;
      if(offset>safe.length || ((offset>0||args.expectedLogHash!==undefined)&&args.expectedLogHash!==hash))
        throw new TypeError('Log hash changed or is missing for continuation; restart at textOffset zero.');
      const end=Math.min(safe.length,offset+(args.maxChars??4000));
      return {job:jobBrief(job),text:safe.slice(offset,end),text_offset:offset,next_text_offset:end,total_chars:safe.length,
        complete:end===safe.length,log_hash:hash,redacted:true,byte_exact_available:false,untrusted:true};
    }
    if(args.textOffset!==undefined||args.maxChars!==undefined||args.expectedLogHash!==undefined)
      throw new TypeError('Log continuation requires fullText:true.');
    const summary = summarizeLog(text, { tailLines: args.tailLines ?? 400 });
    return { job: jobBrief(job), failed_steps_first: jobBrief(job).failed_steps, ...summary };
  })
});

export const actionsGetRunLogsSummary = defineRead({
  name: 'github_actions_get_run_logs_summary', area: 'actions', audience: ['B', 'Op'],
  description: 'Why a run failed: for each failed job, the failing steps and their error lines, read from the run\'s log archive.',
  aliases:{runId:['run_id']},
  properties: { owner: OWNER, repo: REPO, runId: RUN }, required: ['repo', 'runId'],
  handler: (args, ctx) => plain(async () => {
    const { owner, octokit } = await readerFor(args, ctx);
    const p = { owner, repo: args.repo, run_id: args.runId };
    const { items: jobs, capped } = await listWrapped(octokit, 'GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs', { ...p, filter: 'latest' }, 'jobs', 100);
    const failed = jobs.filter((j) => j.conclusion === 'failure' || (j.steps ?? []).some((s) => s.conclusion === 'failure'));
    if (!failed.length) return { run_id: args.runId, jobs_complete:!capped, failed_jobs: [], note: capped?'No failure was found in the incomplete job inventory.':'No job in this run failed.' };
    let entries=[],archiveReadable=false;
    try{
      const res = await octokit.request('GET /repos/{owner}/{repo}/actions/runs/{run_id}/logs', p);
      const bytes = res.data instanceof ArrayBuffer || ArrayBuffer.isView(res.data) ? res.data : Buffer.from(String(res.data ?? ''), 'binary');
      if ((bytes.byteLength ?? bytes.length) <= MAX_ARCHIVE_BYTES){entries=readZip(bytes);archiveReadable=true;}
    }catch{/* Read each exact failed job rather than pretending an unavailable archive was empty. */}
    return { run_id: args.runId, jobs_complete:!capped,archive_readable:archiveReadable, failed_jobs: await Promise.all(failed.map(async (job) => {
      const steps = (job.steps ?? []).filter((s) => s.conclusion === 'failure');
      const mine = entries.filter((e) => e.name.startsWith(`${job.name}/`) || e.name.endsWith(`_${job.name}.txt`) || e.name === `${job.name}.txt`);
      const onStep = mine.filter((e) => steps.some((s) => e.name.includes(s.name)));
      let errors = [...new Set((onStep.length ? onStep : mine).flatMap((e) => summarizeLog(e.text, { tailLines: 1, maxErrors: 40 }).errors))].slice(0, 40);
      let source=mine.length?'archive':'unavailable';
      if(!errors.length){
        try{const direct=await octokit.request('GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs',{owner,repo:args.repo,job_id:job.id});
          const summary=summarizeLog(textOfBody(direct.data),{tailLines:20});errors=summary.errors.length?summary.errors:summary.tail;source='job_log';}
        catch{/* Never attribute another job's output or invent an empty successful diagnostic. */}
      }
      return { ...jobBrief(job), error_lines: errors, logs_source:source,logs_readable:source!=='unavailable',
        full_log:{tool:'github_actions_get_job_log',args:{owner,repo:args.repo,jobId:job.id,fullText:true}},
        ...(!errors.length?{note:'No diagnostic lines were readable. Read this exact job log; absence is not a successful run.'}:{}) };
    })) };
  })
});

export const actionsListPendingDeployments = defineRead({
  name: 'github_actions_list_pending_deployments', area: 'actions', audience: ['Op'],
  description: 'Runs waiting for someone to approve a deployment, with the environment each is waiting on.',
  properties: { owner: OWNER, repo: REPO }, required: ['repo'],
  handler: (args, ctx) => plain(async () => {
    const { owner, octokit } = await readerFor(args, ctx);
    const { items: runs } = await listWrapped(octokit, 'GET /repos/{owner}/{repo}/actions/runs', { owner, repo: args.repo, status: 'waiting' }, 'workflow_runs', 20);
    const waiting = [];
    for (const run of runs) {
      const pending = (await octokit.request('GET /repos/{owner}/{repo}/actions/runs/{run_id}/pending_deployments', { owner, repo: args.repo, run_id: run.id })).data;
      waiting.push({ run_id: run.id, name: run.name, branch: run.head_branch, html_url: run.html_url,
        environments: pending.map((d) => ({ id: d.environment?.id, name: d.environment?.name, current_user_can_approve: d.current_user_can_approve, wait_timer: d.wait_timer, reviewers: (d.reviewers ?? []).map((r) => r.reviewer?.login ?? r.reviewer?.slug) })) });
    }
    return { count: waiting.length, items: waiting };
  })
});

const defs = [actionsListWorkflows, actionsListRuns, actionsGetRun, actionsGetJobLog, actionsGetRunLogsSummary, actionsListPendingDeployments];
export const tools = defs.map((d) => d.tool);
export const handlers = Object.fromEntries(defs.map((d) => [d.tool.name, d.handler]));
