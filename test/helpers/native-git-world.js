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
export async function prepareNativeWorld(w, { existing = false } = {}) {
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
 const resources=createResourceMonitor({root});
 // These signed HTTP fixtures share the test runner's event loop. Wait for
 // observed readiness after fixture/module startup, without overriding limits.
 w.nativeReady=async()=>{const deadline=Date.now()+3000;let sample;do{sample=await resources.check();if(sample.allowed)return;await pause(25);}while(Date.now()<deadline);throw new Error('Native fixture not ready: '+sample.reason);};
 const server = nativeGitServer({ resources, root, key: KEY, now: w.ctx.now, allowLocalFixtures: true, fixtureRemote: () => seed });
 await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const origin = `http://127.0.0.1:${server.address().port}`;
 if (w.nativeFixture) w.nativeFixture.origin = origin;
 w.nativeSeed = seed;
 const providerFetch = w.gh.fetch;
 const multiplex = async (url, init) => {
  if (!String(url).startsWith('https://native-worker.example.test/')) return providerFetch(url, init);
  const payload = JSON.parse(init.body);
  w.nativeRequests ??= []; w.nativeRequests.push(payload.action);
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
  return fetch(origin + '/v1/workspace', init);
 };
 w.gh.fetch = multiplex; w.ctx = { ...w.ctx, fetch: multiplex, env: { ...w.ctx.env, NATIVE_GIT_WORKER_URL: 'https://native-worker.example.test/', NATIVE_GIT_WORKER_KEY: KEY, PUBLIC_BASE_URL: 'https://mcp.example.test' } };
 // SINGLE-DOMAIN-1: one-time addresses are issued on PUBLIC_BASE_URL; this runs the real middleware in front of the worker.
 const relay = await startTransferRelay({ env: () => w.ctx.env, now: w.ctx.now, destinations: { 'https://native-worker.example.test': origin } });
 w.transferRelay = relay;
 w.transferLocal = url => relay.local(url).replace('https://native-worker.example.test', origin);
 return async () => { await relay.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); };
}
