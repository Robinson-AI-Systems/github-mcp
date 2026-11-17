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
export async function sweepAllocations({root,load=allocationScope,authorityOf=allocationAuthority,env=process.env,budgetMs=20000,now=Date.now}={}){
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
   if(s.placement==='device'){const result=await disposeAllocation(ctx,{row:{id:s.workspace,owner:s.owner,repo:s.repo},...s.native});if(!result.disposed)pending++;continue;}
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
 return {inspected,disposed,pending,next_page:after!==''};
}
export async function sweep(req,res,{env=process.env,root,run=sweepAllocations}={}){
 res.setHeader('Cache-Control','no-store');if(req.method!=='POST')return res.status(405).json({error:'method_not_allowed'});
 try{const actual=String(req.headers.authorization??''),same=e=>actual.length===e.length&&timingSafeEqual(Buffer.from(actual),Buffer.from(e));
  // The sweep key, or the deployment's CRON_SECRET: the rack's project timer calls the sweep with it (DOKPLOY-RETIRE-1).
  if(!same('Bearer '+sweepKey(env))&&!(typeof env.CRON_SECRET==='string'&&env.CRON_SECRET.length>=32&&same('Bearer '+env.CRON_SECRET)))return res.status(401).json({error:'unauthorized'});return res.status(200).json(await run({root:root??createDb(productionSql()),env}));}catch{return res.status(503).json({error:'cleanup_pending'});}
}
