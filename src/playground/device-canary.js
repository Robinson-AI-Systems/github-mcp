// PLAY-2: a fresh current-grant controller claim reads a previous *owner-run*
// fixed local canary receipt. No arbitrary commands are sent over this path,
// and this evidence cannot promote a workspace to executable readiness.
import {createPublicKey,verify,randomBytes,createHash} from 'node:crypto';
import {pinnedDeviceOrigin,pinnedDeviceRequest} from './device-probe.js';

const fail=()=>Object.assign(new TypeError('The enrolled local runtime canary was not verified. No command was allowed.'),{safeCode:'device_canary_unconfirmed'});
const ID=/^[a-f0-9]{32}$/;
const BIND=/^[a-f0-9]{64}$/;
const IMAGE=/^[a-z0-9][a-z0-9._/-]*(?::[a-z0-9._-]+)?@sha256:[a-f0-9]{64}$/;
const SIG=/^ed25519:[A-Za-z0-9_-]{86}$/;
const CLAIM='robinson-playground-local-canary-read/v1';
const RESPONSE='robinson-playground-local-canary-proof/v1';
const keyOf=s=>{
 if(typeof s!=='string'||!s.startsWith('ed25519:'))throw fail();
 try{
  const k=createPublicKey({key:Buffer.from(s.slice(8),'base64'),format:'der',type:'spki'});
  if(k.asymmetricKeyType==='ed25519')return k;
 }catch{/* no trust on parse errors */}
 throw fail();
};
export function localRuntimeCanaryClaim({deviceId,origin,generation,now=Date.now,nonce=randomBytes(16).toString('hex')}={}){
 pinnedDeviceOrigin(origin);
 if(!ID.test(deviceId??'')||!Number.isSafeInteger(generation)||generation<1||
   !ID.test(nonce??''))throw fail();
 return {purpose:CLAIM,deviceId,origin,generation,nonce,expiresAt:now()+60000};
}
export function verifyLocalRuntimeCanaryClaim(body,signature,controlPublicKey,{deviceId,origin,generation,now=Date.now}={}){
 if(typeof body!=='string'||Buffer.byteLength(body)>4096||!SIG.test(signature??'')||
    !verify(null,Buffer.from(body),keyOf(controlPublicKey),Buffer.from(signature.slice(8),'base64url')))throw fail();
 let c;try{c=JSON.parse(body);}catch{throw fail();}
 if(!c||Array.isArray(c)||c.purpose!==CLAIM||c.deviceId!==deviceId||c.origin!==origin||
  c.generation!==generation||!ID.test(c.deviceId)||!ID.test(c.nonce??'')||
  !Number.isSafeInteger(c.expiresAt)||c.expiresAt<=now()||c.expiresAt>now()+90000||
  Object.keys(c).sort().join(',')!=='deviceId,expiresAt,generation,nonce,origin,purpose')throw fail();
 return c;
}
export function localRuntimeCanaryReply(claim,receipt,{now=Date.now}={}){
 const row=receipt?.row;
 if(!row||row.deviceId!==claim.deviceId||row.origin!==claim.origin||
    row.generation!==claim.generation||!BIND.test(row.workspaceBinding??'')||
    !IMAGE.test(row.image??'')||row.repositoryAttached!==false||row.controllerAdmission!==false||
    row.node24Uid1000!==true||row.postgres15StartStop!==true||row.chromium!==true||
    row.localDockerIsolation!==true||row.storageQuotaBytes!==null||
    !BIND.test(receipt.digest??''))throw fail();
 return {purpose:RESPONSE,deviceId:claim.deviceId,origin:claim.origin,
  generation:claim.generation,nonce:claim.nonce,observedAt:now(),expiresAt:now()+30000,
  localCanaryAt:row.observedAt,workspaceBinding:row.workspaceBinding,
  image:row.image,localReceiptSha256:receipt.digest,
  checks:{node24Uid1000:true,postgres15StartStop:true,chromium:true,localDockerIsolation:true},
  storageQuotaBytes:null,repositoryAttached:false,executionReady:false};
}
export function verifyLocalRuntimeCanaryReply(body,signature,devicePublicKey,claim,{now=Date.now}={}){
 if(typeof body!=='string'||Buffer.byteLength(body)>8192||!SIG.test(signature??'')||
  !verify(null,Buffer.from(body),keyOf(devicePublicKey),Buffer.from(signature.slice(8),'base64url')))throw fail();
 let p;try{p=JSON.parse(body);}catch{throw fail();}
 if(!p||Array.isArray(p)||p.purpose!==RESPONSE||p.deviceId!==claim.deviceId||
  p.origin!==claim.origin||p.generation!==claim.generation||p.nonce!==claim.nonce||
  !Number.isSafeInteger(p.observedAt)||p.observedAt<now()-60000||p.observedAt>now()+15000||
  !Number.isSafeInteger(p.expiresAt)||p.expiresAt<=now()||p.expiresAt>now()+90000||
  !Number.isSafeInteger(p.localCanaryAt)||p.localCanaryAt<=now()-300000||
  p.localCanaryAt>now()+15000||!BIND.test(p.workspaceBinding??'')||
  !IMAGE.test(p.image??'')||!BIND.test(p.localReceiptSha256??'')||
  p.storageQuotaBytes!==null||p.repositoryAttached!==false||p.executionReady!==false||
  !p.checks||JSON.stringify(p.checks)!==JSON.stringify({
   node24Uid1000:true,postgres15StartStop:true,chromium:true,localDockerIsolation:true
  })||
  Object.keys(p).sort().join(',')!=='checks,deviceId,executionReady,expiresAt,generation,image,localCanaryAt,localReceiptSha256,nonce,observedAt,origin,purpose,repositoryAttached,storageQuotaBytes,workspaceBinding')throw fail();
 return p;
}
export async function readEnrolledLocalCanary({record,signClaim,
 transport=pinnedDeviceRequest,now=Date.now}={}){
 if(!record||record.status!=='pending_canary'||!ID.test(record.deviceId??'')||
    typeof signClaim!=='function'||!record.publicKey||
    !Number.isSafeInteger(record.transportVerifiedAt)||
    record.transportVerifiedAt<=now()-300000)throw fail();
 const claim=localRuntimeCanaryClaim({...record,now});
 const body=JSON.stringify(claim),signature=signClaim(body);
 const response=await transport({origin:record.origin,body,signature,path:'/v1/enrollment/canary'});
 const result=verifyLocalRuntimeCanaryReply(response.body,response.signature,
  record.publicKey,claim,{now});
 return {deviceId:record.deviceId,generation:record.generation,origin:record.origin,
  localCanaryAt:result.localCanaryAt,image:result.image,
  binding:result.workspaceBinding,receiptHash:result.localReceiptSha256,
  repositoryAttached:false,executionReady:false};
}
