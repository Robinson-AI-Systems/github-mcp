// SRV-STATUS-1 (owner request 2026-11-02): one compact read that tells an agent which release it is talking to, when it
// went live, what changed recently, which worker builds serve it and whether its dependencies answer. Read-only: it reads
// the public release history of this server's own repository, asks the native Git worker for its signed capabilities and
// makes one trivial database read. It never returns a credential, an environment value, a worker or direct-host address,
// or a provider error text (those can carry host names); every reason is a fixed plain sentence.
import { bareOctokit } from '../github/client.js';
import { serverRelease } from '../brand/brand.js';
import { currentZone, formatLocal } from '../core/time-zone.js';
import { projectFields } from '../core/result-rules.js';
import { callNativeWorker } from '../native-git/client.js';
import { configuredHosts, hostAllowed } from '../native-git/pool-config.js';
import { poolStatus } from '../native-git/pool.js';
import { WORKER_PROTOCOL } from '../native-git/protocol.js';
import { NATIVE_OPTIONS_VERSION } from '../native-git/commands.js';
import { resolvePrebuiltImage } from '../playground/prebuilt-image.js';
import { dokployPools } from '../playground/dokploy.js';
import { rootAllocationDb } from '../playground/index.js';

export const RELEASE_REPO = Object.freeze({ owner: 'Robinson-AI-Systems', repo: 'github-mcp', branch: 'live' });
/** The whole call answers within this (checks run in parallel); a check still running is reported as not answering. */
export const STATUS_BUDGET_MS = 7000;
export const CACHE_MS = 5 * 60 * 1000;
export const SLOW_MS = Object.freeze({ database: 1500, worker: 3000, direct_git: 3000 });
const RECENT = 5;
const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const SECTIONS = ['release', 'deployed_at', 'recent_changes', 'workers', 'health', 'warnings'];
const short = (sha) => (typeof sha === 'string' && SHA.test(sha) ? sha.slice(0, 12) : null);
const clip = (text, n) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);

// Release history is public and the same for every connection, so one short cache serves them all.
const cache = new Map();
export const _resetServerStatusCache = () => cache.clear();
async function cached(key, now, load) {
  const hit = cache.get(key);
  if (hit && now() - hit.at < CACHE_MS) return hit.value;
  const value = await load();
  cache.set(key, { at: now(), value });
  return value;
}

/** Resolves to { value } | { error } | { timeout: true } within `ms`; never rejects. */
function bounded(promise, ms) {
  let timer;
  const limit = new Promise((resolve) => { timer = setTimeout(() => resolve({ timeout: true }), ms); timer.unref?.(); });
  return Promise.race([Promise.resolve().then(() => promise).then((value) => ({ value }), (error) => ({ error })), limit]).finally(() => clearTimeout(timer));
}
const elapsed = (start) => Math.round(performance.now() - start);

/**
 * The app's own read credential for this public repository when this connection includes its owner account (an installation
 * token narrowed to read-only on this one repository); otherwise an anonymous read, which public repositories allow.
 */
async function releaseReader(ctx) {
  const { owner, repo } = RELEASE_REPO;
  if (ctx.connection?.accounts?.some((a) => String(a).toLowerCase() === owner.toLowerCase()) && typeof ctx.credentials?.token === 'function') {
    try {
      const token = await ctx.credentials.token({ account: owner, cred: 'I', scope: { repositories: [repo] }, profile: 'read_only' });
      if (typeof token === 'string' && token) return bareOctokit({ token, fetch: ctx.fetch });
    } catch { /* fall through to the anonymous public read */ }
  }
  return bareOctokit({ fetch: ctx.fetch });
}

const MERGE = /^Merge pull request #(\d+) from \S+/;
/** The first-parent history of `live`: its head, and the pull requests merged onto it, newest first. */
export async function liveHistory(gh) {
  const { owner, repo, branch } = RELEASE_REPO;
  const { data } = await gh.request('GET /repos/{owner}/{repo}/commits', { owner, repo, sha: branch, per_page: 60 });
  const list = Array.isArray(data) ? data : [];
  const bySha = new Map(list.map((c) => [c.sha, c]));
  const chain = [];
  const dates = new Map();
  const merges = [];
  for (let c = list[0]; c && chain.length < list.length; c = bySha.get(c.parents?.[0]?.sha)) {
    chain.push(c.sha);
    dates.set(c.sha, c.commit?.committer?.date ?? null);
    const message = String(c.commit?.message ?? '');
    const m = MERGE.exec(message);
    if (m && (c.parents?.length ?? 0) > 1 && merges.length < RECENT) {
      const title = message.split('\n').slice(1).map((l) => l.trim()).find(Boolean) ?? '';
      merges.push({ pr: Number(m[1]), title: clip(title, 100), merged_at: c.commit?.committer?.date ?? null, commit: short(c.sha) });
    }
  }
  return { head: list[0]?.sha ?? null, chain, dates, merges };
}

/** When GitHub was told this exact commit's deployment succeeded (Vercel reports each deployment to GitHub). */
export async function deploymentTime(gh, sha, environment) {
  const { owner, repo } = RELEASE_REPO;
  const { data } = await gh.request('GET /repos/{owner}/{repo}/deployments', { owner, repo, sha, environment, per_page: 5 });
  const deployment = (Array.isArray(data) ? data : []).find((d) => d.sha === sha);
  if (!deployment) return null;
  const statuses = (await gh.request('GET /repos/{owner}/{repo}/deployments/{deployment_id}/statuses', { owner, repo, deployment_id: deployment.id, per_page: 10 })).data;
  const success = (Array.isArray(statuses) ? statuses : []).filter((s) => s.state === 'success').map((s) => s.created_at).filter(Boolean).sort()[0];
  return success ? { at: success, source: 'github_deployment_status' } : { at: deployment.created_at, source: 'github_deployment_created' };
}

const SOURCE_NOTE = {
  github_deployment_status: 'When the host reported this exact commit\'s deployment as successful on GitHub.',
  github_deployment_created: 'When the host started deploying this exact commit (no success report on GitHub yet).',
  live_branch_commit_date: 'Fallback: when this commit landed on the live branch. The deployment went live shortly after.'
};
function stamp(at, source) {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return null;
  return { local: formatLocal(date), utc: date.toISOString().replace('.000Z', 'Z'), zone: currentZone(), source, source_note: SOURCE_NOTE[source] };
}

/** The native Git worker's signed capabilities, reduced to versions and switch names (never its addresses or key). */
function workerView(cap) {
  const features = {};
  for (const key of ['direct_download', 'direct_upload', 'upload_chunks', 'upload_apply', 'git_remote']) if (typeof cap[key] === 'string') features[key] = cap[key];
  if (cap.git_direct) features.git_direct = typeof cap.git_direct?.version === 'string' ? cap.git_direct.version : 'on';
  return {
    protocol: Number.isSafeInteger(cap.protocol) ? cap.protocol : null,
    build_commit: SHA.test(cap.build_commit ?? '') ? cap.build_commit : null,
    native_options: typeof cap.native_options === 'string' ? cap.native_options : null,
    capacity_mode: typeof cap.capacity_mode === 'string' ? cap.capacity_mode : null,
    admission: cap.admission && typeof cap.admission === 'object' ? (cap.admission.allowed === false ? 'busy' : 'open') : null,
    features
  };
}

async function checkDatabase(ctx, budget, slow) {
  const start = performance.now();
  const r = await bounded(ctx.db.getSetting('time_zone'), budget);
  const ms = elapsed(start);
  if (r.timeout) return { status: 'down', reason: `The database did not answer within ${Math.round(budget / 1000)} s.` };
  if (r.error) return { status: 'down', reason: 'The database refused or failed a trivial read.' };
  return ms > slow.database ? { status: 'degraded', ms, reason: 'The database answered, but slowly.' } : { status: 'ok', ms };
}

async function checkWorker(ctx, env, budget, slow) {
  if (!env.NATIVE_GIT_WORKER_URL) return { check: { status: 'down', reason: 'No native Git worker is configured on this server.' }, cap: null };
  if (env.NATIVE_GIT_WORKER_DRAINING === 'true') return { check: { status: 'degraded', reason: 'The native Git worker is paused for maintenance (draining).' }, cap: null };
  const start = performance.now();
  const r = await bounded(callNativeWorker(ctx, { action: 'capabilities' }), budget);
  const ms = elapsed(start);
  if (r.timeout) return { check: { status: 'down', reason: `The native Git worker did not answer within ${Math.round(budget / 1000)} s.` }, cap: null };
  if (r.error || !r.value || typeof r.value !== 'object') return { check: { status: 'down', reason: 'The native Git worker could not be reached or refused the signed check.' }, cap: null };
  if (r.value.ready !== true) return { check: { status: 'degraded', ms, reason: 'The native Git worker answered but is not ready.' }, cap: r.value };
  return { check: ms > slow.worker ? { status: 'degraded', ms, reason: 'The native Git worker answered, but slowly.' } : { status: 'ok', ms }, cap: r.value };
}

// WORKER-POOL-1: every pool host's state by name (never an address), only when more than one host is configured.
async function checkPool(ctx, env, budget) {
  const hosts = configuredHosts(env);
  if (hosts.length < 2 && !hosts.invalid) return null;
  const r = await bounded(poolStatus(ctx), budget);
  if (r.timeout || r.error || !Array.isArray(r.value)) return { status: 'degraded', reason: 'The worker pool could not be checked just now.' };
  // WORKER-POOL-2: each host's audience (owner = the service owner's own connections only, shared = anyone). A
  // non-owner sees an owner-only host by name and audience only.
  const list = r.value.map((h) => ({ name: h.name, audience: h.audience, state: h.state, ...(h.reason ? { reason: h.reason } : {}),
    ...(h.active_workspaces !== null ? { active: h.active_workspaces } : {}), ...(h.max_workspaces !== null ? { max: h.max_workspaces } : {}) }));
  const open = list.filter((h) => h.state === 'available').length;
  if (!open) return { status: 'down', hosts: list, reason: `No workspace host ${r.value.owner ? '' : 'open to this connection '}is taking new work (all paused, busy, full, disabled or offline); new workspaces are refused with "try again".` };
  if (r.value.invalid) return { status: 'degraded', hosts: list, reason: 'Part of the NATIVE_GIT_WORKER_POOL setting is not valid and was ignored.' };
  return { status: 'ok', available: open, hosts: list };
}

const directOrigin = (env) => {
  try {
    const url = new URL(String(env.GIT_DIRECT_ORIGIN ?? ''));
    return url.protocol === 'https:' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash ? url.origin : null;
  } catch { return null; }
};
async function checkDirect(ctx, env, budget, slow) {
  const origin = directOrigin(env);
  if (!origin) return null;
  // WORKER-POOL-2: the direct git host is the primary's; a caller who may not use an owner-only primary is not told about it.
  const primary = configuredHosts(env).find((h) => h.role === 'primary');
  if (primary && !hostAllowed(ctx, primary)) return null;
  const start = performance.now();
  const r = await bounded((async () => {
    const res = await ctx.fetch(`${origin}/health`, { redirect: 'error', signal: AbortSignal.timeout(budget) });
    return { ok: res.status === 200 };
  })(), budget);
  const ms = elapsed(start);
  if (r.timeout) return { status: 'down', reason: `The direct git host did not answer within ${Math.round(budget / 1000)} s.` };
  if (r.error || !r.value.ok) return { status: 'down', reason: 'The direct git host did not report healthy. git over this service\'s own domain still works.' };
  return ms > slow.direct_git ? { status: 'degraded', ms, reason: 'The direct git host answered, but slowly.' } : { status: 'ok', ms };
}

const managerCommit = (source) => {
  const text = `${source?.image ?? ''} ${source?.build?.context ?? ''}`;
  return short(/(?:[:#])([0-9a-f]{40})\b/.exec(text)?.[1]);
};
/** Cheap Playground facts: configured pools and the manager's recorded state (one database read, no provider call). */
async function playgroundPool(ctx, env, budget) {
  let pools;
  try { pools = dokployPools(env); } catch { return { check: { status: 'degraded', reason: 'The Playground pool setting is not valid.' }, manager: null }; }
  if (!pools.length) return null;
  const r = await bounded(rootAllocationDb(ctx).getSetting('playground_manager'), budget);
  const state = r.value ?? null;
  const manager = state ? { phase: typeof state.phase === 'string' ? state.phase : 'unknown', built_from: managerCommit(state.source) } : { phase: 'not created' };
  const check = r.timeout || r.error
    ? { status: 'degraded', pools: pools.length, reason: 'The Playground manager state could not be read just now.' }
    : manager.phase === 'running' ? { status: 'ok', pools: pools.length }
      : { status: 'degraded', pools: pools.length, reason: `The Playground manager is ${manager.phase}; new runs may wait while it starts.` };
  return { check, manager };
}

async function runtimeImage(ctx, env, budget) {
  if (env.PLAYGROUND_IMAGE) {
    const digest = /@(sha256:[0-9a-f]{64})$/.exec(String(env.PLAYGROUND_IMAGE))?.[1] ?? null;
    return { source: 'operator_pinned', digest, built_for: null };
  }
  const builtFor = env.PLAYGROUND_BUILD_SOURCE_SHA ?? env.VERCEL_GIT_COMMIT_SHA;
  if (!env.PLAYGROUND_IMAGE_REPOSITORY || !SHA.test(builtFor ?? '')) return { source: 'not_configured', digest: null, built_for: null };
  const r = await bounded(resolvePrebuiltImage(env, { fetch: ctx.fetch, timeoutMs: budget }), budget);
  const digest = typeof r.value === 'string' ? (/@(sha256:[0-9a-f]{64})$/.exec(r.value)?.[1] ?? null) : null;
  return { source: 'release_tag', tag: short(builtFor), built_for: builtFor, digest, published: DIGEST.test(digest ?? ''), ...(r.timeout ? { lookup: 'timed out' } : {}) };
}

function warningsFor({ release, worker, image, history }) {
  const out = [];
  const head = release.commit;
  const order = history?.chain ?? [];
  const relation = (sha) => {
    const from = order.indexOf(head);
    const at = from >= 0 && order.indexOf(sha) > from ? order.indexOf(sha) - from : 0;
    return at > 0 ? `an older commit (${short(sha)}, ${at} commit${at === 1 ? '' : 's'} behind on live)` : `a different commit (${short(sha)})`;
  };
  if (worker) {
    if (worker.protocol !== null && worker.protocol !== WORKER_PROTOCOL)
      out.push({ warning: `The native Git worker speaks protocol ${worker.protocol}; this server speaks ${WORKER_PROTOCOL}.`, next: 'Redeploy the native Git worker from the live branch.' });
    if (worker.native_options !== null && worker.native_options !== NATIVE_OPTIONS_VERSION)
      out.push({ warning: 'The native Git worker is older than this server: its Git operation options differ.', next: 'Redeploy the native Git worker from the live branch.' });
    if (head && worker.build_commit && worker.build_commit !== head)
      out.push({ warning: `The native Git worker was built from ${relation(worker.build_commit)}, not this server's ${short(head)}.`, next: 'Redeploy the native Git worker from the live branch if a worker change since then is needed.' });
    if (head && !worker.build_commit)
      out.push({ warning: 'The native Git worker does not report the commit it was built from.', next: 'Redeploy the worker with SOURCE_COMMIT set to the live commit (docs/NATIVE-GIT-OPERATIONS.md).' });
  }
  if (image?.source === 'release_tag') {
    if (head && image.built_for !== head)
      out.push({ warning: `The Playground runtime image is pinned to ${relation(image.built_for)}, older than this release.`, next: 'Clear PLAYGROUND_BUILD_SOURCE_SHA, or set it to the live commit, so new runs use this release\'s image.' });
    else if (image.published === false && !image.lookup)
      out.push({ warning: 'No Playground runtime image is published for this release yet; new runs build from source (slower).', next: 'Let the "Publish runtime image" workflow finish for this commit, then check again.' });
  }
  return out;
}

const worst = (checks) => (checks.some((c) => c.status === 'down') ? 'down' : checks.some((c) => c.status === 'degraded') ? 'degraded' : 'ok');

/**
 * @param {{ detail?: 'brief'|'full', fields?: string[] }} args
 * @param {{ budgetMs?: number, slowMs?: typeof SLOW_MS }} [options] tests shorten these; the tool uses the defaults.
 */
export async function serverStatus(args, ctx, { budgetMs = STATUS_BUDGET_MS, slowMs = SLOW_MS } = {}) {
  const full = args.detail === 'full';
  const unknown = (args.fields ?? []).map((f) => String(f).split('.')[0]).filter((f) => !SECTIONS.includes(f));
  if (unknown.length) throw new TypeError(`Unknown field: ${unknown.slice(0, 3).join(', ')}. Available: ${SECTIONS.join(', ')}`);
  const want = new Set(args.fields?.length ? args.fields.map((f) => String(f).split('.')[0]) : SECTIONS);
  if (want.has('warnings')) { want.add('workers'); want.add('recent_changes'); }
  const env = ctx.env ?? process.env;
  const now = ctx.now ?? Date.now;
  const released = serverRelease(env);
  const release = { version: released.version, commit: released.commit, ...(released.source ? { source: released.source } : {}) };

  const needsGithub = want.has('recent_changes') || want.has('deployed_at');
  const gh = needsGithub ? releaseReader(ctx) : null;
  const historyTask = needsGithub ? bounded(cached('live-history', now, async () => liveHistory(await gh)), budgetMs) : null;
  const environment = env.VERCEL_ENV === 'production' || !env.VERCEL_ENV ? 'Production' : 'Preview';
  const deployTask = want.has('deployed_at') && release.commit
    ? bounded(cached(`deploy:${release.commit}:${environment}`, now, async () => deploymentTime(await gh, release.commit, environment)), budgetMs) : null;
  const health = want.has('health') || want.has('workers');
  const [history, deployed, database, worker, direct, pool, image, workerPool] = await Promise.all([
    historyTask, deployTask,
    want.has('health') ? checkDatabase(ctx, budgetMs, slowMs) : null,
    health ? checkWorker(ctx, env, budgetMs, slowMs) : null,
    want.has('health') ? checkDirect(ctx, env, budgetMs, slowMs) : null,
    health ? playgroundPool(ctx, env, budgetMs) : null,
    want.has('workers') ? runtimeImage(ctx, env, budgetMs) : null,
    want.has('health') ? checkPool(ctx, env, budgetMs) : null
  ]);

  const out = { release };
  const historyValue = history?.value ?? null;
  if (want.has('deployed_at')) {
    const found = deployed?.value ?? null;
    out.deployed_at = (found && stamp(found.at, found.source))
      ?? (release.commit && historyValue?.dates.get(release.commit) ? stamp(historyValue.dates.get(release.commit), 'live_branch_commit_date') : null)
      ?? { local: null, utc: null, source: 'unknown', source_note: release.commit ? 'GitHub did not answer with this release\'s deployment time just now.' : 'This server did not report its release commit.' };
  }
  if (want.has('recent_changes')) {
    out.recent_changes = historyValue
      ? { untrusted: true, branch: RELEASE_REPO.branch, items: historyValue.merges.map((m) => (full ? m : { pr: m.pr, title: m.title })) }
      : { untrusted: true, branch: RELEASE_REPO.branch, items: [], unavailable: history?.timeout ? 'GitHub did not answer in time.' : 'GitHub could not be asked just now.' };
  }
  const workerFacts = worker?.cap ? workerView(worker.cap) : null;
  if (want.has('workers')) {
    const nativeGit = workerFacts
      ? { protocol: workerFacts.protocol, build_commit: short(workerFacts.build_commit) ?? 'not reported', features: full ? workerFacts.features : Object.keys(workerFacts.features),
          ...(full ? { native_options: workerFacts.native_options, capacity_mode: workerFacts.capacity_mode, admission: workerFacts.admission } : {}) }
      : { available: false };
    const runtime = image.source === 'release_tag'
      ? { tag: image.tag, digest: image.digest && !full ? `${image.digest.slice(0, 19)}…` : image.digest, published: image.published, ...(image.lookup ? { lookup: image.lookup } : {}) }
      : { source: image.source, ...(image.digest ? { digest: full ? image.digest : `${image.digest.slice(0, 19)}…` } : {}) };
    out.workers = { native_git: nativeGit, playground: { runtime_image: runtime, ...(pool?.manager ? { manager: pool.manager } : {}) } };
  }
  if (want.has('health')) {
    const checks = { database, worker: worker.check, ...(workerPool ? { worker_pool: workerPool } : {}), ...(direct ? { direct_git: direct } : {}), ...(pool?.check ? { playground_pool: pool.check } : {}) };
    out.health = { overall: worst(Object.values(checks)), ...checks };
  }
  if (want.has('warnings')) out.warnings = warningsFor({ release, worker: workerFacts, image, history: historyValue });
  if (!args.fields?.length) return out;
  return projectFields(out, args.fields, { alsoKeep: want.has('recent_changes') && out.recent_changes ? ['recent_changes.untrusted'] : [] }).value;
}

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
export const tools = [{
  name: 'github_server_status',
  area: 'server', audience: ['B', 'O', 'Op'], compact: true,
  description: 'This server\'s release, deploy time, recent live changes, worker versions and health checks in one compact read.',
  inputSchema: {
    type: 'object',
    properties: {
      detail: { type: 'string', enum: ['brief', 'full'], description: 'brief (default) or full' },
      fields: { type: 'array', items: { type: 'string', maxLength: 64 }, maxItems: 20, description: `Only these sections: ${SECTIONS.join(', ')}` }
    },
    additionalProperties: false
  },
  annotations: readOnly,
  keepsResult: false
}];
export const handlers = { github_server_status: (args, ctx) => serverStatus(args, ctx) };
