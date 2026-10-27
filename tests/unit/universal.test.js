import {describe,it,expect} from 'vitest';
import {createDispatch} from '../../src/tools/dispatch.js';
import {registry} from '../../src/tools/index.js';
import {restOperations,restOperation,validateRest} from '../../src/github/openapi-index.js';
import {classifyUniversal,assertUniversalAuthority,universalPrice} from '../../src/github/operation-classes.js';
import {curatedTool,handBuiltTargets} from '../../src/github/hand-built-map.js';
import * as u from '../../src/tools/universal.js';
import {makeWorld,parse,runWriteContract} from '../../test/helpers/write-contract.js';
import {spendGate} from '../../src/tools/spend-guard.js';

const api=(operation,params={},body)=>({operation,params,...(body?{body}:{})});
const route='PUT /repos/{owner}/{repo}/interaction-limits';
const scope={owner:'example-org',repo:'hello'};
const payload={limit:'collaborators_only',expiry:'one_day'};
async function dispatch(world,name,args) {
  return createDispatch({credentials:world.credentials,fetch:world.gh.fetch,gates:world.ctx.gates,
    now:world.ctx.now,sleep:world.ctx.sleep})
    .call(null,{registry,name,args,connection:world.connection,db:world.db});
}
function setRead(world,route,body) { world.gh.when(route).reply(200,body); }
const noChange=(gh)=>gh.calls.every(c=>['GET','HEAD'].includes(c.method));

describe('U-1 pinned operation index and read boundary',()=>{
  it('indexes the 1232 official operations without changing the compact registry',()=>{
    const ops=restOperations();
    expect(ops).toHaveLength(1232);
    expect(ops.every(x=>x.category&&x.operationId)).toBe(true);
    expect(u.tools.map(x=>x.name)).toEqual(['github_api_search','github_api_describe','github_api_read','github_api_write']);
    for(const t of u.tools)expect(registry.tools.find(x=>x.name===t.name)).toBeTruthy();
    expect(u.tools[3].writeContract).toBe('defineWrite-v1');
    expect(u.tools[3].profiles).toEqual(['full']);
  });
  it('describes exact route, body and safety; searches safely without a provider credential',async()=>{
    const w=await makeWorld({profile:'read_only'});
    const search=parse(await dispatch(w,'github_api_search',{query:'interaction limit',max:20}));
    expect(search.count).toBeGreaterThan(0);
    const desc=parse(await dispatch(w,'github_api_describe',{operation:route}));
    expect(desc.safety.production).toBe(true);
    expect(desc.method).toBe('PUT');
    expect(desc.parameters).toEqual(expect.any(Array));
    expect(w.gh.calls).toEqual([]);
  });
  it('rejects unknown operation and misspelled path/query and JSON fields before a provider call',()=>{
    expect(()=>restOperation('GET /absolutely/not/real')).toThrow(/not available/);
    const op=restOperation('POST /repos/{owner}/{repo}/issues');
    expect(()=>validateRest(op,{...scope,foo:'bar'},{title:'test'})).toThrow(/Unknown path/);
    expect(()=>validateRest(op,scope,{title:'test',not_a_real_field:true})).toThrow(/Unknown JSON body/);
    expect(()=>validateRest(op,scope,{})).toThrow(/Pinned GitHub/);
  });
  it('rejects bypass, credential-looking values, secrets, enterprise and curated merge',async()=>{
    const merge=restOperation('PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge');
    expect(curatedTool(merge)).toBe('github_pr_merge');
    expect(()=>assertUniversalAuthority(merge,{...scope,bypass_rules:true},{})).toThrow(/Rule bypass/);
    expect(()=>assertUniversalAuthority(merge,scope,{key:'github_pat_ABC012345678901234567890'})).toThrow(/Credential/);
    const w=await makeWorld({mode:'production',profile:'full'});
    const refused=parse(await dispatch(w,'github_api_write',api(merge.route,{...scope,pull_number:7},{})));
    expect(refused.status).toBe('refused');
    expect(w.gh.calls).toEqual([]);
    expect(universalPrice({method:'POST',path:'/orgs/{org}/copilot/billing/selected_users',summary:'Buy Copilot seats'})).toBeNull();
    expect(classifyUniversal({method:'POST',path:'/orgs/{org}/mystery',summary:'Unknown'}).accessWidening).toBe(true);
  });
  it('enforces connected scope and explicitly U credential for /user endpoints',async()=>{
    const w=await makeWorld({profile:'read_only'});
    const foreign=await dispatch(w,'github_api_read',api('GET /repos/{owner}/{repo}',{owner:'outsider',repo:'hello'}));
    expect(foreign.isError).toBe(true);
    expect(w.gh.calls).toEqual([]);
    const personal=await dispatch(w,'github_api_read',api('GET /user',{}));
    expect(personal.isError).toBe(true);
    expect(w.gh.calls).toEqual([]);
  });
  it('uses pinned client, ordinary dispatcher shaping and safe per-connection pagination',async()=>{
    const w=await makeWorld({profile:'read_only'});
    setRead(w,'GET /repos/{owner}/{repo}',{full_name:'example-org/hello',description:'a repo'});
    const result=await dispatch(w,'github_api_read',api('GET /repos/{owner}/{repo}',scope));
    expect(result.isError).not.toBe(true);
    expect(parse(result).data.full_name).toBe('example-org/hello');
    expect(w.gh.calls[0].route).toBe('GET /repos/{owner}/{repo}');
    expect(w.gh.invalid).toEqual([]);
  });
});

runWriteContract({
  label:'universal interaction-limit write',definition:{tool:u.tools[3],handler:u.handlers.github_api_write},
  args:api(route,scope,payload),profile:'full',production:true,needsConfirm:true,accessWidening:true,
  arrange(gh,result){
    gh.when('GET /repos/{owner}/{repo}/interaction-limits').replySequence([
      {status:200,body:{limit:'existing',expiry:'one_day'}},
      {status:200,body:{limit:result==='ok'?'collaborators_only':'existing',expiry:'one_day'}}
    ]);
    gh.when(route).reply(200,{limit:'collaborators_only',expiry:'one_day'});
  }
});

describe('U-1 a create is confirmed from its collection',()=>{
  const list='/orgs/{org}/actions/runner-groups';
  const run=async(listed)=>{
    const w=await makeWorld({profile:'full',mode:'production'});
    w.gh.when('GET '+list).replySequence([
      {status:200,body:{total_count:0,runner_groups:[]}},
      {status:200,body:{total_count:listed.length,runner_groups:listed}}]);
    w.gh.when('POST '+list).reply(201,{id:4,name:'g',visibility:'selected'});
    return parse(await dispatch(w,'github_api_write',{...api('POST '+list,{org:'example-org'},
      {name:'g',visibility:'selected'}),confirm:true}));
  };
  it('confirms when the created group is in the re-read list (seen live 2026-10-23)',async()=>{
    expect(await run([{id:1,name:'Default',visibility:'all'},{id:4,name:'g',visibility:'selected'}]))
      .toMatchObject({done:true,status:'applied'});
  });
  it('does not confirm when a different group with the same fields is listed',async()=>{
    expect(await run([{id:9,name:'g',visibility:'selected'}])).toMatchObject({done:false});
  });
});
describe('U-1 a delete is confirmed by absence',()=>{
  const one='/orgs/{org}/actions/runner-groups/{runner_group_id}';
  const run=async(afterStatus)=>{
    const w=await makeWorld({profile:'full',mode:'production'});
    w.gh.when('GET '+one).replySequence([{status:200,body:{id:4,name:'g'}},
      afterStatus===404?{status:404,body:{message:'Not Found'}}:{status:200,body:{id:4,name:'g'}}]);
    w.gh.when('DELETE '+one).reply(204,null);
    return parse(await dispatch(w,'github_api_write',{...api('DELETE '+one,{org:'example-org',runner_group_id:4}),confirm:true}));
  };
  it('confirms when the object can no longer be read (seen live 2026-10-23)',async()=>{
    expect(await run(404)).toMatchObject({done:true,status:'applied'});
  });
  it('does not confirm when the object is still readable',async()=>{
    expect(await run(200)).toMatchObject({done:false});
  });
});
describe('U-1 a delete of a single setting is confirmed when it reads back empty',()=>{
  const one='/orgs/{org}/interaction-limits';
  const run=async(beforeBody)=>{
    const w=await makeWorld({profile:'full',mode:'production'});
    w.gh.when('GET '+one).replySequence([{status:200,body:beforeBody},{status:200,body:{}}]);
    w.gh.when('DELETE '+one).reply(204,null);
    return parse(await dispatch(w,'github_api_write',{...api('DELETE '+one,{org:'example-org'}),confirm:true}));
  };
  it('confirms when a configured limit now reads back as an empty object (seen live 2026-10-23)',async()=>{
    expect(await run({limit:'existing_users',origin:'organization',expires_at:'2026-10-24T17:40:40Z'}))
      .toMatchObject({done:true,status:'applied'});
  });
  it('does not claim a removal when nothing was configured before',async()=>{
    expect(await run({})).toMatchObject({done:false});
  });
});
describe('U-1 refusal and effect uncertainty',()=>{
  it('does not write on preview or when confirmation is absent',async()=>{
    const w=await makeWorld({profile:'full',mode:'preview'});
    setRead(w,'GET /repos/{owner}/{repo}/interaction-limits',{limit:'existing',expiry:'one_day'});
    const r=parse(await dispatch(w,'github_api_write',api(route,scope,payload)));
    expect(['refused_by_guard','needs_confirmation']).toContain(r.status);
    expect(noChange(w.gh)).toBe(true);
  });
  it('rejected exact-baseline reads do not create an authorization bypass',async()=>{
    const w=await makeWorld({profile:'full',mode:'production'});
    w.gh.when('GET /repos/{owner}/{repo}/interaction-limits').reply(403,{message:'Forbidden'});
    const r=parse(await dispatch(w,'github_api_write',{...api(route,scope,payload),confirm:true}));
    expect(r.status).not.toBe('applied');
    expect(noChange(w.gh)).toBe(true);
  });
  it('same-key retries do not resend after uncertain provider result',async()=>{
    const w=await makeWorld({profile:'full',mode:'production',advanceClockOnSleep:true});
    setRead(w,'GET /repos/{owner}/{repo}/interaction-limits',{limit:'existing',expiry:'one_day'});
    w.gh.when(route).reply(502,{message:'Temporarily unavailable'});
    const a=api(route,scope,payload);
    const r=parse(await dispatch(w,'github_api_write',{...a,confirm:true}));
    expect(r.status).not.toBe('applied');
    const second=parse(await dispatch(w,'github_api_write',{...a,confirm:true}));
    expect(second.status).toBe('replayed');
    expect(w.gh.calls.filter(c=>c.method==='PUT')).toHaveLength(1);
  });
});

describe('U-1 actual user authority and uncertain-cost boundary',()=>{
  it('unselected developer budget does not impose a product-spend cap on an unknown-cost operation',async()=>{
    const w=await makeWorld({profile:'full',mode:'production',gates:[spendGate()]});
    setRead(w,'GET /repos/{owner}/{repo}/interaction-limits',{limit:'existing',expiry:'one_day'});
    const out=parse(await dispatch(w,'github_api_write',api(route,scope,payload)));
    expect(out.status).toBe('needs_confirmation');
    expect(out.needsConfirmation).toBe(true);
    expect(noChange(w.gh)).toBe(true);
  });
  it('does not misclassify an unknown non-curated write as free by its innocent name',()=>{
    expect(universalPrice(restOperation(route))).toBeNull();
    const exactFree=restOperation('PUT /orgs/{org}/actions/oidc/customization/sub');
    expect(universalPrice(exactFree)).toBe(0);
    expect(classifyUniversal(exactFree).spendRisk).toBe(false);
    expect(classifyUniversal(restOperation(route)).spendRisk).toBe(true);
  });
  it('allows an exactly reviewed-free provider DELETE at a user-selected $0 limit but never fabricates readback confirmation',async()=>{
    const free='DELETE /repos/{owner}/{repo}/actions/runners/{runner_id}/labels';
    expect(universalPrice(restOperation(free))).toBe(0);
    const w=await makeWorld({profile:'full',mode:'production',gates:[spendGate()]});
    await w.db.setSpendLimitCents('example-org',0);
    w.gh.when('GET /repos/{owner}/{repo}').reply(200,
      {full_name:'example-org/hello',default_branch:'main'});
    w.gh.when('GET /repos/{owner}/{repo}/actions/runners/{runner_id}/labels')
      .reply(200,[]);
    w.gh.when(free).reply(204,null);
    const args=api(free,{...scope,runner_id:7});
    const out=parse(await dispatch(w,'github_api_write',{...args,confirm:true}));
    expect(['applied','unconfirmed']).toContain(out.status);
    expect(w.gh.calls.filter(x=>x.method==='DELETE')).toHaveLength(1);
    expect(w.gh.invalid).toEqual([]);
    const again=parse(await dispatch(w,'github_api_write',{...args,confirm:true}));
    expect(again).toMatchObject({status:'replayed',replayed:true});
    expect(w.gh.calls.filter(x=>x.method==='DELETE')).toHaveLength(1);
  });
  it('refuses unknown future charges under an explicit selected $0 product budget before any PUT',async()=>{
    const w=await makeWorld({profile:'full',mode:'production',gates:[spendGate()]});
    await w.db.setSpendLimitCents('example-org',0);
    setRead(w,'GET /repos/{owner}/{repo}/interaction-limits',
      {limit:'existing',expiry:'one_day'});
    const out=parse(await dispatch(w,'github_api_write',{...api(route,scope,payload),confirm:true}));
    expect(out).toMatchObject({status:'refused_by_guard',refusedBy:'spend limit'});
    expect(noChange(w.gh)).toBe(true);
  });
  it('refuses unknown future charges under a selected positive cap while keeping full confirmation for uncapped users',async()=>{
    const w=await makeWorld({profile:'full',mode:'production',gates:[spendGate()]});
    await w.db.setSpendLimitCents('example-org',50000);
    setRead(w,'GET /repos/{owner}/{repo}/interaction-limits',
      {limit:'existing',expiry:'one_day'});
    const out=parse(await dispatch(w,'github_api_write',{...api(route,scope,payload),confirm:true}));
    expect(out).toMatchObject({status:'refused_by_guard',refusedBy:'spend limit'});
    expect(noChange(w.gh)).toBe(true);
    const uncapped=await makeWorld({profile:'full',mode:'production',gates:[spendGate()]});
    setRead(uncapped,'GET /repos/{owner}/{repo}/interaction-limits',
      {limit:'existing',expiry:'one_day'});
    const ready=parse(await dispatch(uncapped,'github_api_write',api(route,scope,payload)));
    expect(ready).toMatchObject({status:'needs_confirmation',needsConfirmation:true});
    expect(ready.preview).toContain('COST UNKNOWN');
    expect(noChange(uncapped.gh)).toBe(true);
  });
  it('enforces unknown-cost RTC pass allowance independently of the pass write-permission layer',async()=>{
    const w=await makeWorld({profile:'full',mode:'production',gates:[spendGate()]});
    const ctx={...w.ctx,connection:{...w.ctx.connection,
      pass:true,spend_limit_cents:12000,client_id:'finite-universal-pass'}};
    const verdict=await spendGate()({name:'github_api_write',args:api(route,scope,payload),
      ctx,target:{owner:'example-org',repo:'hello'},
      classification:{spendUnknown:true,spendCents:0},declarations:{spend:true}});
    expect(verdict).toMatchObject({by:'pass spend allowance'});
    expect(noChange(w.gh)).toBe(true);
  });
});

describe('U-1/O-4/Y-7 exact curated provider-operation authority',()=>{
  const exactCases=[
    ['POST /organizations/{org}/settings/billing/budgets','github_billing_save_budget'],
    ['PATCH /organizations/{org}/settings/billing/budgets/{budget_id}','github_billing_save_budget'],
    ['DELETE /organizations/{org}/settings/billing/budgets/{budget_id}','github_billing_delete_budget'],
    ['PUT /orgs/{org}/codespaces/access','github_codespace_set_org_access'],
    ['POST /repos/{owner}/{repo}/codespaces','github_codespace_create'],
    ['POST /user/codespaces/{codespace_name}/start','github_codespace_set_state'],
    ['POST /user/codespaces/{codespace_name}/stop','github_codespace_set_state'],
    ['DELETE /user/codespaces/{codespace_name}','github_codespace_delete'],
    ['POST /orgs/{org}/copilot/billing/selected_users','github_copilot_add_seats'],
    ['DELETE /orgs/{org}/copilot/billing/selected_users','github_copilot_remove_seats'],
    ['POST /orgs/{org}/copilot/billing/selected_teams','github_copilot_team_seats'],
    ['DELETE /orgs/{org}/copilot/billing/selected_teams','github_copilot_team_seats_remove'],
    ['PUT /orgs/{org}/copilot/coding-agent/permissions','github_copilot_agent_policy_set'],
    ['PUT /orgs/{org}/copilot/content_exclusion','github_copilot_content_exclusions_set'],
    ['PUT /orgs/{org}/copilot/coding-agent/permissions/repositories/{repository_id}','github_copilot_agent_repo_set'],
    ['DELETE /orgs/{org}/copilot/coding-agent/permissions/repositories/{repository_id}','github_copilot_agent_repo_set'],
    ['POST /orgs/{org}/actions/hosted-runners','github_hosted_runner_create'],
    ['PATCH /orgs/{org}/actions/hosted-runners/{hosted_runner_id}','github_hosted_runner_manage'],
    ['DELETE /orgs/{org}/actions/hosted-runners/{hosted_runner_id}','github_hosted_runner_manage'],
    ['POST /orgs/{org}/code-security/configurations','github_security_config_save'],
    ['PATCH /orgs/{org}/code-security/configurations/{configuration_id}','github_security_config_save'],
    ['DELETE /orgs/{org}/code-security/configurations/{configuration_id}','github_security_config_delete'],
    ['POST /orgs/{org}/code-security/configurations/{configuration_id}/attach','github_security_config_attach'],
    ['PUT /orgs/{org}/code-security/configurations/{configuration_id}/defaults','github_security_config_default'],
    ['DELETE /orgs/{org}/code-security/configurations/detach','github_security_config_detach'],
    ['PATCH /repos/{owner}/{repo}/code-scanning/default-setup','github_security_code_scanning_default_setup'],
    ['PUT /repos/{owner}/{repo}/private-vulnerability-reporting','github_security_set_feature'],
    ['DELETE /repos/{owner}/{repo}/private-vulnerability-reporting','github_security_set_feature'],
    ['POST /orgs/{org}/secret-scanning/custom-patterns','github_security_secret_pattern_save'],
    ['POST /repos/{owner}/{repo}/secret-scanning/custom-patterns','github_security_secret_pattern_save'],
    ['PATCH /orgs/{org}/secret-scanning/custom-patterns/{pattern_id}','github_security_secret_pattern_save'],
    ['PATCH /repos/{owner}/{repo}/secret-scanning/custom-patterns/{pattern_id}','github_security_secret_pattern_save'],
    ['DELETE /orgs/{org}/secret-scanning/custom-patterns','github_security_secret_pattern_save'],
    ['DELETE /repos/{owner}/{repo}/secret-scanning/custom-patterns','github_security_secret_pattern_save'],
    ['PATCH /orgs/{org}/dependabot/repository-access','github_security_dependabot_org_settings'],
    ['PUT /orgs/{org}/dependabot/repository-access/default-level','github_security_dependabot_org_settings']
  ];
  it('names exactly the matching method and actual specialized provider writer, not a neighboring financial operation',()=>{
    for(const [route,tool] of exactCases){
      expect(curatedTool({route})).toBe(tool);
      expect(registry.tools.some(t=>t.name===tool)).toBe(true);
      expect(handBuiltTargets()).toContain(tool);
    }
    // The originally observed regression: budget DELETE must never tell the
    // user to save a budget, and removing seats must never tell them to buy.
    expect(curatedTool(restOperation('billing/delete-budget-org'))).toBe('github_billing_delete_budget');
    expect(curatedTool(restOperation('DELETE /orgs/{org}/copilot/billing/selected_users')))
      .toBe('github_copilot_remove_seats');
  });
  it('does not turn a family prefix, read or unrelated method into a curated refusal',()=>{
    for(const route of [
      'GET /organizations/{org}/settings/billing/budgets',
      'GET /orgs/{org}/codespaces/access',
      'GET /repos/{owner}/{repo}/codespaces',
      'GET /orgs/{org}/code-security/configurations',
      'GET /orgs/{org}/copilot/billing/selected_users',
      'GET /orgs/{org}/actions/hosted-runners',
      'POST /orgs/{org}/codespaces/access',
      'DELETE /orgs/{org}/code-security/configurations',
      'PATCH /organizations/{org}/settings/billing/budgets/not-a-path-template'
    ])expect(curatedTool({route})).toBeNull();
  });
  it('rejects real pinned curated budget deletion at the universal boundary without a provider mutation',async()=>{
    const w=await makeWorld({profile:'full',mode:'production'});
    const op=restOperation('billing/delete-budget-org');
    const out=parse(await dispatch(w,'github_api_write',api(op.operationId,{
      org:'example-org',budget_id:'95cd1c15-3504-4673-bd17-53e4be6a52e7'})));
    expect(out.status).toBe('refused');
    expect(out.error).toContain('github_billing_delete_budget');
    expect(w.gh.calls).toEqual([]);
  });
  it('all declared curated routes on the pinned inventory route only to actual catalog tools',()=>{
    for(const op of restOperations()){
      const target=curatedTool(op);
      if(target)expect(registry.tools.some(t=>t.name===target)).toBe(true);
    }
  });
});

describe('universal package credential selection', () => {
  it('requires explicit P, verifies the outbound package token and rejects non-package P', async () => {
    const w = await makeWorld({ packageToken: true, profile: 'read_only' });
    const operation = 'GET /orgs/{org}/packages';
    w.gh.when(operation).reply(200, []);
    const args = { operation, params: { org: 'example-org', package_type: 'container' } };
    expect((await dispatch(w, 'github_api_read', args)).isError).toBe(true);
    expect(w.gh.calls).toEqual([]);
    const out = await dispatch(w, 'github_api_read', { ...args, cred: 'P' });
    expect(out.isError).toBeUndefined();
    expect(w.gh.calls).toHaveLength(1);
    expect(w.gh.calls[0].headers.authorization).toBe('token fixture-package-token-value-only');
    expect(w.gh.invalid).toEqual([]);
    const bad = await dispatch(w, 'github_api_read', { operation: 'GET /repos/{owner}/{repo}', params: scope, cred: 'P' });
    expect(bad.isError).toBe(true);
    expect(w.gh.calls).toHaveLength(1);
  });
});

describe('private personal package routing keeps curated mutation boundaries',()=>{
  it('reads authenticated personal private metadata with P and routes every package mutation through the specialized guard',async()=>{
    const w=await makeWorld({packageToken:true,packageUser:true,profile:'full'});
    w.gh.when('GET /user/packages').reply(200,[{id:1,name:'private-image',visibility:'private'}]);
    const read=await dispatch(w,'github_api_read',{operation:'GET /user/packages',params:{package_type:'container'},cred:'P'});
    expect(read.isError).toBeUndefined();expect(read.structuredContent.data[0].visibility).toBe('private');
    expect(w.gh.calls[0].headers.authorization).toBe('token fixture-package-token-value-only');
    for(const base of ['/user','/users/{username}','/orgs/{org}']){
      for(const[method,suffix,tool]of [
        ['DELETE','','github_package_delete'],['DELETE','/versions/{package_version_id}','github_package_delete_version'],
        ['POST','/restore','github_package_restore_version'],['POST','/versions/{package_version_id}/restore','github_package_restore_version']
      ]){
        const operation=method+' '+base+'/packages/{package_type}/{package_name}'+suffix;
        const params={package_type:'container',package_name:'private-image',...(suffix.includes('package_version_id')?{package_version_id:12}:{}),
          ...(base.includes('{username}')?{username:'example-org'}:base.includes('{org}')?{org:'example-org'}:{})};
        const result=await dispatch(w,'github_api_write',{operation,params,cred:'P',dryRun:true});
        expect(result.isError).toBe(true);expect(parse(result).error).toContain(tool);
      }
    }
    expect(w.gh.calls).toHaveLength(1);expect(w.gh.invalid).toEqual([]);
  });
});


describe('PAR-4 existing enterprise specialist operations stay behind exact stronger guards',()=>{
  const curated=[
    ['POST /enterprises/{enterprise}/code-security/configurations','github_enterprise_security_config_save'],
    ['PATCH /enterprises/{enterprise}/code-security/configurations/{configuration_id}','github_enterprise_security_config_save'],
    ['DELETE /enterprises/{enterprise}/code-security/configurations/{configuration_id}','github_enterprise_security_config_delete'],
    ['POST /enterprises/{enterprise}/code-security/configurations/{configuration_id}/attach','github_enterprise_security_config_apply'],
    ['PUT /enterprises/{enterprise}/code-security/configurations/{configuration_id}/defaults','github_enterprise_security_config_apply'],
    ['PUT /enterprises/{enterprise}/dependabot/repository-access/default-level','github_enterprise_dependabot_access_set'],
    ['PATCH /enterprises/{enterprise}/dependabot/repository-access','github_enterprise_dependabot_access_set'],
    ['PUT /enterprises/{enterprise}/actions/cache/retention-limit','github_enterprise_actions_settings_set'],
    ['PUT /enterprises/{enterprise}/actions/cache/storage-limit','github_enterprise_actions_settings_set'],
    ['POST /enterprises/{enterprise}/actions/oidc/customization/properties/repo','github_enterprise_actions_settings_set'],
    ['DELETE /enterprises/{enterprise}/actions/oidc/customization/properties/repo/{custom_property_name}','github_enterprise_actions_settings_set']
  ];
  it('routes every guarded enterprise write to its exact specialist, not a universal alternate',()=>{
    for(const [operation,tool] of curated) {
      expect(curatedTool({route:operation})).toBe(tool);
      expect(registry.tools.some(t=>t.name===tool)).toBe(true);
    }
    expect(curatedTool({route:'PUT /enterprises/{enterprise}/copilot/policies/coding_agent'})).toBeNull();
  });
  it('cannot bypass protected-repository checks by universally attaching security config to all repositories',async()=>{
    const w=await makeWorld({mode:'production',profile:'full'});
    const args={operation:'POST /enterprises/{enterprise}/code-security/configurations/{configuration_id}/attach',
      params:{enterprise:'sample-enterprise',configuration_id:7},body:{scope:'all'},cred:'M',confirm:true};
    const out=parse(await dispatch(w,'github_api_write',args));
    expect(out.status).toBe('refused');
    expect(out.error).toContain('github_enterprise_security_config_apply');
    expect(w.gh.calls).toEqual([]);
  });
});

describe('PAR-4 verified enterprise authority in universal REST',()=>{
  const policy='PUT /enterprises/{enterprise}/copilot/policies/coding_agent';
  const slug='sample-enterprise';
  const args={operation:policy,params:{enterprise:slug},body:{policy_state:'enabled_for_selected_orgs'},cred:'M'};
  function setMaster(w,{scopes=['admin:enterprise','read:enterprise'],admin=true}={}){
    const original=w.credentials;
    const credentials={...original,
      masterStatus:async()=>({enrolled:true,scopes}),
      token:async (p)=>p.cred==='M'?'fixture-master-token-value-only':original.token(p)};
    w.credentials=credentials;
    w.ctx={...w.ctx,credentials};
    w.gh.when('POST /graphql').reply(200,{data:{viewer:{enterprises:{nodes:admin?[{slug,name:'Example enterprise'}]:[]}}}});
    w.gh.when(policy).reply(204,null);
    return w;
  }
  it('does not invent an enterprise-wide veto while preserving the pinned route and master-only choice',async()=>{
    const op=restOperation(policy);
    expect(()=>assertUniversalAuthority(op,{enterprise:slug},{policy_state:'enabled_for_selected_orgs'})).not.toThrow();
    const w=await makeWorld({mode:'production',profile:'full'});
    const refused=parse(await dispatch(w,'github_api_write',{...args,cred:'I',confirm:true}));
    expect(refused.status).toBe('refused');
    expect(w.gh.calls).toEqual([]);
    const foreign=parse(await dispatch(w,'github_api_write',{...args,owner:'foreign-org',confirm:true}));
    expect(foreign.status).toBe('refused');
    expect(w.gh.calls).toEqual([]);
  });
  it('requires a real admin grant before the provider policy mutation',async()=>{
    const w=setMaster(await makeWorld({mode:'production',profile:'full'}),{admin:false});
    const out=parse(await dispatch(w,'github_api_write',{...args,confirm:true}));
    expect(out.status).not.toBe('applied');
    expect(w.gh.calls.some(c=>c.route===policy)).toBe(false);
    const narrow=setMaster(await makeWorld({mode:'production',profile:'full'}),{scopes:['read:enterprise']});
    const denied=parse(await dispatch(narrow,'github_api_write',{...args,confirm:true}));
    expect(denied.status).not.toBe('applied');
    expect(narrow.gh.calls.some(c=>c.route===policy)).toBe(false);
  });
  it('requires preview, confirmation, no-repeat journal, and honest unconfirmed 204 without GET readback',async()=>{
    const w=setMaster(await makeWorld({mode:'production',profile:'full',advanceClockOnSleep:true}));
    const preview=parse(await dispatch(w,'github_api_write',{...args,dryRun:true}));
    expect(preview.status).toBe('preview');
    expect(w.gh.calls.some(c=>c.route===policy)).toBe(false);
    const asked=parse(await dispatch(w,'github_api_write',args));
    expect(asked.status).toBe('needs_confirmation');
    const applied=parse(await dispatch(w,'github_api_write',{...args,confirm:true}));
    expect(applied).toMatchObject({status:'unconfirmed',confirmed:false});
    expect(w.gh.calls.filter(c=>c.route===policy)).toHaveLength(1);
    expect(w.gh.invalid).toEqual([]);
    const retried=parse(await dispatch(w,'github_api_write',{...args,confirm:true}));
    expect(retried.status).toBe('replayed');
    expect(w.gh.calls.filter(c=>c.route===policy)).toHaveLength(1);
  });
  it('reads a pinned enterprise REST setting only after proof of current admin status and read scope',async()=>{
    const route='GET /enterprises/{enterprise}/actions/cache/storage-limit';
    const w=setMaster(await makeWorld({mode:'production',profile:'full'}),{scopes:['read:enterprise']});
    w.gh.when(route).reply(200,{max_cache_size_gb:50});
    const out=await dispatch(w,'github_api_read',{operation:route,params:{enterprise:slug},cred:'M'});
    expect(out.isError).not.toBe(true);
    expect(parse(out)).toMatchObject({status:200,data:{max_cache_size_gb:50}});
    expect(w.gh.calls.filter(c=>c.route===route)).toHaveLength(1);
    expect(w.gh.calls.filter(c=>c.route==='POST /graphql')).toHaveLength(1);
    expect(w.gh.invalid).toEqual([]);
  });
  it('refuses the master token on read-only connections and delegated passes',async()=>{
    const readOnly=setMaster(await makeWorld({mode:'preview',profile:'read_only'}));
    const result=await dispatch(readOnly,'github_api_read',{operation:'GET /enterprises/{enterprise}/actions/cache/storage-limit',params:{enterprise:slug},cred:'M'});
    expect(result.isError).toBe(true);
    expect(readOnly.gh.calls).toEqual([]);
    const pass=setMaster(await makeWorld({mode:'production',profile:'full'}));
    pass.connection={...pass.connection,pass:true};
    const denied=await dispatch(pass,'github_api_read',{operation:'GET /enterprises/{enterprise}/actions/cache/storage-limit',params:{enterprise:slug},cred:'M'});
    expect(denied.isError).toBe(true);
    expect(pass.gh.calls).toEqual([]);
  });
});
