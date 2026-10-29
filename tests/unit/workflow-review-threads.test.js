import {describe,it,expect} from 'vitest';
import {reviewThreads,changedCommentLines,tools} from '../../src/tools/workflows-review.js';
import {createDispatch} from '../../src/tools/dispatch.js';
import {mergeNamespaces} from '../../src/core/registry.js';
import * as meta from '../../src/tools/meta.js';
import {makeWorld} from '../../test/helpers/write-contract.js';
const A='a'.repeat(40),B='b'.repeat(40);
const t=(id='T1',extra={})=>({id,path:'a.js',line:4,start_line:null,original_line:4,side:'RIGHT',
  resolved:false,outdated:false,comments:1,
  root_comment:{id:'C'+id,commit_sha:B,body:'Fix validation',author_association:'NONE'},
  latest_comment:{body:'Fix validation',author_association:'NONE'},...extra});
const d=(threadId='T1',extra={})=>({threadId,disposition:'fixed',explanation:'Reject the invalid value.',...extra});
const args={owner:'example-org',repo:'app',number:7,expectedHeadSha:A};
const content=r=>r.structuredContent;
function fixture(threads=[t()]){
  let tick=0,head=A,fail=null,hook=null,unreadable=false;
  const calls=[],journals=new Map();
  const ctx={now:()=>tick,connection:{client_id:'builder',default_account:'example-org',profile:'full'},
    callTool:async(name,a)=>{
      calls.push({name,args:a});
      if(hook)await hook(name,a);
      const out=v=>({structuredContent:v});
      if(name==='github_pr_get')return out({head_sha:head,state:'open'});
      if(name==='github_review_list_threads')return out({total:threads.length,items:structuredClone(threads),...(unreadable?{more_exist:true}:{})});
      if(name==='github_content_get')return out({type:'file',content:'const valid = true;',start_line:a.startLine,end_line:a.endLine});
      if(name==='github_commit_compare')return out({status:'ahead',behind_by:0,merge_base:B,
        files:[{filename:'a.js',patch:'@@ -3,3 +3,3 @@\n context\n-old\n+new\n context'}]});
      if(a.dryRun)return out({status:'preview',preview:name+' '+a.threadId,needsConfirmation:true});
      if(fail===name)return out({status:'uncertain',confirmed:false});
      if(journals.has(a.requestKey))return out({status:'replayed',confirmed:journals.get(a.requestKey)});
      const thread=threads.find(t=>t.id===a.threadId);
      journals.set(a.requestKey,true);
      if(name==='github_review_reply'){thread.latest_comment={body:a.body,author_association:'MEMBER'};thread.comments++;}
      if(name==='github_review_resolve_thread')thread.resolved=true;
      return out({status:'applied',confirmed:true});
    }};
  return {ctx,calls,threads,journals,setHead:v=>head=v,setFail:v=>fail=v,setHook:v=>hook=v,
    setTime:v=>tick=v,setIncomplete:v=>unreadable=v};
}
const writes=f=>f.calls.filter(c=>['github_review_reply','github_review_resolve_thread'].includes(c.name)&&!c.args.dryRun);
async function preview(f,ds=[d()]){return content(await reviewThreads({...args,dispositions:ds,dryRun:true},f.ctx));}
async function confirm(f,p,ds=[d()]){return content(await reviewThreads({...args,dispositions:ds,confirm:true,planKey:p.planKey},f.ctx));}
describe('W-3 complete review disposition workflow',()=>{
  it('reads current file context and marks outsider comment/code as untrusted',async()=>{
    const f=fixture();f.ctx.connection.profile='read_only';
    const r=content(await reviewThreads({repo:'app',number:7},f.ctx));
    expect(r).toMatchObject({done:true,status:'observed',head_sha:A,total:1});
    expect(r.items[0]).toMatchObject({root_comment:{untrusted:true},latest_comment:{untrusted:true},context:{state:'read',head_sha:A,untrusted:true}});
    expect(f.calls.find(c=>c.name==='github_content_get').args.ref).toBe(A);
    expect(writes(f)).toEqual([]);
  });
  it('handles no threads, deleted context and unreadable content explicitly',async()=>{
    const f=fixture([]);expect(content(await reviewThreads(args,f.ctx))).toMatchObject({done:true,total:0});
    f.threads.push(t('T1',{line:null,outdated:true}));
    expect(content(await reviewThreads(args,f.ctx)).items[0].context.state).toBe('outdated_or_deleted');
    f.threads[0].line=4;
    const original=f.ctx.callTool;
    f.ctx.callTool=(n,a)=>n==='github_content_get'?Promise.resolve({isError:true}):original(n,a);
    expect(content(await reviewThreads(args,f.ctx)).items[0].context.state).toBe('unreadable');
  });
  it('preflights every step once, previews all and applies only after matching confirmation',async()=>{
    const f=fixture([t(),t('T2')]),ds=[d(),d('T2')];
    const p=await preview(f,ds);expect(p.status).toBe('preview');expect(p.rows).toHaveLength(2);
    expect(writes(f)).toHaveLength(0);
    expect((await confirm(f,{planKey:'0'.repeat(64)},ds)).status).toBe('preview');
    expect(writes(f)).toHaveLength(0);
    expect(await confirm(f,p,ds)).toMatchObject({done:true,status:'complete',completed:[{thread_id:'T1',state:'resolved'},{thread_id:'T2',state:'resolved'}]});
    expect(writes(f).map(c=>c.name)).toEqual(['github_review_reply','github_review_resolve_thread','github_review_reply','github_review_resolve_thread']);
    expect(writes(f).every(c=>c.args.expectedHeadSha===A&&c.args.confirm===true)).toBe(true);
  });
  it('does not duplicate already resolved rows',async()=>{
    const f=fixture([t('T1',{resolved:true})]),p=await preview(f);
    expect(await confirm(f,p)).toMatchObject({done:true,completed:[{state:'already_resolved'}]});
    expect(writes(f)).toHaveLength(0);
  });
  it('stale head, new discussion, missing/foreign thread and duplicate selection cannot write',async()=>{
    const f=fixture(),p=await preview(f);f.setHead(B);
    expect((await confirm(f,p)).status).toBe('refused');f.setHead(A);
    f.threads[0].latest_comment.body='A new unresolved concern';f.threads[0].comments++;
    expect((await confirm(f,p)).status).toBe('preview');
    expect((await preview(f,[d('foreign')])).status).toBe('refused');
    expect((await preview(f,[d(),d()])).status).toBe('refused');
    expect(writes(f)).toHaveLength(0);
  });
  it('rejects incomplete thread/comparison evidence and preflights whole selection before applying',async()=>{
    const f=fixture();f.setIncomplete(true);expect((await preview(f)).status).toBe('refused');f.setIncomplete(false);
    const original=f.ctx.callTool;
    f.ctx.callTool=async(n,a)=>n==='github_commit_compare'?{structuredContent:{status:'ahead',behind_by:0,merge_base:B,files:[],files_not_shown:1}}:original(n,a);
    expect((await preview(f)).reason).toMatch(/comparison/);
    f.ctx.callTool=original;f.threads.push(t('T2',{root_comment:null}));
    expect((await preview(f,[d(),d('T2')])).status).toBe('refused');expect(writes(f)).toHaveLength(0);
  });
  it('requires genuine original changed lines for fixed; supports explicit answered and superseded dispositions',async()=>{
    const f=fixture(),original=f.ctx.callTool;
    f.ctx.callTool=(n,a)=>n==='github_commit_compare'?Promise.resolve({structuredContent:{status:'ahead',behind_by:0,merge_base:B,files:[{filename:'a.js',patch:'@@ -1,5 +1,5 @@\n-old\n+new\n context\n unchanged\n unchanged\n unchanged'}]}}):original(n,a);
    expect((await preview(f)).reason).toMatch(/actual commented lines/);
    expect((await preview(f,[d('T1',{disposition:'answered'})])).status).toBe('preview');
    expect((await preview(f,[d('T1',{disposition:'superseded'})])).status).toBe('refused');
    f.threads[0].outdated=true;expect((await preview(f,[d('T1',{disposition:'superseded'})])).status).toBe('preview');
    f.threads[0].side='LEFT';f.ctx.callTool=original;expect((await preview(f)).reason).toMatch(/RIGHT/);
  });
  it('stops after uncertain reply and never resolves or advances another thread',async()=>{
    const f=fixture([t(),t('T2')]),ds=[d(),d('T2')],p=await preview(f,ds);f.setFail('github_review_reply');
    expect(await confirm(f,p,ds)).toMatchObject({done:false,status:'unconfirmed',phase:'reply',completed:[]});
    expect(writes(f)).toHaveLength(1);
  });
  it('recovers a confirmed reply across a timeout without another provider reply',async()=>{
    const f=fixture(),p=await preview(f);
    f.setHook((n,a)=>{if(n==='github_review_reply'&&!a.dryRun)f.setTime(46000);});
    expect(await confirm(f,p)).toMatchObject({status:'pending',phase:'resolve'});
    expect(f.threads[0].resolved).toBe(false);
    const savedKeys=[...f.journals.keys()];f.setHook(null);f.setTime(50000);
    const p2=await preview(f);expect(p2.planKey).not.toBe(p.planKey);
    expect(await confirm(f,p2)).toMatchObject({done:true});
    expect([...f.journals.keys()].filter(k=>k.endsWith(':reply'))).toEqual(savedKeys);
  });
  it('will not bury a new response after its own reply or resolve after head advances',async()=>{
    for(const change of ['discussion','head']){
      const f=fixture(),p=await preview(f);
      f.setHook((n,a)=>{if(n==='github_review_reply'&&!a.dryRun){
        if(change==='discussion')queueMicrotask(()=>{f.threads[0].latest_comment.body='New concern';f.threads[0].comments++;});
        else f.setHead(B);
      }});
      const r=await confirm(f,p);expect(['discussion_changed','stale']).toContain(r.status);
      expect(writes(f).some(c=>c.name==='github_review_resolve_thread')).toBe(false);
    }
  });
  it('budget expiry and delegated preflight refusal send no writes',async()=>{
    const f=fixture();f.setHook(n=>{if(n==='github_commit_compare')f.setTime(47000);});
    expect((await preview(f)).status).toBe('pending');expect(writes(f)).toHaveLength(0);
    f.setTime(0);f.setHook(null);const original=f.ctx.callTool;
    f.ctx.callTool=(n,a)=>n==='github_review_resolve_thread'?Promise.resolve({isError:true}):original(n,a);
    expect((await preview(f)).status).toBe('refused');expect(writes(f)).toHaveLength(0);
  });
  it('reads multiple pages and refuses repeated or missing cursors',async()=>{
    for(const stuck of [false,true]){
      const f=fixture([t(),t('T2')]),original=f.ctx.callTool;
      f.ctx.callTool=async(n,a)=>n==='github_review_list_threads'
        ? {structuredContent:{total:2,items:[structuredClone(f.threads[a.after?1:0])],
          ...(!a.after||stuck?{more_exist:true,next_cursor:'next'}:{})}}
        : original(n,a);
      const r=content(await reviewThreads(args,f.ctx));
      expect(r.status).toBe(stuck?'refused':'observed');
      if(!stuck)expect(r.total).toBe(2);
      expect(writes(f)).toHaveLength(0);
    }
  });
  it('refuses read-only mutation but allows read-only inspection',async()=>{
    const f=fixture();f.ctx.connection.profile='read_only';expect((await preview(f)).status).toBe('refused');
  });
});
describe('diff evidence is actual changed lines',()=>{
  it('accepts deletion/replacement and rejects clipped/binary/context-only patches',()=>{
    expect(changedCommentLines('@@ -3,3 +3,3 @@\n x\n-old\n+new\n y',4,4)).toBe(true);
    expect(changedCommentLines('@@ -3,3 +3,3 @@\n x\n-old\n+new\n y',5,5)).toBe(false);
    expect(changedCommentLines(null,4,4)).toBe(false);
    expect(changedCommentLines('@@ -3,3 +3,3 @@\n-old\n+new\n… [patch cut at 1500 characters]',3,3)).toBe(false);
  });
});
describe('W-3 compact door and aggregate bounds',()=>{
  it('is callable through github_call, while recursive meta calls remain refused',async()=>{
    const w=await makeWorld({}),f=fixture([]);
    const ns={tools,handlers:{github_workflow_review_threads:async(a,c)=>reviewThreads(a,{...c,callTool:f.ctx.callTool})}};
    const r=mergeNamespaces([meta,ns]);
    const dispatch=createDispatch({now:w.ctx.now});
    const response=await dispatch({registry:r,name:'github_call',args:{name:tools[0].name,args},connection:w.connection,db:w.db});
    expect(response.structuredContent).toMatchObject({done:true,total:0});
    expect((await dispatch({registry:r,name:'github_call',args:{name:'github_call',args:{}},connection:w.connection,db:w.db})).isError).toBe(true);
  });
  it('retains large workflow aggregates behind a connection-bound handle and shapes secrets',async()=>{
    const w=await makeWorld({});
    const r=mergeNamespaces([{tools,handlers:{github_workflow_review_threads:async()=>({structuredContent:{items:Array.from({length:30},(_,i)=>({id:i,text:'z'.repeat(3000),token:'fake-sensitive'}))}})}}]);
    const response=await createDispatch()({registry:r,name:tools[0].name,args:{repo:'app',number:7},connection:w.connection,db:w.db});
    expect(response.structuredContent.kept_result.handle).toMatch(/^res_/);
    expect(JSON.stringify(response)).not.toContain('fake-sensitive');
    expect(Buffer.byteLength(JSON.stringify(response.structuredContent))).toBeLessThan(8192);
  });
});

describe('W-3 shared whole-request deadline',()=>{
  it('never starts a reply when its last fresh read exhausted the shared budget',async()=>{
    const f=fixture(),p=await preview(f);let reads=0;
    f.setHook(n=>{if(n==='github_review_list_threads'&&++reads===2)f.setTime(47000);});
    expect((await confirm(f,p)).status).toBe('pending');
    expect(writes(f)).toHaveLength(0);
  });
});
it('uses canonical compact-envelope review evidence and requests only the commented file',async()=>{
 const f=fixture(),original=f.ctx.callTool;
 f.ctx.callTool=async(n,a)=>{
  if(n!=='github_commit_compare')return original(n,a);
  expect(a.path).toBe('a.js');expect(a.fields).toContain('files');
  const body={status:'ahead',behind_by:0,merge_base:B,files:[{filename:'a.js',patch:'@@ -3,3 +3,3 @@\n context\n-old\n+new\n context'}]};
  return {structuredContent:{status:'ahead',behind_by:0,merge_base:B,full_payload_location:'content[0].text',full_payload_format:'json',omitted_fields:['files']},content:[{type:'text',text:JSON.stringify(body)}]};
 };
 expect((await preview(f)).status).toBe('preview');expect(writes(f)).toEqual([]);
});
