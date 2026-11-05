// GIT-DOWNLOAD-1 worker: real `git clone`/`git fetch` and real HTTP archive downloads against the
// signed one-time download route on a local worker, real Git in the workspace, fake values only.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm, lstat, readdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { nativeGitServer } from '../../workers/native-git/server.js';
import { NativeGitWorker } from '../../workers/native-git/engine.js';
import { pruneDownloads } from '../../workers/native-git/download.js';
import { signWorkerBody, nativeBindingHash, DOWNLOAD_PURPOSE, UPLOAD_PURPOSE, DOWNLOAD_SESSION_MS } from '../../src/native-git/protocol.js';
import { defaultScannerSettings } from '../../src/github/scanner-policy.js';

const spawnAsync = (cmd, args, opts) => new Promise(resolve => { const child = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] }); let stdout = '', stderr = ''; child.stdout.on('data', c => { stdout += c; }); child.stderr.on('data', c => { stderr += c; }); child.on('close', status => resolve({ status, stdout, stderr })); });
const KEY = 'FAKE-local-native-download-worker-key-0123456789';
const binding = { authority: 'd'.repeat(32), connection: 'e'.repeat(64), owner: 'example-org', repo: 'hello' };
const IDLE = 14400000;
const ENV = { ...process.env, http_proxy: '', HTTP_PROXY: '', https_proxy: '', HTTPS_PROXY: '', ALL_PROXY: '', all_proxy: '', NO_PROXY: '*', no_proxy: '*', GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
const permissive = { policy: {}, body: () => ({ allowed: true }), check: async () => ({ allowed: true }), close() {} };
let dir, bare, root, server, origin, id, skew, counter;
const git = (cwd, ...a) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'user.name=Agent', '-c', 'user.email=agent@example.test', ...a], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: ENV }).trim();
const gitBytes = (cwd, ...a) => execFileSync('git', a, { cwd, env: ENV, maxBuffer: 64 * 1024 * 1024 });
const clone = (url, target, extra = []) => spawnAsync('git', ['-c', 'http.followRedirects=false', 'clone', '--quiet', ...extra, url, target], { cwd: dir, env: ENV });
const repo = () => join(root, id, 'repo');
const now = () => Date.now() + skew;

async function call(action, options = {}, extra = {}) {
 const body = JSON.stringify({ version: 3, idleTimeoutMs: IDLE, expiresAt: now() + 60000, binding, action, workspace_id: id, options, scannerPolicy: { settings: defaultScannerSettings(), revision: 0 }, ...extra });
 const res = await fetch(origin + '/v1/workspace', { method: 'POST', headers: { 'content-type': 'application/json', 'x-robinson-signature': signWorkerBody(body, KEY) }, body });
 return { status: res.status, data: await res.json() };
}
const address = (claim, route = 'download') => { const body = JSON.stringify(claim); return `${origin}/v1/${route}/${Buffer.from(body).toString('base64url')}.${signWorkerBody(body, KEY)}`; };
async function begin(mode, { ref, maxBytes = 64 * 1024 * 1024, expect: wanted = 'awaiting' } = {}) {
 const downloadId = randomBytes(16).toString('hex'), nonce = randomBytes(16).toString('hex'), expiresAt = now() + 600000;
 const r = await call('download_begin', { downloadId, mode, maxBytes, expiresAt, nonce, ...(ref !== undefined ? { ref } : {}) }, { allowWrite: true, requestKey: 'begin-' + (++counter) });
 expect(r.status).toBe(200);
 if (wanted === 'awaiting') expect(r.data).toMatchObject({ state: 'awaiting', mode });
 const claim = { purpose: DOWNLOAD_PURPOSE, version: 1, workspace_id: id, binding: nativeBindingHash(binding), mode, maxBytes, expiresAt, downloadId, nonce };
 return { downloadId, claim, url: address(claim), begun: r.data };
}
const status = downloadId => call('download_status', { downloadId });
// The worker records the final state just after the response that carried the pack ends, so a client that has
// already exited can read the previous state for a moment. Wait (bounded) for it to settle, then assert exactly.
const settled = async (downloadId, ms = 5000) => {
  const until = Date.now() + ms; let r = await status(downloadId);
  while (r.data?.state === 'serving' && Date.now() < until) { await new Promise(t => setTimeout(t, 50)); r = await status(downloadId); }
  return r;
};
const fetchArchive = async url => { const res = await fetch(url); return { status: res.status, bytes: Buffer.from(await res.arrayBuffer()) }; };
const tarList = bytes => execFileSync('tar', ['-tzf', '-'], { input: bytes, encoding: 'utf8' }).split('\n').filter(Boolean).map(p => p.replace(/\/$/, ''));

beforeEach(async () => {
 skew = 0; counter = 0;
 dir = await mkdtemp(join(tmpdir(), 'native-download-')); const seed = join(dir, 'seed'); bare = join(dir, 'remote.git'); root = join(dir, 'storage');
 await mkdir(seed); git(seed, 'init', '-b', 'main');
 await mkdir(join(seed, 'src')); await writeFile(join(seed, 'src', 'app.js'), 'console.log(1)\n'); await writeFile(join(seed, 'file.txt'), 'base\n'); await writeFile(join(seed, '.gitignore'), 'ignored.log\n');
 await writeFile(join(seed, 'image.bin'), randomBytes(200000));
 git(seed, 'add', '.'); git(seed, 'commit', '-m', 'base'); git(seed, 'tag', '-a', 'v1', '-m', 'v1');
 await writeFile(join(seed, 'file.txt'), 'second\n'); git(seed, 'commit', '-am', 'second'); git(seed, 'branch', 'topic', 'HEAD~1');
 git(dir, 'clone', '--bare', seed, bare);
 const worker = new NativeGitWorker({ root, authorize: async () => true, allowLocalFixtures: true });
 const opened = await worker.create(binding, { requestKey: 'open-download', fixtureRemote: bare }); expect(opened.state).toBe('ready'); id = opened.workspace_id;
 git(repo(), 'branch', 'topic', 'origin/topic'); git(repo(), 'fetch', '--quiet', '--tags', bare);
 server = nativeGitServer({ root, key: KEY, now, allowLocalFixtures: true, fixtureRemote: () => bare, resources: permissive });
 await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${server.address().port}`;
});
afterEach(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); });

describe('git mode: a real git clone from the one-time URL', () => {
 it('clones the exact HEAD, branches and tags read-only, then refuses a second session', async () => {
  const head = git(repo(), 'rev-parse', 'HEAD'); const config = await readFile(join(repo(), '.git', 'config'), 'utf8');
  const { downloadId, url, begun } = await begin('git');
  expect(begun).toMatchObject({ source: 'refs', head, branch: 'main', refs: 3 });
  const out = join(dir, 'out');
  const cloned = await clone(url, out); expect(cloned.status, cloned.stderr).toBe(0);
  expect(git(out, 'rev-parse', 'HEAD')).toBe(head);
  expect(git(out, 'symbolic-ref', 'HEAD')).toBe('refs/heads/main');
  expect(git(out, 'for-each-ref', '--format=%(refname)').split('\n').sort()).toEqual(['refs/heads/main', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main', 'refs/remotes/origin/topic', 'refs/tags/v1']);
  expect(await readFile(join(out, 'image.bin'))).toEqual(await readFile(join(repo(), 'image.bin')));
  expect(git(out, 'fsck', '--full', '--strict')).toBe('');
  expect((await settled(downloadId)).data).toMatchObject({ state: 'downloaded', served_bytes: expect.any(Number) });
  // Single session: a later clone with the same address is refused; the snapshot is gone.
  const again = await clone(url, join(dir, 'again')); expect(again.status).not.toBe(0); expect(again.stderr).toMatch(/410|already used/);
  await expect(readdir(join(root, '.downloads', id, downloadId))).rejects.toThrow();
  // Read-only: the workspace's refs, config and generation are unchanged.
  expect(await readFile(join(repo(), '.git', 'config'), 'utf8')).toBe(config);
  expect((await call('inspect')).data.generation).toBe(0);
 });
 it('serves exactly one requested ref and supports git fetch into an existing clone', async () => {
  const topic = git(repo(), 'rev-parse', 'topic');
  const one = await begin('git', { ref: 'topic' });
  expect(one.begun).toMatchObject({ source: 'ref', head: topic, branch: 'topic', refs: 1 });
  const out = join(dir, 'topic');
  expect((await clone(one.url, out)).status).toBe(0);
  expect(git(out, 'rev-parse', 'HEAD')).toBe(topic);
  expect(git(out, 'for-each-ref', '--format=%(refname)', 'refs/remotes/', 'refs/tags/').split('\n').filter(Boolean).sort()).toEqual(['refs/remotes/origin/HEAD', 'refs/remotes/origin/topic']);
  // An object that was not advertised cannot be wanted (main's newer commit is not in this snapshot).
  expect(git(out, 'cat-file', '-t', topic)).toBe('commit');
  expect(() => git(out, 'cat-file', '-e', git(repo(), 'rev-parse', 'main'))).toThrow();
  const narrow = await begin('git', { ref: 'topic' });
  const unadvertised = await spawnAsync('git', ['fetch', '--quiet', narrow.url, git(repo(), 'rev-parse', 'main')], { cwd: out, env: ENV });
  expect(unadvertised.status).not.toBe(0); expect(unadvertised.stderr).toMatch(/unadvertised object|not our ref/);
  // The server itself refuses a raw want for an object outside the advertised refs.
  const pkt = line => (line.length + 4).toString(16).padStart(4, '0') + line;
  const raw = await begin('git', { ref: 'topic' });
  expect((await fetch(raw.url + '/info/refs?service=git-upload-pack')).status).toBe(200);
  const answer = await fetch(raw.url + '/git-upload-pack', { method: 'POST', headers: { 'content-type': 'application/x-git-upload-pack-request' }, body: pkt(`want ${git(repo(), 'rev-parse', 'main')}\n`) + '0000' + pkt('done\n') });
  expect(await answer.text()).toMatch(/not our ref/);
  // Incremental fetch of main into the existing clone sends only new objects.
  await writeFile(join(repo(), 'new.txt'), 'new\n'); git(repo(), 'add', 'new.txt'); git(repo(), 'commit', '-m', 'workspace work');
  const main = await begin('git', { ref: 'main' });
  const fetched = await spawnAsync('git', ['fetch', '--quiet', main.url, 'main:refs/remotes/ws/main'], { cwd: out, env: ENV });
  expect(fetched.status, fetched.stderr).toBe(0);
  expect(git(out, 'rev-parse', 'refs/remotes/ws/main')).toBe(git(repo(), 'rev-parse', 'HEAD'));
  expect((await settled(main.downloadId)).data.state).toBe('downloaded');
  const commitRef = await begin('git', { ref: topic.slice(0, 12) });
  expect(commitRef.begun).toMatchObject({ branch: 'download', head: topic });
  const missing = await begin('git', { ref: 'no-such-branch', expect: 'refused' });
  expect(missing.begun).toMatchObject({ status: 'refused', reason: expect.stringMatching(/No branch, tag or commit/) });
  expect((await begin('git', { ref: 'worktree', expect: 'refused' })).begun).toMatchObject({ status: 'refused' });
 });
 it('clones a shallow workspace', async () => {
  const worker = new NativeGitWorker({ root, authorize: async () => true, allowLocalFixtures: true });
  const shallow = await worker.create(binding, { requestKey: 'open-shallow', depth: 1, fixtureRemote: 'file://' + bare });
  const previous = id; id = shallow.workspace_id;
  try {
   const { url } = await begin('git');
   const out = join(dir, 'shallow'); const cloned = await clone(url, out); expect(cloned.status, cloned.stderr).toBe(0);
   expect(git(out, 'rev-parse', 'HEAD')).toBe(git(repo(), 'rev-parse', 'HEAD'));
   expect(git(out, 'rev-parse', '--is-shallow-repository')).toBe('true');
  } finally { id = previous; }
 });
 it('refuses expired, tampered, wrong-workspace, upload-purpose and over-cap addresses; leases and upload claims never cross', async () => {
  const ok = await begin('git');
  const tampered = ok.url.slice(0, -1) + (ok.url.endsWith('a') ? 'b' : 'a');
  expect((await clone(tampered, join(dir, 't'))).stderr).toMatch(/403|not valid/);
  expect((await clone(address({ ...ok.claim, workspace_id: 'git_' + 'f'.repeat(32) }), join(dir, 'w'))).stderr).toMatch(/404|no longer available/);
  expect((await clone(address({ ...ok.claim, binding: 'f'.repeat(64) }), join(dir, 'b'))).stderr).toMatch(/404|no longer available/);
  // An upload claim (other purpose and fields) is never a download address, on either route shape.
  const { downloadId, ...rest } = ok.claim;
  const asUpload = { ...rest, purpose: UPLOAD_PURPOSE, mode: 'git', uploadId: downloadId };
  expect((await fetch(address(asUpload) + '/info/refs?service=git-upload-pack')).status).toBe(403);
  expect((await fetch(address({ ...ok.claim, purpose: UPLOAD_PURPOSE }) + '/info/refs?service=git-upload-pack')).status).toBe(403);
  // A download claim is never an upload address, and never a worker request lease.
  expect((await fetch(address(ok.claim, 'upload') + '/info/refs?service=git-receive-pack')).status).toBe(403);
  const claimBody = JSON.stringify(ok.claim);
  expect((await fetch(origin + '/v1/workspace', { method: 'POST', headers: { 'x-robinson-signature': signWorkerBody(claimBody, KEY) }, body: claimBody })).status).toBe(401);
  const lease = JSON.stringify({ version: 3, expiresAt: now() + 60000, binding, action: 'inspect', workspace_id: id });
  expect((await fetch(`${origin}/v1/download/${Buffer.from(lease).toString('base64url')}.${signWorkerBody(lease, KEY)}/info/refs?service=git-upload-pack`)).status).toBe(403);
  // Push to a download address is refused (read-only).
  expect((await fetch(ok.url + '/info/refs?service=git-receive-pack')).status).toBe(403);
  expect([403, 404]).toContain((await fetch(ok.url + '/git-receive-pack', { method: 'POST' })).status);
  // Expired before use.
  skew = 600001;
  expect((await clone(ok.url, join(dir, 'late'))).stderr).toMatch(/403|expired/);
  skew = 0;
  expect((await status(ok.downloadId)).data.state).toBe('awaiting');
  // A cap smaller than the pack fails the clone and consumes the address.
  const small = await begin('git', { maxBytes: 4096 });
  expect((await clone(small.url, join(dir, 'small'))).status).not.toBe(0);
  expect((await status(small.downloadId)).data.state).toBe('failed');
 }, 30000);
 it('lets a session that started before expiry finish, but never past the session window', async () => {
  const { url, downloadId } = await begin('git');
  skew = 600000 - 2000;
  expect((await fetch(url + '/info/refs?service=git-upload-pack')).status).toBe(200);
  skew = 600000 + 60000;
  expect((await clone(url, join(dir, 'late-session'))).status).toBe(0);
  expect((await settled(downloadId)).data.state).toBe('downloaded');
  skew = 0;
  const second = await begin('git');
  expect((await fetch(second.url + '/info/refs?service=git-upload-pack')).status).toBe(200);
  skew = DOWNLOAD_SESSION_MS + 1000;
  expect((await fetch(second.url + '/info/refs?service=git-upload-pack')).status).not.toBe(200);
 });
});

describe('archive mode: one curl download', () => {
 it('matches git archive for a ref and for HEAD by default, once', async () => {
  for (const ref of [undefined, 'v1', 'topic']) {
   const commit = git(repo(), 'rev-parse', (ref ?? 'HEAD') + '^{commit}');
   const { url, downloadId, begun } = await begin('archive', ref === undefined ? {} : { ref });
   expect(begun).toMatchObject({ source: 'commit', head: commit });
   const sent = await spawnAsync('curl', ['-fsS', '--noproxy', '*', '-o', join(dir, 'repo.tar.gz'), url], { env: ENV });
   expect(sent.status, sent.stderr).toBe(0);
   expect(gunzipSync(await readFile(join(dir, 'repo.tar.gz')))).toEqual(gitBytes(repo(), 'archive', '--format=tar', commit));
   expect((await settled(downloadId)).data.state).toBe('downloaded');
   expect((await fetchArchive(url)).status).toBe(410);
  }
 });
 it('a cut-off archive fetch does not consume the address: the same address serves until one download completes (G7)', async () => {
  const commit = git(repo(), 'rev-parse', 'HEAD^{commit}');
  const { url, downloadId } = await begin('archive');
  // First fetch dies mid-stream (the sandboxed-fetch failure from the field: 0 usable bytes).
  const first = await fetch(url);
  expect(first.status).toBe(200);
  const reader = first.body.getReader();
  await reader.read();
  await reader.cancel().catch(() => {});
  await new Promise(t => setTimeout(t, 300));
  expect((await status(downloadId)).data.state).toBe('serving');
  // The retry with the SAME address delivers the whole archive.
  const { status: code, bytes } = await fetchArchive(url);
  expect(code).toBe(200);
  expect(gunzipSync(bytes)).toEqual(gitBytes(repo(), 'archive', '--format=tar', commit));
  expect((await settled(downloadId)).data.state).toBe('downloaded');
  // Only a completed download consumes the address.
  expect((await fetchArchive(url)).status).toBe(410);
 });
 it('an archive retry after the session window is refused', async () => {
  const { url, downloadId } = await begin('archive');
  const first = await fetch(url);
  expect(first.status).toBe(200);
  await first.body.cancel().catch(() => {});
  await new Promise(t => setTimeout(t, 300));
  expect((await status(downloadId)).data.state).toBe('serving');
  skew = DOWNLOAD_SESSION_MS + 1000;
  expect((await fetchArchive(url)).status).toBe(410);
  skew = 0;
 });
 it('worktree: tracked and untracked files including uncommitted edits, never .git, ignored files or outside links', async () => {
  await writeFile(join(repo(), 'file.txt'), 'edited, not committed\n');
  await writeFile(join(repo(), 'new-untracked.md'), '# new\n');
  await writeFile(join(repo(), 'ignored.log'), 'noise\n');
  await mkdir(join(repo(), 'deep', 'er'), { recursive: true }); const long = 'x'.repeat(120) + '.txt'; await writeFile(join(repo(), 'deep', 'er', long), 'long\n');
  await symlink('src/app.js', join(repo(), 'inside-link'));
  const { url, begun } = await begin('archive', { ref: 'worktree' });
  expect(begun).toMatchObject({ source: 'worktree', head: git(repo(), 'rev-parse', 'HEAD'), files: 7 });
  const { status: code, bytes } = await fetchArchive(url); expect(code).toBe(200); expect(bytes.length).toBe(begun.bytes);
  const names = tarList(bytes);
  expect(names.length).toBe(7);
  expect(names).toEqual(expect.arrayContaining(['.gitignore', 'file.txt', 'image.bin', 'src/app.js', 'new-untracked.md', `deep/er/${long}`, 'inside-link']));
  expect(names.some(n => n === '.git' || n.startsWith('.git/') || n.includes('/.git'))).toBe(false);
  expect(names).not.toContain('ignored.log');
  const out = join(dir, 'unpacked'); await mkdir(out); execFileSync('tar', ['-xzf', '-', '-C', out], { input: bytes });
  expect(await readFile(join(out, 'file.txt'), 'utf8')).toBe('edited, not committed\n');
  expect(await readFile(join(out, 'image.bin'))).toEqual(await readFile(join(repo(), 'image.bin')));
  expect(await readFile(join(out, 'deep', 'er', long), 'utf8')).toBe('long\n');
  expect((await lstat(join(out, 'inside-link'))).isSymbolicLink()).toBe(true);
  await expect(lstat(join(out, '.git'))).rejects.toThrow();
 });
 it('refuses symbolic links that escape the tree and folders that are links, sending nothing', async () => {
  const secret = join(dir, 'outside-secret.txt'); await writeFile(secret, 'outside content\n');
  await symlink(secret, join(repo(), 'escape'));
  const absolute = await begin('archive', { ref: 'worktree', expect: 'refused' });
  expect(absolute.begun).toMatchObject({ status: 'refused', reason: expect.stringMatching(/"escape" is a symbolic link that points outside/) });
  await rm(join(repo(), 'escape'));
  await symlink('../../../outside-secret.txt', join(repo(), 'relative-escape'));
  expect((await begin('archive', { ref: 'worktree', expect: 'refused' })).begun.reason).toMatch(/points outside/);
  await rm(join(repo(), 'relative-escape'));
  await symlink('.git/config', join(repo(), 'config-link'));
  expect((await begin('archive', { ref: 'worktree', expect: 'refused' })).begun.reason).toMatch(/points outside/);
  await rm(join(repo(), 'config-link'));
  // A tracked folder replaced by a link to outside is never followed.
  await rm(join(repo(), 'src'), { recursive: true }); await symlink(dir, join(repo(), 'src'));
  expect((await begin('archive', { ref: 'worktree', expect: 'refused' })).begun.reason).toMatch(/symbolic link/);
  await expect(readdir(join(root, '.downloads', id))).resolves.toEqual([]);
 });
 it('refuses an archive bigger than its cap (worktree before any address works; commit by cutting the stream)', async () => {
  const small = await begin('archive', { ref: 'worktree', maxBytes: 1024, expect: 'refused' });
  expect(small.begun).toMatchObject({ status: 'refused', reason: expect.stringMatching(/larger than its 1 MiB limit/) });
  const commit = await begin('archive', { maxBytes: 4096 });
  const sent = await spawnAsync('curl', ['-fsS', '--noproxy', '*', '-o', join(dir, 'cut.tar.gz'), commit.url], { env: ENV });
  expect(sent.status).not.toBe(0);
  expect((await status(commit.downloadId)).data.state).toBe('failed');
  // Other methods are refused.
  const other = await begin('archive');
  expect((await fetch(other.url, { method: 'PUT', body: 'x' })).status).toBe(405);
  expect((await fetch(other.url + '/info/refs?service=git-upload-pack')).status).toBe(405);
  expect((await status(other.downloadId)).data.state).toBe('awaiting');
 });
});

describe('limits and cleanup', () => {
 it('caps outstanding addresses per workspace, replays a begin, and cleans up on sweep and close', async () => {
  const first = await begin('archive');
  const replay = await call('download_begin', { downloadId: first.claim.downloadId, mode: 'archive', maxBytes: first.claim.maxBytes, expiresAt: first.claim.expiresAt, nonce: first.claim.nonce }, { allowWrite: true, requestKey: 'begin-replay' });
  expect(replay.data).toMatchObject({ download_id: 'dl_' + first.downloadId, state: 'awaiting' });
  for (let i = 1; i < 20; i++) await begin('archive');
  expect((await begin('archive', { expect: 'refused' })).begun).toMatchObject({ status: 'refused', reason: expect.stringMatching(/unused download addresses/) });
  expect(await pruneDownloads(root, Date.now())).toEqual({ removed: 0 });
  expect(await pruneDownloads(root, first.claim.expiresAt + DOWNLOAD_SESSION_MS + 600001)).toEqual({ removed: 1 });
  expect(await pruneDownloads(root, Date.now() + 3600000)).toEqual({ removed: 19 });
  await begin('git');
  await new NativeGitWorker({ root, authorize: async () => true }).close(id, binding);
  await expect(lstat(join(root, '.downloads', id))).rejects.toThrow();
 });
 it('begin requires a write lease and capabilities advertise direct downloads', async () => {
  const r = await call('download_begin', { downloadId: 'a'.repeat(32), mode: 'git', maxBytes: 1024, expiresAt: now() + 60000, nonce: 'b'.repeat(32) }, { requestKey: 'no-write' });
  expect(r.status).toBe(400);
  expect((await call('capabilities')).data.direct_download).toBe('one-time-v1');
 });
});
