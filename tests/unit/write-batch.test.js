import {describe,it,expect,beforeEach} from 'vitest';
import {registry} from '../../src/tools/index.js';
import {guardedWriteBatch,tools} from '../../src/tools/workflows-write-batch.js';
import {createFakeDb} from '../../test/helpers/fake-db.js';

const A='a'.repeat(40),B='b'.repeat(40),NOW=Date.UTC(2026,9,27,20);
const steps=()=>[
  {name:'github_branch_create',args:{repo:'app',branch:'topic',from:'main'}},
  {name:'github_content_commit_git_data',args:{repo:'app',branch:'topic',expectedHead:{$from:0,path:'sha'},
    message:'Commit one file',files:[{path:'README.md',content:'published source'}]}},
  {name:'github_workflow_open_pr',args:{repo:'app',head:{$from:0,path:'branch'},title:'Deliver code'}}
];
const reply=body=>({structuredContent:body,content:[{type:'text',text:JSON.stringify(body)}]});
function harness({connection='first',account='org',clock=()=>NOW,work=null}={}){
  const db=createFakeDb({clock}),calls=[];
  const answers={
    github_branch_create:reply({status:'applied',done:true,confirmed:true,result:{branch:'topic',sha:A}}),
    github_content_commit_git_data:reply({status:'applied',done:true,confirmed:true,result:{
      branch_head:B,commit:B,parent:A,tree:'c'.repeat(40),files:1}}),
    github_workflow_open_pr:reply({status:'pr_opened',done:true,number:17,head_sha:B}),
    github_branch_get:reply({branch:'topic',head:B}),
    github_pr_get:reply({number:17,state:'open',head_sha:B})
  };
  const ctx={
    registry,connection:{client_id:connection,default_account:account,accounts:[account],
      mode:'preview',profile:'full',listing:'catalog'},
    db,now:clock,
    callTool:async(name,args)=>{
      calls.push({name,args});
      if(work)return work(name,args,calls,answers);
      return answers[name]??{isError:true};
    }
  };
  return {db,calls,ctx,answers};
}
const input=(extra={})=>({repo:'app',owner:'org',batchKey:'one-logical-change',steps:steps(),confirm:true,...extra});
describe('C-16 guarded sequential write batch',()=>{
  it('registers a separate explicitly changing tool, leaving github_batch read-only',()=>{
    expect(tools.map(t=>t.name)).toEqual(['github_write_batch']);
    const batch=registry.tools.find(t=>t.name==='github_write_batch');
    expect(batch.passthrough).toBe(true);
    expect(batch.delegatedWrites).toEqual(['*']);
    expect(batch.annotations.readOnlyHint).toBe(false);
    expect(registry.tools.find(t=>t.name==='github_batch').annotations.readOnlyHint).toBe(true);
  });
  it('creates a branch, commits exact prior HEAD and opens PR in one call, then replays without any write',async()=>{
    const f=harness();
    const result=await guardedWriteBatch(input(),f.ctx);
    expect(result).toMatchObject({status:'complete',done:true,completed:3,attempted:3,
      atomic:false,rollback:false,items:[
        {index:0,status:'applied',reference:{branch:'topic',sha:A}},
        {index:1,status:'applied',reference:{branch_head:B,commit:B}},
        {index:2,status:'applied',reference:{number:17,head_sha:B}}]});
    expect(f.calls.map(x=>x.name)).toEqual([
      'github_branch_create','github_content_commit_git_data','github_workflow_open_pr']);
    expect(f.calls[1].args.expectedHead).toBe(A);
    expect(f.calls[2].args.head).toBe('topic');
    expect(f.calls.every(x=>x.args.confirm===true)).toBe(true);
    const replay=await guardedWriteBatch(input(),f.ctx);
    expect(replay).toMatchObject({status:'replayed',replayed:true,done:true,completed:3});
    expect(f.calls).toHaveLength(3);
  });
  it('previews the whole plan with no database claim or GitHub writes',async()=>{
    const f=harness();
    const result=await guardedWriteBatch(input({dryRun:true}),f.ctx);
    expect(result.status).toBe('preview');
    expect(result.items).toHaveLength(3);
    expect(f.calls).toHaveLength(0);
    expect((await guardedWriteBatch(input(),f.ctx)).status).toBe('complete');
  });
  it('stops at a middle-step definitive guard refusal; stores the first receipt and never submits later steps',async()=>{
    const f=harness({work:async(name,args,calls,answers)=>
      name==='github_content_commit_git_data'?reply({status:'refused',reason:'Branch protection rejected this exact head.'}):
      answers[name]});
    const first=await guardedWriteBatch(input(),f.ctx);
    expect(first).toMatchObject({status:'stopped',completed:1,items:[
      {status:'applied'},{status:'refused',reason:'Branch protection rejected this exact head.'}]});
    expect(f.calls).toHaveLength(2);
    const again=await guardedWriteBatch(input(),f.ctx);
    expect(again.status).toBe('stopped');
    expect(f.calls).toHaveLength(2);
  });
  it('an interrupted possibly applied step is marked uncertain and cannot be automatically resent',async()=>{
    const f=harness({work:async(name,args,calls,answers)=>{
      if(name==='github_content_commit_git_data')throw new Error('connection lost after send');
      return answers[name];
    }});
    expect((await guardedWriteBatch(input(),f.ctx)).status).toBe('reconciliation_required');
    expect((await guardedWriteBatch(input(),f.ctx)).status).toBe('reconciliation_required');
    expect(f.calls.map(x=>x.name)).toEqual(['github_branch_create','github_content_commit_git_data']);
  });
  it('changed plan under the same batch key is denied without changing the recorded authorization',async()=>{
    const f=harness();
    await guardedWriteBatch(input(),f.ctx);
    const modified=input();modified.steps[1].args.message='Different source';
    const again=await guardedWriteBatch(modified,f.ctx);
    expect(again).toMatchObject({status:'refused'});
    expect(again.reason).toMatch(/different authorization intent/i);
    expect(f.calls).toHaveLength(3);
  });
  it('rejects forward, self, secret and object references before sending any mutation',async()=>{
    for(const v of [
      {$from:1,path:'sha'},{$from:0,path:'secret'},{$from:3,path:'sha'},
      {$from:0,path:'result.data'},{$from:0,path:'__proto__'}
    ]){
      const f=harness(),a=input();
      a.steps[0].args.from=v;
      expect((await guardedWriteBatch(a,f.ctx)).status).toBe('refused');
      expect(f.calls).toHaveLength(0);
    }
  });
  it('requires an explicit expected HEAD for a Git Data commit; no accidental branch-race overwrite',async()=>{
    const f=harness();const a=input();
    delete a.steps[1].args.expectedHead;
    expect((await guardedWriteBatch(a,f.ctx)).reason).toMatch(/exact expectedHead/i);
    expect(f.calls).toHaveLength(0);
  });
  it('passes user-owned per-step confirmation and chooses the original writer guards',async()=>{
    const f=harness();
    const a=input({confirm:true});
    a.steps[1].args.confirm=false;
    const r=await guardedWriteBatch(a,f.ctx);
    expect(r.status).toBe('complete');
    expect(f.calls[1].args.confirm).toBe(false);
  });
  it('does not store unsafe writer data in batch receipts even when provider returned it',async()=>{
    const f=harness({work:async(name,args,calls,answers)=>
      name==='github_branch_create'?reply({status:'applied',done:true,confirmed:true,
        result:{branch:'topic',sha:A,access_token:'ghp_SECRET',private_key:'abc'}}):answers[name]});
    const r=await guardedWriteBatch(input(),f.ctx);
    expect(r.status).toBe('complete');
    expect(JSON.stringify(r)).not.toMatch(/ghp_SECRET|private_key/);
  });
  it('a read-only profile or unconnected account cannot run the batch',async()=>{
    const f=harness();f.ctx.connection.profile='read_only';
    expect((await guardedWriteBatch(input(),f.ctx)).status).toBe('refused');
    f.ctx.connection.profile='full';
    expect((await guardedWriteBatch({...input(),owner:'foreign'},f.ctx)).status).toBe('refused');
    expect(f.calls).toHaveLength(0);
  });
  it('enforces delegated repo grant before any mutation',async()=>{
    const f=harness();
    Object.assign(f.ctx.connection,{pass:true,allow_writes:true,areas:['workflow','branch','content','pr'],
      repos:['org/other']});
    expect((await guardedWriteBatch(input(),f.ctx)).status).toBe('refused');
    expect(f.calls).toHaveLength(0);
  });
  it('does not permit altered plans or cross-tenant receipts to leak through a batch identifier',async()=>{
    const one=harness({connection:'tenant-1'});
    const two=harness({connection:'tenant-2'});
    expect((await guardedWriteBatch(input(),one.ctx)).status).toBe('complete');
    expect((await guardedWriteBatch(input(),two.ctx)).status).toBe('complete');
    expect(one.calls).toHaveLength(3);
    expect(two.calls).toHaveLength(3);
  });
  it('accepts only visible reviewed guarded writes, not read tools or unguarded meta calls',async()=>{
    for(const name of ['github_repo_get','github_call','github_batch','github_write_batch']){
      const f=harness(),a=input({steps:[{name,args:{repo:'app'}}]});
      expect((await guardedWriteBatch(a,f.ctx)).status).toBe('refused');
      expect(f.calls).toHaveLength(0);
    }
  });
  it('does not send a GitHub call if durable persistence is unavailable',async()=>{
    const f=harness();delete f.ctx.db.claimWriteBatch;
    expect((await guardedWriteBatch(input(),f.ctx)).status).toBe('refused');
    expect(f.calls).toHaveLength(0);
  });
  it('parallel same-key double submissions send exactly one set of writes',async()=>{
    let unblock;const firstWrite=new Promise(resolve=>{unblock=resolve;});
    let waiting;const entered=new Promise(resolve=>{waiting=resolve;});
    const f=harness({work:async(name,args,calls,answers)=>{
      if(name==='github_branch_create'){waiting();await firstWrite;}
      return answers[name];
    }});
    const p=guardedWriteBatch(input(),f.ctx);
    await entered;
    const denied=await guardedWriteBatch(input(),f.ctx);
    expect(denied.status).toBe('in_progress');
    unblock();
    const done=await p;
    expect(done.status).toBe('complete');
    expect(f.calls).toHaveLength(3);
  });
});
