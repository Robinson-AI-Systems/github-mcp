import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { call, request } from '../../test/helpers/http-harness.js';
import consentPage from '../../api/tenant/oauth/authorize.js';
import { handleOAuth } from '../../src/oauth/routes.js';
import {handleGithub} from '../../src/github/routes.js';
import consentCallback, { stateCookie } from '../../api/tenant/oauth/callback.js';
import { issueTenantCredential } from '../../src/tenancy/routed-credential.js';

const tenantId='5ca85cbb-2222-4222-8222-333333333333';
const identityId='5ca85cbb-2222-4222-8222-444444444444';
const origin='https://pilot.github.example.test';
const makeEnv=()=>{
  vi.stubEnv('PUBLIC_BASE_URL',origin);
  vi.stubEnv('GITHUB_PRIVATE_TENANT_PILOT','enabled');
  vi.stubEnv('GITHUB_TENANT_ROUTING_KEY',randomBytes(32).toString('base64url'));
  vi.stubEnv('VERCEL_ENV','production');
  return process.env;
};
afterEach(()=>vi.unstubAllEnvs());

it('routes purpose-tagged private callbacks at the registered App URL without consulting owner storage',async()=>{
  vi.stubEnv('GITHUB_PRIVATE_TENANT_PILOT','disabled');
  const runtime={db:new Proxy({},{get(){throw Error('Owner storage must not be consulted');}})};
  const res=await call((req,res)=>handleGithub('user-callback',req,res,{runtime}),
    request('GET',{state:'pt.'+'a'.repeat(43),code:'FAKEcode'}));
  expect(res.statusCode).toBe(403);
  expect(res.headers['Set-Cookie']).toContain('Path=/api/github/user-callback');
});

describe('PUB-2 private browser entry routes',()=>{
  it('reads the GitHub callback state from a normal spaced multi-cookie header',()=>{
    const secret='Q'.repeat(43);
    expect(stateCookie({headers:{cookie:'session=fixture; gh_tenant_pilot_state='+secret+
      '; other=one'}})).toBe(secret);
    expect(stateCookie({headers:{cookie:'session=fixture; gh_tenant_pilot_state=bad'}}))
      .toBeNull();
    expect(stateCookie({headers:{cookie:'unrelated=one'}})).toBeNull();
  });
  it('denies all browser authorization and callbacks by default, including POST',async()=>{
    vi.stubEnv('GITHUB_PRIVATE_TENANT_PILOT','disabled');
    expect((await call(consentPage,request('GET',{client_id:'unknown'}))).statusCode).toBe(403);
    expect((await call(consentPage,request('POST',{client_id:'unknown'}))).statusCode).toBe(403);
    expect((await call(consentCallback,request('GET',{state:'x',code:'y'}))).statusCode).toBe(403);
  });
  it('offers a mobile-sized form with zero tenant account disclosure and requires signed client',async()=>{
    const env=makeEnv();
    const clientId=issueTenantCredential('tcl',{tenantId,identityId,membershipRevision:1,pilotRevision:1},env);
    const params={client_id:clientId,redirect_uri:'https://app.example.test/cb',
      resource:origin+'/api/mcp',response_type:'code',code_challenge:'a'.repeat(43),
      code_challenge_method:'S256',state:'testcaller'};
    const response=await call((req,res)=>consentPage(req,res,{env,
      consentFactory:()=>({inspect:async()=>({productionAllowed:true})})}),request('GET',params));
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('GitHub Unleashed by Robinson AI Systems');
    expect(response.body).toContain('<select name="mode">');
    expect(response.body).toContain('<option value="production">');
    expect(response.body).toContain('<select name="profile">');
    // Full is part of normal GitHub App user OAuth; this only verifies the
    // signed-client form choice, not provider authorization or account access.
    expect(response.body).toContain('<option value="full">');
    expect(response.body).toContain('<option value="everyday">');
    expect(response.body).toContain('Continue to GitHub');
    expect(response.body).not.toContain('robinson-ai-scratch');
    expect(response.body).not.toContain('ADMIN_PASSPHRASE');
    expect(response.headers['Set-Cookie']).toContain('gh_tenant_pilot_form=');
    expect((await call(consentPage,request('GET',{...params,client_id:'tcl_forged'}))).statusCode).toBe(403);
    const denied=await call(consentPage,request('POST',{...params,mode:'full',
      form_csrf:'not-authentic'},{origin}));
    expect(denied.statusCode).toBe(403);
  });
  it('uses GitHub pilot consent through the STANDARD discovered OAuth endpoint for signed clients',async()=>{
    const env=makeEnv();
    const clientId=issueTenantCredential('tcl',{tenantId,identityId,
      membershipRevision:1,pilotRevision:1},env);
    const params={client_id:clientId,redirect_uri:'https://agent.example.test/cb',
      resource:origin+'/api/mcp',response_type:'code',code_challenge:'a'.repeat(43),
      code_challenge_method:'S256',state:'agent-nonce'};
    // A mock owner DB that throws proves the tenant route cannot accidentally
    // interrogate the owner's OAuth clients or ask for ADMIN_PASSPHRASE.
    const rootDb={getOAuthClient:async()=>{throw new Error('Owner DB must not be read');}};
    const consentFactory=()=>({inspect:async()=>({productionAllowed:true})});
    const response=await call((req,res)=>handleOAuth('authorize',req,res,{db:rootDb,env,consentFactory}),
      request('GET',params));
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Continue to GitHub');
    expect(response.body).not.toContain('ADMIN_PASSPHRASE');
    const forged=await call((req,res)=>handleOAuth('authorize',req,res,{db:rootDb,env,consentFactory}),
      request('GET',{...params,client_id:'tcl_forged'}));
    expect(forged.statusCode).toBe(403);
    vi.stubEnv('GITHUB_PRIVATE_TENANT_PILOT','disabled');
    const refused=await call((req,res)=>handleOAuth('authorize',req,res,{
      db:rootDb,env:process.env}),request('GET',params));
    expect(refused.statusCode).toBe(403);
  });
  it('does not offer PRODUCTION choices on a nonproduction deployment',async()=>{
    const env=makeEnv();
    vi.stubEnv('VERCEL_ENV','preview');
    const token=issueTenantCredential('tcl',{tenantId,identityId,membershipRevision:1,pilotRevision:1},env);
    const response=await call((req,res)=>consentPage(req,res,{env,
      consentFactory:()=>({inspect:async()=>({productionAllowed:false})})}),request('GET',{
        client_id:token,redirect_uri:'https://agent.example.test/cb',resource:origin+'/api/mcp',
        response_type:'code',code_challenge:'a'.repeat(43),code_challenge_method:'S256'}));
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('<option value="preview">');
    expect(response.body).not.toContain('<option value="production">');
  });
});
