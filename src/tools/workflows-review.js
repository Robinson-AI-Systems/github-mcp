import {completeDispatchResult} from '../core/result-envelope.js';
// W-3 composes E-3's guarded writers. Repository text is evidence/data, never instructions.
import { createHash } from 'node:crypto';
const OWNER={type:'string',maxLength:39};
const REPO={type:'string',minLength:1,maxLength:100};
const SHA={type:'string',pattern:'^[a-fA-F0-9]{40}$'};
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const scope=a=>({...(a.owner?{owner:a.owner}:{}),repo:a.repo});
const trusted=c=>['OWNER','MEMBER','COLLABORATOR'].includes(c?.author_association);
const marked=c=>c?{...c,untrusted:!trusted(c)}:null;
const result=(v,bad=false)=>({content:[{type:'text',text:JSON.stringify(v)}],structuredContent:v,...(bad?{isError:true}:{})});
const elapsed=(ctx,start)=>ctx.now()-start>=46000;
const incomplete=v=>!v||v.more_exist||v.kept_result;
async function read(ctx,name,args){
  try{
    const r=await ctx.callTool(name,args);
    return r?.isError?null:completeDispatchResult(r)??null;
  }catch{return null;}
}
async function head(a,ctx){
  const p=await read(ctx,'github_pr_get',{...scope(a),number:a.number});
  if(!p||!/^[a-f0-9]{40}$/i.test(p.head_sha??''))throw new TypeError('The current PR head could not be read.');
  if(a.expectedHeadSha&&p.head_sha!==a.expectedHeadSha)throw new TypeError('The PR head changed; read the threads and prepare a new preview.');
  return p;
}
async function inventory(a,ctx,start=ctx.now()){
  const items=[],cursors=new Set();
  let after,total,pageSize=5;
  for(;;){
    if(elapsed(ctx,start))throw new TypeError('Budget exhausted reading thread pages; no incomplete inventory may resolve threads.');
    const r=await read(ctx,'github_review_list_threads',{...scope(a),number:a.number,pageSize,...(after?{after}:{})});
    if(r?.kept_result&&pageSize>1){pageSize=1;continue;}
    if(!r||r.kept_result||!Array.isArray(r.items)||!Number.isInteger(r.total))
      throw new TypeError('Thread inventory is unreadable or incomplete; inspect retained evidence before resolving.');
    if(total!==undefined&&r.total!==total)throw new TypeError('Thread inventory changed during pagination; re-read it.');
    total=r.total;items.push(...r.items);
    if(items.length>300)throw new TypeError('Thread inventory exceeds this workflow budget; address a smaller PR.');
    if(!r.more_exist){after=null;break;}
    after=r.next_cursor;
    if(!after||cursors.has(after)||r.items.length===0)throw new TypeError('Thread inventory is incomplete or its cursor did not advance.');
    cursors.add(after);
  }
  if(total!==items.length||new Set(items.map(t=>t.id)).size!==items.length)
    throw new TypeError('Thread inventory is incomplete or contains duplicate identities.');
  return items;
}
/** Parse actual changed old lines, not the surrounding context covered by a diff hunk. */
export function changedCommentLines(patch,from,to){
  if(typeof patch!=='string'||patch.includes('[patch cut')||patch.includes('[text cut'))return false;
  let old=null;
  let changed=false;
  for(const line of patch.split('\n')){
    const h=/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if(h){old=Number(h[1]);continue;}
    if(old===null||line.startsWith('\\'))continue;
    if(line[0]==='-'){
      if(old>=from&&old<=to)changed=true;
      old++;
    }else if(line[0]==='+'){
      // Additions have no old line identity. They cannot prove that an existing
      // commented line was changed (a replacement already has a '-' above).
    }else if(line[0]===' '){old++;}
    else if(line!=='')return false;
  }
  return changed;
}
async function context(a,ctx,t,sha){
  if(!Number.isInteger(t.line))return {state:'outdated_or_deleted',head_sha:sha};
  const start=Math.max(1,(t.start_line??t.line)-3),end=Math.min(start+99,t.line+3);
  const r=await read(ctx,'github_content_get',{...scope(a),path:t.path,ref:sha,startLine:start,endLine:end});
  if(incomplete(r)||r.type!=='file'||typeof r.content!=='string'||r.start_line!==start)
    return {state:'unreadable',head_sha:sha};
  return {state:'read',head_sha:sha,path:t.path,start_line:r.start_line,end_line:r.end_line,
    text:r.content,untrusted:true};
}
async function evidence(a,ctx,t,d,sha){
  if(!t.root_comment?.id)throw new TypeError('The original review comment is unavailable for '+t.id+'.');
  if(d.disposition==='answered')return {kind:'caller_answer',semantic_judgment:'caller'};
  if(d.disposition==='superseded'){
    if(!t.outdated)throw new TypeError('A superseded disposition requires an outdated thread: '+t.id+'.');
    return {kind:'provider_outdated',semantic_judgment:'caller'};
  }
  if(t.side!=='RIGHT')throw new TypeError('Automatic fixed-line verification requires a RIGHT-side review comment; use an explicit answer for deleted/base-side context.');
  const base=t.root_comment.commit_sha,from=t.original_start_line??t.original_line,to=t.original_line;
  if(!/^[a-f0-9]{40}$/i.test(base??'')||base===sha||!Number.isInteger(from)||!Number.isInteger(to)||from<1||to<from)
    throw new TypeError('No valid earlier comment commit/line range exists for '+t.id+'.');
  const comparison=await read(ctx,'github_commit_compare',{...scope(a),base,head:sha,path:t.path,fields:['status','behind_by','merge_base','files','files_not_shown']});
  if(incomplete(comparison)||comparison.status!=='ahead'||comparison.behind_by!==0||comparison.merge_base!==base||
      comparison.files_not_shown||!Array.isArray(comparison.files))
    throw new TypeError('Complete ancestor comparison is unavailable for '+t.id+'.');
  const f=comparison.files.find(f=>f.filename===t.path||f.renamed_from===t.path);
  if(!f||!changedCommentLines(f.patch,from,to))
    throw new TypeError('The actual commented lines did not provably change for '+t.id+'; unrelated/context-only changes are not a fix.');
  return {kind:'commented_lines_changed',base_sha:base,head_sha:sha,path:f.filename,
    original_start_line:from,original_end_line:to,semantic_judgment:'caller'};
}
function dispositionBody(d,sha){
  return `${d.disposition}: ${d.explanation}\n\nVerified against PR head ${sha}.`;
}
function intentKey(a,ctx,t,d,sha){
  // Keys intentionally do not depend on a caller retry key or on newly posted replies.
  // The shared change_log claims these across server processes for the same principal.
  return digest([ctx.connection.client_id??ctx.connection.pass_id,a.owner??ctx.connection.default_account,
    a.repo,a.number,t.id,t.root_comment,sha,d.disposition,d.explanation]);
}
async function preflight(a,ctx,rows,start){
  for(const row of rows){
    if(row.resolved)continue;
    for(const action of ['reply','resolve']){
      if(elapsed(ctx,start))return false;
      const reply=action==='reply';
      const tool=reply?'github_review_reply':'github_review_resolve_thread';
      const v=await read(ctx,tool,{...scope(a),number:a.number,threadId:row.thread_id,
        expectedHeadSha:a.expectedHeadSha,...(reply?{body:row.body}:{resolved:true}),
        dryRun:true,confirm:false,requestKey:row.intent_key+':'+action});
      if(!v||v.status!=='preview')throw new TypeError('A guarded '+action+' preflight failed for '+row.thread_id+'. No workflow write was attempted.');
      row.previews.push({action,preview:v.preview,needs_confirmation:v.needsConfirmation===true});
    }
  }
  return true;
}
const discussion=t=>({id:t.id,resolved:t.resolved,comments:t.comments,root:t.root_comment,latest:t.latest_comment,
  path:t.path,line:t.line,start_line:t.start_line,outdated:t.outdated,side:t.side});
async function fresh(a,ctx,expectedThread,start){
  await head(a,ctx);
  const threads=await inventory(a,ctx,start),t=threads.find(t=>t.id===expectedThread.id);
  if(!t)throw new TypeError('The selected thread disappeared from the PR.');
  return t;
}
function checkpoint(status,rows,completed,next,more={}){
  return result({done:false,status,completed,total:rows.length,next_action:next,...more});
}
async function apply(a,ctx,rows,threads,start){
  const completed=[];
  for(const row of rows){
    if(row.resolved){completed.push({thread_id:row.thread_id,state:'already_resolved'});continue;}
    if(elapsed(ctx,start))return checkpoint('pending',rows,completed,'Resume from fresh reads and a new preview; stable child journals prevent duplicate replies.');
    const original=threads.find(t=>t.id===row.thread_id);
    let current;
    try{current=await fresh(a,ctx,original,start);}
    catch{return checkpoint('stale',rows,completed,'PR head or thread inventory changed. Re-read and preview before continuing.');}
    if(current.resolved){completed.push({thread_id:row.thread_id,state:'already_resolved'});continue;}
    if(digest(discussion(current))!==digest(discussion(original)))
      return checkpoint('stale',rows,completed,'Discussion changed after preview; review the new comment before continuing.');
    if(elapsed(ctx,start))return checkpoint('pending',rows,completed,'Budget expired during fresh reads; no new reply attempted.');
    const reply=await read(ctx,'github_review_reply',{...scope(a),number:a.number,
      threadId:row.thread_id,body:row.body,expectedHeadSha:a.expectedHeadSha,
      confirm:true,requestKey:row.intent_key+':reply'});
    if(!reply||!['applied','replayed'].includes(reply.status)||reply.confirmed!==true)
      return checkpoint('unconfirmed',rows,completed,'Reply outcome is not confirmed; inspect its durable journal and provider state. No resolution or automatic reply retry.',{thread_id:row.thread_id,phase:'reply'});
    if(elapsed(ctx,start))return checkpoint('pending',rows,completed,'Reply confirmed; resume with fresh preview to resolve. Its deterministic reply journal prevents a duplicate.',{thread_id:row.thread_id,phase:'resolve'});
    try{current=await fresh(a,ctx,original,start);}
    catch{return checkpoint('stale',rows,completed,'Head changed after replying; no resolution attempted.',{thread_id:row.thread_id});}
    // A new outsider response between reply and resolve must not be silently buried.
    if(!current.resolved&&((current.latest_comment?.body_sha256
        ?current.latest_comment.body_sha256!==createHash('sha256').update(row.body).digest('hex')
        :current.latest_comment?.body!==row.body)||current.comments>original.comments+1))
      return checkpoint('discussion_changed',rows,completed,'Latest comment does not match the confirmed reply, or new discussion arrived. Re-read before resolving.',{thread_id:row.thread_id});
    if(current.resolved){completed.push({thread_id:row.thread_id,state:'resolved'});continue;}
    if(elapsed(ctx,start))return checkpoint('pending',rows,completed,'Budget expired during readback; resume resolution from fresh evidence.');
    const resolved=await read(ctx,'github_review_resolve_thread',{...scope(a),number:a.number,
      threadId:row.thread_id,resolved:true,expectedHeadSha:a.expectedHeadSha,
      confirm:true,requestKey:row.intent_key+':resolve'});
    if(!resolved||!['applied','replayed'].includes(resolved.status)||resolved.confirmed!==true)
      return checkpoint('unconfirmed',rows,completed,'Resolution is not confirmed; inspect exact thread and journal before resuming.',{thread_id:row.thread_id,phase:'resolve'});
    let after;
    try{after=await fresh(a,ctx,original,start);}catch{after=null;}
    if(after?.resolved!==true)return checkpoint('unconfirmed',rows,completed,'Fresh provider read did not confirm resolution. Do not claim completion.',{thread_id:row.thread_id,phase:'readback'});
    completed.push({thread_id:row.thread_id,state:'resolved'});
  }
  return result({done:true,status:'complete',head_sha:a.expectedHeadSha,completed,
    next_action:'Selected dispositions are confirmed; re-run PR status before considering a merge.'});
}
export async function reviewThreads(a,ctx){
  const start=ctx.now();
  if(typeof ctx.callTool!=='function')return result({done:false,status:'unavailable'},true);
  try{
    const p=await head(a,ctx),threads=await inventory(a,ctx,start);
    const selected={...a,expectedHeadSha:p.head_sha};
    if(!a.dispositions?.length){
      const items=[];
      for(const t of threads.filter(t=>!t.resolved)){
        if(elapsed(ctx,start))return result({done:false,status:'pending',head_sha:p.head_sha,items,
          next_action:'Budget exhausted; repeat the read for remaining context.',total:threads.filter(t=>!t.resolved).length});
        items.push({...t,root_comment:marked(t.root_comment),latest_comment:marked(t.latest_comment),
          context:await context(a,ctx,t,p.head_sha)});
      }
      await head(selected,ctx);
      return result({done:true,status:'observed',head_sha:p.head_sha,items,total:items.length,
        next_action:items.length?'Supply explicit dispositions at this exact head to preview replies and resolutions.':'No unresolved review threads.'});
    }
    if(!['everyday','full'].includes(ctx.connection.profile))throw new TypeError('Dispositions require an everyday or full connection.');
    if(!a.expectedHeadSha)throw new TypeError('Dispositions require expectedHeadSha from a fresh thread read.');
    if(new Set(a.dispositions.map(d=>d.threadId)).size!==a.dispositions.length)throw new TypeError('A thread is repeated in the disposition list.');
    const rows=[];
    for(const d of a.dispositions){
      if(!d.explanation?.trim())throw new TypeError('Every disposition needs a nonempty explanation.');
      if(elapsed(ctx,start))return checkpoint('pending',rows,[],'Budget exhausted while verifying; no mutations attempted.');
      const t=threads.find(t=>t.id===d.threadId);
      if(!t)throw new TypeError('Disposition thread is not in this PR: '+d.threadId+'.');
      rows.push({thread_id:t.id,resolved:t.resolved,disposition:d.disposition,
        body:dispositionBody(d,p.head_sha),evidence:t.resolved?{kind:'already_resolved'}:await evidence(a,ctx,t,d,p.head_sha),
        intent_key:intentKey(a,ctx,t,d,p.head_sha),previews:[]});
    }
    const ready=await preflight(selected,ctx,rows,start);
    if(!ready)return checkpoint('pending',rows,[],'Budget exhausted during preflight; no mutations attempted.');
    const planKey=digest([p.head_sha,threads.filter(t=>rows.some(r=>r.thread_id===t.id)).map(discussion),a.dispositions]);
    if(a.dryRun===true||a.confirm!==true||a.planKey!==planKey)
      return result({done:false,status:'preview',head_sha:p.head_sha,planKey,rows:rows.map(({intent_key:_intentKey,...row})=>row),
        needs_confirmation:true,next_action:'Review every reply and guarded preview; confirm with this exact planKey and expectedHeadSha.'});
    return await apply(selected,ctx,rows,threads,start);
  }catch(error){
    return result({done:false,status:'refused',reason:error instanceof TypeError?error.message:'Review workflow evidence is unavailable; re-read before proceeding.'},true);
  }
}
const tool={
  name:'github_workflow_review_threads',area:'workflow',audience:['B'],
  description:'Inspect current review context; verify dispositions, preview all replies and resolve confirmed threads with safe recovery.',
  usesRegistry:true,passthrough:true,boundsResult:true,profiles:['read_only','everyday','full'],
  delegatedWrites:['github_review_reply','github_review_resolve_thread'],
  inputSchema:{type:'object',properties:{owner:OWNER,repo:REPO,number:{type:'integer',minimum:1},
    expectedHeadSha:SHA,planKey:{type:'string',pattern:'^[a-f0-9]{64}$'},
    dispositions:{type:'array',minItems:1,maxItems:20,items:{type:'object',properties:{
      threadId:{type:'string',minLength:1,maxLength:100},
      disposition:{type:'string',enum:['fixed','already fixed','superseded','answered']},
      explanation:{type:'string',minLength:1,maxLength:2000}},required:['threadId','disposition','explanation'],additionalProperties:false}},
    confirm:{type:'boolean'},dryRun:{type:'boolean'}},required:['repo','number'],additionalProperties:false},
  annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:false,openWorldHint:true}
};
export const tools=[tool];
export const handlers={[tool.name]:reviewThreads};
