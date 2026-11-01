// PLAY-2: per-tenant, personally confirmed host pairing. Never returns execution
// authority. A host stays pending_canary until separately verified by the runtime.
import {createHash, randomBytes, createPublicKey, verify} from 'node:crypto';
import {probeEnrolledDevice} from './device-probe.js';
import {readEnrolledLocalCanary} from './device-canary.js';
import {signEnrolledDeviceProbeBody,signEnrolledLocalCanaryBody} from '../native-git/signing.js';

const sha = value => createHash('sha256').update(value).digest('hex');
const safe = message => Object.assign(new TypeError(message), {safeMessage:true, safeCode:'playground_enrollment_denied'});
const validId = id => typeof id === 'string' && /^[a-f0-9]{32}$/.test(id);
const codePattern = /^[A-Za-z0-9_-]{43}$/;
const keyFor = id => 'pg_host.' + id;
const rootKey = hash => 'pg_pair.' + hash.slice(0,48);
const indexKey = 'pg_enrolled_index';
const publicKeyOf = key => {
  if(typeof key!=='string'||!/^ed25519:[A-Za-z0-9_-]{40,160}$/.test(key)) throw safe('Invalid pairing key.');
  const pk = createPublicKey({key:Buffer.from(key.slice(8),'base64url'),format:'der',type:'spki'});
  if(pk.asymmetricKeyType!=='ed25519') throw safe('Expected an Ed25519 device key.');
  return pk;
};
export const deviceFingerprint = value => sha(Buffer.from(value.slice(8),'base64url'));
export const pairingIndexKey = code => rootKey(sha(code));
// FLEET-3: opaque routing from a device ID to its tenant scope (no authority in it).
export const deviceRouteKey = deviceId => 'fleet_route.' + deviceId;
export const pairingMessage = ({deviceId,code,origin}) =>
  JSON.stringify({purpose:'robinson-playground-device-pair/v1',deviceId,code,origin});
const originOf = text => {
  let u;try{u=new URL(text);}catch{throw safe('The device HTTPS origin is invalid.');}
  if(u.protocol!=='https:'||u.username||u.password||u.port||u.pathname!=='/'||u.search||u.hash||
     !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])$/i.test(u.hostname)||
     /^[0-9.]+$/.test(u.hostname)||u.hostname==='localhost'||u.hostname.endsWith('.localhost')||
     u.hostname.endsWith('.local')||u.hostname.endsWith('.internal'))throw safe('Only a pinned public HTTPS tunnel name can be enrolled.');
  return u.origin;
};
async function cas(db,key,update){
  for(let n=0;n<4;n++){
    const old=await db.getSetting(key),revision=old?.revision??0;
    const next=update(old);
    if(!next)return null;
    const saved=await db.compareAndSetSetting(key,revision,{...next,revision:revision+1});
    if(saved)return saved;
  }
  throw safe('Enrollment changed concurrently. Reopen My connection.');
}
export function createEnrolledHostStore({db,root,tenantId,identityId,clientId,now=Date.now,random=randomBytes,env=process.env,probeClient=probeEnrolledDevice,canaryClient=readEnrolledLocalCanary}={}){
  if(!db?.getSetting||!db?.compareAndSetSetting||!root?.getSetting||!root?.setSetting||
     typeof tenantId!=='string'||typeof identityId!=='string'||typeof clientId!=='string'||!clientId)throw safe('Verified enrollment scope is required.');
  const current=()=>now();
  const list=async()=>{
    const idx=await db.getSetting(indexKey),ids=idx?.ids??[];
    // 32 is the steady-state bound kept by begin(); older indexes that grew past it
    // (before pruning existed) are still readable up to a hard read bound so they self-heal.
    if(!Array.isArray(ids)||ids.length>256||!ids.every(validId))throw safe('Invalid enrolled host index.');
    const found=await Promise.all(ids.map(id=>db.getSetting(keyFor(id))));
    return found.filter(h=>h?.tenantId===tenantId&&h.identityId===identityId&&h.clientId===clientId).map(h=>({
      deviceId:h.deviceId,status:h.status,fingerprint:h.fingerprint??null,origin:h.origin??null,
      generation:h.generation,pairedAt:h.pairedAt??null,transportVerifiedAt:h.transportVerifiedAt??null,localCanaryAt:h.localCanaryAt??null,
      localCanaryImage:h.localCanaryImage??null,localCanaryBinding:h.localCanaryBinding??null,
      transport:h.transport??'tunnel',lastCheckInAt:h.lastLeaseAt??null,capacity:h.capacity??null,
      revocationPending:h.status==='revocation_pending',lapsed:lapsed(h)
    }));
  };
  // An unclaimed or unconfirmed pairing whose window passed can never progress,
  // so it neither counts toward the device cap nor stays in the bounded index.
  const lapsed=h=>['pending_pair','pending_confirm'].includes(h?.status)&&Number.isSafeInteger(h.expiresAt)&&h.expiresAt<=current();
  async function begin(){
    const existing=await list();
    if(existing.filter(x=>x.status!=='revoked'&&!x.lapsed).length>=8)throw safe('This connection already has eight enrolled or pending devices.');
    const deviceId=random(16).toString('hex'),code=random(32).toString('base64url'),hash=sha(code),expiresAt=current()+600000;
    const host={kind:'playground-enrolled-host',tenantId,identityId,clientId,deviceId,generation:1,
      status:'pending_pair',codeHash:hash,expiresAt,createdAt:current(),revision:1};
    if(!await db.compareAndSetSetting(keyFor(deviceId),0,host))throw safe('Device identity collision.');
    // Keep the tenant index bounded: drop finished (revoked or lapsed) records of
    // ANY client before appending. Their records remain as durable tombstones.
    const prior=(await db.getSetting(indexKey))?.ids??[];
    const finished=new Set((await Promise.all(prior.filter(validId).map(async id=>{const h=await db.getSetting(keyFor(id));return h?.status==='revoked'||lapsed(h)?id:null;}))).filter(Boolean));
    let full=false;
    await cas(db,indexKey,old=>{const ids=[...new Set([...(old?.ids??[]).filter(id=>!finished.has(id)),deviceId])].sort();if(ids.length>32){full=true;return null;}return {ids};});
    if(full){await db.compareAndSetSetting(keyFor(deviceId),1,{...host,status:'revoked',codeHash:null,revokedAt:current(),revision:2});throw safe('This account has too many devices still enrolled or pending. Revoke unused devices in My connection, then start again.');}
    await root.setSetting(rootKey(hash),{kind:'playground-pair-selector',tenantId,identityId,clientId,deviceId,expiresAt});
    return {deviceId,code,expiresAt};
  }
  async function claim({code,deviceId,publicKey,origin,signature}={}){
    if(!codePattern.test(code??'')||!validId(deviceId)||typeof signature!=='string'||!/^[-_A-Za-z0-9]{80,128}$/.test(signature))throw safe('Invalid device pairing proof.');
    const h=await db.getSetting(keyFor(deviceId)),hash=sha(code),pointer=await root.getSetting(rootKey(hash));
    if(!h||h.tenantId!==tenantId||h.identityId!==identityId||h.clientId!==clientId||h.deviceId!==deviceId||
      h.status!=='pending_pair'||h.codeHash!==hash||h.expiresAt<=current()||
      pointer?.tenantId!==tenantId||pointer.identityId!==identityId||pointer.clientId!==clientId||pointer.deviceId!==deviceId||
      pointer.expiresAt!==h.expiresAt)throw safe('Pairing was already used, expired, or belongs to another person.');
    // No origin = a dial-out host agent (FLEET-3): it reaches us, we never reach it.
    const url=origin===undefined||origin===null?null:originOf(origin),pk=publicKeyOf(publicKey),msg=pairingMessage({deviceId,code,origin:url});
    if(!verify(null,Buffer.from(msg),pk,Buffer.from(signature,'base64url')))throw safe('Device did not prove its signing key.');
    const fp=deviceFingerprint(publicKey);
    const saved=await db.compareAndSetSetting(keyFor(deviceId),h.revision,{
      ...h,revision:h.revision+1,status:'pending_confirm',codeHash:null,publicKey,fingerprint:fp,origin:url,transport:url?'tunnel':'dial-out',
      claimedAt:current(),expiresAt:Math.min(h.expiresAt,current()+300000)
    });
    if(!saved)throw safe('Pairing was consumed concurrently.');
    if(!url)await root.setSetting(deviceRouteKey(deviceId),{kind:'fleet-device-route',tenantId,identityId,clientId,deviceId});
    return {deviceId,status:'pending_confirm',fingerprint:fp,origin:url,transport:url?'tunnel':'dial-out'};
  }
  async function approve(deviceId){
    if(!validId(deviceId))throw safe('Unknown device.');
    const saved=await cas(db,keyFor(deviceId),h=>{
      if(h?.tenantId!==tenantId||h.identityId!==identityId||h.clientId!==clientId||h.status!=='pending_confirm'||h.expiresAt<=current()||
         !h.publicKey||!h.fingerprint||!h.origin&&h.transport!=='dial-out')return null;
      return {...h,status:'pending_canary',pairedAt:current(),codeHash:null,expiresAt:null};
    });
    if(!saved)throw safe('The device must first prove its key; reconnect and verify its fingerprint.');
    return {deviceId,status:'pending_canary',fingerprint:saved.fingerprint};
  }
  async function probe(deviceId){
    if(!validId(deviceId))throw safe('Unknown device.');
    const h=await db.getSetting(keyFor(deviceId));
    if(!h||h.tenantId!==tenantId||h.identityId!==identityId||h.clientId!==clientId||
       h.status!=='pending_canary'||!h.origin||!h.publicKey||!h.fingerprint)throw safe('Device must be approved under your current connection first.');
    const observed=await probeClient({record:h,now:current,signClaim:body=>signEnrolledDeviceProbeBody(body,env)});
    if(observed.deviceId!==h.deviceId||observed.generation!==h.generation||observed.origin!==h.origin||
       observed.fingerprint!==h.fingerprint||observed.executionReady!==false||observed.transportVerified!==true)throw safe('Device proof did not match enrolled identity.');
    const saved=await db.compareAndSetSetting(keyFor(deviceId),h.revision,{...h,revision:h.revision+1,transportVerifiedAt:observed.observedAt});
    if(!saved)throw safe('Enrollment changed during probe; no host was admitted.');
    return {deviceId,status:'pending_canary',transportVerifiedAt:saved.transportVerifiedAt,executionReady:false};
  }
  async function canary(deviceId){
    if(!validId(deviceId))throw safe('Unknown device.');
    const h=await db.getSetting(keyFor(deviceId));
    if(!h||h.tenantId!==tenantId||h.identityId!==identityId||h.clientId!==clientId||
       h.status!=='pending_canary'||!h.publicKey||!h.fingerprint||!h.origin||
       !Number.isSafeInteger(h.transportVerifiedAt)||h.transportVerifiedAt<=current()-300000)
      throw safe('A fresh pinned device-tunnel proof is required before local canary readback.');
    const result=await canaryClient({record:h,now:current,
      signClaim:body=>signEnrolledLocalCanaryBody(body,env)});
    if(result.deviceId!==h.deviceId||result.generation!==h.generation||
       result.origin!==h.origin||result.executionReady!==false||
       result.repositoryAttached!==false||!Number.isSafeInteger(result.localCanaryAt)||
       typeof result.image!=='string'||typeof result.binding!=='string'||
       !/^[a-f0-9]{64}$/.test(result.receiptHash??''))
      throw safe('Local canary receipt does not match the enrolled device.');
    const next=await db.compareAndSetSetting(keyFor(deviceId),h.revision,{
      ...h,revision:h.revision+1,localCanaryAt:result.localCanaryAt,
      localCanaryImage:result.image,localCanaryBinding:result.binding,
      localCanaryReceiptHash:result.receiptHash
    });
    if(!next)throw safe('Enrollment changed before canary proof could be recorded. No command was admitted.');
    return {deviceId,status:'pending_canary',localCanaryAt:next.localCanaryAt,
      localCanaryImage:next.localCanaryImage,executionReady:false};
  }
  async function revoke(deviceId){
    if(!validId(deviceId))throw safe('Unknown device.');
    const saved=await cas(db,keyFor(deviceId),h=>{
      if(h?.tenantId!==tenantId||h.identityId!==identityId||h.clientId!==clientId)return null;
      if(['revoked','revocation_pending'].includes(h.status))return {...h};
      return {...h,status:h.status==='ready'||h.status==='constrained'?'revocation_pending':'revoked',
        codeHash:null,revokedAt:current(),generation:h.generation+1};
    });
    if(!saved)throw safe('Device is not enrolled under this connection.');
    return {deviceId,status:saved.status,cleanupConfirmed:saved.status==='revoked'};
  }
  return {begin,claim,approve,probe,canary,revoke,list};
}
