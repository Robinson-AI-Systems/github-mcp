import {describe,it,expect} from 'vitest';
import {makeWorld,runWriteContract,parse} from '../../test/helpers/write-contract.js';
import {createDispatch} from '../../src/tools/dispatch.js';
import {registry} from '../../src/tools/index.js';
import * as protection from '../../src/tools/protection-write.js';

const routes={
 branch:'GET /repos/{owner}/{repo}/branches/{branch}',
 get:'GET /repos/{owner}/{repo}/branches/{branch}/protection',
 put:'PUT /repos/{owner}/{repo}/branches/{branch}/protection',
 del:'DELETE /repos/{owner}/{repo}/branches/{branch}/protection'
};
const flags=['required_linear_history','allow_force_pushes','allow_deletions',
 'block_creations','required_conversation_resolution','lock_branch','allow_fork_syncing'];
const original={
 required_status_checks:{strict:true,contexts:['ci'],checks:[{context:'ci',app_id:24}]},
 enforce_admins:{enabled:true},
 required_pull_request_reviews:{dismiss_stale_reviews:true,require_code_owner_reviews:true,
  required_approving_review_count:2,require_last_push_approval:true,
  dismissal_restrictions:{users:[{login:'reviewer'}],teams:[{slug:'security'}],apps:[]},
  bypass_pull_request_allowances:{users:[],teams:[],apps:[]}},
 restrictions:{users:[{login:'operator'}],teams:[],apps:[]},
 required_linear_history:{enabled:true},allow_force_pushes:{enabled:false},
 allow_deletions:{enabled:false},block_creations:{enabled:true},
 required_conversation_resolution:{enabled:true},lock_branch:{enabled:false},
 allow_fork_syncing:{enabled:false},required_signatures:{enabled:true}
};
const toResponse=body=>({
 required_status_checks:body.required_status_checks===null?null:{
  strict:body.required_status_checks.strict,
  // Real GitHub (2026-10-23) reads an "any app" check (app_id -1) back as app_id null.
  checks:body.required_status_checks.checks.map(c=>({...c,app_id:c.app_id===-1?null:c.app_id})),
  contexts:body.required_status_checks.checks.map(c=>c.context)},
 enforce_admins:{enabled:body.enforce_admins},
 required_pull_request_reviews:body.required_pull_request_reviews===null?null:{
  ...body.required_pull_request_reviews,
  ...Object.fromEntries(['dismissal_restrictions','bypass_pull_request_allowances']
   .filter(k=>body.required_pull_request_reviews[k])
   .map(k=>[k,Object.fromEntries(Object.entries(body.required_pull_request_reviews[k])
    .map(([field,array])=>[field,array.map(value=>({[field==='users'?'login':'slug']:value}))]))]))},
 restrictions:body.restrictions===null?null:Object.fromEntries(Object.entries(body.restrictions)
  .map(([field,array])=>[field,array.map(value=>({[field==='users'?'login':'slug']:value}))])),
 ...Object.fromEntries(flags.map(f=>[f,{enabled:body[f]}])),
 required_signatures:{enabled:true}
});
function arrange(gh,outcome,action){
 gh.when(routes.branch).reply(200,{name:'main',commit:{sha:'f'.repeat(40)}});
 if(action==='remove'){
  gh.when(routes.get).replySequence([{status:200,body:original},
   outcome==='ok'?{status:404,body:{message:'Not Found'}}:{status:200,body:original}]);
  gh.when(routes.del).reply(204,null);
 }else{
  let stored=null;
  gh.when(routes.get).reply(200,()=>outcome==='ok'&&stored?toResponse(stored):original);
  gh.when(routes.put).reply(200,request=>{stored=request.body;return toResponse(request.body);});
 }
}
const definition=name=>({tool:protection.tools.find(t=>t.name===name),
 handler:protection.handlers[name]});
runWriteContract({
 label:'github_protection_set full merge',definition:definition('github_protection_set'),
 args:{repo:'hello',branch:'main',changes:{required_conversation_resolution:false}},
 profile:'full',production:true,needsConfirm:true,
 arrange:(gh,outcome)=>arrange(gh,outcome,'set')
});
runWriteContract({
 label:'github_protection_remove',definition:definition('github_protection_remove'),
 args:{repo:'hello',branch:'main'},profile:'full',production:true,needsConfirm:true,
 arrange:(gh,outcome)=>arrange(gh,outcome,'remove')
});
async function call(w,name,args){
 const d=createDispatch({credentials:w.credentials,fetch:w.gh.fetch,
  now:w.ctx.now,sleep:w.ctx.sleep,gates:[]});
 const x=await d({registry,name,args,connection:w.connection,db:w.db});
 return x.structuredContent??(x.isError?{done:false,error:x.content?.[0]?.text}:parse(x));
}
describe('H-1 classic protection on a branch with no protection yet (real GitHub shapes)',()=>{
 const optionalOmitted=body=>({enforce_admins:{enabled:body.enforce_admins},
  ...Object.fromEntries(flags.map(f=>[f,{enabled:body[f]??false}])),required_signatures:{enabled:false}});
 it('names the missing fields instead of a generic read failure',async()=>{
  const w=await makeWorld({mode:'production',profile:'full'});
  w.gh.when(routes.branch).reply(200,{name:'main',commit:{sha:'f'.repeat(40)}});
  w.gh.when(routes.get).reply(404,{message:'Branch not protected'});
  const r=await call(w,'github_protection_set',{repo:'hello',branch:'main',changes:{required_conversation_resolution:true},confirm:true});
  expect(r).toMatchObject({done:false,status:'refused_by_guard'});
  expect(r.error).toContain('requires explicit');
  expect(w.gh.calls.some(c=>c.route===routes.put)).toBe(false);
 });
 it('creates first-time protection and confirms it when GitHub omits the unconfigured groups',async()=>{
  const w=await makeWorld({mode:'production',profile:'full'});
  const created=optionalOmitted({enforce_admins:false,required_conversation_resolution:true});
  w.gh.when(routes.branch).reply(200,{name:'main',commit:{sha:'f'.repeat(40)}});
  w.gh.when(routes.get).replySequence([{status:404,body:{message:'Branch not protected'}},{status:200,body:created},{status:200,body:created},{status:200,body:created}]);
  w.gh.when(routes.put).reply(200,created);
  const r=await call(w,'github_protection_set',{repo:'hello',branch:'main',confirm:true,
   changes:{required_status_checks:null,enforce_admins:false,required_pull_request_reviews:null,restrictions:null,required_conversation_resolution:true}});
  expect(r).toMatchObject({done:true,status:'applied'});
 });
});
describe('H-1 classic protection complete-object safety',()=>{
 it('preserves required checks, reviewing membership and every unrelated flag in the PUT',async()=>{
  const w=await makeWorld({mode:'production',profile:'full'});
  arrange(w.gh,'ok','set');
  const r=await call(w,'github_protection_set',{repo:'hello',branch:'main',
   changes:{required_conversation_resolution:false},confirm:true});
  expect(r).toMatchObject({done:true,status:'applied'});
  const requests=w.gh.calls.filter(c=>c.route===routes.put);
  expect(requests).toHaveLength(1);
  const b=requests[0].body;
  // Real GitHub (private fixture, 2026-10-23) answers HTTP 422 "More than one subschema in oneOf matched" when both
  // `contexts` and `checks` are sent, so only the app-bound `checks` list goes out.
  expect(b.required_status_checks).toEqual({strict:true,checks:[{context:'ci',app_id:24}]});
  expect(b.required_status_checks).not.toHaveProperty('contexts');
  expect(b.required_pull_request_reviews).toMatchObject({
   required_approving_review_count:2,require_code_owner_reviews:true,
   dismissal_restrictions:{users:['reviewer'],teams:['security'],apps:[]}});
  expect(b.restrictions).toEqual({users:['operator'],teams:[],apps:[]});
  for(const flag of flags.filter(f=>f!=='required_conversation_resolution'))
   expect(b[flag]).toBe(original[flag].enabled);
  expect(b.required_conversation_resolution).toBe(false);
  expect(w.gh.invalid).toEqual([]);
 });
 it('confirms an any-app required check that GitHub reads back as a null app',async()=>{
  const w=await makeWorld({mode:'production',profile:'full'});
  arrange(w.gh,'ok','set');
  const r=await call(w,'github_protection_set',{repo:'hello',branch:'main',
   changes:{required_status_checks:{strict:true,contexts:['ci'],checks:[{context:'ci',app_id:-1}]}},confirm:true});
  expect(r).toMatchObject({done:true,status:'applied'});
  expect(w.gh.calls.filter(c=>c.route===routes.put)[0].body.required_status_checks)
   .toEqual({strict:true,checks:[{context:'ci',app_id:-1}]});
 });
 it('refuses incomplete required review membership before PUT',async()=>{
  const w=await makeWorld({mode:'production',profile:'full'});
  arrange(w.gh,'ok','set');
  w.gh.when(routes.get).reply(200,{...original,
   required_pull_request_reviews:{...original.required_pull_request_reviews,
    dismissal_restrictions:{users:[{login:'reviewer'}]}}});
  const r=await call(w,'github_protection_set',{repo:'hello',branch:'main',
   changes:{required_conversation_resolution:false},confirm:true});
  expect(r.done).toBe(false);
  expect(w.gh.calls.filter(c=>c.route===routes.put)).toHaveLength(0);
 });
 it('refuses incomplete required-check app mappings before PUT',async()=>{
  const w=await makeWorld({mode:'production',profile:'full'});
  arrange(w.gh,'ok','set');
  w.gh.when(routes.get).reply(200,{...original,
   required_status_checks:{strict:true,contexts:['ci','security'],
    checks:[{context:'ci',app_id:24}]}});
  const r=await call(w,'github_protection_set',{repo:'hello',branch:'main',
   changes:{enforce_admins:false},confirm:true});
  expect(r.done).toBe(false);
  expect(w.gh.calls.filter(c=>c.route===routes.put)).toHaveLength(0);
 });
 it('cannot quietly remove protection using a preview connection',async()=>{
  const w=await makeWorld({delegated:true,mode:'preview',profile:'full'});
  arrange(w.gh,'ok','remove');
  const r=await call(w,'github_protection_remove',{repo:'hello',branch:'main',confirm:true});
  expect(r.done).toBe(false);
  expect(w.gh.calls.filter(c=>c.route===routes.del)).toHaveLength(0);
 });
 it('does not accept a partial new protection or invent four required values',async()=>{
  const w=await makeWorld({mode:'production',profile:'full'});
  w.gh.when(routes.branch).reply(200,{name:'main',commit:{sha:'f'.repeat(40)}});
  w.gh.when(routes.get).reply(404,{message:'Not Found'});
  const r=await call(w,'github_protection_set',{repo:'hello',branch:'main',
   changes:{allow_force_pushes:false},confirm:true});
  expect(r.done).toBe(false);
  expect(w.gh.calls.filter(c=>c.route===routes.put)).toHaveLength(0);
 });
 it('denies an attempt to change another account before provider calls',async()=>{
  const w=await makeWorld({mode:'production',profile:'full'});
  const r=await call(w,'github_protection_set',{owner:'foreign',repo:'hello',
   branch:'main',changes:{enforce_admins:false},confirm:true});
  expect(r.done).toBe(false);
  expect(w.gh.calls).toHaveLength(0);
 });
});
