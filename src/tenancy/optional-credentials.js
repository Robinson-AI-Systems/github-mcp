// CAP-3 internal-only private K/P enrollment primitive. The protected
// one-use /api/tenant/optional browser form is its sole bearer entry point.
// A separately scoped runtime adapter decrypts only current enrolled K/P
// grants; Octokit additionally limits each request to the verified read.
import {createHash} from 'node:crypto';
import { encryptSecret, readEncryptionKey } from '../core/crypto.js';
import { verifyGithubBearerIdentity } from './github-identity.js';

const LOGIN=/^[a-z0-9][a-z0-9-]{0,38}$/;
const SUBJECT=/^[1-9][0-9]{0,18}$/;
const DENIED='Optional GitHub authority was not verified for this private member.';
const denied=()=>new Error(DENIED);
const spec=Object.freeze({
  // GOD-1: 'M' (master token) has no per-account probe; see master-credential.js. Present so its AAD context is valid.
  M:{operation:'GET /user',scope:null,endpoint:()=>'https://api.github.com/user',resource:(account,subject)=>'user/'+subject},
  // PUB-9: 'F' (fine-grained token) is enrolled by fine-grained-credential.js only; present so its AAD context is valid.
  F:{operation:'GET /user/repos',scope:null,endpoint:()=>'https://api.github.com/user/repos',resource:account=>'owner/'+account.account_id},
  K:{operation:'GET /notifications',scope:'notifications',
    endpoint:()=>'https://api.github.com/notifications?per_page=1',
    resource:(account,subject)=>'user/'+subject},
  P:{operation:'GET /orgs/{org}/packages',scope:'read:packages',
    endpoint:account=>'https://api.github.com/orgs/'+encodeURIComponent(account.login)+'/packages?package_type=container&per_page=1',
    resource:account=>'org/'+account.account_id}
});
const safeAccount=account=>account &&
  typeof account.login==='string' && LOGIN.test(account.login.toLowerCase()) &&
  Number.isSafeInteger(account.account_id) && account.account_id>0 &&
  account.credential_kind==='app' && account.installation_status==='active';
export const pilotOptionalAad=({tenantId,identityId,accountLogin,kind})=>{
  if(typeof tenantId!=='string'||!tenantId||
      typeof identityId!=='string'||!identityId||
      typeof accountLogin!=='string'||!LOGIN.test(accountLogin.toLowerCase())||
      !Object.hasOwn(spec,kind)) throw denied();
  return 'github-mcp/private-tenant/'+tenantId+'/identity/'+identityId+
    '/account/'+accountLogin.toLowerCase()+'/optional/'+kind+'/github.com';
};

/** Returns no token and never uses another tenant's owner/global credentials.
 * For classic PATs we require a same-token numeric /user read, an exact harmless
 * capability read and GitHub's issued OAuth scope header; form-supplied scopes
 * or a successful /user alone cannot turn into authority. Any ambiguity fails.
 * A bounded local proof TTL avoids claiming permanent provider access. */
export async function enrollVerifiedPilotOptionalCredential({
  directory,db,tenant,accountLogin,kind,bearer,expectedFingerprint=null,
  env=process.env,fetchImpl=fetch,now=Date.now
}={}){
  const selected=['K','P'].includes(kind)?spec[kind]:null;
  if(!selected||typeof accountLogin!=='string'||!LOGIN.test(accountLogin.toLowerCase())||
      typeof bearer!=='string'||bearer.length<8||bearer.length>4096||
      /[^\x21-\x7e]/.test(bearer)||
      typeof directory?.authorizedPilotIdentity!=='function'||
      typeof directory?.getPilotVerifiedSubject!=='function'||
      typeof directory?.putPilotOptionalCredential!=='function'||
      typeof db?.getAccount!=='function'||!tenant?.tenantId||!tenant?.identityId||
      !Number.isSafeInteger(tenant.membershipRevision)||
      !Number.isSafeInteger(tenant.pilotRevision)) throw denied();
  // Recheck CURRENT member and pilot epochs immediately before provider I/O.
  const active=await directory.authorizedPilotIdentity(tenant.tenantId,tenant.identityId);
  if(!active||active.tenantId!==tenant.tenantId||
      active.identityId!==tenant.identityId||
      active.membershipRevision!==tenant.membershipRevision||
      active.pilotRevision!==tenant.pilotRevision) throw denied();
  const account=await db.getAccount(accountLogin);
  if(!safeAccount(account)||account.login.toLowerCase()!==accountLogin.toLowerCase())
    throw denied();
  const subject=await directory.getPilotVerifiedSubject(tenant.tenantId,tenant.identityId);
  if(typeof subject!=='string'||!SUBJECT.test(subject)||
      !Number.isSafeInteger(Number(subject))) throw denied();
  try {
    const principal=await verifyGithubBearerIdentity(bearer,{fetchImpl});
    if(principal.subject!==subject) throw denied();
    const response=await fetchImpl(selected.endpoint(account),{
      method:'GET',redirect:'error',headers:{
        accept:'application/vnd.github+json',
        authorization:'Bearer '+bearer,
        'x-github-api-version':'2022-11-28'
      },signal:AbortSignal.timeout(10000)
    });
    // A successful provider read MUST also attest the required OAuth scope.
    // Never trust a caller-provided scope or infer that an App user token is K/P.
    const granted=String(response?.headers?.get?.('x-oauth-scopes')??'')
      .split(',').map(x=>x.trim()).filter(Boolean);
    if(!response?.ok||response.status!==200||!granted.includes(selected.scope))
      throw denied();
    const resource=selected.resource(account,subject);
    const accessEnc=encryptSecret(bearer,{
      key:readEncryptionKey(env),aad:pilotOptionalAad({
        tenantId:tenant.tenantId,identityId:tenant.identityId,accountLogin,kind
      })
    });
    // Revalidate the membership epochs after the external calls; the INSERT
    // repeats these checks transactionally to close any remaining TOCTOU gap.
    const fresh=await directory.authorizedPilotIdentity(tenant.tenantId,tenant.identityId);
    if(!fresh||fresh.membershipRevision!==tenant.membershipRevision||
        fresh.pilotRevision!==tenant.pilotRevision) throw denied();
    const expiresAt=new Date(now()+24*60*60*1000);
    const stored=await directory.putPilotOptionalCredential({
      tenantId:tenant.tenantId,identityId:tenant.identityId,
      accountLogin:accountLogin.toLowerCase(),kind,actorId:Number(subject),
      accountId:account.account_id,membershipRevision:tenant.membershipRevision,
      pilotRevision:tenant.pilotRevision,accessEnc,operation:selected.operation,
      resource,scopes:[selected.scope],expiresAt,expectedFingerprint
    });
    if(!stored) throw denied();
    return Object.freeze({status:'read-observed-at-enrollment',kind,
      operation:selected.operation,resource,host:'github.com',
      providerExecution:'one-time-harmless-read',currentProviderPermission:'not-tested',
      expiresAt:expiresAt.toISOString()});
  } catch {
    // The GitHub bearer, provider response and encryption details must never
    // appear in a user-facing error or log.
    throw denied();
  }
}


/** Nonsecret historical observation for the same private member. The directory
 * performs fresh SQL epoch/revocation checks; this function rechecks record,
 * ciphertext fingerprint, account and exact resource before any diagnostic.
 * By itself it NEVER authorizes dispatch or decrypts/replays a bearer;
 * the runtime adapter separately revalidates it before an exact-read-only call. */
export function currentPilotOptionalReadback({
  row,tenant,account,subject,kind,operation,resource,now=Date.now()
}={}){
  const selected=['K','P'].includes(kind)?spec[kind]:null;
  if(!row||!selected||operation!==selected.operation||!safeAccount(account)||
      typeof subject!=='string'||!SUBJECT.test(subject)||
      !tenant?.tenantId||!tenant?.identityId||
      row.provider_host!=='github.com'||row.kind!==kind||
      String(row.actor_id)!==subject||
      Number(row.account_id)!==account.account_id||
      row.verified_operation!==operation||
      row.verified_resource!==resource||
      resource!==selected.resource(account,subject)||
      !Array.isArray(row.scopes)||!row.scopes.includes(selected.scope)||
      typeof row.access_enc!=='string'||!row.access_enc.startsWith('v1.')||
      typeof row.cipher_fingerprint!=='string'||
      !Number.isFinite(new Date(row.expires_at).getTime())||
      new Date(row.expires_at).getTime()<=now) return null;
  const fingerprint=createHash('sha256').update(row.access_enc).digest('hex');
  if(fingerprint!==row.cipher_fingerprint) return null;
  return {kind:'classic_pat',host:'github.com',login:account.login,
    accountId:account.account_id,tenantId:tenant.tenantId,
    identityId:tenant.identityId,githubUserId:Number(subject),
    fingerprint,currentCipherFingerprint:fingerprint,
    expiresAt:new Date(row.expires_at).toISOString(),revokedAt:null,
    resources:[resource],permissions:[],scopes:[selected.scope],
    verification:'identity-and-capability-readback',
    observation:'read-observed-at-enrollment'};
}
