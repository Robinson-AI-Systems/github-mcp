// GIT-UPLOAD-1: one-time direct uploads into a native workspace without passing bulk bytes
// through the control plane. The control plane signs a short-lived, single-use capability for
// one upload of one workspace; this worker accepts it only on /v1/upload and only ever writes
// into that upload's quarantine area (a separate bare repository for `git push`, or one archive
// file for `curl --upload-file`). Nothing reaches the workspace until an authenticated apply
// verifies it: fast-forward only for Git, safe names/types/sizes for archives, and the
// repository's content protection on every new byte. No GitHub credential is ever involved.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { lstat, mkdir, open, readFile, readdir, realpath, rm, statfs, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { activeProtectionReport, containsCredential } from '../../src/github/content-protection.js';
import { value } from '../../src/native-git/commands.js';
import { UPLOAD_MAX_BYTES, UPLOAD_TTL_MS, verifyUploadCapability } from '../../src/native-git/protocol.js';
import { ARCHIVE_LIMITS, entryPath, openArchive } from './archive.js';
import { bindingHash, gitEnvironment, gitPrefix, hash, json, save } from './engine.js';
import { readWorkspaceFile, writeWorkspaceFile } from './safe-files.js';

const MiB = 1024 * 1024;
const WORKSPACE = /^git_[a-f0-9]{32}$/, UPLOAD = /^[a-f0-9]{32}$/;
/** A received upload stays applicable this long after its address expired, then the sweep removes it. */
export const UPLOAD_RETENTION_MS = 3600000;
const REQUEST_LIMIT_MS = 300000, GIT_COMMAND_OVERHEAD = MiB;
export const uploadPaths = (root, workspaceId, uploadId) => {
  const base = join(root, '.uploads', workspaceId);
  return { base, record: join(base, uploadId + '.json'), claimed: join(base, uploadId + '.claimed'), data: join(base, uploadId) };
};
// The quarantine repository is ours: fsck every object, never delete, never run hooks, cap the pack.
const quarantineConfig = maxBytes => `[core]\n\thooksPath = /dev/null\n\tfsmonitor = false\n\tlogAllRefUpdates = false\n[receive]\n\tfsckObjects = true\n\tdenyDeletes = true\n\tdenyNonFastForwards = true\n\tmaxInputSize = ${maxBytes}\n\tadvertisePushOptions = false\n\tshallowUpdate = false\n\tautogc = false\n[transfer]\n\tfsckObjects = true\n[gc]\n\tauto = 0\n`;
const STATE_HELP = {
  awaiting: 'Nothing has arrived yet. Run the git push or curl command with the upload URL first (it works once, within 10 minutes), then apply.',
  receiving: 'The upload is still arriving. Wait for git push or curl to finish, then apply.',
  applied: 'This upload was already applied. Begin a new upload for more files.',
  failed: 'This upload did not complete (too large, damaged or refused by Git). Begin a new upload.'
};
const refusal = message => Object.assign(new TypeError(message), { refusal: true });

function view(uploadId, record, now) {
  return { upload_id: 'upl_' + uploadId, mode: record.mode, state: record.state === 'awaiting' && record.expiresAt <= now ? 'expired' : record.state,
    max_bytes: record.maxBytes, expires_at: record.expiresAt, ...(record.receivedBytes !== undefined ? { received_bytes: record.receivedBytes } : {}),
    ...(record.refs ? { branches: record.refs.map(r => ({ name: r.name.replace(/^refs\/heads\//, ''), head: r.head })) } : {}) };
}
async function owned(worker, id, binding, uploadId, write) {
  if (!UPLOAD.test(uploadId ?? '')) throw new TypeError('Invalid upload ID.');
  const w = await worker.workspace(id, binding, write);
  return { w, p: uploadPaths(worker.root, id, uploadId) };
}
async function record(p, binding) {
  let data; try { data = await json(p.record); } catch (error) { if (error.code === 'ENOENT') throw new TypeError('No upload with this ID belongs to this workspace. Begin a new upload.'); throw error; }
  if (data.binding !== bindingHash(binding)) throw new TypeError('Upload belongs to another connection.');
  return data;
}

export async function beginUpload(worker, id, binding, { uploadId, mode, maxBytes, expiresAt, nonce } = {}) {
  const now = worker.now();
  if (!UPLOAD.test(nonce ?? '') || !['git', 'archive'].includes(mode) || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > UPLOAD_MAX_BYTES ||
    !Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt > now + UPLOAD_TTL_MS + 30000) throw new TypeError('Invalid upload request.');
  const { w, p } = await owned(worker, id, binding, uploadId, true);
  if (w.meta.state !== 'ready') throw new TypeError('Workspace is not ready; read status first.');
  await mkdir(join(worker.root, '.uploads'), { recursive: true, mode: 0o700 }); await mkdir(p.base, { recursive: true, mode: 0o700 });
  if (await realpath(p.base) !== p.base) throw new TypeError('Upload storage must not be a symlink.');
  const fresh = { binding: bindingHash(binding), mode, maxBytes, expiresAt, nonce, state: 'awaiting', createdAt: now };
  try { await mkdir(p.data, { mode: 0o700 }); } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const old = await json(p.record).catch(() => null);
    if (!old) throw new TypeError('This upload is still being prepared; read its status.');
    if (['binding', 'mode', 'maxBytes', 'expiresAt', 'nonce'].some(k => old[k] !== fresh[k])) throw new TypeError('Upload ID already belongs to different input.');
    return view(uploadId, old, now);
  }
  if (mode === 'git') {
    await worker.git(p.data, ['init', '--bare', '--quiet', '--template=', 'repo.git']);
    const repo = join(p.data, 'repo.git');
    await writeFile(join(repo, 'config'), await readFile(join(repo, 'config'), 'utf8') + quarantineConfig(maxBytes), { mode: 0o600 });
    // Read-only view of the workspace's objects so the client sends only new objects.
    await mkdir(join(repo, 'objects', 'info'), { recursive: true });
    await writeFile(join(repo, 'objects', 'info', 'alternates'), join(w.repo, '.git', 'objects') + '\n', { mode: 0o600 });
  }
  await save(p.record, fresh);
  return view(uploadId, fresh, now);
}

export async function uploadStatus(worker, id, binding, { uploadId } = {}) {
  const { p } = await owned(worker, id, binding, uploadId, false);
  return view(uploadId, await record(p, binding), worker.now());
}

// ---- The one-time HTTP address (no control-plane request lease; the capability is the authority).
function reply(res, status, message, headers = {}) {
  if (res.headersSent) { res.destroy(); return; }
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(message + '\n');
}
async function exclusive(path) { const handle = await open(path, 'wx', 0o600); await handle.close(); }
async function admitted(root, monitor, bytes) {
  if (monitor) { const check = await monitor.check({ needsDisk: true }); if (!check.allowed) return false; }
  try { const disk = await statfs(root); return Number(disk.bavail) * Number(disk.bsize) >= bytes + 64 * MiB; } catch { return false; }
}
function counted(limit, onOver) {
  let total = 0;
  const stream = new Transform({ transform(chunk, _e, done) { total += chunk.length; if (total > limit) { onOver(); done(new RangeError('over')); } else done(null, chunk); } });
  return { stream, total: () => total };
}

export async function uploadHttp(req, res, { root, key, now = Date.now, monitor } = {}) {
  const url = new URL(req.url, 'http://worker.invalid');
  const match = /^\/v1\/upload\/([A-Za-z0-9_-]{1,2048}\.[A-Za-z0-9_-]{1,200})(\/info\/refs|\/git-receive-pack)?$/.exec(url.pathname);
  if (!match) { req.resume(); return reply(res, 404, 'Not found.'); }
  let claim;
  try { claim = verifyUploadCapability(match[1], key, now()); }
  catch (error) { req.resume(); return reply(res, 403, /expired/.test(error.message) ? 'This upload address has expired. Begin a new upload.' : 'This upload address is not valid. Begin a new upload.'); }
  const route = match[2] ?? '';
  const git = claim.mode === 'git';
  const allowed = git ? (route === '/info/refs' && req.method === 'GET' && url.search === '?service=git-receive-pack') || (route === '/git-receive-pack' && req.method === 'POST')
    : route === '' && url.search === '' && ['PUT', 'POST'].includes(req.method);
  if (!allowed) { req.resume(); return reply(res, git ? 403 : 405, git ? 'This address only accepts git push.' : 'This address only accepts one archive upload (curl --upload-file).'); }
  const p = uploadPaths(root, claim.workspace_id, claim.uploadId);
  let stored;
  try {
    const dir = join(root, claim.workspace_id);
    if (!WORKSPACE.test(claim.workspace_id) || await realpath(dir) !== dir || await realpath(p.base) !== p.base) throw new Error('storage');
    const meta = await json(join(dir, 'workspace.json'));
    stored = await json(p.record);
    if (meta.binding !== claim.binding || meta.state !== 'ready' || meta.expiresAt <= now() || ['binding', 'mode', 'maxBytes', 'expiresAt', 'nonce'].some(k => stored[k] !== claim[k])) throw new Error('mismatch');
  } catch { req.resume(); return reply(res, 404, 'This upload is no longer available. Begin a new upload.'); }
  const used = async () => { try { await lstat(p.claimed); return true; } catch { return false; } };
  if (stored.state !== 'awaiting' || await used()) { req.resume(); return reply(res, 410, 'This upload address was already used. Begin a new upload.'); }
  const declared = req.headers['content-length'] === undefined ? null : Number(req.headers['content-length']);
  if (declared !== null && (!Number.isSafeInteger(declared) || declared < 0)) { req.resume(); return reply(res, 400, 'Invalid request length.'); }
  const limit = claim.maxBytes + (git ? GIT_COMMAND_OVERHEAD : 0);
  if (declared !== null && declared > limit) { req.resume(); return reply(res, 413, `The upload is larger than its ${Math.ceil(claim.maxBytes / MiB)} MiB limit. Begin a new upload with a larger maxMegabytes (up to ${UPLOAD_MAX_BYTES / MiB}).`); }
  const repo = join(p.data, 'repo.git');
  if (route === '/info/refs') {
    const advertised = await runGit(root, p.data, ['receive-pack', '--stateless-rpc', '--advertise-refs', repo], { timeoutMs: 30000 });
    if (advertised.code !== 0) return reply(res, 500, 'The upload repository is unavailable. Begin a new upload.');
    res.writeHead(200, { 'Content-Type': 'application/x-git-receive-pack-advertisement', 'Cache-Control': 'no-store' });
    return res.end(Buffer.concat([Buffer.from('001f# service=git-receive-pack\n0000'), advertised.stdout]));
  }
  if (git && declared === 4) {
    // Git probes large pushes with an empty command list first; it changes nothing.
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    if (Buffer.concat(chunks).toString('latin1') !== '0000') return reply(res, 400, 'Invalid push request.');
    res.writeHead(200, { 'Content-Type': 'application/x-git-receive-pack-result', 'Cache-Control': 'no-store' }); return res.end();
  }
  if (git && req.headers['content-type'] !== 'application/x-git-receive-pack-request') { req.resume(); return reply(res, 415, 'This address only accepts git push.'); }
  if (!await admitted(root, monitor, claim.maxBytes)) { req.resume(); return reply(res, 503, 'The worker is short of storage or memory; nothing was received. Retry the same command shortly.', { 'Retry-After': '2' }); }
  try { await exclusive(p.claimed); } catch { req.resume(); return reply(res, 410, 'This upload address was already used. Begin a new upload.'); }
  await save(p.record, { ...stored, state: 'receiving', claimedAt: now() });
  const fail = async (status, message) => { await save(p.record, { ...stored, state: 'failed', claimedAt: now() }).catch(() => {}); await rm(p.data, { recursive: true, force: true }).catch(() => {}); return reply(res, status, message); };
  const tooLarge = `The upload exceeded its ${Math.ceil(claim.maxBytes / MiB)} MiB limit; nothing was kept. Begin a new upload with a larger maxMegabytes (up to ${UPLOAD_MAX_BYTES / MiB}).`;
  const deadline = setTimeout(() => req.destroy(), REQUEST_LIMIT_MS); deadline.unref();
  try {
    if (!git) {
      let over = false; const counter = counted(limit, () => { over = true; });
      const digest = createHash('sha256');
      const tap = new Transform({ transform(chunk, _e, done) { digest.update(chunk); done(null, chunk); } });
      try { await pipeline(req, counter.stream, tap, createWriteStream(join(p.data, 'archive.upload'), { flags: 'wx', mode: 0o600 })); }
      catch { return await fail(over ? 413 : 400, over ? tooLarge : 'The upload did not finish; nothing was kept. Begin a new upload.'); }
      if (!counter.total()) return await fail(400, 'The upload was empty. Begin a new upload.');
      await save(p.record, { ...stored, state: 'received', claimedAt: now(), receivedBytes: counter.total(), sha256: digest.digest('hex') });
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ received: true, bytes: counter.total(), next: 'Call github_git_workspace_upload operation apply with this upload_id and the current expectedGeneration.' }) + '\n');
    }
    let over = false;
    const counter = counted(limit, () => { over = true; });
    const source = req.headers['content-encoding'] === 'gzip' ? [req, createGunzip()] : [req];
    const child = spawn('git', [...gitPrefix(), 'receive-pack', '--stateless-rpc', repo], { cwd: p.data, env: gitEnvironment(root), stdio: ['pipe', 'pipe', 'ignore'], detached: true });
    const kill = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* ended */ } };
    const out = []; let outBytes = 0;
    child.stdout.on('data', chunk => { outBytes += chunk.length; if (outBytes <= 4 * MiB) out.push(chunk); });
    const closed = new Promise(resolve => child.on('close', resolve));
    const timer = setTimeout(kill, REQUEST_LIMIT_MS); timer.unref();
    child.stdin.on('error', () => {});
    let fed = true;
    try { await pipeline(...source, counter.stream, child.stdin); } catch { fed = false; kill(); }
    const code = await closed; clearTimeout(timer);
    if (over) return await fail(413, tooLarge);
    if (!fed) return await fail(400, 'The push did not finish; nothing was kept. Begin a new upload.');
    const listed = code === 0 ? await runGit(root, repo, ['for-each-ref', '--count=51', '--format=%(refname)%00%(objectname)', 'refs/heads/'], { timeoutMs: 30000 }) : null;
    const refs = listed?.code === 0 ? listed.stdout.toString('utf8').split('\n').filter(Boolean).map(line => { const [name, head] = line.split('\0'); return { name, head }; }) : [];
    if (refs.length && refs.length <= 50) await save(p.record, { ...stored, state: 'received', claimedAt: now(), receivedBytes: counter.total(), refs });
    else { await save(p.record, { ...stored, state: 'failed', claimedAt: now() }); await rm(p.data, { recursive: true, force: true }).catch(() => {}); }
    res.writeHead(200, { 'Content-Type': 'application/x-git-receive-pack-result', 'Cache-Control': 'no-store' });
    return res.end(Buffer.concat(out));
  } catch { return await fail(500, 'The upload did not finish; nothing was kept. Begin a new upload.'); }
  finally { clearTimeout(deadline); }
}

function runGit(root, cwd, args, { timeoutMs = 45000, input, maxOutputBytes = 8 * MiB } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', [...gitPrefix(), ...args], { cwd, env: gitEnvironment(root), stdio: [input ? 'pipe' : 'ignore', 'pipe', 'ignore'], detached: true });
    const out = []; let bytes = 0, problem = null;
    const kill = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* ended */ } };
    const timer = setTimeout(() => { problem = 'timeout'; kill(); }, timeoutMs);
    child.stdout.on('data', chunk => { bytes += chunk.length; if (bytes > maxOutputBytes) { problem = 'output'; kill(); } else out.push(chunk); });
    if (input) { child.stdin.on('error', () => {}); child.stdin.end(input); }
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); problem ? reject(new TypeError('Git did not finish in time or produced too much output.')) : resolve({ code, stdout: Buffer.concat(out) }); });
  });
}

// Streams `git cat-file --batch` so each object is scanned once without loading them all.
function catObjects(root, repo, ids, onObject, { timeoutMs = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', [...gitPrefix(), 'cat-file', '--batch'], { cwd: repo, env: gitEnvironment(root), stdio: ['pipe', 'pipe', 'ignore'], detached: true });
    const pending = []; let pendingBytes = 0, want = null, header = null, failure = null;
    const kill = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* ended */ } };
    const timer = setTimeout(() => { failure = refusal('Content scanning took too long; upload fewer or smaller files.'); kill(); }, timeoutMs);
    const take = n => { const all = Buffer.concat(pending); pending.length = 0; pending.push(all.subarray(n)); pendingBytes = all.length - n; return all.subarray(0, n); };
    child.stdout.on('data', chunk => {
      if (failure) return;
      pending.push(chunk); pendingBytes += chunk.length;
      try {
        for (;;) {
          if (want === null) {
            const all = Buffer.concat(pending); pending.length = 0; pending.push(all); const end = all.indexOf(0x0a);
            if (end < 0) { if (all.length > 512) throw new Error('header'); return; }
            const [id, type, size] = all.toString('latin1', 0, end).split(' ');
            if (type === 'missing' || !Number.isSafeInteger(Number(size))) throw new Error('missing');
            take(end + 1); header = { id, type }; want = Number(size) + 1;
          }
          if (pendingBytes < want) return;
          const body = take(want); want = null; onObject(header.id, header.type, body.subarray(0, body.length - 1));
        }
      } catch (error) { failure = error; kill(); }
    });
    child.stdin.on('error', () => {}); child.stdin.end(ids.join('\n') + '\n');
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); if (failure) reject(failure instanceof TypeError ? failure : new Error('scan')); else if (code !== 0 || want !== null) reject(new Error('scan')); else resolve(); });
  });
}

function findingFor(label, bytes) {
  const text = bytes.toString('utf8');
  if (!containsCredential(text)) return null;
  const rules = [...new Set(activeProtectionReport(text).findings.map(f => f.rule))].slice(0, 3);
  return { path: label, rules };
}
const protectionRefusal = findings => refusal(`Content protection refused this upload: credential-shaped content in ${findings.length} file(s) or commit message(s), first ${JSON.stringify(findings[0].path.slice(0, 200))} (${findings[0].rules.join(', ') || 'credential'}). Remove the values (put real secrets in protected setup) and upload again.`);

async function planGit(worker, w, state, stored, p, { ref, uploadId }) {
  const q = join(p.data, 'repo.git'), refs = stored.refs ?? [];
  let chosen;
  if (ref !== undefined) { const full = ref.startsWith('refs/heads/') ? ref : 'refs/heads/' + ref; chosen = refs.find(r => r.name === full); if (!chosen) throw refusal(`No pushed branch is named ${JSON.stringify(full.slice(11))}; pushed: ${refs.map(r => r.name.slice(11)).join(', ').slice(0, 300)}.`); }
  else if (refs.length === 1) chosen = refs[0];
  else throw refusal(`Several branches were pushed (${refs.map(r => r.name.slice(11)).join(', ').slice(0, 300)}); choose one with ref.`);
  const incoming = (await worker.git(q, ['rev-parse', '--verify', '--end-of-options', chosen.name + '^{commit}'])).stdout.trim();
  if (incoming !== chosen.head) throw refusal('The quarantined branch changed. Begin a new upload.');
  if (state.branch === null) throw refusal('The workspace HEAD is detached. Switch to a branch, then apply the upload again.');
  if (state.in_progress.length) throw refusal(`A ${state.in_progress[0]} operation is in progress in the workspace. Finish or abort it, then apply again.`);
  const tracked = (await worker.git(w.repo, ['status', '--porcelain=v1', '-z', '--untracked-files=no'])).stdout;
  if (tracked.length) throw refusal('The workspace has uncommitted changes to tracked files. Commit, stash or restore them, then apply the git upload again.');
  const head = state.head;
  const summary = { mode: 'git', branch: state.branch, previous_head: head, commits: 0, files_added: 0, files_changed: 0, files_deleted: 0, received_bytes: stored.receivedBytes, paths_sample: [] };
  if (head === incoming) return { execute: async () => ({ ...summary, head }) };
  if (head && (await worker.git(q, ['merge-base', '--is-ancestor', head, incoming], { allowedCodes: [0, 1, 128] })).code !== 0)
    throw refusal(`The pushed commit does not build on the workspace HEAD ${head}. Rebase your commits onto that commit and push to a new upload; only fast-forwards are applied.`);
  const range = head ? [incoming, '--not', head] : [incoming];
  const commits = Number((await worker.git(q, ['rev-list', '--count', ...range])).stdout.trim());
  if (!Number.isSafeInteger(commits) || commits > 5000) throw refusal('More than 5,000 new commits were pushed; use your own Git for history imports of this size.');
  // Paths that change between HEAD and the pushed commit: refuse links/submodules and untracked collisions.
  const raw = head ? (await worker.git(q, ['diff-tree', '-r', '-z', '--no-renames', '--no-commit-id', head, incoming], { maxOutputBytes: 32 * MiB })).stdout
    : (await worker.git(q, ['ls-tree', '-r', '-z', '--full-tree', incoming], { maxOutputBytes: 32 * MiB })).stdout;
  const changes = []; const fields = raw.split('\0');
  if (head) { for (let i = 0; i + 1 < fields.length; i += 2) { const [, , mode, , , status] = fields[i].split(/[: ]/); changes.push({ path: fields[i + 1], mode, status }); } }
  else { for (const line of fields.filter(Boolean)) { const tab = line.indexOf('\t'); changes.push({ path: line.slice(tab + 1), mode: line.split(' ')[0], status: 'A' }); } }
  const link = changes.find(c => c.status !== 'D' && ['120000', '160000'].includes(c.mode));
  if (link) throw refusal(`${JSON.stringify(link.path.slice(0, 200))} is a symbolic link or submodule; upload regular files only, or use your own Git for links.`);
  const untracked = new Set((await worker.git(w.repo, ['ls-files', '-z', '--others'], { maxOutputBytes: 32 * MiB })).stdout.split('\0').filter(Boolean));
  const collision = changes.find(c => c.status === 'A' && untracked.has(c.path));
  if (collision) throw refusal(`${JSON.stringify(collision.path.slice(0, 200))} already exists as an untracked file in the workspace; remove it, then apply again.`);
  // Every object new to the workspace, including intermediate commits and their messages.
  const listed = (await worker.git(q, ['rev-list', '--objects', ...range], { maxOutputBytes: 32 * MiB })).stdout.split('\n').filter(Boolean);
  const names = new Map(); for (const line of listed) { const space = line.indexOf(' '); names.set(space < 0 ? line : line.slice(0, space), space < 0 ? '' : line.slice(space + 1)); }
  if (names.size > 100000) throw refusal('Too many new objects were pushed; use your own Git for imports of this size.');
  const kinds = (await worker.git(q, ['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'], { input: Buffer.from([...names.keys()].join('\n') + '\n'), maxOutputBytes: 16 * MiB })).stdout.split('\n').filter(Boolean).map(line => line.split(' '));
  let total = 0; const scan = [];
  for (const [id, type, size] of kinds) {
    if (type !== 'blob' && type !== 'commit') continue;
    if (type === 'blob') { if (Number(size) > ARCHIVE_LIMITS.fileBytes) throw refusal(`${JSON.stringify((names.get(id) || id).slice(0, 200))} is larger than ${ARCHIVE_LIMITS.fileBytes / MiB} MiB.`); total += Number(size); }
    scan.push(id);
  }
  if (total > ARCHIVE_LIMITS.totalBytes) throw refusal(`The new files total more than ${ARCHIVE_LIMITS.totalBytes / MiB} MiB.`);
  const findings = [];
  await catObjects(worker.root, q, scan, (id, type, bytes) => { const found = findingFor(type === 'commit' ? `commit message ${id.slice(0, 12)}` : names.get(id) || id, bytes); if (found) findings.push(found); });
  if (findings.length) throw protectionRefusal(findings);
  return { execute: async () => {
    const incomingRef = `refs/robinson/incoming/${uploadId}`;
    try {
      await worker.git(w.repo, ['-c', 'protocol.file.allow=always', 'fetch', '--quiet', '--no-tags', '--no-recurse-submodules', '--no-write-fetch-head', '--', q, `+${chosen.name}:${incomingRef}`], { timeoutMs: 120000 });
      if ((await worker.git(w.repo, ['rev-parse', '--verify', incomingRef])).stdout.trim() !== incoming) throw new Error('fetch');
      await worker.git(w.repo, ['merge', '--ff-only', '--no-stat', '--quiet', incomingRef], { timeoutMs: 120000 });
    } finally { await worker.git(w.repo, ['update-ref', '-d', incomingRef], { allowedCodes: [0, 1, 128] }).catch(() => {}); }
    if ((await worker.git(w.repo, ['rev-parse', '--verify', 'HEAD'])).stdout.trim() !== incoming) throw new Error('fast-forward');
    const count = s => changes.filter(c => s.includes(c.status)).length;
    return { ...summary, head: incoming, commits, files_added: count(['A']), files_changed: count(['M', 'T']), files_deleted: count(['D']), paths_sample: changes.slice(0, 20).map(c => c.path) };
  } };
}

async function destination(repo, path) {
  let at = repo; const parts = path.split('/');
  for (let i = 0; i < parts.length; i++) {
    at = join(at, parts[i]);
    let info; try { info = await lstat(at); } catch (error) { if (error.code === 'ENOENT') return 'absent'; throw error; }
    if (info.isSymbolicLink()) throw refusal(`${JSON.stringify(path.slice(0, 200))} would pass through a symbolic link in the workspace.`);
    if (i < parts.length - 1 ? !info.isDirectory() : !info.isFile()) throw refusal(`${JSON.stringify(path.slice(0, 200))} conflicts with an existing ${info.isDirectory() ? 'folder' : 'file'} in the workspace.`);
  }
  return 'file';
}

async function planArchive(worker, w, stored, p, { path }) {
  let prefix = '';
  try { prefix = path === undefined ? '' : entryPath(path); } catch (error) { throw refusal(error.message.replace('Archive refused: ', 'Target path refused: ')); }
  let archive;
  try { archive = await openArchive(join(p.data, 'archive.upload'), p.data); } catch (error) { if (error instanceof TypeError) throw refusal(error.message); throw error; }
  try {
    const findings = []; const plan = [];
    for (const file of archive.files) {
      const dest = prefix ? prefix + '/' + file.path : file.path;
      if (dest.length > 4096) throw refusal('A target path is too long.');
      await destination(w.repo, dest);
      const found = findingFor(dest, await file.read()); if (found) findings.push(found);
      plan.push({ file, dest });
    }
    if (findings.length) throw protectionRefusal(findings);
    return { close: () => archive.close(), execute: async () => {
      let added = 0, changed = 0, unchanged = 0, written = 0;
      for (const { file, dest } of plan) {
        const bytes = await file.read();
        let before = null; try { before = await readWorkspaceFile(w.repo, dest, bytes.length); } catch { before = null; }
        if (before?.equals(bytes)) { unchanged++; continue; }
        const existed = await destination(w.repo, dest) === 'file';
        await writeWorkspaceFile(w.repo, dest, bytes);
        if (!(await readWorkspaceFile(w.repo, dest, bytes.length)).equals(bytes)) throw new Error('readback');
        if (existed) changed++; else added++; written += bytes.length;
      }
      return { mode: 'archive', format: archive.format, target: prefix || '.', files: plan.length, files_added: added, files_changed: changed, files_unchanged: unchanged, bytes_written: written, received_bytes: stored.receivedBytes, paths_sample: plan.slice(0, 20).map(x => x.dest) };
    } };
  } catch (error) { await archive.close(); throw error; }
}

export async function applyUpload(worker, id, binding, { uploadId, ref, path, requestKey, expectedGeneration } = {}) {
  if (ref !== undefined) value(ref, 256);
  if (path !== undefined) value(path, 1024);
  value(requestKey, 128);
  const { w, p } = await owned(worker, id, binding, uploadId, true);
  if (w.meta.state !== 'ready') throw new TypeError('Workspace is not ready; read status first.');
  const receipt = join(w.dir, 'intent-' + hash(requestKey) + '.json'), intent = hash({ operation: 'upload_apply', uploadId, ref: ref ?? null, path: path ?? null });
  let lock;
  try { lock = await open(join(w.dir, 'mutation.lock'), 'wx', 0o600); } catch (error) { if (error.code === 'EEXIST') throw new TypeError('Workspace is leased. Inspect current state; interrupted leases require explicit operator recovery, never automatic write replay.'); throw error; }
  let plan;
  try {
    const current = await json(join(w.dir, 'workspace.json'));
    try { const old = await json(receipt); if (old.intent !== intent) throw new TypeError('Request key already belongs to different input.'); return { ...(old.result ?? { status: 'uncertain', next: 'Inspect local state before a new intent.' }), replayed: true }; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (expectedGeneration !== current.generation) throw new TypeError('Workspace generation changed; inspect before another mutation.');
    const stored = await record(p, binding);
    if (stored.state !== 'received') return { status: 'refused', reason: STATE_HELP[stored.state] ?? 'This upload is not ready to apply.' };
    if (worker.now() > stored.expiresAt + UPLOAD_RETENTION_MS) return { status: 'refused', reason: 'This upload expired before it was applied. Begin a new upload.' };
    const state = await worker.inspect(id, binding);
    try { plan = stored.mode === 'git' ? await planGit(worker, w, state, stored, p, { ref, uploadId }) : await planArchive(worker, w, stored, p, { path }); }
    catch (error) { if (error.refusal) return { status: 'refused', reason: error.message }; throw error; }
    // Checks passed and nothing in the workspace changed yet; from here the receipt records the intent.
    await save(receipt, { intent, state: 'sending' });
    let result;
    try {
      const summary = await plan.execute();
      current.generation += 1; await save(join(w.dir, 'workspace.json'), current);
      await save(p.record, { ...stored, state: 'applied', appliedAt: worker.now() });
      await plan.close?.(); plan.close = null;
      await rm(p.data, { recursive: true, force: true });
      result = { ...summary, ...await worker.inspect(id, binding), upload_id: 'upl_' + uploadId, status: 'applied' };
    } catch (error) {
      // Files may have changed: move the generation so no stale mutation proceeds, and report uncertainty.
      current.generation += 1; await save(join(w.dir, 'workspace.json'), current).catch(() => {});
      result = { status: 'uncertain', generation: current.generation, error: error instanceof TypeError ? error.message : 'The upload was not applied with verified state; inspect the workspace before another intent.' };
    }
    await save(receipt, { intent, result, finished_at: worker.now() });
    return result;
  } finally { await plan?.close?.(); await lock.close(); await rm(join(w.dir, 'mutation.lock'), { force: true }); }
}

/** Removes uploads retained past their apply window and every upload of a removed workspace. */
export async function pruneUploads(root, now = Date.now()) {
  const base = join(root, '.uploads'); let removed = 0;
  for (const id of await readdir(base).catch(error => error.code === 'ENOENT' ? [] : Promise.reject(error))) {
    const dir = join(base, id);
    if (!WORKSPACE.test(id) || await realpath(dir).catch(() => null) !== dir) continue;
    if (!await realpath(join(root, id)).then(() => true, () => false)) { await rm(dir, { recursive: true, force: true }); removed++; continue; }
    for (const name of await readdir(dir)) {
      const match = /^([a-f0-9]{32})\.json$/.exec(name); if (!match) continue;
      const stored = await json(join(dir, name)).catch(() => null);
      // Ten minutes beyond the apply window, so a running apply is never cut short.
      if (!stored || !(now > stored.expiresAt + UPLOAD_RETENTION_MS + 600000)) continue;
      const p = uploadPaths(root, id, match[1]);
      await rm(p.data, { recursive: true, force: true }); await rm(p.claimed, { force: true }); await rm(p.record, { force: true }); removed++;
    }
  }
  return { removed };
}
