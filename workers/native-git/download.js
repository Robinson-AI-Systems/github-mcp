// GIT-DOWNLOAD-1: one-time bulk downloads from a native workspace without passing bulk bytes
// through the control plane. An authenticated, signed `download_begin` takes a snapshot — refs
// copied into a separate bare repository whose objects are a read-only view of the workspace's,
// or a commit to archive, or a tar of the current worktree — and the control plane signs a
// short-lived capability for it. The worker accepts that capability only on /v1/download: one
// read-only `git clone`/`git fetch` session (smart HTTP upload-pack, advertised refs only) or one
// COMPLETED archive download — a fetch that dies mid-stream may be retried with the same address
// inside the session window, because it delivered nothing (G7). Nothing in the workspace is
// changed, no GitHub credential is involved, and no
// `.git` directory, configuration or file outside the workspace repository is ever served.
import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, mkdir, open, readFile, readdir, realpath, rm, stat, statfs, writeFile } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createGzip } from 'node:zlib';
import { value } from '../../src/native-git/commands.js';
import { DOWNLOAD_MAX_BYTES, DOWNLOAD_SESSION_MS, DOWNLOAD_TTL_MS, verifyDownloadCapability } from '../../src/native-git/protocol.js';
import { bindingHash, gitEnvironment, gitPrefix, json, save } from './engine.js';
import { workspaceEntry } from './safe-files.js';
import { refusalText } from './resources.js';

const MiB = 1024 * 1024;
const WORKSPACE = /^git_[a-f0-9]{32}$/, DOWNLOAD = /^[a-f0-9]{32}$/;
export const DOWNLOAD_LIMITS = Object.freeze({ outstanding: 20, refs: 10000, requests: 64, requestBytes: 4 * MiB, entries: 100000, worktreeBytes: 2048 * MiB, buildMs: 40000 });
export const downloadPaths = (root, workspaceId, downloadId) => {
  const base = join(root, '.downloads', workspaceId);
  return { base, record: join(base, downloadId + '.json'), claimed: join(base, downloadId + '.claimed'), data: join(base, downloadId) };
};
// The snapshot repository is ours: no hooks, no filters, only advertised tips may be wanted.
const SNAPSHOT_CONFIG = '[core]\n\thooksPath = /dev/null\n\tfsmonitor = false\n\tlogAllRefUpdates = false\n[uploadpack]\n\tallowFilter = false\n\tallowTipSHA1InWant = false\n\tallowReachableSHA1InWant = false\n\tallowAnySHA1InWant = false\n\tallowRefInWant = false\n[gc]\n\tauto = 0\n';
const refusal = message => Object.assign(new TypeError(message), { refusal: true });

function view(downloadId, record, now) {
  const expired = record.state === 'awaiting' && record.expiresAt <= now;
  return { download_id: 'dl_' + downloadId, mode: record.mode, state: expired ? 'expired' : record.state, source: record.source, max_bytes: record.maxBytes, expires_at: record.expiresAt,
    ...(record.head !== undefined ? { head: record.head } : {}), ...(record.branch !== undefined ? { branch: record.branch } : {}),
    ...(record.refs !== undefined ? { refs: record.refs } : {}), ...(record.files !== undefined ? { files: record.files } : {}),
    ...(record.bytes !== undefined ? { bytes: record.bytes } : {}), ...(record.servedBytes !== undefined ? { served_bytes: record.servedBytes } : {}) };
}
async function owned(worker, id, binding, downloadId, write) {
  if (!DOWNLOAD.test(downloadId ?? '')) throw new TypeError('Invalid download ID.');
  const w = await worker.workspace(id, binding, write);
  return { w, p: downloadPaths(worker.root, id, downloadId) };
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
const commitOf = async (worker, repo, ref) => {
  const r = await worker.git(repo, ['rev-parse', '--verify', '--quiet', '--end-of-options', ref + '^{commit}'], { allowedCodes: [0, 1, 128] });
  return r.code === 0 ? r.stdout.trim() : null;
};
const hasRef = async (worker, repo, full) => (await worker.git(repo, ['show-ref', '--verify', '--quiet', full], { allowedCodes: [0, 1, 128] })).code === 0;
function checkRef(ref) {
  value(ref, 256);
  if (ref.startsWith('-') || /[\x00-\x20\x7f\\]/.test(ref)) throw new TypeError('ref must be a branch, tag, commit ID or "worktree".');
}

// ---- Snapshot builders (run inside the authenticated begin request, under the workspace's busy lock).
async function snapshotRepository(worker, w, dir) {
  await worker.git(dir, ['init', '--bare', '--quiet', '--template=', 'repo.git']);
  const repo = join(dir, 'repo.git');
  await writeFile(join(repo, 'config'), await readFile(join(repo, 'config'), 'utf8') + SNAPSHOT_CONFIG, { mode: 0o600 });
  await mkdir(join(repo, 'objects', 'info'), { recursive: true });
  // Read-only view of the workspace objects; nothing is copied and nothing is written back.
  await writeFile(join(repo, 'objects', 'info', 'alternates'), join(w.repo, '.git', 'objects') + '\n', { mode: 0o600 });
  const shallow = await readFile(join(w.repo, '.git', 'shallow')).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
  if (shallow) await writeFile(join(repo, 'shallow'), shallow, { mode: 0o600 });
  return repo;
}

async function planGitSnapshot(worker, w, ref) {
  const refs = [];
  let head, branch = null;
  if (ref === undefined) {
    const listed = (await worker.git(w.repo, ['for-each-ref', '--format=%(refname)%00%(objectname)', 'refs/heads/', 'refs/tags/'], { maxOutputBytes: 32 * MiB })).stdout.split('\n').filter(Boolean);
    if (listed.length > DOWNLOAD_LIMITS.refs) throw refusal(`The workspace has more than ${DOWNLOAD_LIMITS.refs} branches and tags; download one with ref.`);
    for (const line of listed) { const [name, id] = line.split('\0'); refs.push({ name, id }); }
    const symbolic = await worker.git(w.repo, ['symbolic-ref', '--quiet', 'HEAD'], { allowedCodes: [0, 1, 128] });
    head = await commitOf(worker, w.repo, 'HEAD');
    if (symbolic.code === 0 && refs.some(r => r.name === symbolic.stdout.trim())) branch = symbolic.stdout.trim().slice(11);
  } else {
    head = await commitOf(worker, w.repo, ref);
    if (!head) throw refusal(`No branch, tag or commit named ${JSON.stringify(ref.slice(0, 200))} exists in the workspace.`);
    branch = await hasRef(worker, w.repo, 'refs/heads/' + ref) ? ref : 'download';
    refs.push({ name: 'refs/heads/' + branch, id: head });
    if (await hasRef(worker, w.repo, 'refs/tags/' + ref)) refs.push({ name: 'refs/tags/' + ref, id: (await worker.git(w.repo, ['rev-parse', '--verify', 'refs/tags/' + ref])).stdout.trim() });
  }
  if (!refs.length) throw refusal('The workspace has no commits yet, so there is nothing to clone.');
  return { refs, head: head ?? null, branch };
}

async function writeGitSnapshot(worker, repo, plan) {
  await worker.git(repo, ['update-ref', '--stdin'], { input: Buffer.from(plan.refs.map(r => `create ${r.name} ${r.id}\n`).join('')) });
  if (plan.branch) await worker.git(repo, ['symbolic-ref', 'HEAD', 'refs/heads/' + plan.branch]);
  else if (plan.head) await worker.git(repo, ['update-ref', '--no-deref', 'HEAD', plan.head]);
}

// A plain POSIX tar (ustar + pax names) of tracked and untracked-but-not-ignored files.
const octal = (n, width) => n.toString(8).padStart(width - 1, '0') + '\0';
function tarHeader(name, { size = 0, mode = 0o644, mtime = 0, type = '0', link = '' } = {}) {
  const h = Buffer.alloc(512);
  h.write(name, 0, 100, 'utf8'); h.write(octal(mode, 8), 100); h.write(octal(0, 8), 108); h.write(octal(0, 8), 116);
  h.write(octal(size, 12), 124); h.write(octal(mtime, 12), 136); h.write('        ', 148); h.write(type, 156); h.write(link, 157, 100, 'utf8');
  h.write('ustar\0', 257); h.write('00', 263);
  let sum = 0; for (const b of h) sum += b; h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  return h;
}
function paxRecord(key, text) {
  const body = ` ${key}=${text}\n`; let length = Buffer.byteLength(body) + 1;
  while (String(length).length + Buffer.byteLength(body) !== length) length = String(length).length + Buffer.byteLength(body);
  return length + body;
}
const padding = size => Buffer.alloc((512 - size % 512) % 512);
function* entryHeaders(path, options) {
  const long = Buffer.byteLength(path) > 100 || /[^\x20-\x7e]/.test(path) || Buffer.byteLength(options.link ?? '') > 100 || /[^\x20-\x7e]/.test(options.link ?? '');
  if (long) {
    const pax = Buffer.from(paxRecord('path', path) + (options.link ? paxRecord('linkpath', options.link) : ''));
    yield tarHeader('PaxHeader', { size: pax.length, type: 'x' }); yield pax; yield padding(pax.length);
  }
  yield tarHeader(long ? Buffer.from(path).subarray(0, 100).toString('latin1').replace(/[^\x20-\x7e]/g, '_') : path, { ...options, link: long ? '' : options.link ?? '' });
}
function escapes(path, target) {
  if (!target || posix.isAbsolute(target) || target.includes('\0')) return true;
  const resolved = posix.normalize(posix.join(posix.dirname(path), target));
  return resolved === '..' || resolved.startsWith('../') || resolved.split('/').some(p => p.toLowerCase() === '.git');
}

async function worktreePlan(worker, w) {
  const listed = (await worker.git(w.repo, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { maxOutputBytes: 64 * MiB })).stdout.split('\0').filter(Boolean);
  const paths = [...new Set(listed)].filter(p => !p.endsWith('/') && !p.split('/').some(part => part.toLowerCase() === '.git')).sort();
  if (paths.length > DOWNLOAD_LIMITS.entries) throw refusal(`The worktree has more than ${DOWNLOAD_LIMITS.entries} files; download a commit (ref) or use mode git.`);
  return paths;
}
async function* worktreeTar(w, paths, stats) {
  let total = 0;
  for (const path of paths) {
    let entry;
    try { entry = await workspaceEntry(w.repo, path); }
    catch (error) { if (['ELOOP', 'ENOTDIR'].includes(error.code)) throw refusal(`${JSON.stringify(path.slice(0, 200))} is inside a folder that is a symbolic link; worktree downloads never follow links. Download a commit (ref) instead.`); throw error; }
    if (entry.type === 'symlink') {
      if (escapes(path, entry.target)) throw refusal(`${JSON.stringify(path.slice(0, 200))} is a symbolic link that points outside the repository; worktree downloads never include such links. Remove it, or download a commit (ref) instead.`);
      stats.files++; yield* entryHeaders(path, { type: '2', link: entry.target, mode: 0o777 }); continue;
    }
    if (entry.type !== 'file') continue;
    try {
      total += entry.size;
      if (total > DOWNLOAD_LIMITS.worktreeBytes) throw refusal(`The worktree holds more than ${DOWNLOAD_LIMITS.worktreeBytes / MiB} MiB; download a commit (ref) or use mode git.`);
      yield* entryHeaders(path, { size: entry.size, mode: entry.mode & 0o100 ? 0o755 : 0o644, mtime: entry.mtime });
      let read = 0;
      while (read < entry.size) {
        const chunk = Buffer.alloc(Math.min(MiB, entry.size - read));
        const { bytesRead } = await entry.file.read(chunk, 0, chunk.length, read);
        if (!bytesRead) throw refusal(`${JSON.stringify(path.slice(0, 200))} changed while it was being archived; begin the download again.`);
        read += bytesRead; yield bytesRead === chunk.length ? chunk : chunk.subarray(0, bytesRead);
      }
      yield padding(entry.size); stats.files++;
    } finally { await entry.file.close(); }
  }
  yield Buffer.alloc(1024);
}

function counted(limit, onOver) {
  let total = 0;
  const stream = new Transform({ transform(chunk, _e, done) { total += chunk.length; if (total > limit) { onOver(); done(new RangeError('over')); } else done(null, chunk); } });
  return { stream, total: () => total };
}
const tooLarge = maxBytes => `The download would be larger than its ${Math.ceil(maxBytes / MiB)} MiB limit. Begin again with a larger maxMegabytes (up to ${DOWNLOAD_MAX_BYTES / MiB}), download one ref, or use mode git.`;

export async function beginDownload(worker, id, binding, { downloadId, mode, ref, maxBytes, expiresAt, nonce } = {}) {
  const now = worker.now();
  if (!DOWNLOAD.test(nonce ?? '') || !['git', 'archive'].includes(mode) || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > DOWNLOAD_MAX_BYTES ||
    !Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt > now + DOWNLOAD_TTL_MS + 30000) throw new TypeError('Invalid download request.');
  if (ref !== undefined) checkRef(ref);
  if (mode === 'git' && ref === 'worktree') return { status: 'refused', reason: 'ref "worktree" is for mode archive; a git clone carries commits only. Commit first, or use mode archive.' };
  const { w, p } = await owned(worker, id, binding, downloadId, true);
  if (w.meta.state !== 'ready') throw new TypeError('Workspace is not ready; read status first.');
  await mkdir(join(worker.root, '.downloads'), { recursive: true, mode: 0o700 }); await mkdir(p.base, { recursive: true, mode: 0o700 });
  if (await realpath(p.base) !== p.base) throw new TypeError('Download storage must not be a symlink.');
  const fresh = { binding: bindingHash(binding), mode, ref: ref ?? null, maxBytes, expiresAt, nonce, state: 'awaiting', createdAt: now };
  const old = await json(p.record).catch(() => null);
  if (old) {
    if (['binding', 'mode', 'ref', 'maxBytes', 'expiresAt', 'nonce'].some(k => old[k] !== fresh[k])) throw new TypeError('Download ID already belongs to different input.');
    return view(downloadId, old, now);
  }
  let outstanding = 0;
  for (const name of await readdir(p.base)) {
    if (!/^[a-f0-9]{32}\.json$/.test(name)) continue;
    const other = await json(join(p.base, name)).catch(() => null);
    if (other && ((other.state === 'awaiting' && other.expiresAt > now) || other.state === 'serving')) outstanding++;
  }
  if (outstanding >= DOWNLOAD_LIMITS.outstanding) return { status: 'refused', reason: `This workspace already has ${outstanding} unused download addresses; use one or wait for them to expire (10 minutes).` };
  if (!await roomFor(worker.root, mode === 'archive' && ref === 'worktree' ? maxBytes : 0)) throw new TypeError('The worker is short of storage; no download was prepared. Retry shortly.');
  try { await mkdir(p.data, { mode: 0o700 }); } catch (error) { if (error.code === 'EEXIST') throw new TypeError('This download is still being prepared; read its status.'); throw error; }
  try {
    const repo = await snapshotRepository(worker, w, p.data);
    let record;
    if (mode === 'git') {
      const plan = await planGitSnapshot(worker, w, ref);
      await writeGitSnapshot(worker, repo, plan);
      record = { ...fresh, source: ref === undefined ? 'refs' : 'ref', head: plan.head, branch: plan.branch, refs: plan.refs.length };
    } else if (ref === 'worktree') {
      const head = await commitOf(worker, w.repo, 'HEAD');
      const paths = await worktreePlan(worker, w); const stats = { files: 0 };
      let over = false; const counter = counted(maxBytes, () => { over = true; });
      const abort = AbortSignal.timeout(DOWNLOAD_LIMITS.buildMs);
      try { await pipeline(Readable.from(worktreeTar(w, paths, stats)), createGzip(), counter.stream, createWriteStream(join(p.data, 'archive.tar.gz'), { flags: 'wx', mode: 0o600 }), { signal: abort }); }
      catch (error) {
        if (error.refusal) throw error;
        if (over) throw refusal(tooLarge(maxBytes));
        if (abort.aborted) throw refusal('Archiving the worktree took too long; download a commit (ref) or use mode git.');
        throw error;
      }
      record = { ...fresh, source: 'worktree', head, files: stats.files, bytes: counter.total() };
    } else {
      const head = await commitOf(worker, w.repo, ref ?? 'HEAD');
      if (!head) throw refusal(ref === undefined ? 'The workspace has no commits yet; use ref "worktree" to download its files.' : `No branch, tag or commit named ${JSON.stringify(ref.slice(0, 200))} exists in the workspace.`);
      record = { ...fresh, source: 'commit', head };
    }
    await save(p.record, record);
    return view(downloadId, record, now);
  } catch (error) {
    await rm(p.data, { recursive: true, force: true }).catch(() => {});
    if (error.refusal) return { status: 'refused', reason: error.message };
    throw error;
  }
}

export async function downloadStatus(worker, id, binding, { downloadId } = {}) {
  const { p } = await owned(worker, id, binding, downloadId, false);
  let data; try { data = await json(p.record); } catch (error) { if (error.code === 'ENOENT') throw new TypeError('No download with this ID belongs to this workspace. Begin a new download.'); throw error; }
  if (data.binding !== bindingHash(binding)) throw new TypeError('Download belongs to another connection.');
  return view(downloadId, data, worker.now());
}

// ---- The one-time HTTP address (no control-plane request lease; the capability is the authority).
function reply(res, status, message, headers = {}) {
  if (res.headersSent) { res.destroy(); return; }
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(message + '\n');
}
async function roomFor(root, bytes) {
  try { const disk = await statfs(root); return Number(disk.bavail) * Number(disk.bsize) >= bytes + 64 * MiB; } catch { return false; }
}
async function readBody(req, limit) {
  const chunks = []; let total = 0;
  const source = req.headers['content-encoding'] === 'gzip' ? req.pipe(createGunzip()) : req;
  for await (const chunk of source) { total += chunk.length; if (total > limit) throw new RangeError('over'); chunks.push(chunk); }
  return Buffer.concat(chunks);
}

export async function downloadHttp(req, res, { root, key, now = Date.now, monitor } = {}) {
  const url = new URL(req.url, 'http://worker.invalid');
  const match = /^\/v1\/download\/([A-Za-z0-9_-]{1,2048}\.[A-Za-z0-9_-]{1,200})(\/info\/refs|\/git-upload-pack)?$/.exec(url.pathname);
  if (!match) { req.resume(); return reply(res, 404, 'Not found.'); }
  let claim;
  try { claim = verifyDownloadCapability(match[1], key, now(), { graceMs: DOWNLOAD_SESSION_MS }); }
  catch (error) { req.resume(); return reply(res, 403, /expired/.test(error.message) ? 'This download address has expired. Begin a new download.' : 'This download address is not valid. Begin a new download.'); }
  const route = match[2] ?? '';
  const git = claim.mode === 'git';
  const allowed = git ? (route === '/info/refs' && req.method === 'GET' && url.search === '?service=git-upload-pack') || (route === '/git-upload-pack' && req.method === 'POST')
    : route === '' && url.search === '' && req.method === 'GET';
  if (!allowed) { req.resume(); return reply(res, git ? 403 : 405, git ? 'This address only serves git clone or git fetch.' : 'This address only serves one archive download (curl).'); }
  const p = downloadPaths(root, claim.workspace_id, claim.downloadId);
  let stored;
  try {
    const dir = join(root, claim.workspace_id);
    if (!WORKSPACE.test(claim.workspace_id) || await realpath(dir) !== dir || await realpath(p.base) !== p.base) throw new Error('storage');
    const meta = await json(join(dir, 'workspace.json'));
    stored = await json(p.record);
    if (meta.binding !== claim.binding || meta.state !== 'ready' || meta.expiresAt <= now() || ['binding', 'mode', 'maxBytes', 'expiresAt', 'nonce'].some(k => stored[k] !== claim[k])) throw new Error('mismatch');
  } catch { req.resume(); return reply(res, 404, 'This download is no longer available. Begin a new download.'); }
  const gone = () => { req.resume(); return reply(res, 410, 'This download address was already used. Begin a new download.'); };
  const at = now();
  if (stored.state === 'awaiting') {
    if (claim.expiresAt <= at) { req.resume(); return reply(res, 403, 'This download address has expired. Begin a new download.'); }
    if (monitor) { const check = await monitor.check({ needsDisk: false }); if (!check.allowed) { req.resume(); return reply(res, 503, refusalText(check, 'The worker is short of memory; nothing was sent. Retry the same command shortly.'), { 'Retry-After': String(check.retryAfterSeconds ?? 2) }); } }
    // The first request of a session claims the address exactly once (O_EXCL).
    try { const handle = await open(p.claimed, 'wx', 0o600); await handle.close(); } catch { return gone(); }
    stored = { ...stored, state: 'serving', sessionStartedAt: at, requests: 0, servedBytes: 0 };
    await save(p.record, stored);
  } else if (!(stored.state === 'serving' && stored.sessionStartedAt + DOWNLOAD_SESSION_MS > at && (!git || stored.requests < DOWNLOAD_LIMITS.requests))) return gone();
  const finish = async (state, extra = {}) => { await save(p.record, { ...stored, ...extra, state, finishedAt: now() }).catch(() => {}); if (state !== 'serving') await rm(p.data, { recursive: true, force: true }).catch(() => {}); };
  const repo = join(p.data, 'repo.git');
  try {
    if (!git) return await serveArchive(req, res, { root, claim, stored, p, repo, finish });
    stored.requests += 1;
    if (route === '/info/refs') {
      const advertised = await runGit(root, repo, ['upload-pack', '--stateless-rpc', '--advertise-refs', repo], { timeoutMs: 30000, maxOutputBytes: 32 * MiB });
      if (advertised.code !== 0) { await finish('failed'); return reply(res, 500, 'The download snapshot is unavailable. Begin a new download.'); }
      const body = Buffer.concat([Buffer.from('001e# service=git-upload-pack\n0000'), advertised.stdout]);
      if (stored.servedBytes + body.length > claim.maxBytes) { await finish('failed'); return reply(res, 413, tooLarge(claim.maxBytes)); }
      await finish('serving', { requests: stored.requests, servedBytes: stored.servedBytes + body.length }); stored.servedBytes += body.length;
      res.writeHead(200, { 'Content-Type': 'application/x-git-upload-pack-advertisement', 'Cache-Control': 'no-store' });
      return res.end(body);
    }
    if (req.headers['content-type'] !== 'application/x-git-upload-pack-request') { req.resume(); return reply(res, 415, 'This address only serves git clone or git fetch.'); }
    let input;
    try { input = await readBody(req, DOWNLOAD_LIMITS.requestBytes); } catch { return reply(res, 413, 'The fetch request is too large; fetch fewer refs or clone into an empty folder.'); }
    // A session ends with the response that carries the pack (Git may omit "done" after "ready").
    let last = input.includes(Buffer.from('0009done\n')) || input.includes(Buffer.from('0008done')), tail = Buffer.alloc(0);
    const watch = new Transform({ transform(chunk, _e, done) { if (!last) { const view = Buffer.concat([tail, chunk]); last = view.includes(Buffer.from('PACK')); tail = view.subarray(-3); } done(null, chunk); } });
    let over = false; const counter = counted(claim.maxBytes - stored.servedBytes, () => { over = true; });
    const child = spawn('git', [...gitPrefix(), 'upload-pack', '--stateless-rpc', repo], { cwd: p.data, env: gitEnvironment(root), stdio: ['pipe', 'pipe', 'ignore'], detached: true });
    const kill = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* ended */ } };
    const timer = setTimeout(kill, DOWNLOAD_SESSION_MS); timer.unref();
    const closed = new Promise(resolve => child.on('close', resolve));
    child.stdin.on('error', () => {}); child.stdin.end(input);
    res.writeHead(200, { 'Content-Type': 'application/x-git-upload-pack-result', 'Cache-Control': 'no-store' }); res.flushHeaders(); // a proxy in front (the single-domain relay) sees the reply start at once
    let sent = true;
    try { await pipeline(child.stdout, watch, counter.stream, res); } catch { sent = false; kill(); }
    const code = await closed; clearTimeout(timer);
    const servedBytes = stored.servedBytes + counter.total();
    if (over || !sent || code !== 0) { await finish('failed', { requests: stored.requests, servedBytes }); if (!res.writableEnded) res.destroy(); return; }
    await finish(last ? 'downloaded' : 'serving', { requests: stored.requests, servedBytes });
  } catch { await finish('failed'); return reply(res, 500, 'The download did not finish. Begin a new download.'); }
}

async function serveArchive(req, res, { root, claim, stored, p, repo, finish }) {
  req.resume();
  let over = false; const counter = counted(claim.maxBytes, () => { over = true; });
  const headers = { 'Content-Type': 'application/gzip', 'Content-Disposition': 'attachment; filename="repo.tar.gz"', 'Cache-Control': 'no-store' };
  if (stored.source === 'worktree') {
    const file = join(p.data, 'archive.tar.gz'); const size = (await stat(file)).size;
    res.writeHead(200, { ...headers, 'Content-Length': String(size) });
    // G7: a fetch that dies mid-stream delivered nothing usable, so it must not consume the
    // address (the field failure was a 0-byte first fetch and a 410 on retry). The snapshot is
    // kept in 'serving' and the same address may be fetched again inside the session window;
    // only a completed serve consumes it. A serve that breaks the byte cap stays 'failed'.
    try { await pipeline(createReadStream(file), counter.stream, res); } catch { await finish(over ? 'failed' : 'serving', { servedBytes: counter.total() }); if (!res.writableEnded) res.destroy(); return; }
    return finish('downloaded', { servedBytes: counter.total() });
  }
  // A commit snapshot: `git archive` of the fixed commit in the snapshot repository (no workspace config or attributes).
  const child = spawn('git', [...gitPrefix(), 'archive', '--format=tar', '--end-of-options', stored.head], { cwd: repo, env: gitEnvironment(root), stdio: ['ignore', 'pipe', 'ignore'], detached: true });
  const kill = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* ended */ } };
  const timer = setTimeout(kill, DOWNLOAD_SESSION_MS); timer.unref();
  const closed = new Promise(resolve => child.on('close', resolve));
  res.writeHead(200, headers); res.flushHeaders();
  let sent = true;
  try { await pipeline(child.stdout, createGzip(), counter.stream, res); } catch { sent = false; kill(); }
  const code = await closed; clearTimeout(timer);
  if (over) { await finish('failed', { servedBytes: counter.total() }); if (!res.writableEnded) res.destroy(); return; }
  // G7: once the stream has broken, the child's exit code says nothing — a cut-off client
  // makes git die on the broken pipe, and the kill above lands as a signal (exit code null).
  // The serve was cut off, not failed: the snapshot stays 'serving' for a retry.
  if (!sent) { await finish('serving', { servedBytes: counter.total() }); if (!res.writableEnded) res.destroy(); return; }
  if (code !== 0) { await finish('failed', { servedBytes: counter.total() }); if (!res.writableEnded) res.destroy(); return; }
  return finish('downloaded', { servedBytes: counter.total() });
}

/** Removes download snapshots past their address and session window, and every download of a removed workspace. */
export async function pruneDownloads(root, now = Date.now()) {
  const base = join(root, '.downloads'); let removed = 0;
  for (const id of await readdir(base).catch(error => error.code === 'ENOENT' ? [] : Promise.reject(error))) {
    const dir = join(base, id);
    if (!WORKSPACE.test(id) || await realpath(dir).catch(() => null) !== dir) continue;
    if (!await lstat(join(root, id)).then(() => true, () => false)) { await rm(dir, { recursive: true, force: true }); removed++; continue; }
    for (const name of await readdir(dir)) {
      const match = /^([a-f0-9]{32})\.json$/.exec(name); if (!match) continue;
      const stored = await json(join(dir, name)).catch(() => null);
      if (!stored || !(now > stored.expiresAt + DOWNLOAD_SESSION_MS + 600000)) continue;
      const p = downloadPaths(root, id, match[1]);
      await rm(p.data, { recursive: true, force: true }); await rm(p.claimed, { force: true }); await rm(p.record, { force: true }); removed++;
    }
  }
  return { removed };
}
