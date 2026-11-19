import {callNativeWorker} from '../native-git/client.js';
import {attachRepository} from './attachment.js';
import {createHash,timingSafeEqual} from 'node:crypto';
import {publicOrigin} from '../core/http.js';
import {signNativeWorkerBody} from '../native-git/signing.js';
import {createDb,productionSql} from '../db.js';
import {allocationScope,allocationAuthority} from './lifecycle.js';
import {ensureAllocation,disposeAllocation} from './allocations.js';
import {indexAllocation} from './index.js';
import {stuckReason,markStuck,releaseTransferLock,isRuntimeOnlyCleanup} from './stuck.js';
const hash=x=>createHash('sha256').update(x).digest('hex');
export const sweepKey=env=>hash(signNativeWorkerBody(JSON.stringify({purpose:'robinson-playground-maintenance/v1',origin:publicOrigin(env)}),env));
// DOKPLOY-RETIRE-1 (2026-11-17): the project manager service and the warm runtimes ran on the retired
// Dokploy pool and are gone. The sweep stays: it is called by a rack timer (or any scheduler) and advances or
// cleans up every allocation, on a person's own computer or (closing them) left from the retired pool.
// SWEEP-CLEANUP-1 (2026-11-19): the sweep runs every minute, so it never blocks on a computer that is offline: it checks a
// removal order's answer briefly (deviceWaitMs) and looks again next minute. It used to wait the full 20 s on one offline
// computer every run. Closed records are cleared after RETAIN_CLOSED_MS once their workspace is gone (clearClosedAllocations).
export async function sweepAllocations({root,load=allocationScope,authorityOf=allocationAuthority,env=process.env,budgetMs=20000,deviceWaitMs=1500,now=Date.now}={}){
 const start=now(),cursor=await root.getSetting('playground_sweep_cursor'),rows=await root.listPlaygroundIndexes({after:cursor?.after??'',limit:50});let inspected=0,disposed=0,pending=0,after=cursor?.after??'';
 for(const row of rows){if(now()-start>=budgetMs)break;const indexed=row.value.allocation;after=row.setting;inspected++;
  try{
   const ctx=await load({binding:indexed.binding,...(indexed.scope?.tenantId?{tenant:indexed.scope.tenantId,identity:indexed.scope.identityId}:{})},{env});let s=ctx.stored;
   const authority=await authorityOf(ctx);
   if(authority.bootstrap&&authority.connection&&!s.cleanupRequested){
    // PG-STUCK-1: a runtime with no progress past the stored threshold is given up on here, never
    // retried forever; one whose deployment reports an error is marked by ensureAllocation itself.
    const reason=stuckReason(s,{now:now(),env});
    if(!reason){ctx.connection=authority.connection;ctx.publicDb=root;const record={row:{id:s.workspace,owner:s.owner,repo:s.repo,expires_at:authority.job.expires_at},...s.native};const allocated=await ensureAllocation(ctx,record);if(!isRuntimeOnlyCleanup(allocated)){if(['allocated','attaching'].includes(allocated.phase))await attachRepository(ctx,record,{budgetMs:Math.max(1000,budgetMs-(now()-start))});continue;}s=allocated;}
    else{ctx.publicDb=root;const marked=await markStuck(ctx,s,reason,{now:now(),env});if(!marked){pending++;continue;}s=marked;}
    ctx.stored=s;
   }
   // Only the runtime goes for a stuck allocation while its workspace and grant are still current;
   // an expired/closed workspace or revoked grant still disposes the workspace too, as before.
   const runtimeOnly=isRuntimeOnlyCleanup(s)&&!(authority.cleanup&&authority.reason!=='allocation_not_active');
   if(runtimeOnly&&s.phase==='disposed')continue;
   if(!authority.cleanup&&!s.cleanupRequested&&!['cleanup_requested','stopped','deleting'].includes(s.phase))continue;
   ctx.connection={client_id:s.clientId,pass_id:s.passId};ctx.publicDb=root;
   // Device allocations are cleaned up through their own machine.
   if(s.placement==='device'){const result=await disposeAllocation(ctx,{row:{id:s.workspace,owner:s.owner,repo:s.repo},...s.native},{deviceWaitMs});if(!result.disposed)pending++;continue;}
   // A row of the retired pool has nothing left to remove from here: disposeAllocation closes it.
   const record={row:{id:s.workspace,owner:s.owner,repo:s.repo},...s.native};
   if(runtimeOnly)await releaseTransferLock(ctx,s);
   const result=await disposeAllocation(ctx,record);
   if(result.disposed){
    if(!result.sourceDisposed&&!runtimeOnly){
     const job={...s.native.job,brokerOrigin:undefined,allocationBinding:undefined};
     const invoke=(action,options)=>callNativeWorker(ctx,{binding:s.native.binding,workspace_id:s.native.worker,job,action,options,allowWrite:true,renewLease:false});
     // Release only this transfer's lock. Close still refuses any unrelated lock;
     // an absent source is independently read back by the bound worker's close.
     if(s.transfer)try{await invoke('attachment_export',{mode:'release',transferId:s.transfer.transferId});}catch{/* Close confirms absence or safely refuses its retained lease. */}
     if((await invoke('close')).disposed!==true){pending++;continue;}
     await ctx.db.finishJob?.(s.workspace,s.connection,{state:'ready',detail:'Native workspace disposed.'});
     const updated=await ctx.db.compareAndSetSetting('playground.'+s.binding.slice(0,40),result.revision,{...result,sourceDisposed:true,revision:result.revision+1});if(!updated){pending++;continue;}await indexAllocation(ctx,updated);
    }
    disposed++;
   }else pending++;
  }catch{pending++;}
 }
 if(rows.length===0||inspected===rows.length&&rows.length<50)after='';
 await root.compareAndSetSetting('playground_sweep_cursor',cursor?.revision??0,{revision:(cursor?.revision??0)+1,after});
 const cleared=now()-start<budgetMs?await clearClosedAllocations({root,load,budgetMs:budgetMs-(now()-start),now}):{cleared:0,kept:0};
 return {inspected,disposed,pending,cleared:cleared.cleared,next_page:after!==''};
}
export const RETAIN_CLOSED_MS=7*86400000;
// Deletes closed allocation records (the tenant's record and its index row) once they are a week old and their
// workspace record is gone, so nothing can still refer to them. The computers clear the workspace files themselves:
// each Git machine deletes a workspace once its idle lease expires, and a device runtime is ordered down on check-in
// if the computer still reports it (src/fleet/host.js). A record whose scope can no longer be loaded is unreachable,
// so only its index row is left to delete. Progress is kept in 'playground_retention'.
export async function clearClosedAllocations({root,load=allocationScope,env=process.env,budgetMs=10000,limit=25,now=Date.now}={}){
 const start=now(),rows=await root.listClosedPlaygroundIndexes({before:now()-RETAIN_CLOSED_MS,limit});let cleared=0,kept=0;
 for(const row of rows){
  if(now()-start>=budgetMs)break;
  const indexed=row.value.allocation;
  try{
   let ctx=null;
   try{ctx=await load({binding:indexed.binding,...(indexed.scope?.tenantId?{tenant:indexed.scope.tenantId,identity:indexed.scope.identityId}:{})},{env});}
   catch(error){if(!(error instanceof TypeError))throw error;}
   const s=ctx?.stored;
   if(s&&s.phase!=='disposed'){kept++;continue;}
   if(s&&!ctx.namespaceMissing){
    if(await ctx.db.getJob?.(s.workspace,s.connection)){kept++;continue;}
    if(typeof ctx.db.deleteSettingAt==='function'&&!await ctx.db.deleteSettingAt('playground.'+s.binding.slice(0,40),s.revision)){kept++;continue;}
   }
   if(await root.deleteSettingAt(row.setting,row.value.revision))cleared++;else kept++;
  }catch{kept++;}
 }
 if(cleared){const t=await root.getSetting('playground_retention');await root.compareAndSetSetting('playground_retention',t?.revision??0,{revision:(t?.revision??0)+1,clearedTotal:(t?.clearedTotal??0)+cleared,lastClearedAt:now()});}
 return {cleared,kept};
}
export async function sweep(req,res,{env=process.env,root,run=sweepAllocations}={}){
 res.setHeader('Cache-Control','no-store');if(req.method!=='POST')return res.status(405).json({error:'method_not_allowed'});
 try{const actual=String(req.headers.authorization??''),same=e=>actual.length===e.length&&timingSafeEqual(Buffer.from(actual),Buffer.from(e));
  // The sweep key, or the deployment's CRON_SECRET: the rack's project timer calls the sweep with it (DOKPLOY-RETIRE-1).
  if(!same('Bearer '+sweepKey(env))&&!(typeof env.CRON_SECRET==='string'&&env.CRON_SECRET.length>=32&&same('Bearer '+env.CRON_SECRET)))return res.status(401).json({error:'unauthorized'});return res.status(200).json(await run({root:root??createDb(productionSql()),env}));}catch{return res.status(503).json({error:'cleanup_pending'});}
}
