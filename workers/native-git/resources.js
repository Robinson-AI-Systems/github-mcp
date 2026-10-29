import { statfs } from 'node:fs/promises';
import { dirname } from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';

const MiB=1024*1024;
export const RESOURCE_DEFAULTS=Object.freeze({minMemoryBytes:32*MiB,minDiskBytes:64*MiB,maxLoopDelayMs:250});
const pressure=(reason)=>({allowed:false,reason,retryAfterSeconds:2});
export function createResourceMonitor({root,policy={},memory=()=>process.availableMemory(),filesystem=statfs,delay}={}) {
 const limits={...RESOURCE_DEFAULTS,...policy};
 for(const [key,value] of Object.entries(limits)) if(!Object.hasOwn(RESOURCE_DEFAULTS,key)||!Number.isSafeInteger(value)||value<=0)throw new TypeError('Invalid native resource policy.');
 const histogram=delay??monitorEventLoopDelay({resolution:20});histogram.enable?.();
 const reset=setInterval(()=>histogram.reset?.(),1000);reset.unref();
 const memoryCheck=(extra=0,floor=limits.minMemoryBytes)=>{
  let available;try{available=memory();}catch{return pressure('memory_observation_unavailable');}
  if(!Number.isFinite(available)||available<0)return pressure('memory_observation_unavailable');
  return available<floor+extra?pressure('memory_pressure'):{allowed:true};
 };
 return {
  policy:limits,
  body(bytes){return memoryCheck(bytes*3,Math.min(limits.minMemoryBytes,2*MiB));},
  async check({needsDisk=true}={}){
   const mem=memoryCheck();if(!mem.allowed)return mem;
   const lag=histogram.percentile(99)/1e6;
   if(!Number.isFinite(lag)||lag<0)return pressure('responsiveness_observation_unavailable');
   if(lag>limits.maxLoopDelayMs)return pressure('worker_responsiveness_pressure');
   if(needsDisk){
    let disk;try{disk=await filesystem(root);}catch(error){
     if(error.code!=='ENOENT')return pressure('storage_observation_unavailable');
     try{disk=await filesystem(dirname(root));}catch{return pressure('storage_observation_unavailable');}
    }
    const free=Number(disk.bavail)*Number(disk.bsize);
    if(!Number.isFinite(free)||free<0)return pressure('storage_observation_unavailable');
    if(free<limits.minDiskBytes)return pressure('storage_pressure');
   }
   return {allowed:true};
  },
  close(){clearInterval(reset);histogram.disable?.();}
 };
}
export function resourcePolicyFromEnv(env={}) {
 const policy={};
 for(const [name,key,multiplier] of [['NATIVE_GIT_MIN_AVAILABLE_MEMORY_MB','minMemoryBytes',MiB],['NATIVE_GIT_MIN_AVAILABLE_DISK_MB','minDiskBytes',MiB],['NATIVE_GIT_MAX_LOOP_DELAY_MS','maxLoopDelayMs',1]]){
  if(env[name]===undefined)continue;
  const n=Number(env[name])*multiplier;if(!Number.isSafeInteger(n)||n<=0)throw new TypeError('Invalid native resource policy setting.');policy[key]=n;
 }
 return policy;
}
