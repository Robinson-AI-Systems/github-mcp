// GIT-REMOTE-1: Routing Middleware for `https://<origin>/git/<owner>/<repo>.git` (git smart HTTP).
//
// Each Git request is checked here BEFORE anything is forwarded: the session key from HTTP Basic
// (hash lookup in the key's own database, expiry, revocation, repository match, access level, and the
// connection it belongs to still being live). Only then is the request rewritten to the native Git
// worker, with the key and every other credential header stripped; the worker receives only a
// signed, short-lived claim naming this key, the repository's mirror and the one Git service. The
// destination is the configured worker origin only, never anything from the request: not an open proxy.
// Request bodies (pushes) never pass through this code (`skipMiddlewareRequestBody`).
import { publicOrigin } from '../core/http.js';
import { workerOrigin, rewriteResponse } from '../native-git/relay.js';
import { authorizeGitRequest } from './authorize.js';
import { openKeyScope } from './keys.js';
import { GIT_REALM, KEY_PREFIX, basicPassword, parseGitRequest as parseWire, parseSecret } from './wire.js';

export { GIT_PREFIX, GIT_REALM } from './wire.js';
/** Exactly what a Git smart-HTTP client needs; Authorization, cookies and everything else are dropped. */
export const REMOTE_FORWARDED_HEADERS = Object.freeze(['accept', 'accept-encoding', 'content-encoding', 'content-length', 'content-type', 'git-protocol', 'user-agent']);
export const CLAIM_HEADER = 'x-robinson-git-claim';

const text = (status, message, extra = {}) => new Response(message.endsWith('\n') ? message : message + '\n', { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...extra } });
// Git shows a text/plain error body to the person as `remote: <line>` (remote-curl show_http_message).
const challenge = message => text(401, message, { 'WWW-Authenticate': `Basic realm="${GIT_REALM}", charset="UTF-8"` });

/** What the request asks for, or a refusal Response. Only the fixed smart-HTTP shapes are accepted. */
export function parseGitRequest(method, url) {
 const wanted = parseWire(method, url);
 return wanted.refuse ? { refuse: text(wanted.refuse.status, wanted.refuse.message) } : wanted;
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
 const verdict = await authorizeGitRequest({ parsed, wanted, env, now, openScope, door: 'domain' });
 if (!verdict.ok) return verdict.challenge ? challenge(verdict.message) : text(verdict.status, verdict.message, verdict.retryAfter ? { 'Retry-After': String(verdict.retryAfter) } : {});
 const headers = new Headers();
 for (const name of REMOTE_FORWARDED_HEADERS) { const value = request.headers.get(name); if (value !== null) headers.set(name, value); }
 headers.set(CLAIM_HEADER, verdict.claim);
 return rewriteResponse(`${worker}/v1/remote/${wanted.suffix}`, headers);
}
