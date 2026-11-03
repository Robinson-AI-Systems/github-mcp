// NATIVE-ERGO-1: github_repo_change — one call to write/delete files, commit, push and open the PR.
// The nine write-contract checks through every door, then real commits and pushes from a real
// local worker into a real local bare remote: new branch, existing branch, replay, interrupted
// resume, a moved branch, the PR through the guarded workflow, and the upload path.
import { afterEach, beforeEach, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { runWriteContract, makeWorld, parse, doorsFor } from '../../test/helpers/write-contract.js';
import { prepareNativeWorld } from '../../test/helpers/native-git-world.js';
import { startTransferRelay } from '../../test/helpers/transfer-relay.js';
import { nativeGitServer } from '../../workers/native-git/server.js';
import { createDispatch } from '../../src/tools/dispatch.js';
import { registry, COMPACT_DEVELOPER_TOOLS } from '../../src/tools/index.js';
import { toolsForListing } from '../../src/core/registry.js';
import * as change from '../../src/tools/repo-change.js';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
const definition = { tool: change.tools[0], handler: change.handlers.github_repo_change };
const headOf = (remote, branch) => { try { return git(remote, 'rev-parse', '--verify', '-q', 'refs/heads/' + branch); } catch { return null; } };
// GitHub's view of a branch is the local remote's own ref (a missing branch answers with another ref).
const refRoute = (gh, remote) => gh.when('GET /repos/{owner}/{repo}/git/ref/{ref}').reply(200, request => {
 const branch = String(request.params.ref).replace(/^heads\//, ''); const sha = headOf(remote(), branch);
 return sha ? { ref: 'refs/heads/' + branch, node_id: 'REF_1', url: 'https://api.github.com/x', object: { sha, type: 'commit', url: 'https://api.github.com/y' } }
  : { ref: 'refs/heads/__absent__', node_id: 'REF_0', url: 'https://api.github.com/x', object: { sha: '0'.repeat(40), type: 'commit', url: 'https://api.github.com/y' } };
});
const arrange = (gh, outcome) => { gh.nativeOutcome = outcome; gh.when('GET /repos/{owner}/{repo}').reply(200, { full_name: 'example-org/hello', default_branch: 'main' }); };
const cleanups = [];
afterEach(async () => { for (const close of cleanups.splice(0)) await close(); });

runWriteContract({ label: 'github_repo_change (new branch from main)', definition, args: { repo: 'hello', branch: 'topic', files: [{ path: 'new.txt', content: 'hello\n' }], message: 'Add new.txt' },
 arrange, needsConfirm: true, production: true, profile: 'full', expectedWrites: 0,
 prepare: async w => { cleanups.push(await prepareNativeWorld(w)); refRoute(w.gh, () => w.nativeSeed); } });

// ---- Real local worker and bare remote (push to main is allowed on a bare repository).
let dir, bare, w, server, origin, requests, interrupt, relay;
beforeEach(async () => {
 dir = await mkdtemp(join(tmpdir(), 'repo-change-')); const seed = join(dir, 'seed'); bare = join(dir, 'remote.git');
 await mkdir(seed); git(seed, 'init', '-b', 'main'); git(seed, 'config', 'user.name', 'Fixture'); git(seed, 'config', 'user.email', 'fixture@example.test');
 await writeFile(join(seed, 'file.txt'), 'initial\n'); await writeFile(join(seed, 'old.txt'), 'old\n'); git(seed, 'add', '.'); git(seed, 'commit', '-m', 'initial'); git(dir, 'clone', '--bare', seed, bare);
 w = await makeWorld({ mode: 'production', profile: 'full' }); requests = []; interrupt = null;
 const resources = { policy: { minMemoryBytes: 33554432, minDiskBytes: 67108864, maxLoopDelayMs: 250 }, body: () => ({ allowed: true }), check: async () => ({ allowed: true }), close() {} };
 server = nativeGitServer({ root: join(dir, 'storage'), key: 'FAKE-repo-change-worker-key-for-local-tests', now: w.ctx.now, allowLocalFixtures: true, fixtureRemote: () => bare, resources });
 await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${server.address().port}`;
 arrange(w.gh, 'ok'); refRoute(w.gh, () => bare);
 w.env = { ...w.ctx.env, NATIVE_GIT_WORKER_URL: 'https://worker.example.test/', NATIVE_GIT_WORKER_KEY: 'FAKE-repo-change-worker-key-for-local-tests', PUBLIC_BASE_URL: 'https://mcp.example.test' };
 relay = await startTransferRelay({ env: () => w.env, now: w.ctx.now, destinations: { 'https://worker.example.test': origin } });
});
afterEach(async () => { await relay?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); });
const fetcher = async (url, init) => {
 if (new URL(url).origin === 'https://worker.example.test') {
  const body = JSON.parse(init.body); requests.push(body);
  if (interrupt?.(body)) { interrupt = null; throw new TypeError('simulated network cut'); }
  return fetch(origin + '/v1/workspace', init);
 }
 return w.gh.fetch(url, init);
};
const call = (name, args) => createDispatch({ ...w.ctx, sleep: async () => {}, env: w.env, gates: [], fetch: fetcher }).call(null, { registry, name, args, connection: w.connection, db: w.db });
const runs = op => requests.filter(r => r.action === 'run' && r.operation === op).length;

it('one call makes a new branch with written and deleted files, commits once and pushes; the same call again replays', async () => {
 const args = { owner: 'example-org', repo: 'hello', branch: 'feature/one', files: [{ path: 'src/a.txt', content: 'alpha\n' }, { path: 'bin.dat', base64: Buffer.from([0, 1, 2, 255]).toString('base64') }], deletePaths: ['old.txt', 'never-there.txt'], message: 'One change', requestKey: 'one' };
 const out = parse(await call('github_repo_change', args));
 expect(out, JSON.stringify(out)).toMatchObject({ status: 'applied', confirmed: true, result: { stage: 'pushed', branch: 'feature/one', base: 'main', files_written: 2, files_deleted: 1 } });
 const head = headOf(bare, 'feature/one');
 expect(out.result.commit).toBe(head);
 expect(git(bare, 'log', '-1', '--format=%s', head)).toBe('One change');
 expect(git(bare, 'rev-parse', head + '^')).toBe(headOf(bare, 'main'));
 expect(git(bare, 'show', head + ':src/a.txt')).toBe('alpha');
 expect(git(bare, 'ls-tree', '--name-only', head).split('\n').sort()).toEqual(['bin.dat', 'file.txt', 'src']);
 expect(out.progress).toMatchObject({ stage: 'pushed', commit: head }); expect(out.progress.progress).toMatch(/new branch feature\/one from main.*committed.*pushed/);
 expect(Buffer.byteLength(JSON.stringify(out.progress))).toBeLessThanOrEqual(1200);
 const again = parse(await call('github_repo_change', args));
 expect(again).toMatchObject({ status: 'replayed', confirmed: true });
 expect(runs('commit')).toBe(1); expect(runs('push')).toBe(1); expect(headOf(bare, 'feature/one')).toBe(head);
}, 60000);

it('updates an existing branch in the reused workspace (no second clone), with expectedHead; a moved branch is refused before any change', async () => {
 const first = parse(await call('github_repo_change', { repo: 'hello', branch: 'topic', files: [{ path: 'a.txt', content: '1\n' }], message: 'first', requestKey: 'u1' }));
 expect(first.status, JSON.stringify(first)).toBe('applied');
 const head1 = first.result.commit;
 const second = parse(await call('github_repo_change', { repo: 'hello', branch: 'topic', expectedHead: head1, files: [{ path: 'a.txt', content: '2\n' }], message: 'second', requestKey: 'u2' }));
 expect(second, JSON.stringify(second)).toMatchObject({ status: 'applied', result: { stage: 'pushed', workspace_id: first.result.workspace_id } });
 expect(second.result.progress.join(' ')).toMatch(/reused open workspace/);
 expect(requests.filter(r => r.action === 'open')).toHaveLength(1);
 expect(git(bare, 'rev-parse', second.result.commit + '^')).toBe(head1);
 // Someone else pushes; a caller holding the old head is refused, nothing is sent.
 const other = join(dir, 'other'); git(dir, 'clone', '-b', 'topic', bare, other); git(other, 'config', 'user.name', 'O'); git(other, 'config', 'user.email', 'o@example.test');
 await writeFile(join(other, 'b.txt'), 'b\n'); git(other, 'add', '.'); git(other, 'commit', '-m', 'elsewhere'); git(other, 'push', 'origin', 'topic');
 const before = runs('commit');
 const moved = parse(await call('github_repo_change', { repo: 'hello', branch: 'topic', expectedHead: second.result.commit, files: [{ path: 'a.txt', content: '3\n' }], message: 'third', requestKey: 'u3' }));
 expect(moved).toMatchObject({ status: 'refused_by_guard', reason_code: 'branch_moved', no_change_sent: true });
 expect(moved.error).toMatch(/moved.*allowMoved/);
 expect(runs('commit')).toBe(before);
 // allowMoved builds on the moved head instead.
 const allowed = parse(await call('github_repo_change', { repo: 'hello', branch: 'topic', expectedHead: second.result.commit, allowMoved: true, files: [{ path: 'a.txt', content: '3\n' }], message: 'third', requestKey: 'u4' }));
 expect(allowed, JSON.stringify(allowed)).toMatchObject({ status: 'applied', result: { stage: 'pushed' } });
 expect(git(bare, 'rev-parse', allowed.result.commit + '^')).toBe(git(other, 'rev-parse', 'HEAD'));
 // Identical content: nothing to commit, said plainly.
 const same = parse(await call('github_repo_change', { repo: 'hello', branch: 'topic', files: [{ path: 'a.txt', content: '3\n' }], message: 'noop', requestKey: 'u5' }));
 expect(same, JSON.stringify(same)).toMatchObject({ status: 'applied', result: { stage: 'no_changes', commit: allowed.result.commit } });
 expect(headOf(bare, 'topic')).toBe(allowed.result.commit);
}, 90000);

it('an interrupted push is finished by the same call again: one commit, one push, never two', async () => {
 const args = { repo: 'hello', branch: 'resume', files: [{ path: 'r.txt', content: 'r\n' }], message: 'resume me', requestKey: 'resume' };
 interrupt = body => body.action === 'run' && body.operation === 'push';
 const cut = parse(await call('github_repo_change', args));
 expect(cut, JSON.stringify(cut)).toMatchObject({ done: false, status: 'uncertain' });
 expect(headOf(bare, 'resume')).toBe(null);
 const resumed = parse(await call('github_repo_change', args));
 expect(resumed, JSON.stringify(resumed)).toMatchObject({ status: 'replayed', confirmed: true, replay_state: 'current', result: { stage: 'pushed' } });
 const head = headOf(bare, 'resume');
 expect(resumed.result.commit).toBe(head);
 expect(git(bare, 'rev-list', '--count', 'main..resume')).toBe('1');
 expect(runs('commit')).toBe(2); // the second is the worker replaying its receipt, not a new commit
 expect(requests.filter(r => r.action === 'open')).toHaveLength(1);
}, 60000);

it('opens the pull request through the guarded PR workflow and returns its number and URL', async () => {
 let created = null;
 const pr = () => ({ number: 7, state: 'open', draft: false, merged: false, html_url: 'https://github.com/example-org/hello/pull/7', title: 'Add pr.txt', head: { ref: 'with-pr', sha: headOf(bare, 'with-pr'), repo: { full_name: 'example-org/hello' } }, base: { ref: 'main', sha: headOf(bare, 'main'), repo: { full_name: 'example-org/hello' } }, labels: [], user: { login: 'example-owner' }, mergeable_state: 'unknown' });
 w.gh.when('GET /repos/{owner}/{repo}/pulls').reply(200, () => created ? [pr()] : []);
 w.gh.when('POST /repos/{owner}/{repo}/pulls').reply(201, () => { created = pr(); return created; });
 w.gh.when('GET /repos/{owner}/{repo}/pulls/{pull_number}').reply(200, () => pr());
 w.gh.when('POST /graphql').reply(200, { data: { repository: { pullRequest: { reviewThreads: { totalCount: 0, nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } } } });
 const out = parse(await call('github_repo_change', { repo: 'hello', branch: 'with-pr', files: [{ path: 'pr.txt', content: 'pr\n' }], message: 'Add pr.txt', pr: { title: 'Add pr.txt', body: 'One-call change.' }, requestKey: 'with-pr' }));
 expect(out, JSON.stringify(out)).toMatchObject({ status: 'applied', result: { stage: 'pushed', pr: { status: 'opened', number: 7, url: 'https://github.com/example-org/hello/pull/7' } } });
 expect(out.progress.pr).toEqual({ number: 7, url: 'https://github.com/example-org/hello/pull/7' });
 const posts = w.gh.calls.filter(c => c.method === 'POST' && !(c.route === 'POST /graphql' && !/^\s*mutation\b/.test(String(c.body?.query ?? ''))));
 expect(posts.map(p => p.route), JSON.stringify(posts.map(p => [p.route, p.path]))).toEqual(['POST /repos/{owner}/{repo}/pulls']); expect(posts[0].body).toMatchObject({ head: 'with-pr', base: 'main', title: 'Add pr.txt' });
 expect(w.gh.invalid).toEqual([]);
 // Asking for a PR from a branch equal to its base is refused before anything runs.
 const same = parse(await call('github_repo_change', { repo: 'hello', branch: 'main', base: 'main', pr: { title: 'x' }, requestKey: 'same' }));
 expect(same).toMatchObject({ status: 'refused_by_guard', no_change_sent: true });
}, 60000);

it('larger changes: upload returns a one-time command first, then one more call applies, deletes, commits and pushes', async () => {
 const begun = parse(await call('github_repo_change', { repo: 'hello', branch: 'bulk', upload: 'archive', requestKey: 'bulk-1' }));
 expect(begun, JSON.stringify(begun)).toMatchObject({ status: 'applied', result: { stage: 'awaiting_upload', upload_id: expect.stringMatching(/^upl_/), single_use: true } });
 expect(begun.result.command).toMatch(/^U="https:\/\/mcp\.example\.test\/v1\/transfer\/u\/.+\/chunk\?offset=/);
 expect(begun.result.single_command).toMatch(/^curl --fail -H "X-Content-SHA256: .+" --upload-file files\.tar\.gz "https:\/\/mcp\.example\.test\/v1\/transfer\/u\//);
 expect(begun.progress.command).toBe(begun.result.command);
 const src = join(dir, 'bulk'); await mkdir(join(src, 'docs'), { recursive: true }); await writeFile(join(src, 'docs', 'big.md'), 'x'.repeat(200000)); await writeFile(join(src, 'file.txt'), 'changed\n');
 const archive = execFileSync('tar', ['-czf', '-', '-C', src, '.']);
 const url = begun.result.command.match(/^U="(https:[^"]+)"/)[1];
 const sent = await fetch(relay.local(url).replace('https://worker.example.test', origin), { method: 'PUT', body: archive });
 expect(sent.status, await sent.clone().text()).toBe(200);
 const done = parse(await call('github_repo_change', { repo: 'hello', branch: 'bulk', workspace_id: begun.result.workspace_id, upload_id: begun.result.upload_id, deletePaths: ['old.txt'], message: 'Bulk change', requestKey: 'bulk-2' }));
 expect(done, JSON.stringify(done)).toMatchObject({ status: 'applied', result: { stage: 'pushed', files_deleted: 1 } });
 const head = headOf(bare, 'bulk');
 expect(git(bare, 'ls-tree', '-r', '--name-only', head).split('\n').sort()).toEqual(['docs/big.md', 'file.txt']);
 expect(git(bare, 'show', head + ':file.txt')).toBe('changed');
 const replay = parse(await call('github_repo_change', { repo: 'hello', branch: 'bulk', upload: 'archive', requestKey: 'bulk-1' }));
 expect(JSON.stringify(replay)).not.toContain('/v1/transfer/');
}, 60000);

it('refuses unusable input plainly before anything is sent', async () => {
 for (const [args, pattern] of [
  [{ repo: 'hello', branch: 'x', files: [{ path: '../up.txt', content: 'x' }], message: 'm' }, /not a usable file path/],
  [{ repo: 'hello', branch: 'x', files: [{ path: 'a.txt', content: 'x', base64: 'eA==' }], message: 'm' }, /either content .* or base64/],
  [{ repo: 'hello', branch: 'x', files: [{ path: 'a.txt', content: 'x' }] }, /commit message is required/],
  [{ repo: 'hello', branch: 'x', files: [{ path: 'k.env', content: 'TOKEN=' + ['ghp', 'A1b2'.repeat(9)].join('_') }], message: 'm' }, /shaped like a credential/],
  [{ repo: 'hello', branch: 'x', upload_id: 'upl_' + '0'.repeat(32), message: 'm' }, /also give the workspace_id/],
  [{ repo: 'hello', branch: 'x' }, /Nothing to change/],
  [{ repo: 'hello', branch: 'x', base: 'nope', files: [{ path: 'a', content: 'a' }], message: 'm' }, /Neither x nor the base nope exists/]
 ]) {
  const out = parse(await call('github_repo_change', args));
  expect(out, JSON.stringify(out)).toMatchObject({ status: 'refused_by_guard', no_change_sent: true }); expect(out.error).toMatch(pattern);
 }
 expect(requests.filter(r => r.action === 'run' || r.action === 'open')).toEqual([]);
});

it('is in the default (compact) tool list within the listing budget, with a short description', () => {
 const compact = toolsForListing(registry, 'full', 'compact');
 const tool = compact.find(t => t.name === 'github_repo_change');
 expect(tool).toBeTruthy(); expect(COMPACT_DEVELOPER_TOOLS).toContain('github_repo_change');
 expect(tool.description.length).toBeLessThanOrEqual(160);
 expect(Object.keys(tool.compactSchema.properties)).toEqual(expect.arrayContaining(['branch', 'files', 'deletePaths', 'message', 'pr', 'expectedHead', 'allowMoved', 'upload', 'upload_id', 'workspace_id', 'requestKey']));
 expect(tool.inputSchema.properties.fresh).toBeTruthy();
 expect(doorsFor(definition)).toHaveLength(3);
});
