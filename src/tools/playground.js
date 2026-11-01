import {createPreviewEntry} from '../playground/preview-entry.js';
import {attachRepository} from '../playground/attachment.js';
import {dokployConfig} from '../playground/dokploy.js';
import {ensureAllocation,disposeAllocation,allocationRecord,inspectAllocation,resumeAllocation} from '../playground/allocations.js';
import {playgroundAvailability,playgroundFallback,requirePlaygroundExecution} from '../playground/availability.js';
import {prepareEnrolledPlacement,inspectEnrolledPlacement} from '../playground/enrolled-placement.js';
import {defineRead} from './define-read.js';
import {defineGithubWrite} from './define-github-write.js';
import {playgroundRecord,playgroundRequestKey,playgroundRuntimeKey,playgroundExecutionId,callPlayground,presentPlayground,playgroundSetup} from '../playground/client.js';
const OWNER={type:'string',maxLength:39},REPO={type:'string',minLength:1,maxLength:100},WORKSPACE={type:'string',pattern:'^job_[a-f0-9]{16}$'},EXECUTION={type:'string',pattern:'^[a-f0-9]{64}$'};
const properties={owner:OWNER,repo:REPO,workspace_id:WORKSPACE};
const required=['repo','workspace_id'];
const targetFor=allowUnattached=>async(a,c)=>{const record=await playgroundRecord(c,a,{allowUnattached});return{owner:record.row.owner,repo:record.row.repo,kind:'playground',scope:'repo',record};};
const target=targetFor(false);
const availability=(c,r)=>playgroundAvailability(c,r,()=>callPlayground(c,r,'capabilities'));
const explain=e=>e?.safeMessage?e.message:'Playground execution was not confirmed. Inspect the original execution ID before retrying.';
const guidance='Robinson Playground runs arbitrary commands only inside an attached isolated runtime. Supply argv (for example ["npm","test"]), a workspace_id and stable requestKey. Applied means execution accepted, not build/test success; inspect command state/exitCode and read complete hash-pinned logs. Never put credentials in argv. Use read operation preview with port/path for authenticated development text; use workspace operation preview for interactive browser entry. No shared-worker shell fallback. Read availability for best_effort, constrained, recovery or Git-only modes; best_effort has no verified storage quota or capacity guarantee and downloads require its controlled HTTP(S) gateway proxy. No automatic push, paid runner or unsafe shell fallback. Discover tools through github_search_tools and call through github_call.';
const execute=defineGithubWrite({name:'github_playground_execute',area:'playground',audience:['B','O','Op'],description:'Run shell commands, builds and tests in Robinson Playground’s isolated runtime sandbox; retrieve status/logs by execution ID.',guidance,
 properties:{...properties,argv:{type:'array',minItems:1,maxItems:128,items:{type:'string',maxLength:16384}},cwd:{type:'string',maxLength:4096},timeoutMs:{type:'integer',minimum:1,maximum:14400000}},required:[...required,'argv','requestKey'],declarations:{production:'when-target',confirm:'when-needed',profiles:['full']},requestKey:playgroundRequestKey,explain,target:targetFor(true),
 read:async(_a,c,t)=>{const readiness=await availability(c,t.record);requirePlaygroundExecution(readiness);const cap=readiness.capabilities;if(cap.protocol!==1||cap.arbitraryCommands!==true||cap.idleTimeoutMs!==t.record.job.idleTimeoutMs)throw new TypeError('Update the attached Playground runtime before executing commands.');return{ready:true};},classify:()=>({}),summarize:({target:t})=>`Execute a command in Robinson Playground for ${t.owner}/${t.repo}; this may change workspace files and use configured host compute/storage.`,
 apply:async({args:a,ctx:c,target:t})=>{const requestKey=playgroundRuntimeKey(c,a),id=playgroundExecutionId(t.record.allocation.binding,requestKey);let result;try{result=await callPlayground(c,t.record,'start',{requestKey,argv:a.argv,...(a.cwd!==undefined?{cwd:a.cwd}:{}),...(a.timeoutMs!==undefined?{timeoutMs:a.timeoutMs}:{})});}catch(error){error.safeMessage=true;error.message=`${error.message} execution_id=${id}`;throw error;}return{id,result};},
 readAfter:async({ctx:c,target:t,response})=>({expected:response.id,started:response.result,execution:await callPlayground(c,t.record,'status',{id:response.id})}),
 verify:({after})=>after.started.id===after.expected&&after.execution.id===after.expected&&['starting','running','completed','failed'].includes(after.execution.state),
 present:({after})=>({execution_id:after.expected,accepted:after.execution.state!=='uncertain',command_finished:['completed','failed'].includes(after.execution.state),command_succeeded:after.execution.state==='completed'&&after.execution.exitCode===0,execution:after.execution,next:'Use github_playground_read status/logs with this execution_id; applied means accepted, not command success.'})
});
const read=defineRead({name:'github_playground_read',area:'playground',audience:['B','O','Op'],description:'Inspect Playground availability, safe fallback, command status, protected logs and private development text previews.',guidance,byteWindow:true,
 properties:{...properties,operation:{type:'string',enum:['capabilities','availability','allocation','status','logs','preview']},port:{type:'integer',minimum:1024,maximum:65535},path:{type:'string',maxLength:4096},expectedBodyHash:{type:'string',pattern:'^[a-f0-9]{64}$'},execution_id:EXECUTION,requestKey:{type:'string',minLength:1,maxLength:128},byteOffset:{type:'integer',minimum:0},byteLength:{type:'integer',minimum:1,maximum:32768},expectedLogHash:{type:'string',pattern:'^[a-f0-9]{64}$'}},required:['operation'],
 handler:async(a,c)=>{
  if(a.operation==='availability'&&!a.workspace_id)return playgroundFallback('workspace_required');
  if(a.operation==='capabilities'&&!a.workspace_id)return{product:"Robinson's Playground",operations:['github_playground_execute','github_playground_read','github_playground_cancel','github_playground_workspace'],runtime_attached:false,setup_required:true,next:'Use an attached workspace_id and repository to check its actual runtime. Installation alone does not attach a runtime.',setup:'https://github.com/Robinson-AI-Systems/github-mcp/blob/main/docs/CODING-WORKSPACES.md'};
  const record=await playgroundRecord(c,a,{allowUnattached:['capabilities','availability','allocation'].includes(a.operation)});
  if(a.operation==='allocation'){
   if(c.db.playgroundScope?.tenantId&&c.connection?.profile==='full'){
    const enrolled=await inspectEnrolledPlacement(c,record);
    if(enrolled)return enrolled;
   }
   return await inspectAllocation(c,record);
  }
  if(a.operation==='availability'){
   if(!record.allocation&&c.db.playgroundScope?.tenantId&&c.connection?.profile==='full'&&
      await inspectEnrolledPlacement(c,record))return playgroundFallback('enrolled_source_attachment_required');
   return await availability(c,record);
  }
  if(!record.allocation)return playgroundSetup(c,record);
  if(a.operation==='capabilities')return await callPlayground(c,record,'capabilities');
  if(a.operation==='preview')return presentPlayground(await callPlayground(c,record,'preview',{port:a.port,path:a.path??'/',offset:a.byteOffset??0,length:a.byteLength??8192,...(a.expectedBodyHash?{expectedBodyHash:a.expectedBodyHash}:{})}));
  const id=a.execution_id??(a.requestKey?playgroundExecutionId(record.allocation.binding,playgroundRuntimeKey(c,a)):null);
  if(!id)throw new TypeError('execution_id or the original command requestKey is required for status/logs.');
  return presentPlayground(await callPlayground(c,record,a.operation,{id,...(a.operation==='logs'?{offset:a.byteOffset??0,length:a.byteLength??8192,...(a.expectedLogHash?{expectedLogHash:a.expectedLogHash}:{})}:{})}));
 }
});
const cancel=defineGithubWrite({name:'github_playground_cancel',area:'playground',audience:['B','O','Op'],description:'Cancel a command in the Playground runtime sandbox and independently read its actual terminal state.',guidance,
 properties:{...properties,execution_id:EXECUTION},required:[...required,'execution_id'],declarations:{production:'never',confirm:'when-needed',profiles:['full']},explain,target,
 read:(a,c,t)=>callPlayground(c,t.record,'status',{id:a.execution_id}),classify:()=>({}),summarize:({target:t})=>`Cancel a Playground command in ${t.owner}/${t.repo}; this does not close or delete the workspace.`,
 apply:({args:a,ctx:c,target:t})=>callPlayground(c,t.record,'cancel',{id:a.execution_id}),readAfter:({args:a,ctx:c,target:t})=>callPlayground(c,t.record,'status',{id:a.execution_id}),
 verify:({args:a,after})=>after.id===a.execution_id&&['completed','failed'].includes(after.state),present:({after})=>({execution_id:after.id,execution:after,process_group_stopped:after.reason!=='cancelled_before_start',command_never_started:after.no_operation_started===true,whole_allocation_disposed:false})
});
const workspace=defineGithubWrite({name:'github_playground_workspace',area:'playground',audience:['B','O','Op'],description:'Provision or dispose this workspace’s dedicated Playground allocation, with exact ownership and lifecycle readback.',
 guidance:'Use operation provision with a stable requestKey. For your already approved, signed and locally canaried personally enrolled device, operation provision with placement enrolled and exact device_id records a tenant-only awaiting_source intent; it does not call Docker, attach Git or enable execution. An existing operator allocation is never moved implicitly. Default operator provisioning still requires its protected Dokploy project and later attachment/enforcement. Read allocation to inspect progress; dispose only an exact owned operator allocation after verified process absence. No provider secrets or runtime URLs are tool arguments.',
 properties:{...properties,operation:{type:'string',enum:['provision','attach','resume','preview','dispose']},port:{type:'integer',minimum:1024,maximum:65535},placement:{type:'string',enum:['operator','enrolled']},device_id:{type:'string',pattern:'^[a-f0-9]{32}required:[...required,'operation','requestKey'],declarations:{production:'never',confirm:'when-needed',profiles:['full']},target:targetFor(true),explain,
 read:async(a,c,t)=>{
  if(a.placement==='enrolled'){
   if(a.operation!=='provision'||!a.device_id)throw new TypeError('Select an existing personally enrolled device for provision only.');
   return {enrolled:await inspectEnrolledPlacement(c,t.record)};
  }
  if(a.device_id)throw new TypeError('Device identity is accepted only for an enrolled placement.');
  if(a.operation!=='dispose')dokployConfig(c.env);
  return {allocation:await allocationRecord(c,t.record)};
 },classify:()=>({}),summarize:({args:a,target:t})=>a.placement==='enrolled'?
  `Record the exact already-paired device placement for ${t.owner}/${t.repo}; no container, transfer, source attachment or command will be started.`:
  `${({provision:'Provision',attach:'Attach the repository to',resume:'Resume',preview:'Open a private preview for',dispose:'Delete the files and volumes of'})[a.operation]} the exact dedicated Playground allocation for ${t.owner}/${t.repo}; uses configured host resources, no additional paid plan.`,
 apply:({args:a,ctx:c,target:t})=>a.placement==='enrolled'?prepareEnrolledPlacement(c,t.record,a.device_id):a.operation==='provision'?ensureAllocation(c,t.record):a.operation==='attach'?attachRepository(c,t.record):a.operation==='resume'?resumeAllocation(c,t.record):a.operation==='preview'?createPreviewEntry(c,t.record,a.port??4173):disposeAllocation(c,t.record),
 readAfter:async({args:a,ctx:c,target:t,response})=>a.placement==='enrolled'?({response,allocation:await inspectEnrolledPlacement(c,t.record),operation:a.operation,placement:'enrolled'}):({response,allocation:await allocationRecord(c,t.record),observed:await inspectAllocation(c,t.record),operation:a.operation}),
 verify:({after})=>after.placement==='enrolled'?after.response?.placement==='enrolled'&&after.response?.phase==='awaiting_source'&&after.allocation?.phase==='awaiting_source'&&after.response.device_id===after.allocation.device_id&&after.response.execution_available===false:after.operation==='preview'?typeof after.response.entry_url==='string':after.operation==='dispose'?after.response.disposed===true:['requested','waiting_resources'].includes(after.allocation?.phase)||after.observed?.provider_observed===true&&!!after.allocation?.composeId&&['created','exposed','deploying','allocated','attaching','attached'].includes(after.allocation.phase),
 present:({after})=>after.placement==='enrolled'?after.allocation:after.operation==='preview'?after.response:({workspace_id:after.allocation?.workspace,phase:after.allocation?.phase??'absent',allocation_ready:['allocated','attached'].includes(after.allocation?.phase),repository_attached:after.allocation?.repositoryAttached===true,disposed:after.response.disposed===true,execution_available:false,next:'Read allocation and availability. Provisioning acceptance is not repository attachment, enforcement or command success.'})
});
export const tools=[execute.tool,read.tool,cancel.tool,workspace.tool];
export const handlers=Object.fromEntries([execute,read,cancel,workspace].map(x=>[x.tool.name,x.handler]));
}},required:[...required,'operation','requestKey'],declarations:{production:'never',confirm:'when-needed',profiles:['full']},target:targetFor(true),explain,
 read:async(a,c,t)=>{if(a.operation!=='dispose')dokployConfig(c.env);return {allocation:await allocationRecord(c,t.record)};},classify:()=>({}),summarize:({args:a,target:t})=>`${({provision:'Provision',attach:'Attach the repository to',resume:'Resume',preview:'Open a private preview for',dispose:'Delete the files and volumes of'})[a.operation]} the exact dedicated Playground allocation for ${t.owner}/${t.repo}; uses configured host resources, no additional paid plan.`,
 apply:({args:a,ctx:c,target:t})=>a.operation==='provision'?ensureAllocation(c,t.record):a.operation==='attach'?attachRepository(c,t.record):a.operation==='resume'?resumeAllocation(c,t.record):a.operation==='preview'?createPreviewEntry(c,t.record,a.port??4173):disposeAllocation(c,t.record),
 readAfter:async({args:a,ctx:c,target:t,response})=>({response,allocation:await allocationRecord(c,t.record),observed:await inspectAllocation(c,t.record),operation:a.operation}),
 verify:({after})=>after.operation==='preview'?typeof after.response.entry_url==='string':after.operation==='dispose'?after.response.disposed===true:['requested','waiting_resources'].includes(after.allocation?.phase)||after.observed?.provider_observed===true&&!!after.allocation?.composeId&&['created','exposed','deploying','allocated','attaching','attached'].includes(after.allocation.phase),
 present:({after})=>after.operation==='preview'?after.response:({workspace_id:after.allocation?.workspace,phase:after.allocation?.phase??'absent',allocation_ready:['allocated','attached'].includes(after.allocation?.phase),repository_attached:after.allocation?.repositoryAttached===true,disposed:after.response.disposed===true,execution_available:false,next:'Read allocation and availability. Provisioning acceptance is not repository attachment, enforcement or command success.'})
});
export const tools=[execute.tool,read.tool,cancel.tool,workspace.tool];
export const handlers=Object.fromEntries([execute,read,cancel,workspace].map(x=>[x.tool.name,x.handler]));
