import {readWorkspaceFile,writeWorkspaceFile,removeWorkspaceFile} from './safe-files.js';
import {evaluateFileProtection,findingFingerprint} from '../../src/github/file-protection.js';
import {defaultScannerSettings} from '../../src/github/scanner-policy.js';
// Portable execution plane: fixed argv, no shell, hooks, filters or caller-supplied config.
import { spawn } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { mkdir, readFile, rename, open, rm, realpath, lstat, readdir } from 'node:fs/promises';
import { resolve, join, dirname, isAbsolute } from 'node:path';
import { READ_OPERATIONS, gitCommand, ref, value } from '../../src/native-git/commands.js';
export { READ_OPERATIONS, WRITE_OPERATIONS, gitCommand } from '../../src/native-git/commands.js';
import { nativeWorkspaceId } from '../../src/native-git/protocol.js';
import { containsCredential, redact, activeProtectionReport, withProtectionContext, withRepositoryProtection } from '../../src/github/content-protection.js';

const ID = /^git_[a-f0-9]{32}$/;
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const bindingHash = binding => hash(['authority', 'connection', 'owner', 'repo'].map(k => value(binding?.[k])));
async function save(path, data) {
  const temp = path + '.' + randomBytes(8).toString('hex');
  const handle = await open(temp, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(data)); await handle.sync(); } finally { await handle.close(); }
  await rename(temp, path);
  const directory = await open(dirname(path), 'r'); try { await directory.sync(); } finally { await directory.close(); }
}

export class NativeGitWorker {
  constructor({ root, authorize, credential, allowLocalFixtures = false, timeoutMs = 45000, maxOutputBytes = 2 * 1024 * 1024, now = Date.now, scannerPolicy={settings:defaultScannerSettings(),revision:0} } = {}) {
    if (!isAbsolute(root ?? '') || typeof authorize !== 'function') throw new TypeError('Isolated absolute storage and an authorization callback are required.');
    Object.assign(this, { root: resolve(root), authorize, credential, allowLocalFixtures, timeoutMs, maxOutputBytes, now, scannerPolicy });
  }
  async access(binding, write) {
    bindingHash(binding);
    if (await this.authorize(binding, { write }) !== true) throw new TypeError('Current workspace authorization is not valid.');
  }
  async git(cwd, args, { token, remote, allowedCodes = [0] } = {}) {
    const env = { PATH: process.env.PATH, HOME: this.root, LANG: 'C.UTF-8', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true', GIT_SEQUENCE_EDITOR: 'true', GIT_ATTR_NOSYSTEM: '1', GIT_LFS_SKIP_SMUDGE: '1', GIT_LITERAL_PATHSPECS: '1', GIT_OPTIONAL_LOCKS: '0' };
    let encoded;
    if (token) {
      encoded = Buffer.from('x-access-token:' + token).toString('base64');
      Object.assign(env, { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: `http.${remote}.extraheader`, GIT_CONFIG_VALUE_0: 'Authorization: Basic ' + encoded });
    }
    const prefix = ['--no-pager', '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'credential.helper=', '-c', 'http.followRedirects=false', '-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always', '-c', 'submodule.recurse=false', '-c', 'gc.auto=0', '-c', 'commit.gpgSign=false', '-c', 'tag.gpgSign=false', '-c', 'core.attributesFile=/dev/null', '-c', 'core.fsync=committed', '-c', 'pack.threads=1', '-c', 'pack.windowMemory=64m'];
    if (this.allowLocalFixtures) prefix.push('-c', 'protocol.file.allow=always');
    const result = await new Promise((accept, reject) => {
      const child = spawn('git', [...prefix, ...args], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
      const out = [], err = []; let bytes = 0, problem;
      const kill = reason => { problem ??= reason; try { process.kill(-child.pid, 'SIGKILL'); } catch { /* ended */ } };
      const timer = setTimeout(() => kill('Git timed out; inspect the workspace and remote before another intent.'), this.timeoutMs);
      const collect = target => chunk => { bytes += chunk.length; if (bytes > this.maxOutputBytes) kill('Complete output exceeds the worker limit; narrow the query or use byte windows.'); else target.push(chunk); };
      child.stdout.on('data', collect(out)); child.stderr.on('data', collect(err));
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.on('close', code => { clearTimeout(timer); problem ? reject(new Error(problem)) : accept({ untrusted: true, code, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8') }); });
    });
    for (const secret of [token, encoded].filter(Boolean)) for (const k of ['stdout', 'stderr']) result[k] = result[k].split(secret).join('[hidden]');
    for (const k of ['stdout', 'stderr']) { const safe = redact(result[k]); if (safe !== result[k]) result.content_exact = false; result[k] = safe; }
    if (!allowedCodes.includes(result.code)) throw Object.assign(new Error('Native Git refused the operation.'), { gitResult: result });
    return result;
  }
  async workspace(id, binding, write = false, allowExpired = false) {
    if (!ID.test(id ?? '')) throw new TypeError('Invalid workspace ID.');
    await this.access(binding, write);
    const dir = join(this.root, id);
    if (await realpath(dir) !== dir) throw new TypeError('Workspace storage must not be a symlink.');
    const meta = await json(join(dir, 'workspace.json'));
    if (meta.binding !== bindingHash(binding)) throw new TypeError('Workspace belongs to another connection.');
    if (!allowExpired && meta.expiresAt <= this.now()) throw new TypeError('Workspace idle timeout expired. Open a separate workspace with a fresh intent.');
    return { dir, repo: join(dir, 'repo'), meta };
  }
  async create(binding, { requestKey, fixtureRemote, branch, depth, ttlMs = 14400000, authorName = 'Robinson Git workspace', authorEmail = 'workspace@users.noreply.github.com' } = {}) {
    await this.access(binding, false); value(requestKey, 128); value(authorName, 100); value(authorEmail, 254);
    const { owner, repo } = binding;
    if (!/^[A-Za-z0-9-]{1,39}$/.test(owner) || !/^[A-Za-z0-9_.-]{1,100}$/.test(repo) || ['.', '..'].includes(repo)) throw new TypeError('Invalid GitHub remote identity.');
    if (fixtureRemote && !this.allowLocalFixtures) throw new TypeError('Local fixture remotes are disabled.');
    if (depth !== undefined && (!Number.isSafeInteger(depth) || depth < 1 || depth > 100000)) throw new TypeError('Invalid shallow clone depth.');
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 60000 || ttlMs > 7 * 86400000) throw new TypeError('Workspace lease must be one minute to seven days.');
    const id = nativeWorkspaceId(binding, requestKey), dir = join(this.root, id);
    const createIntent = hash({ branch, depth, ttlMs, authorName, authorEmail });
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    if (await realpath(this.root) !== this.root) throw new TypeError('Worker storage root must not be a symlink.');
    try { await mkdir(dir, { mode: 0o700 }); } catch (e) { if (e.code !== 'EEXIST') throw e; const prior = await this.workspace(id, binding); if (prior.meta.createIntent !== createIntent) throw new TypeError('Clone request key belongs to different input.'); return { workspace_id: id, replayed: true, ...await this.inspect(id, binding) }; }
    const remote = fixtureRemote ?? `https://github.com/${owner}/${repo}.git`;
    await save(join(dir, 'workspace.json'), { binding: bindingHash(binding), createIntent, remote, generation: 0, idleTimeoutMs: ttlMs, lastActivityAt: this.now(), expiresAt: this.now() + ttlMs, state: 'opening' });
    try {
      const token = fixtureRemote ? null : await this.credential?.(binding, { write: false });
      await this.git(dir, ['clone', '--no-recurse-submodules', ...(branch ? ['--branch', ref(branch)] : []), ...(depth ? ['--depth', String(depth)] : []), '--', remote, 'repo'], { token, remote });
      await this.git(join(dir, 'repo'), ['config', '--local', 'user.name', value(authorName, 100)]);
      await this.git(join(dir, 'repo'), ['config', '--local', 'user.email', value(authorEmail, 254)]);
      const meta = await json(join(dir, 'workspace.json')); meta.state = 'ready'; await save(join(dir, 'workspace.json'), meta);
      return { workspace_id: id, ...await this.inspect(id, binding) };
    } catch { return { workspace_id: id, state: 'uncertain', next: 'Inspect the workspace. An interrupted clone is not replayed automatically; dispose it and create a new intent if incomplete.' }; }
  }
  async touch(id, binding, idleTimeoutMs, { admitted = false } = {}) {
    if (!Number.isSafeInteger(idleTimeoutMs) || idleTimeoutMs < 60000 || idleTimeoutMs > 86400000) throw new TypeError('Invalid workspace idle timeout.');
    const w = await this.workspace(id, binding, false, admitted);
    let lock;
    try { lock = await open(join(w.dir, 'mutation.lock'), 'wx', 0o600); } catch (error) { if (error.code === 'EEXIST') throw new TypeError('Workspace is leased; inspect current state. Interrupted locks require operator recovery.'); throw error; }
    try {
      const meta = await json(join(w.dir, 'workspace.json'));
      if (!admitted && meta.expiresAt <= this.now()) throw new TypeError('Workspace idle timeout expired; open a separate workspace with a fresh intent.');
      if (meta.idleTimeoutMs !== undefined && meta.idleTimeoutMs !== idleTimeoutMs) throw new TypeError('Workspace idle timeout differs from its original lease.');
      meta.idleTimeoutMs = idleTimeoutMs; meta.lastActivityAt = this.now(); meta.expiresAt = meta.lastActivityAt + idleTimeoutMs;
      await save(join(w.dir, 'workspace.json'), meta);
      return { idle_timeout_ms: idleTimeoutMs, last_activity_at: meta.lastActivityAt, expires_at: meta.expiresAt };
    } finally { await lock.close(); await rm(join(w.dir, 'mutation.lock'), { force: true }); }
  }
  async inspectMetadata(id, binding) {
    const { meta } = await this.workspace(id, binding, false, true);
    return { state: meta.state, generation: meta.generation, expires_at: meta.expiresAt };
  }
  async inspect(id, binding, worktree) {
    const w = await this.workspace(id, binding);
    await this.selectWorktree(w, worktree);
    if (w.meta.state !== 'ready') return { state: w.meta.state, generation: w.meta.generation, expires_at: w.meta.expiresAt, next: 'Incomplete initialization; dispose this workspace before opening with a new request key.' };
    const head = await this.git(w.repo, ['rev-parse', '--verify', 'HEAD'], { allowedCodes: [0, 128] });
    const branch = await this.git(w.repo, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { allowedCodes: [0, 1] });
    const status = await this.git(w.repo, ['status', '--porcelain=v1', '--untracked-files=all']);
    const conflicts = await this.git(w.repo, ['diff', '--name-only', '--diff-filter=U']);
    const inProgress = [];
    for (const name of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'BISECT_LOG']) {
      const location = (await this.git(w.repo, ['rev-parse', '--git-path', name])).stdout.trim();
      try { await lstat(resolve(w.repo, location)); inProgress.push(name); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    }
    return { state: 'ready', generation: w.meta.generation, branch: branch.code === 0 ? branch.stdout.trim() : null, head: head.code === 0 ? head.stdout.trim() : null, status: status.stdout, conflicts: conflicts.stdout.split('\n').filter(Boolean), in_progress: inProgress, expires_at: w.meta.expiresAt };
  }
  async selectWorktree(w, name) {
    if (name === undefined) return;
    if (!/^[a-zA-Z0-9_-]{1,60}$/.test(name)) throw new TypeError('Invalid worktree identifier.');
    const root = w.repo, path = join(w.dir, 'worktrees', name);
    if (await realpath(path) !== path) throw new TypeError('Worktree is not isolated.');
    const common = (await this.git(path, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).stdout.trim();
    if (common !== join(root, '.git')) throw new TypeError('Worktree belongs to a different repository.');
    w.repo = path;
  }
  async filePath(repo, path) {
    value(path, 4096);
    const parts = path.split('/');
    if (isAbsolute(path) || path.includes('\\') || parts.some(p => !p || p === '.' || p === '..' || p.toLowerCase() === '.git') || path.includes(':')) throw new TypeError('Use a relative workspace file outside Git metadata.');
    let parent = repo;
    for (const part of parts) { parent = join(parent, part); try { if ((await lstat(parent)).isSymbolicLink()) throw new TypeError('Symlink file access is refused.'); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
    return join(repo, path);
  }
  async remoteRefs(w, token, selected) {
    const actual = (await this.git(w.repo, ['remote', 'get-url', 'origin'])).stdout.trim();
    if (actual !== w.meta.remote) throw new TypeError('Remote identity changed.');
    const result = await this.git(w.repo, ['ls-remote', '--refs', '--', w.meta.remote, ...(selected ? [ref(selected)] : [])], { token, remote: w.meta.remote });
    return Object.fromEntries(result.stdout.trim().split('\n').filter(Boolean).map(line => { const [id, name] = line.split('\t'); return [name, id]; }));
  }
  async execute(id,binding,options={}){return withProtectionContext(()=>withRepositoryProtection(this.scannerPolicy.settings.additionalRules.filter(r=>!this.scannerPolicy.settings.disabledRules.includes(r.id)),()=>this.executeScoped(id,binding,options)));}
  async executeScoped(id, binding, { operation, args = {}, requestKey, expectedGeneration } = {}) {
    gitCommand(operation, args); const writing = !READ_OPERATIONS.includes(operation);
    const w = await this.workspace(id, binding, writing);
    await this.selectWorktree(w, args.worktree);
    if (w.meta.state !== 'ready') throw new TypeError('Workspace is not ready; inspect or dispose it.');
    for (const p of [...(args.paths ?? []), ...(args.path && !operation.startsWith('worktree_') ? [args.path] : [])]) await this.filePath(w.repo, p);
    if (!writing && operation === 'operation_result') {
      value(args.intentKey, 128);
      const record = await json(join(w.dir, 'intent-' + hash(args.intentKey) + '.json'));
      return { historical: true, observed_at: record.finished_at ?? null, result: record.result ?? { status: 'uncertain', next: 'Intent was started without a verified receipt. Inspect workspace and remote refs before a new intent.' } };
    }
    if (!writing && ['read_file', 'protection_check'].includes(operation)) {
      const data = await readWorkspaceFile(w.repo,args.path);
      if (data.length > 20 * 1024 * 1024) throw new TypeError('File exceeds the worker read limit; use the documented local Git export.');
      const source=data.toString('utf8'),blobSha=createHash('sha1').update(Buffer.from(`blob ${data.length}\0`)).update(data).digest('hex');
      const specific=data.length<=1000000&&this.scannerPolicy.settings.suppressions.some(s=>s.fileReadException&&s.path===args.path&&s.blobSha===blobSha);
      const assessed=specific?evaluateFileProtection({source,path:args.path,sha:blobSha,settings:this.scannerPolicy.settings,revision:this.scannerPolicy.revision}):null;
      if(operation==='protection_check'){
        const report=assessed?.report??activeProtectionReport(source);
        return {path:args.path,blob_sha:blobSha,file_hash:createHash('sha256').update(data).digest('hex'),...report,policy_revision:this.scannerPolicy.revision,
          findings:report.findings.map(f=>({...f,fingerprint:f.fingerprint??findingFingerprint(blobSha,f.rule,f.byte_offset,f.byte_length)})),
          next:'Use value-free fingerprints and repository-scoped scanner settings. Committed pinned samples verify changes; changed bytes never inherit a file-read exception.'};
      }
      if(assessed?!assessed.report.byte_exact_available:containsCredential(source))throw new TypeError('Byte retrieval blocked by content protection; use github_git_workspace_read operation=protection_check with this path for value-free rule locations.');
      const offset = args.byteOffset ?? 0, length = args.byteLength ?? 32768;
      const fileHash = createHash('sha256').update(data).digest('hex');
      if ((offset > 0 || args.expectedFileHash !== undefined) && args.expectedFileHash !== fileHash) throw new TypeError('File hash changed or is missing for continuation; restart from byte offset zero.');
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > data.length || !Number.isSafeInteger(length) || length < 1 || length > 32768) throw new TypeError('Invalid byte window.');
      return { file_hash: fileHash, encoding: 'base64', content_base64: data.subarray(offset, offset + length).toString('base64'), byte_offset: offset, byte_length: data.subarray(offset, offset + length).length, total_bytes: data.length, next_byte_offset: Math.min(data.length, offset + length), complete: offset + length >= data.length };
    }
    if (!writing && operation === 'remote_refs') return { refs: await this.remoteRefs(w, this.allowLocalFixtures ? null : await this.credential?.(binding, { write: false }), args.ref) };
    if (!writing) return this.git(w.repo, gitCommand(operation, args), { allowedCodes: [0, 1] });
    value(requestKey, 128);
    const receipt = join(w.dir, 'intent-' + hash(requestKey) + '.json'), intent = hash({ operation, args });
    let lock;
    try { lock = await open(join(w.dir, 'mutation.lock'), 'wx', 0o600); } catch (e) { if (e.code === 'EEXIST') throw new TypeError('Workspace is leased. Inspect current state; interrupted leases require explicit operator recovery, never automatic write replay.'); throw e; }
    try {
      const current = await json(join(w.dir, 'workspace.json'));
      try { const old = await json(receipt); if (old.intent !== intent) throw new TypeError('Request key already belongs to different input.'); return { ...(old.result ?? { status: 'uncertain', next: 'Inspect local and remote state before a new intent.' }), replayed: true }; } catch (e) { if (e.code !== 'ENOENT') throw e; }
      if (expectedGeneration !== current.generation) throw new TypeError('Workspace generation changed; inspect before another mutation.');
      await save(receipt, { intent, state: 'sending' });
      let result;
      try {
        if (operation === 'write_file') {
          if (typeof args.base64 !== 'string' || args.base64.length > 1400000 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(args.base64)) throw new TypeError('Supply canonical base64 of at most 1 MiB.');
          const bytes = Buffer.from(args.base64, 'base64'); if (containsCredential(bytes.toString('utf8'))) throw new TypeError('Credential-shaped file input belongs in protected setup, not tool arguments.');
          await writeWorkspaceFile(w.repo,args.path,bytes);
          if (!(await readWorkspaceFile(w.repo,args.path)).equals(bytes)) throw new Error('File readback differed.');
          result = { code: 0, file_hash: createHash('sha256').update(bytes).digest('hex') };
        } else if (operation === 'remove_file') { await removeWorkspaceFile(w.repo,args.path); result = { code: 0 }; }
        else if (operation.startsWith('worktree_')) {
          if (!/^[a-zA-Z0-9_-]{1,60}$/.test(args.name ?? '')) throw new TypeError('Worktree name must be a simple local identifier.');
          const path = join(w.dir, 'worktrees', args.name); await mkdir(dirname(path), { recursive: true });
          result = await this.git(w.repo, operation === 'worktree_add' ? ['worktree', 'add', '--detach', '--', path, ref(args.ref ?? 'HEAD')] : ['worktree', 'remove', '--', path]);
        } else {
          const network = ['fetch', 'pull', 'push'].includes(operation);
          const token = network && !this.allowLocalFixtures ? await this.credential?.(binding, { write: operation === 'push' }) : null;
          let expectedRemote, destination;
          if (network) {
            const actual = (await this.git(w.repo, ['remote', 'get-url', 'origin'])).stdout.trim(); if (actual !== current.remote) throw new TypeError('Remote identity changed.');
            if (operation === 'push') { destination = `refs/${args.tag ? 'tags' : 'heads'}/${ref(args.branch)}`; const refs = await this.remoteRefs(w, token, destination); if (args.expectedHead !== undefined && (refs[destination] ?? '') !== args.expectedHead) throw new TypeError('Expected remote head changed; nothing pushed.'); expectedRemote = args.delete ? null : (await this.git(w.repo, ['rev-parse', '--verify', `${ref(args.ref ?? 'HEAD')}^{object}`])).stdout.trim();
            if (args.expectedHead && !args.force && !args.delete) {
              if (args.tag && expectedRemote !== args.expectedHead) throw new TypeError('Updating an existing tag requires explicit force and its expected-head lease.');
              if (!args.tag && (await this.git(w.repo, ['merge-base', '--is-ancestor', args.expectedHead, expectedRemote], { allowedCodes: [0,1,128] })).code !== 0) throw new TypeError('Non-fast-forward push refused: fetch the expected remote commit or select explicit force with a lease.');
            } } }
          result = await this.git(w.repo, gitCommand(operation, args), { token, remote: current.remote, allowedCodes: [0, 1, 128] });
          if (operation === 'push' && result.code === 0) { const actual = (await this.remoteRefs(w, token, destination))[destination] ?? null; result.remote_verified = actual === expectedRemote; result.remote_head = actual; }
        }
        current.generation += 1; await save(join(w.dir, 'workspace.json'), current);
        const state = await this.inspect(id, binding, args.worktree);
        result = { ...result, ...state, status: result.code === 0 ? result.remote_verified === false ? 'unconfirmed' : 'applied' : state.conflicts.length ? 'conflict' : 'rejected' };
      } catch (error) { result = { status: 'uncertain', error: error instanceof TypeError ? error.message : 'Native operation did not finish with verified state; inspect before another intent.' }; }
      await save(receipt, { intent, result, finished_at: this.now() }); return result;
    } finally { await lock.close(); await rm(join(w.dir, 'mutation.lock'), { force: true }); }
  }
  async close(id, binding) {
    if (!ID.test(id ?? '')) throw new TypeError('Invalid workspace ID.');
    await this.access(binding, true);
    try { await realpath(join(this.root,id)); } catch(error) { if(error.code!=='ENOENT')throw error;await rm(join(this.root,'.attachments',id),{recursive:true,force:true});return {disposed:true,alreadyAbsent:true}; }
    const w = await this.workspace(id, binding, true, true);
    let lock; try { lock = await open(join(w.dir, 'mutation.lock'), 'wx', 0o600); } catch { throw new TypeError('Workspace is busy; no files deleted.'); }
    try { await rm(w.dir, { recursive: true, force: true });await rm(join(this.root,'.attachments',id),{recursive:true,force:true}); return { disposed: true }; } finally { await lock.close(); }
  }
  async prune({ skip = new Set(), limit = 100 } = {}) {
    let removed = 0;
    for (const id of await readdir(this.root).catch(e => e.code === 'ENOENT' ? [] : Promise.reject(e))) {
      if (removed >= limit || !ID.test(id) || skip.has(id)) continue;
      const dir = join(this.root, id); let lock;
      try {
        if (await realpath(dir) !== dir) continue;
        const meta = await json(join(dir, 'workspace.json'));
        if (!Number.isFinite(meta.expiresAt) || meta.expiresAt > this.now()) continue;
        lock = await open(join(dir, 'mutation.lock'), 'wx', 0o600);
        await rm(dir, { recursive: true, force: true });await rm(join(this.root,'.attachments',id),{recursive:true,force:true}); removed++;
      } catch (e) { if (!['EEXIST', 'ENOENT'].includes(e.code)) throw e; }
      finally { if (lock) await lock.close(); }
    }
    return { removed };
  }
  async list(binding) {
    await this.access(binding, false); const items = [];
    for (const id of await readdir(this.root).catch(e => e.code === 'ENOENT' ? [] : Promise.reject(e))) {
      if (!ID.test(id)) continue;
      try { const meta = await json(join(this.root, id, 'workspace.json')); if (meta.binding === bindingHash(binding)) items.push({ workspace_id: id, generation: meta.generation, state: meta.state, expires_at: meta.expiresAt }); } catch { /* corrupt metadata is an operator recovery item, not another tenant's output */ }
    }
    return items;
  }
}
