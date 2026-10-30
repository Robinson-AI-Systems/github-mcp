import {generateKeyPairSync,sign} from 'node:crypto';
import {it,expect,afterEach} from 'vitest';
import {makeWorld,parse} from '../../test/helpers/write-contract.js';
import {preparePlaygroundWorld} from '../../test/helpers/playground-world.js';
import {playgroundRecord,playgroundBinding} from '../../src/playground/client.js';
import {allocationPlan,dokployConfig,dokployProvider} from '../../src/playground/dokploy.js';
import {ensureAllocation,disposeAllocation,allocationRecord,inspectAllocation} from '../../src/playground/allocations.js';
import * as tools from '../../src/tools/playground.js';
const base={owner:'example-org',repo:'hello',workspace_id:'job_0123456789abcdef'};
const cleanups=[];afterEach(async()=>{for(const close of cleanups.splice(0))await close();});
const config={origin:'https://dokploy.example.test',key:'FAKE_PROVIDER_KEY',project:'fixture-project',environment:'fixture-environment',image:'ghcr.io/example/runtime@sha256:'+'a'.repeat(64),ingress:'107.90.116.157',worker:'git_'+'1'.repeat(32),nativeBinding:'2'.repeat(64)};
async function world(){const w=await makeWorld({profile:'full',mode:'production',gates:[]});w.gh.when('GET /repos/{owner}/{repo}').reply(200,{full_name:'example-org/hello'});cleanups.push(await preparePlaygroundWorld(w));w.ctx.env.PLAYGROUND_ADMISSION=JSON.stringify({project:config.project,observedAt:w.ctx.now(),availableMemoryBytes:8*1024**3,availableDiskBytes:10*1024**3,pressure:0});return {w,record:await playgroundRecord(w.ctx,base)};}
function fixtureProvider({lostCreate=false,remaining=false}={}){
 const calls=[],rows=new Map();let volume=false,stopped=false;
 return {calls,rows,project:async()=>({}),inventory:async()=>[...rows.values()],
  async create(plan){calls.push('create');const row={composeId:'owned-compose',appName:plan.name,plan,composeStatus:'idle'};rows.set(row.composeId,row);volume=true;if(lostCreate)throw TypeError('lost response');return row;},
  async inspect(id,plan){const row=rows.get(id);if(row&&row.plan.planHash!==plan.planHash)throw TypeError('ownership');return row??null;},
  async expose(){calls.push('expose');},async deploy(id){calls.push('deploy');rows.get(id).composeStatus='done';},
  async stop(){calls.push('stop');stopped=true;},async containers(){return remaining||!stopped?[{Id:'owned-container'}]:[];},
  async remove(id){calls.push('remove');rows.delete(id);volume=false;},async absent(id){return !rows.has(id)&&!volume&&stopped;}
 };
}
it('plans a uniquely owned constrained allocation without credentials, public app ports or quota claims',()=>{
 const p=allocationPlan({binding:'b'.repeat(64),verificationKey:'ed25519:FAKE_PUBLIC',idleTimeoutMs:14400000},config),body=JSON.parse(p.composeFile);
 expect(body.services.coding).toMatchObject({read_only:true,cpus:'7.5',mem_limit:'6656m',cap_drop:['ALL'],networks:['workspace']});expect(body.services.coding).not.toHaveProperty('ports');expect(body.networks.workspace.internal).toBe(true);expect(body.volumes.files.name).toBe(p.volume+'-files');expect(p.enforcement).toMatchObject({storageQuotaVerified:false,networkIsolationVerified:false,executionEnabled:false});expect(JSON.stringify(p)).not.toContain(config.key);expect(p.origin).toContain('107-90-116-157.sslip.io');
});
it('uses pinned REST method/query/body and refuses foreign source before any deploy/delete',async()=>{
 const sent=[];const p=allocationPlan({binding:'b'.repeat(64),verificationKey:'ed25519:FAKE_PUBLIC',idleTimeoutMs:14400000},config);
 let foreign=false;const fetch=async(url,init)=>{sent.push({url:new URL(url),init});const operation=new URL(url).pathname.split('/').pop();if(operation==='project.one')return Response.json({projectId:config.project,environments:[{environmentId:config.environment,compose:[]}]});if(operation==='compose.create')return Response.json({composeId:'owned'});if(operation==='compose.one')return Response.json({composeId:'owned',name:p.name,environmentId:config.environment,environment:{projectId:config.project},appName:p.name,description:foreign?'FOREIGN':p.description,composeFile:p.composeFile,sourceType:'raw'});throw Error('unintended call');};
 const provider=dokployProvider(config,{fetch});await provider.create(p);expect(sent[0].url.searchParams.get('projectId')).toBe(config.project);expect(sent[0].init.method).toBe('GET');expect(JSON.parse(sent[1].init.body)).toMatchObject({environmentId:config.environment,sourceType:'raw',composeType:'docker-compose',composeFile:p.composeFile});expect(sent[1].init.headers['x-api-key']).toBe(config.key);foreign=true;await expect(provider.deploy('owned',p)).rejects.toThrow(/ownership/);expect(sent).toHaveLength(4);
});
it('provisions once, reads back allocation, and deletes only after whole-container and volume absence',async()=>{
 const {w,record}=await world(),provider=fixtureProvider();const first=await ensureAllocation(w.ctx,record,{provider,config,manager:async()=>{}});expect(first.phase).toBe('allocated');expect(first.repositoryAttached).toBe(false);expect((await ensureAllocation(w.ctx,record,{provider,config,manager:async()=>{}})).composeId).toBe(first.composeId);expect(provider.calls.filter(x=>x==='create')).toHaveLength(1);
 expect(await inspectAllocation(w.ctx,record,{provider,config,manager:async()=>{}})).toMatchObject({phase:'allocated',execution_available:false,repository_attached:false});const gone=await disposeAllocation(w.ctx,record,{provider,config,manager:async()=>{}});expect(gone).toMatchObject({phase:'disposed',disposed:true});expect(provider.calls).toEqual(['create','expose','deploy','stop','remove']);expect((await allocationRecord(w.ctx,record)).binding).toBe(playgroundBinding(record));
});
it('recovers a lost create response from exact owned inventory without another create',async()=>{
 const {w,record}=await world(),provider=fixtureProvider({lostCreate:true});await expect(ensureAllocation(w.ctx,record,{provider,config,manager:async()=>{}})).rejects.toThrow('lost response');const recovered=await ensureAllocation(w.ctx,record,{provider,config,manager:async()=>{}});expect(recovered.phase).toBe('allocated');expect(provider.calls.filter(x=>x==='create')).toHaveLength(1);
});
it('refuses concurrent allocation claims and preserves volumes while any owned container remains',async()=>{
 const {w,record}=await world(),provider=fixtureProvider({remaining:true});const results=await Promise.allSettled([ensureAllocation(w.ctx,record,{provider,config,manager:async()=>{}}),ensureAllocation(w.ctx,record,{provider,config,manager:async()=>{}})]);expect(results.some(x=>x.status==='fulfilled')).toBe(true);expect(provider.calls.filter(x=>x==='create')).toHaveLength(1);const pending=await disposeAllocation(w.ctx,record,{provider,config,manager:async()=>{}});expect(pending.disposed).toBe(false);expect(provider.calls).not.toContain('remove');
});
it('keeps provider configuration protected and missing allocation setup produces no provider write',async()=>{
 expect(()=>dokployConfig({})).toThrow(/protected/);const {w}=await world();const result=parse(await tools.handlers.github_playground_workspace({...base,operation:'provision',requestKey:'setup-missing'},w.ctx));expect(result.done).toBe(false);expect(w.playgroundRequests).toHaveLength(0);
});

it('starts the trusted manager even while resource admission queues the first workspace',async()=>{
 const {w,record}=await world(),provider=fixtureProvider();delete w.ctx.env.PLAYGROUND_ADMISSION;let managers=0;
 const result=await ensureAllocation(w.ctx,record,{provider,config,manager:async()=>{managers++;}});
 expect(result.phase).toBe('waiting_resources');expect(managers).toBe(1);expect(provider.calls).not.toContain('create');
});
it('creates an owned private allocation without host telemetry when explicitly configured best effort',async()=>{
 const {w,record}=await world(),provider=fixtureProvider();delete w.ctx.env.PLAYGROUND_ADMISSION;w.ctx.env.PLAYGROUND_RESOURCE_MODE='best_effort';
 const result=await ensureAllocation(w.ctx,record,{provider,config,manager:async()=>{}});
 expect(result.phase).toBe('allocated');expect(result.plan.isolationProfile).toBe('dedicated-internal-v1');expect(result.enforcementVerified).toBe(false);expect(provider.calls.filter(x=>x==='create')).toHaveLength(1);
});
it('does not accept a recovered ingress with the private Git broker route missing',async()=>{
 const {w,record}=await world(),provider=fixtureProvider();await ensureAllocation(w.ctx,record,{provider,config,manager:async()=>{}});
 const old=await allocationRecord(w.ctx,record),key='playground.'+old.binding.slice(0,40);
 await w.ctx.db.compareAndSetSetting(key,old.revision,{...old,revision:old.revision+1,phase:'exposing'});
 const row=provider.rows.get(old.composeId);row.domains=[{host:old.plan.host,port:3000,https:true,serviceName:'coding',path:'/'}];
 await expect(ensureAllocation(w.ctx,record,{provider,config,manager:async()=>{}})).rejects.toThrow(/Ingress/);
 row.domains.push({host:old.plan.host,port:3000,https:true,serviceName:'broker',path:'/v1/workspace'});
 expect((await ensureAllocation(w.ctx,record,{provider,config,manager:async()=>{}})).phase).toBe('allocated');
});
it('recovers a lost delete response by absence readback without requiring the deleted Compose to exist',async()=>{
 const {w,record}=await world(),provider=fixtureProvider();await ensureAllocation(w.ctx,record,{provider,config,manager:async()=>{}});
 const remove=provider.remove;let lost=true;provider.remove=async(...args)=>{await remove(...args);if(lost){lost=false;throw Error('lost delete response');}};
 await expect(disposeAllocation(w.ctx,record,{provider,config})).rejects.toThrow('lost delete response');
 expect((await disposeAllocation(w.ctx,record,{provider,config})).disposed).toBe(true);
 expect(provider.calls.filter(x=>x==='remove')).toHaveLength(1);
});
it('disposes a resource-queued intent without inventing a provider allocation',async()=>{
 const {w,record}=await world(),provider=fixtureProvider();delete w.ctx.env.PLAYGROUND_ADMISSION;
 await ensureAllocation(w.ctx,record,{provider,config,manager:async()=>{}});
 expect(await disposeAllocation(w.ctx,record,{provider,config})).toMatchObject({disposed:true,neverAllocated:true});expect(provider.calls).toEqual([]);
});
it('supports an exact operator-owned quota group and isolated egress driver without claiming their enforcement',()=>{
 const binding='b'.repeat(64),p=allocationPlan({binding,verificationKey:'ed25519:FAKE_PUBLIC',idleTimeoutMs:14400000},{...config,storageDriver:{name:'fixture-quota',options:{group:'{binding}',role:'{volume}'}},networkDriver:{name:'fixture-isolated',options:{tenant:'{binding}'}}}),body=JSON.parse(p.composeFile);
 expect(body.volumes.files.driver_opts).toEqual({group:binding,role:'files'});expect(body.volumes.git.driver_opts.group).toBe(binding);expect(body.networks.workspace.driver_opts.tenant).toBe(binding);expect(body.networks.workspace.internal).toBe(false);expect(p.enforcement.storageQuotaVerified).toBe(false);expect(p.enforcement.executionEnabled).toBe(false);
});
it('plans a genuinely smaller enforced aggregate allocation without weakening runtime controls',()=>{
 const p=allocationPlan({binding:'b'.repeat(64),verificationKey:'ed25519:FAKE_PUBLIC',idleTimeoutMs:14400000},{...config,cpuCpus:2,memoryBytes:2*1024**3}),body=JSON.parse(p.composeFile);
 expect(body.services.coding.cpus).toBe('1.5');expect(body.services.broker.cpus).toBe('0.5');expect(body.services.coding.mem_limit).toBe('1536m');expect(body.services.broker.mem_limit).toBe('512m');expect(body.services.coding.cap_drop).toEqual(['ALL']);expect(p.enforcement.memoryConfiguredBytes).toBe(2*1024**3);
});
it('selects smaller ceilings from fresh host headroom before creating a queued allocation',async()=>{
 const {w,record}=await world(),provider=fixtureProvider();delete w.ctx.env.PLAYGROUND_ADMISSION;
 await ensureAllocation(w.ctx,record,{provider,config,manager:async()=>{}});
 w.ctx.env.PLAYGROUND_ADMISSION=JSON.stringify({project:config.project,observedAt:w.ctx.now(),availableCpuCpus:2,availableMemoryBytes:2*1024**3,availableDiskBytes:2*1024**3,pressure:0});
 const result=await ensureAllocation(w.ctx,record,{provider,config,manager:async()=>{}});expect(result.phase).toBe('allocated');const plan=JSON.parse(result.plan.composeFile);expect(plan.services.coding.cpus).toBe('1.5');expect(plan.services.coding.mem_limit).toBe('1536m');expect(provider.calls.filter(x=>x==='create')).toHaveLength(1);
});

it('uses scoped independent cleanup proof when host volume inspection is forbidden, never delete success alone',async()=>{
 const {w,record}=await world(),provider=fixtureProvider();const original=await ensureAllocation(w.ctx,record,{provider,config,manager:async()=>{}});
 provider.absent=async()=>{throw Object.assign(Error('volume inspection forbidden'),{safeCode:'playground_provider_refused',status:401});};
 await expect(disposeAllocation(w.ctx,record,{provider,config})).rejects.toThrow('volume inspection forbidden');expect((await allocationRecord(w.ctx,record)).phase).toBe('deleting');
 const {privateKey,publicKey}=generateKeyPairSync('ed25519');let valid=false;
 w.ctx.env.PLAYGROUND_TELEMETRY_URL='https://operator.example.test/observations';w.ctx.env.PLAYGROUND_TELEMETRY_PUBLIC_KEY='ed25519:'+publicKey.export({format:'der',type:'spki'}).toString('base64');
 w.ctx.fetch=async()=>{const body=JSON.stringify({purpose:'robinson-playground-capacity/v1',project:config.project,observedAt:w.ctx.now(),allocations:[{workspace_id:record.row.id,binding:original.binding,observedAt:w.ctx.now(),expiresAt:w.ctx.now()+60000,cleanup:{composeId:original.composeId,composeAbsent:true,containersAbsent:true,volumesAbsent:valid?original.plan.volumes:original.plan.volumes.slice(1)}}]});return new Response(body,{headers:{'x-robinson-telemetry-signature':'ed25519:'+sign(null,Buffer.from(body),privateKey).toString('base64url')}});};
 await expect(disposeAllocation(w.ctx,record,{provider,config})).rejects.toThrow('volume inspection forbidden');valid=true;
 expect((await disposeAllocation(w.ctx,record,{provider,config})).disposed).toBe(true);expect(provider.calls.filter(x=>x==='remove')).toHaveLength(1);
});
it('refuses provider project changes before disposal even when the caller retains the original plan',async()=>{
 const {w,record}=await world(),provider=fixtureProvider();await ensureAllocation(w.ctx,record,{provider,config,manager:async()=>{}});const before=[...provider.calls];
 await expect(disposeAllocation(w.ctx,record,{provider,config:{...config,project:'foreign'}})).rejects.toThrow(/scope changed/);expect(provider.calls).toEqual(before);
 await expect(ensureAllocation(w.ctx,record,{provider,config:{...config,project:'foreign'},manager:async()=>{}})).rejects.toThrow(/scope changed/);expect(provider.calls).toEqual(before);
});
