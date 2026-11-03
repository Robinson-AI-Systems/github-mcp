// GIT-REMOTE-1: session keys for the git remote on this service's own domain
// (`https://<origin>/git/<owner>/<repo>.git`). Owner decision 2026-11-02 ("Build option 2").
//
// - The setup tool stores a row with only the SHA-256 of a one-time exchange code; the tool result
//   carries the code (10 minutes, single use), never a key.
// - The exchange endpoint swaps the code for a fresh random session key exactly once and stores only
//   the key's SHA-256. The key goes straight into the person's git credential store.
// - A key is bound to one connection, one repository and one access level, expires on its own
//   (default 8 hours, at most 24; a stored setting) and can be revoked on My connection.
// - Rows live in the connection's own (tenant) database; a small root index names only the key's
//   tenant scope so a request can be routed to that database. No credential is in the index.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createDb, productionSql, GIT_REMOTE_ID } from '../db.js';
import { CODE_PREFIX, KEY_PREFIX, parseSecret, sha256 } from './wire.js';

export { CODE_PREFIX, KEY_PREFIX, parseSecret, sha256 };
export const CODE_TTL_MS = 600000;
export const DEFAULT_HOURS = 8;
export const MAX_HOURS = 24;
export const LIFETIME_SETTING = 'git_remote.lifetime';
/** The username git sends with the key (any value works; this one makes logs readable). */
export const GIT_USERNAME = 'x-robinson-git';
export const indexKey = id => 'git_remote.' + id;

/** A fresh row id and its one-time exchange code. */
export function newExchangeCode() {
 const id = randomBytes(16).toString('hex');
 return { id, code: `${CODE_PREFIX}${id}_${randomBytes(32).toString('base64url')}` };
}
/** A fresh 256-bit session key for row `id`. */
export const newSessionKey = id => `${KEY_PREFIX}${id}_${randomBytes(32).toString('base64url')}`;

export function sameHash(stored, candidate) {
 if (typeof stored !== 'string' || typeof candidate !== 'string' || stored.length !== 64 || candidate.length !== 64) return false;
 return timingSafeEqual(Buffer.from(stored, 'hex'), Buffer.from(candidate, 'hex'));
}

/** One bare mirror per connection and repository on the worker (never shared between connections). */
export const mirrorId = (connection, owner, repo) => sha256(JSON.stringify(['robinson-git-remote/v1', connection, owner.toLowerCase(), repo.toLowerCase()]));

/** The stored lifetime setting, plainly explained in docs/DECISIONS.md; defaults 8 h, at most 24 h. */
export async function keyLifetime(db) {
 let stored = null; try { stored = typeof db?.getSetting === 'function' ? await db.getSetting(LIFETIME_SETTING) : null; } catch { stored = null; }
 const max = Number.isSafeInteger(stored?.max_hours) && stored.max_hours >= 1 && stored.max_hours <= MAX_HOURS ? stored.max_hours : MAX_HOURS;
 const def = Number.isSafeInteger(stored?.default_hours) && stored.default_hours >= 1 && stored.default_hours <= max ? stored.default_hours : Math.min(DEFAULT_HOURS, max);
 return { defaultHours: def, maxHours: max };
}

export const remotePath = (owner, repo) => `git/${owner}/${repo}.git`;

/**
 * The connection a key belongs to, as it is now: the same live connector login (refreshable),
 * with its current profile, mode and accounts. Null when it was disconnected, changed account
 * list, or the key's owner is no longer one of its accounts. Service passes never hold keys.
 */
export async function liveConnection(db, row, env = process.env) {
 const rows = (await db.listUpgradeableConnections()).filter(c => c.client_id === row.connection && c.kind === 'connector');
 const c = rows[0];
 if (!c || !Array.isArray(c.accounts) || !c.accounts.length || !c.accounts.includes(c.default_account)) return null;
 if (!['everyday', 'full', 'read_only'].includes(c.profile) || !['preview', 'production'].includes(c.mode)) return null;
 // Same rule as a connector bearer (src/oauth/policy.js toConnection): production works only on the production deployment.
 if (c.mode === 'production' && env.VERCEL_ENV !== 'production') return null;
 if (!c.accounts.some(a => a.toLowerCase() === String(row.owner).toLowerCase())) return null;
 return Object.freeze({ client_id: c.client_id, default_account: c.default_account, accounts: Object.freeze([...c.accounts]), mode: c.mode, profile: c.profile, listing: c.listing ?? 'compact' });
}

const fmt = d => { try { return new Date(d).toISOString().replace(/\.\d{3}Z$/, 'Z'); } catch { return 'an earlier time'; } };
const NEW_KEY = 'Ask your AI to call github_git_remote_setup for this repository and run the command it returns.';
/**
 * Checks a presented key against its row for one Git request. Returns `{ ok: true }` or
 * `{ ok: false, status, reason, message }` with a plain sentence and next step. Messages name only
 * the key's own repository (from the database), never text from the request.
 */
export function checkKey(row, presentedHash, { service, owner, repo, now = Date.now() }) {
 const no = (status, reason, message) => ({ ok: false, status, reason, message });
 if (!row || !row.key_hash || !sameHash(row.key_hash, presentedHash)) return no(401, 'invalid', `This git session key is not valid. ${NEW_KEY}`);
 if (row.revoked_at) return no(401, 'revoked', `This git session key was cancelled (My connection page). ${NEW_KEY}`);
 if (new Date(row.expires_at).getTime() <= now) return no(401, 'expired', `This git session key expired at ${fmt(row.expires_at)} (UTC). Keys last 8 hours by default, at most 24. ${NEW_KEY}`);
 if (String(row.owner).toLowerCase() !== String(owner).toLowerCase() || String(row.repo).toLowerCase() !== String(repo).toLowerCase())
  return no(403, 'wrong_repository', `This git session key is for ${row.owner}/${row.repo} only, not this repository. ${NEW_KEY}`);
 if (service === 'git-receive-pack' && row.access !== 'write')
  return no(403, 'read_only_key', `This git session key is read-only, so git push is refused. Ask for one with access "write" (github_git_remote_setup), or send the change with github_repo_change.`);
 return { ok: true };
}

/**
 * Opens the database a key lives in. The root index names the tenant scope only; a tenant whose
 * membership, pilot revision or Marketplace binding changed since the key was made is closed
 * (null), exactly as its connector bearer would be. `withCredentials` adds the GitHub credential
 * store (the broker only; Routing Middleware never needs it).
 */
export async function openKeyScope(id, { env = process.env, withCredentials = false } = {}) {
 if (!GIT_REMOTE_ID.test(id ?? '')) return null;
 const rootSql = productionSql(), root = createDb(rootSql);
 const index = await root.getSetting(indexKey(id));
 if (index?.kind !== 'git-remote-index' || index.id !== id || !index.scope) return null;
 const scope = index.scope;
 if (scope.tenantId) {
  const { createTenantDirectory, createTenantSql, assertTenantSearchPath } = await import('../tenancy/directory.js');
  const directory = createTenantDirectory(rootSql);
  const [authorized, marketplace] = await Promise.all([directory.authorizedPilotIdentity(scope.tenantId, scope.identityId), directory.marketplaceBinding(scope.tenantId)]);
  if (!authorized || authorized.tenantId !== scope.tenantId || authorized.membershipRevision !== scope.membershipRevision || (scope.pilotRevision !== undefined && authorized.pilotRevision !== scope.pilotRevision)) return null;
  if (marketplace && !marketplace.active) return null;
  const sql = createTenantSql(env.DATABASE_URL, scope.tenantId); await assertTenantSearchPath(sql, scope.tenantId);
  const db = createDb(sql); db.playgroundScope = Object.freeze({ ...scope });
  if (!withCredentials) return { db, env, scope };
  const [{ createCredentials }, { createTenantScopedCredentials }] = await Promise.all([import('../github/credentials.js'), import('../tenancy/user-authorization.js')]);
  const credentials = createTenantScopedCredentials({ base: createCredentials({ db, env, rootApps: root }), directory, tenant: authorized, db, env, fetchImpl: fetch });
  return { db, env, scope, credentials };
 }
 if (scope.legacy !== true) return null;
 // The owner's own database is the root database: Routing Middleware needs nothing more (no schema pass, no credentials).
 if (!withCredentials) return { db: root, env, scope };
 const { getSecretsRuntime } = await import('../runtime.js');
 const runtime = await getSecretsRuntime({ env });
 return { db: runtime.db, env, scope, credentials: runtime.credentials };
}
