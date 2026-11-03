// GIT-REMOTE-1 / GIT-DIRECT-1: the parts of the git remote's wire format that both doors share —
// Routing Middleware on this service's own domain and the native worker's direct git host. Only
// node:crypto; nothing here reads a database or a credential store, so the worker image can carry it.
//
// - parseGitRequest: the fixed Git smart-HTTP shapes accepted at /git/<owner>/<repo>.git/…
// - basicPassword / parseSecret: the session key from HTTP Basic, reduced to `{ id, hash }` at once.
// - The direct host's worker → control-plane signature (`x-robinson-git-worker`): Ed25519 over a
//   purpose label, a timestamp, a nonce and the SHA-256 of the body, by a key the worker generates
//   on its own volume and reports in its signed-capabilities answer. It carries no secret.
import { createHash } from 'node:crypto';

export const KEY_PREFIX = 'rgk_';
export const CODE_PREFIX = 'rgc_';
export const GIT_PREFIX = '/git/';
export const GIT_REALM = 'GitHub Unleashed git';
const ID = /^[a-f0-9]{32}$/;
const SECRET = /^[A-Za-z0-9_-]{43}$/;
const PATH = /^\/git\/([A-Za-z0-9-]{1,39})\/([A-Za-z0-9_.-]{1,100})\/(info\/refs|git-upload-pack|git-receive-pack)$/;

export const sha256 = value => createHash('sha256').update(value).digest('hex');

/** `{ id, hash }` of a well-formed code or key, else null. Nothing about the secret is kept but its hash. */
export function parseSecret(value, prefix) {
 if (typeof value !== 'string' || value.length !== prefix.length + 32 + 1 + 43 || !value.startsWith(prefix)) return null;
 const id = value.slice(prefix.length, prefix.length + 32), secret = value.slice(prefix.length + 33);
 if (!ID.test(id) || value[prefix.length + 32] !== '_' || !SECRET.test(secret)) return null;
 return { id, hash: sha256(value) };
}

/** The password half of an HTTP Basic header, or null. */
export function basicPassword(header) {
 const m = /^Basic[ \t]+([A-Za-z0-9+/=]{1,1024})$/i.exec(String(header ?? '').trim());
 if (!m) return null;
 const decoded = Buffer.from(m[1], 'base64').toString('utf8'), colon = decoded.indexOf(':');
 return colon < 0 ? null : decoded.slice(colon + 1);
}

/**
 * What a /git/ request asks for — `{ owner, repo, service, step, suffix }` — or `{ refuse: { status, message } }`.
 * Only the fixed smart-HTTP shapes are accepted.
 * @param {string} method
 * @param {URL} url
 */
export function parseGitRequest(method, url) {
 const m = PATH.exec(url.pathname);
 if (!m) return { refuse: { status: 404, message: 'This address serves git clone, fetch, pull and push only: https://<this service>/git/<owner>/<repository>.git' } };
 const [, owner, rawRepo, route] = m;
 const repo = rawRepo.endsWith('.git') ? rawRepo.slice(0, -4) : rawRepo;
 if (!repo || ['.', '..'].includes(repo)) return { refuse: { status: 404, message: 'Not a repository address.' } };
 if (route === 'info/refs') {
  const service = { '?service=git-upload-pack': 'git-upload-pack', '?service=git-receive-pack': 'git-receive-pack' }[url.search];
  if (!service) return { refuse: { status: 403, message: 'This address serves Git smart HTTP only (clone, fetch, pull, push). Update Git if it is very old.' } };
  if (method !== 'GET') return { refuse: { status: 405, message: 'Use GET for the ref advertisement.' } };
  return { owner, repo, service, step: 'refs', suffix: 'info/refs' + url.search };
 }
 if (method !== 'POST' || url.search) return { refuse: { status: 405, message: 'Use POST for Git packs.' } };
 return { owner, repo, service: route, step: 'pack', suffix: route };
}

// ---- The direct host's worker signature -------------------------------------------------------
export const DIRECT_PURPOSE = 'robinson-git-direct/v1';
export const DIRECT_HEADER = 'x-robinson-git-worker';
/** How far apart the worker's and the control plane's clocks may be for one authorize call. */
export const DIRECT_SKEW_MS = 60000;
export const directPayload = (at, nonce, body) => Buffer.from(`${DIRECT_PURPOSE}\n${at}\n${nonce}\n${sha256(body)}`);
export const DIRECT_WORKER_KEY = /^ed25519:[A-Za-z0-9+/]{40,64}={0,2}$/;

/** A configured public origin (https, no credentials, path, query or fragment), or null. `local` allows http (tests only). */
export function cleanOrigin(raw, { local = false } = {}) {
 if (typeof raw !== 'string' || !raw) return null;
 let url; try { url = new URL(raw); } catch { return null; }
 if (!(url.protocol === 'https:' || (local && url.protocol === 'http:')) || url.username || url.password || url.search || url.hash || url.pathname !== '/') return null;
 return url.origin;
}
