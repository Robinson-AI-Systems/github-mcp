import { completeDispatchResult } from '../core/result-envelope.js';
// W-1: Compose the reviewed PR read/write tools; never issue an unguarded provider write.
import {redact} from './util.js';
// A workflow invocation advances at most one durable write, then resumes from fresh reads.
const OWNER={type:'string',maxLength:39},REPO={type:'string',minLength:1,maxLength:100};
const NUMBER={type:'integer',minimum:1},BRANCH={type:'string',minLength:1,maxLength:250};
const TITLE={type:'string',minLength:1,maxLength:256},BODY={type:'string',maxLength:20000};
const LABELS={type:'array',maxItems:20,uniqueItems:true,items:{type:'string',minLength:1,maxLength:100}};
const receipt=(data,error=false)=>({structuredContent:data,
  content:[{type:'text',text:JSON.stringify(data)}],...(error?{isError:true}:{})});
const refused=(why)=>receipt({done:false,status:'refused',reason:why},true);
const clock=(ctx)=>typeof ctx.now==='function'?ctx.now():Date.now();
const within=(ctx,start)=>clock(ctx)-start<46000;
const readBody=(response)=>{
  if(response?.isError||!response?.structuredContent)return null;
  return completeDispatchResult(response);
};
async function call(ctx,name,args){
  if(typeof ctx.callTool!=='function')throw new Error('The guarded tool dispatcher is unavailable.');
  return ctx.callTool(name,args);
}
const scope=(a)=>({...(a.owner?{owner:a.owner}:{}),repo:a.repo});
const bounded=(value,max=240)=>typeof value==='string'?redact(value).slice(0,max):null;
function firstFailure(pr,diagnosis){
  if(!diagnosis||!Array.isArray(diagnosis.runs))return {status:'unavailable',reason:'CI failure details could not be read.'};
  const run=diagnosis.runs.find(x=>x.head_sha===pr.head_sha&&x.failed_jobs?.length);
  if(!run)return {status:'unavailable',reason:'No failed GitHub Actions job with matching exact-head evidence was readable.'};
  const job=run.failed_jobs[0];
  const annotations=job.annotations?.items;
  return {status:'observed',head_sha:pr.head_sha,run_id:run.run_id,
    job:bounded(job.name,120),failed_step:bounded(job.failed_steps?.[0]?.name,120),
    error_excerpt:job.logs_readable===true?(job.error_lines??[]).slice(0,3).map(x=>bounded(x,300)):null,
    logs_readable:job.logs_readable===true,
    annotations:Array.isArray(annotations)?annotations.slice(0,3).map(x=>({
      path:bounded(x.path,180),line:Number.isInteger(x.line)?x.line:null,
      level:bounded(x.level,40),message:bounded(x.message,250)})):[],
    annotations_complete:job.annotations?.complete===true,
    untrusted:true};
}
function nextAction(p){
  if(p.state!=='open')return p.merged?'Already merged.':'Closed; reopen it before continuing.';
  if(p.draft)return 'Mark this draft ready for review.';
  if(p.mergeable===false)return 'Resolve merge conflicts before merging.';
  if(p.mergeable!==true)return 'GitHub has not confirmed mergeability; check again.';
  if(!Number.isInteger(p.threads?.unresolved))return 'Review threads could not be verified; fix their read permission first.';
  if(p.threads.unresolved>0)return 'Address and resolve the outstanding review threads.';
  if(['CHANGES_REQUESTED','REVIEW_REQUIRED'].includes(p.review_decision))
    return 'Resolve the blocking review decision.';
  if(p.merge_diagnostics?.strict_up_to_date===true&&p.merge_diagnostics?.head_contains_base===false)return 'GitHub requires an up-to-date branch: merge or rebase the current base with real ancestry, then rerun checks at the new exact head.';
  if(p.checks?.green!==true)return p.checks?.green===null
    ?'Required checks could not be verified; inspect permissions and rerun the read.'
    :'Wait for or repair required CI checks at this exact head.';
  return 'All checks appear green. Re-read the exact head and use merge_when_green with independent confirmation.';
}
export async function inspectPr(args,ctx){
  const start=clock(ctx),base=scope(args);
  // Two independent guarded reads. Fetching stack membership in parallel
  // removes a full serial provider turn from the common PR status workflow.
  const [prReply, stackReply]=await Promise.all([
    call(ctx,'github_pr_get',{...base,number:args.number}),
    call(ctx,'github_pr_list_stacks',{...base,pullRequest:args.number,max:30})
  ]);
  const pr=readBody(prReply);
  if(!pr)return {done:false,status:'not_readable',number:args.number,
    next:'The PR or its required CI/review evidence could not be read.'};
  let position={state:'not_readable',note:'Stack membership could not be checked.'};
  if(within(ctx,start)){
    const r=readBody(stackReply);
    if(r&&!r.next_page_possible&&r.count===0)position={state:'none'};
    else if(r&&Array.isArray(r.items)&&!r.next_page_possible){
      const matches=r.items.flatMap(s=>(s.pull_requests??[]).map((p,i)=>({
        stack:s.number,position:i+1,number:p.number,count:s.pull_requests.length
      }))).filter(x=>x.number===args.number);
      position=matches.length?{state:'found',items:matches}:{state:'none'};
    }
  }
  const next=nextAction(pr);
  let ciFailure=null;
  // Only a confirmed red exact-head check needs additional GitHub Actions reads.
  // The CI helper selects the latest run at this SHA and bounds its first job.
  if(pr.state==='open'&&pr.checks?.green===false&&
    pr.checks.items?.some(x=>x.state==='failure')&&within(ctx,start)){
    const diagnosis=readBody(await call(ctx,'github_workflow_ci_failure_summary',{
      ...base,pr:args.number,firstFailureOnly:true}));
    ciFailure=firstFailure(pr,diagnosis);
  }
  return {done:true,status:'observed',number:pr.number,head_sha:pr.head_sha,
    head:pr.head,base:pr.base,draft:pr.draft,state:pr.state,merged:pr.merged,
    mergeable:pr.mergeable,mergeable_state:pr.mergeable_state,
    merge_diagnostics:pr.merge_diagnostics??null,checks:pr.checks??null,review_decision:pr.review_decision??null,
    unresolved_threads:pr.threads?.unresolved??null,stack:position,
    ...(ciFailure?{ci_failure:ciFailure}:{}),next_action:next,can_request_merge:next.startsWith('All checks'),
    html_url:pr.html_url,observed_at:new Date(clock(ctx)).toISOString(),
    ...(within(ctx,start)?{}:{incomplete:true,reason:'The 50-second workflow budget is nearly exhausted.'})};
}
const statusTool={
  name:'github_workflow_pr_status',area:'workflow',audience:['B','Op'],compact:true,
  description:'PR head, CI failures, reviews, stack position and next action.',
  usesRegistry:true,
  inputSchema:{type:'object',properties:{owner:OWNER,repo:REPO,number:NUMBER},required:['repo','number'],additionalProperties:false},
  annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:true}
};
// GitHub's native auto_merge field is the only source for whether GitHub itself is armed.
// The write journal can additionally prove which exact head this connection armed;
// if GitHub was armed elsewhere or the head moved, never invent an arming SHA.
export async function mergeAutomationStatus(args,ctx){
  const account=args.owner??ctx.connection?.default_account;
  if(!account||!ctx.connection?.accounts?.some(x=>x.toLowerCase()===account.toLowerCase()))
    return {status:'not_readable',armed:null,reason:'The selected account is not available to this connection.'};
  const pr=readBody(await call(ctx,'github_pr_get',{...scope(args),number:args.number}));
  if(!pr)return {status:'not_readable',armed:null,number:args.number,reason:'GitHub PR state could not be read.'};
  const known=pr.auto_merge?.known!==false && pr.auto_merge!=null;
  const native=known?pr.auto_merge.enabled===true:null;
  const conditions=[];
  if(pr.checks?.green===false)conditions.push('checks');
  if(pr.checks?.green===null)conditions.push('checks_unreadable');
  if(pr.threads?.unresolved>0)conditions.push('review_threads');
  if(['REVIEW_REQUIRED','CHANGES_REQUESTED'].includes(pr.review_decision))conditions.push('reviews');
  if(pr.mergeable===false)conditions.push('merge_conflicts');
  if(pr.mergeable==null)conditions.push('mergeability_unreadable');
  const base={number:pr.number,head_sha:pr.head_sha,provider:'GitHub native auto_merge',
    native_auto_merge_enabled:native,merge_method:pr.auto_merge?.merge_method??null,
    enabled_by:pr.auto_merge?.enabled_by??null,mergeable_state:pr.mergeable_state??null,
    waiting_on:conditions,checks:pr.checks?.green??null,review_decision:pr.review_decision??null,
    note:'merge_when_green is a one-shot guarded merge, not an automatically armed background job.'};
  if(pr.merged)return {...base,status:'completed',armed:false,merged:true};
  if(pr.state!=='open')return {...base,status:'disabled',armed:false,reason:'PR is closed without a confirmed merge.'};
  if(native===false)return {...base,status:'disabled',armed:false};
  if(native===null)return {...base,status:'unknown',armed:null,reason:'GitHub did not expose its native auto-merge state.'};
  let last=null;
  const client=ctx.connection?.client_id??ctx.connection?.pass_id;
  if(client&&typeof ctx.db?.listChanges==='function'){
    try{
      const rows=await ctx.db.listChanges({account,accounts:[account],
        repo:account+'/'+args.repo,tool:'github_pr_set_auto_merge',limit:100});
      last=rows.find(r=>r.connection===client&&r.confirmed===true&&
        r.before?.pr?.number===args.number)??null;
    }catch{/* Native provider evidence remains authoritative even if the journal is unavailable. */}
  }
  const recorded=!!(last?.after?.auto_merge&&last?.before?.pr?.head_sha);
  const matching=recorded&&last.before.pr.head_sha===pr.head_sha;
  const state=recorded&&!matching?'superseded_head':
    !matching?'armed_unknown_head':
    pr.mergeable_state==='queued'?'queued':conditions.length?'waiting':'armed';
  return {...base,status:state,armed:true,armed_head_sha:matching?pr.head_sha:null,
    recorded_at:matching?last.at:null,
    ...(recorded&&!matching?{previous_recorded_head_sha:last.before.pr.head_sha}:{}),
    ...(!matching?{reason:'GitHub confirms auto-merge is enabled, but no matching, connection-scoped arming receipt proves this head.'}:{})};
}
const mergeAutomationTool={
  name:'github_workflow_merge_automation_status',area:'workflow',audience:['B','Op'],compact:true,
  description:'GitHub auto-merge: actual arming, head and blockers.',
  usesRegistry:true,
  inputSchema:{type:'object',properties:{owner:OWNER,repo:REPO,number:NUMBER},required:['repo','number'],additionalProperties:false},
  annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:true}
};
async function openPr(args,ctx){
  if(!['everyday','full'].includes(ctx.connection?.profile))
    return refused('Opening PRs requires the everyday or full connection profile.');
  const start=clock(ctx),s=scope(args);
  const requested=(args.labels??[]).map(x=>x.trim()).filter(Boolean);
  if(new Set(requested.map(x=>x.toLowerCase())).size!==requested.length)
    return refused('Duplicate or blank label names are not allowed.');
  // The guarded PR writer already checks current repository/base, head branch,
  // existing PRs, permissions, notification and idempotency, then reads back.
  // Without labels there is no second durable action to coordinate, so do not
  // duplicate that entire preflight in this outer workflow.
  if(!requested.length){
    const response=readBody(await call(ctx,'github_pr_create',{
      ...s,head:args.head,...(args.base?{base:args.base}:{}),
      title:args.title,body:args.body??'',draft:args.draft===true,
      confirm:args.confirm===true,dryRun:args.dryRun===true,
      ...(args.requestKey?{requestKey:args.requestKey+':create'}:{})
    }));
    const result=response?.result;
    const verified=(response?.status==='applied'||response?.status==='replayed')
      &&response?.done===true&&Number.isInteger(result?.number);
    if(verified){
      // The writer's replay journal holds HISTORICAL readback. Unlike a newly
      // applied result, it does not re-read the PR. An old PR may now be closed,
      // merged, or point at a different head; verify current GitHub evidence.
      if(response.status==='replayed'){
        const current=readBody(await call(ctx,'github_pr_get',{...s,number:result.number}));
        const recordedSha=result.head_sha??result.head?.sha;
        const recordedBase=result.base?.ref??result.base??null;
        if(!current||current.number!==result.number||current.state!=='open'||current.merged||
          current.head!==args.head.split(':').pop()||current.base!==recordedBase||
          !/^[0-9a-f]{40}$/i.test(recordedSha??'')||current.head_sha!==recordedSha){
          return receipt({done:false,status:'stale_replay',number:result.number,
            guarded_tool:'github_pr_create',
            next:'The earlier PR result is historical; re-read the current PR and head before proceeding. No second write was sent.'});
        }
        return receipt({done:true,status:'existing',number:current.number,
          head_sha:current.head_sha,base:current.base,html_url:current.html_url??null,
          guarded_tool:'github_pr_create',
          next:'Existing open PR independently verified from the current head; inspect CI when ready.'});
      }
      return receipt({done:true,status:result.replayed?'existing':'pr_opened',
        number:result.number,head_sha:result.head_sha??result.head?.sha??null,
        base:result.base?.ref??result.base??args.base??null,
        html_url:result.html_url??null,guarded_tool:'github_pr_create',
        next:'PR creation or existing PR verified by the guarded writer; inspect CI when ready.'});
    }
    return receipt({done:false,status:'not_applied',guarded_tool:'github_pr_create',
      underlying_status:response?.status??'unknown',
      next:'The guarded writer did not confirm a PR. Read its result or current GitHub state; do not retry an uncertain write with a new request key.'});
  }
  let repo;
  try{repo=readBody(await call(ctx,'github_repo_get',s));}
  catch{return refused('The repository could not be read before opening its PR.');}
  if(!repo?.default_branch)return refused('The default branch is unreadable; no PR was opened.');
  const base=args.base??repo.default_branch;
  if((args.head.includes(':')?args.head.split(':').pop():args.head)===base)
    return refused('The PR head and base must be different branches.');
  if(!within(ctx,start))return receipt({done:false,status:'pending',next:'Workflow time budget exhausted before any change.'});
  const head=args.head.includes(':')?args.head:(args.owner??ctx.connection.default_account)+':'+args.head;
  // The registered PR list returns normalized string head/base, not REST head.ref/base.ref.
  // Full-detail pages can be held behind an 8-KB result handle even for one PR;
  // request only the evidence required for exact head/base idempotence.
  const listed=readBody(await call(ctx,'github_pr_list',{...s,base,head,max:20,
    detail:'summary',fields:['number','head','base','state','draft']}));
  if(!listed||!Array.isArray(listed.items)||listed.more_exist||listed.more_possible||
    listed.next_page_possible||listed.complete===false||listed.kept_result||
    listed.items.length>=20||(Number.isInteger(listed.count)&&listed.count!==listed.items.length))
    return refused('Open PR inventory is incomplete; cannot verify idempotence.');
  const requestedHead=args.head.split(':').pop();
  const matches=listed.items.filter(p=>p.state==='open'&&
    (typeof p.head==='string'?p.head:p.head?.ref)===requestedHead&&
    (typeof p.base==='string'?p.base:p.base?.ref)===base);
  if(matches.length>1)return refused('Several open PRs match that head/base; select one explicitly.');
  const existing=matches[0]??null;
  if(existing){
    const status=readBody(await call(ctx,'github_pr_get',{...s,number:existing.number}));
    if(!status||status.state!=='open'||status.merged||status.head!==args.head.split(':').pop()||status.base!==base)
      return refused('The matching PR changed since inventory; no label mutation was attempted.');
    const missing=requested.filter(label=>!(status.labels??[]).some(x=>x.toLowerCase()===label.toLowerCase()));
    if(!missing.length){
      return receipt({done:true,status:'existing',number:status.number,
        head_sha:status.head_sha,base,next_action:nextAction(status),
        html_url:status.html_url,labels:status.labels});
    }
    if(!within(ctx,start))return receipt({done:false,status:'pending',number:status.number,next:'Resume label application after the workflow budget refreshes.'});
    const mutation=await call(ctx,'github_issue_set_labels',{
      ...s,number:status.number,mode:'add',labels:missing,
      confirm:args.confirm===true,dryRun:args.dryRun===true,
      ...(args.requestKey?{requestKey:args.requestKey+':labels'}:{})});
    const body=readBody(mutation);
    return receipt({done:false,status:body?.status==='applied'?'labels_applied':'labels_not_applied',
      number:status.number,underlying_status:body?.status??'unknown',guarded_tool:'github_issue_set_labels',
      next:'Re-run to verify labels and the PR status through fresh provider reads.'});
  }
  if(!within(ctx,start))return receipt({done:false,status:'pending',next:'Resume creation after the workflow budget refreshes.'});
  const result=await call(ctx,'github_pr_create',{
    ...s,head:args.head,base,title:args.title,body:args.body??'',draft:args.draft===true,
    confirm:args.confirm===true,dryRun:args.dryRun===true,
    ...(args.requestKey?{requestKey:args.requestKey+':create'}:{})});
  const applied=readBody(result);
  return receipt({done:false,status:applied?.status==='applied'?'pr_opened':'not_applied',
    underlying_status:applied?.status??'unknown',guarded_tool:'github_pr_create',
    ...(applied?.number?{number:applied.number}:{}),
    next:'Re-run with the same fields to verify the PR and apply requested labels, if any.'});
}
const openTool={
  name:'github_workflow_open_pr',area:'workflow',audience:['B'],compact:true,
  description:'Open a PR once, applying labels via guarded follow-up.',
  usesRegistry:true,passthrough:true,profiles:['everyday','full'],
  delegatedWrites:['github_pr_create','github_issue_set_labels'],
  inputSchema:{type:'object',properties:{owner:OWNER,repo:REPO,head:BRANCH,
    base:BRANCH,title:TITLE,body:BODY,draft:{type:'boolean'},labels:LABELS,
    confirm:{type:'boolean'},dryRun:{type:'boolean'},
    requestKey:{type:'string',minLength:4,maxLength:128}},
    required:['repo','head','title'],additionalProperties:false},
  annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:false,openWorldHint:true}
};
export const tools=[statusTool,mergeAutomationTool,openTool];
export const handlers={[statusTool.name]:inspectPr,[mergeAutomationTool.name]:mergeAutomationStatus,[openTool.name]:openPr};
