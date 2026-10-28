import crypto, { createHash } from 'node:crypto';
import pg from 'pg';
import { createDb } from '../../src/db.js';
import { issueTenantCredential } from '../../src/tenancy/routed-credential.js';
import { resolvePrivateTenantMcpBearer } from '../../src/tenancy/mcp-route.js';
import { privateTenantToken } from '../../src/tenancy/oauth-token.js';
import { createPrivateGitHubConsent } from '../../src/tenancy/github-consent.js';
import { registerPrivatePilotClient } from '../../src/tenancy/client-registration.js';
import { createCredentials } from '../../src/github/credentials.js';
import { createTenantScopedCredentials, storePilotUserGrant } from '../../src/tenancy/user-authorization.js';
import { bootstrapPrivateOwnerPilot } from '../../src/tenancy/owner-bootstrap.js';
import { invitePrivatePilotMember } from '../../src/tenancy/private-invite.js';
import { encryptSecret } from '../../src/core/crypto.js';
import { call, json, request } from '../../test/helpers/http-harness.js';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createTenantDirectory, tenantConnectionString, tenantSchemaName,
  initializeProvisionedTenant } from '../../src/tenancy/directory.js';

let admin, tenantA, tenantB, directory, a, b, ownerA, ownerB, namespace;
const clients = [];
const extraTenantIds = [];
const connect = async (url) => {
  const p = new pg.Client({ connectionString: url });
  await p.connect(); clients.push(p); return p;
};
async function signed(kind,scope,env){
  const latest=await directory.authorizedPilotIdentity(scope.tenantId,scope.identityId);
  if(!latest) throw new Error('The real pilot membership must exist before signing.');
  return issueTenantCredential(kind,{...scope,
    membershipRevision:latest.membershipRevision,pilotRevision:latest.pilotRevision},env);
}
const sqlFor = (client) => async (template, ...values) => {
  let query = template[0];
  for (let i = 0; i < values.length; i++) query += '$' + (i + 1) + template[i + 1];
  return (await client.query(query, values)).rows;
};

beforeAll(async () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('Disposable TEST_DATABASE_URL is required.');
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(url).hostname))
    throw new Error('Refusing non-local PostgreSQL for private-pilot tests.');
  admin = await connect(url);
  namespace = 'github_pub2_pilot_' + crypto.randomBytes(6).toString('hex');
  await admin.query('CREATE SCHEMA "' + namespace + '"');
  await admin.query('SET search_path TO "' + namespace + '"');
  directory = createTenantDirectory(sqlFor(admin));
  await directory.initSchema();
  ownerA = await directory.enrollVerifiedGithubSubject('20001');
  ownerB = await directory.enrollVerifiedGithubSubject('20002');
  a = await directory.provision(ownerA);
  b = await directory.provision(ownerB);
  const pa = await connect(tenantConnectionString(url, a.id));
  const pb = await connect(tenantConnectionString(url, b.id));
  tenantA = sqlFor(pa); tenantB = sqlFor(pb);
  await initializeProvisionedTenant({ tenantId: a.id, connectionString: url, sqlFactory: () => tenantA });
  await initializeProvisionedTenant({ tenantId: b.id, connectionString: url, sqlFactory: () => tenantB });
  expect(await directory.activate(a.id, tenantSchemaName(a.id))).toBe(true);
  expect(await directory.activate(b.id, tenantSchemaName(b.id))).toBe(true);
});

afterAll(async () => {
  if (admin) {
    for (const tenant of [a, b, ...extraTenantIds.map(id=>({id}))]) {
      if (tenant?.id) await admin.query('DROP SCHEMA IF EXISTS "' + tenantSchemaName(tenant.id) + '" CASCADE').catch(() => {});
    }
    if (namespace) await admin.query('DROP SCHEMA IF EXISTS "' + namespace + '" CASCADE').catch(() => {});
  }
  for (const c of clients.reverse()) await c.end().catch(() => {});
});

describe('PUB-2 private-only provider identity and tenant pilot allowlist in REAL PostgreSQL', () => {
  it('creates exactly one private tenant under concurrent owner retries using genuine PostgreSQL transactions', async () => {
    const clientTwo=await connect(process.env.TEST_DATABASE_URL);
    await clientTwo.query('SET search_path TO "' + namespace + '"');
    const otherDirectory=createTenantDirectory(sqlFor(clientTwo));
    const ids=await Promise.all(Array.from({length:8},(_,i)=>(i%2?directory:otherDirectory)
      .provisionPilotForOwnerAccount(ownerA,'pilot-once-org')));
    expect(new Set(ids).size).toBe(1);
    const id=ids[0];
    extraTenantIds.push(id);
    const rows=await admin.query('SELECT count(*)::integer AS n FROM gh_tenant_pilot_bootstraps WHERE account_login=$1',["pilot-once-org"]);
    expect(rows.rows[0].n).toBe(1);
    expect(await directory.authorized(id,ownerB)).toBeNull();
    const dbClient=await connect(tenantConnectionString(process.env.TEST_DATABASE_URL,id));
    await initializeProvisionedTenant({tenantId:id,connectionString:process.env.TEST_DATABASE_URL,
      sqlFactory:()=>sqlFor(dbClient)});
    expect(await directory.activate(id,tenantSchemaName(id))).toBe(true);
    expect((await directory.authorized(id,ownerA)).role).toBe('owner');
    expect(await otherDirectory.provisionPilotForOwnerAccount(ownerA,'pilot-once-org')).toBe(id);
    expect(await directory.activate(id,tenantSchemaName(id))).toBe(false);
  });

  it('owner bootstrap verifies live GitHub, copies only sealed App data and reuses one tenant on retry',async()=>{
    const rootDb=createDb(sqlFor(admin));
    await rootDb.initSchema();
    const env={VERCEL_ENV:'production',GITHUB_PRIVATE_TENANT_PILOT:'enabled',
      GITHUB_PILOT_APP_ID:'920001',DATABASE_URL:process.env.TEST_DATABASE_URL,
      TOKEN_ENCRYPTION_KEY:crypto.randomBytes(32).toString('base64url')};
    const app=920001,org='owner-pilot-fixture',installation=920002;
    const secret=(text,kind)=>encryptSecret(text,{
      aad:'github-mcp/app/'+app+'/'+kind,key:Buffer.from(env.TOKEN_ENCRYPTION_KEY,'base64url')});
    const appKey=secret('fixture-private-key-material','private_key');
    const appClient=secret('fixture-client-secret-value','client_secret');
    await rootDb.saveApp({id:app,slug:'private-pilot-app',ownerLogin:org,
      ownerType:'Organization',clientId:'fixture-client-id',
      clientSecretEnc:appClient,privateKeyEnc:appKey,
      webhookSecretEnc:secret('fixture-webhook-secret','webhook_secret'),permissions:{contents:'read'}});
    await rootDb.upsertAccount({login:org,accountId:920003,
      accountType:'Organization',label:'Owner scratch pilot',
      credentialKind:'app',appId:app,isScratch:true});
    await rootDb.setInstallation(org,{installationId:installation,
      repositorySelection:'all',permissions:{contents:'read'},status:'active'});
    const fetchImpl=async url=>{
      if(url==='https://api.github.com/user')
        return {ok:true,status:200,json:async()=>({id:20001,login:'real-owner-fixture',type:'User'})};
      if(url==='https://api.github.com/user/installations?per_page=100')
        return {ok:true,status:200,json:async()=>({total_count:1,
          installations:[{id:installation,app_id:app,account:{id:920003},suspended_at:null}]})};
      throw Error('Unrecognized fixture GitHub read');
    };
    const rootCredentials=createCredentials({db:rootDb,env,fetch:fetchImpl});
    await rootCredentials.storeUserAuthorization(org,{
      userLogin:'real-owner-fixture',accessToken:'fixture-owner-auth-test-token',
      expiresIn:28800,refreshToken:null});
    const sqlPool=new Map();
    const tenantSqlFactory=url=>{
      if(!sqlPool.has(url)){
        const clientPromise=connect(url);
        sqlPool.set(url,async(parts,...params)=>sqlFor(await clientPromise)(parts,...params));
      }
      return sqlPool.get(url);
    };
    const args={accountLogin:org,rootDb,ownerCredentials:rootCredentials,
      env,fetchImpl,rootSqlFactory:()=>sqlFor(admin),tenantSqlFactory};
    const one=await bootstrapPrivateOwnerPilot(args);
    const two=await bootstrapPrivateOwnerPilot(args);
    expect(two.tenantId).toBe(one.tenantId);
    expect(one.account).toBe(org);
    expect(one.githubUser).toBe('real-owner-fixture');
    extraTenantIds.push(one.tenantId);
    expect((await directory.authorized(one.tenantId,ownerA)).role).toBe('owner');
    const userSql=tenantSqlFactory(tenantConnectionString(env.DATABASE_URL,one.tenantId));
    const tenantDb=createDb(userSql);
    const savedApp=await tenantDb.getApp(app);
    const savedOrg=await tenantDb.getAccount(org);
    expect(savedApp.private_key_enc).toBe(appKey);
    expect(savedApp.client_secret_enc).toBe(appClient);
    expect(savedOrg.production_enabled).toBe(false);
    expect(savedOrg.user_token_enc).toBeNull();
    expect(savedOrg.installation_status).toBe('active');
    expect(JSON.stringify(two)).not.toContain('fixture-owner-auth-test-token');
    expect(await directory.resolveAllowlistedPilotSubject(one.tenantId,'20001')).not.toBeNull();
    expect(await directory.revokePrivatePilotsForAccount(org)).toBe(1);
    expect(await directory.resolveAllowlistedPilotSubject(one.tenantId,'20001')).toBeNull();
    expect(await directory.revokePrivatePilotsForAccount(org)).toBe(0);
    const recovered=await bootstrapPrivateOwnerPilot(args);
    expect(recovered.tenantId).toBe(one.tenantId);
    expect(await directory.resolveAllowlistedPilotSubject(one.tenantId,'20001')).not.toBeNull();
    await expect(bootstrapPrivateOwnerPilot({...args,env:{...env,VERCEL_ENV:'preview'}}))
      .rejects.toThrow(/not enabled/);
    await rootDb.setInstallationStatus(org,'suspended');
    await expect(bootstrapPrivateOwnerPilot(args)).rejects.toThrow(/scratch GitHub App/);
    await rootDb.setInstallationStatus(org,'active');
  });

  it('does not allow an unknown, cross-tenant, or merely invited identity into a pilot', async () => {
    expect(await directory.resolveAllowlistedPilotSubject(a.id, '20001')).toBeNull();
    expect(await directory.resolveAllowlistedPilotSubject(a.id, '20002')).toBeNull();
    expect(await directory.resolveAllowlistedPilotSubject(b.id, '20001')).toBeNull();
    expect(await directory.resolveAllowlistedPilotSubject(a.id, '29999')).toBeNull();
    expect(await directory.allowlistPilotIdentity(a.id, ownerB, ownerB)).toBe(false);
    expect(await directory.allowlistPilotIdentity(a.id, ownerA, ownerB)).toBe(false);
    expect(await directory.grant(a.id, ownerA, ownerB, 'member')).toBe(true);
    expect(await directory.resolveAllowlistedPilotSubject(a.id, '20002')).toBeNull();
  });

  it('permits exactly one owner-issued pilot member and rejects cross-tenant actions', async () => {
    expect(await directory.allowlistPilotIdentity(a.id, ownerB, ownerB)).toBe(false);
    expect(await directory.allowlistPilotIdentity(a.id, ownerA, ownerB)).toBe(true);
    const match = await directory.resolveAllowlistedPilotSubject(a.id, '20002');
    expect(match).toMatchObject({ identityId: ownerB, tenantId: a.id,
      role: 'member', pilotRevision: 1 });
    expect(await directory.resolveAllowlistedPilotSubject(b.id, '20002')).toBeNull();
    expect(await directory.revokePilotIdentity(a.id, ownerB, ownerB)).toBe(false);
    expect(await directory.revokePilotIdentity(b.id, ownerA, ownerB)).toBe(false);
    expect(await directory.revokePilotIdentity(a.id, ownerA, ownerB)).toBe(true);
    expect(await directory.resolveAllowlistedPilotSubject(a.id, '20002')).toBeNull();
  });

  it('routes valid signed access into only its own tenant store; revoked and forged routes stay closed',async()=>{
    const { randomBytes } = await import('node:crypto');
    const env={GITHUB_PRIVATE_TENANT_PILOT:'enabled',
      GITHUB_TENANT_ROUTING_KEY:randomBytes(32).toString('base64url'),
      GITHUB_PILOT_APP_ID:'987001',
      DATABASE_URL:process.env.TEST_DATABASE_URL};
    const { root }={root:sqlFor(admin)};
    const tenantDbA=createDb(tenantA);
    const tenantDbB=createDb(tenantB);
    const claimA={tenantId:a.id,identityId:ownerA};
    const claimB={tenantId:b.id,identityId:ownerB};
    for(const db of [tenantDbA,tenantDbB]){
      await db.upsertAccount({login:'overlap-org',accountId:987002,accountType:'Organization',
        label:'Pilot fixture',credentialKind:'app',appId:987001});
      await db.setInstallation('overlap-org',{installationId:987003,
        repositorySelection:'all',permissions:{contents:'read'},status:'active'});
    }
    expect(await directory.allowlistPilotIdentity(a.id,ownerA,ownerA)).toBe(true);
    expect(await directory.allowlistPilotIdentity(b.id,ownerB,ownerB)).toBe(true);
    const clientA=await signed('tcl',claimA,env);
    const tokenA=await signed('tac',claimA,env);
    const refreshA=await signed('trf',claimA,env);
    const clientB=await signed('tcl',claimB,env);
    const tokenB=await signed('tac',claimB,env);
    await tenantDbA.createOAuthClient({clientId:clientA,clientSecret:'fixture-a-test-secret',
      redirectUris:['https://pilot.example.test/cb'],clientName:'A'});
    await tenantDbB.createOAuthClient({clientId:clientB,clientSecret:'fixture-b-test-secret',
      redirectUris:['https://pilot.example.test/cb'],clientName:'B'});
    await tenantDbA.createAccessToken({clientId:clientA,accessToken:tokenA,refreshToken:refreshA,
      defaultAccount:'overlap-org',accounts:['overlap-org'],mode:'preview',profile:'full',listing:'compact'});
    await tenantDbB.createAccessToken({clientId:clientB,accessToken:tokenB,
      refreshToken:await signed('trf',claimB,env),defaultAccount:'overlap-org',
      accounts:['overlap-org'],mode:'preview',profile:'read_only',listing:'compact'});
    const overrides={env,rootSqlFactory:()=>root,tenantSqlFactory:(url)=>
      url.includes(tenantSchemaName(a.id))?tenantA:tenantB};
    const one=await resolvePrivateTenantMcpBearer({...overrides,authorization:'Bearer '+tokenA});
    for(const scheme of ['bearer ','BEARER\t','bEaReR  ']){
      const alternate=await resolvePrivateTenantMcpBearer({...overrides,authorization:scheme+tokenA});
      expect(alternate?.tenant).toEqual(one.tenant);
      expect(alternate?.clientId).toBe(one.clientId);
    }
    const two=await resolvePrivateTenantMcpBearer({...overrides,authorization:'Bearer '+tokenB});
    expect(one.tenant).toMatchObject({tenantId:a.id,identityId:ownerA});
    expect(two.tenant).toMatchObject({tenantId:b.id,identityId:ownerB});
    expect((await one.db.getAccessToken(tokenA)).profile).toBe('full');
    expect((await two.db.getAccessToken(tokenB)).profile).toBe('read_only');
    expect(await one.db.getAccessToken(tokenB)).toBeNull();
    expect(await two.db.getAccessToken(tokenA)).toBeNull();
    // Already-issued connections cannot survive App suspension, credential
    // removal, or a mismatched installed App. Restore only for the next test.
    await tenantDbA.setInstallationStatus('overlap-org','suspended');
    expect(await resolvePrivateTenantMcpBearer({...overrides,authorization:'Bearer '+tokenA})).toBeNull();
    expect(await resolvePrivateTenantMcpBearer({...overrides,authorization:'Bearer '+tokenB})).not.toBeNull();
    await tenantDbA.setInstallationStatus('overlap-org','active');
    expect(await resolvePrivateTenantMcpBearer({...overrides,authorization:'Bearer '+tokenA})).not.toBeNull();
    await tenantDbA.upsertAccount({login:'overlap-org',accountId:987002,accountType:'Organization',
      label:'Mismatched App',credentialKind:'app',appId:987004});
    expect(await resolvePrivateTenantMcpBearer({...overrides,authorization:'Bearer '+tokenA})).toBeNull();
    await tenantDbA.upsertAccount({login:'overlap-org',accountId:987002,accountType:'Organization',
      label:'Restored App',credentialKind:'app',appId:987001});
    expect(await resolvePrivateTenantMcpBearer({...overrides,authorization:'Bearer '+tokenA})).not.toBeNull();
    expect(await resolvePrivateTenantMcpBearer({...overrides,
      authorization:'Bearer '+tokenA,env:{...env,GITHUB_PRIVATE_TENANT_PILOT:'disabled'}})).toBeNull();
    expect(await directory.revokePilotIdentity(a.id,ownerA,ownerA)).toBe(true);
    expect(await resolvePrivateTenantMcpBearer({...overrides,authorization:'Bearer '+tokenA})).toBeNull();
    // Re-allowlisting grants a NEW epoch; old signed clients/tokens cannot revive.
    expect(await directory.allowlistPilotIdentity(a.id,ownerA,ownerA)).toBe(true);
    expect(await resolvePrivateTenantMcpBearer({...overrides,authorization:'Bearer '+tokenA})).toBeNull();
    expect(await resolvePrivateTenantMcpBearer({...overrides,authorization:'Bearer '+tokenB})).not.toBeNull();
    expect(await tenantDbB.revokeAccessToken(tokenB)).toBe(true);
    expect(await resolvePrivateTenantMcpBearer({...overrides,authorization:'Bearer '+tokenB})).toBeNull();
  });

  it('redeems tenant-scoped OAuth code exactly once, rotates refresh atomically, and denies wrong clients',async()=>{
    const env={PUBLIC_BASE_URL:'https://pilot.github.example.test',
      GITHUB_PRIVATE_TENANT_PILOT:'enabled',
      GITHUB_PILOT_APP_ID:'987001',
      GITHUB_TENANT_ROUTING_KEY:crypto.randomBytes(32).toString('base64url'),
      DATABASE_URL:process.env.TEST_DATABASE_URL};
    const grant={tenantId:a.id,identityId:ownerA};
    const other={tenantId:b.id,identityId:ownerB};
    expect(await directory.allowlistPilotIdentity(a.id,ownerA,ownerA)).toBe(true);
    expect(await directory.allowlistPilotIdentity(b.id,ownerB,ownerB)).toBe(true);
    const clientA=await signed('tcl',grant,env);
    const clientB=await signed('tcl',other,env);
    const clientSecret='fixture-private-tenant-a-secret';
    const clientSecretB='fixture-private-tenant-b-secret';
    const dbA=createDb(tenantA),dbB=createDb(tenantB);
    for(const db of [dbA,dbB]){
      await db.upsertAccount({login:'overlap-org',accountId:987002,accountType:'Organization',
        label:'Isolated OAuth fixture',credentialKind:'app',appId:987001});
      await db.setInstallation('overlap-org',{installationId:987003,
        repositorySelection:'all',permissions:{contents:'read'},status:'active'});
    }
    const redirect='https://pilot.example.test/callback';
    const verifier='z'.repeat(43);
    const challenge=createHash('sha256').update(verifier).digest('base64url');
    await dbA.createOAuthClient({clientId:clientA,clientSecret,redirectUris:[redirect],clientName:'tenant-A-pilot'});
    await dbB.createOAuthClient({clientId:clientB,clientSecret:clientSecretB,redirectUris:[redirect],clientName:'tenant-B-pilot'});
    const code='fixture-signed-pilot-code';
    await dbA.createAuthCode({code,clientId:clientA,redirectUri:redirect,codeChallenge:challenge,
      codeChallengeMethod:'S256',defaultAccount:'overlap-org',accounts:['overlap-org'],
      mode:'preview',profile:'full',listing:'compact'});
    const route=(url)=>url.includes(tenantSchemaName(a.id))?tenantA:tenantB;
    const handler=(req,res)=>privateTenantToken(req,res,{env,rootSqlFactory:()=>sqlFor(admin),tenantSqlFactory:route});
    const form={grant_type:'authorization_code',client_id:clientA,client_secret:clientSecret,
      redirect_uri:redirect,code,code_verifier:verifier,resource:env.PUBLIC_BASE_URL+'/api/mcp'};
    const wrongClient=await call(handler,request('POST',{...form,client_id:clientB,client_secret:clientSecretB}));
    expect(wrongClient.statusCode).toBe(400);
    const redeemed=await call(handler,request('POST',form));
    expect(redeemed.statusCode).toBe(200);
    const first=json(redeemed);
    expect(first.access_token).toMatch(/^tac_/);
    expect(first.refresh_token).toMatch(/^trf_/);
    expect((await dbA.getAccessToken(first.access_token)).profile).toBe('full');
    expect(await dbB.getAccessToken(first.access_token)).toBeNull();
    expect((await call(handler,request('POST',form))).statusCode).toBe(400);
    const tokenRoute=await resolvePrivateTenantMcpBearer({
      authorization:'Bearer '+first.access_token,env,
      rootSqlFactory:()=>sqlFor(admin),tenantSqlFactory:route});
    expect(tokenRoute.tenant.tenantId).toBe(a.id);
    const rotation={grant_type:'refresh_token',client_id:clientA,client_secret:clientSecret,
      refresh_token:first.refresh_token,resource:env.PUBLIC_BASE_URL+'/api/mcp'};
    const refreshed=await call(handler,request('POST',rotation));
    expect(refreshed.statusCode).toBe(200);
    const second=json(refreshed);
    expect(second.access_token).toMatch(/^tac_/);
    expect(second.access_token).not.toBe(first.access_token);
    expect((await call(handler,request('POST',rotation))).statusCode).toBe(400);
    expect(await dbA.getAccessToken(first.access_token)).toBeNull();
    expect((await dbA.getAccessToken(second.access_token)).profile).toBe('full');
    expect((await call(handler,request('POST',{...rotation,client_id:clientB,
      client_secret:clientSecretB,refresh_token:second.refresh_token}))).statusCode).toBe(400);
    expect(await directory.revokePilotIdentity(a.id,ownerA,ownerA)).toBe(true);
    expect((await call(handler,request('POST',{...rotation,
      refresh_token:second.refresh_token}))).statusCode).toBe(401);
    expect(await dbA.getAccessToken(second.access_token)).not.toBeNull();
    expect(await resolvePrivateTenantMcpBearer({
      authorization:'Bearer '+second.access_token,env,
      rootSqlFactory:()=>sqlFor(admin),tenantSqlFactory:route})).toBeNull();
  });

  it('atomically redeems one code and refresh token across two independent PostgreSQL connections',async()=>{
    const env={PUBLIC_BASE_URL:'https://pilot.github.example.test',
      GITHUB_PRIVATE_TENANT_PILOT:'enabled',GITHUB_PILOT_APP_ID:'987001',
      GITHUB_TENANT_ROUTING_KEY:crypto.randomBytes(32).toString('base64url'),
      DATABASE_URL:process.env.TEST_DATABASE_URL};
    const dbA=createDb(tenantA);
    await dbA.upsertAccount({login:'overlap-org',accountId:987002,
      accountType:'Organization',label:'Concurrent private pilot',credentialKind:'app',appId:987001});
    await dbA.setInstallation('overlap-org',{installationId:987003,
      repositorySelection:'all',permissions:{contents:'read'},status:'active'});
    expect(await directory.allowlistPilotIdentity(a.id,ownerA,ownerA)).toBe(true);
    const claim={tenantId:a.id,identityId:ownerA};
    const clientId=await signed('tcl',claim,env);
    const clientSecret='fixture-concurrent-oauth-client-secret';
    const redirectUri='https://pilot-concurrent.example.test/cb';
    await dbA.createOAuthClient({clientId,clientSecret,redirectUris:[redirectUri],
      clientName:'concurrent private pilot'});
    const code='fixture-code-'+crypto.randomBytes(18).toString('hex');
    const verifier='q'.repeat(43);
    const challenge=createHash('sha256').update(verifier).digest('base64url');
    await dbA.createAuthCode({code,clientId,redirectUri,codeChallenge:challenge,
      codeChallengeMethod:'S256',defaultAccount:'overlap-org',
      accounts:['overlap-org'],mode:'preview',profile:'full',listing:'compact'});
    const connectionOne=await connect(tenantConnectionString(env.DATABASE_URL,a.id));
    const connectionTwo=await connect(tenantConnectionString(env.DATABASE_URL,a.id));
    const handler=conn=>(req,res)=>privateTenantToken(req,res,{env,
      rootSqlFactory:()=>sqlFor(admin),tenantSqlFactory:()=>sqlFor(conn)});
    const h1=handler(connectionOne),h2=handler(connectionTwo);
    const form={grant_type:'authorization_code',client_id:clientId,client_secret:clientSecret,
      code,redirect_uri:redirectUri,code_verifier:verifier,
      resource:env.PUBLIC_BASE_URL+'/api/mcp'};
    const first=await Promise.all([call(h1,request('POST',form)),call(h2,request('POST',form))]);
    expect(first.map(x=>x.statusCode).sort()).toEqual([200,400]);
    const granted=json(first.find(x=>x.statusCode===200));
    expect(granted.access_token).toMatch(/^tac_/);
    const renew={grant_type:'refresh_token',client_id:clientId,client_secret:clientSecret,
      refresh_token:granted.refresh_token,resource:env.PUBLIC_BASE_URL+'/api/mcp'};
    const second=await Promise.all([call(h2,request('POST',renew)),call(h1,request('POST',renew))]);
    expect(second.map(x=>x.statusCode).sort()).toEqual([200,400]);
    const refreshed=json(second.find(x=>x.statusCode===200));
    expect(refreshed.access_token).not.toBe(granted.access_token);
    expect(await dbA.getAccessToken(granted.access_token)).toBeNull();
    expect((await dbA.getAccessToken(refreshed.access_token)).profile).toBe('full');
    expect((await call(h1,request('POST',renew))).statusCode).toBe(400);
    const dbB=createDb(tenantB);
    expect(await dbB.getAccessToken(refreshed.access_token)).toBeNull();
  });

  it('registers a pilot client only after real GitHub numeric identity and App installation proof',async()=>{
    const env={PUBLIC_BASE_URL:'https://pilot.github.example.test',
      GITHUB_PRIVATE_TENANT_PILOT:'enabled',
      GITHUB_TENANT_ROUTING_KEY:crypto.randomBytes(32).toString('base64url'),
      GITHUB_PILOT_APP_ID:'83001',DATABASE_URL:process.env.TEST_DATABASE_URL};
    const dbA=createDb(tenantA);
    await dbA.upsertAccount({login:'client-register-fixture',accountId:84001,
      accountType:'Organization',label:'Trusted provider fixture',
      credentialKind:'app',appId:83001});
    await dbA.setInstallation('client-register-fixture',{
      installationId:85001,repositorySelection:'all',permissions:{contents:'write'},status:'active'});
    expect(await directory.allowlistPilotIdentity(a.id,ownerA,ownerA)).toBe(true);
    let providerId=20001, installation=85001;
    const fetchImpl=async(url)=>{
      if(url==='https://api.github.com/user')
        return {ok:true,status:200,json:async()=>({id:providerId,login:'registered-owner',type:'User'})};
      if(url==='https://api.github.com/user/installations?per_page=100')
        return {ok:true,status:200,json:async()=>({total_count:1,
          installations:[{id:installation,app_id:83001,account:{id:84001},suspended_at:null}]})};
      throw Error('unrecognized fixture route');
    };
    const args={oauthBearer:'fixture-github-oauth-bearer',trustedTenantId:a.id,
      accountLogin:'client-register-fixture',
      redirectUris:['https://private-tenant.example.test/oauth/callback'],
      clientName:'private-client',env,fetchImpl,
      rootSqlFactory:()=>sqlFor(admin),tenantSqlFactory:url=>
        url.includes(tenantSchemaName(a.id))?tenantA:tenantB};
    const info=await registerPrivatePilotClient(args);
    expect(info.client_id).toMatch(/^tcl_/);
    expect(info.client_secret).toHaveLength(43);
    expect((await dbA.getOAuthClient(info.client_id)).client_secret_hash).toBeDefined();
    expect((await dbA.getOAuthClient(info.client_id)).authorized_account).toBe('client-register-fixture');
    expect(JSON.stringify(await dbA.getOAuthClient(info.client_id))).not.toContain(info.client_secret);
    // Two approved installations may coexist. Standard MCP/mobile consent
    // must silently use THIS client registration's verified account, never
    // pick a different installation or display a tenant-wide account list.
    await dbA.upsertAccount({login:'different-fixture-org',accountId:84002,
      accountType:'Organization',label:'Other private App',credentialKind:'app',appId:83001});
    await dbA.setInstallation('different-fixture-org',{installationId:85002,
      repositorySelection:'all',permissions:{contents:'read'},status:'active'});
    const consent=createPrivateGitHubConsent({
      env:{...env,GITHUB_PILOT_APP_CLIENT_ID:'fixture-pilot-client-id',
        GITHUB_PILOT_APP_CLIENT_SECRET:'fixture-pilot-client-secret'},
      rootSqlFactory:()=>sqlFor(admin),tenantSqlFactory:args.tenantSqlFactory,
      fetchImpl
    });
    const baseConsent={client_id:info.client_id,response_type:'code',
      redirect_uri:args.redirectUris[0],state:'private-client-state',
      code_challenge:'v'.repeat(43),code_challenge_method:'S256',
      resource:env.PUBLIC_BASE_URL+'/api/mcp',mode:'preview',
      profile:'full',listing:'compact'};
    await expect(consent.start(baseConsent)).resolves.toMatchObject({
      url:expect.stringContaining('https://github.com/login/oauth/authorize?')});
    await expect(consent.start({...baseConsent,account:'different-fixture-org'}))
      .rejects.toThrow(/not verified/);
    // A pre-binding legacy client must refuse ambiguous installations even
    // when the caller supplies a legitimate second account. The account
    // selector is not provider-verified registration evidence.
    const unbound=await signed('tcl',{tenantId:a.id,identityId:ownerA},env);
    await dbA.createOAuthClient({clientId:unbound,
      clientSecret:'fixture-unbound-secret',
      redirectUris:args.redirectUris,clientName:'old-unbound-client'});
    await expect(consent.start({...baseConsent,client_id:unbound}))
      .rejects.toThrow(/not verified/);
    await expect(consent.start({...baseConsent,client_id:unbound,
      account:'different-fixture-org'})).rejects.toThrow(/not verified/);
    await expect(consent.start({...baseConsent,client_id:unbound,
      account:'client-register-fixture'})).rejects.toThrow(/not verified/);
    providerId=20002;
    await expect(registerPrivatePilotClient(args)).rejects.toThrow(/private tenant pilot/);
    providerId=20001;installation=85002;
    await expect(registerPrivatePilotClient(args)).rejects.toThrow(/has not been delegated/);
    installation=85001;
    await expect(registerPrivatePilotClient({...args,redirectUris:['http://evil.example.test/cb']})).rejects.toThrow(/registration/);
    await expect(registerPrivatePilotClient({...args,env:{...env,GITHUB_PRIVATE_TENANT_PILOT:'disabled'}})).rejects.toThrow(/disabled/);
  });

  it('keeps U grants separate for two humans sharing one organization, including revoke and disallowed K/P',async()=>{
    const env={TOKEN_ENCRYPTION_KEY:crypto.randomBytes(32).toString('base64url')};
    const account='same-tenant-user-test';
    const db=createDb(tenantA);
    await db.upsertAccount({login:account,accountId:99101,accountType:'Organization',
      label:'Shared App account',credentialKind:'app',appId:99102});
    await db.setInstallation(account,{installationId:99103,
      repositorySelection:'all',permissions:{contents:'read'},status:'active'});
    const first=await directory.allowlistPilotIdentity(a.id,ownerA,ownerA);
    expect(first).toBe(true);
    expect(await directory.grant(a.id,ownerA,ownerB,'member')).toBe(true);
    expect(await directory.allowlistPilotIdentity(a.id,ownerA,ownerB)).toBe(true);
    const base={token:async({cred})=>{
      if (cred==='I') return 'fixture-App-token-for-tenant-owner';
      throw Error('shared user token must not be consulted');
    }};
    for(const [identityId,userLogin,token] of [
      [ownerA,'alice','alice-personal-github-oauth-token'],
      [ownerB,'bob','bob-personal-github-oauth-token']]){
      await storePilotUserGrant({directory,tenantId:a.id,identityId,account,
        userLogin,accessToken:token,expiresIn:3600,env});
    }
    const forUser=identityId=>createTenantScopedCredentials({
      base,directory,tenant:{tenantId:a.id,identityId,
        role:identityId===ownerA?'owner':'member'},env});
    expect(await forUser(ownerA).token({account,cred:'U'}))
      .toBe('alice-personal-github-oauth-token');
    expect(await forUser(ownerB).token({account,cred:'U'}))
      .toBe('bob-personal-github-oauth-token');
    expect(await forUser(ownerA).token({account,cred:'I'}))
      .toBe('fixture-App-token-for-tenant-owner');
    // Default I-mode tools run as the invited user's own delegated GitHub
    // App USER token, never through the owner's installation-wide bearer.
    expect(await forUser(ownerB).token({account,cred:'I'}))
      .toBe('bob-personal-github-oauth-token');
    expect((await db.getAccount(account)).user_token_enc).toBeNull();
    expect(await directory.getPilotUserAuthorization(a.id,ownerA,account))
      .not.toEqual(await directory.getPilotUserAuthorization(a.id,ownerB,account));
    await expect(forUser(ownerA).token({account,cred:'K'}))
      .rejects.toThrow(/authorization/);
    await expect(forUser(ownerB).token({account,cred:'P'}))
      .rejects.toThrow(/authorization/);
    expect(await directory.revokePilotUserAuthorization(a.id,ownerB,account)).toBe(true);
    await expect(forUser(ownerB).token({account,cred:'U'})).rejects.toThrow();
    expect(await forUser(ownerA).token({account,cred:'U'}))
      .toBe('alice-personal-github-oauth-token');
    expect(await directory.revokePilotIdentity(a.id,ownerA,ownerA)).toBe(true);
    await expect(forUser(ownerA).token({account,cred:'U'})).rejects.toThrow();
    expect(await directory.allowlistPilotIdentity(a.id,ownerA,ownerA)).toBe(true);
  });

  it('rotates an expired member user grant once across concurrent requests without leaking a second member',async()=>{
    const env={TOKEN_ENCRYPTION_KEY:crypto.randomBytes(32).toString('base64url'),
      GITHUB_PILOT_APP_CLIENT_ID:'fixture-private-refresh-app',
      GITHUB_PILOT_APP_CLIENT_SECRET:'fixture-private-refresh-secret'};
    const account='individual-refresh-test';
    const db=createDb(tenantA);
    await db.upsertAccount({login:account,accountId:99201,
      accountType:'Organization',label:'Refresh fixture',credentialKind:'app',appId:99202});
    await db.setInstallation(account,{installationId:99203,
      repositorySelection:'all',permissions:{contents:'read'},status:'active'});
    await directory.allowlistPilotIdentity(a.id,ownerA,ownerA);
    await directory.grant(a.id,ownerA,ownerB,'member');
    await directory.allowlistPilotIdentity(a.id,ownerA,ownerB);
    await storePilotUserGrant({directory,tenantId:a.id,identityId:ownerA,
      account,userLogin:'user-one',accessToken:'owner-expiring-bearer',
      refreshToken:'one-use-owner-refresh',expiresIn:60,refreshExpiresIn:3600,env});
    await storePilotUserGrant({directory,tenantId:a.id,identityId:ownerB,
      account,userLogin:'user-two',accessToken:'other-member-valid-bearer',
      refreshToken:'other-member-untouched-refresh',expiresIn:3600,refreshExpiresIn:3600,env});
    let refreshed=0;
    const fetchImpl=async (url,opts)=>{
      if(url==='https://github.com/login/oauth/access_token'){
        refreshed++;
        expect(opts.body.get('grant_type')).toBe('refresh_token');
        expect(opts.body.get('refresh_token')).toBe('one-use-owner-refresh');
        return {ok:true,json:async()=>({
          access_token:'owner-renewed-bearer',
          refresh_token:'owner-new-refresh-value',
          expires_in:3600,refresh_token_expires_in:3600})};
      }
      if(url==='https://api.github.com/user')return {ok:true,status:200,
        json:async()=>({id:20001,login:'owner-one',type:'User'})};
      if(url==='https://api.github.com/user/installations?per_page=100')return{
        ok:true,status:200,json:async()=>({total_count:1,installations:[
          {id:99203,app_id:99202,account:{id:99201},suspended_at:null}]})};
      throw Error('Unknown fixture provider endpoint');
    };
    const owner=createTenantScopedCredentials({
      base:{token:async()=>{throw Error('global token not allowed');}},
      db,directory,tenant:await directory.authorizedPilotIdentity(a.id,ownerA),
      env,fetchImpl
    });
    const other=createTenantScopedCredentials({
      base:{token:async()=>{throw Error('global token not allowed');}},
      db,directory,tenant:{tenantId:a.id,identityId:ownerB,role:'member'},
      env,fetchImpl
    });
    const pair=await Promise.allSettled([
      owner.token({account,cred:'U'}),owner.token({account,cred:'U'})]);
    expect(refreshed).toBe(1);
    const successes=pair.filter(x=>x.status==='fulfilled');
    expect(successes.length).toBeGreaterThanOrEqual(1);
    expect(successes.every(x=>x.value==='owner-renewed-bearer')).toBe(true);
    expect(await owner.token({account,cred:'U'})).toBe('owner-renewed-bearer');
    expect(await other.token({account,cred:'U'})).toBe('other-member-valid-bearer');
    const stored=await directory.getPilotUserAuthorization(a.id,ownerA,account);
    expect(stored.access_enc).toMatch(/^v1\./);
    expect(JSON.stringify(stored)).not.toContain('owner-new-refresh-value');
    expect(await directory.revokePilotUserAuthorization(a.id,ownerA,account)).toBe(true);
    await expect(owner.token({account,cred:'U'})).rejects.toThrow();
    expect(await other.token({account,cred:'U'})).toBe('other-member-valid-bearer');
  });

  it('never lets a late invalid_grant erase a newer GitHub user sign-in',async()=>{
    const env={TOKEN_ENCRYPTION_KEY:crypto.randomBytes(32).toString('base64url'),
      GITHUB_PILOT_APP_CLIENT_ID:'fixture-reauth-app',
      GITHUB_PILOT_APP_CLIENT_SECRET:'fixture-reauth-secret'};
    const account='reauth-race-fixture';
    await directory.allowlistPilotIdentity(a.id,ownerA,ownerA);
    await storePilotUserGrant({directory,tenantId:a.id,identityId:ownerA,account,
      userLogin:'owner-user',accessToken:'old-expiring-user-bearer',
      refreshToken:'old-one-use-refresh',expiresIn:60,refreshExpiresIn:3600,env});
    let started,release;
    const began=new Promise(resolve=>{started=resolve;});
    const pause=new Promise(resolve=>{release=resolve;});
    const credentials=createTenantScopedCredentials({
      base:{token:async()=>{throw Error('shared U must not be used');}},
      db:createDb(tenantA),directory,tenant:{tenantId:a.id,identityId:ownerA,role:'owner'},
      env,fetchImpl:async url=>{
        expect(url).toBe('https://github.com/login/oauth/access_token');
        started();
        await pause;
        return {ok:false,json:async()=>({error:'invalid_grant'})};
      }});
    const oldRenewal=credentials.token({account,cred:'U'});
    await began;
    const oldRecord=await directory.getPilotUserAuthorization(a.id,ownerA,account);
    expect(oldRecord.refresh_claim_id).not.toBeNull();
    expect(new Date(oldRecord.refresh_claim_expires_at).getTime()-Date.now())
      .toBeGreaterThan(50_000);
    // A new provider login replaces this principal's access and refresh tokens
    // while the older, failed provider refresh is still in flight.
    await storePilotUserGrant({directory,tenantId:a.id,identityId:ownerA,account,
      userLogin:'owner-user',accessToken:'fresh-after-new-consent',
      refreshToken:'new-consent-refresh',expiresIn:3600,refreshExpiresIn:3600,env});
    release();
    await expect(oldRenewal).rejects.toThrow(/authorization/);
    expect(await credentials.token({account,cred:'U'}))
      .toBe('fresh-after-new-consent');
    expect(Number((await directory.getPilotUserAuthorization(a.id,ownerA,account)).revision))
      .toBeGreaterThan(Number(oldRecord.revision));
  });

  it('preflights the genuine tenant OAuth client and exact App before displaying a mobile/desktop consent page',async()=>{
    const env={PUBLIC_BASE_URL:'https://pilot.github.example.test',VERCEL_ENV:'production',
      GITHUB_PRIVATE_TENANT_PILOT:'enabled',
      GITHUB_TENANT_ROUTING_KEY:crypto.randomBytes(32).toString('base64url'),
      GITHUB_PILOT_APP_CLIENT_ID:'fixture-inspect-client',
      GITHUB_PILOT_APP_CLIENT_SECRET:'fixture-not-a-real-secret',
      GITHUB_PILOT_APP_ID:'92001',DATABASE_URL:process.env.TEST_DATABASE_URL};
    const db=createDb(tenantA);
    const account='inspect-ready';
    await db.upsertAccount({login:account,accountId:92002,accountType:'Organization',
      label:'Private consent inspection',credentialKind:'app',appId:92001,isScratch:true});
    await db.setInstallation(account,{installationId:92003,
      repositorySelection:'all',permissions:{contents:'read'},status:'active'});
    await directory.allowlistPilotIdentity(a.id,ownerA,ownerA);
    const client=await signed('tcl',{tenantId:a.id,identityId:ownerA},env);
    const redirect='https://private-inspect.example.test/callback';
    await db.createOAuthClient({clientId:client,clientSecret:'fixture-inspect-secret',
      redirectUris:[redirect],clientName:'Android or desktop',authorizedAccount:account});
    const consent=createPrivateGitHubConsent({env,
      rootSqlFactory:()=>sqlFor(admin),tenantSqlFactory:()=>tenantA});
    const fields={client_id:client,redirect_uri:redirect,response_type:'code',
      code_challenge:'x'.repeat(43),code_challenge_method:'S256',
      resource:env.PUBLIC_BASE_URL+'/api/mcp'};
    expect(await consent.inspect(fields)).toEqual({productionAllowed:true});
    await db.setProductionEnabled(account,true);
    expect(await consent.inspect(fields)).toEqual({productionAllowed:true});
    await expect(consent.inspect({...fields,redirect_uri:'https://wrong.example.test/cb'}))
      .rejects.toThrow(/not verified/);
    await db.setInstallationStatus(account,'suspended');
    await expect(consent.inspect(fields)).rejects.toThrow(/not verified/);
    await db.setInstallationStatus(account,'active');
    expect(await consent.inspect(fields)).toEqual({productionAllowed:true});
    await directory.revokePilotIdentity(a.id,ownerA,ownerA);
    await expect(consent.inspect(fields)).rejects.toThrow(/not verified/);
    await directory.allowlistPilotIdentity(a.id,ownerA,ownerA);
  });

  it('proves real tenant GitHub consent state, browser CSRF, installation scope, PKCE and token issuance',async()=>{
    const env={PUBLIC_BASE_URL:'https://pilot.github.example.test',VERCEL_ENV:'production',
      GITHUB_PRIVATE_TENANT_PILOT:'enabled',
      GITHUB_TENANT_ROUTING_KEY:crypto.randomBytes(32).toString('base64url'),
      GITHUB_PILOT_APP_CLIENT_ID:'gh-pilot-test-client',
      GITHUB_PILOT_APP_CLIENT_SECRET:'fixture-only-not-real',
      TOKEN_ENCRYPTION_KEY:crypto.randomBytes(32).toString('base64url'),
      GITHUB_PILOT_APP_ID:'80001',
      DATABASE_URL:process.env.TEST_DATABASE_URL};
    const dbA=createDb(tenantA), dbB=createDb(tenantB);
    expect(await directory.allowlistPilotIdentity(a.id,ownerA,ownerA)).toBe(true);
    expect(await directory.allowlistPilotIdentity(b.id,ownerB,ownerB)).toBe(true);
    const clientA=await signed('tcl',{tenantId:a.id,identityId:ownerA},env);
    const secretA='fixture-owner-a-private-client-secret';
    const account='fixture-app-owner';
    await dbA.upsertAccount({login:account,accountId:81001,accountType:'Organization',
      label:'Private pilot org',credentialKind:'app',appId:80001});
    await dbA.setInstallation(account,{installationId:82001,
      repositorySelection:'all',permissions:{contents:'write'},status:'active'});
    await dbA.createOAuthClient({clientId:clientA,clientSecret:secretA,
      redirectUris:['https://private-pilot.example.test/cb'],clientName:'private-pilot-A'});
    const clientB=await signed('tcl',{tenantId:b.id,identityId:ownerB},env);
    await dbB.createOAuthClient({clientId:clientB,clientSecret:'other-fixture-secret',
      redirectUris:['https://private-pilot.example.test/cb'],clientName:'private-pilot-B'});
    let installationVisible=true,verifiedId=20001,exchangeCalls=0;
    const fetchImpl=async (url)=>{
      if(url==='https://github.com/login/oauth/access_token'){
        exchangeCalls++;
        return {ok:true,json:async()=>({access_token:'fixture-ephemeral-github-user-token',
          refresh_token:'fixture-ephemeral-user-refresh',expires_in:28800,
          refresh_token_expires_in:15000000})};
      }
      if(url==='https://api.github.com/user')
        return {ok:true,status:200,json:async()=>({id:verifiedId,login:'private-pilot-owner',type:'User'})};
      if(url==='https://api.github.com/user/installations?per_page=100')
        return {ok:true,status:200,json:async()=>({total_count:1,installations:installationVisible?
          [{id:82001,app_id:80001,account:{id:81001},suspended_at:null}]:
          [{id:82002,app_id:80001,account:{id:81001},suspended_at:null}]})};
      throw Error('Unknown fixture provider URL');
    };
    const route=url=>url.includes(tenantSchemaName(a.id))?tenantA:tenantB;
    const consent=createPrivateGitHubConsent({env,fetchImpl,
      rootSqlFactory:()=>sqlFor(admin),tenantSqlFactory:route});
    const verifier='v'.repeat(43);
    const challenge=createHash('sha256').update(verifier).digest('base64url');
    const form={client_id:clientA,response_type:'code',
      redirect_uri:'https://private-pilot.example.test/cb',
      code_challenge:challenge,code_challenge_method:'S256',state:'caller-nonce',
      resource:env.PUBLIC_BASE_URL+'/api/mcp',account,mode:'preview',
      profile:'full',listing:'compact'};
    const first=await consent.start(form);
    expect(first.url).toContain('https://github.com/login/oauth/authorize?');
    expect(first.url).toContain('code_challenge_method=S256');
    await expect(consent.finish({state:first.csrfState,code:'fake-github-code',
      browserCsrf:'invalid-cookie'})).rejects.toThrow(/not verified/);
    expect(exchangeCalls).toBe(0);
    const target=await consent.finish({state:first.csrfState,code:'fake-github-code',
      browserCsrf:first.csrfState});
    const redirected=new URL(target);
    expect(redirected.origin).toBe('https://private-pilot.example.test');
    expect(redirected.searchParams.get('state')).toBe('caller-nonce');
    expect(redirected.searchParams.get('iss')).toBe(env.PUBLIC_BASE_URL);
    const mcpCode=redirected.searchParams.get('code');
    expect(mcpCode.length).toBeGreaterThan(30);
    expect(exchangeCalls).toBe(1);
    const authorizedAccount=await dbA.getAccount(account);
    expect(authorizedAccount.user_token_enc).toBeNull();
    expect(authorizedAccount.user_refresh_enc).toBeNull();
    const individual=await directory.getPilotUserAuthorization(a.id,ownerA,account);
    expect(individual.user_login).toBe('private-pilot-owner');
    expect(individual.access_enc).toMatch(/^v1\./);
    expect(individual.refresh_enc).toMatch(/^v1\./);
    expect(individual.authority_binding).toMatchObject({kind:'app_user',host:'github.com',
      githubUserId:20001,tenantId:a.id,identityId:ownerA,
      accountId:81001,installationId:82001,appId:80001,
      operations:['GET /user'],resources:['user/20001'],permissions:[]});
    expect(JSON.stringify(individual)).not.toContain('fixture-ephemeral-github-user-token');
    expect((await dbB.getAccount(account))).toBeNull();
    await expect(consent.finish({state:first.csrfState,code:'fake-github-code',
      browserCsrf:first.csrfState})).rejects.toThrow(/not verified/);
    const handler=(req,res)=>privateTenantToken(req,res,{
      env,rootSqlFactory:()=>sqlFor(admin),tenantSqlFactory:route});
    const exchanged=await call(handler,request('POST',{
      grant_type:'authorization_code',client_id:clientA,client_secret:secretA,
      redirect_uri:form.redirect_uri,code:mcpCode,code_verifier:verifier,
      resource:form.resource}));
    expect(exchanged.statusCode).toBe(200);
    const token=json(exchanged);
    expect(token.access_token).toMatch(/^tac_/);
    const scopedRoute=await resolvePrivateTenantMcpBearer({
      authorization:'Bearer '+token.access_token,env,fetchImpl,
      rootSqlFactory:()=>sqlFor(admin),tenantSqlFactory:route});
    expect(await scopedRoute.credentials.token({account,cred:'U'}))
      .toBe('fixture-ephemeral-github-user-token');
    expect((await dbA.getAccessToken(token.access_token)).accounts).toEqual([account]);
    expect(await dbB.getAccessToken(token.access_token)).toBeNull();
    // A provider-reported wrong installation can never complete the handoff.
    const second=await consent.start(form);
    installationVisible=false;
    await expect(consent.finish({state:second.csrfState,code:'another-code',
      browserCsrf:second.csrfState})).rejects.toThrow(/not verified/);
    installationVisible=true;
    // A different provider identity must not inherit this signed client.
    const third=await consent.start(form);
    verifiedId=20002;
    await expect(consent.finish({state:third.csrfState,code:'third-code',
      browserCsrf:third.csrfState})).rejects.toThrow(/not verified/);
    verifiedId=20001;
    const fourth=await consent.start(form);
    expect(await directory.revokePilotIdentity(a.id,ownerA,ownerA)).toBe(true);
    await expect(consent.finish({state:fourth.csrfState,code:'fourth-code',
      browserCsrf:fourth.csrfState})).rejects.toThrow(/not verified/);
    await directory.allowlistPilotIdentity(a.id,ownerA,ownerA);
    await expect(consent.finish({state:fourth.csrfState,code:'fourth-code',
      browserCsrf:fourth.csrfState})).rejects.toThrow(/not verified/);
  });

  it('cannot reactivate a revoked tenant member through the allowlist alone', async () => {
    expect(await directory.allowlistPilotIdentity(a.id, ownerA, ownerB)).toBe(true);
    const active = await directory.resolveAllowlistedPilotSubject(a.id, '20002');
    expect(active.pilotRevision).toBeGreaterThan(1);
    expect(await directory.revoke(a.id, ownerA, ownerB)).toBe(true);
    expect(await directory.resolveAllowlistedPilotSubject(a.id, '20002')).toBeNull();
    expect(await directory.allowlistPilotIdentity(a.id, ownerA, ownerB)).toBe(false);
    expect(await directory.grant(a.id, ownerA, ownerB, 'member')).toBe(true);
    const refreshed = await directory.resolveAllowlistedPilotSubject(a.id, '20002');
    expect(refreshed.membershipRevision).toBeGreaterThan(active.membershipRevision);
    expect(await directory.enrollVerifiedGithubSubject('20002')).toBe(ownerB);
    expect(await directory.resolveAllowlistedPilotSubject(b.id, '20001')).toBeNull();
  });
  it('allows only protected owner invitation with verified GitHub user and no copied credential',async()=>{
    const env={VERCEL_ENV:'production',GITHUB_PRIVATE_TENANT_PILOT:'enabled',
      GITHUB_TENANT_ROUTING_KEY:crypto.randomBytes(32).toString('base64url'),
      GITHUB_PILOT_APP_ID:'91001',DATABASE_URL:process.env.TEST_DATABASE_URL};
    const db=createDb(tenantA);
    await db.upsertAccount({login:'pilot-invite-fixture',accountId:91002,
      accountType:'Organization',label:'Private invitation fixture',
      credentialKind:'app',appId:91001});
    await db.setInstallation('pilot-invite-fixture',{
      installationId:91003,repositorySelection:'all',
      permissions:{contents:'read'},status:'active'});
    let targetId=20002;
    const fetchImpl=async url=>{
      if(url==='https://api.github.com/user')
        return {ok:true,status:200,json:async()=>({id:20001,login:'owner-fixture',type:'User'})};
      if(url==='https://api.github.com/users/member-fixture')
        return {ok:true,status:200,json:async()=>({id:targetId,login:'member-fixture',type:'User'})};
      throw Error('Unexpected GitHub API in private test');
    };
    const args={accountLogin:'pilot-invite-fixture',targetLogin:'member-fixture',
      redirectUri:'https://private-agent.example.test/oauth/callback',
      rootDb:{},ownerCredentials:{token:async()=> 'fixture-owner-github-user-access'},
      env,fetchImpl,bootstrap:async()=>({account:'pilot-invite-fixture',tenantId:a.id}),
      rootSqlFactory:()=>sqlFor(admin),tenantSqlFactory:()=>tenantA};
    const invited=await invitePrivatePilotMember(args);
    expect(invited.githubLogin).toBe('member-fixture');
    expect(invited.tenantId).toBe(a.id);
    expect(invited.client_id).toMatch(/^tcl_/);
    expect(invited.client_secret).toHaveLength(43);
    expect(JSON.stringify(await db.getOAuthClient(invited.client_id)))
      .not.toContain(invited.client_secret);
    expect(await directory.resolveAllowlistedPilotSubject(a.id,'20002'))
      .toMatchObject({identityId:ownerB,role:'member'});
    expect((await db.getAccount('pilot-invite-fixture')).user_login).toBeNull();
    targetId=20001;
    await expect(invitePrivatePilotMember(args)).rejects.toThrow(/could not be verified/);
    targetId=20002;
    await expect(invitePrivatePilotMember({...args,
      env:{...env,GITHUB_PRIVATE_TENANT_PILOT:'disabled'}})).rejects.toThrow(/could not be verified/);
  });


});
