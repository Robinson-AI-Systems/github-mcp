// GIT-UPLOAD-1 control plane: the nine write-contract checks through every door, and the
// whole agent flow (begin → git push / curl upload → apply) against a real local worker.
import { afterEach, it, expect } from 'vitest';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
const spawnAsync = (cmd, args, opts) => new Promise(resolve => { const child = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] }); let stdout = '', stderr = ''; child.stdout.on('data', c => { stdout += c; }); child.stderr.on('data', c => { stderr += c; }); child.on('close', status => resolve({ status, stdout, stderr })); });
import { gzipSync } from 'node:zlib';
import { runWriteContract, makeWorld, parse, doorsFor } from '../../test/helpers/write-contract.js';
import { prepareNativeWorld } from '../../test/helpers/native-git-world.js';
import * as native from '../../src/tools/native-git.js';
import { NativeGitWorker } from '../../workers/native-git/engine.js';
import { beginUpload } from '../../workers/native-git/upload.js';
import { signWorkerBody, nativeBindingHash, verifyUploadCapability, UPLOAD_PURPOSE } from '../../src/native-git/protocol.js';

const cleanups = [];
afterEach(async () => { for (const close of cleanups.splice(0)) await close(); });
const definition = { tool: native.tools.find(t => t.name === 'github_git_workspace_upload'), handler: native.handlers.github_git_workspace_upload };
const arrange = (gh, outcome) => { gh.nativeOutcome = outcome; gh.when('GET /repos/{owner}/{repo}').reply(200, { full_name: 'example-org/hello', default_branch: 'main' }); };
const WORKSPACE = 'job_0123456789abcdef', UPLOAD_ID = 'ab'.repeat(16);
const ENV = { ...process.env, http_proxy: '', HTTP_PROXY: '', https_proxy: '', HTTPS_PROXY: '', ALL_PROXY: '', all_proxy: '', NO_PROXY: '*', no_proxy: '*', GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
function tarGz(files) {
 const blocks = [];
 for (const [name, text] of files) {
  const data = Buffer.from(text); const h = Buffer.alloc(512); h.write(name, 0); h.write('0000644\0', 100); h.write(data.length.toString(8).padStart(11, '0') + '\0', 124); h.write('00000000000\0', 136); h.write('        ', 148); h.write('0', 156); h.write('ustar\0', 257); h.write('00', 263);
  let sum = 0; for (const b of h) sum += b; h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  blocks.push(h, data, Buffer.alloc((512 - data.length % 512) % 512));
 }
 return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]));
}
const local = (w, url) => url.replace('https://native-worker.example.test', w.nativeFixture.origin);
async function receivedArchive(w) {
 const f = w.nativeFixture, worker = new NativeGitWorker({ root: f.root, authorize: async () => true, allowLocalFixtures: true, now: w.ctx.now });
 const expiresAt = w.ctx.now() + 600000, nonce = 'cd'.repeat(16), maxBytes = 1048576;
 await beginUpload(worker, f.workerId, f.binding, { uploadId: UPLOAD_ID, mode: 'archive', maxBytes, expiresAt, nonce });
 const body = JSON.stringify({ purpose: UPLOAD_PURPOSE, version: 1, workspace_id: f.workerId, binding: nativeBindingHash(f.binding), mode: 'archive', maxBytes, expiresAt, uploadId: UPLOAD_ID, nonce });
 const res = await fetch(`${f.origin}/v1/upload/${Buffer.from(body).toString('base64url')}.${signWorkerBody(body, f.key)}`, { method: 'PUT', body: tarGz([['upload/a.txt', 'a\n']]) });
 expect(res.status).toBe(200);
}
async function world() {
 const w = await makeWorld({ profile: 'full', mode: 'production', gates: [] }); arrange(w.gh, 'ok'); cleanups.push(await prepareNativeWorld(w, { existing: true })); return w;
}
const secretShaped = text => /gh[pousr]_|github_pat_|x-access-token|authorization|BEGIN [A-Z ]*KEY/i.test(text);

runWriteContract({ label: 'github_git_workspace_upload begin', definition, args: { workspace_id: WORKSPACE, operation: 'begin', mode: 'archive' }, arrange, needsConfirm: true, profile: 'full', expectedWrites: 0,
 prepare: async w => { cleanups.push(await prepareNativeWorld(w, { existing: true })); } });
runWriteContract({ label: 'github_git_workspace_upload apply', definition, args: { workspace_id: WORKSPACE, operation: 'apply', upload_id: 'upl_' + UPLOAD_ID, expectedGeneration: 0 }, arrange, needsConfirm: true, profile: 'full', expectedWrites: 0,
 prepare: async w => { cleanups.push(await prepareNativeWorld(w, { existing: true })); await receivedArchive(w); } });

it('archive flow through every door: one-time URL with no credential, curl-style upload, checked apply and generation bump', async () => {
 for (const door of doorsFor(definition)) {
  const w = await world();
  const begun = parse(await door.call(w, { workspace_id: WORKSPACE, operation: 'begin', mode: 'archive', maxMegabytes: 2, requestKey: 'begin-' + door.name }));
  expect(begun).toMatchObject({ status: 'applied', confirmed: true, result: { state: 'awaiting', mode: 'archive', single_use: true, max_bytes: 2 * 1048576 } });
  const url = new URL(begun.result.url);
  expect(url.origin).toBe('https://native-worker.example.test');
  expect(begun.result.command).toContain('curl --fail --upload-file');
  const claim = verifyUploadCapability(url.pathname.split('/').pop(), w.nativeFixture.key, w.ctx.now());
  expect(Object.keys(claim).sort()).toEqual(['binding', 'expiresAt', 'maxBytes', 'mode', 'nonce', 'purpose', 'uploadId', 'version', 'workspace_id']);
  expect(claim.expiresAt - w.ctx.now()).toBeLessThanOrEqual(600000);
  expect(secretShaped(JSON.stringify(begun))).toBe(false);
  // Replay never hands out the address again (it is not kept in the change log).
  const replay = parse(await door.call(w, { workspace_id: WORKSPACE, operation: 'begin', mode: 'archive', maxMegabytes: 2, requestKey: 'begin-' + door.name }));
  expect(replay).toMatchObject({ status: 'replayed' }); expect(JSON.stringify(replay)).not.toContain(url.pathname);
  expect((await fetch(local(w, begun.result.url), { method: 'PUT', body: tarGz([['photos/a.txt', 'one\n'], ['photos/b.txt', 'two\n']]) })).status).toBe(200);
  const applied = parse(await door.call(w, { workspace_id: WORKSPACE, operation: 'apply', upload_id: begun.result.upload_id, expectedGeneration: 0, path: 'site', requestKey: 'apply-' + door.name }));
  expect(applied).toMatchObject({ status: 'applied', confirmed: true, result: { mode: 'archive', target: 'site', files_added: 2, workspace: { generation: 1 } } });
  expect(await readFile(join(w.nativeFixture.root, w.nativeFixture.workerId, 'repo', 'site', 'photos', 'b.txt'), 'utf8')).toBe('two\n');
  expect(secretShaped(JSON.stringify(applied))).toBe(false);
  expect(w.nativeRequests.filter(x => x === 'upload_apply')).toHaveLength(1);
 }
}, 60000);

it('git flow: a real git push to the returned address, then a fast-forward apply that the typed tools can push', async () => {
 const w = await world(); const f = w.nativeFixture;
 const dir = await mkdtemp(join(tmpdir(), 'upload-agent-')); cleanups.push(() => rm(dir, { recursive: true, force: true }));
 const agent = join(dir, 'agent'); const git = (...a) => execFileSync('git', ['-c', 'user.name=Agent', '-c', 'user.email=agent@example.test', ...a], { cwd: agent, encoding: 'utf8', env: ENV }).trim();
 execFileSync('git', ['clone', '--quiet', f.seed, agent], { env: ENV });
 await writeFile(join(agent, 'image.bin'), Buffer.from([0, 1, 2, 255, 254])); git('add', 'image.bin'); git('commit', '-m', 'image');
 const begun = parse(await definition.handler({ workspace_id: WORKSPACE, operation: 'begin', mode: 'git', requestKey: 'git-begin' }, w.ctx));
 expect(begun.result.command).toMatch(/^git push ".+" HEAD:refs\/heads\/upload$/);
 const pushed = await spawnAsync('git', ['push', local(w, begun.result.url), 'HEAD:refs/heads/upload'], { cwd: agent, env: ENV });
 expect(pushed.status, pushed.stderr).toBe(0);
 const applied = parse(await definition.handler({ workspace_id: WORKSPACE, operation: 'apply', upload_id: begun.result.upload_id, expectedGeneration: 0, requestKey: 'git-apply' }, w.ctx));
 expect(applied).toMatchObject({ status: 'applied', result: { mode: 'git', commits: 1, files_added: 1, head: git('rev-parse', 'HEAD') } });
});

it('reports refusals plainly as rejected with nothing changed, and validates arguments per operation', async () => {
 const w = await world();
 const begun = parse(await definition.handler({ workspace_id: WORKSPACE, operation: 'begin', mode: 'archive', requestKey: 'refuse-begin' }, w.ctx));
 expect((await fetch(local(w, begun.result.url), { method: 'PUT', body: tarGz([['../escape.txt', 'x']]) })).status).toBe(200);
 const refused = parse(await definition.handler({ workspace_id: WORKSPACE, operation: 'apply', upload_id: begun.result.upload_id, expectedGeneration: 0, requestKey: 'refuse-apply' }, w.ctx));
 expect(refused).toMatchObject({ done: false, status: 'rejected' }); expect(refused.error).toMatch(/Archive refused: unsafe entry name/);
 const early = parse(await definition.handler({ workspace_id: WORKSPACE, operation: 'apply', upload_id: 'upl_' + 'e'.repeat(32), expectedGeneration: 0, requestKey: 'missing' }, w.ctx));
 expect(early.status).toBe('rejected');
 const wrong = await definition.handler({ workspace_id: WORKSPACE, operation: 'begin', mode: 'git', path: 'x' }, w.ctx);
 expect(JSON.stringify(parse(wrong))).toMatch(/path is not used by operation begin/);
 const missing = await definition.handler({ workspace_id: WORKSPACE, operation: 'begin' }, w.ctx);
 expect(JSON.stringify(parse(missing))).toMatch(/begin requires mode/);
});
