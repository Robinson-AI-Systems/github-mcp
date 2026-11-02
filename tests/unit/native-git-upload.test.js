// GIT-UPLOAD-1 worker: real `git push` and `curl --upload-file` against the signed one-time
// upload route on a local worker, real Git in the workspace, fake values only.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
const spawnAsync = (cmd, args, opts) => new Promise(resolve => { const child = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] }); let stdout = '', stderr = ''; child.stdout.on('data', c => { stdout += c; }); child.stderr.on('data', c => { stderr += c; }); child.on('close', status => resolve({ status, stdout, stderr })); });
import { randomBytes } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { nativeGitServer } from '../../workers/native-git/server.js';
import { NativeGitWorker } from '../../workers/native-git/engine.js';
import { pruneUploads, UPLOAD_RETENTION_MS } from '../../workers/native-git/upload.js';
import { signWorkerBody, nativeBindingHash, UPLOAD_PURPOSE } from '../../src/native-git/protocol.js';
import { defaultScannerSettings } from '../../src/github/scanner-policy.js';
import { buildZip } from '../../test/helpers/zip-builder.js';

const KEY = 'FAKE-local-native-upload-worker-key-0123456789';
const binding = { authority: 'a'.repeat(32), connection: 'c'.repeat(64), owner: 'example-org', repo: 'hello' };
const IDLE = 14400000;
const ENV = { ...process.env, http_proxy: '', HTTP_PROXY: '', https_proxy: '', HTTPS_PROXY: '', ALL_PROXY: '', all_proxy: '', NO_PROXY: '*', no_proxy: '*', GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
const permissive = { policy: {}, body: () => ({ allowed: true }), check: async () => ({ allowed: true }), close() {} };
let dir, bare, root, agent, server, origin, id, skew, counter;
const git = (cwd, ...a) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'user.name=Agent', '-c', 'user.email=agent@example.test', ...a], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: ENV }).trim();
const push = (url, spec = 'HEAD:refs/heads/upload', cwd = agent) => spawnAsync('git', ['-c', 'http.followRedirects=false', 'push', url, spec], { cwd, env: ENV });
const repo = () => join(root, id, 'repo');
const now = () => Date.now() + skew;

async function call(action, options = {}, extra = {}) {
 const body = JSON.stringify({ version: 3, idleTimeoutMs: IDLE, expiresAt: now() + 60000, binding, action, workspace_id: id, options, scannerPolicy: { settings: defaultScannerSettings(), revision: 0 }, ...extra });
 const res = await fetch(origin + '/v1/workspace', { method: 'POST', headers: { 'content-type': 'application/json', 'x-robinson-signature': signWorkerBody(body, KEY) }, body });
 return { status: res.status, data: await res.json() };
}
const address = claim => { const body = JSON.stringify(claim); return `${origin}/v1/upload/${Buffer.from(body).toString('base64url')}.${signWorkerBody(body, KEY)}`; };
async function begin(mode, { maxBytes = 8 * 1024 * 1024 } = {}) {
 const uploadId = randomBytes(16).toString('hex'), nonce = randomBytes(16).toString('hex'), expiresAt = now() + 600000;
 const r = await call('upload_begin', { uploadId, mode, maxBytes, expiresAt, nonce }, { allowWrite: true, requestKey: 'begin-' + (++counter) });
 expect(r).toMatchObject({ status: 200, data: { state: 'awaiting', mode } });
 const claim = { purpose: UPLOAD_PURPOSE, version: 1, workspace_id: id, binding: nativeBindingHash(binding), mode, maxBytes, expiresAt, uploadId, nonce };
 return { uploadId, claim, url: address(claim) };
}
const status = uploadId => call('upload_status', { uploadId });
async function apply(uploadId, options = {}, key = 'apply-' + (++counter)) {
 const state = await call('inspect');
 return call('upload_apply', { uploadId, ...options }, { allowWrite: true, requestKey: key, expectedGeneration: state.data.generation });
}
const put = (url, bytes) => fetch(url, { method: 'PUT', body: bytes });
function tarEntry(name, data = Buffer.alloc(0), type = '0', link = '') {
 const h = Buffer.alloc(512); h.write(name, 0, 100, 'utf8'); h.write('0000644\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116);
 h.write(data.length.toString(8).padStart(11, '0') + '\0', 124); h.write('00000000000\0', 136); h.write('        ', 148); h.write(type, 156); h.write(link, 157); h.write('ustar\0', 257); h.write('00', 263);
 let sum = 0; for (const b of h) sum += b; h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
 return Buffer.concat([h, data, Buffer.alloc((512 - data.length % 512) % 512)]);
}
const tarGz = entries => gzipSync(Buffer.concat([...entries.map(e => tarEntry(...e)), Buffer.alloc(1024)]));

beforeEach(async () => {
 skew = 0; counter = 0;
 dir = await mkdtemp(join(tmpdir(), 'native-upload-')); const seed = join(dir, 'seed'); bare = join(dir, 'remote.git'); root = join(dir, 'storage'); agent = join(dir, 'agent');
 await mkdir(seed); git(seed, 'init', '-b', 'main'); await writeFile(join(seed, 'file.txt'), 'base\n'); git(seed, 'add', 'file.txt'); git(seed, 'commit', '-m', 'base');
 git(dir, 'clone', '--bare', seed, bare); git(dir, 'clone', bare, agent);
 const worker = new NativeGitWorker({ root, authorize: async () => true, allowLocalFixtures: true });
 const opened = await worker.create(binding, { requestKey: 'open-upload', fixtureRemote: bare }); expect(opened.state).toBe('ready'); id = opened.workspace_id;
 server = nativeGitServer({ root, key: KEY, now, allowLocalFixtures: true, fixtureRemote: () => bare, resources: permissive });
 await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${server.address().port}`;
});
afterEach(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); });

describe('git mode: a real git push into quarantine, then a fast-forward apply', () => {
 it('receives a binary commit without touching the workspace, applies it once and refuses replay', async () => {
  const image = randomBytes(300000); await mkdir(join(agent, 'assets')); await writeFile(join(agent, 'assets', 'photo.png'), image);
  git(agent, 'add', 'assets/photo.png'); git(agent, 'commit', '-m', 'add photo'); const pushed = git(agent, 'rev-parse', 'HEAD');
  const before = git(repo(), 'rev-parse', 'HEAD');
  const { uploadId, url } = await begin('git');
  const first = await push(url); expect(first.status, first.stderr).toBe(0);
  // Quarantine only: the workspace branch, refs and worktree are unchanged until apply.
  expect(git(repo(), 'rev-parse', 'HEAD')).toBe(before);
  expect(git(repo(), 'for-each-ref', '--format=%(refname)')).not.toContain('upload');
  await expect(lstat(join(repo(), 'assets'))).rejects.toThrow();
  expect((await status(uploadId)).data).toMatchObject({ state: 'received', branches: [{ name: 'upload', head: pushed }] });
  // Single use: the same address refuses a second push.
  git(agent, 'commit', '--allow-empty', '-m', 'second'); const replay = await push(url, 'HEAD:refs/heads/again');
  expect(replay.status).not.toBe(0); expect(replay.stderr).toMatch(/410|already used/);
  git(agent, 'reset', '--hard', 'HEAD~1');
  const applied = await apply(uploadId);
  expect(applied).toMatchObject({ status: 200, data: { status: 'applied', mode: 'git', branch: 'main', previous_head: before, head: pushed, commits: 1, files_added: 1, generation: 1 } });
  expect(await readFile(join(repo(), 'assets', 'photo.png'))).toEqual(image);
  expect(git(repo(), 'for-each-ref', '--format=%(refname)')).not.toContain('robinson');
  const again = await apply(uploadId);
  expect(again.data).toMatchObject({ status: 'refused', reason: expect.stringMatching(/already applied/) });
  // The existing typed push then publishes it; the quarantine is gone.
  const sent = await call('run', {}, { allowWrite: true, operation: 'push', options: { branch: 'main', expectedHead: before }, requestKey: 'push-1', expectedGeneration: 1 });
  expect(sent.data).toMatchObject({ status: 'applied', remote_verified: true, remote_head: pushed });
  await expect(readdir(join(root, '.uploads', id, uploadId))).rejects.toThrow();
 });
 it('replays a finished apply receipt without repeating it', async () => {
  await writeFile(join(agent, 'more.txt'), 'more\n'); git(agent, 'add', 'more.txt'); git(agent, 'commit', '-m', 'more');
  const { uploadId, url } = await begin('git'); expect((await push(url)).status).toBe(0);
  const first = await apply(uploadId, {}, 'same-apply');
  const state = await call('inspect');
  const replayed = await call('upload_apply', { uploadId }, { allowWrite: true, requestKey: 'same-apply', expectedGeneration: 0 });
  expect(replayed.data).toMatchObject({ status: 'applied', replayed: true, head: first.data.head });
  expect((await call('inspect')).data.generation).toBe(state.data.generation);
 });
 it('refuses a pushed history that does not fast-forward the workspace, leaving it unchanged', async () => {
  await writeFile(join(repo(), 'local.txt'), 'local\n'); git(repo(), 'add', 'local.txt'); git(repo(), 'commit', '-m', 'workspace moved');
  const before = git(repo(), 'rev-parse', 'HEAD');
  await writeFile(join(agent, 'other.txt'), 'other\n'); git(agent, 'add', 'other.txt'); git(agent, 'commit', '-m', 'diverged');
  const { uploadId, url } = await begin('git'); expect((await push(url)).status).toBe(0);
  const refused = await apply(uploadId);
  expect(refused.data).toMatchObject({ status: 'refused', reason: expect.stringMatching(/does not build on the workspace HEAD .*only fast-forwards/) });
  expect(git(repo(), 'rev-parse', 'HEAD')).toBe(before); await expect(lstat(join(repo(), 'other.txt'))).rejects.toThrow();
  expect((await call('inspect')).data.generation).toBe(0);
 });
 it('scans every new commit, including deleted intermediate content and messages, before any change', async () => {
  const candidate = 'rtc_pass_' + 'a'.repeat(43);
  await writeFile(join(agent, 'config.txt'), `token=${candidate}\n`); git(agent, 'add', 'config.txt'); git(agent, 'commit', '-m', 'oops');
  git(agent, 'rm', '-q', 'config.txt'); git(agent, 'commit', '-m', 'remove it again');
  const { uploadId, url } = await begin('git'); expect((await push(url)).status).toBe(0);
  const refused = await apply(uploadId);
  expect(refused.data).toMatchObject({ status: 'refused', reason: expect.stringMatching(/Content protection refused this upload.*config\.txt/) });
  expect(JSON.stringify(refused.data)).not.toContain(candidate);
  expect(git(repo(), 'log', '--format=%s')).not.toContain('oops');
  // The refused objects stayed in the quarantine; the workspace object store never received them.
  expect(spawnSync('git', ['cat-file', '-e', git(agent, 'rev-parse', 'HEAD~1')], { cwd: repo(), env: ENV }).status).not.toBe(0);
 }, 20000);
 it('refuses expired, tampered, wrong-workspace and wrong-mode addresses, oversize pushes and worker-lease confusion', async () => {
  await writeFile(join(agent, 'big.bin'), randomBytes(200000)); git(agent, 'add', 'big.bin'); git(agent, 'commit', '-m', 'big');
  const small = await begin('git', { maxBytes: 20000 });
  const over = await push(small.url); expect(over.status).not.toBe(0);
  expect((await status(small.uploadId)).data.state).toBe('failed');
  const ok = await begin('git');
  const tampered = ok.url.slice(0, -1) + (ok.url.endsWith('a') ? 'b' : 'a');
  expect((await push(tampered)).stderr).toMatch(/403|not valid/);
  const other = address({ ...ok.claim, workspace_id: 'git_' + 'f'.repeat(32) });
  expect((await push(other)).stderr).toMatch(/404|no longer available/);
  const archive = await begin('archive');
  expect((await push(archive.url)).status).not.toBe(0);
  expect((await put(ok.url, Buffer.from('x'))).status).toBe(403);
  // An upload claim is not a worker request lease, and a worker lease is not an upload address.
  const claimBody = JSON.stringify(ok.claim);
  const asLease = await fetch(origin + '/v1/workspace', { method: 'POST', headers: { 'x-robinson-signature': signWorkerBody(claimBody, KEY) }, body: claimBody });
  expect(asLease.status).toBe(401);
  const lease = JSON.stringify({ version: 3, expiresAt: now() + 60000, binding, action: 'inspect', workspace_id: id });
  expect((await fetch(`${origin}/v1/upload/${Buffer.from(lease).toString('base64url')}.${signWorkerBody(lease, KEY)}`)).status).toBe(403);
  skew = 700000;
  expect((await push(ok.url)).stderr).toMatch(/403|expired/);
  skew = 0;
  expect((await status(ok.uploadId)).data.state).toBe('awaiting');
 }, 30000);
 it('keeps pushes inside the quarantine: branch updates, deletions and .git hook trees never reach the workspace', async () => {
  const before = git(repo(), 'rev-parse', 'HEAD'); const config = await readFile(join(repo(), '.git', 'config'), 'utf8');
  const { url, uploadId } = await begin('git');
  await writeFile(join(agent, 'x.txt'), 'x\n'); git(agent, 'add', 'x.txt'); git(agent, 'commit', '-m', 'x');
  expect((await push(url, 'HEAD:refs/heads/main')).status).toBe(0);
  expect(git(repo(), 'rev-parse', 'refs/heads/main')).toBe(before);
  expect(git(repo(), 'rev-parse', 'refs/remotes/origin/main')).toBe(before);
  // A tree that smuggles .git/hooks is refused by the quarantine's object checks.
  const hookBlob = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: agent, input: '#!/bin/sh\ntouch pwned\n', env: ENV }).toString().trim();
  const hooks = execFileSync('git', ['mktree'], { cwd: agent, input: `100755 blob ${hookBlob}\tpost-merge\n`, env: ENV }).toString().trim();
  const dotgit = execFileSync('git', ['mktree'], { cwd: agent, input: `040000 tree ${hooks}\thooks\n`, env: ENV }).toString().trim();
  const entry = Buffer.concat([Buffer.from('40000 .git\0'), Buffer.from(dotgit, 'hex')]);
  const evil = execFileSync('git', ['hash-object', '-w', '-t', 'tree', '--literally', '--stdin'], { cwd: agent, input: entry, env: ENV }).toString().trim();
  const commit = execFileSync('git', ['-c', 'user.name=A', '-c', 'user.email=a@example.test', 'commit-tree', evil, '-p', 'HEAD', '-m', 'hook'], { cwd: agent, env: ENV }).toString().trim();
  const second = await begin('git');
  expect((await push(second.url, `${commit}:refs/heads/evil`)).status).not.toBe(0);
  expect((await status(second.uploadId)).data.state).toBe('failed');
  const applied = await apply(uploadId, { ref: 'main' });
  expect(applied.data).toMatchObject({ status: 'applied', head: git(agent, 'rev-parse', 'HEAD') });
  await expect(lstat(join(repo(), 'pwned'))).rejects.toThrow();
  expect(await readFile(join(repo(), '.git', 'config'), 'utf8')).toBe(config);
 }, 30000);
});

describe('archive mode: one curl upload, then a checked extraction', () => {
 it('extracts a .tar.gz under a target folder with curl --upload-file and bumps the generation', async () => {
  const image = randomBytes(150000);
  const bytes = tarGz([['photos/a.png', image], ['photos/', Buffer.alloc(0), '5'], ['notes/readme.md', Buffer.from('# hi\n')]]);
  await writeFile(join(dir, 'files.tar.gz'), bytes);
  const { uploadId, url } = await begin('archive');
  const sent = await spawnAsync('curl', ['--silent', '--show-error', '--fail', '--noproxy', '*', '--upload-file', join(dir, 'files.tar.gz'), url], { env: ENV });
  expect(sent.status, sent.stderr).toBe(0); expect(JSON.parse(sent.stdout)).toMatchObject({ received: true, bytes: bytes.length });
  await expect(lstat(join(repo(), 'site'))).rejects.toThrow();
  expect((await put(url, bytes)).status).toBe(410);
  const applied = await apply(uploadId, { path: 'site' });
  expect(applied.data).toMatchObject({ status: 'applied', mode: 'archive', format: 'tar.gz', target: 'site', files: 2, files_added: 2, generation: 1 });
  expect(await readFile(join(repo(), 'site', 'photos', 'a.png'))).toEqual(image);
  expect(git(repo(), 'status', '--porcelain')).toContain('site/');
 });
 it('extracts a .zip, counting changed and unchanged files', async () => {
  await writeFile(join(repo(), 'keep.txt'), 'same\n');
  const { uploadId, url } = await begin('archive');
  expect((await put(url, buildZip([{ name: 'file.txt', data: 'changed\n' }, { name: 'keep.txt', data: 'same\n', stored: true }, { name: 'dir/new.bin', data: 'new' }]))).status).toBe(200);
  const applied = await apply(uploadId);
  expect(applied.data).toMatchObject({ status: 'applied', format: 'zip', files_added: 1, files_changed: 1, files_unchanged: 1 });
  expect(await readFile(join(repo(), 'file.txt'), 'utf8')).toBe('changed\n');
 });
 const refusals = [
  ['path traversal', () => tarGz([['ok.txt', Buffer.from('ok')], ['../escape.txt', Buffer.from('x')]]), /unsafe entry name/],
  ['an absolute path', () => tarGz([['/etc/escape.txt', Buffer.from('x')]]), /unsafe entry name/],
  ['a symbolic link', () => tarGz([['link', Buffer.alloc(0), '2', '/etc/passwd']]), /symbolic link/],
  ['a hard link', () => tarGz([['hard', Buffer.alloc(0), '1', 'file.txt']]), /hard link/],
  ['a device', () => tarGz([['dev', Buffer.alloc(0), '3']]), /device or FIFO/],
  ['a .git path', () => tarGz([['.git/config', Buffer.from('[core]\n\thooksPath = /tmp\n')]]), /unsafe entry name/],
  ['a nested .GIT path', () => buildZip([{ name: 'sub/.GIT/hooks/post-merge', data: 'x' }]), /unsafe entry name/],
  ['a zip symlink', () => buildZip([{ name: 'link', data: '/etc/passwd', link: true }]), /symbolic link/],
  ['a zip traversal', () => buildZip([{ name: 'a/../../x', data: 'x' }]), /unsafe entry name/],
  ['a zip bomb', () => buildZip([{ name: 'zeros.bin', data: Buffer.alloc(20 * 1024 * 1024) }]), /zip bomb/],
  ['a gzip bomb', () => gzipSync(Buffer.concat([tarEntry('zeros.bin', Buffer.alloc(40 * 1024 * 1024)), Buffer.alloc(1024)])), /zip bomb/],
  ['a lying zip size', () => buildZip([{ name: 'lie.txt', data: 'abcdef', lie: 3 }]), /stated size/],
  ['duplicate names', () => tarGz([['a.txt', Buffer.from('1')], ['./a.txt', Buffer.from('2')]]), /more than once/],
  ['a file and folder with one name', () => tarGz([['a', Buffer.from('1')], ['a/b', Buffer.from('2')]]), /also a file/],
  ['not an archive', () => Buffer.from('plain text'), /not a \.tar\.gz/]
 ];
 for (const [label, make, reason] of refusals) it(`refuses ${label} before writing anything`, async () => {
  const { uploadId, url } = await begin('archive', { maxBytes: 4 * 1024 * 1024 });
  expect((await put(url, make())).status).toBe(200);
  const refused = await apply(uploadId);
  expect(refused.data).toMatchObject({ status: 'refused', reason: expect.stringMatching(reason) });
  expect(git(repo(), 'status', '--porcelain')).toBe('');
  expect((await call('inspect')).data.generation).toBe(0);
 });
 it('refuses too many entries, credential-shaped files, oversize bodies and workspace symlink targets', async () => {
  const many = await begin('archive');
  expect((await put(many.url, buildZip(Array.from({ length: 10001 }, (_v, i) => ({ name: `f${i}`, data: '', stored: true }))))).status).toBe(200);
  expect((await apply(many.uploadId)).data.reason).toMatch(/more than 10000 entries/);
  const candidate = 'rtc_pass_' + 'b'.repeat(43);
  const secret = await begin('archive'); expect((await put(secret.url, tarGz([['env.txt', Buffer.from(`KEY=${candidate}\n`)]]))).status).toBe(200);
  const refused = await apply(secret.uploadId);
  expect(refused.data.reason).toMatch(/Content protection refused/); expect(JSON.stringify(refused.data)).not.toContain(candidate);
  const small = await begin('archive', { maxBytes: 1000 });
  // A declared oversize body is refused before the address is used, so it is not consumed.
  expect((await put(small.url, randomBytes(5000))).status).toBe(413);
  expect((await status(small.uploadId)).data.state).toBe('awaiting');
  execFileSync('ln', ['-s', '/tmp', join(repo(), 'outside')]);
  const linked = await begin('archive'); expect((await put(linked.url, tarGz([['outside/x.txt', Buffer.from('x')]]))).status).toBe(200);
  expect((await apply(linked.uploadId)).data.reason).toMatch(/symbolic link in the workspace/);
  expect((await call('inspect')).data.generation).toBe(0);
 }, 30000);
});

describe('cleanup', () => {
 it('workspace close removes its uploads and the sweep removes retained ones', async () => {
  const first = await begin('archive');
  const engine = new NativeGitWorker({ root, authorize: async () => true });
  expect(await pruneUploads(root, Date.now())).toEqual({ removed: 0 });
  expect(await pruneUploads(root, first.claim.expiresAt + UPLOAD_RETENTION_MS + 600001)).toEqual({ removed: 1 });
  await expect(lstat(join(root, '.uploads', id, first.uploadId + '.json'))).rejects.toThrow();
  await begin('git');
  await engine.close(id, binding);
  await expect(lstat(join(root, '.uploads', id))).rejects.toThrow();
 });
});

it('capabilities advertise direct uploads', async () => {
 expect((await call('capabilities')).data.direct_upload).toBe('quarantine-v1');
});
