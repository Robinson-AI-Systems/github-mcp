import {it,expect} from 'vitest';
import {allocationPlan} from '../../src/playground/compose-plan.js';
import {SIZE_CLASSES,resolveSizeClass,sizedConfig,defaultSizeClass} from '../../src/playground/sizing.js';
import * as nativeTools from '../../src/tools/native-git.js';
import * as playgroundTools from '../../src/tools/playground.js';
const services=plan=>JSON.parse(plan.composeFile).services;
const total=s=>Math.round(['broker','coding','ingress'].reduce((n,k)=>n+Number(s[k].cpus),0)*10)/10;

it('resolves classes, honours the protected default and never raises operator ceilings',()=>{
 expect(resolveSizeClass(undefined,{})).toBe('medium');expect(resolveSizeClass('auto',{PLAYGROUND_DEFAULT_SIZE:'small'})).toBe('small');
 expect(resolveSizeClass('none',{})).toBeNull();expect(resolveSizeClass('medium',{})).toBe('medium');
 expect(()=>resolveSizeClass('huge',{})).toThrow(/auto, none, small/);expect(()=>defaultSizeClass({PLAYGROUND_DEFAULT_SIZE:'xl'})).toThrow(/PLAYGROUND_DEFAULT_SIZE/);
 expect(sizedConfig({cpuCpus:8,memoryBytes:8*1024**3},'small')).toMatchObject({cpuCpus:2,memoryBytes:2*1024**3});
 expect(sizedConfig({cpuCpus:3,memoryBytes:3*1024**3},'large')).toMatchObject({cpuCpus:3,memoryBytes:3*1024**3});
 expect(sizedConfig({cpuCpus:8},undefined)).toEqual({cpuCpus:8});expect(()=>sizedConfig({},'giant')).toThrow(/unknown/);
 expect(Object.keys(SIZE_CLASSES)).toEqual(['small','medium','large']);
});
// DOKPLOY-RETIRE-1 (2026-11-17): sizing is checked on the plan itself; placing it on a paired computer is
// tests/unit/fleet-dial-out.test.js. The provisioning tests that drove a fake Dokploy server are gone.
const planFor=(sizeClass)=>allocationPlan({binding:'b'.repeat(64),verificationKey:'ed25519:fixture',idleTimeoutMs:14400000},
 {...sizedConfig({cpuCpus:8,memoryBytes:8*1024**3},sizeClass),image:'ghcr.io/example/runtime@sha256:'+'a'.repeat(64),worker:'git_'+'1'.repeat(32),nativeBinding:'2'.repeat(64),ingress:'127.0.0.1'});
it('a small plan fits the small ceiling as a whole',()=>{
 const s=services(planFor('small'));expect(total(s)).toBeLessThanOrEqual(2);
 expect(['broker','coding','ingress'].reduce((n,k)=>n+parseInt(s[k].mem_limit,10),0)).toBeLessThanOrEqual(2048);
});
it('caps swap at the memory limit for every service so an out-of-memory command is stopped, not swapped',()=>{
 for(const [name,svc] of Object.entries(services(planFor('medium'))))if(svc.mem_limit)expect([name,svc.memswap_limit]).toEqual([name,svc.mem_limit]);
});
it('keeps the original full-size plan for large',()=>{
 const s=services(planFor('large'));expect(s.coding.cpus).toBe('7.4');expect(s.coding.mem_limit).toBe('6528m');
});
it('the plan names no provider address: the placing computer gives it (DOKPLOY-RETIRE-1)',()=>{
 const p=planFor('small');expect(p.host).toBeNull();expect(p.origin).toBeNull();expect(p.composeFile).not.toMatch(/dokploy/i);
});
it('advertises the runtime choice on workspace open and the size on provision',()=>{
 const open=nativeTools.tools.find(t=>t.name==='github_git_workspace_open'),ws=playgroundTools.tools.find(t=>t.name==='github_playground_workspace');
 expect(open.inputSchema.properties.runtime.enum).toEqual(['auto','none','small','medium','large']);
 expect(ws.inputSchema.properties.size.enum).toEqual(['auto','small','medium','large']);
});
