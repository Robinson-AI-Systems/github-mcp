// Shared typed native Git surface; no provider or operating-system access.
import { containsCredential } from '../github/content-protection.js';
export const READ_OPERATIONS = ['protection_check', 'operation_result', 'status', 'log', 'show', 'diff', 'changed_files', 'blame', 'refs', 'conflicts', 'read_file', 'remote_refs', 'stash_list', 'worktree_list', 'bisect_log'];
// NATIVE-ERGO-1: operations/options a worker understands only once it reports native_options 'ergonomic-v1'.
export const NATIVE_OPTIONS_VERSION = 'ergonomic-v1';
export const WRITE_OPERATIONS = ['write_file', 'remove_file', 'branch_create', 'branch_delete', 'branch_rename', 'switch', 'tag_create', 'tag_delete', 'add', 'restore', 'commit', 'merge', 'merge_abort', 'rebase', 'rebase_continue', 'rebase_abort', 'cherry_pick', 'cherry_pick_continue', 'cherry_pick_abort', 'revert', 'revert_continue', 'revert_abort', 'reset', 'clean', 'stash_push', 'stash_pop', 'stash_drop', 'fetch', 'pull', 'push', 'worktree_add', 'worktree_remove', 'bisect_start', 'bisect_good', 'bisect_bad', 'bisect_reset'];
const sha = /^[a-f0-9]{40,64}$/;
export function value(input, max = 256) {
  if (typeof input !== 'string' || !input.length || input.length > max || /[\x00-\x1f\x7f]/.test(input) || containsCredential(input)) throw new TypeError('Invalid native Git argument.');
  return input;
}
export function ref(input, max = 256) {
  value(input, max);
  if (input.startsWith('-') || /[\s~^:?*\[\\]/.test(input) || input.includes('..') || input.includes('@{') || input.endsWith('/')) throw new TypeError('Use an exact reference or object ID.');
  return input;
}
export function switchBranch(options = {}) {
  const names = ['name', 'branch', ...(options.create ? [] : ['ref'])].filter(key => options[key] !== undefined).map(key => options[key]);
  if (!names.length) throw new TypeError('Switch requires options.branch (options.name or options.ref is also accepted).');
  if (names.some(name => name !== names[0])) throw new TypeError('Switch branch arguments disagree; supply one exact branch.');
  return ref(names[0]);
}
export function branchName(options = {}) {
  const names = [options.name, options.branch].filter(name => name !== undefined);
  if (!names.length) throw new TypeError('Supply options.name or options.branch for the branch name; options.ref selects the starting/old ref.');
  if (names.some(name => name !== names[0])) throw new TypeError('Branch name arguments disagree; supply one exact branch.');
  return ref(names[0]);
}
const OPTIONS = {
 protection_check: ['path'], operation_result: ['intentKey'], status: [], log: ['ref','max'], show: ['ref'], diff: ['ref','staged','paths','nameOnly'], changed_files: ['ref'], blame: ['ref','path'], refs: ['ref'], conflicts: [], remote_refs: ['ref'], read_file: ['path','byteOffset','byteLength','expectedFileHash'], stash_list: [], worktree_list: [], bisect_log: [],
 write_file: ['path','base64'], remove_file: ['path','paths'], branch_create: ['name','branch','ref'], branch_delete: ['name','branch','force'], branch_rename: ['name','branch','ref'], switch: ['name','branch','ref','create','from'], tag_create: ['name','ref'], tag_delete: ['name'], add: ['paths','all'], restore: ['paths','staged'], commit: ['message','amend'], merge: ['ref','branch','message','noFastForward','fastForwardOnly'], merge_abort: [], rebase: ['ref'], rebase_continue: [], rebase_abort: [], cherry_pick: ['ref'], cherry_pick_continue: [], cherry_pick_abort: [], revert: ['ref'], revert_continue: [], revert_abort: [], reset: ['ref','hard'], clean: ['paths'], stash_push: ['message'], stash_pop: [], stash_drop: [], fetch: ['branch','branches','ref','remote','prune','tags'], pull: ['branch','ref'], push: ['branch','ref','expectedHead','force','delete','tag'], worktree_add: ['name','ref'], worktree_remove: ['name'], bisect_start: ['good','bad'], bisect_good: ['ref'], bisect_bad: ['ref'], bisect_reset: []
};
// NATIVE-ERGO-1: the spellings agents naturally use, folded into one canonical shape before
// validation (by the control plane and again by the worker, so both agree on the intent).
const ADD_ALL = new Set(['.', '-A', '--all', ':/', '*']);
export function normalizeNativeOptions(operation, input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Native options must be an object.');
  const a = { ...input };
  const take = (from, to) => { if (a[from] === undefined) return; if (a[to] !== undefined && a[to] !== a[from]) throw new TypeError(`${from} and ${to} disagree for ${operation}; supply one.`); a[to] = a[from]; delete a[from]; };
  if (operation === 'add') {
    if (typeof a.paths === 'string') a.paths = [a.paths];
    if (Array.isArray(a.paths) && a.paths.some(p => ADD_ALL.has(p))) { if (a.paths.length !== 1) throw new TypeError('Use "." (or all: true) alone to add every change, or list exact paths.'); delete a.paths; a.all = true; }
    if (a.all === false) delete a.all;
  }
  if (operation === 'remove_file') {
    if (typeof a.paths === 'string') a.paths = [a.paths];
    if (a.path !== undefined && a.paths !== undefined) { a.paths = [...new Set([a.path, ...a.paths])]; delete a.path; }
    if (Array.isArray(a.paths) && a.paths.length === 1) { a.path = a.paths[0]; delete a.paths; }
  }
  if (operation === 'merge') take('branch', 'ref');
  if (operation === 'pull') take('ref', 'branch');
  if (operation === 'fetch') {
    if (a.remote !== undefined) { if (a.remote !== 'origin') throw new TypeError('Workspaces have one remote, "origin" (the GitHub repository); omit remote or use "origin".'); delete a.remote; }
    for (const key of ['branch', 'ref']) if (a[key] !== undefined) { a.branches = [...new Set([...(a.branches ?? []), a[key]])]; delete a[key]; }
    if (typeof a.branches === 'string') a.branches = [a.branches];
    if (Array.isArray(a.branches)) a.branches = a.branches.map(b => typeof b === 'string' ? b.replace(/^(?:refs\/heads\/|origin\/)/, '') : b);
  }
  if (operation === 'switch' && a.create) take('ref', 'from');
  return a;
}
/** True when these canonical options need a worker that reports native_options NATIVE_OPTIONS_VERSION. */
export function needsErgonomicWorker(operation, a = {}) {
  return operation === 'changed_files' || (operation === 'diff' && a.nameOnly !== undefined) || (operation === 'remove_file' && a.paths !== undefined) || (operation === 'add' && a.all === true)
    || (operation === 'switch' && (a.create !== undefined || a.from !== undefined)) || (operation === 'merge' && ['message', 'noFastForward', 'fastForwardOnly'].some(k => a[k] !== undefined))
    || (operation === 'fetch' && (a.prune !== undefined || a.tags !== undefined));
}
/** The same intent for an older worker: fetch then fetches all of origin (a superset of the named branches). */
export function olderWorkerOptions(operation, a = {}) {
  if (operation === 'fetch') { const { branches: _b, ...rest } = a; return rest; }
  return a;
}
export function allowedOptions(operation) { return OPTIONS[operation] ? [...OPTIONS[operation], 'worktree'] : null; }
export function gitCommand(operation, input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Native options must be an object.');
  if (containsCredential(JSON.stringify(input))) throw new TypeError('Credential-shaped native input belongs in protected setup, not tool arguments.');
  if (operation === 'write_file' && typeof input.base64 === 'string' && containsCredential(Buffer.from(input.base64, 'base64').toString('utf8'))) throw new TypeError('Credential-shaped file input belongs in protected setup, not tool arguments.');
  const allowed = OPTIONS[operation];
  if (!allowed) throw new TypeError('Unsupported typed native Git operation; use the documented local alternative.');
  const unknown = Object.keys(input).filter(key => key !== 'worktree' && !allowed.includes(key));
  if (unknown.length) throw new TypeError(`Option${unknown.length > 1 ? 's' : ''} ${unknown.slice(0, 5).join(', ')} ${unknown.length > 1 ? 'are' : 'is'} not supported for ${operation}. Valid options: ${allowed.length ? allowed.join(', ') + ', worktree' : 'none (besides worktree)'}.`);
  const a = normalizeNativeOptions(operation, input);
  for (const key of ['force','delete','tag','hard','staged','amend','all','create','nameOnly','prune','tags','noFastForward','fastForwardOnly']) if (a[key] !== undefined && typeof a[key] !== 'boolean') throw new TypeError(`Native flags must be booleans (${key} must be true or false).`);
  const paths = () => {
    if (!Array.isArray(a.paths) || !a.paths.length || a.paths.length > 100) throw new TypeError('Supply 1–100 exact workspace paths.');
    return a.paths.map(p => value(p, 4096));
  };
  const limit = () => { const n = a.max ?? 20; if (!Number.isSafeInteger(n) || n < 1 || n > 100) throw new TypeError('max must be 1–100.'); return String(n); };
  switch (operation) {
    case 'status': return ['status', '--porcelain=v1', '--untracked-files=all'];
    case 'log': return ['log', '--format=%H%x00%P%x00%an%x00%aI%x00%s', '-n', limit(), ref(a.ref ?? 'HEAD')];
    case 'show': return ['show', '--no-ext-diff', '--no-textconv', ref(a.ref ?? 'HEAD')];
    case 'diff': return ['diff', '--no-ext-diff', '--no-textconv', ...(a.nameOnly ? ['--name-status', '--no-renames'] : []), ...(a.staged ? ['--cached'] : []), ...(a.ref ? [ref(a.ref)] : []), '--', ...(a.paths ? paths() : [])];
    case 'blame': return ['blame', '--line-porcelain', ref(a.ref ?? 'HEAD'), '--', value(a.path, 4096)];
    case 'refs': return ['for-each-ref', '--format=%(refname)%00%(objectname)', ...(a.ref ? [ref(a.ref, 267)] : [])];
    case 'conflicts': return ['ls-files', '--unmerged'];
    case 'stash_list': return ['stash', 'list'];
    case 'worktree_list': return ['worktree', 'list', '--porcelain'];
    case 'bisect_log': return ['bisect', 'log'];
    case 'branch_create': return ['branch', '--', branchName(a), ref(a.ref ?? 'HEAD')];
    case 'branch_rename': return ['branch', '-m', ...(a.ref ? [ref(a.ref)] : []), branchName(a)];
    case 'branch_delete': return ['branch', a.force ? '-D' : '-d', '--', branchName(a)];
    // Without --no-guess, a branch that exists only as origin/<name> (made on GitHub, then fetched) is switched to and tracked.
    case 'switch': return a.create ? ['switch', '-c', switchBranch(a), ...(a.from !== undefined ? [ref(a.from)] : [])] : ['switch', switchBranch(a)];
    case 'tag_create': return ['tag', '--', ref(a.name), ref(a.ref ?? 'HEAD')];
    case 'tag_delete': return ['tag', '-d', '--', ref(a.name)];
    case 'add': if (a.all && a.paths !== undefined) throw new TypeError('Use all: true or paths, not both.'); return a.all ? ['add', '--all'] : ['add', '--', ...paths()];
    case 'restore': return ['restore', ...(a.staged ? ['--staged'] : []), '--', ...paths()];
    case 'commit': {
      if (typeof a.message !== 'string' || !a.message.length || a.message.length > 10000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(a.message)) throw new TypeError('Supply a commit message of at most 10000 characters.');
      return ['commit', '--no-gpg-sign', ...(a.amend ? ['--amend'] : []), '-m', a.message];
    }
    case 'merge': {
      if (a.noFastForward && a.fastForwardOnly) throw new TypeError('Choose noFastForward or fastForwardOnly, not both.');
      if (a.message !== undefined && (typeof a.message !== 'string' || !a.message.length || a.message.length > 10000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(a.message))) throw new TypeError('Supply a merge message of at most 10000 characters.');
      if (a.ref === undefined) throw new TypeError('Merge requires options.ref (or options.branch), for example origin/main.');
      return ['merge', '--no-edit', ...(a.noFastForward ? ['--no-ff'] : a.fastForwardOnly ? ['--ff-only'] : []), ...(a.message !== undefined ? ['-m', a.message] : []), '--', ref(a.ref)];
    }
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
    case 'fetch': {
      if (a.branches !== undefined && (!Array.isArray(a.branches) || !a.branches.length || a.branches.length > 20)) throw new TypeError('Supply 1–20 branch names to fetch, or none to fetch every branch.');
      const specs = (a.branches ?? []).map(b => `+refs/heads/${ref(b)}:refs/remotes/origin/${ref(b)}`);
      return ['fetch', '--no-recurse-submodules', ...(a.prune ? ['--prune'] : []), ...(a.tags === false ? ['--no-tags'] : a.tags ? ['--tags'] : []), 'origin', ...specs];
    }
    case 'pull': if (a.branch === undefined) throw new TypeError('Pull requires options.branch (the GitHub branch to fast-forward from).'); return ['pull', '--ff-only', '--no-recurse-submodules', 'origin', ref(a.branch)];
    case 'changed_files': return ['diff', '--name-status', '--no-renames', '--no-ext-diff', '--no-textconv', ref(a.ref ?? 'HEAD'), '--'];
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
    case 'remove_file': if (a.paths !== undefined) paths(); else value(a.path, 4096); return null;
    case 'protection_check': case 'operation_result': case 'read_file': case 'write_file': case 'remote_refs': case 'worktree_add': case 'worktree_remove': return null;
    default: throw new TypeError('Unsupported native operation. LFS, executable hooks/filters, submodules, signing and bisect run use the documented local Git setup.');
  }
}


export function nativeOperationHelp(operation) {
  if (!Object.hasOwn(OPTIONS, operation)) throw new TypeError('Unknown native operation; read capabilities for supported operation names.');
  const required = {branch_create:['name or branch'],branch_delete:['name or branch'],branch_rename:['name or branch'],switch:['name or branch or ref'],write_file:['path','base64'],remove_file:['path or paths'],add:['paths, or all: true'],restore:['paths'],commit:['message'],merge:['ref or branch'],rebase:['ref'],cherry_pick:['ref'],revert:['ref'],reset:['ref'],clean:['paths'],pull:['branch'],push:['branch'],worktree_add:['name'],worktree_remove:['name'],bisect_start:['good','bad'],read_file:['path'],protection_check:['path'],blame:['path'],operation_result:['intentKey']};
  const examples = {branch_create:{branch:'topic',ref:'HEAD'},switch:{branch:'topic'},branch_rename:{branch:'new-name',ref:'old-name'},branch_delete:{branch:'topic'},merge:{ref:'origin/main'},add:{all:true},remove_file:{paths:['old.txt','docs/old.md']},fetch:{branch:'feature'},changed_files:{ref:'origin/main'}};
  return {operation,allowed_options:[...OPTIONS[operation],'worktree'],required:required[operation]??[],...(examples[operation]?{example:examples[operation]}:{}),note:'Only listed options are accepted. branch_create does not switch branches; ref is its starting reference. switch with create: true makes and switches to a new branch (from = start point); switch to a branch made on GitHub after fetch with options.branch. Reads use workspace_id; mutations also require expectedGeneration. read_file uses explicit top-level byteLength. Keep one requestKey per intent.'};
}
