// Each pilot member's GitHub user authorization is a distinct encrypted
// record, not a shared gh_accounts U token. Never allow a member to obtain
// another member's user bearer through the organization account name.
import { encryptSecret, decryptSecret, readEncryptionKey } from '../core/crypto.js';
import { GithubClientError } from '../github/errors.js';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { publicOrigin } from '../core/http.js';
import { verifyGithubBearerIdentity, verifyGithubUserInstallation } from './github-identity.js';
import {pilotOptionalAad,currentPilotOptionalReadback} from './optional-credentials.js';
import {masterAad,currentMasterReadback,MASTER_HANDLE} from './master-credential.js';
import { userGrantBinding, currentUserGrantBinding } from './credential-binding.js';
import { resolveDocumentedCredential } from '../github/credential-authority.js';
import {pilotAppClient} from './pilot-app-client.js';

const aad=(tenantId,identityId,account,kind)=>
  `github-mcp/private-tenant/${tenantId}/identity/${identityId}/account/${account.toLowerCase()}/${kind}`;
const denied=()=>new GithubClientError('no_credentials',
  'Your own GitHub user authorization is unavailable or expired. Sign in through GitHub again.');

export async function storePilotUserGrant({ directory, tenantId, identityId,
  account, userLogin, accessToken, refreshToken = null, expiresIn,
  refreshExpiresIn = null, verifiedContext = null, env = process.env, now = Date.now }) {
  if (typeof accessToken!=='string' || accessToken.length<8 || accessToken.length>4096 ||
      !Number.isSafeInteger(expiresIn) || expiresIn<60 || expiresIn>31536000 ||
      (refreshToken!==null && (typeof refreshToken!=='string' ||
        refreshToken.length<8 || refreshToken.length>4096)) ||
      (refreshExpiresIn!==null && (!Number.isSafeInteger(refreshExpiresIn) ||
        refreshExpiresIn<60 || refreshExpiresIn>31536000)))
    throw new TypeError('Invalid user authorization details.');
  const key=readEncryptionKey(env);
  const at=now();
  const accessEnc=encryptSecret(accessToken,{
    aad:aad(tenantId,identityId,account,'access'),key});
  const refreshEnc=refreshToken===null?null:encryptSecret(refreshToken,{
    aad:aad(tenantId,identityId,account,'refresh'),key});
  const accessExpiresAt=new Date(at+expiresIn*1000);
  if (verifiedContext && (verifiedContext.tenant?.tenantId!==tenantId ||
      verifiedContext.tenant?.identityId!==identityId ||
      verifiedContext.account?.login?.toLowerCase()!==account.toLowerCase())) throw denied();
  const authorityBinding=verifiedContext?userGrantBinding({...verifiedContext,
    accessEnc,expiresAt:accessExpiresAt}):null;
  const stored=await directory.storePilotUserAuthorization({
    tenantId,identityId,accountLogin:account.toLowerCase(),userLogin,
    accessEnc,accessExpiresAt,authorityBinding,
    refreshEnc,refreshExpiresAt:refreshToken===null?null:
      new Date(at+(refreshExpiresIn??15811200)*1000)
  });
  if (!stored) throw denied();
  return true;
}

/** Refresh belongs to one user/tenant/account, not an installation-wide
 * gh_accounts row. PostgreSQL permits at most one process to spend the stored
 * refresh token. GitHub validates the *new* bearer and App installation before
 * the replacement is committed. No secret is ever included in an error. */
async function renewPilotUser({ directory, tenant, db, account, row, env, now, fetchImpl }) {
  if (!row.refresh_enc || !row.refresh_expires_at ||
      new Date(row.refresh_expires_at).getTime()<=now() ||
      typeof directory.claimPilotUserRefresh!=='function' || !db)
    throw denied();
  const scope={tenantId:tenant.tenantId,identityId:tenant.identityId,
    accountLogin:account.toLowerCase()};
  const claimId=randomUUID();
  const got=await directory.claimPilotUserRefresh({
    ...scope,expectedAccessEnc:row.access_enc,claimId
  });
  if (!got) throw new GithubClientError('rate_limited',
    'Your personal GitHub authorization is being renewed. Retry shortly.');
  let invalidGrant=false;
  try {
    const key=readEncryptionKey(env);
    const refreshToken=decryptSecret(got.refresh_enc,{
      aad:aad(tenant.tenantId,tenant.identityId,account,'refresh'),key
    });
    const appClient=await pilotAppClient({env,db});
    const result=await fetchImpl('https://github.com/login/oauth/access_token',{
      method:'POST',signal:AbortSignal.timeout(15000),
      headers:{accept:'application/json','content-type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({client_id:appClient.clientId,
        client_secret:appClient.clientSecret,
        grant_type:'refresh_token',refresh_token:refreshToken})
    });
    const data=await result.json();
    if (!result.ok || data?.error) {
      invalidGrant=['invalid_grant','bad_refresh_token'].includes(data?.error);
      throw denied();
    }
    const access=data?.access_token,refresh=data?.refresh_token;
    const expiresIn=Number(data?.expires_in);
    const refreshIn=Number(data?.refresh_token_expires_in);
    if (typeof access!=='string' || access.length<8 || access.length>4096 ||
        typeof refresh!=='string' || refresh.length<8 || refresh.length>4096 ||
        !Number.isSafeInteger(expiresIn) || expiresIn<60 || expiresIn>31536000 ||
        !Number.isSafeInteger(refreshIn) || refreshIn<60 || refreshIn>31536000)
      throw denied();
    const actual=await verifyGithubBearerIdentity(access,{fetchImpl});
    const expected=await directory.getPilotVerifiedSubject(scope.tenantId,scope.identityId);
    const app=await db.getAccount(account);
    if (!expected || actual.subject!==expected || !app ||
        app.credential_kind!=='app' || app.installation_status!=='active' ||
        !await verifyGithubUserInstallation(access,{
          installationId:app.installation_id,appId:app.app_id,
          accountId:app.account_id,fetchImpl
        })) throw denied();
    const accessEnc=encryptSecret(access,{
      aad:aad(scope.tenantId,scope.identityId,account,'access'),key});
    const accessExpiresAt=new Date(now()+expiresIn*1000);
    const authorityBinding=userGrantBinding({subject:actual.subject,tenant,
      account:app,accessEnc,expiresAt:accessExpiresAt});
    const newer=await directory.finishPilotUserRefresh({
      ...scope,expectedAccessEnc:row.access_enc,claimId,
      accessEnc,accessExpiresAt,authorityBinding,
      refreshEnc:encryptSecret(refresh,{
        aad:aad(scope.tenantId,scope.identityId,account,'refresh'),key}),
      refreshExpiresAt:new Date(now()+refreshIn*1000)
    });
    if (!newer) throw denied();
    return access;
  } catch {
    if (invalidGrant && typeof directory.invalidatePilotUserRefresh==='function')
      await directory.invalidatePilotUserRefresh({
        ...scope,expectedAccessEnc:row.access_enc,claimId
      }).catch(()=>{});
    throw denied();
  } finally {
    await directory.releasePilotUserRefresh({...scope,claimId}).catch(()=>{});
  }
}

/** Returns the ordinary scoped installation credential API unchanged for
 * 'I', but forbids P/K sharing and uses identity-bound U data exclusively.
 * Every user token read enforces fresh membership/allowlist via directory. */
export function createTenantScopedCredentials({ base, directory, tenant, db,
  env = process.env, now = Date.now, fetchImpl = fetch }) {
  if (!base || typeof base.token!=='function' ||
      !directory || typeof directory.getPilotUserAuthorization!=='function' ||
      !tenant?.tenantId || !tenant?.identityId)
    throw new TypeError('Private tenant credential scope required.');
  const key=()=>readEncryptionKey(env);
  // An optional grant is usable only for the previously observed exact harmless
  // read, not as a generic PAT or an App permission upgrade. Verify active
  // private member + immutable account/principal binding on every acquisition
  // AND at each HTTP request. No owner K/P credential can be borrowed.
  const optionalDenied=()=>new GithubClientError('no_credentials',
    'Your optional GitHub authorization is unavailable or expired. Verify it on the protected setup page.');
  async function currentOptional(accountLogin,kind){
    // A legacy in-memory directory without the optional lookup must deny
    // before any decryption or provider traffic, not throw a raw TypeError.
    if(typeof directory.getPilotOptionalCredential!=='function')
      throw optionalDenied();
    if(typeof accountLogin!=='string' ||
        !/^[a-z0-9][a-z0-9-]{0,38}$/.test(accountLogin.toLowerCase())||
        !['K','P'].includes(kind))throw optionalDenied();
    const active=await directory.authorizedPilotIdentity(tenant.tenantId,tenant.identityId);
    if(!active||active.tenantId!==tenant.tenantId||
      active.identityId!==tenant.identityId||
      active.membershipRevision!==tenant.membershipRevision||
      active.pilotRevision!==tenant.pilotRevision)throw optionalDenied();
    const account=await db.getAccount(accountLogin);
    const subject=await directory.getPilotVerifiedSubject(tenant.tenantId,tenant.identityId);
    if(typeof subject!=='string'||!/^[1-9][0-9]{0,18}$/.test(subject)||
      !Number.isSafeInteger(Number(subject))||
      account?.login?.toLowerCase()!==accountLogin.toLowerCase())throw optionalDenied();
    const row=await directory.getPilotOptionalCredential({
      tenantId:tenant.tenantId,identityId:tenant.identityId,
      accountLogin:accountLogin.toLowerCase(),kind});
    const operation=kind==='K'?'GET /notifications':'GET /orgs/{org}/packages';
    const resource=kind==='K'?'user/'+subject:'org/'+account.account_id;
    if(!currentPilotOptionalReadback({row,tenant:active,account,subject,
      kind,operation,resource,now:now()}))throw optionalDenied();
    return {row,account};
  }
  // GOD-1: the person's master token (M). Same checks as any optional grant: current member, same GitHub person,
  // intact ciphertext, not expired. `needAny` lists scopes of which at least one must have been granted.
  async function currentMaster(needAny=null){
    if(typeof directory.getPilotOptionalCredential!=='function')throw optionalDenied();
    const active=await directory.authorizedPilotIdentity(tenant.tenantId,tenant.identityId);
    if(!active||active.tenantId!==tenant.tenantId||active.identityId!==tenant.identityId||
      active.membershipRevision!==tenant.membershipRevision||
      active.pilotRevision!==tenant.pilotRevision)throw optionalDenied();
    const subject=await directory.getPilotVerifiedSubject(tenant.tenantId,tenant.identityId);
    if(typeof subject!=='string'||!/^[1-9][0-9]{0,18}$/.test(subject))throw optionalDenied();
    const row=await directory.getPilotOptionalCredential({tenantId:tenant.tenantId,
      identityId:tenant.identityId,accountLogin:MASTER_HANDLE,kind:'M'});
    const seen=currentMasterReadback({row,subject,now:now()});
    if(!seen)throw optionalDenied();
    if(needAny&&!needAny.some(s=>seen.scopes.includes(s)))throw optionalDenied();
    return {row,scopes:seen.scopes,expiresAt:seen.expiresAt};
  }
  const FALLBACK_SCOPES={K:['notifications'],P:['read:packages','repo']};
  const apiOnly=url=>{
    let parsed;
    try{parsed=new URL(url,'https://api.github.com');}catch{return false;}
    return parsed.origin==='https://api.github.com'&&!parsed.username&&!parsed.password&&!parsed.hash;
  };
  function exactOptionalRequest({kind,account,method,url}){
    if(method!=='GET' || typeof url!=='string')return false;
    let parsed;
    try{parsed=new URL(url,'https://api.github.com');}catch{return false;}
    if(parsed.origin!=='https://api.github.com'||parsed.username||parsed.password||
       parsed.hash)return false;
    if(kind==='K')return parsed.pathname==='/user'||parsed.pathname==='/notifications';
    if(kind==='P'){
      const prefix='/orgs/';
      if(!parsed.pathname.startsWith(prefix)||!parsed.pathname.endsWith('/packages'))
        return false;
      const encoded=parsed.pathname.slice(prefix.length,-'/packages'.length);
      let owner;
      try{owner=decodeURIComponent(encoded);}catch{return false;}
      return owner.toLowerCase()===account.toLowerCase()&&
        /^[a-z0-9][a-z0-9-]{0,38}$/i.test(owner);
    }
    return false;
  }
  return {
    ...base,
    // Diagnostic only: never decrypt a bearer or initiate provider operations.
    // Only this explicitly reviewed identity read is proven by native consent.
    async operationAuthority({account,operation,resource,host='github.com'}) {
      const actualAccount=await db.getAccount(account);
      const subject=await directory.getPilotVerifiedSubject(tenant.tenantId,tenant.identityId);
      const active=await directory.authorizedPilotIdentity(tenant.tenantId,tenant.identityId);
      const row=await directory.getPilotUserAuthorization(tenant.tenantId,
        tenant.identityId,account.toLowerCase());
      const isCurrent=active &&
        active.membershipRevision===tenant.membershipRevision &&
        active.pilotRevision===tenant.pilotRevision;
      const binding=isCurrent
        ?currentUserGrantBinding({row,tenant:active,subject,account:actualAccount,now:now()}):null;
      // Classic K/P are private-member optional grants, never the shared owner
      // K/P vault or a fallback for an unrelated tool. Read historical proof
      // only: the MCP diagnostic cannot decrypt the bearer or dispatch it.
      const optionalKind=operation==='GET /notifications'?'K':
        operation==='GET /orgs/{org}/packages'?'P':null;
      const selectedResource=resource??(
        operation==='GET /user'||operation==='GET /notifications'
          ?'user/'+subject
          :operation==='GET /orgs/{org}/packages'&&Number.isSafeInteger(actualAccount?.account_id)
            ?'org/'+actualAccount.account_id:null);
      let optional=null;
      if(isCurrent&&optionalKind&&host==='github.com'&&
          typeof directory.getPilotOptionalCredential==='function'){
        const entry=await directory.getPilotOptionalCredential({
          tenantId:tenant.tenantId,identityId:tenant.identityId,
          accountLogin:account.toLowerCase(),kind:optionalKind
        });
        optional=currentPilotOptionalReadback({row:entry,tenant,account:actualAccount,
          subject,kind:optionalKind,operation,resource:selectedResource,now:now()});
      }
      return resolveDocumentedCredential({operation,host,
        resource:selectedResource,
        account:{accountId:actualAccount?.account_id,login:actualAccount?.login},
        principal:{...tenant,host:'github.com',githubUserId:Number(subject)},
        requestedKind:optionalKind?'classic_pat':'app_user',
        grants:optional?[optional]:binding?.operations.includes(operation)?[binding]:[],
        now:now()});
    },
    async authorizeOptionalRequest({account,kind,method,url}={}){
      // M may use any GitHub API address; the tool lifecycle (classification, confirmation, spend and production
      // gates) decides whether the operation itself is allowed. It can never go to another host.
      if(kind==='M'){ await currentMaster(); return apiOnly(url)?true:(()=>{throw optionalDenied();})(); }
      let entry;
      try{ entry=await currentOptional(account,kind); }
      catch(error){
        // No K/P of its own: the master token may stand in for the same exact read, if it carries the scope.
        await currentMaster(FALLBACK_SCOPES[kind]).catch(()=>{throw error;});
        const own=await db.getAccount(account);
        if(!exactOptionalRequest({kind,account:own?.login??account,method,url}))throw optionalDenied();
        return true;
      }
      if(!exactOptionalRequest({kind,account:entry.account.login,method,url}))
        throw optionalDenied();
      return true;
    },
    /** A private, one-use, ten-minute link to the master-token page for THIS signed-in person, so the token can be added
     * at any time without disconnecting or reconnecting. The link carries no secret of the person's. */
    async masterLink({clientId,redirectUri}={}){
      if(typeof clientId!=='string'||!clientId.startsWith('pcl_')||typeof redirectUri!=='string')throw optionalDenied();
      if(typeof directory.createPublicFlow!=='function')throw optionalDenied();
      const active=await directory.authorizedPilotIdentity(tenant.tenantId,tenant.identityId);
      if(!active||active.membershipRevision!==tenant.membershipRevision||
        active.pilotRevision!==tenant.pilotRevision)throw optionalDenied();
      const handle=randomBytes(32).toString('base64url');
      const ok=await directory.createPublicFlow({stateHash:createHash('sha256').update(handle).digest('hex'),
        stage:'god',clientId,redirectUri,codeChallenge:randomBytes(32).toString('base64url'),tier:'standard',
        purpose:'master',tenantId:tenant.tenantId,identityId:tenant.identityId,ttlSeconds:600,maxOpen:200});
      if(!ok)throw optionalDenied();
      const origin=publicOrigin(env);
      return {url:origin+'/api/tenant/optional?master_link='+handle,expiresInMinutes:10};
    },
    /** A private, one-use, ten-minute link to the "revoke a leaked token" page for THIS signed-in person. The tokens are
     * pasted on that page, never into a chat; the link itself carries no secret. */
    async revokeLink({clientId,redirectUri}={}){
      if(typeof clientId!=='string'||!clientId.startsWith('pcl_')||typeof redirectUri!=='string')throw optionalDenied();
      if(typeof directory.createPublicFlow!=='function')throw optionalDenied();
      const active=await directory.authorizedPilotIdentity(tenant.tenantId,tenant.identityId);
      if(!active||active.membershipRevision!==tenant.membershipRevision||
        active.pilotRevision!==tenant.pilotRevision)throw optionalDenied();
      const handle=randomBytes(32).toString('base64url');
      const ok=await directory.createPublicFlow({stateHash:createHash('sha256').update(handle).digest('hex'),
        stage:'god',clientId,redirectUri,codeChallenge:randomBytes(32).toString('base64url'),tier:'standard',
        purpose:'revoke',tenantId:tenant.tenantId,identityId:tenant.identityId,ttlSeconds:600,maxOpen:200});
      if(!ok)throw optionalDenied();
      return {url:publicOrigin(env)+'/api/tenant/optional?revoke_link='+handle,expiresInMinutes:10};
    },
    /** Nonsecret summary for github_whoami. Never the token. */
    async masterStatus(){
      // GOD-6: also the person's numeric GitHub id (`subject`, the key of every per-person setting) and the saved login.
      // An expired token says so (`expired`), so the connection can fall back to the app with a reason.
      try{
        const m=await currentMaster();
        const subject=await directory.getPilotVerifiedSubject(tenant.tenantId,tenant.identityId);
        const login=await db.getSetting('master_login.'+subject).catch(()=>null);
        return {enrolled:true,scopes:m.scopes,expires_at:m.expiresAt,subject,login:typeof login==='string'&&login?login:null};
      }catch{
        try{
          const subject=await directory.getPilotVerifiedSubject(tenant.tenantId,tenant.identityId);
          const row=await directory.getPilotOptionalCredential({tenantId:tenant.tenantId,
            identityId:tenant.identityId,accountLogin:MASTER_HANDLE,kind:'M'});
          const at=row?.expires_at?new Date(row.expires_at):null;
          if(row&&at&&Number.isFinite(at.getTime())&&at.getTime()<=now()&&typeof subject==='string'&&String(row.actor_id)===subject)
            return {enrolled:false,expired:true,expires_at:at.toISOString(),subject};
        }catch{ /* not expired, just absent */ }
        return {enrolled:false};
      }
    },
    async token(args={}) {
      const cred=args.cred??'I';
      if(cred==='M'){
        if(args.scope?.repositories?.length||args.scope?.repository_ids?.length||args.scope?.permissions)throw optionalDenied();
        const {row}=await currentMaster();
        try{ return decryptSecret(row.access_enc,{aad:masterAad(tenant),key:key()}); }
        catch{throw optionalDenied();}
      }
      if(cred==='K'||cred==='P'){
        if(args.scope?.repositories?.length||args.scope?.repository_ids?.length||
            args.scope?.permissions)throw optionalDenied();
        let own;
        try{ own=await currentOptional(args.account,cred); }
        catch(error){
          const m=await currentMaster(FALLBACK_SCOPES[cred]).catch(()=>{throw error;});
          try{ return decryptSecret(m.row.access_enc,{aad:masterAad(tenant),key:key()}); }
          catch{throw optionalDenied();}
        }
        try{
          return decryptSecret(own.row.access_enc,{
            aad:pilotOptionalAad({tenantId:tenant.tenantId,
              identityId:tenant.identityId,accountLogin:args.account,kind:cred}),
            key:key()});
        }catch{throw optionalDenied();}
      }
      // GitHub explicitly limits an App USER token to the intersection of
      // the user's and the App's permissions. An invited member must NEVER
      // inherit an installation-wide I token; route ordinary I-mode tools
      // through that member's own U token instead. The provider will refuse
      // App-only endpoints the user is not authorized to call.
      if (cred==='I' && tenant.role==='owner') return base.token(args);
      if (cred!=='U' && cred!=='I') throw denied();
      // User bearers cannot be minted down to repository/permission-scoped
      // passes. Refuse before lookup/decryption/refresh, with no broader fallback.
      if (args.scope?.repositories?.length || args.scope?.repository_ids?.length ||
          args.scope?.permissions) throw denied();
      if (typeof args.account!=='string') throw denied();
      const row=await directory.getPilotUserAuthorization(
        tenant.tenantId,tenant.identityId,args.account.toLowerCase());
      if (!row || !row.access_enc) throw denied();
      // A bound grant cannot retain authority through a context/install change.
      // Legacy rows remain supported, but never become capability evidence.
      if (row.authority_binding) {
        const subject=await directory.getPilotVerifiedSubject(tenant.tenantId,tenant.identityId);
        const active=await directory.authorizedPilotIdentity(tenant.tenantId,tenant.identityId);
        const account=await db.getAccount(args.account);
        if (!active || active.membershipRevision!==tenant.membershipRevision ||
            active.pilotRevision!==tenant.pilotRevision || !currentUserGrantBinding({
              row,tenant:active,subject,account,now:now(),allowExpired:true})) throw denied();
      }
      if (new Date(row.access_expires_at).getTime()<=now()+60_000)
        return renewPilotUser({directory,tenant,db,account:args.account,
          row,env,now,fetchImpl});
      try {
        return decryptSecret(row.access_enc,{
          aad:aad(tenant.tenantId,tenant.identityId,args.account,'access'),key:key()
        });
      } catch {
        throw denied();
      }
    },
    async forgetUserAuthorization(account) {
      if (typeof account!=='string') return;
      await directory.revokePilotUserAuthorization(tenant.tenantId,
        tenant.identityId,account.toLowerCase());
    }
  };
}
