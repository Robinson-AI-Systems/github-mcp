import {it,expect,afterEach} from 'vitest';
import {makeWorld,parse,doorsFor} from '../../test/helpers/write-contract.js';
import {preparePlaygroundWorld} from '../../test/helpers/playground-world.js';
import * as tools from '../../src/tools/playground.js';
import {enforcementObservation,playgroundAvailability} from '../../src/playground/availability.js';
import {playgroundRecord} from '../../src/playground/client.js';
const base={owner:'example-org',repo:'hello',workspace_id:'job_0123456789abcdef'};
const closes=[];afterEach(async()=>{for(const close of closes.splice(0))await close();});
async function world(){const w=await makeWorld({profile:'full',mode:'production',gates:[]});w.gh.when('GET /repos/{owner}/{repo}').reply(200,{full_name:'example-org/hello'});closes.push(await preparePlaygroundWorld(w));return w;}
const read=(w)=>tools.handlers.github_playground_read({...base,operation:'availability'},w.ctx);
it('keeps Git-only operation available without an allocation or verified enforcement, with no runtime send',async()=>{
 const w=await world();delete w.ctx.env.PLAYGROUND_ALLOCATIONS;
 expect(await read(w)).toMatchObject({mode:'git_only',reason:'runtime_unattached',execution_available:false,background_retry_scheduled:false,fallback:{automatic:false}});expect(w.playgroundRequests).toHaveLength(0);
 const result=parse(await tools.handlers.github_playground_execute({...base,argv:['true'],requestKey:'later'},w.ctx));expect(result).toMatchObject({done:false,no_change_sent:true,reason_code:'runtime_unattached'});expect(w.playgroundRequests).toHaveLength(0);
});
it('requires matching fresh protected observations for every execution door and recovers with the same intent',async()=>{
 const definition={tool:tools.tools.find(t=>t.name==='github_playground_execute'),handler:tools.handlers.github_playground_execute};
 for(const door of doorsFor(definition)){
  const w=await world(),prior=w.ctx.env.PLAYGROUND_ENFORCEMENT,args={...base,argv:['true'],requestKey:'same-on-recovery'};delete w.ctx.env.PLAYGROUND_ENFORCEMENT;
  const denied=parse(await door.call(w,args));expect(denied).toMatchObject({done:false,no_change_sent:true,retryable:false,reason_code:'enforcement_unverified'});expect(w.playground.starts()).toBe(0);expect(w.playgroundRequests).toHaveLength(0);
  w.ctx.env.PLAYGROUND_ENFORCEMENT=prior;const accepted=parse(await door.call(w,args));expect(accepted.status).toBe('applied');expect(w.playground.starts()).toBe(1);
 }
});
it('rejects stale/wrong/unverified/excessive evidence and caller arguments cannot provide enforcement',async()=>{
 const w=await world(),r=await playgroundRecord(w.ctx,base),original=JSON.parse(w.ctx.env.PLAYGROUND_ENFORCEMENT)[0];
 for(const patch of [{binding:'b'.repeat(64)},{observedAt:w.ctx.now()+1},{expiresAt:w.ctx.now()},{expiresAt:w.ctx.now()+14400001},{isolation:false},{termination:false},{repositoryAttached:false},{cpuCpus:9},{memoryBytes:9*1024**3},{storageQuotaBytes:151*1000**3},{storageQuotaBytes:0},{extra:true}]){
  w.ctx.env.PLAYGROUND_ENFORCEMENT=JSON.stringify([{...original,...patch}]);expect(enforcementObservation(w.ctx,r)).toBeNull();expect((await read(w)).execution_available).toBe(false);
 }
 w.ctx.env.PLAYGROUND_ENFORCEMENT=JSON.stringify([original,original]);expect(enforcementObservation(w.ctx,r)).toBeNull();
});
it('uses smaller enforced CPU/memory in constrained mode without promising reservations or upgrading plans',async()=>{
 const w=await world();w.playgroundCapacity={cpu:{cgroupQuotaCpus:2},memory:{cgroupLimitBytes:2*1024**3}};
 expect(await read(w)).toMatchObject({mode:'constrained',execution_available:true,resource_reservation:false,availability_guaranteed:false,limits:{cpuCpus:2,memoryBytes:2*1024**3},fallback:{automatic:false}});
 for(const capacity of [{cpu:{cgroupQuotaCpus:null},memory:{cgroupLimitBytes:1024}},{cpu:{cgroupQuotaCpus:9},memory:{cgroupLimitBytes:1024}},{cpu:{cgroupQuotaCpus:2},memory:{cgroupLimitBytes:null}}]){w.playgroundCapacity=capacity;expect(await read(w)).toMatchObject({mode:'git_only',reason:'runtime_limits_unconfirmed',execution_available:false});}
});
it('reports recovery on transport loss without starting or rerouting work, and propagates real authorization failures',async()=>{
 const w=await world(),record=await playgroundRecord(w.ctx,base);
 expect(await playgroundAvailability(w.ctx,record,async()=>{throw {safeCode:'playground_transport'};})).toMatchObject({mode:'recovery',retryable:true,execution_available:false,background_retry_scheduled:false});
 await expect(playgroundAvailability(w.ctx,record,async()=>{throw new TypeError('permission denied');})).rejects.toThrow('permission denied');expect(w.playground.starts()).toBe(0);
});
