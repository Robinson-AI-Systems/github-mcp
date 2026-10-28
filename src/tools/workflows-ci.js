// W-4: one bounded observation, or one delegated failed-job retry. Never poll Actions.
import {defineRead} from './define-read.js';
const OWNER={type:'string',maxLength:39},REPO={type:'string',minLength:1,maxLength:100};
const ID={type:'integer',minimum:1},SHA={type:'string',pattern:'^[a-fA-F0-9]{40}$'};
const scope=a=>({...(a.owner?{owner:a.owner}:{}),repo:a.repo});
const bad=v=>!v||v.kept_result||v.more_exist;
const ended=(ctx,start)=>ctx.now()-start>=46000;
const response=(v,error=false)=>({structuredContent:v,content:[{type:'text',text:JSON.stringify(v)}],...(error?{isError:true}:{})});
async function call(ctx,name,a){
  try{const r=await ctx.callTool(name,a);return r?.isError?null:r?.structuredContent??null;}catch{return null;}
}
async function getRun(a,ctx,id){return call(ctx,'github_actions_get_run',{...scope(a),runId:id});}
async function select(a,ctx){
  if([a.pr,a.runId,a.ref].filter(v=>v!==undefined).length!==1)throw new TypeError('Supply exactly one pr, runId or ref.');
  if(a.runId){const run=await getRun(a,ctx,a.runId);if(bad(run))throw new TypeError('The selected run is unreadable.');return [run];}
  const source=a.pr?await call(ctx,'github_pr_get',{...scope(a),number:a.pr}):
    await call(ctx,'github_commit_get',{...scope(a),ref:a.ref});
  const sha=a.pr?source?.head_sha:source?.sha;
  if(!/^[a-f0-9]{40}$/i.test(sha??''))throw new TypeError('The requested PR/ref head is unreadable.');
  // Full provider run records can exceed the bounded result budget before the
  // workflow sees even one item. Select only the exact-head identity fields;
  // fetch each selected run's jobs separately before interpreting a failure.
  const listed=await call(ctx,'github_actions_list_runs',{...scope(a),headSha:sha,
    max:50,detail:'full',fields:['id','workflow_id','head_sha','head_branch','status','conclusion']});
  if(bad(listed)||!Array.isArray(listed.items)||listed.items.length>=50||
    (Number.isInteger(listed.count)&&listed.count!==listed.items.length))
    throw new TypeError('Head-specific run inventory is incomplete.');
  if(listed.items.some(r=>r.head_sha!==sha))throw new TypeError('Run inventory includes another commit.');
  // Latest attempt/run per workflow, so an obsolete failure does not mask a newer pass.
  const workflows=new Map();
  for(const r of listed.items){
    if(!Number.isInteger(r.workflow_id))throw new TypeError('A run has no verifiable workflow identity.');
    const previous=workflows.get(r.workflow_id);
    if(!previous||r.id>previous.id)workflows.set(r.workflow_id,r);
  }
  return [...workflows.values()];
}
const failed=j=>j.conclusion==='failure'||j.failed_steps?.length>0;
async function failures(a,ctx,run,start,{firstOnly=false}={}){
  if(bad(run)||!Array.isArray(run.jobs)||run.jobs_complete!==true)return {complete:false,items:[],reason:'Failed-job inventory is incomplete.'};
  const items=[];
  for(const job of run.jobs.filter(failed).slice(0,firstOnly?1:undefined)){
    if(ended(ctx,start))return {complete:false,items,reason:'Workflow time budget exhausted.'};
    const log=await call(ctx,'github_actions_get_job_log',{...scope(a),jobId:job.id,tailLines:10});
    const errors=bad(log)?null:(Array.isArray(log.errors)?log.errors:null);
    let annotations=null;
    if(job.check_run_id&&!ended(ctx,start)){
      const check=await call(ctx,'github_check_get_run',{...scope(a),checkRunId:job.check_run_id});
      if(!bad(check)&&check.head_sha===run.head_sha)annotations={items:check.annotations??[],
        complete:(check.annotations_count??0)<=(check.annotations?.length??0)};
    }
    items.push({id:job.id,name:job.name,failed_steps:job.failed_steps??[],
      error_lines:errors,logs_readable:errors!==null,annotations,html_url:job.html_url,
      likely_cause:errors?.length?'Reported error (inference): '+errors[0]:
        'No readable error evidence; inspect the failed step locally.',untrusted:true});
  }
  return {complete:true,items};
}
const signature=job=>job.logs_readable&&job.error_lines?.length?
  JSON.stringify([job.failed_steps.map(s=>s.name),job.error_lines]):null;
async function baseline(a,ctx,run,repo,start){
  if(!repo?.default_branch||!Number.isInteger(run.workflow_id)||ended(ctx,start))return null;
  const listing=await call(ctx,'github_actions_list_runs',{...scope(a),workflow:String(run.workflow_id),branch:repo.default_branch,max:1,detail:'full',fields:['id','workflow_id','head_sha','head_branch','status','conclusion']});
  // max 1 intentionally requests the newest run; older runs are not baseline candidates.
  const latest=listing?.items?.[0];
  if(!latest||latest.workflow_id!==run.workflow_id||latest.head_branch!==repo.default_branch)return null;
  const detail=await getRun(a,ctx,latest.id);
  if(bad(detail)||detail.workflow_id!==run.workflow_id||detail.status!=='completed')return null;
  return {run_id:detail.id,head_sha:detail.head_sha,branch:repo.default_branch,
    jobs:detail.jobs,failures:await failures(a,ctx,detail,start)};
}
export async function ciFailureSummary(a,ctx){
  const start=ctx.now();
  try{
    const selected=await select(a,ctx);
    if(!selected.length)return {done:false,status:'no_runs',runs:[],
      next_action:'No GitHub Actions workflow run exists at this exact PR/ref head; no CI diagnosis or passing CI claim can be made.'};
    const repo=await call(ctx,'github_repo_get',scope(a)),runs=[];
    for(const item of selected){
      if(ended(ctx,start))return {done:false,status:'pending',runs,next_action:'Budget exhausted; inspect one remaining runId directly.'};
      const run=await getRun(a,ctx,item.id);
      if(bad(run)||run.head_sha!==item.head_sha){runs.push({run_id:item.id,state:'unreadable',complete:false});continue;}
      const own=await failures(a,ctx,run,start,{firstOnly:a.firstFailureOnly===true}),base=a.firstFailureOnly===true?null:await baseline(a,ctx,run,repo,start);
      runs.push({run_id:run.id,head_sha:run.head_sha,workflow_id:run.workflow_id,status:run.status,
        conclusion:run.conclusion,attempt:run.run_attempt,complete:own.complete,
        reason:own.reason,baseline:base?{run_id:base.run_id,head_sha:base.head_sha,branch:base.branch}:null,
        failed_jobs:own.items.map(job=>{
          const matches=base?.failures.items.filter(j=>j.name===job.name)??[];
          const other=matches.length===1?matches[0]:null;
          const baselineJob=base?.jobs?.find(j=>j.name===job.name);
          const same=signature(job)&&signature(other??{})?signature(job)===signature(other):
            (baselineJob?.conclusion==='success'?false:null);
          return {...job,same_failure_on_default:same,baseline_job:other?.id??null};
        }),html_url:run.html_url});
      if(a.firstFailureOnly===true&&own.items.length>0)break;
    }
    const complete=a.firstFailureOnly===true
      ?runs.some(r=>r.complete&&r.status==='completed'&&r.failed_jobs?.length>0)
      :runs.length>0&&runs.every(r=>r.complete&&r.status==='completed');
    return {done:complete,status:complete?'observed':'partial',runs,
      next_action:'Use observed errors to reproduce/fix locally. A guarded automatic failed-job rerun is allowed only once for a workflow/head.'};
  }catch(e){return {done:false,status:'unreadable',reason:e instanceof TypeError?e.message:'CI evidence could not be read.'};}
}
export async function rerunFailedCi(a,ctx){
  const start=ctx.now();
  if(!['everyday','full'].includes(ctx.connection.profile))return response({done:false,status:'refused',reason:'A writable connection profile is required.'},true);
  const run=await getRun(a,ctx,a.runId);
  if(bad(run)||!Number.isInteger(run.workflow_id)||run.head_sha!==a.expectedHeadSha)
    return response({done:false,status:'refused',reason:'The expected run head/workflow cannot be verified.'},true);
  if(run.status!=='completed')return response({done:false,status:'pending',run_id:run.id,
    next_action:'This run is still active. Check its eventual result; no waiting loop or rerun occurred.'});
  if(run.conclusion!=='failure'||run.jobs_complete!==true||!run.jobs?.some(failed))
    return response({done:false,status:'refused',reason:'A completed failed run and complete failed-job inventory are required.'},true);
  if(ended(ctx,start))return response({done:false,status:'pending',next_action:'Budget expired before any retry.'});
  const r=await call(ctx,'github_actions_rerun',{...scope(a),runId:run.id,mode:'failed',
    expectedHeadSha:a.expectedHeadSha,expectedWorkflowId:run.workflow_id,confirm:a.confirm===true,dryRun:a.dryRun===true});
  if(!r)return response({done:false,status:'not_applied',reason:'The guarded rerun failed or was refused; no retry is claimed.'});
  if(r.status==='replayed')return response({done:false,status:'retry_already_claimed',confirmed:r.confirmed===true,
    next_action:'This workflow/head already used its automatic retry, or its outcome is uncertain. Reproduce locally; do not automatically rerun it again.'});
  return response({...r,done:false,guarded_tool:'github_actions_rerun',
    next_action:r.status==='applied'?'Retry submitted once. Inspect its new attempt later without rerunning again.':
      'Review the guarded preview/refusal; production and independent owner confirmation remain required.'});
}
const summary=defineRead({name:'github_workflow_ci_failure_summary',area:'workflow',audience:['B','Op'],
  description:'Explain failed CI jobs, steps, errors and annotations; compare observed failures with the same workflow on the default branch.',
  properties:{owner:OWNER,repo:REPO,pr:ID,runId:ID,ref:{type:'string',minLength:1,maxLength:250},
    firstFailureOnly:{type:'boolean',description:'Return only the first failed job at the selected exact head; skip baseline comparison.'}},required:['repo'],handler:ciFailureSummary});
const retry={name:'github_workflow_rerun_failed_ci',area:'workflow',audience:['B','Op'],
  description:'Retry failed jobs once for an exact workflow/head; preserve production guards and stop after a durable prior retry claim.',
  usesRegistry:true,passthrough:true,boundsResult:true,profiles:['everyday','full'],delegatedWrites:['github_actions_rerun'],
  inputSchema:{type:'object',properties:{owner:OWNER,repo:REPO,runId:ID,expectedHeadSha:SHA,confirm:{type:'boolean'},dryRun:{type:'boolean'}},
    required:['repo','runId','expectedHeadSha'],additionalProperties:false},
  annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:false,openWorldHint:true}};
export const tools=[{...summary.tool,usesRegistry:true},retry];
export const handlers={[summary.tool.name]:summary.handler,[retry.name]:rerunFailedCi};
