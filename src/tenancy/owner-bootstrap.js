// PUB-2 private owner-initiated bootstrap only. The caller MUST already have
// passed the protected setup-page passphrase, same-origin/CSRF and production
// checks. Never expose this function as a public API, MCP tool, or Hub action.
import { createTenantDirectory, initializeProvisionedTenant } from './directory.js';
import { storeFactory } from '../db-transport.js';
import { verifyGithubBearerIdentity, verifyGithubUserInstallation } from './github-identity.js';

export async function bootstrapPrivateOwnerPilot({
  accountLogin, rootDb, ownerCredentials, env=process.env, fetchImpl=fetch,
  rootSqlFactory=storeFactory, tenantSqlFactory=storeFactory
}) {
  if (env.VERCEL_ENV!=='production' ||
      env.GITHUB_PRIVATE_TENANT_PILOT!=='enabled' || !env.DATABASE_URL ||
      !/^[1-9][0-9]{0,18}$/.test(String(env.GITHUB_PILOT_APP_ID??'')))
    throw new Error('Private owner pilot is not enabled for this deployment.');
  if (typeof accountLogin!=='string' ||
      !/^[a-z0-9][a-z0-9-]{0,38}$/.test(accountLogin))
    throw new TypeError('Select one exact approved scratch organization.');
  if (!rootDb || !ownerCredentials || typeof ownerCredentials.token!=='function')
    throw new TypeError('Private owner setup credentials are required.');
  const account=await rootDb.getAccount(accountLogin);
  const app=account?.app_id ? await rootDb.getApp(account.app_id) : null;
  if (!account || account.account_type!=='Organization' ||
      account.credential_kind!=='app' || !account.is_scratch ||
      account.installation_status!=='active' ||
      account.repository_selection!=='all' ||
      account.app_id!==Number(env.GITHUB_PILOT_APP_ID) ||
      !Number.isSafeInteger(account.installation_id) ||
      account.installation_id<=0 || !app ||
      !app.client_secret_enc || !app.private_key_enc || !app.webhook_secret_enc)
    throw new Error('A verified installed scratch GitHub App is required.');
  // The owner's already-encrypted, user-authorized GitHub U credential proves
  // their principal. Never trust an account name typed into the setup form.
  const bearer=await ownerCredentials.token({account:account.login,cred:'U'});
  const principal=await verifyGithubBearerIdentity(bearer,{fetchImpl});
  if (principal.login.toLowerCase()!==String(account.user_login||'').toLowerCase() ||
      !await verifyGithubUserInstallation(bearer,{
        installationId:account.installation_id,appId:account.app_id,
        accountId:account.account_id,fetchImpl
      })) throw new Error('GitHub cannot verify this owner and App installation.');
  const directory=createTenantDirectory(rootSqlFactory(env.DATABASE_URL));
  await directory.initSchema();
  const identityId=await directory.enrollVerifiedGithubSubject(principal.subject);
  const tenantId=await directory.provisionPilotForOwnerAccount(identityId,account.login.toLowerCase());
  const {db}=await initializeProvisionedTenant({
    tenantId,connectionString:env.DATABASE_URL,sqlFactory:tenantSqlFactory
  });
  // Copy ONLY already-encrypted, service-owned App key material to this
  // isolated tenant. Encryption AAD stays bound to the SAME App numeric ID.
  // Do NOT copy the owner's U token, unrelated accounts or production flag.
  await db.saveApp({id:app.id,slug:app.slug,ownerLogin:app.owner_login,
    ownerType:app.owner_type,clientId:app.client_id,
    clientSecretEnc:app.client_secret_enc,privateKeyEnc:app.private_key_enc,
    webhookSecretEnc:app.webhook_secret_enc,permissions:app.permissions});
  await db.upsertAccount({login:account.login,accountId:account.account_id,
    accountType:'Organization',label:account.label,
    credentialKind:'app',appId:app.id});
  if (!await db.setInstallation(account.login,{
    installationId:account.installation_id,
    repositorySelection:account.repository_selection,
    permissions:account.installation_permissions,status:'active'
  })) throw new Error('The private tenant App installation could not be stored.');
  const already=await directory.authorized(tenantId,identityId);
  if (!already && !await directory.activate(tenantId,
    'gh_t_'+tenantId.replaceAll('-','')))
    throw new Error('The private tenant could not be activated.');
  const allowed=await directory.resolveAllowlistedPilotSubject(tenantId,principal.subject);
  if (!allowed && !await directory.allowlistPilotIdentity(tenantId,identityId,identityId))
    throw new Error('Private pilot access was not approved.');
  return Object.freeze({tenantId,account:account.login,githubUser:principal.login,
    reused:already!==null});
}
