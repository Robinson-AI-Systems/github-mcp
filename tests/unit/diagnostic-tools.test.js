import { describe, expect, it } from 'vitest';
import { handlers, tools, compareArea } from '../../src/tools/server-diagnostics.js';
import { AREAS, LEVELS } from '../../src/data/permission-needs.js';
import { SETTINGS, findSettings, fill } from '../../src/data/dashboard-map.js';
import { MANIFEST_PERMISSIONS } from '../../src/github/app-manifest.js';
import { parseCatalog } from '../../scripts/check-writes.mjs';
import { makeWorld, parse } from '../../test/helpers/write-contract.js';
import fs from 'node:fs';
import {effectiveToolAccess,documentedOperationAccess,accessRecovery,additionalCredentialHandoff} from '../../src/github/effective-access.js';
import {optionalCredentialIdentityStatus} from '../../src/github/optional-identity-status.js';
import {registry} from '../../src/tools/index.js';
import {createGithubPolicy} from '../../src/oauth/policy.js';
import {createDispatch} from '../../src/tools/dispatch.js';

const CATALOG = parseCatalog(fs.readFileSync(new URL('../../docs/TOOL-CATALOG.md', import.meta.url), 'utf8'));
const SECRET = [/gh[pousr]_[A-Za-z0-9]{8,}/, /github_pat_[A-Za-z0-9_]{8,}/];
const call = async (name, w, args) => {
  const r = await handlers[name](args, w.ctx);
  return r?.content ? parse(r) : r;
};

async function appWorld(permissions, extra = {}) {
  const w = await makeWorld({ profile: 'read_only', accounts: ['example-org', 'example-user'], ...extra });
  await w.db.upsertAccount({ login: 'example-org', accountId: 1001, accountType: 'Organization', label: 'Example', credentialKind: 'app', appId: 5150 });
  await w.db.setInstallation('example-org', { installationId: 777, repositorySelection: 'all', permissions, status: 'active' });
  return w;
}

describe('permission needs data', () => {
  it('names only permissions the App manifest asks for, at levels the manifest grants', () => {
    const ids = new Set();
    for (const area of AREAS) {
      expect(ids.has(area.id), area.id).toBe(false);
      ids.add(area.id);
      for (const [permission, need] of Object.entries(area.needs)) {
        expect(MANIFEST_PERMISSIONS[permission], `${area.id}: ${permission}`).toBeDefined();
        expect(LEVELS[need], `${area.id}: ${permission}`).toBeLessThanOrEqual(LEVELS[MANIFEST_PERMISSIONS[permission]]);
      }
    }
  });
  it('compares levels (write covers read, none covers nothing)', () => {
    const area = { needs: { contents: 'write', metadata: 'read' } };
    expect(compareArea(area, { contents: 'write', metadata: 'write' })).toEqual([]);
    expect(compareArea(area, { contents: 'read' })).toEqual([{ permission: 'contents', needed: 'write', granted: 'read' }, { permission: 'metadata', needed: 'read', granted: 'none' }]);
  });
});

describe('github_check_permissions', () => {
  it('separates complete App grants from the unverified package credential capability', async () => {
    const w = await appWorld({ ...MANIFEST_PERMISSIONS });
    const out = await call('github_check_permissions', w, { account: 'example-org' });
    expect(out.accounts[0]).toMatchObject({ login: 'example-org', status: 'capability unverified', areas_missing: 0, areas_unverified: 1, areas_ok: AREAS.length - 1 });
    expect(out.checked_areas).toBe(AREAS.length);
  });
  it('names the exact permission to add and where to add it', async () => {
    const w = await appWorld({ metadata: 'read', contents: 'write', issues: 'read' });
    const out = await call('github_check_permissions', w, { account: 'example-org' });
    const acct = out.accounts[0];
    expect(acct.status).toBe('permissions missing');
    expect(acct.add_these).toContain('pull_requests: write (now none)');
    expect(acct.add_these).toContain('issues: write (now read)');
    expect(acct.add_these.join()).not.toContain('contents');
    expect(acct.how).toContain('https://github.com/organizations/example-org/settings/installations/777');
    expect(acct.areas.find((a) => a.area === 'pull-requests').missing).toEqual([{ permission: 'pull_requests', needed: 'write', granted: 'none' }]);
    const one = await call('github_check_permissions', w, { account: 'example-org', area: 'content' });
    expect(one).toMatchObject({ checked_areas: 1 });
    expect(one.accounts[0].status).toBe('all good');
    const full = await call('github_check_permissions', w, { account: 'example-org', area: 'issues', detail: 'full' });
    expect(full.accounts[0].areas[0]).toMatchObject({ area: 'issues', ok: false });
  });
  it('names the packages, runner and merge-queue gaps for an installation created before Y-1, and never calls a missing permission ok', async () => {
    const { packages, organization_self_hosted_runners, merge_queues, ...older } = MANIFEST_PERMISSIONS; // eslint-disable-line no-unused-vars
    const w = await appWorld(older);
    const out = await call('github_check_permissions', w, { account: 'example-org' });
    const acct = out.accounts[0];
    expect(acct.status).toBe('permissions missing');
    expect(acct.add_these).toEqual(expect.arrayContaining(['organization_self_hosted_runners: write (now none)', 'merge_queues: write (now none)']));
    expect(acct.areas.map((a) => a.area)).toEqual(expect.arrayContaining(['packages', 'runners', 'merge-queue']));
    expect((await call('github_check_permissions', w, { account: 'example-org', area: 'packages' })).accounts[0].status).toBe('capability unverified');
  });
  it.each(['brief', 'full'])('accepts package grants but keeps runtime capability unverified without requesting impossible consent (%s)', async (detail) => {
    const w = await appWorld({ packages: 'write' });
    const out = await call('github_check_permissions', w, { account: 'example-org', area: 'packages', detail });
    expect(out).toMatchObject({ checked_areas: 1, accounts: [{
      login: 'example-org', status: 'capability unverified', areas_ok: 0, areas_missing: 0, areas_unverified: 1,
      areas: [{ area: 'packages', capability: 'unverified', missing: [], note: expect.stringContaining('classic package token') }]
    }] });
    if (detail === 'full') expect(out.accounts[0].areas[0]).toMatchObject({ permissions_ok: true, ok: false });
    expect(out.accounts[0]).not.toHaveProperty('add_these');
    expect(out.accounts[0]).not.toHaveProperty('how');
  });
  it.each([{}, { packages: 'read' }, { organization_packages: 'write' }])(
    'still refuses to mark an unavailable or insufficient packages grant as ready: %j', async (permissions) => {
      // Include metadata so absent packages is a known permission map rather than an unrecorded installation.
      const w = await appWorld({ metadata: 'read', ...permissions });
      const acct = (await call('github_check_permissions', w, { account: 'example-org', area: 'packages' })).accounts[0];
      expect(acct.status).toBe('capability unverified');
      expect(acct).not.toHaveProperty('add_these');
      expect(acct.areas[0].missing).toEqual([]);
      expect(acct.areas[0].note).toContain('classic package token');
    });
  it('explains fine-grained, not-installed, and unknown cases instead of guessing', async () => {
    const w = await appWorld({});
    const all = await call('github_check_permissions', w, {});
    const byLogin = Object.fromEntries(all.accounts.map((a) => [a.login, a]));
    expect(byLogin['example-user'].status).toBe('fine-grained token');
    expect(byLogin['example-org'].status).toBe('unknown');
    await w.db.setInstallationStatus('example-org', 'suspended');
    expect((await call('github_check_permissions', w, { account: 'example-org' })).accounts[0].status).toBe('not installed');
  });
  it('rejects an unknown area and an account outside the connection', async () => {
    const w = await appWorld({ ...MANIFEST_PERMISSIONS });
    await expect(call('github_check_permissions', w, { area: 'nope' })).rejects.toThrow(/Unknown area/);
    await expect(call('github_check_permissions', w, { account: 'other-org' })).rejects.toThrow(/not one of the GitHub accounts/);
  });
});

describe('CAP-2 Standard Full diagnosis without token or permission escalation',()=>{
  const tool={name:'github_test_write',writes:true,profiles:['full'],declarations:{cred:'I',production:'always'}};
  it('shows ordinary Full in owner sign-in without changing the Everyday default or production gate',()=>{
    const policy=createGithubPolicy({env:{VERCEL_ENV:'production'}});
    const account={login:'example-org',label:'Example',is_default:true,production_enabled:false};
    const html=policy.page({params:{mode:'preview'},choices:[account],client:{client_name:'ChatGPT'}});
    expect(html).toContain('Full — every operation allowed by your real GitHub grant and user policy');
    expect(html).toContain('no God Mode or extra token is required');
    expect(html).toContain('value="everyday" selected');
    expect(html).not.toContain('value="full" selected');
    const args={'acct:example-org':'on',default_account:'example-org',mode:'preview',profile:'full',listing:'compact'};
    expect(policy.validate({params:args,choices:[account]}).settings.profile).toBe('full');
    expect(policy.validate({params:{...args,mode:'production'},choices:[account]}).settings.mode).toBe('production');
  });
  it('never confuses stored credentials with verified grants or silently widens a scope',()=>{
    const account={login:'example-org',credential_kind:'app',app_id:500,installation_id:501,
      installation_status:'active',repository_selection:'selected',has_user_token:false};
    const c={accounts:['example-org'],profile:'read_only',mode:'preview'};
    const denied=effectiveToolAccess({connection:c,account,tool});
    expect(denied.refusedBy).toEqual(['profile','mode']);
    expect(denied.credential.state).toBe('stored-unverified');
    expect(denied.resource.state).toBe('not-enumerated');
    const full=effectiveToolAccess({connection:{...c,profile:'full',mode:'production'},account,tool});
    expect(full.status).toBe('unverified');
    expect(full.permissionProof).toBe('not-performed');
    const user=effectiveToolAccess({connection:{...c,profile:'full'},account,
      tool:{...tool,declarations:{cred:'U',production:'never'}}});
    expect(user.refusedBy).toEqual(['credential']);
    expect(()=>effectiveToolAccess({connection:c,account:{...account,login:'foreign'},tool})).toThrow(/not in this connection/);
  });
  it('routes a source-layer refusal identically by direct, MCP dispatcher and github_call',async()=>{
    const w=await appWorld({metadata:'read'});
    const ctx={...w.ctx,registry};
    const args={account:'example-org',tool:'github_pr_merge'};
    const direct=await handlers.github_check_permissions(args,ctx);
    expect(direct.accounts[0].effective_access.refusedBy).toContain('profile');
    expect(direct.checked_areas).toBe(1);
    const dispatch=createDispatch({env:w.ctx.env,credentials:w.credentials,fetch:w.gh.fetch});
    const plain=await dispatch({registry,name:'github_check_permissions',args,connection:w.connection,db:w.db});
    expect(plain.structuredContent.checked_areas).toBe(1);
    expect(parse(plain).accounts[0].effective_access.refusedBy).toContain('profile');
    const meta=await dispatch({registry,name:'github_call',args:{name:'github_check_permissions',args},
      connection:w.connection,db:w.db});
    expect(parse(meta).accounts[0].effective_access.refusedBy).toContain('profile');
    expect(w.gh.calls).toEqual([]);
    await expect(handlers.github_check_permissions({account:'foreign',tool:'github_pr_merge'},ctx)).rejects.toThrow(/not one/);
  });
});

describe('CAP-2 operation evidence without permission inflation',()=>{
  it('separates documented token support from effective provider execution',()=>{
    const account={login:'example-org',credential_kind:'app',installation_status:'active'};
    const repo=documentedOperationAccess({account,route:'GET /repos/{owner}/{repo}'});
    expect(repo).toMatchObject({documentation:'operation-reviewed',
      I:{credentialType:'app_installation',documentation:'supported',grantedToThisConnection:'not-proven'},
      U:{documentation:'supported'},otherCredential:null,
      matchingToolDispatch:'not-verified',effectiveProviderExecution:'not-verified'});
    expect(repo.I.requiredPermissions).toEqual(['repository:metadata:read']);
    expect(repo.restrictedKinds.K).toContain('never an API fallback');
    const app=documentedOperationAccess({account,route:'GET /app'});
    expect(app).toMatchObject({I:{documentation:'unsupported'},U:{documentation:'unsupported'},
      otherCredential:{credentialType:'app_jwt',documentation:'supported'}});
    const fine=documentedOperationAccess({account:{...account,credential_kind:'fine_grained'},route:'GET /user'});
    expect(fine.I.credentialType).toBe('fine_grained_pat');
    const unreviewed=documentedOperationAccess({account,route:'GET /unreviewed'});
    expect(unreviewed).toMatchObject({documentation:'unknown',I:{documentation:'unknown'},
      effectiveProviderExecution:'not-verified'});
  });
  it('only reports exact pinned routes for one connection-selected account, never contacting GitHub',async()=>{
    const w=await appWorld({...MANIFEST_PERMISSIONS});
    const args={account:'example-org',tool:'github_repo_get',operation:'GET /repos/{owner}/{repo}'};
    const result=await handlers.github_check_permissions(args,w.ctx);
    expect(result.checked_areas).toBe(1);
    expect(result.accounts[0].operation_evidence.I.documentation).toBe('supported');
    expect(result.accounts[0].operation_evidence.effectiveProviderExecution).toBe('not-verified');
    expect(w.gh.calls).toHaveLength(0);
    await expect(handlers.github_check_permissions({operation:args.operation},w.ctx))
      .rejects.toThrow(/select one connection account/);
    await expect(handlers.github_check_permissions({...args,account:'foreign'},w.ctx))
      .rejects.toThrow(/not one of the GitHub accounts/);
    await expect(handlers.github_check_permissions({...args,operation:'GET /nonexistent-route'},w.ctx))
      .rejects.toThrow(/absent from pinned/);
  });
});

describe('CAP-2 explicit recovery without secret or privilege mutation',()=>{
  const tool={name:'github_sensitive_write',area:'repo',writes:true,
    profiles:['full'],declarations:{cred:'I',production:'always'}};
  const account={login:'example-org',account_type:'Organization',credential_kind:'app',
    app_id:10,installation_id:11,installation_status:'active',repository_selection:'selected'};
  const connection={accounts:['example-org'],profile:'everyday',mode:'preview'};
  it('separately identifies connection, installation permissions and production approval',()=>{
    const missing=[{permission:'administration',needed:'write',granted:'read'}];
    const r=accessRecovery({connection,account,tool,missingPermissions:missing});
    expect(r.verified).toBe(false);
    expect(r.capability).toBe('not-tested');
    expect(r.requiresUserConsent).toBe(true);
    expect(r.actions.map(x=>x.layer)).toEqual([
      'connection-profile','github-installation-permissions','production-mode','repository-selection']);
    expect(r.actions[1].missing).toEqual(missing);
    expect(r.actions[1].documentation).toContain('approving-updated-permissions');
    expect(r.recheck).toMatchObject({tool:'github_check_permissions',account:'example-org',
      registeredTool:'github_sensitive_write'});
    expect(JSON.stringify(r)).not.toMatch(/gh[pousr]_[A-Za-z0-9]{8,}/);
  });
  it('never offers K or P as fallback; unreviewed source remains unverified',()=>{
    const u={...tool,declarations:{cred:'U',production:'never'}};
    const r=accessRecovery({connection:{...connection,profile:'full'},account,tool:u});
    expect(r.actions[0].action).toBe('explicit-github-user-authorization');
    const p=accessRecovery({connection:{...connection,profile:'full'},account,
      tool:{...tool,declarations:{cred:'P',production:'never'}}});
    expect(p.actions[0].action).toBe('protected-setup-only');
    const denied=accessRecovery({connection:{...connection,profile:'full'},account,tool,
      operation:documentedOperationAccess({account,route:'GET /app'})});
    expect(denied.actions.map(x=>x.action)).toContain('no-supported-standard-token-proven');
    expect(denied.verified).toBe(false);
  });
  it('carries bounded recovery via real handler and nested meta call without provider side effects',async()=>{
    const w=await appWorld({metadata:'read'});
    const args={account:'example-org',tool:'github_pr_merge',operation:'GET /repos/{owner}/{repo}'};
    const reg=await handlers.github_check_permissions(args,w.ctx);
    expect(reg.accounts[0].recovery.verified).toBe(false);
    expect(reg.accounts[0].recovery.recheck.registeredTool).toBe('github_pr_merge');
    const dispatch=createDispatch({env:w.ctx.env,credentials:w.credentials,fetch:w.gh.fetch});
    const out=await dispatch({registry,name:'github_check_permissions',args,connection:w.connection,db:w.db});
    expect(parse(out).accounts[0].recovery.capability).toBe('not-tested');
    const viaMeta=await dispatch({registry,name:'github_call',
      args:{name:'github_check_permissions',args},connection:w.connection,db:w.db});
    expect(parse(viaMeta).accounts[0].recovery.verified).toBe(false);
    expect(w.gh.calls).toEqual([]);
  });
});

describe('CAP-3 owner optional-kind status cannot claim endpoint authorization',()=>{
  it('never exposes optional owner evidence on private-tenant or pass diagnostic paths',async()=>{
    const w=await appWorld({metadata:'read'});
    const original=w.db.additionalCredentialProofs;
    let calls=0;
    w.db.additionalCredentialProofs=async()=>{calls++;return {P:{version:1}};};
    try{
      const args={account:'example-org',tool:'github_pr_merge'};
      const viaPass=await handlers.github_check_permissions(args,{
        ...w.ctx,connection:{...w.connection,pass:true}
      });
      expect(viaPass.accounts[0].optional_credentials).toBeUndefined();
      const tenant=await handlers.github_check_permissions(args,{
        ...w.ctx,credentials:{...w.credentials,operationAuthority:async()=>({})}
      });
      expect(tenant.accounts[0].optional_credentials).toBeUndefined();
      expect(calls).toBe(0);
    }finally{w.db.additionalCredentialProofs=original;}
  });
  it('separates a matching encrypted fingerprint and identity from actual permission',async()=>{
    const {createHash}=await import('node:crypto');
    const account={account_id:901,package_enc:'sealed-package-value'};
    const proof={version:1,kind:'P',host:'github.com',scope:'legacy-owner',
      actorId:4001,accountId:901,verification:'identity-only',
      fingerprint:createHash('sha256').update(account.package_enc).digest('hex')};
    const good=optionalCredentialIdentityStatus({account,proofs:{P:proof}});
    expect(good.P).toMatchObject({stored:true,identity:'verified-at-enrollment',
      operationPermission:'not-proven'});
    expect(good.K).toMatchObject({stored:false,identity:'unverified'});
    const stale=optionalCredentialIdentityStatus({account:{
      ...account,package_enc:'different-encrypted-value'},proofs:{P:proof}});
    expect(stale.P.identity).toBe('unverified');
    expect(optionalCredentialIdentityStatus({account,proofs:{
      P:{...proof,scope:'tenant-b'}}}).P.identity).toBe('unverified');
    expect(optionalCredentialIdentityStatus({account,proofs:{
      P:{...proof,expiresAt:new Date(0).toISOString()}}}).P.identity).toBe('unverified');
    expect(JSON.stringify(good)).not.toContain('sealed-package-value');
    const readback={...proof,verification:'identity-and-capability-readback',
      operation:'GET /orgs/{org}/packages',resource:'org/901',scopes:['read:packages']};
    const observed=optionalCredentialIdentityStatus({account,proofs:{P:readback}});
    expect(observed.P).toMatchObject({identity:'verified-at-enrollment',
      operationPermission:'observed-for-read-at-enrollment',
      documentedRead:'GET /orgs/{org}/packages'});
    expect(optionalCredentialIdentityStatus({account,proofs:{P:{
      ...readback,operation:'DELETE /orgs/{org}/packages'}}}).P.identity).toBe('unverified');
  });
});

describe('CAP-3 exact-operation protected setup handoff without credential exchange',()=>{
  const account={login:'example-org'};
  const ownerContext=true,origin='https://mcp.example.test';
  it('offers classic K only for reviewed classic-only notifications',()=>{
    const x=additionalCredentialHandoff({account,operation:'GET /notifications',
      origin,ownerContext});
    expect(x).toMatchObject({status:'protected-setup',kind:'K',
      setupUrl:'https://mcp.example.test/api/github/setup',
      automaticProviderIssuance:false,grantVerified:false,account:'example-org'});
    expect(x.instructions).toContain('never paste the token into chat');
    expect(JSON.stringify(x)).not.toMatch(/gh[pousr]_[A-Za-z0-9]{8,}/);
  });
  it('does not gate Standard App package support behind optional token setup',()=>{
    const x=additionalCredentialHandoff({account,
      operation:'GET /orgs/{org}/packages',origin,ownerContext});
    expect(x).toMatchObject({status:'standard-supported',
      effectivePermission:'not-verified'});
    expect(x.setupUrl).toBeUndefined();
    expect(additionalCredentialHandoff({account,operation:'GET /not-reviewed',
      origin,ownerContext}).status).toBe('unverified');
  });
  it('appears in direct and nested meta diagnostics without leaking a bearer',async()=>{
    const w=await appWorld({metadata:'read'});
    const env={...w.ctx.env,PUBLIC_BASE_URL:'https://mcp.example.test'};
    const args={account:'example-org',tool:'github_repo_get',
      operation:'GET /notifications'};
    const direct=await handlers.github_check_permissions(args,{...w.ctx,env});
    expect(direct.accounts[0].additional_setup).toMatchObject({
      status:'protected-setup',kind:'K',setupUrl:'https://mcp.example.test/api/github/setup'});
    const dispatch=createDispatch({env,credentials:w.credentials,fetch:w.gh.fetch});
    const normal=await dispatch({registry,name:'github_check_permissions',
      args,connection:w.connection,db:w.db});
    const nested=await dispatch({registry,name:'github_call',
      args:{name:'github_check_permissions',args},connection:w.connection,db:w.db});
    for(const reply of [normal,nested]){
      expect(parse(reply).accounts[0].additional_setup).toMatchObject({
        status:'protected-setup',kind:'K'});
    }
    expect(w.gh.calls).toEqual([]);
    const record=await w.db.getAccount('example-org');
    const {createHash}=await import('node:crypto');
    const enc='sealed-fixture-notification-value';
    await w.db.setClassicToken(record.login,{enc,scopes:['notifications'],last4:'last'});
    expect(await w.db.bindAdditionalCredentialProof({
      login:record.login,kind:'K',expectedCipher:enc,
      proof:{version:1,kind:'K',host:'github.com',scope:'legacy-owner',
        actorId:4201,accountId:record.account_id,
        fingerprint:createHash('sha256').update(enc).digest('hex'),
        verification:'identity-and-capability-readback',
        operation:'GET /notifications',resource:'user/4201',scopes:['notifications']}
    })).toBe(true);
    const after=await handlers.github_check_permissions(args,{...w.ctx,env});
    expect(after.accounts[0].additional_setup).toMatchObject({
      status:'read-observed-at-enrollment',kind:'K'});
    expect(after.accounts[0].additional_setup.note).toContain('NOT been rechecked');
    expect(w.gh.calls).toEqual([]);
    const tenant=await handlers.github_check_permissions(args,{
      ...w.ctx,env,credentials:{...w.credentials,operationAuthority:async()=>({})}
    });
    expect(tenant.accounts[0].additional_setup.status).toBe('not-offered');
    const pass=await handlers.github_check_permissions(args,{
      ...w.ctx,env,connection:{...w.connection,pass:true}
    });
    expect(pass.accounts[0].additional_setup.status).toBe('not-offered');
  });
  it('refuses foreign origin, service pass and private tenant access to owner forms',()=>{
    for(const x of ['http://mcp.example.test','https://user:pass@mcp.example.test',
      'https://mcp.example.test/other','https://mcp.example.test?code=secret',
      'https://mcp.example.test:4444']){
      const out=additionalCredentialHandoff({account,operation:'GET /notifications',
        origin:x,ownerContext});
      expect(out.status).toBe('configuration-needed');
      expect(out.setupUrl).toBeUndefined();
    }
    expect(additionalCredentialHandoff({account,operation:'GET /notifications',
      origin,ownerContext:false})).toMatchObject({status:'not-offered'});
  });
});

describe('github_rate_status', () => {
  const live = { resources: { core: { limit: 5000, used: 12, remaining: 4988, reset: 1_790_000_000 }, graphql: { limit: 5000, used: 0, remaining: 5000, reset: 1_790_000_000 }, search: { limit: 30, used: 1, remaining: 29, reset: 1_790_000_000 }, scim: { limit: 1, used: 0, remaining: 1, reset: 1_790_000_000 } } };
  it('shows what the server last saw, a block in force, and the live numbers', async () => {
    const w = await makeWorld({ profile: 'read_only' });
    await w.db.recordRateState({ account: 'example-org', resource: 'core', remaining: 0, resetAt: new Date(Date.now() + 600_000), blockedUntil: new Date(Date.now() + 600_000) });
    w.gh.when('GET /rate_limit').reply(200, live);
    const out = await call('github_rate_status', w, { account: 'example-org' });
    const acct = out.accounts[0];
    expect(acct.last_seen.core.remaining).toBe(0);
    expect(acct.blocked[0]).toMatch(/^core until /);
    expect(acct.live.core).toMatchObject({ limit: 5000, remaining: 4988 });
    expect(acct.live).not.toHaveProperty('scim');
    const full = await call('github_rate_status', w, { account: 'example-org', detail: 'full' });
    expect(full.accounts[0].live).toHaveProperty('scim');
  });
  it('can skip the live call, and reports (does not throw) when GitHub cannot be asked', async () => {
    const w = await makeWorld({ profile: 'read_only' });
    expect((await call('github_rate_status', w, { live: false })).accounts[0]).not.toHaveProperty('live');
    w.gh.when('GET /rate_limit').reply(500, { message: 'boom' });
    const out = await call('github_rate_status', w, {});
    expect(out.accounts[0].live_unavailable).toContain('could not be asked');
    expect(JSON.stringify(out)).not.toMatch(SECRET[0]);
  });
  it('reports a missing credential plainly and refuses an outside account', async () => {
    const w = await makeWorld({ profile: 'read_only', accounts: ['example-org', 'bare-org'] });
    await w.db.upsertAccount({ login: 'bare-org', accountId: 9, accountType: 'Organization', label: 'Bare', credentialKind: 'app' });
    const out = await call('github_rate_status', w, { account: 'bare-org' });
    expect(out.accounts[0].live_unavailable).toContain('No GitHub credential');
    await expect(call('github_rate_status', w, { account: 'elsewhere' })).rejects.toThrow(/not one of the GitHub accounts/);
  });
});

describe('github_where_is_setting', () => {
  it('finds a setting by plain words and fills in the organization', async () => {
    const w = await makeWorld({ profile: 'read_only' });
    const out = await call('github_where_is_setting', w, { query: 'how do I require two-factor?' });
    const s = out.settings[0];
    expect(s.setting).toContain('two-factor');
    expect(s.url).toBe('https://github.com/organizations/example-org/settings/security');
    expect(s.steps[0]).toMatchObject({ n: 1 });
    expect(s.verifyWith).toMatchObject({ tool: 'github_admin_check_setting', args: { owner: 'example-org', settingId: 'org-require-2fa', expectedBoolean: true }, field: 'verified', equals: true });
    const named = await call('github_where_is_setting', w, { query: '2fa', org: 'example-org' });
    expect(named.settings[0].url).toContain('/organizations/example-org/');
  });
  it('says when there is a read-back and when there is none', async () => {
    const w = await makeWorld({ profile: 'read_only' });
    const pw = (await call('github_where_is_setting', w, { query: 'change my password' })).settings[0];
    expect(pw.verifyWith).toBeNull();
    expect(pw.check).toContain('tell me when it is done');
    expect(pw.url).toBe('https://github.com/settings/security');
  });
  it('uses the selected enrolled personal identity for user-profile links and no other org', async()=>{
    const w=await makeWorld({profile:'read_only',accounts:['example-org','alternate-account']});
    const row=await w.db.getAccount('alternate-account');
    await w.db.setUserAuthorization('alternate-account',{
      userLogin:'another-owner',tokenEnc:row.user_token_enc,
      tokenExpiresAt:row.user_token_expires_at,refreshEnc:row.user_refresh_enc,
      refreshExpiresAt:row.user_refresh_expires_at});
    const first=await call('github_where_is_setting',w,{query:'pinned repositories'});
    expect(first.settings.find(s=>s.scope==='user').url).toBe('https://github.com/example-owner');
    const chosen=await call('github_where_is_setting',w,{query:'pinned repositories',org:'alternate-account'});
    expect(chosen.settings.find(s=>s.scope==='user').url).toBe('https://github.com/another-owner');
    expect(JSON.stringify(chosen.settings)).not.toContain('https://github.com/alternate-account');
    expect(w.gh.calls).toHaveLength(0);
  });
  it('withholds profile links instead of using the organization when personal U is absent',async()=>{
    const w=await makeWorld({profile:'read_only'});
    await w.db.clearUserAuthorization('example-org');
    const out=await call('github_where_is_setting',w,{query:'pinned repositories'});
    expect(out.settings.find(s=>s.scope==='user')).toMatchObject({
      url:null,identity:'not_verified',reason:expect.stringContaining('not be inferred')
    });
    const org=await call('github_where_is_setting',w,{query:'require two-factor'});
    expect(org.settings.find(s=>s.scope==='org').url).toContain('organizations/example-org/');
    expect(w.gh.calls).toHaveLength(0);
  });
  it('admits when nothing matches and refuses an empty query or an outside organization', async () => {
    const w = await makeWorld({ profile: 'read_only' });
    const none = await call('github_where_is_setting', w, { query: 'zzzz qqqq' });
    expect(none.found).toBe(0);
    expect(none.try_words.length).toBeGreaterThan(0);
    await expect(call('github_where_is_setting', w, { query: '  ' })).rejects.toThrow(/Say which setting/);
    await expect(call('github_where_is_setting', w, { query: '2fa', org: 'elsewhere' })).rejects.toThrow(/not one of the GitHub accounts/);
  });
});

describe('the dashboard map', () => {
  it('has unique ids, https links, numbered-able steps, an expected result, and only real catalog tools for read-backs', () => {
    const ids = new Set();
    for (const s of SETTINGS) {
      expect(ids.has(s.id)).toBe(false);
      ids.add(s.id);
      expect(s.url, s.id).toMatch(/^https:\/\/github\.com\//);
      expect(s.steps.length, s.id).toBeGreaterThan(0);
      for (const step of s.steps) expect(step.action && step.target, s.id).toBeTruthy();
      expect(s.expected, s.id).toBeTruthy();
      expect(['org', 'user', 'repo']).toContain(s.scope);
      if (s.verifyWith) expect(CATALOG.has(s.verifyWith.tool), `${s.id}: ${s.verifyWith.tool}`).toBe(true);
    }
  });
  it('covers each thing the catalog says GitHub has no API for', () => {
    const covered = ['two-factor', 'saml', 'plan', 'marketplace', 'password', 'oauth', 'token policy', 'copilot', 'notification email', 'security log', 'sponsors', 'delete', 'transfer', 'reminders', 'interaction'];
    for (const word of covered) expect(findSettings(word).length, word).toBeGreaterThan(0);
  });
  it('fills only the placeholders it knows and leaves the rest', () => {
    expect(fill({ a: ['{org}/x', '{user}'], b: 1 }, { org: 'o', user: null })).toEqual({ a: ['o/x', '{user}'], b: 1 });
  });
});

describe('the tool descriptions', () => {
  it('are short, read-only, and present in the catalog', () => {
    for (const t of tools) {
      expect(t.description.length, t.name).toBeLessThanOrEqual(160);
      expect(t.annotations.readOnlyHint).toBe(true);
      expect(CATALOG.has(t.name), t.name).toBe(true);
    }
  });
});
