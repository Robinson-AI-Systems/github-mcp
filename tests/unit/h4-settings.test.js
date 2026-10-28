import {describe,it,expect} from 'vitest';
import {spendGate as actualSpendGate} from '../../src/tools/spend-guard.js';
import {makeWorld as baseWorld,runWriteContract,parse} from '../../test/helpers/write-contract.js';
import {registry} from '../../src/tools/index.js';
import {createDispatch} from '../../src/tools/dispatch.js';
import * as settings from '../../src/tools/security-settings-write.js';

const routes={
  repo:'GET /repos/{owner}/{repo}',repoPatch:'PATCH /repos/{owner}/{repo}',
  actions:'GET /repos/{owner}/{repo}/actions/permissions',
  workflow:'GET /repos/{owner}/{repo}/actions/permissions/workflow',
  selected:'GET /repos/{owner}/{repo}/actions/permissions/selected-actions',
  fork:'GET /repos/{owner}/{repo}/actions/permissions/fork-pr-contributor-approval',
  retention:'GET /repos/{owner}/{repo}/actions/permissions/artifact-and-log-retention',
  dependabot:'GET /repos/{owner}/{repo}/automated-security-fixes',
  dependabotPut:'PUT /repos/{owner}/{repo}/automated-security-fixes',
  dependabotDelete:'DELETE /repos/{owner}/{repo}/automated-security-fixes',
  pvr:'GET /repos/{owner}/{repo}/private-vulnerability-reporting',pvrPut:'PUT /repos/{owner}/{repo}/private-vulnerability-reporting',
  pvrDelete:'DELETE /repos/{owner}/{repo}/private-vulnerability-reporting',
  workflowPut:'PUT /repos/{owner}/{repo}/actions/permissions/workflow',
  retentionPut:'PUT /repos/{owner}/{repo}/actions/permissions/artifact-and-log-retention'
};
const security=(secret='disabled',priv=false,overrides={})=>({
  id:1,full_name:'example-org/hello',private:priv,
  security_and_analysis:{
    advanced_security:{status:'disabled'},code_security:{status:'disabled'},
    secret_scanning:{status:secret},
    secret_scanning_push_protection:{status:'disabled'},
    secret_scanning_ai_detection:{status:'disabled'},
    secret_scanning_non_provider_patterns:{status:'disabled'},
    secret_scanning_delegated_alert_dismissal:{status:'disabled'},
    secret_scanning_delegated_bypass:{status:'disabled'},
    ...Object.fromEntries(Object.entries(overrides).map(([name,status])=>[name,{status}]))
  }});
async function makeWorld(options){
  const w=await baseWorld(options);
  w.gh.when(routes.dependabot).reply(200,{enabled:true,paused:false});
  return w;
}
function arrangeFeature(gh,result){
  gh.when(routes.repo).replySequence([
    {status:200,body:security()},
    {status:200,body:security(result==='ok'?'enabled':'disabled')}]);
  gh.when(routes.repoPatch).reply(200,security('enabled'));
  gh.when(routes.pvr).reply(200,{enabled:false});
  gh.when(routes.dependabot).reply(200,{enabled:true,paused:false});
}
const actions={enabled:true,allowed_actions:'all',sha_pinning_required:true};
const workflow=(p='read')=>({
  default_workflow_permissions:p,can_approve_pull_request_reviews:false});
const fork={approval_policy:1};
const retention={days:30,maximum_allowed_days:90};
function arrangeWorkflow(gh,result){
  gh.when(routes.actions).reply(200,actions);
  gh.when(routes.workflow).replySequence([
    {status:200,body:workflow()},
    {status:200,body:workflow(result==='ok'?'write':'read')}]);
  gh.when(routes.fork).reply(200,fork);
  gh.when(routes.retention).reply(200,retention);
  gh.when(routes.workflowPut).reply(204,null);
}
const featureDef={tool:settings.securitySetFeature.tool,
  handler:settings.securitySetFeature.handler};
const actionDef={tool:settings.actionsSetSettings.tool,
  handler:settings.actionsSetSettings.handler};
runWriteContract({
  label:'github_security_set_feature preserves other flags',
  definition:featureDef,args:{repo:'hello',feature:'secret_scanning',enabled:true},
  production:true,needsConfirm:true,profile:'full',arrange:arrangeFeature});
runWriteContract({
  label:'github_security_set_feature private paid activation with informed owner consent',
  definition:featureDef,args:{repo:'hello',feature:'secret_scanning',enabled:true},
  production:true,needsConfirm:true,profile:'full',
  arrange(gh,result){
    gh.when(routes.repo).replySequence([
      {status:200,body:security('disabled',true)},
      {status:200,body:security(result==='ok'?'enabled':'disabled',true)}
    ]);
    gh.when(routes.pvr).reply(200,{enabled:false});
    gh.when(routes.dependabot).reply(200,{enabled:true,paused:false});
    gh.when(routes.repoPatch).reply(200,security('enabled',true));
  }
});
runWriteContract({
  label:'github_actions_set_settings preserves other policy',
  definition:actionDef,args:{repo:'hello',section:'workflow',
    changes:{default_workflow_permissions:'write'}},
  production:true,needsConfirm:true,accessWidening:true,profile:'full',
  arrange:arrangeWorkflow});
async function call(w,name,args){
  const dispatch=createDispatch({env:w.ctx.env,credentials:w.credentials,
    fetch:w.gh.fetch,now:w.ctx.now,sleep:w.ctx.sleep,gates:w.ctx.gates});
  const v=await dispatch({registry,name,args,connection:w.connection,db:w.db});
  return v.structuredContent??(v.isError?{done:false,error:v.content?.[0]?.text}:parse(v));
}
describe('H-4 security feature and Actions policy safety',()=>{
  it('reads five Actions categories and feature state before modifying anything',async()=>{
    const w=await makeWorld({mode:'preview',profile:'full'});
    arrangeWorkflow(w.gh,'ok');w.gh.when(routes.repo).reply(200,security());w.gh.when(routes.pvr).reply(200,{enabled:true});
    const a=await call(w,'github_actions_get_settings',{repo:'hello'});
    const s=await call(w,'github_security_get_settings',{repo:'hello'});
    expect(a.workflow.default_workflow_permissions).toBe('read');
    expect(a.retention.days).toBe(30);
    expect(a.actions.sha_pinning_required).toBe(true);
    expect(s.security_and_analysis.dependabot_security_updates).toBe('enabled');
    expect(s.security_and_analysis.private_vulnerability_reporting).toBe('enabled');
    expect(w.gh.invalid).toEqual([]);
  });
  it('enables owner-directed private paid security in one call with cost disclosure, preserving other fields',async()=>{
    const w=await makeWorld({mode:'production',profile:'full',gates:[actualSpendGate()]});
    w.gh.when(routes.repo).replySequence([
      {status:200,body:security('disabled',true)},
      {status:200,body:security('enabled',true)}
    ]);
    w.gh.when(routes.pvr).reply(200,{enabled:false});
    w.gh.when(routes.repoPatch).reply(200,security('enabled',true));
    const first=await call(w,'github_security_set_feature',
      {repo:'hello',feature:'secret_scanning',enabled:true});
    expect(first).toMatchObject({status:'applied',done:true});
    expect(first.summary).toContain('COST UNKNOWN');
    expect(w.gh.calls.filter(x=>x.route===routes.repoPatch)).toHaveLength(1);
    expect(w.gh.invalid).toEqual([]);
  });
  it('refuses private paid activation under an explicitly delegated $0 limit and pass cap',async()=>{
    const w=await makeWorld({mode:'production',profile:'full',delegated:true,gates:[actualSpendGate()]});
    await w.db.setSpendLimitCents('example-org',0);
    w.gh.when(routes.repo).reply(200,security('disabled',true));
    w.gh.when(routes.pvr).reply(200,{enabled:false});
    const out=await call(w,'github_security_set_feature',
      {repo:'hello',feature:'secret_scanning',enabled:true,confirm:true});
    expect(out).toMatchObject({status:'refused_by_guard',refusedBy:'spend limit'});
    expect(w.gh.calls.filter(x=>x.route===routes.repoPatch)).toHaveLength(0);
    // RTC forbids writes on a read-only pass before touching spend. Exercise
    // the genuine spend gate in isolation with the same finite pass cap, to
    // prove unknown charges cannot sneak through even on an authorized pass.
    const pass=await makeWorld({mode:'production',profile:'full',gates:[actualSpendGate()]});
    const passCtx={...pass.ctx,connection:{...pass.ctx.connection,
      pass:true,spend_limit_cents:5000,client_id:'limited-pass'}};
    const verdict=await actualSpendGate()({
      name:'github_security_set_feature',
      args:{repo:'hello',feature:'secret_scanning',enabled:true},
      ctx:passCtx,target:{owner:'example-org'},
      classification:{spendUnknown:true,spendCents:0},
      declarations:{spend:true}});
    expect(verdict).toMatchObject({by:'pass spend allowance'});
    expect(pass.gh.calls.filter(x=>x.method!=='GET')).toHaveLength(0);
  });
  it('lets owners turn off premium security even with a selected $0 user cap',async()=>{
    const w=await makeWorld({mode:'production',profile:'full',gates:[actualSpendGate()]});
    await w.db.setSpendLimitCents('example-org',0);
    w.gh.when(routes.repo).replySequence([
      {status:200,body:security('enabled',true)},
      {status:200,body:security('disabled',true)}
    ]);
    w.gh.when(routes.pvr).reply(200,{enabled:false});
    w.gh.when(routes.repoPatch).reply(200,security('disabled',true));
    const out=await call(w,'github_security_set_feature',
      {repo:'hello',feature:'secret_scanning',enabled:false,confirm:true});
    expect(out.status).toBe('applied');
    expect(w.gh.calls.filter(x=>x.route===routes.repoPatch)).toHaveLength(1);
  });
  it('denies any changed field without complete readback baseline',async()=>{
    const w=await makeWorld({mode:'production',profile:'full'});
    arrangeWorkflow(w.gh,'ok');
    w.gh.when(routes.workflow).reply(200,{default_workflow_permissions:'read'});
    const r=await call(w,'github_actions_set_settings',{
      repo:'hello',section:'workflow',
      changes:{can_approve_pull_request_reviews:true},confirm:true});
    expect(r.done).toBe(false);
    expect(w.gh.calls.filter(x=>x.method==='PUT')).toHaveLength(0);
  });
  it('blocks retention beyond inherited organization policy',async()=>{
    const w=await makeWorld({mode:'production',profile:'full'});
    arrangeWorkflow(w.gh,'ok');
    const r=await call(w,'github_actions_set_settings',{
      repo:'hello',section:'retention',changes:{days:365},confirm:true});
    expect(r.done).toBe(false);
    expect(w.gh.calls.filter(x=>x.route===routes.retentionPut)).toHaveLength(0);
  });
  it('confirms only the changed workflow fields and writes the complete preserved object',async()=>{
    const w=await makeWorld({mode:'production',profile:'full'});
    arrangeWorkflow(w.gh,'ok');
    const r=await call(w,'github_actions_set_settings',{
      repo:'hello',section:'workflow',
      changes:{default_workflow_permissions:'write'},confirm:true});
    expect(r).toMatchObject({done:true,status:'applied'});
    const put=w.gh.calls.find(x=>x.route===routes.workflowPut);
    expect(put.body).toMatchObject({default_workflow_permissions:'write',
      can_approve_pull_request_reviews:false});
    expect(w.gh.invalid).toEqual([]);
  });
  it('reads a private repository whose fork-approval setting GitHub answers with 422',async()=>{
    const w=await makeWorld({mode:'preview',profile:'full'});
    arrangeWorkflow(w.gh,'ok');
    // Observed on real GitHub 2026-10-23: the setting exists only for public repositories.
    w.gh.when(routes.fork).reply(422,{message:'Validation Failed'});
    const a=await call(w,'github_actions_get_settings',{repo:'hello'});
    expect(a.retention.days).toBe(30);
    expect(a.fork.approval_policy).toBeNull();
    expect(a.fork.not_applicable).toMatch(/private/);
  });
  it('read policy failure never turns into invented defaults',async()=>{
    const w=await makeWorld({mode:'preview',profile:'full'});
    arrangeWorkflow(w.gh,'ok');
    w.gh.when(routes.retention).reply(403,{message:'not allowed'});
    const r=await call(w,'github_actions_get_settings',{repo:'hello'});
    expect(r.done).not.toBe(true);
  });
});

describe('H-4 private vulnerability reporting (its own GitHub endpoint)',()=>{
  const run=(w,args)=>call(w,'github_security_set_feature',{repo:'hello',feature:'private_vulnerability_reporting',...args});
  it('turns reporting on with PUT and verifies by reading it back, leaving every other feature alone',async()=>{
    const w=await makeWorld({mode:'production',profile:'full'});
    w.gh.when(routes.repo).reply(200,security());
    w.gh.when(routes.pvr).replySequence([{status:200,body:{enabled:false}},{status:200,body:{enabled:true}}]);
    w.gh.when(routes.pvrPut).reply(204,null);
    const out=await run(w,{enabled:true,confirm:true});
    expect(out).toMatchObject({status:'applied',confirmed:true,result:{feature:'private_vulnerability_reporting',enabled:true}});
    expect(w.gh.calls.filter(c=>c.method!=='GET').map(c=>c.route)).toEqual([routes.pvrPut]);
    expect(w.gh.invalid).toEqual([]);
  });
  it('turns reporting off with DELETE',async()=>{
    const w=await makeWorld({mode:'production',profile:'full'});
    w.gh.when(routes.repo).reply(200,security());
    w.gh.when(routes.pvr).replySequence([{status:200,body:{enabled:true}},{status:200,body:{enabled:false}}]);
    w.gh.when(routes.pvrDelete).reply(204,null);
    expect(await run(w,{enabled:false,confirm:true})).toMatchObject({status:'applied',confirmed:true,result:{enabled:false}});
    expect(w.gh.calls.filter(c=>c.method!=='GET').map(c=>c.route)).toEqual([routes.pvrDelete]);
  });
  it('refuses to guess when the reporting status cannot be read, and sends nothing',async()=>{
    const w=await makeWorld({mode:'production',profile:'full'});
    w.gh.when(routes.repo).reply(200,security());
    w.gh.when(routes.pvr).reply(404,{message:'Not Found'});
    const out=await run(w,{enabled:true,confirm:true});
    expect(out.done).toBe(false);
    expect(w.gh.calls.filter(c=>c.method!=='GET')).toEqual([]);
  });
  it('is not a paid feature: private repositories are not refused for cost',async()=>{
    const w=await makeWorld({mode:'production',profile:'full'});
    w.gh.when(routes.repo).reply(200,security('disabled',true));
    w.gh.when(routes.pvr).replySequence([{status:200,body:{enabled:false}},{status:200,body:{enabled:true}}]);
    w.gh.when(routes.pvrPut).reply(204,null);
    expect(await run(w,{enabled:true,confirm:true})).toMatchObject({status:'applied'});
  });
});
runWriteContract({
  label:'github_security_set_feature private vulnerability reporting',definition:pvrDefForContract(),
  args:{repo:'hello',feature:'private_vulnerability_reporting',enabled:true},
  production:true,needsConfirm:true,profile:'full',arrange(gh,result){
    gh.when(routes.repo).reply(200,security());
    gh.when(routes.pvr).replySequence([{status:200,body:{enabled:false}},{status:200,body:{enabled:result==='ok'}}]);
    gh.when(routes.pvrPut).reply(204,null);
    gh.when(routes.dependabot).reply(200,{enabled:true,paused:false});
  }});
function pvrDefForContract(){return {tool:settings.securitySetFeature.tool,handler:settings.securitySetFeature.handler};}



describe('H-4 source-backed provider security switches and separated Dependabot contract',()=>{
  const feature=(w,featureName,enabled,extra={})=>
    call(w,'github_security_set_feature',{repo:'hello',feature:featureName,enabled,...extra});
  it('reads GitHub supported extra security flags and verified Dependabot paused status',async()=>{
    const w=await makeWorld({mode:'preview',profile:'full'});
    w.gh.when(routes.repo).reply(200,security());
    w.gh.when(routes.pvr).reply(200,{enabled:false});
    w.gh.when(routes.dependabot).reply(200,{enabled:true,paused:true});
    const r=await call(w,'github_security_get_settings',{repo:'hello'});
    expect(r.security_and_analysis.secret_scanning_ai_detection).toBe('disabled');
    expect(r.security_and_analysis.secret_scanning_non_provider_patterns).toBe('disabled');
    expect(r.security_and_analysis.secret_scanning_delegated_alert_dismissal).toBe('disabled');
    expect(r.security_and_analysis.secret_scanning_delegated_bypass).toBe('disabled');
    expect(r.security_and_analysis.dependabot_security_updates).toBe('enabled');
    expect(r.dependabot_security_updates_paused).toBe(true);
    expect(w.gh.calls.some(x=>x.route===routes.dependabot)).toBe(true);
    expect(w.gh.invalid).toEqual([]);
  });
  it('does not inherit obsolete repo-body Dependabot status when the dedicated GET says disabled',async()=>{
    const w=await makeWorld({mode:'preview',profile:'full'});
    w.gh.when(routes.repo).reply(200,{...security(),
      security_and_analysis:{...security().security_and_analysis,
        dependabot_security_updates:{status:'enabled'}}});
    w.gh.when(routes.dependabot).reply(404,{message:'Not Found'});
    w.gh.when(routes.pvr).reply(200,{enabled:false});
    const r=await call(w,'github_security_get_settings',{repo:'hello'});
    expect(r.security_and_analysis.dependabot_security_updates).toBe('disabled');
    expect(r.dependabot_security_updates_paused).toBe(false);
  });
  it('enables Dependabot security fixes using its real PUT, with independent exact GET readback',async()=>{
    const w=await makeWorld({mode:'production',profile:'full'});
    w.gh.when(routes.repo).reply(200,security());
    w.gh.when(routes.pvr).reply(200,{enabled:false});
    w.gh.when(routes.dependabot).replySequence([
      {status:404,body:{message:'Not Found'}},
      {status:200,body:{enabled:true,paused:false}}
    ]);
    w.gh.when(routes.dependabotPut).reply(204,null);
    const result=await feature(w,'dependabot_security_updates',true,{confirm:true});
    expect(result).toMatchObject({status:'applied',done:true,
      result:{feature:'dependabot_security_updates',enabled:true}});
    expect(w.gh.calls.filter(x=>x.method!=='GET').map(x=>x.route))
      .toEqual([routes.dependabotPut]);
    expect(w.gh.invalid).toEqual([]);
  });
  it('disables Dependabot security fixes using real DELETE and absence readback',async()=>{
    const w=await makeWorld({mode:'production',profile:'full'});
    w.gh.when(routes.repo).reply(200,security());
    w.gh.when(routes.pvr).reply(200,{enabled:false});
    w.gh.when(routes.dependabot).replySequence([
      {status:200,body:{enabled:true,paused:false}},
      {status:404,body:{message:'Not Found'}}
    ]);
    w.gh.when(routes.dependabotDelete).reply(204,null);
    const r=await feature(w,'dependabot_security_updates',false,{confirm:true});
    expect(r).toMatchObject({status:'applied',done:true,result:{enabled:false}});
    expect(w.gh.calls.filter(x=>x.method!=='GET').map(x=>x.route))
      .toEqual([routes.dependabotDelete]);
    expect(w.gh.invalid).toEqual([]);
  });
  it('refuses Dependabot toggle when GitHub permissions make the state unknown',async()=>{
    const w=await makeWorld({mode:'production',profile:'full'});
    w.gh.when(routes.repo).reply(200,security());
    w.gh.when(routes.pvr).reply(200,{enabled:false});
    w.gh.when(routes.dependabot).reply(403,{message:'Forbidden'});
    const r=await feature(w,'dependabot_security_updates',true,{confirm:true});
    expect(r.done).toBe(false);
    expect(w.gh.calls.filter(x=>x.method!=='GET')).toEqual([]);
  });
  for(const name of ['secret_scanning_ai_detection','secret_scanning_non_provider_patterns',
    'secret_scanning_delegated_alert_dismissal','secret_scanning_delegated_bypass']){
    it('performs exact guarded '+name+' enable and verifies all other settings unchanged',async()=>{
      const w=await makeWorld({mode:'production',profile:'full',
        gates:[actualSpendGate()]});
      w.gh.when(routes.repo).replySequence([
        {status:200,body:security('disabled',true)},
        {status:200,body:security('disabled',true,{[name]:'enabled'})}
      ]);
      w.gh.when(routes.pvr).reply(200,{enabled:false});
      w.gh.when(routes.repoPatch).reply(200,security('disabled',true,{[name]:'enabled'}));
      const preview=await feature(w,name,true,{dryRun:true});
      expect(preview.status).toBe('preview');
      expect(preview.preview).toContain('COST UNKNOWN');
      if(['secret_scanning_delegated_bypass','secret_scanning_delegated_alert_dismissal'].includes(name))
        expect(preview.preview).toContain('ACCESS CHANGE');
      expect(w.gh.calls.filter(x=>x.method!=='GET')).toEqual([]);
      const done=await feature(w,name,true,{confirm:true});
      expect(done).toMatchObject({status:'applied',done:true,result:{feature:name,enabled:true}});
      const writes=w.gh.calls.filter(x=>x.method!=='GET');
      expect(writes).toHaveLength(1);
      expect(writes[0].route).toBe(routes.repoPatch);
      expect(writes[0].body.security_and_analysis)
        .toEqual({[name]:{status:'enabled'}});
      expect(w.gh.invalid).toEqual([]);
    });
  }
  it('respects an explicitly delegated zero spend cap on new private security features',async()=>{
    const w=await makeWorld({mode:'production',profile:'full',delegated:true,gates:[actualSpendGate()]});
    await w.db.setSpendLimitCents('example-org',0);
    w.gh.when(routes.repo).reply(200,security('disabled',true));
    w.gh.when(routes.pvr).reply(200,{enabled:false});
    const denied=await feature(w,'secret_scanning_ai_detection',true,{confirm:true});
    expect(denied).toMatchObject({status:'refused_by_guard',refusedBy:'spend limit'});
    expect(w.gh.calls.filter(x=>x.method!=='GET')).toHaveLength(0);
  });
  it('does not invent status or invoke a write for unavailable future feature fields',async()=>{
    const w=await makeWorld({mode:'production',profile:'full'});
    w.gh.when(routes.repo).reply(200,{...security(),
      security_and_analysis:{secret_scanning:{status:'enabled'}}});
    w.gh.when(routes.pvr).reply(200,{enabled:false});
    const r=await feature(w,'secret_scanning_ai_detection',true,{confirm:true});
    expect(r.done).toBe(false);
    expect(w.gh.calls.filter(x=>x.method!=='GET')).toHaveLength(0);
  });
});
