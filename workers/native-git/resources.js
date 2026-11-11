import { statfs } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';

const MiB=1024*1024;
export const RESOURCE_DEFAULTS=Object.freeze({minMemoryBytes:32*MiB,minDiskBytes:64*MiB,maxLoopDelayMs:250});
const pressure=(reason)=>({allowed:false,reason,retryAfterSeconds:2});
// PC-WORKER-1 (owner decision 2026-11-03, "my own use of this PC always wins instantly"): an owner pause
// is a file on the volume (`<storage>/.owner-pause`, written by deploy/pc/pc-worker pause). While it
// exists every admission check refuses new work before anything starts; work already admitted finishes.
export const OWNER_PAUSE_FILE='.owner-pause';
export const OWNER_PAUSED=Object.freeze({allowed:false,reason:'owner_paused',retryAfterSeconds:60});
export const OWNER_PAUSED_TEXT='This worker is paused by its owner (the computer is in use); nothing was started. Try again later.';
// PAUSE-ORIGIN-1 (2026-11-11): the same file also closes admission for the worker's own maintenance —
// deploy/pc/worker-autoupdate.sh and worker-resolv-guard.sh write it with their marker inside. A failed
// self-update leaves it in place "for operator repair", and agents were told "paused by its owner (the
// computer is in use)" while nobody was at the PC. The reason code stays `owner_paused` (placement,
// retry and pool logic are unchanged); `held_by` says who holds the pause, and the text says it plainly.
export const PAUSE_HOLDERS=Object.freeze({'worker-autoupdate':'updater','worker-resolv-guard':'resolver_guard'});
export const PAUSED_TEXT=Object.freeze({
 owner:OWNER_PAUSED_TEXT,
 updater:'This worker is closed to new work by its own self-updater, not by its owner: an update is being applied, or a failed update is waiting for operator repair. Nothing was started. Try again later.',
 resolver_guard:'This worker is closed to new work by its name-lookup guard, not by its owner: it is repairing DNS, or waiting for operator repair. Nothing was started. Try again later.',
});
/** Who holds a pause, from the pause file's text: 'updater', 'resolver_guard', or 'owner' (anything else). */
export function pauseHolder(text){const t=String(text??'');for(const [marker,holder] of Object.entries(PAUSE_HOLDERS))if(t.includes(marker))return holder;return 'owner';}
export const pausedText=holder=>PAUSED_TEXT[holder]??OWNER_PAUSED_TEXT;
/** The plain sentence for a refused admission: the pause (by who holds it), or the given resource-pressure text. */
export const refusalText=(check,pressureText)=>check?.reason==='owner_paused'?pausedText(check.held_by):pressureText;
export function createResourceMonitor({root,policy={},memory=()=>process.availableMemory(),filesystem=statfs,delay,pauseFile=null,paused=existsSync,readPause=path=>readFileSync(path,'utf8')}={}) {
 const limits={...RESOURCE_DEFAULTS,...policy};
 for(const [key,value] of Object.entries(limits)) if(!Object.hasOwn(RESOURCE_DEFAULTS,key)||!Number.isSafeInteger(value)||value<=0)throw new TypeError('Invalid native resource policy.');
 const isPaused=()=>{if(!pauseFile)return false;try{return paused(pauseFile)===true;}catch{return true;}};
 // An unreadable pause file is the owner's: never guess a maintenance pause.
 const holder=()=>{if(!pauseFile)return 'owner';try{return pauseHolder(readPause(pauseFile).slice(0,400));}catch{return 'owner';}};
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
  /** True while the owner pause file exists (a check that cannot tell counts as paused: never defended). */
  paused:isPaused,
  /** Who holds the current pause ('owner' | 'updater' | 'resolver_guard'). */
  pauseHolder:holder,
  async check({needsDisk=true}={}){
   if(isPaused())return {...OWNER_PAUSED,held_by:holder()};
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
