import {defineRead} from './define-read.js';
import {defineGithubWrite} from './define-github-write.js';
import {playgroundRecord,playgroundRequestKey,playgroundRuntimeKey,playgroundExecutionId,callPlayground,presentPlayground} from '../playground/client.js';
const OWNER={type:'string',maxLength:39},REPO={type:'string',minLength:1,maxLength:100},WORKSPACE={type:'string',pattern:'^job_[a-f0-9]{16}$'},EXECUTION={type:'string',pattern:'^[a-f0-9]{64}$'};
const properties={owner:OWNER,repo:REPO,workspace_id:WORKSPACE};
const required=['repo','workspace_id'];
const target=async(a,c)=>{const record=await playgroundRecord(c,a);return{owner:record.row.owner,repo:record.row.repo,kind:'playground',scope:'repo',record};};
const explain=e=>e?.safeMessage?e.message:'Playground execution was not confirmed. Inspect the original execution ID before retrying.';
const guidance='Robinson Playground runs arbitrary commands only inside an attached isolated runtime. Supply argv (for example ["npm","test"]), a workspace_id and stable requestKey. Applied means execution accepted, not build/test success; inspect command state/exitCode and read complete hash-pinned logs. Never put credentials in argv. No shared-worker shell fallback. Discover these tools through github_search_tools and call through github_call.';
const execute=defineGithubWrite({name:'github_playground_execute',area:'playground',audience:['B','O','Op'],description:'Execute commands in Robinson Playground; returns an execution ID for status, complete logs and cancellation.',guidance,
 properties:{...properties,argv:{type:'array',minItems:1,maxItems:128,items:{type:'string',maxLength:16384}},cwd:{type:'string',maxLength:4096},timeoutMs:{type:'integer',minimum:1,maximum:14400000}},required:[...required,'argv','requestKey'],declarations:{production:'when-target',confirm:'when-needed',profiles:['full']},requestKey:playgroundRequestKey,explain,target,
 read:async(_a,c,t)=>{const cap=await callPlayground(c,t.record,'capabilities');if(cap.protocol!==1||cap.arbitraryCommands!==true||cap.idleTimeoutMs!==t.record.job.idleTimeoutMs)throw new TypeError('Update the attached Playground runtime before executing commands.');return{ready:true};},classify:()=>({}),summarize:({target:t})=>`Execute a command in Robinson Playground for ${t.owner}/${t.repo}; this may change workspace files and use configured host compute/storage.`,
 apply:async({args:a,ctx:c,target:t})=>{const requestKey=playgroundRuntimeKey(c,a),id=playgroundExecutionId(t.record.allocation.binding,requestKey);let result;try{result=await callPlayground(c,t.record,'start',{requestKey,argv:a.argv,...(a.cwd!==undefined?{cwd:a.cwd}:{}),...(a.timeoutMs!==undefined?{timeoutMs:a.timeoutMs}:{})});}catch(error){error.safeMessage=true;error.message=`${error.message} execution_id=${id}`;throw error;}return{id,result};},
 readAfter:async({ctx:c,target:t,response})=>({expected:response.id,started:response.result,execution:await callPlayground(c,t.record,'status',{id:response.id})}),
 verify:({after})=>after.started.id===after.expected&&after.execution.id===after.expected&&['starting','running','completed','failed'].includes(after.execution.state),
 present:({after})=>({execution_id:after.expected,accepted:after.execution.state!=='uncertain',command_finished:['completed','failed'].includes(after.execution.state),command_succeeded:after.execution.state==='completed'&&after.execution.exitCode===0,execution:after.execution,next:'Use github_playground_read status/logs with this execution_id; applied means accepted, not command success.'})
});
const read=defineRead({name:'github_playground_read',area:'playground',audience:['B','O','Op'],description:'Read Playground capabilities, command status/exit code or complete redacted log windows.',guidance,byteWindow:true,
 properties:{...properties,operation:{type:'string',enum:['capabilities','status','logs']},execution_id:EXECUTION,requestKey:{type:'string',minLength:1,maxLength:128},byteOffset:{type:'integer',minimum:0},byteLength:{type:'integer',minimum:1,maximum:32768},expectedLogHash:{type:'string',pattern:'^[a-f0-9]{64}$'}},required:['operation'],
 handler:async(a,c)=>{
  if(a.operation==='capabilities'&&!a.workspace_id)return{product:"Robinson's Playground",operations:['github_playground_execute','github_playground_read','github_playground_cancel'],runtime_attached:false,setup_required:true,next:'Use an attached workspace_id and repository to check its actual runtime. Installation alone does not attach a runtime.',setup:'https://github.com/Robinson-AI-Systems/github-mcp/blob/main/docs/CODING-WORKSPACES.md'};
  const record=await playgroundRecord(c,a);
  if(a.operation==='capabilities')return await callPlayground(c,record,'capabilities');
  const id=a.execution_id??(a.requestKey?playgroundExecutionId(record.allocation.binding,playgroundRuntimeKey(c,a)):null);
  if(!id)throw new TypeError('execution_id or the original command requestKey is required for status/logs.');
  return presentPlayground(await callPlayground(c,record,a.operation,{id,...(a.operation==='logs'?{offset:a.byteOffset??0,length:a.byteLength??8192,...(a.expectedLogHash?{expectedLogHash:a.expectedLogHash}:{})}:{})}));
 }
});
const cancel=defineGithubWrite({name:'github_playground_cancel',area:'playground',audience:['B','O','Op'],description:'Cancel a Playground command process group and independently read its actual terminal state.',guidance,
 properties:{...properties,execution_id:EXECUTION},required:[...required,'execution_id'],declarations:{production:'never',confirm:'when-needed',profiles:['full']},explain,target,
 read:(a,c,t)=>callPlayground(c,t.record,'status',{id:a.execution_id}),classify:()=>({}),summarize:({target:t})=>`Cancel a Playground command in ${t.owner}/${t.repo}; this does not close or delete the workspace.`,
 apply:({args:a,ctx:c,target:t})=>callPlayground(c,t.record,'cancel',{id:a.execution_id}),readAfter:({args:a,ctx:c,target:t})=>callPlayground(c,t.record,'status',{id:a.execution_id}),
 verify:({args:a,after})=>after.id===a.execution_id&&['completed','failed'].includes(after.state),present:({after})=>({execution_id:after.id,execution:after,process_group_stopped:true,whole_allocation_disposed:false})
});
export const tools=[execute.tool,read.tool,cancel.tool];
export const handlers=Object.fromEntries([execute,read,cancel].map(x=>[x.tool.name,x.handler]));
