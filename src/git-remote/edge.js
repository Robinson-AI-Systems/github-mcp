// GIT-REMOTE-1: Routing Middleware for `https://<origin>/git/<owner>/<repo>.git` (git smart HTTP).
//
// Each Git request is checked here BEFORE anything is forwarded: the session key from HTTP Basic
// (hash lookup in the key's own database, expiry, revocation, repository match, access level, and the
// connection it belongs to still being live). Only then is the request rewritten to the native Git
// worker, with the key and every other credential header stripped; the worker receives only a
// signed, short-lived claim naming this key, the repository's mirror and the one Git service. The
// destination is the configured worker origin only, never anything from the request: not an open proxy.
// Request bodies (pushes) never pass through this code (`skipMiddlewareRequestBody`).
import { randomBytes } from 'node:crypto';
import { publicOrigin } from '../core/http.js';
import { workerOrigin, rewriteResponse } from '../native-git/relay.js';
import { REMOTE_PURPOSE, REMOTE_PACK_TTL_MS, REMOTE_REFS_TTL_MS } from '../native-git/protocol.js';
import { signGitRemoteClaim } from '../native-git/signing.js';
import { KEY_PREFIX, checkKey, liveConnection, mirrorId, openKeyScope, parseSecret } from './keys.js';

export const GIT_PREFIX = '/git/';
export const GIT_REALM = 'Robinson GitHub MCP git';
const PATH = /^\/git\/([A-Za-z0-9-]{1,39})\/([A-Za-z0-9_.-]{1,100})\/(info\/refs|git-upload-pack|git-receive-pack)$/;
/** Exactly what a Git smart-HTTP client needs; Authorization, cookies and everything else are dropped. */
export const REMOTE_FORWARDED_HEADERS = Object.freeze(['accept', 'accept-encoding', 'content-encoding', 'content-length', 'content-type', 'git-protocol', 'user-agent']);
export const CLAIM_HEADER = 'x-robinson-git-claim';

const text = (status, message, extra = {}) => new Response(message.endsWith('\n') ? message : message + '\n', { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...extra } });
// Git shows a text/plain error body to the person as `remote: <line>` (remote-curl show_http_message).
const challenge = message => text(401, message, { 'WWW-Authenticate': `Basic realm="${GIT_REALM}", charset="UTF-8"` });

function basicPassword(header) {
 const m = /^Basic[ \t]+([A-Za-z0-9+/=]{1,1024})$/i.exec(String(header ?? '').trim());
 if (!m) return null;
 const decoded = Buffer.from(m[1], 'base64').toString('utf8'), colon = decoded.indexOf(':');
 return colon < 0 ? null : decoded.slice(colon + 1);
}

/** What the request asks for, or a refusal. Only the fixed smart-HTTP shapes are accepted. */
export function parseGitRequest(method, url) {
 const m = PATH.exec(url.pathname);
 if (!m) return { refuse: text(404, 'This address serves git clone, fetch, pull and push only: https://<this service>/git/<owner>/<repository>.git') };
 const [, owner, rawRepo, route] = m;
 const repo = rawRepo.endsWith('.git') ? rawRepo.slice(0, -4) : rawRepo;
 if (!repo || ['.', '..'].includes(repo)) return { refuse: text(404, 'Not a repository address.') };
 if (route === 'info/refs') {
  const service = { '?service=git-upload-pack': 'git-upload-pack', '?service=git-receive-pack': 'git-receive-pack' }[url.search];
  if (!service) return { refuse: text(403, 'This address serves Git smart HTTP only (clone, fetch, pull, push). Update Git if it is very old.') };
  if (method !== 'GET') return { refuse: text(405, 'Use GET for the ref advertisement.') };
  return { owner, repo, service, step: 'refs', suffix: 'info/refs' + url.search };
 }
 if (method !== 'POST' || url.search) return { refuse: text(405, 'Use POST for Git packs.') };
 return { owner, repo, service: route, step: 'pack', suffix: route };
}

/**
 * The whole Routing Middleware answer for one /git/ request.
 * @param {Request} request
 * @param {object} [env]
 * @param {{ now?: () => number, openScope?: typeof openKeyScope }} [deps]
 */
export async function handleGitRemote(request, env = process.env, { now = Date.now, openScope = openKeyScope } = {}) {
 let url; try { url = new URL(request.url); } catch { return text(404, 'Not found.'); }
 const wanted = parseGitRequest(request.method, url);
 if (wanted.refuse) return wanted.refuse;
 const password = basicPassword(request.headers.get('authorization'));
 if (password === null) return challenge('Sign-in needed: this git address uses a session key from github_git_remote_setup. Ask your AI to call it for this repository and run the command it returns (it stores the key for this address only).');
 const parsed = parseSecret(password, KEY_PREFIX);
 if (!parsed) return challenge('This git session key is not valid. Ask your AI to call github_git_remote_setup for this repository and run the command it returns.');
 const worker = workerOrigin(env, false);
 let control; try { control = publicOrigin(env); } catch { control = null; }
 if (!worker || !control) return text(503, 'The git remote is not configured on this service yet. Use github_repo_download and github_repo_change meanwhile.');
 let scope;
 try { scope = await openScope(parsed.id, { env }); } catch { return text(503, 'The git remote could not check this key right now. Run the same command again in a minute.', { 'Retry-After': '30' }); }
 if (!scope) return challenge('This git session key is not valid (or the connection it belongs to has ended). Ask your AI to call github_git_remote_setup for this repository and run the command it returns.');
 const { db } = scope;
 const log = (outcome, detail = null) => db.recordGitRemoteUse({ keyId: parsed.id, service: `${wanted.service === 'git-receive-pack' ? 'push' : 'fetch'}.${wanted.step}`, outcome, detail }).catch(() => {});
 let row, connection;
 try {
  row = await db.getGitRemoteKey(parsed.id);
  const verdict = checkKey(row, parsed.hash, { service: wanted.service, owner: wanted.owner, repo: wanted.repo, now: now() });
  if (!verdict.ok) { if (row) await log('refused:' + verdict.reason); return verdict.status === 401 ? challenge(verdict.message) : text(verdict.status, verdict.message); }
  connection = await liveConnection(db, row, env);
  if (!connection) { await log('refused:connection_ended'); return challenge('The app connection this git session key belongs to was disconnected or changed. Connect again, then ask for a new key with github_git_remote_setup.'); }
  if (wanted.service === 'git-receive-pack' && connection.profile === 'read_only') { await log('refused:connection_read_only'); return text(403, 'Your connection is read-only now (My connection page), so git push is refused. Allow changes again there, or ask the owner.'); }
 } catch { return text(503, 'The git remote could not check this key right now. Run the same command again in a minute.', { 'Retry-After': '30' }); }
 const at = now();
 const claim = JSON.stringify({ purpose: REMOTE_PURPOSE, version: 1, key: row.id, mirror: mirrorId(row.connection, row.owner, row.repo), owner: row.owner, repo: row.repo,
  service: wanted.service, step: wanted.step, access: row.access, control, expiresAt: at + (wanted.step === 'pack' ? REMOTE_PACK_TTL_MS : REMOTE_REFS_TTL_MS), nonce: randomBytes(16).toString('hex') });
 let signed; try { signed = `${Buffer.from(claim).toString('base64url')}.${signGitRemoteClaim(claim, env)}`; } catch { return text(503, 'The git remote is not configured on this service yet.'); }
 await log('allowed');
 const headers = new Headers();
 for (const name of REMOTE_FORWARDED_HEADERS) { const value = request.headers.get(name); if (value !== null) headers.set(name, value); }
 headers.set(CLAIM_HEADER, signed);
 return rewriteResponse(`${worker}/v1/remote/${wanted.suffix}`, headers);
}
