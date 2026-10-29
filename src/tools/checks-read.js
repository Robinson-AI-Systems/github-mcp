// Checks, artifacts and caches, read side (G-2 part 1). CI state is the shared helper of Batch E exposed as a tool. Artifact bytes never
// pass through a tool: only a short-lived link does.
import { ciState } from '../github/ci-state.js';
import { defineRead } from './define-read.js';
import { plain, readerFor } from './github-read.js';
import { githubDownloadPage, safeGithubDownloadRedirect } from './safe-download-link.js';

const OWNER = { type: 'string', maxLength: 39, description: 'GitHub account (default: the connection\'s default account)' };
const REPO = { type: 'string', minLength: 1, maxLength: 100 };
const MAX = { type: 'integer', minimum: 1, maximum: 300, description: 'Default 30' };

/** Pages a GitHub list that wraps its items in an object, by page number, up to `max` items. */
async function listWrapped(octokit, route, params, key, max) {
  const items = [];
  for (let page = 1; items.length < max; page += 1) {
    const data = (await octokit.request(route, { ...params, per_page: 100, page })).data;
    const batch = data?.[key] ?? [];
    items.push(...batch);
    if (batch.length < 100 || items.length >= (data.total_count ?? Infinity)) break;
  }
  return { items: items.slice(0, max), capped: items.length > max };
}

export const checkGetCiState = defineRead({
  name: 'github_check_get_ci_state', area: 'check', audience: ['B', 'Op'],
  description: 'Read exact-head checks, required policy and missing-check reasons for a PR or commit.',
  properties: { owner: OWNER, repo: REPO, pr: { type: 'integer', minimum: 1, description: 'Pull request number (uses its head and base)' },
    ref: { type: 'string', minLength: 1, maxLength: 250, description: 'Commit, branch or tag (default: the default branch)' }, base: { type: 'string', maxLength: 250, description: 'Branch whose required checks apply (default: the default branch)' } },
  required: ['repo'],
  handler: (args, ctx) => plain(async () => {
    const { owner, octokit } = await readerFor(args, ctx);
    const p = { owner, repo: args.repo };
    let headSha; let baseBranch = args.base;
    if (args.pr) {
      const pr = (await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', { ...p, pull_number: args.pr })).data;
      headSha = pr.head.sha; baseBranch = baseBranch ?? pr.base.ref;
    } else {
      const defaultBranch = (await octokit.request('GET /repos/{owner}/{repo}', p)).data.default_branch;
      headSha = (await octokit.request('GET /repos/{owner}/{repo}/commits/{ref}', { ...p, ref: args.ref ?? defaultBranch })).data.sha;
      baseBranch = baseBranch ?? defaultBranch;
    }
    const state = await ciState(octokit, { owner, repo: args.repo, baseBranch, headSha });
    const overall = state.green === true ? 'green' : state.green === null ? 'unknown' : state.checks.some((c) => c.state === 'failure' || c.state === 'missing') ? 'red' : 'pending';
    return { head_sha: headSha, base_branch: baseBranch, overall, ...state };
  })
});

export const checkGetRun = defineRead({
  name: 'github_check_get_run', area: 'check', audience: ['B'],
  description: 'One check run with its output summary and the first annotations (file, line, message).',
  properties: { owner: OWNER, repo: REPO, checkRunId: { type: 'integer', minimum: 1 } }, required: ['repo', 'checkRunId'],
  handler: (args, ctx) => plain(async () => {
    const { owner, octokit } = await readerFor(args, ctx);
    const p = { owner, repo: args.repo, check_run_id: args.checkRunId };
    const run = (await octokit.request('GET /repos/{owner}/{repo}/check-runs/{check_run_id}', p)).data;
    let annotations = [];
    if (run.output?.annotations_count) {
      annotations = (await octokit.request('GET /repos/{owner}/{repo}/check-runs/{check_run_id}/annotations', { ...p, per_page: 50 })).data
        .map((a) => ({ path: a.path, line: a.start_line, level: a.annotation_level, title: a.title, message: a.message }));
    }
    return { id: run.id, name: run.name, status: run.status, conclusion: run.conclusion, head_sha: run.head_sha, app: run.app?.slug, started_at: run.started_at, completed_at: run.completed_at,
      title: run.output?.title, summary: run.output?.summary, annotations_count: run.output?.annotations_count, annotations, html_url: run.html_url };
  })
});

export const artifactList = defineRead({
  name: 'github_artifact_list', area: 'artifact', audience: ['B'], summaryType: 'artifact',
  description: 'Artifacts of one run or of the whole repository, with size and expiry.',
  properties: { owner: OWNER, repo: REPO, runId: { type: 'integer', minimum: 1, description: 'Only this run\'s artifacts' }, name: { type: 'string', maxLength: 250 }, max: MAX }, required: ['repo'],
  handler: (args, ctx) => plain(async () => {
    const { owner, octokit } = await readerFor(args, ctx);
    const byRun = args.runId !== undefined;
    const { items, capped } = await listWrapped(octokit, byRun ? 'GET /repos/{owner}/{repo}/actions/runs/{run_id}/artifacts' : 'GET /repos/{owner}/{repo}/actions/artifacts',
      { owner, repo: args.repo, ...(byRun ? { run_id: args.runId } : {}), ...(args.name ? { name: args.name } : {}) }, 'artifacts', args.max ?? 30);
    return { count: items.length, ...(capped ? { more_exist: true } : {}), items };
  })
});

export const artifactGetLink = defineRead({
  name: 'github_artifact_get_link', area: 'artifact', audience: ['B'],
  description: 'A short-lived download link for an artifact (the link, never the file).',
  properties: { owner: OWNER, repo: REPO, artifactId: { type: 'integer', minimum: 1 } }, required: ['repo', 'artifactId'],
  guidance: 'Temporary artifact download redirects can contain bearer credentials. Signed and unverified locations never appear in AI results; use the GitHub Actions page instead.',
  handler: (args, ctx) => plain(async () => {
    const { owner, octokit } = await readerFor(args, ctx);
    const p = { owner, repo: args.repo, artifact_id: args.artifactId };
    const artifact = (await octokit.request('GET /repos/{owner}/{repo}/actions/artifacts/{artifact_id}', p)).data;
    if (artifact.expired) throw new TypeError(`Artifact ${artifact.name} expired on ${artifact.expires_at}; GitHub no longer has it.`);
    const response = await octokit.request('GET /repos/{owner}/{repo}/actions/artifacts/{artifact_id}/{archive_format}', { ...p, archive_format: 'zip', request: { redirect: 'manual' } });
    const url = response.headers?.location;
    if (!url) throw new TypeError('GitHub did not return a download link for that artifact.');
    const safe = safeGithubDownloadRedirect(url, githubDownloadPage(owner, args.repo, 'actions'));
    return { id: artifact.id, name: artifact.name, size_in_bytes: artifact.size_in_bytes,
      ...safe, expires: safe.url ? 'within about one minute' : null };
  })
});

export const cacheList = defineRead({
  name: 'github_cache_list', area: 'cache', audience: ['B', 'Op'],
  description: 'Actions caches of a repository (key, branch, size, last used) and the total cache usage.',
  properties: { owner: OWNER, repo: REPO, key: { type: 'string', maxLength: 250, description: 'Only keys starting with this' }, ref: { type: 'string', maxLength: 250, description: 'Only caches for this ref, e.g. refs/heads/main' },
    sort: { type: 'string', enum: ['created_at', 'last_accessed_at', 'size_in_bytes'], description: 'Default last_accessed_at' }, max: MAX }, required: ['repo'],
  handler: (args, ctx) => plain(async () => {
    const { owner, octokit } = await readerFor(args, ctx);
    const p = { owner, repo: args.repo };
    const usage = (await octokit.request('GET /repos/{owner}/{repo}/actions/cache/usage', p)).data;
    const { items, capped } = await listWrapped(octokit, 'GET /repos/{owner}/{repo}/actions/caches', { ...p, ...(args.key ? { key: args.key } : {}), ...(args.ref ? { ref: args.ref } : {}), sort: args.sort ?? 'last_accessed_at', direction: 'desc' }, 'actions_caches', args.max ?? 30);
    return { usage: { caches: usage.active_caches_count, bytes: usage.active_caches_size_in_bytes }, count: items.length, ...(capped ? { more_exist: true } : {}),
      items: items.map((c) => ({ id: c.id, key: c.key, ref: c.ref, size_in_bytes: c.size_in_bytes, last_accessed_at: c.last_accessed_at, created_at: c.created_at })) };
  })
});

const defs = [checkGetCiState, checkGetRun, artifactList, artifactGetLink, cacheList];
export const tools = defs.map((d) => d.tool);
export const handlers = Object.fromEntries(defs.map((d) => [d.tool.name, d.handler]));
