// GIT-REMOTE-1 / GIT-DIRECT-1: the one check every git remote request passes before anything is
// served, shared by both doors:
//  - Routing Middleware on this service's own domain (src/git-remote/edge.js), and
//  - the native worker's direct git host, which asks `/api/git-remote?op=authorize` (src/git-remote/api.js)
//    with only the key's id and SHA-256, never the key.
// Checks: hash (constant time) in the key's own database, revocation, expiry, repository match, access
// level, the connection still live, and a read-only connection refusing push. Every check is logged in
// git_remote_uses. The answer is a signed, short-lived claim naming this key, the repository's mirror and
// one Git service; it never carries the key or a GitHub credential.
import { randomBytes } from 'node:crypto';
import { publicOrigin } from '../core/http.js';
import { REMOTE_PURPOSE, REMOTE_PACK_TTL_MS, REMOTE_REFS_TTL_MS, REMOTE_DIRECT_PACK_TTL_MS } from '../native-git/protocol.js';
import { signGitRemoteClaim } from '../native-git/signing.js';
import { checkKey, liveConnection, mirrorId, openKeyScope } from './keys.js';
import { ownerIdentityDb } from '../native-git/pool-audience.js';

const NEW_KEY = 'Ask your AI to call github_git_remote_setup for this repository and run the command it returns.';
const no = (status, message, { challenge = status === 401, reason = null, retryAfter = null } = {}) => ({ ok: false, status, message, challenge, reason, retryAfter });

/**
 * @param {{ parsed: { id: string, hash: string } | null, wanted: { owner: string, repo: string, service: string, step: string },
 *   env?: object, now?: () => number, openScope?: typeof openKeyScope, door?: 'domain' | 'direct' }} input
 */
export async function authorizeGitRequest({ parsed, wanted, env = process.env, now = Date.now, openScope = openKeyScope, door = 'domain' }) {
 if (!parsed) return no(401, `This git session key is not valid. ${NEW_KEY}`, { reason: 'malformed' });
 let control; try { control = publicOrigin(env); } catch { control = null; }
 if (!control) return no(503, 'The git remote is not configured on this service yet. Use github_repo_download and github_repo_change meanwhile.', { challenge: false });
 let scope;
 try { scope = await openScope(parsed.id, { env }); } catch { return no(503, 'The git remote could not check this key right now. Run the same command again in a minute.', { challenge: false, retryAfter: 30 }); }
 if (!scope) return no(401, `This git session key is not valid (or the connection it belongs to has ended). ${NEW_KEY}`, { reason: 'unknown' });
 const { db } = scope;
 const service = `${wanted.service === 'git-receive-pack' ? 'push' : 'fetch'}.${wanted.step}`;
 const log = (outcome, detail = null) => db.recordGitRemoteUse({ keyId: parsed.id, service, outcome, detail: detail ?? (door === 'direct' ? 'direct host' : null) }).catch(() => {});
 let row, connection;
 try {
  row = await db.getGitRemoteKey(parsed.id);
  const verdict = checkKey(row, parsed.hash, { service: wanted.service, owner: wanted.owner, repo: wanted.repo, now: now() });
  if (!verdict.ok) { if (row) await log('refused:' + verdict.reason); return no(verdict.status, verdict.message, { reason: verdict.reason }); }
  connection = await liveConnection(db, row, env);
  if (!connection) { await log('refused:connection_ended'); return no(401, `The app connection this git session key belongs to was disconnected or changed. Connect again, then ask for a new key with github_git_remote_setup.`, { reason: 'connection_ended' }); }
  if (wanted.service === 'git-receive-pack' && connection.profile === 'read_only') { await log('refused:connection_read_only'); return no(403, 'Your connection is read-only now (My connection page), so git push is refused. Allow changes again there, or ask the owner.', { reason: 'connection_read_only' }); }
 } catch { return no(503, 'The git remote could not check this key right now. Run the same command again in a minute.', { challenge: false, retryAfter: 30 }); }
 const at = now();
 const direct = door === 'direct';
 const ttl = wanted.step === 'pack' ? (direct ? REMOTE_DIRECT_PACK_TTL_MS : REMOTE_PACK_TTL_MS) : REMOTE_REFS_TTL_MS;
 // Version 1 (the domain door) is unchanged so a worker that has not been redeployed keeps accepting it.
 const claim = JSON.stringify({ purpose: REMOTE_PURPOSE, version: direct ? 2 : 1, ...(direct ? { door: 'direct' } : {}), key: row.id, mirror: mirrorId(row.connection, row.owner, row.repo), owner: row.owner, repo: row.repo,
  service: wanted.service, step: wanted.step, access: row.access, control, expiresAt: at + ttl, nonce: randomBytes(16).toString('hex') });
 let signed; try { signed = `${Buffer.from(claim).toString('base64url')}.${signGitRemoteClaim(claim, env)}`; } catch { return no(503, 'The git remote is not configured on this service yet.', { challenge: false }); }
 await log('allowed');
 // WORKER-POOL-2: a key in the owner's own (root) database is the owner's; RELAY-OWNER-1: so is a tenant key whose
 // database belongs to the operator's own verified GitHub id. Anyone else's tenant key is not.
 const ownerKey = (scope.scope?.legacy === true && !scope.scope?.tenantId) || ownerIdentityDb(db, env);
 return { ok: true, claim: signed, row, connection, host: scope.host ?? null, ownerKey };
}
