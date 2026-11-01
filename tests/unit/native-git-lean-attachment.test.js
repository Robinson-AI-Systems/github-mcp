import {it, expect} from 'vitest';
import {mkdtemp, mkdir, writeFile, readFile, rm, access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {NativeGitWorker} from '../../workers/native-git/engine.js';
import {attachmentRequest} from '../../workers/native-git/attachment.js';

const binding = {authority: 'fixture', connection: 'fixture', owner: 'example-org', repo: 'hello'};
const b64 = s => Buffer.from(s).toString('base64');

it('lean attachment sends only what GitHub lacks and rebuilds the exact workspace on the broker', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lean-')), seed = join(root, 'seed'); await mkdir(seed);
  const git = (cwd, ...args) => execFileSync('git', args, {cwd, stdio: 'pipe', encoding: 'utf8'}).trim();
  try {
    git(seed, 'init', '-b', 'main'); git(seed, 'config', 'user.name', 'F'); git(seed, 'config', 'user.email', 'f@example.test');
    // A large committed history the broker should fetch itself rather than receive.
    await writeFile(join(seed, 'big.bin'), Buffer.alloc(3 * 1024 * 1024, 9)); await writeFile(join(seed, 'keep.txt'), 'keep\n'); await writeFile(join(seed, 'gone.txt'), 'gone\n');
    git(seed, 'add', '.'); git(seed, 'commit', '-m', 'base');
    const source = new NativeGitWorker({root: join(root, 'source'), authorize: async () => true, allowLocalFixtures: true});
    const target = new NativeGitWorker({root: join(root, 'target'), authorize: async () => true, allowLocalFixtures: true});
    const {workspace_id: id} = await source.create(binding, {fixtureRemote: seed, requestKey: 'open'});
    const repo = join(root, 'source', id, 'repo'), sg = (...a) => git(repo, ...a);
    // Local-only state: an unpushed commit, a stash, a staged new file, a modified and a deleted tracked file, an untracked file.
    await writeFile(join(repo, 'local.txt'), 'local commit\n'); sg('add', 'local.txt'); sg('commit', '-m', 'local only');
    await writeFile(join(repo, 'keep.txt'), 'stashed\n'); sg('stash');
    await writeFile(join(repo, 'staged.txt'), 'staged only\n'); sg('add', 'staged.txt');
    await writeFile(join(repo, 'keep.txt'), 'modified\n'); await rm(join(repo, 'gone.txt'));
    await writeFile(join(repo, 'untracked.txt'), 'untracked\n');
    const before = await source.inspect(id, binding);
    const key = Buffer.alloc(32, 7).toString('base64'), transferId = 'b'.repeat(64);
    const invoke = (worker, action, options, extra = {}) => attachmentRequest(worker, {action, binding, workspace_id: id, allowWrite: true, options, ...extra}, {singleWorkspaceId: worker === target ? id : undefined});
    const exported = await invoke(source, 'attachment_export', {mode: 'prepare', key, transferId, expectedGeneration: before.generation, lean: true});
    expect(exported.lean).toBe(true);
    expect(exported.bytes).toBeLessThan(1024 * 1024); // the 3 MiB file is not copied
    await expect(access(join(root, 'source', id, 'lean.json'))).rejects.toThrow(); // export cleans up after itself
    await invoke(target, 'attachment_import', {mode: 'begin', transferId, bytes: exported.bytes, digest: exported.digest});
    let offset = 0;
    while (offset < exported.bytes) { const page = await invoke(source, 'attachment_export', {mode: 'read', transferId, offset}); offset = (await invoke(target, 'attachment_import', {mode: 'append', transferId, offset, base64: page.base64})).offset; }
    await invoke(source, 'attachment_export', {mode: 'freeze', transferId});
    await expect(invoke(target, 'attachment_import', {mode: 'finish', transferId, key})).rejects.toThrow(/network authorization/);
    const imported = await invoke(target, 'attachment_import', {mode: 'finish', transferId, key}, {credential: 'ghs_FAKEshortlived'});
    expect(imported.complete).toBe(true);
    const after = await target.inspect(id, binding);
    expect(after.head).toBe(before.head); expect(after.status).toBe(before.status); expect(after.generation).toBe(before.generation);
    const tr = join(root, 'target', id, 'repo'), tg = (...a) => git(tr, ...a);
    expect((await readFile(join(tr, 'big.bin'))).length).toBe(3 * 1024 * 1024);
    expect(await readFile(join(tr, 'keep.txt'), 'utf8')).toBe('modified\n');
    expect(await readFile(join(tr, 'untracked.txt'), 'utf8')).toBe('untracked\n');
    await expect(access(join(tr, 'gone.txt'))).rejects.toThrow();
    expect(tg('show', ':staged.txt')).toBe('staged only');
    expect(tg('log', '-1', '--format=%s')).toBe('local only');
    expect(tg('stash', 'list')).toMatch(/stash@\{0\}/);
    expect(tg('show', 'stash@{0}:keep.txt')).toBe('stashed');
    tg('fsck', '--connectivity-only');
    expect((await invoke(target, 'attachment_import', {mode: 'finish', transferId, key}, {credential: 'ghs_FAKEshortlived'})).replayed).toBe(true);
  } finally { await rm(root, {recursive: true, force: true}); }
});

it('falls back to a full copy when the workspace is shallow or mid-operation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lean-fallback-')), seed = join(root, 'seed'); await mkdir(seed);
  const git = (cwd, ...args) => execFileSync('git', args, {cwd, stdio: 'pipe', encoding: 'utf8'}).trim();
  try {
    git(seed, 'init', '-b', 'main'); git(seed, 'config', 'user.name', 'F'); git(seed, 'config', 'user.email', 'f@example.test');
    await writeFile(join(seed, 'a.txt'), 'a\n'); git(seed, 'add', '.'); git(seed, 'commit', '-m', 'a');
    await writeFile(join(seed, 'a.txt'), 'b\n'); git(seed, 'commit', '-am', 'b');
    const source = new NativeGitWorker({root: join(root, 'source'), authorize: async () => true, allowLocalFixtures: true});
    const {workspace_id: id} = await source.create(binding, {fixtureRemote: 'file://' + seed, requestKey: 'open-shallow', depth: 1});
    const state = await source.inspect(id, binding);
    const exported = await attachmentRequest(source, {action: 'attachment_export', binding, workspace_id: id, allowWrite: true, options: {mode: 'prepare', key: Buffer.alloc(32, 1).toString('base64'), transferId: 'c'.repeat(64), expectedGeneration: state.generation, lean: true}}, {});
    expect(exported.lean).toBe(false);
    expect(b64('x')).toBe('eA==');
  } finally { await rm(root, {recursive: true, force: true}); }
});
