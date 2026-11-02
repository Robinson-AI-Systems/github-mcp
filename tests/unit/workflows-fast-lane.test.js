import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createDispatch } from '../../src/tools/dispatch.js';
import { registry } from '../../src/tools/index.js';
import { makeWorld } from '../../test/helpers/write-contract.js';
import { handlers as mergeWorkflows } from '../../src/tools/workflows-merge.js';

const SHA='a'.repeat(40);
const PULL='GET /repos/{owner}/{repo}/pulls/{pull_number}';
const PR=(extra={})=>({ number:7, title:'A change', state:'open', draft:false, merged:false,
  head:{ref:'feat',sha:SHA},base:{ref:'main'},html_url:'https://github.com/example-org/hello/pull/7',...extra });
const dispatcher=w=>createDispatch({ env:w.ctx.env,credentials:w.credentials,gates:w.ctx.gates,
  fetch:w.gh.fetch,now:w.ctx.now,sleep:async()=>{} });
const run=(w,args)=>dispatcher(w)({registry,name:'github_workflow_open_pr',args,connection:w.connection,db:w.db});
const calls=(w,route)=>w.gh.calls.filter(x=>x.route===route);
async function world({existing=false,unconfirmed=false}={}){
  const w=await makeWorld({profile:'everyday'});
  w.gh.when('GET /repos/{owner}/{repo}').reply(200,{default_branch:'main'});
  w.gh.when('GET /repos/{owner}/{repo}/pulls').reply(200,existing?[PR()]:[]);
  w.gh.when('GET /repos/{owner}/{repo}/git/ref/{ref}').reply(200,{object:{sha:SHA}});
  w.gh.when('POST /repos/{owner}/{repo}/pulls').reply(201,PR());
  w.gh.when(PULL).reply(200,unconfirmed?PR({head:{ref:'changed',sha:SHA}}):PR());
  return w;
}
describe('C-6 real guarded no-label PR creation lane',()=>{
  it('benchmarks the synthetic three-stage PR lane and records measured scheduling cuts',()=>{
    const stdout=execFileSync(process.execPath,['scripts/benchmark-pr-conveyor.mjs'],{
      cwd:process.cwd(),encoding:'utf8',timeout:20000
    });
    const data=JSON.parse(stdout);
    expect(data).toMatchObject({fakeReadMs:25,repetitions:5});
    expect(data.rows.map(x=>x.name)).toEqual(['openPr','mergeOne','stackReadSix']);
    for(const row of data.rows)expect(row.serialControlMedianMs).toBeGreaterThan(row.optimizedMedianMs);
    console.log('C-6 synthetic benchmark '+JSON.stringify(data));
  });

  it('creates with one guarded writer and exactly one repo/inventory read rather than duplicate outer preflights',async()=>{
    const w=await world();
    const r=await run(w,{repo:'hello',head:'feat',title:'A change'});
    expect(r.isError).not.toBe(true);
    expect(r.structuredContent).toMatchObject({done:true,status:'pr_opened',number:7,head_sha:SHA});
    expect(calls(w,'GET /repos/{owner}/{repo}')).toHaveLength(1);
    expect(calls(w,'GET /repos/{owner}/{repo}/pulls')).toHaveLength(1);
    expect(calls(w,'POST /repos/{owner}/{repo}/pulls')).toHaveLength(1);
    expect(calls(w,PULL)).toHaveLength(1);
    expect(w.gh.invalid).toEqual([]);
  });
  it('uses writer idempotence, returns an existing matching PR and makes no duplicate write',async()=>{
    const w=await world({existing:true});
    const r=await run(w,{repo:'hello',head:'feat',title:'A change'});
    expect(r.structuredContent).toMatchObject({done:true,status:'existing',number:7});
    expect(calls(w,'GET /repos/{owner}/{repo}')).toHaveLength(1);
    expect(calls(w,'GET /repos/{owner}/{repo}/pulls')).toHaveLength(1);
    expect(calls(w,'POST /repos/{owner}/{repo}/pulls')).toHaveLength(0);
  });
  it('does not claim success when the guarded writer cannot confirm independent readback',async()=>{
    const w=await world({unconfirmed:true});
    const r=await run(w,{repo:'hello',head:'feat',title:'A change'});
    expect(r.structuredContent).toMatchObject({done:false,status:'not_applied',underlying_status:'unconfirmed'});
    expect(calls(w,'POST /repos/{owner}/{repo}/pulls')).toHaveLength(1);
  });
  it('does not bypass notification confirmation on a routine-looking PR title',async()=>{
    const w=await world();
    const r=await run(w,{repo:'hello',head:'feat',title:'Please review @outside-collaborator'});
    // CONN-FB-1: an unconfirmed call is a plain preview (nothing sent), still carrying the writer's confirmation status.
    expect(r.structuredContent).toMatchObject({done:false,status:'preview',underlying_status:'needs_confirmation'});
    expect(calls(w,'POST /repos/{owner}/{repo}/pulls')).toHaveLength(0);
  });
  it('still refuses a connection without write permission',async()=>{
    const w=await world();
    const readOnly=Object.freeze({...w.connection,profile:'read_only'});
    const r=await dispatcher(w)({registry,name:'github_workflow_open_pr',
      args:{repo:'hello',head:'feat',title:'A change'},connection:readOnly,db:w.db});
    expect(r.isError).toBe(true);
    expect(calls(w,'POST /repos/{owner}/{repo}/pulls')).toHaveLength(0);
  });
});

const ready=(number,extra={})=>({number,head_sha:SHA,head:'branch-'+number,base:'main',
  state:'open',draft:false,merged:false,mergeable:true,review_decision:'APPROVED',
  threads:{unresolved:0},checks:{green:true,items:[{state:'success',started_at:'2026-10-15T15:00:00Z'}]},...extra});
const reply=x=>({structuredContent:x});
const ctxFor=read=>({connection:{profile:'full'},now:Date.now,
  callTool:async(name,args)=>reply(await read(name,args))});
describe('C-6 parallel exact-head merge preparation',()=>{
  it('starts independent PR/default branch reads together and still issues one guarded merge',async()=>{
    let active=0,peak=0,mutations=0,merged=false;
    const ctx=ctxFor(async(name)=>{
      if(name==='github_pr_get'||name==='github_repo_get'){
        active++;peak=Math.max(peak,active);
        await new Promise(resolve=>setTimeout(resolve,20));
        active--;return name==='github_pr_get'?ready(4,merged?{state:'closed',merged:true}:{}):{default_branch:'main'};
      }
      if(name==='github_pr_merge'){mutations++;merged=true;return {status:'applied'};}
      throw new Error('Unexpected tool '+name);
    });
    const r=(await mergeWorkflows.github_workflow_merge_when_green(
      {repo:'hello',number:4,expectedHeadSha:SHA,confirm:true},ctx)).structuredContent;
    expect(r).toMatchObject({status:'merged',done:true});
    expect(peak).toBe(2);
    expect(mutations).toBe(1);
  });
  it('refuses stale head after overlapping independent reads, without sending a merge',async()=>{
    let writes=0;
    const ctx=ctxFor(async(name)=>{
      if(name==='github_repo_get')return {default_branch:'main'};
      if(name==='github_pr_get')return ready(4,{head_sha:'b'.repeat(40)});
      if(name==='github_pr_merge'){writes++;return {status:'applied'};}
      throw new Error('Unexpected '+name);
    });
    const r=(await mergeWorkflows.github_workflow_merge_when_green(
      {repo:'hello',number:4,expectedHeadSha:SHA},ctx)).structuredContent;
    expect(r.status).toBe('not_ready');
    expect(writes).toBe(0);
  });
  it('reads at most 3 chain members at once and validates the complete ordered chain before any write',async()=>{
    let active=0,peak=0,mutations=0;
    const ctx=ctxFor(async(name,args)=>{
      if(name==='github_repo_get')return {default_branch:'main'};
      if(name==='github_pr_get'){
        active++;peak=Math.max(peak,active);
        await new Promise(resolve=>setTimeout(resolve,12+(args.number%3)*4));
        active--;
        return ready(args.number,{state:'closed',merged:true});
      }
      if(name==='github_pr_merge'||name==='github_pr_update'){mutations++;return {status:'applied'};}
      throw new Error('Unexpected '+name);
    });
    const r=(await mergeWorkflows.github_workflow_merge_stack({repo:'hello',prs:[1,2,3,4,5,6]},ctx)).structuredContent;
    expect(r).toMatchObject({status:'complete',done:true,prs:[1,2,3,4,5,6]});
    expect(peak).toBe(3);
    expect(active).toBe(0);
    expect(mutations).toBe(0);
  });
  it('fails closed on incomplete chain before making any write',async()=>{
    let writes=0;
    const ctx=ctxFor(async(name,args)=>{
      if(name==='github_repo_get')return {default_branch:'main'};
      if(name==='github_pr_get')return args.number===3?null:ready(args.number);
      if(name==='github_pr_merge'||name==='github_pr_update')writes++;
      return {status:'applied'};
    });
    const r=(await mergeWorkflows.github_workflow_merge_stack({repo:'hello',prs:[1,2,3]},ctx)).structuredContent;
    expect(r.status).toBe('refused');
    expect(writes).toBe(0);
  });
});
