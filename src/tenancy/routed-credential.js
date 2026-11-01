// PRIVATE PUB-2 tenant token router. No public enrollment exists here.
// The signed prefix only chooses a tenant database; it does not authenticate a
// GitHub bearer on its own. Every actual access also checks the server-side
// allowlist, membership and hashed token row in that tenant's database.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WIRE = /^(tac|trf|tcl)_([A-Za-z0-9_-]{86})_([A-Za-z0-9_-]{43})$/;
const KINDS = new Set(['tac', 'trf', 'tcl']);
const INFO = Buffer.from('robinson-github-tenant-routing-v2-revocation');

function keyFor(env) {
  if (env?.GITHUB_PRIVATE_TENANT_PILOT !== 'enabled')
    throw new Error('Private tenant pilot is disabled.');
  const text = env?.GITHUB_TENANT_ROUTING_KEY;
  if (typeof text !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(text))
    throw new Error('Private tenant token routing has no configured signing key.');
  const key = Buffer.from(text, 'base64url');
  if (key.length !== 32 || key.toString('base64url') !== text)
    throw new Error('Private tenant token routing signing key is invalid.');
  return key;
}
// KEY-ROTATION: during a routing-key change the replaced key may still CHECK (never issue) credentials, for a stored,
// time-bounded window: GITHUB_TENANT_ROUTING_KEY_PREVIOUS (the old key) and GITHUB_TENANT_ROUTING_KEY_PREVIOUS_UNTIL
// (an ISO UTC time at most ROUTING_OVERLAP_MAX_DAYS ahead). Anything else (missing, malformed, past, too far ahead, the
// same as the current key) means no previous key: the strict, pre-rotation behaviour. New credentials always use the
// current key, so a person whose app refreshes during the window simply moves to the new key.
export const ROUTING_OVERLAP_MAX_DAYS = 30;
function previousKeyFor(env, now) {
  const text = env?.GITHUB_TENANT_ROUTING_KEY_PREVIOUS, until = env?.GITHUB_TENANT_ROUTING_KEY_PREVIOUS_UNTIL;
  if (typeof text !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(text) || text === env?.GITHUB_TENANT_ROUTING_KEY) return null;
  if (typeof until !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z$/.test(until)) return null;
  const ends = Date.parse(until);
  if (!Number.isFinite(ends) || ends <= now || ends > now + ROUTING_OVERLAP_MAX_DAYS * 86400000) return null;
  const key = Buffer.from(text, 'base64url');
  return key.length === 32 && key.toString('base64url') === text ? key : null;
}
/** Plain words for diagnostics and the runbook: whether a routing-key overlap is open. Never a key value. */
export function routingKeyOverlap(env = process.env, now = Date.now()) {
  const open = env?.GITHUB_PRIVATE_TENANT_PILOT === 'enabled' && previousKeyFor(env, now) !== null;
  return open ? { open: true, until: new Date(Date.parse(env.GITHUB_TENANT_ROUTING_KEY_PREVIOUS_UNTIL)).toISOString() }
    : { open: false, until: null, ignored: typeof env?.GITHUB_TENANT_ROUTING_KEY_PREVIOUS === 'string' && env.GITHUB_TENANT_ROUTING_KEY_PREVIOUS !== '' };
}
function bytesOf(uuid) {
  if (typeof uuid !== 'string' || !UUID.test(uuid))
    throw new TypeError('A verified tenant and identity UUID are required.');
  return Buffer.from(uuid.replaceAll('-', ''), 'hex');
}
function uuidOf(b) {
  const h = b.toString('hex');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
function mac(key, kind, payload) {
  return createHmac('sha256', key).update(INFO).update(Buffer.from([0]))
    .update(kind).update(Buffer.from([0])).update(payload).digest();
}
export function isTenantRoutedCredential(value) {
  return typeof value === 'string' && /^(?:tac|trf|tcl)_/.test(value);
}
export function issueTenantCredential(kind, { tenantId, identityId, membershipRevision, pilotRevision }, env = process.env) {
  if (!KINDS.has(kind)) throw new TypeError('Unknown tenant credential kind.');
  const key = keyFor(env);
  // Re-allowlisting must NEVER resurrect a previously revoked client, access
  // or refresh token. Pin both monotonic revisions into the signed payload.
  if (![membershipRevision, pilotRevision].every(v=>Number.isInteger(v) && v>0 && v<=0xffffffff))
    throw new TypeError('Current pilot and membership revisions are required.');
  const revision=Buffer.alloc(8);
  revision.writeUInt32BE(membershipRevision,0);
  revision.writeUInt32BE(pilotRevision,4);
  const payload=Buffer.concat([bytesOf(tenantId),bytesOf(identityId),revision,randomBytes(24)]);
  return `${kind}_${payload.toString('base64url')}_${mac(key, kind, payload).toString('base64url')}`;
}
export function verifyTenantCredential(value, expectedKind, env = process.env, now = Date.now()) {
  if (!KINDS.has(expectedKind)) return null;
  // Any token with a tenant marker MUST stay on this path; never fall back
  // to the owner database because of invalid shape, key or signature.
  if (!isTenantRoutedCredential(value)) return null;
  const found = WIRE.exec(value);
  if (!found || found[1] !== expectedKind) return null;
  let key;
  try { key = keyFor(env); } catch { return null; }
  const payload = Buffer.from(found[2], 'base64url');
  const signature = Buffer.from(found[3], 'base64url');
  if (payload.length !== 64 || signature.length !== 32 ||
      payload.toString('base64url') !== found[2] ||
      signature.toString('base64url') !== found[3]) return null;
  // The current key first; the previous key only inside its window. Both are full constant-time MAC checks.
  const previous = previousKeyFor(env, now);
  const signedByCurrent = timingSafeEqual(mac(key, expectedKind, payload), signature);
  if (!signedByCurrent && !(previous && timingSafeEqual(mac(previous, expectedKind, payload), signature))) return null;
  const membershipRevision=payload.readUInt32BE(32);
  const pilotRevision=payload.readUInt32BE(36);
  if (membershipRevision===0 || pilotRevision===0) return null;
  return Object.freeze({ tenantId:uuidOf(payload.subarray(0,16)),
    identityId:uuidOf(payload.subarray(16,32)),membershipRevision,pilotRevision });
}
