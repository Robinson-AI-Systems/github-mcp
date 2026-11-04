// GIT-REMOTE-1: the git remote's worker side. Every request arrives from Routing Middleware with a
// signed, short-lived claim (x-robinson-git-claim) that names one session key, one repository mirror
// and one Git service; the person's key never reaches this worker, and no GitHub credential is stored.
//
// - Mirror: one bare repository per connection and repository (`.remotes/<mirror>/mirror.git`).
// - Fetch: the ref advertisement first refreshes the mirror from GitHub with a credential the control
//   plane's broker mints for that one request, then serves `upload-pack` (advertised tips only, no
//   filters, no hooks). The pack request is served from the mirror.
// - Push: `receive-pack` lands the objects in Git's quarantine and runs this worker's own pre-receive
//   hook (remote-hook.mjs, never repository content). The hook asks the broker (guard gates, change
//   log, credential), scans every new object with the repository's content protection, pushes to
//   GitHub atomically with a lease on what the client saw, and only then lets Git answer "ok". A
//   refusal reaches the client as `remote:` lines with a plain next step.
//
// GIT-DIRECT-1: the same core also serves the worker's own direct git host (direct.js), where the
// control plane's answer to op=authorize supplies the claim. There, a push streams straight from the
// client to Git's quarantine (never held in memory), up to the stored per-push limit, while the
// worker volume's free space is watched; a refusal reaches the client as `remote:` lines.
import { spawn } from 'node:child_process';
import { chmod, mkdir, readFile, readdir, realpath, rm, statfs, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { redactExcerpt } from '../../src/github/content-protection.js';
import { GITHUB_FILE_LIMIT_BYTES, GITHUB_PUSH_LIMIT_BYTES, REMOTE_MAX_PUSH_BYTES, verifyRemoteClaim } from '../../src/native-git/protocol.js';
import { gitEnvironment, gitPrefix } from './engine.js';
import { refusalText } from './resources.js';
import { githubSshRemote, httpVersionArgs } from './github-ssh.js';

const MiB = 1024 * 1024;
export const REMOTE_LIMITS = Object.freeze({ requestBytes: 4 * MiB, refreshWaitMs: 90000, refreshTimeoutMs: 900000, serveMs: 900000, idleMs: 48 * 3600000, brokerMs: 20000, directServeMs: 12 * 3600000 });
/**
 * What the pre-receive hook enforces and how the direct host guards the volume. Production uses these;
 * only local tests (allowLocalFixtures) may lower them.
 * - fileBytes: GitHub's per-file limit; a larger file is refused with a Git LFS explanation.
 * - githubPushBytes: GitHub's per-push limit; a larger push is sent on in batches (direct host).
 * - reserveBytes: free space kept on the volume beyond a push (mirror refreshes, other work).
 * - diskCheckBytes: how often (in received bytes) free space is measured during a direct push.
 */
export const REMOTE_DEFAULT_LIMITS = Object.freeze({ fileBytes: GITHUB_FILE_LIMIT_BYTES, githubPushBytes: GITHUB_PUSH_LIMIT_BYTES, reserveBytes: 512 * MiB, diskCheckBytes: 16 * MiB });
const HOOK = fileURLToPath(new URL('./remote-hook.mjs', import.meta.url));
// The mirror is ours: no hooks except the worker's own pre-receive (given per push on the command line),
// no filters, only advertised tips may be wanted, every received object is checked.
const MIRROR_CONFIG = '[core]\n\thooksPath = /dev/null\n\tfsmonitor = false\n\tlogAllRefUpdates = false\n[uploadpack]\n\tallowFilter = false\n\tallowTipSHA1InWant = false\n\tallowReachableSHA1InWant = false\n\tallowAnySHA1InWant = false\n\tallowRefInWant = false\n' +
 `[receive]\n\tfsckObjects = true\n\tdenyDeletes = false\n\tdenyNonFastForwards = false\n\tmaxInputSize = ${REMOTE_MAX_PUSH_BYTES}\n\tadvertisePushOptions = false\n\tshallowUpdate = false\n\tautogc = false\n\tunpackLimit = 1\n\tkeepAlive = 5\n[transfer]\n\tfsckObjects = true\n[gc]\n\tauto = 0\n`;
const refreshing = new Map(), locks = new Map();

function reply(res, status, message, headers = {}) {
 if (res.headersSent) { res.destroy(); return; }
 res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
 res.end(message + '\n');
}
const plain = value => redactExcerpt(String(value ?? '')).replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 300);

/** Serializes refreshes and pushes of one mirror inside this process (one process per volume). */
async function locked(mirror, fn) {
 const prior = locks.get(mirror) ?? Promise.resolve();
 let release; const mine = new Promise(r => { release = r; });
 const chain = prior.then(() => mine); locks.set(mirror, chain);
 await prior;
 try { return await fn(); } finally { release(); if (locks.get(mirror) === chain) locks.delete(mirror); }
}

export function runGit(args, { cwd, env, input, timeoutMs = 45000, maxOutputBytes = 8 * MiB } = {}) {
 return new Promise((resolve, reject) => {
  const child = spawn('git', args, { cwd, env, stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'], detached: true });
  const out = [], err = []; let bytes = 0, problem = null;
  const kill = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* ended */ } };
  const timer = setTimeout(() => { problem = 'timeout'; kill(); }, timeoutMs);
  const take = list => chunk => { bytes += chunk.length; if (bytes > maxOutputBytes) { problem = 'output'; kill(); } else list.push(chunk); };
  child.stdout.on('data', take(out)); child.stderr.on('data', take(err));
  if (input) { child.stdin.on('error', () => {}); child.stdin.end(input); }
  child.on('error', error => { clearTimeout(timer); reject(error); });
  child.on('close', code => { clearTimeout(timer); if (problem) reject(new Error(problem)); else resolve({ code, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8') }); });
 });
}
/** Git with the worker's fixed safety configuration; `local` (tests only) also allows plain-HTTP fixture remotes. */
export const remotePrefix = local => [...gitPrefix(), ...(local ? ['-c', 'protocol.http.allow=always'] : [])];
/** The credential goes in an environment-only header for exactly this remote; never on a command line. */
export function tokenEnvironment(base, remote, token) {
 return { ...base, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: `http.${remote}.extraheader`, GIT_CONFIG_VALUE_0: 'Authorization: Basic ' + Buffer.from('x-access-token:' + token).toString('base64') };
}

export async function callBroker(url, claimToken, body, { fetchImpl = fetch, timeoutMs = REMOTE_LIMITS.brokerMs } = {}) {
 let response;
 try { response = await fetchImpl(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutMs), headers: { 'Content-Type': 'application/json', 'x-robinson-git-claim': claimToken }, body: JSON.stringify(body) }); }
 catch { return { allow: false, message: 'The service could not be reached to check this request. Run the git command again in a minute.' }; }
 let text = '';
 try { for await (const chunk of response.body) { text += Buffer.from(chunk).toString('utf8'); if (text.length > 65536) throw new Error('size'); } } catch { return { allow: false, message: 'The service answered unexpectedly. Run the git command again.' }; }
 let data; try { data = JSON.parse(text); } catch { data = null; }
 if (!data || typeof data !== 'object') return { allow: false, message: 'The service answered unexpectedly. Run the git command again.' };
 if (!response.ok && data.allow !== false) return { allow: false, message: typeof data.message === 'string' ? data.message : response.status === 409 ? 'This git request was already used. Run the git command again.' : 'The service refused this git request. Run the git command again.' };
 return data;
}

async function mirrorDir(root, mirror) {
 const base = join(root, '.remotes'); await mkdir(base, { recursive: true, mode: 0o700 });
 if (await realpath(base) !== base) throw new TypeError('Remote storage must not be a symlink.');
 const dir = join(base, mirror), repo = join(dir, 'mirror.git');
 try { await mkdir(dir, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
 if (await realpath(dir) !== dir) throw new TypeError('Remote storage must not be a symlink.');
 try { await readFile(join(repo, 'HEAD')); }
 catch {
  await rm(repo, { recursive: true, force: true });
  const made = await runGit([...gitPrefix(), 'init', '--bare', '--quiet', '--template=', 'mirror.git'], { cwd: dir, env: gitEnvironment(root) });
  if (made.code !== 0) throw new Error('init');
  await writeFile(join(repo, 'config'), await readFile(join(repo, 'config'), 'utf8') + MIRROR_CONFIG, { mode: 0o600 });
 }
 return { dir, repo };
}
const touch = (dir, claim, now) => writeFile(join(dir, 'remote.json'), JSON.stringify({ lastUsedAt: now, owner: claim.owner, repo: claim.repo }), { mode: 0o600 }).catch(() => {});

/** Brings the mirror up to date with GitHub (branches and tags, pruned). One refresh per mirror at a time. */
function refresh(ctx, claim, m, credential, defaultBranch) {
 const running = refreshing.get(claim.mirror);
 if (running) return running;
 const task = locked(claim.mirror, async () => {
  const remote = ctx.githubRemote(claim.owner, claim.repo);
  const env = tokenEnvironment(gitEnvironment(ctx.root), remote, credential);
  const fetched = await runGit([...remotePrefix(ctx.local), ...httpVersionArgs(ctx.githubTransport?.httpVersion), 'fetch', '--prune', '--no-tags', '--no-write-fetch-head', '--quiet', '--no-recurse-submodules', '--', remote, '+refs/heads/*:refs/heads/*', '+refs/tags/*:refs/tags/*'],
   { cwd: m.repo, env, timeoutMs: REMOTE_LIMITS.refreshTimeoutMs });
  if (fetched.code !== 0) return { ok: false, message: 'GitHub refused or did not answer the refresh of this repository. Run the git command again; if it keeps failing, check that this connection can still read the repository.' };
  if (typeof defaultBranch === 'string' && /^[^\x00-\x20\x7f~^:?*[\\]{1,250}$/.test(defaultBranch) && !defaultBranch.startsWith('-')) {
   const has = await runGit([...gitPrefix(), 'show-ref', '--verify', '--quiet', 'refs/heads/' + defaultBranch], { cwd: m.repo, env: gitEnvironment(ctx.root) });
   if (has.code === 0) await runGit([...gitPrefix(), 'symbolic-ref', 'HEAD', 'refs/heads/' + defaultBranch], { cwd: m.repo, env: gitEnvironment(ctx.root) });
  }
  return { ok: true };
 }).catch(() => ({ ok: false, message: 'The refresh from GitHub did not finish. Run the git command again.' })).finally(() => { refreshing.delete(claim.mirror); });
 refreshing.set(claim.mirror, task);
 return task;
}

function counted(limit, onOver) {
 let total = 0;
 return { stream: new Transform({ transform(chunk, _e, done) { total += chunk.length; if (total > limit) { onOver(); done(new RangeError('over')); } else done(null, chunk); } }), total: () => total };
}

/**
 * Handles /v1/remote/info/refs, /v1/remote/git-upload-pack and /v1/remote/git-receive-pack (the domain door:
 * Routing Middleware forwards the signed claim in a header).
 * @param {object} ctx `{ root, key, now, monitor, local, githubRemote(owner, repo), brokerUrl(control), fetchImpl, limits, freeDisk }`
 */
export async function remoteHttp(req, res, ctx) {
 const url = new URL(req.url, 'http://worker.invalid');
 const route = { '/v1/remote/info/refs': 'refs', '/v1/remote/git-upload-pack': 'git-upload-pack', '/v1/remote/git-receive-pack': 'git-receive-pack' }[url.pathname];
 if (!route) { req.resume(); return reply(res, 404, 'Not found.'); }
 return serveRemote(req, res, ctx, { route, search: url.search, claimToken: String(req.headers['x-robinson-git-claim'] ?? '') });
}

/**
 * The shared core of both doors once a claim is in hand. `direct` (the direct host only) carries the
 * control plane's stored per-push limit.
 * @param {{ route: 'refs'|'git-upload-pack'|'git-receive-pack', search: string, claimToken: string, direct?: { pushBytes: number } | null }} wanted
 */
export async function serveRemote(req, res, ctx, { route, search, claimToken, direct = null }) {
 let claim;
 try { claim = verifyRemoteClaim(claimToken, ctx.key, ctx.now()); }
 catch (error) { req.resume(); return reply(res, 403, /expired/.test(error.message) ? 'This git request took too long to reach the worker. Run the git command again.' : 'This git request was not issued by this service. Use the remote URL from github_git_remote_setup.'); }
 // Each door accepts only its own claims (a direct claim lasts longer and never travels in a header).
 if ((claim.door === 'direct') !== Boolean(direct)) { req.resume(); return reply(res, 403, 'This git request was not issued by this service. Use the remote URL from github_git_remote_setup.'); }
 const step = route === 'refs' ? 'refs' : 'pack';
 const service = route === 'refs' ? { '?service=git-upload-pack': 'git-upload-pack', '?service=git-receive-pack': 'git-receive-pack' }[search] : route;
 if (claim.step !== step || claim.service !== service || (step === 'refs' ? req.method !== 'GET' : req.method !== 'POST' || search !== '')) { req.resume(); return reply(res, 403, 'This git request does not match what the service checked. Run the git command again.'); }
 if (!ctx.local && new URL(claim.control).protocol !== 'https:') { req.resume(); return reply(res, 403, 'This git request was not issued by this service.'); }
 const limits = { ...REMOTE_DEFAULT_LIMITS, ...(ctx.limits ?? {}) };
 const brokerUrl = ctx.brokerUrl(claim.control);
 if (ctx.monitor) { const check = await ctx.monitor.check({ needsDisk: step === 'refs' || service === 'git-receive-pack' }); if (!check.allowed) { req.resume(); return reply(res, 503, refusalText(check, 'The git remote is short of memory or storage right now; nothing was changed. Run the same git command again shortly.'), { 'Retry-After': String(check.reason === 'owner_paused' ? check.retryAfterSeconds : 5) }); } }
 let m; try { m = await mirrorDir(ctx.root, claim.mirror); } catch { req.resume(); return reply(res, 500, 'The git remote storage is unavailable. Run the git command again later.'); }
 await touch(m.dir, claim, ctx.now());
 const env = gitEnvironment(ctx.root);
 if (step === 'refs') {
  req.resume();
  const answer = await callBroker(brokerUrl, claimToken, { phase: 'fetch' }, { fetchImpl: ctx.fetchImpl });
  if (answer.allow !== true || typeof answer.credential !== 'string') return reply(res, 403, plain(answer.message ?? 'The service refused this git request.'));
  const task = refresh(ctx, claim, m, answer.credential, answer.default_branch);
  const done = await Promise.race([task, new Promise(r => setTimeout(() => r(null), REMOTE_LIMITS.refreshWaitMs).unref())]);
  if (done === null) return reply(res, 503, 'This repository is still being copied from GitHub to the git remote (a large repository takes a while the first time). Run the same git command again in a minute.', { 'Retry-After': '60' });
  if (!done.ok) return reply(res, 502, done.message);
  if (direct && service === 'git-receive-pack') {
   const free = await freeBytes(ctx);
   if (free !== null && free < limits.reserveBytes) return reply(res, 507, `The git remote's storage is nearly full (${size(free)} free; it keeps ${size(limits.reserveBytes)} in reserve), so this push is refused before it starts. Nothing was changed. Try again later, or push through ${claim.control}/git/${claim.owner}/${claim.repo}.git.`, { 'Retry-After': '300' });
  }
  const advertised = await runGit([...gitPrefix(), service.slice(4), '--stateless-rpc', '--advertise-refs', m.repo], { cwd: m.dir, env, timeoutMs: 30000, maxOutputBytes: 64 * MiB }).catch(() => null);
  if (!advertised || advertised.code !== 0) return reply(res, 500, 'The git remote could not list this repository. Run the git command again.');
  const line = `# service=${service}\n`, header = (line.length + 4).toString(16).padStart(4, '0') + line + '0000';
  res.writeHead(200, { 'Content-Type': `application/x-${service}-advertisement`, 'Cache-Control': 'no-store' });
  return res.end(Buffer.concat([Buffer.from(header), Buffer.from(advertised.stdout, 'utf8')]));
 }
 if (req.headers['content-type'] !== `application/x-${service}-request`) { req.resume(); return reply(res, 415, 'This address serves Git smart HTTP only.'); }
 const source = req.headers['content-encoding'] === 'gzip' ? [req, createGunzip()] : [req];
 if (service === 'git-upload-pack') {
  // The fetch request (wants/haves) is small; the pack streams back.
  const chunks = []; let total = 0;
  try { for await (const chunk of req.headers['content-encoding'] === 'gzip' ? req.pipe(createGunzip()) : req) { total += chunk.length; if (total > REMOTE_LIMITS.requestBytes) throw new RangeError('over'); chunks.push(chunk); } }
  catch { return reply(res, 413, 'The fetch request is too large; fetch fewer refs or clone into an empty folder.'); }
  const child = spawn('git', [...gitPrefix(), 'upload-pack', '--stateless-rpc', m.repo], { cwd: m.dir, env, stdio: ['pipe', 'pipe', 'ignore'], detached: true });
  const kill = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* ended */ } };
  const timer = setTimeout(kill, REMOTE_LIMITS.serveMs); timer.unref();
  child.stdin.on('error', () => {}); child.stdin.end(Buffer.concat(chunks));
  res.writeHead(200, { 'Content-Type': 'application/x-git-upload-pack-result', 'Cache-Control': 'no-store' }); res.flushHeaders();
  try { await pipeline(child.stdout, res); } catch { kill(); if (!res.writableEnded) res.destroy(); }
  clearTimeout(timer); return;
 }
 // Push. Git's quarantine holds the objects until the worker's pre-receive hook has pushed them to GitHub.
 return locked(claim.mirror, async () => {
  const hooks = await hookDirectory(ctx.root);
  const hookEnv = { ...env, ROBINSON_REMOTE_CLAIM: claimToken, ROBINSON_REMOTE_BROKER: brokerUrl, ROBINSON_REMOTE_GITHUB: ctx.githubRemote(claim.owner, claim.repo), ROBINSON_REMOTE_ROOT: ctx.root,
   ROBINSON_REMOTE_SLUG: `${claim.owner}/${claim.repo}`, ROBINSON_REMOTE_FILE_LIMIT: String(limits.fileBytes), ROBINSON_REMOTE_GITHUB_LIMIT: String(limits.githubPushBytes),
   ...(direct ? { ROBINSON_REMOTE_DIRECT: '1' } : {}), ...transportEnvironment(ctx, claim), ...(ctx.local ? { ROBINSON_REMOTE_LOCAL: '1', ...(limits.renewMs !== undefined ? { ROBINSON_REMOTE_RENEW_MS: String(limits.renewMs) } : {}) } : {}) };
  if (direct) return directReceive(req, res, { ctx, m, hooks, hookEnv, limits, pushBytes: direct.pushBytes, decoded: req.headers['content-encoding'] === 'gzip' ? req.pipe(createGunzip()) : req });
  const child = spawn('git', [...gitPrefix(), '-c', `core.hooksPath=${hooks}`, 'receive-pack', '--stateless-rpc', m.repo], { cwd: m.dir, env: hookEnv, stdio: ['pipe', 'pipe', 'ignore'], detached: true });
  const kill = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* ended */ } };
  const timer = setTimeout(kill, REMOTE_LIMITS.serveMs); timer.unref();
  const closed = new Promise(r => child.on('close', r));
  child.stdin.on('error', () => {});
  // RELAY-OWNER-1: the reply never starts before Git does. Git writes nothing until it has read the whole pack
  // (its keepalives start right after, during the hook), so no response header reaches a proxy in front while the
  // push is still uploading. A Go net/http front (Tailscale Funnel) that sees a response begin with under 256 KiB
  // of the request unread reads and drops the rest itself, which corrupted or cut off mid-size pushes.
  let over = false; const counter = counted(REMOTE_MAX_PUSH_BYTES + MiB, () => { over = true; });
  const output = replyWhenGitWrites(child.stdout, res).catch(() => { kill(); });
  try { await pipeline(...source, counter.stream, child.stdin); } catch { kill(); }
  await closed; await output; clearTimeout(timer);
  if (over && !res.writableEnded) res.destroy();
 });
}

/** Streams Git's answer, sending the response header with its first byte (or at the end when it wrote none). */
export async function replyWhenGitWrites(stdout, res, contentType = 'application/x-git-receive-pack-result') {
 const start = () => { if (!res.headersSent) res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' }); };
 const gone = new Promise(resolve => res.once('close', resolve));
 for await (const chunk of stdout) {
  if (res.destroyed) throw new Error('client gone');
  start();
  if (!res.write(chunk)) await Promise.race([new Promise(resolve => res.once('drain', resolve)), gone]);
 }
 if (res.destroyed) throw new Error('client gone');
 start(); res.end();
}

// ---- GIT-DIRECT-1: the direct host's streamed push ------------------------------------------
const GiB = 1024 * MiB;
export const size = n => n >= GiB ? `${(n / GiB).toFixed(2)} GiB` : n >= MiB ? `${(n / MiB).toFixed(1)} MiB` : `${Math.max(0, Math.round(n / 1024))} KiB`;
async function freeBytes(ctx) {
 try { const s = await (ctx.freeDisk ?? (() => statfs(ctx.root)))(); const free = Number(s.bavail) * Number(s.bsize); return Number.isFinite(free) && free >= 0 ? free : null; }
 catch { return null; }
}
const pkt = payload => { const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload); return Buffer.concat([Buffer.from((body.length + 4).toString(16).padStart(4, '0')), body]); };
const FLUSH = Buffer.from('0000');
/**
 * The push commands at the head of a receive-pack request: `{ refs, caps, end }` (end = bytes up to and
 * including the flush packet), `{ incomplete: true }` while more bytes are needed, or `{ invalid: true }`.
 */
export function pushCommands(head) {
 const refs = []; let caps = [], at = 0;
 for (;;) {
  if (head.length < at + 4) return { incomplete: true };
  const len = parseInt(head.subarray(at, at + 4).toString('latin1'), 16);
  if (!Number.isInteger(len) || !/^[0-9a-f]{4}$/.test(head.subarray(at, at + 4).toString('latin1'))) return { invalid: true };
  if (len === 0) return { refs, caps, end: at + 4 };
  if (len < 4) return { invalid: true };
  if (head.length < at + len) return { incomplete: true };
  let line = head.subarray(at + 4, at + len).toString('utf8');
  const nul = line.indexOf('\0');
  if (nul >= 0) { if (!refs.length) caps = line.slice(nul + 1).trim().split(' ').filter(Boolean); line = line.slice(0, nul); }
  const [, , ref] = line.replace(/\n$/, '').split(' ');
  if (!/^shallow /.test(line) && !/^push-cert/.test(line)) { if (!ref) return { invalid: true }; refs.push(ref); }
  at += len;
 }
}
/** A receive-pack answer refusing every ref, with `messages` shown to the person as `remote:` lines. */
export function refusalReport(commands, messages, reason) {
 const caps = new Set(commands?.caps ?? []), parts = [];
 const report = Buffer.concat([pkt(`unpack ${reason}\n`), ...(commands?.refs ?? []).map(ref => pkt(`ng ${ref} ${reason}\n`)), FLUSH]);
 if (caps.has('side-band-64k') || caps.has('side-band')) {
  for (const line of messages) parts.push(pkt(Buffer.concat([Buffer.from([2]), Buffer.from(String(line).replace(/[\x00-\x09\x0b-\x1f\x7f]/g, ' ') + '\n')])));
  if (caps.has('report-status') || caps.has('report-status-v2')) parts.push(pkt(Buffer.concat([Buffer.from([1]), report])));
  parts.push(FLUSH);
 } else if (caps.has('report-status') || caps.has('report-status-v2')) parts.push(report);
 return Buffer.concat(parts);
}

/**
 * Streams one push from the client into receive-pack (and so into Git's quarantine on disk), never
 * holding it in memory. Refuses plainly — after reading the rest of the request, so the client is
 * listening — when the push is over `pushBytes` or the volume would drop below its reserve.
 */
async function directReceive(req, res, { ctx, m, hooks, hookEnv, limits, pushBytes, decoded }) {
 const iterator = decoded[Symbol.asyncIterator]();
 const declared = req.headers['content-encoding'] === 'gzip' ? null : Number(req.headers['content-length'] ?? NaN);
 let head = Buffer.alloc(0), commands = null, total = 0, refusal = null;
 const refuse = (reason, ...messages) => { refusal ??= { reason, messages }; };
 const drain = async () => { try { for (;;) { const { done } = await iterator.next(); if (done) break; } } catch { /* the client went away */ } };
 const answer = () => { if (res.headersSent) { res.destroy(); return; } res.writeHead(200, { 'Content-Type': 'application/x-git-receive-pack-result', 'Cache-Control': 'no-store' }); res.end(refusalReport(commands, refusal.messages, refusal.reason)); };
 const limitLines = over => [`Refused: this push is ${over ? 'larger than' : 'about'} ${size(pushBytes)}, the git remote's per-push limit (stored setting git_remote.push_limit; GitHub's own limit is ${size(limits.githubPushBytes)}). Nothing was pushed to GitHub.`,
  'Next: push fewer commits at a time (for example git push origin <older-commit>:<branch> first), or ask the owner to raise git_remote.push_limit.'];
 // 1. The commands (small) come first; nothing is spawned before they are complete.
 try {
  while (!commands) {
   const { value, done } = await iterator.next();
   if (done) break;
   head = Buffer.concat([head, value]); total += value.length;
   const parsed = pushCommands(head);
   if (parsed.invalid || (parsed.incomplete && head.length > 65536)) { await drain(); return reply(res, 400, 'This is not a git push request.'); }
   if (!parsed.incomplete) commands = parsed;
  }
 } catch { return res.destroy(); }
 if (!commands) return reply(res, 400, 'This is not a git push request.');
 if (Number.isSafeInteger(declared) && declared > pushBytes + MiB) refuse('push-too-large', ...limitLines(true));
 const free = await freeBytes(ctx);
 if (!refusal && free !== null && Number.isSafeInteger(declared) && free - declared < limits.reserveBytes)
  refuse('storage-full', `Refused: this push (${size(declared)}) does not fit on the git remote's storage (${size(free)} free, ${size(limits.reserveBytes)} kept in reserve). Nothing was pushed to GitHub.`, 'Next: try again later, or push fewer commits at a time.');
 if (refusal) { await drain(); return answer(); }
 // 2. receive-pack with the worker's own hook; the pack goes to Git's quarantine on disk as it arrives.
 const child = spawn('git', [...gitPrefix(), '-c', `core.hooksPath=${hooks}`, '-c', `receive.maxInputSize=${pushBytes + MiB}`, 'receive-pack', '--stateless-rpc', m.repo], { cwd: m.dir, env: hookEnv, stdio: ['pipe', 'pipe', 'ignore'], detached: true });
 const kill = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* ended */ } };
 const timer = setTimeout(kill, REMOTE_LIMITS.directServeMs); timer.unref();
 const closed = new Promise(r => child.on('close', r));
 child.stdin.on('error', () => {});
 // Git answers only after the whole pack; the first byte it writes starts the reply.
 const forward = chunk => { if (refusal) return; if (!res.headersSent) { res.writeHead(200, { 'Content-Type': 'application/x-git-receive-pack-result', 'Cache-Control': 'no-store' }); res.flushHeaders(); } res.write(chunk); };
 child.stdout.on('data', forward);
 // Backpressure: wait for Git to take the bytes (or to end), so the push never piles up in memory.
 const write = chunk => child.stdin.write(chunk) ? undefined : Promise.race([new Promise(resolve => child.stdin.once('drain', resolve)), closed]);
 let nextCheck = limits.diskCheckBytes, aborted = false;
 try {
  await write(head);
  for (;;) {
   const { value, done } = await iterator.next();
   if (done) break;
   total += value.length;
   if (total > pushBytes + MiB) { refuse('push-too-large', ...limitLines(true)); break; }
   if (total >= nextCheck) {
    nextCheck = total + limits.diskCheckBytes;
    const now = await freeBytes(ctx);
    if (now !== null && now < limits.reserveBytes) { refuse('storage-full', `Refused: the git remote's storage filled up while receiving this push (${size(total)} received, ${size(now)} free, ${size(limits.reserveBytes)} kept in reserve). Nothing was pushed to GitHub.`, 'Next: try again later, or push fewer commits at a time.'); break; }
   }
   await write(value);
  }
 } catch { aborted = true; }
 if (refusal || aborted) {
  child.stdout.off('data', forward); kill(); await closed; clearTimeout(timer);
  if (aborted) return res.destroy();
  await drain(); return answer();
 }
 child.stdin.end();
 await closed; clearTimeout(timer);
 if (!res.headersSent) { res.writeHead(200, { 'Content-Type': 'application/x-git-receive-pack-result', 'Cache-Control': 'no-store' }); }
 res.end();
}

/**
 * GIT-SSH-LEG-1: the worker's GitHub transport settings for the hook (server.js reads them from the environment once).
 * Local tests may point the SSH leg at a fixture host and ssh program.
 */
function transportEnvironment(ctx, claim) {
 const t = ctx.githubTransport;
 if (!t) return {};
 return { ...(t.transport === 'ssh' ? { ROBINSON_REMOTE_TRANSPORT: 'ssh', ROBINSON_REMOTE_GITHUB_SSH: (ctx.local && ctx.githubSshRemote ? ctx.githubSshRemote : githubSshRemote)(claim.owner, claim.repo, t.sshPort) } : {}),
  ...(t.httpVersion ? { ROBINSON_REMOTE_HTTP_VERSION: t.httpVersion } : {}),
  ...(ctx.local && t.sshBinary ? { ROBINSON_REMOTE_SSH_BINARY: t.sshBinary } : {}), ...(ctx.local && t.sshTmp ? { ROBINSON_REMOTE_SSH_TMP: t.sshTmp } : {}) };
}

let hookDir = null;
async function hookDirectory(root) {
 if (hookDir?.root === root) return hookDir.path;
 const path = join(root, '.remote-hooks');
 await mkdir(path, { recursive: true, mode: 0o700 });
 if (await realpath(path) !== path) throw new TypeError('Hook storage must not be a symlink.');
 const script = `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(HOOK)}\n`;
 await writeFile(join(path, 'pre-receive'), script, { mode: 0o700 }); await chmod(join(path, 'pre-receive'), 0o700);
 hookDir = { root, path };
 return path;
}

/** Removes mirrors idle for two days (keys last at most 24 hours; a new key refreshes from GitHub anyway). */
export async function pruneRemotes(root, now = Date.now()) {
 const base = join(root, '.remotes'); let removed = 0;
 for (const id of await readdir(base).catch(error => error.code === 'ENOENT' ? [] : Promise.reject(error))) {
  if (!/^[a-f0-9]{64}$/.test(id) || locks.has(id) || refreshing.has(id)) continue;
  const dir = join(base, id);
  let meta = null; try { meta = JSON.parse(await readFile(join(dir, 'remote.json'), 'utf8')); } catch { meta = null; }
  if (meta && Number.isSafeInteger(meta.lastUsedAt) && now - meta.lastUsedAt < REMOTE_LIMITS.idleMs) continue;
  await rm(dir, { recursive: true, force: true }); removed++;
 }
 return { removed };
}
export const remoteHookPath = () => HOOK;
