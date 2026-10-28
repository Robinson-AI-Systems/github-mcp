import {describe,expect,it} from 'vitest';
import {runWriteContract,makeWorld,parse} from '../../test/helpers/write-contract.js';
import * as seeded from '../../src/tools/dev-seed-write.js';

const ID='run-seeded-101',REPO='seed-demo',OWNER='example-org',COMMIT='b'.repeat(40);
const PATH=`.github/workflows/rtc-${ID}.yml`,LABEL=`rtc-run-${ID}`,BRANCH=`rtc/${ID}/failure-ref`;
const MARK=`rtc_run=${ID}`;
const workflow=(failing)=>`name: RTC ${ID}
on:
  workflow_dispatch:
jobs:
  fixture:
    runs-on: ubuntu-latest
    steps:
      - name: ${failing?'Fail':'Pass'} controlled scenario
        run: ${failing?'exit 1':'echo "RTC fixture passed"'}
`;
const repository=(v={})=>({full_name:`${OWNER}/${REPO}`,private:true,
  description:`Developer fixture for ${MARK} (repo-basic)`,default_branch:'main',...v});
const arrange=(scenario)=>(gh,outcome)=>{
  const failing=scenario==='failing-ci';
  const after=repository(failing?{description:`Developer fixture for ${MARK} (failing-ci)`}:{});
  gh.when('GET /repos/{owner}/{repo}').replySequence([
    {status:404,body:{message:'Not Found'}},
    {status:200,body:repository({...after,...(outcome==='mismatch'?{private:false}:{})})},
    {status:200,body:after}
  ]);
  gh.when('POST /orgs/{org}/repos').reply(201,after);
  gh.when('GET /repos/{owner}/{repo}/labels').reply(200,[]);
  gh.when('GET /repos/{owner}/{repo}/git/ref/{ref}').reply(200,request=>({
    ref:`refs/${request.params.ref}`,object:{sha:COMMIT}
  }));
  gh.when('PUT /repos/{owner}/{repo}/contents/{path}').reply(201,{
    content:{path:PATH,sha:'a'.repeat(40)},commit:{sha:COMMIT}
  });
  gh.when('GET /repos/{owner}/{repo}/contents/{path}').reply(200,{
    path:PATH,sha:'a'.repeat(40),content:Buffer.from(workflow(failing)).toString('base64'),encoding:'base64'
  });
  if(failing){
    gh.when('POST /repos/{owner}/{repo}/git/refs').reply(201,{ref:`refs/heads/${BRANCH}`,object:{sha:COMMIT}});
    gh.when('GET /repos/{owner}/{repo}/git/ref/{ref}').reply(200,request=>({ref:`refs/${request.params.ref}`,object:{sha:COMMIT}}));
  }else{
    gh.when('POST /repos/{owner}/{repo}/labels').reply(201,{name:LABEL,color:'0969da',description:MARK});
    gh.when('GET /repos/{owner}/{repo}/labels/{name}').reply(200,{name:LABEL,color:'0969da',description:MARK});
  }
};
const def={tool:seeded.tools[0],handler:seeded.handlers.github_dev_seed};
for(const scenario of ['repo-basic','failing-ci']){
  runWriteContract({label:`github_dev_seed(${scenario})`,definition:def,
    args:{repo:REPO,runId:ID,scenario},arrange:arrange(scenario),
    scratchAccount:true,previewOnly:true,needsConfirm:false,expectedWrites:3});
}
describe('V-1 real multi-step GitHub scenario safeguards',()=>{
  it('records all three exact returned objects with immutable run identity',async()=>{
    const w=await makeWorld({scratchAccount:true});arrange('repo-basic')(w.gh,'ok');
    const out=parse(await def.handler({repo:REPO,runId:ID,scenario:'repo-basic',confirm:true},w.ctx));
    expect(out).toMatchObject({status:'applied',done:true,confirmed:true});
    const list=await w.db.listDevObjects({runId:ID,account:OWNER,connection:'client-1'});
    expect(list.map(x=>x.object_type).sort()).toEqual(['label','repo','workflow_file']);
    expect(list.find(x=>x.object_type==='repo').created_sha).toBe(COMMIT);
    expect(list.map(x=>x.object_id).sort()).toEqual([PATH,LABEL,`${OWNER}/${REPO}`].sort());
    for(const step of ['seed-repo','seed-workflow','seed-label'])
      expect(await w.db.getDevIntent({runId:ID,account:OWNER,connection:'client-1',stepId:step}))
        .toMatchObject({status:'recorded'});
    const run=await w.db.getDevRun({id:ID,account:OWNER,connection:'client-1'});
    expect(run.scenarios).toEqual(['repo-basic']);
  });
  it('does not permit a run to silently switch scenario after it was registered',async()=>{
    const w=await makeWorld({scratchAccount:true});
    await w.db.createDevRun({id:ID,account:OWNER,connection:'client-1',scenarios:['repo-basic']});
    const out=parse(await def.handler({repo:REPO,runId:ID,scenario:'failing-ci',confirm:true},w.ctx));
    expect(out.done).toBe(false);
    expect(w.gh.calls).toEqual([]);
  });
  it('refuses non-scratch organizations, production mode and unimplemented scenario names without GitHub calls',async()=>{
    const basic=await makeWorld();expect(parse(await def.handler({repo:REPO,runId:ID,scenario:'repo-basic',confirm:true},basic.ctx)).done).toBe(false);
    expect(basic.gh.calls).toEqual([]);
    const prod=await makeWorld({scratchAccount:true,mode:'production'});
    expect(parse(await def.handler({repo:REPO,runId:ID,scenario:'repo-basic',confirm:true},prod.ctx)).done).toBe(false);
    expect(prod.gh.calls).toEqual([]);
    expect(seeded.SEEDABLE).toEqual(['repo-basic','failing-ci','release-train','protected-main','stack-of-three','pr-with-threads','webhook-target']);
  });
  it('never blindly repeats a failed downstream GitHub write after repo creation',async()=>{
    const w=await makeWorld({scratchAccount:true});arrange('repo-basic')(w.gh,'ok');
    w.gh.when('PUT /repos/{owner}/{repo}/contents/{path}').reply(403,{message:'Forbidden'});
    const out=parse(await def.handler({repo:REPO,runId:ID,scenario:'repo-basic',confirm:true},w.ctx));
    expect(out.done).toBe(false);
    const rows=await w.db.listDevObjects({runId:ID,account:OWNER,connection:'client-1'});
    expect(rows).toEqual([expect.objectContaining({object_type:'repo',object_id:`${OWNER}/${REPO}`})]);
    expect(await w.db.getDevIntent({runId:ID,account:OWNER,connection:'client-1',stepId:'seed-workflow'}))
      .toMatchObject({status:'uncertain'});
    expect(w.gh.calls.filter(x=>x.route==='POST /orgs/{org}/repos')).toHaveLength(1);
  });
});

const releaseArrange=(gh,outcome)=>{
  const repo=repository({description:`Developer fixture for ${MARK} (release-train)`});
  gh.when('GET /repos/{owner}/{repo}').replySequence([
    {status:404,body:{message:'Not Found'}},
    {status:200,body:repo},
    {status:200,body:{...repo,...(outcome==='mismatch'?{private:false}:{})}}
  ]);
  gh.when('POST /orgs/{org}/repos').reply(201,repo);
  gh.when('GET /repos/{owner}/{repo}/labels').reply(200,[]);
  gh.when('GET /repos/{owner}/{repo}/git/ref/{ref}').reply(200,
    request=>({ref:`refs/${request.params.ref}`,object:{sha:COMMIT}}));
  gh.when('POST /repos/{owner}/{repo}/git/refs').reply(201,
    request=>({ref:request.body.ref,object:{sha:request.body.sha}}));
  gh.when('POST /repos/{owner}/{repo}/releases').reply(201,
    {id:128,tag_name:'v0.3.0',draft:true,body:`Draft-only release fixture ${MARK}`});
  gh.when('GET /repos/{owner}/{repo}/releases/{release_id}').reply(200,
    {id:128,tag_name:'v0.3.0',draft:true,body:`Draft-only release fixture ${MARK}`});
};
runWriteContract({label:'github_dev_seed(release-train)',definition:def,
  args:{repo:REPO,runId:ID,scenario:'release-train'},arrange:releaseArrange,
  scratchAccount:true,previewOnly:true,needsConfirm:false,expectedWrites:5});
describe('release-train durable draft fixture',()=>{
  it('records three exact tags and the draft release, never publishes',async()=>{
    const w=await makeWorld({scratchAccount:true});releaseArrange(w.gh,'ok');
    const out=parse(await def.handler({repo:REPO,runId:ID,scenario:'release-train',confirm:true},w.ctx));
    expect(out).toMatchObject({status:'applied',done:true,confirmed:true});
    const rows=await w.db.listDevObjects({runId:ID,account:OWNER,connection:'client-1'});
    expect(rows.map(x=>x.object_type).sort()).toEqual(['release','repo','tag','tag','tag']);
    expect(rows.filter(x=>x.object_type==='tag').map(x=>x.object_id).sort())
      .toEqual(['v0.1.0','v0.2.0','v0.3.0']);
    expect(rows.find(x=>x.object_type==='release').object_id).toBe('128');
    expect(w.gh.calls.filter(x=>x.route==='POST /repos/{owner}/{repo}/releases')[0].body.draft).toBe(true);
  });
});

const rulesetFixture=(overrides={})=>({
  id:841,name:LABEL,target:'branch',enforcement:'active',
  conditions:{ref_name:{include:['~DEFAULT_BRANCH'],exclude:[]}},
  bypass_actors:[],rules:[{type:'required_status_checks',parameters:{
    required_status_checks:[{context:'ci'}],strict_required_status_checks_policy:true
  }}],...overrides
});
const protectedArrange=(gh,outcome)=>{
  const repo=repository({description:`Developer fixture for ${MARK} (protected-main)`});
  gh.when('GET /repos/{owner}/{repo}').replySequence([
    {status:404,body:{message:'Not Found'}},
    {status:200,body:repo},{status:200,body:repo}
  ]);
  gh.when('POST /orgs/{org}/repos').reply(201,repo);
  gh.when('GET /repos/{owner}/{repo}/labels').reply(200,[]);
  gh.when('GET /repos/{owner}/{repo}/git/ref/{ref}').reply(200,
    {ref:'refs/heads/main',object:{sha:COMMIT}});
  gh.when('POST /repos/{owner}/{repo}/rulesets').reply(201,rulesetFixture());
  gh.when('GET /repos/{owner}/{repo}/rulesets/{ruleset_id}').reply(200,
    rulesetFixture(outcome==='mismatch'?{enforcement:'disabled'}:{}));
};
runWriteContract({label:'github_dev_seed(protected-main)',definition:def,
  args:{repo:REPO,runId:ID,scenario:'protected-main'},arrange:protectedArrange,
  scratchAccount:true,previewOnly:true,needsConfirm:false,expectedWrites:2});
describe('protected-main scratch fixture',()=>{
  it('records exact GitHub ruleset ID and mandates ci on only the default branch',async()=>{
    const w=await makeWorld({scratchAccount:true});protectedArrange(w.gh,'ok');
    const out=parse(await def.handler({repo:REPO,runId:ID,scenario:'protected-main',confirm:true},w.ctx));
    expect(out).toMatchObject({status:'applied',done:true,confirmed:true});
    const rows=await w.db.listDevObjects({runId:ID,account:OWNER,connection:'client-1'});
    expect(rows.map(x=>x.object_type).sort()).toEqual(['repo','ruleset']);
    expect(rows.find(x=>x.object_type==='ruleset').object_id).toBe('841');
    const call=w.gh.calls.find(x=>x.route==='POST /repos/{owner}/{repo}/rulesets');
    expect(call.body.conditions.ref_name.include).toEqual(['~DEFAULT_BRANCH']);
    expect(call.body.rules[0].parameters.required_status_checks).toEqual([{context:'ci'}]);
  });
});

const stackSha=i=>String.fromCharCode(97+i).repeat(40);
const stackFixture=(gh,outcome)=>{
  const repo=repository({description:`Developer fixture for ${MARK} (stack-of-three)`});
  gh.when('GET /repos/{owner}/{repo}').replySequence([
    {status:404,body:{message:'Not Found'}},{status:200,body:repo},
    {status:200,body:repository({...repo,...(outcome==='mismatch'?{private:false}:{})})}
  ]);
  gh.when('POST /orgs/{org}/repos').reply(201,repo);
  gh.when('GET /repos/{owner}/{repo}/labels').reply(200,[]);
  gh.when('GET /repos/{owner}/{repo}/git/ref/{ref}').reply(200,request=>{
    const name=request.params.ref,match=name.match(/stack-(\d)$/);
    const i=Number(match?.[1]??0);
    return {ref:`refs/${name}`,object:{sha:i?stackSha(i):COMMIT}};
  });
  gh.when('POST /repos/{owner}/{repo}/git/refs').reply(201,request=>({
    ref:request.body.ref,object:{sha:request.body.sha}
  }));
  gh.when('PUT /repos/{owner}/{repo}/contents/{path}').reply(201,request=>{
    const i=Number(request.params.path.match(/stack-(\d)\.md$/)?.[1]);
    return {content:{path:request.params.path},commit:{sha:stackSha(i)}};
  });
  gh.when('GET /repos/{owner}/{repo}/contents/{path}').reply(200,request=>{
    const i=Number(request.params.path.match(/stack-(\d)\.md$/)?.[1]);
    return {path:request.params.path,content:Buffer.from(
      `RTC draft stack ${i} for rtc_run=${ID}\n`).toString('base64')};
  });
  gh.when('POST /repos/{owner}/{repo}/labels').reply(201,{name:'rtc-run',description:MARK});
  gh.when('GET /repos/{owner}/{repo}/labels/{name}').reply(200,{name:'rtc-run',description:MARK});
  const pull=request=>{
    const i=Number(request.body?.head?.match(/stack-(\d)$/)?.[1]??
      (Number(request.params?.pull_number)-70));
    return {number:70+i,head:{ref:`rtc/${ID}/stack-${i}`,sha:stackSha(i)},
      base:{ref:i===1?'main':`rtc/${ID}/stack-${i-1}`},
      body:`Run-owned draft review fixture.\n\n<!-- rtc_run=${ID} -->`,
      state:'open',draft:true};
  };
  gh.when('POST /repos/{owner}/{repo}/pulls').reply(201,request=>pull(request));
  gh.when('GET /repos/{owner}/{repo}/pulls/{pull_number}').reply(200,request=>pull(request));
  gh.when('POST /repos/{owner}/{repo}/issues/{issue_number}/labels').reply(200,[{name:'rtc-run'}]);
  gh.when('GET /repos/{owner}/{repo}/issues/{issue_number}/labels').reply(200,[{name:'rtc-run'}]);
};
runWriteContract({label:'github_dev_seed(stack-of-three)',definition:def,
  args:{repo:REPO,runId:ID,scenario:'stack-of-three'},arrange:stackFixture,
  scratchAccount:true,previewOnly:true,needsConfirm:false,expectedWrites:14,advanceClockOnSleep:true});
describe('three exact-head stacked draft PRs',()=>{
  it('journals all fourteen objects and links exact bases, without merging',async()=>{
    const w=await makeWorld({scratchAccount:true,advanceClockOnSleep:true});stackFixture(w.gh,'ok');
    const out=parse(await def.handler({repo:REPO,runId:ID,scenario:'stack-of-three',confirm:true},w.ctx));
    if(!out.done)throw new Error(JSON.stringify({out,steps:w.gh.calls.map(x=>x.route).slice(-22),
      invalid:w.gh.invalid.map(x=>({route:x.route,path:x.path}))}));
    expect(out).toMatchObject({status:'applied',done:true,confirmed:true});
    const saved=await w.db.listDevObjects({runId:ID,account:OWNER,connection:'client-1',limit:50});
    expect(saved).toHaveLength(14);
    expect(saved.filter(x=>x.object_type==='pr').map(x=>x.object_id).sort()).toEqual(['71','72','73']);
    expect(saved.filter(x=>x.object_type==='pr_label').map(x=>x.object_id).sort())
      .toEqual(['71:rtc-run','72:rtc-run','73:rtc-run']);
    const prs=w.gh.calls.filter(x=>x.route==='POST /repos/{owner}/{repo}/pulls');
    expect(prs.map(x=>({head:x.body.head,base:x.body.base,draft:x.body.draft}))).toEqual([
      {head:`rtc/${ID}/stack-1`,base:'main',draft:true},
      {head:`rtc/${ID}/stack-2`,base:`rtc/${ID}/stack-1`,draft:true},
      {head:`rtc/${ID}/stack-3`,base:`rtc/${ID}/stack-2`,draft:true}
    ]);
    expect(w.gh.invalid).toEqual([]);
    expect(w.gh.calls.some(x=>/\/merge$|\/dispatches$/.test(x.path))).toBe(false);
  });
});

it('full owner seeds a verified scratch scenario from production mode with exact journal provenance',async()=>{
  const w=await makeWorld({scratchAccount:true,mode:'production',profile:'full'});arrange('repo-basic')(w.gh,'ok');
  const result=parse(await def.handler({repo:REPO,runId:ID,scenario:'repo-basic'},w.ctx));
  expect(result).toMatchObject({status:'applied',confirmed:true});
  expect((await w.db.listDevObjects({runId:ID,account:OWNER,connection:'client-1'})).map(o=>o.object_type).sort()).toEqual(['label','repo','workflow_file']);
  expect(w.gh.invalid).toEqual([]);
});
