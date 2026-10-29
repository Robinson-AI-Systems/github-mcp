import { describe, expect, it, vi } from 'vitest';
import { claimTenantBudget, recordTenantMetric,
  withTenantStorageLimits, TenantCapacityError,
  TENANT_RUNTIME_LIMITS, validateTenantRuntimePolicy, readTenantRuntimePolicy,
  saveTenantRuntimePolicy, withTenantProviderMetrics } from '../../src/tenancy/runtime-limits.js';

describe('PUB-3 scoped runtime fail-closed validation',()=>{
  it('rejects malformed/untrusted scope and nonfinite limits before SQL',async()=>{
    const sql=vi.fn();
    for(const props of [
      {operation:'arbitrary-code',clientId:'a',tenantMax:10,clientMax:2},
      {operation:'job',clientId:'a',tenantMax:10,clientMax:2,window:'day'},
      {operation:'mcp',clientId:'',tenantMax:10,clientMax:2},
      {operation:'mcp',clientId:'x'.repeat(300),tenantMax:10,clientMax:2},
      {operation:'mcp',clientId:'a',tenantMax:2,clientMax:3},
      {operation:'mcp',clientId:'a',tenantMax:10,clientMax:2,amount:-1},
      {operation:'mcp',clientId:'a',tenantMax:10,clientMax:2,window:'year'}
    ]){
      await expect(claimTenantBudget(sql,props)).rejects.toThrow(/Invalid/);
    }
    expect(sql).not.toHaveBeenCalled();
  });

  it('throws a bounded public rate error when atomic Postgres refuses a claim',async()=>{
    const sql=vi.fn(async()=>[]);
    await expect(claimTenantBudget(sql,{operation:'mcp',clientId:'client',
      tenantMax:10,clientMax:2})).rejects.toBeInstanceOf(TenantCapacityError);
    expect(sql).toHaveBeenCalledOnce();
    const error=await claimTenantBudget(sql,{operation:'oauth',clientId:'client',
      tenantMax:10,clientMax:2}).catch(x=>x);
    expect(error.retryAfterSeconds).toBe(60);
    expect(error.message).not.toContain('client');
  });

  it('validates retained size and TTL before any database mutation',async()=>{
    const db={createJob:vi.fn(),putResult:vi.fn()};
    const sql=vi.fn();
    const store=withTenantStorageLimits(db,sql,'client-fixture');
    await expect(store.createJob({ttlMinutes:1441})).rejects.toBeInstanceOf(TenantCapacityError);
    await expect(store.putResult({ttlSeconds:86401,body:{a:1}}))
      .rejects.toBeInstanceOf(TenantCapacityError);
    await expect(store.putResult({body:{big:'X'.repeat(
      TENANT_RUNTIME_LIMITS.resultMaxBytes+1)}}))
      .rejects.toBeInstanceOf(TenantCapacityError);
    await expect(store.putResult({body:undefined})).rejects.toThrow(/valid JSON/);
    expect(db.putResult).not.toHaveBeenCalled();
    expect(db.createJob).not.toHaveBeenCalled();
    expect(sql).not.toHaveBeenCalled();
  });

  it('classifies provider success, refusal and network exceptions without storing request secrets',async()=>{
    const sql=vi.fn(async()=>[]);
    const token='fixture-sensitive-github-token';
    const secretUrl='https://api.github.com/repos/very-private-org/private-repo?token='+token;
    let outcome=200;
    const fetchImpl=vi.fn(async()=>{
      if(outcome===0) throw new Error('transport echoed '+token);
      return {ok:outcome===200,status:outcome};
    });
    const metered=withTenantProviderMetrics(sql,fetchImpl);
    await expect(metered(secretUrl,{headers:{authorization:'Bearer '+token}}))
      .resolves.toMatchObject({status:200});
    outcome=403;
    await expect(metered(secretUrl)).resolves.toMatchObject({status:403});
    outcome=0;
    await expect(metered(secretUrl)).rejects.toThrow(/transport echoed/);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const metricCalls=sql.mock.calls.filter(call=>String(call[0]?.[0]).includes('gh_tenant_runtime_metrics (hour'));
    expect(metricCalls).toHaveLength(3);
    const paramText=metricCalls.map(call=>call.slice(1).join('|')).join(' | ');
    expect(paramText).toContain('provider');
    for(const value of ['ok','refused','error'])expect(paramText).toContain(value);
    expect(paramText).not.toContain(token);
    expect(paramText).not.toContain('private-repo');
    expect(paramText).not.toContain('very-private-org');
    expect(paramText).not.toContain(secretUrl);
  });

  it('never admits raw tokens, repository names, errors or URLs into telemetry event classes',async()=>{
    const sql=vi.fn();
    const bad=[
      {event:'github_pat_FAKEsecret',outcome:'ok',durationMs:2},
      {event:'https://github.com/org/private',outcome:'ok',durationMs:2},
      {event:'mcp',outcome:'raw GitHub error contains key',durationMs:2},
      {event:'mcp',outcome:'ok',durationMs:-1},
      {event:'mcp',outcome:'ok',durationMs:Infinity}
    ];
    for(const v of bad)await expect(recordTenantMetric(sql,v)).rejects.toThrow();
    expect(sql).not.toHaveBeenCalled();
  });

  it('validates independent owner limits, rejects unknown keys and refuses corruption',async()=>{
    expect(validateTenantRuntimePolicy({})).toMatchObject(TENANT_RUNTIME_LIMITS);
    expect(validateTenantRuntimePolicy({mcpClientPerMinute:250,mcpTenantPerMinute:1200})
      .mcpClientPerMinute).toBe(250);
    for(const invalid of [
      null,[],{'__proto__':null}, {mcpClientPerMinute:-1},
      {mcpClientPerMinute:1.5}, {mcpClientPerMinute:9999},
      {mcpClientPerMinute:700,mcpTenantPerMinute:400},
      {secretToken:'not safe'}, {oauthClientPerMinute:10,oauthTenantPerMinute:5}
    ]) expect(()=>validateTenantRuntimePolicy(invalid)).toThrow();
    const sql=vi.fn(async()=>[{value:{mcpClientPerMinute:150,mcpTenantPerMinute:800}}]);
    expect((await readTenantRuntimePolicy(sql)).mcpClientPerMinute).toBe(150);
    const store=vi.fn(async()=>[]);
    await expect(saveTenantRuntimePolicy(store,{mcpClientPerMinute:50,
      mcpTenantPerMinute:500})).resolves.toMatchObject({mcpClientPerMinute:50});
    expect(store).toHaveBeenCalledOnce();
    expect(store.mock.calls[0].slice(1).join('|')).not.toMatch(/token|email|secret/i);
    await expect(readTenantRuntimePolicy(async()=>[{value:{unauthorized:'raw'}}]))
      .rejects.toThrow(/policy/);
  });
});


describe('job creation without daily quotas',()=>{
 it('normalizes retired stored32/128/200 quotas to no daily limit and omits them on save',async()=>{
  for(const value of [{},{jobsClientPerDay:32,jobsTenantPerDay:200},{jobsClientPerDay:128,jobsTenantPerDay:1}]){
   expect(validateTenantRuntimePolicy(value)).toMatchObject({jobsClientPerDay:null,jobsTenantPerDay:null});
  }
  const sql=vi.fn(async()=>[]);
  await saveTenantRuntimePolicy(sql,{jobsClientPerDay:128,jobsTenantPerDay:200});
  expect(JSON.parse(sql.mock.calls[0][2])).not.toHaveProperty('jobsClientPerDay');
  expect(JSON.parse(sql.mock.calls[0][2])).not.toHaveProperty('jobsTenantPerDay');
  expect(()=>validateTenantRuntimePolicy({jobsClientPerDay:'unlimited'})).toThrow();
 });
 it('admits successive jobs despite exhausted old quotas without claiming a daily budget',async()=>{
  const sql=vi.fn(async parts=>{
   const query=parts.join('');
   if(query.includes('SELECT value FROM server_settings'))return [{value:{jobsClientPerDay:1,jobsTenantPerDay:1}}];
   if(query.includes('gh_claim_tenant_storage_slot'))return [{admitted:true}];
   if(query.includes('gh_claim_tenant_capacity'))throw new Error('An exhausted old daily job quota must never be consulted.');
   return [];
  });
  const db={createJob:vi.fn(async()=>({state:'pending'})),finishJob:vi.fn(async()=>({state:'ready'})),putResult:vi.fn()};
  const store=withTenantStorageLimits(db,sql,'fixture-client');
  for(let i=0;i<201;i++){const id='job_'+i.toString(16).padStart(16,'0');await store.createJob({id,connection:'fixture-connection',owner:'fixture',kind:'export'});await store.finishJob(id,'fixture-connection',{state:'ready'});}
  expect(db.createJob).toHaveBeenCalledTimes(201);
  expect(sql.mock.calls.every(c=>!c[0].join('').includes('gh_claim_tenant_capacity'))).toBe(true);
 });
});

it('native workspace metadata uses no fixed active slots for any client',async()=>{
 const db={createJob:vi.fn(async input=>input),putResult:vi.fn()},sql=vi.fn();
 for(const client of ['client-A','client-B']){
  const store=withTenantStorageLimits(db,sql,client);
  for(let i=0;i<21;i++)await store.createJob({id:'job_'+i.toString(16).padStart(16,'0'),connection:client,owner:'fixture',kind:'native-git-workspace',ttlMinutes:240});
 }
 expect(db.createJob).toHaveBeenCalledTimes(42);expect(sql).not.toHaveBeenCalled();
});
