// Internal worker transport, never a user-supplied URL or host command.
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
export function verifyWorkerBody(body, signature, key, now = Date.now()) {
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
 const data = JSON.parse(body);
 if (![2, WORKER_PROTOCOL].includes(data.version) || !Number.isSafeInteger(data.expiresAt) || data.expiresAt <= now || data.expiresAt > now + 90000) throw new TypeError('Expired or invalid worker lease.');
 if (!['capabilities', 'open', 'inspect', 'read', 'run', 'close', 'attachment_export', 'attachment_import'].includes(data.action)) throw new TypeError('Unsupported worker action.');
 return data;
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
export const nativeWorkerHost = env => createHash('sha256').update(new URL(workerUrl(env)).origin).digest('hex').slice(0,32);
export function nativeWorkerRoute(env, job) {
 if(job?.brokerOrigin){const url=new URL(job.brokerOrigin);if(!/^[a-f0-9]{64}$/.test(job.allocationBinding??'')||url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new TypeError('Invalid bound dedicated Git broker.');return new URL('/v1/workspace',url).href;}
 const primary=workerUrl(env);
 const previous=env?.NATIVE_GIT_PREVIOUS_WORKER_URL ? workerUrl({...env,NATIVE_GIT_WORKER_URL:env.NATIVE_GIT_PREVIOUS_WORKER_URL}) : null;
 if (job?.host!==undefined) {
  for (const url of [primary,previous].filter(Boolean)) {
   if (createHash('sha256').update(new URL(url).origin).digest('hex').slice(0,32)===job.host) return url;
  }
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
