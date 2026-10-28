import { it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { nativeGitServer } from '../../workers/native-git/server.js';
import { signWorkerBody, verifyWorkerBody, workerUrl } from '../../src/native-git/protocol.js';
import { makeWorld, parse } from '../../test/helpers/write-contract.js';
import { createDispatch } from '../../src/tools/dispatch.js';
import { registry } from '../../src/tools/index.js';

const KEY = 'FAKE-worker-service-key-for-local-tests-only';
let dir, bare, server, origin, w, requests, asymmetric;
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
beforeEach(async () => {
 dir = await mkdtemp(join(tmpdir(), 'native-service-')); const seed = join(dir, 'seed'); bare = join(dir, 'remote.git');
 await mkdir(seed); git(seed, 'init', '-b', 'main'); git(seed, 'config', 'user.name', 'Fixture'); git(seed, 'config', 'user.email', 'fixture@example.test');
 await writeFile(join(seed, 'file.txt'), 'initial\n'); git(seed, 'add', 'file.txt'); git(seed, 'commit', '-m', 'initial'); git(dir, 'clone', '--bare', seed, bare);
 w = await makeWorld({ mode: 'production', profile: 'full' }); requests = []; asymmetric = false;
 server = nativeGitServer({ root: join(dir, 'storage'), key: KEY, now: w.ctx.now, allowLocalFixtures: true, fixtureRemote: () => bare });
 await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${server.address().port}`;
 w.gh.when('GET /repos/{owner}/{repo}').reply(200, { full_name: 'example-org/hello', default_branch: 'main' });
});
afterEach(async () => { await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); });
async function invoke(name, args, connection = w.connection) {
 const run = createDispatch({ ...w.ctx, env: { ...w.ctx.env, NATIVE_GIT_WORKER_URL: 'https://worker.example.test/', ...(asymmetric ? {} : { NATIVE_GIT_WORKER_KEY: KEY }) }, gates: [], fetch: async (url, init) => {
  if (String(url).startsWith('https://worker.example.test/')) { requests.push(JSON.parse(init.body)); return fetch(origin + '/v1/workspace', init); }
  return w.gh.fetch(url, init);
 } });
 return run({ registry, name, args, connection, db: w.db });
}
async function opened() {
 const result = parse(await invoke('github_git_workspace_open', { owner: 'example-org', repo: 'hello' }));
 expect(result.status, JSON.stringify(result)).toBe('applied'); return result.result.workspace_id;
}
it('verifies internal signatures, expiry, fixed origin and non-write grants', async () => {
 const lease = JSON.stringify({ version: 1, action: 'inspect', expiresAt: w.ctx.now() + 60000 });
 expect(verifyWorkerBody(lease, signWorkerBody(lease, KEY), KEY, w.ctx.now()).action).toBe('inspect');
 expect(() => verifyWorkerBody(lease, signWorkerBody(lease + 'x', KEY), KEY, w.ctx.now())).toThrow(/authorization/);
 expect(() => verifyWorkerBody(lease, signWorkerBody(lease, KEY), KEY, w.ctx.now() + 60001)).toThrow(/Expired/);
 expect(() => workerUrl({ NATIVE_GIT_WORKER_URL: 'http://untrusted.test' })).toThrow(/HTTPS/);
 const denied = await fetch(origin + '/v1/workspace', { method: 'POST', body: lease }); expect(denied.status).toBe(401);
 expect(JSON.stringify(await denied.json())).not.toContain(KEY);
});
it('opens through MCP, makes a native edit, reads exact bytes and independently disposes the workspace', async () => {
 const id = await opened();
 const changed = parse(await invoke('github_git_workspace_run', { workspace_id: id, operation: 'write_file', expectedGeneration: 0, options: { path: 'file.txt', base64: Buffer.from('changed\n').toString('base64') } }));
 expect(changed.status, JSON.stringify(changed)).toBe('applied');
 expect(changed.result.workspace.generation).toBe(1);
 const result = parse(await invoke('github_git_workspace_read', { workspace_id: id, operation: 'read_file', options: { path: 'file.txt' }, byteLength: 32768 }));
 expect(Buffer.from(result.content_base64, 'base64').toString()).toBe('changed\n'); expect(result.file_hash).toMatch(/^[a-f0-9]{64}$/);
 const closed = parse(await invoke('github_git_workspace_close', { workspace_id: id }));
 expect(closed.status, JSON.stringify(closed)).toBe('applied'); expect(closed.result.disposed).toBe(true);
 const missing = await invoke('github_git_workspace_read', { workspace_id: id, operation: 'status' }); expect(missing.isError).toBe(true);
 expect(w.gh.invalid).toEqual([]);
});
it('revalidates provider access before cached reads and never exposes another connection’s workspace', async () => {
 const id = await opened(); const count = requests.length;
 const foreign = await invoke('github_git_workspace_read', { workspace_id: id, operation: 'status' }, { ...w.connection, client_id: 'different-client' });
 expect(foreign.isError).toBe(true); expect(requests).toHaveLength(count);
 w.gh.when('GET /repos/{owner}/{repo}').reply(403, { message: 'Access revoked' });
 const denied = await invoke('github_git_workspace_read', { workspace_id: id, operation: 'status' });
 expect(denied.isError).toBe(true); expect(requests).toHaveLength(count);
});
it('preserves dry runs, read-only grants and immutable write replay through the dispatcher', async () => {
 const preview = parse(await invoke('github_git_workspace_open', { owner: 'example-org', repo: 'hello', dryRun: true })); expect(preview.status).toBe('preview'); expect(requests).toHaveLength(0);
 const denied = await invoke('github_git_workspace_open', { owner: 'example-org', repo: 'hello' }, { ...w.connection, profile: 'read_only' }); expect(denied.isError).toBe(true); expect(requests).toHaveLength(0);
 const id = await opened(); const args = { workspace_id: id, operation: 'branch_create', expectedGeneration: 0, options: { name: 'topic' }, requestKey: 'native-replay-intent' };
 const first = parse(await invoke('github_git_workspace_run', args)); expect(first.status).toBe('applied');
 const count = requests.filter(r => r.action === 'run').length;
 const again = parse(await invoke('github_git_workspace_run', args)); expect(again.replayed).toBe(true);
 expect(requests.filter(r => r.action === 'run')).toHaveLength(count);
});

it('reports actual signed worker capabilities and pages connection-bound workspace IDs', async () => {
 const capabilities = parse(await invoke('github_git_workspace_read', { operation: 'capabilities' }));
 expect(capabilities.worker.ready).toBe(true); expect(capabilities.worker.native_git).toContain('git version');
 expect(capabilities.unsupported.map(x => x.feature)).toContain('LFS');
 const id = await opened();
 const inventory = parse(await invoke('github_git_workspace_list', { max: 1 }));
 expect(inventory.items).toMatchObject([{ workspace_id: id, owner: 'example-org', repo: 'hello' }]); expect(inventory.next_cursor).toBeNull(); expect(inventory.complete).toBe(true);
 expect(JSON.stringify(inventory)).not.toContain('authority');
});

it('relays a stated content-protection refusal and returns a value-free report for an uncommitted file', async () => {
 const id = await opened();
 const { nativeConnection } = await import('../../src/native-git/client.js');
 const row = await w.db.getJob(id, nativeConnection(w.ctx)); const backend = JSON.parse(row.provider_ref).worker;
 const candidate = 'rtc_pass_' + 'a'.repeat(43);
 await writeFile(join(dir, 'storage', backend, 'repo', 'sensitive.txt'), candidate);
 const denied = await invoke('github_git_workspace_read', { workspace_id: id, operation: 'read_file', options: { path: 'sensitive.txt' }, byteLength: 8 });
 expect(denied.isError).toBe(true); expect(JSON.stringify(denied)).toContain('content protection'); expect(JSON.stringify(denied)).toContain('protection_check'); expect(JSON.stringify(denied)).not.toContain(candidate);
 const report = parse(await invoke('github_git_workspace_read', { workspace_id: id, operation: 'protection_check', options: { path: 'sensitive.txt' } }));
 expect(report.total_findings).toBe(1); expect(report.matched_values_returned).toBe(false); expect(JSON.stringify(report)).not.toContain(candidate);
});
it('never releases another request’s active workspace lock when a busy request is refused', async () => {
 const id = await opened();
 const { nativeConnection } = await import('../../src/native-git/client.js');
 const row = await w.db.getJob(id, nativeConnection(w.ctx)); const backend = JSON.parse(row.provider_ref).worker;
 const binding = requests.find(r => r.action === 'open').binding;
 const body = JSON.stringify({ version: 1, action: 'inspect', binding, workspace_id: backend, expiresAt: w.ctx.now() + 60000 });
 const statuses = await Promise.all(Array.from({ length: 5 }, async () => {
  const response = await fetch(origin + '/v1/workspace', { method: 'POST', body, headers: { 'x-robinson-signature': signWorkerBody(body, KEY) } }); await response.text(); return response.status;
 }));
 expect(statuses.filter(x => x === 200)).toHaveLength(1); expect(statuses.filter(x => x === 409)).toHaveLength(4);
 const after = await fetch(origin + '/v1/workspace', { method: 'POST', body, headers: { 'x-robinson-signature': signWorkerBody(body, KEY) } }); expect(after.status).toBe(200); await after.text();
});

it('executes a real MCP clone with only a public verification key on the worker', async () => {
 const { nativeWorkerPublicKey } = await import('../../src/native-git/signing.js');
 server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
 server = nativeGitServer({ root: join(dir, 'storage'), key: nativeWorkerPublicKey(w.ctx.env), now: w.ctx.now, allowLocalFixtures: true, fixtureRemote: () => bare });
 await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${server.address().port}`; asymmetric = true;
 const id = await opened(); expect(id).toMatch(/^job_/);
 const state = parse(await invoke('github_git_workspace_read', { workspace_id: id, operation: 'status' })); expect(state.state).toBe('ready');
 expect(requests.every(r => !Object.hasOwn(r, 'signingKey'))).toBe(true);
});
