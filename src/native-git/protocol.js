// Internal worker transport, never a user-supplied URL or host command.
import { configuredHost, hostId } from './pool-config.js';
import { createHmac, timingSafeEqual, createHash, createPublicKey, verify } from 'node:crypto';
export const WORKER_PROTOCOL = 3;
export function workerKey(key) {
 if (typeof key === 'string' && key.startsWith('ed25519:')) {
  const parsed = createPublicKey({ key: Buffer.from(key.slice(8), 'base64'), format: 'der', type: 'spki' });
  if (parsed.asymmetricKeyType !== 'ed25519' || parsed.export({ format: 'der', type: 'spki' }).toString('base64') !== key.slice(8)) throw new TypeError('Invalid worker control public key.');
  return key;
 }
 if (typeof key !== 'string' || key.length < 32) throw new TypeError('Configure NATIVE_GIT_WORKER_KEY with at least 32 random characters in protected server settings.');
 return key;
}
export const signWorkerBody = (body, key) => createHmac('sha256', workerKey(key)).update(body).digest('hex');
function verifySignature(body, signature, key) {
 workerKey(key);
 if (key.startsWith('ed25519:')) {
  if (typeof signature !== 'string' || !/^ed25519:[A-Za-z0-9_-]{86}$/.test(signature)) throw new TypeError('Invalid worker authorization.');
  const bytes = Buffer.from(signature.slice(8), 'base64url');
  const pub = createPublicKey({ key: Buffer.from(key.slice(8), 'base64'), format: 'der', type: 'spki' });
  if (bytes.toString('base64url') !== signature.slice(8) || !verify(null, Buffer.from(body), pub, bytes)) throw new TypeError('Invalid worker authorization.');
 } else {
  if (typeof signature !== 'string' || !/^[a-f0-9]{64}$/.test(signature)) throw new TypeError('Invalid worker authorization.');
  if (!timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(signWorkerBody(body, key), 'hex'))) throw new TypeError('Invalid worker authorization.');
 }
}
export function verifyWorkerBody(body, signature, key, now = Date.now()) {
 verifySignature(body, signature, key);
 const data = JSON.parse(body);
 if (![2, WORKER_PROTOCOL].includes(data.version) || !Number.isSafeInteger(data.expiresAt) || data.expiresAt <= now || data.expiresAt > now + 90000) throw new TypeError('Expired or invalid worker lease.');
 // Purpose-separated claims (uploads, previews, coding) are never request leases.
 if (Object.hasOwn(data, 'purpose')) throw new TypeError('Unsupported worker action.');
 if (!['capabilities', 'direct_configure', 'open', 'inspect', 'read', 'run', 'close', 'attachment_export', 'attachment_import', 'upload_begin', 'upload_status', 'upload_apply', 'download_begin', 'download_status'].includes(data.action)) throw new TypeError('Unsupported worker action.');
 return data;
}

// GIT-UPLOAD-1: a one-time upload address carries this signed claim, never a GitHub credential.
// It is accepted only by the worker's /v1/upload route and grants writes to one quarantine area.
export const UPLOAD_PURPOSE = 'robinson-native-upload/v1';
export const UPLOAD_TTL_MS = 600000;
export const UPLOAD_MAX_BYTES = 100 * 1024 * 1024;
const UPLOAD_FIELDS = ['binding', 'expiresAt', 'maxBytes', 'mode', 'nonce', 'purpose', 'uploadId', 'version', 'workspace_id'];
export const nativeBindingHash = binding => createHash('sha256').update(JSON.stringify(['authority', 'connection', 'owner', 'repo'].map(k => binding?.[k]))).digest('hex');
// A one-time address is `<base64url(claim)>.<signature>`; the claim must hold exactly `fields`.
function decodeCapability(token, key, fields, label) {
 if (typeof token !== 'string' || token.length > 2048 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw new TypeError(`Invalid ${label} address.`);
 const [encoded, signature] = token.split('.');
 const body = Buffer.from(encoded, 'base64url').toString('utf8');
 if (Buffer.from(body, 'utf8').toString('base64url') !== encoded) throw new TypeError(`Invalid ${label} address.`);
 verifySignature(body, key.startsWith('ed25519:') ? 'ed25519:' + signature : signature, key);
 let claim; try { claim = JSON.parse(body); } catch { throw new TypeError(`Invalid ${label} address.`); }
 if (!claim || typeof claim !== 'object' || Array.isArray(claim) || JSON.stringify(Object.keys(claim).sort()) !== JSON.stringify(fields)) throw new TypeError(`Invalid ${label} address.`);
 return claim;
}
// CHUNK-UPLOAD-1: a chunked upload that started inside its ten-minute window may keep sending chunks,
// reading status and finishing for this much longer (the worker refuses it for an upload that had not
// started chunking before expiry). Nothing new can start after the ten minutes.
export const UPLOAD_CHUNK_GRACE_MS = 1200000;
export const UPLOAD_CHUNK_MAX_BYTES = 8 * 1024 * 1024;
export function verifyUploadCapability(token, key, now = Date.now(), { graceMs = 0 } = {}) {
 const claim = decodeCapability(token, key, UPLOAD_FIELDS, 'upload');
 if (claim.purpose !== UPLOAD_PURPOSE || claim.version !== 1 || !['git', 'archive'].includes(claim.mode)) throw new TypeError('Invalid upload address.');
 if (!/^git_[a-f0-9]{32}$/.test(claim.workspace_id) || !/^[a-f0-9]{64}$/.test(claim.binding) || !/^[a-f0-9]{32}$/.test(claim.uploadId) || !/^[a-f0-9]{32}$/.test(claim.nonce)) throw new TypeError('Invalid upload address.');
 if (!Number.isSafeInteger(claim.maxBytes) || claim.maxBytes < 1 || claim.maxBytes > UPLOAD_MAX_BYTES) throw new TypeError('Invalid upload address.');
 // Small allowance for clock difference between the control plane and the worker.
 if (!Number.isSafeInteger(claim.expiresAt) || claim.expiresAt > now + UPLOAD_TTL_MS + 30000) throw new TypeError('This upload address has expired. Begin a new upload.');
 if (claim.expiresAt <= now - Math.min(Math.max(graceMs, 0), UPLOAD_CHUNK_GRACE_MS)) throw new TypeError('This upload address has expired. Begin a new upload.');
 return claim;
}
// GIT-DOWNLOAD-1: a one-time download address carries this signed claim, never a GitHub credential.
// It is accepted only by the worker's /v1/download route and grants one read-only clone session
// (or one archive download) of a snapshot taken by an authenticated download_begin.
export const DOWNLOAD_PURPOSE = 'robinson-native-download/v1';
export const DOWNLOAD_TTL_MS = 600000;
/** A clone that started before expiry may finish its few requests within this window of its first request. */
export const DOWNLOAD_SESSION_MS = 300000;
export const DOWNLOAD_MAX_BYTES = 500 * 1024 * 1024;
const DOWNLOAD_FIELDS = ['binding', 'downloadId', 'expiresAt', 'maxBytes', 'mode', 'nonce', 'purpose', 'version', 'workspace_id'];
export function verifyDownloadCapability(token, key, now = Date.now(), { graceMs = 0 } = {}) {
 const claim = decodeCapability(token, key, DOWNLOAD_FIELDS, 'download');
 if (claim.purpose !== DOWNLOAD_PURPOSE || claim.version !== 1 || !['git', 'archive'].includes(claim.mode)) throw new TypeError('Invalid download address.');
 if (!/^git_[a-f0-9]{32}$/.test(claim.workspace_id) || !/^[a-f0-9]{64}$/.test(claim.binding) || !/^[a-f0-9]{32}$/.test(claim.downloadId) || !/^[a-f0-9]{32}$/.test(claim.nonce)) throw new TypeError('Invalid download address.');
 if (!Number.isSafeInteger(claim.maxBytes) || claim.maxBytes < 1 || claim.maxBytes > DOWNLOAD_MAX_BYTES) throw new TypeError('Invalid download address.');
 if (!Number.isSafeInteger(claim.expiresAt) || claim.expiresAt > now + DOWNLOAD_TTL_MS + 30000) throw new TypeError('Invalid download address.');
 if (claim.expiresAt <= now - Math.min(Math.max(graceMs, 0), DOWNLOAD_SESSION_MS)) throw new TypeError('This download address has expired. Begin a new download.');
 return claim;
}
export function workerUrl(env) {
 const raw = env?.NATIVE_GIT_WORKER_URL;
 if (!raw) throw new TypeError('Native Git worker is not configured. Deploy workers/native-git with persistent storage using docs/NATIVE-GIT-OPERATIONS.md, then set NATIVE_GIT_WORKER_URL in protected server configuration and pin this service’s public verification key on the worker. Existing GitHub API tools remain available.');
 const url = new URL(raw);
 if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new TypeError('Native Git requires a fixed HTTPS worker origin without credentials, query or path.');
 return new URL('/v1/workspace', url).href;
}

export const nativeWorkspaceId = (binding, key) => {
 const digest = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
 return 'git_' + digest([digest(['authority', 'connection', 'owner', 'repo'].map(k => binding[k])), key]).slice(0, 32);
};

// Host pins are compact, non-secret IDs. Only protected configured origins are
// eligible; a stored workspace can never supply an arbitrary credential target.
export const nativeWorkerHost = env => hostId(new URL(workerUrl(env)).origin);
export function nativeWorkerRoute(env, job) {
 if(job?.brokerOrigin){const url=new URL(job.brokerOrigin);if(!/^[a-f0-9]{64}$/.test(job.allocationBinding??'')||url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new TypeError('Invalid bound dedicated Git broker.');return new URL('/v1/workspace',url).href;}
 const primary=workerUrl(env);
 const previous=env?.NATIVE_GIT_PREVIOUS_WORKER_URL ? workerUrl({...env,NATIVE_GIT_WORKER_URL:env.NATIVE_GIT_PREVIOUS_WORKER_URL}) : null;
 if (job?.host!==undefined) {
  // WORKER-POOL-1: any configured pool host (primary, previous or NATIVE_GIT_WORKER_POOL), by its stored id.
  const pinned=configuredHost(env,job.host);
  if (pinned) return new URL('/v1/workspace',pinned.origin).href;
  throw Object.assign(new TypeError('This workspace belongs to a worker origin that is no longer configured. Restore its protected host configuration or migrate its data; no request was sent.'),{safeMessage:true,safeCode:'native_worker_host_unavailable',safeRetryable:false});
 }
 if (previous && job?.createdAt!==undefined) {
  const stamp=env.NATIVE_GIT_WORKER_CUTOVER_AT;
  const cutover=typeof stamp==='string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(stamp)?Date.parse(stamp):NaN;
  const created=new Date(job.createdAt).getTime();
  if (!Number.isFinite(cutover) || !Number.isFinite(created)) throw Object.assign(new TypeError('Configure the exact worker cutover timestamp before routing historical workspaces. Nothing was sent.'),{safeMessage:true,safeCode:'native_worker_route_configuration',safeRetryable:false});
  return created<cutover?previous:primary;
 }
 return primary;
}

// GIT-REMOTE-1: the git remote on this service's own domain. Routing Middleware checks the person's
// session key and forwards each Git request to the worker with this signed, short-lived claim in a
// header (never in the URL, never the key itself). The worker serves the repository's mirror with it
// and presents it back to the control plane's broker to obtain a GitHub credential for that one request.
export const REMOTE_PURPOSE = 'robinson-git-remote/v1';
export const REMOTE_REFS_TTL_MS = 120000;
/** A push's pack step may take minutes to upload before the guarded push runs. */
export const REMOTE_PACK_TTL_MS = 900000;
export const REMOTE_MAX_PUSH_BYTES = 100 * 1024 * 1024;
// GIT-DIRECT-1: the worker's own direct git host. Its claims are version 2 (`door: "direct"`); a pack
// step there may stream for hours on a slow link, so its claim lasts longer. Version 1 is unchanged.
export const REMOTE_DIRECT_PACK_TTL_MS = 8 * 3600000;
/** GitHub's documented limits: 2 GB per push, 100 MiB per file (Git LFS beyond that). */
export const GITHUB_PUSH_LIMIT_BYTES = 2 * 1024 * 1024 * 1024;
export const GITHUB_FILE_LIMIT_BYTES = 100 * 1024 * 1024;
/** A report only closes a change-log row (no credential), so it is accepted this long after the claim expired. */
export const REMOTE_REPORT_GRACE_MS = 24 * 3600000;
const REMOTE_FIELDS = ['access', 'control', 'expiresAt', 'key', 'mirror', 'nonce', 'owner', 'purpose', 'repo', 'service', 'step', 'version'];
const REMOTE_DIRECT_FIELDS = [...REMOTE_FIELDS, 'door'].sort();
export function verifyRemoteClaim(token, key, now = Date.now(), { graceMs = 0 } = {}) {
 let fields = REMOTE_FIELDS;
 try { const [encoded] = String(token).split('.'); if (Object.hasOwn(JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) ?? {}, 'door')) fields = REMOTE_DIRECT_FIELDS; } catch { /* decodeCapability refuses it */ }
 const claim = decodeCapability(token, key, fields, 'git remote');
 const direct = fields === REMOTE_DIRECT_FIELDS;
 if (claim.purpose !== REMOTE_PURPOSE || claim.version !== (direct ? 2 : 1) || (direct && claim.door !== 'direct') || !['git-upload-pack', 'git-receive-pack'].includes(claim.service) || !['refs', 'pack'].includes(claim.step) || !['read', 'write'].includes(claim.access)) throw new TypeError('Invalid git remote claim.');
 if (claim.service === 'git-receive-pack' && claim.access !== 'write') throw new TypeError('Invalid git remote claim.');
 if (!/^[a-f0-9]{32}$/.test(claim.key) || !/^[a-f0-9]{64}$/.test(claim.mirror) || !/^[a-f0-9]{32}$/.test(claim.nonce)) throw new TypeError('Invalid git remote claim.');
 if (!/^[A-Za-z0-9-]{1,39}$/.test(claim.owner) || !/^[A-Za-z0-9_.-]{1,100}$/.test(claim.repo) || ['.', '..'].includes(claim.repo)) throw new TypeError('Invalid git remote claim.');
 let control; try { control = new URL(claim.control); } catch { throw new TypeError('Invalid git remote claim.'); }
 if (!['https:', 'http:'].includes(control.protocol) || control.username || control.password || control.pathname !== '/' || control.search || control.hash || control.origin !== claim.control) throw new TypeError('Invalid git remote claim.');
 const ttl = claim.step === 'pack' ? (direct ? REMOTE_DIRECT_PACK_TTL_MS : REMOTE_PACK_TTL_MS) : REMOTE_REFS_TTL_MS;
 if (!Number.isSafeInteger(claim.expiresAt) || claim.expiresAt > now + ttl + 30000) throw new TypeError('Invalid git remote claim.');
 if (claim.expiresAt <= now - Math.min(Math.max(graceMs, 0), REMOTE_REPORT_GRACE_MS)) throw new TypeError('This git remote request has expired. Run the git command again.');
 return claim;
}
