// GIT-DIRECT-1 (owner decision 2026-11-02, "Build it and beat GitHub's push"): the native worker serves
// the same `/git/<owner>/<repo>.git` smart-HTTP endpoints directly on its own public origin
// (GIT_DIRECT_ORIGIN, for example https://git.<domain>), so pushes and clones no longer pass Vercel's
// proxy and its size and time limits.
//
// The worker has no database. For every request it asks the control plane (op=authorize at
// GIT_DIRECT_CONTROL_ORIGIN), signed with this worker's own Ed25519 key, which lives on the volume and
// is reported to the control plane in the answer to its signed capabilities call (setup pins it). The
// worker sends only the session key's id and SHA-256: the key itself never leaves this process, is
// never logged and never goes into an onward request. The control plane runs the same check as Routing
// Middleware (hash, expiry, revocation, repository, access, live connection, read-only) and answers
// with the same kind of signed claim, which the shared core (remote.js serveRemote) then serves with
// every GIT-REMOTE-1 rail: mirror, quarantine and pre-receive hook, guard gates, scanner, change log,
// acting-as attribution, atomic leased push with read-back. Only the fixed Git paths are served; the
// worker never proxies, follows a redirect or contacts anything named by the request.
import { createServer } from 'node:http';
import { generateKeyPairSync, createPrivateKey, createPublicKey, randomBytes, sign } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { DIRECT_HEADER, GIT_REALM, KEY_PREFIX, basicPassword, cleanOrigin, directPayload, parseGitRequest, parseSecret } from '../../src/git-remote/wire.js';
import { serveRemote } from './remote.js';

const plainText = (res, status, message, headers = {}) => {
 if (res.headersSent) { res.destroy(); return; }
 res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
 res.end(message.endsWith('\n') ? message : message + '\n');
};
const challenge = (res, message) => plainText(res, 401, message, { 'WWW-Authenticate': `Basic realm="${GIT_REALM}", charset="UTF-8"` });

/** This worker's direct-host signing key: generated once on the volume (0600), never sent anywhere. */
export async function directIdentity(root) {
 const dir = join(root, '.git-direct');
 await mkdir(dir, { recursive: true, mode: 0o700 });
 if (await realpath(dir) !== dir) throw new TypeError('Direct host storage must not be a symlink.');
 const file = join(dir, 'identity.pem');
 let pem;
 try { pem = await readFile(file, 'utf8'); }
 catch (error) {
  if (error.code !== 'ENOENT') throw error;
  pem = generateKeyPairSync('ed25519').privateKey.export({ format: 'pem', type: 'pkcs8' });
  const temp = `${file}.${randomBytes(6).toString('hex')}`;
  await writeFile(temp, pem, { mode: 0o600, flag: 'wx' }); await rename(temp, file);
 }
 const privateKey = createPrivateKey(pem);
 const publicKey = 'ed25519:' + createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).toString('base64');
 return Object.freeze({ publicKey, sign: data => sign(null, data, privateKey).toString('base64url') });
}

/** The direct host's configuration from the worker environment, or null when it is not configured. */
export function directConfig(env = process.env, { local = false } = {}) {
 const origin = cleanOrigin(env.GIT_DIRECT_ORIGIN, { local }), control = cleanOrigin(env.GIT_DIRECT_CONTROL_ORIGIN, { local });
 if (!origin || !control) return null;
 const port = Number(env.GIT_DIRECT_PORT ?? 3001);
 if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new TypeError('GIT_DIRECT_PORT must be a port number.');
 return Object.freeze({ origin, control, port });
}

// ---- Failed sign-in attempts per source ---------------------------------------------------------
const PRIVATE = /^(?:127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|169\.254\.|::1$|f[cd][0-9a-f]{2}:|fe80:)/i;
/**
 * Where a request comes from. A request from a private or loopback address (the reverse proxy in front
 * of the worker, such as Traefik on the Docker network) is attributed to the last address that proxy
 * appended to X-Forwarded-For; a request from a public address is attributed to that address.
 */
export function sourceOf(req) {
 const peer = String(req.socket?.remoteAddress ?? '').replace(/^::ffff:/, '');
 if (!PRIVATE.test(peer)) return peer || 'unknown';
 const hops = String(req.headers['x-forwarded-for'] ?? '').split(',').map(s => s.trim()).filter(Boolean);
 const last = hops.at(-1);
 return last && /^[0-9a-fA-F.:]{2,45}$/.test(last) ? last.replace(/^::ffff:/, '') : peer || 'unknown';
}
/** At most `max` failed key attempts per source in a rolling `windowMs`; then refused until the window passes. */
export function createAttemptLimiter({ max = 20, windowMs = 10 * 60000, maxSources = 10000, now = Date.now } = {}) {
 const seen = new Map();
 const recent = source => { const list = (seen.get(source) ?? []).filter(t => now() - t < windowMs); if (list.length) seen.set(source, list); else seen.delete(source); return list; };
 return {
  blocked(source) { const list = recent(source); return list.length >= max ? Math.max(1, Math.ceil((list[0] + windowMs - now()) / 1000)) : 0; },
  fail(source) {
   const list = recent(source); list.push(now()); seen.delete(source); seen.set(source, list);
   while (seen.size > maxSources) seen.delete(seen.keys().next().value);
  },
  size: () => seen.size
 };
}

/** Asks the control plane whether this one request may be served. Never sends the key; never follows a redirect. */
export async function authorizeDirect({ control, identity, fetchImpl = fetch, now = Date.now, timeoutMs = 20000 }, body) {
 const at = String(now()), nonce = randomBytes(16).toString('hex');
 const canonical = JSON.stringify([body.id, body.hash, body.owner, body.repo, body.service, body.step]);
 let response;
 try {
  response = await fetchImpl(new URL('/api/git-remote?op=authorize', control).href, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
   headers: { 'Content-Type': 'application/json', [DIRECT_HEADER]: `${at}.${nonce}.${identity.sign(directPayload(at, nonce, canonical))}` }, body: JSON.stringify(body) });
 } catch { return { allow: false, status: 503, message: 'The git remote could not reach this service to check the key. Run the git command again in a minute.', retry_after: 30 }; }
 let text = '';
 try { for await (const chunk of response.body) { text += Buffer.from(chunk).toString('utf8'); if (text.length > 16384) throw new Error('size'); } } catch { text = ''; }
 let data = null; try { data = JSON.parse(text); } catch { data = null; }
 if (response.ok && data && typeof data === 'object') return data;
 if (response.status === 401 || response.status === 404) return { allow: false, status: 503, message: 'This direct git address is not set up on the service yet (or the worker changed). Ask your AI to call github_git_remote_setup again, or use the fallback address it gives.' };
 return { allow: false, status: 503, message: 'The git remote could not check the key right now. Run the git command again in a minute.', retry_after: 30 };
}

/**
 * The direct git host: its own HTTP server (a separate port, so the worker's other routes keep their own
 * timeouts). No total request deadline: a slow link may stream a large push for hours, while a
 * connection that sends nothing for `idleMs` is closed.
 * @param {object} o `{ root, key, now, monitor, local, githubRemote, brokerUrl, fetchImpl, limits, freeDisk, config, identity, limiter, idleMs }`
 */
export function gitDirectServer(o) {
 const { config, identity, now = Date.now, idleMs = 120000 } = o;
 const limiter = o.limiter ?? createAttemptLimiter({ now });
 const host = new URL(config.origin).host;
 const ctx = { root: o.root, key: o.key, now, monitor: o.monitor, local: o.local, githubRemote: o.githubRemote, brokerUrl: o.brokerUrl, fetchImpl: o.fetchImpl ?? fetch, limits: o.limits, freeDisk: o.freeDisk };
 const server = createServer({ requestTimeout: 0, headersTimeout: 15000, maxHeaderSize: 8192 }, async (req, res) => {
  try {
   req.socket.setTimeout(idleMs, () => req.socket.destroy());
   let url; try { url = new URL(req.url, 'http://direct.invalid'); } catch { req.resume(); return plainText(res, 404, 'Not found.'); }
   if (req.method === 'GET' && url.pathname === '/health') return plainText(res, 200, 'ok');
   // Only this worker's own configured name (a stray host name never reaches the git routes).
   if (String(req.headers.host ?? '').toLowerCase() !== host.toLowerCase()) { req.resume(); return plainText(res, 421, `This address serves git only at ${config.origin}/git/<owner>/<repository>.git`); }
   const wanted = parseGitRequest(req.method, url);
   if (wanted.refuse) { req.resume(); return plainText(res, wanted.refuse.status, wanted.refuse.message); }
   const source = sourceOf(req);
   const wait = limiter.blocked(source);
   if (wait) { req.resume(); return plainText(res, 429, `Too many failed git sign-in attempts from this network address. Wait about ${Math.ceil(wait / 60)} minute(s), then use a key from github_git_remote_setup.`, { 'Retry-After': String(wait) }); }
   const password = basicPassword(req.headers.authorization);
   // No key: git asks its credential helper (not a failed attempt).
   if (password === null) { req.resume(); return challenge(res, 'Sign-in needed: this git address uses a session key from github_git_remote_setup. Ask your AI to call it for this repository and run the command it returns (it stores the key for this address only).'); }
   const parsed = parseSecret(password, KEY_PREFIX);
   if (!parsed) { limiter.fail(source); req.resume(); return challenge(res, 'This git session key is not valid. Ask your AI to call github_git_remote_setup for this repository and run the command it returns.'); }
   const answer = await authorizeDirect({ control: config.control, identity, fetchImpl: ctx.fetchImpl, now }, { id: parsed.id, hash: parsed.hash, owner: wanted.owner, repo: wanted.repo, service: wanted.service, step: wanted.step });
   if (answer.allow !== true || typeof answer.claim !== 'string') {
    const status = [401, 403, 404, 503].includes(answer.status) ? answer.status : 403;
    if (status === 401) limiter.fail(source);
    req.resume();
    const message = typeof answer.message === 'string' ? answer.message.replace(/[\x00-\x09\x0b-\x1f\x7f]/g, ' ').slice(0, 400) : 'This git request was refused.';
    if (status === 401 && answer.challenge !== false) return challenge(res, message);
    return plainText(res, status, message, answer.retry_after ? { 'Retry-After': String(answer.retry_after) } : {});
   }
   const pushBytes = Number.isSafeInteger(answer.limits?.push_bytes) && answer.limits.push_bytes > 0 ? answer.limits.push_bytes : null;
   if (wanted.service === 'git-receive-pack' && !pushBytes) { req.resume(); return plainText(res, 503, 'The service did not say how large a push may be. Run the git command again.'); }
   return await serveRemote(req, res, ctx, { route: wanted.step === 'refs' ? 'refs' : wanted.service, search: url.search, claimToken: answer.claim, direct: { pushBytes: pushBytes ?? 0 } });
  } catch {
   // No key, claim, path or Git output leaves an unexpected failure.
   if (res.headersSent) res.destroy(); else plainText(res, 500, 'The git remote could not finish this request. Run the git command again.');
  }
 });
 server.on('clientError', (_error, socket) => socket.destroy());
 return server;
}
