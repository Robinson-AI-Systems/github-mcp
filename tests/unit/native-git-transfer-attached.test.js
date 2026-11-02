// SINGLE-DOMAIN-1: a workspace attached to a Playground runtime downloads and uploads from the
// runtime's own (authoritative) copy, through this service's single domain: relay (real middleware)
// → runtime ingress (real ingress.js) → runtime broker (real native Git server pinned to the
// Ed25519 control-plane key and this one workspace). Older runtimes and own-computer runtimes are
// refused plainly with the fallback.
import { afterEach, it, expect } from 'vitest';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createServer, request as httpRequest } from 'node:http';
import { execFileSync, spawn } from 'node:child_process';
import { makeWorld, parse } from '../../test/helpers/write-contract.js';
import { prepareNativeWorld } from '../../test/helpers/native-git-world.js';
import { startTransferRelay } from '../../test/helpers/transfer-relay.js';
import { nativeGitServer } from '../../workers/native-git/server.js';
import { createResourceMonitor } from '../../workers/native-git/resources.js';
import { NativeGitWorker } from '../../workers/native-git/engine.js';
import { ingressServer } from '../../workers/coding-workspace/ingress.js';
import { nativeWorkerPublicKey } from '../../src/native-git/signing.js';
import { nativeBindingHash } from '../../src/native-git/protocol.js';
import * as native from '../../src/tools/native-git.js';

const WORKSPACE = 'job_0123456789abcdef';
const BROKER = 'https://ras-pg-' + '1'.repeat(32) + '-203-0-113-10.sslip.io';
const ENV = { ...process.env, http_proxy: '', HTTP_PROXY: '', https_proxy: '', HTTPS_PROXY: '', ALL_PROXY: '', all_proxy: '', NO_PROXY: '*', no_proxy: '*', GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
const spawnAsync = (cmd, args, opts) => new Promise(resolve => { const child = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] }); let stderr = ''; child.stderr.on('data', c => { stderr += c; }); child.on('close', status => resolve({ status, stderr })); });
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const cleanups = [];
afterEach(async () => { for (const close of cleanups.splice(0)) await close(); });
const call = (w, name, args) => native.handlers[name](args, w.ctx).then(parse);

async function attachedWorld({ ingress = 'current', origin = BROKER } = {}) {
 const w = await makeWorld({ profile: 'full', mode: 'production', gates: [] });
 w.gh.nativeOutcome = 'ok'; w.gh.when('GET /repos/{owner}/{repo}').reply(200, { full_name: 'example-org/hello', default_branch: 'main' });
 cleanups.push(await prepareNativeWorld(w, { existing: true }));
 const { binding, workerId, seed } = w.nativeFixture;
 // The runtime's copy: same workspace identity, plus one commit that exists only there.
 const dir = await mkdtemp(join(tmpdir(), 'broker-')); cleanups.push(() => rm(dir, { recursive: true, force: true }));
 const root = join(dir, 'storage');
 await new NativeGitWorker({ root, authorize: async () => true, allowLocalFixtures: true, now: w.ctx.now }).create(binding, { requestKey: 'fixture', fixtureRemote: seed });
 const repo = join(root, workerId, 'repo'), git = (...a) => execFileSync('git', a, { cwd: repo, stdio: 'pipe' });
 await writeFile(join(repo, 'runtime.txt'), 'made in the runtime\n'); git('add', 'runtime.txt'); git('-c', 'user.name=Runtime', '-c', 'user.email=runtime@example.test', 'commit', '-m', 'runtime work');
 w.brokerRepo = repo;
 // This in-process broker shares the test runner's event loop with the control plane under test (in
 // production they are separate processes), so its loop-delay admission would measure the test's own
 // first-call work. Memory and disk admission keep their defaults; only the shared-loop delay is widened.
 const resources = createResourceMonitor({ root, policy: { maxLoopDelayMs: 5000 } });
 const broker = nativeGitServer({ resources, root, key: nativeWorkerPublicKey(w.ctx.env), now: w.ctx.now, singleWorkspaceId: workerId, singleBinding: nativeBindingHash(binding) });
 const brokerPort = await listen(broker); cleanups.push(() => { broker.closeAllConnections(); return new Promise(r => broker.close(r)); });
 const coding = createServer((_req, res) => { res.writeHead(404); res.end(); }); const codingPort = await listen(coding); cleanups.push(() => new Promise(r => coding.close(r)));
 const front = ingress === 'current' ? ingressServer({ coding: { hostname: '127.0.0.1', port: codingPort }, broker: { hostname: '127.0.0.1', port: brokerPort } })
  // An older ingress: only /v1/workspace reaches the broker; everything else goes to the coding server.
  : createServer((req, res) => { if (req.url !== '/v1/workspace') { req.resume(); res.writeHead(404); return res.end(); } req.pipe(httpRequest({ hostname: '127.0.0.1', port: brokerPort, path: req.url, method: req.method, headers: req.headers }, a => { res.writeHead(a.statusCode, a.headers); a.pipe(res); })); });
 const frontPort = await listen(front); cleanups.push(() => { front.closeAllConnections?.(); return new Promise(r => front.close(r)); });
 const ingressOrigin = `http://127.0.0.1:${frontPort}`;
 // Attach: the allocation record nativeRecord reads (as the attach flow saves it).
 const allocationBinding = createHash('sha256').update(JSON.stringify(['robinson-playground/v1', WORKSPACE, binding.authority, binding.connection, binding.owner.toLowerCase(), binding.repo.toLowerCase(), workerId])).digest('hex');
 await w.db.setSetting('playground.' + allocationBinding.slice(0, 40), { binding: allocationBinding, connection: binding.connection, workspace: WORKSPACE, phase: 'attached', brokerOrigin: origin, revision: 1 });
 const shared = w.ctx.fetch;
 w.brokerRequests = [];
 const fetchAll = (url, init) => { if (!String(url).startsWith(BROKER + '/')) return shared(url, init); const u = new URL(url); w.brokerRequests.push(u.pathname); return fetch(ingressOrigin + u.pathname + u.search, init); };
 w.ctx = { ...w.ctx, fetch: fetchAll, env: { ...w.ctx.env, PLAYGROUND_INGRESS_IPV4: '203.0.113.10' } };
 const relay = await startTransferRelay({ env: () => w.ctx.env, now: w.ctx.now, destinations: { [BROKER]: ingressOrigin } }); cleanups.push(relay.close);
 w.local = url => relay.local(url);
 w.relay = relay;
 return w;
}

it('download: an attached workspace is served from the runtime copy through the single domain (real git clone and curl)', async () => {
 const w = await attachedWorld();
 const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: w.brokerRepo, encoding: 'utf8' }).trim();
 const begun = await call(w, 'github_git_workspace_download', { workspace_id: WORKSPACE, mode: 'git', requestKey: 'attached-clone' });
 expect(begun).toMatchObject({ status: 'applied', confirmed: true, result: { state: 'awaiting', head, single_use: true } });
 const url = new URL(begun.result.url);
 expect(url.origin).toBe('https://mcp.example.test');
 expect(url.pathname.startsWith('/v1/transfer/d/b.' + new URL(BROKER).hostname + '/')).toBe(true);
 expect(begun.progress.command).toBe(begun.result.command); expect(begun.progress.if_blocked).toContain('mcp.example.test');
 expect(Buffer.byteLength(JSON.stringify(begun.progress))).toBeLessThanOrEqual(1200);
 // The shared worker's copy was not asked to prepare anything; the runtime's was.
 expect((w.nativeRequests ?? []).filter(a => a === 'download_begin')).toEqual([]);
 const dir = await mkdtemp(join(tmpdir(), 'attached-agent-')); cleanups.push(() => rm(dir, { recursive: true, force: true }));
 const cloned = await spawnAsync('git', ['-c', 'http.followRedirects=false', 'clone', '--quiet', w.local(begun.result.url), join(dir, 'repo')], { env: ENV });
 expect(cloned.status, cloned.stderr).toBe(0);
 expect(await readFile(join(dir, 'repo', 'runtime.txt'), 'utf8')).toBe('made in the runtime\n');
 expect(w.relay.seen.every(s => s.destination.startsWith(BROKER + '/v1/download/'))).toBe(true);
 // Worst case for the always-visible digest: Ed25519 broker capability, archive command, largest cap.
 const archive = await call(w, 'github_git_workspace_download', { workspace_id: WORKSPACE, mode: 'archive', ref: 'worktree', maxMegabytes: 500, requestKey: 'attached-archive' });
 expect(archive.progress).toMatchObject({ command: archive.result.command, if_blocked: expect.stringContaining('mcp.example.test') });
 expect(Buffer.byteLength(JSON.stringify(archive.progress))).toBeLessThanOrEqual(1200);
 // …and with a public host longer than the live one (the domain appears in both command and note).
 const longHost = 'transfer-relay-long-public-host.example.test';
 const longWorld = { ...w, ctx: { ...w.ctx, env: { ...w.ctx.env, PUBLIC_BASE_URL: 'https://' + longHost } } };
 const long = await call(longWorld, 'github_git_workspace_download', { workspace_id: WORKSPACE, mode: 'archive', maxMegabytes: 500, requestKey: 'attached-long' });
 expect(long.progress).toMatchObject({ command: long.result.command, if_blocked: expect.stringContaining(longHost) });
 expect(Buffer.byteLength(JSON.stringify(long.progress))).toBeLessThanOrEqual(1200);
 const res = await fetch(w.local(archive.result.url)); expect(res.status).toBe(200);
 const names = execFileSync('tar', ['-tzf', '-'], { input: Buffer.from(await res.arrayBuffer()), encoding: 'utf8' }).split('\n').filter(Boolean).sort();
 expect(names).toEqual(['file.txt', 'runtime.txt']);
 expect((await fetch(w.local(archive.result.url))).status).toBe(410); // single use
}, 60000);

it('upload: an archive goes to the runtime copy through the single domain and applies there', async () => {
 const w = await attachedWorld();
 const begun = await call(w, 'github_git_workspace_upload', { workspace_id: WORKSPACE, operation: 'begin', mode: 'archive', maxMegabytes: 2, requestKey: 'attached-upload' });
 expect(begun).toMatchObject({ status: 'applied', result: { state: 'awaiting', mode: 'archive' } });
 expect(new URL(begun.result.url).pathname.startsWith('/v1/transfer/u/b.')).toBe(true);
 expect(begun.result.direct_command).toContain(BROKER + '/v1/upload/');
 expect(Buffer.byteLength(JSON.stringify(begun.progress))).toBeLessThanOrEqual(1200);
 const dir = await mkdtemp(join(tmpdir(), 'attached-up-')); cleanups.push(() => rm(dir, { recursive: true, force: true }));
 await writeFile(join(dir, 'notes.md'), 'from the agent\n'); execFileSync('tar', ['-czf', join(dir, 'files.tar.gz'), '-C', dir, 'notes.md']);
 const put = await spawnAsync('curl', ['--fail', '-sS', '--noproxy', '*', '--upload-file', join(dir, 'files.tar.gz'), w.local(begun.result.url)], { env: ENV });
 expect(put.status, put.stderr).toBe(0);
 const raw = await native.handlers.github_git_workspace_read({ workspace_id: WORKSPACE, operation: 'status' }, w.ctx); const status = raw?.content ? parse(raw) : raw; const generation = status.generation ?? status.result?.generation ?? status.data?.generation;
 const applied = await call(w, 'github_git_workspace_upload', { workspace_id: WORKSPACE, operation: 'apply', upload_id: begun.result.upload_id, expectedGeneration: generation, requestKey: 'attached-apply' });
 expect(applied).toMatchObject({ status: 'applied', confirmed: true, result: { files_added: 1 } });
 expect(await readFile(join(w.brokerRepo, 'notes.md'), 'utf8')).toBe('from the agent\n');
 expect((w.nativeRequests ?? []).filter(a => a.startsWith('upload_'))).toEqual([]);
}, 60000);

it('an older runtime image or an own-computer runtime is refused plainly with the fallback, and nothing is prepared', async () => {
 const w = await attachedWorld({ ingress: 'old' });
 const old = await call(w, 'github_git_workspace_download', { workspace_id: WORKSPACE, mode: 'git', requestKey: 'old' });
 expect(old).toMatchObject({ done: false, status: 'refused_by_guard' }); expect(old.error).toMatch(/older runtime image.*github_repo_download with fresh: true/);
 const up = await call(w, 'github_git_workspace_upload', { workspace_id: WORKSPACE, operation: 'begin', mode: 'git', requestKey: 'old-up' });
 expect(up.error).toMatch(/older runtime image/);
 expect(w.brokerRequests).not.toContain('/v1/workspace');
 const device = await attachedWorld({ origin: 'https://d' + 'a'.repeat(32) + '-' + 'b'.repeat(24) + '.fleet.invalid/' });
 const own = await call(device, 'github_git_workspace_download', { workspace_id: WORKSPACE, mode: 'archive', requestKey: 'device' });
 expect(own.error).toMatch(/your own computer.*github_repo_download/);
}, 60000);
