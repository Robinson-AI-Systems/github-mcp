import {describe,it,expect} from 'vitest';
import {makeWorld,parse} from '../../test/helpers/write-contract.js';
import {createDispatch} from '../../src/tools/dispatch.js';
import {registry} from '../../src/tools/index.js';
import {createGates} from '../../src/tools/gates.js';
import {DEFAULT_PROJECTS,APP_READINESS_IDS} from '../../src/data/profile-schema.js';
import * as readiness from '../../src/tools/app-readiness.js';

const REPO='GET /repos/{owner}/{repo}',
  RULES='GET /repos/{owner}/{repo}/rulesets',
  BRANCH='GET /repos/{owner}/{repo}/branches/{branch}',
  WORK='GET /repos/{owner}/{repo}/actions/permissions/workflow',
  FORK='GET /repos/{owner}/{repo}/actions/permissions/fork-pr-contributor-approval',
  ACT='GET /repos/{owner}/{repo}/actions/permissions',
  RET='GET /repos/{owner}/{repo}/actions/permissions/artifact-and-log-retention',
  SECRETS='GET /repos/{owner}/{repo}/actions/secrets',
  DEP='GET /repos/{owner}/{repo}/dependabot/secrets',
  KEYS='GET /repos/{owner}/{repo}/keys',
  PEOPLE='GET /repos/{owner}/{repo}/collaborators',
  WF='GET /repos/{owner}/{repo}/contents/{path}';
const p=()=>{
  const source=structuredClone(DEFAULT_PROJECTS[0]);
  source.id='synthetic-app';
  source.name='Synthetic app';
  source.source.repository='example-org/hello';
  source.source.verifiedMainSha='a'.repeat(40);
  source.repos=['example-org/hello'];
  source.ownedRefs=[];
  source.productionBranches=[];
  source.notes='Synthetic only';
  return source;
};
const repo=(options={})=>({
  full_name:'example-org/hello',private:false,allow_merge_commit:true,
  security_and_analysis:{secret_scanning:{status:'enabled'},
    secret_scanning_push_protection:{status:'enabled'}},
  ...options
});
function arrange(gh,{ruleList=[],repoState={},security={},work='read',fork='all_external_contributors',
  workflowText=null}={}){
  gh.when(REPO).reply(200,repo({...repoState,
    security_and_analysis:{...repo().security_and_analysis,...security}}));
  gh.when(RULES).reply(200,ruleList);
  // H-4 uses GitHub's real, separate Dependabot security-updates read.
  // An unstubbed 501 would be retried by Octokit and wrongly time out P-2.
  gh.when('GET /repos/{owner}/{repo}/automated-security-fixes')
    .reply(200,{enabled:true,paused:false});
  gh.when('GET /repos/{owner}/{repo}/private-vulnerability-reporting').reply(200,{enabled:false});
  gh.when(BRANCH).reply(404,{message:'not found'});
  gh.when(ACT).reply(200,{enabled:true,allowed_actions:'all'});
  gh.when(WORK).reply(200,{default_workflow_permissions:work,
    can_approve_pull_request_reviews:false});
  gh.when(FORK).reply(200,{approval_policy:fork});
  gh.when(RET).reply(200,{days:30,maximum_allowed_days:90});
  gh.when(SECRETS).reply(200,{total_count:0,secrets:[]});
  gh.when(DEP).reply(200,{total_count:0,secrets:[]});
  gh.when(KEYS).reply(200,[]);
  gh.when(PEOPLE).reply(200,[]);
  gh.when(WF).reply(200,workflowText?{
    encoding:'base64',size:workflowText.length,
    content:Buffer.from(workflowText).toString('base64')}:
    {encoding:'base64',size:38,content:Buffer.from('on: [push]\npermissions:\n  contents: read').toString('base64')});
}
const invoke=async(w,args)=>{
  const dispatch=createDispatch({env:w.ctx.env,credentials:w.credentials,
    fetch:w.gh.fetch,now:w.ctx.now,sleep:w.ctx.sleep,gates:createGates()});
  return dispatch({registry,name:'github_workflow_app_readiness',args,
    connection:w.connection,db:w.db});
};
const spec=p();
describe('P-2 project G1–G20 readiness and safe fix routing',()=>{
  it('registers one discoverable workflow with explicitly non-read-only mutation capability',()=>{
    expect(readiness.tools.map(x=>x.name)).toEqual(['github_workflow_app_readiness']);
    expect(readiness.tools[0].annotations.readOnlyHint).toBe(false);
    expect(registry.tools.find(x=>x.name==='github_workflow_app_readiness')).toBeDefined();
  });
  it('observes every existing G row, keeps process/guided rows non-done, and does not write',async()=>{
    const w=await makeWorld({profile:'full'});
    arrange(w.gh);
    const x=parse(await invoke(w,{spec}));
    expect(x.rows.map(row=>row.id)).toEqual(APP_READINESS_IDS);
    expect(x.rows.find(row=>row.id==='G1').status).toBe('done');
    expect(x.rows.find(row=>row.id==='G2').status).toBe('needs_attention');
    expect(x.rows.find(row=>row.id==='G5').status).toBe('needs_you');
    expect(x.rows.find(row=>row.id==='G8').status).toBe('needs_attention');
    expect(x.rows.find(row=>row.id==='G17').status).toBe('done');
    expect(x.all_done).toBe(false);
    expect(w.gh.calls.filter(call=>!['GET','HEAD'].includes(call.method))).toEqual([]);
  });
  it('treats a private repository without a fork-approval setting (GitHub 422) as done, with no repair offered',async()=>{
    const w=await makeWorld({profile:'full'});
    arrange(w.gh);
    w.gh.when(FORK).reply(422,{message:'Validation Failed'});
    const x=parse(await invoke(w,{spec}));
    const g16=x.rows.find(row=>row.id==='G16');
    expect(g16.status).toBe('done');
    expect(JSON.stringify(x)).not.toContain('"section":"fork"');
  });
  it('uses the identical evaluator for a persisted project and validated inline spec',async()=>{
    const w=await makeWorld({profile:'full'});
    arrange(w.gh);
    await w.db.initSchema();
    const original=await w.db.getKnownProject('appliance-desk');
    const app={...spec,id:'appliance-desk'};
    await w.db.saveKnownProject(app,original.version);
    const first=parse(await invoke(w,{project:'appliance-desk'}));
    const second=parse(await invoke(w,{spec:app}));
    expect(first.rows.map(x=>x.status)).toEqual(second.rows.map(x=>x.status));
    expect(first.scope).toBe('example-org/hello');
  });
  it('refuses scope outside connected account and forbids ambiguous project choice',async()=>{
    const w=await makeWorld();
    arrange(w.gh);
    const o=parse(await invoke(w,{spec:{...spec,
      repos:['other-org/secret'],source:{...spec.source,repository:'other-org/secret'}}}));
    expect(o.status).toBe('refused');
    const a=parse(await invoke(w,{project:'synthetic-app',spec}));
    expect(a.status).toBe('refused');
    expect(w.gh.calls).toHaveLength(0);
  });
  it('does not repair unknown or guided workflow rows or edit workflow files',async()=>{
    const w=await makeWorld({mode:'production',profile:'full'});
    arrange(w.gh);
    const x=parse(await invoke(w,{spec,fixRow:'G11',confirm:true}));
    expect(x.status).toBe('not_fixable');
    expect(w.gh.calls.filter(q=>q.method!=='GET')).toHaveLength(0);
  });
  it('a missing ci rule generates only an exact guarded ruleset mutation for owner confirmation',async()=>{
    const w=await makeWorld({mode:'production',profile:'full'});
    arrange(w.gh);
    const x=parse(await invoke(w,{spec,fixRow:'G2',confirm:false}));
    expect(['fix_not_applied','not_fixable']).toContain(x.status);
    expect(w.gh.calls.filter(q=>q.method==='PUT'||q.method==='POST')).toHaveLength(0);
    expect(x.rows.find(r=>r.id==='G2').status).toBe('needs_attention');
  });
  it('confirms exactly one missing ci ruleset via existing safeguarded writer and independent reread',async()=>{
    const w=await makeWorld({mode:'production',profile:'full'});
    // The positive test authorizes production only for the synthetic account.
    // Other cases must continue exercising the real production switch refusal.
    await w.db.setProductionEnabled('example-org',true);
    arrange(w.gh);
    const rules=[
      {type:'required_status_checks',parameters:{
        strict_required_status_checks_policy:true,required_status_checks:[{context:'ci'}]}},
      {type:'non_fast_forward'},{type:'deletion'}
    ];
    const created={id:88,name:'main-ci-and-safety',target:'branch',
      enforcement:'active',source:'example-org/hello',
      conditions:{ref_name:{include:['~DEFAULT_BRANCH'],exclude:[]}},
      rules,bypass_actors:[]};
    w.gh.when(RULES).replySequence([
      {status:200,body:[]},{status:200,body:[]},
      {status:200,body:[{id:88}]}
    ]);
    w.gh.when('POST /repos/{owner}/{repo}/rulesets').reply(201,{id:88});
    w.gh.when('GET /repos/{owner}/{repo}/rulesets/{ruleset_id}').reply(200,created);
    const x=parse(await invoke(w,{spec,fixRow:'G2',confirm:true}));
    expect(x.status,JSON.stringify(x.attempted)).toBe('fixed');
    expect(x.rows.find(row=>row.id==='G2').status).toBe('fixed');
    expect(w.gh.calls.filter(q=>q.method==='POST')).toHaveLength(1);
    expect(w.gh.invalid).toEqual([]);
  });
  it('uses a validated inline profile exact custom required-check list, not hardcoded ci',async()=>{
    const w=await makeWorld({mode:'production',profile:'full'});
    arrange(w.gh);
    const policy={...spec,requiredChecks:['build','security']};
    const x=parse(await invoke(w,{spec:policy,fixRow:'G2',confirm:false}));
    expect(x.rows.find(r=>r.id==='G2').evidence).toContain('build, security');
    expect(x.status).toBe('fix_not_applied');
    expect(w.gh.calls.filter(y=>!['GET','HEAD'].includes(y.method))).toEqual([]);
  });
  it('detects flow-style forbidden workflow triggers even with apparently safe permissions',async()=>{
    const w=await makeWorld({profile:'full'});
    arrange(w.gh,{workflowText:'on: [pull_request_target]\npermissions:\n  contents: read'});
    const x=parse(await invoke(w,{spec}));
    expect(x.rows.find(r=>r.id==='G11').status).toBe('needs_attention');
    expect(x.rows.find(r=>r.id==='G12').status).toBe('needs_attention');
  });
  it('accepts profile-declared read-level checks permission on a daily release workflow',async()=>{
    const w=await makeWorld({profile:'full'});
    arrange(w.gh,{workflowText:'on:\n  schedule: []\npermissions:\n  contents: write\n  checks: read'});
    const x=parse(await invoke(w,{spec}));
    expect(x.rows.find(r=>r.id==='G12').status).toBe('done');
  });
  it('does not mistake an organization member user login for an outside collaborator',async()=>{
    const w=await makeWorld({profile:'full'});
    arrange(w.gh,{repoState:{owner:{login:'example-org',type:'Organization'}}});
    w.gh.when(PEOPLE).reply(200,[{login:'example-admin',id:1}]);
    const x=parse(await invoke(w,{spec}));
    expect(x.rows.find(r=>r.id==='G19').status).toBe('needs_you');
    expect(x.rows.find(r=>r.id==='G19').evidence).toContain('user identities');
  });
  it('readable private-repository paid scanning never bypasses zero spending policy',async()=>{
    const w=await makeWorld({delegated:true,mode:'production',profile:'full'});
    arrange(w.gh,{repoState:{private:true},
      security:{secret_scanning:{status:'disabled'}}});
    const x=parse(await invoke(w,{spec,fixRow:'G15',fixFeature:'secret_scanning',confirm:true}));
    expect(x.done).toBe(false);
    expect(w.gh.calls.filter(q=>q.method==='PATCH')).toHaveLength(0);
  });
  it('readable GitHub denied policies never become done or auto-fixed',async()=>{
    const w=await makeWorld({mode:'production',profile:'full'});
    arrange(w.gh);
    w.gh.when(RULES).reply(403,{message:'Forbidden'});
    const x=parse(await invoke(w,{spec,fixRow:'G2',confirm:true}));
    expect(x.rows.find(r=>r.id==='G2').status).toBe('not_readable');
    expect(x.status).toBe('not_fixable');
    expect(w.gh.calls.filter(q=>q.method!=='GET')).toHaveLength(0);
  });
  it('requires one named missing feature instead of bulk security activation',async()=>{
    const w=await makeWorld({profile:'full'});
    arrange(w.gh,{security:{secret_scanning:{status:'disabled'},
      secret_scanning_push_protection:{status:'disabled'}}});
    const x=parse(await invoke(w,{spec,fixRow:'G15',confirm:true}));
    expect(x.status).toBe('needs_choice');
    expect(w.gh.calls.filter(q=>q.method!=='GET')).toHaveLength(0);
  });
});
