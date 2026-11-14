// FLEET-3 check-in and report handling for dial-out host agents. Pure logic over
// a tenant scope so it can be tested without HTTP or Postgres.
import {randomBytes} from 'node:crypto';
import {CHECKIN,REPORT,ORDER,peekDevice,verifyDeviceRequest,cleanCapacity,readinessPassed} from './protocol.js';
import {enqueue,take,complete,read} from './mailbox.js';
import {signFleetOrderBody,signAgentReleaseBody} from '../native-git/signing.js';
const hostKey=id=>'pg_host.'+id;
// PLAY-3 §5.1: the newest signed agent release, advertised on the check-in
// response only when the operator has configured a release (all three env
// values). The advertisement is signed with the same fleet key that signs
// orders; the agent verifies it against the key pinned at join, checks the
// bundle hash after download, and refuses downgrades itself.
export function agentUpdateAdvertisement(env){
 const version=env?.PLAYGROUND_AGENT_LATEST_VERSION,bundleSha256=env?.PLAYGROUND_AGENT_BUNDLE_SHA256,bundleUrl=env?.PLAYGROUND_AGENT_BUNDLE_URL;
 if(typeof version!=='string'||!/^[A-Za-z0-9][A-Za-z0-9./-]{0,60}$/.test(version)||!/^[a-f0-9]{64}$/.test(bundleSha256??'')||typeof bundleUrl!=='string')return null;
 let url;try{url=new URL(bundleUrl);}catch{return null;}
 if(url.protocol!=='https:'||url.username||url.password)return null;
 const minimumProtocol=Number(env?.PLAYGROUND_AGENT_MIN_PROTOCOL);
 const body=JSON.stringify({purpose:'robinson-playground-agent-release/v1',version,bundleSha256,bundleUrl,...(Number.isSafeInteger(minimumProtocol)&&minimumProtocol>1?{minimumProtocol}:{})});
 return {body,signature:signAgentReleaseBody(body,env)};
}
const cleanUpdateReport=r=>{
 if(!r||typeof r!=='object'||Array.isArray(r))return null;
 const s=(v,n)=>typeof v==='string'?v.slice(0,n):null;
 const out={failedVersion:s(r.failedVersion,60),rolledBackTo:s(r.rolledBackTo,60),at:s(r.at,40),reason:s(r.reason,60)};
 return out.failedVersion||out.rolledBackTo?out:null;
};
const deny=reason=>Object.assign(new TypeError('Host request was not accepted.'),{safeCode:'fleet_denied',reason});
const sleepDefault=ms=>new Promise(r=>setTimeout(r,ms));
const READINESS_RETRY_MS=300000;

async function verifiedHost(scope,body,signature,purpose,now){
 const deviceId=peekDevice(body);
 // Check-ins and reports from one machine overlap, so a lost compare-and-set re-reads and re-verifies.
 for(let attempt=0;attempt<8;attempt++){
  const host=await scope.db.getSetting(hostKey(deviceId));
  if(!host||host.tenantId!==scope.tenantId||host.identityId!==scope.identityId||host.clientId!==scope.clientId||host.transport!=='dial-out')throw deny('unknown_host');
  if(host.status==='revoked')throw deny('revoked');
  if(!['pending_canary','ready','revocation_pending'].includes(host.status))throw deny('not_approved');
  // Revocation bumps the generation so nothing old keeps working; the agent still
  // answers under its own (previous) generation only to carry out the terminate order.
  const agentGeneration=host.status==='revocation_pending'?host.generation-1:host.generation;
  const request=verifyDeviceRequest(body,signature,host,{purpose,now,generation:agentGeneration});
  const recent=[...(host.recentSeqs??[]),request.seq].sort((a,b)=>a-b);
  const dropped=recent.length>64?recent.splice(0,recent.length-64):[];
  const saved=await scope.db.compareAndSetSetting(hostKey(deviceId),host.revision,{...host,recentSeqs:recent,seqFloor:dropped.length?Math.max(host.seqFloor??0,dropped.at(-1)):host.seqFloor??0,revision:host.revision+1});
  if(saved)return {host:saved,request,agentGeneration};
 }
 throw deny('concurrent');
}
export function signOrder(message,env){
 const body=JSON.stringify({purpose:ORDER,deviceId:message.deviceId,generation:message.generation,id:message.id,kind:message.type,payload:message.payload,expiresAt:message.expiresAt});
 return {body,signature:signFleetOrderBody(body,env)};
}
// Re-read and re-apply on conflict; `update` decides from the CURRENT record (or returns null to skip).
async function saveHost(db,deviceId,update){
 for(let attempt=0;attempt<8;attempt++){
  const host=await db.getSetting(hostKey(deviceId)),patch=host&&update(host);
  if(!patch)return host;
  const next=await db.compareAndSetSetting(hostKey(deviceId),host.revision,{...host,...patch,revision:host.revision+1});
  if(next)return next;
 }
 throw deny('concurrent');
}
export async function checkIn(scope,{body,signature,env,now=Date.now,waitMs=20000,pollMs=500,sleep=sleepDefault}){
 // A grant that was revoked or downgraded since pairing stops all new work.
 if(scope.grantActive===false)throw deny('grant_inactive');
 let {host,request,agentGeneration}=await verifiedHost(scope,body,signature,CHECKIN,now);
 const patch={lastLeaseAt:now(),capacity:cleanCapacity(request.capacity)};
 const updateReport=cleanUpdateReport(request.agentUpdateReport);
 if(updateReport)patch.agentUpdateReport={...updateReport,receivedAt:now()};
 if(host.status==='pending_canary'&&!host.readinessOrder&&!(host.readinessRetryAt>now())){
  const order=await enqueue(scope.db,{deviceId:host.deviceId,generation:host.generation,kind:'readiness',payload:{nonce:randomBytes(16).toString('hex')},ttlMs:600000,now});
  patch.readinessOrder=order.id;
 }
 if(host.status==='revocation_pending'&&!host.terminateOrder){
  const order=await enqueue(scope.db,{deviceId:host.deviceId,generation:agentGeneration,kind:'terminate',payload:{reason:'device_revoked'},ttlMs:7*86400000,now});
  patch.terminateOrder=order.id;
 }
 host=await saveHost(scope.db,host.deviceId,current=>({...patch,...(current.readinessOrder&&patch.readinessOrder?{readinessOrder:current.readinessOrder}:{}),...(current.terminateOrder&&patch.terminateOrder?{terminateOrder:current.terminateOrder}:{})}));
 const until=now()+Math.max(0,Math.min(waitMs,25000));let orders=[];
 for(;;){orders=await take(scope.db,host.deviceId,{now});if(orders.length||now()>=until)break;await sleep(pollMs);}
 const agentUpdate=agentUpdateAdvertisement(env);
 return {status:host.status,orders:orders.map(m=>signOrder(m,env)),serverTime:now(),pollAfterMs:orders.length?0:1000,...(agentUpdate?{agentUpdate}:{})};
}
export async function report(scope,{body,signature,now=Date.now}){
 let {host,request,agentGeneration}=await verifiedHost(scope,body,signature,REPORT,now);
 const m=await read(scope.db,request.id);
 if(!m||m.deviceId!==host.deviceId||m.generation!==agentGeneration)throw deny('unknown_order');
 const result=request.result&&typeof request.result==='object'&&!Array.isArray(request.result)?request.result:{};
 if(m.type==='relay'&&(!Number.isSafeInteger(result.status)||typeof result.body!=='string'||Buffer.byteLength(result.body)>3*1024*1024))throw deny('bad_relay_result');
 await complete(scope.db,host.deviceId,m.id,result,{now});
 if(m.type==='readiness'&&host.status==='pending_canary'&&host.readinessOrder===m.id){
  const passed=readinessPassed(result,m);
  await saveHost(scope.db,host.deviceId,current=>current.status!=='pending_canary'||current.readinessOrder!==m.id?null:passed?{status:'ready',readyAt:now(),readinessOrder:null,readiness:{dockerOk:true,composeOk:true,internalNetworkOk:true,uid1000Ok:true,checkedAt:now()}}:{readinessOrder:null,readinessRetryAt:now()+READINESS_RETRY_MS,readinessFailure:typeof result.reason==='string'?result.reason.slice(0,200):'readiness_failed'});
  return {accepted:true,status:passed?'ready':'pending_canary'};
 }
 if(m.type==='terminate'&&host.status==='revocation_pending'&&result.allAbsent===true){
  await saveHost(scope.db,host.deviceId,current=>current.status!=='revocation_pending'?null:{status:'revoked',cleanupConfirmedAt:now(),terminatedGeneration:agentGeneration,cleanupEvidence:'device_attested'});
  return {accepted:true,status:'revoked'};
 }
 return {accepted:true,status:host.status};
}
