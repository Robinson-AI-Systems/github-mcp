import { describe, expect, it } from 'vitest';
import { readTenantMcpEligibility, checkedTenantMcpDirectory,
  requestScopedVerifiedAccess, tenantMcpAccountsLive } from '../../src/tenancy/mcp-route.js';

const claim = { tenantId:'tenant-a', identityId:'person-a', membershipRevision:7, pilotRevision:11 };
const authorized = { ...claim, namespace:'gh_t_example', role:'owner' };
const env = { GITHUB_PILOT_APP_ID:'91', VERCEL_ENV:'production' };
const app = extra => ({ credential_kind:'app', installation_status:'active',
  installation_id:37, app_id:91, production_enabled:true, ...extra });

describe('C-9 tenant MCP hot path', () => {
  it('starts both independent live checks before either returns; starts them anew next request', async () => {
    const pending=[];
    const directory={
      authorizedPilotIdentity:()=>new Promise(resolve=>pending.push(resolve)),
      marketplaceBinding:()=>new Promise(resolve=>pending.push(resolve))
    };
    const first=readTenantMcpEligibility(directory,claim);
    expect(pending).toHaveLength(2);
    pending[0](authorized); pending[1]({active:true});
    expect(await first).toEqual({authorized,marketplace:{active:true}});
    const second=readTenantMcpEligibility(directory,claim);
    expect(pending).toHaveLength(4);
    pending[2](null); pending[3](null);
    expect((await second).authorized).toBeNull();
  });

  it('uses only the checked identity; mismatched revisions and foreign identities fail closed', async () => {
    let called=0;
    const directory={
      authorized:async()=>{called++; return null;},
      marketplaceBinding:async()=>{called++; return null;},
      getPublicClient:async()=>null
    };
    const market={active:true};
    const scoped=checkedTenantMcpDirectory(directory,claim,authorized,market);
    expect(await scoped.authorized(claim.tenantId,claim.identityId)).toEqual({
      tenantId:'tenant-a',namespace:'gh_t_example',role:'owner',membershipRevision:7
    });
    expect(await scoped.marketplaceBinding('tenant-a')).toBe(market);
    expect(await scoped.authorized('tenant-b','person-a')).toBeNull();
    expect(await scoped.authorized('tenant-a','person-b')).toBeNull();
    await expect(scoped.marketplaceBinding('tenant-b')).rejects.toThrow(/Foreign tenant/);
    expect(called).toBe(0);
    expect(()=>checkedTenantMcpDirectory(directory,claim,null,market)).toThrow();
    expect(()=>checkedTenantMcpDirectory(directory,claim,{...authorized,pilotRevision:10},market)).toThrow();
    expect(()=>checkedTenantMcpDirectory(directory,claim,{...authorized,identityId:'other'},market)).toThrow();
  });

  it('avoids the repeated exact bearer SQL lookup but cannot reuse a different token or a later request', async () => {
    let calls=0;
    const db={getAccessToken:async()=>{calls++;return null;},getAccount:async()=>null};
    const grant={client_id:'pcl_test'};
    const scoped=requestScopedVerifiedAccess(db,'tac_test',grant);
    expect(await scoped.getAccessToken('tac_test')).toBe(grant);
    expect(calls).toBe(0);
    expect(await scoped.getAccessToken('tac_different')).toBeNull();
    expect(calls).toBe(1);
    expect(db.getAccessToken).not.toBe(scoped.getAccessToken);
    expect(await db.getAccessToken('tac_test')).toBeNull();
    expect(calls).toBe(2);
    expect(()=>requestScopedVerifiedAccess(db,'tac_test',null)).toThrow();
  });

  it('bounds fanout at ten and checks all accounts without serialized awaits', async () => {
    const pending=[];
    const db={getAccount:login=>new Promise(resolve=>pending.push([login,resolve]))};
    const work=tenantMcpAccountsLive(db,['one','two','three'],'production',env);
    expect(pending.map(([login])=>login)).toEqual(['one','two','three']);
    pending.forEach(([,resolve])=>resolve(app()));
    expect(await work).toBe(true);
    expect(await tenantMcpAccountsLive(db,Array(11).fill('one'),'production',env)).toBe(false);
    expect(pending).toHaveLength(3);
  });

  it('preserves strict App, marketplace-independent production, removed and master-place gates', async () => {
    for(const row of [null,app({installation_status:'suspended'}),
      app({installation_id:0}),app({app_id:92}),app({production_enabled:false})]){
      expect(await tenantMcpAccountsLive({getAccount:async()=>row},['one'],'production',env)).toBe(false);
    }
    expect(await tenantMcpAccountsLive({getAccount:async()=>app({production_enabled:false})},['one'],'preview',env)).toBe(true);
    expect(await tenantMcpAccountsLive({getAccount:async()=>app()},['one'],'production',
      {...env,VERCEL_ENV:'preview'})).toBe(false);
    expect(await tenantMcpAccountsLive({getAccount:async()=>({credential_kind:'master'})},['one'],'production',env)).toBe(true);
  });
  it('runs a reproducible delayed-SQL benchmark without calling it live speed evidence', async () => {
    const { execFileSync } = await import('node:child_process');
    const report=JSON.parse(execFileSync(process.execPath,
      ['scripts/benchmark-tenant-mcp-auth.mjs'],
      {cwd:process.cwd(),encoding:'utf8',timeout:30000}));
    expect(report).toMatchObject({fakeSqlDelayMs:20,repetitions:4});
    expect(report.serialControlMedianMs).toBeGreaterThan(report.optimizedMedianMs);
    expect(report.reductionPercent).toBeGreaterThan(30);
  });

});
