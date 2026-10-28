import {describe,it,expect} from 'vitest';
import {makeWorld,runWriteContract,parse} from '../../test/helpers/write-contract.js';
import {createDispatch} from '../../src/tools/dispatch.js';
import {registry} from '../../src/tools/index.js';
import * as actions from '../../src/tools/webhooks-actions.js';

const routes={
 hook:'GET /repos/{owner}/{repo}/hooks/{hook_id}',
 del:'DELETE /repos/{owner}/{repo}/hooks/{hook_id}',
 list:'GET /repos/{owner}/{repo}/hooks/{hook_id}/deliveries',
 delivery:'GET /repos/{owner}/{repo}/hooks/{hook_id}/deliveries/{delivery_id}',
 retry:'POST /repos/{owner}/{repo}/hooks/{hook_id}/deliveries/{delivery_id}/attempts',
 ping:'POST /repos/{owner}/{repo}/hooks/{hook_id}/pings'
};
const hook={id:7,active:true,name:'web',events:['push','ping'],
 config:{url:'https://hooks.fictional.net/github/callback?private=UNSAFE',content_type:'json'}};
const original={id:9,guid:'guid-9',event:'push',redelivery:false};
function arrange(gh,result,type){
 if(type==='delete'){
  gh.when(routes.hook).replySequence([
   {status:200,body:hook},
   result==='ok'?{status:404,body:{message:'Not Found'}}:{status:200,body:hook}
  ]);
  gh.when(routes.del).reply(204,null);return;
 }
 gh.when(routes.hook).reply(200,hook);
 gh.when(routes.list).replySequence([
  {status:200,body:type==='ping'?[]:[original]},
  {status:200,body:result!=='ok'?(type==='ping'?[]:[original]):(
   type==='ping'?[{id:10,event:'ping'}]:
   [original,{id:10,guid:'guid-9',redelivery:true,event:'push'}])}
 ]);
 if(type==='retry'){
  gh.when(routes.delivery).reply(200,original);
  gh.when(routes.retry).reply(202,{});
 }else gh.when(routes.ping).reply(204,null);
}
const definition=n=>({tool:actions.tools.find(t=>t.name===n),handler:actions.handlers[n]});
runWriteContract({
 label:'github_webhook_delete',definition:definition('github_webhook_delete'),
 args:{repo:'hello',hookId:7},production:true,needsConfirm:true,profile:'full',
 arrange:(gh,result)=>arrange(gh,result,'delete')
});
runWriteContract({
 label:'github_webhook_redeliver',definition:definition('github_webhook_redeliver'),
 args:{repo:'hello',hookId:7,deliveryId:9},production:true,needsConfirm:true,
 arrange:(gh,result)=>arrange(gh,result,'retry')
});
runWriteContract({
 label:'github_webhook_ping',definition:definition('github_webhook_ping'),
 args:{repo:'hello',hookId:7},production:true,needsConfirm:true,
 arrange:(gh,result)=>arrange(gh,result,'ping')
});
async function call(w,name,args){
 const dispatch=createDispatch({credentials:w.credentials,fetch:w.gh.fetch,
  now:w.ctx.now,sleep:w.ctx.sleep,gates:[]});
 const r=await dispatch({registry,name,args,connection:w.connection,db:w.db});
 return r.structuredContent??(r.isError?{done:false,error:r.content?.[0]?.text}:parse(r));
}
describe('H-2 webhook mutation safety and refused paths',()=>{
 it('never sends a DELETE on PREVIEW even with confirmation',async()=>{
  const w=await makeWorld({delegated:true,mode:'preview',profile:'full'});
  arrange(w.gh,'ok','delete');
  const r=await call(w,'github_webhook_delete',{repo:'hello',hookId:7,confirm:true});
  expect(r.done).toBe(false);
  expect(w.gh.calls.filter(c=>c.route===routes.del)).toHaveLength(0);
 });
 it('will not dispatch a redelivery for unverified delivery identity',async()=>{
  const w=await makeWorld({mode:'production',profile:'full'});
  arrange(w.gh,'ok','retry');
  w.gh.when(routes.delivery).reply(200,{id:999,guid:'other',event:'push'});
  const r=await call(w,'github_webhook_redeliver',{repo:'hello',hookId:7,deliveryId:9,confirm:true});
  expect(r.done).toBe(false);
  expect(w.gh.calls.filter(c=>c.route===routes.retry)).toHaveLength(0);
 });
 it('waits for a ping that GitHub records a moment after accepting it (seen on the real account)',async()=>{
  const w=await makeWorld({mode:'production',profile:'full'});
  w.gh.when(routes.hook).reply(200,hook);
  w.gh.when(routes.list).replySequence([
   {status:200,body:[]},{status:200,body:[]},{status:200,body:[{id:'3849911300538769408',event:'ping'}]}]);
  w.gh.when(routes.ping).reply(204,null);
  const r=await call(w,'github_webhook_ping',{repo:'hello',hookId:7,confirm:true});
  expect(r).toMatchObject({done:true,status:'applied',confirmed:true});
  expect(r.result.ping_delivery_id).toBe('3849911300538769408');
 });
 it('still reports unconfirmed, after a bounded wait, when no ping ever shows up',async()=>{
  const w=await makeWorld({mode:'production',profile:'full'});
  w.gh.when(routes.hook).reply(200,hook);
  w.gh.when(routes.list).reply(200,[]);
  w.gh.when(routes.ping).reply(204,null);
  const r=await call(w,'github_webhook_ping',{repo:'hello',hookId:7,confirm:true});
  expect(r.done).toBe(false);
  expect(r.status).toBe('unconfirmed');
  expect(w.gh.calls.filter(c=>c.route===routes.list).length).toBeLessThanOrEqual(5);
 });
 it('refuses to ping webhook URLs on private or HTTP origins',async()=>{
  const w=await makeWorld({mode:'production',profile:'full'});
  arrange(w.gh,'ok','ping');
  w.gh.when(routes.hook).reply(200,{...hook,config:{url:'http://127.0.0.1/hook'}});
  const r=await call(w,'github_webhook_ping',{repo:'hello',hookId:7,confirm:true});
  expect(r.done).toBe(false);
  expect(w.gh.calls.filter(c=>c.route===routes.ping)).toHaveLength(0);
 });
 it('refuses incomplete delivery inventory before ping',async()=>{
  const w=await makeWorld({mode:'production',profile:'full'});
  arrange(w.gh,'ok','ping');
  w.gh.when(routes.list).reply(200,Array.from({length:100},(_,i)=>({id:i+1,event:'push'})));
  const r=await call(w,'github_webhook_ping',{repo:'hello',hookId:7,confirm:true});
  expect(r.done).toBe(false);
  expect(w.gh.calls.filter(c=>c.route===routes.ping)).toHaveLength(0);
 });
 it('requires a real account to edit, refusing unrelated owners before any call',async()=>{
  const w=await makeWorld({mode:'production',profile:'full'});
  const r=await call(w,'github_webhook_delete',{owner:'foreign',repo:'hello',
   hookId:7,confirm:true});
  expect(r.done).toBe(false);
  expect(w.gh.calls).toHaveLength(0);
 });
 it('does not persist raw hook configuration in the confirmed delete change journal',async()=>{
  const w=await makeWorld({mode:'production',profile:'full'});
  arrange(w.gh,'ok','delete');
  w.gh.when(routes.hook).replySequence([
   {status:200,body:{...hook,config:{...hook.config,secret:'FAKE_SIGNING_VALUE_NEVER_STORE',
     url:'https://hooks.fictional.net/webhook?token=PRIVATE_QUERY_NEVER_STORE'}}},
   {status:404,body:{message:'Not Found'}}]);
  const r=await call(w,'github_webhook_delete',{repo:'hello',hookId:7,confirm:true});
  expect(r).toMatchObject({done:true,status:'applied'});
  const row=await w.db.getChange(1);
  const recorded=JSON.stringify({row,result:r});
  expect(recorded).not.toContain('FAKE_SIGNING_VALUE_NEVER_STORE');
  expect(recorded).not.toContain('PRIVATE_QUERY_NEVER_STORE');
 });
 it('never journals webhook delivery payloads or HTTP authorization headers',async()=>{
  const w=await makeWorld({mode:'production',profile:'full'});
  arrange(w.gh,'ok','retry');
  w.gh.when(routes.delivery).reply(200,{...original,
   request:{payload:{password:'DELIVERY_PRIVATE_NEVER_STORE'},
    headers:{Authorization:'HEADER_PRIVATE_NEVER_STORE'}}});
  w.gh.when(routes.list).replySequence([
   {status:200,body:[original]},
   {status:200,body:[original,{id:10,guid:'guid-9',event:'push',redelivery:true,
     request:{payload:{key:'AFTER_PRIVATE_NEVER_STORE'}}}]}]);
  const r=await call(w,'github_webhook_redeliver',{
   repo:'hello',hookId:7,deliveryId:9,confirm:true});
  expect(r).toMatchObject({done:true,status:'applied'});
  const recorded=JSON.stringify({row:await w.db.getChange(1),result:r});
  for(const secret of ['DELIVERY_PRIVATE_NEVER_STORE','HEADER_PRIVATE_NEVER_STORE',
   'AFTER_PRIVATE_NEVER_STORE'])expect(recorded).not.toContain(secret);
 });

});
