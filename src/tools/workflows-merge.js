import { createHash } from 'node:crypto';
import { guardedResultBody } from '../core/result-envelope.js';
// W-2: no direct mutations; compose existing expected-head and production-guarded writers.
// One mutating step per invocation. A stack advances after a fresh read on the next call.
const OWNER={type:'string',maxLength:39},REPO={type:'string',minLength:1,maxLength:100};
const NUMBER={type:'integer',minimum:1};
const SHA={type:'string',pattern:'^[a-fA-F0-9]{40}$'};
const PRS={type:'array',items:NUMBER,minItems:2,maxItems:15,uniqueItems:true};
const SHAS={type:'array',items:SHA,minItems:2,maxItems:15};
const common={owner:OWNER,repo:REPO,confirm:{type:'boolean'},dryRun:{type:'boolean'},
  requestKey:{type:'string',minLength:4,maxLength:128}};
const reply=(v,bad=false)=>({structuredContent:v,content:[{type:'text',text:JSON.stringify(v)}],...(bad?{isError:true}:{})});
const refuse=(reason,more={})=>reply({status:'refused',done:false,reason,...more},true);
const scope=a=>({...(a.owner?{owner:a.owner}:{}),repo:a.repo});
const now=ctx=>ctx.now();
const shape=guardedResultBody;
const stop=(start,ctx)=>now(ctx)-start>=46000;
async function invoke(ctx,name,args){
  if(typeof ctx.callTool!=='function')throw new Error('Guarded tool dispatch is unavailable.');
  return shape(await ctx.callTool(name,args));
}
async function pr(ctx,s,number){return invoke(ctx,'github_pr_get',{...s,number});}
async function repo(ctx,s){return invoke(ctx,'github_repo_get',s);}
const CI_NOT_GREEN='Required CI checks are not proven green at this head.';
const isSoft=(w)=>w===CI_NOT_GREEN||w==='Review decision blocks merge.'||/^Review threads could not be verified/.test(w)||/ unresolved review threads\.$/.test(w);
const softAdvice=(w)=>w===CI_NOT_GREEN?'Add a CI workflow that runs on pull requests (or fix the failing check), or confirm yourself that the change is safe.'
  :w==='Review decision blocks merge.'?'Get the requested review or approval (a self review is fine where the owner allows it), or confirm yourself that the change is safe.'
  :'Resolve the review threads, or confirm yourself that nothing in them matters.';
function blockers(p,expected,defaultBranch,{override=false}={}){
  const missing=[];
  if(!p)return ['PR provider read is unavailable.'];
  if(p.state!=='open'||p.merged)missing.push('PR is not open and unmerged.');
  if(p.draft)missing.push('PR is still a draft.');
  if(p.head_sha!==expected)missing.push('Expected head does not match the latest actual head.');
  // Owner feedback 2026-11-12: a PR into a release or parent branch is a normal merge. GitHub's own rules for that base branch and the
  // guarded merge writer still apply; only the default-branch-only restriction is gone.
  if(p.mergeable!==true)missing.push('GitHub did not confirm mergeability.');
  // Explicit override only skips local CI/review vetoes so the underlying
  // guarded merge can check the person, settings, reason, exact head, and
  // GitHub's actual decision. It never loosens the default merge path.
  if(!override){
    if(p.checks?.green!==true)missing.push(CI_NOT_GREEN);
    // Unknown threads are never treated as none; say why so the caller can act (owner feedback 2026-11-02).
    if(!Number.isInteger(p.threads?.unresolved))missing.push('Review threads could not be verified'+
      (typeof p.threads?.unknown==='string'?' ('+p.threads.unknown.replace(/\.$/,'')+')':'')+'.');
    else if(p.threads.unresolved>0)missing.push(p.threads.unresolved+' unresolved review threads.');
    if(['CHANGES_REQUESTED','REVIEW_REQUIRED'].includes(p.review_decision))
      missing.push('Review decision blocks merge.');
  }
  return missing;
}
async function freshAfterRetarget(p,ctx,s){
  // Review comments can change PR.updated_at without changing its base, so
  // compare CI to the last real base_ref_changed event instead.
  // The timeline is a registry read; an inaccessible/capped history fails closed.
  const timeline=await invoke(ctx,'github_issue_list_timeline',{...s,number:p.number,max:100});
  if(!timeline||timeline.more_exist||timeline.kept_result||!Array.isArray(timeline.items))
    return {ready:false,reason:'PR base-change history is unreadable or incomplete.'};
  const changed=timeline.items.filter(x=>x.event==='base_ref_changed');
  if(!changed.length)return {ready:true,reason:'No retarget recorded in complete history.'};
  const last=Math.max(...changed.map(x=>Date.parse(x.created_at??'')));
  if(!Number.isFinite(last)||!p.checks?.items?.length)
    return {ready:false,reason:'Cannot establish complete CI timing after the last retarget.'};
  const ready=p.checks.items.every(x=>{
    const stamp=x.started_at??x.updated_at??x.completed_at;
    return x.state==='success'&&Number.isFinite(Date.parse(stamp??''))&&
      Date.parse(stamp)>last;
  });
  return {ready,reason:ready?'Every required check ran after the last actual retarget.':
    'Required CI has not been independently observed after the latest actual retarget.'};
}
function authorize(ctx){
  return ['everyday','full'].includes(ctx.connection?.profile);
}
async function mergeOne(a,ctx){
  if(!authorize(ctx))return refuse('Merge workflows require an everyday or full connection.');
  const start=now(ctx),s=scope(a);
  // Both observations are independently authorized. The guarded merge writer
  // still rechecks the exact head and branch state immediately before mutation.
  let [p,r]=await Promise.all([pr(ctx,s,a.number),repo(ctx,s)]);
  if(!r?.default_branch)return refuse('Default-branch provider evidence unavailable.');
  // Owner feedback 2026-11-12: merging into anything but the default branch must be deliberate. The caller names the branch it
  // means to merge into; a mismatch or a missing name stops here, before any CI wait or write.
  if(p&&p.state==='open'&&p.base&&p.base!==r.default_branch&&a.mergeIntoBranch!==p.base)
    return reply({status:'needs_branch_confirmation',done:false,number:a.number,pr_base:p.base,default_branch:r.default_branch,
      ...(a.mergeIntoBranch?{you_said:a.mergeIntoBranch}:{}),
      next:'PR #'+a.number+' targets "'+p.base+'", not the default branch "'+r.default_branch+'". If merging into "'+p.base+'" is intentional (for example a release or parent branch), call again with the same arguments plus mergeIntoBranch: "'+p.base+'". If you meant to merge into "'+r.default_branch+'", retarget the PR first with github_pr_update.'});
  let why=blockers(p,a.expectedHeadSha,r.default_branch,{override:a.overrideRules===true});
  // CONN-FB-1: optionally wait (inside this call's time budget) when the ONLY thing missing is checks that are still
  // running. A red check, any other blocker, or a moved head is never waited on; the merge path below is unchanged.
  if(a.waitForChecks===true&&why.length===1&&why[0]===CI_NOT_GREEN&&p?.checks?.green===false&&
    !(p.checks.items??[]).some(x=>x.state==='failure')){
    const budget=Math.floor((46000-(now(ctx)-start)-16000)/1000);
    if(budget>=5){
      const waited=await invoke(ctx,'github_check_wait',{...s,pr:a.number,expectedHeadSha:a.expectedHeadSha,timeoutSeconds:Math.min(budget,30)});
      if(waited?.overall!=='green'&&waited?.overall!=='no_ci')return reply({status:waited?.status==='head_moved'?'not_ready':'checks_running',done:false,number:a.number,
        expected_head:a.expectedHeadSha,checks:waited?.overall??'unknown',waited_seconds:waited?.waited_seconds??null,
        ...(waited?.still_running?{still_running:waited.still_running}:{}),...(waited?.not_reported_yet?{not_reported_yet:waited.not_reported_yet}:{}),
        next:waited?.overall==='red'?'A required check failed; fix it, push, and call again with the new head.':
          waited?.status==='head_moved'?'The PR head moved; re-read it and call again with the new expectedHeadSha.':
          'Checks are still running. Call github_workflow_merge_when_green again with the same arguments (waitForChecks: true).'});
      p=await pr(ctx,s,a.number);
      why=blockers(p,a.expectedHeadSha,r.default_branch,{override:a.overrideRules===true});
    }
  }
  // Owner feedback 2026-11-10: a change sent without git showed checks that took ~7 minutes to start, and the answer was a
  // bare "not_ready ... repair the listed conditions". Checks that have not started or are still running are not a fault to
  // repair: say they are waiting and how to wait. A red check or any other blocker keeps the plain not_ready answer.
  if(why.length===1&&why[0]===CI_NOT_GREEN&&p?.checks?.green===false&&!(p.checks.items??[]).some(x=>x.state==='failure'))
    return reply({status:'checks_running',done:false,number:a.number,expected_head:a.expectedHeadSha,actual_head:p?.head_sha??null,blockers:why,
      next:'Required checks have not finished at this head (not started yet, or still running; GitHub can take several minutes to start them). Nothing needs repairing. Call github_workflow_merge_when_green again with waitForChecks: true, or wait with github_check_wait.'});
  if(why.length){
    // Owner feedback 2026-11-11: this tool stays strictly green-only. When the ONLY things missing are advisory (CI not green or not
    // set up, review, threads), name them as warnings and point to the deliberate fallback tool. Hard facts never get that pointer.
    const soft=why.filter(isSoft);
    if(soft.length===why.length){
      return reply({status:'not_ready',done:false,number:a.number,expected_head:a.expectedHeadSha,actual_head:p?.head_sha??null,
        blockers:why,warnings:why.map(w=>({warning:w,suggestion:softAdvice(w)})),fallback_tool:'github_workflow_merge_anyway',
        next:'This tool only merges when everything is green, and it is the recommended way to merge. Not green: '+why.join(' ')+' Best: set up what is missing (CI that runs on pull requests, a review) and call again. If you have double-checked the change yourself and merging anyway is intentional, use github_workflow_merge_anyway (it asks you to confirm and give a reason).'});
    }
    return reply({status:'not_ready',done:false,number:a.number,
      expected_head:a.expectedHeadSha,actual_head:p?.head_sha??null,
      blockers:why,next:'Repair the listed conditions, then re-read the exact PR.'});
  }
  if(stop(start,ctx))return reply({status:'pending',done:false,
    next:'Workflow budget ended without a merge attempt.'});
  const result=await invoke(ctx,'github_pr_merge',{...s,number:a.number,
    expectedHeadSha:a.expectedHeadSha,method:'merge',
    confirm:a.confirm===true,dryRun:a.dryRun===true,
    ...(a.overrideRules===true?{overrideRules:true,overrideReason:a.overrideReason}:{}),
    ...(a.requestKey?{requestKey:a.requestKey+':'+a.number}:{})});
  if(result?.status!=='applied'){
    const previewing=result?.status==='preview'||result?.status==='needs_confirmation';
    // Never hide the guarded writer's informed-consent preview from clients
    // of this compact workflow. The writer, not this wrapper, decides when
    // confirmation is required, and no mutation is claimed here.
    return reply({status:previewing?result.status:'not_applied',done:false,
      guarded_tool:'github_pr_merge',underlying_status:result?.status??'unknown',
      ...(typeof result?.preview==='string'?{preview:result.preview}:{}),
      ...(typeof result?.needsConfirmation==='boolean'?{needsConfirmation:result.needsConfirmation}:{}),
      ...(typeof result?.prompt==='string'?{prompt:result.prompt}:{}),
      ...(typeof result?.because==='string'?{because:result.because}:{}),
      ...(typeof result?.refusedBy==='string'?{refusedBy:result.refusedBy}:{}),
      ...(typeof result?.error==='string'?{error:result.error}:{}),
      ...(typeof result?.warning==='string'?{warning:result.warning}:{}),
      next:previewing?'Read the delegated writer preview, obtain approval and call with confirm: true if authorized.':
        'No merge is claimed. Inspect the guarded refusal or the current exact head before retrying.'});
  }
  const after=await pr(ctx,s,a.number);
  const pending=a.overrideRules===true&&['pending','enqueued'].includes(result.result?.status);
  return reply({status:after?.merged===true?'merged':pending?'pending':'unconfirmed',
    done:after?.merged===true,number:a.number,
    // Owner feedback 2026-11-12: return the verified merge SHA. The writer's answer first, then the fresh PR read (GitHub records the
    // real merge commit there once merged), so callers need no extra branch lookup before checking CI on the merged commit.
    merge_commit:result.merge_commit??result.result?.merge_commit??(after?.merged===true?after.test_merge_sha??after.merge_commit_sha:null)??null,
    next:after?.merged===true?'Merge confirmed from a fresh independent PR read.':pending
      ?'GitHub accepted the request for background processing; inspect its later result before claiming the PR merged.':
      'Provider merge response was applied but fresh readback did not confirm it; inspect before retrying.'});
}
async function stackOrder(args,ctx,s){
  if(!!args.prs===!!args.stackNumber)
    return {error:'Supply exactly one ordered PR list or one GitHub stack number.'};
  if(args.prs)return {numbers:args.prs};
  const found=await invoke(ctx,'github_pr_list_stacks',{...s,stackNumber:args.stackNumber});
  const numbers=(found?.pull_requests??[]).map(x=>x.number);
  return numbers.length>=2&&numbers.length<=15?
    {numbers}:{error:'Stack could not be read or has fewer than two or more than fifteen PRs.'};
}
async function mergeStack(a,ctx){
  if(!authorize(ctx))return refuse('Merge workflows require an everyday or full connection.');
  const start=now(ctx),s=scope(a);
  const selected=await stackOrder(a,ctx,s);
  if(selected.error)return refuse(selected.error);
  const numbers=selected.numbers;
  if(new Set(numbers).size!==numbers.length)return refuse('A PR is repeated in the ordered stack.');
  if(a.expectedHeadShas&&a.expectedHeadShas.length!==numbers.length)
    return refuse('Expected head SHA list must match the complete ordered stack.');
  const r=await repo(ctx,s);
  if(!r?.default_branch)return refuse('Cannot verify the default branch, so no merge will occur.');
  let previous=null;
  // Freshly read and validate the whole specified chain before any mutation.
  const chain=[];
  for(let offset=0;offset<numbers.length;offset+=3){
    if(stop(start,ctx))return reply({status:'pending',done:false,complete:chain.length,
      next:'Workflow budget expired; re-read the stack before proceeding.'});
    // PR reads are independent, but validate in the original strict chain order
    // before issuing any retarget/merge. Never parallelize durable writes.
    const batch=await Promise.all(numbers.slice(offset,offset+3).map(number=>pr(ctx,s,number)));
    for(let j=0;j<batch.length;j++){
      const i=offset+j,p=batch[j];
      if(stop(start,ctx))return reply({status:'pending',done:false,complete:chain.length,
        next:'Workflow budget expired; re-read the stack before proceeding.'});
      if(!p)return refuse('Could not read PR #'+numbers[i]+'.');
      if(a.expectedHeadShas?.[i]&&p.head_sha!==a.expectedHeadShas[i])
        return refuse('PR #'+p.number+' advanced since the requested head SHA.',{actual_head:p.head_sha});
      if(p.state!=='open'&&!p.merged)return refuse('Stack includes closed unmerged PR #'+p.number+'.');
      if(!p.merged&&previous&&!previous.merged&&p.base!==previous.head)
        return refuse(p.base===previous.base
          ?'PR #'+p.number+' is a sibling of PR #'+previous.number+' (both are based on '+p.base+'), not stacked on it. List only a chain where each PR is based on the previous PR\'s branch, or merge siblings one at a time with github_workflow_merge_when_green.'
          :'Stack branch chain is broken between PR #'+previous.number+' and #'+p.number+': #'+p.number+' is based on '+p.base+', not on #'+previous.number+'\'s branch '+previous.head+'. List the PRs bottom-up so each is based on the previous one\'s branch.',
          {chain:chain.map(x=>({number:x.number,head:x.head,base:x.base})).concat({number:p.number,head:p.head,base:p.base})});
      chain.push(p);
      previous=p;
    }
  }
  const active=chain.findIndex(p=>!p.merged);
  if(active===-1)return reply({status:'complete',done:true,prs:numbers,next:'Every listed PR was independently observed merged.'});
  const item=chain[active];
  // Never merge into a stack parent. Move the bottom open PR to the default
  // branch using the existing guarded retarget writer, then return immediately.
  if(item.base!==r.default_branch){
    if(stop(start,ctx))return reply({status:'pending',done:false,next:'Time budget exhausted before retargeting.'});
    const x=await invoke(ctx,'github_pr_update',{...s,number:item.number,base:r.default_branch,expectedHeadSha:item.head_sha,
      confirm:a.confirm===true,dryRun:a.dryRun===true,
      ...(a.requestKey?{requestKey:a.requestKey+':retarget:'+item.number}:{})});
    return reply({status:x?.status==='applied'?'retargeted':'not_applied',done:false,
      number:item.number,underlying_status:x?.status??'unknown',
      next:'After the new base is observed, wait for NEW CI at this unchanged exact head. Reinvoke after new checks.'});
  }
  const why=blockers(item,item.head_sha,r.default_branch);
  if(why.length)return reply({status:'not_ready',done:false,number:item.number,
    blockers:why,next:'Resolve the listed conditions without merging into the parent branch.'});
  // A stacked PR originally based on a parent must be rechecked after retarget.
  // For a later member require post-retarget timestamp proof on the current base.
  if(stop(start,ctx))return reply({status:'pending',done:false,
    next:'Workflow budget expired before checking base-change history; no merge attempted.'});
  const fresh=await freshAfterRetarget(item,ctx,s);
  if(!fresh.ready)
    return reply({status:'pending_fresh_ci',done:false,number:item.number,
      head_sha:item.head_sha,reason:fresh.reason,
      next:'No merge: check the source base-change event and run CI after that event.'});
  if(stop(start,ctx))return reply({status:'pending',done:false,next:'Time budget ended; no merge attempted.'});
  const x=await invoke(ctx,'github_pr_merge',{...s,number:item.number,
    expectedHeadSha:item.head_sha,method:'merge',
    confirm:a.confirm===true,dryRun:a.dryRun===true,
    ...(a.requestKey?{requestKey:a.requestKey+':merge:'+item.number}:{})});
  if(x?.status!=='applied')return reply({status:'not_applied',done:false,number:item.number,
    underlying_status:x?.status??'unknown',next:'No merge claimed. Inspect guarded refusal or preview.'});
  const after=await pr(ctx,s,item.number);
  return reply({status:after?.merged===true?'merged_one':'unconfirmed',done:false,
    number:item.number,confirmed:after?.merged===true,
    next:after?.merged===true?'Reinvoke to retarget the next PR and require its new CI.':
      'Provider readback unconfirmed. Inspect exact PR before any retry.'});
}
const whenTool={
  name:'github_workflow_merge_when_green',area:'workflow',audience:['B'],compact:true,
  description:'Guarded exact-head, green-CI PR merge.',
  usesRegistry:true,passthrough:true,profiles:['everyday','full'],delegatedWrites:['github_pr_merge'],
  inputSchema:{type:'object',properties:{...common,number:NUMBER,expectedHeadSha:SHA,
    overrideRules:{type:'boolean'},overrideReason:{type:'string',minLength:10,maxLength:200},waitForChecks:{type:'boolean'},mergeIntoBranch:{type:'string',maxLength:255}},
    required:['repo','number','expectedHeadSha'],additionalProperties:false},
  annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:false,openWorldHint:true}
};
const stackTool={
  name:'github_workflow_merge_stack',area:'workflow',audience:['B'],compact:true,
  description:'Retarget/merge a PR stack one guarded step at a time.',
  usesRegistry:true,passthrough:true,profiles:['everyday','full'],
  delegatedWrites:['github_pr_update','github_pr_merge'],
  inputSchema:{type:'object',properties:{...common,prs:PRS,stackNumber:NUMBER,expectedHeadShas:SHAS},
    required:['repo'],additionalProperties:false},
  annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:false,openWorldHint:true}
};
const ackToken=(p,soft)=>createHash('sha256').update(p.head_sha+'|'+soft.join('|')).digest('hex').slice(0,8);
// The deliberate fallback (owner feedback 2026-11-11): merge without green, with a small bump so it is never an accident.
async function mergeAnyway(a,ctx){
  if(!authorize(ctx))return refuse('Merge workflows require an everyday or full connection.');
  const s=scope(a);
  const [p,r]=await Promise.all([pr(ctx,s,a.number),repo(ctx,s)]);
  if(!r?.default_branch)return refuse('Default-branch provider evidence unavailable.');
  const why=blockers(p,a.expectedHeadSha,r.default_branch);
  const hard=why.filter(w=>!isSoft(w));
  if(hard.length)return reply({status:'not_ready',done:false,number:a.number,blockers:hard,next:'Something hard stops this merge (not just missing CI or review). Fix it first; merging anyway cannot skip it.'});
  if(!why.length)return reply({status:'use_merge_when_green',done:false,number:a.number,next:'Everything is green. Merge with github_workflow_merge_when_green, the normal tool.'});
  const token=ackToken(p,why),reason=String(a.reason??'').trim();
  const good=a.acknowledge===token&&reason.length>=20&&reason.split(/\s+/).length>=4&&!/^<.*>$/.test(reason);
  if(!good)return reply({status:'needs_acknowledgement',done:false,number:a.number,expected_head:a.expectedHeadSha,
    warnings:why.map(w=>({warning:w,suggestion:softAdvice(w)})),acknowledge:token,
    next:'Merging without green is allowed but must be intentional. Preferably set up what is missing first. If you have double-checked the change yourself, call github_workflow_merge_anyway again with the same arguments plus acknowledge: "'+token+'" and reason: a real sentence (20+ characters) saying what you checked. The reason is recorded.'});
  return mergeOne({...a,overrideRules:true,overrideReason:reason.slice(0,200)},ctx);
}
const anywayTool={
  name:'github_workflow_merge_anyway',area:'workflow',audience:['B'],compact:true,
  description:'Fallback: merge at the exact head when CI or review is missing, after an acknowledgement and a written reason. Prefer github_workflow_merge_when_green.',
  usesRegistry:true,passthrough:true,profiles:['everyday','full'],delegatedWrites:['github_pr_merge'],
  inputSchema:{type:'object',properties:{...common,number:NUMBER,expectedHeadSha:SHA,acknowledge:{type:'string',maxLength:16},mergeIntoBranch:{type:'string',maxLength:255},reason:{type:'string',maxLength:200}},
    required:['repo','number','expectedHeadSha'],additionalProperties:false},
  annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:false,openWorldHint:true}
};
export const tools=[whenTool,anywayTool,stackTool];
export const handlers={[whenTool.name]:mergeOne,[anywayTool.name]:mergeAnyway,[stackTool.name]:mergeStack};
