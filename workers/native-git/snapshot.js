// Operator-only, authenticated encrypted full-workspace export/import. Never a chat byte-read bypass.
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { lstat, readFile, writeFile, readdir, mkdir, open, rm } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { NativeGitWorker } from './engine.js';
const MAX_BYTES = 100 * 1024 * 1024;
const ID = /^git_[a-f0-9]{32}$/;
const keyBytes = key => { const b = Buffer.from(key ?? '', 'base64'); if (b.length !== 32) throw new TypeError('Use a protected 32-byte base64 snapshot encryption key.'); return b; };
const validPath = p => typeof p === 'string' && p.length <= 4096 && !p.includes('\\') && !/[\x00-\x1f]/.test(p) && p.split('/').every(x => x && x !== '.' && x !== '..');
export async function exportWorkspace({ root, id, key }) {
 if (!ID.test(id)) throw new TypeError('Invalid workspace.'); const dir = join(resolve(root), id);
 if ((await lstat(dir)).isSymbolicLink()) throw new TypeError('Invalid workspace root.');
 const meta = JSON.parse(await readFile(join(dir, 'workspace.json'), 'utf8'));
 if (meta.state !== 'ready') throw new TypeError('Only stable initialized workspaces may be exported.');
 const lock = await open(join(dir, 'mutation.lock'), 'wx', 0o600); const files = []; let total = 0;
 try {
  const walk = async (base, prefix = '') => {
   for (const name of (await readdir(base)).sort()) {
    const path = prefix ? `${prefix}/${name}` : name; if (path === 'mutation.lock') continue;
    if (!validPath(path)) throw new TypeError('Unsupported snapshot path.');
    const stat = await lstat(join(base, name));
    if (stat.isSymbolicLink()) throw new TypeError('Snapshot contains a symlink; use an isolated filesystem snapshot that preserves it without dereferencing.');
    if (stat.isDirectory()) { files.push({ path, directory: true }); await walk(join(base, name), path); }
    else if (stat.isFile()) { total += stat.size; if (total > MAX_BYTES) throw new TypeError('Snapshot exceeds 100 MiB; use a volume snapshot outside chat.'); files.push({ path, mode: stat.mode & 0o777, base64: (await readFile(join(base, name))).toString('base64') }); }
    else throw new TypeError('Unsupported snapshot file type.');
   }
  };
  await walk(dir);
  const plain = Buffer.from(JSON.stringify({ version: 1, id, files }));
  const nonce = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', keyBytes(key), nonce); cipher.setAAD(Buffer.from('robinson-native-git-snapshot/v1'));
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([Buffer.from('RNG1'), nonce, cipher.getAuthTag(), encrypted]);
 } finally { await lock.close(); await rm(join(dir, 'mutation.lock'), { force: true }); }
}
export async function importWorkspace({ root, bytes, key }) {
 if (!Buffer.isBuffer(bytes) || bytes.length < 32 || bytes.length > 150 * 1024 * 1024 || bytes.subarray(0, 4).toString() !== 'RNG1') throw new TypeError('Invalid encrypted workspace snapshot.');
 const cipher = createDecipheriv('aes-256-gcm', keyBytes(key), bytes.subarray(4, 16)); cipher.setAAD(Buffer.from('robinson-native-git-snapshot/v1')); cipher.setAuthTag(bytes.subarray(16, 32));
 const payload = JSON.parse(Buffer.concat([cipher.update(bytes.subarray(32)), cipher.final()]).toString('utf8'));
 if (payload.version !== 1 || !ID.test(payload.id) || !Array.isArray(payload.files) || payload.files.length > 100000) throw new TypeError('Invalid snapshot manifest.');
 const names = new Set(); let size = 0;
 for (const f of payload.files) { if (!validPath(f.path) || names.has(f.path)) throw new TypeError('Invalid snapshot path.'); names.add(f.path); if (!f.directory) { if (typeof f.base64 !== 'string') throw new TypeError('Invalid snapshot file.'); size += Buffer.byteLength(f.base64, 'base64'); if (size > MAX_BYTES) throw new TypeError('Snapshot too large.'); } }
 await mkdir(resolve(root), { recursive: true, mode: 0o700 });
 const dir = join(resolve(root), payload.id); await mkdir(dir, { mode: 0o700 });
 try {
  for (const f of payload.files.filter(f => f.directory)) await mkdir(join(dir, f.path), { recursive: true, mode: 0o700 });
  for (const f of payload.files.filter(f => !f.directory)) { const path = join(dir, f.path); await mkdir(dirname(path), { recursive: true, mode: 0o700 }); await writeFile(path, Buffer.from(f.base64, 'base64'), { mode: (f.mode & 0o111) ? 0o700 : 0o600, flag: 'wx' }); }
  // Linked worktrees contain absolute Git metadata paths; repair them after moving hosts/roots.
  const treeRoot = join(dir, 'worktrees'); let trees = []; try { trees = await readdir(treeRoot); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (trees.length) { const worker = new NativeGitWorker({ root: resolve(root), authorize: async () => true }); await worker.git(join(dir, 'repo'), ['worktree', 'repair', '--', ...trees.map(t => join(treeRoot, t))]); }
  return { workspace_id: payload.id, files: payload.files.length, bytes: size, encrypted_sha256: createHash('sha256').update(bytes).digest('hex') };
 } catch (error) { await rm(dir, { recursive: true, force: true }); throw error; }
}
