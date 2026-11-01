// PUB-9: a person's GitHub fine-grained personal access token (credential kind 'F').
// Typed only on the protected one-use setup page, never into a chat or a tool. On saving, the server asks GitHub with the
// token who it belongs to (must be the same person who signed in), which repositories it reaches (one owner, by GitHub's
// design) and what it can read (fine-grained.js probes), then stores it encrypted per tenant, person and owner, with that
// permission set and GitHub's own expiry. The owner becomes an "extra place" (GOD-5 rules: read-only until the person allows
// changes) reached with this token. An owner already connected with the GitHub App, or through the master token, keeps
// that: the App and the person's sign-in always come first.
import { createHash } from 'node:crypto';
import { encryptSecret, readEncryptionKey } from '../core/crypto.js';
import { bareOctokit } from '../github/client.js';
import { pilotOptionalAad } from './optional-credentials.js';
import { FINE_PREFIX, fineSettingKey, readFinePermissions, validPermissionSet } from '../github/fine-grained.js';

const SUBJECT = /^[1-9][0-9]{0,18}$/;
const LOGIN = /^[a-z0-9][a-z0-9-]{0,38}$/i;
const REPO = /^[A-Za-z0-9._-]{1,100}$/;
const MAX_PAGES = 5; // 500 repositories; a longer list is stored as "every repository of the owner"

/** A refusal whose sentence is safe to show on the setup page (fixed words plus, at most, a GitHub login). */
export class FineSetupRefusal extends Error {
  constructor(plain) { super(plain); this.name = 'FineSetupRefusal'; this.plain = plain; }
}
const refuse = (plain) => new FineSetupRefusal(plain);
const GENERIC = 'The fine-grained token was not verified. Check that it is a fine-grained token from your own GitHub login, then try again.';

const parseExpiry = (value) => {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const ms = Date.parse(text.replace(' UTC', 'Z').replace(' ', 'T'));
  return Number.isFinite(ms) ? ms : null;
};

/**
 * Verifies and stores one fine-grained token. Returns nonsecret facts only.
 * @returns {Promise<{ status: string, kind: 'F', owner: string, repositories: number|'all', permissions: string[], expiresAt: string|null }>}
 */
export async function enrollFineGrainedCredential({
  directory, db, tenant, bearer, env = process.env, fetchImpl = fetch, now = Date.now
} = {}) {
  if (typeof bearer !== 'string' || bearer.length < 20 || bearer.length > 4096 || /[^\x21-\x7e]/.test(bearer) ||
      typeof directory?.authorizedPilotIdentity !== 'function' || typeof directory?.getPilotVerifiedSubject !== 'function' ||
      typeof directory?.putPilotOptionalCredential !== 'function' || typeof db?.getAccount !== 'function' ||
      typeof db?.upsertFinePlace !== 'function' || !tenant?.tenantId || !tenant?.identityId ||
      !Number.isSafeInteger(tenant.membershipRevision) || !Number.isSafeInteger(tenant.pilotRevision)) throw refuse(GENERIC);
  // Classic tokens (ghp_…) and anything else are refused before any GitHub traffic: this page is for fine-grained tokens.
  if (!bearer.startsWith(FINE_PREFIX)) throw refuse('That is not a fine-grained token (they start with github_pat_). For a classic token use the master token page instead.');
  try {
    const active = await directory.authorizedPilotIdentity(tenant.tenantId, tenant.identityId);
    if (!active || active.membershipRevision !== tenant.membershipRevision || active.pilotRevision !== tenant.pilotRevision) throw refuse(GENERIC);
    const subject = await directory.getPilotVerifiedSubject(tenant.tenantId, tenant.identityId);
    if (typeof subject !== 'string' || !SUBJECT.test(subject)) throw refuse(GENERIC);
    // Only through the shared client (pinned API version, user agent). The token stays inside this request.
    const octokit = bareOctokit({ token: bearer, fetch: fetchImpl });
    const request = (route, params = {}) => octokit.request(route, { ...params, request: { signal: AbortSignal.timeout(10000) } });
    let me;
    try { me = await request('GET /user'); } catch { throw refuse('GitHub did not accept this token. It may be expired, revoked or mistyped.'); }
    if (String(me.data?.id) !== subject) throw refuse('This token belongs to a different GitHub login than the one you signed in with.');
    // A fine-grained token has no classic scopes. A classic token always reports them, even when empty-handed.
    if (me.headers?.['x-oauth-scopes'] !== undefined && me.headers?.['x-oauth-scopes'] !== null) throw refuse('That is a classic token, not a fine-grained one.');
    const expiry = parseExpiry(me.headers?.['github-authentication-token-expiration']);
    if (expiry !== null && expiry <= now()) throw refuse('This token has already expired. Create a new one on GitHub.');

    // Which repositories does it reach? GitHub gives a fine-grained token exactly one owner.
    const repos = [];
    let complete = false;
    for (let page = 1; page <= MAX_PAGES; page++) {
      const got = (await request('GET /user/repos', { per_page: 100, page, sort: 'full_name' })).data;
      if (!Array.isArray(got)) throw refuse(GENERIC);
      repos.push(...got);
      if (got.length < 100) { complete = true; break; }
    }
    if (!repos.length) throw refuse('This token cannot see any repository. On GitHub, edit the token, choose its repositories under Repository access, then try again.');
    const owners = new Map(repos.map((r) => [String(r?.owner?.login ?? '').toLowerCase(), r.owner]));
    if (owners.size !== 1) throw refuse('This token reaches repositories of more than one owner, so it could not be matched to one place. Create one fine-grained token per owner.');
    const [[ownerKey, ownerInfo]] = [...owners];
    if (!LOGIN.test(ownerKey) || !Number.isSafeInteger(ownerInfo?.id) || ownerInfo.id < 1 || !['User', 'Organization'].includes(ownerInfo?.type)) throw refuse(GENERIC);
    const ownerLogin = String(ownerInfo.login);
    const existing = await db.getAccount(ownerLogin);
    if (existing && existing.credential_kind !== 'master')
      throw refuse(`${ownerLogin} is already connected with the GitHub App, which is the better way. The token was not saved.`);
    if (existing && existing.place_cred !== 'F')
      throw refuse(`${ownerLogin} is already an extra place through your master token. The token was not saved.`);
    const names = repos.map((r) => String(r?.name ?? '')).filter((n) => REPO.test(n));
    if (names.length !== repos.length) throw refuse(GENERIC);

    // What can it read? One sample repository (permissions on a fine-grained token apply to all of its repositories).
    const sample = repos[0];
    const scope = ownerInfo.type === 'Organization' ? 'org' : String(ownerInfo.id) === subject ? 'user' : 'none';
    const permissions = await readFinePermissions(request, { owner: ownerLogin, repo: sample.name,
      ref: typeof sample.default_branch === 'string' && sample.default_branch ? sample.default_branch : null, scope });
    if (!validPermissionSet(permissions)) throw refuse(GENERIC);

    const accountLogin = ownerKey;
    const accessEnc = encryptSecret(bearer, { key: readEncryptionKey(env),
      aad: pilotOptionalAad({ tenantId: tenant.tenantId, identityId: tenant.identityId, accountLogin, kind: 'F' }) });
    const fresh = await directory.authorizedPilotIdentity(tenant.tenantId, tenant.identityId);
    if (!fresh || fresh.membershipRevision !== tenant.membershipRevision || fresh.pilotRevision !== tenant.pilotRevision) throw refuse(GENERIC);
    // Replacing this owner's earlier token is a compare-and-swap on its ciphertext, so two saves cannot cross.
    const prior = typeof directory.pilotOptionalFingerprint === 'function'
      ? await directory.pilotOptionalFingerprint({ tenantId: tenant.tenantId, identityId: tenant.identityId, accountLogin, kind: 'F' }) : null;
    const expiresAt = expiry === null ? null : new Date(expiry);
    const stored = await directory.putPilotOptionalCredential({
      tenantId: tenant.tenantId, identityId: tenant.identityId, accountLogin, kind: 'F', actorId: Number(subject),
      accountId: ownerInfo.id, membershipRevision: tenant.membershipRevision, pilotRevision: tenant.pilotRevision, accessEnc,
      operation: 'GET /user/repos', resource: 'owner/' + ownerInfo.id, scopes: permissions, expiresAt,
      expectedFingerprint: prior?.cipher_fingerprint ?? null });
    if (!stored) throw refuse(GENERIC);
    const place = await db.upsertFinePlace({ login: ownerLogin, accountId: ownerInfo.id, accountType: ownerInfo.type, repos: complete ? names : null });
    if (!place) throw refuse(GENERIC);
    if (typeof db.addAccountsToConnections === 'function') await db.addAccountsToConnections([ownerLogin]);
    // A new or re-checked token starts with a clean record of what GitHub refused (bookkeeping never fails the save).
    try {
      if (typeof db.setSetting === 'function') {
        await db.setSetting(fineSettingKey('fine_refused', subject, accountLogin), '');
        await db.setSetting(fineSettingKey('fine_rejected_at', subject, accountLogin), '');
      }
    } catch { /* the token is saved */ }
    return Object.freeze({ status: 'read-observed-at-enrollment', kind: 'F', owner: ownerLogin,
      repositories: complete ? names.length : 'all', permissions, expiresAt: expiresAt ? expiresAt.toISOString() : null });
  } catch (error) {
    // Never the token, a GitHub response body or encryption detail: only our own fixed sentences.
    if (error instanceof FineSetupRefusal) throw error;
    throw refuse(GENERIC);
  }
}

/** Nonsecret check of a stored fine-grained row for one place: right person and owner, intact ciphertext, not expired. */
export function currentFineReadback({ row, subject, place, now = Date.now() } = {}) {
  if (!row || row.kind !== 'F' || row.provider_host !== 'github.com' || typeof subject !== 'string' || !SUBJECT.test(subject) ||
      String(row.actor_id) !== subject || !place || place.credential_kind !== 'master' || place.place_cred !== 'F' ||
      Number(row.account_id) !== Number(place.account_id) || row.verified_operation !== 'GET /user/repos' ||
      row.verified_resource !== 'owner/' + Number(place.account_id) || !validPermissionSet(row.scopes) ||
      typeof row.access_enc !== 'string' || !row.access_enc.startsWith('v1.') || typeof row.cipher_fingerprint !== 'string' ||
      (row.expires_at !== null && row.expires_at !== undefined &&
        (!Number.isFinite(new Date(row.expires_at).getTime()) || new Date(row.expires_at).getTime() <= now))) return null;
  if (createHash('sha256').update(row.access_enc).digest('hex') !== row.cipher_fingerprint) return null;
  return { scopes: [...row.scopes], expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null };
}
