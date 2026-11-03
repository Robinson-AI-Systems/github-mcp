// WORKER-POOL-2 (owner decision 2026-11-03, "Only my work on my PC"): who may use which native Git pool host.
// Control plane only (pool-config.js, which the worker images also carry, stays free of these imports).
import { isOperatorConnection } from '../core/authority.js';
import { configuredHosts } from './pool-config.js';

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
