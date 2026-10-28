import {describe,it,expect} from 'vitest';
import {registry} from '../../src/tools/index.js';
import {handlers as prWorkflows} from '../../src/tools/workflows-pr.js';
import {handlers as mergeWorkflows} from '../../src/tools/workflows-merge.js';
import {tools as issueReadTools} from '../../src/tools/issues-read.js';

// The real tool schema bounds the arguments a workflow may pass (a mocked call must not hide an out-of-range one).
const timelineMax=issueReadTools.find(t=>t.name==='github_issue_list_timeline').inputSchema.properties.max.maximum;

const A='a'.repeat(40),B='b'.repeat(40),C='c'.repeat(40);
const ready=(number=4,more={})=>({
  number,state:'open',merged:false,draft:false,head_sha:A,head:'feature-a',
  base:'main',mergeable:true,review_decision:'APPROVED',
  threads:{unresolved:0},updated_at:'2026-10-15T01:00:00Z',
  checks:{green:true,basis:'required',items:[{context:'ci',state:'success',
    started_at:'2026-10-15T02:00:00Z'}]},labels:[],html_url:'https://github.com/example-org/app/pull/'+number,...more
});
function fixture({prs={4:ready()},mode='preview',profile='full',time=Date.parse('2026-10-15T03:00:00Z'),extra={}}={}){
  const calls=[];
  let clock=time;
  const outputs={
    github_repo_get:{default_branch:'main'},
    github_pr_list:{items:[],count:0},
    github_pr_list_stacks:{items:[],count:0},
    github_issue_list_timeline:{items:[],count:0},
    ...extra
  };
  const response=x=>({structuredContent:x,content:[{type:'text',text:JSON.stringify(x)}]});
  const ctx={
    connection:{mode,profile,accounts:['example-org'],default_account:'example-org'},
    now:()=>clock,
    callTool:async(name,args)=>{
      calls.push({name,args});
      const value=name==='github_pr_get'?prs[args.number]??null:outputs[name];
      if(typeof value==='function')return response(await value(args,prs,calls));
      return value===null?{isError:true,content:[{type:'text',text:'unreadable'}]}:response(value??{status:'preview'});
    }
  };
  return {ctx,calls,prs,outputs,advance:ms=>{clock+=ms;}};
}
const body=r=>r.structuredContent;
const writes=x=>x.calls.filter(c=>['github_pr_create','github_pr_merge','github_pr_update',
  'github_issue_set_labels'].includes(c.name));

describe('W-1 full PR status and resumable guarded open',()=>{
  it('registers both approved workflows with correct read-versus-change marks',()=>{
    for(const name of ['github_workflow_pr_status','github_workflow_open_pr',
      'github_workflow_merge_when_green','github_workflow_merge_stack'])
      expect(registry.tools.find(t=>t.name===name)).toBeDefined();
    expect(registry.tools.find(t=>t.name==='github_workflow_pr_status').annotations.readOnlyHint).toBe(true);
    expect(registry.tools.find(t=>t.name==='github_workflow_open_pr').passthrough).toBe(true);
  });
  it('reports exact CI, review decision, stack position and next action without a write',async()=>{
    const f=fixture({extra:{github_pr_list_stacks:{items:[{
      number:22,pull_requests:[{number:4},{number:5}]}],count:1}}});
    const got=await prWorkflows.github_workflow_pr_status({repo:'app',number:4},f.ctx);
    expect(got.checks.green).toBe(true);
    expect(got.stack.items[0]).toMatchObject({stack:22,position:1,number:4});
    expect(got.can_request_merge).toBe(true);
    expect(writes(f)).toEqual([]);
  });
  it('does not disguise missing review/CI evidence as safe to merge',async()=>{
    const f=fixture({prs:{4:ready(4,{threads:{unknown:'forbidden'},checks:{green:null}})}});
    const got=await prWorkflows.github_workflow_pr_status({repo:'app',number:4},f.ctx);
    expect(got.can_request_merge).toBe(false);
    expect(got.next_action).toMatch(/review threads could not be verified/i);
  });
  it('opens a PR through guarded writer with every confirmation/notification policy still delegated',async()=>{
    const f=fixture({extra:{github_pr_create:{status:'applied',number:21}}});
    const x=body(await prWorkflows.github_workflow_open_pr({
      repo:'app',head:'feature-a',title:'Real title',body:'@outsider please review',
      labels:['bug'],confirm:true,requestKey:'w1-open'},f.ctx));
    expect(x.status).toBe('pr_opened');
    expect(writes(f).map(c=>c.name)).toEqual(['github_pr_create']);
    expect(writes(f)[0].args).toMatchObject({head:'feature-a',base:'main',
      title:'Real title',confirm:true,requestKey:'w1-open:create'});
    expect(x.done).toBe(false);
  });
  it('refreshes journal-replayed PR evidence and refuses stale head, closed PR, or missing read without a new write',async()=>{
    const saved={done:true,status:'replayed',result:{number:4,head:{ref:'feature-a',sha:A},base:{ref:'main'}}};
    for(const [current,expected] of [
      [ready(4),{done:true,status:'existing',number:4,head_sha:A}],
      [ready(4,{head_sha:B}),{done:false,status:'stale_replay'}],
      [ready(4,{state:'closed',merged:true}),{done:false,status:'stale_replay'}],
      [null,{done:false,status:'stale_replay'}]
    ]){
      const f=fixture({prs:{4:current},extra:{github_pr_create:saved}});
      const output=body(await prWorkflows.github_workflow_open_pr({
        repo:'app',head:'feature-a',title:'Already sent',requestKey:'same-pr'},f.ctx));
      expect(output).toMatchObject(expected);
      expect(f.calls.map(x=>x.name)).toEqual(['github_pr_create','github_pr_get']);
      // The fixture counts delegated writer invocations, not provider POSTs;
      // journal replay calls exactly one guarded writer, never a second time.
      expect(writes(f)).toHaveLength(1);
    }
  });
  it('returns an already open PR and adds only missing labels through issue guard on separate invocation',async()=>{
    const f=fixture({prs:{4:ready(4,{labels:['ready']})},extra:{
      github_pr_list:{count:1,items:[{number:4,head:'feature-a',base:'main',state:'open',draft:false}]},
      github_issue_set_labels:{status:'applied'}
    }});
    const request={repo:'app',head:'feature-a',title:'Real title',labels:['ready','bug'],confirm:true};
    const x=body(await prWorkflows.github_workflow_open_pr(request,f.ctx));
    expect(x.status).toBe('labels_applied');
    expect(writes(f)).toHaveLength(1);
    expect(writes(f)[0]).toMatchObject({name:'github_issue_set_labels',
      args:{number:4,mode:'add',labels:['bug'],confirm:true}});
    f.prs[4].labels.push('bug');
    const done=body(await prWorkflows.github_workflow_open_pr(request,f.ctx));
    expect(done).toMatchObject({status:'existing',done:true,number:4});
    expect(writes(f)).toHaveLength(1);
  });
  it('refuses incomplete idempotence inventory, bad profile, duplicate labels and time budget',async()=>{
    const f=fixture({extra:{github_pr_list:{items:[],more_exist:true}}});
    expect(body(await prWorkflows.github_workflow_open_pr({
      repo:'app',head:'feature-a',title:'x',labels:['bug'],confirm:true},f.ctx)).status).toBe('refused');
    expect(writes(f)).toHaveLength(0);
    const narrow=fixture({profile:'read_only'});
    expect(body(await prWorkflows.github_workflow_open_pr({
      repo:'app',head:'feature-a',title:'x',confirm:true},narrow.ctx)).status).toBe('refused');
    const dup=fixture();
    expect(body(await prWorkflows.github_workflow_open_pr({
      repo:'app',head:'feature-a',title:'x',labels:['a','a'],confirm:true},dup.ctx)).status).toBe('refused');
    const timeout=fixture({extra:{github_repo_get:()=>{timeout.advance(48000);return {default_branch:'main'};}}});
    expect(body(await prWorkflows.github_workflow_open_pr({
      repo:'app',head:'feature-a',title:'x',labels:['bug'],confirm:true},timeout.ctx)).status).toBe('pending');
    expect(writes(timeout)).toHaveLength(0);
  });

  it('uses a compact normalized real-provider list and never creates a duplicate matching PR',async()=>{
    const f=fixture({prs:{4:ready(4,{labels:['ready']})},extra:{github_pr_list:{count:1,items:[
      {number:4,head:'feature-a',base:'main',state:'open',draft:false}
    ]}}});
    const result=body(await prWorkflows.github_workflow_open_pr({
      repo:'app',head:'feature-a',title:'Already exists',labels:['ready'],dryRun:false,confirm:true},f.ctx));
    expect(result).toMatchObject({done:true,status:'existing',number:4});
    expect(writes(f)).toHaveLength(0);
    const listCall=f.calls.find(x=>x.name==='github_pr_list');
    expect(listCall.args).toMatchObject({detail:'summary',max:20,
      fields:['number','head','base','state','draft']});
  });
  it('fails closed on held, capped, mismatched and non-array PR inventories',async()=>{
    for(const listed of [
      {count:1,items:[],kept_result:{handle:'opaque'}},
      {count:2,items:[{number:4,head:'feature-a',base:'main',state:'open'}]},
      {count:0,items:[],more_exist:true},
      {count:0,items:[],complete:false},
      {count:0,items:null},
      {count:20,items:Array.from({length:20},(_,i)=>({number:i+1,head:'other',base:'main',state:'open'}))}
    ]){
      const f=fixture({extra:{github_pr_list:listed}});
      const result=body(await prWorkflows.github_workflow_open_pr({
        repo:'app',head:'feature-a',title:'Never duplicate',labels:['ready'],confirm:true},f.ctx));
      expect(result).toMatchObject({done:false,status:'refused'});
      expect(writes(f)).toEqual([]);
    }
  });
});

describe('W-2 exact-head and one-step stack conveyor',()=>{
  const args={repo:'app',number:4,expectedHeadSha:A,confirm:true,requestKey:'w2-merge'};
  it('refuses stale SHA, draft, conflicts, missing CI, unreadable threads, and review rejection',async()=>{
    const cases=[
      {head_sha:B},{draft:true},{mergeable:false},{checks:{green:null}},
      {threads:{unknown:'provider denied'}},{threads:{unresolved:2}},
      {review_decision:'CHANGES_REQUESTED'},{base:'feature-parent'}
    ];
    for(const changes of cases){
      const f=fixture({prs:{4:ready(4,changes)},extra:{github_pr_merge:{status:'applied'}}});
      const x=body(await mergeWorkflows.github_workflow_merge_when_green(args,f.ctx));
      expect(x.done).toBe(false);
      expect(x.status).toBe('not_ready');
      expect(writes(f)).toHaveLength(0);
    }
  });
  it('offers explicit owner bypass through the same guarded writer despite red CI/reviews, but still checks identity and exact SHA',async()=>{
    const r=registry.tools.find(t=>t.name==='github_workflow_merge_when_green');
    expect(r.inputSchema.properties.overrideRules.type).toBe('boolean');
    expect(r.inputSchema.properties.overrideReason.minLength).toBe(10);
    const f=fixture({prs:{4:ready(4,{checks:{green:false},threads:{unresolved:2},
      review_decision:'CHANGES_REQUESTED'})},extra:{
      github_pr_merge:{status:'applied',result:{status:'pending'}}
    }});
    const request={repo:'app',number:4,expectedHeadSha:A,overrideRules:true,
      overrideReason:'Owner approved the exception',confirm:true};
    const x=body(await mergeWorkflows.github_workflow_merge_when_green(request,f.ctx));
    expect(x).toMatchObject({done:false,status:'pending'});
    expect(writes(f)).toHaveLength(1);
    expect(writes(f)[0]).toMatchObject({name:'github_pr_merge',args:{
      expectedHeadSha:A,overrideRules:true,overrideReason:'Owner approved the exception',confirm:true}});
    const ordinary=fixture({prs:{4:ready(4,{checks:{green:false},threads:{unresolved:2}})},
      extra:{github_pr_merge:{status:'applied'}}});
    expect(body(await mergeWorkflows.github_workflow_merge_when_green({
      repo:'app',number:4,expectedHeadSha:A,confirm:true},ordinary.ctx)).status).toBe('not_ready');
    expect(writes(ordinary)).toHaveLength(0);
    const stale=fixture({prs:{4:ready(4,{head_sha:B,checks:{green:false}})}});
    expect(body(await mergeWorkflows.github_workflow_merge_when_green(request,stale.ctx)).status).toBe('not_ready');
    expect(writes(stale)).toHaveLength(0);
    const readonly=fixture({profile:'read_only'});
    expect(body(await mergeWorkflows.github_workflow_merge_when_green(request,readonly.ctx)).status).toBe('refused');
    expect(writes(readonly)).toHaveLength(0);
  });
  it('forwards the real writer preview and guard refusal to the compact override caller',async()=>{
    const request={repo:'app',number:4,expectedHeadSha:A,overrideRules:true,
      overrideReason:'Owner reviewed explicit bypass'};
    const p=fixture({prs:{4:ready(4,{checks:{green:false},threads:{unresolved:2}})},extra:{
      github_pr_merge:{status:'needs_confirmation',done:false,needsConfirmation:true,
        preview:'OVERRIDE: Required scan not green; owner requested bypass',prompt:'Read the preview, then call again with confirm: true.'}
    }});
    const preview=body(await mergeWorkflows.github_workflow_merge_when_green(request,p.ctx));
    expect(preview).toMatchObject({status:'needs_confirmation',done:false,needsConfirmation:true,
      preview:expect.stringMatching(/OVERRIDE/),prompt:expect.stringMatching(/confirm: true/)});
    expect(writes(p)).toHaveLength(1);
    expect(writes(p)[0].args.confirm).toBe(false);
    const d=fixture({prs:{4:ready(4,{checks:{green:false}})},extra:{
      github_pr_merge:{status:'refused_by_guard',refusedBy:'protected',error:'User protected list forbids overrides'}
    }});
    const refused=body(await mergeWorkflows.github_workflow_merge_when_green({...request,confirm:true},d.ctx));
    expect(refused).toMatchObject({status:'not_applied',done:false,refusedBy:'protected',
      error:'User protected list forbids overrides'});
    expect(writes(d)).toHaveLength(1);
  });
  it('delegates exact head, merge method and independent guarded confirm; verifies provider readback',async()=>{
    const f=fixture({extra:{github_pr_merge:(a,prs)=>{
      prs[4]={...prs[4],state:'closed',merged:true};
      return {status:'applied',number:4,merged:true,merge_commit:C};
    }}});
    const x=body(await mergeWorkflows.github_workflow_merge_when_green(args,f.ctx));
    expect(x).toMatchObject({status:'merged',done:true,number:4});
    expect(writes(f)).toHaveLength(1);
    expect(writes(f)[0].args).toMatchObject({
      expectedHeadSha:A,method:'merge',confirm:true,requestKey:'w2-merge:4'});
  });
  it('never calls a mutating writer if the requested head is green but the review is unknown',async()=>{
    const f=fixture({prs:{4:ready(4,{threads:{unknown:'graphql outage'}})}});
    const x=body(await mergeWorkflows.github_workflow_merge_when_green(args,f.ctx));
    expect(x.blockers).toEqual(expect.arrayContaining([expect.stringMatching(/threads could not/i)]));
    expect(writes(f)).toHaveLength(0);
  });
  it('retargets an ordered stack bottom-up and returns without merging the stack parent',async()=>{
    const f=fixture({prs:{
      4:ready(4,{head_sha:A,head:'feature-a',base:'main'}),
      5:ready(5,{head_sha:B,head:'feature-b',base:'feature-a'})
    },extra:{github_pr_merge:(a,prs)=>{
      prs[a.number]={...prs[a.number],state:'closed',merged:true};
      return {status:'applied'};
    },github_pr_update:(a,prs)=>{
      prs[a.number]={...prs[a.number],base:a.base,updated_at:'2026-10-15T02:59:00Z',
        baseChangedAt:'2026-10-15T02:59:00Z'};
      return {status:'applied'};
    },github_issue_list_timeline:(a,prs)=>{
      expect(a.max).toBeLessThanOrEqual(timelineMax);
      const changed=prs[a.number].baseChangedAt;
      const items=changed?[{event:'base_ref_changed',created_at:changed}]:[];
      return {items,count:items.length};
    }}});
    const input={repo:'app',prs:[4,5],expectedHeadShas:[A,B],confirm:true,requestKey:'stack'};
    let x=body(await mergeWorkflows.github_workflow_merge_stack(input,f.ctx));
    expect(x).toMatchObject({status:'merged_one',number:4,done:false});
    x=body(await mergeWorkflows.github_workflow_merge_stack(input,f.ctx));
    expect(x).toMatchObject({status:'retargeted',number:5});
    expect(f.prs[5].base).toBe('main');
    expect(writes(f)[1].args.expectedHeadSha).toBe(B);
    x=body(await mergeWorkflows.github_workflow_merge_stack(input,f.ctx));
    expect(x).toMatchObject({status:'pending_fresh_ci',number:5});
    expect(writes(f).map(c=>c.name)).toEqual(['github_pr_merge','github_pr_update']);
    f.prs[5].checks.items[0].started_at='2026-10-15T03:00:00Z';
    x=body(await mergeWorkflows.github_workflow_merge_stack(input,f.ctx));
    expect(x.status).toBe('merged_one');
    expect(writes(f).map(c=>c.name)).toEqual([
      'github_pr_merge','github_pr_update','github_pr_merge']);
    x=body(await mergeWorkflows.github_workflow_merge_stack(input,f.ctx));
    expect(x.status).toBe('complete');
  });
  it('does not mistake a later review edit for a base retarget in a root PR',async()=>{
    const f=fixture({prs:{
      4:ready(4,{updated_at:'2026-10-15T03:00:00Z'}),
      5:ready(5,{head:'feature-b',head_sha:B,base:'feature-a'})
    },extra:{github_issue_list_timeline:{items:[],count:0},
      github_pr_merge:(a,prs)=>{
        prs[a.number]={...prs[a.number],state:'closed',merged:true};
        return {status:'applied'};
      }}});
    const result=body(await mergeWorkflows.github_workflow_merge_stack({
      repo:'app',prs:[4,5],confirm:true},f.ctx));
    expect(result.status).toBe('merged_one');
    expect(writes(f).map(x=>x.name)).toEqual(['github_pr_merge']);
  });
  it('refuses unreadable base-change history despite green checks',async()=>{
    const f=fixture({prs:{4:ready(),5:ready(5,{head:'feature-b',head_sha:B,base:'feature-a'})},
      extra:{github_issue_list_timeline:null}});
    const x=body(await mergeWorkflows.github_workflow_merge_stack({
      repo:'app',prs:[4,5],confirm:true},f.ctx));
    expect(x.status).toBe('pending_fresh_ci');
    expect(writes(f)).toHaveLength(0);
  });
  it('rejects out-of-order chain, changed expected SHAs and missing timed check evidence',async()=>{
    const f=fixture({prs:{4:ready(4),5:ready(5,{head:'feature-b',head_sha:B,base:'other'})}});
    let x=body(await mergeWorkflows.github_workflow_merge_stack({
      repo:'app',prs:[4,5],confirm:true},f.ctx));
    expect(x.status).toBe('refused');
    x=body(await mergeWorkflows.github_workflow_merge_stack({
      repo:'app',prs:[4,5],expectedHeadShas:[B,B],confirm:true},f.ctx));
    expect(x.reason).toMatch(/advanced/i);
    expect(writes(f)).toHaveLength(0);
  });
});

it('merge workflow returns the actual guarded refusal instead of unknown', async () => {
  const f=fixture();
  const call=f.ctx.callTool;
  f.ctx.callTool=async(name,args)=>name==='github_pr_merge'
    ? {isError:true,structuredContent:{status:'refused_by_guard',refusedBy:'provider permission',error:'GitHub rejected the credential.'}}
    : call(name,args);
  const got=body(await mergeWorkflows.github_workflow_merge_when_green({repo:'app',number:4,
    expectedHeadSha:A,confirm:true},f.ctx));
  expect(got).toMatchObject({done:false,status:'not_applied',underlying_status:'refused_by_guard',
    refusedBy:'provider permission',error:'GitHub rejected the credential.'});
});
