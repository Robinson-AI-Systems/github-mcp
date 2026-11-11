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

// GIT-UPLOAD-1: one-time upload address claim. It never carries a credential or a
// worker action; the worker accepts it only on its quarantine upload route.
export function signNativeUploadClaim(body, env = process.env) {
 const claim = JSON.parse(body);
 if (!claim || claim.purpose !== 'robinson-native-upload/v1' || Object.hasOwn(claim, 'credential') || Object.hasOwn(claim, 'action')) throw new TypeError('Invalid upload claim.');
 if (env.NATIVE_GIT_WORKER_KEY) {
  if (env.NATIVE_GIT_WORKER_KEY.startsWith('ed25519:')) throw new TypeError('A public verifier is not a shared signing secret. Use the control-plane signing key.');
  return signWorkerBody(body, env.NATIVE_GIT_WORKER_KEY);
 }
 return sign(null, Buffer.from(body), signingKey(env)).toString('base64url');
}

// GIT-DOWNLOAD-1: one-time download address claim; same rules, its own purpose.
export function signNativeDownloadClaim(body, env = process.env) {
 const claim = JSON.parse(body);
 if (!claim || claim.purpose !== 'robinson-native-download/v1' || Object.hasOwn(claim, 'credential') || Object.hasOwn(claim, 'action') || Object.hasOwn(claim, 'uploadId')) throw new TypeError('Invalid download claim.');
 if (env.NATIVE_GIT_WORKER_KEY) {
  if (env.NATIVE_GIT_WORKER_KEY.startsWith('ed25519:')) throw new TypeError('A public verifier is not a shared signing secret. Use the control-plane signing key.');
  return signWorkerBody(body, env.NATIVE_GIT_WORKER_KEY);
 }
 return sign(null, Buffer.from(body), signingKey(env)).toString('base64url');
}

// Purpose-separated claims; a coding container receives only the public verifier.
export function signCodingWorkerBody(body,env=process.env){
 const claim=JSON.parse(body);if(claim.purpose!=='robinson-coding/v1'||Object.hasOwn(claim,'credential'))throw new TypeError('Invalid coding lease.');
 return 'ed25519:'+sign(null,Buffer.from(body),signingKey(env)).toString('base64url');
}

export function signPreviewBody(body,env=process.env){const claim=JSON.parse(body);if(claim.purpose!=='robinson-playground-preview/v1'||Object.hasOwn(claim,'credential'))throw new TypeError('Invalid preview delegation.');return sign(null,Buffer.from(body),signingKey(env)).toString('base64url');}

// PLAY-2: non-executable, 60-second device identity/tunnel proof. The same
// control-plane signer issues coding claims, but purpose separation is exact.
export function signEnrolledDeviceProbeBody(body,env=process.env){
 const c=JSON.parse(body);
 if(!c||c.purpose!=='robinson-playground-device-probe/v1'||Object.hasOwn(c,'credential')||
    Object.hasOwn(c,'argv')||Object.hasOwn(c,'options'))throw new TypeError('Invalid device reachability claim.');
 return 'ed25519:'+sign(null,Buffer.from(body),signingKey(env)).toString('base64url');
}

// PLAY-2: a readback claim for previously user-run local image tests, never an
// authority to execute commands or change the installed image.
export function signEnrolledLocalCanaryBody(body,env=process.env){
 const claim=JSON.parse(body);
 if(!claim||claim.purpose!=='robinson-playground-local-canary-read/v1'||
    Object.hasOwn(claim,'credential')||Object.hasOwn(claim,'argv')||
    Object.hasOwn(claim,'options')||Object.hasOwn(claim,'image')||
    Object.hasOwn(claim,'workspaceBinding'))throw new TypeError('Invalid local canary readback claim.');
 return 'ed25519:'+sign(null,Buffer.from(body),signingKey(env)).toString('base64url');
}

// FLEET-3: orders the control plane hands a dial-out host agent (relay a signed
// claim, start/stop an allocation, run the readiness check, terminate). The
// agent pins the public key; an order can never carry a credential or argv.
export function signFleetOrderBody(body,env=process.env){
 const order=JSON.parse(body);
 if(!order||order.purpose!=='robinson-fleet-order/v1'||Object.hasOwn(order,'credential')||Object.hasOwn(order.payload??{},'credential')||Object.hasOwn(order.payload??{},'argv'))throw new TypeError('Invalid fleet order.');
 return 'ed25519:'+sign(null,Buffer.from(body),signingKey(env)).toString('base64url');
}

// PLAY-3: a signed agent-release advertisement (version + bundle hash + HTTPS
// bundle address) carried on the check-in response. An update is the most
// privileged order the control plane can give, so it rides the same signing
// key the agent pinned at join — under its own purpose, validated as
// strictly as an order: no credential, no argv, nothing executable inline.
export function signAgentReleaseBody(body,env=process.env){
 const rel=JSON.parse(body);
 if(!rel||rel.purpose!=='robinson-playground-agent-release/v1'||typeof rel.version!=='string'||!/^[a-f0-9]{64}$/.test(rel.bundleSha256??'')||typeof rel.bundleUrl!=='string'||Object.hasOwn(rel,'credential')||Object.hasOwn(rel,'argv'))throw new TypeError('Invalid agent release.');
 return 'ed25519:'+sign(null,Buffer.from(body),signingKey(env)).toString('base64url');
}

// GIT-REMOTE-1: the per-request git remote claim (Routing Middleware → worker → broker). It names one
// session key, one repository mirror and one Git service; it never carries a credential or the key.
export function signGitRemoteClaim(body, env = process.env) {
 const claim = JSON.parse(body);
 if (!claim || claim.purpose !== 'robinson-git-remote/v1' || ['credential', 'action', 'uploadId', 'downloadId', 'secret', 'password'].some(k => Object.hasOwn(claim, k))) throw new TypeError('Invalid git remote claim.');
 if (env.NATIVE_GIT_WORKER_KEY) {
  if (env.NATIVE_GIT_WORKER_KEY.startsWith('ed25519:')) throw new TypeError('A public verifier is not a shared signing secret. Use the control-plane signing key.');
  return signWorkerBody(body, env.NATIVE_GIT_WORKER_KEY);
 }
 return sign(null, Buffer.from(body), signingKey(env)).toString('base64url');
}
