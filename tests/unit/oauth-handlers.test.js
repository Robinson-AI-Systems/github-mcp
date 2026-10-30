import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { createFakeDb } from '../../test/helpers/fake-db.js';
import { call, json, request } from '../../test/helpers/http-harness.js';
import { createOAuthHandlers } from '../../src/core/oauth-handlers.js';
import { createGithubPolicy } from '../../src/oauth/policy.js';

const baseEnv = { PUBLIC_BASE_URL: 'https://github-mcp.example.test', ADMIN_PASSPHRASE: 'only-the-owner-knows' };
const resource = baseEnv.PUBLIC_BASE_URL + '/api/mcp';
const callback = 'https://client.example.test/cb';
const verifier = 'a'.repeat(43);
const challenge = createHash('sha256').update(verifier).digest('base64url');
const ACCOUNTS = [
  { login: 'example-org', label: 'Example Org', production_enabled: false, is_default: true },
  { login: 'example-user', label: 'Example User', production_enabled: true, is_default: false }
];

async function fixture(env = baseEnv, accounts = ACCOUNTS) {
  let now = Date.now();
  const db = createFakeDb({ clock: () => now });
  await db.seedAccounts(accounts);
  return { db, h: createOAuthHandlers({ db, env, policy: createGithubPolicy({ env }) }), advance: (n) => { now += n; } };
}
async function register(h, name = 'Personal agent') {
  const res = await call(h.register, request('POST', { redirect_uris: [callback], client_name: name }));
  expect(res.statusCode).toBe(201);
  return json(res);
}
const form = (client, extra = {}) => ({
  client_id: client.client_id, redirect_uri: callback, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256',
  resource, state: 'nonce123', 'acct:example-org': 'on', 'acct:example-user': 'on', default_account: 'example-user',
  mode: 'preview', profile: 'full', listing: 'compact', ...extra
});
const tokenRequest = (client, code) => request('POST', {
  grant_type: 'authorization_code', client_id: client.client_id, client_secret: client.client_secret, redirect_uri: callback, code, code_verifier: verifier, resource
});
const refreshRequest = (client, refresh, extra = {}) => request('POST', {
  grant_type: 'refresh_token', client_id: client.client_id, client_secret: client.client_secret, refresh_token: refresh, resource, ...extra
});

describe('policy plumbing', () => {
  it('refuses to build handlers without a complete policy', () => {
    expect(() => createOAuthHandlers({ db: {}, env: baseEnv })).toThrow(TypeError);
    expect(() => createOAuthHandlers({ db: {}, env: baseEnv, policy: { choices() {} } })).toThrow(TypeError);
  });
});

describe('connector metadata and registration', () => {
  it('publishes fixed HTTPS metadata and does not advertise weak PKCE', async () => {
    const { h } = await fixture();
    const auth = json(await call(h.metadata, request('GET', {})));
    expect(auth.issuer).toBe(baseEnv.PUBLIC_BASE_URL);
    expect(auth.authorization_endpoint).toBe(baseEnv.PUBLIC_BASE_URL + '/api/oauth/authorize');
    expect(auth.code_challenge_methods_supported).toEqual(['S256']);
    expect(auth.authorization_response_iss_parameter_supported).toBe(true);
    expect(json(await call(h.resourceMetadata, request('GET', {}))).resource).toBe(resource);
    expect((await call(h.metadata, request('POST', {}))).statusCode).toBe(405);
  });

  it('never derives the issuer from a request header: a missing or non-HTTPS PUBLIC_BASE_URL throws', async () => {
    for (const bad of [undefined, 'http://github-mcp.example.test', 'https://user:pw@github-mcp.example.test', 'https://github-mcp.example.test/path']) {
      const { h } = await fixture({ ...baseEnv, PUBLIC_BASE_URL: bad });
      await expect(call(h.metadata, request('GET', { host: 'evil.example.test' }, { host: 'evil.example.test' }))).rejects.toThrow(/PUBLIC_BASE_URL/);
    }
  });

  it('registers a client, returning its secret once and storing only the hash', async () => {
    const { h, db } = await fixture();
    const client = await register(h);
    expect(client).toMatchObject({ token_endpoint_auth_method: 'client_secret_post', redirect_uris: [callback], client_secret_expires_at: 0 });
    const stored = await db.getOAuthClient(client.client_id);
    expect(JSON.stringify(stored)).not.toContain(client.client_secret);
  });

  it('registers a secretless public client and exchanges and refreshes with PKCE and no resource', async () => {
    const { h, db } = await fixture();
    const created = json(await call(h.register, request('POST', {
      redirect_uris: [callback], client_name: 'Muse', token_endpoint_auth_method: 'none'
    })));
    expect(created.client_id).toBeTruthy();
    expect(created.token_endpoint_auth_method).toBe('none');
    expect(created).not.toHaveProperty('client_secret');
    expect((await db.getOAuthClient(created.client_id)).token_endpoint_auth_method).toBe('none');
    const requestData = form(created, { resource: undefined, scope: 'mcp:read mcp:write',
      passphrase: baseEnv.ADMIN_PASSPHRASE });
    expect((await call(h.authorize, request('GET', requestData))).statusCode).toBe(200);
    const approved = await call(h.authorize, request('POST', requestData));
    expect(approved.statusCode).toBe(302);
    const code = new URL(approved.headers.Location).searchParams.get('code');
    expect(code).toBeTruthy();
    const tokenBody = { grant_type: 'authorization_code', client_id: created.client_id,
      code, redirect_uri: callback, code_verifier: verifier };
    const issued = await call(h.token, request('POST', tokenBody));
    expect(issued.statusCode).toBe(200);
    const first = json(issued);
    expect(first.access_token).toBeTruthy();
    const refreshed = await call(h.token, request('POST', {
      grant_type: 'refresh_token', client_id: created.client_id, refresh_token: first.refresh_token
    }));
    expect(refreshed.statusCode).toBe(200);
    expect(json(refreshed).refresh_token).not.toBe(first.refresh_token);
    expect((await call(h.token, request('POST', {
      grant_type: 'refresh_token', client_id: created.client_id, refresh_token: first.refresh_token
    }))).statusCode).toBe(400);
  });

  it('keeps secretless grants bound to the exact redirect, client, PKCE and MCP audience', async () => {
    const { h } = await fixture();
    const create = async () => json(await call(h.register, request('POST', {
      redirect_uris: [callback], token_endpoint_auth_method: 'none'
    })));
    const client = await create(), other = await create();
    const badAudience = await call(h.authorize, request('GET', form(client, {
      resource: 'https://foreign.example.test/api/mcp'
    })));
    expect(badAudience.statusCode).toBe(400);
    const approved = await call(h.authorize, request('POST', form(client, {
      resource: undefined, passphrase: baseEnv.ADMIN_PASSPHRASE
    })));
    const code = new URL(approved.headers.Location).searchParams.get('code');
    const params = { grant_type: 'authorization_code', client_id: client.client_id, code,
      redirect_uri: callback, code_verifier: verifier };
    expect((await call(h.token, request('POST', { ...params, resource: 'https://foreign.example.test/api/mcp' }))).statusCode).toBe(400);
    expect((await call(h.token, request('POST', { ...params, client_id: other.client_id }))).statusCode).toBe(400);
    // Consuming a code for a different client does not issue access to either party.
    expect((await call(h.token, request('POST', params))).statusCode).toBe(400);
    const another = await call(h.authorize, request('POST', form(client, {
      resource: undefined, passphrase: baseEnv.ADMIN_PASSPHRASE
    })));
    const nextCode = new URL(another.headers.Location).searchParams.get('code');
    expect((await call(h.token, request('POST', { ...params, code: nextCode, code_verifier: 'z'.repeat(43) }))).statusCode).toBe(400);
    expect((await call(h.token, request('POST', { ...params, code: nextCode }))).statusCode).toBe(400);
  });

  it('never treats a confidential client as public when the caller omits its secret', async () => {
    const { h } = await fixture();
    const client = await register(h);
    const approved = await call(h.authorize, request('POST', form(client, { passphrase: baseEnv.ADMIN_PASSPHRASE })));
    const code = new URL(approved.headers.Location).searchParams.get('code');
    const body = { grant_type: 'authorization_code', client_id: client.client_id,
      code, redirect_uri: callback, code_verifier: verifier };
    expect((await call(h.token, request('POST', body))).statusCode).toBe(401);
    expect((await call(h.token, request('POST', { ...body, client_secret: client.client_secret }))).statusCode).toBe(200);
  });

  it('rejects insecure or duplicate redirect URIs, too many of them, and unsupported client authentication', async () => {
    const { h } = await fixture();
    const attempts = [
      { redirect_uris: ['http://evil.example.test/cb'] }, { redirect_uris: [] }, { redirect_uris: [callback, callback] },
      { redirect_uris: Array.from({ length: 9 }, (_, n) => `https://client.example.test/cb${n}`) },
      { redirect_uris: [callback], token_endpoint_auth_method: 'client_secret_basic' }, {}
    ];
    for (const body of attempts) {
      const res = await call(h.register, request('POST', body));
      expect(res.statusCode).toBe(400);
      expect(json(res).error).toBe('invalid_client_metadata');
    }
    expect((await call(h.register, request('GET', {}))).statusCode).toBe(405);
  });
});

describe('authorize page', () => {
  it('lists the accounts, preselects the default account, and defaults the listing by client', async () => {
    const { h } = await fixture({ ...baseEnv, VERCEL_ENV: 'production' });
    const generic = await register(h);
    const page = await call(h.authorize, request('GET', { ...form(generic), 'acct:example-org': undefined, 'acct:example-user': undefined, default_account: undefined, listing: undefined, profile: undefined, mode: undefined }));
    expect(page.statusCode).toBe(200);
    expect(page.headers['Content-Type']).toMatch(/text\/html/);
    expect(page.body).toContain('Example Org');
    expect(page.body).toMatch(/name="acct:example-org" value="on" checked/);
    expect(page.body).not.toMatch(/name="acct:example-user" value="on" checked/);
    expect(page.body).toMatch(/<option value="example-org" selected>/);
    expect(page.body).toContain('<option value="everyday" selected>');
    expect(page.body).toContain('<option value="compact" selected>');
    expect(page.body).toContain('<option value="production" selected>');
    expect(page.body).toContain('<option value="preview">');
    const claude = await register(h, 'Claude');
    const claudePage = await call(h.authorize, request('GET', { ...form(claude), listing: undefined }));
    expect(claudePage.body).toContain('<option value="catalog" selected>');
  });

  it('preserves a missing resource as the canonical MCP audience through browser form submission', async () => {
    const { h } = await fixture();
    const client = await register(h);
    const page = await call(h.authorize, request('GET', form(client, { resource: undefined })));
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('name="resource" value="' + resource + '"');
    const posted = await call(h.authorize, request('POST', form(client, {
      resource, passphrase: baseEnv.ADMIN_PASSPHRASE
    })));
    expect(posted.statusCode).toBe(302);
  });

  it('offers production, selected by default, on the production deployment whatever the per-account setting; preview deployments offer preview only', async () => {
    for (const [env, accounts, expected] of [
      [baseEnv, ACCOUNTS, false],
      [{ ...baseEnv, VERCEL_ENV: 'preview' }, ACCOUNTS, false],
      [{ ...baseEnv, VERCEL_ENV: 'production' }, ACCOUNTS.map((a) => ({ ...a, production_enabled: false })), true],
      [{ ...baseEnv, VERCEL_ENV: 'production' }, ACCOUNTS, true]
    ]) {
      const { h } = await fixture(env, accounts);
      const client = await register(h);
      const page = await call(h.authorize, request('GET', form(client, { mode: undefined })));
      expect(page.body.includes('<option value="production"')).toBe(expected);
      expect(page.body).toContain('<option value="preview"');
      if (expected) expect(page.body).toContain('<option value="production" selected>');
      else expect(page.body).toContain('<option value="preview" selected>');
    }
  });

  it('disables the form when no account is connected', async () => {
    const { h } = await fixture(baseEnv, []);
    const client = await register(h);
    const page = await call(h.authorize, request('GET', form(client)));
    expect(page.body).toContain('No GitHub accounts are connected yet');
    expect(page.body).toContain('href="/api/github/setup"');
    expect(page.body).toContain('<button type="submit" disabled>');
  });

  it('escapes everything it echoes (state, account names, error text) so a crafted value cannot inject markup', async () => {
    const evil = '"><script>alert(1)</script>';
    const { h } = await fixture(baseEnv, [{ login: 'example-org', label: evil, production_enabled: false, is_default: true }]);
    const client = await register(h);
    const page = await call(h.authorize, request('GET', form(client, { state: evil })));
    expect(page.body).not.toContain('<script>alert(1)</script>');
    expect(page.body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    const wrong = await call(h.authorize, request('POST', form(client, { state: evil, passphrase: 'nope' })));
    expect(wrong.body).not.toContain('<script>alert(1)</script>');
  });

  it('refuses unknown clients, unregistered redirects, weak PKCE and a foreign resource before showing anything', async () => {
    const { h } = await fixture();
    const client = await register(h);
    const bad = [
      { client_id: 'nobody' }, { redirect_uri: 'https://elsewhere.example.test/cb' }, { response_type: 'token' },
      { code_challenge_method: 'plain' }, { code_challenge: 'short' }, { resource: 'https://elsewhere.example.test/api/mcp' }
    ];
    for (const change of bad) {
      for (const method of ['GET', 'POST']) {
        const res = await call(h.authorize, request(method, form(client, { ...change, passphrase: baseEnv.ADMIN_PASSPHRASE })));
        expect(res.statusCode).toBe(400);
        expect(json(res).error).toBe('invalid_request');
      }
    }
  });
});

describe('sign-in and what a login may choose', () => {
  it('fails closed when no administrator passphrase is configured, and creates no code', async () => {
    const { h, db } = await fixture({ PUBLIC_BASE_URL: baseEnv.PUBLIC_BASE_URL });
    const client = await register(h);
    const res = await call(h.authorize, request('POST', form(client, { passphrase: '' })));
    expect(res.statusCode).toBe(503);
    expect(json(res).error).toBe('server_not_configured');
    expect(await db.consumeAuthCode('anything')).toBeNull();
  });

  it('locks the address after five wrong passphrases; the right one cannot bypass the lock', async () => {
    const { h } = await fixture();
    const client = await register(h);
    for (let n = 0; n < 5; n++) {
      const res = await call(h.authorize, request('POST', form(client, { passphrase: n === 0 ? '' : 'wrong' })));
      expect(res.statusCode).toBe(401);
    }
    const locked = await call(h.authorize, request('POST', form(client, { passphrase: baseEnv.ADMIN_PASSPHRASE })));
    expect(locked.statusCode).toBe(429);
    expect(locked.headers['Retry-After']).toBe('900');
    expect(locked.headers.Location).toBeUndefined();
  });

  it('does not examine the chosen settings until the passphrase is right (a stranger learns nothing)', async () => {
    const { h } = await fixture();
    const client = await register(h);
    const res = await call(h.authorize, request('POST', form(client, { 'acct:nobody': 'on', mode: 'production', passphrase: 'wrong' })));
    expect(res.statusCode).toBe(401);
    expect(res.body).toContain('Incorrect passphrase');
    expect(res.body).not.toContain('Unknown GitHub account');
  });

  it('refuses invalid choices after a correct passphrase, with a page message and no code', async () => {
    const { h } = await fixture();
    const client = await register(h);
    const cases = [
      [{ 'acct:example-org': undefined, 'acct:example-user': undefined }, 'Choose at least one'],
      [{ 'acct:nobody': 'on' }, 'Unknown GitHub account'],
      [{ 'acct:example-user': 'off' , default_account: 'example-user' }, 'default account must be one of the selected'],
      [{ default_account: 'someone-else' }, 'default account must be one of the selected'],
      [{ default_account: undefined }, 'default account must be one of the selected'],
      [{ profile: 'admin' }, 'Invalid mode, profile or tool listing'],
      [{ listing: 'everything' }, 'Invalid mode, profile or tool listing'],
      [{ mode: 'live' }, 'Invalid mode, profile or tool listing']
    ];
    for (const [change, message] of cases) {
      const res = await call(h.authorize, request('POST', form(client, { passphrase: baseEnv.ADMIN_PASSPHRASE, ...change })));
      expect(res.statusCode, message).toBe(400);
      expect(res.body).toContain(message);
      expect(res.headers.Location).toBeUndefined();
    }
  });

  it('uses the only selected account as the default when none is named', async () => {
    const { h } = await fixture();
    const client = await register(h);
    const res = await call(h.authorize, request('POST', form(client, { 'acct:example-org': undefined, default_account: undefined, passphrase: baseEnv.ADMIN_PASSPHRASE })));
    expect(res.statusCode).toBe(302);
  });

  it('refuses a forged mode=production on a preview deployment, but grants it on the production deployment even for an account without the old per-account switch', async () => {
    for (const env of [baseEnv, { ...baseEnv, VERCEL_ENV: 'preview' }]) {
      const { h } = await fixture(env);
      const client = await register(h);
      const res = await call(h.authorize, request('POST', form(client, { mode: 'production', passphrase: baseEnv.ADMIN_PASSPHRASE })));
      expect(res.statusCode).toBe(400);
      expect(res.body).toContain('Production mode is not available on this deployment');
      expect(res.headers.Location).toBeUndefined();
    }
    const { h } = await fixture({ ...baseEnv, VERCEL_ENV: 'production' });
    const client = await register(h);
    const res = await call(h.authorize, request('POST', form(client, { mode: 'production', passphrase: baseEnv.ADMIN_PASSPHRASE })));
    expect(res.statusCode).toBe(302);
    expect(res.body ?? '').not.toContain('Production is not turned on');
  });

  it('grants a production connection only on the production deployment', async () => {
    const { h, db } = await fixture({ ...baseEnv, VERCEL_ENV: 'production' });
    const client = await register(h);
    const granted = await call(h.authorize, request('POST', form(client, {
      mode: 'production', 'acct:example-org': undefined, default_account: 'example-user', passphrase: baseEnv.ADMIN_PASSPHRASE
    })));
    expect(granted.statusCode).toBe(302);
    const code = new URL(granted.headers.Location).searchParams.get('code');
    const tokens = json(await call(h.token, tokenRequest(client, code)));
    expect(await db.getAccessToken(tokens.access_token)).toMatchObject({ mode: 'production', accounts: ['example-user'], default_account: 'example-user' });
  });
});

describe('code and token exchange', () => {
  it('one login persists through access expiry and every refresh keeps all connection settings', async () => {
    const { h, db, advance } = await fixture();
    const client = await register(h);
    const authorized = await call(h.authorize, request('POST', form(client, { passphrase: baseEnv.ADMIN_PASSPHRASE })));
    expect(authorized.statusCode).toBe(302);
    const location = new URL(authorized.headers.Location);
    expect(location.origin + location.pathname).toBe(callback);
    expect(location.searchParams.get('state')).toBe('nonce123');
    expect(location.searchParams.get('iss')).toBe(baseEnv.PUBLIC_BASE_URL);
    const code = location.searchParams.get('code');
    expect(authorized.headers['Cache-Control']).toBe('no-store');

    const wrongSecret = await call(h.token, request('POST', { ...tokenRequest(client, code).body, client_secret: 'wrong-client-secret' }));
    expect(wrongSecret.statusCode).toBe(401);
    expect(json(wrongSecret).error).toBe('invalid_client');

    const granted = await call(h.token, tokenRequest(client, code));
    expect(granted.statusCode).toBe(200);
    const original = json(granted);
    expect(original).toMatchObject({ token_type: 'Bearer', expires_in: 3600 });
    const settings = { default_account: 'example-user', accounts: ['example-org', 'example-user'], mode: 'preview', profile: 'full', listing: 'compact' };
    expect(await db.getAccessToken(original.access_token)).toMatchObject(settings);
    expect((await call(h.token, tokenRequest(client, code))).statusCode).toBe(400);

    advance(45 * 86_400_000);
    expect(await db.getAccessToken(original.access_token)).toBeNull();
    const refreshed = await call(h.token, refreshRequest(client, original.refresh_token));
    expect(refreshed.statusCode).toBe(200);
    const second = json(refreshed);
    expect(await db.getAccessToken(second.access_token)).toMatchObject(settings);
    const replay = await call(h.token, refreshRequest(client, original.refresh_token));
    expect(replay.statusCode).toBe(400);
    expect(json(replay).error).toBe('invalid_grant');
    // a replay right after the rotation is only refused (two refreshes racing); the reuse test below covers the later replay
    const third = json(await call(h.token, refreshRequest(client, second.refresh_token)));
    expect(await db.getAccessToken(third.access_token)).toMatchObject(settings);
  });
  it('every normal refresh keeps the same settings and chains forward', async () => {
    const { h, db } = await fixture();
    const client = await register(h);
    const code = new URL((await call(h.authorize, request('POST', form(client, { passphrase: baseEnv.ADMIN_PASSPHRASE })))).headers.Location).searchParams.get('code');
    let tokens = json(await call(h.token, tokenRequest(client, code)));
    for (let i = 0; i < 3; i += 1) {
      tokens = json(await call(h.token, refreshRequest(client, tokens.refresh_token)));
      expect(await db.getAccessToken(tokens.access_token)).toMatchObject({ default_account: 'example-user', profile: 'full', listing: 'compact' });
    }
  });

  it('refuses a refresh from another client, for a foreign resource, after revocation, and a missing credential', async () => {
    const { h, db } = await fixture();
    const client = await register(h);
    const other = await register(h, 'Other agent');
    const code = new URL((await call(h.authorize, request('POST', form(client, { passphrase: baseEnv.ADMIN_PASSPHRASE })))).headers.Location).searchParams.get('code');
    const tokens = json(await call(h.token, tokenRequest(client, code)));
    expect((await call(h.token, refreshRequest(other, tokens.refresh_token))).statusCode).toBe(400);
    expect((await call(h.token, refreshRequest({ client_id: 'fake-other-client', client_secret: client.client_secret }, tokens.refresh_token))).statusCode).toBe(401);
    const foreign = await call(h.token, refreshRequest(client, tokens.refresh_token, { resource: 'https://elsewhere.example.test/api/mcp' }));
    expect(foreign.statusCode).toBe(400);
    expect(json(foreign).error).toBe('invalid_target');
    expect((await call(h.token, refreshRequest(client, ''))).statusCode).toBe(400);
    await db.revokeAccessToken(tokens.access_token);
    expect((await call(h.token, refreshRequest(client, tokens.refresh_token))).statusCode).toBe(400);
  });

  it('PUB-5 C: a refresh token works once; showing a used one again ends the whole sign-in (access and refresh both stop)', async () => {
    const { h, db, advance } = await fixture();
    const client = await register(h);
    const code = new URL((await call(h.authorize, request('POST', form(client, { passphrase: baseEnv.ADMIN_PASSPHRASE })))).headers.Location).searchParams.get('code');
    const first = json(await call(h.token, tokenRequest(client, code)));
    const second = json(await call(h.token, refreshRequest(client, first.refresh_token)));
    expect(second.refresh_token).not.toBe(first.refresh_token);
    expect(await db.getAccessToken(second.access_token)).not.toBeNull();
    // two refreshes racing within a minute (same app, flaky network): the second is refused but the sign-in lives
    expect((await call(h.token, refreshRequest(client, first.refresh_token))).statusCode).toBe(400);
    expect(await db.getAccessToken(second.access_token)).not.toBeNull();
    advance(120_000);
    // the thief (or a confused client) shows the old refresh token again
    const replay = await call(h.token, refreshRequest(client, first.refresh_token));
    expect(replay.statusCode).toBe(400);
    expect(json(replay).error).toBe('invalid_grant');
    // the whole sign-in is over: the newest access token and the newest refresh token no longer work
    expect(await db.getAccessToken(second.access_token)).toBeNull();
    expect((await call(h.token, refreshRequest(client, second.refresh_token))).statusCode).toBe(400);
  });

  it('refuses a code used with the wrong verifier, redirect, client or an expired code, and unknown grant types', async () => {
    const { h, advance } = await fixture();
    const client = await register(h);
    const other = await register(h, 'Other agent');
    const fresh = async () => new URL((await call(h.authorize, request('POST', form(client, { passphrase: baseEnv.ADMIN_PASSPHRASE })))).headers.Location).searchParams.get('code');
    const attempts = [
      (code) => request('POST', { ...tokenRequest(client, code).body, code_verifier: 'b'.repeat(43) }),
      (code) => request('POST', { ...tokenRequest(client, code).body, code_verifier: undefined }),
      (code) => request('POST', { ...tokenRequest(client, code).body, redirect_uri: 'https://elsewhere.example.test/cb' }),
      (code) => request('POST', { ...tokenRequest(other, code).body })
    ];
    for (const make of attempts) {
      const res = await call(h.token, make(await fresh()));
      expect([400, 401]).toContain(res.statusCode);
      expect(res.statusCode === 400 ? json(res).error : 'invalid_client').toMatch(/invalid_grant|invalid_client/);
    }
    const expiring = await fresh();
    advance(11 * 60_000);
    expect((await call(h.token, tokenRequest(client, expiring))).statusCode).toBe(400);
    const odd = await call(h.token, request('POST', { grant_type: 'password', client_id: client.client_id, client_secret: client.client_secret, resource }));
    expect(json(odd).error).toBe('unsupported_grant_type');
    expect((await call(h.token, request('GET', {}))).statusCode).toBe(405);
  });
});
