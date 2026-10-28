import {describe,it,expect} from 'vitest';
import {SETTINGS,fill} from '../../src/data/dashboard-map.js';
import {makeWorld} from '../../test/helpers/write-contract.js';
import {createDispatch} from '../../src/tools/dispatch.js';
import {registry} from '../../src/tools/index.js';
import {selectedSpendCap} from '../../src/tools/spend-guard.js';

const routes={
  org:'GET /orgs/{org}',
  owners:'GET /orgs/{org}/members',
  outside:'GET /orgs/{org}/outside_collaborators',
  invitations:'GET /orgs/{org}/invitations',
  repos:'GET /orgs/{org}/repos',
  repo:'GET /repos/{owner}/{repo}',
  policy:'GET /repos/{owner}/{repo}/actions/permissions/workflow',
  keys:'GET /repos/{owner}/{repo}/keys',
  apps:'GET /orgs/{org}/installations',
  pats:'GET /orgs/{org}/personal-access-token-requests',
  billing:'GET /organizations/{org}/settings/billing/usage'
};
const org=(twoFactor=true)=>({
  login:'example-org',name:'Example Org',description:'A safe test org',
  two_factor_requirement_enabled:twoFactor,default_repository_permission:'read',
  plan:{name:'free'}});
const fakeRepo=(secret='enabled')=>({
  id:42,name:'hello',full_name:'example-org/hello',private:false,
  security_and_analysis:{
    secret_scanning:{status:secret},
    secret_scanning_push_protection:{status:'enabled'},
    dependabot_security_updates:{status:'enabled'}}});
function arrange(w,opts={}){
  w.gh.when('GET /user').reply(200,{id:1,login:'example-owner',type:'User',two_factor_authentication:true});
  w.gh.when(routes.org).reply(200,org(opts.twoFactor??true));
  w.gh.when(routes.owners).reply(200,[{login:'example-owner',id:1}]);
  w.gh.when(routes.outside).reply(200,opts.outside?[{login:'outsider'}]:[]);
  w.gh.when(routes.invitations).reply(200,[]);
  w.gh.when(routes.repos).reply(200,[fakeRepo()]);
  w.gh.when(routes.repo).reply(200,fakeRepo(opts.scanning??'enabled'));
  w.gh.when(routes.policy).reply(200,{default_workflow_permissions:opts.token??'read',
    can_approve_pull_request_reviews:false});
  w.gh.when(routes.keys).reply(200,opts.writeKey?[{id:7,read_only:false}]:[]);
  w.gh.when(routes.apps).reply(200,{total_count:0,installations:[]});
  w.gh.when(routes.pats).reply(200,[]);
  w.gh.when(routes.billing).reply(200,{usageItems:[]});
}
async function call(w,name,args={}){
  const dispatch=createDispatch({credentials:w.credentials,env:w.ctx.env,
    fetch:w.gh.fetch,now:w.ctx.now,sleep:w.ctx.sleep,gates:[]});
  const r=await dispatch({registry,name,args,connection:w.connection,db:w.db});
  if (r.structuredContent?.full_payload_location === 'content[0].text') return JSON.parse(r.content[0].text);
  return r.structuredContent??(r.isError?{error:r.content?.[0]?.text}:
    JSON.parse(r.content[0].text));
}
describe('O-1 full guided GitHub settings inventory and verification',()=>{
  it('covers repository, org and user pages with unique IDs, actionable steps and clear incomplete status',()=>{
    const ids=new Set();
    for(const s of SETTINGS){
      expect(ids.has(s.id),s.id).toBe(false);ids.add(s.id);
      expect(s.url).toMatch(/^https:\/\/github.com\//);
      expect(s.steps.length).toBeGreaterThan(0);
      expect(['repo','org','user']).toContain(s.scope);
      expect(s.expected).toBeTruthy();
      expect(s.verifyWith?.tool==='github_org_get').toBe(false);
    }
    for(const scope of ['repo','org','user'])
      expect(SETTINGS.filter(x=>x.scope===scope).length).toBeGreaterThanOrEqual(15);
  });
  it('finds repository Actions and substitutes org/repo deeply without claiming UI completion',async()=>{
    const w=await makeWorld({profile:'read_only'});
    const guides=await call(w,'github_admin_list_guided_settings',{
      scope:'repo',owner:'example-org',repo:'hello',query:'Actions',max:20});
    expect(guides.settings.length).toBeGreaterThan(0);
    expect(guides.settings.some(x=>x.url.includes('/example-org/hello/settings'))).toBe(true);
    expect(guides.settings.every(x=>x.status===(x.verification?'can_check_with_provider':'manual_confirmation_required'))).toBe(true);
    const where=await call(w,'github_where_is_setting',{
      query:'deploy keys',org:'example-org',repo:'hello',detail:'full'});
    expect(where.settings.some(x=>x.url.endsWith('/hello/settings/keys'))).toBe(true);
    expect(w.gh.calls).toHaveLength(0);
    expect(fill({url:'{org}/{repo}',steps:['{user}/{repo}']},{
      org:'example-org',user:'owner',repo:'hello'}))
      .toEqual({url:'example-org/hello',steps:['owner/hello']});
  });
  it('paginates the entire approved guide inventory without dropping pages',async()=>{
    const w=await makeWorld({profile:'read_only'});
    const all=[];
    for(let i=0;i<3;i++){
      const page=await call(w,'github_admin_list_guided_settings',{
        scope:'org',max:20,offset:i*20});
      all.push(...page.settings.map(x=>x.id));
    }
    const unique=new Set(all);
    expect(unique.size).toBe(all.length);
    expect(unique.size).toBeGreaterThan(20);
  });
  it('independently verifies organization 2FA and refuses to infer provider-disabled status',async()=>{
    const w=await makeWorld({profile:'read_only'});
    w.gh.when(routes.org).reply(200,org(false));
    const r=await call(w,'github_admin_check_setting',{
      owner:'example-org',settingId:'org-require-2fa',expectedBoolean:true});
    expect(r).toMatchObject({verified:false,status:'differs',observed:false,expected:true});
    const noApi=await call(w,'github_admin_check_setting',{
      settingId:'user-password'});
    expect(noApi).toMatchObject({verified:false,status:'not_readable'});
    expect(w.gh.invalid).toEqual([]);
  });
  it('cannot read outside enrolled account or turn browser navigation into verified completion',async()=>{
    const w=await makeWorld({profile:'read_only'});
    const bad=await call(w,'github_admin_check_setting',{
      owner:'outsider',settingId:'org-require-2fa',expectedBoolean:true});
    expect(bad.verified).not.toBe(true);
    const guided=await call(w,'github_admin_check_setting',{
      owner:'example-org',settingId:'org-page-billing'});
    expect(guided).toMatchObject({verified:false,status:'manual_confirmation_required'});
    expect(w.gh.calls).toHaveLength(0);
  });
});
describe('O-1 bound personal navigation identity',()=>{
  it('uses the enrolled org user U for personal profile links, not its organization login',async()=>{
    const w=await makeWorld({profile:'read_only'});
    const r=await call(w,'github_admin_list_guided_settings',{owner:'example-org',scope:'user',max:100});
    const pinned=r.settings.find(s=>s.id==='user-pinned');
    expect(pinned.url).toBe('https://github.com/example-owner');
    expect(r.settings.find(s=>s.id==='user-profile-readme').url).toBe('https://github.com/example-owner');
    expect(pinned.url).not.toContain('example-org');
    const orgGuide=await call(w,'github_admin_list_guided_settings',{scope:'org',max:100});
    expect(orgGuide.settings.find(s=>s.id==='org-require-2fa').url).toContain('/organizations/example-org/');
    expect(w.gh.calls).toHaveLength(0);
  });
  it('never fabricates a personal profile URL when U is absent or malformed',async()=>{
    const w=await makeWorld({profile:'read_only'});
    await w.db.clearUserAuthorization('example-org');
    const r=await call(w,'github_admin_list_guided_settings',{scope:'user',max:100});
    const pinned=r.settings.find(s=>s.id==='user-pinned');
    expect(pinned).toMatchObject({url:null,identity:'not_verified'});
    expect(pinned.reason).toContain('not be inferred');
    expect(r.settings.find(s=>s.id==='user-password').url).toBe('https://github.com/settings/security');
    const invalid=await makeWorld({profile:'read_only'});
    const row=await invalid.db.getAccount('example-org');
    await invalid.db.setUserAuthorization('example-org',{
      userLogin:'bad/redirect',tokenEnc:row.user_token_enc,
      tokenExpiresAt:row.user_token_expires_at,refreshEnc:row.user_refresh_enc,
      refreshExpiresAt:row.user_refresh_expires_at});
    const bad=await call(invalid,'github_admin_list_guided_settings',{scope:'user',max:100});
    expect(bad.settings.find(s=>s.id==='user-pinned').url).toBeNull();
    expect(w.gh.calls).toHaveLength(0);
    expect(invalid.gh.calls).toHaveLength(0);
  });
  it('requires a personal-account U matching the enrolled account ID and name',async()=>{
    const w=await makeWorld({profile:'read_only',accounts:['example-person'],packageUser:true});
    const mismatch=await call(w,'github_admin_list_guided_settings',{scope:'user',max:100});
    expect(mismatch.settings.find(s=>s.id==='user-pinned').url).toBeNull();
    const row=await w.db.getAccount('example-person');
    await w.db.setUserAuthorization('example-person',{
      userLogin:'example-person',tokenEnc:row.user_token_enc,
      tokenExpiresAt:row.user_token_expires_at,refreshEnc:row.user_refresh_enc,
      refreshExpiresAt:row.user_refresh_expires_at});
    const bound=await call(w,'github_admin_list_guided_settings',{scope:'user',max:100});
    expect(bound.settings.find(s=>s.id==='user-pinned').url).toBe('https://github.com/example-person');
  });
  it('keeps developer spending bans out of completed-product purchase and destruction guidance',()=>{
    const rows=SETTINGS.filter(x=>['org-plan','org-marketplace','org-delete','user-sponsors','user-delete-account'].includes(x.id));
    expect(rows).toHaveLength(5);
    for(const item of rows){
      expect(item.expected).not.toMatch(/server (never|will never)/i);
      expect(item.expected).toMatch(/guide/i);
    }
    expect(SETTINGS.find(x=>x.id==='user-recovery-codes').expected).toMatch(/Never paste/i);
  });
});

describe('O-1 actual owner and security overview',()=>{
  it('categorizes verified service, organization and security state without a false all-clear',async()=>{
    const w=await makeWorld({profile:'read_only'});
    arrange(w);
    const r=await call(w,'github_admin_overview',{maxRepositories:10});
    expect(r.owner).toBe('example-org');
    expect(r.server).toMatchObject({production_enabled:false,spend_limit_cents:null,spend_limit_configured:false});
    expect(r.checks.find(c=>c.id==='server-spend')).toMatchObject({status:'ok',value:{limit_cents:null,limit_configured:false,spend_enabled:true}});
    expect(r.checks.find(c=>c.id==='require-2fa')).toMatchObject({status:'ok'});
    expect(r.checks.find(c=>c.id==='security-feature-coverage')).toMatchObject({status:'ok'});
    expect(r.checks.find(c=>c.id==='actions-token-rights')).toMatchObject({status:'ok'});
    expect(r.checks.find(c=>c.id==='billing-usage')).toMatchObject({status:'ok',value:{total_net_dollars:0,usage_items:0,complete:true,currency:'USD'}});
    expect(r.checks.find(c=>c.id==='sso')).toMatchObject({status:'not_available_on_plan'});
    expect(r.repo_inventory_complete).toBe(true);
    expect(w.gh.invalid).toEqual([]);
    expect(w.gh.calls.filter(c=>c.method!=='GET')).toHaveLength(0);
  });
  it('does not mislabel the legacy developer default $0 as an end-user spending prohibition',async()=>{
    expect(selectedSpendCap({spend_limit_cents:0,spend_limit_explicit:false}))
      .toMatchObject({configured:false,limitCents:null,newSpendingAllowedByCap:true});
    expect(selectedSpendCap({spend_limit_cents:0,spend_limit_explicit:true}))
      .toMatchObject({configured:true,limitCents:0,newSpendingAllowedByCap:false});
    // A positive historical cap is a preserved user restriction despite a
    // missing legacy explicit flag; do not silently drop it.
    expect(selectedSpendCap({spend_limit_cents:2500,spend_limit_explicit:false}))
      .toMatchObject({configured:true,limitCents:2500,newSpendingAllowedByCap:true});
    const w=await makeWorld({profile:'read_only'});arrange(w);
    const r=await call(w,'github_admin_overview',{maxRepositories:10});
    const spend=r.checks.find(x=>x.id==='server-spend');
    expect(spend.detail).toContain('No user-configured MCP spending cap');
    expect(spend.detail).not.toContain('Autonomous spending is $0');
    expect(w.gh.calls.every(x=>x.method==='GET')).toBe(true);
  });
  it('preserves an explicitly selected zero and positive end-user spending cap in owner reporting',async()=>{
    for(const limit of [0,2500]){
      const w=await makeWorld({profile:'read_only'});arrange(w);
      await w.db.setSpendLimitCents('example-org',limit);
      const r=await call(w,'github_admin_overview',{maxRepositories:10});
      expect(r.server).toMatchObject({spend_limit_configured:true,spend_limit_cents:limit});
      const spend=r.checks.find(x=>x.id==='server-spend');
      expect(spend.value).toMatchObject({limit_cents:limit,limit_configured:true,spend_enabled:limit>0});
      expect(spend.detail).toContain(limit===0?'explicit $0':'$25.00');
      expect(w.gh.calls.every(x=>x.method==='GET')).toBe(true);
    }
  });
  it('reads real provider billed usage for the selected UTC month rather than guessing unavailability',async()=>{
    const w=await makeWorld({profile:'read_only'});arrange(w);
    const month=new Date(w.ctx.now()).toISOString().slice(0,7);
    w.gh.when(routes.billing).reply(200,{usageItems:[
      {date:month+'-15T00:00:00Z',product:'Actions',netAmount:1.25,grossAmount:1.25,discountAmount:0}
    ]});
    const r=await call(w,'github_admin_overview',{maxRepositories:10});
    expect(r.checks.find(x=>x.id==='billing-usage')).toMatchObject({
      status:'ok',value:{period_utc:month,total_net_dollars:1.25,usage_items:1,complete:true,currency:'USD'}});
    expect(w.gh.calls.some(x=>x.route===routes.billing&&x.method==='GET')).toBe(true);
    expect(w.gh.calls.every(x=>x.method==='GET')).toBe(true);
    expect(w.gh.invalid).toEqual([]);
  });
  it('never turns a denied, malformed or wrong-period bill into an apparent $0 balance',async()=>{
    const month=new Date((await makeWorld({profile:'read_only'})).ctx.now()).toISOString().slice(0,7);
    const cases=[
      {status:403,body:{message:'Resource not accessible by integration'}},
      {status:200,body:{}},
      {status:200,body:{usageItems:[{date:'2020-01-01',product:'Actions',netAmount:7}]}},
      {status:200,body:{usageItems:[{date:month+'-01',product:'Actions',netAmount:null}]}}
    ];
    for(const test of cases){
      const w=await makeWorld({profile:'read_only'});arrange(w);
      w.gh.when(routes.billing).reply(test.status,test.body);
      const r=await call(w,'github_admin_overview',{maxRepositories:10});
      expect(r.checks.find(x=>x.id==='billing-usage')).toMatchObject({status:'not_readable'});
      expect(w.gh.calls.every(x=>x.method==='GET')).toBe(true);
    }
  });
  it('identifies missing 2FA, scanning and write-capable keys as attention, not permission denial',async()=>{
    const w=await makeWorld({profile:'read_only'});
    arrange(w,{twoFactor:false,scanning:'disabled',token:'write',writeKey:true});
    const r=await call(w,'github_admin_review_security',{maxRepositories:10});
    expect(r.summary.needs_attention).toBeGreaterThanOrEqual(3);
    expect(r.priority_actions.some(x=>x.check==='security-feature-coverage')).toBe(true);
    expect(r.priority_actions.some(x=>x.check==='write-capable-deploy-keys')).toBe(true);
    expect(r.checks.find(x=>x.id==='actions-token-rights')).toMatchObject({status:'needs_attention'});
    expect(w.gh.invalid).toEqual([]);
  });
  it('keeps GitHub API refusal as not_readable without fabricating complete coverage',async()=>{
    const w=await makeWorld({profile:'read_only'});
    arrange(w);
    w.gh.when(routes.keys).reply(403,{message:'Resource not accessible'});
    const r=await call(w,'github_admin_overview',{maxRepositories:10});
    expect(r.checks.find(x=>x.id==='write-capable-deploy-keys')).toMatchObject({
      status:'not_readable'});
    expect(r.summary.not_readable).toBeGreaterThan(0);
    expect(w.gh.calls.filter(c=>c.method!=='GET')).toHaveLength(0);
  });
});

describe('O-1 enrolled personal authority read',()=>{
  const personal=out=>out.checks.find(x=>x.area==='personal');
  it('uses genuine U associated with an org and exposes minimal verified status only',async()=>{
    const w=await makeWorld({profile:'read_only'});arrange(w);
    w.gh.when('GET /user').reply(200,{id:1,login:'EXAMPLE-OWNER',type:'User',two_factor_authentication:true,plan:{name:'free'},email:'private@example.test',bio:'private text',token:'ghu_FAKEprivateProfileValue'});
    const out=await call(w,'github_admin_overview');
    expect(personal(out)).toMatchObject({id:'personal-account',status:'ok',value:{id:1,login:'EXAMPLE-OWNER',two_factor_authentication:true,plan:'free'}});
    const reads=w.gh.calls.filter(x=>x.route==='GET /user');expect(reads).toHaveLength(1);
    expect(reads[0].headers.authorization).toBe('token ghu_FAKE0123456789abcdefghij');
    expect(JSON.stringify(out)).not.toMatch(/private@example|private text|privateProfileValue/);
    expect(w.gh.calls.every(x=>x.method==='GET')).toBe(true);expect(w.gh.invalid).toEqual([]);
  });
  it('keeps withheld personal settings unknown instead of treating them as false',async()=>{
    const w=await makeWorld({profile:'read_only'});arrange(w);
    w.gh.when('GET /user').reply(200,{id:1,login:'example-owner',type:'User'});
    const out=personal(await call(w,'github_admin_overview'));
    expect(out).toMatchObject({status:'ok',value:{two_factor_authentication:null,plan:null}});
    expect(out.detail).toContain('Omitted personal settings remain unknown');
  });
  it('uses U for a personal enrolled account without pretending it is an organization',async()=>{
    const w=await makeWorld({profile:'read_only'});
    await w.db.upsertAccount({login:'example-org',accountId:1011,accountType:'User',label:'Personal'});
    w.gh.when('GET /user').reply(200,{id:1011,login:'example-org',type:'User',two_factor_authentication:false});
    const out=await call(w,'github_admin_overview');
    expect(out.account_type).toBe('User');
    expect(personal(out)).toMatchObject({id:'personal-status',status:'ok',value:{login:'example-org',two_factor_authentication:false}});
    expect(w.gh.calls.map(x=>x.route)).toEqual(['GET /user']);
  });
  it('does not request any personal provider data without U or fall back to I',async()=>{
    const w=await makeWorld({profile:'read_only'});arrange(w);await w.db.clearUserAuthorization('example-org');
    const out=personal(await call(w,'github_admin_overview'));
    expect(out.status).toBe('not_readable');expect(out.reason).toContain('Authorize as me');
    expect(w.gh.calls.some(x=>x.route==='GET /user')).toBe(false);
  });
  it.each([401,403])('preserves provider HTTP %i as unreadable without credential fallback',async status=>{
    const w=await makeWorld({profile:'read_only'});arrange(w);
    w.gh.when('GET /user').reply(status,{message:'Not authorized'});
    expect(personal(await call(w,'github_admin_overview'))).toMatchObject({status:'not_readable',reason:expect.stringContaining('HTTP '+status)});
    expect(w.gh.calls.filter(x=>x.route==='GET /user')).toHaveLength(1);
  });
  it.each([{id:1,login:'example-owner'},{id:1,login:'example-owner',type:''},{id:2,login:'outsider',type:'User'},{id:1,login:'example-owner',type:'Organization'},{login:'example-owner'},{id:0,login:'example-owner'}])('refuses mismatched or unverifiable user identity: %j',async user=>{
    const w=await makeWorld({profile:'read_only'});arrange(w);w.gh.when('GET /user').reply(200,user);
    expect(personal(await call(w,'github_admin_overview'))).toMatchObject({status:'not_readable',reason:expect.stringContaining('does not match')});
  });
  it('refuses a personal account whose provider numeric identity differs from enrollment',async()=>{
    const w=await makeWorld({profile:'read_only'});
    await w.db.upsertAccount({login:'example-org',accountId:1011,accountType:'User',label:'Personal'});
    w.gh.when('GET /user').reply(200,{id:9999,login:'example-org',type:'User'});
    expect(personal(await call(w,'github_admin_overview')).status).toBe('not_readable');
  });
});
