// Real local Git and signed HTTP worker; only provider identity/transport failure is faked.
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { nativeGitServer } from '../../workers/native-git/server.js';
import { NativeGitWorker } from '../../workers/native-git/engine.js';
import { nativeConnection } from '../../src/native-git/client.js';
const KEY = 'FAKE-local-native-contract-worker-key';
export async function prepareNativeWorld(w, { existing = false } = {}) {
 const dir = await mkdtemp(join(tmpdir(), 'native-contract-')); const seed = join(dir, 'seed'); const root = join(dir, 'storage');
 const git = (...a) => execFileSync('git', a, { cwd: seed, stdio: 'pipe' });
 await mkdir(seed); git('init', '-b', 'main'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.test'); await writeFile(join(seed, 'file.txt'), 'fixture\n'); git('add', 'file.txt'); git('commit', '-m', 'fixture');
 if (existing) {
  const binding = { authority: randomBytes(16).toString('hex'), connection: nativeConnection(w.ctx), owner: 'example-org', repo: 'hello' };
  const worker = new NativeGitWorker({ root, authorize: async () => true, allowLocalFixtures: true, now: w.ctx.now });
  const opened = await worker.create(binding, { requestKey: 'fixture', fixtureRemote: seed });
  await w.db.createJob({ id: 'job_0123456789abcdef', connection: nativeConnection(w.ctx), owner: 'example-org', repo: 'hello', kind: 'native-git-workspace', ttlMinutes:240, providerRef: JSON.stringify({ authority: binding.authority, worker: opened.workspace_id }) });
 }
 const server = nativeGitServer({ root, key: KEY, now: w.ctx.now, allowLocalFixtures: true, fixtureRemote: () => seed });
 await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const origin = `http://127.0.0.1:${server.address().port}`;
 const providerFetch = w.gh.fetch;
 const multiplex = async (url, init) => {
  if (!String(url).startsWith('https://native-worker.example.test/')) return providerFetch(url, init);
  const payload = JSON.parse(init.body);
  w.nativeRequests ??= []; w.nativeRequests.push(payload.action);
  if (w.gh.nativeOutcome === 'mismatch') {
   if (payload.action === 'run') return new Response(JSON.stringify({ status: 'unconfirmed', generation: 0, idle_timeout_ms:payload.idleTimeoutMs, last_activity_at:w.ctx.now(), expires_at:w.ctx.now()+payload.idleTimeoutMs }));
   if (payload.action === 'close') return new Response(JSON.stringify({ disposed: false }));
   if (payload.action === 'inspect' && !existing) return new Response(JSON.stringify({ state: 'opening' }));
  }
  return fetch(origin + '/v1/workspace', init);
 };
 w.gh.fetch = multiplex; w.ctx = { ...w.ctx, fetch: multiplex, env: { ...w.ctx.env, NATIVE_GIT_WORKER_URL: 'https://native-worker.example.test/', NATIVE_GIT_WORKER_KEY: KEY } };
 return async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); };
}
