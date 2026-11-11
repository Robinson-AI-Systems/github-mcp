import {callNativeWorker} from '../native-git/client.js';
import {attachRepository} from './attachment.js';
import {createHash,timingSafeEqual} from 'node:crypto';
import {publicOrigin} from '../core/http.js';
import {signNativeWorkerBody} from '../native-git/signing.js';
import {createDb,productionSql} from '../db.js';
import {allocationScope,allocationAuthority} from './lifecycle.js';
import {ensureAllocation,disposeAllocation} from './allocations.js';
import {indexAllocation,rootAllocationDb} from './index.js';
import {dokployConfig,dokployProvider,pinProviderIdentity} from './dokploy.js';
import {reconcileWarmRuntimes} from './warm-runtimes.js';
import {stuckReason,markStuck,releaseTransferLock,isRuntimeOnlyCleanup} from './stuck.js';
const hash=x=>createHash('sha256').update(x).digest('hex');
export const sweepKey=env=>hash(signNativeWorkerBody(JSON.stringify({purpose:'robinson-playground-maintenance/v1',origin:publicOrigin(env)}),env));
// The sweep key is derived from the server signing key, so a TOKEN_ENCRYPTION_KEY
// rotation silently changes what a running manager should carry. Compare the
// provider's stored compose with the freshly built one: the sweep key slot is
// the only field that may legitimately differ. 'current' = stored key matches
// the current derivation; 'stale' = only the key differs (re-pin it); 'other'
// = anything else differs (an ownership problem, never a repair candidate).
export function managerKeyDrift(storedFile,expectedFile){
 if(storedFile===expectedFile)return 'current';
 let stored,expected;try{stored=JSON.parse(storedFile);expected=JSON.parse(expectedFile);}catch{return 'other';}
 const keyOf=x=>x?.services?.manager?.environment?.PLAYGROUND_SWEEP_KEY;
 const masked=x=>{const copy=JSON.parse(JSON.stringify(x));const env=copy?.services?.manager?.environment;if(env&&typeof env==='object')delete env.PLAYGROUND_SWEEP_KEY;return JSON.stringify(copy);};
 if(masked(stored)!==masked(expected))return 'other';
 return keyOf(stored)===keyOf(expected)?'current':'stale';
}
export async function ensureProjectManager(ctx,config,provider){
 const root=rootAllocationDb(ctx),origin=publicOrigin(ctx.env),name='ras-pg-manager-'+hash(origin).slice(0,16),description='robinson-playground-manager/v1 '+hash(origin);
 let state=await root.getSetting('playground_manager');
 const pinnedSource=state?.source??(config.image?{image:config.image}:{image:'ras-playground:'+config.sourceSha,build:{context:'https://github.com/Robinson-AI-Systems/github-mcp.git#'+config.sourceSha,dockerfile:'workers/coding-workspace/Dockerfile',target:'production'}});
 // JSONB normalizes object key order. Reconstruct the original pinned source
 // shape before byte-exact provider ownership comparison; never repin to the
 // current controller image merely because settings were read from Postgres.
 const source={image:pinnedSource.image,...(pinnedSource.build?{build:{context:pinnedSource.build.context,dockerfile:pinnedSource.build.dockerfile,target:pinnedSource.build.target}}:{})};
 const key=sweepKey(ctx.env),composeFile=JSON.stringify({name,services:{manager:{...source,user:'1000:1000',init:true,restart:'unless-stopped',read_only:true,cap_drop:['ALL'],security_opt:['no-new-privileges:true'],mem_limit:'128m',cpus:'0.1',command:['node','workers/coding-workspace/manager.js'],healthcheck:{disable:true},environment:{PLAYGROUND_SWEEP_URL:new URL('/api/playground/sweep',origin).href,PLAYGROUND_SWEEP_KEY:key},tmpfs:['/tmp:rw,noexec,nosuid,nodev,size=16m,mode=1777']}}});
 // Only a fingerprint of the derived key is recorded (never the key itself):
 // it is what lets a later rotation be noticed on the running path below.
 const keyFingerprint=hash(key);
 // Regenerated only in trusted memory: the manager's cleanup-only capability is
 // never stored in the ordinary allocation registry or returned by an MCP tool.
 let plan={name,description,composeFile,planHash:hash(composeFile),...(state?.providerAppName?{providerAppName:state.providerAppName}:{})};
 const save=async patch=>{const next=await root.compareAndSetSetting('playground_manager',state?.revision??0,{...state,...patch,revision:(state?.revision??0)+1});if(!next)throw new TypeError('Manager provisioning is already in progress.');state=next;};
 if(state?.phase==='running'){
  if(state.keyFingerprint===keyFingerprint)return;
  // The recorded fingerprint disagrees with the current derivation (or predates
  // fingerprints): the running manager may carry a key the server no longer
  // accepts. Prove what the provider actually holds before mutating anything.
  if(typeof provider.stored!=='function'||typeof provider.update!=='function')throw new TypeError('Manager sweep-key re-pin is unavailable from this provider.');
  const row=await provider.stored(state.composeId,plan);if(!row)throw new TypeError('Manager is recorded running but its provider compose is missing.');
  const drift=managerKeyDrift(row.composeFile,composeFile);
  if(drift==='other')throw new TypeError('Manager compose changed outside its sweep key; no mutation was sent.');
  if(drift==='current'){await save({keyFingerprint});return;}
  // Re-pin through the provider's own update path, then redeploy; the
  // 'deploying' promotion below (or a later ensure) confirms the restart.
  await provider.update(state.composeId,plan);
  await save({phase:'deploying',dispatchVersion:1,keyFingerprint});
  await provider.deploy(state.composeId,plan);
 }
 if(!state){await save({phase:'creating',name,description,source,keyFingerprint});const created=await provider.create(plan);if(!created?.composeId)throw new TypeError('Manager creation is uncertain.');plan=pinProviderIdentity(plan,created.appName);await save({phase:'created',composeId:created.composeId,providerAppName:plan.providerAppName});}
 else if(state.phase==='creating'){const matches=(await provider.inventory()).filter(x=>x.name===name||x.appName===name);if(matches.length!==1)throw new TypeError('Manager creation is uncertain; no duplicate was created.');const observed=await provider.inspect(matches[0].composeId,plan,{adoptAssignedName:true});plan=pinProviderIdentity(plan,observed.appName);await save({phase:'created',composeId:observed.composeId,providerAppName:plan.providerAppName,source});}
 if(!plan.providerAppName){const observed=await provider.inspect(state.composeId,plan,{adoptAssignedName:true});plan=pinProviderIdentity(plan,observed?.appName);await save({providerAppName:plan.providerAppName,source});}
 // The pre-suffix-fix controller recorded deploying before its ownership
 // preflight refused. Recover that legacy no-dispatch state once, only after
 // exact source/identity plus idle/empty provider deployment readback. Never
 // repeatedly resubmit an uncertain new dispatch.
 if(state.phase==='deploying'&&!state.dispatchVersion&&provider.deployments&&(await provider.inspect(state.composeId,plan))?.composeStatus==='idle'&&(await provider.deployments(state.composeId,plan)).length===0)await save({phase:'created',dispatchVersion:1});
 if(state.phase==='created'){await save({phase:'deploying',dispatchVersion:1});await provider.deploy(state.composeId,plan);}
 if(state.phase==='deploying'&&(await provider.inspect(state.composeId,plan))?.composeStatus==='done')await save({phase:'running'});
}
export async function sweepAllocations({root,load=allocationScope,authorityOf=allocationAuthority,env=process.env,budgetMs=20000,now=Date.now,providerFactory=dokployProvider,fetch=globalThis.fetch,warm=reconcileWarmRuntimes}={}){
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
   // Device allocations are cleaned up through their own machine; Dokploy rows use their own pool.
   if(s.placement==='device'){const result=await disposeAllocation(ctx,{row:{id:s.workspace,owner:s.owner,repo:s.repo},...s.native});if(!result.disposed)pending++;continue;}
   const config=dokployConfig(env,s.pool),provider=providerFactory(config,{fetch:ctx.fetch});
   if(!s.composeId&&!['requested','waiting_resources','disposed'].includes(s.phase)){const matches=(await provider.inventory()).filter(a=>a.name===s.plan.name||a.appName===s.plan.name);if(matches.length!==1){pending++;continue;}const observed=await provider.inspect(matches[0].composeId,s.plan,{adoptAssignedName:true});const next=await ctx.db.compareAndSetSetting('playground.'+s.binding.slice(0,40),s.revision,{...s,composeId:observed.composeId,plan:pinProviderIdentity(s.plan,observed.appName),revision:s.revision+1});if(!next){pending++;continue;}await indexAllocation(ctx,next);ctx.stored=next;}
   const record={row:{id:s.workspace,owner:s.owner,repo:s.repo},...s.native};
   if(runtimeOnly)await releaseTransferLock(ctx,s);
   const result=await disposeAllocation(ctx,record,{config,provider});
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
 // FLEET-7: the same sweep runs the warm-runtime gate and drains tenant-free image holders it no longer wants.
 let warmState={enabled:false,pending:true};if(now()-start<budgetMs)try{warmState=await warm({root,env,fetch,now,providerFactory});}catch{/* Retried next sweep; never blocks allocation cleanup. */}
 return {inspected,disposed,pending,next_page:after!=='',warm:{enabled:warmState.enabled===true,running:warmState.running??0,pending:warmState.pending===true||warmState.pending>0}};
}
export async function sweep(req,res,{env=process.env,root,run=sweepAllocations}={}){
 res.setHeader('Cache-Control','no-store');if(req.method!=='POST')return res.status(405).json({error:'method_not_allowed'});
 try{const expected='Bearer '+sweepKey(env),actual=String(req.headers.authorization??'');if(actual.length!==expected.length||!timingSafeEqual(Buffer.from(actual),Buffer.from(expected)))return res.status(401).json({error:'unauthorized'});return res.status(200).json(await run({root:root??createDb(productionSql()),env}));}catch{return res.status(503).json({error:'cleanup_pending'});}
}
