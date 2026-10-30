// Protected operator observations are prerequisites, never a capacity reservation
// or a replacement for independent host acceptance. No caller may submit these.
const CPU=8,MEMORY=8*1024**3,DISK=150*1000**3;
const alternatives=()=>({automatic:false,permissionChecks:'Each operation still uses the connection’s existing grants.',tools:['github_git_workspace_read','github_git_workspace_run','github_content_commit_git_data','github_actions_dispatch'],guidance:'Continue editing and Git operations using the existing workspace. Existing repository CI may build/test committed work when explicitly requested; no automatic push, workflow dispatch, paid runner or provider switch.'});
export function playgroundFallback(reason,{retryable=false,mode='git_only'}={}){
 return {mode,reason,execution_available:false,command_started:false,background_retry_scheduled:false,retryable,retry_after_seconds:retryable?2:null,workspace_preserved:true,fallback:alternatives(),next:retryable?'Inspect the original intent before retrying identical command arguments with the same requestKey.':'Continue Git/GitHub work while the runtime prerequisite is resolved. Do not run shell commands in the shared Git worker.'};
}
export function enforcementObservation(ctx,record){
 let rows;try{rows=JSON.parse(ctx.env?.PLAYGROUND_ENFORCEMENT??'[]');}catch{return null;}
 if(!Array.isArray(rows)||rows.length>10000)return null;
 const matches=rows.filter(x=>x?.workspace_id===record.row.id);
 if(matches.length!==1)return null;
 const o=matches[0],now=(ctx.now??Date.now)();
 if(Object.keys(o).some(k=>!['workspace_id','binding','observedAt','expiresAt','isolation','termination','repositoryAttached','cpuCpus','memoryBytes','storageQuotaBytes'].includes(k))||o.binding!==record.allocation?.binding||!Number.isSafeInteger(o.observedAt)||!Number.isSafeInteger(o.expiresAt)||o.observedAt>now||o.expiresAt<=now||o.expiresAt<=o.observedAt||o.expiresAt-o.observedAt>14400000||o.isolation!==true||o.termination!==true||o.repositoryAttached!==true||!Number.isFinite(o.cpuCpus)||o.cpuCpus<=0||o.cpuCpus>CPU||!Number.isSafeInteger(o.memoryBytes)||o.memoryBytes<=0||o.memoryBytes>MEMORY||!Number.isSafeInteger(o.storageQuotaBytes)||o.storageQuotaBytes<=0||o.storageQuotaBytes>DISK)return null;
 return o;
}
export async function playgroundAvailability(ctx,record,probe){
 if(!record.allocation)return playgroundFallback('runtime_unattached');
 const evidence=enforcementObservation(ctx,record);
 if(!evidence)return playgroundFallback('enforcement_unverified');
 let cap;try{cap=await probe();}catch(e){if(['playground_transport','playground_response'].includes(e.safeCode))return playgroundFallback('runtime_unavailable',{retryable:true,mode:'recovery'});throw e;}
 if(cap.protocol!==1||cap.arbitraryCommands!==true||cap.idleTimeoutMs!==record.job.idleTimeoutMs)return playgroundFallback('runtime_incompatible');
 const cpu=cap.capacity?.cpu?.cgroupQuotaCpus,memory=cap.capacity?.memory?.cgroupLimitBytes;
 if(!Number.isFinite(cpu)||cpu<=0||cpu>evidence.cpuCpus||!Number.isSafeInteger(memory)||memory<=0||memory>evidence.memoryBytes)return playgroundFallback('runtime_limits_unconfirmed');
 const constrained=cpu<CPU||memory<MEMORY||evidence.storageQuotaBytes<DISK;
 return {mode:constrained?'constrained':'ready',execution_available:true,resource_reservation:false,availability_guaranteed:false,background_retry_scheduled:false,limits:{cpuCpus:cpu,memoryBytes:memory,storageQuotaBytes:evidence.storageQuotaBytes},enforcement:{source:'protected_operator_observation_and_runtime_cgroup_readback',observedAt:evidence.observedAt,expiresAt:evidence.expiresAt,independentLiveAcceptance:false},fallback:alternatives(),next:'Execute with a stable requestKey. Resource pressure can defer admission; inspect that same intent and retry after recovery.',capabilities:cap};
}
export function requirePlaygroundExecution(availability){
 if(availability.execution_available)return;
 throw Object.assign(new TypeError(`Playground is in ${availability.mode} mode (${availability.reason}); no command was sent. Existing Git/GitHub tools remain available under their normal permissions. Use github_playground_read operation availability for recovery guidance.`),{safeMessage:true,safeCode:availability.reason,safeRetryable:availability.retryable===true});
}
