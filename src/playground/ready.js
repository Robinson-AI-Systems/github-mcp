// The "is it really ready" report that setup gives once a runtime is attached. It uses the runtime's own signed
// capabilities answer (identity, limits, protocol) and the workspace's current branch. It does NOT run a command:
// command_run is always false and the text says so.
const pick=(o,keys)=>Object.fromEntries(keys.filter(k=>o?.[k]!==undefined).map(k=>[k,o[k]]));
export async function readinessReport(ctx,record,{availability,inspect}){
 let seen=null,branch=null;
 try{seen=await availability(ctx,record);}catch{seen=null;}
 try{const w=await inspect(ctx,record);const b=w?.branch??w?.current_branch??w?.head?.branch??null;branch=typeof b==='string'&&b.length<=256?b:null;}catch{branch=null;}
 const ready=seen?.execution_available===true;
 const cap=seen?.capabilities;
 return {
  execution_ready:ready,mode:seen?.mode??'unknown',reason:ready?null:(seen?.reason??'not_confirmed'),
  active_branch:branch,
  verified_by:'runtime_signed_capabilities',command_run:false,
  limits:seen?.limits??null,
  runtime:ready?{...pick(cap,['protocol','execution','arbitraryCommands']),preview:cap?.preview?{ports:cap.preview.ports,text_body_limit_bytes:cap.preview.textBodyLimitBytes}:null,repository:cap?.repository?{git_read_only:cap.repository.gitReadOnly===true}:null}:null,
  retryable:seen?.retryable===true,
  note:ready?'The runtime answered its signed readiness check. No command was run; start one with github_playground_execute.':'Commands are not available yet. '+(seen?.next??'Call setup again in about a minute.')
 };
}
