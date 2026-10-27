import { randomBytes, createHash } from 'node:crypto';
import pg from 'pg';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createDb } from '../../src/db.js';
import { purgeRevokedTenantArtifacts } from '../../src/tenancy/incident-cleanup.js';
import { createTenantDirectory, initializeProvisionedTenant,
  tenantConnectionString, tenantSchemaName } from '../../src/tenancy/directory.js';
import { claimTenantBudget, admitTenantMcp, admitTenantOAuth,
  recordTenantMetric, createTenantMetricBuffer, withTenantProviderMetrics, purgeExpiredTenantRuntime, withTenantStorageLimits,
  readTenantRuntimePolicy, saveTenantRuntimePolicy,
  reserveTenantStorage, releaseTenantStorage,
  TenantCapacityError, TENANT_RUNTIME_LIMITS } from '../../src/tenancy/runtime-limits.js';

const clients=[];
const adapter=client=>async(parts,...values)=>{
  let sql=parts[0];
  for(let i=0;i<values.length;i++)sql+='$'+(i+1)+parts[i+1];
  return (await client.query(sql,values)).rows;
};
async function connect(url){
  const c=new pg.Client({connectionString:url});
  await c.connect();clients.push(c);return c;
}
let root,ownerDir,a,b,sqlA,sqlA2,sqlB,dbA,dbB,testSchema;
beforeAll(async()=>{
  const url=process.env.TEST_DATABASE_URL;
  if(!url || !['localhost','127.0.0.1','::1','[::1]'].includes(new URL(url).hostname))
    throw new Error('PUB-3 tests require local disposable PostgreSQL.');
  root=await connect(url);
  testSchema='github_pub3_'+randomBytes(6).toString('hex');
  await root.query('CREATE SCHEMA "'+testSchema+'"');
  await root.query('SET search_path TO "'+testSchema+'"');
  ownerDir=createTenantDirectory(adapter(root));
  await ownerDir.initSchema();
  const first=await ownerDir.enrollVerifiedGithubSubject('981001');
  const second=await ownerDir.enrollVerifiedGithubSubject('981002');
  a=await ownerDir.provision(first);
  b=await ownerDir.provision(second);
  const tenantA=await connect(tenantConnectionString(url,a.id));
  const anotherA=await connect(tenantConnectionString(url,a.id));
  const tenantB=await connect(tenantConnectionString(url,b.id));
  sqlA=adapter(tenantA);sqlA2=adapter(anotherA);sqlB=adapter(tenantB);
  await initializeProvisionedTenant({tenantId:a.id,connectionString:url,sqlFactory:()=>sqlA});
  await initializeProvisionedTenant({tenantId:b.id,connectionString:url,sqlFactory:()=>sqlB});
  expect(await ownerDir.activate(a.id,tenantSchemaName(a.id))).toBe(true);
  expect(await ownerDir.activate(b.id,tenantSchemaName(b.id))).toBe(true);
  dbA=createDb(sqlA);dbB=createDb(sqlB);
});
afterAll(async()=>{
  if(root){
    for(const tenant of [a,b])if(tenant?.id)
      await root.query('DROP SCHEMA IF EXISTS "'+tenantSchemaName(tenant.id)+'" CASCADE').catch(()=>{});
    if(testSchema)await root.query('DROP SCHEMA IF EXISTS "'+testSchema+'" CASCADE').catch(()=>{});
  }
  for(const c of clients.reverse())await c.end().catch(()=>{});
});

describe('PUB-3 tenant capacity with REAL PostgreSQL',()=>{
  it('rejects first-write over cap and serializes simultaneous serverless claims',async()=>{
    const args={operation:'mcp',clientId:'racy-client-A',tenantMax:8,clientMax:4};
    const over=()=>claimTenantBudget(sqlA,{...args,amount:5});
    await expect(over()).rejects.toBeInstanceOf(TenantCapacityError);
    const all=await Promise.allSettled(Array.from({length:9},(_,i)=>
      claimTenantBudget(i%2?sqlA:sqlA2,{...args,amount:1})));
    const passed=all.filter(x=>x.status==='fulfilled');
    const blocked=all.filter(x=>x.status==='rejected');
    expect(passed).toHaveLength(4);
    expect(blocked).toHaveLength(5);
    expect(blocked.every(x=>x.reason instanceof TenantCapacityError)).toBe(true);
    // A second A client has its own cap but must share the A tenant ceiling.
    const next={...args,clientId:'another-client-A'};
    const two=await Promise.allSettled(Array.from({length:6},(_,i)=>
      claimTenantBudget(i%2?sqlA2:sqlA,next)));
    expect(two.filter(x=>x.status==='fulfilled')).toHaveLength(4);
    await expect(claimTenantBudget(sqlA,{...next,clientId:'third-A'}))
      .rejects.toBeInstanceOf(TenantCapacityError);
    // B has its own schema and same exact client identifier without sharing quota.
    await expect(claimTenantBudget(sqlB,args)).resolves.toMatchObject({
      clientUsed:1,tenantUsed:1
    });
  });

  it('retains strict per-client and per-tenant minute/day separation and reclaims windows safely',async()=>{
    await expect(admitTenantMcp(sqlB,'supported-client')).resolves.toMatchObject({allowed:true});
    await expect(admitTenantOAuth(sqlB,'supported-client')).resolves.toMatchObject({allowed:true});
    const day={operation:'job',clientId:'day-limits',tenantMax:3,clientMax:2,window:'day'};
    await claimTenantBudget(sqlA,day);
    await claimTenantBudget(sqlA,day);
    await expect(claimTenantBudget(sqlA,day)).rejects.toBeInstanceOf(TenantCapacityError);
    await expect(claimTenantBudget(sqlA,{...day,clientId:'other-day'})).resolves.toMatchObject({allowed:true});
    await expect(claimTenantBudget(sqlA,{...day,clientId:'third-day'}))
      .rejects.toBeInstanceOf(TenantCapacityError);
    await sqlA`UPDATE gh_tenant_budget_windows SET expires_at=now()-interval '5 seconds',
      window_start=window_start-interval '2 days'
      WHERE scope LIKE 'job:%'`;
    expect((await purgeExpiredTenantRuntime(sqlA)).budgetRows).toBeGreaterThanOrEqual(2);
    await expect(claimTenantBudget(sqlA,day)).resolves.toMatchObject({allowed:true});
    const rows=await sqlB`SELECT count(*)::integer AS n FROM gh_tenant_budget_windows`;
    expect(rows[0].n).toBeGreaterThan(0);
  });

  it('bounds retained results, job TTLs and independently scoped handles',async()=>{
    const first=withTenantStorageLimits(dbA,sqlA,'retained-a');
    const second=withTenantStorageLimits(dbB,sqlB,'retained-a');
    const handle='res_'+randomBytes(16).toString('base64url');
    const body={results:Array.from({length:20},(_,i)=>({i,detail:'clean fixture'}))};
    await first.putResult({handle,connection:'tenant-A',summary:'bounded',body});
    expect((await dbA.getResult(handle,'tenant-A')).body).toEqual(body);
    expect(await dbA.getResult(handle,'tenant-B')).toBeNull();
    expect(await dbB.getResult(handle,'tenant-A')).toBeNull();
    const another='res_'+randomBytes(16).toString('base64url');
    await second.putResult({handle:another,connection:'tenant-B',body});
    expect((await dbB.getResult(another,'tenant-B')).body).toEqual(body);
    await expect(first.putResult({handle:'res_'+randomBytes(16).toString('base64url'),
      connection:'tenant-A',body:{blob:'x'.repeat(TENANT_RUNTIME_LIMITS.resultMaxBytes+1)}}))
      .rejects.toBeInstanceOf(TenantCapacityError);
    await expect(first.putResult({handle:'res_'+randomBytes(16).toString('base64url'),
      connection:'tenant-A',ttlSeconds:86401,body}))
      .rejects.toBeInstanceOf(TenantCapacityError);
    const id='job_'+randomBytes(8).toString('hex');
    await first.createJob({id,connection:'tenant-A',owner:'fixture-org',kind:'autofix',
      providerRef:'88',ttlMinutes:1440});
    expect((await dbA.getJob(id,'tenant-A')).state).toBe('pending');
    expect(await dbA.getJob(id,'tenant-B')).toBeNull();
    expect(await dbB.getJob(id,'tenant-A')).toBeNull();
    await expect(first.createJob({id:'job_'+randomBytes(8).toString('hex'),
      connection:'tenant-A',owner:'fixture-org',kind:'autofix',ttlMinutes:1441}))
      .rejects.toBeInstanceOf(TenantCapacityError);
  });

  it('serializes active pending job slots across instances and isolates tenants',async()=>{
    const key='concurrency-client';
    const jobs=Array.from({length:TENANT_RUNTIME_LIMITS.jobsClientPending+3},
      ()=> 'job_'+randomBytes(8).toString('hex'));
    const requests=await Promise.allSettled(jobs.map((id,i)=>
      reserveTenantStorage(i%2?sqlA2:sqlA,'job',key,id,60)));
    expect(requests.filter(x=>x.status==='fulfilled')).toHaveLength(
      TENANT_RUNTIME_LIMITS.jobsClientPending);
    expect(requests.filter(x=>x.status==='rejected')).toHaveLength(3);
    expect(requests.filter(x=>x.status==='rejected').every(x=>
      x.reason instanceof TenantCapacityError)).toBe(true);
    // A matching client identifier in B has a DIFFERENT namespace and pool.
    await expect(reserveTenantStorage(sqlB,'job',key,jobs[0],60))
      .resolves.toBeUndefined();
    const accepted=jobs.filter((id,i)=>requests[i].status==='fulfilled');
    await releaseTenantStorage(sqlA,'job',key,accepted[0]);
    const retry=jobs.find((id,i)=>requests[i].status==='rejected');
    await expect(reserveTenantStorage(sqlA,'job',key,retry,60))
      .resolves.toBeUndefined();
    await expect(reserveTenantStorage(sqlB,'job',key,jobs[0],60))
      .rejects.toBeInstanceOf(TenantCapacityError);
    // An earlier test has a different client's pending A job. Check the
    // current client independently rather than assuming the tenant was empty.
    const scopedKey=createHash('sha256').update(key).digest('hex').slice(0,24);
    const scoped=await sqlA`SELECT count(*)::integer AS n FROM gh_tenant_storage_slots
      WHERE kind='job' AND client_key=${scopedKey} AND expires_at>now()`;
    const aRows=await sqlA`SELECT count(*)::integer AS n FROM gh_tenant_storage_slots
      WHERE kind='job' AND expires_at>now()`;
    const bRows=await sqlB`SELECT count(*)::integer AS n FROM gh_tenant_storage_slots
      WHERE kind='job' AND expires_at>now()`;
    expect(scoped[0].n).toBe(TENANT_RUNTIME_LIMITS.jobsClientPending);
    expect(aRows[0].n).toBe(TENANT_RUNTIME_LIMITS.jobsClientPending+1);
    expect(bRows[0].n).toBe(1);
  });

  it('limits stored result handle rows and cleans only expired reservations',async()=>{
    const client='result-row-fixture';
    const ids=Array.from({length:TENANT_RUNTIME_LIMITS.resultsClientActive+1},
      ()=> 'res_'+randomBytes(16).toString('base64url'));
    const claims=await Promise.allSettled(ids.map((id,i)=>
      reserveTenantStorage(i%2?sqlA:sqlA2,'result',client,id,60)));
    expect(claims.filter(x=>x.status==='fulfilled')).toHaveLength(
      TENANT_RUNTIME_LIMITS.resultsClientActive);
    expect(claims.filter(x=>x.status==='rejected')).toHaveLength(1);
    const reservation=await sqlB`SELECT count(*)::integer AS n FROM gh_tenant_storage_slots
      WHERE kind='result'`;
    expect(reservation[0].n).toBe(1); // Earlier tenant-B retained result
    await sqlA`UPDATE gh_tenant_storage_slots SET expires_at=now()-interval '1 second'
      WHERE kind='result' AND client_key IS NOT NULL`;
    const clean=await purgeExpiredTenantRuntime(sqlA);
    expect(clean.slotRows).toBeGreaterThan(0);
    const other=await sqlB`SELECT count(*)::integer AS n FROM gh_tenant_storage_slots
      WHERE kind='result'`;
    expect(other).toEqual(reservation); // B never touched
    await expect(reserveTenantStorage(sqlA,'result',client,ids.at(-1),60))
      .resolves.toBeUndefined();
  });

  it('refuses malformed or slot-capped storage without spending the daily job/result budget',async()=>{
    const client='reservation-order-'+randomBytes(7).toString('hex');
    const facade=withTenantStorageLimits(dbA,sqlA,client);
    const policy=await readTenantRuntimePolicy(sqlA);
    const key=createHash('sha256').update(client).digest('hex').slice(0,24);
    const scopeJob='job:client:'+key, scopeResult='result:client:'+key;
    const job='job_'+randomBytes(8).toString('hex');
    const result='res_'+randomBytes(16).toString('base64url');
    await saveTenantRuntimePolicy(sqlA,{jobsClientPending:1,resultsClientActive:1});
    try {
      // Both malformed inputs previously spent the day quota before their
      // identifier was validated. Neither may even reserve a slot.
      await expect(facade.createJob({id:'bad',connection:'tenant-A',owner:'fixture',
        kind:'check'})).rejects.toThrow(/Invalid tenant job/);
      await expect(facade.putResult({handle:'bad',connection:'tenant-A',
        body:{a:1}})).rejects.toThrow(/Invalid tenant result/);
      let daily=await sqlA`SELECT scope FROM gh_tenant_budget_windows
        WHERE scope=${scopeJob} OR scope=${scopeResult}`;
      expect(daily).toEqual([]);

      const heldJob='job_'+randomBytes(8).toString('hex');
      const heldResult='res_'+randomBytes(16).toString('base64url');
      await reserveTenantStorage(sqlA,'job',client,heldJob,60);
      await reserveTenantStorage(sqlA,'result',client,heldResult,60);
      await expect(facade.createJob({id:job,connection:'tenant-A',
        owner:'fixture',kind:'check'})).rejects.toBeInstanceOf(TenantCapacityError);
      await expect(facade.putResult({handle:result,connection:'tenant-A',
        body:{ok:true}})).rejects.toBeInstanceOf(TenantCapacityError);
      daily=await sqlA`SELECT scope FROM gh_tenant_budget_windows
        WHERE scope=${scopeJob} OR scope=${scopeResult}`;
      expect(daily).toEqual([]); // Slot refusals cannot exhaust daily quota.
      await releaseTenantStorage(sqlA,'job',client,heldJob);
      await releaseTenantStorage(sqlA,'result',client,heldResult);
      await facade.createJob({id:job,connection:'tenant-A',owner:'fixture',
        kind:'check',ttlMinutes:10});
      await facade.putResult({handle:result,connection:'tenant-A',
        body:{ok:true},ttlSeconds:600});
      daily=await sqlA`SELECT scope,used::integer FROM gh_tenant_budget_windows
        WHERE scope=${scopeJob} OR scope=${scopeResult} ORDER BY scope`;
      expect(daily).toHaveLength(2);
      expect(daily.find(x=>x.scope===scopeJob).used).toBe(1);
      expect(daily.find(x=>x.scope===scopeResult).used).toBeGreaterThan(0);
      expect((await dbA.getJob(job,'tenant-A')).state).toBe('pending');
      expect((await dbA.getResult(result,'tenant-A')).body).toEqual({ok:true});
    } finally {
      // Persist only owner-configurable fields, not resolved fixed maxima.
      await saveTenantRuntimePolicy(sqlA,{
        jobsClientPending:policy.jobsClientPending,
        resultsClientActive:policy.resultsClientActive
      });
    }
  });

  it('records only fixed, aggregate operational classes and can purge expired history',async()=>{
    await recordTenantMetric(sqlA,{event:'mcp',outcome:'ok',durationMs:17});
    await recordTenantMetric(sqlA,{event:'mcp',outcome:'ok',durationMs:20});
    await recordTenantMetric(sqlA,{event:'oauth',outcome:'refused',durationMs:300});
    const metrics=await sqlA`SELECT event,outcome,latency_bucket,count
      FROM gh_tenant_runtime_metrics ORDER BY event,outcome`;
    expect(metrics).toEqual([
      {event:'mcp',outcome:'ok',latency_bucket:'lt100ms',count:'2'},
      {event:'oauth',outcome:'refused',latency_bucket:'lt500ms',count:'1'}
    ]);
    await expect(recordTenantMetric(sqlA,{event:'some-repo/token',
      outcome:'ok',durationMs:15})).rejects.toThrow();
    await expect(recordTenantMetric(sqlA,{event:'mcp',
      outcome:'github_pat_FAKEsecret',durationMs:15})).rejects.toThrow();
    await sqlA`UPDATE gh_tenant_runtime_metrics SET hour=hour-interval '48 hours'`;
    const deleted=await purgeExpiredTenantRuntime(sqlA);
    expect(deleted.metricRows).toBe(2);
    expect(await sqlB`SELECT count(*)::integer AS n FROM gh_tenant_runtime_metrics`)
      .toEqual([{n:0}]);
  });
  it('C-8 coalesces every provider outcome and MCP event into one awaited per-tenant SQL flush',async()=>{
    let writesA=0,writesB=0;
    const trackedA=(parts,...values)=>{writesA++;return sqlA(parts,...values);};
    const trackedB=(parts,...values)=>{writesB++;return sqlB(parts,...values);};
    const metricsA=createTenantMetricBuffer(trackedA);
    const metricsB=createTenantMetricBuffer(trackedB);
    const ok=async()=>new Response(null,{status:200});
    const rejected=async()=>new Response(null,{status:403});
    const failed=async()=>{throw new Error('fixture connection failed');};
    const fetchA=withTenantProviderMetrics(trackedA,ok,{buffer:metricsA});
    const fetchB=withTenantProviderMetrics(trackedB,ok,{buffer:metricsB});
    expect((await fetchA()).status).toBe(200);
    expect((await fetchA()).status).toBe(200);
    expect((await withTenantProviderMetrics(trackedA,rejected,{buffer:metricsA})()).status).toBe(403);
    await expect(withTenantProviderMetrics(trackedA,failed,{buffer:metricsA})())
      .rejects.toThrow('fixture connection failed');
    expect((await fetchB()).status).toBe(200);
    // A normal provider response is returned without waiting on ANY metric SQL.
    expect(writesA).toBe(0);
    expect(writesB).toBe(0);
    metricsA.record({event:'mcp',outcome:'ok',durationMs:22});
    metricsB.record({event:'mcp',outcome:'refused',durationMs:201});
    expect(()=>metricsA.record({event:'fixture-private-repository/token',
      outcome:'ok',durationMs:10})).toThrow();
    const [countA,countB]=await Promise.all([metricsA.flush(),metricsB.flush()]);
    expect([countA,countB]).toEqual([5,2]);
    expect([writesA,writesB]).toEqual([1,1]);
    expect(await metricsA.flush()).toBe(0);
    expect(writesA).toBe(1);
    const rowsA=await sqlA`SELECT event,outcome,sum(count)::integer AS n
      FROM gh_tenant_runtime_metrics GROUP BY event,outcome ORDER BY event,outcome`;
    expect(rowsA).toEqual([
      {event:'mcp',outcome:'ok',n:1},
      {event:'provider',outcome:'error',n:1},
      {event:'provider',outcome:'ok',n:2},
      {event:'provider',outcome:'refused',n:1}
    ]);
    const rowsB=await sqlB`SELECT event,outcome,sum(count)::integer AS n
      FROM gh_tenant_runtime_metrics GROUP BY event,outcome ORDER BY event,outcome`;
    expect(rowsB).toEqual([
      {event:'mcp',outcome:'refused',n:1},
      {event:'provider',outcome:'ok',n:1}
    ]);
    const noSql=()=>Promise.reject(new Error('fixture telemetry DB failure'));
    const broken=createTenantMetricBuffer(noSql);
    const answer=await withTenantProviderMetrics(noSql,ok,{buffer:broken})();
    expect(answer.status).toBe(200);
    await expect(broken.flush()).rejects.toThrow('fixture telemetry DB failure');
  });

  it('persists independently configurable private owner capacity per tenant without affecting any other tenant',async()=>{
    const originalB=await readTenantRuntimePolicy(sqlB);
    expect(originalB.mcpClientPerMinute).toBe(TENANT_RUNTIME_LIMITS.mcpClientPerMinute);
    const saved=await saveTenantRuntimePolicy(sqlA,{
      mcpClientPerMinute:250,mcpTenantPerMinute:1000,
      oauthClientPerMinute:2,oauthTenantPerMinute:3
    });
    expect(saved.mcpClientPerMinute).toBe(250);
    expect((await readTenantRuntimePolicy(sqlA)).mcpTenantPerMinute).toBe(1000);
    expect((await readTenantRuntimePolicy(sqlB)).mcpClientPerMinute).toBe(originalB.mcpClientPerMinute);
    await expect(saveTenantRuntimePolicy(sqlA,{
      mcpClientPerMinute:301,mcpTenantPerMinute:300
    })).rejects.toThrow(/lower than/);
    await expect(saveTenantRuntimePolicy(sqlA,{mcpClientPerMinute:9000}))
      .rejects.toThrow(/invalid limit/);
    expect((await readTenantRuntimePolicy(sqlA)).mcpClientPerMinute).toBe(250);
    const same={operation:'oauth',clientId:'configured-ratelimit',tenantMax:3,clientMax:2};
    await expect(claimTenantBudget(sqlA,same)).resolves.toMatchObject({allowed:true});
    await expect(admitTenantOAuth(sqlA,same.clientId)).resolves.toMatchObject({allowed:true});
    await expect(admitTenantOAuth(sqlA,same.clientId)).rejects.toBeInstanceOf(TenantCapacityError);
    await expect(admitTenantOAuth(sqlA,'another-configured-client'))
      .resolves.toMatchObject({allowed:true});
    await expect(admitTenantOAuth(sqlA,'third-configured-client'))
      .rejects.toBeInstanceOf(TenantCapacityError);
    await expect(admitTenantOAuth(sqlB,'configured-ratelimit'))
      .resolves.toMatchObject({allowed:true});
  });

  it('emergency revocation fails closed first and cleans only the selected owner tenant',async()=>{
    const ownerRows=await root.query(
      'SELECT identity_id FROM gh_tenant_memberships WHERE tenant_id=$1 AND role=$2',[a.id,'owner']);
    const outsiderRows=await root.query(
      'SELECT identity_id FROM gh_tenant_memberships WHERE tenant_id=$1 AND role=$2',[b.id,'owner']);
    const ownerId=String(ownerRows.rows[0]?.identity_id);
    const outsiderId=String(outsiderRows.rows[0]?.identity_id);
    expect(ownerId).toMatch(/^[0-9a-f-]{36}$/);
    expect(await ownerDir.allowlistPilotIdentity(a.id,ownerId,ownerId)).toBe(true);
    const key='res_'+randomBytes(16).toString('base64url');
    await dbA.putResult({handle:key,connection:'revoked-fixture',summary:'delete-on-revoke',
      body:{message:'only tenant A'}});
    await reserveTenantStorage(sqlA,'result','revoke-test-client',key,600);
    const otherTenantBefore=await sqlB`SELECT count(*)::integer AS n FROM gh_tenant_storage_slots`;
    const otherResultsBefore=await sqlB`SELECT count(*)::integer AS n FROM result_store`;
    const opts={directory:ownerDir,tenantId:a.id,ownerIdentityId:outsiderId,
      connectionString:process.env.TEST_DATABASE_URL,
      sqlFactory:url=>url.includes(tenantSchemaName(a.id))?sqlA:sqlB};
    await expect(purgeRevokedTenantArtifacts(opts)).rejects.toThrow(/owner/);
    expect((await dbA.getResult(key,'revoked-fixture')).body).toEqual({message:'only tenant A'});
    expect(await ownerDir.revokePilotIdentity(a.id,ownerId,ownerId)).toBe(true);
    expect(await ownerDir.authorizedPilotIdentity(a.id,ownerId)).toBeNull();
    const cleaned=await purgeRevokedTenantArtifacts({...opts,ownerIdentityId:ownerId});
    expect(cleaned.results).toBeGreaterThanOrEqual(1);
    expect(await dbA.getResult(key,'revoked-fixture')).toBeNull();
    const slots=await sqlA`SELECT count(*)::integer AS n FROM gh_tenant_storage_slots`;
    expect(slots[0].n).toBe(0);
    expect(await sqlB`SELECT count(*)::integer AS n FROM gh_tenant_storage_slots`)
      .toEqual(otherTenantBefore);
    expect(await sqlB`SELECT count(*)::integer AS n FROM result_store`)
      .toEqual(otherResultsBefore);
  });

});
