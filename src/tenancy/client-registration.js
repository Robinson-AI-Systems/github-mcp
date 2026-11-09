// PRIVILEGED internal client registration for an existing owner-approved pilot.
// No anonymous HTTP route invokes this function. PUB-4 must give users a
// supported client sign-in experience without showing a private backend token.
import { randomBytes } from 'node:crypto';
import { storeFactory } from '../db-transport.js';
import { validRedirectUri } from '../core/oauth.js';
import { createTenantDirectory, openAuthorizedTenantDb } from './directory.js';
import { admitTenantOAuth } from './runtime-limits.js';
import { issueTenantCredential } from './routed-credential.js';
import { resolvePrivatePilotIdentity, verifyGithubUserInstallation } from './github-identity.js';

export async function registerPrivatePilotClient({
  oauthBearer, trustedTenantId, accountLogin, redirectUris, clientName,
  env = process.env, fetchImpl = fetch,
  rootSqlFactory = storeFactory, tenantSqlFactory = storeFactory
}) {
  if (env.GITHUB_PRIVATE_TENANT_PILOT !== 'enabled' || !env.DATABASE_URL ||
      !/^[1-9][0-9]{0,18}$/.test(String(env.GITHUB_PILOT_APP_ID || '')))
    throw new Error('Private pilot registration is disabled.');
  if (!Array.isArray(redirectUris) || redirectUris.length < 1 || redirectUris.length > 8 ||
      new Set(redirectUris).size !== redirectUris.length ||
      !redirectUris.every(uri => typeof uri === 'string' && validRedirectUri(uri)) ||
      typeof accountLogin !== 'string' || !/^[A-Za-z0-9-]{1,39}$/.test(accountLogin) ||
      (clientName !== undefined && (typeof clientName !== 'string' || clientName.length>100)))
    throw new TypeError('Invalid private OAuth client registration.');
  const directory=createTenantDirectory(rootSqlFactory(env.DATABASE_URL));
  const { tenant }=await resolvePrivatePilotIdentity({
    oauthBearer,trustedTenantId,directory,env,fetchImpl
  });
  const { db,sql }=await openAuthorizedTenantDb({
    directory,tenantId:tenant.tenantId,verifiedIdentityId:tenant.identityId,
    connectionString:env.DATABASE_URL,sqlFactory:tenantSqlFactory
  });
  await admitTenantOAuth(sql,tenant.identityId);
  const account=await db.getAccount(accountLogin);
  if (!account || account.credential_kind!=='app' ||
      account.app_id!==Number(env.GITHUB_PILOT_APP_ID) ||
      !Number.isSafeInteger(account.installation_id) ||
      account.installation_status!=='active' ||
      !await verifyGithubUserInstallation(oauthBearer,{
        installationId:account.installation_id,appId:account.app_id,
        accountId:account.account_id,fetchImpl
      }))
    throw new Error('This GitHub App installation has not been delegated to the private pilot.');
  // Recheck the membership immediately before issuing the client secret.
  const again=await directory.authorizedPilotIdentity(tenant.tenantId,tenant.identityId);
  if (!again || again.membershipRevision!==tenant.membershipRevision ||
      again.pilotRevision!==tenant.pilotRevision)
    throw new Error('The private pilot membership changed during registration.');
  const clientId=issueTenantCredential('tcl',{
    tenantId:tenant.tenantId,identityId:tenant.identityId,
    membershipRevision:again.membershipRevision,pilotRevision:again.pilotRevision
  },env);
  const clientSecret=randomBytes(32).toString('base64url');
  // The exact GitHub App installation was verified against this OAuth user.
  // Bind it to the signed client so a standard mobile/desktop MCP consent
  // request needs no untrusted account form field, even with multiple Apps.
  await db.createOAuthClient({clientId,clientSecret,redirectUris,
    clientName:clientName||'GitHub private pilot',authorizedAccount:account.login});
  return Object.freeze({client_id:clientId,client_secret:clientSecret,redirect_uris:[...redirectUris],
    token_endpoint_auth_method:'client_secret_post',
    grant_types:['authorization_code','refresh_token'],response_types:['code']});
}
