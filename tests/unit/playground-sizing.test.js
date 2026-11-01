import {it,expect,afterEach} from 'vitest';
import {makeWorld} from '../../test/helpers/write-contract.js';
import {preparePlaygroundWorld} from '../../test/helpers/playground-world.js';
import {playgroundRecord} from '../../src/playground/client.js';
import {ensureAllocation,inspectAllocation} from '../../src/playground/allocations.js';
import {SIZE_CLASSES,resolveSizeClass,sizedConfig,defaultSizeClass} from '../../src/playground/sizing.js';
import * as nativeTools from '../../src/tools/native-git.js';
import * as playgroundTools from '../../src/tools/playground.js';
const base={owner:'example-org',repo:'hello',workspace_id:'job_0123456789abcdef'};
const cleanups=[];afterEach(async()=>{for(const close of cleanups.splice(0))await close();});
const config={origin:'https://dokploy.example.test',key:'FAKE_PROVIDER_KEY',project:'fixture-project',environment:'fixture-environment',image:'ghcr.io/example/runtime@sha256:'+'a'.repeat(64),ingress:'107.90.116.157',worker:'git_'+'1'.repeat(32),nativeBinding:'2'.repeat(64)};
async function world(env={}){const w=await makeWorld({profile:'full',mode:'production',gates:[]});w.gh.when('GET /repos/{owner}/{repo}').reply(200,{full_name:'example-org/hello'});cleanups.push(await preparePlaygroundWorld(w));Object.assign(w.ctx.env,{PLAYGROUND_ADMISSION:JSON.stringify({project:config.project,observedAt:w.ctx.now(),availableMemoryBytes:8*1024**3,availableDiskBytes:10*1024**3,pressure:0})},env);return {w,record:await playgroundRecord(w.ctx,base)};}
function provider(){const rows=new Map(),creates=[];return {creates,project:async()=>({}),inventory:async()=>[...rows.values()],async create(plan){creates.push(plan);const row={composeId:'owned-'+creates.length,appName:plan.name,plan,composeStatus:'idle'};rows.set(row.composeId,row);return row;},async inspect(id){return rows.get(id)??null;},async expose(){},async deploy(id){rows.get(id).composeStatus='done';}};}
const services=plan=>JSON.parse(plan.composeFile).services;
const total=s=>Math.round(['broker','coding','ingress'].reduce((n,k)=>n+Number(s[k].cpus),0)*10)/10;

it('resolves classes, honours the protected default and never raises operator ceilings',()=>{
 expect(resolveSizeClass(undefined,{})).toBe('large');expect(resolveSizeClass('auto',{PLAYGROUND_DEFAULT_SIZE:'small'})).toBe('small');
 expect(resolveSizeClass('none',{})).toBeNull();expect(resolveSizeClass('medium',{})).toBe('medium');
 expect(()=>resolveSizeClass('huge',{})).toThrow(/auto, none, small/);expect(()=>defaultSizeClass({PLAYGROUND_DEFAULT_SIZE:'xl'})).toThrow(/PLAYGROUND_DEFAULT_SIZE/);
 expect(sizedConfig({cpuCpus:8,memoryBytes:8*1024**3},'small')).toMatchObject({cpuCpus:2,memoryBytes:2*1024**3});
 expect(sizedConfig({cpuCpus:3,memoryBytes:3*1024**3},'large')).toMatchObject({cpuCpus:3,memoryBytes:3*1024**3});
 expect(sizedConfig({cpuCpus:8},undefined)).toEqual({cpuCpus:8});expect(()=>sizedConfig({},'giant')).toThrow(/unknown/);
 expect(Object.keys(SIZE_CLASSES)).toEqual(['small','medium','large']);
});
it('provisions a small allocation whose whole compose fits the small ceiling and records the class',async()=>{
 const {w,record}=await world(),p=provider();
 const row=await ensureAllocation(w.ctx,record,{provider:p,config,manager:async()=>{},size:'small'});
 expect(row.size).toBe('small');expect(row.phase).toBe('allocated');
 const s=services(p.creates[0]);expect(total(s)).toBeLessThanOrEqual(2);expect(s.coding.mem_limit).toBe('1408m');expect(p.creates[0].enforcement.memoryConfiguredBytes).toBe(2*1024**3);
 const observed=await inspectAllocation(w.ctx,record,{provider:p,config});expect(observed.runtime_size).toMatchObject({size_class:'small',ceiling:{cpuCpus:2,memoryBytes:2*1024**3}});
});
it('keeps an existing allocation at its recorded size even when a later call asks for another size',async()=>{
 const {w,record}=await world(),p=provider();
 await ensureAllocation(w.ctx,record,{provider:p,config,manager:async()=>{},size:'medium'});
 const again=await ensureAllocation(w.ctx,record,{provider:p,config,manager:async()=>{},size:'large'});
 expect(again.size).toBe('medium');expect(p.creates).toHaveLength(1);expect(services(again.plan).coding.mem_limit).toBe(String(4096-1024-128)+'m');
});
it('leaves the default (no size, no protected default) identical to the original full-size plan',async()=>{
 const {w,record}=await world(),p=provider();
 const row=await ensureAllocation(w.ctx,record,{provider:p,config,manager:async()=>{}});
 expect(row.size).toBe('large');const s=services(row.plan);expect(s.coding.cpus).toBe('7.4');expect(s.coding.mem_limit).toBe('6528m');
});
it('refuses to provision a new allocation for size none before any provider call',async()=>{
 const {w,record}=await world(),p=provider();
 await expect(ensureAllocation(w.ctx,record,{provider:p,config,manager:async()=>{},size:'none'})).rejects.toThrow(/none/);expect(p.creates).toHaveLength(0);
});
it('advertises the runtime choice on workspace open and the size on provision',()=>{
 const open=nativeTools.tools.find(t=>t.name==='github_git_workspace_open'),ws=playgroundTools.tools.find(t=>t.name==='github_playground_workspace');
 expect(open.inputSchema.properties.runtime.enum).toEqual(['auto','none','small','medium','large']);
 expect(ws.inputSchema.properties.size.enum).toEqual(['auto','small','medium','large']);
});
