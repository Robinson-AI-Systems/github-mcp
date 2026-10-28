import {describe,it,expect} from 'vitest';
import {makeWorld,runWriteContract,parse} from '../../test/helpers/write-contract.js';
import {createDispatch} from '../../src/tools/dispatch.js';
import {registry} from '../../src/tools/index.js';
import * as writers from '../../src/tools/org-write.js';

const R={
  org:'GET /orgs/{org}',update:'PATCH /orgs/{org}',
  members:'GET /orgs/{org}/members',
  inviteList:'GET /orgs/{org}/invitations',
  failed:'GET /orgs/{org}/failed_invitations',
  teams:'GET /orgs/{org}/teams',
  user:'GET /users/{username}',invite:'POST /orgs/{org}/invitations',
  cancel:'DELETE /orgs/{org}/invitations/{invitation_id}',
  membership:'GET /orgs/{org}/memberships/{username}',
  setRole:'PUT /orgs/{org}/memberships/{username}',
  remove:'DELETE /orgs/{org}/members/{username}',
  outside:'GET /orgs/{org}/outside_collaborators',
  outsideDelete:'DELETE /orgs/{org}/outside_collaborators/{username}',
  outsideConvert:'PUT /orgs/{org}/outside_collaborators/{username}',
  blocks:'GET /orgs/{org}/blocks/{username}',
  block:'PUT /orgs/{org}/blocks/{username}',
  schema:'GET /orgs/{org}/properties/schema',
  property:'PUT /orgs/{org}/properties/schema/{custom_property_name}',
  immutable:'GET /orgs/{org}/settings/immutable-releases',
  immutablePut:'PUT /orgs/{org}/settings/immutable-releases'
};
const organization=(name='Example')=>({
  login:'example-org',id:20,name,description:'Baseline organization',
  default_repository_permission:'read',members_can_create_repositories:false,
  members_can_fork_private_repositories:false,
  two_factor_requirement_enabled:true,plan:{name:'free'}});
const pending={id:12,invitee:{login:'alice'},role:'direct_member',team_ids:[]};
const active={role:'member',state:'active',user:{login:'alice'}};
const exactRead=(gh,route,first,last)=>gh.when(route).replySequence([
  {status:200,body:first},
  {status:200,body:last}
]);
const mismatch=(result,ok,bad)=>result==='ok'?ok:bad;
function arrangeUpdate(gh,result){
  exactRead(gh,R.org,organization(),organization(mismatch(result,'Updated','Not updated')));
  gh.when(R.update).reply(200,organization('Updated'));
}
function arrangeInvite(gh,result){
  exactRead(gh,R.inviteList,[],
    result==='ok'?[pending]:[{...pending,role:'billing_manager'}]);
  gh.when(R.user).reply(200,{login:'alice',id:77});
  gh.when(R.invite).reply(201,pending);
}
function arrangeCancel(gh,result){
  exactRead(gh,R.inviteList,[pending],result==='ok'?[]:[pending]);
  gh.when(R.cancel).reply(204,null);
}
function arrangeRole(gh,result){
  exactRead(gh,R.membership,active,{
    ...active,role:mismatch(result,'admin','member')});
  gh.when(R.setRole).reply(200,{...active,role:'admin'});
}
function arrangeRemove(gh,result){
  gh.when(R.membership).replySequence([
    {status:200,body:active},
    result==='ok'?{status:404,body:{message:'Not Found'}}:
      {status:200,body:active}]);
  gh.when(R.remove).reply(204,null);
}
function arrangeOutside(gh,result){
  exactRead(gh,R.outside,[{login:'alice'}],
    result==='ok'?[]:[{login:'alice'}]);
  gh.when(R.membership).reply(404,{message:'Not Found'});
  gh.when(R.outsideDelete).reply(204,null);
}
function arrangeBlock(gh,result){
  gh.when(R.blocks).replySequence([
    {status:404,body:{message:'Not Found'}},
    result==='ok'?{status:204,body:null}:
      {status:404,body:{message:'Not Found'}}]);
  gh.when(R.block).reply(204,null);
}
function arrangeSchema(gh,result){
  exactRead(gh,R.schema,[],
    result==='ok'?[{property_name:'tier',value_type:'string'}]:
      [{property_name:'tier',value_type:'true_false'}]);
  gh.when(R.property).reply(200,{property_name:'tier',value_type:'string'});
}
function arrangeImmutable(gh,result){
  exactRead(gh,R.immutable,{enforced_repositories:'none'},{
    enforced_repositories:mismatch(result,'all','none')});
  gh.when(R.immutablePut).reply(200,{enforced_repositories:'all'});
}
const def=name=>({tool:writers.tools.find(x=>x.name===name),
  handler:writers.handlers[name]});
for(const x of [
  {name:'github_org_update_settings',args:{changes:{name:'Updated'}},
    arrange:arrangeUpdate,production:true},
  {name:'github_org_update_settings',args:{changes:{web_commit_signoff_required:true}},
    arrange:(gh,result)=>{exactRead(gh,R.org,{...organization(),web_commit_signoff_required:false},{...organization(),web_commit_signoff_required:result==='ok'});gh.when(R.update).reply(200,{...organization(),web_commit_signoff_required:true});},production:true},
  {name:'github_org_invite_member',args:{username:'alice',role:'direct_member'},
    arrange:arrangeInvite,notifies:['alice'],accessWidening:true},
  {name:'github_org_cancel_invitation',args:{invitationId:12},
    arrange:arrangeCancel,notifies:['alice']},
  {name:'github_org_set_member_role',args:{username:'alice',role:'admin'},
    arrange:arrangeRole,accessWidening:true},
  {name:'github_org_remove_member',args:{username:'alice'},
    arrange:arrangeRemove},
  {name:'github_org_set_outside_collaborator',args:{username:'alice',action:'remove'},
    arrange:arrangeOutside},
  {name:'github_org_set_blocked',args:{username:'alice',blocked:true},
    arrange:arrangeBlock,production:true},
  {name:'github_org_custom_properties',args:{name:'tier',action:'save',
      spec:{value_type:'string'}},
    arrange:arrangeSchema,production:true},
  {name:'github_org_set_immutable_releases',args:{enforcedRepositories:'all'},
    arrange:arrangeImmutable,production:true}
]){
  runWriteContract({label:x.name,definition:def(x.name),args:x.args,
    arrange:x.arrange,needsConfirm:true,production:x.production??false,
    accessWidening:x.accessWidening??false,notifies:x.notifies??[],
    profile:'full'});
}
async function call(w,name,args={}){
  const dispatch=createDispatch({env:w.ctx.env,credentials:w.credentials,
    fetch:w.gh.fetch,now:w.ctx.now,sleep:w.ctx.sleep,gates:[]});
  const result=await dispatch({registry,name,args,connection:w.connection,db:w.db});
  return result.structuredContent??(result.isError?
    {done:false,error:result.content?.[0]?.text??'Unknown error'}:parse(result));
}
describe('O-2 unset profile text is a known value, unset policy is not',()=>{
  const run=async(before,changes,after)=>{
    const w=await makeWorld({mode:'production',profile:'full'});
    w.gh.when(R.org).replySequence([{status:200,body:before},{status:200,body:after}]);
    w.gh.when(R.update).reply(200,after);
    return call(w,'github_org_update_settings',{changes,confirm:true});
  };
  it('sets a description that GitHub reports as null (seen live 2026-10-23)',async()=>{
    const b={...organization(),description:null};
    const r=await run(b,{description:'New text'},{...b,description:'New text'});
    expect(r).toMatchObject({done:true,status:'applied'});
  });
  it('still refuses an unreadable policy value (null boolean)',async()=>{
    const b={...organization(),members_can_create_repositories:null};
    const r=await run(b,{members_can_create_repositories:true},{...b,members_can_create_repositories:true});
    expect(r.done).toBe(false);
  });
});
describe('O-2 live-request contract and scope regressions',()=>{
  it('organization reads use exact enrolled identity and never write',async()=>{
    const w=await makeWorld({profile:'read_only'});
    w.gh.when(R.org).reply(200,organization());
    w.gh.when(R.members).reply(200,[{login:'alice',role:'member'}]);
    w.gh.when(R.inviteList).reply(200,[pending]);
    w.gh.when(R.failed).reply(200,[]);
    expect((await call(w,'github_org_get')).org).toBe('example-org');
    expect((await call(w,'github_org_list_members')).members[0].login).toBe('alice');
    const inv=await call(w,'github_org_list_invitations');
    expect(inv.pending).toHaveLength(1);
    expect(inv.complete).toBe(true);
    expect(w.gh.invalid).toEqual([]);
    expect(w.gh.calls.filter(c=>c.method!=='GET')).toHaveLength(0);
  });
  it('refuses an unenrolled organization before provider reads or changes',async()=>{
    const w=await makeWorld({mode:'production',profile:'full'});
    const result=await call(w,'github_org_set_member_role',{
      owner:'other-org',username:'alice',role:'admin',confirm:true});
    expect(result.done).toBe(false);
    expect(w.gh.calls).toHaveLength(0);
  });
  it('cannot invite an existing recipient or unverified team',async()=>{
    const w=await makeWorld({mode:'preview',profile:'full'});
    w.gh.when(R.inviteList).reply(200,[pending]);
    const out=await call(w,'github_org_invite_member',{
      username:'alice',role:'direct_member',confirm:true});
    expect(out.done).toBe(false);
    expect(w.gh.calls.some(c=>c.route===R.invite)).toBe(false);
    const next=await makeWorld({mode:'preview',profile:'full'});
    next.gh.when(R.inviteList).reply(200,[]);
    next.gh.when(R.teams).reply(200,[{id:8}]);
    expect((await call(next,'github_org_invite_member',{
      username:'alice',role:'admin',teamIds:[99],confirm:true})).done).toBe(false);
    expect(next.gh.calls.some(c=>c.route===R.invite)).toBe(false);
  });
  it('never promotes a user when membership is absent',async()=>{
    const w=await makeWorld({mode:'preview',profile:'full'});
    w.gh.when(R.membership).reply(404,{message:'Not Found'});
    expect((await call(w,'github_org_set_member_role',{
      username:'alice',role:'admin',confirm:true})).done).toBe(false);
    expect(w.gh.calls.filter(c=>c.method!=='GET')).toHaveLength(0);
  });
  it('refuses mismatched provider organization identity',async()=>{
    const w=await makeWorld({profile:'read_only'});
    w.gh.when(R.org).reply(200,{...organization(),login:'other-org'});
    const result=await call(w,'github_org_get');
    expect(result.error??JSON.stringify(result)).toMatch(/organization|identity|not/i);
    expect(w.gh.invalid).toEqual([]);
  });
});
