// PC-WORKER-1 (owner decision 2026-11-03: "my own use of this PC always wins instantly, so anything
// running on it must be pausable/killable and resumable, never defended"). The owner pause is a file on
// the worker volume (`<storage>/.owner-pause`, written by deploy/pc/pc-worker pause). While it exists the
// worker refuses new work with `no_operation_started` before anything starts; work already admitted
// finishes. The PC is reached on a Tailscale Funnel `https://<pc>.<tailnet>.ts.net` origin, which serves
// both the worker API and the direct git host. Every value here is fake.
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, readdir } from 'node:fs/promises';
import { writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { nativeGitServer } from '../../workers/native-git/server.js';
import { createResourceMonitor, OWNER_PAUSE_FILE, OWNER_PAUSED_TEXT, refusalText } from '../../workers/native-git/resources.js';
import { directConfig, directOrigins, directHost, gitDirectServer } from '../../workers/native-git/direct.js';
import { cleanOrigin } from '../../src/git-remote/wire.js';
import { signWorkerBody, workerUrl, nativeWorkerRoute, nativeWorkerHost } from '../../src/native-git/protocol.js';
import { callNativeWorker } from '../../src/native-git/client.js';
import { routeFor } from '../../src/native-git/relay.js';
import { directOrigin } from '../../src/git-remote/api.js';

const KEY = 'FAKE-worker-service-key-for-local-tests-only';
const PC = 'https://pc-example.tailnet-example.ts.net';
const MCP = 'https://mcp.example.test';
const DOKPLOY = 'https://worker.example.test';
const histogram = () => ({ percentile: () => 0, enable() {}, disable() {}, reset() {} });
const cleanups = [];
afterEach(async () => { for (const c of cleanups.splice(0).reverse()) await c(); });
// fetch() cannot set Host; Tailscale serve forwards the incoming Host, so the tests send it with node:http.
const get = (port, path, headers = {}) => new Promise((resolve, reject) => {
 const req = httpRequest({ host: '127.0.0.1', port, path, headers }, res => { let text = ''; res.setEncoding('utf8'); res.on('data', c => { text += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text })); });
 req.on('error', reject); req.end();
});
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();

async function world() {
 const dir = await mkdtemp(join(tmpdir(), 'pc-worker-pause-'));
 cleanups.push(() => rm(dir, { recursive: true, force: true }));
 const seed = join(dir, 'seed'), bare = join(dir, 'remote.git'), root = join(dir, 'storage');
 await mkdir(seed); git(seed, 'init', '-b', 'main'); git(seed, 'config', 'user.name', 'Fixture'); git(seed, 'config', 'user.email', 'fixture@example.test');
 await writeFile(join(seed, 'file.txt'), 'initial\n'); git(seed, 'add', 'file.txt'); git(seed, 'commit', '-m', 'initial'); git(dir, 'clone', '--bare', seed, bare);
 await mkdir(root);
 const hooks = { onClone: () => {} };
 const server = nativeGitServer({ root, key: KEY, allowLocalFixtures: true, resourcePolicy: { minMemoryBytes: 1, minDiskBytes: 1, maxLoopDelayMs: 5000 }, fixtureRemote: () => { hooks.onClone(); return bare; } });
 await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
 cleanups.push(() => new Promise(resolve => server.close(resolve)));
 const origin = `http://127.0.0.1:${server.address().port}`;
 const binding = { authority: 'a'.repeat(32), connection: 'b'.repeat(64), owner: 'example-org', repo: 'hello' };
 const call = async (claim) => {
  const body = JSON.stringify({ version: 3, expiresAt: Date.now() + 60000, scannerPolicy: { settings: undefined, revision: 0 }, ...claim });
  const res = await fetch(origin + '/v1/workspace', { method: 'POST', headers: { 'content-type': 'application/json', 'x-robinson-signature': signWorkerBody(body, KEY) }, body });
  return { status: res.status, retryAfter: res.headers.get('retry-after'), body: await res.json() };
 };
 const open = requestKey => call({ action: 'open', binding, requestKey, allowWrite: true, idleTimeoutMs: 600000, options: { ttlMs: 600000 } });
 const pause = () => writeFileSync(join(root, OWNER_PAUSE_FILE), 'paused\n');
 const resume = () => rm(join(root, OWNER_PAUSE_FILE), { force: true });
 return { root, call, open, pause, resume, hooks, binding };
}

describe('owner pause switch (worker side)', () => {
 it('the resource monitor refuses every admission while the pause file exists and recovers when it is removed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pc-worker-monitor-')); cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const pauseFile = join(dir, OWNER_PAUSE_FILE);
  const monitor = createResourceMonitor({ root: dir, delay: histogram(), policy: { minMemoryBytes: 1, minDiskBytes: 1 }, pauseFile });
  cleanups.push(() => monitor.close());
  expect(await monitor.check()).toEqual({ allowed: true });
  writeFileSync(pauseFile, '');
  expect(monitor.paused()).toBe(true);
  expect(await monitor.check()).toEqual({ allowed: false, reason: 'owner_paused', retryAfterSeconds: 60 });
  expect(await monitor.check({ needsDisk: false })).toMatchObject({ reason: 'owner_paused' });
  // Request bodies are still read (a status call is not new work); admission decides.
  expect(monitor.body(100).allowed).toBe(true);
  await rm(pauseFile);
  expect(await monitor.check()).toEqual({ allowed: true });
  // Never defended: an observation that cannot tell counts as paused.
  const unsure = createResourceMonitor({ root: dir, delay: histogram(), policy: { minMemoryBytes: 1, minDiskBytes: 1 }, pauseFile, paused: () => { throw new Error('private /data path'); } });
  cleanups.push(() => unsure.close());
  expect(await unsure.check()).toMatchObject({ reason: 'owner_paused' });
  // Without a pause file configured (other deployments) nothing changes.
  const plain = createResourceMonitor({ root: dir, delay: histogram(), policy: { minMemoryBytes: 1, minDiskBytes: 1 } });
  cleanups.push(() => plain.close()); writeFileSync(pauseFile, '');
  expect(await plain.check()).toEqual({ allowed: true }); expect(plain.paused()).toBe(false);
  expect(refusalText({ reason: 'owner_paused' }, 'pressure')).toBe(OWNER_PAUSED_TEXT);
  expect(refusalText({ reason: 'memory_pressure' }, 'pressure')).toBe('pressure');
 });

 it('refuses a new clone with no_operation_started while paused, starts nothing, and accepts it again after resume', async () => {
  const w = await world();
  w.pause();
  const refused = await w.open('open-paused');
  expect(refused.status).toBe(429);
  expect(refused.retryAfter).toBe('60');
  expect(refused.body).toMatchObject({ error: 'worker_resource_pressure', reason: 'owner_paused', phase: 'admission', no_operation_started: true, next: OWNER_PAUSED_TEXT });
  expect((await readdir(w.root)).filter(name => name.startsWith('git_'))).toEqual([]);
  // Capabilities still answer (status is not new work) and say the worker is paused.
  const caps = await w.call({ action: 'capabilities' });
  expect(caps.status).toBe(200);
  expect(caps.body).toMatchObject({ ready: true, owner_paused: true, admission: { allowed: false, reason: 'owner_paused' } });
  await w.resume();
  const opened = await w.open('open-after-resume');
  expect(opened.status, JSON.stringify(opened.body)).toBe(200);
  expect(opened.body.state).toBe('ready');
  const after = await w.call({ action: 'capabilities' });
  expect(after.body.owner_paused).toBeUndefined();
  expect(after.body.admission).toEqual({ allowed: true });
 });

 it('lets work admitted before the pause finish, then refuses the next request', async () => {
  const w = await world();
  // The pause lands while the clone is already running (after admission).
  w.hooks.onClone = () => w.pause();
  const inFlight = await w.open('open-in-flight');
  expect(inFlight.status, JSON.stringify(inFlight.body)).toBe(200);
  expect(inFlight.body.state).toBe('ready');
  expect(existsSync(join(w.root, OWNER_PAUSE_FILE))).toBe(true);
  const id = inFlight.body.workspace_id;
  const next = await w.call({ action: 'run', operation: 'branch_create', workspace_id: id, binding: w.binding, requestKey: 'next', expectedGeneration: inFlight.body.generation, allowWrite: true, idleTimeoutMs: 600000, options: { name: 'topic' } });
  expect(next.status).toBe(429);
  expect(next.body).toMatchObject({ reason: 'owner_paused', no_operation_started: true });
  // A metadata-only status inspect still answers while paused (it starts nothing).
  const status = await w.call({ action: 'inspect', workspace_id: id, binding: w.binding, renewLease: false });
  expect(status.status, JSON.stringify(status.body)).toBe(200);
 });

 it('the direct git host refuses a new git request while paused, before any key check or authorization call', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pc-worker-direct-')); cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const pauseFile = join(dir, OWNER_PAUSE_FILE); writeFileSync(pauseFile, '');
  const monitor = createResourceMonitor({ root: dir, delay: histogram(), policy: { minMemoryBytes: 1, minDiskBytes: 1 }, pauseFile }); cleanups.push(() => monitor.close());
  let authorizeCalls = 0;
  const server = gitDirectServer({ root: dir, key: KEY, monitor, local: true, config: { origin: PC, control: MCP, port: 0 }, identity: { publicKey: 'ed25519:FAKE', sign: () => 'x' },
   fetchImpl: async () => { authorizeCalls++; return Response.json({ allow: true, claim: 'FAKE-claim', limits: { push_bytes: 1024 } }); } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); cleanups.push(() => new Promise(resolve => server.close(resolve)));
  const port = server.address().port;
  const health = await fetch(`http://127.0.0.1:${port}/health`);
  expect(health.status).toBe(200);
  const res = await get(port, '/git/example-org/hello.git/info/refs?service=git-upload-pack', { host: new URL(PC).host, authorization: 'Basic ' + Buffer.from('x:FAKE-session-key').toString('base64') });
  expect(res.status).toBe(503);
  expect(res.headers['retry-after']).toBe('60');
  expect(res.text).toBe(OWNER_PAUSED_TEXT + '\n');
  expect(authorizeCalls).toBe(0);
  await rm(pauseFile);
  const resumed = await get(port, '/git/example-org/hello.git/info/refs?service=git-upload-pack', { host: new URL(PC).host });
  expect(resumed.status).toBe(401);
 });
});

describe('control plane reading the owner pause', () => {
 const ctx = fetch => ({ env: { NATIVE_GIT_WORKER_URL: PC + '/', NATIVE_GIT_WORKER_KEY: KEY }, fetch });
 it('explains the owner pause plainly and marks it as no operation started', async () => {
  const body = JSON.stringify({ error: 'worker_resource_pressure', reason: 'owner_paused', phase: 'admission', no_operation_started: true });
  const error = await callNativeWorker(ctx(async () => new Response(body, { status: 429 })), { action: 'capabilities' }).catch(e => e);
  expect(error).toMatchObject({ safeMessage: true, nativeCode: 'native_busy', safeRetryable: true, nativeNoOperationStarted: true, status: 429 });
  expect(error.message).toContain('paused by its owner');
  expect(error.message).toContain('No operation was started');
 });
 it('names a stopped host behind the tunnel (non-JSON 502/503/504) without claiming nothing started', async () => {
  for (const status of [502, 503, 504]) {
   const error = await callNativeWorker(ctx(async () => new Response('<html>Bad gateway</html>', { status })), { action: 'capabilities' }).catch(e => e);
   expect(error).toMatchObject({ safeMessage: true, nativeCode: 'native_transport', status });
   expect(error.message).toContain('may be paused by its owner');
   expect(error.message).toContain('outcome may be unknown');
   expect(error.message).not.toContain('Bad gateway');
  }
  const other = await callNativeWorker(ctx(async () => new Response('not json', { status: 500 })), { action: 'capabilities' }).catch(e => e);
  expect(other.nativeCode).toBe('native_response');
 });
});

describe('Tailscale Funnel origin (https://<pc>.<tailnet>.ts.net) as primary worker and direct git host', () => {
 it('is accepted as worker origin, direct git origin and relay route, with Dokploy kept as the previous worker', () => {
  expect(cleanOrigin(PC)).toBe(PC);
  expect(cleanOrigin(PC + '/')).toBe(PC);
  expect(cleanOrigin(PC + '/git')).toBeNull();
  expect(cleanOrigin(PC.replace('https:', 'http:'))).toBeNull();
  expect(workerUrl({ NATIVE_GIT_WORKER_URL: PC })).toBe(PC + '/v1/workspace');
  expect(directOrigin({ GIT_DIRECT_ORIGIN: PC })).toBe(PC);
  expect(directOrigins({ origin: PC, control: MCP })).toEqual({ origin: PC, control: MCP });
  expect(directConfig({ GIT_DIRECT_ORIGIN: PC, GIT_DIRECT_CONTROL_ORIGIN: MCP })).toMatchObject({ origin: PC, control: MCP, port: 3001 });
  const env = { NATIVE_GIT_WORKER_URL: PC, NATIVE_GIT_PREVIOUS_WORKER_URL: DOKPLOY, NATIVE_GIT_WORKER_CUTOVER_AT: '2026-11-03T12:00:00Z' };
  // Workspaces created on Dokploy keep resolving there; new ones go to the PC.
  expect(nativeWorkerRoute(env, { host: nativeWorkerHost({ NATIVE_GIT_WORKER_URL: DOKPLOY }) })).toBe(DOKPLOY + '/v1/workspace');
  expect(nativeWorkerRoute(env, { host: nativeWorkerHost({ NATIVE_GIT_WORKER_URL: PC }) })).toBe(PC + '/v1/workspace');
  expect(nativeWorkerRoute(env)).toBe(PC + '/v1/workspace');
  expect(routeFor(env, PC)).toBe('w');
  expect(routeFor(env, DOKPLOY)).toBe('p');
 });
 it('one host serves both: the direct host answers git only for its own ts.net name, health on /health', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pc-worker-host-')); cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const host = directHost({ root: dir, identity: { publicKey: 'ed25519:FAKE', sign: () => 'x' }, env: { GIT_DIRECT_ORIGIN: PC, GIT_DIRECT_CONTROL_ORIGIN: MCP }, listen: async () => {} });
  expect(host.report()).toMatchObject({ origin: PC, control: MCP, source: 'environment' });
  const server = gitDirectServer({ root: dir, key: KEY, config: () => host.config, identity: { publicKey: 'ed25519:FAKE', sign: () => 'x' }, fetchImpl: async () => { throw new Error('not reached'); } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); cleanups.push(() => new Promise(resolve => server.close(resolve)));
  const port = server.address().port;
  // Tailscale serve keeps the incoming Host and maps /health to the direct port's /health.
  expect((await get(port, '/health', { host: new URL(PC).host })).text).toBe('ok\n');
  const stray = await get(port, '/git/example-org/hello.git/info/refs?service=git-upload-pack', { host: 'other.example.test' });
  expect(stray.status).toBe(421);
  const own = await get(port, '/git/example-org/hello.git/info/refs?service=git-upload-pack', { host: new URL(PC).host });
  expect(own.status).toBe(401);
  expect(own.headers['www-authenticate']).toContain('Basic');
 });
});
