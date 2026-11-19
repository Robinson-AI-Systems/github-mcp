import {describe,it,expect} from 'vitest';
import {ciFailureSummary,rerunFailedCi} from '../../src/tools/workflows-ci.js';
const A='a'.repeat(40),B='b'.repeat(40);
const job=(id=5,extra={})=>({id,name:'unit',conclusion:'failure',failed_steps:[{name:'Run tests',number:2}],check_run_id:99,...extra});
const run=(id=1,extra={})=>({id,workflow_id:20,head_sha:A,status:'completed',conclusion:'failure',run_attempt:1,jobs_complete:true,jobs:[job()],...extra});
function fixture(){
  let clock=0,guard='applied';const calls=[],claims=new Set(),runs={1:run(),2:run(2,{head_sha:B,head_branch:'main',jobs:[job(6)]})};
  const ctx={connection:{profile:'full'},now:()=>clock,callTool:async(n,a)=>{
    calls.push({name:n,args:a});let v;
    if(n==='github_actions_get_run')v=runs[a.runId];
    if(n==='github_repo_get')v={default_branch:'main'};
    if(n==='github_pr_get')v={head_sha:A};
    if(n==='github_commit_get')v={sha:A};
    if(n==='github_actions_list_runs')v={items:a.workflow?[runs[2]]:[runs[1]]};
    if(n==='github_actions_get_job_log')v={errors:['AssertionError: expected denied request']};
    if(n==='github_check_get_run')v={head_sha:a.checkRunId===99?A:B,annotations_count:1,annotations:[{path:'test.js',line:4,message:'Denied expected'}]};
    if(n==='github_actions_rerun'){
      if(a.dryRun)v={status:'preview'};
      else if(claims.has(a.expectedWorkflowId+':'+a.expectedHeadSha))v={status:'replayed',confirmed:true};
      else{v={status:guard,confirmed:guard==='applied'};if(guard==='applied')claims.add(a.expectedWorkflowId+':'+a.expectedHeadSha);}
    }
    return v?{structuredContent:structuredClone(v)}:{isError:true};
  }};
  return {ctx,calls,runs,setGuard:v=>guard=v,setTime:v=>clock=v};
}
const arg={repo:'app',runId:1,expectedHeadSha:A};
const body=r=>r.structuredContent;
describe('W-4 CI failure diagnosis',()=>{
  it('collects errors, failed steps and annotations and compares same-workflow default-branch failures',async()=>{
    const f=fixture(),r=await ciFailureSummary({repo:'app',pr:7},f.ctx);
    expect(r).toMatchObject({done:true,runs:[{run_id:1,baseline:{run_id:2,branch:'main'},failed_jobs:[{name:'unit',same_failure_on_default:true,error_lines:['AssertionError: expected denied request'],annotations:{complete:true},untrusted:true}]}]});
    expect(f.calls.find(c=>c.name==='github_actions_list_runs'&&c.args.workflow).args).toMatchObject({workflow:'20',branch:'main',max:1});
    expect(f.calls.some(c=>c.name==='github_actions_rerun')).toBe(false);
  });
  it('does not claim CI diagnosis complete when GitHub has no runs for this PR head',async()=>{
    const f=fixture(),original=f.ctx.callTool;
    f.ctx.callTool=(name,args)=>name==='github_actions_list_runs'?
      Promise.resolve({structuredContent:{count:0,items:[]}}):original(name,args);
    const result=await ciFailureSummary({repo:'app',pr:7},f.ctx);
    expect(result).toMatchObject({done:false,status:'no_runs',runs:[]});
    expect(result.next_action).toMatch(/no CI diagnosis/i);
    expect(f.calls.some(x=>x.name==='github_actions_rerun')).toBe(false);
  });
  it('requests only bounded exact-head run fields before fetching complete jobs',async()=>{
    const f=fixture();await ciFailureSummary({repo:'app',pr:7},f.ctx);
    const lists=f.calls.filter(x=>x.name==='github_actions_list_runs');
    expect(lists[0].args).toMatchObject({headSha:A,max:50,detail:'full',
      fields:['id','workflow_id','head_sha','head_branch','status','conclusion']});
    expect(lists[1].args).toMatchObject({workflow:'20',branch:'main',max:1,
      fields:['id','workflow_id','head_sha','head_branch','status','conclusion']});
    expect(f.calls.filter(x=>x.name==='github_actions_get_run')).toHaveLength(2);
  });
  it('treats full-page and result-handle run inventories as incomplete',async()=>{
    for(const inventory of [
      {count:1,items:[],kept_result:{handle:'held'}},
      {count:50,items:Array.from({length:50},()=>({workflow_id:20,head_sha:A,id:1}))},
      {count:3,items:[{id:1,workflow_id:20,head_sha:A}]},
      {items:[],more_exist:true}
    ]){
      const f=fixture(),prior=f.ctx.callTool;
      f.ctx.callTool=(n,a)=>n==='github_actions_list_runs'?
        Promise.resolve({structuredContent:inventory}):prior(n,a);
      expect((await ciFailureSummary({repo:'app',pr:7},f.ctx)).status).toBe('unreadable');
    }
  });
  it('handles empty successful CI without manufacturing a failure',async()=>{
    const f=fixture();f.runs[1]=run(1,{conclusion:'success',jobs:[job(5,{conclusion:'success',failed_steps:[]})]});
    expect(await ciFailureSummary({repo:'app',ref:'feature'},f.ctx)).toMatchObject({done:true,runs:[{failed_jobs:[]}]});
  });
  it('reports unavailable baseline/logs as unknown, and a successful baseline job as different',async()=>{
    for(const unavailable of ['baseline','logs','success']){
      const f=fixture();
      if(unavailable==='baseline')delete f.runs[2];
      if(unavailable==='logs'){const original=f.ctx.callTool;f.ctx.callTool=(n,a)=>n==='github_actions_get_job_log'?Promise.resolve({isError:true}):original(n,a);}
      if(unavailable==='success')f.runs[2]=run(2,{head_sha:B,head_branch:'main',conclusion:'success',jobs:[job(6,{conclusion:'success',failed_steps:[]})]});
      const r=await ciFailureSummary({repo:'app',runId:1},f.ctx);
      expect(r.runs[0].failed_jobs[0].same_failure_on_default).toBe(unavailable==='success'?false:null);
      if(unavailable==='logs')expect(r.runs[0].failed_jobs[0]).toMatchObject({logs_readable:false,error_lines:null});
    }
  });
  it('collects every failed job and never guesses a pass from capped evidence',async()=>{
    const f=fixture();f.runs[1].jobs.push(job(10,{name:'db'}));
    expect((await ciFailureSummary({repo:'app',runId:1},f.ctx)).runs[0].failed_jobs).toHaveLength(2);
    f.runs[1].jobs_complete=false;
    expect((await ciFailureSummary({repo:'app',runId:1},f.ctx)).runs[0]).toMatchObject({complete:false,failed_jobs:[]});
  });
  it('rejects ambiguous selectors, wrong-head inventory and capped run listing',async()=>{
    const f=fixture();expect((await ciFailureSummary({repo:'app',pr:7,runId:1},f.ctx)).status).toBe('unreadable');
    const original=f.ctx.callTool;f.ctx.callTool=(n,a)=>n==='github_actions_list_runs'?Promise.resolve({structuredContent:{more_exist:true,items:[]}}):original(n,a);
    expect((await ciFailureSummary({repo:'app',ref:'feature'},f.ctx)).status).toBe('unreadable');
    f.ctx.callTool=original;f.runs[1].head_sha=B;
    expect((await ciFailureSummary({repo:'app',pr:7},f.ctx)).status).toBe('unreadable');
  });
  it('does not attribute a different workflow run as the default baseline',async()=>{
    const f=fixture();f.runs[2].workflow_id=30;
    expect((await ciFailureSummary({repo:'app',runId:1},f.ctx)).runs[0].baseline).toBe(null);
  });
  it('returns a budget checkpoint without polling',async()=>{
    const f=fixture(),original=f.ctx.callTool;
    f.ctx.callTool=async(n,a)=>{const r=await original(n,a);if(n==='github_repo_get')f.setTime(47000);return r;};
    expect(await ciFailureSummary({repo:'app',pr:7},f.ctx)).toMatchObject({done:false,status:'pending'});
    expect(f.calls.filter(c=>c.name==='github_actions_get_run')).toHaveLength(0);
  });
});
describe('W-4 durable failed-job retry composition',()=>{
  it('previews and delegates exact head/workflow only in failed mode',async()=>{
    const f=fixture();expect(body(await rerunFailedCi({...arg,dryRun:true},f.ctx)).status).toBe('preview');
    expect(body(await rerunFailedCi({...arg,confirm:true},f.ctx)).status).toBe('applied');
    expect(f.calls.filter(c=>c.name==='github_actions_rerun')[1].args).toMatchObject({mode:'failed',expectedHeadSha:A,expectedWorkflowId:20,confirm:true});
    expect(f.calls.filter(c=>c.name==='github_actions_rerun')[1].args.dryRun).toBeUndefined();
  });
  it('refuses a second automatic retry across attempts or new run IDs on the same workflow/head',async()=>{
    const f=fixture();await rerunFailedCi({...arg,confirm:true},f.ctx);
    f.runs[1].run_attempt=2;
    expect(body(await rerunFailedCi({...arg,confirm:true},f.ctx)).status).toBe('retry_already_claimed');
    f.runs[3]=run(3);
    expect(body(await rerunFailedCi({...arg,runId:3,confirm:true},f.ctx)).status).toBe('retry_already_claimed');
  });
  it('returns pending for active runs and refuses unknown head/incomplete/successful evidence',async()=>{
    for(const extra of [{status:'in_progress'},{head_sha:B},{jobs_complete:false},{conclusion:'success'},{jobs:[]}]){
      const f=fixture();Object.assign(f.runs[1],extra);
      expect(['pending','refused']).toContain(body(await rerunFailedCi(arg,f.ctx)).status);
      expect(f.calls.some(c=>c.name==='github_actions_rerun')).toBe(false);
    }
  });
  it('takes a PR number or a run id alone, in one try (RERUN-PR-1)',async()=>{
    const f=fixture();
    expect(body(await rerunFailedCi({repo:'app',pr:7,dryRun:true},f.ctx)).status).toBe('preview');
    expect(f.calls.filter(c=>c.name==='github_actions_rerun').at(-1).args).toMatchObject({runId:1,expectedHeadSha:A,expectedWorkflowId:20,mode:'failed'});
    expect(body(await rerunFailedCi({repo:'app',runId:1,dryRun:true},f.ctx)).status).toBe('preview');
    expect(f.calls.filter(c=>c.name==='github_actions_rerun').at(-1).args.expectedHeadSha).toBe(A);
    expect(body(await rerunFailedCi({repo:'app'},f.ctx))).toMatchObject({status:'refused',reason:expect.stringContaining('pr')});
    expect(body(await rerunFailedCi({repo:'app',pr:7,runId:1},f.ctx)).status).toBe('refused');
    expect(body(await rerunFailedCi({repo:'app',pr:7,expectedHeadSha:B},f.ctx)).reason).toContain('not the expectedHeadSha');
    f.runs[1].conclusion='success';
    expect(body(await rerunFailedCi({repo:'app',pr:7},f.ctx)).status).toBe('nothing_to_rerun');
  });
  it('says plainly when GitHub accepted the retry but the new attempt is not visible yet (SETTLE-1)',async()=>{
    const f=fixture();f.setGuard('accepted');
    expect(body(await rerunFailedCi({...arg,confirm:true},f.ctx)).next_action).toContain('GitHub accepted the retry');
  });
  it('keeps delegated production/confirmation refusals intact',async()=>{
    const f=fixture();f.setGuard('refused_by_guard');
    expect(body(await rerunFailedCi({...arg,confirm:true},f.ctx))).toMatchObject({done:false,status:'refused_by_guard'});
    f.ctx.connection.profile='read_only';expect(body(await rerunFailedCi(arg,f.ctx)).status).toBe('refused');
  });
});
