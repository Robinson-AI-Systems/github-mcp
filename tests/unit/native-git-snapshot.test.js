import { it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { NativeGitWorker } from '../../workers/native-git/engine.js';
import { exportWorkspace, importWorkspace } from '../../workers/native-git/snapshot.js';
it('moves encrypted complete state to another root and resumes edits and a detached worktree', async () => {
 const dir = await mkdtemp(join(tmpdir(), 'native-backup-')); const seed = join(dir, 'seed');
 const binding = { authority: 'fixture-one', connection: 'connection-one', owner: 'example-org', repo: 'hello' };
 const git = (...a) => execFileSync('git', a, { cwd: seed, encoding: 'utf8', stdio: 'pipe' });
 try {
  await mkdir(seed); git('init', '-b', 'main'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.test'); await writeFile(join(seed, 'file.txt'), 'base\n'); git('add', 'file.txt'); git('commit', '-m', 'base');
  let worker = new NativeGitWorker({ root: join(dir, 'first'), authorize: async () => true, allowLocalFixtures: true });
  const { workspace_id: id } = await worker.create(binding, { fixtureRemote: seed, requestKey: 'open' }); let n = 0;
  const run = async (operation, args = {}) => worker.execute(id, binding, { operation, args, requestKey: 'op-' + ++n, expectedGeneration: (await worker.inspect(id, binding)).generation });
  await run('write_file', { path: 'file.txt', base64: Buffer.from('uncommitted\n').toString('base64') });
  await run('worktree_add', { name: 'analysis' });
  const key = Buffer.alloc(32, 7).toString('base64'); const bytes = await exportWorkspace({ root: join(dir, 'first'), id, key });
  expect(bytes.toString('utf8')).not.toContain('uncommitted');
  const corrupt = Buffer.from(bytes); corrupt[corrupt.length - 1] ^= 1;
  await expect(importWorkspace({ root: join(dir, 'bad'), bytes: corrupt, key })).rejects.toThrow();
  const imported = await importWorkspace({ root: join(dir, 'second'), bytes, key }); expect(imported.workspace_id).toBe(id);
  await expect(importWorkspace({ root: join(dir, 'second'), bytes, key })).rejects.toThrow();
  worker = new NativeGitWorker({ root: join(dir, 'second'), authorize: async () => true, allowLocalFixtures: true });
  expect((await run('read_file', { path: 'file.txt' })).content_base64).toBe(Buffer.from('uncommitted\n').toString('base64'));
  const tree = await run('write_file', { path: 'tree.txt', base64: 'eA==', worktree: 'analysis' }); expect(tree.status).toBe('applied');
  expect((await run('read_file', { path: 'tree.txt', worktree: 'analysis' })).content_base64).toBe('eA==');
  expect(await readFile(join(dir, 'second', id, 'worktrees', 'analysis', 'tree.txt'), 'utf8')).toBe('x');
 } finally { await rm(dir, { recursive: true, force: true }); }
});
