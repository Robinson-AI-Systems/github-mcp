// PUB-2: protected setup-page only, no anonymous customer invitation route.
// Owner explicitly permits a stable GitHub user to connect to ONE scratch
// tenant and gets one private MCP client configuration via sealed reveal.
import { randomBytes } from 'node:crypto';
import { storeFactory } from '../db-transport.js';
import { validRedirectUri } from '../core/oauth.js';
import { createTenantDirectory, openAuthorizedTenantDb } from './directory.js';
import { bootstrapPrivateOwnerPilot } from './owner-bootstrap.js';
import { verifyGithubBearerIdentity } from './github-identity.js';
import { issueTenantCredential } from './routed-credential.js';

const USER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const refused = () => new Error('Private pilot member invitation could not be verified.');
export async function invitePrivatePilotMember({
  accountLogin,targetLogin,redirectUri,rootDb,ownerCredentials,
  env=process.env,fetchImpl=fetch,rootSqlFactory=storeFactory,tenantSqlFactory=storeFactory,
  bootstrap=bootstrapPrivateOwnerPilot
}) {
  if (env.VERCEL_ENV!=='production' ||
      env.GITHUB_PRIVATE_TENANT_PILOT!=='enabled' || !env.DATABASE_URL ||
      !USER.test(String(targetLogin||'')) ||
      !validRedirectUri(redirectUri) || !redirectUri.startsWith('https://')) throw refused();
  if (!rootDb || typeof ownerCredentials?.token!=='function') throw refused();
  // The real implementation repeats the owner setup's GitHub U verification,
  // scratch-App installation proof, and idempotent private tenant bootstrap.
  const pilot=await bootstrap({accountLogin,rootDb,ownerCredentials,
    env,fetchImpl,rootSqlFactory,tenantSqlFactory});
  const ownerBearer=await ownerCredentials.token({account:pilot.account,cred:'U'});
  const owner=await verifyGithubBearerIdentity(ownerBearer,{fetchImpl});
  const response=await fetchImpl('https://api.github.com/users/'+encodeURIComponent(targetLogin),{
    headers:{accept:'application/vnd.github+json',authorization:'Bearer '+ownerBearer,
      'x-github-api-version':'2022-11-28'},
    signal:AbortSignal.timeout(10000)
  });
  if (!response?.ok || response.status!==200) throw refused();
  const target=await response.json();
  if (!Number.isSafeInteger(target?.id) || target.id<=0 ||
      target.type!=='User' || typeof target.login!=='string' ||
      target.login.toLowerCase()!==targetLogin.toLowerCase() ||
      String(target.id)===owner.subject) throw refused();
  const directory=createTenantDirectory(rootSqlFactory(env.DATABASE_URL));
  const ownerIdentity=await directory.enrollVerifiedGithubSubject(owner.subject);
  const targetIdentity=await directory.enrollVerifiedGithubSubject(String(target.id));
  const current=await directory.authorized(pilot.tenantId,ownerIdentity);
  if (!current || current.role!=='owner') throw refused();
  // Real DB constraints verify and serially increment revocation epochs.
  if (!await directory.grant(pilot.tenantId,ownerIdentity,targetIdentity,'member') ||
      !await directory.allowlistPilotIdentity(pilot.tenantId,ownerIdentity,targetIdentity))
    throw refused();
  const tenant=await directory.authorizedPilotIdentity(pilot.tenantId,targetIdentity);
  if (!tenant || tenant.role!=='member') throw refused();
  const {db}=await openAuthorizedTenantDb({
    directory,tenantId:tenant.tenantId,verifiedIdentityId:tenant.identityId,
    connectionString:env.DATABASE_URL,sqlFactory:tenantSqlFactory
  });
  const account=await db.getAccount(pilot.account);
  if (!account || account.credential_kind!=='app' ||
      account.app_id!==Number(env.GITHUB_PILOT_APP_ID) ||
      account.installation_status!=='active' ||
      !Number.isSafeInteger(account.installation_id) ||
      account.installation_id<=0) throw refused();
  // No Github U token or App installation bearer is passed to the invited
  // user. Their later browser consent must independently prove GitHub /user
  // and user-installation membership; that is the sole path to an MCP code.
  const clientId=issueTenantCredential('tcl',tenant,env);
  const clientSecret=randomBytes(32).toString('base64url');
  await db.createOAuthClient({clientId,clientSecret,redirectUris:[redirectUri],
    clientName:'Owner-approved private GitHub pilot: '+target.login});
  return Object.freeze({githubLogin:target.login,tenantId:tenant.tenantId,
    client_id:clientId,client_secret:clientSecret,redirect_uris:[redirectUri]});
}
