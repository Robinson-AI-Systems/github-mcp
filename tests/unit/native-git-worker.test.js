import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { NativeGitWorker, gitCommand } from '../../workers/native-git/engine.js';

let dir, bare, seed, worker, id, authorized;
const binding = { authority: 'tenant-authority-one', connection: 'connection-one', owner: 'example-org', repo: 'hello' };
const git = (cwd, ...args) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
let counter;
async function run(operation, args = {}, key) {
 const state = await worker.inspect(id, binding);
 return worker.execute(id, binding, { operation, args, requestKey: key ?? `intent-${++counter}`, expectedGeneration: state.generation });
}
const edit = (path, text) => run('write_file', { path, base64: Buffer.from(text).toString('base64') });
async function commit(text) { await run('add', { paths: ['file.txt'] }); return run('commit', { message: text }); }

beforeEach(async () => {
 dir = await mkdtemp(join(tmpdir(), 'native-git-')); seed = join(dir, 'seed'); bare = join(dir, 'remote.git');
 await mkdir(seed); git(seed, 'init', '-b', 'main'); git(seed, 'config', 'user.name', 'Fixture'); git(seed, 'config', 'user.email', 'fixture@example.test');
 await writeFile(join(seed, 'file.txt'), 'base\n'); git(seed, 'add', '--', 'file.txt'); git(seed, 'commit', '-m', 'base');
 git(dir, 'clone', '--bare', seed, bare); authorized = true; counter = 0;
 worker = new NativeGitWorker({ root: join(dir, 'worker'), authorize: async () => authorized, allowLocalFixtures: true });
 const opened = await worker.create(binding, { requestKey: 'open-one', fixtureRemote: bare });
 expect(opened.state).toBe('ready'); id = opened.workspace_id;
});
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe('native Git through actual local bare repositories', () => {
 it('clones, edits binary bytes, stages, commits, pushes and independently verifies the remote', async () => {
  const bytes = Buffer.from([0, 255, 1, 128, 2]);
  expect((await run('write_file', { path: 'asset.bin', base64: bytes.toString('base64') })).status).toBe('applied');
  const read = await run('read_file', { path: 'asset.bin', byteLength: 2 });
  expect(Buffer.from(read.content_base64, 'base64')).toEqual(bytes.subarray(0, 2));
  await run('add', { paths: ['asset.bin'] });
  const saved = await run('commit', { message: 'add binary' }); expect(saved.status).toBe('applied');
  const prior = git(bare, 'rev-parse', 'refs/heads/main');
  const pushed = await run('push', { branch: 'main', expectedHead: prior });
  expect(pushed).toMatchObject({ status: 'applied', remote_verified: true, remote_head: saved.head });
  expect(git(bare, 'rev-parse', 'refs/heads/main')).toBe(saved.head);
  expect((await run('log')).stdout).toContain('add binary');
 });
 it('replays a finished immutable intent without a second commit and refuses changed intent or stale generation', async () => {
  await edit('file.txt', 'change\n'); await run('add', { paths: ['file.txt'] });
  const first = await run('commit', { message: 'once' }, 'same-key');
  const second = await run('commit', { message: 'once' }, 'same-key');
  expect(second).toMatchObject({ replayed: true, head: first.head });
  await expect(run('commit', { message: 'different' }, 'same-key')).rejects.toThrow(/different input/);
  await expect(worker.execute(id, binding, { operation: 'branch_create', args: { name: 'stale' }, requestKey: 'stale', expectedGeneration: 0 })).rejects.toThrow(/generation/);
 });
 it('denies another tenant/connection, revoked access, metadata paths and symlink traversal', async () => {
  await expect(worker.inspect(id, { ...binding, authority: 'other-tenant' })).rejects.toThrow(/another connection/);
  await expect(worker.inspect(id, { ...binding, connection: 'other-client' })).rejects.toThrow(/another connection/);
  authorized = false; await expect(worker.inspect(id, binding)).rejects.toThrow(/authorization/); authorized = true;
  for (const path of ['../outside', '.git/config', '/etc/passwd', 'a/../../b', 'a\\b']) await expect(run('write_file', { path, base64: 'eA==' })).rejects.toThrow(/workspace|metadata/);
  await symlink(dir, join(dir, 'worker', id, 'repo', 'escape'));
  await expect(run('read_file', { path: 'escape/seed/file.txt' })).rejects.toThrow(/Symlink/);
 });
 it('preserves real merge conflict state, accepts a resolution and makes the merge commit', async () => {
  await run('branch_create', { name: 'topic' }); await run('switch', { name: 'topic' });
  await edit('file.txt', 'topic\n'); await commit('topic'); await run('switch', { name: 'main' });
  await edit('file.txt', 'main\n'); await commit('main');
  const conflict = await run('merge', { ref: 'topic' });
  expect(conflict.status).toBe('conflict'); expect(conflict.conflicts).toContain('file.txt'); expect(conflict.in_progress).toContain('MERGE_HEAD');
  expect((await run('conflicts')).stdout).toContain('file.txt');
  await edit('file.txt', 'resolved\n'); const merged = await commit('resolve');
  expect(merged.status).toBe('applied'); expect(merged.in_progress).not.toContain('MERGE_HEAD');
  expect(git(join(dir, 'worker', id, 'repo'), 'rev-list', '--parents', '-1', 'HEAD').split(' ')).toHaveLength(3);
 });
 it('aborts merge conflicts, stashes/restores edits, creates tags and uses detached worktrees', async () => {
  await edit('file.txt', 'saved change\n'); expect((await run('stash_push')).status).toBe('applied');
  expect((await run('read_file', { path: 'file.txt' })).content_base64).toBe(Buffer.from('base\n').toString('base64'));
  expect((await run('stash_list')).stdout).toContain('MCP workspace stash'); await run('stash_pop');
  expect((await run('diff')).stdout).toContain('saved change'); await run('restore', { paths: ['file.txt'] });
  expect((await run('tag_create', { name: 'v1' })).status).toBe('applied');
  expect((await run('worktree_add', { name: 'analysis' })).status).toBe('applied');
  expect((await run('worktree_list')).stdout).toContain('analysis');
  expect((await run('worktree_remove', { name: 'analysis' })).status).toBe('applied');
 });
 it('does not implicitly force-push when only an expected head is selected', async () => {
  expect(gitCommand('push', { branch: 'main', expectedHead: 'a'.repeat(40) })).toContain('--force-with-lease=refs/heads/main:' + 'a'.repeat(40));
  expect(() => gitCommand('push', { branch: 'main', force: true })).toThrow(/lease/);
  const before = git(bare, 'rev-parse', 'main');
  const out = await run('push', { branch: 'main', expectedHead: 'a'.repeat(40) });
  expect(out.status).not.toBe('applied'); expect(git(bare, 'rev-parse', 'main')).toBe(before);
 });
 it('contains credentials in native output and refuses their byte reconstruction across windows', async () => {
  const candidate = 'rtc_pass_' + 'a'.repeat(43);
  // Fixture creation outside the tool mirrors an already committed remote secret.
  await writeFile(join(dir, 'worker', id, 'repo', 'sensitive.txt'), candidate);
  await expect(run('read_file', { path: 'sensitive.txt', byteOffset: 2, byteLength: 4 })).rejects.toThrow(/content protection/);
  const diagnostic = await run('protection_check', { path: 'sensitive.txt' }); expect(diagnostic.total_findings).toBe(1); expect(diagnostic.matched_values_returned).toBe(false); expect(JSON.stringify(diagnostic)).not.toContain(candidate);
  const rejected = await run('write_file', { path: 'new.txt', base64: Buffer.from(candidate).toString('base64') }).catch(e => e);
  expect(rejected).toBeInstanceOf(TypeError); expect(String(rejected)).not.toContain(candidate);
  await expect(readFile(join(dir, 'worker', id, 'repo', 'new.txt'))).rejects.toThrow();
  await expect(run('commit', { message: candidate })).rejects.toThrow(/protected setup/);
 });
 it('survives worker replacement, never repeats an uncertain receipt and disposes only the owned workspace', async () => {
  await edit('file.txt', 'durable\n'); const before = await worker.inspect(id, binding);
  worker = new NativeGitWorker({ root: join(dir, 'worker'), authorize: async () => true, allowLocalFixtures: true });
  expect(await worker.inspect(id, binding)).toMatchObject({ generation: before.generation });
  expect((await run('read_file', { path: 'file.txt' })).content_base64).toBe(Buffer.from('durable\n').toString('base64'));
  expect(await worker.close(id, binding)).toEqual({ disposed: true });
  expect(await readFile(join(seed, 'file.txt'), 'utf8')).toBe('base\n');
 });
});

it('rebase conflict survives inspection and continues after explicit resolution', async () => {
 await run('branch_create', { name: 'topic' }); await run('switch', { name: 'topic' }); await edit('file.txt', 'topic\n'); await commit('topic');
 await run('switch', { name: 'main' }); await edit('file.txt', 'main\n'); await commit('main'); await run('switch', { name: 'topic' });
 const conflict = await run('rebase', { ref: 'main' }); expect(conflict.status).toBe('conflict'); expect(conflict.in_progress).toContain('rebase-merge');
 await edit('file.txt', 'resolved\n'); await run('add', { paths: ['file.txt'] });
 const continued = await run('rebase_continue'); expect(continued.status).toBe('applied'); expect(continued.in_progress).not.toContain('rebase-merge');
});
it('cherry-picks, reverts, resets, cleans and performs manual bisect with real Git', async () => {
 const base = (await worker.inspect(id, binding)).head;
 await run('branch_create', { name: 'topic' }); await run('switch', { name: 'topic' }); await edit('file.txt', 'topic\n'); const topic = await commit('topic');
 await run('switch', { name: 'main' }); const picked = await run('cherry_pick', { ref: topic.head }); expect(picked.status).toBe('applied');
 expect((await run('revert', { ref: picked.head })).status).toBe('applied');
 expect((await run('read_file', { path: 'file.txt' })).content_base64).toBe(Buffer.from('base\n').toString('base64'));
 const top = (await worker.inspect(id, binding)).head;
 expect((await run('bisect_start', { good: base, bad: top })).status).toBe('applied');
 expect((await run('bisect_bad')).status).toBe('applied'); expect((await run('bisect_reset')).status).toBe('applied');
 expect((await run('reset', { ref: base, hard: true })).status).toBe('applied');
 await edit('untracked.txt', 'remove me'); expect((await run('clean', { paths: ['untracked.txt'] })).status).toBe('applied');
 expect((await worker.inspect(id, binding)).status).toBe('');
});
it('requires immutable file hashes for continuation and contains real hook execution', async () => {
 const first = await run('read_file', { path: 'file.txt', byteLength: 2 });
 await expect(run('read_file', { path: 'file.txt', byteOffset: 2, byteLength: 2 })).rejects.toThrow(/hash/);
 expect((await run('read_file', { path: 'file.txt', byteOffset: 2, byteLength: 2, expectedFileHash: first.file_hash })).byte_length).toBe(2);
 await edit('file.txt', 'new\n'); await expect(run('read_file', { path: 'file.txt', byteOffset: 2, expectedFileHash: first.file_hash })).rejects.toThrow(/hash/);
 const marker = join(dir, 'hook-executed');
 await writeFile(join(dir, 'worker', id, 'repo', '.git', 'hooks', 'pre-commit'), `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o755 });
 expect((await commit('safe commit\n\nSecond paragraph')).status).toBe('applied');
 await expect(readFile(marker)).rejects.toThrow();
});
it('retains an uncertain interrupted receipt without repeating it and serializes concurrent mutations', async () => {
 const key = 'interrupted-request';
 const { createHash } = await import('node:crypto'); const hash = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
 const args = { name: 'should-not-exist' };
 await writeFile(join(dir, 'worker', id, 'intent-' + hash(key) + '.json'), JSON.stringify({ intent: hash({ operation: 'branch_create', args }), state: 'sending' }));
 expect(await run('branch_create', args, key)).toMatchObject({ status: 'uncertain', replayed: true });
 expect((await run('refs')).stdout).not.toContain('should-not-exist');
 const generation = (await worker.inspect(id, binding)).generation;
 const results = await Promise.allSettled(['a', 'b'].map(name => worker.execute(id, binding, { operation: 'branch_create', args: { name }, requestKey: name, expectedGeneration: generation })));
 expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1); expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);
});

it('returns durable historical operation receipts and cleans only expired unlocked workspaces', async () => {
 const result = await run('branch_create', { name: 'receipt-branch' }, 'receipt-key');
 const kept = await run('operation_result', { intentKey: 'receipt-key' }); expect(kept).toMatchObject({ historical: true, result: { status: 'applied', head: result.head } });
 const expired = new NativeGitWorker({ root: join(dir, 'worker'), authorize: async () => true, now: () => Date.now() + 2 * 86400000 });
 expect(await expired.prune({ skip: new Set([id]) })).toEqual({ removed: 0 });
 expect(await expired.prune()).toEqual({ removed: 1 });
 expect(await readFile(join(seed, 'file.txt'), 'utf8')).toBe('base\n');
});

it('uses atomic expected-head leases while refusing non-fast-forward changes unless force was explicitly selected', async () => {
 const base = (await worker.inspect(id, binding)).head;
 await edit('file.txt', 'new\n'); const newer = await commit('new'); expect((await run('push', { branch: 'main', expectedHead: base })).status).toBe('applied');
 await run('reset', { ref: base, hard: true });
 const denied = await run('push', { branch: 'main', expectedHead: newer.head }); expect(denied.status).not.toBe('applied'); expect(git(bare, 'rev-parse', 'main')).toBe(newer.head);
 const forced = await run('push', { branch: 'main', expectedHead: newer.head, force: true }); expect(forced).toMatchObject({ status: 'applied', remote_verified: true, remote_head: base });
 await expect(run('reset', { ref: base, hard: 'false' })).rejects.toThrow(/booleans/);
 await expect(run('push', { branch: 'main', hard: true })).rejects.toThrow(/not supported/);
});
