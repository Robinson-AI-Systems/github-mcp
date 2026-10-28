import {describe,it,expect} from 'vitest';
import {inspectPr,mergeAutomationStatus,tools} from '../../src/tools/workflows-pr.js';
import {ciFailureSummary} from '../../src/tools/workflows-ci.js';
import {registry} from '../../src/tools/index.js';

const A='a'.repeat(40), B='b'.repeat(40);
const pr=(extra={})=>({number:7,head_sha:A,state:'open',merged:false,mergeable:true,
  mergeable_state:'clean',draft:false,base:'main',threads:{unresolved:0},
  review_decision:'APPROVED',checks:{green:true,items:[{context:'ci',state:'success'}]},
  auto_merge:{known:true,enabled:false},...extra});
function harness(p=pr(),diagnosis=null,rows=[]){
  const calls=[];const ctx={now:()=>Date.parse('2026-10-27T20:00:00Z'),
    connection:{accounts:['example-org'],default_account:'example-org',client_id:'mine'},
    db:{listChanges:async a=>{calls.push({name:'listChanges',args:a});return rows;}},
    callTool:async(name,args)=>{calls.push({name,args});const payload={
      github_pr_get:p,github_pr_list_stacks:{count:0,items:[]},
      github_workflow_ci_failure_summary:diagnosis}[name];
      return payload==null?{isError:true}:{structuredContent:structuredClone(payload)};
    }};
  return {ctx,calls};
}
const args={owner:'example-org',repo:'app',number:7};
describe('C-14 PR diagnostics',()=>{
  it('keeps the green path minimal and exact-head CI intact',async()=>{
    const f=harness();const result=await inspectPr(args,f.ctx);
    expect(result).toMatchObject({head_sha:A,checks:{green:true},can_request_merge:true});
    expect(result.ci_failure).toBeUndefined();
    expect(f.calls.map(x=>x.name)).toEqual(['github_pr_get','github_pr_list_stacks']);
  });
  it('includes first head-matched failed job, failing step, bounded error and annotations',async()=>{
    const f=harness(pr({checks:{green:false,items:[{context:'ci',state:'failure'}]}}),{runs:[{
      head_sha:A,run_id:12,failed_jobs:[{name:'unit',failed_steps:[{name:'Run tests'}],
        logs_readable:true,error_lines:['AssertionError expected valid result'],
        annotations:{complete:true,items:[{path:'tests/unit/app.test.js',line:34,message:'Assertion failed'}]}}]}]});
    const result=await inspectPr(args,f.ctx);
    expect(result.ci_failure).toMatchObject({status:'observed',head_sha:A,run_id:12,job:'unit',
      failed_step:'Run tests',error_excerpt:['AssertionError expected valid result'],
      annotations:[{line:34,path:'tests/unit/app.test.js'}]});
    expect(f.calls.at(-1)).toMatchObject({name:'github_workflow_ci_failure_summary',
      args:{pr:7,firstFailureOnly:true}});
  });
  it('never attributes stale-head or inaccessible CI logs to current PR',async()=>{
    const p=pr({checks:{green:false,items:[{context:'ci',state:'failure'}]}});
    const stale=harness(p,{runs:[{head_sha:B,run_id:13,failed_jobs:[{name:'old'}]}]});
    expect((await inspectPr(args,stale.ctx)).ci_failure.status).toBe('unavailable');
    const noLogs=harness(p,{runs:[{head_sha:A,run_id:14,failed_jobs:[{
      name:'unit',failed_steps:[{name:'Run tests'}],logs_readable:false,error_lines:null,
      annotations:{complete:false,items:[{path:'a.js',line:2,message:'line 2 failed'}]}}]}]});
    expect((await inspectPr(args,noLogs.ctx)).ci_failure).toMatchObject({
      status:'observed',logs_readable:false,error_excerpt:null,annotations:[{line:2}]});
  });
  it('clips unsafe descriptions without emitting credential-shaped text',async()=>{
    const f=harness(pr({checks:{green:false,items:[{context:'ci',state:'failure'}]}}),{runs:[{
      head_sha:A,run_id:15,failed_jobs:[{name:'unit',failed_steps:[{name:'test'}],
        logs_readable:true,error_lines:['bad '+('x'.repeat(330))],annotations:{items:[]}}]}]});
    const result=await inspectPr(args,f.ctx);
    expect(result.ci_failure.error_excerpt[0].length).toBeLessThanOrEqual(300);
  });
});
describe('C-14 provider-native auto-merge state',()=>{
  it('registers a read-only tool (no new writer or poller)',()=>{
    expect(tools.find(t=>t.name==='github_workflow_merge_automation_status')?.annotations.readOnlyHint).toBe(true);
    expect(registry.tools.some(t=>t.name==='github_workflow_merge_automation_status')).toBe(true);
  });
  it('reports disabled and merged, never inferring arming from mergeable',async()=>{
    expect(await mergeAutomationStatus(args,harness().ctx)).toMatchObject({status:'disabled',armed:false});
    expect(await mergeAutomationStatus(args,harness(pr({merged:true,state:'closed'})).ctx))
      .toMatchObject({status:'completed',armed:false});
  });
  it('reads a real native arm and exact-head recorded receipt for this connection',async()=>{
    const saved=[{connection:'mine',confirmed:true,at:'2026-10-27T19:00:00Z',
      before:{pr:{number:7,head_sha:A}},after:{auto_merge:{enabled_by:{login:'person'}}}}];
    const f=harness(pr({auto_merge:{known:true,enabled:true,merge_method:'MERGE'},
      checks:{green:false,items:[{context:'ci',state:'failure'}]}}),null,saved);
    expect(await mergeAutomationStatus(args,f.ctx)).toMatchObject({status:'waiting',armed:true,
      armed_head_sha:A,waiting_on:['checks'],recorded_at:'2026-10-27T19:00:00Z'});
    expect(f.calls.find(c=>c.name==='listChanges').args).toMatchObject({
      repo:'example-org/app',account:'example-org',tool:'github_pr_set_auto_merge'});
  });
  it('never trusts another connection receipt or guesses the armed SHA',async()=>{
    const saved=[{connection:'foreign',confirmed:true,before:{pr:{number:7,head_sha:A}},
      after:{auto_merge:{enabled:true}}}];
    const f=harness(pr({auto_merge:{known:true,enabled:true}}),null,saved);
    const state=await mergeAutomationStatus(args,f.ctx);
    expect(state).toMatchObject({status:'armed_unknown_head',armed:true,armed_head_sha:null});
    expect(state).not.toHaveProperty('recorded_at','2026-10-27T19:00:00Z');
  });
  it('labels superseded receipt after head change and unreadable native state',async()=>{
    const saved=[{connection:'mine',confirmed:true,before:{pr:{number:7,head_sha:B}},
      after:{auto_merge:{enabled:true}}}];
    expect(await mergeAutomationStatus(args,harness(pr({auto_merge:{known:true,enabled:true}}),null,saved).ctx))
      .toMatchObject({status:'superseded_head',armed:true,armed_head_sha:null,previous_recorded_head_sha:B});
    expect(await mergeAutomationStatus(args,harness(pr({auto_merge:{known:false}})).ctx))
      .toMatchObject({status:'unknown',armed:null});
  });
  it('does not read a foreign account or leak historical records',async()=>{
    const f=harness(pr({auto_merge:{known:true,enabled:true}}));
    const result=await mergeAutomationStatus({...args,owner:'foreign-org'},f.ctx);
    expect(result.status).toBe('not_readable');
    expect(f.calls).toEqual([]);
  });
});
describe('C-14 bounded first-failure CI helper',()=>{
  it('does not fetch default-branch baseline and stops at first failed job',async()=>{
    const calls=[];const run={id:9,workflow_id:4,head_sha:A,status:'completed',
      conclusion:'failure',jobs_complete:true,jobs:[
        {id:5,name:'unit',conclusion:'failure',failed_steps:[{name:'test'}]},
        {id:6,name:'browser',conclusion:'failure',failed_steps:[{name:'browser test'}]}]};
    const ctx={now:()=>0,callTool:async(name,a)=>{
      calls.push({name,a});const x={
        github_pr_get:{head_sha:A},
        github_actions_list_runs:{count:1,items:[{id:9,workflow_id:4,head_sha:A}]},
        github_repo_get:{default_branch:'main'},github_actions_get_run:run,
        github_actions_get_job_log:{errors:['test failure']}}[name];
      return x?{structuredContent:x}:{isError:true};
    }};
    const result=await ciFailureSummary({repo:'app',pr:7,firstFailureOnly:true},ctx);
    expect(result.done).toBe(true);
    expect(result.runs[0].failed_jobs).toHaveLength(1);
    expect(calls.filter(x=>x.name==='github_actions_get_job_log')).toHaveLength(1);
    expect(calls.some(x=>x.name==='github_actions_list_runs'&&x.a.workflow)).toBe(false);
  });
});
