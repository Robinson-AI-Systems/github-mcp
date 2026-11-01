import {it, expect, afterEach, describe} from 'vitest';
import {generateKeyPairSync, sign, createPublicKey} from 'node:crypto';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {makeWorld} from '../../test/helpers/write-contract.js';
import {preparePlaygroundWorld} from '../../test/helpers/playground-world.js';
import {playgroundRecord, callPlayground, playgroundBinding} from '../../src/playground/client.js';
import {ensureAllocation, disposeAllocation, inspectAllocation, enqueueAllocation} from '../../src/playground/allocations.js';
import {createEnrolledHostStore, deviceRouteKey} from '../../src/playground/enrolled-hosts.js';
import {checkIn, report} from '../../src/fleet/host.js';
import {enqueue, take, complete, awaitResult} from '../../src/fleet/mailbox.js';
import {deviceOrigin, parseDeviceOrigin, transportFetch} from '../../src/fleet/relay.js';
import {deviceCeiling, deviceBaseline} from '../../src/fleet/device-allocations.js';
import {HostAgent} from '../../tools/playground-device/agent.mjs';
import {createFleetHandler} from '../../api/fleet/checkin.js';

const base = {owner: 'example-org', repo: 'hello', workspace_id: 'job_0123456789abcdef'};
const cleanups = []; afterEach(async () => { for (const c of cleanups.splice(0)) await c(); });
const memory = () => { const m = new Map(); return {
  getSetting: async k => structuredClone(m.get(k) ?? null), setSetting: async (k, v) => { m.set(k, structuredClone(v)); },
  compareAndSetSetting: async (k, rev, v) => { if ((m.get(k)?.revision ?? 0) !== rev) return null; m.set(k, structuredClone(v)); return structuredClone(v); }, _m: m}; };
const GIB = 1024 ** 3;

// A fake Docker that behaves like an isolated compose run on loopback.
function fakeDocker({internal = true, publishCoding = false, failUp = false} = {}) {
  const calls = [], live = new Set();
  const exec = async (cmd, a) => {
    calls.push([cmd, ...a].join(' '));
    const s = a.join(' ');
    if (s.startsWith('version')) return '27.3.1';
    if (s.startsWith('compose version')) return '2.29.7';
    if (s.startsWith('info')) return '/var/lib/docker';
    if (s.startsWith('network create') || s.startsWith('network rm')) return '';
    if (s.startsWith('run') && s.includes(' id -u')) return '1000';
    if (s.startsWith('run') && s.includes('wget')) { if (internal) throw Object.assign(new Error('network unreachable'), {stderr: 'bad address'}); return 'ok'; }
    if (s.startsWith('network ls -q --filter name=')) return '';
    if (/compose -p \S+ -f \S+ up/.test(s)) { if (failUp) throw new Error('build failed'); live.add(a[2]); return ''; }
    if (/compose -p \S+ -f \S+ port ingress 3000/.test(s)) return '127.0.0.1:41234';
    if (s.startsWith('network inspect')) return JSON.stringify([{Internal: internal}]);
    if (/compose -p \S+ ps -q/.test(s)) return 'c1\nc2';
    if (s.startsWith('inspect')) return JSON.stringify([
      {Config: {Labels: {'com.docker.compose.service': 'coding'}}, NetworkSettings: {Ports: {'3000/tcp': publishCoding ? [{HostIp: '0.0.0.0', HostPort: '1'}] : null}}, Mounts: []},
      {Config: {Labels: {'com.docker.compose.service': 'ingress'}}, NetworkSettings: {Ports: {'3000/tcp': [{HostIp: '127.0.0.1', HostPort: '41234'}]}}, Mounts: []}]);
    if (/compose -p \S+ -f \S+ down/.test(s)) { live.delete(a[2]); return ''; }
    if (/^(container|volume|network) ls/.test(s)) return '';
    throw new Error('unexpected docker call: ' + s);
  };
  return {exec, calls, live};
}

async function setup({docker = fakeDocker(), freeMemoryBytes = 12 * GIB} = {}) {
  const w = await makeWorld({profile: 'full', mode: 'production', gates: []});
  w.gh.when('GET /repos/{owner}/{repo}').reply(200, {full_name: 'example-org/hello'});
  cleanups.push(await preparePlaygroundWorld(w));
  delete w.ctx.env.PLAYGROUND_ALLOCATIONS; delete w.ctx.env.PLAYGROUND_ENFORCEMENT; delete w.ctx.env.PLAYGROUND_DOKPLOY_ORIGIN;
  Object.assign(w.ctx.env, {PLAYGROUND_IMAGE: 'ghcr.io/example/runtime@sha256:' + 'a'.repeat(64), PUBLIC_BASE_URL: 'https://mcp.example.test'});
  const root = memory(), scope = {db: w.ctx.db, root, tenantId: 't1', identityId: 'i1', clientId: w.ctx.connection.client_id, grantActive: true};
  const store = createEnrolledHostStore({db: w.ctx.db, root, tenantId: 't1', identityId: 'i1', clientId: w.ctx.connection.client_id, now: w.ctx.now});
  const dir = await mkdtemp(join(tmpdir(), 'fleet-agent-')); cleanups.push(() => rm(dir, {recursive: true, force: true}));
  const routes = {
    '/api/native-git-key': async () => Response.json({public_key: (await import('../../src/native-git/signing.js')).nativeWorkerPublicKey(w.ctx.env)}),
    '/api/playground/enroll': async init => { try { return Response.json(await store.claim(JSON.parse(init.body))); } catch { return Response.json({error: 'pairing_denied'}, {status: 403}); } },
    '/api/fleet/checkin': async init => { try { const b = JSON.parse(init.body); return Response.json(await checkIn(scope, {body: b.request, signature: b.signature, env: w.ctx.env, now: w.ctx.now, waitMs: 0})); } catch (e) { return Response.json({error: 'host_denied'}, {status: e.reason === 'revoked' ? 410 : 403}); } },
    '/api/fleet/report': async init => { try { const b = JSON.parse(init.body); return Response.json(await report(scope, {body: b.request, signature: b.signature, now: w.ctx.now})); } catch { return Response.json({error: 'host_denied'}, {status: 403}); } }
  };
  const agentFetch = async (url, init = {}) => {
    const u = new URL(url);
    if (u.hostname === '127.0.0.1' && u.port === '41234') return w.ctx.fetch('https://playground.example.test' + u.pathname, init);
    return routes[u.pathname](init);
  };
  const agent = new HostAgent({dir, exec: docker.exec, fetchImpl: agentFetch, now: w.ctx.now, sleep: async () => {}, log: () => {}});
  agent.capacity = async () => ({cpus: 8, memoryBytes: 16 * GIB, freeMemoryBytes, freeDiskBytes: 200e9, docker: '27.3.1', compose: '2.29.7', agent: 'fleet-agent/1', platform: 'linux', allocations: Object.keys(agent.state?.allocations ?? {})});
  const drain = async () => { await agent.checkInOnce(); await Promise.all([...agent.work.values()]); };
  w.ctx.relaySleep = async () => { await drain(); };
  return {w, root, scope, store, agent, drain, docker};
}
async function joinAndApprove(t) {
  const started = await t.store.begin();
  const {fingerprint} = await t.agent.join({device: started.deviceId, code: started.code, server: 'https://mcp.example.test'});
  await t.store.approve(started.deviceId);
  return {deviceId: started.deviceId, fingerprint};
}

describe('FLEET-3 dial-out hosts', () => {
  it('pairs with no tunnel, passes the readiness check over outbound check-ins and becomes ready', async () => {
    const t = await setup();
    const {deviceId} = await joinAndApprove(t);
    expect(await t.root.getSetting(deviceRouteKey(deviceId))).toMatchObject({tenantId: 't1', clientId: 'client-1'});
    expect((await t.store.list())[0]).toMatchObject({status: 'pending_canary', transport: 'dial-out', origin: null});
    await t.drain(); // receives readiness order, runs it, reports
    const [host] = await t.store.list();
    expect(host).toMatchObject({status: 'ready', transport: 'dial-out'});
    expect(host.capacity.cpus).toBe(8);
    expect(t.docker.calls.some(c => c.includes('network create --internal'))).toBe(true);
  });

  it('keeps a machine whose network is not isolated out of service', async () => {
    const t = await setup({docker: fakeDocker({internal: false})});
    await joinAndApprove(t); await t.drain();
    expect((await t.store.list())[0].status).toBe('pending_canary');
  });

  it('places a workspace on the person’s own machine first, runs a signed command through the relay, then cleans up', async () => {
    const t = await setup(); await joinAndApprove(t); await t.drain();
    const record = await playgroundRecord(t.w.ctx, base, {allowUnattached: true});
    const queued = await enqueueAllocation(t.w.ctx, record, {size: 'medium'});
    expect(queued).toMatchObject({placement: 'device', phase: 'requested', size: 'medium'});
    expect(parseDeviceOrigin(queued.plan.origin)?.deviceId).toBe(queued.device.deviceId);
    const compose = JSON.parse(queued.plan.composeFile);
    expect(compose.services.coding.ports).toBeUndefined();
    const allocated = await ensureAllocation(t.w.ctx, record, {deviceWaitMs: 5000});
    expect(allocated).toMatchObject({phase: 'allocated', deviceNetwork: {workspaceInternal: true, codingPublishedPorts: 0, source: 'device_attested'}});
    expect(t.docker.calls.some(c => c.includes('up -d --build'))).toBe(true);
    expect(t.agent.state.allocations[queued.binding].port).toBe(41234);
    // Signed command travels relay → agent → loopback gateway → runtime, signature intact.
    const attachedRecord = {...record, allocation: {binding: playgroundBinding(record), url: new URL('/v1/coding', allocated.origin).href}};
    const started = await callPlayground(t.w.ctx, attachedRecord, 'start', {requestKey: 'pg_exec_' + 'c'.repeat(64), argv: ['npm', 'test']});
    expect(started.state).toBe('running');
    expect(t.w.playgroundRequests.at(-1)).toMatchObject({action: 'start', binding: playgroundBinding(record)});
    expect((await inspectAllocation(t.w.ctx, record)).placement).toBe('device');
    const disposed = await disposeAllocation(t.w.ctx, record, {deviceWaitMs: 5000});
    expect(disposed).toMatchObject({phase: 'disposed', cleanupEvidence: 'device_attested'});
    expect(t.agent.state.allocations[queued.binding]).toBeUndefined();
  });

  it('refuses an allocation whose runtime the machine would expose, and waits while the machine is offline', async () => {
    const t = await setup({docker: fakeDocker({publishCoding: true})}); await joinAndApprove(t); await t.drain();
    const record = await playgroundRecord(t.w.ctx, base, {allowUnattached: true});
    expect((await ensureAllocation(t.w.ctx, record, {deviceWaitMs: 5000})).phase).toBe('device_refused');
    const off = await setup(); await joinAndApprove(off); await off.drain();
    const r2 = await playgroundRecord(off.w.ctx, base, {allowUnattached: true});
    await enqueueAllocation(off.w.ctx, r2, {});
    off.w.advanceClock(120000); // no check-in for two minutes
    expect((await ensureAllocation(off.w.ctx, r2, {deviceWaitMs: 0})).phase).toBe('waiting_resources');
  });

  it('falls back to Git-only when no machine fits and no shared pool exists', async () => {
    const t = await setup({freeMemoryBytes: GIB}); await joinAndApprove(t); await t.drain();
    const record = await playgroundRecord(t.w.ctx, base, {allowUnattached: true});
    expect(await enqueueAllocation(t.w.ctx, record, {})).toBeNull();
    expect(deviceCeiling({capacity: {cpus: 4, freeMemoryBytes: 6 * GIB, freeDiskBytes: 50e9}}, 'large')).toEqual({cpuCpus: 3, memoryBytes: 4.5 * GIB});
  });

  it('revocation terminates the machine’s runtimes and then shuts the door', async () => {
    const t = await setup(); const {deviceId} = await joinAndApprove(t); await t.drain();
    const record = await playgroundRecord(t.w.ctx, base, {allowUnattached: true});
    await ensureAllocation(t.w.ctx, record, {deviceWaitMs: 5000});
    expect(Object.keys(t.agent.state.allocations)).toHaveLength(1);
    expect((await t.store.revoke(deviceId)).status).toBe('revocation_pending');
    await t.drain(); // terminate order → down everything → allAbsent
    expect((await t.store.list())[0].status).toBe('revoked');
    expect(Object.keys(t.agent.state.allocations)).toHaveLength(0);
    expect((await disposeAllocation(t.w.ctx, record, {deviceWaitMs: 0})).cleanupEvidence).toBe('device_terminate_attested');
    expect(await t.agent.checkInOnce()).toMatchObject({revoked: true});
  });

  it('rejects replayed, forged and foreign check-ins and unsigned orders', async () => {
    const t = await setup(); const {deviceId} = await joinAndApprove(t);
    const signed = await t.agent.signed('robinson-fleet-checkin/v1', {capacity: {}});
    await checkIn(t.scope, {body: signed.request, signature: signed.signature, env: t.w.ctx.env, now: t.w.ctx.now, waitMs: 0});
    await expect(checkIn(t.scope, {body: signed.request, signature: signed.signature, env: t.w.ctx.env, now: t.w.ctx.now, waitMs: 0})).rejects.toThrow(/not accepted/);
    // Overlapping requests may arrive out of signing order: an unseen older seq is still accepted once.
    const early = await t.agent.signed('robinson-fleet-checkin/v1', {capacity: {}}), late = await t.agent.signed('robinson-fleet-checkin/v1', {capacity: {}});
    await checkIn(t.scope, {body: late.request, signature: late.signature, env: t.w.ctx.env, now: t.w.ctx.now, waitMs: 0});
    await checkIn(t.scope, {body: early.request, signature: early.signature, env: t.w.ctx.env, now: t.w.ctx.now, waitMs: 0});
    await expect(checkIn(t.scope, {body: early.request, signature: early.signature, env: t.w.ctx.env, now: t.w.ctx.now, waitMs: 0})).rejects.toThrow(/not accepted/);
    const other = generateKeyPairSync('ed25519').privateKey, next = JSON.stringify({...JSON.parse(signed.request), seq: JSON.parse(signed.request).seq + 5});
    await expect(checkIn(t.scope, {body: next, signature: 'ed25519:' + sign(null, Buffer.from(next), other).toString('base64url'), env: t.w.ctx.env, now: t.w.ctx.now, waitMs: 0})).rejects.toThrow();
    await expect(checkIn({...t.scope, tenantId: 'someone-else'}, {body: next, signature: 'x', env: t.w.ctx.env, now: t.w.ctx.now, waitMs: 0})).rejects.toThrow();
    await expect(checkIn({...t.scope, grantActive: false}, {body: next, signature: 'x', env: t.w.ctx.env, now: t.w.ctx.now, waitMs: 0})).rejects.toThrow();
    expect(() => t.agent.verifyOrder({body: JSON.stringify({purpose: 'robinson-fleet-order/v1', deviceId, generation: 1, id: 'a'.repeat(32), kind: 'terminate'}), signature: 'ed25519:' + sign(null, Buffer.from('x'), other).toString('base64url')})).toThrow(/signature/);
    expect(() => t.agent.localCompose({binding: 'b'.repeat(64), composeFile: JSON.stringify({services: {coding: {privileged: true}}}), planHash: 'x'})).toThrow();
  });

  it('serves the check-in endpoint with clear status codes', async () => {
    const t = await setup(); await joinAndApprove(t);
    const handler = createFleetHandler('checkin', {env: t.w.ctx.env, scopeFactory: async () => t.scope, options: {now: t.w.ctx.now, waitMs: 0}});
    const res = () => { const r = {headers: {}, setHeader(k, v) { this.headers[k] = v; }, statusCode: 0, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, send(b) { this.body = b; return this; }, end(b) { this.body = b; return this; }}; return r; };
    const signed = await t.agent.signed('robinson-fleet-checkin/v1', {capacity: {}});
    const ok = res(); await handler({method: 'POST', body: signed}, ok); expect(ok.statusCode).toBe(200);
    const bad = res(); await handler({method: 'POST', body: {request: '{}', signature: 'x'}}, bad); expect(bad.statusCode).toBe(403);
    const off = createFleetHandler('checkin', {env: {}}), r404 = res(); await off({method: 'POST', body: signed}, r404); expect(r404.statusCode).toBe(404);
  });
});

describe('FLEET-3 mailbox and relay', () => {
  it('delivers once, drops expired orders and reports uncertain when nobody answers', async () => {
    const db = memory(); let now = 1000; const clock = () => now, id = 'd'.repeat(32);
    const a = await enqueue(db, {deviceId: id, generation: 1, kind: 'relay', payload: {}, ttlMs: 500, now: clock});
    const b = await enqueue(db, {deviceId: id, generation: 1, kind: 'relay', payload: {}, ttlMs: 50, now: clock});
    now += 100;
    const got = await take(db, id, {now: clock});
    expect(got.map(m => m.id)).toEqual([a.id]); expect(await take(db, id, {now: clock})).toEqual([]);
    expect((await db.getSetting('fleet_m.' + b.id)).state).toBe('expired');
    await complete(db, id, a.id, {status: 200, body: '{}'}, {now: clock});
    expect((await awaitResult(db, a.id, {timeoutMs: 0})).state).toBe('done');
    const c = await enqueue(db, {deviceId: id, generation: 1, kind: 'relay', payload: {}, ttlMs: 500, now: clock});
    expect((await awaitResult(db, c.id, {timeoutMs: 0, clock})).state).toBe('queued');
  });
  it('never sends a device origin to the network and refuses offline machines before queuing', async () => {
    const db = memory(), seen = [];
    const ctx = {db, fetch: async u => { seen.push(u); return new Response('{}'); }, now: () => 5000};
    const origin = deviceOrigin('e'.repeat(32), 'f'.repeat(64));
    expect(origin).toMatch(/\.fleet\.invalid\/$/);
    await expect(transportFetch(ctx)(new URL('/v1/coding', origin).href, {method: 'POST', body: '{}', headers: {'x-robinson-signature': 's'}})).rejects.toThrow(/offline/);
    expect(seen).toEqual([]);
    await transportFetch(ctx)('https://worker.example.test/v1/workspace', {method: 'POST', body: '{}'}); expect(seen).toHaveLength(1);
    expect(await deviceBaseline({db, now: () => 5000}, {placement: 'device', phase: 'attached'}, {workspace: undefined, binding: undefined})).toBeNull();
    expect(createPublicKey).toBeTypeOf('function');
  });
});
