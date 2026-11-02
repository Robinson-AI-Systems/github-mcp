// GIT-DOWNLOAD-1 control plane: the nine write-contract checks through every door, and the whole
// agent flow (download → real git clone / curl of the returned address) against a real local worker.
import { afterEach, it, expect } from 'vitest';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { runWriteContract, makeWorld, parse, doorsFor } from '../../test/helpers/write-contract.js';
import { prepareNativeWorld } from '../../test/helpers/native-git-world.js';
import * as native from '../../src/tools/native-git.js';
import { verifyDownloadCapability, verifyUploadCapability, verifyWorkerBody, DOWNLOAD_PURPOSE, UPLOAD_PURPOSE } from '../../src/native-git/protocol.js';

const spawnAsync = (cmd, args, opts) => new Promise(resolve => { const child = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] }); let stdout = '', stderr = ''; child.stdout.on('data', c => { stdout += c; }); child.stderr.on('data', c => { stderr += c; }); child.on('close', status => resolve({ status, stdout, stderr })); });
const cleanups = [];
afterEach(async () => { for (const close of cleanups.splice(0)) await close(); });
const definition = { tool: native.tools.find(t => t.name === 'github_git_workspace_download'), handler: native.handlers.github_git_workspace_download };
const arrange = (gh, outcome) => { gh.nativeOutcome = outcome; gh.when('GET /repos/{owner}/{repo}').reply(200, { full_name: 'example-org/hello', default_branch: 'main' }); };
const WORKSPACE = 'job_0123456789abcdef';
const ENV = { ...process.env, http_proxy: '', HTTP_PROXY: '', https_proxy: '', HTTPS_PROXY: '', ALL_PROXY: '', all_proxy: '', NO_PROXY: '*', no_proxy: '*', GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
const local = (w, url) => w.transferLocal(url);
const workspaceRepo = w => join(w.nativeFixture.root, w.nativeFixture.workerId, 'repo');
async function world() {
 const w = await makeWorld({ profile: 'full', mode: 'production', gates: [] }); arrange(w.gh, 'ok'); cleanups.push(await prepareNativeWorld(w, { existing: true })); return w;
}
const secretShaped = text => /gh[pousr]_|github_pat_|x-access-token|authorization|BEGIN [A-Z ]*KEY/i.test(text);

runWriteContract({ label: 'github_git_workspace_download archive', definition, args: { workspace_id: WORKSPACE, mode: 'archive' }, arrange, needsConfirm: true, profile: 'full', expectedWrites: 0,
 prepare: async w => { cleanups.push(await prepareNativeWorld(w, { existing: true })); } });
runWriteContract({ label: 'github_git_workspace_download git', definition, args: { workspace_id: WORKSPACE, mode: 'git' }, arrange, needsConfirm: true, profile: 'full', expectedWrites: 0,
 prepare: async w => { cleanups.push(await prepareNativeWorld(w, { existing: true })); } });

it('git flow through every door: one-time clone URL with no credential in progress, a real clone of the exact HEAD, replay never re-issues it', async () => {
 for (const door of doorsFor(definition)) {
  const w = await world();
  const dir = await mkdtemp(join(tmpdir(), 'download-agent-')); cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workspaceRepo(w), encoding: 'utf8' }).trim();
  const begun = parse(await door.call(w, { workspace_id: WORKSPACE, mode: 'git', requestKey: 'clone-' + door.name }));
  expect(begun).toMatchObject({ status: 'applied', confirmed: true, result: { state: 'awaiting', mode: 'git', head, branch: 'main', single_use: true } });
  const url = new URL(begun.result.url);
  expect(url.origin).toBe('https://mcp.example.test'); expect(url.pathname).toMatch(/^\/v1\/transfer\/[du]\/w\/[A-Za-z0-9_-]{32}\//);
  expect(begun.result.command).toBe(`git -c http.followRedirects=false clone "${begun.result.url}" repo`);
  // Compact clients drop `result`; the always-visible progress must carry the one-time command.
  expect(begun.progress).toMatchObject({ download_id: begun.result.download_id, command: begun.result.command, head, single_use: true });
  // The allowlist note names this service's own domain, inside the bounded always-visible digest.
  expect(begun.progress.if_blocked).toMatch(/cannot reach mcp\.example\.test .*add that one domain to your AI's network allowlist/); expect(begun.progress.if_blocked).toMatch(/Same domain for every repository/);
  expect(Buffer.byteLength(JSON.stringify(begun.progress))).toBeLessThanOrEqual(1200);
  const claim = verifyDownloadCapability(url.pathname.split('/').pop(), w.nativeFixture.key, w.ctx.now());
  expect(Object.keys(claim).sort()).toEqual(['binding', 'downloadId', 'expiresAt', 'maxBytes', 'mode', 'nonce', 'purpose', 'version', 'workspace_id']);
  expect(claim).toMatchObject({ purpose: DOWNLOAD_PURPOSE, maxBytes: 200 * 1048576 });
  expect(claim.expiresAt - w.ctx.now()).toBeLessThanOrEqual(600000);
  expect(() => verifyUploadCapability(url.pathname.split('/').pop(), w.nativeFixture.key, w.ctx.now())).toThrow();
  expect(secretShaped(JSON.stringify(begun))).toBe(false);
  const replay = parse(await door.call(w, { workspace_id: WORKSPACE, mode: 'git', requestKey: 'clone-' + door.name }));
  expect(replay).toMatchObject({ status: 'replayed' }); expect(JSON.stringify(replay)).not.toContain(url.pathname);
  const cloned = await spawnAsync('git', ['clone', '--quiet', local(w, begun.result.url), join(dir, 'repo')], { env: ENV });
  expect(cloned.status, cloned.stderr).toBe(0);
  expect(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: join(dir, 'repo'), encoding: 'utf8' }).trim()).toBe(head);
  expect(await readFile(join(dir, 'repo', 'file.txt'), 'utf8')).toBe('fixture\n');
  expect(w.nativeRequests.filter(x => x === 'download_begin')).toHaveLength(1);
 }
}, 60000);

it('archive flow: ref "worktree" includes uncommitted files and no .git; a commit archive matches git archive', async () => {
 const w = await world(); const repo = workspaceRepo(w);
 await writeFile(join(repo, 'draft.md'), 'not committed\n');
 const begun = parse(await definition.handler({ workspace_id: WORKSPACE, mode: 'archive', ref: 'worktree', requestKey: 'wt' }, w.ctx));
 expect(begun).toMatchObject({ status: 'applied', result: { source: 'worktree', files: 2 } });
 expect(begun.result.command).toMatch(/^curl -fsS ".+" -o repo\.tar\.gz && mkdir -p repo && tar -xzf repo\.tar\.gz -C repo$/);
 expect(begun.progress.command).toBe(begun.result.command);
 const res = await fetch(local(w, begun.result.url)); expect(res.status).toBe(200);
 const names = execFileSync('tar', ['-tzf', '-'], { input: Buffer.from(await res.arrayBuffer()), encoding: 'utf8' }).split('\n').filter(Boolean).sort();
 expect(names).toEqual(['draft.md', 'file.txt']);
 const commit = parse(await definition.handler({ workspace_id: WORKSPACE, mode: 'archive', requestKey: 'commit' }, w.ctx));
 const bytes = Buffer.from(await (await fetch(local(w, commit.result.url))).arrayBuffer());
 expect(gunzipSync(bytes)).toEqual(execFileSync('git', ['archive', '--format=tar', commit.result.head], { cwd: repo }));
 expect(secretShaped(JSON.stringify([begun, commit]))).toBe(false);
});

it('reports refusals plainly as rejected and sends nothing', async () => {
 const w = await world();
 const wrong = parse(await definition.handler({ workspace_id: WORKSPACE, mode: 'git', ref: 'worktree', requestKey: 'wrong' }, w.ctx));
 expect(wrong).toMatchObject({ done: false, status: 'refused_by_guard', no_change_sent: true }); expect(wrong.error).toMatch(/ref "worktree" is for mode archive/);
 const missing = parse(await definition.handler({ workspace_id: WORKSPACE, mode: 'archive', ref: 'no-such-tag', requestKey: 'missing' }, w.ctx));
 expect(missing).toMatchObject({ done: false, status: 'rejected' }); expect(missing.error).toMatch(/No branch, tag or commit/);
 expect(w.nativeRequests.filter(x => x === 'download_begin')).toHaveLength(1);
});

it('production signing: an Ed25519 download claim verifies with the pinned key and never works as an upload claim or request lease', async () => {
 const { signNativeDownloadClaim, signNativeUploadClaim, signNativeWorkerBody, nativeWorkerPublicKey } = await import('../../src/native-git/signing.js');
 const env = { TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64') }; const key = nativeWorkerPublicKey(env), now = Date.now();
 const fields = { version: 1, workspace_id: 'git_' + 'a'.repeat(32), binding: 'b'.repeat(64), mode: 'git', maxBytes: 1048576, expiresAt: now + 600000, nonce: 'd'.repeat(32) };
 const claim = JSON.stringify({ purpose: DOWNLOAD_PURPOSE, ...fields, downloadId: 'c'.repeat(32) });
 const token = `${Buffer.from(claim).toString('base64url')}.${signNativeDownloadClaim(claim, env)}`;
 expect(verifyDownloadCapability(token, key, now)).toMatchObject({ mode: 'git', downloadId: 'c'.repeat(32) });
 expect(() => verifyUploadCapability(token, key, now)).toThrow(/Invalid upload/);
 expect(() => verifyWorkerBody(claim, 'ed25519:' + token.split('.')[1], key, now)).toThrow();
 const upload = JSON.stringify({ purpose: UPLOAD_PURPOSE, ...fields, uploadId: 'c'.repeat(32) });
 const uploadToken = `${Buffer.from(upload).toString('base64url')}.${signNativeUploadClaim(upload, env)}`;
 expect(() => verifyDownloadCapability(uploadToken, key, now)).toThrow(/Invalid download/);
 // The signers refuse each other's purpose, credentials and actions.
 expect(() => signNativeDownloadClaim(upload, env)).toThrow(/Invalid download claim/);
 expect(() => signNativeUploadClaim(claim, env)).toThrow(/Invalid upload claim/);
 expect(() => signNativeDownloadClaim(JSON.stringify({ ...JSON.parse(claim), credential: 'x' }), env)).toThrow(/Invalid download claim/);
 const lease = JSON.stringify({ version: 3, expiresAt: now + 60000, action: 'inspect' });
 expect(() => verifyDownloadCapability(`${Buffer.from(lease).toString('base64url')}.${signNativeWorkerBody(lease, env).slice(8)}`, key, now)).toThrow(/Invalid download/);
 expect(() => verifyDownloadCapability(token, key, now + 600001)).toThrow(/expired/);
 expect(verifyDownloadCapability(token, key, now + 600001, { graceMs: 300000 }).downloadId).toBe('c'.repeat(32));
 expect(() => verifyDownloadCapability(token, key, now + 900001, { graceMs: 300000 })).toThrow(/expired/);
});
