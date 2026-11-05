// NATIVE-ERGO-1: the spellings agents naturally use, and definite outcomes instead of UNCONFIRMED,
// through the real MCP dispatcher, a real local worker and a real bare remote.
import { afterEach, beforeEach, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { makeWorld, parse } from '../../test/helpers/write-contract.js';
import { startTransferRelay } from '../../test/helpers/transfer-relay.js';
import { nativeGitServer } from '../../workers/native-git/server.js';
import { createDispatch } from '../../src/tools/dispatch.js';
import { registry } from '../../src/tools/index.js';
import { gitCommand, normalizeNativeOptions, needsErgonomicWorker, nativeOperationHelp } from '../../src/native-git/commands.js';
import { nextStep, porcelainPaths } from '../../src/native-git/outcomes.js';

const KEY = 'FAKE-native-ergonomics-worker-key-for-tests';
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
let dir, bare, w, server, origin, requests, oldWorker, relay, env;
beforeEach(async () => {
 dir = await mkdtemp(join(tmpdir(), 'native-ergo-')); const seed = join(dir, 'seed'); bare = join(dir, 'remote.git');
 await mkdir(seed); git(seed, 'init', '-b', 'main'); git(seed, 'config', 'user.name', 'Fixture'); git(seed, 'config', 'user.email', 'fixture@example.test');
 await writeFile(join(seed, 'file.txt'), 'initial\n'); await writeFile(join(seed, 'a.txt'), 'a\n'); await writeFile(join(seed, 'b.txt'), 'b\n'); git(seed, 'add', '.'); git(seed, 'commit', '-m', 'initial'); git(dir, 'clone', '--bare', seed, bare);
 w = await makeWorld({ mode: 'production', profile: 'full' }); requests = []; oldWorker = false;
 const resources = { policy: { minMemoryBytes: 33554432, minDiskBytes: 67108864, maxLoopDelayMs: 250 }, body: () => ({ allowed: true }), check: async () => ({ allowed: true }), close() {} };
 server = nativeGitServer({ root: join(dir, 'storage'), key: KEY, now: w.ctx.now, allowLocalFixtures: true, fixtureRemote: () => bare, resources });
 await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${server.address().port}`;
 w.gh.when('GET /repos/{owner}/{repo}').reply(200, { full_name: 'example-org/hello', default_branch: 'main' });
 env = { ...w.ctx.env, NATIVE_GIT_WORKER_URL: 'https://worker.example.test/', NATIVE_GIT_WORKER_KEY: KEY, PUBLIC_BASE_URL: 'https://mcp.example.test' };
 relay = await startTransferRelay({ env: () => env, now: w.ctx.now, destinations: { 'https://worker.example.test': origin } });
});
afterEach(async () => { await relay.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); });
const fetcher = async (url, init) => {
 if (new URL(url).origin !== 'https://worker.example.test') return w.gh.fetch(url, init);
 const body = JSON.parse(init.body); requests.push(body);
 const answer = await fetch(origin + '/v1/workspace', init);
 // An older deployed worker: the same engine without the new capability flags.
 if (oldWorker && body.action === 'capabilities') { const cap = await answer.json(); delete cap.native_options; delete cap.upload_apply; return new Response(JSON.stringify(cap)); }
 return answer;
};
const call = (name, args) => createDispatch({ ...w.ctx, sleep: async () => {}, env, gates: [], fetch: fetcher }).call(null, { registry, name, args, connection: w.connection, db: w.db });
let generation = 0, id;
async function open() {
 const out = parse(await call('github_git_workspace_open', { repo: 'hello', runtime: 'none', requestKey: 'open' }));
 expect(out.status, JSON.stringify(out)).toBe('applied'); id = out.result.workspace_id; generation = out.result.generation; return id;
}
let n = 0;
async function run(operation, options, extra = {}) {
 const out = parse(await call('github_git_workspace_run', { workspace_id: id, operation, expectedGeneration: generation, ...(options ? { options } : {}), requestKey: `k${n++}`, ...extra }));
 const next = out.result?.next_generation ?? out.details?.next_generation;
 if (Number.isSafeInteger(next)) generation = next;
 return out;
}
const write = (path, text) => run('write_file', { path, base64: Buffer.from(text).toString('base64') });

it('normalizes the spellings agents use and lists valid options when one is wrong', () => {
 expect(gitCommand('add', { paths: ['.'] })).toEqual(['add', '--all']);
 expect(gitCommand('add', { all: true })).toEqual(['add', '--all']);
 expect(normalizeNativeOptions('remove_file', { paths: ['a', 'b'] })).toEqual({ paths: ['a', 'b'] });
 expect(normalizeNativeOptions('remove_file', { paths: ['a'] })).toEqual({ path: 'a' });
 expect(gitCommand('fetch', { remote: 'origin', branch: 'origin/feature' })).toEqual(['fetch', '--no-recurse-submodules', 'origin', '+refs/heads/feature:refs/remotes/origin/feature']);
 expect(gitCommand('fetch', { branches: ['a', 'refs/heads/b'], prune: true })).toEqual(['fetch', '--no-recurse-submodules', '--prune', 'origin', '+refs/heads/a:refs/remotes/origin/a', '+refs/heads/b:refs/remotes/origin/b']);
 expect(gitCommand('merge', { branch: 'origin/main', noFastForward: true, message: 'Merge main' })).toEqual(['merge', '--no-edit', '--no-ff', '-m', 'Merge main', '--', 'origin/main']);
 expect(gitCommand('pull', { ref: 'main' })).toEqual(['pull', '--ff-only', '--no-recurse-submodules', 'origin', 'main']);
 expect(gitCommand('switch', { branch: 'new', create: true, from: 'origin/main' })).toEqual(['switch', '-c', 'new', 'origin/main']);
 expect(gitCommand('switch', { branch: 'existing' })).toEqual(['switch', 'existing']);
 expect(() => gitCommand('fetch', { remote: 'upstream' })).toThrow(/one remote, "origin"/);
 expect(() => gitCommand('merge', { into: 'x' })).toThrow(/Option into is not supported for merge\. Valid options: ref, branch, message, noFastForward, fastForwardOnly, worktree\./);
 expect(needsErgonomicWorker('fetch', normalizeNativeOptions('fetch', { branch: 'x' }))).toBe(false);
 expect(needsErgonomicWorker('add', normalizeNativeOptions('add', { paths: ['.'] }))).toBe(true);
 expect(nativeOperationHelp('remove_file')).toMatchObject({ required: ['path or paths'], example: { paths: ['old.txt', 'docs/old.md'] } });
 expect(porcelainPaths(' M a.txt\n?? "x\\303\\251.txt"\nR  old -> new\n')).toEqual(['a.txt', 'xé.txt', 'old', 'new']);
 expect(nextStep('switch', { status: 'rejected', stderr: "fatal: invalid reference: topic" }, { branch: 'topic' })).toMatch(/run fetch with options\.branch "topic".*create: true/);
});

it('add ".", remove several paths, top-level shortcuts, quiet replies and next_generation every time', async () => {
 await open();
 await write('new.txt', 'new\n');
 const removed = await run('remove_file', { paths: ['a.txt', 'b.txt'] });
 expect(removed, JSON.stringify(removed)).toMatchObject({ status: 'applied', result: { outcome: 'applied', removed: 2, next_generation: expect.any(Number) } });
 const added = parse(await call('github_git_workspace_run', { workspace_id: id, operation: 'add', expectedGeneration: generation, paths: ['.'], quiet: true, requestKey: 'add-all' }));
 expect(added, JSON.stringify(added)).toMatchObject({ status: 'applied', result: { operation: 'add', outcome: 'applied', branch: 'main', changed_paths: 3 } });
 expect(added.result.status).toBeUndefined(); expect(added.result.stdout).toBeUndefined();
 generation = added.result.next_generation;
 const committed = await run(undefined, undefined, { operation: 'commit', message: 'tidy', quiet: true });
 expect(committed, JSON.stringify(committed)).toMatchObject({ status: 'applied', result: { outcome: 'applied', changed_paths: 0 } });
 const pushed = await run('push', { branch: 'main', expectedHead: git(bare, 'rev-parse', 'main') });
 expect(pushed.result).toMatchObject({ outcome: 'applied', remote_verified: true });
 expect(git(bare, 'ls-tree', '--name-only', 'main').split('\n').sort()).toEqual(['file.txt', 'new.txt']);
 // Owner/repo on a workspace call are checked, not refused as unknown.
 const wrongRepo = parse(await call('github_git_workspace_run', { workspace_id: id, owner: 'example-org', repo: 'other', operation: 'add', expectedGeneration: generation, options: { all: true }, requestKey: 'wrong-repo' }));
 expect(wrongRepo).toMatchObject({ status: 'refused_by_guard', no_change_sent: true }); expect(wrongRepo.error).toMatch(/belongs to example-org\/hello/);
 const conflicting = parse(await call('github_git_workspace_run', { workspace_id: id, operation: 'add', expectedGeneration: generation, paths: ['a'], options: { paths: ['b'] } }));
 expect(conflicting).toMatchObject({ status: 'refused', no_change_sent: true }); expect(conflicting.error).toMatch(/both at the top level and in options/);
}, 60000);

it('a branch made on GitHub is fetched by name and switched to; a missing branch is a definite refusal with the next step', async () => {
 await open();
 const missing = await run('switch', { branch: 'made-on-github' });
 expect(missing, JSON.stringify(missing)).toMatchObject({ done: false, status: 'rejected', reason_code: 'provider_rejected', details: { outcome: 'rejected', operation: 'switch', next_generation: expect.any(Number) } });
 expect(missing.error).toMatch(/switch did not happen.*Next: The branch "made-on-github" does not exist.*fetch with options\.branch/);
 expect(JSON.stringify(missing)).not.toMatch(/UNCONFIRMED|unconfirmed/);
 // Someone makes the branch on GitHub (github_branch_create); fetch it by name, then switch.
 git(bare, 'branch', 'made-on-github', 'main');
 const fetched = await run('fetch', { branch: 'made-on-github', remote: 'origin' });
 expect(fetched, JSON.stringify(fetched)).toMatchObject({ status: 'applied' });
 const switched = await run('switch', { branch: 'made-on-github' });
 expect(switched, JSON.stringify(switched)).toMatchObject({ status: 'applied', result: { branch: 'made-on-github' } });
 // create-and-switch in one step
 const created = await run('switch', { branch: 'fresh-topic', create: true, from: 'origin/main' });
 expect(created, JSON.stringify(created)).toMatchObject({ status: 'applied', result: { branch: 'fresh-topic' } });
}, 60000);

it('a merge with real conflicts is a definite result listing the files and the next step, never unconfirmed', async () => {
 await open();
 await run('switch', { branch: 'topic', create: true });
 await write('file.txt', 'topic side\n'); await run('add', { all: true }); await run('commit', { message: 'topic' });
 const other = join(dir, 'other'); git(dir, 'clone', bare, other); git(other, 'config', 'user.name', 'O'); git(other, 'config', 'user.email', 'o@example.test');
 await writeFile(join(other, 'file.txt'), 'main side\n'); git(other, 'commit', '-am', 'main'); git(other, 'push', 'origin', 'main');
 await run('fetch', { branch: 'main' });
 const merged = await run('merge', { branch: 'origin/main' });
 expect(merged, JSON.stringify(merged)).toMatchObject({ done: true, status: 'applied', confirmed: true, result: { outcome: 'conflict', conflicts: ['file.txt'], in_progress: ['MERGE_HEAD'] } });
 expect(merged.result.next).toMatch(/merge stopped with conflicts in file\.txt.*merge_abort/);
 expect(merged.progress).toMatchObject({ outcome: 'conflict', conflicts: ['file.txt'] });
 const aborted = await run('merge_abort');
 expect(aborted.result.outcome).toBe('applied'); expect(aborted.result.in_progress).toBeUndefined(); expect(aborted.result.conflicts).toBeUndefined();
}, 60000);

it('a stale expectedGeneration says plainly that nothing changed and gives the generation to send', async () => {
 await open();
 await write('x.txt', 'x\n');
 const stale = parse(await call('github_git_workspace_run', { workspace_id: id, operation: 'add', expectedGeneration: 0, options: { paths: ['x.txt'] }, requestKey: 'stale' }));
 expect(stale, JSON.stringify(stale)).toMatchObject({ status: 'rejected', details: { next_generation: generation } });
 expect(stale.error).toMatch(/Stale expectedGeneration.*nothing was changed.*generation \d+.*new requestKey/);
 expect(stale.reason_code).not.toBe('write_outcome_uncertain');
}, 60000);

it('an older deployed worker: add all becomes explicit paths; options it cannot run are refused plainly before anything is sent', async () => {
 await open(); oldWorker = true;
 await write('one.txt', '1\n'); await write('two.txt', '2\n');
 const added = await run('add', { paths: ['.'] });
 expect(added, JSON.stringify(added)).toMatchObject({ status: 'applied' });
 expect(requests.filter(r => r.action === 'run' && r.operation === 'add').at(-1).options).toEqual({ paths: ['one.txt', 'two.txt'] });
 const removing = await run('remove_file', { paths: ['a.txt', 'b.txt'] });
 expect(removing).toMatchObject({ status: 'refused_by_guard', reason_code: 'native_worker_update_required', no_change_sent: true });
 expect(removing.error).toMatch(/must be updated.*Meanwhile: remove one path per call/);
 const fetched = await run('fetch', { branch: 'main' });
 expect(fetched).toMatchObject({ status: 'applied' });
 expect(requests.filter(r => r.action === 'run' && r.operation === 'fetch').at(-1).options).toEqual({});
}, 60000);

it('changed_files lists paths that differ from a ref, including untracked files', async () => {
 await open();
 await write('file.txt', 'changed\n'); await run('remove_file', { path: 'a.txt' }); await write('new/n.txt', 'n\n');
 const changed = parse(await call('github_git_workspace_read', { workspace_id: id, operation: 'changed_files', ref: 'origin/main' }));
 expect(changed, JSON.stringify(changed)).toMatchObject({ ref: 'origin/main', count: 3, complete: true });
 expect(changed.files).toEqual(expect.arrayContaining([{ status: 'M', path: 'file.txt' }, { status: 'D', path: 'a.txt' }, { status: '?', path: 'new/n.txt' }]));
}, 60000);

it('upload: begin ignores expectedGeneration; apply deletes listed files and mirror removes files the archive dropped', async () => {
 await open();
 const begin = parse(await call('github_git_workspace_upload', { workspace_id: id, operation: 'begin', mode: 'archive', expectedGeneration: generation, requestKey: 'up-1' }));
 expect(begin, JSON.stringify(begin)).toMatchObject({ status: 'applied', result: { upload_id: expect.stringMatching(/^upl_/) } });
 const misplaced = parse(await call('github_git_workspace_upload', { workspace_id: id, operation: 'begin', mode: 'archive', deletePaths: ['a.txt'], requestKey: 'up-x' }));
 expect(misplaced.error).toMatch(/deletePaths belongs to operation apply/);
 const src = join(dir, 'arch'); await mkdir(src); await writeFile(join(src, 'file.txt'), 'from archive\n'); await writeFile(join(src, 'b.txt'), 'b2\n');
 const sent = await fetch(relay.local(begin.result.url).replace('https://worker.example.test', origin), { method: 'PUT', body: execFileSync('tar', ['-czf', '-', '-C', src, '.']) });
 expect(sent.status).toBe(200);
 const applied = parse(await call('github_git_workspace_upload', { workspace_id: id, operation: 'apply', upload_id: begin.result.upload_id, expectedGeneration: generation, mirror: true, mode: 'archive', requestKey: 'up-2' }));
 expect(applied, JSON.stringify(applied)).toMatchObject({ status: 'applied', result: { files_changed: 2, files_deleted: 1, deleted_sample: ['a.txt'], next_generation: expect.any(Number) } });
 generation = applied.result.next_generation;
 const status = parse(await call('github_git_workspace_read', { workspace_id: id, operation: 'changed_files' }));
 expect(status.files).toEqual(expect.arrayContaining([{ status: 'D', path: 'a.txt' }, { status: 'M', path: 'file.txt' }, { status: 'M', path: 'b.txt' }]));
 // A stale generation on apply is plain too.
 const second = parse(await call('github_git_workspace_upload', { workspace_id: id, operation: 'begin', mode: 'archive', requestKey: 'up-3' }));
 const stale = parse(await call('github_git_workspace_upload', { workspace_id: id, operation: 'apply', upload_id: second.result.upload_id, expectedGeneration: 0, requestKey: 'up-4' }));
 expect(stale).toMatchObject({ status: 'rejected', details: { next_generation: generation } }); expect(stale.error).toMatch(/Stale expectedGeneration/);
}, 60000);

it('status reports the remote head beside the local one and names divergence (G12)', async () => {
 await open();
 const BRANCH = 'GET /repos/{owner}/{repo}/branches/{branch}';
 const localHead = git(bare, 'rev-parse', 'main');
 w.gh.when(BRANCH).reply(200, { name: 'main', commit: { sha: localHead } });
 const same = parse(await call('github_git_workspace_read', { workspace_id: id, operation: 'status' }));
 expect(same).toMatchObject({ state: 'ready', branch: 'main', head: localHead, remote: { branch: 'main', head: localHead, relation: 'same' } });
 expect(same.divergence_note).toBeUndefined();
 // GitHub's main advances (a squash lands there); the workspace still sits on the old local ref.
 const remoteHead = 'b'.repeat(40);
 w.gh.when(BRANCH).reply(200, { name: 'main', commit: { sha: remoteHead } });
 const diverged = parse(await call('github_git_workspace_read', { workspace_id: id, operation: 'status' }));
 expect(diverged).toMatchObject({ head: localHead, remote: { branch: 'main', head: remoteHead, relation: 'different' } });
 expect(diverged.divergence_note).toMatch(/stale|unpushed/);
 // A failed remote read never fails the status read; the relation is honestly unknown.
 w.gh.when(BRANCH).reply(404, { message: 'Not Found' });
 const unknown = parse(await call('github_git_workspace_read', { workspace_id: id, operation: 'status' }));
 expect(unknown).toMatchObject({ state: 'ready', head: localHead, remote: { branch: 'main', head: null, relation: 'unknown' } });
}, 60000);

it('a large archive well past the earlier 19.5 MB failure goes through the one-time relay address and applies', async () => {
 await open();
 const begin = parse(await call('github_git_workspace_upload', { workspace_id: id, operation: 'begin', mode: 'archive', maxMegabytes: 60, requestKey: 'big-1' }));
 const src = join(dir, 'big'); await mkdir(src);
 // Incompressible bytes, so the archive itself is about 30 MB.
 await writeFile(join(src, 'blob.bin'), execFileSync('head', ['-c', String(30 * 1024 * 1024), '/dev/urandom'], { maxBuffer: 40 * 1024 * 1024 }));
 const archive = execFileSync('tar', ['-czf', '-', '-C', src, '.'], { maxBuffer: 40 * 1024 * 1024 });
 expect(archive.length).toBeGreaterThan(30 * 1024 * 1024);
 const sent = await fetch(relay.local(begin.result.url).replace('https://worker.example.test', origin), { method: 'PUT', body: archive, headers: { 'content-length': String(archive.length) } });
 expect(sent.status, await sent.clone().text()).toBe(200);
 const applied = parse(await call('github_git_workspace_upload', { workspace_id: id, operation: 'apply', upload_id: begin.result.upload_id, expectedGeneration: generation, requestKey: 'big-2' }));
 expect(applied, JSON.stringify(applied)).toMatchObject({ status: 'applied', result: { files_added: 1 } });
}, 120000);
