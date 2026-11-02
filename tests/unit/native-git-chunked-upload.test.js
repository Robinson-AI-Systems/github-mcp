// CHUNK-UPLOAD-1: resumable chunked uploads through the real one-domain relay (middleware.js's handler in
// a local stand-in for Vercel's proxy) into a real local native Git worker, using the exact shell command
// the tool returns (split, curl, wc, sha256sum, git bundle). Fake values only.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { nativeGitServer } from '../../workers/native-git/server.js';
import { NativeGitWorker } from '../../workers/native-git/engine.js';
import { signWorkerBody, nativeBindingHash, UPLOAD_PURPOSE, UPLOAD_CHUNK_GRACE_MS } from '../../src/native-git/protocol.js';
import { transferUrl, planTransferRelay } from '../../src/native-git/relay.js';
import { CHUNKED_UPLOAD_COMMAND, UPLOAD_COMMAND_SINGLE_WITH_DIGEST, nativeInternals } from '../../src/tools/native-git.js';
import { defaultScannerSettings } from '../../src/github/scanner-policy.js';
import { startTransferRelay } from '../../test/helpers/transfer-relay.js';

const KEY = 'FAKE-local-chunked-upload-worker-key-0123456789';
const MiB = 1048576;
const binding = { authority: 'a'.repeat(32), connection: 'c'.repeat(64), owner: 'example-org', repo: 'hello' };
const ENV = { ...process.env, http_proxy: '', HTTP_PROXY: '', https_proxy: '', HTTPS_PROXY: '', ALL_PROXY: '', all_proxy: '', NO_PROXY: '*', no_proxy: '*', GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
const RELAY_ENV = { TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'), PUBLIC_BASE_URL: 'https://mcp.example.test', NATIVE_GIT_WORKER_URL: 'https://worker.example.test/', NATIVE_GIT_WORKER_KEY: KEY };
const permissive = { policy: {}, body: () => ({ allowed: true }), check: async () => ({ allowed: true }), close() {} };
let dir, bare, root, agent, server, relay, id, skew, counter;
const now = () => Date.now() + skew;
const git = (cwd, ...a) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'user.name=Agent', '-c', 'user.email=agent@example.test', ...a], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: ENV }).trim();
const repo = () => join(root, id, 'repo');
const sh = (script, cwd) => new Promise(resolve => { const c = spawn('bash', ['-c', script], { cwd, env: ENV, stdio: ['ignore', 'pipe', 'pipe'] }); let stdout = '', stderr = ''; c.stdout.on('data', d => { stdout += d; }); c.stderr.on('data', d => { stderr += d; }); c.on('close', status => resolve({ status, stdout, stderr })); });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

async function call(action, options = {}, extra = {}) {
 const body = JSON.stringify({ version: 3, idleTimeoutMs: 14400000, expiresAt: now() + 60000, binding, action, workspace_id: id, options, scannerPolicy: { settings: defaultScannerSettings(), revision: 0 }, ...extra });
 const res = await fetch(`http://127.0.0.1:${server.address().port}/v1/workspace`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-robinson-signature': signWorkerBody(body, KEY) }, body });
 return { status: res.status, data: await res.json() };
}
async function begin(mode, maxBytes = 40 * MiB) {
 const uploadId = randomBytes(16).toString('hex'), nonce = randomBytes(16).toString('hex'), expiresAt = now() + 600000;
 const r = await call('upload_begin', { uploadId, mode, maxBytes, expiresAt, nonce }, { allowWrite: true, requestKey: 'begin-' + (++counter) });
 expect(r).toMatchObject({ status: 200, data: { state: 'awaiting', mode } });
 const claim = JSON.stringify({ purpose: UPLOAD_PURPOSE, version: 1, workspace_id: id, binding: nativeBindingHash(binding), mode, maxBytes, expiresAt, uploadId, nonce });
 const capability = `${Buffer.from(claim).toString('base64url')}.${signWorkerBody(claim, KEY)}`;
 const publicUrl = transferUrl(RELAY_ENV, { kind: 'u', destinationOrigin: 'https://worker.example.test', capability });
 expect(publicUrl).toMatch(/^https:\/\/mcp\.example\.test\/v1\/transfer\/u\/w\//);
 return { uploadId, base: r.data.base, publicUrl, url: relay.local(publicUrl) };
}
async function apply(uploadId, options = {}) {
 const state = await call('inspect');
 return call('upload_apply', { uploadId, ...options }, { allowWrite: true, requestKey: 'apply-' + (++counter), expectedGeneration: state.data.generation });
}
const putChunk = (url, offset, bytes, headers = {}) => fetch(`${url}/chunk?offset=${offset}`, { method: 'PUT', body: bytes, headers });
const status = async url => (await fetch(`${url}/status`)).json();
const finish = (url, size, digest) => fetch(`${url}/finish?size=${size}&sha256=${digest}`, { method: 'POST' });
const pieces = (bytes, size = 4 * MiB) => { const out = []; for (let at = 0; at < bytes.length; at += size) out.push({ offset: at, bytes: bytes.subarray(at, at + size) }); return out; };
async function tarGzOf(files) {
 const src = join(dir, 'src-' + (++counter)); await mkdir(src);
 for (const [name, data] of Object.entries(files)) { await mkdir(join(src, name, '..'), { recursive: true }); await writeFile(join(src, name), data); }
 const out = join(dir, 'up-' + counter); await mkdir(out);
 execFileSync('tar', ['-czf', join(out, 'files.tar.gz'), '-C', src, '.'], { env: ENV });
 return { cwd: out, bytes: await readFile(join(out, 'files.tar.gz')) };
}

beforeEach(async () => {
 skew = 0; counter = 0;
 dir = await mkdtemp(join(tmpdir(), 'native-chunked-')); const seed = join(dir, 'seed'); bare = join(dir, 'remote.git'); root = join(dir, 'storage'); agent = join(dir, 'agent');
 await mkdir(seed); git(seed, 'init', '-b', 'main'); await writeFile(join(seed, 'file.txt'), 'base\n'); git(seed, 'add', 'file.txt'); git(seed, 'commit', '-m', 'base');
 git(dir, 'clone', '--bare', seed, bare); git(dir, 'clone', bare, agent);
 const worker = new NativeGitWorker({ root, authorize: async () => true, allowLocalFixtures: true });
 const opened = await worker.create(binding, { requestKey: 'open-chunked', fixtureRemote: bare }); expect(opened.state).toBe('ready'); id = opened.workspace_id;
 server = nativeGitServer({ root, key: KEY, now, allowLocalFixtures: true, fixtureRemote: () => bare, resources: permissive });
 await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
 relay = await startTransferRelay({ env: () => RELAY_ENV, now, destinations: { 'https://worker.example.test': `http://127.0.0.1:${server.address().port}` } });
});
afterEach(async () => { await relay.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); });

describe('archive mode: the returned chunked command through the one-domain relay', () => {
 it('uploads a 30 MB+ archive in 4 MiB requests, verifies size and SHA-256, and applies it', async () => {
  const big = randomBytes(31 * MiB), small = Buffer.from('hello\n');
  const { cwd, bytes } = await tarGzOf({ 'assets/big.bin': big, 'docs/readme.txt': small });
  expect(bytes.length).toBeGreaterThan(30 * MiB);
  const { uploadId, publicUrl, url } = await begin('archive');
  const command = CHUNKED_UPLOAD_COMMAND.archive(url);
  const ran = await sh(command, cwd);
  expect(ran.status, ran.stderr).toBe(0);
  expect(JSON.parse(ran.stdout)).toMatchObject({ received: true, bytes: bytes.length, sha256: sha(bytes), chunks: Math.ceil(bytes.length / (4 * MiB)) });
  // Every relayed request stayed small and went only to the configured worker.
  expect(relay.seen.filter(s => s.destination.includes('/chunk?offset=')).length).toBe(Math.ceil(bytes.length / (4 * MiB)));
  expect(relay.seen.every(s => s.destination.startsWith('https://worker.example.test/v1/upload/'))).toBe(true);
  expect(await readdir(cwd)).toEqual(['files.tar.gz']); // the command cleans up its chunk files
  expect((await call('upload_status', { uploadId })).data).toMatchObject({ state: 'received', received_bytes: bytes.length, sha256: sha(bytes), chunked: true });
  const applied = await apply(uploadId);
  expect(applied.data).toMatchObject({ status: 'applied', mode: 'archive', files_added: 2 });
  expect((await readFile(join(repo(), 'assets', 'big.bin'))).equals(big)).toBe(true);
  // The public address is the service's own domain; the command embeds exactly that address once.
  expect(CHUNKED_UPLOAD_COMMAND.archive(publicUrl).split(publicUrl).length).toBe(2);
 }, 120000);

 it('accepts out-of-order and retried chunks, refuses different or overlapping bytes, reports ranges, and finishes only when complete', async () => {
  const { bytes } = await tarGzOf({ 'data.bin': randomBytes(10 * MiB) });
  const { uploadId, url } = await begin('archive');
  const parts = pieces(bytes); expect(parts.length).toBe(3);
  expect((await putChunk(url, parts[2].offset, parts[2].bytes)).status).toBe(200);
  expect((await putChunk(url, parts[0].offset, parts[0].bytes)).status).toBe(200);
  const retried = await putChunk(url, parts[0].offset, parts[0].bytes); expect(retried.status).toBe(200);
  expect(await retried.json()).toMatchObject({ already_stored: true, sha256: sha(parts[0].bytes) });
  const changed = Buffer.from(parts[0].bytes); changed[5] ^= 1;
  expect((await putChunk(url, 0, changed)).status).toBe(409);
  expect((await putChunk(url, 1024, parts[0].bytes.subarray(0, 4096))).status).toBe(409); // overlaps chunk 0
  expect((await putChunk(url, parts[1].offset, parts[1].bytes, { 'x-content-sha256': sha(changed) })).status).toBe(422); // chunk digest mismatch: not stored
  // A one-request upload can no longer use this address.
  expect((await fetch(url, { method: 'PUT', body: Buffer.from('x') })).status).toBe(410);
  const partial = await status(url);
  expect(partial).toMatchObject({ state: 'receiving', chunked: true, chunks: 2, present: [[0, 4 * MiB], [8 * MiB, bytes.length]] });
  const early = await finish(url, bytes.length, sha(bytes)); expect(early.status).toBe(409);
  expect(await early.json()).toMatchObject({ finished: false, missing: [[4 * MiB, 8 * MiB]] });
  expect((await putChunk(url, parts[1].offset, parts[1].bytes, { 'x-content-sha256': sha(parts[1].bytes) })).status).toBe(200);
  const done = await finish(url, bytes.length, sha(bytes)); expect(done.status).toBe(200);
  expect(await done.json()).toMatchObject({ received: true, bytes: bytes.length, chunks: 3 });
  expect(await (await finish(url, bytes.length, sha(bytes))).json()).toMatchObject({ already_finished: true });
  expect((await putChunk(url, 0, parts[0].bytes)).status).toBe(410);
  expect((await apply(uploadId)).data).toMatchObject({ status: 'applied', files_added: 1 });
 }, 60000);

 it('resumes after an interrupted chunk: the cut chunk is not stored, status shows the gap, rerunning the command completes', async () => {
  const { cwd, bytes } = await tarGzOf({ 'one.bin': randomBytes(9 * MiB) });
  const { uploadId, url } = await begin('archive');
  const parts = pieces(bytes);
  expect((await putChunk(url, 0, parts[0].bytes)).status).toBe(200);
  // Interrupted mid-body: Content-Length promises 4 MiB, only 1 MiB arrives, then the connection drops.
  await new Promise(resolve => {
   const target = new URL(`${url}/chunk?offset=${parts[1].offset}`);
   const req = httpRequest(target, { method: 'PUT', headers: { 'content-length': String(parts[1].bytes.length) } });
   req.on('error', () => resolve()); req.on('response', r => { r.resume(); r.on('end', resolve); });
   req.write(parts[1].bytes.subarray(0, MiB), () => setTimeout(() => { req.destroy(); resolve(); }, 200));
  });
  await new Promise(resolve => setTimeout(resolve, 300));
  const gap = await status(url);
  expect(gap).toMatchObject({ chunks: 1, bytes_present: 4 * MiB, present: [[0, 4 * MiB]] });
  expect((await readdir(join(root, '.uploads', id, uploadId, 'parts'))).filter(n => n.startsWith('incoming-'))).toEqual([]);
  const ran = await sh(CHUNKED_UPLOAD_COMMAND.archive(url), cwd);
  expect(ran.status, ran.stderr).toBe(0);
  expect(JSON.parse(ran.stdout)).toMatchObject({ received: true, bytes: bytes.length, sha256: sha(bytes) });
  expect((await apply(uploadId)).data).toMatchObject({ status: 'applied', files_added: 1 });
 }, 60000);

 it('refuses a whole-file digest mismatch at finish and discards the upload', async () => {
  const { bytes } = await tarGzOf({ 'x.bin': randomBytes(5 * MiB) });
  const { uploadId, url } = await begin('archive');
  for (const part of pieces(bytes)) expect((await putChunk(url, part.offset, part.bytes)).status).toBe(200);
  const wrong = await finish(url, bytes.length, 'f'.repeat(64));
  expect(wrong.status).toBe(422); expect(await wrong.text()).toMatch(/not the f{64} that was sent; nothing was kept/);
  expect((await call('upload_status', { uploadId })).data.state).toBe('failed');
  expect((await apply(uploadId)).data).toMatchObject({ status: 'refused' });
 }, 60000);

 it('one-request uploads check the client digest at receipt; a refused apply leaves the quarantine intact and a corrected apply succeeds', async () => {
  const { cwd, bytes } = await tarGzOf({ 'keep/a.txt': 'a\n', 'keep/b.bin': randomBytes(2 * MiB) });
  const bad = await begin('archive');
  const mismatch = await fetch(bad.url, { method: 'PUT', body: bytes, headers: { 'x-content-sha256': sha(Buffer.from('other')) } });
  expect(mismatch.status).toBe(422);
  expect((await call('upload_status', { uploadId: bad.uploadId })).data.state).toBe('failed');
  const good = await begin('archive');
  const ran = await sh(UPLOAD_COMMAND_SINGLE_WITH_DIGEST(good.url), cwd);
  expect(ran.status, ran.stderr).toBe(0); expect(JSON.parse(ran.stdout)).toMatchObject({ received: true, bytes: bytes.length, sha256: sha(bytes) });
  // The live failure: an apply refused for a bad deletePaths entry, then the corrected apply said "the gzip data is damaged".
  const refused = await apply(good.uploadId, { deletePaths: ['no-such-file.txt'] });
  expect(refused.data).toMatchObject({ status: 'refused', reason: expect.stringMatching(/does not exist/) });
  const quarantine = join(root, '.uploads', id, good.uploadId);
  expect(await readdir(quarantine)).toEqual(['archive.upload']);
  expect(sha(await readFile(join(quarantine, 'archive.upload')))).toBe(sha(bytes));
  const applied = await apply(good.uploadId);
  expect(applied.data).toMatchObject({ status: 'applied', files_added: 2 });
 }, 60000);
});

describe('git mode: a git bundle in chunks', () => {
 it('uploads a bundle of new commits with the returned command and fast-forwards on apply', async () => {
  await writeFile(join(agent, 'blob.bin'), randomBytes(9 * MiB)); git(agent, 'add', 'blob.bin'); git(agent, 'commit', '-m', 'big binary');
  const pushed = git(agent, 'rev-parse', 'HEAD');
  const { uploadId, base, url } = await begin('git');
  expect(base).toBe(git(repo(), 'rev-parse', 'HEAD'));
  const ran = await sh(CHUNKED_UPLOAD_COMMAND.git(url, base), agent);
  expect(ran.status, ran.stderr).toBe(0);
  expect(JSON.parse(ran.stdout)).toMatchObject({ received: true, branches: ['upload'] });
  expect(git(repo(), 'rev-parse', 'HEAD')).not.toBe(pushed); // quarantine only until apply
  expect((await call('upload_status', { uploadId })).data).toMatchObject({ state: 'received', branches: [{ name: 'upload', head: pushed }] });
  expect((await apply(uploadId)).data).toMatchObject({ status: 'applied', mode: 'git', head: pushed, commits: 1 });
  expect(git(repo(), 'rev-parse', 'HEAD')).toBe(pushed);
 }, 60000);
 it('refuses a bundle that is not a git bundle', async () => {
  const { url } = await begin('git');
  const junk = randomBytes(1000);
  expect((await putChunk(url, 0, junk)).status).toBe(200);
  const r = await finish(url, junk.length, sha(junk)); expect(r.status).toBe(422); expect(await r.text()).toMatch(/bundle was refused/);
 });
});

describe('time window', () => {
 it('lets a chunked upload that started in time continue past ten minutes, never one that had not started', async () => {
  const started = await begin('archive'), idle = await begin('archive');
  const payload = randomBytes(1000);
  expect((await putChunk(started.url, 0, payload.subarray(0, 500))).status).toBe(200);
  skew = 600000 + 60000; // eleven minutes later
  expect((await putChunk(started.url, 500, payload.subarray(500))).status).toBe(200);
  expect((await finish(started.url, 1000, sha(payload))).status).toBe(200);
  expect((await putChunk(idle.url, 0, payload)).status).toBe(403);
  expect((await fetch(idle.url, { method: 'PUT', body: payload })).status).toBe(403);
  skew = 600000 + UPLOAD_CHUNK_GRACE_MS + 1000;
  expect((await fetch(`${started.url}/status`)).status).toBe(403);
 });
});

describe('relay: chunk steps only with their method and exact query', () => {
 it('forwards chunk, status and finish, and refuses other shapes', async () => {
  const { publicUrl } = await begin('archive');
  const plan = (u, method) => planTransferRelay({ method, url: u, headers: { 'x-content-sha256': 'a'.repeat(64), cookie: 'FAKE=1' } }, RELAY_ENV, now());
  const ok = plan(publicUrl + '/chunk?offset=0', 'PUT'); expect(ok).toMatchObject({ ok: true }); expect(ok.destination).toMatch(/\/v1\/upload\/[^/]+\/chunk\?offset=0$/);
  expect(ok.headers.get('x-content-sha256')).toBe('a'.repeat(64)); expect(ok.headers.get('cookie')).toBeNull();
  expect(plan(publicUrl + '/status', 'GET')).toMatchObject({ ok: true });
  expect(plan(publicUrl + '/finish?size=10&sha256=' + 'a'.repeat(64), 'POST')).toMatchObject({ ok: true });
  expect(plan(publicUrl + '/chunk?offset=0', 'POST')).toMatchObject({ ok: false, status: 405 });
  expect(plan(publicUrl + '/chunk?offset=0&x=1', 'PUT')).toMatchObject({ ok: false, status: 404 });
  expect(plan(publicUrl + '/chunk', 'PUT')).toMatchObject({ ok: false, status: 404 });
  expect(plan(publicUrl + '/finish?size=10', 'POST')).toMatchObject({ ok: false, status: 404 });
  expect(plan(publicUrl.replace('/transfer/u/', '/transfer/d/') + '/chunk?offset=0', 'PUT')).toMatchObject({ ok: false });
 });
});

describe('commands offered', () => {
 it('offers the one-request command alone when the worker or runtime ingress cannot take chunks', () => {
  const url = 'https://mcp.example.test/v1/transfer/u/w/' + 'a'.repeat(32) + '/x.y';
  expect(nativeInternals.uploadCommands('archive', url, {})).toEqual({ command: UPLOAD_COMMAND_SINGLE_WITH_DIGEST(url) });
  const both = nativeInternals.uploadCommands('git', url, { chunks: true, base: 'b'.repeat(40) });
  expect(both.command).toBe(CHUNKED_UPLOAD_COMMAND.git(url, 'b'.repeat(40))); expect(both.single_command).toMatch(/^git -c http\.followRedirects=false push/);
  expect(both.command).toContain('--not ' + 'b'.repeat(16) + '&&');
 });
});
