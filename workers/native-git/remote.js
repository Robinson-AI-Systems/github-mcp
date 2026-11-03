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
import { spawn } from 'node:child_process';
import { chmod, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { redactExcerpt } from '../../src/github/content-protection.js';
import { REMOTE_MAX_PUSH_BYTES, verifyRemoteClaim } from '../../src/native-git/protocol.js';
import { gitEnvironment, gitPrefix } from './engine.js';

const MiB = 1024 * 1024;
export const REMOTE_LIMITS = Object.freeze({ requestBytes: 4 * MiB, refreshWaitMs: 90000, refreshTimeoutMs: 900000, serveMs: 900000, idleMs: 48 * 3600000, brokerMs: 20000 });
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
  const fetched = await runGit([...remotePrefix(ctx.local), 'fetch', '--prune', '--no-tags', '--no-write-fetch-head', '--quiet', '--no-recurse-submodules', '--', remote, '+refs/heads/*:refs/heads/*', '+refs/tags/*:refs/tags/*'],
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
 * Handles /v1/remote/info/refs, /v1/remote/git-upload-pack and /v1/remote/git-receive-pack.
 * @param {object} ctx `{ root, key, now, monitor, local, githubRemote(owner, repo), brokerUrl(control), fetchImpl }`
 */
export async function remoteHttp(req, res, ctx) {
 const url = new URL(req.url, 'http://worker.invalid');
 const route = { '/v1/remote/info/refs': 'refs', '/v1/remote/git-upload-pack': 'git-upload-pack', '/v1/remote/git-receive-pack': 'git-receive-pack' }[url.pathname];
 if (!route) { req.resume(); return reply(res, 404, 'Not found.'); }
 let claim;
 try { claim = verifyRemoteClaim(String(req.headers['x-robinson-git-claim'] ?? ''), ctx.key, ctx.now()); }
 catch (error) { req.resume(); return reply(res, 403, /expired/.test(error.message) ? 'This git request took too long to reach the worker. Run the git command again.' : 'This git request was not issued by this service. Use the remote URL from github_git_remote_setup.'); }
 const step = route === 'refs' ? 'refs' : 'pack';
 const service = route === 'refs' ? { '?service=git-upload-pack': 'git-upload-pack', '?service=git-receive-pack': 'git-receive-pack' }[url.search] : route;
 if (claim.step !== step || claim.service !== service || (step === 'refs' ? req.method !== 'GET' : req.method !== 'POST' || url.search !== '')) { req.resume(); return reply(res, 403, 'This git request does not match what the service checked. Run the git command again.'); }
 if (!ctx.local && new URL(claim.control).protocol !== 'https:') { req.resume(); return reply(res, 403, 'This git request was not issued by this service.'); }
 const brokerUrl = ctx.brokerUrl(claim.control);
 const claimToken = String(req.headers['x-robinson-git-claim']);
 if (ctx.monitor) { const check = await ctx.monitor.check({ needsDisk: step === 'refs' || service === 'git-receive-pack' }); if (!check.allowed) { req.resume(); return reply(res, 503, 'The git remote is short of memory or storage right now; nothing was changed. Run the same git command again shortly.', { 'Retry-After': '5' }); } }
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
   ROBINSON_REMOTE_SLUG: `${claim.owner}/${claim.repo}`, ...(ctx.local ? { ROBINSON_REMOTE_LOCAL: '1' } : {}) };
  const child = spawn('git', [...gitPrefix(), '-c', `core.hooksPath=${hooks}`, 'receive-pack', '--stateless-rpc', m.repo], { cwd: m.dir, env: hookEnv, stdio: ['pipe', 'pipe', 'ignore'], detached: true });
  const kill = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* ended */ } };
  const timer = setTimeout(kill, REMOTE_LIMITS.serveMs); timer.unref();
  const closed = new Promise(r => child.on('close', r));
  child.stdin.on('error', () => {});
  // The reply starts at once so a proxy in front sees the response begin; Git's keepalives follow during the hook.
  res.writeHead(200, { 'Content-Type': 'application/x-git-receive-pack-result', 'Cache-Control': 'no-store' }); res.flushHeaders();
  let over = false; const counter = counted(REMOTE_MAX_PUSH_BYTES + MiB, () => { over = true; });
  const output = pipeline(child.stdout, res).catch(() => { kill(); });
  try { await pipeline(...source, counter.stream, child.stdin); } catch { kill(); }
  await closed; await output; clearTimeout(timer);
  if (over && !res.writableEnded) res.destroy();
 });
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
