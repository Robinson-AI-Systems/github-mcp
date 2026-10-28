import {describe,expect,it} from 'vitest';
import {runWriteContract,makeWorld,parse} from '../../test/helpers/write-contract.js';
import * as mod from '../../src/tools/dev-cleanup-write.js';
const RUN='run-clean-204',REPO='fixture',OWNER='example-org';
const repo={full_name:`${OWNER}/${REPO}`,private:true,description:`Developer fixture for rtc_run=${RUN}`,default_branch:'main'};
const def={tool:mod.tools[0],handler:mod.handlers.github_dev_cleanup};
async function prepare(world,scenario='repo-basic'){
  await world.db.createDevRun({id:RUN,account:OWNER,connection:'client-1',scenarios:[scenario]});
  await world.db.recordDevObject({runId:RUN,account:OWNER,connection:'client-1',
    type:'repo',owner:OWNER,repo:REPO,objectId:`${OWNER}/${REPO}`,createdSha:'a'.repeat(40)});
}
function arrange(gh,outcome){
  gh.when('GET /repos/{owner}/{repo}').replySequence([
    {status:200,body:repo},{status:200,body:repo},{status:200,body:repo},{status:200,body:repo},
    outcome==='mismatch'?{status:200,body:repo}:{status:404,body:{message:'Not Found'}},
    outcome==='mismatch'?{status:200,body:repo}:{status:404,body:{message:'Not Found'}}
  ]);
  gh.when('GET /repos/{owner}/{repo}/branches').reply(200,[{name:'main',commit:{sha:'a'.repeat(40)}}]);
  gh.when('GET /repos/{owner}/{repo}/pulls').reply(200,[]);
  gh.when('GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews').reply(200,[]);
  gh.when('GET /repos/{owner}/{repo}/issues').reply(200,[]);
  gh.when('GET /repos/{owner}/{repo}/tags').reply(200,[]);
  gh.when('GET /repos/{owner}/{repo}/releases').reply(200,[]);
  gh.when('GET /repos/{owner}/{repo}/hooks').reply(200,[]);
  gh.when('GET /repos/{owner}/{repo}/rulesets').reply(200,[]);
  gh.when('GET /repos/{owner}/{repo}/milestones').reply(200,[]);
  gh.when('GET /repos/{owner}/{repo}/deployments').reply(200,[]);
  gh.when('GET /repos/{owner}/{repo}/environments').reply(200,{total_count:0,environments:[]});
  gh.when('GET /repos/{owner}/{repo}/labels').reply(200,[]);
  gh.when('GET /repos/{owner}/{repo}/actions/runs').reply(200,{total_count:0,workflow_runs:[]});
  gh.when('GET /repos/{owner}/{repo}/actions/artifacts').reply(200,{total_count:0,artifacts:[]});
  gh.when('GET /repos/{owner}/{repo}/actions/workflows').reply(200,{total_count:0,workflows:[]});
  gh.when('GET /repos/{owner}/{repo}/issues/comments').reply(200,[]);
  gh.when('GET /repos/{owner}/{repo}/pulls/comments').reply(200,[]);
  gh.when('DELETE /repos/{owner}/{repo}').reply(204);
}
runWriteContract({label:'github_dev_cleanup exact scratch',definition:def,
  args:{runId:RUN,repo:REPO},scratchAccount:true,previewOnly:true,
  needsConfirm:true,expectedWrites:1,prepare,arrange});
describe('V-2 protected run deletion',()=>{
  it('refuses unverified owner and non-scratch account before any remote read',async()=>{
    const w=await makeWorld();await prepare(w);arrange(w.gh,'ok');
    const result=parse(await def.handler({runId:RUN,repo:REPO,confirm:true},w.ctx));
    expect(result.done).toBe(false);
    expect(w.gh.calls).toHaveLength(0);
  });
  it('rejects a mismatched private repository identity without sending DELETE',async()=>{
    const w=await makeWorld({scratchAccount:true});await prepare(w);
    w.gh.when('GET /repos/{owner}/{repo}').reply(200,{...repo,description:'foreign'});
    const result=parse(await def.handler({runId:RUN,repo:REPO,confirm:true},w.ctx));
    expect(result.done).toBe(false);
    expect(w.gh.calls.filter(c=>c.method==='DELETE')).toHaveLength(0);
  });
  it('refuses a prefix-collision scratch marker before deleting any repository',async()=>{
    const w=await makeWorld({scratchAccount:true});await prepare(w);
    w.gh.when('GET /repos/{owner}/{repo}').reply(200,{
      ...repo,description:'Developer fixture rtc_run='+RUN+'-other (repo-basic)'
    });
    const result=parse(await def.handler({runId:RUN,repo:REPO,confirm:true},w.ctx));
    expect(result.done).toBe(false);
    expect(w.gh.calls.filter(c=>c.method==='DELETE')).toHaveLength(0);
  });
  it('refuses to delete a scratch repository containing an unjournaled branch',async()=>{
    const w=await makeWorld({scratchAccount:true});await prepare(w);arrange(w.gh,'ok');
    w.gh.when('GET /repos/{owner}/{repo}/branches').reply(200,[
      {name:'main',commit:{sha:'a'.repeat(40)}},
      {name:'outsider-work',commit:{sha:'b'.repeat(40)}}
    ]);
    const out=parse(await def.handler({runId:RUN,repo:REPO,confirm:true},w.ctx));
    expect(out.done).toBe(false);
    expect(w.gh.calls.some(c=>c.route==='DELETE /repos/{owner}/{repo}')).toBe(false);
    expect(w.gh.invalid).toEqual([]);
  });
  it('refuses a foreign PR or issue even when the repository marker matches',async()=>{
    for(const [route,body] of [
      ['GET /repos/{owner}/{repo}/pulls',[{number:55,body:'unrelated',merged:false}]],
      ['GET /repos/{owner}/{repo}/issues',[{number:56,body:'unrelated'}]]
    ]){
      const w=await makeWorld({scratchAccount:true});await prepare(w);arrange(w.gh,'ok');
      w.gh.when(route).reply(200,body);
      const out=parse(await def.handler({runId:RUN,repo:REPO,confirm:true},w.ctx));
      expect(out.done).toBe(false);
      expect(w.gh.calls.some(c=>c.route==='DELETE /repos/{owner}/{repo}')).toBe(false);
      expect(w.gh.invalid).toEqual([]);
    }
  });
  it('refuses foreign milestones and deployments before any destructive repo operation',async()=>{
    for(const [route,items] of [
      ['GET /repos/{owner}/{repo}/milestones',[{number:12,title:'customer launch',state:'closed'}]],
      ['GET /repos/{owner}/{repo}/deployments',[{id:44,sha:'a'.repeat(40),environment:'production'}]]
    ]){
      const w=await makeWorld({scratchAccount:true});await prepare(w);arrange(w.gh,'ok');
      w.gh.when(route).reply(200,items);
      const out=parse(await def.handler({runId:RUN,repo:REPO,confirm:true},w.ctx));
      expect(out.done).toBe(false);
      expect(w.gh.calls.some(x=>x.method==='DELETE'||x.method==='PATCH')).toBe(false);
      expect(w.gh.invalid).toEqual([]);
    }
  });
  it('refuses foreign, inconsistent or inaccessible deployment environment state',async()=>{
    const route='GET /repos/{owner}/{repo}/environments';
    for(const variant of [
      {status:200,body:{total_count:1,environments:[{name:'production'}]}},
      {status:200,body:{total_count:0,environments:[{name:'hidden'}]}},
      {status:200,body:{total_count:1,environments:[]}},
      {status:200,body:{total_count:0}},
      {status:403,body:{message:'Insufficient Actions read permission'}}
    ]){
      const w=await makeWorld({scratchAccount:true});await prepare(w);arrange(w.gh,'ok');
      w.gh.when(route).reply(variant.status,variant.body);
      const out=parse(await def.handler({runId:RUN,repo:REPO,confirm:true},w.ctx));
      expect(out.done,JSON.stringify(variant)).toBe(false);
      expect(w.gh.calls.some(x=>x.method==='DELETE'||x.method==='PATCH')).toBe(false);
    }
  });
  it('refuses incomplete or permission-denied milestone and deployment inventories',async()=>{
    for(const route of ['GET /repos/{owner}/{repo}/milestones',
      'GET /repos/{owner}/{repo}/deployments']){
      for(const mode of ['capped','denied']){
        const w=await makeWorld({scratchAccount:true});await prepare(w);arrange(w.gh,'ok');
        if(mode==='capped')
          w.gh.when(route).reply(200,Array.from({length:100},(_,i)=>({id:i+1})),
            {link:'<https://api.github.com/repos/example-org/fixture?page=2>; rel="next"'});
        else w.gh.when(route).reply(403,{message:'Insufficient GitHub App permission'});
        const out=parse(await def.handler({runId:RUN,repo:REPO,confirm:true},w.ctx));
        expect(out.done).toBe(false);
        expect(w.gh.calls.some(x=>x.method==='DELETE'||x.method==='PATCH')).toBe(false);
      }
    }
  });
  it('refuses an incomplete remote listing instead of assuming there are no foreign artifacts',async()=>{
    const w=await makeWorld({scratchAccount:true});await prepare(w);arrange(w.gh,'ok');
    w.gh.when('GET /repos/{owner}/{repo}/branches').reply(200,[
      {name:'main',commit:{sha:'a'.repeat(40)}}
    ],{'link':'<https://api.github.com/repos/example-org/fixture/branches?page=2>; rel="next"'});
    const out=parse(await def.handler({runId:RUN,repo:REPO,confirm:true},w.ctx));
    expect(out.done).toBe(false);
    expect(w.gh.calls.some(c=>c.route==='DELETE /repos/{owner}/{repo}')).toBe(false);
  });
  it('refuses a recorded scratch branch whose HEAD changed outside recorded fixture commits',async()=>{
    const w=await makeWorld({scratchAccount:true});await prepare(w);arrange(w.gh,'ok');
    const name=`rtc/${RUN}/feature`;
    await w.db.recordDevObject({runId:RUN,account:OWNER,connection:'client-1',type:'branch',
      owner:OWNER,repo:REPO,objectId:name,createdSha:'a'.repeat(40)});
    w.gh.when('GET /repos/{owner}/{repo}/branches').reply(200,[
      {name:'main',commit:{sha:'a'.repeat(40)}},{name,commit:{sha:'b'.repeat(40)}}
    ]);
    const out=parse(await def.handler({runId:RUN,repo:REPO,confirm:true},w.ctx));
    expect(out.done).toBe(false);
    expect(w.gh.calls.some(c=>c.route==='DELETE /repos/{owner}/{repo}')).toBe(false);
  });
  it('refuses another owned branch commit substituted as the current tip',async()=>{
    const w=await makeWorld({scratchAccount:true});await prepare(w);arrange(w.gh,'ok');
    const one=`rtc/${RUN}/first`,two=`rtc/${RUN}/second`;
    await w.db.recordDevObject({runId:RUN,account:OWNER,connection:'client-1',
      type:'branch',owner:OWNER,repo:REPO,objectId:one,createdSha:'a'.repeat(40)});
    await w.db.recordDevObject({runId:RUN,account:OWNER,connection:'client-1',
      type:'branch',owner:OWNER,repo:REPO,objectId:two,createdSha:'b'.repeat(40)});
    w.gh.when('GET /repos/{owner}/{repo}/branches').reply(200,[
      {name:'main',commit:{sha:'a'.repeat(40)}},
      {name:one,commit:{sha:'b'.repeat(40)}},
      {name:two,commit:{sha:'b'.repeat(40)}}
    ]);
    const out=parse(await def.handler({runId:RUN,repo:REPO,confirm:true},w.ctx));
    expect(out.done).toBe(false);
    expect(w.gh.calls.some(c=>c.route==='DELETE /repos/{owner}/{repo}')).toBe(false);
    expect(w.gh.invalid).toEqual([]);
  });
  it('refuses another fixture-file commit when the branch has its own recorded fixture',async()=>{
    const w=await makeWorld({scratchAccount:true});await prepare(w);arrange(w.gh,'ok');
    const branch=`rtc/${RUN}/first`,path=`rtc/${RUN}/first.md`;
    await w.db.recordDevObject({runId:RUN,account:OWNER,connection:'client-1',
      type:'branch',owner:OWNER,repo:REPO,objectId:branch,createdSha:'a'.repeat(40)});
    await w.db.recordDevObject({runId:RUN,account:OWNER,connection:'client-1',
      type:'fixture_file',owner:OWNER,repo:REPO,objectId:path,createdSha:'b'.repeat(40)});
    await w.db.recordDevObject({runId:RUN,account:OWNER,connection:'client-1',
      type:'fixture_file',owner:OWNER,repo:REPO,objectId:`rtc/${RUN}/other.md`,createdSha:'c'.repeat(40)});
    w.gh.when('GET /repos/{owner}/{repo}/branches').reply(200,[
      {name:'main',commit:{sha:'a'.repeat(40)}},{name:branch,commit:{sha:'c'.repeat(40)}}
    ]);
    const out=parse(await def.handler({runId:RUN,repo:REPO,confirm:true},w.ctx));
    expect(out.done).toBe(false);
    expect(w.gh.calls.some(c=>c.route==='DELETE /repos/{owner}/{repo}')).toBe(false);
  });
  it('refuses foreign tags, retargeted tags and published or unrecorded releases',async()=>{
    for(const scenario of ['foreign-tag','retargeted-tag','foreign-release','published-release','release-assets']){
      const w=await makeWorld({scratchAccount:true});await prepare(w);arrange(w.gh,'ok');
      const recordedTag={runId:RUN,account:OWNER,connection:'client-1',
        type:'tag',owner:OWNER,repo:REPO,objectId:'v0.1.0',createdSha:'a'.repeat(40)};
      const tag={name:'v0.1.0',commit:{sha:'a'.repeat(40)}};
      if(scenario!=='foreign-tag')await w.db.recordDevObject(recordedTag);
      const release={id:123,tag_name:'v0.1.0',draft:true,published_at:null,
        body:`Draft fixture rtc_run=${RUN}`,assets:[]};
      if(['published-release','release-assets'].includes(scenario))
        await w.db.recordDevObject({runId:RUN,account:OWNER,connection:'client-1',
          type:'release',owner:OWNER,repo:REPO,objectId:'123'});
      w.gh.when('GET /repos/{owner}/{repo}/tags').reply(200,[
        scenario==='retargeted-tag'?{...tag,commit:{sha:'b'.repeat(40)}}:tag
      ]);
      if(scenario.includes('release')){
        w.gh.when('GET /repos/{owner}/{repo}/releases').reply(200,[
          {...release,...(scenario==='published-release'?{draft:false,published_at:'2026-10-12T00:00:00Z'}:
            scenario==='release-assets'?{assets:[{id:456}]}:{})}
        ]);
      }
      const out=parse(await def.handler({runId:RUN,repo:REPO,confirm:true},w.ctx));
      expect(out.done).toBe(false);
      expect(w.gh.calls.some(c=>c.route==='DELETE /repos/{owner}/{repo}')).toBe(false);
      expect(w.gh.invalid).toEqual([]);
    }
  });
  it('deletes a release-train scratch repo only when its exact draft and tags are still owned',async()=>{
    const w=await makeWorld({scratchAccount:true});await prepare(w,'release-train');arrange(w.gh,'ok');
    for(const name of ['v0.1.0','v0.2.0','v0.3.0'])
      await w.db.recordDevObject({runId:RUN,account:OWNER,connection:'client-1',
        type:'tag',owner:OWNER,repo:REPO,objectId:name,createdSha:'a'.repeat(40)});
    await w.db.recordDevObject({runId:RUN,account:OWNER,connection:'client-1',
      type:'release',owner:OWNER,repo:REPO,objectId:'123'});
    w.gh.when('GET /repos/{owner}/{repo}/tags').reply(200,
      ['v0.1.0','v0.2.0','v0.3.0'].map(name=>({name,commit:{sha:'a'.repeat(40)}})));
    w.gh.when('GET /repos/{owner}/{repo}/releases').reply(200,[
      {id:123,tag_name:'v0.3.0',draft:true,published_at:null,
        body:`Draft release rtc_run=${RUN}`,assets:[]}
    ]);
    const out=parse(await def.handler({runId:RUN,repo:REPO,confirm:true},w.ctx));
    expect(out.done).toBe(true);
    expect(w.gh.calls.some(c=>c.route==='DELETE /repos/{owner}/{repo}')).toBe(true);
    expect(w.gh.invalid).toEqual([]);
  });
  it('refuses a truncated release listing rather than deleting unseen artifacts',async()=>{
    const w=await makeWorld({scratchAccount:true});await prepare(w);arrange(w.gh,'ok');
    // A full page plus a next link is a finite, genuinely capped fixture.
    w.gh.when('GET /repos/{owner}/{repo}/releases').reply(200,
      Array.from({length:100},(_,i)=>({id:i+1,tag_name:'other',draft:true,assets:[]})),
      {link:'<https://api.github.com/repos/example-org/fixture/releases?page=2>; rel="next"'});
    const out=parse(await def.handler({runId:RUN,repo:REPO,confirm:true},w.ctx));
    expect(out.done).toBe(false);
    expect(w.gh.calls.some(c=>c.route==='DELETE /repos/{owner}/{repo}')).toBe(false);
  });
  it('refuses unrecorded webhook or foreign repository ruleset before deleting scratch',async()=>{
    for(const [route,items] of [
      ['GET /repos/{owner}/{repo}/hooks',[{id:72,name:'web',active:true}]],
      ['GET /repos/{owner}/{repo}/rulesets',[{id:73,name:'foreign',source_type:'Repository'}]]
    ]){
      const w=await makeWorld({scratchAccount:true});await prepare(w);arrange(w.gh,'ok');
      w.gh.when(route).reply(200,items);
      const out=parse(await def.handler({runId:RUN,repo:REPO,confirm:true},w.ctx));
      expect(out.done).toBe(false);
      expect(w.gh.calls.some(c=>c.route==='DELETE /repos/{owner}/{repo}')).toBe(false);
      expect(w.gh.invalid).toEqual([]);
    }
  });
  it('lets a recorded V-4 test webhook go with its scratch repository and refuses a changed or repeated one', async () => {
    for (const live of [[{ id: 72, name: 'web', type: 'Repository' }], [{ id: 72, name: 'web', type: 'Organization' }], [{ id: 72, name: 'web', type: 'Repository' }, { id: 72, name: 'web', type: 'Repository' }]]) {
      const w = await makeWorld({ scratchAccount: true }); await prepare(w); arrange(w.gh, 'ok');
      await w.db.recordDevObject({ runId: RUN, account: OWNER, connection: 'client-1', type: 'webhook', owner: OWNER, repo: REPO, objectId: '72' });
      w.gh.when('GET /repos/{owner}/{repo}/hooks').reply(200, live);
      const out = parse(await def.handler({ runId: RUN, repo: REPO, confirm: true }, w.ctx));
      const good = live.length === 1 && live[0].type === 'Repository';
      expect(out.done).toBe(good);
      expect(w.gh.calls.some((c) => c.route === 'DELETE /repos/{owner}/{repo}')).toBe(good);
      expect(w.gh.invalid).toEqual([]);
    }
  });
  it('removes the recorded forwarder and every forwarder bound to the run, and never another run or connection', async () => {
    const w = await makeWorld({ scratchAccount: true });
    await prepare(w, 'webhook-target'); arrange(w.gh, 'ok');
    const f = (n, extra = {}) => ({ account: OWNER, connection: 'client-1', id: `fwd_${String(n).padStart(16, 'd')}`, url: 'https://app.example.net/hook', events: [], secretEnc: 'v1.' + 'z'.repeat(40), ...extra });
    await w.db.createDevForwarder(f(1, { runId: RUN, repo: REPO }));
    await w.db.createDevForwarder(f(2, { runId: RUN }));
    await w.db.createDevForwarder(f(3, { runId: 'run-other-999' }));
    await w.db.createDevForwarder(f(4));
    await w.db.createDevForwarder(f(5, { runId: RUN, connection: 'client-two' }));
    await w.db.recordDevObject({ runId: RUN, account: OWNER, connection: 'client-1', type: 'forwarder', owner: OWNER, repo: REPO, objectId: f(1).id });
    await w.db.recordDevObject({ runId: RUN, account: OWNER, connection: 'client-1', type: 'webhook', owner: OWNER, repo: REPO, objectId: '72' });
    w.gh.when('GET /repos/{owner}/{repo}/hooks').reply(200, [{ id: 72, name: 'web', type: 'Repository' }]);
    const out = parse(await def.handler({ runId: RUN, repo: REPO, confirm: true }, w.ctx));
    expect(out).toMatchObject({ status: 'applied', done: true, result: { cleanup: { verified: true, forwarders_removed: 2 } } });
    expect((await w.db.listDevForwarders({ account: OWNER, connection: 'client-1' })).map((x) => x.id)).toEqual([f(3).id, f(4).id]);
    expect(await w.db.getDevForwarder({ account: OWNER, connection: 'client-two', id: f(5).id })).not.toBeNull();
    expect(w.gh.invalid).toEqual([]);
  });
  it('requires unchanged recorded required-ci scratch ruleset and refuses drift',async()=>{
    for(const altered of [false,true]){
      const w=await makeWorld({scratchAccount:true});await prepare(w,'protected-main');arrange(w.gh,'ok');
      await w.db.recordDevObject({runId:RUN,account:OWNER,connection:'client-1',
        type:'ruleset',owner:OWNER,repo:REPO,objectId:'321'});
      w.gh.when('GET /repos/{owner}/{repo}/rulesets').reply(200,[
        {id:321,name:`rtc-run-${RUN}`,source_type:'Repository'}
      ]);
      w.gh.when('GET /repos/{owner}/{repo}/rulesets/{ruleset_id}').reply(200,{
        id:321,name:`rtc-run-${RUN}`,source_type:'Repository',
        target:'branch',enforcement:'active',bypass_actors:[],
        conditions:{ref_name:{include:['~DEFAULT_BRANCH'],exclude:[]}},
        rules:[{type:'required_status_checks',parameters:{
          strict_required_status_checks_policy:true,
          required_status_checks:[{context:altered?'other':'ci'}]
        }}]
      });
      const out=parse(await def.handler({runId:RUN,repo:REPO,confirm:true},w.ctx));
      expect(out.done).toBe(!altered);
      expect(w.gh.calls.some(c=>c.route==='DELETE /repos/{owner}/{repo}')).toBe(!altered);
      expect(w.gh.invalid).toEqual([]);
    }
  });
  it('rejects a recorded scratch PR retargeted to another repository or unrelated head',async()=>{
    for(const variant of ['foreign-head-repo','foreign-base','wrong-sha','ready-for-review']){
      const w=await makeWorld({scratchAccount:true});await prepare(w);arrange(w.gh,'ok');
      const branch=`rtc/${RUN}/review`;
      await w.db.recordDevObject({runId:RUN,account:OWNER,connection:'client-1',
        type:'branch',owner:OWNER,repo:REPO,objectId:branch,createdSha:'a'.repeat(40)});
      await w.db.recordDevObject({runId:RUN,account:OWNER,connection:'client-1',
        type:'pr',owner:OWNER,repo:REPO,objectId:'101',createdSha:'a'.repeat(40)});
      w.gh.when('GET /repos/{owner}/{repo}/branches').reply(200,[
        {name:'main',commit:{sha:'a'.repeat(40)}},{name:branch,commit:{sha:'a'.repeat(40)}}
      ]);
      w.gh.when('GET /repos/{owner}/{repo}/pulls').reply(200,[{
        number:101,merged:false,draft:variant!=='ready-for-review',state:'open',
        body:`<!-- rtc_run=${RUN} -->`,
        head:{ref:branch,sha:variant==='wrong-sha'?'b'.repeat(40):'a'.repeat(40),
          repo:{full_name:variant==='foreign-head-repo'?'outsider/fixture':`${OWNER}/${REPO}`}},
        base:{ref:variant==='foreign-base'?'foreign-main':'main',repo:{full_name:`${OWNER}/${REPO}`}}
      }]);
      const out=parse(await def.handler({runId:RUN,repo:REPO,confirm:true},w.ctx));
      expect(out.done).toBe(false);
      expect(w.gh.calls.some(c=>c.route==='DELETE /repos/{owner}/{repo}')).toBe(false);
      expect(w.gh.invalid).toEqual([]);
    }
  });
  it('refuses a merged scratch PR even if it keeps the original run marker',async()=>{
    const w=await makeWorld({scratchAccount:true});await prepare(w);arrange(w.gh,'ok');
    const branch=`rtc/${RUN}/review`;
    await w.db.recordDevObject({runId:RUN,account:OWNER,connection:'client-1',
      type:'branch',owner:OWNER,repo:REPO,objectId:branch,createdSha:'a'.repeat(40)});
    await w.db.recordDevObject({runId:RUN,account:OWNER,connection:'client-1',
      type:'pr',owner:OWNER,repo:REPO,objectId:'101',createdSha:'a'.repeat(40)});
    w.gh.when('GET /repos/{owner}/{repo}/branches').reply(200,[
      {name:'main',commit:{sha:'a'.repeat(40)}},{name:branch,commit:{sha:'a'.repeat(40)}}
    ]);
    w.gh.when('GET /repos/{owner}/{repo}/pulls').reply(200,[{
      number:101,draft:true,state:'closed',merged_at:'2026-10-12T00:00:00Z',
      body:`<!-- rtc_run=${RUN} -->`,
      head:{ref:branch,sha:'a'.repeat(40),repo:{full_name:`${OWNER}/${REPO}`}},
      base:{ref:'main',repo:{full_name:`${OWNER}/${REPO}`}}
    }]);
    const out=parse(await def.handler({runId:RUN,repo:REPO,confirm:true},w.ctx));
    expect(out.done).toBe(false);
    expect(w.gh.calls.some(c=>c.route==='DELETE /repos/{owner}/{repo}')).toBe(false);
  });
  it('refuses foreign formal PR reviews even with a matching run PR journal',async()=>{
    const w=await makeWorld({scratchAccount:true});await prepare(w);arrange(w.gh,'ok');
    const branch=`rtc/${RUN}/review`;
    await w.db.recordDevObject({runId:RUN,account:OWNER,connection:'client-1',
      type:'branch',owner:OWNER,repo:REPO,objectId:branch,createdSha:'a'.repeat(40)});
    await w.db.recordDevObject({runId:RUN,account:OWNER,connection:'client-1',
      type:'pr',owner:OWNER,repo:REPO,objectId:'101',createdSha:'a'.repeat(40)});
    w.gh.when('GET /repos/{owner}/{repo}/branches').reply(200,[
      {name:'main',commit:{sha:'a'.repeat(40)}},{name:branch,commit:{sha:'a'.repeat(40)}}
    ]);
    w.gh.when('GET /repos/{owner}/{repo}/pulls').reply(200,[{
      number:101,merged_at:null,draft:true,state:'open',
      body:`<!-- rtc_run=${RUN} -->`,
      head:{ref:branch,sha:'a'.repeat(40),repo:{full_name:`${OWNER}/${REPO}`}},
      base:{ref:'main',repo:{full_name:`${OWNER}/${REPO}`}}
    }]);
    w.gh.when('GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews').reply(200,[
      {id:601,state:'APPROVED',user:{login:'outsider'}}
    ]);
    const out=parse(await def.handler({runId:RUN,repo:REPO,confirm:true},w.ctx));
    expect(out.done).toBe(false);
    expect(w.gh.calls.some(c=>c.method==='DELETE')).toBe(false);
    expect(w.gh.invalid).toEqual([]);
  });
  it('accepts a run-recorded draft PR only while its head and base remain exact',async()=>{
    const w=await makeWorld({scratchAccount:true});await prepare(w,'pr-with-threads');arrange(w.gh,'ok');
    const branch=`rtc/${RUN}/review`;
    await w.db.recordDevObject({runId:RUN,account:OWNER,connection:'client-1',
      type:'branch',owner:OWNER,repo:REPO,objectId:branch,createdSha:'a'.repeat(40)});
    await w.db.recordDevObject({runId:RUN,account:OWNER,connection:'client-1',
      type:'pr',owner:OWNER,repo:REPO,objectId:'101',createdSha:'a'.repeat(40)});
    w.gh.when('GET /repos/{owner}/{repo}/branches').reply(200,[
      {name:'main',commit:{sha:'a'.repeat(40)}},{name:branch,commit:{sha:'a'.repeat(40)}}
    ]);
    w.gh.when('GET /repos/{owner}/{repo}/pulls').reply(200,[{
      number:101,merged_at:null,draft:true,state:'closed',
      body:`<!-- rtc_run=${RUN} -->`,
      head:{ref:branch,sha:'a'.repeat(40),repo:{full_name:`${OWNER}/${REPO}`}},
      base:{ref:'main',repo:{full_name:`${OWNER}/${REPO}`}}
    }]);
    w.gh.when('GET /repos/{owner}/{repo}/issues').reply(200,[{
      number:101,pull_request:{url:'https://api.github.com/fixture'}
    }]);
    w.gh.when('GET /repos/{owner}/{repo}/pulls/{pull_number}').reply(200,{
      number:101,merged:false,merged_at:null,draft:true,state:'closed',
      head:{ref:branch,sha:'a'.repeat(40),repo:{full_name:`${OWNER}/${REPO}`}},
      base:{ref:'main',repo:{full_name:`${OWNER}/${REPO}`}},
      body:`<!-- rtc_run=${RUN} -->`
    });
    const out=parse(await def.handler({runId:RUN,repo:REPO,confirm:true},w.ctx));
    expect(out.done).toBe(true);
    expect(w.gh.calls.some(c=>c.route==='DELETE /repos/{owner}/{repo}')).toBe(true);
    expect(w.gh.invalid).toEqual([]);
  });
  it('refuses a scratch PR changed between the inventory and its individual pre-close read',async()=>{
    const branch=`rtc/${RUN}/review`;
    const basePull={
      number:101,merged:false,merged_at:null,draft:true,state:'closed',
      body:`<!-- rtc_run=${RUN} -->`,
      head:{ref:branch,sha:'a'.repeat(40),repo:{full_name:`${OWNER}/${REPO}`}},
      base:{ref:'main',repo:{full_name:`${OWNER}/${REPO}`}}
    };
    for(const change of [
      {draft:false},{state:'open'},{merged_at:'2026-10-12T10:00:00Z'},
      {head:{...basePull.head,sha:'b'.repeat(40)}},
      {base:{...basePull.base,ref:'other-branch'}},
      {head:{...basePull.head,repo:{full_name:'outsider/fixture'}}},
      {number:102},{body:'new foreign content'}
    ]){
      const w=await makeWorld({scratchAccount:true});await prepare(w);arrange(w.gh,'ok');
      await w.db.recordDevObject({runId:RUN,account:OWNER,connection:'client-1',
        type:'branch',owner:OWNER,repo:REPO,objectId:branch,createdSha:'a'.repeat(40)});
      await w.db.recordDevObject({runId:RUN,account:OWNER,connection:'client-1',
        type:'pr',owner:OWNER,repo:REPO,objectId:'101',createdSha:'a'.repeat(40)});
      w.gh.when('GET /repos/{owner}/{repo}/branches').reply(200,[
        {name:'main',commit:{sha:'a'.repeat(40)}},{name:branch,commit:{sha:'a'.repeat(40)}}
      ]);
      w.gh.when('GET /repos/{owner}/{repo}/pulls').reply(200,[basePull]);
      w.gh.when('GET /repos/{owner}/{repo}/issues').reply(200,[
        {number:101,pull_request:{url:'https://api.github.com/fixture'}}
      ]);
      w.gh.when('GET /repos/{owner}/{repo}/pulls/{pull_number}').reply(200,{...basePull,...change});
      const out=parse(await def.handler({runId:RUN,repo:REPO,confirm:true},w.ctx));
      expect(out.done,JSON.stringify(change)).toBe(false);
      expect(w.gh.calls.some(x=>x.method==='PATCH'||x.method==='DELETE')).toBe(false);
      expect(w.gh.invalid).toEqual([]);
    }
  });
  it('verifies the same draft PR identity after closing an owned open PR',async()=>{
    const branch=`rtc/${RUN}/review`;
    const before={
      number:101,merged:false,merged_at:null,draft:true,state:'open',
      body:`<!-- rtc_run=${RUN} -->`,
      head:{ref:branch,sha:'a'.repeat(40),repo:{full_name:`${OWNER}/${REPO}`}},
      base:{ref:'main',repo:{full_name:`${OWNER}/${REPO}`}}
    };
    for(const changed of [null,{draft:false},{head:{...before.head,sha:'b'.repeat(40)}}]){
      const w=await makeWorld({scratchAccount:true});await prepare(w,'pr-with-threads');arrange(w.gh,'ok');
      for(const [type,id] of [['branch',branch],['pr','101']])
        await w.db.recordDevObject({runId:RUN,account:OWNER,connection:'client-1',
          type,owner:OWNER,repo:REPO,objectId:id,createdSha:'a'.repeat(40)});
      w.gh.when('GET /repos/{owner}/{repo}/branches').reply(200,[
        {name:'main',commit:{sha:'a'.repeat(40)}},{name:branch,commit:{sha:'a'.repeat(40)}}
      ]);
      w.gh.when('GET /repos/{owner}/{repo}/pulls').reply(200,[before]);
      w.gh.when('GET /repos/{owner}/{repo}/issues').reply(200,[
        {number:101,pull_request:{url:'https://api.github.com/fixture'}}
      ]);
      w.gh.when('GET /repos/{owner}/{repo}/pulls/{pull_number}').replySequence([
        {status:200,body:before},{status:200,body:{...before,state:'closed',...changed}}
      ]);
      w.gh.when('PATCH /repos/{owner}/{repo}/pulls/{pull_number}').reply(200,{...before,state:'closed'});
      const result=parse(await def.handler({runId:RUN,repo:REPO,confirm:true},w.ctx));
      expect(w.gh.calls.some(x=>x.method==='PATCH')).toBe(true);
      expect(result.done).toBe(changed===null);
      expect(w.gh.calls.some(x=>x.method==='DELETE')).toBe(changed===null);
      expect(w.gh.invalid).toEqual([]);
    }
  });
  it('refuses direct mutations to the default branch even when no other objects changed',async()=>{
    const w=await makeWorld({scratchAccount:true});await prepare(w);arrange(w.gh,'ok');
    w.gh.when('GET /repos/{owner}/{repo}/branches').reply(200,[
      {name:'main',commit:{sha:'b'.repeat(40)}}]);
    const out=parse(await def.handler({runId:RUN,repo:REPO,confirm:true},w.ctx));
    expect(out.done).toBe(false);
    expect(w.gh.calls.some(c=>c.method==='DELETE')).toBe(false);
    expect(w.gh.invalid).toEqual([]);
  });
  it('permits only an exactly journaled workflow commit to advance scratch default',async()=>{
    for(const changed of [false,true]){
      const w=await makeWorld({scratchAccount:true});await prepare(w);arrange(w.gh,'ok');
      await w.db.recordDevObject({runId:RUN,account:OWNER,connection:'client-1',
        type:'workflow_file',owner:OWNER,repo:REPO,
        objectId:`.github/workflows/rtc-${RUN}.yml`,createdSha:'b'.repeat(40)});
      w.gh.when('GET /repos/{owner}/{repo}/branches').reply(200,[
        {name:'main',commit:{sha:changed?'c'.repeat(40):'b'.repeat(40)}}]);
      w.gh.when('GET /repos/{owner}/{repo}/actions/workflows').reply(200,{
        total_count:1,workflows:[{id:14,path:`.github/workflows/rtc-${RUN}.yml`,state:'active'}]});
      const out=parse(await def.handler({runId:RUN,repo:REPO,confirm:true},w.ctx));
      expect(out.done).toBe(!changed);
      expect(w.gh.calls.some(c=>c.route==='DELETE /repos/{owner}/{repo}')).toBe(!changed);
      expect(w.gh.invalid).toEqual([]);
    }
  });
  it('refuses old scratch journals without a proven initial commit identity',async()=>{
    const w=await makeWorld({scratchAccount:true});
    await w.db.createDevRun({id:RUN,account:OWNER,connection:'client-1'});
    await w.db.recordDevObject({runId:RUN,account:OWNER,connection:'client-1',
      type:'repo',owner:OWNER,repo:REPO,objectId:`${OWNER}/${REPO}`});
    arrange(w.gh,'ok');
    const out=parse(await def.handler({runId:RUN,repo:REPO,confirm:true},w.ctx));
    expect(out.done).toBe(false);
    expect(w.gh.calls.some(c=>c.method==='DELETE')).toBe(false);
  });
  it('refuses a changed run-owned label and does not delete the private repository',async()=>{
    for(const variant of ['missing','renamed','recolored','foreign-marker']){
      const w=await makeWorld({scratchAccount:true});await prepare(w);arrange(w.gh,'ok');
      const name=`rtc-run-${RUN}`;
      await w.db.recordDevObject({runId:RUN,account:OWNER,connection:'client-1',
        type:'label',owner:OWNER,repo:REPO,objectId:name});
      w.gh.when('GET /repos/{owner}/{repo}/labels/{name}').reply(
        variant==='missing'?404:200,variant==='missing'?{message:'Not Found'}:{
          name:variant==='renamed'?'different':name,
          description:variant==='foreign-marker'? `rtc_run=${RUN}-different`:`rtc_run=${RUN}`,
          color:variant==='recolored'?'ffffff':'0969da'
        });
      const out=parse(await def.handler({runId:RUN,repo:REPO,confirm:true},w.ctx));
      expect(out.done).toBe(false);
      expect(w.gh.calls.some(c=>c.method==='DELETE')).toBe(false);
      expect(w.gh.invalid).toEqual([]);
    }
  });
  it('allows one exact recorded run label to accompany private scratch deletion',async()=>{
    const w=await makeWorld({scratchAccount:true});await prepare(w);arrange(w.gh,'ok');
    const name=`rtc-run-${RUN}`;
    await w.db.recordDevObject({runId:RUN,account:OWNER,connection:'client-1',
      type:'label',owner:OWNER,repo:REPO,objectId:name});
    w.gh.when('GET /repos/{owner}/{repo}/labels').reply(200,
      [{name,description:`rtc_run=${RUN}`,color:'0969da'}]);
    w.gh.when('GET /repos/{owner}/{repo}/labels/{name}').reply(200,
      {name,description:`rtc_run=${RUN}`,color:'0969da'});
    const out=parse(await def.handler({runId:RUN,repo:REPO,confirm:true},w.ctx));
    expect(out.done).toBe(true);
    expect(w.gh.calls.some(c=>c.route==='DELETE /repos/{owner}/{repo}')).toBe(true);
    expect(w.gh.invalid).toEqual([]);
  });
  it('blocks foreign, duplicate and incomplete label inventories before deleting scratch',async()=>{
    const route='GET /repos/{owner}/{repo}/labels';
    for(const variant of [
      {status:200,items:[{name:'customer-priority',color:'ff0000'}]},
      {status:200,items:[{name:'bug'},{name:'bug'}]},
      {status:403,items:{message:'Forbidden'}},
      {status:200,items:Array.from({length:100},(_,i)=>({name:`label-${i}`}))}
    ]){
      const w=await makeWorld({scratchAccount:true});await prepare(w);arrange(w.gh,'ok');
      if(Array.isArray(variant.items)&&variant.items.length===100)
        w.gh.when(route).reply(200,variant.items,
          {link:'<https://api.github.com/repos/example-org/fixture/labels?page=2>; rel="next"'});
      else w.gh.when(route).reply(variant.status,variant.items);
      const out=parse(await def.handler({runId:RUN,repo:REPO,confirm:true},w.ctx));
      expect(out.done,JSON.stringify(variant).slice(0,100)).toBe(false);
      expect(w.gh.calls.some(x=>x.method==='DELETE'||x.method==='PATCH')).toBe(false);
      expect(w.gh.invalid).toEqual([]);
    }
  });
  it('refuses foreign, unreadable or inconsistent Actions run and artifact inventories',async()=>{
    for(const [route,variants] of [
      ['GET /repos/{owner}/{repo}/actions/runs',[
        {status:200,body:{total_count:1,workflow_runs:[{id:22}]}},
        {status:200,body:{total_count:0,workflow_runs:[{id:22}]}},
        {status:200,body:{total_count:0}},
        {status:403,body:{message:'Not authorized'}}
      ]],
      ['GET /repos/{owner}/{repo}/actions/artifacts',[
        {status:200,body:{total_count:1,artifacts:[{id:33}]}},
        {status:200,body:{total_count:0,artifacts:[{id:33}]}},
        {status:200,body:{total_count:0}},
        {status:403,body:{message:'Not authorized'}}
      ]]
    ]){
      for(const variant of variants){
        const w=await makeWorld({scratchAccount:true});await prepare(w);arrange(w.gh,'ok');
        w.gh.when(route).reply(variant.status,variant.body);
        const out=parse(await def.handler({runId:RUN,repo:REPO,confirm:true},w.ctx));
        expect(out.done,route+' '+JSON.stringify(variant)).toBe(false);
        expect(w.gh.calls.some(x=>x.method==='DELETE'||x.method==='PATCH')).toBe(false);
        expect(w.gh.invalid).toEqual([]);
      }
    }
  });
  it('refuses missing, foreign, changed and inaccessible Actions workflow definitions',async()=>{
    const route='GET /repos/{owner}/{repo}/actions/workflows';
    for(const response of [
      {status:200,body:{total_count:1,workflows:[{id:14,path:'.github/workflows/foreign.yml',state:'active'}]}},
      {status:200,body:{total_count:0,workflows:[{id:14,path:'foreign.yml',state:'active'}]}},
      {status:200,body:{total_count:1,workflows:[]}},
      {status:200,body:{workflows:[]}},
      {status:403,body:{message:'Forbidden'}}
    ]){
      const w=await makeWorld({scratchAccount:true});await prepare(w);arrange(w.gh,'ok');
      w.gh.when(route).reply(response.status,response.body);
      const out=parse(await def.handler({runId:RUN,repo:REPO,confirm:true},w.ctx));
      expect(out.done,JSON.stringify(response)).toBe(false);
      expect(w.gh.calls.some(x=>x.method==='DELETE'||x.method==='PATCH')).toBe(false);
      expect(w.gh.invalid).toEqual([]);
    }
  });
  it('refuses a disabled or duplicate run-owned workflow even with a recorded path',async()=>{
    for(const state of ['disabled_manually','active']){
      const w=await makeWorld({scratchAccount:true});await prepare(w);arrange(w.gh,'ok');
      await w.db.recordDevObject({runId:RUN,account:OWNER,connection:'client-1',
        type:'workflow_file',owner:OWNER,repo:REPO,
        objectId:`.github/workflows/rtc-${RUN}.yml`,createdSha:'b'.repeat(40)});
      w.gh.when('GET /repos/{owner}/{repo}/branches').reply(200,[
        {name:'main',commit:{sha:'b'.repeat(40)}}]);
      const same={id:14,path:`.github/workflows/rtc-${RUN}.yml`,state};
      w.gh.when('GET /repos/{owner}/{repo}/actions/workflows').reply(200,
        {total_count:state==='active'?2:1,workflows:state==='active'?[same,same]:[same]});
      const out=parse(await def.handler({runId:RUN,repo:REPO,confirm:true},w.ctx));
      expect(out.done).toBe(false);
      expect(w.gh.calls.some(x=>x.method==='DELETE'||x.method==='PATCH')).toBe(false);
    }
  });
  it('refuses orphaned PR-label associations without any GitHub mutation',async()=>{
    const w=await makeWorld({scratchAccount:true});await prepare(w);arrange(w.gh,'ok');
    await w.db.recordDevObject({runId:RUN,account:OWNER,connection:'client-1',
      type:'pr_label',owner:OWNER,repo:REPO,objectId:'91:rtc-run'});
    const out=parse(await def.handler({runId:RUN,repo:REPO,confirm:true},w.ctx));
    expect(out.done).toBe(false);
    expect(w.gh.calls.some(c=>c.method==='DELETE')).toBe(false);
  });
  it('refuses foreign issue or review comments before scratch deletion',async()=>{
    for(const [route,items] of [
      ['GET /repos/{owner}/{repo}/issues/comments',[{id:30,body:'not ours'}]],
      ['GET /repos/{owner}/{repo}/pulls/comments',[{id:31,body:'foreign review'}]]
    ]){
      const w=await makeWorld({scratchAccount:true});await prepare(w);arrange(w.gh,'ok');
      w.gh.when(route).reply(200,items);
      const out=parse(await def.handler({runId:RUN,repo:REPO,confirm:true},w.ctx));
      expect(out.done).toBe(false);
      expect(w.gh.calls.some(c=>c.method==='DELETE')).toBe(false);
      expect(w.gh.invalid).toEqual([]);
    }
  });
  it('requires the exact original review comment ID, commit, body and PR',async()=>{
    const {inspectScratchComments}=await import('../../src/dev/cleanup-comments.js');
    const w=await makeWorld({scratchAccount:true});arrange(w.gh,'ok');
    const objects=[
      {object_type:'pr',object_id:'47',owner:OWNER,repo:REPO},
      {object_type:'review_comment',object_id:'501',owner:OWNER,repo:REPO,created_sha:'a'.repeat(40)}
    ];
    const valid={id:501,commit_id:'a'.repeat(40),path:`rtc/${RUN}/review.md`,
      body:`rtc_run=${RUN} review discussion 1`,
      pull_request_url:`https://api.github.com/repos/${OWNER}/${REPO}/pulls/47`};
    w.gh.when('GET /repos/{owner}/{repo}/pulls/comments').reply(200,[valid]);
    await expect(inspectScratchComments(await (await import('../../src/github/client.js'))
      .githubFor(w.ctx,{owner:OWNER}),{owner:OWNER,repo:REPO,run:{id:RUN},objects}))
      .resolves.toMatchObject({review_comment_count:1});
    for(const changed of [
      {...valid,commit_id:'b'.repeat(40)},
      {...valid,body:`rtc_run=${RUN}-other review discussion 1`},
      {...valid,pull_request_url:`https://api.github.com/repos/${OWNER}/${REPO}/pulls/55`}
    ]){
      w.gh.when('GET /repos/{owner}/{repo}/pulls/comments').reply(200,[changed]);
      await expect(inspectScratchComments(await (await import('../../src/github/client.js'))
        .githubFor(w.ctx,{owner:OWNER}),{owner:OWNER,repo:REPO,run:{id:RUN},objects}))
        .rejects.toThrow(/Deletion refused/);
    }
    expect(w.gh.invalid).toEqual([]);
  });
  it('never allows a production connection to perform developer cleanup',async()=>{
    const w=await makeWorld({scratchAccount:true,mode:'production'});await prepare(w);arrange(w.gh,'ok');
    const result=parse(await def.handler({runId:RUN,repo:REPO,confirm:true},w.ctx));
    expect(result.status).toBe('refused');
    expect(w.gh.calls).toHaveLength(0);
  });
});

describe('V-2 missing journaled scratch resources cannot be silently erased',()=>{
  for(const [type,id] of [
    ['branch',`rtc/${RUN}/deleted-ref`],['pr','101'],['issue','201'],
    ['tag','v0.1.0'],['release','301'],['ruleset','401']
  ]){
    it(`refuses deletion when a recorded ${type} disappeared from remote inventory`,async()=>{
      const w=await makeWorld({scratchAccount:true});await prepare(w);arrange(w.gh,'ok');
      await w.db.recordDevObject({runId:RUN,account:OWNER,connection:'client-1',
        type,owner:OWNER,repo:REPO,objectId:id,
        createdSha:['branch','tag'].includes(type)?'a'.repeat(40):null});
      const out=parse(await def.handler({runId:RUN,repo:REPO,confirm:true},w.ctx));
      expect(out.done).toBe(false);
      expect(w.gh.calls.filter(c=>c.method==='DELETE'||c.method==='PATCH')).toHaveLength(0);
      expect(w.gh.invalid).toEqual([]);
    });
  }
});

describe('V-2 scenario cannot acquire extra whole-repository deletion authority',()=>{
  it('refuses a real but unexpected tag in a repo-basic run, despite matching journal and remote',async()=>{
    const w=await makeWorld({scratchAccount:true});await prepare(w);arrange(w.gh,'ok');
    await w.db.recordDevObject({runId:RUN,account:OWNER,connection:'client-1',
      type:'tag',owner:OWNER,repo:REPO,objectId:'v0.1.0',createdSha:'a'.repeat(40)});
    w.gh.when('GET /repos/{owner}/{repo}/tags').reply(200,[
      {name:'v0.1.0',commit:{sha:'a'.repeat(40)}}]);
    const out=parse(await def.handler({runId:RUN,repo:REPO,confirm:true},w.ctx));
    expect(out.done).toBe(false);
    expect(w.gh.calls.filter(c=>c.method==='DELETE'||c.method==='PATCH')).toHaveLength(0);
    expect(w.gh.invalid).toEqual([]);
  });
});

const birthLabel={id:11,name:'bug',color:'d73a4a',description:'Initial label'};
async function prepareBirth(w) {
  const scope={runId:RUN,account:OWNER,connection:'client-1'};
  await w.db.createDevRun({id:RUN,account:OWNER,connection:'client-1',scenarios:['repo-basic']});
  await w.db.claimDevIntent({...scope,stepId:'seed-repo',type:'repo',
    owner:OWNER,repo:REPO,objectName:REPO});
  await w.db.completeDevBirthIntent({...scope,stepId:'seed-repo',
    objectId:`${OWNER}/${REPO}`,createdSha:'a'.repeat(40),labels:[birthLabel]});
}
function arrangeBirth(gh,outcome) {
  arrange(gh,outcome);
  gh.when('GET /repos/{owner}/{repo}/labels').reply(200,[birthLabel]);
}
runWriteContract({label:'github_dev_cleanup unchanged container birth labels',definition:def,
  args:{runId:RUN,repo:REPO},scratchAccount:true,previewOnly:true,
  needsConfirm:true,expectedWrites:1,prepare:prepareBirth,arrange:arrangeBirth});
describe('confirmed scratch container birth-label disposal',()=>{
  it.each([
    [{...birthLabel,id:12}],
    [{...birthLabel,name:'renamed'}],
    [{...birthLabel,color:'ffffff'}],
    [{...birthLabel,description:'repurposed'}],
    [],
    [birthLabel,{id:12,name:'foreign',color:'ffffff',description:null}],
    [birthLabel,birthLabel]
  ])('refuses changed, missing, replaced, duplicate or added initial labels: %j',async labels=>{
    const w=await makeWorld({scratchAccount:true});await prepareBirth(w);arrangeBirth(w.gh,'ok');
    w.gh.when('GET /repos/{owner}/{repo}/labels').reply(200,labels);
    const out=parse(await def.handler({runId:RUN,repo:REPO,confirm:true},w.ctx));
    expect(out.done).toBe(false);
    expect(w.gh.calls.filter(c=>c.method==='DELETE')).toHaveLength(0);
  });
  it('rechecks baseline after the freeze and immediately before repository deletion',async()=>{
    const w=await makeWorld({scratchAccount:true});await prepareBirth(w);arrangeBirth(w.gh,'ok');
    w.gh.when('GET /repos/{owner}/{repo}/labels').replySequence([
      {status:200,body:[birthLabel]},
      {status:200,body:[{...birthLabel,description:'changed during cleanup'}]}
    ]);
    const out=parse(await def.handler({runId:RUN,repo:REPO,confirm:true},w.ctx));
    expect(out.done).toBe(false);
    expect(w.gh.calls.filter(c=>c.method==='DELETE')).toHaveLength(0);
  });
  it('permits unchanged initial labels alongside a verified run-created label',async()=>{
    const w=await makeWorld({scratchAccount:true});await prepareBirth(w);arrangeBirth(w.gh,'ok');
    const scope={runId:RUN,account:OWNER,connection:'client-1',stepId:'seed-label'};
    await w.db.claimDevIntent({...scope,type:'label',owner:OWNER,repo:REPO,objectName:'rtc-run'});
    await w.db.completeDevIntent({...scope,objectId:'rtc-run'});
    const label={id:12,name:'rtc-run',color:'0969da',description:`rtc_run=${RUN}`};
    w.gh.when('GET /repos/{owner}/{repo}/labels').reply(200,[birthLabel,label]);
    w.gh.when('GET /repos/{owner}/{repo}/labels/{name}').reply(200,label);
    const out=parse(await def.handler({runId:RUN,repo:REPO,confirm:true},w.ctx));
    expect(out.done).toBe(true);
    expect(w.gh.calls.filter(c=>c.method==='DELETE')).toHaveLength(1);
    expect(w.gh.invalid).toEqual([]);
  });
});

it('full owner can clean exact recorded scratch fixtures from production mode',async()=>{
  const w=await makeWorld({scratchAccount:true,mode:'production',profile:'full'});await prepare(w);arrange(w.gh,'ok');
  const result=parse(await def.handler({runId:RUN,repo:REPO},w.ctx));
  expect(result).toMatchObject({status:'applied',confirmed:true});
  expect(w.gh.calls.filter(c=>c.method==='DELETE')).toHaveLength(1);
  expect(w.gh.invalid).toEqual([]);
});
