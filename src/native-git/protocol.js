// Internal worker transport, never a user-supplied URL or host command.
import { createHmac, timingSafeEqual, createHash, createPublicKey, verify } from 'node:crypto';
export const WORKER_PROTOCOL = 1;
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
 if (data.version !== WORKER_PROTOCOL || !Number.isSafeInteger(data.expiresAt) || data.expiresAt <= now || data.expiresAt > now + 90000) throw new TypeError('Expired or invalid worker lease.');
 if (!['capabilities', 'open', 'inspect', 'read', 'run', 'close'].includes(data.action)) throw new TypeError('Unsupported worker action.');
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
