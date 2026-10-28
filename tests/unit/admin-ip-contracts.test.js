import {describe,it,expect} from 'vitest';
import {makeWorld,runWriteContract,parse} from '../../test/helpers/write-contract.js';
import {createDispatch} from '../../src/tools/dispatch.js';
import {registry} from '../../src/tools/index.js';
import * as ip from '../../src/tools/ip-allowlist.js';
import {notificationRestriction} from '../../src/tools/org-write.js';
const row=()=>({__typename:'IpAllowListEntry',id:'IP1',allowListValue:'192.0.2.0/24',isActive:true,name:'office',owner:{__typename:'Organization',id:'ORG1'}});
function arrange(gh,result='ok',opts={}){
 const state={entry:opts.create?null:row(),sent:[],notification:'DISABLED',reads:0};
 gh.when('GET /orgs/{org}').reply(200,{login:'example-org',id:1});
 gh.when('POST /graphql').reply(200,req=>{
  const q=req.body.query,v=req.body.variables??{},input=v.input;
  if(q.includes('membershipType: ADMIN'))return {data:{viewer:{enterprises:{nodes:[{slug:'acme-ent'}]}}}};
  if(q.includes('IpOwner('))return {data:{enterprise:{id:'ORG1',slug:'acme-ent'}}};
  if(q.includes('IpOwnerOrganization'))return {data:{organization:{id:'ORG1',login:'example-org'}}};
  if(q.includes('IpEntrySave')){
   state.sent.push(input);
   if(result==='ok')state.entry={...row(),allowListValue:input.allowListValue,isActive:input.isActive,name:input.name,owner:opts.enterprise?{__typename:'Enterprise',id:'ORG1'}:row().owner};
   return {data:{[q.includes('updateIpAllowListEntry')?'updateIpAllowListEntry':'createIpAllowListEntry']:{ipAllowListEntry:{id:'IP1'}}}};
  }
  if(q.includes('IpEntryDelete')){state.sent.push(input);if(result==='ok')state.entry=null;return {data:{deleteIpAllowListEntry:{clientMutationId:null}}};}
  if(q.includes('IpEntries')){
   const page={nodes:opts.nodes??[state.entry],pageInfo:opts.pageInfo??{hasNextPage:false,endCursor:null}};
   return {data:opts.enterprise?{enterprise:{id:'ORG1',ownerInfo:{ipAllowListEntries:page}}}:{organization:{id:'ORG1',ipAllowListEntries:page}}};
  }
  if(q.includes('IpEntry(')){
   state.reads++;if(opts.concurrent&&state.reads===2)state.entry={...state.entry,name:'changed elsewhere'};
   return {data:{node:state.entry}};
  }
  if(q.includes('OrganizationNotificationSet')){state.sent.push(input);if(result==='ok')state.notification=input.settingValue;return {data:{updateNotificationRestrictionSetting:{clientMutationId:null}}};}
  if(q.includes('OrganizationNotificationPolicy'))return {data:{organization:{id:'ORG1',login:'example-org',notificationDeliveryRestrictionEnabledSetting:state.notification}}};
  throw new Error('Unexpected fixture query');
 });
 return state;
}
const def=name=>({tool:ip.tools.find(t=>t.name===name),handler:ip.handlers[name]});
const base={needsConfirm:true,production:true,accessWidening:true,profile:'full'};
for(const [label,args,opts] of [
 ['create',{value:'198.51.100.0/24',active:false,name:'new office'},{create:true}],
 ['update',{entryId:'IP1',active:false},{}],
 ['delete',{entryId:'IP1'},{}]
])runWriteContract({...base,label:`IP entry ${label}`,definition:def(`github_ip_allowlist_${label==='delete'?'delete':'save'}`),args,arrange:(gh,r)=>arrange(gh,r,opts)});
runWriteContract({...base,label:'organization notification restriction',definition:notificationRestriction,args:{restricted:true},arrange});
async function call(w,name,args={}){
 const dispatch=createDispatch({env:w.ctx.env,credentials:w.credentials,fetch:w.gh.fetch,now:w.ctx.now,sleep:w.ctx.sleep,gates:[]});
 return dispatch({registry,name,args,connection:w.connection,db:w.db});
}
async function world(opts={}){const w=await makeWorld({profile:'full',mode:'production'});return {...w,state:arrange(w.gh,'ok',opts)};}
describe('IP policy exact identity and preservation',()=>{
 it('preserves omitted value and label while changing active, using validated provider inputs',async()=>{
  const w=await world();const out=parse(await call(w,'github_ip_allowlist_save',{entryId:'IP1',active:false}));
  expect(out.status).toBe('applied');expect(w.state.sent).toEqual([{ipAllowListEntryId:'IP1',allowListValue:'192.0.2.0/24',isActive:false,name:'office'}]);expect(w.gh.invalid).toEqual([]);
 });
 it('preserves a protected existing label internally without exposing it in result or journal',async()=>{
  const w=await world();const secret='ghp_'+ 'a'.repeat(36);w.state.entry.name=secret;
  const out=await call(w,'github_ip_allowlist_save',{entryId:'IP1',active:false});
  expect(parse(out).status).toBe('applied');expect(w.state.sent[0].name).toBe(secret);
  expect(JSON.stringify(out)).not.toContain(secret);
  const change=await w.db.getChange(parse(out).logged.id);expect(JSON.stringify(change)).not.toContain(secret);
 });
 it('refuses foreign entry ownership before mutation',async()=>{
  const w=await world();w.state.entry.owner.id='FOREIGN';
  expect((await call(w,'github_ip_allowlist_delete',{entryId:'IP1'})).isError).toBe(true);expect(w.state.sent).toEqual([]);
 });
 it('refuses an entry that changes between baseline and send',async()=>{
  const w=await world({concurrent:true});const out=await call(w,'github_ip_allowlist_save',{entryId:'IP1',active:false});
  expect(JSON.stringify(out)).toMatch(/changed/);expect(w.state.sent).toEqual([]);
 });
 it('rejects invalid networks before any provider call',async()=>{
  for(const value of ['192.0.2.0/33','2001:db8::/129','invalid','192.0.2.0/24/7']){
   const w=await world();expect((await call(w,'github_ip_allowlist_save',{value})).isError).toBe(true);expect(w.gh.calls).toHaveLength(0);
  }
 });
 it('reports the provider cursor and incomplete inventory honestly',async()=>{
  const w=await world({pageInfo:{hasNextPage:true,endCursor:'next-page'}});
  const out=parse(await call(w,'github_ip_allowlist_list',{max:1}));expect(out).toMatchObject({complete:false,next_cursor:'next-page',items:[{id:'IP1'}]});expect(w.gh.invalid).toEqual([]);
 });
 it('refuses malformed inventory rather than treating it as absence',async()=>{
  const w=await world({nodes:[{...row(),isActive:null}]});expect((await call(w,'github_ip_allowlist_list')).isError).toBe(true);
 });
 it('blocks an explicitly repository-restricted pass from account policy',async()=>{
  const w=await world();w.connection={...w.connection,pass:true,repos:['example-org/repo'],allow_writes:true,allow_access_changes:true};
  expect((await call(w,'github_ip_allowlist_list')).isError).toBe(true);expect(w.gh.calls).toHaveLength(0);
 });
 it('uses enterprise ownerId only after current administrator proof',async()=>{
  const w=await world({create:true,enterprise:true}),base=w.credentials;
  w.credentials=Object.assign(Object.create(base),{masterStatus:async()=>({enrolled:true,scopes:['admin:enterprise']}),authorizeOptionalRequest:async()=>true,token:async o=>o.cred==='M'?'ghp_FAKEmaster':base.token(o)});
  const out=parse(await call(w,'github_ip_allowlist_save',{enterprise:'acme-ent',value:'2001:db8::/32'}));
  expect(out.status).toBe('applied');expect(w.state.sent[0]).toEqual({ownerId:'ORG1',allowListValue:'2001:db8::/32',isActive:true,name:null});expect(w.gh.invalid).toEqual([]);
 });
});
