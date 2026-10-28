import {describe,it,expect} from 'vitest';
import {makeWorld,runWriteContract,doorsFor,parse} from '../../test/helpers/write-contract.js';
import {spendGate} from '../../src/tools/spend-guard.js';
import {createDispatch} from '../../src/tools/dispatch.js';
import {registry} from '../../src/tools/index.js';
import * as defs from '../../src/tools/billing-write.js';
import * as recovered from '../../src/tools/billing-guided.js';

const B='GET /organizations/{org}/settings/billing/budgets';
const BG='GET /organizations/{org}/settings/billing/budgets/{budget_id}';
const BC='POST /organizations/{org}/settings/billing/budgets';
const BD='DELETE /organizations/{org}/settings/billing/budgets/{budget_id}';
const ACCESS='PUT /orgs/{org}/codespaces/access';
const billing='GET /orgs/{org}/copilot/billing';
const assignments='GET /orgs/{org}/copilot/billing/seats';
const seatPut='POST /orgs/{org}/copilot/billing/selected_users';
const seatDel='DELETE /orgs/{org}/copilot/billing/selected_users';
const membership='GET /orgs/{org}/memberships/{username}';
const csUser='GET /user';
const csGet='GET /user/codespaces/{codespace_name}';
const csRepo='GET /repos/{owner}/{repo}';
const csMachines='GET /repos/{owner}/{repo}/codespaces/machines';
const csCreate='POST /repos/{owner}/{repo}/codespaces';
const csStart='POST /user/codespaces/{codespace_name}/start';
const csDelete='DELETE /user/codespaces/{codespace_name}';
const limit={has_next_page:false,total_count:0,budgets:[]};
const b={id:'abc01234-def56789',budget_scope:'organization',
  budget_amount:30,budget_type:'ProductPricing',budget_product_sku:'actions',
  prevent_further_usage:true,budget_alerting:{will_alert:false,alert_recipients:[]}};
const plan={plan_type:'business',seat_management_setting:'assign_selected',
  seat_breakdown:{total:1}};
const seat=(pending=null)=>({assignee:{login:'alice'},plan_type:'business',
  pending_cancellation_date:pending});
const current=(state='Shutdown')=>({
  name:'test-code',id:99,state,repository:{full_name:'example-org/hello'},
  owner:{login:'example-owner'},billable_owner:{login:'example-org'},
  machine:{name:'basic',cpus:2},
  git_status:{has_unpushed_changes:false,has_uncommitted_changes:false}});
function budgetArrange(gh,result){
  gh.when(B).reply(200,limit);
  gh.when(BC).reply(200,{budget:b});
  gh.when(BG).reply(200,result==='ok'?b:{...b,budget_amount:40});
}
function addSeats(gh,result){
  gh.when(billing).reply(200,plan);
  gh.when(assignments).replySequence([
    {status:200,body:{total_seats:0,seats:[]}},
    {status:200,body:{total_seats:result==='ok'?1:0,
      seats:result==='ok'?[seat()]:[]}}]);
  gh.when(membership).reply(200,{state:'active',role:'member'});
  gh.when(seatPut).reply(201,{seats_created:1});
}
function removeSeats(gh,result){
  gh.when(billing).reply(200,plan);
  gh.when(assignments).replySequence([
    {status:200,body:{total_seats:1,seats:[seat()]}},
    {status:200,body:{total_seats:1,
      seats:[seat(result==='ok'?'2026-11-01':null)]}}]);
  gh.when(seatDel).reply(200,{seats_cancelled:1});
}
function codeUser(gh){gh.when(csUser).reply(200,{login:'example-owner'});}
function createCode(gh,result){
  codeUser(gh);
  gh.when(csRepo).reply(200,{id:88,full_name:'example-org/hello'});
  gh.when(csMachines).reply(200,{machines:[{name:'basic',cpus:2}]});
  gh.when(csCreate).reply(201,{name:'test-code'});
  gh.when(csGet).reply(200,result==='ok'?current('Available'):
    {...current('Available'),repository:{full_name:'other-org/hello'}});
}
function startCode(gh,result){
  codeUser(gh);
  gh.when(csGet).replySequence([
    {status:200,body:current('Shutdown')},
    {status:200,body:current(result==='ok'?'Available':'Shutdown')}]);
  gh.when(csStart).reply(201,current('Available'));
}
function deleteCode(gh,result){
  codeUser(gh);
  gh.when(csGet).replySequence([
    {status:200,body:current('Shutdown')},
    result==='ok'?{status:404,body:{message:'Not Found'}}:
      {status:200,body:current('Shutdown')}]);
  gh.when(csDelete).reply(204,null);
}
const writeDef=name=>({tool:defs.tools.find(x=>x.name===name),
  handler:defs.handlers[name]});
const contracts=[
  {name:'github_billing_save_budget',
    args:{action:'create',budgetAmount:30,budgetScope:'organization',
      budgetType:'ProductPricing',budgetProductSku:'actions',
      preventFurtherUsage:true},arrange:budgetArrange,
    spendCents:3000,production:true},
  {name:'github_copilot_add_seats',args:{usernames:['alice']},
    arrange:addSeats,spendCents:1900,production:true,
    accessWidening:true,notifies:['alice']},
  {name:'github_copilot_remove_seats',args:{usernames:['alice']},
    arrange:removeSeats,production:true},
  {name:'github_codespace_create',
    args:{repo:'hello',ref:'main',machine:'basic',machineCores:2,
      estimatedHours:1,storageGb:1},arrange:createCode,
    spendCents:25,production:true},
  {name:'github_codespace_set_state',
    args:{name:'test-code',action:'start',estimatedHours:1},
    arrange:startCode,spendCents:18,production:true},
  {name:'github_codespace_delete',args:{name:'test-code'},
    arrange:deleteCode,production:true}
];
function deleteBudgetArrange(gh,outcome){
  gh.when(BG).replySequence([
    {status:200,body:b},
    outcome==='ok'?{status:404,body:{message:'Not Found'}}:{status:200,body:b}
  ]);
  gh.when(B).replySequence([
    {status:200,body:{budgets:[b],has_next_page:false,total_count:1}},
    {status:200,body:{budgets:outcome==='ok'?[]:[b],
      has_next_page:false,total_count:outcome==='ok'?0:1}}
  ]);
  gh.when(BD).reply(200,{message:'Budget successfully deleted.',budget_id:b.id});
}
runWriteContract({label:'github_billing_delete_budget',
  definition:{tool:recovered.deleteBudget.tool,handler:recovered.deleteBudget.handler},
  args:{budgetId:b.id},
  arrange:deleteBudgetArrange,profile:'full',needsConfirm:true,production:true});

for(const c of contracts)
  runWriteContract({label:c.name,definition:writeDef(c.name),args:c.args,
    arrange:c.arrange,profile:'full',needsConfirm:true,
    spendCents:c.spendCents??0,production:c.production??false,
    accessWidening:c.accessWidening??false,notifies:c.notifies??[]});
async function invoke(w,name,args={}){
  const dispatch=createDispatch({env:w.ctx.env,credentials:w.credentials,
    fetch:w.gh.fetch,now:w.ctx.now,sleep:w.ctx.sleep,gates:w.ctx.gates});
  const response=await dispatch({registry,name,args,connection:w.connection,db:w.db});
  return response.structuredContent??(response.isError?
    {done:false,error:response.content?.[0]?.text}:parse(response));
}
describe('O-4 real prices, budget safety, marketplace, Copilot and Codespaces',()=>{
  it('reads GitHub usage dollar values without inventing cents or all-data totals',async()=>{
    const w=await makeWorld({profile:'read_only'});
    w.gh.when('GET /organizations/{org}/settings/billing/usage').reply(200,{
      usageItems:[{product:'Actions',sku:'actions_linux',quantity:25,
        unitType:'minutes',grossAmount:1,discountAmount:0.2,netAmount:0.8}]});
    const actual=await invoke(w,'github_billing_get_usage');
    expect(actual.usage.total_net_dollars).toBe(0.8);
    expect(actual.usage.items[0].net_dollars).toBe(0.8);
    expect(actual.usage.complete).toBe(true);
    expect(w.gh.invalid).toEqual([]);
  });
  it('returns exact budgets with dollar caps and their enforcement flags',async()=>{
    const w=await makeWorld({profile:'read_only'});
    w.gh.when(B).reply(200,{budgets:[b],has_next_page:false,total_count:1});
    const actual=await invoke(w,'github_billing_list_budgets');
    expect(actual.budgets[0].amount_dollars).toBe(30);
    expect(actual.budgets[0].prevent_further_usage).toBe(true);
    expect(actual.complete).toBe(true);
    expect(w.gh.invalid).toEqual([]);
  });
  it('shows the real paid plan and seats with cancellation date',async()=>{
    const w=await makeWorld({profile:'read_only'});
    w.gh.when(billing).reply(200,plan);
    w.gh.when(assignments).reply(200,{total_seats:1,
      seats:[seat('2026-11-01')]});
    const result=await invoke(w,'github_copilot_get_billing');
    expect(result.approximate_monthly_seat_price_dollars).toBe(19);
    expect(result.seats[0].pending_cancellation_date).toBe('2026-11-01');
    expect(result.complete).toBe(true);
    expect(w.gh.invalid).toEqual([]);
  });
  it('reads exact user Codespace state and billable owner',async()=>{
    const w=await makeWorld({profile:'read_only'});
    codeUser(w.gh);
    w.gh.when('GET /user/codespaces').reply(200,{
      total_count:1,codespaces:[current('Available')]});
    const result=await invoke(w,'github_codespace_list',{scope:'user'});
    expect(result.codespaces[0].billable_owner).toBe('example-org');
    expect(result.codespaces[0].state).toBe('Available');
    expect(result.complete).toBe(true);
    expect(w.gh.invalid).toEqual([]);
  });
  it('refuses budget deletion with a mismatched confirmation ID before DELETE',async()=>{
    const w=await makeWorld({mode:'production',profile:'full',gates:[spendGate()]});
    w.gh.when(BG).reply(200,b);
    const result=await invoke(w,'github_billing_delete_budget',
      {budgetId:b.id,confirmBudgetId:'not-this-budget',confirm:true});
    expect(result.done).toBe(false);
    expect(w.gh.calls.filter(x=>x.method==='DELETE')).toHaveLength(0);
  });
  it('enforces an explicitly selected $0 product cap on unknown future budget deletion',async()=>{
    const w=await makeWorld({delegated:true,mode:'production',profile:'full',gates:[spendGate()]});
    await w.db.setSpendLimitCents('example-org',0);
    deleteBudgetArrange(w.gh,'ok');
    const result=await invoke(w,'github_billing_delete_budget',
      {budgetId:b.id,confirmBudgetId:b.id,confirm:true});
    expect(result).toMatchObject({done:false,status:'refused_by_guard',
      refusedBy:'spend limit'});
    expect(w.gh.calls.filter(x=>x.method==='DELETE')).toHaveLength(0);
  });
  it('permits an uncapped authorized user to preview unknown future budget charges without DELETE',async()=>{
    const w=await makeWorld({mode:'production',profile:'full',gates:[spendGate()]});
    deleteBudgetArrange(w.gh,'ok');
    const result=await invoke(w,'github_billing_delete_budget',
      {budgetId:b.id,confirmBudgetId:b.id,dryRun:true});
    expect(result.status).toBe('preview');
    expect(result.preview).toContain('COST UNKNOWN');
    expect(w.gh.calls.filter(x=>x.method==='DELETE')).toHaveLength(0);
  });
  it('keeps an explicit restricted grant from replacing Codespaces users without acknowledgement',async()=>{
    const w=await makeWorld({delegated:true,mode:'production',profile:'full'});
    w.gh.when('GET /orgs/{org}').reply(200,{login:'example-org'});
    const result=await invoke(w,'github_codespace_set_org_access',
      {visibility:'selected_members',usernames:['alice'],confirm:true});
    expect(result.done).toBe(false);
    expect(w.gh.calls.filter(x=>x.method==='PUT')).toHaveLength(0);
  });
  it('refuses Codespaces cost-unknown expansion under a user-selected cap',async()=>{
    const w=await makeWorld({delegated:true,mode:'production',profile:'full',gates:[spendGate()]});
    await w.db.setSpendLimitCents('example-org',5000);
    w.gh.when('GET /orgs/{org}').reply(200,{login:'example-org'});
    const result=await invoke(w,'github_codespace_set_org_access',
      {visibility:'all_members',confirm:true});
    expect(result).toMatchObject({status:'refused_by_guard',refusedBy:'spend limit'});
    expect(w.gh.calls.filter(x=>x.method==='PUT')).toHaveLength(0);
  });
  it('still allows cost-reducing Codespaces disable with an explicit $0 spend cap',async()=>{
    const w=await makeWorld({mode:'production',profile:'full',gates:[spendGate()]});
    await w.db.setSpendLimitCents('example-org',0);
    w.gh.when('GET /orgs/{org}').reply(200,{login:'example-org'});
    w.gh.when(ACCESS).reply(204,null);
    const response=await invoke(w,'github_codespace_set_org_access',
      {visibility:'disabled',confirm:true});
    expect(response.status).toBe('unconfirmed');
    expect(response.refusedBy).toBeUndefined();
    expect(w.gh.calls.filter(x=>x.method==='PUT')).toHaveLength(1);
  });
  it('requires real organization membership before assigning an unknown-priced Copilot plan seat',async()=>{
    const w=await makeWorld({mode:'production',profile:'full'});
    w.gh.when(billing).reply(200,{...plan,plan_type:'unknown'});
    w.gh.when(assignments).reply(200,{total_seats:0,seats:[]});
    const result=await invoke(w,'github_copilot_add_seats',{
      usernames:['alice'],confirm:true});
    expect(result.done).toBe(false);
    expect(w.gh.calls.filter(x=>x.method!=='GET')).toHaveLength(0);
  });
});

describe('O-4 Codespaces access: all three write doors despite missing provider GET',()=>{
  const args={visibility:'all_members'};
  const definition={tool:recovered.setCodespaceAccess.tool,
    handler:recovered.setCodespaceAccess.handler};
  const arrange=(w)=>{
    w.gh.when('GET /orgs/{org}').reply(200,{login:'example-org'});
    w.gh.when(ACCESS).reply(204,null);
  };
  for(const door of doorsFor(definition)){
    it(door.name+': preview, informed confirmation, exactly-once 204 and honest unverified journal',async()=>{
      const w=await makeWorld({mode:'production',profile:'full',gates:[spendGate()]});
      arrange(w);
      const preview=parse(await door.call(w,{...args,dryRun:true}));
      expect(preview).toMatchObject({done:false,status:'preview'});
      expect(preview.preview).toContain('COST UNKNOWN');
      expect(preview.preview).toContain('ACCESS CHANGE');
      expect(w.gh.calls.filter(x=>x.method==='PUT')).toHaveLength(0);
      const first=parse(await door.call(w,args));
      expect(first).toMatchObject({done:false,status:'unconfirmed',confirmed:false});
      expect(first.result).toMatchObject({acknowledged:true,verified:false});
      expect(w.gh.calls.filter(x=>x.method==='PUT')).toHaveLength(1);
      expect(w.gh.invalid).toEqual([]);
      const again=parse(await door.call(w,{...args,confirm:true}));
      expect(again).toMatchObject({status:'replayed',replayed:true});
      expect(w.gh.calls.filter(x=>x.method==='PUT')).toHaveLength(1);
    });
    it(door.name+': PREVIEW and no privilege escalation deny before provider write',async()=>{
      const w=await makeWorld({delegated:true,mode:'preview',profile:'full',gates:[spendGate()]});
      arrange(w);
      const denied=parse(await door.call(w,{...args,confirm:true}));
      expect(denied).toMatchObject({status:'refused_by_guard',refusedBy:'mode'});
      expect(w.gh.calls.filter(x=>x.method==='PUT')).toHaveLength(0);
    });
    it(door.name+': recipient replacement confirms membership and only sends selected_usernames',async()=>{
      const w=await makeWorld({mode:'production',profile:'full',gates:[spendGate()]});
      arrange(w);
      w.gh.when('GET /orgs/{org}/memberships/{username}')
        .reply(200,{state:'active',role:'member'});
      const res=parse(await door.call(w,{visibility:'selected_members',
        usernames:['alice'],replaceSelectedUsers:true,confirm:true}));
      expect(res.status).toBe('unconfirmed');
      const writes=w.gh.calls.filter(x=>x.method==='PUT');
      expect(writes).toHaveLength(1);
      expect(writes[0].body).toMatchObject({
        visibility:'selected_members',selected_usernames:['alice']});
      expect(w.gh.invalid).toEqual([]);
    });
  }
});


describe('O-4 end-user authority: provider-allowed unenforced budget controls',()=>{
 const args={action:'create',budgetAmount:30,budgetScope:'organization',
   budgetType:'ProductPricing',budgetProductSku:'actions',preventFurtherUsage:false};
 const unenforced={...b,prevent_further_usage:false};
 function arrangeCreate(gh){
   gh.when(B).reply(200,limit);
   gh.when(BC).reply(200,{budget:unenforced});
   gh.when(BG).reply(200,unenforced);
 }
 function arrangeUpdate(gh){
   gh.when(BG).replySequence([
     {status:200,body:b},{status:200,body:b},
     {status:200,body:unenforced}
   ]);
   gh.when(B).reply(200,{budgets:[b],has_next_page:false,total_count:1});
   gh.when('PATCH /organizations/{org}/settings/billing/budgets/{budget_id}')
     .reply(200,{budget:unenforced});
 }
 it('executes user-authorized unenforced organization budget once with full billing disclosure',async()=>{
   const w=await makeWorld({mode:'production',profile:'full',gates:[spendGate()]});
   arrangeCreate(w.gh);
   const dry=await invoke(w,'github_billing_save_budget',{...args,dryRun:true});
   expect(dry).toMatchObject({status:'preview',done:false});
   expect(dry.preview).toMatch(/COST UNKNOWN/);
   expect(dry.preview).toMatch(/UNENFORCED/);
   expect(w.gh.calls.filter(x=>x.method==='POST')).toHaveLength(0);
   const waiting=await invoke(w,'github_billing_save_budget',{...args,dryRun:true});
   expect(waiting.status).toBe('preview');
   expect(w.gh.calls.filter(x=>x.method==='POST')).toHaveLength(0);
   const applied=await invoke(w,'github_billing_save_budget',{...args,confirm:true});
   expect(applied).toMatchObject({done:true,status:'applied',confirmed:true});
   expect(w.gh.calls.filter(x=>x.method==='POST')).toHaveLength(1);
   expect((await invoke(w,'github_billing_save_budget',{...args,confirm:true})))
     .toMatchObject({status:'replayed',replayed:true});
   expect(w.gh.calls.filter(x=>x.method==='POST')).toHaveLength(1);
   expect(w.gh.invalid).toEqual([]);
 });
 it('refuses an unenforced budget under a real user-selected finite cap',async()=>{
   const w=await makeWorld({delegated:true,mode:'production',profile:'full',gates:[spendGate()]});
   await w.db.setSpendLimitCents('example-org',10000);
   arrangeCreate(w.gh);
   const denied=await invoke(w,'github_billing_save_budget',{...args,confirm:true});
   expect(denied).toMatchObject({done:false,status:'refused_by_guard',refusedBy:'spend limit'});
   expect(w.gh.calls.filter(x=>x.method==='POST')).toHaveLength(0);
 });
 it('allows disabling organization budget enforcement only after exact readback',async()=>{
   const w=await makeWorld({mode:'production',profile:'full',gates:[spendGate()]});
   arrangeUpdate(w.gh);
   const request={action:'update',budgetId:b.id,preventFurtherUsage:false};
   const dry=await invoke(w,'github_billing_save_budget',{...request,dryRun:true});
   expect(dry.preview).toMatch(/COST UNKNOWN/);
   const done=await invoke(w,'github_billing_save_budget',{...request,confirm:true});
   expect(done).toMatchObject({done:true,status:'applied',confirmed:true});
   expect(w.gh.calls.filter(x=>x.method==='PATCH')).toHaveLength(1);
   expect(w.gh.invalid).toEqual([]);
 });
 it('protects finite caps and delegated passes against disabling budget enforcement',async()=>{
   for(const limited of ['user','pass']){
     const w=await makeWorld({delegated:true,mode:'production',profile:'full',gates:[spendGate()]});
     if(limited==='user')await w.db.setSpendLimitCents('example-org',5000);
     else w.ctx.connection={...w.ctx.connection,pass:true,client_id:'limited-owner-pass',
       spend_limit_cents:10000};
     arrangeUpdate(w.gh);
     const result=await defs.handlers.github_billing_save_budget({
       action:'update',budgetId:b.id,preventFurtherUsage:false,confirm:true},w.ctx).then(parse);
     expect(result).toMatchObject({done:false,status:'refused_by_guard'});
     expect(w.gh.calls.filter(x=>x.method==='PATCH')).toHaveLength(0);
   }
 });
 it('preserves GitHub-required enforcement for user-scoped budgets',async()=>{
   const w=await makeWorld({mode:'production',profile:'full',gates:[spendGate()]});
   const denied=await invoke(w,'github_billing_save_budget',{...args,budgetScope:'user',
     budgetProductSku:'ai_credits',user:'alice',confirm:true});
   expect(denied.done).toBe(false);
   expect(w.gh.calls.filter(x=>x.method==='POST')).toHaveLength(0);
 });
});

describe('O-4 end-user authority: a valid but unpriced Copilot license plan',()=>{
 const futurePlan={...plan,plan_type:'future_paid_org_plan'};
 const initial={total_seats:0,seats:[]};
 const final={total_seats:1,seats:[seat()]};
 function arrange(gh){
   gh.when(billing).reply(200,futurePlan);
   gh.when(assignments).replySequence([
     {status:200,body:initial},{status:200,body:initial},
     {status:200,body:final}
   ]);
   gh.when(membership).reply(200,{state:'active',role:'member'});
   gh.when(seatPut).reply(201,{seats_created:1});
 }
 it('shows unknown future cost instead of mislabeling the license as free',async()=>{
   const w=await makeWorld({mode:'production',profile:'full',gates:[spendGate()]});
   arrange(w.gh);
   const preview=await invoke(w,'github_copilot_add_seats',{usernames:['alice'],dryRun:true});
   expect(preview.status).toBe('preview');
   expect(preview.preview).toContain('COST UNKNOWN');
   expect(preview.preview).toContain('future_paid_org_plan');
   expect(w.gh.calls.filter(x=>x.method==='POST')).toHaveLength(0);
   const result=await invoke(w,'github_copilot_add_seats',{usernames:['alice'],confirm:true});
   expect(result).toMatchObject({done:true,status:'applied'});
   expect(w.gh.calls.filter(x=>x.method==='POST')).toHaveLength(1);
   expect(w.gh.invalid).toEqual([]);
 });
 it('does not allow an unknown price to bypass an explicit user spending ceiling',async()=>{
   const w=await makeWorld({delegated:true,mode:'production',profile:'full',gates:[spendGate()]});
   await w.db.setSpendLimitCents('example-org',9000);
   arrange(w.gh);
   const result=await invoke(w,'github_copilot_add_seats',{usernames:['alice'],confirm:true});
   expect(result).toMatchObject({status:'refused_by_guard',refusedBy:'spend limit'});
   expect(w.gh.calls.filter(x=>x.method==='POST')).toHaveLength(0);
 });
 it('still permits license removal without a published plan price',async()=>{
   const w=await makeWorld({mode:'production',profile:'full',gates:[spendGate()]});
   await w.db.setSpendLimitCents('example-org',0);
   w.gh.when(billing).reply(200,futurePlan);
   w.gh.when(assignments).replySequence([
     {status:200,body:{total_seats:1,seats:[seat()]}},
     {status:200,body:{total_seats:1,seats:[seat('2026-11-10')]}}
   ]);
   w.gh.when(seatDel).reply(200,{seats_cancelled:1});
   const result=await invoke(w,'github_copilot_remove_seats',{usernames:['alice'],confirm:true});
   expect(result).toMatchObject({done:true,status:'applied'});
   expect(w.gh.calls.filter(x=>x.method==='DELETE')).toHaveLength(1);
   expect(w.gh.invalid).toEqual([]);
 });
});

it('executes an owner-selected Codespaces replacement without a duplicate acknowledgement and remains unconfirmed',async()=>{
  const w=await makeWorld({mode:'production',profile:'full'});
  w.gh.when('GET /orgs/{org}').reply(200,{login:'example-org'});
  w.gh.when(membership).reply(200,{state:'active'});
  w.gh.when(ACCESS).reply(204,null);
  const result=await invoke(w,'github_codespace_set_org_access',{visibility:'selected_members',usernames:['alice']});
  expect(result.status).toBe('unconfirmed');
  expect(result.summary).toContain('COST UNKNOWN');
  expect(w.gh.calls.filter(x=>x.method==='PUT')).toHaveLength(1);
  expect(w.gh.invalid).toEqual([]);
});

it('keeps a caller-selected no-replacement instruction and restricted missing target confirmation from sending writes',async()=>{
  const owner=await makeWorld({mode:'production',profile:'full'});
  const result=await invoke(owner,'github_codespace_set_org_access',{visibility:'selected_members',usernames:['alice'],replaceSelectedUsers:false});
  expect(result.done).toBe(false);
  expect(owner.gh.calls.filter(x=>x.method==='PUT')).toHaveLength(0);
  const limited=await makeWorld({delegated:true,mode:'production',profile:'full'});
  const denied=await invoke(limited,'github_billing_delete_budget',{budgetId:b.id,confirm:true});
  expect(denied.done).toBe(false);
  expect(limited.gh.calls.filter(x=>x.method==='DELETE')).toHaveLength(0);
});
