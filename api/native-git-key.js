// Public verification material only. Never a signing key, GitHub credential or grant.
import { nativeWorkerPublicKey } from '../src/native-git/signing.js';
export function nativeGitKeyHandler({ env = process.env } = {}) {
 return (req, res) => {
  res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'method_not_allowed' }); }
  try { return res.status(200).json({ algorithm: 'ed25519', public_key: nativeWorkerPublicKey(env), purpose: 'Pin on the native Git worker; grants are still checked by the authenticated MCP control plane.' }); }
  catch { return res.status(503).json({ error: 'native_git_signing_not_configured' }); }
 };
}
export default nativeGitKeyHandler();
