// GIT-UPLOAD-1: one-time direct uploads into a native workspace without passing bulk bytes
// through the control plane. The control plane signs a short-lived, single-use capability for
// one upload of one workspace; this worker accepts it only on /v1/upload and only ever writes
// into that upload's quarantine area (a separate bare repository for `git push`, or one archive
// file for `curl --upload-file`). Nothing reaches the workspace until an authenticated apply
// verifies it: fast-forward only for Git, safe names/types/sizes for archives, and the
// repository's content protection on every new byte. No GitHub credential is ever involved.
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { link, lstat, mkdir, open, readFile, readdir, realpath, rename, rm, statfs, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { blockingPushFindings, valueFingerprint } from '../../src/github/file-protection.js';
import { value } from '../../src/native-git/commands.js';
import { UPLOAD_CHUNK_GRACE_MS, UPLOAD_CHUNK_MAX_BYTES, UPLOAD_MAX_BYTES, UPLOAD_TTL_MS, verifyUploadCapability } from '../../src/native-git/protocol.js';
import { ARCHIVE_LIMITS, entryPath, openArchive } from './archive.js';
import { bindingHash, gitEnvironment, gitPrefix, hash, json, save } from './engine.js';
import { readWorkspaceFile, writeWorkspaceFile, removeWorkspaceFile, workspaceEntry } from './safe-files.js';
import { refusalText } from './resources.js';

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
  receiving: 'The upload is still arriving (or its chunks were never finished). Wait for the command to finish, or send the missing chunks and finish, then apply.',
  applied: 'This upload was already applied. Begin a new upload for more files.',
  failed: 'This upload did not complete (too large, damaged or refused by Git). Begin a new upload.'
};
const refusal = message => Object.assign(new TypeError(message), { refusal: true });

function view(uploadId, record, now) {
  return { upload_id: 'upl_' + uploadId, mode: record.mode, state: record.state === 'awaiting' && record.expiresAt <= now ? 'expired' : record.state,
    max_bytes: record.maxBytes, expires_at: record.expiresAt, ...(record.receivedBytes !== undefined ? { received_bytes: record.receivedBytes } : {}),
    ...(record.sha256 ? { sha256: record.sha256 } : {}), ...(record.chunked ? { chunked: true } : {}), ...(record.mode === 'git' && record.base !== undefined ? { base: record.base } : {}),
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
    // CHUNK-UPLOAD-1: the workspace HEAD a chunked git bundle may leave out (null for an empty repository).
    const head = await worker.git(w.repo, ['rev-parse', '--verify', '--quiet', 'HEAD'], { allowedCodes: [0, 1, 128] });
    fresh.base = head.code === 0 ? head.stdout.trim() : null;
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
// Resolves to null when admitted, otherwise the refused check (PC-WORKER-1: the owner pause has its own sentence).
async function refused(root, monitor, bytes) {
  if (monitor) { const check = await monitor.check({ needsDisk: true }); if (!check.allowed) return check; }
  try { const disk = await statfs(root); return Number(disk.bavail) * Number(disk.bsize) >= bytes + 64 * MiB ? null : { allowed: false, reason: 'storage_pressure' }; } catch { return { allowed: false, reason: 'storage_observation_unavailable' }; }
}
function counted(limit, onOver) {
  let total = 0;
  const stream = new Transform({ transform(chunk, _e, done) { total += chunk.length; if (total > limit) { onOver(); done(new RangeError('over')); } else done(null, chunk); } });
  return { stream, total: () => total };
}

export async function uploadHttp(req, res, { root, key, now = Date.now, monitor } = {}) {
  const url = new URL(req.url, 'http://worker.invalid');
  const match = /^\/v1\/upload\/([A-Za-z0-9_-]{1,2048}\.[A-Za-z0-9_-]{1,200})(\/info\/refs|\/git-receive-pack|\/chunk|\/status|\/finish)?$/.exec(url.pathname);
  if (!match) { req.resume(); return reply(res, 404, 'Not found.'); }
  const step = CHUNK_STEPS[match[2] ?? ''];
  let claim;
  try { claim = verifyUploadCapability(match[1], key, now(), { graceMs: step ? UPLOAD_CHUNK_GRACE_MS : 0 }); }
  catch (error) { req.resume(); return reply(res, 403, /expired/.test(error.message) ? 'This upload address has expired. Begin a new upload.' : 'This upload address is not valid. Begin a new upload.'); }
  const route = match[2] ?? '';
  const git = claim.mode === 'git';
  const allowed = step ? req.method === step : git ? (route === '/info/refs' && req.method === 'GET' && url.search === '?service=git-receive-pack') || (route === '/git-receive-pack' && req.method === 'POST')
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
  if (step) return chunkStep(req, res, { route, url, claim, p, root, monitor, now });
  const used = async () => { try { await lstat(p.claimed); return true; } catch { return false; } };
  if (stored.state !== 'awaiting' || await used()) { req.resume(); return reply(res, 410, 'This upload address was already used. Begin a new upload.'); }
  const declared = req.headers['content-length'] === undefined ? null : Number(req.headers['content-length']);
  if (declared !== null && (!Number.isSafeInteger(declared) || declared < 0)) { req.resume(); return reply(res, 400, 'Invalid request length.'); }
  const limit = claim.maxBytes + (git ? GIT_COMMAND_OVERHEAD : 0);
  const clientDigest = typeof req.headers['x-content-sha256'] === 'string' ? req.headers['x-content-sha256'].trim().toLowerCase() : null;
  if (clientDigest !== null && !/^[a-f0-9]{64}$/.test(clientDigest)) { req.resume(); return reply(res, 400, 'X-Content-SHA256 must be the 64-character hex SHA-256 of the file (sha256sum).'); }
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
  { const no = await refused(root, monitor, claim.maxBytes); if (no) { req.resume(); return reply(res, 503, refusalText(no, 'The worker is short of storage or memory; nothing was received. Retry the same command shortly.'), { 'Retry-After': String(no.retryAfterSeconds ?? 2) }); } }
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
      // CHUNK-UPLOAD-1: integrity at receive time, not at apply: a body shorter or longer than its own
      // Content-Length, or bytes whose SHA-256 differs from the client's X-Content-SHA256, are discarded.
      const sha256 = digest.digest('hex');
      if (declared !== null && counter.total() !== declared) return await fail(400, `Only ${counter.total()} of ${declared} bytes arrived; nothing was kept. Begin a new upload (the chunked command resumes instead of restarting).`);
      if (clientDigest && clientDigest !== sha256) return await fail(422, `The ${counter.total()} bytes received have SHA-256 ${sha256}, not the ${clientDigest} that was sent; nothing was kept. Begin a new upload.`);
      await save(p.record, { ...stored, state: 'received', claimedAt: now(), receivedBytes: counter.total(), sha256 });
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ received: true, upload_id: 'upl_' + claim.uploadId, bytes: counter.total(), sha256, next: 'Call github_git_workspace_upload operation apply with this upload_id and the current expectedGeneration.' }) + '\n');
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

// ---- CHUNK-UPLOAD-1: resumable uploads in small requests on the same one-time capability.
// PUT <url>/chunk?offset=N stores one chunk (at most 8 MiB) as its own part file, named by offset,
// length and SHA-256: a retried identical chunk is a no-op, different bytes at a stored range or an
// overlapping range are refused. GET <url>/status lists the byte ranges present, so an interrupted
// upload resumes. POST <url>/finish?size=N&sha256=H checks the parts tile [0, N) exactly, re-hashes
// every part, assembles the file and compares the whole-file SHA-256 before anything is quarantined.
// The first chunk claims the address for chunks (a one-request upload is then refused, and the
// reverse). Chunks may keep arriving for UPLOAD_CHUNK_GRACE_MS after the ten-minute window only for an
// upload whose first chunk arrived inside it. In git mode the assembled file is a git bundle, fetched
// into the same fsck-checking quarantine repository a git push would use.
const CHUNK_STEPS = { '/chunk': 'PUT', '/status': 'GET', '/finish': 'POST' };
const PART = /^(\d{1,12})-(\d{1,9})-([a-f0-9]{64})\.part$/;
export const UPLOAD_PARTS_MAX = 4096;
const LOCK_STALE_MS = 300000;
const sendJson = (res, status, body) => { if (res.headersSent) { res.destroy(); return; } res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body) + '\n'); };
async function claimKind(p) { try { return (await readFile(p.claimed, 'utf8')) === 'chunks' ? 'chunks' : 'single'; } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
async function withUploadLock(p, fn) {
  const path = p.data + '.lock';
  for (let i = 0; ; i++) {
    try { await (await open(path, 'wx', 0o600)).close(); break; } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const info = await lstat(path).catch(() => null);
      if (info && Date.now() - info.mtimeMs > LOCK_STALE_MS) { await rm(path, { force: true }); continue; }
      if (i >= 400) throw Object.assign(new Error('busy'), { busy: true });
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
  try { return await fn(); } finally { await rm(path, { force: true }); }
}
async function listParts(p) {
  const names = await readdir(join(p.data, 'parts')).catch(error => error.code === 'ENOENT' ? [] : Promise.reject(error));
  return names.map(name => PART.exec(name)).filter(Boolean).map(m => ({ name: m[0], offset: Number(m[1]), bytes: Number(m[2]), sha256: m[3] })).sort((a, b) => a.offset - b.offset || a.bytes - b.bytes);
}
function present(parts) {
  const out = [];
  for (const x of parts) { const last = out.at(-1); if (last && x.offset <= last[1]) last[1] = Math.max(last[1], x.offset + x.bytes); else out.push([x.offset, x.offset + x.bytes]); }
  return out;
}

async function chunkStep(req, res, ctx) {
  const { route, claim, p, now } = ctx;
  try {
    const kind = await claimKind(p);
    if (route === '/status') { req.resume(); return sendJson(res, 200, await chunkStatus(p, claim, kind, now)); }
    if (kind === 'single') { req.resume(); return reply(res, 410, 'This upload address was already used for a one-request upload. Begin a new upload.'); }
    if (claim.expiresAt <= now() && kind !== 'chunks') { req.resume(); return reply(res, 403, 'This upload address has expired. Begin a new upload.'); }
    return route === '/chunk' ? await receiveChunk(req, res, ctx, kind) : await finishChunks(req, res, ctx);
  } catch (error) {
    req.resume();
    if (error?.busy) return reply(res, 503, 'The upload is busy with another request; retry this one shortly.', { 'Retry-After': '1' });
    return reply(res, 500, 'The chunk step did not finish; the chunks already stored are kept. Read status and retry.');
  }
}

async function chunkStatus(p, claim, kind, now) {
  const stored = await json(p.record), parts = stored.state === 'receiving' && kind === 'chunks' ? await listParts(p) : [];
  const ranges = present(parts);
  return { upload_id: 'upl_' + claim.uploadId, mode: claim.mode, state: stored.state === 'awaiting' && claim.expiresAt <= now() ? 'expired' : stored.state, chunked: kind === 'chunks', max_bytes: claim.maxBytes,
    chunks: parts.length, bytes_present: parts.reduce((n, x) => n + x.bytes, 0), present: ranges.slice(0, 100), ...(ranges.length > 100 ? { present_truncated: true } : {}),
    ...(stored.receivedBytes !== undefined ? { received_bytes: stored.receivedBytes } : {}), ...(stored.sha256 ? { sha256: stored.sha256 } : {}),
    accepts_chunks_until: kind === 'chunks' ? claim.expiresAt + UPLOAD_CHUNK_GRACE_MS : claim.expiresAt };
}

async function receiveChunk(req, res, { url, claim, p, root, monitor, now }, kind) {
  const m = /^\?offset=(\d{1,12})$/.exec(url.search), offset = m ? Number(m[1]) : NaN;
  if (!Number.isSafeInteger(offset)) { req.resume(); return reply(res, 400, 'A chunk needs ?offset=<byte offset of its first byte>.'); }
  if (offset >= claim.maxBytes) { req.resume(); return reply(res, 413, `Offset ${offset} is beyond this upload's ${Math.ceil(claim.maxBytes / MiB)} MiB limit. Begin a new upload with a larger maxMegabytes (up to ${UPLOAD_MAX_BYTES / MiB}).`); }
  const declared = req.headers['content-length'] === undefined ? null : Number(req.headers['content-length']);
  if (declared !== null && (!Number.isSafeInteger(declared) || declared < 0)) { req.resume(); return reply(res, 400, 'Invalid request length.'); }
  const limit = Math.min(UPLOAD_CHUNK_MAX_BYTES, claim.maxBytes - offset);
  const tooBig = declared !== null && declared > limit;
  if (tooBig) { req.resume(); return reply(res, 413, declared > UPLOAD_CHUNK_MAX_BYTES ? `A chunk may be at most ${UPLOAD_CHUNK_MAX_BYTES / MiB} MiB; split the file with split -b 4m.` : `This chunk would pass the upload's ${Math.ceil(claim.maxBytes / MiB)} MiB limit. Begin a new upload with a larger maxMegabytes.`); }
  const clientDigest = typeof req.headers['x-content-sha256'] === 'string' ? req.headers['x-content-sha256'].trim().toLowerCase() : null;
  if (clientDigest !== null && !/^[a-f0-9]{64}$/.test(clientDigest)) { req.resume(); return reply(res, 400, 'X-Content-SHA256 must be the 64-character hex SHA-256 of the chunk.'); }
  const stored = await json(p.record);
  if (!['awaiting', 'receiving'].includes(stored.state)) { req.resume(); return reply(res, 410, stored.state === 'received' ? 'This upload was already finished; call apply.' : 'This upload is closed. Begin a new upload.'); }
  { const no = await refused(root, monitor, 2 * UPLOAD_CHUNK_MAX_BYTES); if (no) { req.resume(); return reply(res, 503, refusalText(no, 'The worker is short of storage or memory; this chunk was not stored. Retry it shortly.'), { 'Retry-After': String(no.retryAfterSeconds ?? 2) }); } }
  if (kind === null) {
    // Atomic claim: link() fails if a one-request upload (or another first chunk) claimed it first.
    const marker = p.claimed + '.' + randomBytes(6).toString('hex');
    await writeFile(marker, 'chunks', { mode: 0o600, flag: 'wx' });
    try { await link(marker, p.claimed); } catch (error) { if (error.code !== 'EEXIST') throw error; } finally { await rm(marker, { force: true }); }
    if (await claimKind(p) !== 'chunks') { req.resume(); return reply(res, 410, 'This upload address was already used for a one-request upload. Begin a new upload.'); }
    await withUploadLock(p, async () => { const current = await json(p.record); if (current.state === 'awaiting') await save(p.record, { ...current, state: 'receiving', chunked: true, claimedAt: now() }); });
  }
  const dir = join(p.data, 'parts'); await mkdir(dir, { recursive: true, mode: 0o700 });
  const incoming = join(dir, 'incoming-' + randomBytes(8).toString('hex'));
  let over = false; const counter = counted(limit, () => { over = true; }), digest = createHash('sha256');
  const tap = new Transform({ transform(chunk, _e, done) { digest.update(chunk); done(null, chunk); } });
  const deadline = setTimeout(() => req.destroy(), REQUEST_LIMIT_MS); deadline.unref();
  try { await pipeline(req, counter.stream, tap, createWriteStream(incoming, { flags: 'wx', mode: 0o600 })); }
  catch { await rm(incoming, { force: true }); return reply(res, over ? 413 : 400, over ? `A chunk may be at most ${limit === UPLOAD_CHUNK_MAX_BYTES ? UPLOAD_CHUNK_MAX_BYTES / MiB + ' MiB' : 'what is left of the upload limit'}; this one was not stored.` : 'This chunk did not arrive in full and was not stored; send it again (the other chunks are kept).'); }
  finally { clearTimeout(deadline); }
  const bytes = counter.total(), sha256 = digest.digest('hex');
  const discard = async (status, message) => { await rm(incoming, { force: true }); return reply(res, status, message); };
  if (!bytes) return discard(400, 'The chunk was empty and was not stored.');
  if (declared !== null && bytes !== declared) return discard(400, `Only ${bytes} of ${declared} bytes of this chunk arrived; it was not stored. Send it again.`);
  if (clientDigest && clientDigest !== sha256) return discard(422, 'This chunk arrived with different bytes than its X-Content-SHA256; it was not stored. Send it again.');
  return withUploadLock(p, async () => {
    const current = await json(p.record);
    if (current.state !== 'receiving') return discard(410, current.state === 'received' ? 'This upload was already finished; call apply.' : 'This upload is closed. Begin a new upload.');
    const parts = await listParts(p);
    const same = parts.find(x => x.offset === offset && x.bytes === bytes);
    if (same) { await rm(incoming, { force: true }); return same.sha256 === sha256 ? sendJson(res, 200, { received: true, offset, bytes, sha256, already_stored: true, next_offset: offset + bytes }) : reply(res, 409, `Different bytes were already stored at offset ${offset}; nothing was changed. Begin a new upload if the file changed.`); }
    const clash = parts.find(x => x.offset < offset + bytes && offset < x.offset + x.bytes);
    if (clash) return discard(409, `Bytes ${offset}-${offset + bytes - 1} overlap a stored chunk at ${clash.offset}-${clash.offset + clash.bytes - 1}; send chunks at the same offsets as before (split -b 4m).`);
    if (parts.length >= UPLOAD_PARTS_MAX) return discard(413, `More than ${UPLOAD_PARTS_MAX} chunks; use larger chunks (split -b 4m).`);
    await rename(incoming, join(dir, `${offset}-${bytes}-${sha256}.part`));
    return sendJson(res, 200, { received: true, offset, bytes, sha256, next_offset: offset + bytes });
  });
}

async function finishChunks(req, res, { url, claim, p, root, now }) {
  req.resume();
  const m = /^\?size=(\d{1,12})&sha256=([a-f0-9]{64})$/.exec(url.search);
  if (!m) return reply(res, 400, 'finish needs ?size=<total bytes>&sha256=<hex SHA-256 of the whole file> (sha256sum).');
  const size = Number(m[1]), expected = m[2], git = claim.mode === 'git';
  if (!Number.isSafeInteger(size) || size < 1 || size > claim.maxBytes) return reply(res, 413, `size must be between 1 and this upload's ${claim.maxBytes} byte limit.`);
  return withUploadLock(p, async () => {
    const stored = await json(p.record);
    if (stored.state === 'received' && stored.chunked) return stored.receivedBytes === size && stored.sha256 === expected
      ? sendJson(res, 200, { received: true, upload_id: 'upl_' + claim.uploadId, bytes: size, sha256: expected, already_finished: true, next: 'Call github_git_workspace_upload operation apply with this upload_id and the current expectedGeneration.' })
      : reply(res, 409, 'This upload was already finished with a different size or SHA-256. Begin a new upload for a different file.');
    if (stored.state === 'awaiting') return reply(res, 409, 'No chunk has arrived yet. Send the chunks with PUT <url>/chunk?offset=N first.');
    if (stored.state !== 'receiving' || !stored.chunked) return reply(res, 410, 'This upload is closed. Begin a new upload.');
    const fail = async (status, message) => { await save(p.record, { ...stored, state: 'failed', failedAt: now() }).catch(() => {}); await rm(p.data, { recursive: true, force: true }).catch(() => {}); return reply(res, status, message); };
    const parts = await listParts(p); let at = 0; const missing = [];
    for (const x of parts) { if (x.offset > at) missing.push([at, x.offset]); at = Math.max(at, x.offset + x.bytes); }
    if (at > size) return fail(400, `Chunks reach byte ${at}, past the stated size ${size}; nothing was kept. Begin a new upload.`);
    if (at < size) missing.push([at, size]);
    if (missing.length) return sendJson(res, 409, { finished: false, missing: missing.slice(0, 20), next: 'Send the missing byte ranges with PUT <url>/chunk?offset=<start> (or rerun the chunked command; stored chunks are skipped as duplicates), then finish again.' });
    const target = join(p.data, git ? 'upload.bundle' : 'archive.upload');
    const whole = createHash('sha256'); const out = await open(target, 'wx', 0o600);
    try {
      for (const x of parts) {
        const bytes = await readFile(join(p.data, 'parts', x.name));
        if (bytes.length !== x.bytes || createHash('sha256').update(bytes).digest('hex') !== x.sha256) { await out.close(); return fail(500, 'A stored chunk did not read back intact; nothing was kept. Begin a new upload.'); }
        whole.update(bytes); let done = 0; while (done < bytes.length) done += (await out.write(bytes, done)).bytesWritten;
      }
      await out.sync();
    } finally { await out.close().catch(() => {}); }
    const sha256 = whole.digest('hex');
    if (sha256 !== expected) return fail(422, `The ${size} bytes received have SHA-256 ${sha256}, not the ${expected} that was sent; nothing was kept. Check that size and sha256 are of the same file you split, then begin a new upload.`);
    let refs;
    if (git) {
      const repo = join(p.data, 'repo.git');
      // Branches in the bundle, or its HEAD (`git bundle create f HEAD`) as branch "upload".
      const heads = await runGit(root, repo, ['bundle', 'list-heads', target], { timeoutMs: 30000 }).catch(() => ({ code: 1 }));
      const names = heads.code === 0 ? heads.stdout.toString('utf8').split('\n').map(line => line.split(' ')[1]).filter(Boolean) : [];
      const spec = names.some(n => n.startsWith('refs/heads/')) ? '+refs/heads/*:refs/heads/*' : names.includes('HEAD') ? '+HEAD:refs/heads/upload' : null;
      const fetched = spec ? await runGit(root, repo, ['-c', 'protocol.file.allow=always', '-c', 'fetch.fsckObjects=true', 'fetch', '--quiet', '--no-tags', '--no-write-fetch-head', '--no-recurse-submodules', '--', target, spec], { timeoutMs: 240000 }).catch(() => ({ code: 1 })) : { code: 1 };
      const listed = fetched.code === 0 ? await runGit(root, repo, ['for-each-ref', '--count=51', '--format=%(refname)%00%(objectname)', 'refs/heads/'], { timeoutMs: 30000 }) : null;
      refs = listed?.code === 0 ? listed.stdout.toString('utf8').split('\n').filter(Boolean).map(line => { const [name, head] = line.split('\0'); return { name, head }; }) : [];
      if (!refs.length || refs.length > 50) return fail(422, 'The git bundle was refused: damaged, no branch in it, more than 50 branches, or it needs commits the workspace does not have (create it with --not <base> from the begin result). Begin a new upload.');
      await rm(target, { force: true });
    }
    await save(p.record, { ...stored, state: 'received', receivedBytes: size, sha256, chunked: true, finishedAt: now(), ...(refs ? { refs } : {}) });
    await rm(join(p.data, 'parts'), { recursive: true, force: true });
    return sendJson(res, 200, { received: true, upload_id: 'upl_' + claim.uploadId, bytes: size, sha256, chunks: parts.length, ...(refs ? { branches: refs.map(r => r.name.slice(11)) } : {}), next: 'Call github_git_workspace_upload operation apply with this upload_id and the current expectedGeneration.' });
  });
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
// GIT-REMOTE-1: a pre-receive hook passes its own environment (it carries Git's quarantine object directory).
export function catObjects(root, repo, ids, onObject, { timeoutMs = 120000, env = gitEnvironment(root) } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', [...gitPrefix(), 'cat-file', '--batch'], { cwd: repo, env, stdio: ['pipe', 'pipe', 'ignore'], detached: true });
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

export function findingFor(label, bytes, settings = null) {
  const text = bytes.toString('utf8');
  // PUSH-FIXTURE-1: pushed and uploaded content allows documented FAKE test tokens (git remote, direct host, workspace upload).
  // FIXTURE-EXCEPTION-1: and the owner's exact-value push exceptions for this path (repository scanner settings).
  const findings = blockingPushFindings(label, text, settings);
  if (!findings.length) return null;
  const rules = [...new Set(findings.map(f => f.rule))].slice(0, 3);
  // PUSH-REFUSAL-RECEIPTS-1: each finding's value fingerprint (never the value), so the owner can
  // allow a deliberate fake value even when the file has never reached GitHub.
  const bytes2 = Buffer.from(text);
  const values = findings.slice(0, 50).map(f => ({ rule: f.rule, line: f.line,
   valueFingerprint: valueFingerprint(label, f.rule, bytes2.subarray(f.byte_offset, f.byte_offset + f.byte_length).toString()) }));
  // NATIVE-ERGO-1: say where (line and rule, never the value) so a false positive can be found and reported.
  return { path: label, rules, lines: findings.slice(0, 3).map(f => `line ${f.line} (${f.rule})`), values };
}
const protectionRefusal = findings => refusal(`Content protection refused this upload: credential-shaped content in ${findings.length} file(s) or commit message(s), first ${JSON.stringify(findings[0].path.slice(0, 200))} (${findings[0].lines?.length ? findings[0].lines.join(', ') : findings[0].rules.join(', ') || 'credential'}). If it is a false positive, check it with github_git_workspace_read protection_check and the repository scanner settings; otherwise remove the values (put real secrets in protected setup) and upload again.`);

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

async function planArchive(worker, w, stored, p, { path, deletePaths, mirror }) {
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
    // NATIVE-ERGO-1: deletions travel with the archive: explicit deletePaths, or mirror (tracked files
    // under the target folder that the archive no longer has). Untracked files are never mirrored away.
    const incoming = new Set(plan.map(x => x.dest)), removals = new Set();
    for (const raw of deletePaths ?? []) {
      let rel; try { rel = entryPath(raw); } catch (error) { throw refusal(error.message.replace('Archive refused: ', 'Delete path refused: ')); }
      if (incoming.has(rel)) throw refusal(`${JSON.stringify(rel.slice(0, 200))} is both in the archive and in deletePaths; choose one.`);
      const entry = await workspaceEntry(w.repo, rel); await entry.file?.close();
      if (!['file', 'symlink'].includes(entry.type)) throw refusal(`${JSON.stringify(rel.slice(0, 200))} ${entry.type === 'missing' ? 'does not exist' : 'is not a file'} in the workspace, so it cannot be deleted. Nothing was applied.`);
      removals.add(rel);
    }
    if (mirror) {
      if (!plan.length) throw refusal('mirror needs an archive with at least one file; an empty archive would delete everything under the target.');
      const tracked = (await worker.git(w.repo, ['ls-files', '-z', '--', ...(prefix ? [prefix] : [])], { maxOutputBytes: 32 * MiB })).stdout.split('\0').filter(Boolean);
      for (const file of tracked) if (!incoming.has(file) && (!prefix || file.startsWith(prefix + '/'))) removals.add(file);
      if (removals.size > 5000) throw refusal('mirror would delete more than 5,000 files; check the archive root and path, or delete in smaller steps.');
    }
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
      let deleted = 0;
      for (const rel of removals) { const entry = await workspaceEntry(w.repo, rel); await entry.file?.close(); if (entry.type === 'missing') continue; await removeWorkspaceFile(w.repo, rel); deleted++; }
      return { mode: 'archive', format: archive.format, target: prefix || '.', files: plan.length, files_added: added, files_changed: changed, files_unchanged: unchanged, files_deleted: deleted, bytes_written: written, received_bytes: stored.receivedBytes, paths_sample: plan.slice(0, 20).map(x => x.dest), ...(removals.size ? { deleted_sample: [...removals].slice(0, 20) } : {}) };
    } };
  } catch (error) { await archive.close(); throw error; }
}

export async function applyUpload(worker, id, binding, { uploadId, ref, path, deletePaths, mirror, requestKey, expectedGeneration } = {}) {
  if (ref !== undefined) value(ref, 256);
  if (path !== undefined) value(path, 1024);
  if (deletePaths !== undefined && (!Array.isArray(deletePaths) || !deletePaths.length || deletePaths.length > 1000)) throw new TypeError('deletePaths must list 1–1000 workspace paths.');
  for (const p of deletePaths ?? []) value(p, 4096);
  if (mirror !== undefined && typeof mirror !== 'boolean') throw new TypeError('mirror must be true or false.');
  value(requestKey, 128);
  const { w, p } = await owned(worker, id, binding, uploadId, true);
  if (w.meta.state !== 'ready') throw new TypeError('Workspace is not ready; read status first.');
  const receipt = join(w.dir, 'intent-' + hash(requestKey) + '.json'), intent = hash({ operation: 'upload_apply', uploadId, ref: ref ?? null, path: path ?? null, ...(deletePaths ? { deletePaths } : {}), ...(mirror ? { mirror } : {}) });
  let lock;
  try { lock = await open(join(w.dir, 'mutation.lock'), 'wx', 0o600); } catch (error) { if (error.code === 'EEXIST') throw new TypeError('Workspace is leased. Inspect current state; interrupted leases require explicit operator recovery, never automatic write replay.'); throw error; }
  let plan;
  try {
    const current = await json(join(w.dir, 'workspace.json'));
    try { const old = await json(receipt); if (old.intent !== intent) throw new TypeError('Request key already belongs to different input.'); return { ...(old.result ?? { status: 'uncertain', next: 'Inspect local state before a new intent.' }), replayed: true }; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (expectedGeneration !== current.generation) throw new TypeError(`Stale expectedGeneration ${Number.isSafeInteger(expectedGeneration) ? expectedGeneration : 'missing'}: the workspace is at generation ${current.generation}. Nothing was applied. Call apply again with expectedGeneration ${current.generation} and a new requestKey.`);
    const stored = await record(p, binding);
    if (stored.mode === 'git' && (deletePaths || mirror)) return { status: 'refused', reason: 'deletePaths and mirror are for archive uploads. In git mode, delete the files in your commits (git rm) and push again.' };
    if (stored.state !== 'received') return { status: 'refused', reason: STATE_HELP[stored.state] ?? 'This upload is not ready to apply.' };
    if (worker.now() > stored.expiresAt + UPLOAD_RETENTION_MS) return { status: 'refused', reason: 'This upload expired before it was applied. Begin a new upload.' };
    const state = await worker.inspect(id, binding);
    try { plan = stored.mode === 'git' ? await planGit(worker, w, state, stored, p, { ref, uploadId }) : await planArchive(worker, w, stored, p, { path, deletePaths, mirror }); }
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
      await rm(p.data, { recursive: true, force: true }); await rm(p.data + '.lock', { force: true }); await rm(p.claimed, { force: true }); await rm(p.record, { force: true }); removed++;
    }
  }
  return { removed };
}
