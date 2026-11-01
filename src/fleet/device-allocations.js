// FLEET-3/4: Playground allocations placed on a person's own dial-out computer
// or server. Same compose plan as the Dokploy pool (four services, four volumes,
// private network), started by the host agent instead of the Dokploy API.
import {createHash} from 'node:crypto';
import {enqueue, read, awaitResult} from './mailbox.js';
import {deviceOrigin, hostIsLive} from './relay.js';
import {allocationPlan} from '../playground/dokploy.js';
import {SIZE_CLASSES} from '../playground/sizing.js';
import {nativeWorkerPublicKey} from '../native-git/signing.js';

const GIB = 1024 ** 3;
const fail = message => Object.assign(new TypeError(message), {safeMessage: true, safeCode: 'playground_device'});
const hostKey = id => 'pg_host.' + id;

// Ready, recently checked-in dial-out hosts that this exact connection enrolled.
export async function readyHosts(db, {clientId, now = Date.now} = {}) {
  const ids = (await db.getSetting('pg_enrolled_index'))?.ids ?? [];
  const hosts = await Promise.all(ids.filter(id => /^[a-f0-9]{32}$/.test(id)).slice(0, 256).map(id => db.getSetting(hostKey(id))));
  return hosts.filter(h => h && (!clientId || h.clientId === clientId) && hostIsLive(h, now()));
}

// What this host can honestly give a class: never more than the class, never more
// than the machine. Needs at least 1 CPU, 1.5 GiB free memory and 10 GB free disk.
export function deviceCeiling(host, size = 'large') {
  const cls = SIZE_CLASSES[size] ?? SIZE_CLASSES.large, c = host?.capacity ?? {};
  if (!(c.cpus >= 1) || !(c.freeMemoryBytes >= 1.5 * GIB) || !(c.freeDiskBytes >= 10e9)) return null;
  const cpuCpus = Math.max(1, Math.min(cls.cpuCpus, Math.floor(c.cpus * 0.75 * 10) / 10));
  const memoryBytes = Math.max(1024 ** 3, Math.min(cls.memoryBytes, Math.floor(c.freeMemoryBytes * 0.75 / 1024 ** 2) * 1024 ** 2));
  return {cpuCpus, memoryBytes};
}

// Owner decision 2026-11-01: the person's own machines first, then the operator pool.
export async function chooseHost(ctx, size) {
  const hosts = await readyHosts(ctx.db, {clientId: ctx.connection?.client_id ?? null, now: ctx.now ?? Date.now});
  const fitting = hosts.map(h => ({h, ceiling: deviceCeiling(h, size)})).filter(x => x.ceiling);
  fitting.sort((a, b) => b.h.capacity.freeMemoryBytes - a.h.capacity.freeMemoryBytes || a.h.deviceId.localeCompare(b.h.deviceId));
  return fitting[0] ?? null;
}

export function devicePlan(ctx, record, binding, host, ceiling, prebuilt = null) {
  const env = ctx.env ?? {};
  const sourceSha = env.PLAYGROUND_BUILD_SOURCE_SHA ?? env.VERCEL_GIT_COMMIT_SHA;
  const image = env.PLAYGROUND_IMAGE || (/^[-a-zA-Z0-9./:]+@sha256:[a-f0-9]{64}$/.test(prebuilt ?? '') ? prebuilt : undefined);
  if (!/^[-a-zA-Z0-9./:]+@sha256:[a-f0-9]{64}$/.test(image ?? '') && !/^[a-f0-9]{40}$/.test(sourceSha ?? ''))
    throw fail('No pinned runtime image or source revision is configured for your computer.');
  const plan = allocationPlan({binding, verificationKey: nativeWorkerPublicKey(env), idleTimeoutMs: record.job.idleTimeoutMs}, {
    image, sourceSha, controlOrigin: env.PUBLIC_BASE_URL, ingress: '127.0.0.1',
    cpuCpus: ceiling.cpuCpus, memoryBytes: ceiling.memoryBytes, scope: ctx.db.playgroundScope, worker: record.worker,
    nativeBinding: createHash('sha256').update(JSON.stringify(['authority', 'connection', 'owner', 'repo'].map(k => record.binding[k]))).digest('hex')
  });
  // No public host name on a device: requests reach it only through the agent relay.
  return {...plan, host: null, origin: deviceOrigin(host.deviceId, binding), placement: 'device', deviceId: host.deviceId};
}

const orderUp = (ctx, stored) => enqueue(ctx.db, {deviceId: stored.device.deviceId, generation: stored.device.generation, kind: 'allocation_up',
  payload: {binding: stored.binding, project: stored.plan.name, composeFile: stored.plan.composeFile, planHash: stored.plan.planHash}, ttlMs: 120000, now: ctx.now ?? Date.now});

function networkAttested(result) {
  const n = result?.network;
  return result?.up === true && n?.workspaceInternal === true && n.codingPublishedPorts === 0 && n.ingressLoopbackOnly === true && n.noDockerSocket === true;
}

// Advance a device allocation one step; every transition is a compare-and-set.
export async function ensureDeviceAllocation(ctx, stored, save, {waitMs = 20000} = {}) {
  const now = (ctx.now ?? Date.now)();
  const host = await ctx.db.getSetting(hostKey(stored.device.deviceId));
  if (['requested', 'waiting_resources'].includes(stored.phase)) {
    if (!hostIsLive(host, now) || host.generation !== stored.device.generation) return save({phase: 'waiting_resources', admission: {allowed: false, reason: 'device_offline'}});
    const order = await orderUp(ctx, stored);
    stored = await save({phase: 'creating', upOrder: order.id});
  }
  if (stored.phase === 'creating') {
    const m = await awaitResult(ctx.db, stored.upOrder, {timeoutMs: waitMs, clock: ctx.now ?? Date.now, ...(ctx.relaySleep ? {sleep: ctx.relaySleep} : {})});
    if (m?.state === 'expired') return save({phase: 'requested', upOrder: null});
    if (m?.state !== 'done') return stored;
    if (!networkAttested(m.result)) return save({phase: 'device_refused', refusal: typeof m.result?.reason === 'string' ? m.result.reason.slice(0, 200) : 'device_could_not_start_isolated_runtime'});
    return save({phase: 'allocated', origin: stored.plan.origin, composeId: 'device:' + stored.device.deviceId, repositoryAttached: false, enforcementVerified: false,
      deviceNetwork: {workspaceInternal: true, codingPublishedPorts: 0, ingressLoopbackOnly: true, noDockerSocket: true, attestedAt: m.completedAt, source: 'device_attested'}});
  }
  return stored;
}

export async function disposeDeviceAllocation(ctx, stored, save, {waitMs = 20000} = {}) {
  const now = ctx.now ?? Date.now;
  if (stored.phase === 'disposed') return stored;
  if (['requested', 'waiting_resources', 'device_refused'].includes(stored.phase) && !stored.upOrder)
    return save({phase: 'disposed', disposed: true, disposedAt: now(), neverAllocated: stored.phase !== 'device_refused'});
  const host = await ctx.db.getSetting(hostKey(stored.device.deviceId));
  if (host?.status === 'revoked' && Number.isSafeInteger(host.cleanupConfirmedAt) && host.terminatedGeneration === stored.device.generation)
    return save({phase: 'disposed', disposed: true, disposedAt: now(), cleanupEvidence: 'device_terminate_attested'});
  if (stored.phase !== 'deleting' || !stored.downOrder) {
    const order = await enqueue(ctx.db, {deviceId: stored.device.deviceId, generation: stored.device.generation, kind: 'allocation_down',
      payload: {binding: stored.binding, project: stored.plan.name}, ttlMs: 7 * 86400000, now});
    stored = await save({phase: 'deleting', downOrder: order.id});
  }
  const m = await awaitResult(ctx.db, stored.downOrder, {timeoutMs: waitMs, clock: now, ...(ctx.relaySleep ? {sleep: ctx.relaySleep} : {})});
  const r = m?.result;
  if (m?.state === 'done' && r?.containersAbsent === true && r.volumesAbsent === true && r.networksAbsent === true)
    return save({phase: 'disposed', disposed: true, disposedAt: now(), cleanupEvidence: 'device_attested'});
  return {...stored, disposed: false, next: 'Waiting for your computer to confirm the runtime and its volumes are gone. It finishes when the computer is online.'};
}

// The device version of the managed baseline: attached, attested private
// network, pinned runtime identity, read-only Git mount, and a live host.
export async function deviceBaseline(ctx, s, {workspace, binding, requireLive = true}) {
  if (s?.placement !== 'device' || s.phase !== 'attached' || s.workspace !== workspace || s.binding !== binding || s.repositoryAttached !== true) return null;
  const host = await ctx.db.getSetting(hostKey(s.device?.deviceId));
  // requireLive=false for the runtime's own heartbeat: the heartbeat arriving is itself proof the machine is up,
  // so a slow agent check-in never stops running work; a revoked or re-paired machine still fails here.
  if ((requireLive ? !hostIsLive(host, (ctx.now ?? Date.now)()) : host?.status !== 'ready') || host.generation !== s.device.generation) return null;
  const m = s.attachment?.mounts, n = s.deviceNetwork;
  if (!m?.worktree || !m.git || m.gitReadOnly !== true || !/^ed25519:[A-Za-z0-9+/=]+$/.test(s.runtimePublicKey ?? '') || n?.workspaceInternal !== true || n.codingPublishedPorts !== 0) return null;
  return {mode: 'best_effort', placement: 'device', runtimePublicKey: s.runtimePublicKey, mounts: m, dependencyEgress: s.plan?.isolationProfile === 'dedicated-ingress-v2',
    configured: {cpuCpus: s.plan.enforcement.cpuConfigured, memoryBytes: s.plan.enforcement.memoryConfiguredBytes, storageQuotaBytes: null}};
}

export async function inspectDevice(ctx, stored) {
  const m = stored.upOrder ? await read(ctx.db, stored.upOrder) : null;
  return {placement: 'device', device_id: stored.device.deviceId, order_state: m?.state ?? null};
}
