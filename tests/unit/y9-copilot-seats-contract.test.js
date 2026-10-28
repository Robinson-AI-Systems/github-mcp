// Y-9d Copilot team-seat billing/cancellation through every protected write door.
import {runWriteContract,makeWorld,parse} from '../../test/helpers/write-contract.js';
import {describe,it,expect} from 'vitest';
import {spendGate} from '../../src/tools/spend-guard.js';
import * as copilot from '../../src/tools/y9-copilot.js';

const def=name=>({tool:copilot.tools.find(x=>x.name===name),handler:copilot.handlers[name]});
const BILL='GET /orgs/{org}/copilot/billing';
const TEAM='GET /orgs/{org}/teams/{team_slug}/members';
const SEATS='GET /orgs/{org}/copilot/billing/seats';
const user=(pending=null)=>({assignee:{login:'alice'},plan_type:'business',
  assigning_team:{slug:'engineering'},pending_cancellation_date:pending});
function basic(gh) {
  gh.when(BILL).reply(200,{plan_type:'business',seat_management_setting:'assign_selected'});
  gh.when(TEAM).reply(200,[{login:'alice'}]);
}
function add(gh,result){
  basic(gh);
  gh.when(SEATS).replySequence([
    {status:200,body:{total_seats:0,seats:[]}},
    {status:200,body:{total_seats:result==='ok'?1:0,seats:result==='ok'?[user()]:[]}}
  ]);
  gh.when('POST /orgs/{org}/copilot/billing/selected_teams').reply(201,{seats_created:1});
}
function remove(gh,result){
  basic(gh);
  gh.when(SEATS).replySequence([
    {status:200,body:{total_seats:1,seats:[user()]}},
    {status:200,body:{total_seats:1,seats:[user(result==='ok'?'2026-11-10':null)]}}
  ]);
  gh.when('DELETE /orgs/{org}/copilot/billing/selected_teams').reply(200,{seats_cancelled:1});
}
runWriteContract({label:'Y-9d github_copilot_team_seats',definition:def('github_copilot_team_seats'),
  args:{teamSlug:'engineering',action:'add'},arrange:add,
  production:true,profile:'full',needsConfirm:true,spendCents:1900,accessWidening:true});
runWriteContract({label:'Y-9d github_copilot_team_seats_remove',definition:def('github_copilot_team_seats_remove'),
  args:{teamSlug:'engineering',action:'remove'},arrange:remove,
  production:true,profile:'full',needsConfirm:true});


describe('Y-9d genuine delegation for an unpriced paid Copilot team',()=>{
 const args={owner:'example-org',teamSlug:'engineering',action:'add'};
 const future={plan_type:'future_paid_org_plan',seat_management_setting:'assign_selected'};
 function arrange(gh){
   gh.when(BILL).reply(200,future);
   gh.when(TEAM).reply(200,[{login:'alice'}]);
   gh.when(SEATS).replySequence([
     {status:200,body:{total_seats:0,seats:[]}},
     {status:200,body:{total_seats:0,seats:[]}},
     {status:200,body:{total_seats:1,seats:[user()]}},
     {status:200,body:{total_seats:1,seats:[user()]}}
   ]);
   gh.when('POST /orgs/{org}/copilot/billing/selected_teams')
     .reply(201,{seats_created:1});
 }
 it('shows unknown recurring bills, then permits an explicitly confirmed full-authority team assignment once',async()=>{
   const w=await makeWorld({mode:'production',profile:'full',gates:[spendGate()]});
   arrange(w.gh);
   const d=await copilot.handlers.github_copilot_team_seats({...args,dryRun:true},w.ctx).then(parse);
   expect(d).toMatchObject({status:'preview',done:false});
   expect(d.preview).toContain('COST UNKNOWN');
   expect(d.preview).toContain('future_paid_org_plan');
   expect(w.gh.calls.filter(x=>x.method==='POST')).toHaveLength(0);
   const first=await copilot.handlers.github_copilot_team_seats({...args,confirm:true},w.ctx).then(parse);
   expect(first).toMatchObject({done:true,status:'applied'});
   expect(w.gh.calls.filter(x=>x.method==='POST')).toHaveLength(1);
   const again=await copilot.handlers.github_copilot_team_seats({...args,confirm:true},w.ctx).then(parse);
   expect(again).toMatchObject({status:'replayed',replayed:true});
   expect(w.gh.calls.filter(x=>x.method==='POST')).toHaveLength(1);
   expect(w.gh.invalid).toEqual([]);
 });
 it('refuses a future-priced Copilot team change when user selected a finite monthly cap',async()=>{
   const w=await makeWorld({delegated:true,mode:'production',profile:'full',gates:[spendGate()]});
   await w.db.setSpendLimitCents('example-org',10000);
   arrange(w.gh);
   const response=await copilot.handlers.github_copilot_team_seats({...args,confirm:true},w.ctx).then(parse);
   expect(response).toMatchObject({done:false,status:'refused_by_guard',refusedBy:'spend limit'});
   expect(w.gh.calls.filter(x=>x.method==='POST')).toHaveLength(0);
 });
 it('refuses unverified team membership instead of executing even under unrestricted spending',async()=>{
   const w=await makeWorld({mode:'production',profile:'full',gates:[spendGate()]});
   arrange(w.gh);
   w.gh.when(TEAM).reply(403,{message:'permission denied'});
   const response=await copilot.handlers.github_copilot_team_seats({...args,confirm:true},w.ctx).then(parse);
   expect(response.done).toBe(false);
   expect(w.gh.calls.filter(x=>x.method==='POST')).toHaveLength(0);
 });
});
