// C-16: explicit sequential write composition. Every mutation goes through the
// existing canonical dispatcher and defineWrite journal; the batch never issues
// a GitHub mutation directly. An independent durable intent/lease protects
// against re-running completed steps after timeout, retries or double submit.
import { createHash, randomUUID } from 'node:crypto';
import { validateArgs } from '../core/validate.js';
import { toolsForProfile } from '../core/registry.js';
import { passRefusal } from '../rtc/pass-scope.js';
import { redact } from './util.js';

const OWNER={type:'string',maxLength:39};
const REPO={type:'string',minLength:1,maxLength:100};
const CALL={type:'object',additionalProperties:false,properties:{
  name:{type:'string',minLength:1,maxLength:80},
  args:{type:'object',additionalProperties:true}
},required:['name']};
const readOnly={readOnlyHint:false,destructiveHint:true,idempotentHint:false,openWorldHint:true};
const SAFE_FIELDS=new Set(['sha','branch','branch_head','commit','parent','tree','number','id',
  'head_sha','ref','merge_commit','html_url','run_id','issue_number']);
const SHA=/^[a-fA-F0-9]{40}$/;
const SIMPLE=/^[A-Za-z0-9._/-]{1,250}$/;
const REF_KEYS=new Set(['$from','path']);
const isObj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const hash=s=>createHash('sha256').update(s).digest('hex');
const connectionId=ctx=>ctx.connection?.client_id??ctx.connection?.pass_id??null;
const digest=x=>hash(JSON.stringify(x));
const deny=(reason,more={})=>({done:false,status:'refused',reason:redact(String(reason)).slice(0,300),...more});
const empty=x=>x===undefined||x===null;
const scoped=(a,ctx)=>({owner:a.owner??ctx.connection?.default_account,repo:a.repo});
function cleanRefValue(key,v){
  if(['number','id','run_id','issue_number'].includes(key))
    return Number.isSafeInteger(v)&&v>0?v:null;
  if(typeof v!=='string')return null;
  if(['sha','branch_head','commit','parent','tree','head_sha','merge_commit'].includes(key))
    return SHA.test(v)?v.toLowerCase():null;
  if(key==='html_url')return /^https:\/\/github\.com\/[A-Za-z0-9._/-]{1,500}$/.test(v)?v:null;
  return SIMPLE.test(v)?v:null;
}
function reference(body){
  const result=isObj(body?.result)?body.result:{};
  const combined={...body,...result};
  const clean={};
  for(const key of SAFE_FIELDS){
    const value=cleanRefValue(key,combined[key]);
    if(value!==null)clean[key]=value;
  }
  return clean;
}
function marker(v){
  return isObj(v)&&Object.keys(v).length===2&&Object.keys(v).every(k=>REF_KEYS.has(k))&&
    Number.isInteger(v.$from)&&typeof v.path==='string';
}
function validateReferences(value,index,depth=0){
  if(depth>7)throw new TypeError('Step arguments are nested too deeply.');
  if(Array.isArray(value)){for(const part of value)validateReferences(part,index,depth+1);return;}
  if(!isObj(value))return;
  const keys=Object.keys(value);
  if(keys.some(k=>['__proto__','constructor','prototype'].includes(k)))
    throw new TypeError('Unsafe field name in step arguments.');
  if('$from' in value||'path' in value&&keys.length===2){
    if(!marker(value)||value.$from<0||value.$from>=index||
      !/^(?:result\.)?[a-z_]{2,24}$/.test(value.path)||
      !SAFE_FIELDS.has(value.path.replace(/^result\./,'')))
      throw new TypeError('A step may reference only a safe scalar output of a completed earlier step.');
    return;
  }
  for(const part of Object.values(value))validateReferences(part,index,depth+1);
}
function hasReference(value){
  if(Array.isArray(value))return value.some(hasReference);
  if(!isObj(value))return false;
  return marker(value)||Object.values(value).some(hasReference);
}
function resolve(value,completed){
  if(Array.isArray(value))return value.map(x=>resolve(x,completed));
  if(!isObj(value))return value;
  if(marker(value)){
    const key=value.path.replace(/^result\./,'');
    const row=completed[value.$from];
    const found=row?.reference?.[key];
    if(row?.status!=='applied'||cleanRefValue(key,found)===null)
      throw new TypeError('Referenced earlier output is not independently confirmed or is unavailable.');
    return found;
  }
  return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,resolve(v,completed)]));
}
function canDelegate(tool){
  if(tool?.writeContract==='defineWrite-v1'&&tool.writes===true)return true;
  return tool?.area==='workflow'&&tool.usesRegistry===true&&tool.passthrough===true&&
    Array.isArray(tool.delegatedWrites)&&tool.delegatedWrites.length>0&&
    tool.name!=='github_write_batch'&&tool.delegatedWrites.every(n=>n!=='*');
}
function topScope(args,ctx){
  const account=args.owner??ctx.connection?.default_account;
  const allowed=ctx.connection?.accounts??[];
  if(!account||!allowed.some(a=>a.toLowerCase()===String(account).toLowerCase()))
    throw new TypeError('The selected account is not authorized by this connection.');
  return account;
}
function prepare(args,ctx){
  if(!Array.isArray(args.steps)||args.steps.length<1||args.steps.length>8)
    throw new TypeError('Provide between 1 and 8 sequential operations.');
  const account=topScope(args,ctx);
  const allowed=new Map(toolsForProfile(ctx.registry,ctx.connection.profile).map(t=>[t.name,t]));
  const checked=args.steps.map((s,i)=>{
    const t=allowed.get(s.name);
    if(!canDelegate(t))throw new TypeError('Step '+(i+1)+': not a visible guarded write tool ('+String(s.name).slice(0,80)+').');
    const given=s.args??{};
    if(!isObj(given))throw new TypeError('Step '+(i+1)+': arguments must be an object.');
    if(Object.hasOwn(given,'requestKey'))
      throw new TypeError('Step '+(i+1)+': batch-owned request keys cannot be replaced.');
    validateReferences(given,i);
    const a={...given,...(args.repo&&!given.repo&&t.inputSchema?.properties?.repo?{repo:args.repo}:{}),
      ...(!given.owner&&t.inputSchema?.properties?.owner?{owner:account}:{})};
    const owner=a.owner??account;
    if(!ctx.connection.accounts.some(x=>x.toLowerCase()===String(owner).toLowerCase()))
      throw new TypeError('Step '+(i+1)+': account is outside this connection.');
    const refusal=passRefusal({tool:t,args:a,connection:ctx.connection});
    if(refusal)throw new TypeError('Step '+(i+1)+': '+refusal);
    if(s.name==='github_content_commit_git_data'&&empty(a.expectedHead))
      throw new TypeError('Git-data commit steps require a literal or referenced exact expectedHead.');
    const schema=t.inputSchema??{type:'object',properties:{}};
    if(!hasReference(a)){
      const p=validateArgs(schema,{
        ...a,...(schema.properties?.requestKey?{requestKey:'batch-preflight'}:{}),
        ...(schema.properties?.dryRun?{dryRun:true}:{}),
        ...(schema.properties?.confirm?{confirm:false}:{})});
      if(p)throw new TypeError('Step '+(i+1)+': '+p);
    }else{
      for(const key of schema.required??[])if(!Object.hasOwn(a,key))
        throw new TypeError('Step '+(i+1)+': '+key+' is required.');
      for(const key of Object.keys(a))if(!Object.hasOwn(schema.properties??{},key)&&
        schema.additionalProperties!==true)
        throw new TypeError('Step '+(i+1)+': unknown field '+key.slice(0,50));
    }
    return {name:s.name,args:a,tool:t};
  });
  return {account,checked};
}
function intent(checked){
  // JSON order is not a meaningful change to the user's authorization intent.
  const ordered=(x)=>Array.isArray(x)?x.map(ordered):isObj(x)?
    Object.fromEntries(Object.keys(x).sort().filter(k=>k!=='confirm'&&k!=='dryRun')
      .map(k=>[k,ordered(x[k])])):x;
  return digest(checked.map(s=>({name:s.name,args:ordered(s.args)})));
}
function item(i,s,status,more={}){
  return {index:i,name:s.name,status,...more};
}
function respond(status,items,more={}){
  const succeeded=items.filter(x=>x.status==='applied').length;
  return {done:status==='complete'||status==='replayed',status,
    completed:succeeded,attempted:items.length,items,
    atomic:false,rollback:false,...more};
}
function resultBody(r){
  if(isObj(r?.structuredContent))return r.structuredContent;
  try{
    const t=r?.content?.find(c=>c.type==='text')?.text;
    return isObj(JSON.parse(t))?JSON.parse(t):null;
  }catch{return null;}
}
function outcome(r){
  const body=resultBody(r);
  if(!body||r?.isError)return {status:'uncertain',reason:'The guarded writer did not return a trustworthy confirmed read-back.'};
  if(body.status==='applied'&&body.confirmed===true&&body.done===true)
    return {status:'applied',reference:reference(body),verified:true};
  if(['pr_opened','existing','labels_applied','merged'].includes(body.status)&&body.done===true)
    return {status:'applied',reference:reference(body),verified:true};
  if(['needs_confirmation','refused','refused_by_guard','preview','not_applied'].includes(body.status))
    return {status:'refused',reason:redact(String(body.reason??body.next_action??body.status)).slice(0,240)};
  return {status:'uncertain',reason:'The writer reported '+redact(String(body.status??'unknown')).slice(0,70)+
    '; no automatic retry is safe without independent reconciliation.'};
}
async function checkPrefix(checked,items,ctx){
  // Before resuming an interrupted batch, prove the last observed branch head
  // and created PR still exist; an earlier branch-create SHA may legitimately be
  // superseded by the later commit in the same batch.
  const latest=new Map();
  for(const row of items){
    if(row.status!=='applied')return false;
    const step=checked[row.index];
    if(['github_branch_create','github_content_commit_git_data'].includes(row.name)){
      const branch=step.args.branch,repo=step.args.repo,owner=step.args.owner;
      if(typeof branch!=='string'||!repo)return false;
      const sha=row.reference?.branch_head??row.reference?.sha;
      if(!SHA.test(sha??''))return false;
      latest.set(owner+'/'+repo+'/'+branch,{owner,repo,branch,sha});
    }else if(row.name!=='github_workflow_open_pr'){
      // Generic completed writes are at-most-once. Do not auto-continue an
      // interrupted composition if no bounded exact read-back is available.
      return false;
    }
  }
  for(const v of latest.values()){
    const r=await ctx.callTool('github_branch_get',{owner:v.owner,repo:v.repo,branch:v.branch});
    if(r?.isError||resultBody(r)?.head!==v.sha)return false;
  }
  for(const row of items.filter(x=>x.name==='github_workflow_open_pr')){
    const number=row.reference?.number;
    if(!Number.isInteger(number))return false;
    const step=checked[row.index];
    const r=await ctx.callTool('github_pr_get',{owner:step.args.owner,repo:step.args.repo,number});
    const p=resultBody(r);
    if(r?.isError||!p||p.number!==number||p.state!=='open'||
      (row.reference.head_sha&&p.head_sha!==row.reference.head_sha))return false;
  }
  return true;
}
export async function guardedWriteBatch(args,ctx){
  const start=ctx.now();
  let prepared;
  try{prepared=prepare(args,ctx);}catch(e){return deny(e.message);}
  const {account,checked}=prepared;
  const planDigest=intent(checked);
  const preview=checked.map((s,i)=>item(i,s,'planned',{
    scope:{owner:s.args.owner??account,repo:s.args.repo??null},
    ...(hasReference(s.args)?{depends_on_prior_steps:true}:{})}));
  if(args.dryRun===true)return respond('preview',preview,{
    done:false,requires_confirm:checked.some(s=>s.tool.inputSchema?.properties?.confirm),
    note:'No GitHub write or batch claim was made. Every step will use its own guards and confirmation.'});
  if(!args.batchKey||typeof args.batchKey!=='string')
    return deny('Supply a stable batchKey to make retries and double-submits safe.');
  const conn=connectionId(ctx);
  if(!conn||!ctx.db?.claimWriteBatch||!ctx.db?.saveWriteBatch)
    return deny('Durable scoped batch journal is unavailable, so nothing was sent.');
  const key=hash([conn,account.toLowerCase(),args.batchKey].join('|'));
  const lease=randomUUID();
  let claimed;
  try{claimed=await ctx.db.claimWriteBatch({key,connection:conn,account,intentHash:planDigest,lease});}
  catch{return deny('The durable batch could not be claimed. No GitHub mutation was sent.');}
  if(claimed?.status==='conflict')
    return deny('This batchKey was previously used for a different authorization intent. Use a new key.');
  if(claimed?.status==='denied')
    return deny('That batch is outside this connection or account.');
  if(claimed?.status==='complete')
    return respond('replayed',claimed.items??[],{replayed:true,source:'durable_verified_receipts',
      next_action:'All recorded operations were individually read back when first applied; no write was repeated.'});
  if(claimed?.status==='uncertain')
    return respond('reconciliation_required',claimed.items??[],{
      next_action:'An earlier mutation has an uncertain outcome. Inspect GitHub and the individual change journal; start a NEW batch for only remaining actions with exact current heads. Never repeat the uncertain write automatically.'});
  if(claimed?.claimed!==true)
    return respond('in_progress',[],{next_action:'The same batch is active in another request. No concurrent step was sent.'});
  let items=Array.isArray(claimed.items)?claimed.items:[];
  const save=async(next,status)=>{
    const ok=await ctx.db.saveWriteBatch({key,connection:conn,account,lease,items:next,status});
    if(!ok)throw new Error('The batch lease or journal write could not be verified.');
    items=next;
  };
  const stopped=items.find(x=>x.status!=='applied');
  if(stopped?.status==='started'||stopped?.status==='uncertain'){
    try{await save(items,'uncertain');}catch{}
    return respond('reconciliation_required',items,{
      next_action:'A mutation may have reached GitHub before the result was saved. Check current branch/PR and the individual journal; new explicit batch required for remaining work.'});
  }
  if(stopped){
    try{await save(items,'partial');}catch{}
    return respond('stopped',items,{next_action:'This batch already stopped without applying later steps. Read the outcomes and start a new batch for only remaining authorized changes.'});
  }
  if(items.length&&!(await checkPrefix(checked,items,ctx))){
    try{await save(items,'uncertain');}catch{}
    return respond('reconciliation_required',items,{next_action:'Previously confirmed branch/PR state could not be independently reverified; no new mutation was sent.'});
  }
  for(let i=items.length;i<checked.length;i++){
    const step=checked[i];
    if(ctx.now()-start>43000){
      try{await save(items,'partial');}catch{}
      return respond('pending',items,{next_action:'Time budget reached before another write; retry the SAME batchKey to continue only verified incomplete steps.'});
    }
    let callArgs;
    try{
      callArgs=resolve(step.args,items);
      const p=step.tool.inputSchema?.properties??{};
      if(p.requestKey)callArgs.requestKey=hash(key+':'+i+':'+step.name).slice(0,64);
      if(p.confirm)callArgs.confirm=args.confirm===true&&step.args.confirm!==false;
      if(p.dryRun)callArgs.dryRun=false;
      const error=validateArgs(step.tool.inputSchema,callArgs);
      if(error)throw new TypeError(error);
    }catch(e){
      const row=item(i,step,'refused',{reason:redact(String(e.message)).slice(0,240)});
      try{await save([...items,row],'partial');}catch{}
      return respond('stopped',items,{next_action:'The next step did not pass argument validation; no later step was sent.'});
    }
    try{
      await save([...items,item(i,step,'started')],'running');
    }catch{return respond('reconciliation_required',items,{next_action:'Failed to persist the step intent before sending; no write was started.'});}
    let result;
    try{result=await ctx.callTool(step.name,callArgs);}
    catch{
      try{await save([...items,item(i,step,'uncertain',{reason:'The delegated write interrupted before its result could be confirmed.'})],'uncertain');}catch{}
      return respond('reconciliation_required',items,{next_action:'The delegated write may have applied. Check provider state and its individual journal before a NEW batch.'});
    }
    const observed=outcome(result);
    const row=item(i,step,observed.status,{...observed,
      ...(observed.status==='applied'?{request_key:callArgs.requestKey??null}:{})});
    try{await save([...items,row],observed.status==='uncertain'?'uncertain':
      observed.status==='refused'?'partial':i===checked.length-1?'complete':'running');}
    catch{return respond('reconciliation_required',items,{next_action:'The provider result could not be durably recorded; no following step was sent.'});}
    if(observed.status!=='applied')
      return respond(observed.status==='uncertain'?'reconciliation_required':'stopped',items,{
        next_action:observed.status==='uncertain'
          ?'Verify the possibly applied step on GitHub and in the write journal. Do not automatically replay it.'
          :'The guard or provider refused this step; later steps were not called. New batchKey for changed plan.'});
  }
  return respond('complete',items,{next_action:'All mutations were individually guarded, journaled and independently read back. GitHub operations are not transactional.'});
}
export const tools=[{
  name:'github_write_batch',area:'workflow',audience:['B','Op'],usesRegistry:true,
  passthrough:true,boundsResult:true,profiles:['everyday','full'],
  delegatedWrites:['*'],
  description:'Run authorized sequential guarded writes with durable per-step receipts and stop-on-error.',
  inputSchema:{type:'object',properties:{
    owner:OWNER,repo:REPO,
    batchKey:{type:'string',minLength:4,maxLength:128,description:'One stable key for this plan across retries; never reuse for different steps'},
    steps:{type:'array',minItems:1,maxItems:8,items:CALL},
    dryRun:{type:'boolean'},confirm:{type:'boolean'}
  },required:['batchKey','steps'],additionalProperties:false},
  annotations:readOnly
}];
export const handlers={github_write_batch:guardedWriteBatch};
