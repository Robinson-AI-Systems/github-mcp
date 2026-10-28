import { redact } from '../github/content-protection.js';
// PUB-2 private OAuth token endpoint routing. An OAuth client ID embeds
// server-signed tenant and verified subject IDs; these are only selectors.
// The real tenant's stored OAuth client secret, single-use code/refresh hash,
// and current owner-approved private pilot membership remain mandatory.
// Never retry a private tenant client through legacy owner OAuth storage.
import { neon } from '@neondatabase/serverless';
import { createTenantDirectory, openAuthorizedTenantDb } from './directory.js';
import { verifyTenantCredential, issueTenantCredential } from './routed-credential.js';
import { createOAuthHandlers } from '../core/oauth-handlers.js';
import { createGithubPolicy } from '../oauth/policy.js';
import { paramsOf, send } from '../core/http.js';
import { admitTenantOAuth, TenantCapacityError, recordTenantMetric } from './runtime-limits.js';
import { isPublicClientId, parsePublicCode } from './public-code.js';
import { marketplaceResource } from '../marketplace/resource.js';

export async function privateTenantToken(req, res, {
  env = process.env, rootSqlFactory = neon, tenantSqlFactory = neon
} = {}) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { error: 'method_not_allowed' });
  }
  let params;
  try { params = paramsOf(req); } catch { return send(res, 400, { error: 'invalid_request' }); }
  // PUB-6: a public (pcl_) client carries no tenant. Its code or refresh token selects the tenant; the tenant's own
  // mirrored client row (secret hash, redirect list), single-use code and live membership still decide.
  const publicClient = isPublicClientId(params.client_id);
  // Internal log only (no secrets, no codes): what kind of token request arrived and how it ended.
  const note = (stage) => { try { console.error('[oauth-token]', stage, 'grant=' + redact(String(params.grant_type ?? '-')).slice(0, 24),
    'client=' + (publicClient ? 'pcl' : 'other'), 'secret=' + (typeof params.client_secret === 'string' && params.client_secret ? 'yes' : 'no'),
    'basic=' + (/^basic /i.test(String(req.headers?.authorization ?? '')) ? 'yes' : 'no'),
    'resource=' + (params.resource ? 'yes' : 'no'), 'verifier=' + (params.code_verifier ? 'yes' : 'no'), 'status=' + res.statusCode); } catch { /* logging must never break a request */ } };
  note('request');
  let claim = publicClient ? null : verifyTenantCredential(params.client_id, 'tcl', env);
  if ((!claim && !publicClient) || !env.DATABASE_URL || env.GITHUB_PRIVATE_TENANT_PILOT !== 'enabled') return send(res, 401, { error: 'invalid_client' });
  let tenantSql=null;
  const started=Date.now();
  let outcome='error';
  try {
    const directory = createTenantDirectory(rootSqlFactory(env.DATABASE_URL));
    if (publicClient) {
      claim = null;
      if (await directory.getPublicClient(params.client_id)) {
        if (params.grant_type === 'authorization_code') {
          const selector = parsePublicCode(params.code);
          const live = selector && await directory.authorizedPilotIdentity(selector.tenantId, selector.identityId);
          if (live) claim = { tenantId: live.tenantId, identityId: live.identityId,
            membershipRevision: live.membershipRevision, pilotRevision: live.pilotRevision };
        } else if (params.grant_type === 'refresh_token') {
          claim = verifyTenantCredential(params.refresh_token, 'trf', env);
        }
      }
      if (!claim) { note('no-claim'); return send(res, 401, { error: 'invalid_client' }); }
    }
    const pilot = await directory.authorizedPilotIdentity(claim.tenantId, claim.identityId);
    const marketplace = await directory.marketplaceBinding(claim.tenantId);
    if (marketplace && !marketplace.active) return send(res,401,{error:'invalid_client'});
    if (!pilot || pilot.tenantId !== claim.tenantId || pilot.identityId !== claim.identityId ||
        pilot.membershipRevision !== claim.membershipRevision ||
        pilot.pilotRevision !== claim.pilotRevision)
      return send(res, 401, { error: 'invalid_client' });
    const scope = await openAuthorizedTenantDb({
      directory, tenantId: claim.tenantId, verifiedIdentityId: claim.identityId,
      connectionString: env.DATABASE_URL, sqlFactory: tenantSqlFactory
    });
    if (scope.tenant.namespace !== pilot.namespace ||
        scope.tenant.membershipRevision !== pilot.membershipRevision)
      return send(res, 401, { error: 'invalid_client' });
    tenantSql=scope.sql;
    await admitTenantOAuth(tenantSql,params.client_id);
    const handlers = createOAuthHandlers({
      db: scope.db, env, policy: createGithubPolicy({ env }),
      ...(marketplace ? {resourceUrl:marketplaceResource(marketplace.accountId, env)} : {}),
      issueTokens: () => ({
        accessToken: issueTenantCredential('tac', claim, env),
        refreshToken: issueTenantCredential('trf', claim, env)
      })
    });
    const result=await handlers.token(req, res);
    outcome=res.statusCode>=400?'refused':'ok';
    // PUB-5 B: remember (at most once a day) that this app registration is in use, so unused registrations can be cleaned away.
    if (publicClient && outcome==='ok') await directory.touchPublicClient(params.client_id).catch(()=>{});
    note('done');
    return result;
  } catch (error) {
    if (error instanceof TenantCapacityError) {
      outcome='throttled';
      res.setHeader('Retry-After',String(error.retryAfterSeconds));
      return send(res,429,{error:'rate_limited',retry_after_seconds:error.retryAfterSeconds});
    }
    return send(res, 503, { error: 'temporarily_unavailable' });
  } finally {
    if(tenantSql) await recordTenantMetric(tenantSql,{
      event:params?.grant_type==='refresh_token'?'refresh':'oauth',
      outcome,durationMs:Math.max(0,Date.now()-started)
    }).catch(()=>{});
  }
}
