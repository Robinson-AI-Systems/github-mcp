import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import privateTenantAuthorize from '../../api/tenant/oauth/authorize.js';
import { issueTenantCredential } from '../../src/tenancy/routed-credential.js';
import { call, request } from '../../test/helpers/http-harness.js';

const ENV = {
  PUBLIC_BASE_URL:'https://github-private-pilot.example.test',
  GITHUB_PRIVATE_TENANT_PILOT:'enabled',
  GITHUB_TENANT_ROUTING_KEY:randomBytes(32).toString('base64url'),
  VERCEL_ENV:'production'
};
const grant={tenantId:'5ca85cbb-2222-4222-8222-333333333333',
  identityId:'5ca85cbb-2222-4222-8222-444444444444',
  membershipRevision:1,pilotRevision:1};
const client=issueTenantCredential('tcl',grant,ENV);
const params={
  client_id:client,
  redirect_uri:'https://private-client.example.test/oauth/callback',
  response_type:'code',code_challenge:'z'.repeat(43),
  code_challenge_method:'S256',
  state:'client-owned-csrf',
  resource:ENV.PUBLIC_BASE_URL+'/api/mcp'
};
const consentFactory=()=>({
  inspect:async()=>({productionAllowed:true}),
  start:async()=>{throw Error('Provider sign-in intentionally unavailable in unit fixture');}
});
const handler=(req,res)=>privateTenantAuthorize(req,res,{env:ENV,consentFactory});

describe('PUB-4 mobile-sized private GitHub consent is also standards-compliant for desktop',()=>{
  it('renders a responsive OAuth form with exact native request fields and no tenant account inventory',async()=>{
    const res=await call(handler,request('GET',params));
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toContain('text/html');
    expect(res.headers['Content-Security-Policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['Set-Cookie']).toContain('HttpOnly');
    expect(res.headers['Set-Cookie']).toContain('SameSite=Strict');
    const page=res.body;
    expect(page).toContain('name="viewport"');
    expect(page).toContain('Connect GitHub Unleashed by Robinson AI Systems');
    expect(page).toContain('name="client_id"');
    expect(page).toContain('name="code_challenge"');
    expect(page).toContain('name="redirect_uri"');
    expect(page).toContain('name="form_csrf"');
    expect(page).toContain('name="mode"');
    expect(page).toContain('value="production"');
    expect(page).toContain('name="profile"');
    expect(page).toContain('value="read_only"');
    expect(page).toContain('value="full"');
    expect(page).not.toContain('name="account"');
    expect(page).not.toContain('robinson-ai-scratch');
    expect(page).not.toContain('codex/open');
    expect(page).not.toContain('GITHUB_PILOT_APP_CLIENT_SECRET');
  });

  it('does not offer production in nonproduction and never shows a disabled private pilot',async()=>{
    const preview=await call((req,res)=>privateTenantAuthorize(req,res,{
      env:{...ENV,VERCEL_ENV:'preview'},consentFactory:()=>({inspect:async()=>({productionAllowed:false})})}),request('GET',params));
    expect(preview.statusCode).toBe(200);
    expect(preview.body).not.toContain('value="production"');
    const disabled=await call((req,res)=>privateTenantAuthorize(req,res,{
      env:{...ENV,GITHUB_PRIVATE_TENANT_PILOT:'disabled'},consentFactory}),request('GET',params));
    expect(disabled.statusCode).toBe(403);
    expect(disabled.body).not.toContain(client);
  });

  it('refuses signed but revoked/missing tenant OAuth clients without displaying login',async()=>{
    const checked=await call((req,res)=>privateTenantAuthorize(req,res,{
      env:ENV,consentFactory:()=>({inspect:async()=>{throw Error('revoked grant');}})
    }),request('GET',params));
    expect(checked.statusCode).toBe(403);
    expect(checked.body).not.toContain('Continue to GitHub');
    expect(checked.body).not.toContain(client);
  });

  it('hides PRODUCTION for an account with the production switch OFF on a real production deployment',async()=>{
    const denied=await call((req,res)=>privateTenantAuthorize(req,res,{
      env:ENV,consentFactory:()=>({inspect:async()=>({productionAllowed:false})})
    }),request('GET',params));
    expect(denied.statusCode).toBe(200);
    expect(denied.body).toContain('value="preview"');
    expect(denied.body).not.toContain('value="production"');
  });

  it('refuses missing signed clients, malformed form CSRF, and unsupported methods before tenant access',async()=>{
    const missing=await call(handler,request('GET',{...params,client_id:'unauthorized'}));
    expect(missing.statusCode).toBe(403);
    const unsupported=await call(handler,request('PUT',params));
    expect(unsupported.statusCode).toBe(405);
    const forged=await call(handler,request('POST',{
      ...params,form_csrf:'wrong-cookie'
    },{origin:ENV.PUBLIC_BASE_URL,cookie:'gh_tenant_pilot_form='+randomBytes(32).toString('base64url')}));
    expect(forged.statusCode).toBe(403);
    expect(forged.body).not.toContain(client);
  });
});
