import { it, expect } from 'vitest';
import { nativeWorkerPublicKey, signNativeWorkerBody } from '../../src/native-git/signing.js';
import { verifyWorkerBody, signWorkerBody } from '../../src/native-git/protocol.js';
import { nativeGitKeyHandler } from '../../api/native-git-key.js';
const env = { TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64') };
it('purpose-separated asymmetric leases verify with public material without permitting a shared-secret downgrade', () => {
 const now = Date.now(); const body = JSON.stringify({ version: 1, expiresAt: now + 60000, action: 'capabilities' });
 const pub = nativeWorkerPublicKey(env); const signature = signNativeWorkerBody(body, env);
 expect(pub).toMatch(/^ed25519:/); expect(verifyWorkerBody(body, signature, pub, now).action).toBe('capabilities');
 expect(() => verifyWorkerBody(body + ' ', signature, pub, now)).toThrow(/authorization/);
 expect(() => verifyWorkerBody(body, signWorkerBody(body, pub), pub, now)).toThrow(/authorization/);
 expect(() => verifyWorkerBody(body, signature, nativeWorkerPublicKey({ TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 8).toString('base64') }), now)).toThrow(/authorization/);
 expect(pub).not.toContain(env.TOKEN_ENCRYPTION_KEY);
});
it('public key discovery returns only public verification data and fails closed when root configuration is absent', () => {
 const response = () => ({ headers: {}, setHeader(k,v) { this.headers[k] = v; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
 const res = response(); nativeGitKeyHandler({ env })({ method: 'GET' }, res);
 expect(res.code).toBe(200); expect(res.body.public_key).toBe(nativeWorkerPublicKey(env)); expect(JSON.stringify(res.body)).not.toContain(env.TOKEN_ENCRYPTION_KEY);
 const missing = response(); nativeGitKeyHandler({ env: {} })({ method: 'GET' }, missing); expect(missing.code).toBe(503);
 const denied = response(); nativeGitKeyHandler({ env })({ method: 'POST' }, denied); expect(denied.code).toBe(405);
});
