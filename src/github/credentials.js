// The credential store (A3–A5): GitHub App secrets, installation tokens, the owner's user authorization and pasted
// tokens, all encrypted at rest (AES-256-GCM, `TOKEN_ENCRYPTION_KEY`) with a context tying each value to its owner so a
// copied ciphertext cannot be moved to another account. Nothing here is returned by a tool; the only consumer of plain
// values is `credentials.token()`, which the client calls once per request. Errors are plain words and never carry a value.
import crypto from 'node:crypto';
import { decryptSecret, encryptSecret, readEncryptionKey } from '../core/crypto.js';
import { bareOctokit } from './client.js';
import { GithubClientError } from './errors.js';

export const INSTALLATION_TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000; // enforced by the database query too
export const USER_TOKEN_REFRESH_MARGIN_MS = 10 * 60 * 1000;
const OAUTH_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const KEY_HELP = 'Credential storage is not set up on this server. Set TOKEN_ENCRYPTION_KEY (a base64 32-byte key; see docs/DEPLOY.md) and try again.';

const b64url = (input) => Buffer.from(input).toString('base64url');
const lower = (login) => String(login).toLowerCase();

/** Permissions GitHub offers only at `write` (checked against the vendored description by `tests/unit/credentials-downscope.test.js`). */
export const WRITE_ONLY_PERMISSIONS = Object.freeze(['workflows', 'profile']);

/** Stable text for a downscoping request: 'all' when unscoped, else a short hash of its canonical JSON. */
export function scopeKeyOf(scope) {
  if (!scope || (!scope.repositories?.length && !scope.repository_ids?.length && !scope.permissions)) return 'all';
  const canonical = JSON.stringify({
    repositories: [...(scope.repositories || [])].sort(), repository_ids: [...(scope.repository_ids || [])].sort(),
    permissions: Object.fromEntries(Object.entries(scope.permissions || {}).sort(([a], [b]) => a.localeCompare(b)))
  });
  return crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 32);
}

/** The GitHub App JWT (RS256, valid ten minutes, backdated sixty seconds for clock drift). */
export function signAppJwt({ appId, privateKey, now = Date.now }) {
  const iat = Math.floor(now() / 1000) - 60;
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ iat, exp: iat + 9 * 60 + 60, iss: String(appId) }));
  const signature = crypto.createSign('RSA-SHA256').update(`${head}.${body}`).sign(privateKey).toString('base64url');
  return `${head}.${body}.${signature}`;
}

/**
 * @param {{ db: object, env?: object, fetch?: Function, now?: () => number }} options
 * @returns the credential API: `token({ account, cred, scope })` for the client, plus the storing and verifying calls the
 *   setup page uses. `cred`: `I` the account's main credential (App installation token, or its fine-grained token),
 *   `U` the owner's user authorization, `K` the notifications token, `P` the package-only classic token.
 */
/**
 * @param {object} [options.rootApps] HARD-1: optional shared store of the App's sealed keys (`getApp(id)`). Per-person stores pass the
 *   shared (root) one so a replaced App key reaches everyone at once; without it, or when it has no such App, the store's own copy is used.
 */
export function createCredentials({ db, env = process.env, fetch = globalThis.fetch, now = Date.now, rootApps = null }) {
  const appStore = rootApps ? { async getApp(id) {
    let shared = null;
    try { shared = await rootApps.getApp(id); } catch { shared = null; }
    return shared ?? db.getApp(id);
  } } : db;
  // KEY-ROTATION: previous App secrets live only in the shared (root) store, next to the authoritative App row. A store
  // without the table (or any read failure) simply has no previous value, which is the strict case.
  async function previousSecrets(appId) {
    const store = rootApps ?? db;
    if (typeof store.getAppPreviousSecrets !== 'function') return [];
    try { return await store.getAppPreviousSecrets(appId); } catch { return []; }
  }
  let cachedKey = null;
  function key() {
    if (cachedKey) return cachedKey;
    try { cachedKey = readEncryptionKey(env); } catch { throw new GithubClientError('no_credentials', KEY_HELP); }
    return cachedKey;
  }
  const seal = (value, aad) => encryptSecret(value, { aad, key: key() });
  const open = (envelope, aad) => {
    try { return decryptSecret(envelope, { aad, key: key() }); } catch (error) {
      if (error instanceof GithubClientError) throw error;
      throw new GithubClientError('no_credentials', 'A saved GitHub credential could not be read (wrong TOKEN_ENCRYPTION_KEY, or it changed). Add the credential again on the setup page.');
    }
  };
  const contexts = {
    privateKey: (appId) => `github-mcp/app/${appId}/private_key`,
    clientSecret: (appId) => `github-mcp/app/${appId}/client_secret`,
    webhookSecret: (appId) => `github-mcp/app/${appId}/webhook_secret`,
    userToken: (login) => `github-mcp/account/${lower(login)}/user_token`,
    userRefresh: (login) => `github-mcp/account/${lower(login)}/user_refresh`,
    fineGrained: (login) => `github-mcp/account/${lower(login)}/fine_grained`,
    classic: (login) => `github-mcp/account/${lower(login)}/classic`,
    packages: (login) => `github-mcp/account/${lower(login)}/packages`,
    installation: (installationId, scopeKey) => `github-mcp/installation/${installationId}/${scopeKey}`,
    verifier: (state) => `github-mcp/setup/${state}/verifier`
  };

  const missing = (account, what) => new GithubClientError('no_credentials', `${account}: ${what} Open the setup page to fix it.`, { account });

  /** A `read_only` connection gets every permission the installation has, at `read` only (permissions that cannot be read are left out), so a bug in a tool cannot write. */
  function readOnlyScope(row, scope) {
    const granted = row.installation_permissions && typeof row.installation_permissions === 'object' ? Object.keys(row.installation_permissions) : [];
    const readable = granted.filter((name) => !WRITE_ONLY_PERMISSIONS.includes(name));
    const wanted = scope?.permissions ? readable.filter((name) => Object.hasOwn(scope.permissions, name)) : readable;
    if (!wanted.length) throw missing(row.login, 'its installation\'s permissions are not known yet, so a read-only token cannot be made. Press the check button on the setup page.');
    return { ...(scope ?? {}), permissions: Object.fromEntries(wanted.map((name) => [name, 'read'])) };
  }

  async function appOf(row) {
    const app = row.app_id == null ? null : await appStore.getApp(row.app_id);
    if (!app) throw missing(row.login, 'no GitHub App has been created for this account yet.');
    return app;
  }

  async function installationToken(row, scope, profile) {
    if (row.installation_id == null || row.installation_status !== 'active') {
      throw missing(row.login, row.installation_status === 'suspended' ? 'its GitHub App installation is suspended.' : 'the GitHub App is not installed on this account yet.');
    }
    scope = profile === 'read_only' ? readOnlyScope(row, scope) : scope;
    const scopeKey = scopeKeyOf(scope);
    const cached = await db.getInstallationToken(row.installation_id, scopeKey);
    if (cached) return open(cached.token_enc, contexts.installation(row.installation_id, scopeKey));
    const app = await appOf(row);
    const jwt = signAppJwt({ appId: app.id, privateKey: open(app.private_key_enc, contexts.privateKey(app.id)), now });
    const body = {};
    // Optional, temporary: GitHub's per-request override for the new stateless installation token format
    // (https://github.blog/changelog/2026-05-15-github-app-installation-tokens-per-request-override-header). Unset = GitHub's
    // normal rollout. Only 'enabled' or 'disabled' is sent; remove the setting once both formats are validated.
    const format = env.GITHUB_STATELESS_INSTALLATION_TOKENS;
    if (format === 'enabled' || format === 'disabled') body.headers = { 'x-github-stateless-s2s-token': format };
    if (scope?.repositories?.length) body.repositories = scope.repositories;
    if (scope?.repository_ids?.length) body.repository_ids = scope.repository_ids;
    if (scope?.permissions) body.permissions = scope.permissions;
    let response;
    try {
      response = await bareOctokit({ token: jwt, fetch }).request('POST /app/installations/{installation_id}/access_tokens', { installation_id: row.installation_id, ...body });
    } catch (error) {
      if (error?.status === 404) await db.setInstallationStatus(row.login, 'none');
      if ([401, 403, 404, 422].includes(error?.status)) {
        throw missing(row.login, `GitHub would not give the server a token (${error.status}). The App may have been uninstalled or its key replaced.`);
      }
      throw error;
    }
    const expiresAt = new Date(response.data.expires_at);
    await db.putInstallationToken(row.installation_id, scopeKey, seal(response.data.token, contexts.installation(row.installation_id, scopeKey)), expiresAt);
    return response.data.token;
  }

  // The claim is persisted, so two Vercel instances cannot spend the same
  // one-use GitHub OAuth refresh token at the same time. Never log its value.
  const USER_REFRESH_LEASE_MS = 60_000;
  // Abort the provider exchange well BEFORE the lease is eligible for takeover.
  // A slow transport must not allow two active POSTs of one-use refresh credentials.
  const USER_REFRESH_HTTP_TIMEOUT_MS = 15_000;
  const USER_REFRESH_WAIT_MS = 5_000;
  async function refreshUser(row, app, claimId) {
    const refresh = open(row.user_refresh_enc, contexts.userRefresh(row.login));
    let response, data;
    try {
      response = await fetch(OAUTH_TOKEN_URL, {
        method: 'POST',
        signal: AbortSignal.timeout(USER_REFRESH_HTTP_TIMEOUT_MS),
        headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: app.client_id, client_secret: open(app.client_secret_enc, contexts.clientSecret(app.id)), grant_type: 'refresh_token', refresh_token: refresh })
      });
      data = await response.json();
    } catch {
      // Network errors and malformed temporary responses are not revocation.
      throw new GithubClientError('rate_limited', 'GitHub user authorization could not be renewed right now. Retry this read shortly.');
    }
    if (!response.ok || data?.error || !data?.access_token || !data?.refresh_token) {
      const latest = await db.getAccount(row.login);
      if (latest?.user_token_enc && latest.user_token_enc !== row.user_token_enc) return latest;
      if (data?.error === 'bad_refresh_token' || data?.error === 'invalid_grant') {
        const cleared = await db.clearUserAuthorizationIfClaim(row.login, row.user_token_enc, claimId);
        if (!cleared) {
          const changed = await db.getAccount(row.login);
          if (changed?.user_token_enc && changed.user_token_enc !== row.user_token_enc) return changed;
        }
        throw missing(row.login, 'your GitHub sign-in for personal settings has expired.');
      }
      throw new GithubClientError('rate_limited', 'GitHub user authorization refresh was temporarily refused. Retry shortly; the saved authorization was not erased.');
    }
    const at = now();
    const saved = await db.finishUserRefresh(row.login, {
      expectedTokenEnc: row.user_token_enc, claimId, userLogin: row.user_login,
      tokenEnc: seal(data.access_token, contexts.userToken(row.login)),
      tokenExpiresAt: new Date(at + Number(data.expires_in || 28800) * 1000),
      refreshEnc: seal(data.refresh_token, contexts.userRefresh(row.login)),
      refreshExpiresAt: new Date(at + Number(data.refresh_token_expires_in || 15811200) * 1000)
    });
    const latest = await db.getAccount(row.login);
    if (!saved && (!latest?.user_token_enc || latest.user_token_enc === row.user_token_enc)) {
      // A revoked or replaced authorization must never be resurrected by this call.
      throw missing(row.login, 'the personal authorization changed during renewal. Recheck it on the private setup page.');
    }
    return latest;
  }

  async function userToken(row) {
    const deadline = Date.now() + USER_REFRESH_WAIT_MS;
    let current = row;
    while (true) {
      if (!current?.user_token_enc) throw missing(row.login, 'it has not been authorized for personal settings yet ("Authorize as me").');
      if (!current.user_token_expires_at || new Date(current.user_token_expires_at).getTime() - now() >= USER_TOKEN_REFRESH_MARGIN_MS)
        return open(current.user_token_enc, contexts.userToken(row.login));
      if (!current.user_refresh_enc) {
        await db.clearUserAuthorizationIfCurrent(row.login, current.user_token_enc);
        throw missing(row.login, 'your GitHub sign-in for personal settings has expired.');
      }
      const claimId = crypto.randomUUID();
      const at = now();
      if (await db.claimUserRefresh(row.login, {
        expectedTokenEnc: current.user_token_enc, claimId, at: new Date(at),
        expiresAt: new Date(at + USER_REFRESH_LEASE_MS)
      })) {
        try {
          current = await refreshUser(current, await appOf(current), claimId);
        } finally {
          await db.releaseUserRefreshClaim(row.login, claimId);
        }
      } else {
        if (Date.now() >= deadline) {
          throw new GithubClientError('rate_limited', 'Another request is renewing this GitHub sign-in. Retry the read shortly; no authorization was erased.');
        }
        await new Promise(resolve => setTimeout(resolve, 75));
        current = await db.getAccount(row.login);
      }
    }
  }

  async function storeUserAuthorization(login, { userLogin, accessToken, expiresIn, refreshToken, refreshExpiresIn }) {
    const at = now();
    return await db.setUserAuthorization(login, {
      userLogin, tokenEnc: seal(accessToken, contexts.userToken(login)), tokenExpiresAt: new Date(at + Number(expiresIn || 28800) * 1000),
      refreshEnc: refreshToken ? seal(refreshToken, contexts.userRefresh(login)) : null,
      refreshExpiresAt: refreshToken ? new Date(at + Number(refreshExpiresIn || 15811200) * 1000) : null
    });
  }

  return {
    /** Called by `githubFor` once per request. Returns the plain token string, or throws a plain `no_credentials`. */
    async token({ account, cred = 'I', scope, profile } = {}) {
      const row = await db.getAccount(account);
      if (!row) throw missing(account, 'it is not one of the accounts set up on this server.');
      if (cred === 'U') return await userToken(row);
      // The master token exists only for signed-in tenant connections; the legacy owner vault has none.
      if (cred === 'M') throw missing(row.login, 'the master token is only available on a signed-in connection.');
      // PUB-9: fine-grained tokens of signed-in people live in their private vault; the owner vault never holds kind 'F'.
      if (cred === 'F') throw missing(row.login, 'a fine-grained token place is only available on a signed-in connection.');
      if (cred === 'P') {
        if (scope?.repositories?.length || scope?.permissions)
          throw missing(row.login, 'a classic package token cannot be narrowed to this pass scope.');
        if (!row.package_enc) throw missing(row.login, 'no package token has been added; use the private setup page.');
        if (row.package_expires_at && new Date(row.package_expires_at).getTime() <= now())
          throw missing(row.login, 'its package token has expired; replace it on the private setup page.');
        return open(row.package_enc, contexts.packages(row.login));
      }
      if (cred === 'K') {
        if (!row.classic_enc) throw missing(row.login, 'no notifications token has been added.');
        return open(row.classic_enc, contexts.classic(row.login));
      }
      if (row.credential_kind === 'fine_grained') {
        if (scope?.permissions || scope?.repositories?.length) throw missing(row.login, 'it uses a fine-grained token, which cannot be narrowed per connection; switch it to the GitHub App.');
        if (!row.fine_grained_enc) throw missing(row.login, 'no fine-grained token has been added.');
        if (row.fine_grained_expires_at && new Date(row.fine_grained_expires_at).getTime() <= now()) throw missing(row.login, 'its fine-grained token has expired.');
        return open(row.fine_grained_enc, contexts.fineGrained(row.login));
      }
      return await installationToken(row, scope, profile);
    },

    /** Stores the App returned by `POST /app-manifests/{code}/conversions`, encrypting its three secrets. Returns no secret. */
    async storeApp(conversion, { ownerLogin, ownerType }) {
      const id = Number(conversion?.id);
      for (const field of ['slug', 'client_id', 'client_secret', 'pem', 'webhook_secret']) {
        if (typeof conversion?.[field] !== 'string' || !conversion[field]) throw new TypeError(`The GitHub App response is missing ${field}.`);
      }
      if (!Number.isSafeInteger(id) || id <= 0) throw new TypeError('The GitHub App response has no valid id.');
      await db.saveApp({
        id, slug: conversion.slug, ownerLogin, ownerType, clientId: conversion.client_id,
        clientSecretEnc: seal(conversion.client_secret, contexts.clientSecret(id)),
        privateKeyEnc: seal(conversion.pem, contexts.privateKey(id)),
        webhookSecretEnc: seal(conversion.webhook_secret, contexts.webhookSecret(id)),
        permissions: conversion.permissions ?? {}
      });
      return { id, slug: conversion.slug, client_id: conversion.client_id };
    },
    /** The App's webhook secret, for verifying `X-Hub-Signature-256` (A12) and nothing else. */
    async webhookSecret(appId) {
      const app = await appStore.getApp(appId);
      return app ? open(app.webhook_secret_enc, contexts.webhookSecret(app.id)) : null;
    },
    /**
     * KEY-ROTATION: every webhook secret a delivery may be signed with right now: the current one, plus the replaced one
     * while its stored window (at most 24 hours) is open. Never more than two; the webhook handler checks each in turn.
     */
    async webhookSecrets(appId) {
      const app = await appStore.getApp(appId);
      if (!app) return [];
      const out = [open(app.webhook_secret_enc, contexts.webhookSecret(app.id))];
      const previous = (await previousSecrets(app.id)).find((x) => x.kind === 'webhook_secret' && x.accepted_until.getTime() > now());
      if (previous) { try { out.push(open(previous.secret_enc, contexts.webhookSecret(app.id))); } catch { /* an unreadable old value is simply not accepted */ } }
      return out;
    },
    /**
     * KEY-ROTATION: replaces one App secret in the shared store (the caller already proved the new value with GitHub).
     * The replaced value stays sealed until `acceptedUntil`. Returns { replaced: boolean }; never a value.
     */
    async replaceAppSecret(appId, kind, value, { acceptedUntil }) {
      if (!['private_key', 'client_secret', 'webhook_secret'].includes(kind)) throw new TypeError('Unknown App secret.');
      if (typeof value !== 'string' || !value) throw new TypeError('A new value is required.');
      const app = await db.getApp(appId);
      if (!app) return { replaced: false };
      const column = kind + '_enc', context = { private_key: contexts.privateKey, client_secret: contexts.clientSecret, webhook_secret: contexts.webhookSecret }[kind](app.id);
      if (open(app[column], context) === value) return { replaced: false, same: true };
      const replaced = await db.replaceAppSecret({ id: app.id, kind, expectedEnc: app[column], newEnc: seal(value, context), acceptedUntil });
      return { replaced };
    },
    /** KEY-ROTATION Undo: puts the replaced value back while its window is open. Returns true when undone. */
    async restoreAppSecret(appId, kind) {
      const app = await db.getApp(appId);
      return app ? await db.restorePreviousAppSecret({ id: app.id, kind, expectedEnc: app[kind + '_enc'] }) : false;
    },
    /** KEY-ROTATION Finish now: the replaced value stops being accepted at once. Returns true when one was removed. */
    async endAppSecretOverlap(appId, kind) { return await db.endAppSecretOverlap({ id: Number(appId), kind }); },
    /** KEY-ROTATION: which App secrets have an open window, as [{ kind, acceptedUntil }] (no values). */
    async appSecretWindows(appId) {
      return (await previousSecrets(appId)).filter((x) => x.accepted_until.getTime() > now()).map((x) => ({ kind: x.kind, acceptedUntil: x.accepted_until }));
    },
    /** The App's OAuth client id and secret, for the user-authorization exchange on the setup page (A-5b). */
    async clientCredentials(appId) {
      const app = await appStore.getApp(appId);
      return app ? { clientId: app.client_id, clientSecret: open(app.client_secret_enc, contexts.clientSecret(app.id)) } : null;
    },
    /** A short-lived JWT for calls made as the App itself (`GET /app`, installation lookups). */
    async appJwt(appId) {
      const app = await appStore.getApp(appId);
      if (!app) throw new GithubClientError('no_credentials', 'That GitHub App is not stored on this server.');
      return signAppJwt({ appId: app.id, privateKey: open(app.private_key_enc, contexts.privateKey(app.id)), now });
    },
    storeUserAuthorization,
    async storeFineGrained(login, token, { expiresAt = null, actorId = null, accountId = null } = {}) {
      if (typeof token !== 'string' || token.length < 20) throw new TypeError('That does not look like a GitHub token.');
      const enc=seal(token,contexts.fineGrained(login));
      const saved=await db.setFineGrainedToken(login,{enc,last4:token.slice(-4),expiresAt});
      if(saved && Number.isSafeInteger(actorId)&&actorId>0 &&
          Number.isSafeInteger(accountId)&&accountId>0 &&
          typeof db.bindAdditionalCredentialProof==='function') {
        await db.bindAdditionalCredentialProof({login,kind:'F',expectedCipher:enc,
          proof:{version:1,kind:'F',host:'github.com',actorId,accountId,
            scope:'legacy-owner',
            fingerprint:crypto.createHash('sha256').update(enc).digest('hex'),
            verification:'identity-only',expiresAt:expiresAt?.toISOString()??null}});
      }
      return saved;
    },
    async storePackage(login, token, { scopes, actor, actorId = null, accountId = null, expiresAt = null, listReadback = false }) {
      if (typeof token !== 'string' || token.length < 20) throw new TypeError('That does not look like a GitHub token.');
      if (!Array.isArray(scopes) || !scopes.includes('read:packages') || scopes.some(s => !['read:packages', 'write:packages', 'delete:packages', 'repo'].includes(s)) || typeof actor !== 'string' || !actor)
        throw new TypeError('Package credentials require a verified actor and package scopes.');
      const enc=seal(token,contexts.packages(login));
      const saved=await db.setPackageToken(login,{enc,scopes:[...scopes],actor,expiresAt});
      // Legacy calls without verified numeric identity remain valid but
      // unverified. A simultaneous replacement cannot inherit evidence.
      if(saved && Number.isSafeInteger(actorId)&&actorId>0 &&
          Number.isSafeInteger(accountId)&&accountId>0 &&
          typeof db.bindAdditionalCredentialProof==='function') {
        await db.bindAdditionalCredentialProof({login,kind:'P',expectedCipher:enc,
          proof:{version:1,kind:'P',host:'github.com',actorId,accountId,
            scope:'legacy-owner',
            fingerprint:crypto.createHash('sha256').update(enc).digest('hex'),
            verification:listReadback?'identity-and-capability-readback':'identity-only',
            operation:listReadback?'GET /orgs/{org}/packages':null,
            resource:listReadback?'org/'+accountId:null,
            scopes:listReadback?['read:packages']:[],
            expiresAt:expiresAt?.toISOString()??null}});
      }
      return saved;
    },
    async storeClassic(login, token, scopes, { actorId = null, accountId = null, listReadback = false } = {}) {
      if (typeof token !== 'string' || token.length < 20) throw new TypeError('That does not look like a GitHub token.');
      const enc=seal(token,contexts.classic(login));
      const saved=await db.setClassicToken(login,{enc,scopes:[...scopes],last4:token.slice(-4)});
      if(saved && Number.isSafeInteger(actorId)&&actorId>0 &&
          Number.isSafeInteger(accountId)&&accountId>0 &&
          typeof db.bindAdditionalCredentialProof==='function') {
        await db.bindAdditionalCredentialProof({login,kind:'K',expectedCipher:enc,
          proof:{version:1,kind:'K',host:'github.com',actorId,accountId,
            scope:'legacy-owner',
            fingerprint:crypto.createHash('sha256').update(enc).digest('hex'),
            verification:listReadback?'identity-and-capability-readback':'identity-only',
            operation:listReadback?'GET /notifications':null,
            resource:listReadback?'user/'+actorId:null,
            scopes:listReadback?['notifications']:[],
            expiresAt:null}});
      }
      return saved;
    },
    /** For a user-token 401: forget the authorization so the setup page asks for it again (A5). */
    async forgetUserAuthorization(login) { await db.clearUserAuthorization(login); },
    /** Seals a PKCE verifier for the time between the setup page and the callback. */
    sealVerifier(state, verifier) { return seal(verifier, contexts.verifier(state)); },
    openVerifier(state, envelope) { return open(envelope, contexts.verifier(state)); },
    /** True when the encryption key is configured and valid (the setup page refuses to store anything otherwise). */
    keyConfigured() { try { key(); return true; } catch { return false; } }
  };
}
