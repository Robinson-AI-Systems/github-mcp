import {createPreviewEntry} from '../playground/preview-entry.js';
import {attachRepository} from '../playground/attachment.js';
import {disposeAllocation,allocationRecord,inspectAllocation,resumeAllocation,provisionAllocation,recoverAllocation,recoveryPendingError,replacementNotice} from '../playground/allocations.js';
import {playgroundAvailability,playgroundFallback,requirePlaygroundExecution} from '../playground/availability.js';
import {warmRuntimeStatus} from '../playground/warm-runtimes.js';
import {defineRead} from './define-read.js';
import {passRefusal} from '../rtc/pass-scope.js';
import {withUpsizeHint} from '../playground/sizing.js';
import {RUN_PHASES,runIntent,runRequestKey,startRun,advanceRun,readRun,presentRun,runEssentials,defaultRunDeps} from '../playground/run.js';
import {authorizeNativeRepo,callNativeWorker,nativeConnection,nativeRecord} from '../native-git/client.js';
import {workerUrl} from '../native-git/protocol.js';
import {ref as exactRef} from '../native-git/commands.js';
import {defineGithubWrite} from './define-github-write.js';
import {playgroundRecord,playgroundRequestKey,playgroundRuntimeKey,playgroundExecutionId,callPlayground,presentPlayground,playgroundSetup} from '../playground/client.js';
const OWNER={type:'string',maxLength:39},REPO={type:'string',minLength:1,maxLength:100},WORKSPACE={type:'string',pattern:'^job_[a-f0-9]{16}$'},EXECUTION={type:'string',pattern:'^[a-f0-9]{64}$'};
const properties={owner:OWNER,repo:REPO,workspace_id:WORKSPACE};
const required=['repo','workspace_id'];
const targetFor=allowUnattached=>async(a,c)=>{const record=await playgroundRecord(c,a,{allowUnattached});return{owner:record.row.owner,repo:record.row.repo,kind:'playground',scope:'repo',record};};
const target=targetFor(false);
const availability=(c,r)=>playgroundAvailability(c,r,()=>callPlayground(c,r,'capabilities'));
const explain=e=>e?.safeMessage?e.message:'Playground execution was not confirmed. Inspect the original execution ID before retrying.';
// The allocation's stored size class (for the out-of-memory upsize hint); unknown -> null.
const sizeOf=async(c,record)=>{try{return (await allocationRecord(c,record))?.size??null;}catch{return null;}};
const guidance='For a one-off check (tests, lint, a build) at a branch, tag or commit, prefer github_playground_run: it opens, provisions, runs and cleans up in one intent. Robinson Playground runs arbitrary commands only inside an attached isolated runtime. Supply argv (for example ["npm","test"]), a workspace_id and stable requestKey. Applied means execution accepted, not build/test success; inspect command state/exitCode and read complete hash-pinned logs. Never put credentials in argv. Use read operation preview with port/path for authenticated development text; use workspace operation preview for interactive browser entry. No shared-worker shell fallback. Read availability for best_effort, constrained, recovery or Git-only modes; best_effort has no verified storage quota or capacity guarantee and downloads require its controlled HTTP(S) gateway proxy. No automatic push, paid runner or unsafe shell fallback. Discover tools through github_search_tools and call through github_call.';
const execute=defineGithubWrite({name:'github_playground_execute',area:'playground',audience:['B','O','Op'],description:'Run shell commands, builds and tests in Robinson Playground’s isolated runtime sandbox; retrieve status/logs by execution ID.',guidance,
 properties:{...properties,argv:{type:'array',minItems:1,maxItems:128,items:{type:'string',maxLength:16384}},cwd:{type:'string',maxLength:4096},timeoutMs:{type:'integer',minimum:1,maximum:14400000}},required:[...required,'argv','requestKey'],declarations:{production:'when-target',confirm:'when-needed',profiles:['full']},requestKey:playgroundRequestKey,explain,target:targetFor(true),
 read:async(_a,c,t)=>{const readiness=await availability(c,t.record);requirePlaygroundExecution(readiness);const cap=readiness.capabilities;if(cap.protocol!==1||cap.arbitraryCommands!==true||cap.idleTimeoutMs!==t.record.job.idleTimeoutMs)throw new TypeError('Update the attached Playground runtime before executing commands.');return{ready:true};},classify:()=>({}),summarize:({target:t})=>`Execute a command in Robinson Playground for ${t.owner}/${t.repo}; this may change workspace files and use configured host compute/storage.`,
 apply:async({args:a,ctx:c,target:t})=>{const requestKey=playgroundRuntimeKey(c,a),id=playgroundExecutionId(t.record.allocation.binding,requestKey);let result;try{result=await callPlayground(c,t.record,'start',{requestKey,argv:a.argv,...(a.cwd!==undefined?{cwd:a.cwd}:{}),...(a.timeoutMs!==undefined?{timeoutMs:a.timeoutMs}:{})});}catch(error){error.safeMessage=true;error.message=`${error.message} execution_id=${id}`;throw error;}return{id,result};},
 readAfter:async({ctx:c,target:t,response})=>({expected:response.id,started:response.result,execution:await callPlayground(c,t.record,'status',{id:response.id}),size:await sizeOf(c,t.record)}),
 // A replay re-reads the same execution, so it reports the command's current state (not the state at first start).
 refreshReplay:async({ctx:c,target:t,prior})=>/^[a-f0-9]{64}$/.test(prior?.expected??'')?{...prior,execution:await callPlayground(c,t.record,'status',{id:prior.expected}),size:await sizeOf(c,t.record)}:null,
 verify:({after})=>after.started.id===after.expected&&after.execution.id===after.expected&&['starting','running','completed','failed'].includes(after.execution.state),
 present:({after})=>({execution_id:after.expected,accepted:after.execution.state!=='uncertain',command_finished:['completed','failed'].includes(after.execution.state),command_succeeded:after.execution.state==='completed'&&after.execution.exitCode===0,execution:withUpsizeHint(after.execution,after.size),next:'Use github_playground_read status/logs with this execution_id; applied means accepted, not command success.'})
});
const read=defineRead({name:'github_playground_read',area:'playground',audience:['B','O','Op'],description:'Inspect Playground availability, safe fallback, command status, protected logs and private development text previews.',guidance,byteWindow:true,
 properties:{...properties,operation:{type:'string',enum:['capabilities','availability','allocation','status','logs','preview']},port:{type:'integer',minimum:1024,maximum:65535},path:{type:'string',maxLength:4096},expectedBodyHash:{type:'string',pattern:'^[a-f0-9]{64}$'},execution_id:EXECUTION,requestKey:{type:'string',minLength:1,maxLength:128},byteOffset:{type:'integer',minimum:0},byteLength:{type:'integer',minimum:1,maximum:32768},expectedLogHash:{type:'string',pattern:'^[a-f0-9]{64}$'}},required:['operation'],
 handler:async(a,c)=>{
  if(a.operation==='availability'&&!a.workspace_id)return{...playgroundFallback('workspace_required'),warm_runtimes:await warmRuntimeStatus(c)};
  if(a.operation==='capabilities'&&!a.workspace_id)return{product:"Robinson's Playground",operations:['github_playground_run','github_playground_execute','github_playground_read','github_playground_cancel','github_playground_workspace'],runtime_attached:false,setup_required:true,next:'Use an attached workspace_id and repository to check its actual runtime. Installation alone does not attach a runtime.',setup:'https://github.com/Robinson-AI-Systems/github-mcp/blob/main/docs/CODING-WORKSPACES.md',warm_runtimes:await warmRuntimeStatus(c)};
  const record=await playgroundRecord(c,a,{allowUnattached:['capabilities','availability','allocation'].includes(a.operation)});
  if(a.operation==='allocation')return await inspectAllocation(c,record);
  if(a.operation==='availability')return await availability(c,record);
  if(!record.allocation)return playgroundSetup(c,record);
  if(a.operation==='capabilities')return await callPlayground(c,record,'capabilities');
  if(a.operation==='preview')return presentPlayground(await callPlayground(c,record,'preview',{port:a.port,path:a.path??'/',offset:a.byteOffset??0,length:a.byteLength??8192,...(a.expectedBodyHash?{expectedBodyHash:a.expectedBodyHash}:{})}));
  const id=a.execution_id??(a.requestKey?playgroundExecutionId(record.allocation.binding,playgroundRuntimeKey(c,a)):null);
  if(!id)throw new TypeError('execution_id or the original command requestKey is required for status/logs.');
  const data=presentPlayground(await callPlayground(c,record,a.operation,{id,...(a.operation==='logs'?{offset:a.byteOffset??0,length:a.byteLength??8192,...(a.expectedLogHash?{expectedLogHash:a.expectedLogHash}:{})}:{})}));
  return a.operation==='status'?withUpsizeHint(data,await sizeOf(c,record)):data;
 }
});
const cancel=defineGithubWrite({name:'github_playground_cancel',area:'playground',audience:['B','O','Op'],description:'Cancel a command in the Playground runtime sandbox and independently read its actual terminal state.',guidance,
 properties:{...properties,execution_id:EXECUTION},required:[...required,'execution_id'],declarations:{production:'never',confirm:'when-needed',profiles:['full']},explain,target,
 read:(a,c,t)=>callPlayground(c,t.record,'status',{id:a.execution_id}),classify:()=>({}),summarize:({target:t})=>`Cancel a Playground command in ${t.owner}/${t.repo}; this does not close or delete the workspace.`,
 apply:({args:a,ctx:c,target:t})=>callPlayground(c,t.record,'cancel',{id:a.execution_id}),readAfter:({args:a,ctx:c,target:t})=>callPlayground(c,t.record,'status',{id:a.execution_id}),
 verify:({args:a,after})=>after.id===a.execution_id&&['completed','failed'].includes(after.state),present:({after})=>({execution_id:after.id,execution:after,process_group_stopped:after.reason!=='cancelled_before_start',command_never_started:after.no_operation_started===true,whole_allocation_disposed:false})
});
// PG-STUCK-1: an attach on a runtime that failed to start (or stopped making progress) does not
// retry the same broken runtime; it removes it and provisions a fresh one for the same workspace.
async function attachWithRecovery(c,record){
 const recovered=await recoverAllocation(c,record);
 if(recovered.pending)throw recoveryPendingError(recovered.reason,c.env);
 if(recovered.reason||recovered.stored?.phase==='disposed')return provisionAllocation(c,record);
 return attachRepository(c,record);
}
const workspace=defineGithubWrite({name:'github_playground_workspace',area:'playground',audience:['B','O','Op'],description:'Provision or dispose this workspace’s dedicated Playground allocation, with exact ownership and lifecycle readback.',
 guidance:'Use operation provision with a stable requestKey and the smallest fitting size (small: lint/unit tests; medium: typical builds and a test database; large: browser tests and monorepos); an allocation may remain deploying or awaiting repository attachment/enforcement. Read allocation to inspect progress. Dispose deletes only this exact owned allocation and volume after whole-process absence is independently verified. No provider secrets or runtime URLs are tool arguments.',
 properties:{...properties,operation:{type:'string',enum:['provision','attach','resume','preview','dispose']},port:{type:'integer',minimum:1024,maximum:65535},size:{type:'string',enum:['auto','small','medium','large'],description:'Provision only: runtime size class for a NEW allocation (small 2 CPU/2 GiB, medium 4/4, large 8/8, never above operator ceilings). An existing allocation keeps its size.'}},required:[...required,'operation','requestKey'],declarations:{production:'never',confirm:'when-needed',profiles:['full']},target:targetFor(true),explain,
 read:async(a,c,t)=>({allocation:await allocationRecord(c,t.record)}),classify:()=>({}),summarize:({args:a,target:t})=>`${({provision:'Provision',attach:'Attach the repository to',resume:'Resume',preview:'Open a private preview for',dispose:'Delete the files and volumes of'})[a.operation]} the exact dedicated Playground allocation for ${t.owner}/${t.repo}; uses configured host resources, no additional paid plan.`,
 apply:({args:a,ctx:c,target:t})=>a.operation==='provision'?provisionAllocation(c,t.record,{size:a.size}):a.operation==='attach'?attachWithRecovery(c,t.record):a.operation==='resume'?resumeAllocation(c,t.record):a.operation==='preview'?createPreviewEntry(c,t.record,a.port??4173):disposeAllocation(c,t.record),
 readAfter:async({args:a,ctx:c,target:t,response})=>({response,allocation:await allocationRecord(c,t.record),observed:await inspectAllocation(c,t.record),operation:a.operation}),
 verify:({after})=>after.operation==='preview'?typeof after.response.entry_url==='string':after.operation==='dispose'?after.response.disposed===true:['requested','waiting_resources'].includes(after.allocation?.phase)||after.observed?.provider_observed===true&&!!after.allocation?.composeId&&['created','exposed','deploying','allocated','attaching','attached'].includes(after.allocation.phase),
 present:({after,ctx:c})=>after.operation==='preview'?after.response:({workspace_id:after.allocation?.workspace,phase:after.allocation?.phase??'absent',runtime_size:after.allocation?.size??null,allocation_ready:['allocated','attached'].includes(after.allocation?.phase),repository_attached:after.allocation?.repositoryAttached===true,disposed:after.response.disposed===true,execution_available:false,...(after.response?.replacedReason?{runtime_replaced:true,replaced_reason:after.response.replacedReason}:{}),next:replacementNotice(after.response?.replacedReason,c?.env)??'Read allocation and availability. Provisioning acceptance is not repository attachment, enforcement or command success.'})
});
// FLEET-2 run-at-commit. One intent = one Git-only workspace at the ref, the smallest fitting
// runtime, one command and full cleanup. Resumable: each call advances within the function
// budget and a repeat call with the same requestKey continues (a write-layer replay).
const GIT_TOOL={name:'github_git_workspace_open',area:'git',writes:true,inputSchema:{properties:{repo:{}}}};
const runGuidance='Prefer this for one-off checks (tests, lint, a build) at a branch, tag or 40-character commit SHA: it opens a Git-only workspace at that commit, picks the smallest fitting runtime (size auto: small without browser/database, medium with a database, large with browser tests), runs argv once, returns status, exit code and the last 4 KB of log, then deletes the runtime and workspace. A call returns within about 40 seconds; if finished is false, call again with the same arguments and requestKey to continue (nothing runs twice); progress always shows phase, exit_code and next. Applied means the run intent was accepted; read command_succeeded and exit_code. Never put credentials in argv. For interactive multi-step work use github_git_workspace_open plus github_playground_execute.';
export function runToolDefinition(deps=defaultRunDeps,{budgetMs=40000,pollMs=2000,reserveMs=15000}={}){
 const advance=(c,intent)=>advanceRun(c,intent,{deps,budgetMs,pollMs,reserveMs});
 return defineGithubWrite({name:'github_playground_run',area:'playground',audience:['B','O','Op'],description:'Run one command at a branch, tag or commit in a fresh right-sized Playground runtime, return exit code and log tail, then clean everything up.',guidance:runGuidance,
  properties:{owner:OWNER,repo:REPO,ref:{type:'string',minLength:1,maxLength:256,description:'Branch, tag or 40-character commit SHA to run at.'},argv:{type:'array',minItems:1,maxItems:128,items:{type:'string',maxLength:16384}},cwd:{type:'string',maxLength:4096},size:{type:'string',enum:['auto','small','medium','large'],description:'Runtime size; auto (default) picks from the repository: small without browser/database, medium with a database, large with browser tests.'},timeoutMs:{type:'integer',minimum:1,maximum:14400000}},
  required:['repo','ref','argv','requestKey'],declarations:{production:'when-target',confirm:'when-needed',profiles:['full']},explain,
  requestKey:(c,a)=>runRequestKey(c,a),
  target:(a,c)=>({owner:a.owner??c.connection.default_account,repo:a.repo,scope:'repo',kind:'playground-run'}),
  read:async(a,c,t)=>{
   try{exactRef(a.ref);}catch{throw Object.assign(new TypeError('ref must be an exact branch, tag or 40-character commit SHA.'),{safeMessage:true,safeCode:'invalid_ref'});}
   const refusal=passRefusal({tool:GIT_TOOL,args:{owner:t.owner,repo:t.repo},connection:c.connection});if(refusal)throw Object.assign(new TypeError(refusal+' A run also needs Git workspace access.'),{safeMessage:true,safeCode:'pass_area_git_required'});
   workerUrl(c.env);await authorizeNativeRepo(c,t.owner,t.repo);
   const existing=await readRun(c,runIntent(c,a));if(existing)return{run_phase:existing.phase};
   const cap=await callNativeWorker(c,{action:'capabilities'});if(cap.capacity_mode!=='resource-aware')throw Object.assign(new TypeError('Update the native Git worker to resource-based admission before running.'),{safeMessage:true,safeCode:'native_worker_update_required'});
   if(!cap.admission?.allowed)throw Object.assign(new TypeError('Native Git worker resource pressure. Nothing was cloned; retry in a moment.'),{safeMessage:true,safeCode:'native_resource_pressure',safeRetryable:true});
   return{run_phase:null};
  },
  classify:()=>({}),
  summarize:({args:a,target:t})=>`Run ${JSON.stringify(a.argv.slice(0,3)).slice(0,120)} once in a fresh Robinson Playground runtime for ${t.owner}/${t.repo} at ${a.ref}; the runtime and workspace are deleted when it finishes. Uses configured host compute, no paid plan.`,
  apply:async({args:a,ctx:c,requestKey})=>{const s=await startRun(c,a,{deps,requestKey});await advance(c,s.intent);return{intent:s.intent};},
  readAfter:async({ctx:c,response})=>observeRun(c,response.intent),
  // A repeat call continues the SAME intent (derived from the arguments, so it also works when the
  // first call was cut off before its outcome was journalled): one leased, bounded, idempotent
  // advance of the run state machine. The command start is keyed by the intent, never re-sent.
  resumeReplay:true,essentials:runEssentials,
  refreshReplay:async({args:a,ctx:c,prior})=>{const intent=runIntent(c,a);if(prior?.intent!=null&&prior.intent!==intent)return null;if(!await readRun(c,intent))return null;await advance(c,intent);return observeRun(c,intent);},
  verify:({after})=>!!after.run&&RUN_PHASES.includes(after.run.phase)&&after.workspace_consistent===true,
  present:({after})=>presentRun(after.run)
 });
}
// Independent readback: the stored run plus the workspace as the Git worker/database see it.
async function observeRun(c,intent){
 const run=await readRun(c,intent);if(!run)return{intent,run:null,workspace_consistent:false};
 let consistent=false;
 try{
  if(run.phase==='done'){const job=await c.db.getJob(run.workspace_id,nativeConnection(c));consistent=job?.state==='failed'||job?.state==='ready'&&job.detail==='Native workspace disposed.';}
  else{const record=await nativeRecord(c,run.workspace_id),seen=await callNativeWorker(c,{binding:record.binding,job:record.job,workspace_id:record.worker,action:'inspect'});consistent=run.phase==='opening'?['opening','ready'].includes(seen.state):seen.state==='ready';}
 }catch{consistent=false;}
 return{intent,run,workspace_consistent:consistent};
}
const run=runToolDefinition();
export const tools=[execute.tool,read.tool,cancel.tool,workspace.tool,run.tool];
export const handlers=Object.fromEntries([execute,read,cancel,workspace,run].map(x=>[x.tool.name,x.handler]));
