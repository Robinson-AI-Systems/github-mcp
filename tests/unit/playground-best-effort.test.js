import {it,expect,afterEach} from 'vitest';
import {makeWorld,parse,doorsFor} from '../../test/helpers/write-contract.js';
import {preparePlaygroundWorld} from '../../test/helpers/playground-world.js';
import {allocationPlan} from '../../src/playground/dokploy.js';
import {playgroundRecord} from '../../src/playground/client.js';
import {allocationAdmission} from '../../src/playground/admission.js';
import {allocationAuthority} from '../../src/playground/lifecycle.js';
import {resumeAllocation} from '../../src/playground/allocations.js';
import {resourceMode,managedResourceBaseline} from '../../src/playground/resource-policy.js';
import {nativeWorkerPublicKey,signNativeWorkerBody} from '../../src/native-git/signing.js';
import * as tools from '../../src/tools/playground.js';
const base={owner:'example-org',repo:'hello',workspace_id:'job_0123456789abcdef'},closes=[];
afterEach(async()=>{for(const close of closes.splice(0))await close();});
async function world(){
 const w=await makeWorld({profile:'full',mode:'production',gates:[]});w.gh.when('GET /repos/{owner}/{repo}').reply(200,{full_name:'example-org/hello'});closes.push(await preparePlaygroundWorld(w));
 Object.assign(w.ctx.env,{PLAYGROUND_RESOURCE_MODE:'best_effort',PLAYGROUND_DOKPLOY_ORIGIN:'https://dokploy.example.test',PLAYGROUND_DOKPLOY_PROJECT_ID:'fixture',PLAYGROUND_DOKPLOY_ENVIRONMENT_ID:'fixture-env',PLAYGROUND_DOKPLOY_API_KEY:'FAKE_PROVIDER_KEY',PLAYGROUND_IMAGE:'ghcr.io/example/runtime@sha256:'+'a'.repeat(64),PLAYGROUND_INGRESS_IPV4:'107.90.116.157'});delete w.ctx.env.PLAYGROUND_ENFORCEMENT;
 const record=await playgroundRecord(w.ctx,base),binding=record.allocation.binding;
 const config={origin:w.ctx.env.PLAYGROUND_DOKPLOY_ORIGIN,project:'fixture',environment:'fixture-env',image:'fixture',ingress:'107.90.116.157',worker:record.worker,nativeBinding:'a'.repeat(64)};
 const plan=allocationPlan({binding,verificationKey:'ed25519:FAKE_PUBLIC',idleTimeoutMs:record.job.idleTimeoutMs},config),mounts={worktree:'fixture-worktree',git:'fixture-git',gitReadOnly:true};
 const stored={revision:1,phase:'attached',binding,workspace:record.row.id,connection:record.binding.connection,clientId:w.ctx.connection.client_id,owner:base.owner,repo:base.repo,providerOrigin:config.origin,providerProject:config.project,providerEnvironment:config.environment,plan,planHash:plan.planHash,origin:plan.origin,brokerOrigin:plan.origin,composeId:'fixture-compose',repositoryAttached:true,runtimePublicKey:nativeWorkerPublicKey(w.ctx.env),attachment:{mounts}};
 const key='playground.'+binding.slice(0,40);await w.db.setSetting(key,stored);
 delete w.ctx.env.PLAYGROUND_ALLOCATIONS;
 // Unit transport fixture: actual signed HTTP commands still use the existing
 // fake engine; capabilities model an independently attached container.
 const prior=w.ctx.fetch;w.cap={execution:'dedicated-container',providerCredentials:false,identity_key:stored.runtimePublicKey,repository:mounts,authority:{required:true,allowed:true}};
 w.converted=JSON.parse(plan.composeFile);
 w.ctx.fetch=async(url,init)=>{if(String(url).startsWith(config.origin+'/api/')){const op=new URL(url).pathname.split('/').pop();if(op==='compose.one')return Response.json({composeId:stored.composeId,name:plan.name,appName:plan.name,environmentId:config.environment,environment:{projectId:config.project},description:plan.description,composeFile:plan.composeFile,sourceType:'raw'});if(op==='compose.getConvertedCompose')return Response.json(w.converted);throw Error('Unexpected provider call');}if(String(url).startsWith(plan.origin+'/v1/workspace')){url=new URL('/v1/workspace',w.ctx.env.NATIVE_GIT_WORKER_URL).href;init={...init,headers:{...init.headers,'x-robinson-signature':signNativeWorkerBody(init.body,w.ctx.env)}};}if(String(url).startsWith(plan.origin+'/v1/coding'))url='https://playground.example.test/v1/coding';const response=await prior(url,init);if(String(url).startsWith('https://playground.example.test/')&&JSON.parse(init.body).action==='capabilities')return Response.json({...await response.json(),...w.cap});return response;};
 w.gh.fetch=w.ctx.fetch;
 return {w,stored,key,record,config};
}
const available=w=>tools.handlers.github_playground_read({...base,operation:'availability'},w.ctx);
it('attempts allocation without monitoring only under explicit protected best-effort policy; preserves known pressure and configured-feed failure',()=>{
 const now=Date.now(),config={project:'fixture'},env={PLAYGROUND_RESOURCE_MODE:'best_effort'};
 expect(resourceMode({})).toBe('verified');expect(()=>resourceMode({PLAYGROUND_RESOURCE_MODE:'caller_choice'})).toThrow();
 expect(allocationAdmission(env,config,now)).toMatchObject({allowed:true,reason:'capacity_unknown_best_effort',capacityVerified:false,reservation:false});
 expect(allocationAdmission({...env,PLAYGROUND_TELEMETRY_URL:'https://offline.example.test'},config,now).allowed).toBe(false);
 expect(allocationAdmission({...env,PLAYGROUND_ADMISSION:JSON.stringify({project:'fixture',observedAt:now,availableMemoryBytes:1,availableDiskBytes:2*1024**3,pressure:0})},config,now)).toMatchObject({allowed:false,reason:'memory_pressure'});
});
it('executes and replays through every public door without quota/monitoring evidence, with honest unknown limits',async()=>{
 const definition={tool:tools.tools.find(t=>t.name==='github_playground_execute'),handler:tools.handlers.github_playground_execute};
 for(const door of doorsFor(definition)){
  const {w}=await world();w.playgroundCapacity={cpu:{cgroupQuotaCpus:null},memory:{cgroupLimitBytes:null}};
  expect(await available(w)).toMatchObject({mode:'best_effort',execution_available:true,limits:{cpuCpus:null,memoryBytes:null,storageQuotaBytes:null},enforcement:{resourceGuarantees:false,storageQuotaVerified:false,hostMonitoringAvailable:false}});
  const args={...base,argv:['true'],requestKey:'best-effort'},first=parse(await door.call(w,args));expect(first.status,JSON.stringify(first)).toBe('applied');expect(parse(await door.call(w,args)).status).toBe('replayed');expect(w.playground.starts()).toBe(1);
 }
});
it('does not turn URL-only, foreign, tampered, unattached or unsupported-network allocations into command authority',async()=>{
 const {w,stored,key}=await world();
 for(const patch of [{connection:'foreign'},{workspace:'job_ffffffffffffffff'},{binding:'f'.repeat(64)},{phase:'attaching'},{repositoryAttached:false},{providerProject:'foreign'},{providerEnvironment:'foreign'},{providerOrigin:'https://foreign.example.test'},{origin:'https://foreign.example.test'},{plan:{...stored.plan,isolationProfile:undefined}},{plan:{...stored.plan,composeFile:'{}'}},{runtimePublicKey:null},{attachment:{mounts:{...stored.attachment.mounts,gitReadOnly:false}}}]){
  await w.db.setSetting(key,{...stored,...patch});let denied=false;try{denied=(await available(w)).execution_available===false;}catch{denied=true;}expect(denied).toBe(true);
 }
 await w.db.setSetting(key,null);expect((await available(w)).execution_available).toBe(false);expect(w.playground.starts()).toBe(0);
});
it('requires the actual pinned runtime identity, read-only shared Git mount and current authority',async()=>{
 const {w}=await world(),cap=w.cap;
 for(const patch of [{identity_key:'ed25519:OTHER'},{repository:{...cap.repository,gitReadOnly:false}},{repository:{...cap.repository,worktree:'other'}},{authority:{required:false,allowed:true}},{authority:{required:true,allowed:false}},{providerCredentials:true},{execution:'shared-worker'}]){w.cap={...cap,...patch};expect((await available(w)).execution_available).toBe(false);}
 w.cap=cap;w.ctx.env.PLAYGROUND_TELEMETRY_URL='https://offline.example.test';expect((await available(w)).execution_available).toBe(false);expect(w.playground.starts()).toBe(0);
});
it('keeps grant revocation, repository authorization, expiry and exact provider ownership binding in best-effort lifecycle/resume',async()=>{
 const {w,stored,record,config}=await world(),ctx={...w.ctx,stored,db:{...w.db,listUpgradeableConnections:async()=>[{client_id:stored.clientId,profile:'full',accounts:[base.owner],mode:'production'}]}};
 expect(managedResourceBaseline(ctx.env,stored,{workspace:stored.workspace,binding:stored.binding})).not.toBeNull();
 expect(await allocationAuthority(ctx)).toMatchObject({allowed:true,reason:'current_grant'});
 expect(await allocationAuthority({...ctx,membershipValid:false})).toMatchObject({allowed:false,cleanup:true});
 expect(await allocationAuthority({...ctx,db:{...ctx.db,listUpgradeableConnections:async()=>[]}})).toMatchObject({allowed:false,cleanup:true,reason:'grant_expired_or_revoked'});
 expect(await allocationAuthority({...ctx,db:{...ctx.db,getJob:async()=>null}})).toMatchObject({allowed:false,cleanup:true,reason:'workspace_expired_or_closed'});
 let starts=0;const provider={start:async(id,plan)=>{expect(id).toBe(stored.composeId);expect(plan).toEqual(stored.plan);starts++;}};
 await resumeAllocation(ctx,record,{provider,config});expect(starts).toBe(1);
 await expect(resumeAllocation(ctx,record,{provider,config:{...config,project:'foreign'}})).rejects.toThrow(/scope changed/);expect(starts).toBe(1);
});
it('refuses provider-added shared ingress networks at every execution door before sending any command',async()=>{
 const definition={tool:tools.tools.find(t=>t.name==='github_playground_execute'),handler:tools.handlers.github_playground_execute};
 for(const door of doorsFor(definition)){
  const {w}=await world();w.converted.services.coding.networks.push('dokploy-network','default');
  expect(await available(w)).toMatchObject({execution_available:false,reason:'network_isolation_unverified'});
  expect(parse(await door.call(w,{...base,argv:['true'],requestKey:'unsafe-ingress'}))).toMatchObject({done:false,no_change_sent:true,reason_code:'network_isolation_unverified'});expect(w.playground.starts()).toBe(0);expect(w.playgroundRequests).toHaveLength(0);
 }
});
it('does not infer private isolation from unsupported YAML, missing readback or default/host/public network configuration',async()=>{
 const {w}=await world(),original=structuredClone(w.converted);
 for(const value of ['services:\n  coding:\n    networks: [workspace, dokploy-network]\n',null,{}, {...original,networks:{workspace:{...original.networks.workspace,internal:false}}},{...original,services:{...original.services,coding:{...original.services.coding,network_mode:'host'}}}]){w.converted=value;expect((await available(w)).execution_available).toBe(false);}
 w.converted=JSON.stringify(original);expect((await available(w)).execution_available).toBe(true);
});
