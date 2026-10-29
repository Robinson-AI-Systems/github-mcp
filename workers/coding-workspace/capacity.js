import {availableParallelism} from 'node:os';
import {readFile,statfs} from 'node:fs/promises';
const decimal=s=>/^\d+$/.test(s.trim())&&Number.isSafeInteger(Number(s))?Number(s):null;
export async function codingCapacity({root,read=readFile,filesystem=statfs,parallelism=availableParallelism,memory=()=>process.availableMemory()}={}){
 const file=async name=>{try{return await read('/sys/fs/cgroup/'+name,'utf8');}catch{return null;}};
 const [cpu,mem,current]=await Promise.all(['cpu.max','memory.max','memory.current'].map(file));
 let cpuLimit=null;if(cpu){const [q,p]=cpu.trim().split(/\s+/);const quota=decimal(q),period=decimal(p??'');if(quota!==null&&period>0)cpuLimit=quota/period;}
 let availableMemory=null;try{const v=memory();if(Number.isSafeInteger(v)&&v>=0)availableMemory=v;}catch{/* Unknown, never substitute host total. */}
 let filesystemAvailableBytes=null;try{const s=await filesystem(root);const v=Number(s.bavail)*Number(s.bsize);if(Number.isSafeInteger(v)&&v>=0)filesystemAvailableBytes=v;}catch{/* Unknown. */}
 let logicalCpus=null;try{const v=parallelism();if(Number.isSafeInteger(v)&&v>0)logicalCpus=v;}catch{/* Unknown. */}
 return {scope:'this_container',observedAt:new Date().toISOString(),cpu:{schedulerParallelism:logicalCpus,cgroupQuotaCpus:cpuLimit,dedicatedPhysicalCores:false},memory:{cgroupLimitBytes:mem?decimal(mem):null,cgroupUsedBytes:current?decimal(current):null,availableBytes:availableMemory},storage:{filesystemAvailableBytes,workspaceQuotaBytes:null,quotaVerified:false,note:'Filesystem availability can be shared. It is not a per-workspace disk quota or reserved SSD capacity.'},performanceComparison:'unmeasured'};
}
