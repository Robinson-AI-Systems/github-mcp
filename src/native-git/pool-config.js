// WORKER-POOL-1 (owner request 2026-11-03: "use my available machines automatically when my main PC gets busy").
//
// The native Git worker pool: every execution site (Chris's PC, the Dokploy worker, later the Workshop machine or
// another enrolled computer) is one host running its own workers/native-git behind the same control plane.
//
// Which hosts exist comes ONLY from protected server configuration (the environment), never from the database
// or a request: a worker host receives signed leases and short-lived GitHub credentials, so adding one is a
// protected-configuration change, exactly like NATIVE_GIT_WORKER_URL today. The stored owner setting
// (`native_git.worker_pool`, src/native-git/pool.js) can only switch a configured host off for new work or change its
// priority or workspace limit; it can never add an address.
//
//   NATIVE_GIT_WORKER_URL           the primary host (name "primary", priority 10)
//   NATIVE_GIT_PREVIOUS_WORKER_URL  the previous host (name "previous", priority 90), still eligible for new work
//   NATIVE_GIT_WORKER_POOL          optional JSON list: [{"name":"workshop","origin":"https://…","priority":50,
//                                   "maxWorkspaces":4,"enabled":true}]; an entry whose origin is the primary's or the
//                                   previous host's only renames it or sets its priority, limit or enabled flag.
//                                   WORKER-POOL-2: optional "audience": "owner" | "shared" (see below).
//
// WORKER-POOL-2 (owner decision 2026-11-03, "Only my work on my PC"): each host has an audience. `owner` hosts serve
// only the service owner's own connections; `shared` hosts serve anyone. The audience comes only from protected
// configuration (the "audience" field above), never from the stored setting. Default without any audience set: the
// primary host (NATIVE_GIT_WORKER_URL, Chris's PC) is `owner` whenever another host is `shared`; every other host is
// `shared`. A one-host pool stays `shared` (otherwise nobody else could use native Git at all), unless it says
// "audience": "owner" explicitly.
//
// Lower priority numbers are tried first. A workspace is pinned for life to the host it was opened on by the
// host id below (the same 32-hex origin hash every existing workspace already stores), so a pool host stays
// routable while it is configured, even when it is disabled for new work.
import { createHash } from 'node:crypto';
import { isOperatorConnection } from '../core/authority.js';

export const MAX_POOL_HOSTS = 16;
export const HOST_NAME = /^[a-z0-9][a-z0-9-]{0,31}$/;
const DEFAULT_PRIORITY = Object.freeze({ primary: 10, previous: 90, pool: 50 });
const PRIORITY_MAX = 1000, LIMIT_MAX = 1000;
export const AUDIENCES = Object.freeze(['owner', 'shared']);

/** The compact, non-secret id a workspace stores to stay pinned to its host (unchanged since PC-WORKER-1). */
export const hostId = origin => createHash('sha256').update(origin).digest('hex').slice(0, 32);

/** A fixed HTTPS worker origin (no credentials, path, query or fragment), or null. */
export function workerOriginOf(raw) {
 if (typeof raw !== 'string' || !raw) return null;
 let url; try { url = new URL(raw); } catch { return null; }
 if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') return null;
 return url.origin;
}
const intIn = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;

/** The pool list from NATIVE_GIT_WORKER_POOL: valid entries and whether anything in it was invalid. */
function poolList(env) {
 const raw = env?.NATIVE_GIT_WORKER_POOL;
 if (raw === undefined || raw === null || raw === '') return { entries: [], invalid: false };
 let list; try { list = JSON.parse(raw); } catch { return { entries: [], invalid: true }; }
 if (!Array.isArray(list)) return { entries: [], invalid: true };
 const entries = []; let invalid = list.length > MAX_POOL_HOSTS;
 for (const item of list.slice(0, MAX_POOL_HOSTS)) {
  const origin = workerOriginOf(item?.origin);
  const ok = item && typeof item === 'object' && HOST_NAME.test(item.name ?? '') && origin
   && (item.priority === undefined || intIn(item.priority, 0, PRIORITY_MAX))
   && (item.maxWorkspaces === undefined || item.maxWorkspaces === null || intIn(item.maxWorkspaces, 1, LIMIT_MAX))
   && (item.enabled === undefined || typeof item.enabled === 'boolean')
   && (item.audience === undefined || AUDIENCES.includes(item.audience));
  if (!ok) { invalid = true; continue; }
  entries.push({ name: item.name, origin, priority: item.priority, maxWorkspaces: item.maxWorkspaces ?? null, enabled: item.enabled, audience: item.audience });
 }
 return { entries, invalid };
}

/**
 * Every configured worker host, preferred first: [{ id, name, origin, priority, maxWorkspaces, enabled, role, audience }].
 * An invalid NATIVE_GIT_WORKER_POOL entry is skipped (reported as `invalid`), never guessed at; the primary and
 * previous hosts always keep working from their own settings.
 */
export function configuredHosts(env) {
 const hosts = [];
 const add = (origin, role, name) => {
  if (!origin || hosts.some(h => h.origin === origin)) return;
  hosts.push({ id: hostId(origin), name, origin, priority: DEFAULT_PRIORITY[role], maxWorkspaces: null, enabled: true, role, audience: undefined, order: hosts.length });
 };
 add(workerOriginOf(env?.NATIVE_GIT_WORKER_URL), 'primary', 'primary');
 add(workerOriginOf(env?.NATIVE_GIT_PREVIOUS_WORKER_URL), 'previous', 'previous');
 const { entries, invalid } = poolList(env);
 for (const entry of entries) {
  let host = hosts.find(h => h.origin === entry.origin);
  if (!host) { if (hosts.length >= MAX_POOL_HOSTS) continue; add(entry.origin, 'pool', entry.name); host = hosts.at(-1); }
  if (hosts.some(h => h !== host && h.name === entry.name)) continue; // names stay unique; the first one wins
  host.name = entry.name;
  if (entry.priority !== undefined) host.priority = entry.priority;
  if (entry.maxWorkspaces !== null) host.maxWorkspaces = entry.maxWorkspaces;
  if (entry.enabled !== undefined) host.enabled = entry.enabled;
  if (entry.audience !== undefined) host.audience = entry.audience;
 }
 // WORKER-POOL-2 default: the primary is owner-only whenever another host serves everyone.
 const sharedOther = hosts.some(h => h.role !== 'primary' && (h.audience ?? 'shared') === 'shared');
 for (const h of hosts) if (h.audience === undefined) h.audience = h.role === 'primary' && sharedOther ? 'owner' : 'shared';
 const sorted = hosts.sort((a, b) => a.priority - b.priority || a.order - b.order).map(({ order: _order, ...h }) => Object.freeze(h));
 return Object.freeze(Object.assign(sorted, { invalid }));
}

/** The configured host with this id (any state: a pinned workspace keeps routing to a disabled host). */
export const configuredHost = (env, id) => typeof id === 'string' && /^[a-f0-9]{32}$/.test(id) ? configuredHosts(env).find(h => h.id === id) ?? null : null;

/** Applies the owner's stored adjustments (enabled, priority, maxWorkspaces per host name); never adds a host. */
export function applyPoolSetting(hosts, stored) {
 const by = stored && typeof stored === 'object' && stored.hosts && typeof stored.hosts === 'object' && !Array.isArray(stored.hosts) ? stored.hosts : {};
 const out = hosts.map(h => {
  const s = Object.hasOwn(by, h.name) && by[h.name] && typeof by[h.name] === 'object' ? by[h.name] : null;
  if (!s) return h;
  return Object.freeze({ ...h,
   ...(typeof s.enabled === 'boolean' ? { enabled: s.enabled } : {}),
   ...(intIn(s.priority, 0, PRIORITY_MAX) ? { priority: s.priority } : {}),
   ...(s.maxWorkspaces === null || intIn(s.maxWorkspaces, 1, LIMIT_MAX) ? { maxWorkspaces: s.maxWorkspaces } : {}) });
 });
 return Object.freeze(out.map((h, order) => ({ h, order })).sort((a, b) => a.h.priority - b.h.priority || a.order - b.order).map(x => x.h));
}

// ---- WORKER-POOL-2: who may use which host ---------------------------------------------------------------------
/**
 * The service owner's own connection: the operator's direct full connector (PUB-8 `operator` mark, set only by the
 * operator's own database route) on the operator's own database. A person's tenant or public connection, a
 * Marketplace connection, a service pass, an RTC/HTTPS door call and a background maintenance context are not.
 */
export const ownerCaller = ctx => isOperatorConnection(ctx?.connection) && !ctx?.db?.playgroundScope?.tenantId;
/** Whether this caller may be placed on (or sent to, unpinned) this host. */
export const hostAllowed = (ctx, host) => !!host && (host.audience !== 'owner' || ownerCaller(ctx));
/** The host a worker origin belongs to, or null. */
export const hostByOrigin = (env, origin) => configuredHosts(env).find(h => h.origin === origin) ?? null;

/** Requests that reached an owner-only host for a non-owner because they were already pinned there (served, counted). */
const strays = { count: 0, byHost: Object.create(null) };
export const strayCount = () => ({ count: strays.count, by_host: { ...strays.byHost } });
export function noteStray(host, where) {
 strays.count++; strays.byHost[host.name] = (strays.byHost[host.name] ?? 0) + 1;
 try { console.warn('[worker-pool] non-owner request served on owner-only host (pinned before WORKER-POOL-2)', host.name, where); } catch { /* logging never breaks a call */ }
}

/**
 * The job one worker call is routed with, for this caller. A pinned call (a workspace's stored host, or an older
 * workspace's creation time, or a dedicated broker) keeps its host. An unpinned call (a capabilities probe, the
 * direct-host setup) goes to the primary, except that a non-owner whose primary is owner-only goes to the first host
 * it may use; with none it is refused before anything is sent (retryable, no operation started).
 */
export function routeJobFor(ctx, job) {
 if (job && (job.brokerOrigin || job.host !== undefined || job.createdAt !== undefined)) return job;
 const hosts = configuredHosts(ctx?.env), primary = hosts.find(h => h.role === 'primary');
 if (!primary || hostAllowed(ctx, primary)) return job;
 const other = hosts.find(h => h.enabled && hostAllowed(ctx, h));
 if (!other) throw Object.assign(new TypeError('All workspace hosts are busy or paused; try again in a minute. No operation was started (nothing was sent to a worker).'), { safeMessage: true, safeCode: 'native_hosts_busy', safeRetryable: true, status: 503, noOperationStarted: true, nativeNoOperationStarted: true });
 return { ...(job ?? {}), host: other.id };
}
