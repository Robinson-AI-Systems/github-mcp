// WORKER-POOL-1: live status and placement for the native Git worker pool (hosts: src/native-git/pool-config.js).
//
// Placement, for every opener (github_git_workspace_open, github_repo_download, github_repo_change and
// github_playground_run's open): hosts are tried in priority order and the first one that is enabled, answers its
// signed capabilities call, is not paused by its owner, admits new work by its measured resources and is under its
// workspace limit is chosen. The chosen host's id is recorded in the workspace's job, so every later call stays on that
// host for life (no live migration). When none is available the open is refused before anything is cloned, with a
// plain, retryable "all workspace hosts are busy or paused; try again in a minute" and no_operation_started.
//
// Status cache (per server configuration, i.e. per process for process.env): an "available" answer is reused for
// STATUS_TTL_MS so a burst of opens costs one signed call, and an unreachable host counts as unavailable for the same
// time until it answers again (an offline computer does not slow every open down). A paused, busy or full answer is
// never reused: those answers are fast, so a host the owner resumes takes work again at once.
import { callNativeWorker } from './client.js';
import { configuredHosts, applyPoolSetting, hostAllowed, ownerCaller } from './pool-config.js';
import { rootAllocationDb } from '../playground/index.js';

export const POOL_SETTING = 'native_git.worker_pool';
export const STATUS_TTL_MS = 20000;
export const PROBE_TIMEOUT_MS = 8000;
const caches = new WeakMap();
const cacheFor = env => {
 if (!env || typeof env !== 'object') return null;
 let cache = caches.get(env); if (!cache) { cache = new Map(); caches.set(env, cache); }
 return cache;
};
const nowOf = ctx => (ctx.now ?? Date.now)();
const reasonText = value => typeof value === 'string' ? value.replace(/[^a-z_]/g, '').slice(0, 64) : null;

/** The configured hosts with the owner's stored adjustments applied (a missing or unreadable setting changes nothing). */
export async function poolHosts(ctx) {
 const hosts = configuredHosts(ctx.env);
 let stored = null;
 try { const db = rootAllocationDb(ctx); stored = typeof db?.getSetting === 'function' ? await db.getSetting(POOL_SETTING) : null; } catch { stored = null; }
 return stored ? applyPoolSetting(hosts, stored) : hosts;
}

/**
 * What one host's capabilities answer means for new work:
 * available | paused | busy | full | update_required | unavailable | disabled.
 */
export function judgeHost(host, cap, { download = false, workspace = true } = {}) {
 const active = Number.isSafeInteger(cap?.active_workspaces) && cap.active_workspaces >= 0 ? cap.active_workspaces : null;
 const limits = [host.maxWorkspaces, cap?.max_workspaces].filter(n => Number.isSafeInteger(n) && n > 0);
 const max = limits.length ? Math.min(...limits) : null;
 const base = { active, max };
 if (!host.enabled) return { ...base, state: 'disabled' };
 if (!cap || typeof cap !== 'object' || cap.ready !== true) return { ...base, state: 'unavailable' };
 if (cap.owner_paused === true || cap.admission?.reason === 'owner_paused') return { ...base, state: 'paused' };
 if ((workspace && cap.capacity_mode !== 'resource-aware') || (download && cap.direct_download !== 'one-time-v1')) return { ...base, state: 'update_required' };
 // A workspace needs resource-based admission; the git remote (workspace: false) only needs no explicit refusal.
 if (workspace ? cap.admission?.allowed !== true : cap.admission?.allowed === false) return { ...base, state: 'busy', reason: reasonText(cap.admission?.reason) ?? 'resource_observation_unavailable' };
 if (max !== null && active !== null && active >= max) return { ...base, state: 'full' };
 return { ...base, state: 'available' };
}

/** One host's signed capabilities (cached as described above), or null when it did not answer. */
export async function hostCapabilities(ctx, host, { call = callNativeWorker, refresh = false } = {}) {
 const cache = cacheFor(ctx.env), at = nowOf(ctx), hit = cache?.get(host.id);
 if (!refresh && hit && at - hit.at < STATUS_TTL_MS) return hit.cap;
 let cap = null, maintenance = false;
 try { cap = await call(ctx, { action: 'capabilities', job: { host: host.id }, timeoutMs: PROBE_TIMEOUT_MS }); }
 catch (error) { cap = null; maintenance = error?.safeCode === 'native_worker_maintenance'; }
 if (maintenance) return { ready: false, draining: true };
 if (cap && typeof cap === 'object' && !Array.isArray(cap)) {
  if (judgeHost({ ...host, enabled: true, maxWorkspaces: null }, cap).state === 'available') cache?.set(host.id, { at, cap });
  else cache?.delete(host.id);
  return cap;
 }
 cache?.set(host.id, { at, cap: null });
 return null;
}

/** Forget a host's cached answer (after it definitely refused new work, so the next choice asks it again). */
export function forgetHost(ctx, id) { cacheFor(ctx.env)?.delete(id); }
/** Count a workspace just opened on a cached host, so a burst of opens inside the cache time respects its limit. */
export function noteOpened(ctx, id) {
 const hit = cacheFor(ctx.env)?.get(id);
 if (hit?.cap && Number.isSafeInteger(hit.cap.active_workspaces)) hit.cap = { ...hit.cap, active_workspaces: hit.cap.active_workspaces + 1 };
}

/**
 * Every host's state for github_server_status: names, audience and states only, never an address. WORKER-POOL-2: a
 * non-owner caller sees an owner-only host by name and audience only (state `owner_only`; it is not asked).
 */
export async function poolStatus(ctx, { call = callNativeWorker } = {}) {
 const hosts = await poolHosts(ctx);
 const states = await Promise.all(hosts.map(async h => {
  if (!hostAllowed(ctx, h)) return { name: h.name, role: h.role, audience: h.audience, state: 'owner_only', active_workspaces: null, max_workspaces: null };
  const cap = h.enabled ? await hostCapabilities(ctx, h, { call, refresh: true }) : null;
  const judged = judgeHost(h, cap);
  const state = cap?.draining ? 'draining' : judged.state;
  return { name: h.name, role: h.role, audience: h.audience, state, ...(judged.reason ? { reason: judged.reason } : {}), active_workspaces: judged.active, max_workspaces: judged.max };
 }));
 return Object.assign(states, { invalid: configuredHosts(ctx.env).invalid === true, owner: ownerCaller(ctx) });
}

const BUSY = 'All workspace hosts are busy or paused; try again in a minute. No operation was started (nothing was cloned).';
const UPDATE = 'Update the native Git worker to resource-based admission before opening a new workspace.';
const DOWNLOAD_UPDATE = 'The native Git worker must be updated before direct downloads work. No clone was sent.';
/** The plain refusal when no host can take new work: retryable unless every host only needs an update. */
export function poolRefusal(tried, { download = false } = {}) {
 const states = tried.map(t => t.state);
 if (states.length && states.every(s => s === 'update_required'))
  return Object.assign(new TypeError(download ? DOWNLOAD_UPDATE : UPDATE), { safeMessage: true, safeCode: 'native_worker_update_required', noOperationStarted: true, nativeNoOperationStarted: true });
 const detail = tried.length ? ' Hosts: ' + tried.map(t => `${t.name} ${t.state}${t.reason ? ' (' + t.reason + ')' : ''}`).join(', ') + '.' : '';
 // A one-host pool keeps its earlier reason code for resource pressure (agents already branch on it).
 const code = tried.length === 1 && states[0] === 'busy' ? 'native_resource_pressure' : 'native_hosts_busy';
 return Object.assign(new TypeError((BUSY + detail).slice(0, 600)), { safeMessage: true, safeCode: code, safeRetryable: true, status: 503,
  noOperationStarted: true, nativeNoOperationStarted: true, outcomeDetails: { no_operation_started: true, hosts: tried.slice(0, 16) } });
}

/**
 * Chooses the host for a new workspace (see the top of this file). `exclude` names host ids that already refused
 * this open definitely (no operation started); `needs(capabilities)` adds a feature the host must report;
 * `workspace: false` (the git remote) does not require resource-based admission, only no explicit refusal.
 * Returns the host (with the capabilities it answered); throws the plain refusal when none can take it.
 * WORKER-POOL-2: an owner-only host is never considered for a non-owner caller (not asked, not listed in the refusal),
 * so with no shared host available the caller gets the same plain retryable refusal, never the owner's machine.
 */
export async function placeWorkspace(ctx, { download = false, exclude = [], call = callNativeWorker, needs = null, workspace = true } = {}) {
 const all = await poolHosts(ctx);
 const hosts = all.filter(h => hostAllowed(ctx, h));
 if (!all.length) throw Object.assign(new TypeError('Native Git worker is not configured. Set NATIVE_GIT_WORKER_URL (docs/NATIVE-GIT-OPERATIONS.md). Existing GitHub API tools remain available.'), { safeMessage: true, safeCode: 'native_worker_unconfigured', noOperationStarted: true });
 const tried = [];
 for (const host of hosts) {
  if (exclude.includes(host.id)) { tried.push({ name: host.name, state: 'busy' }); continue; }
  if (!host.enabled) { tried.push({ name: host.name, state: 'disabled' }); continue; }
  const cap = await hostCapabilities(ctx, host, { call });
  let judged = judgeHost(host, cap, { download, workspace });
  if (judged.state === 'available' && needs && !needs(cap)) judged = { ...judged, state: 'update_required' };
  if (judged.state === 'available') return Object.assign(Object.create(null), host, { capabilities: cap });
  tried.push({ name: host.name, state: cap?.draining ? 'draining' : judged.state, ...(judged.reason ? { reason: judged.reason } : {}) });
 }
 throw poolRefusal(tried, { download });
}
