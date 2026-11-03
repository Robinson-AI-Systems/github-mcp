// Contract-generic OAuth HTTP handlers (A-3b). Adapted from Robinson-AI-Systems/stripe-mcp src/core/oauth-handlers.js @ 90a49c0.
// Everything service-specific (which accounts exist, which settings a login chooses, how the page looks, which settings a
// token carries) comes from the injected `policy`, so this file imports nothing GitHub-specific and the hub can extract it:
//   policy.choices(db)                              -> whatever the page needs (e.g. the account list)
//   policy.page({ params, choices, client, error }) -> HTML for the authorize page
//   policy.validate({ params, choices })            -> { settings } (spread into createAuthCode) or { error } (page message)
//   policy.tokenSettings(record)                    -> settings spread into createAccessToken, copied from the issuing row
import { randomToken, hashToken, secretsMatch, verifyPkce, validRedirectUri, evaluateLogin, clientIp, LOCKOUT_WINDOW_MINUTES } from './oauth.js';
import { publicOrigin, send, paramsOf, only } from './http.js';

const tokenResponse = (access, refresh) => ({ access_token: access, token_type: 'Bearer', expires_in: 3600, refresh_token: refresh });
const bad = (res, status, code, description) => send(res, status, { error: code, error_description: description });
const html = (res, status, page) => send(res, status, page, 'text/html; charset=utf-8');
const str = (x) => (typeof x === 'string' ? x : '');

export function createOAuthHandlers({ db, env = process.env, policy, scopesSupported, resourceUrl = null, issueTokens = () => ({ accessToken: randomToken(32), refreshToken: randomToken(32) }) }) {
  if (!policy || ['choices', 'page', 'validate', 'tokenSettings'].some((name) => typeof policy[name] !== 'function')) {
    throw new TypeError('createOAuthHandlers needs a policy with choices, page, validate and tokenSettings.');
  }
  // resourceUrl is supplied only by trusted service composition after resolving the token's tenant.
  const urls = () => { const origin = publicOrigin(env); return { origin, resource: resourceUrl ?? origin + '/api/mcp' }; };
  // A missing resource defaults to this single canonical MCP audience. Explicit other targets fail.
  const validateResource = (value) => value === undefined || value === urls().resource;

  async function register(req, res) {
    if (!only(res, req, ['POST'])) return;
    let p;
    try { p = paramsOf(req); } catch { return bad(res, 400, 'invalid_client_metadata', 'Malformed registration'); }
    if (!Array.isArray(p.redirect_uris) || p.redirect_uris.length < 1 || p.redirect_uris.length > 8 ||
      !p.redirect_uris.every((x) => typeof x === 'string' && validRedirectUri(x)) || new Set(p.redirect_uris).size !== p.redirect_uris.length) {
      return bad(res, 400, 'invalid_client_metadata', 'One to eight valid, distinct redirect URIs required');
    }
    if (p.token_endpoint_auth_method && !['client_secret_post', 'none'].includes(p.token_endpoint_auth_method)) {
      return bad(res, 400, 'invalid_client_metadata', 'Supported methods: client_secret_post and none');
    }
    const id = randomToken(24);
    const authMethod = p.token_endpoint_auth_method ?? 'client_secret_post';
    const secret = authMethod === 'none' ? null : randomToken(32);
    await db.createOAuthClient({ clientId: id, clientSecret: secret, authMethod, redirectUris: p.redirect_uris, clientName: str(p.client_name).slice(0, 100) });
    return send(res, 201, {
      client_id: id, ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}), redirect_uris: p.redirect_uris,
      token_endpoint_auth_method: authMethod, grant_types: ['authorization_code', 'refresh_token'], response_types: ['code']
    });
  }

  async function authorize(req, res) {
    if (!only(res, req, ['GET', 'POST'])) return;
    let p;
    try { p = paramsOf(req); } catch { return bad(res, 400, 'invalid_request', 'Malformed authorization request'); }
    if (p.resource === undefined) p = { ...p, resource: urls().resource };
    const client = await db.getOAuthClient(str(p.client_id));
    if (!client || !client.redirect_uris?.includes(p.redirect_uri) || !validRedirectUri(p.redirect_uri)) {
      return bad(res, 400, 'invalid_request', 'Unknown client or redirect address');
    }
    if (p.response_type !== 'code' || p.code_challenge_method !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(str(p.code_challenge)) || !validateResource(p.resource)) {
      return bad(res, 400, 'invalid_request', 'Authorization code, S256 PKCE, and exact MCP resource are required');
    }
    const choices = await policy.choices(db);
    const show = (status, error = '') => html(res, status, policy.page({ params: p, choices, client, error }));
    if (req.method === 'GET') return show(200);

    if (!env.ADMIN_PASSPHRASE) return bad(res, 503, 'server_not_configured', 'Admin passphrase is not configured');
    const verdict = await evaluateLogin({ ip: clientIp(req), supplied: p.passphrase, expected: env.ADMIN_PASSPHRASE, store: db });
    if (verdict.status === 'locked') {
      res.setHeader('Retry-After', String(LOCKOUT_WINDOW_MINUTES * 60));
      return show(429, 'Too many sign-in attempts');
    }
    if (verdict.status !== 'ok') return show(401, 'Incorrect passphrase');

    // Only after the passphrase checks out do the chosen settings get examined (no oracle for strangers).
    const checked = policy.validate({ params: p, choices });
    if (checked.error) return show(400, checked.error);
    const code = randomToken(32);
    await db.createAuthCode({ code, clientId: p.client_id, redirectUri: p.redirect_uri, codeChallenge: p.code_challenge, codeChallengeMethod: 'S256', ...checked.settings });
    const destination = new URL(p.redirect_uri);
    destination.searchParams.set('code', code);
    if (typeof p.state === 'string') destination.searchParams.set('state', p.state);
    // Bind the OAuth response to the canonical advertised authorization issuer.
    destination.searchParams.set('iss', urls().origin);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Location', destination.toString());
    return res.status(302).end();
  }

  async function token(req, res) {
    if (!only(res, req, ['POST'])) return;
    let p;
    try { p = paramsOf(req); } catch { return bad(res, 400, 'invalid_request', 'Malformed token request'); }
    if (!validateResource(p.resource)) return bad(res, 400, 'invalid_target', 'Token resource must be this MCP');
    const client = await db.getOAuthClient(str(p.client_id));
    // The registration decides the auth method; requests cannot downgrade confidential clients.
    const publicClient = client?.token_endpoint_auth_method === 'none';
    if (!client || (publicClient ? p.client_secret !== undefined && p.client_secret !== ''
      : !(typeof p.client_secret === 'string' && p.client_secret && secretsMatch(hashToken(p.client_secret), client.client_secret_hash)))) {
      return bad(res, 401, 'invalid_client', 'Client credentials rejected');
    }
    if (p.grant_type === 'authorization_code') {
      if (!p.code || !client.redirect_uris.includes(p.redirect_uri) || !p.code_verifier) return bad(res, 400, 'invalid_grant', 'Missing or invalid authorization details');
      const record = await db.consumeAuthCode(p.code);
      if (!record || record.client_id !== p.client_id || record.redirect_uri !== p.redirect_uri || !verifyPkce(p.code_verifier, record.code_challenge, record.code_challenge_method)) {
        return bad(res, 400, 'invalid_grant', 'Code is expired, used, or failed PKCE');
      }
      const { accessToken, refreshToken } = issueTokens({ clientId: p.client_id });
      if (typeof accessToken !== 'string' || typeof refreshToken !== 'string' ||
          accessToken === refreshToken || accessToken.length < 30 || refreshToken.length < 30)
        return bad(res, 503, 'server_not_configured', 'Token issuer unavailable');
      // Every connection setting is copied from the issuing code row, never defaulted (hub contract §2).
      await db.createAccessToken({ accessToken, refreshToken, clientId: p.client_id, ...policy.tokenSettings(record) });
      return send(res, 200, tokenResponse(accessToken, refreshToken));
    }
    if (p.grant_type === 'refresh_token') {
      if (!str(p.refresh_token)) return bad(res, 400, 'invalid_grant', 'Missing refresh token');
      const { accessToken, refreshToken } = issueTokens({ clientId: p.client_id });
      if (typeof accessToken !== 'string' || typeof refreshToken !== 'string' ||
          accessToken === refreshToken || accessToken.length < 30 || refreshToken.length < 30)
        return bad(res, 503, 'server_not_configured', 'Token issuer unavailable');
      // The store rotates the credential in place on the same row, so every setting stays as issued.
      const rotated = await db.rotateRefreshToken({ refreshToken: p.refresh_token, clientId: p.client_id, accessToken, newRefreshToken: refreshToken });
      if (!rotated) return bad(res, 400, 'invalid_grant', 'Refresh credential is expired, used, or revoked');
      return send(res, 200, tokenResponse(accessToken, refreshToken));
    }
    return bad(res, 400, 'unsupported_grant_type', 'Supported grants: authorization_code and refresh_token');
  }

  function metadata(req, res) {
    if (!only(res, req, ['GET'])) return;
    const { origin } = urls();
    return send(res, 200, {
      issuer: origin, authorization_endpoint: origin + '/api/oauth/authorize', token_endpoint: origin + '/api/oauth/token',
      registration_endpoint: origin + '/api/oauth/register', response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'],
      authorization_response_iss_parameter_supported: true,
      token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
      // PUB-10: advertised only when the public-connect CIMD resolver is live on this
      // deployment; the resolver itself is built and tested before this line ships.
      ...(env.GITHUB_PUBLIC_CONNECT === 'enabled' ? { client_id_metadata_document_supported: true } : {}),
      ...(scopesSupported?{scopes_supported:scopesSupported}:{})
    });
  }

  function resourceMetadata(req, res) {
    if (!only(res, req, ['GET'])) return;
    const { origin, resource } = urls();
    return send(res, 200, { resource, authorization_servers: [origin],
      ...(scopesSupported?{scopes_supported:scopesSupported}:{}) });
  }

  return { register, authorize, token, metadata, resourceMetadata };
}
