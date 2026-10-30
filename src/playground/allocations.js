import {allocationAdmission,refreshAdmission,cleanupEvidence} from './admission.js';
import {ensureProjectManager} from './manager.js';
import {indexAllocation} from './index.js';
import {enforcementObservation} from './availability.js';
import {managedResourceBaseline} from './resource-policy.js';
import {createHash} from 'node:crypto';
import {playgroundBinding} from './client.js';
import {nativeWorkerPublicKey} from '../native-git/signing.js';
import {nativeConnection} from '../native-git/client.js';
import {allocationPlan,dokployConfig,dokployProvider,allocationProcessesStopped,pinProviderIdentity} from './dokploy.js';
const fail=message=>Object.assign(new TypeError(message),{safeMessage:true,safeCode:'playground_allocation_recovery'});
const providerScope=(stored,config)=>{if(stored&&(stored.providerOrigin!==config.origin||stored.providerProject!==config.project||stored.providerEnvironment!==config.environment))throw fail('Allocation provider scope changed; preserve the original resources.');};
export const allocationKey=binding=>'playground.'+binding.slice(0,40);
export async function allocationRecord(ctx,record){
 const binding=playgroundBinding(record),key=allocationKey(binding),value=await ctx.db.getSetting(key);
 if(value&&(value.binding!==binding||value.connection!==nativeConnection(ctx)||value.workspace!==record.row.id))throw fail('Stored allocation does not belong to this exact workspace/connection.');return value;
}
// Every state transition is a DB compare-and-set. A lost provider create response
// is recovered by exact owned source/plan, never by blindly creating another stack.
export async function ensureAllocation(ctx,record,{provider,config,manager=ensureProjectManager}={}){
 config??=dokployConfig(ctx.env);
 const refreshed=await refreshAdmission(ctx,config),admission=allocationAdmission(refreshed.env,config,(ctx.now??Date.now)());
 if(admission.allowed&&admission.observedAt!==null){const observed=JSON.parse(refreshed.env.PLAYGROUND_ADMISSION);config={...config,cpuCpus:Math.min(config.cpuCpus??8,observed.availableCpuCpus??config.cpuCpus??8),memoryBytes:Math.min(config.memoryBytes??8*1024**3,observed.availableMemoryBytes)};}
 provider??=dokployProvider(config,{fetch:ctx.fetch});
 const binding=playgroundBinding(record),key=allocationKey(binding);let plan=allocationPlan({binding,verificationKey:nativeWorkerPublicKey(ctx.env),idleTimeoutMs:record.job.idleTimeoutMs},{...config,scope:ctx.db.playgroundScope,worker:record.worker,nativeBinding:createHash('sha256').update(JSON.stringify(['authority','connection','owner','repo'].map(k=>record.binding[k]))).digest('hex')});
 let stored=await allocationRecord(ctx,record);providerScope(stored,config);
 if(stored?.plan?.providerAppName&&stored.planHash===plan.planHash)plan=stored.plan;
 if(stored&&stored.planHash!==plan.planHash){if(stored.providerOrigin!==config.origin||stored.providerProject!==config.project||stored.providerEnvironment!==config.environment)throw fail('Allocation provider scope changed; preserve the original resources.');if(!admission.allowed||stored.composeId||!['requested','waiting_resources'].includes(stored.phase))plan=stored.plan;}
 const save=async patch=>{const next=await ctx.db.compareAndSetSetting(key,stored?.revision??0,{...stored,...patch,revision:(stored?.revision??0)+1});if(!next)throw fail('Another allocation transition is in progress; inspect the existing state.');stored=next;await indexAllocation(ctx,stored);};
 if(!stored){await provider.project();await save({kind:'playground-allocation',scope:ctx.db.playgroundScope??{legacy:true},delegated:ctx.connection.pass===true,providerOrigin:config.origin,providerProject:config.project,providerEnvironment:config.environment,binding,connection:nativeConnection(ctx),clientId:ctx.connection.client_id??null,passId:ctx.connection.pass_id??null,workspace:record.row.id,owner:record.row.owner,repo:record.row.repo,phase:'requested',planHash:plan.planHash,plan,native:{binding:record.binding,worker:record.worker,job:record.job},createdAt:(ctx.now??Date.now)(),expiresAt:new Date(record.row.expires_at).getTime()});
 }
 await manager(ctx,config,provider);
 if(admission.allowed&&stored.planHash!==plan.planHash)await save({planHash:plan.planHash,plan});if(!admission.allowed){if(stored.phase==='requested'||stored.phase==='waiting_resources')await save({phase:'waiting_resources',admission});return stored;}
 if(stored.phase==='requested'||stored.phase==='waiting_resources'){await save({phase:'creating'});
  const a=await provider.create(plan);if(typeof a?.composeId!=='string'||!a.composeId)throw fail('Provider create was not confirmed. Inspect this same allocation intent.');plan=pinProviderIdentity(plan,a.appName);await save({composeId:a.composeId,phase:'created',plan});
 }else if(stored.phase==='creating'){
  const matches=(await provider.inventory()).filter(a=>a.name===plan.name||a.appName===plan.name);if(matches.length!==1)throw fail('Original create is uncertain. No replacement allocation was created.');const a=await provider.inspect(matches[0].composeId,plan,{adoptAssignedName:true});plan=pinProviderIdentity(plan,a.appName);await save({composeId:a.composeId,phase:'created',plan});
 }
 if(['cleanup_requested','stopped','deleting','disposed'].includes(stored.phase))return stored;
 if(!plan.providerAppName){const a=await provider.inspect(stored.composeId,plan,{adoptAssignedName:true});plan=pinProviderIdentity(plan,a?.appName);await save({plan});}
 await provider.inspect(stored.composeId,plan);
 if(stored.phase==='created'){await save({phase:'exposing'});await provider.expose(stored.composeId,plan);await save({phase:'exposed'});}
 if(stored.phase==='exposing'){const observed=await provider.inspect(stored.composeId,plan);if([['/','coding'],['/v1/workspace','broker']].every(([path,service])=>observed?.domains?.some(d=>d.host===plan.host&&d.port===3000&&d.https===true&&d.serviceName===service&&d.path===path)))await save({phase:'exposed'});}
 if(stored.phase==='exposing')throw fail('Ingress creation is uncertain. Inspect exact allocation domains before resuming; no duplicate domain was created.');
 if(stored.phase==='exposed'){await save({phase:'deploying'});await provider.deploy(stored.composeId,plan);}
 if(stored.phase==='deploying'){const a=await provider.inspect(stored.composeId,plan);if(a?.composeStatus==='done')await save({phase:'allocated',origin:plan.origin,repositoryAttached:false,enforcementVerified:false});}
 return stored;
}
export async function disposeAllocation(ctx,record,{provider,config}={}){
 let stored=await allocationRecord(ctx,record);if(!stored)return {disposed:true,allocationExisted:false};
 config??=dokployConfig(ctx.env);providerScope(stored,config);provider??=dokployProvider(config,{fetch:ctx.fetch});
 const key=allocationKey(stored.binding),plan=stored.plan;
 const save=async patch=>{const next=await ctx.db.compareAndSetSetting(key,stored.revision,{...stored,...patch,revision:stored.revision+1});if(!next)throw fail('Another allocation cleanup transition is in progress.');stored=next;await indexAllocation(ctx,stored);};
 if(stored.phase==='disposed')return stored;
 const absent=async()=>{try{return await provider.absent(stored.composeId,plan);}catch(error){if(error.safeCode!=='playground_provider_refused'||![401,403].includes(error.status)||!await cleanupEvidence(ctx,stored))throw error;return await provider.inspect(stored.composeId,plan)===null&&(await provider.containers(plan)).length===0;}};
 if(!stored.composeId&&['requested','waiting_resources'].includes(stored.phase)){await save({phase:'disposed',disposed:true,disposedAt:(ctx.now??Date.now)(),neverAllocated:true});return stored;}
 if(!stored.composeId)throw fail('Uncertain allocation creation requires exact provider recovery before disposal.');
 if(stored.phase!=='deleting'){
 await provider.inspect(stored.composeId,plan);await save({phase:'cleanup_requested'});await provider.stop(stored.composeId,plan);
 if(!allocationProcessesStopped(await provider.containers(plan)))return {...stored,disposed:false,next:'Whole-allocation termination is not confirmed; volume preserved.'};
 await save({phase:'stopped'});await save({phase:'deleting'});await provider.remove(stored.composeId,plan);
 }
 if(stored.phase==='deleting'&&!await absent()){const owned=await provider.inspect(stored.composeId,plan);if(owned&&allocationProcessesStopped(await provider.containers(plan)))await provider.remove(stored.composeId,plan);}
 if(!await absent())return {...stored,disposed:false,next:'Exact process/volume removal has not been independently confirmed.'};
 await save({phase:'disposed',disposed:true,disposedAt:(ctx.now??Date.now)()});return stored;
}

export async function inspectAllocation(ctx,record,{provider,config}={}){
 let stored=await allocationRecord(ctx,record);if(!stored)return {workspace_id:record.row.id,phase:'absent',allocation_ready:false};
 if(stored.phase==='disposed')return {workspace_id:record.row.id,phase:'disposed',disposed:true};
 config??=dokployConfig(ctx.env);providerScope(stored,config);provider??=dokployProvider(config,{fetch:ctx.fetch});
 if(!stored.composeId)return {workspace_id:record.row.id,phase:stored.phase,allocation_ready:false,next:'Recover the original provisioning intent; no replacement was created.'};
 const observed=await provider.inspect(stored.composeId,stored.plan);
 if(observed?.composeStatus==='done'&&stored.phase==='deploying'){
  const next=await ctx.db.compareAndSetSetting(allocationKey(stored.binding),stored.revision,{...stored,phase:'allocated',origin:stored.plan.origin,repositoryAttached:false,enforcementVerified:false,revision:stored.revision+1});if(next){stored=next;await indexAllocation(ctx,stored);}
 }
 return {workspace_id:record.row.id,phase:stored.phase,allocation_ready:['allocated','attaching','attached'].includes(stored.phase),repository_attached:stored.repositoryAttached===true,enforcement_verified:stored.enforcementVerified===true,execution_available:false,provider_observed:observed!==null,next:'Repository attachment and verified enforcement are required before commands.'};
}

export async function resumeAllocation(ctx,record,{provider,config}={}){ctx=await refreshAdmission(ctx,{project:ctx.env?.PLAYGROUND_DOKPLOY_PROJECT_ID});const stored=await allocationRecord(ctx,record);if(stored?.phase!=='attached'||!enforcementObservation(ctx,{row:record.row,allocation:{binding:stored.binding}})&&!managedResourceBaseline(ctx.env,stored,{workspace:record.row.id,binding:playgroundBinding(record)}))throw fail('An attached managed allocation or fresh verified controls are required before resume.');config??=dokployConfig(ctx.env);providerScope(stored,config);provider??=dokployProvider(config,{fetch:ctx.fetch});await provider.start(stored.composeId,stored.plan);return stored;}

export async function enqueueAllocation(ctx,record){
 const config=dokployConfig(ctx.env),binding=playgroundBinding(record),key=allocationKey(binding);
 const old=await allocationRecord(ctx,record);if(old)return old;
 const plan=allocationPlan({binding,verificationKey:nativeWorkerPublicKey(ctx.env),idleTimeoutMs:record.job.idleTimeoutMs},{...config,scope:ctx.db.playgroundScope,worker:record.worker,nativeBinding:createHash('sha256').update(JSON.stringify(['authority','connection','owner','repo'].map(k=>record.binding[k]))).digest('hex')});
 const row={revision:1,kind:'playground-allocation',scope:ctx.db.playgroundScope??{legacy:true},delegated:ctx.connection.pass===true,providerOrigin:config.origin,providerProject:config.project,providerEnvironment:config.environment,binding,connection:nativeConnection(ctx),clientId:ctx.connection.client_id??null,passId:ctx.connection.pass_id??null,workspace:record.row.id,owner:record.row.owner,repo:record.row.repo,phase:'requested',planHash:plan.planHash,plan,native:{binding:record.binding,worker:record.worker,job:record.job},createdAt:(ctx.now??Date.now)(),expiresAt:new Date(record.row.expires_at).getTime()};
 const saved=await ctx.db.compareAndSetSetting(key,0,row);if(!saved)return await allocationRecord(ctx,record);await indexAllocation(ctx,saved);return saved;
}
