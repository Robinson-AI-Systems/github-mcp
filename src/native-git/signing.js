// Control-plane only: purpose-separated signing material never leaves the MCP host.
import { hkdfSync, createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { readEncryptionKey } from '../core/crypto.js';
import { signWorkerBody } from './protocol.js';
function signingKey(env) {
 const seed = Buffer.from(hkdfSync('sha256', readEncryptionKey(env), Buffer.from('robinson-native-git/v1'), Buffer.from('ed25519-worker-leases'), 32));
 try { return createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]), format: 'der', type: 'pkcs8' }); }
 finally { seed.fill(0); }
}
export function nativeWorkerPublicKey(env = process.env) {
 return 'ed25519:' + createPublicKey(signingKey(env)).export({ format: 'der', type: 'spki' }).toString('base64');
}
export function signNativeWorkerBody(body, env = process.env) {
 if (env.NATIVE_GIT_WORKER_KEY) {
  if (env.NATIVE_GIT_WORKER_KEY.startsWith('ed25519:')) throw new TypeError('A public verifier is not a shared signing secret. Use the control-plane signing key.');
  return signWorkerBody(body, env.NATIVE_GIT_WORKER_KEY);
 }
 return 'ed25519:' + sign(null, Buffer.from(body), signingKey(env)).toString('base64url');
}
