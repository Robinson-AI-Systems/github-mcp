// FLEET-6 lean attachment. Instead of copying a workspace's whole Git history,
// copy only what GitHub does not already have: refs, index, config, a bundle of
// local-only commits/stash/staged blobs, and changed or untracked files. The
// receiving broker fetches everything else from GitHub itself. Removes the 100 MiB
// limit for ordinary workspaces; only uncommitted bytes still count toward it.
import {readdir, readFile, writeFile, rm, mkdir, lstat, rename} from 'node:fs/promises';
import {join, resolve, dirname} from 'node:path';
import {NativeGitWorker} from './engine.js';

const IN_PROGRESS = ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'BISECT_LOG'];
const SHA = /^[a-f0-9]{40}$/;
const split0 = s => s.split('\0').filter(Boolean);
const exists = async p => { try { await lstat(p); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } };

// Returns null when the workspace is not eligible (callers fall back to a full copy).
// Must run while the caller holds the workspace mutation lock.
export async function planLeanExport(dir, {allowLocalFixtures = false} = {}) {
  const repo = join(dir, 'repo'), gitDir = join(repo, '.git');
  if (await exists(join(gitDir, 'shallow'))) return null;
  try { if ((await readdir(join(dir, 'worktrees'))).length) return null; } catch (e) { if (e.code !== 'ENOENT') throw e; }
  for (const name of IN_PROGRESS) if (await exists(join(gitDir, name))) return null;
  const git = new NativeGitWorker({root: resolve(dirname(dir)), authorize: async () => true, allowLocalFixtures});
  const run = (args, codes) => git.git(repo, args, codes ? {allowedCodes: codes} : {});
  const remotes = [...new Set((await run(['for-each-ref', '--format=%(objectname)', 'refs/remotes'])).stdout.split('\n').map(s => s.trim()).filter(s => SHA.test(s)))];
  if (!remotes.length || remotes.length > 500) return null;
  // Staged-but-uncommitted blobs live only in the object store: carry them in the
  // bundle through a temporary ref that is removed before the files are copied.
  const tree = (await run(['write-tree'])).stdout.trim();
  const indexCommit = (await run(['commit-tree', tree, '-m', 'robinson-lean-index'])).stdout.trim();
  const bundlePath = join(dir, 'lean.bundle');
  let bundle = false;
  try {
    await run(['update-ref', 'refs/robinson/lean-index', indexCommit]);
    const made = await run(['bundle', 'create', bundlePath, '--all', '--not', '--remotes'], [0, 128]);
    bundle = made.code === 0 && await exists(bundlePath);
  } finally { await run(['update-ref', '-d', 'refs/robinson/lean-index'], [0, 1]); }
  if (!bundle) await rm(bundlePath, {force: true});
  const tracked = new Set(split0((await run(['ls-files', '-z'])).stdout));
  const changed = new Set(split0((await run(['diff-files', '--name-only', '-z'])).stdout));
  const deleted = split0((await run(['ls-files', '-z', '--deleted'])).stdout);
  const skip = new Set([...tracked].filter(p => !changed.has(p)).map(p => 'repo/' + p));
  const plan = {version: 1, fetch: remotes, bundle, deleted};
  await writeFile(join(dir, 'lean.json'), JSON.stringify(plan), {mode: 0o600});
  return {plan, skip};
}
export async function cleanLeanExport(dir) { await rm(join(dir, 'lean.bundle'), {force: true}); await rm(join(dir, 'lean.json'), {force: true}); }

// Receiver side, after the .git metadata and non-repository files are written and
// BEFORE changed/untracked working files are written.
export async function completeLeanImport(dir, {plan, token, remote, timeoutMs = 900000, allowLocalFixtures = false}) {
  const repo = join(dir, 'repo'), gitDir = join(repo, '.git');
  if (plan?.version !== 1 || !Array.isArray(plan.fetch) || !plan.fetch.every(s => SHA.test(s)) || !Array.isArray(plan.deleted)) throw new TypeError('Invalid lean attachment plan.');
  await mkdir(join(gitDir, 'objects', 'pack'), {recursive: true, mode: 0o700});
  await mkdir(join(gitDir, 'objects', 'info'), {recursive: true, mode: 0o700});
  const git = new NativeGitWorker({root: resolve(dirname(dir)), authorize: async () => true, allowLocalFixtures});
  // The copied refs point at local commits that are not present yet, which a fetch
  // into the repository would reject. Fetch and unbundle into a scratch bare repo on
  // the same volume, then move its objects in.
  const scratch = join(gitDir, 'robinson-lean-fetch.git');
  await rm(scratch, {recursive: true, force: true});
  await git.git(gitDir, ['init', '--bare', '--quiet', scratch]);
  try {
    // Fetch by exact commit in batches; GitHub serves any reachable commit by SHA.
    for (let i = 0; i < plan.fetch.length; i += 50)
      await git.git(scratch, ['fetch', '--no-tags', '--no-write-fetch-head', '--', remote, ...plan.fetch.slice(i, i + 50)], {token, remote, timeoutMs});
    if (plan.bundle) await git.git(scratch, ['bundle', 'unbundle', join(dir, 'lean.bundle')], {timeoutMs});
    await moveObjects(join(scratch, 'objects'), join(gitDir, 'objects'));
  } finally { await rm(scratch, {recursive: true, force: true}); }
  await git.git(repo, ['checkout-index', '-a', '-f'], {timeoutMs});
  return git;
}
async function moveObjects(from, to) {
  for (const entry of await readdir(from)) {
    if (entry === 'info') continue;
    const src = join(from, entry), dst = join(to, entry);
    if ((await lstat(src)).isDirectory()) { await mkdir(dst, {recursive: true, mode: 0o700}); for (const f of await readdir(src)) await rename(join(src, f), join(dst, f)).catch(e => { if (e.code !== 'EEXIST') throw e; }); }
  }
}
export async function finishLeanImport(dir, git, plan) {
  const repo = join(dir, 'repo');
  for (const p of plan.deleted) { const path = join(repo, p); if (!path.startsWith(repo + '/')) throw new TypeError('Invalid deleted path.'); await rm(path, {force: true}); }
  // Every object any ref, the index or the stash needs must now be present.
  await git.git(repo, ['rev-list', '--objects', '--all', '--quiet'], {timeoutMs: 900000});
  await git.git(repo, ['status', '--porcelain=v1'], {timeoutMs: 900000});
  await cleanLeanExport(dir);
}
export const readLeanPlan = async dir => JSON.parse(await readFile(join(dir, 'lean.json'), 'utf8'));
