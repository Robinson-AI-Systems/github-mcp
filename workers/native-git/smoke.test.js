// Dependency-free image acceptance; real Git, no provider token, outside unit catalog.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { NativeGitWorker } from './engine.js';
import {createResourceMonitor} from './resources.js';
import { exportWorkspace, importWorkspace } from './snapshot.js';
test('packaged image clones, commits, pushes, verifies and restores native Git state as non-root', async () => {
 const dir = await mkdtemp(join(tmpdir(), 'native-image-')); const seed = join(dir, 'seed'), bare = join(dir, 'remote.git');
 const git = (...a) => execFileSync('git', a, { cwd: seed, stdio: 'pipe' });
 try {
  await mkdir(seed); git('init', '-b', 'main'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.test'); await writeFile(join(seed, 'file.txt'), 'base\n'); git('add', 'file.txt'); git('commit', '-m', 'base'); git('clone', '--bare', seed, bare);
  const binding = { authority: 'image-fixture', connection: 'image-connection', owner: 'example-org', repo: 'hello' }; const root = join(dir, 'storage');
  const worker = new NativeGitWorker({ root, authorize: async () => true, allowLocalFixtures: true });
  const opened = await worker.create(binding, { requestKey: 'image-open', fixtureRemote: bare }); assert.equal(opened.state, 'ready');
  const lease=await worker.touch(opened.workspace_id,binding,4*60*60000); assert.equal(lease.idle_timeout_ms,4*60*60000); assert.equal(lease.expires_at,lease.last_activity_at+4*60*60000); let generation = 0;
  for (const [operation, args] of [['write_file', { path: 'binary.dat', base64: 'AP8B' }], ['add', { paths: ['binary.dat'] }], ['commit', { message: 'image commit' }], ['push', { branch: 'main' }]]) {
   const result = await worker.execute(opened.workspace_id, binding, { operation, args, requestKey: operation, expectedGeneration: generation++ }); assert.equal(result.status, 'applied'); if (operation === 'push') assert.equal(result.remote_verified, true);
  }
  const key = Buffer.alloc(32, 3).toString('base64'); const bytes = await exportWorkspace({ root, id: opened.workspace_id, key });
  const restored = await importWorkspace({ root: join(dir, 'restored'), bytes, key }); assert.equal(restored.workspace_id, opened.workspace_id);
  assert.notEqual(process.getuid?.(), 0, 'the packaged smoke test must run as the unprivileged image user');
 } finally { await rm(dir, { recursive: true, force: true }); }
});

test('packaged image samples available process memory and writable filesystem without a request-count cap',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'native-resource-image-'));
 const monitor=createResourceMonitor({root:dir});
 try{assert.equal(monitor.body(1024).allowed,true);assert.deepEqual(await monitor.check(),{allowed:true});assert.equal(Object.hasOwn(monitor.policy,'maxConcurrent'),false);}
 finally{monitor.close();await rm(dir,{recursive:true,force:true});}
});
