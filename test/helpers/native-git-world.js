// Real local Git and signed HTTP worker; only provider identity/transport failure is faked.
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {createResourceMonitor} from '../../workers/native-git/resources.js';
import {setTimeout as pause} from 'node:timers/promises';
import { nativeGitServer } from '../../workers/native-git/server.js';
import { NativeGitWorker } from '../../workers/native-git/engine.js';
import { nativeConnection } from '../../src/native-git/client.js';
import { startTransferRelay } from './transfer-relay.js';
const KEY = 'FAKE-local-native-contract-worker-key';
// WORKER-POOL-1: `pool` adds more real signed worker hosts behind the same control plane, e.g.
// [{ name: 'dokploy', role: 'previous' }, { name: 'workshop', maxWorkspaces: 1 }, { name: 'laptop', offline: true }].
// The primary is named "pc" in NATIVE_GIT_WORKER_POOL. Per host: w.pool[name] = { root, origin, requests, pause(),
// resume(), pressure (set a reason string to fail admission) }. `primary` sets the same options for the primary.
export const POOL_ORIGIN = name => `https://native-worker-${name}.example.test`;
export async function prepareNativeWorld(w, { existing = false, pool = null, primary = {} } = {}) {
 const dir = await mkdtemp(join(tmpdir(), 'native-contract-')); const seed = join(dir, 'seed'); const root = join(dir, 'storage');
 const git = (...a) => execFileSync('git', a, { cwd: seed, stdio: 'pipe' });
 await mkdir(seed); git('init', '-b', 'main'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.test'); await writeFile(join(seed, 'file.txt'), 'fixture\n'); git('add', 'file.txt'); git('commit', '-m', 'fixture');
 if (existing) {
  const binding = { authority: randomBytes(16).toString('hex'), connection: nativeConnection(w.ctx), owner: 'example-org', repo: 'hello' };
  const worker = new NativeGitWorker({ root, authorize: async () => true, allowLocalFixtures: true, now: w.ctx.now });
  const opened = await worker.create(binding, { requestKey: 'fixture', fixtureRemote: seed });
  w.nativeFixture = { root, binding, workerId: opened.workspace_id, key: KEY, seed };
  await w.db.createJob({ id: 'job_0123456789abcdef', connection: nativeConnection(w.ctx), owner: 'example-org', repo: 'hello', kind: 'native-git-workspace', ttlMinutes:240, providerRef: JSON.stringify({ authority: binding.authority, worker: opened.workspace_id }) });
 }
 const baseResources=createResourceMonitor({root,pauseFile:join(root,'.owner-pause')});
 const hostControl=(hostRoot,monitor)=>{const control={root:hostRoot,requests:[],pressure:null,
  pause:async()=>{await mkdir(hostRoot,{recursive:true});await writeFile(join(hostRoot,'.owner-pause'),'');},
  resume:async()=>{await rm(join(hostRoot,'.owner-pause'),{force:true});}};
  control.monitor={...monitor,check:async o=>control.pressure?{allowed:false,reason:control.pressure,retryAfterSeconds:2}:monitor.check(o),close:()=>monitor.close()};return control;};
 const primaryControl=hostControl(root,baseResources);
 const resources=pool?primaryControl.monitor:baseResources;
 // These signed HTTP fixtures share the test runner's event loop. Wait for
 // observed readiness after fixture/module startup, without overriding limits.
 w.nativeReady=async()=>{const monitors=[resources,...(w.pool?Object.values(w.pool).filter(h=>h!==primaryControl).map(h=>h.monitor):[])];const deadline=Date.now()+5000;let sample;do{sample=null;for(const m of monitors){const one=await m.check();if(!one.allowed){sample=one;break;}}if(!sample)return;await pause(25);}while(Date.now()<deadline);throw new Error('Native fixture not ready: '+sample.reason);};
 const server = nativeGitServer({ resources, root, key: KEY, now: w.ctx.now, allowLocalFixtures: true, fixtureRemote: () => seed, ...(primary.maxWorkspaces ? { maxWorkspaces: primary.maxWorkspaces } : {}) });
 await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const origin = `http://127.0.0.1:${server.address().port}`;
 const extra = [];
 if (pool) {
  primaryControl.origin = 'https://native-worker.example.test'; w.pool = { pc: primaryControl };
  for (const host of pool) {
   const hostRoot = join(dir, 'storage-' + host.name), control = hostControl(hostRoot, createResourceMonitor({ root: hostRoot, pauseFile: join(hostRoot, '.owner-pause') }));
   control.origin = POOL_ORIGIN(host.name); w.pool[host.name] = control;
   if (host.offline) { extra.push({ host, control, server: null, local: null }); continue; }
   const hostServer = nativeGitServer({ resources: control.monitor, root: hostRoot, key: KEY, now: w.ctx.now, allowLocalFixtures: true, fixtureRemote: () => seed, ...(host.maxWorkspaces ? { maxWorkspaces: host.maxWorkspaces } : {}) });
   await new Promise(resolve => hostServer.listen(0, '127.0.0.1', resolve));
   extra.push({ host, control, server: hostServer, local: `http://127.0.0.1:${hostServer.address().port}` });
  }
 }
 if (w.nativeFixture) w.nativeFixture.origin = origin;
 w.nativeSeed = seed;
 const providerFetch = w.gh.fetch;
 const mismatch = payload => {
  if (w.gh.nativeOutcome === 'mismatch') {
   if (payload.action === 'upload_status') return new Response(JSON.stringify({ upload_id: 'upl_' + '0'.repeat(32), state: 'expired', mode: 'archive', idle_timeout_ms:payload.idleTimeoutMs, last_activity_at:w.ctx.now(), expires_at:w.ctx.now()+payload.idleTimeoutMs }));
   if (payload.action === 'download_status') return new Response(JSON.stringify({ download_id: 'dl_' + '0'.repeat(32), state: 'expired', mode: 'archive', idle_timeout_ms:payload.idleTimeoutMs, last_activity_at:w.ctx.now(), expires_at:w.ctx.now()+payload.idleTimeoutMs }));
   if (payload.action === 'upload_apply') return new Response(JSON.stringify({ status: 'unconfirmed', generation: 0, idle_timeout_ms:payload.idleTimeoutMs, last_activity_at:w.ctx.now(), expires_at:w.ctx.now()+payload.idleTimeoutMs }));
   if (payload.action === 'run') return new Response(JSON.stringify({ status: 'unconfirmed', generation: 0, idle_timeout_ms:payload.idleTimeoutMs, last_activity_at:w.ctx.now(), expires_at:w.ctx.now()+payload.idleTimeoutMs }));
   if (payload.action === 'close') return new Response(JSON.stringify({ disposed: false }));
   // A clone that the read-back finds failed. (Status inspects no longer renew the idle lease,
   // so the mismatch is a real state disagreement, not a missing lease field.)
   if (payload.action === 'inspect' && !existing) return new Response(JSON.stringify({ state: 'failed', generation: 0 }));
  }
  return null;
 };
 const multiplex = async (url, init) => {
  const other = extra.find(x => String(url).startsWith(x.control.origin + '/'));
  if (other) {
   const payload = JSON.parse(init.body); other.control.requests.push(payload.action);
   if (!other.local) throw new TypeError('fetch failed');
   const forced = mismatch(payload); if (forced) return forced;
   return fetch(other.local + '/v1/workspace', init);
  }
  if (!String(url).startsWith('https://native-worker.example.test/')) return providerFetch(url, init);
  const payload = JSON.parse(init.body);
  if (pool) primaryControl.requests.push(payload.action);
  w.nativeRequests ??= []; w.nativeRequests.push(payload.action);
  const forced = mismatch(payload); if (forced) return forced;
  return fetch(origin + '/v1/workspace', init);
 };
 const poolEnv = pool ? {
  ...(pool.some(h => h.role === 'previous') ? { NATIVE_GIT_PREVIOUS_WORKER_URL: POOL_ORIGIN(pool.find(h => h.role === 'previous').name) + '/' } : {}),
  NATIVE_GIT_WORKER_POOL: JSON.stringify([{ name: 'pc', origin: 'https://native-worker.example.test', ...(primary.limit ? { maxWorkspaces: primary.limit } : {}) },
   ...pool.map((h, i) => ({ name: h.name, origin: POOL_ORIGIN(h.name), ...(h.role === 'previous' ? {} : { priority: h.priority ?? 50 + i }), ...(h.limit ? { maxWorkspaces: h.limit } : {}), ...(h.enabled === false ? { enabled: false } : {}) }))])
 } : {};
 w.gh.fetch = multiplex; w.ctx = { ...w.ctx, fetch: multiplex, env: { ...w.ctx.env, NATIVE_GIT_WORKER_URL: 'https://native-worker.example.test/', NATIVE_GIT_WORKER_KEY: KEY, PUBLIC_BASE_URL: 'https://mcp.example.test', ...poolEnv } };
 // SINGLE-DOMAIN-1: one-time addresses are issued on PUBLIC_BASE_URL; this runs the real middleware in front of the worker.
 const destinations = { 'https://native-worker.example.test': origin };
 for (const x of extra) if (x.local) destinations[x.control.origin] = x.local;
 const relay = await startTransferRelay({ env: () => w.ctx.env, now: w.ctx.now, destinations });
 w.transferRelay = relay;
 w.transferLocal = url => { let out = relay.local(url).replace('https://native-worker.example.test', origin); for (const x of extra) if (x.local) out = out.replace(x.control.origin, x.local); return out; };
 return async () => { await relay.close(); for (const x of [{ server }, ...extra]) if (x.server) { x.server.closeAllConnections(); await new Promise(resolve => x.server.close(resolve)); } await rm(dir, { recursive: true, force: true }); };
}
