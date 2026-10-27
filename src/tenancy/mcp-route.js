// PRIVATE tenant MCP routing boundary. Every tenant bearer is self-scoped by
// HMAC, checked against current membership/allowlist, AND looked up by hash in
// only that tenant's store. A failed tenant credential must NEVER be looked up
// through the legacy owner's global database.
import { neon } from '@neondatabase/serverless';
import { createTenantDirectory, openAuthorizedTenantDb } from './directory.js';
import { isTenantRoutedCredential, verifyTenantCredential } from './routed-credential.js';
import { isPublicClientId } from './public-code.js';
import { createCredentials } from '../github/credentials.js';
import { createDb } from '../db.js';
import { createTenantScopedCredentials } from './user-authorization.js';
import { withTenantStorageLimits, withTenantProviderMetrics, createTenantMetricBuffer } from './runtime-limits.js';

export const isPrivateTenantBearer = (authorization) =>
  typeof authorization === 'string' &&
  /^[Bb][Ee][Aa][Rr][Ee][Rr][ \t]+(?:tac|trf|tcl)_/.test(authorization);

/** Dependency overrides are for private tests only; no user-visible route
 * accepts an arbitrary tenant identifier, identity or tenant SQL handle. */
export async function resolvePrivateTenantMcpBearer({
  authorization, env = process.env, fetchImpl = fetch, rootSqlFactory = neon,
  tenantSqlFactory = neon
}) {
  const value = /^[Bb][Ee][Aa][Rr][Ee][Rr][ \t]+([A-Za-z0-9_-]{30,256})$/.exec(String(authorization || ''))?.[1];
  if (!value || !isTenantRoutedCredential(value)) return null;
  const claim = verifyTenantCredential(value, 'tac', env);
  if (!claim || !env.DATABASE_URL) return null;
  try {
    const directory = createTenantDirectory(rootSqlFactory(env.DATABASE_URL));
    const authorized = await directory.authorizedPilotIdentity(claim.tenantId, claim.identityId);
    const marketplace = await directory.marketplaceBinding(claim.tenantId);
    if (marketplace && !marketplace.active) return null;
    if (!authorized || authorized.tenantId !== claim.tenantId ||
        authorized.identityId !== claim.identityId ||
        authorized.membershipRevision !== claim.membershipRevision ||
        authorized.pilotRevision !== claim.pilotRevision) return null;
    const { db, tenant, sql } = await openAuthorizedTenantDb({
      directory, tenantId: claim.tenantId, verifiedIdentityId: claim.identityId,
      connectionString: env.DATABASE_URL, sqlFactory: tenantSqlFactory
    });
    if (tenant.namespace !== authorized.namespace ||
        tenant.membershipRevision !== authorized.membershipRevision) return null;
    const grant = await db.getAccessToken(value);
    // The token must be a real tenant-scoped connector issued to exactly
    // this identity, with its registered client also MAC-bound to the same
    // tenant/identity. Arbitrary legacy client IDs never inherit tenant access.
    // PUB-6 (dark): a public (pcl_) client has no tenant inside its id. The access token itself is tenant/identity
    // signed and revision-pinned (checked above); the client must still exist at the root (deleting it is the
    // emergency lever) and be mirrored in this tenant. Such a connection may span several of the SAME person's
    // accounts; every one is validated below. Signed (tcl_) clients keep the exact single-account rule.
    const isPublic = typeof grant?.client_id === 'string' && isPublicClientId(grant.client_id);
    if (isPublic) {
      if (!await directory.getPublicClient(grant.client_id) || !await db.getOAuthClient(grant.client_id)) return null;
    } else {
      const client = grant?.client_id &&
        verifyTenantCredential(grant.client_id, 'tcl', env);
      if (!client || client.tenantId !== claim.tenantId ||
          client.identityId !== claim.identityId ||
          client.membershipRevision !== claim.membershipRevision ||
          client.pilotRevision !== claim.pilotRevision) return null;
    }
    const selectedAccount = grant.default_account;
    if (!Array.isArray(grant.accounts) || !grant.accounts.length || grant.accounts.length > 10 ||
        !grant.accounts.includes(selectedAccount) ||
        (!isPublic && (grant.accounts.length !== 1 || grant.accounts[0] !== selectedAccount))) return null;
    for (const login of grant.accounts) {
      const account = await db.getAccount(login);
      // GOD-5: an extra place (master token) has no installation; it only needs to still exist. Its own gate and the master
      // token checks decide every request, so a place switched back to read-only never breaks the rest of the connection.
      if (account?.credential_kind === 'master') continue;
      if (!account || account.credential_kind !== 'app' ||
          account.installation_status !== 'active' ||
          !Number.isSafeInteger(account.installation_id) || account.installation_id <= 0 ||
          !Number.isSafeInteger(account.app_id) ||
          account.app_id !== Number(env.GITHUB_PILOT_APP_ID) ||
          (grant.mode === 'production' &&
            (env.VERCEL_ENV !== 'production' || account.production_enabled !== true))) return null;
    }
    // Keep transport events in this tenant's validated SQL namespace. Metrics
    // contain no URL, GitHub subject, repository, token or exception text.
    const providerMetrics=createTenantMetricBuffer(sql);
    const meteredFetch=withTenantProviderMetrics(sql,fetchImpl,{buffer:providerMetrics});
    // HARD-1: the App's sealed keys come from the one shared (root) copy, so a replaced key reaches every person at once.
    const base = createCredentials({ db, env, fetch: meteredFetch, rootApps: createDb(rootSqlFactory(env.DATABASE_URL)) });
    let credentials = createTenantScopedCredentials({
      base, directory, tenant: authorized, db, env, fetchImpl:meteredFetch
    });
    if (marketplace) {
      const live = async () => { if (!(await directory.marketplaceBinding(claim.tenantId))?.active)
        throw new Error('Marketplace subscription is not active.'); };
      const wrapped = {...credentials};
      for (const name of ['token','operationAuthority','authorizeOptionalRequest']) {
        const original = credentials[name];
        if (typeof original === 'function') wrapped[name] = async (...args) => {
          await live(); const result = await original(...args); await live(); return result;
        };
      }
      credentials = wrapped;
    }
    return { db: withTenantStorageLimits(db,sql,grant.client_id), credentials,
      sql, providerMetrics, clientId: grant.client_id,
      marketplaceAccountId: marketplace?.accountId ?? null,
      tenant: Object.freeze({ ...authorized }) };
  } catch {
    // Missing private registry, driver search_path refusal, revocation, and
    // database failure are all a closed authentication failure. No SQL details.
    return null;
  }
}
