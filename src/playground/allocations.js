import {chooseRuntimeImage} from './runtime-variant.js';
import {indexAllocation} from './index.js';
import {resolveSizeClass,describeSize} from './sizing.js';
import {chooseHost,devicePlan,ensureDeviceAllocation,disposeDeviceAllocation,deviceBaseline,inspectDevice} from '../fleet/device-allocations.js';
import {enqueue as enqueueOrder} from '../fleet/mailbox.js';
import {playgroundBinding} from './client.js';
import {nativeConnection} from '../native-git/client.js';
import {stuckReason,stuckExplanation,markStuck,releaseTransferLock,isRuntimeOnlyCleanup,MAX_FAILED_STARTS} from './stuck.js';
const fail=message=>Object.assign(new TypeError(message),{safeMessage:true,safeCode:'playground_allocation_recovery'});
export const allocationKey=binding=>'playground.'+binding.slice(0,40);
export async function allocationRecord(ctx,record){
 const binding=playgroundBinding(record),key=allocationKey(binding),value=await ctx.db.getSetting(key);
 if(value&&(value.binding!==binding||value.connection!==nativeConnection(ctx)||value.workspace!==record.row.id))throw fail('Stored allocation does not belong to this exact workspace/connection.');return value;
}
// Device rows reuse the same key, index and compare-and-set discipline.
function deviceSaver(ctx,key,stored){let current=stored;return async patch=>{const next=await ctx.db.compareAndSetSetting(key,current.revision,{...current,...patch,revision:current.revision+1});if(!next)throw fail('Another allocation transition is in progress; inspect the existing state.');current=next;await indexAllocation(ctx,next);return next;};}
function deviceRow(ctx,record,binding,chosen,sizeClass,choice){
 const plan=devicePlan(ctx,record,binding,chosen.h,chosen.ceiling,choice?.image??null);
 return {revision:1,kind:'playground-allocation',size:sizeClass,placement:'device',...(choice?.record?{runtimeImage:choice.record}:{}),device:{deviceId:chosen.h.deviceId,generation:chosen.h.generation},scope:ctx.db.playgroundScope??{legacy:true},delegated:ctx.connection.pass===true,providerOrigin:null,providerProject:null,providerEnvironment:null,binding,connection:nativeConnection(ctx),clientId:ctx.connection.client_id??null,passId:ctx.connection.pass_id??null,workspace:record.row.id,owner:record.row.owner,repo:record.row.repo,phase:'requested',planHash:plan.planHash,plan,native:{binding:record.binding,worker:record.worker,job:record.job},createdAt:(ctx.now??Date.now)(),expiresAt:new Date(record.row.expires_at).getTime()};
}
async function placeOnDevice(ctx,record,sizeClass,choose){
 const chosen=await chooseHost(ctx,sizeClass);if(!chosen)return null;
 const binding=playgroundBinding(record),saved=await ctx.db.compareAndSetSetting(allocationKey(binding),0,deviceRow(ctx,record,binding,chosen,sizeClass,await choose()));
 if(!saved)return await allocationRecord(ctx,record);await indexAllocation(ctx,saved);return saved;
}
// Every state transition is a DB compare-and-set. A lost provider create response
// is recovered by exact owned source/plan, never by blindly creating another stack.
// DOKPLOY-RETIRE-1 (2026-11-17): the shared operator pool (Dokploy) is retired. A runtime is placed only on a
// computer the person (or the service owner) paired with github_playground_host_pairing. A row left from the
// retired pool is closed in place: its resources are removed on that server by its owner, not from here.
const NO_HOST='No Playground computer is available for this workspace. Pair one of your own computers or servers with github_playground_host_pairing (it needs Docker); your workspace files are kept and Git tools still work.';
const RETIRED='This runtime was on the retired shared pool, which no longer exists; it is closed. Your workspace files are kept and Git tools still work. Pair one of your own computers with github_playground_host_pairing, then provision again.';
const isRetiredPoolRow=row=>!!row&&row.placement!=='device';
async function retirePoolRow(ctx,stored){
 if(stored.phase==='disposed')return stored;
 const next=await ctx.db.compareAndSetSetting(allocationKey(stored.binding),stored.revision,{...stored,phase:'disposed',disposed:true,disposedAt:(ctx.now??Date.now)(),retiredPool:true,cleanupEvidence:'operator_pool_retired',revision:stored.revision+1});
 if(!next)throw fail('Another allocation transition is in progress; inspect the existing state.');await indexAllocation(ctx,next);return next;
}
export async function ensureAllocation(ctx,record,{size,deviceWaitMs,signals}={}){
 // FLEET-2: the image of a NEW allocation is chosen once by the slim gate (runtime-variant.js).
 const choices=new Map(),choose=(sizeClass,pinned=false)=>{const k=sizeClass+':'+pinned;if(!choices.has(k))choices.set(k,chooseRuntimeImage(ctx,record,sizeClass,{pinned,signals}));return choices.get(k);};
 const prior=await allocationRecord(ctx,record);
 // A row from the retired pool is closed; a disposed one is replaced on a paired computer below.
 if(isRetiredPoolRow(prior)&&prior.phase!=='disposed')return retirePoolRow(ctx,prior);
 if(prior?.placement==='device')return ensureDeviceAllocation(ctx,prior,deviceSaver(ctx,allocationKey(prior.binding),prior),{waitMs:deviceWaitMs});
 const sizeClass=prior?.size??resolveSizeClass(size,ctx.env);
 if(sizeClass===null)throw fail('Runtime size none means no Playground allocation; choose auto, small, medium or large to provision.');
 if(prior){
  // A closed row of the retired pool is replaced by a fresh row on a paired computer under the same key.
  const chosen=await chooseHost(ctx,sizeClass);if(!chosen)throw Object.assign(fail(NO_HOST),{status:409,safeCode:'playground_no_host'});
  const binding=playgroundBinding(record),row=deviceRow(ctx,record,binding,chosen,sizeClass,await choose(sizeClass));
  const next=await ctx.db.compareAndSetSetting(allocationKey(binding),prior.revision,{...row,revision:prior.revision+1});
  if(!next)throw fail('Another allocation transition is in progress; inspect the existing state.');await indexAllocation(ctx,next);
  return ensureDeviceAllocation(ctx,next,deviceSaver(ctx,allocationKey(binding),next),{waitMs:deviceWaitMs});
 }
 const placed=await placeOnDevice(ctx,record,sizeClass,()=>choose(sizeClass));
 if(!placed)throw Object.assign(fail(NO_HOST),{status:409,safeCode:'playground_no_host'});
 if(isRetiredPoolRow(placed))return retirePoolRow(ctx,placed);
 return ensureDeviceAllocation(ctx,placed,deviceSaver(ctx,allocationKey(placed.binding),placed),{waitMs:deviceWaitMs});
}
export async function disposeAllocation(ctx,record,{deviceWaitMs}={}){
 const stored=await allocationRecord(ctx,record);if(!stored)return {disposed:true,allocationExisted:false};
 if(stored.placement==='device')return disposeDeviceAllocation(ctx,stored,deviceSaver(ctx,allocationKey(stored.binding),stored),{waitMs:deviceWaitMs});
 return retirePoolRow(ctx,stored);
}

// PG-STUCK-1: remove a runtime that can no longer make progress (provider error, or no progress
// past the stored threshold), keeping the person's workspace. Returns {stored, reason, pending}.
// pending=true means removal was started but its whole-process absence is not confirmed yet.
export async function recoverAllocation(ctx,record,{composeStatus}={}){
 let stored=await allocationRecord(ctx,record);if(!stored||stored.placement==='device')return {stored,reason:null,pending:false};
 let reason=isRuntimeOnlyCleanup(stored)?stored.cleanupReason:null;
 if(!reason&&!stored.cleanupRequested){reason=stuckReason(stored,{now:(ctx.now??Date.now)(),env:ctx.env,composeStatus});if(reason){const marked=await markStuck(ctx,stored,reason,{now:(ctx.now??Date.now)()});if(!marked)throw Object.assign(fail('Another allocation transition is in progress; read the allocation in a minute.'),{safeRetryable:true});stored=marked;}}
 if(!reason||stored.phase==='disposed')return {stored,reason,pending:false};
 await releaseTransferLock(ctx,stored);
 const result=await disposeAllocation(ctx,record);
 return {stored:result.disposed?await allocationRecord(ctx,record):result,reason,pending:result.disposed!==true};
}
const replacingMessage=(reason,env)=>`This workspace's runtime failed to start (${stuckExplanation(reason,env)}) and is being removed; your workspace files are kept.`;
export function recoveryPendingError(reason,env){return Object.assign(fail(replacingMessage(reason,env)+' Call github_playground_workspace operation provision again in about a minute; a fresh runtime is created then.'),{status:409,safeRetryable:true,safeCode:'playground_runtime_replacing'});}
/** Provision, replacing a stuck runtime first (at most once per call, never the same broken compose). */
export async function provisionAllocation(ctx,record,options={}){
 let replaced=null;
 for(let round=0;round<2;round++){
  const recovered=await recoverAllocation(ctx,record,options);
  if(recovered.pending)throw recoveryPendingError(recovered.reason,ctx.env);
  if(recovered.reason)replaced=recovered.reason;
  const stored=await ensureAllocation(ctx,record,options);
  // A deployment that reported an error during this call is removed and replaced in the second round.
  if(!isRuntimeOnlyCleanup(stored)||round===1)return replaced?{...stored,replacedReason:replaced}:stored;
  replaced=stored.cleanupReason;
 }
}
export function replacementNotice(reason,env){return reason?`The previous runtime failed to start (${stuckExplanation(reason,env)}) and was removed; a fresh runtime is being provisioned and attaches automatically. Next: github_playground_read operation allocation in a few minutes.`:null;}

export async function inspectAllocation(ctx,record){
 let stored=await allocationRecord(ctx,record);if(!stored)return {workspace_id:record.row.id,phase:'absent',allocation_ready:false};
 if(stored.phase==='disposed')return {workspace_id:record.row.id,phase:'disposed',disposed:true,...(stored.retiredPool===true?{retired_pool:true,cleanup:'manual_by_server_owner',note:'Closed when the shared Dokploy pool was retired; its server owner removed the resources by hand, so this row is not a checked teardown.'}:{}),...(stored.cleanupEvidence==='device_unconfirmed'?{cleanup:'unconfirmed',unconfirmed_reason:stored.unconfirmedReason??null,note:'Closed without your computer confirming the runtime was removed (it was offline, unpaired or re-paired). When that computer is next online and still reports the runtime, it is ordered removed automatically.'}:{}),...(stored.runtimeOnly?{runtime_failed:true,failed_reason:stored.cleanupReason??null,next:(stored.failedStarts??0)>=MAX_FAILED_STARTS?`The runtime failed to start ${stored.failedStarts} times in a row; nothing more is retried automatically. Your workspace files are kept and Git tools still work.`:`The runtime failed to start (${stuckExplanation(stored.cleanupReason,ctx.env)}) and was removed; your workspace files are kept. Next: github_playground_workspace operation provision for a fresh runtime.`}:{})};
 if(stored.placement==='device')return {workspace_id:record.row.id,phase:stored.phase,runtime_size:describeSize(stored.size),runtime_image:stored.runtimeImage??null,...await inspectDevice(ctx,stored),allocation_ready:['allocated','attaching','attached'].includes(stored.phase),repository_attached:stored.repositoryAttached===true,execution_available:false,next:stored.phase==='waiting_resources'?'Your computer is offline or not ready; provisioning continues when it checks in again.':'Repository attachment is required before commands.'};
 // A row from the retired shared pool (DOKPLOY-RETIRE-1).
 return {workspace_id:record.row.id,phase:stored.phase,allocation_ready:false,repository_attached:false,execution_available:false,retired_pool:true,next:RETIRED};
}

export async function resumeAllocation(ctx,record){const stored=await allocationRecord(ctx,record);if(stored?.placement==='device'){if(stored.phase!=='attached'||!await deviceBaseline(ctx,stored,{workspace:record.row.id,binding:playgroundBinding(record)}))throw fail('An attached allocation on a live, ready computer is required before resume.');await enqueueOrder(ctx.db,{deviceId:stored.device.deviceId,generation:stored.device.generation,kind:'allocation_up',payload:{binding:stored.binding,project:stored.plan.name,composeFile:stored.plan.composeFile,planHash:stored.plan.planHash},ttlMs:120000,now:ctx.now??Date.now});return stored;}throw fail(stored?RETIRED:'An attached allocation on a live, ready computer is required before resume.');}

export async function enqueueAllocation(ctx,record,{size,signals}={}){
 const sizeClass=resolveSizeClass(size,ctx.env);if(sizeClass===null)return null;
 const old=await allocationRecord(ctx,record);if(old)return old;
 // The published image of this server's own commit, when one exists (else build from source);
 // FLEET-2: the slim variant when the gate allows (small + no browser/database signals).
 const choice=await chooseRuntimeImage(ctx,record,sizeClass,{signals});
 return placeOnDevice(ctx,record,sizeClass,async()=>choice);
}
