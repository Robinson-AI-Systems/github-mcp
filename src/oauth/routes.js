// GitHub MCP composition boundary: the reusable core handlers are dependency-injected with this server's policy.
import { createOAuthHandlers } from '../core/oauth-handlers.js';
import { createGithubPolicy } from './policy.js';
import { getDb } from '../runtime.js';
import { isTenantRoutedCredential } from '../tenancy/routed-credential.js';
import { privateTenantToken } from '../tenancy/oauth-token.js';
import { paramsOf, send } from '../core/http.js';
import privateTenantAuthorize from '../../api/tenant/oauth/authorize.js';
import { isPublicClientId } from '../tenancy/public-code.js';
import { isCimdClientId } from '../tenancy/cimd-client.js';
import { publicConnectEnabled } from '../tenancy/public-connect.js';
import { publicApprove, publicAuthorize, publicForget, publicLimits, publicManage, publicTrust, publicMoved, publicRegister } from '../tenancy/public-http.js';
import { TRUST_PAGES } from '../tenancy/trust-pages.js';
import { MUSE_PUBLIC_CLIENT_ID } from '../tenancy/muse-client.js';

// DOOR-DB-1: the discovery documents are built from configuration alone; serving them never opens the store.
const STORELESS = Object.freeze(['metadata', 'resourceMetadata', 'museClient']);

// RAS MCP Standard D-006 MC-8: plain `muse` is the easy Client ID anyone can
// type. It is a nickname for this server's fixed public Muse client, swapped
// in on the request itself as it arrives (later steps re-read the request),
// so every door after this one sees the same client it always has.
export const MUSE_CLIENT_NICKNAME = 'muse';
export function applyMuseNickname(req) {
  if (req?.query && req.query.client_id === MUSE_CLIENT_NICKNAME) req.query = { ...req.query, client_id: MUSE_PUBLIC_CLIENT_ID };
  if (req?.method === 'GET') return;
  const body = req?.body;
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    if (body.client_id === MUSE_CLIENT_NICKNAME) req.body = { ...body, client_id: MUSE_PUBLIC_CLIENT_ID };
    return;
  }
  if (typeof body !== 'string' || body.length > 65536) return;
  const type = String(req.headers?.['content-type'] || '').split(';')[0].toLowerCase();
  if (type === 'application/x-www-form-urlencoded') {
    const form = new URLSearchParams(body);
    if (form.get('client_id') === MUSE_CLIENT_NICKNAME) { form.set('client_id', MUSE_PUBLIC_CLIENT_ID); req.body = form.toString(); }
  } else if (type === 'application/json') {
    try {
      const parsed = JSON.parse(body);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.client_id === MUSE_CLIENT_NICKNAME)
        req.body = JSON.stringify({ ...parsed, client_id: MUSE_PUBLIC_CLIENT_ID });
    } catch { /* malformed bodies are refused by the handler as before */ }
  }
}

/** Runs one OAuth handler. Any failure answers 503 with no detail (never SQL, tokens, passphrases or stack text). */
export async function handleOAuth(which, req, res, { db, env = process.env, consentFactory } = {}) {
  try {
    if (['authorize', 'token', 'revoke'].includes(which)) applyMuseNickname(req);
    // PUB-6 (dark): while GITHUB_PUBLIC_CONNECT is on, registration creates public clients (pcl_), never owner clients.
    if (which === 'register' && publicConnectEnabled(env)) return await publicRegister(req, res, { env });
    if (which === 'authorize' && ['GET','POST'].includes(req.method)) {
      let params;
      try { params = paramsOf(req); } catch { return send(res, 400, { error: 'invalid_request' }); }
      // Standard MCP discovery advertises /api/oauth/authorize. A pre-enrolled
      // PRIVATE tenant client must land on GitHub consent there, not the
      // global owner's administrator-passphrase authorization page.
      // Invalid signed clients fail closed; never query the owner DB for them.
      if (publicConnectEnabled(env)) {
        if (params.page === 'limits') return await publicLimits(req, res, { env });
        if (TRUST_PAGES.includes(params.page)) return await publicTrust(req, res, { env });
        if (params.forget === '1') return await publicForget(req, res, { env });
        if (params.manage === '1' || req.query?.manage === '1') return await publicManage(req, res, { env });
        if (params.step === 'approve') return await publicApprove(req, res, { env });
      }
      if (isPublicClientId(params.client_id) || isCimdClientId(params.client_id)) return await publicAuthorize(req, res, { env });
      if (isTenantRoutedCredential(params.client_id)) {
        // One sign-in for everyone: once the public sign-in is on, the older private-pilot sign-in takes no NEW sign-ins.
        // Connections it already made keep working (their refresh is untouched); reconnecting goes through the new flow.
        if (publicConnectEnabled(env)) return publicMoved(req, res);
        return privateTenantAuthorize(req,res,{env,consentFactory});
      }
    }
    if (which === 'token' && req.method === 'POST') {
      let params;
      try { params = paramsOf(req); } catch { return send(res, 400, { error: 'invalid_request' }); }
      // Never try an explicitly tenant-routed client/refresh token against
      // the legacy owner database, even if the marker/signature is invalid.
      if (isTenantRoutedCredential(params.client_id) || isPublicClientId(params.client_id) || isCimdClientId(params.client_id))
        return privateTenantToken(req, res, { env });
      if (isTenantRoutedCredential(params.refresh_token) ||
          isTenantRoutedCredential(params.code))
        return send(res, 401, { error: 'invalid_client' });
    }
    const handlers = createOAuthHandlers({ db: db ?? (STORELESS.includes(which) ? null : await getDb()), env, policy: createGithubPolicy({ env }),
      ...(env.GITHUB_PRIVATE_TENANT_PILOT==='enabled'?{scopesSupported:['github.notifications.read']}:{}) });
    return await handlers[which](req, res);
  } catch {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(503).json({ error: 'temporarily_unavailable', error_description: 'GitHub Unleashed is not configured or its database is unavailable' });
  }
}
