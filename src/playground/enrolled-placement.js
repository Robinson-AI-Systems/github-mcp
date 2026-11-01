// PLAY-2: non-executable, tenant-local placement intent for a user-owned host.
// No paid provider mutation, runtime dispatch, origin tool arguments or implicit
// migration from an operator allocation. Readiness is deliberately never true.
import {playgroundBinding} from './client.js';
import {pinnedDeviceOrigin} from './device-probe.js';
import {nativeConnection} from '../native-git/client.js';

const DEVICE=/^[a-f0-9]{32}$/;
const BIND=/^[a-f0-9]{64}$/;
const fail=reason=>Object.assign(new TypeError(reason),{
 safeMessage:true,safeCode:'enrolled_placement_unavailable'
});
export const enrolledPlacementKey=binding=>{
 if(!BIND.test(binding??''))throw fail('Invalid exact workspace binding.');
 return 'pg_device_alloc.'+binding.slice(0,40);
};
const hostKey=deviceId=>{
 if(!DEVICE.test(deviceId??''))throw fail('A previously enrolled exact device ID is required.');
 return 'pg_host.'+deviceId;
};
function authorized(ctx,record){
 const scope=ctx.db?.playgroundScope,connection=ctx.connection;
 if(!scope?.tenantId||!scope?.identityId||!Number.isSafeInteger(scope.membershipRevision)||
    !connection?.client_id||connection.pass===true||connection.pass_id||
    connection.profile!=='full'||typeof ctx.db?.compareAndSetSetting!=='function'||
    record?.binding?.connection!==nativeConnection(ctx)||
    record?.row?.state!=='pending')throw fail('Your current Full tenant connection and active workspace are required.');
 return {tenantId:scope.tenantId,identityId:scope.identityId,
  membershipRevision:scope.membershipRevision,clientId:connection.client_id};
}
function exactHost(host,{tenantId,identityId,clientId},deviceId,binding,now,requireFresh){
 if(!host||host.kind!=='playground-enrolled-host'||host.deviceId!==deviceId||
    host.tenantId!==tenantId||host.identityId!==identityId||host.clientId!==clientId||
    host.status!=='pending_canary'||!Number.isSafeInteger(host.generation)||host.generation<1||
    !/^[a-f0-9]{64}$/.test(host.fingerprint??'')||typeof host.publicKey!=='string'||
    !host.publicKey.startsWith('ed25519:')||!host.pairedAt||
    host.localCanaryBinding!==binding||
    !/^[a-z0-9][a-z0-9._/-]*(?::[a-z0-9._-]+)?@sha256:[a-f0-9]{64}$/.test(host.localCanaryImage??'')||
    !BIND.test(host.localCanaryReceiptHash??'')||
    !Number.isSafeInteger(host.transportVerifiedAt)||!Number.isSafeInteger(host.localCanaryAt)||
    host.transportVerifiedAt>now+15000||host.localCanaryAt>now+15000||
    (requireFresh&&(host.transportVerifiedAt<=now-300000||host.localCanaryAt<=now-300000)))
   throw fail('Device has not passed the signed current-connection checks for this exact workspace.');
 pinnedDeviceOrigin(host.origin);
 return host;
}
const exposed=(stored,hostCurrent=true)=>({
 placement:'enrolled',workspace_id:stored.workspace,device_id:stored.deviceId,
 generation:stored.generation,phase:hostCurrent?stored.phase:'enrollment_revoked',
 repository_attached:false,execution_available:false,command_started:false,
 storageQuotaVerified:false,availability:'git_only',
 next:hostCurrent?'Device and workspace pinned. Native Git source attachment, current authority, resource and cleanup evidence remain required; no executable allocation exists.':'This enrolled device changed or was revoked; no command was sent.'
});
export async function enrolledPlacementRecord(ctx,record){
 const scope=authorized(ctx,record),binding=playgroundBinding(record);
 const saved=await ctx.db.getSetting(enrolledPlacementKey(binding));
 if(!saved)return null;
 if(saved.kind!=='playground-enrolled-allocation/v1'||saved.binding!==binding||
    saved.workspace!==record.row.id||saved.worker!==record.worker||
    saved.connection!==record.binding.connection||saved.tenantId!==scope.tenantId||
    saved.identityId!==scope.identityId||saved.clientId!==scope.clientId||
    saved.owner.toLowerCase()!==record.row.owner.toLowerCase()||
    saved.repo.toLowerCase()!==record.row.repo.toLowerCase()||
    saved.phase!=='awaiting_source')throw fail('An enrolled allocation record does not match the current workspace.');
 const host=await ctx.db.getSetting(hostKey(saved.deviceId));
 let current=false;
 try{
  const pinned=exactHost(host,scope,saved.deviceId,binding,(ctx.now??Date.now)(),false);
  current=pinned.generation===saved.generation&&pinned.origin===saved.origin&&
   pinned.fingerprint===saved.fingerprint&&pinned.publicKey===saved.publicKey&&
   pinned.localCanaryImage===saved.image;
 }catch{/* a stale or revoked device has zero execution authority */}
 return {stored,current};
}
export async function prepareEnrolledPlacement(ctx,record,deviceId){
 const scope=authorized(ctx,record);
 if(!DEVICE.test(deviceId??''))throw fail('Select only your own previously paired device ID.');
 const binding=playgroundBinding(record),now=(ctx.now??Date.now)();
 const activeOperator=await ctx.db.getSetting('playground.'+binding.slice(0,40));
 if(activeOperator&&activeOperator.phase!=='disposed')
  throw fail('An operator allocation is already recorded for this workspace. Drain and reconcile it separately; no automatic migration.');
 const old=await enrolledPlacementRecord(ctx,record);
 if(old){
  if(!old.current||old.stored.deviceId!==deviceId)
   throw fail('An existing workspace placement is pinned to a different or revoked device. No migration was performed.');
  return exposed(old.stored,true);
 }
 const host=exactHost(await ctx.db.getSetting(hostKey(deviceId)),scope,deviceId,binding,now,true);
 const placement={kind:'playground-enrolled-allocation/v1',binding,workspace:record.row.id,
  worker:record.worker,owner:record.row.owner,repo:record.row.repo,connection:record.binding.connection,
  tenantId:scope.tenantId,identityId:scope.identityId,
  membershipRevision:scope.membershipRevision,clientId:scope.clientId,
  deviceId,generation:host.generation,fingerprint:host.fingerprint,publicKey:host.publicKey,
  origin:host.origin,image:host.localCanaryImage,phase:'awaiting_source',
  sourceAttached:false,executionReady:false,createdAt:now,revision:1};
 const saved=await ctx.db.compareAndSetSetting(enrolledPlacementKey(binding),0,placement);
 if(!saved){
  const found=await enrolledPlacementRecord(ctx,record);
  if(found?.current&&found.stored.deviceId===deviceId)return exposed(found.stored);
  throw fail('Workspace placement was concurrently assigned; no duplicate was created.');
 }
 return exposed(saved);
}
export async function inspectEnrolledPlacement(ctx,record){
 const row=await enrolledPlacementRecord(ctx,record);
 return row?exposed(row.stored,row.current):null;
}
