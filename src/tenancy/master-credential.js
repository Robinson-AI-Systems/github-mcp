// GOD-1: the master token (credential kind 'M').
// One classic GitHub token that belongs to the SAME person who signed in. It is stored once per person under the
// fixed handle 'master' (it is not tied to one connected account), encrypted with a context that binds it to the
// tenant and the person, and every use goes through the normal guarded tool lifecycle. No tool ever returns it.
import {createHash} from 'node:crypto';
import {encryptSecret,readEncryptionKey} from '../core/crypto.js';
import {pilotOptionalAad} from './optional-credentials.js';

const SUBJECT=/^[1-9][0-9]{0,18}$/;
const denied=()=>new Error('The master token was not verified. Check that it is a classic token from your own GitHub login.');
export const MASTER_HANDLE='master';
// Every classic scope that is useful to an assistant. The person can untick any of them on GitHub; what is ticked is recorded.
export const MASTER_SCOPES=Object.freeze(['repo','workflow','write:packages','delete:packages','admin:org',
  'admin:public_key','admin:repo_hook','admin:org_hook','gist','notifications','user','delete_repo',
  'write:discussion','admin:gpg_key','admin:ssh_signing_key','codespace','project','audit_log','copilot']);
// GOD-3: `enterprise` adds the optional GitHub Enterprise permissions (only for people who administer an enterprise).
export const ENTERPRISE_SCOPES=Object.freeze(['admin:enterprise','manage_billing:enterprise','read:enterprise','scim:enterprise']);
export const masterTokenLink=({enterprise=false}={})=>'https://github.com/settings/tokens/new?description='+
  encodeURIComponent('Robinson GitHub MCP master token')+'&scopes='+
  [...MASTER_SCOPES,...(enterprise?ENTERPRISE_SCOPES.filter(x=>!MASTER_SCOPES.includes(x)):[])].map(encodeURIComponent).join(',');
export const masterAad=({tenantId,identityId})=>pilotOptionalAad({tenantId,identityId,accountLogin:MASTER_HANDLE,kind:'M'});
const parseExpiry=value=>{
  const text=String(value??'').trim();
  if(!text)return null;
  const ms=Date.parse(text.replace(' UTC','Z').replace(' ','T'));
  return Number.isFinite(ms)?ms:null;
};

export async function enrollMasterCredential({
  directory,tenant,bearer,expectedFingerprint=null,env=process.env,fetchImpl=fetch,now=Date.now
}={}){
  if(typeof bearer!=='string'||bearer.length<8||bearer.length>4096||/[^\x21-\x7e]/.test(bearer)||
      typeof directory?.authorizedPilotIdentity!=='function'||
      typeof directory?.getPilotVerifiedSubject!=='function'||
      typeof directory?.putPilotOptionalCredential!=='function'||
      !tenant?.tenantId||!tenant?.identityId||
      !Number.isSafeInteger(tenant.membershipRevision)||!Number.isSafeInteger(tenant.pilotRevision)) throw denied();
  try{
    const active=await directory.authorizedPilotIdentity(tenant.tenantId,tenant.identityId);
    if(!active||active.membershipRevision!==tenant.membershipRevision||
        active.pilotRevision!==tenant.pilotRevision) throw denied();
    const subject=await directory.getPilotVerifiedSubject(tenant.tenantId,tenant.identityId);
    if(typeof subject!=='string'||!SUBJECT.test(subject)) throw denied();
    const response=await fetchImpl('https://api.github.com/user',{method:'GET',redirect:'error',
      headers:{accept:'application/vnd.github+json',authorization:'Bearer '+bearer,
        'x-github-api-version':'2022-11-28'},signal:AbortSignal.timeout(10000)});
    if(!response?.ok||response.status!==200) throw denied();
    const who=await response.json();
    if(String(who?.id)!==subject) throw denied();                    // must be the person who signed in
    const scopes=[...new Set(String(response.headers?.get?.('x-oauth-scopes')??'')
      .split(',').map(x=>x.trim()).filter(Boolean))];
    if(scopes.length<1||scopes.length>60||!scopes.every(x=>/^[a-z_]+(?::[a-z_]+)*$/.test(x))) throw denied(); // classic only
    // The person chose the token's life on GitHub (30 days, a year, or never). We keep exactly that: no cap of our own.
    // No expiry header means the token never expires; it then stays until the person removes it.
    const theirs=parseExpiry(response.headers?.get?.('github-authentication-token-expiration'));
    if(theirs!==null&&theirs<=now()) throw denied();
    const expiresAt=theirs===null?null:new Date(theirs);
    const accessEnc=encryptSecret(bearer,{key:readEncryptionKey(env),aad:masterAad(tenant)});
    const fresh=await directory.authorizedPilotIdentity(tenant.tenantId,tenant.identityId);
    if(!fresh||fresh.membershipRevision!==tenant.membershipRevision||
        fresh.pilotRevision!==tenant.pilotRevision) throw denied();
    const stored=await directory.putPilotOptionalCredential({
      tenantId:tenant.tenantId,identityId:tenant.identityId,accountLogin:MASTER_HANDLE,kind:'M',
      actorId:Number(subject),accountId:Number(subject),membershipRevision:tenant.membershipRevision,
      pilotRevision:tenant.pilotRevision,accessEnc,operation:'GET /user',resource:'user/'+subject,
      scopes,expiresAt,expectedFingerprint});
    if(!stored) throw denied();
    return Object.freeze({status:'read-observed-at-enrollment',kind:'M',scopes,expiresAt:expiresAt?expiresAt.toISOString():null,login:typeof who.login==='string'?who.login:null});
  }catch{ throw denied(); }
}

/** Nonsecret check of a stored master row: right person, intact ciphertext, not expired. Returns scopes and expiry. */
export function currentMasterReadback({row,subject,now=Date.now()}={}){
  if(!row||row.kind!=='M'||row.provider_host!=='github.com'||typeof subject!=='string'||!SUBJECT.test(subject)||
      String(row.actor_id)!==subject||Number(row.account_id)!==Number(subject)||
      row.verified_operation!=='GET /user'||row.verified_resource!=='user/'+subject||
      !Array.isArray(row.scopes)||row.scopes.length<1||
      typeof row.access_enc!=='string'||!row.access_enc.startsWith('v1.')||
      typeof row.cipher_fingerprint!=='string'||
      (row.expires_at!==null&&row.expires_at!==undefined&&
        (!Number.isFinite(new Date(row.expires_at).getTime())||new Date(row.expires_at).getTime()<=now))) return null;
  if(createHash('sha256').update(row.access_enc).digest('hex')!==row.cipher_fingerprint) return null;
  return {scopes:[...row.scopes],expiresAt:row.expires_at?new Date(row.expires_at).toISOString():null};
}
