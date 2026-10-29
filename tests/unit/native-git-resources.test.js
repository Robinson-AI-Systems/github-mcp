import {it,expect} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createResourceMonitor,resourcePolicyFromEnv,RESOURCE_DEFAULTS} from '../../workers/native-git/resources.js';
const MiB=1024*1024;
const histogram=()=>({percentile:()=>0,enable(){},disable(){},reset(){}});
it('samples actual process memory and a real filesystem without inventing a request count',async()=>{
 const root=await mkdtemp(join(tmpdir(),'native-resource-'));const monitor=createResourceMonitor({root,delay:histogram(),policy:{minMemoryBytes:1,minDiskBytes:1}});
 try{expect(await monitor.check()).toEqual({allowed:true});expect(monitor.body(100).allowed).toBe(true);expect(monitor.policy).not.toHaveProperty('maxConcurrent');}finally{monitor.close();await rm(root,{recursive:true,force:true});}
});
it('names memory, disk and responsiveness pressure and recovers from fresh measurements',async()=>{
 let memory=128*MiB,free=128*MiB,lag=0;
 const monitor=createResourceMonitor({root:'/data',memory:()=>memory,filesystem:async()=>({bavail:free,bsize:1}),delay:{...histogram(),percentile:()=>lag*1e6}});
 try{
  expect((await monitor.check()).allowed).toBe(true);
  memory=16*MiB;expect((await monitor.check()).reason).toBe('memory_pressure');expect(monitor.body(100).allowed).toBe(true);
  memory=128*MiB;free=1024;expect((await monitor.check()).reason).toBe('storage_pressure');expect((await monitor.check({needsDisk:false})).allowed).toBe(true);
  free=128*MiB;lag=500;expect((await monitor.check()).reason).toBe('worker_responsiveness_pressure');
  lag=0;expect((await monitor.check()).allowed).toBe(true);memory=1;expect(monitor.body(100).reason).toBe('memory_pressure');
 }finally{monitor.close();}
});
it('fails closed on missing measurements without returning paths, and validates resource settings',async()=>{
 const monitor=createResourceMonitor({root:'/private/volume',memory:()=>128*MiB,filesystem:async()=>{throw new Error('private path');},delay:histogram()});
 try{expect(await monitor.check()).toMatchObject({allowed:false,reason:'storage_observation_unavailable'});expect(JSON.stringify(await monitor.check())).not.toContain('/private');}finally{monitor.close();}
 expect(resourcePolicyFromEnv({NATIVE_GIT_MAX_CONCURRENT:'8'})).toEqual({});
 expect(resourcePolicyFromEnv({NATIVE_GIT_MIN_AVAILABLE_MEMORY_MB:'64'})).toEqual({minMemoryBytes:64*MiB});
 expect(()=>resourcePolicyFromEnv({NATIVE_GIT_MAX_LOOP_DELAY_MS:'invalid'})).toThrow();
 expect(()=>createResourceMonitor({root:'/data',policy:{maxConcurrent:8}})).toThrow();
 expect(RESOURCE_DEFAULTS.minMemoryBytes).toBe(32*MiB);
});
