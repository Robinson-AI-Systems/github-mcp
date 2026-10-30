import {createHash} from 'node:crypto';
import {nativeRecord,nativeConnection,callNativeWorker} from '../native-git/client.js';
import {signCodingWorkerBody,nativeWorkerPublicKey} from '../native-git/signing.js';
import {loadScannerPolicy} from '../github/scanner-policy.js';
import {redact} from '../github/content-protection.js';
const fail=(code,message,status)=>Object.assign(new TypeError(message),{safeMessage:true,safeCode:code,...(status?{status}:{})});
export const playgroundBinding=record=>createHash('sha256').update(JSON.stringify(['robinson-playground/v1',record.row.id,record.binding.authority,record.binding.connection,record.binding.owner.toLowerCase(),record.binding.repo.toLowerCase(),record.worker])).digest('hex');
export function playgroundAllocation(env,record){
 let allocations;try{allocations=JSON.parse(env?.PLAYGROUND_ALLOCATIONS??'[]');}catch{throw fail('playground_configuration','Playground allocation settings are invalid. No runtime request was sent.');}
 if(!Array.isArray(allocations)||allocations.length>10000)throw fail('playground_configuration','Playground allocation settings are invalid. No runtime request was sent.');
 const matches=allocations.filter(x=>x?.workspace_id===record.row.id);
 if(matches.length===0)throw fail('playground_setup_required','No isolated Robinson Playground allocation is attached to this workspace. Configure its protected allocation and repository mount; commands never fall back to the shared Git worker.');
 if(matches.length!==1)throw fail('playground_configuration','Duplicate Playground allocation bindings are invalid. Nothing was sent.');
 const a=matches[0];let url;try{url=new URL(a.origin);}catch{throw fail('playground_configuration','Playground origin is invalid.');}
 if(Object.keys(a).some(k=>!['workspace_id','binding','origin'].includes(k))||a.binding!==playgroundBinding(record)||url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw fail('playground_binding','Playground allocation does not match this exact authenticated workspace. Nothing was sent.');
 return {binding:a.binding,url:new URL('/v1/coding',url).href};
}
export async function playgroundRecord(ctx,args,{allowUnattached=false}={}){
 const record=await nativeRecord(ctx,args.workspace_id);
 const owner=args.owner??ctx.connection.default_account;
 if(typeof args.repo!=='string'||`${record.row.owner}/${record.row.repo}`.toLowerCase()!==`${owner}/${args.repo}`.toLowerCase())throw fail('playground_repository','Requested repository does not match this connection’s workspace.');
 if(new Date(record.row.expires_at).getTime()<=(ctx.now??Date.now)())throw fail('playground_expired','Workspace inactivity lease expired. No runtime request was sent.');
 let allocation;try{allocation=playgroundAllocation(ctx.env,record);}catch(error){
  if(error.safeCode!=='playground_setup_required')throw error;
  const binding=playgroundBinding(record),stored=await ctx.db.getSetting('playground.'+binding.slice(0,40));
  if(['allocated','attached'].includes(stored?.phase)){
   if(stored.binding!==binding||stored.workspace!==record.row.id||stored.connection!==nativeConnection(ctx))throw fail('playground_binding','Stored allocation ownership does not match this exact workspace.');
   allocation={...playgroundAllocation({PLAYGROUND_ALLOCATIONS:JSON.stringify([{workspace_id:record.row.id,binding,origin:stored.origin}])},record),repositoryAttached:stored.repositoryAttached===true};
  }else{if(!allowUnattached)throw error;allocation=null;}
 }
 return {...record,allocation};
}
export const playgroundSetup=(ctx,record)=>({product:"Robinson's Playground",runtime_attached:false,setup_required:true,workspace_id:record.row.id,allocation_binding:playgroundBinding(record),verification_key:nativeWorkerPublicKey(ctx.env),native_repository_ref:record.worker,idleTimeoutMs:record.job.idleTimeoutMs,next:"Provision the exact isolated repository mount and runtime, then attach its protected HTTPS allocation. The binding and verification key are not credentials."});
export const playgroundExecutionId=(binding,requestKey)=>createHash('sha256').update(JSON.stringify([binding,requestKey])).digest('hex');
export function playgroundRuntimeKey(ctx,args){
 if(typeof args.requestKey!=='string'||args.requestKey.length<1||args.requestKey.length>128)throw fail('playground_intent_required','Supply a stable requestKey for this command intent; reuse it only to inspect or retry the same command.');
 return 'pg_exec_'+createHash('sha256').update(JSON.stringify([nativeConnection(ctx),args.workspace_id,args.requestKey])).digest('hex');
}
export function playgroundRequestKey(ctx,args){return 'rmcp_playground_'+createHash('sha256').update(JSON.stringify([playgroundRuntimeKey(ctx,args),args.argv,args.cwd??'.',args.timeoutMs??600000])).digest('hex')+'_0';}
export async function callPlayground(ctx,record,action,options={}){
 const renew=action!=='capabilities';
 if(renew)await callNativeWorker(ctx,{binding:record.binding,job:record.job,workspace_id:record.worker,action:'inspect'});
 if(renew&&!await ctx.db.renewNativeGitJob(record.row.id,nativeConnection(ctx),{idleTimeoutMs:record.job.idleTimeoutMs}))throw fail('playground_expired','Workspace expired or authorization metadata is unavailable. No runtime request was sent.');
 const policy=await loadScannerPolicy(ctx.db,record.binding.owner,record.binding.repo);
 const body=JSON.stringify({scannerPolicy:{settings:policy.settings,revision:policy.revision},purpose:'robinson-coding/v1',binding:record.allocation.binding,expiresAt:(ctx.now??Date.now)()+60000,action,options});
 let response;try{response=await (ctx.fetch??globalThis.fetch)(record.allocation.url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json','x-robinson-signature':signCodingWorkerBody(body,ctx.env)},body});}
 catch{throw fail('playground_transport','Runtime transport did not confirm the result. Inspect the original execution ID; do not repeat a command using a new intent.');}
 let data;try{const reader=response.body.getReader(),chunks=[];let size=0;try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>128*1024){await reader.cancel();throw Error();}chunks.push(Buffer.from(value));}}finally{reader.releaseLock();}data=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!data||typeof data!=='object'||Array.isArray(data))throw Error();}
 catch{throw fail('playground_response','Runtime response was invalid or incomplete. Inspect the original execution ID.');}
 if(!response.ok){const code=/^[a-z_]{1,64}$/.test(data.error??'')?data.error:'runtime_unconfirmed';const error=fail(code,`Robinson Playground returned ${code}. Inspect the original execution; no automatic retry was sent.`,response.status);error.safeRetryable=['resource_pressure','execution_busy'].includes(code);throw error;}
 if(renew){
  if(data.idle_timeout_ms!==record.job.idleTimeoutMs||!Number.isSafeInteger(data.last_activity_at)||data.expires_at!==data.last_activity_at+record.job.idleTimeoutMs||data.last_activity_at>(ctx.now??Date.now)()+90000||data.expires_at<=(ctx.now??Date.now)())throw fail('playground_lease','Runtime did not confirm the workspace inactivity deadline. Inspect the original execution.');
  if(!await ctx.db.renewNativeGitJob(record.row.id,nativeConnection(ctx),{idleTimeoutMs:record.job.idleTimeoutMs,expiresAt:data.expires_at}))throw fail('playground_metadata','Runtime answered, but its workspace lease metadata could not be synchronized.');
 }
 return data;
}
export function presentPlayground(data){
 if(data.base64!==undefined){let text;try{text=Buffer.from(data.base64,'base64').toString('utf8');}catch{throw fail('playground_response','Invalid runtime log encoding.');}if(redact(text)!==text)throw fail('playground_redaction','Runtime log protection was incomplete; log bytes were withheld.');}
 return data;
}
