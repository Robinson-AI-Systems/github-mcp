// Shared typed native Git surface; no provider or operating-system access.
import { containsCredential } from '../github/content-protection.js';
export const READ_OPERATIONS = ['protection_check', 'operation_result', 'status', 'log', 'show', 'diff', 'blame', 'refs', 'conflicts', 'read_file', 'remote_refs', 'stash_list', 'worktree_list', 'bisect_log'];
export const WRITE_OPERATIONS = ['write_file', 'remove_file', 'branch_create', 'branch_delete', 'branch_rename', 'switch', 'tag_create', 'tag_delete', 'add', 'restore', 'commit', 'merge', 'merge_abort', 'rebase', 'rebase_continue', 'rebase_abort', 'cherry_pick', 'cherry_pick_continue', 'cherry_pick_abort', 'revert', 'revert_continue', 'revert_abort', 'reset', 'clean', 'stash_push', 'stash_pop', 'stash_drop', 'fetch', 'pull', 'push', 'worktree_add', 'worktree_remove', 'bisect_start', 'bisect_good', 'bisect_bad', 'bisect_reset'];
const sha = /^[a-f0-9]{40,64}$/;
export function value(input, max = 256) {
  if (typeof input !== 'string' || !input.length || input.length > max || /[\x00-\x1f\x7f]/.test(input) || containsCredential(input)) throw new TypeError('Invalid native Git argument.');
  return input;
}
export function ref(input) {
  value(input);
  if (input.startsWith('-') || /[\s~^:?*\[\\]/.test(input) || input.includes('..') || input.includes('@{') || input.endsWith('/')) throw new TypeError('Use an exact reference or object ID.');
  return input;
}
const OPTIONS = {
 protection_check: ['path'], operation_result: ['intentKey'], status: [], log: ['ref','max'], show: ['ref'], diff: ['ref','staged','paths'], blame: ['ref','path'], refs: ['ref'], conflicts: [], remote_refs: ['ref'], read_file: ['path','byteOffset','byteLength','expectedFileHash'], stash_list: [], worktree_list: [], bisect_log: [],
 write_file: ['path','base64'], remove_file: ['path'], branch_create: ['name','ref'], branch_delete: ['name','force'], branch_rename: ['name','ref'], switch: ['name'], tag_create: ['name','ref'], tag_delete: ['name'], add: ['paths'], restore: ['paths','staged'], commit: ['message','amend'], merge: ['ref'], merge_abort: [], rebase: ['ref'], rebase_continue: [], rebase_abort: [], cherry_pick: ['ref'], cherry_pick_continue: [], cherry_pick_abort: [], revert: ['ref'], revert_continue: [], revert_abort: [], reset: ['ref','hard'], clean: ['paths'], stash_push: ['message'], stash_pop: [], stash_drop: [], fetch: [], pull: ['branch'], push: ['branch','ref','expectedHead','force','delete','tag'], worktree_add: ['name','ref'], worktree_remove: ['name'], bisect_start: ['good','bad'], bisect_good: ['ref'], bisect_bad: ['ref'], bisect_reset: []
};
export function gitCommand(operation, a = {}) {
  if (!a || typeof a !== 'object' || Array.isArray(a)) throw new TypeError('Native options must be an object.');
  if (containsCredential(JSON.stringify(a))) throw new TypeError('Credential-shaped native input belongs in protected setup, not tool arguments.');
  if (operation === 'write_file' && typeof a.base64 === 'string' && containsCredential(Buffer.from(a.base64, 'base64').toString('utf8'))) throw new TypeError('Credential-shaped file input belongs in protected setup, not tool arguments.');
  const allowed = OPTIONS[operation];
  if (!allowed) throw new TypeError('Unsupported typed native Git operation; use the documented local alternative.');
  for (const key of Object.keys(a)) if (key !== 'worktree' && !allowed.includes(key)) throw new TypeError(`Option is not supported for ${operation}; inspect the native operation guidance.`);
  for (const key of ['force','delete','tag','hard','staged','amend']) if (a[key] !== undefined && typeof a[key] !== 'boolean') throw new TypeError('Native flags must be booleans.');
  const paths = () => {
    if (!Array.isArray(a.paths) || !a.paths.length || a.paths.length > 100) throw new TypeError('Supply 1–100 exact workspace paths.');
    return a.paths.map(p => value(p, 4096));
  };
  const limit = () => { const n = a.max ?? 20; if (!Number.isSafeInteger(n) || n < 1 || n > 100) throw new TypeError('max must be 1–100.'); return String(n); };
  switch (operation) {
    case 'status': return ['status', '--porcelain=v1', '--untracked-files=all'];
    case 'log': return ['log', '--format=%H%x00%P%x00%an%x00%aI%x00%s', '-n', limit(), ref(a.ref ?? 'HEAD')];
    case 'show': return ['show', '--no-ext-diff', '--no-textconv', ref(a.ref ?? 'HEAD')];
    case 'diff': return ['diff', '--no-ext-diff', '--no-textconv', ...(a.staged ? ['--cached'] : []), ...(a.ref ? [ref(a.ref)] : []), '--', ...(a.paths ? paths() : [])];
    case 'blame': return ['blame', '--line-porcelain', ref(a.ref ?? 'HEAD'), '--', value(a.path, 4096)];
    case 'refs': return ['for-each-ref', '--format=%(refname)%00%(objectname)', ...(a.ref ? [ref(a.ref)] : [])];
    case 'conflicts': return ['ls-files', '--unmerged'];
    case 'stash_list': return ['stash', 'list'];
    case 'worktree_list': return ['worktree', 'list', '--porcelain'];
    case 'bisect_log': return ['bisect', 'log'];
    case 'branch_create': return ['branch', '--', ref(a.name), ref(a.ref ?? 'HEAD')];
    case 'branch_rename': return ['branch', '-m', ...(a.ref ? [ref(a.ref)] : []), ref(a.name)];
    case 'branch_delete': return ['branch', a.force ? '-D' : '-d', '--', ref(a.name)];
    case 'switch': return ['switch', ref(a.name)];
    case 'tag_create': return ['tag', '--', ref(a.name), ref(a.ref ?? 'HEAD')];
    case 'tag_delete': return ['tag', '-d', '--', ref(a.name)];
    case 'add': return ['add', '--', ...paths()];
    case 'restore': return ['restore', ...(a.staged ? ['--staged'] : []), '--', ...paths()];
    case 'commit': {
      if (typeof a.message !== 'string' || !a.message.length || a.message.length > 10000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(a.message)) throw new TypeError('Supply a commit message of at most 10000 characters.');
      return ['commit', '--no-gpg-sign', ...(a.amend ? ['--amend'] : []), '-m', a.message];
    }
    case 'merge': return ['merge', '--no-edit', '--', ref(a.ref)];
    case 'merge_abort': return ['merge', '--abort'];
    case 'rebase': return ['rebase', ref(a.ref)];
    case 'rebase_continue': return ['rebase', '--continue'];
    case 'rebase_abort': return ['rebase', '--abort'];
    case 'cherry_pick': return ['cherry-pick', ref(a.ref)];
    case 'cherry_pick_continue': return ['cherry-pick', '--continue'];
    case 'cherry_pick_abort': return ['cherry-pick', '--abort'];
    case 'revert': return ['revert', '--no-edit', ref(a.ref)];
    case 'revert_continue': return ['revert', '--continue'];
    case 'revert_abort': return ['revert', '--abort'];
    case 'reset': return ['reset', a.hard ? '--hard' : '--mixed', ref(a.ref), '--'];
    case 'clean': return ['clean', '-fd', '--', ...paths()];
    case 'stash_push': return ['stash', 'push', '--include-untracked', '-m', value(a.message ?? 'MCP workspace stash', 200)];
    case 'stash_pop': return ['stash', 'pop'];
    case 'stash_drop': return ['stash', 'drop'];
    case 'fetch': return ['fetch', '--no-recurse-submodules', 'origin'];
    case 'pull': return ['pull', '--ff-only', '--no-recurse-submodules', 'origin', ref(a.branch)];
    case 'push': {
      if (a.expectedHead !== undefined && a.expectedHead !== '' && !sha.test(a.expectedHead)) throw new TypeError('expectedHead must be an exact object ID, or empty for an absent reference.');
      if (a.delete && a.ref !== undefined) throw new TypeError('A deleted remote ref cannot also select source content.');
      if (a.force && a.expectedHead === undefined) throw new TypeError('A forced push needs an explicit expectedHead lease.');
      const dest = a.tag ? 'tags' : 'heads';
      // Every selected expected head is atomic. The engine separately verifies fast-forward eligibility unless force was explicit.
      return ['push', ...(a.expectedHead !== undefined ? [`--force-with-lease=refs/${dest}/${ref(a.branch)}:${a.expectedHead}`] : []), 'origin', `${a.delete ? '' : ref(a.ref ?? 'HEAD')}:refs/${dest}/${ref(a.branch)}`];
    }
    case 'bisect_start': return ['bisect', 'start', ref(a.bad), ref(a.good)];
    case 'bisect_good': return ['bisect', 'good', ref(a.ref ?? 'HEAD')];
    case 'bisect_bad': return ['bisect', 'bad', ref(a.ref ?? 'HEAD')];
    case 'bisect_reset': return ['bisect', 'reset'];
    case 'protection_check': case 'operation_result': case 'read_file': case 'write_file': case 'remove_file': case 'remote_refs': case 'worktree_add': case 'worktree_remove': return null;
    default: throw new TypeError('Unsupported native operation. LFS, executable hooks/filters, submodules, signing and bisect run use the documented local Git setup.');
  }
}

