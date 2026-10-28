import { createMarketplaceStore } from '../../src/marketplace/store.js';
import { createMarketplaceWebhook, sweepMarketplace } from '../../src/marketplace/lifecycle.js';
import crypto, { createHash } from 'node:crypto';
import pg from 'pg';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createDb } from '../../src/db.js';
import { createTenantDirectory, tenantSchemaName } from '../../src/tenancy/directory.js';
import { createPublicConnect, FORGET_CLIENT, MANAGE_CLIENT, PublicConnectError } from '../../src/tenancy/public-connect.js';
import { parsePublicCode } from '../../src/tenancy/public-code.js';
import { privateTenantToken } from '../../src/tenancy/oauth-token.js';
import { resolvePrivateTenantMcpBearer } from '../../src/tenancy/mcp-route.js';
import { publicApprove, publicAuthorize, publicCallback, publicForget, publicManage, publicRegister } from '../../src/tenancy/public-http.js';
import { encryptSecret } from '../../src/core/crypto.js';
import { Readable } from 'node:stream';
import { createCredentials } from '../../src/github/credentials.js';
import { createWebhookHandler } from '../../src/github/webhook.js';
import { createPublicCleanup } from '../../src/tenancy/public-cleanup.js';
import { call, json, request, response } from '../../test/helpers/http-harness.js';

const APP = 960001, ORIGIN = 'https://connect.example.test', CB = 'https://chat.example.test/oauth/callback';
let admin, root, directory, env;
const clients = [], pool = new Map();
const connect = async (url) => { const c = new pg.Client({ connectionString: url }); await c.connect(); clients.push(c); return c; };
const sqlFor = (client) => async (template, ...values) => {
  let query = template[0];
  for (let i = 0; i < values.length; i++) query += '$' + (i + 1) + template[i + 1];
  return (await client.query(query, values)).rows;
};
const rootSqlFactory = () => sqlFor(admin);
const tenantSqlFactory = (url) => {
  if (!pool.has(url)) { const p = connect(url); pool.set(url, async (parts, ...params) => sqlFor(await p)(parts, ...params)); }
  return pool.get(url);
};
// A fake GitHub: people are keyed by the code they present; installations differ per person.
const people = {
  alice: { token: 'tok-alice-0001', id: 31001, login: 'alice-dev', roles: { 'client-co': 'admin' }, installs: [
    { id: 41001, app_id: APP, account: { id: 31001, login: 'alice-dev', type: 'User' }, repository_selection: 'all', suspended_at: null },
    { id: 41002, app_id: APP, account: { id: 51001, login: 'client-co', type: 'Organization' }, repository_selection: 'all', suspended_at: null },
    { id: 41003, app_id: 777, account: { id: 51002, login: 'other-app-org', type: 'Organization' }, repository_selection: 'all', suspended_at: null }] },
  bob: { token: 'tok-bob-00002', id: 31002, login: 'bob-test', installs: [
    { id: 41010, app_id: APP, account: { id: 31002, login: 'bob-test', type: 'User' }, repository_selection: 'all', suspended_at: null }] },
  erin: { token: 'tok-erin-00005', id: 31005, login: 'erin-member', roles: { 'client-co': 'member' }, installs: [
    { id: 41040, app_id: APP, account: { id: 51001, login: 'client-co', type: 'Organization' }, repository_selection: 'all', suspended_at: null }] },
  carol: { token: 'tok-carol-003', id: 31003, login: 'carol-new', installs: [] },
  dave: { token: 'tok-dave-0006', id: 31006, login: 'dave-solo', roles: { 'client-co': 'admin' }, installs: [
    { id: 41050, app_id: APP, account: { id: 51001, login: 'client-co', type: 'Organization' }, repository_selection: 'all', suspended_at: null }] }
};
people.market = { ...people.alice, token:'ghu_FAKE-marketplace-0001' };
const revokedMarketplace = new Set();
let failMarketplaceRevocation = false;
const fetchImpl = async (url, opts = {}) => {
  if (url.startsWith('https://api.github.com/applications/fixture-app-client/token')) {
    if (failMarketplaceRevocation) return new Response('{}',{status:503});
    revokedMarketplace.add(JSON.parse(opts.body).access_token);
    return new Response(null,{status:204});
  }
  if (url.startsWith('https://api.github.com/user/marketplace_purchases'))
    return Response.json([{account:{id:51001},plan:{id:920001,monthly_price_in_cents:0,yearly_price_in_cents:0}}]);
  if (url === 'https://github.com/login/oauth/access_token') {
    const who = people[String(opts.body.get('code')).split('-')[0]];
    if (!who) return { ok: false, status: 400, json: async () => ({}) };
    return { ok: true, json: async () => ({ access_token: who.token, refresh_token: who.token + '-refresh', expires_in: 28800, refresh_token_expires_in: 15000000 }) };
  }
  const who = Object.values(people).find((p) => opts.headers?.authorization === 'Bearer ' + p.token);
  if (!who) return { ok: false, status: 401, json: async () => ({}) };
  if (url === 'https://api.github.com/user') return { ok: true, status: 200, json: async () => ({ id: who.id, login: who.login, type: 'User' }) };
  if (url.startsWith('https://api.github.com/user/memberships/orgs/')) {
    const org = url.split('/').pop();
    const role = who.roles?.[org];
    return role ? { ok: true, status: 200, json: async () => ({ state: 'active', role, organization: { id: org === 'client-co' ? 51001 : 0 } }) } : { ok: false, status: 404, json: async () => ({}) };
  }
  if (url === 'https://api.github.com/user/memberships/orgs?state=active&per_page=100')
    return { ok: true, status: 200, json: async () => Object.entries(who.roles ?? {}).map(([login, role]) => ({ state: 'active', role, organization: { id: login === 'client-co' ? 51001 : 0, login } })) };
  if (url === 'https://api.github.com/user/installations?per_page=100') return { ok: true, status: 200, json: async () => ({ total_count: who.installs.length, installations: who.installs }) };
  throw new Error('unrecognized fixture route ' + url);
};
const verifier = 'v'.repeat(43), challenge = createHash('sha256').update(verifier).digest('base64url');
const make = (over = {}) => createPublicConnect({ env: { ...env, ...over }, fetchImpl, rootSqlFactory, tenantSqlFactory });
const authorizeParams = (client, extra = {}) => ({ client_id: client.client_id, response_type: 'code', redirect_uri: CB,
  code_challenge: challenge, code_challenge_method: 'S256', state: 'client-nonce', resource: ORIGIN + '/api/mcp', ...extra });
async function signIn(connector, client, who, extra = {}) {
  const started = await connector.begin(authorizeParams(client, extra));
  const url = new URL(started.url);
  expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize');
  return { started, finished: connector.finish({ state: started.state, code: who + '-fixture-code-1' }) };
}
/** Sign in and tap Approve (optionally Read-only). Returns the app's redirect address. */
async function approved(connector, client, who, { readOnly = false, extra = {} } = {}) {
  const result = await (await signIn(connector, client, who, extra)).finished;
  if (!result.approve) throw new Error('expected the Approve page, got ' + Object.keys(result));
  return (await connector.approve({ handle: result.approve.handle, choice: 'approve', readOnly })).redirect;
}
const codeOf = (redirect) => new URL(redirect).searchParams.get('code');
const exchange = (client, code) => call((req, res) => privateTenantToken(req, res, { env, rootSqlFactory, tenantSqlFactory }),
  request('POST', { grant_type: 'authorization_code', client_id: client.client_id, client_secret: client.client_secret,
    redirect_uri: CB, code, code_verifier: verifier, resource: ORIGIN + '/api/mcp' }));

beforeAll(async () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('Disposable TEST_DATABASE_URL is required.');
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(url).hostname)) throw new Error('Refusing non-local PostgreSQL.');
  admin = await connect(url);
  const ns = 'github_pub6_' + crypto.randomBytes(6).toString('hex');
  await admin.query('CREATE SCHEMA "' + ns + '"'); await admin.query('SET search_path TO "' + ns + '"');
  admin.ns = ns;
  directory = createTenantDirectory(sqlFor(admin)); await directory.initSchema();
  root = createDb(sqlFor(admin)); await root.initSchema();
  env = { VERCEL_ENV: 'production', GITHUB_PRIVATE_TENANT_PILOT: 'enabled', GITHUB_PUBLIC_CONNECT: 'enabled',
    GITHUB_PILOT_APP_ID: String(APP), PUBLIC_BASE_URL: ORIGIN, DATABASE_URL: url,
    GITHUB_PILOT_APP_CLIENT_ID: 'fixture-app-client', GITHUB_PILOT_APP_CLIENT_SECRET: 'fixture-app-secret',
    TOKEN_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64url'),
    GITHUB_TENANT_ROUTING_KEY: crypto.randomBytes(32).toString('base64url') };
  const secret = (text, kind) => encryptSecret(text, { aad: `github-mcp/app/${APP}/${kind}`, key: Buffer.from(env.TOKEN_ENCRYPTION_KEY, 'base64url') });
  await root.saveApp({ id: APP, slug: 'public-connect-app', ownerLogin: 'service-owner', ownerType: 'Organization', clientId: 'fixture-app-client',
    clientSecretEnc: secret('fixture-client-secret', 'client_secret'), privateKeyEnc: secret('fixture-private-key', 'private_key'),
    webhookSecretEnc: secret('fixture-webhook-secret', 'webhook_secret'), permissions: { contents: 'read' } });
});
afterAll(async () => {
  if (admin) {
    const ids = await admin.query('SELECT tenant_id FROM gh_tenant_pilot_bootstraps').then((r) => r.rows).catch(() => []);
    for (const r of ids) await admin.query('DROP SCHEMA IF EXISTS "' + tenantSchemaName(r.tenant_id) + '" CASCADE').catch(() => {});
    await admin.query('DROP SCHEMA IF EXISTS "' + admin.ns + '" CASCADE').catch(() => {});
  }
  for (const c of clients.reverse()) await c.end().catch(() => {});
});

const tenantOf = async (selector) => {
  const { openAuthorizedTenantDb } = await import('../../src/tenancy/directory.js');
  return createDb((await openAuthorizedTenantDb({ directory, tenantId: selector.tenantId, verifiedIdentityId: selector.identityId, connectionString: env.DATABASE_URL, sqlFactory: tenantSqlFactory })).sql);
};
const gateFor = (token) => resolvePrivateTenantMcpBearer({ authorization: 'Bearer ' + token.access_token, env, fetchImpl, rootSqlFactory, tenantSqlFactory });
const tokenFor = async (c, client, who, opts) => json(await exchange(client, codeOf(await approved(c, client, who, opts))));

describe('PUB-6 public simple connect in REAL PostgreSQL', () => {
  it('is completely off unless the flag, production and the private machinery are all on', async () => {
    for (const over of [{ GITHUB_PUBLIC_CONNECT: undefined }, { VERCEL_ENV: 'preview' }, { GITHUB_PRIVATE_TENANT_PILOT: 'disabled' }]) {
      await expect(make(over).registerClient({ redirect_uris: [CB] })).rejects.toThrow(/could not verify/);
    }
    const res = await call((req, r) => publicRegister(req, r, { env: { ...env, GITHUB_PUBLIC_CONNECT: undefined } }), request('POST', { redirect_uris: [CB] }));
    expect(res.statusCode).toBe(404);
  });

  it('registers public clients (hash only), validating and capping them', async () => {
    const c = make();
    const client = await c.registerClient({ redirect_uris: [CB], client_name: 'ChatGPT' });
    expect(client.client_id).toMatch(/^pcl_/);
    const row = await directory.getPublicClient(client.client_id);
    expect(row.secretHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(row)).not.toContain(client.client_secret);
    await expect(c.registerClient({ redirect_uris: ['http://evil.example.test/cb'] })).rejects.toBeInstanceOf(PublicConnectError);
    await expect(c.registerClient({ redirect_uris: [] })).rejects.toBeInstanceOf(PublicConnectError);
    const total = (await admin.query('SELECT count(*)::int n FROM gh_public_clients')).rows[0].n;
    await expect(make({ GITHUB_PUBLIC_MAX_CLIENTS: String(total) }).registerClient({ redirect_uris: [CB] })).rejects.toMatchObject({ code: 'capacity' });
  });

  it('one sign-in connects their own account AND a client organization, but only after Approve', async () => {
    const c = make();
    const client = await c.registerClient({ redirect_uris: [CB], client_name: 'ChatGPT' });
    const { started, finished } = await signIn(c, client, 'alice');
    const result = await finished;
    // Nothing reaches the app yet: the person sees who is signed in and which site gets access.
    expect(result.redirect).toBeUndefined();
    expect(result.approve).toMatchObject({ signedInAs: 'alice-dev', appName: 'ChatGPT', appHost: 'chat.example.test' });
    expect(result.approve.accounts.map((a) => a.login)).toEqual(['alice-dev', 'client-co']);
    // the same single-use GitHub state can never be replayed
    await expect(c.finish({ state: started.state, code: 'alice-fixture-code-2' })).rejects.toThrow();
    const { redirect } = await c.approve({ handle: result.approve.handle, choice: 'approve' });
    // the Approve handle is one use
    await expect(c.approve({ handle: result.approve.handle, choice: 'approve' })).rejects.toThrow();
    const target = new URL(redirect);
    expect(target.origin + target.pathname).toBe(CB);
    expect(target.searchParams.get('state')).toBe('client-nonce');
    expect(target.searchParams.get('iss')).toBe(ORIGIN);
    const code = target.searchParams.get('code');
    const selector = parsePublicCode(code);
    expect(selector).not.toBeNull();
    const done = await exchange(client, code);
    expect(done.statusCode).toBe(200);
    const token = json(done);
    expect(token.access_token).toMatch(/^tac_/);
    const tenantDb = await tenantOf(selector);
    const grant = await tenantDb.getAccessToken(token.access_token);
    expect(grant.accounts).toEqual(['alice-dev', 'client-co']);
    expect(grant.default_account).toBe('alice-dev');
    expect(grant.mode).toBe('production');
    expect(grant.profile).toBe('full');
    // a code works exactly once, and a wrong secret is refused
    expect((await exchange(client, code)).statusCode).not.toBe(200);
    const bad = await call((req, res) => privateTenantToken(req, res, { env, rootSqlFactory, tenantSqlFactory }),
      request('POST', { grant_type: 'authorization_code', client_id: client.client_id, client_secret: 'wrong-secret-value', redirect_uri: CB, code, code_verifier: verifier, resource: ORIGIN + '/api/mcp' }));
    expect(bad.statusCode).toBe(401);
    // the access token reaches this person's own sealed GitHub authorization, for each account
    const routed = await gateFor(token);
    expect(await routed.credentials.token({ account: 'alice-dev', cred: 'U' })).toBe(people.alice.token);
    expect(await routed.credentials.token({ account: 'client-co', cred: 'U' })).toBe(people.alice.token);
    const refreshed = await call((req, res) => privateTenantToken(req, res, { env, rootSqlFactory, tenantSqlFactory }),
      request('POST', { grant_type: 'refresh_token', client_id: client.client_id, client_secret: client.client_secret, refresh_token: token.refresh_token, resource: ORIGIN + '/api/mcp' }));
    expect(refreshed.statusCode).toBe(200);
    // the other app's installation was never connected
    expect(await tenantDb.getAccount('other-app-org')).toBeNull();
  });

  it('Cancel sends the app access_denied and no code', async () => {
    const c = make();
    const client = await c.registerClient({ redirect_uris: [CB] });
    const result = await (await signIn(c, client, 'alice')).finished;
    const { redirect } = await c.approve({ handle: result.approve.handle, choice: 'cancel' });
    const url = new URL(redirect);
    expect(url.searchParams.get('error')).toBe('access_denied');
    expect(url.searchParams.get('code')).toBeNull();
    expect(url.searchParams.get('state')).toBe('client-nonce');
    await expect(c.approve({ handle: result.approve.handle, choice: 'approve' })).rejects.toThrow();
    await expect(c.approve({ handle: result.approve.handle, choice: 'something-else' })).rejects.toThrow();
  });

  it('gives each person their own isolated tenant and refuses a code carried to another person', async () => {
    const c = make();
    const client = await c.registerClient({ redirect_uris: [CB] });
    const a = await approved(c, client, 'alice'), b = await approved(c, client, 'bob');
    const sa = parsePublicCode(codeOf(a)), sb = parsePublicCode(codeOf(b));
    expect(sa.tenantId).not.toBe(sb.tenantId);
    expect(sa.identityId).not.toBe(sb.identityId);
    const forged = codeOf(a).replace(/^pc\.[0-9a-f]{32}\.[0-9a-f]{32}/, `pc.${sb.tenantId.replaceAll('-', '')}.${sb.identityId.replaceAll('-', '')}`);
    expect((await exchange(client, forged)).statusCode).not.toBe(200);
  });

  it('a person with no installation gets the install page, resumes after installing, and is told plainly if still missing', async () => {
    const c = make();
    const client = await c.registerClient({ redirect_uris: [CB] });
    const first = await (await signIn(c, client, 'carol')).finished;
    expect(first.install).toMatchObject({ signedInAs: 'carol-new', again: false });
    const installState = new URL(first.install.url).searchParams.get('state');
    expect(first.install.url).toMatch(/^https:\/\/github\.com\/apps\/public-connect-app\/installations\/new\?state=pc\./);
    const resumed = await c.resumeInstall({ state: installState });
    expect(resumed.url).toContain('https://github.com/login/oauth/authorize?');
    await expect(c.resumeInstall({ state: installState })).rejects.toThrow();
    const still = await c.finish({ state: resumed.state, code: 'carol-fixture-code-1' });
    expect(still.install).toMatchObject({ again: true });
    // now the App is "installed" for carol and a fresh connect reaches Approve
    people.carol.installs = [{ id: 41020, app_id: APP, account: { id: 31003, login: 'carol-new', type: 'User' }, repository_selection: 'selected', suspended_at: null }];
    expect(await approved(c, client, 'carol')).toContain(CB);
  });

  it('offers accounts without the App on the Approve page (to add later) and never loops into an install', async () => {
    const c = make();
    const client = await c.registerClient({ redirect_uris: [CB] });
    // dave administers an installed organization; his own personal account has no App yet.
    const first = await (await signIn(c, client, 'dave')).finished;
    expect(first.approve.accounts.map((a) => a.login)).toEqual(['client-co']);
    expect(first.approve.others).toEqual(['dave-solo']);
    expect(first.approve.manageUrl).toBe(ORIGIN + '/connection');
    const { redirect } = await c.approve({ handle: first.approve.handle, choice: 'approve' });
    expect(codeOf(redirect)).toBeTruthy();
  });

  it('PUB-5 C: a code used with the wrong PKCE verifier is refused and the code is burned; a replay of a good exchange is refused', async () => {
    const c = make();
    const client = await c.registerClient({ redirect_uris: [CB] });
    const wrong = await approved(c, client, 'alice');
    const logged = []; const realError = console.error; console.error = (...a) => { logged.push(a.join(' ')); };
    let bad;
    try { bad = await call((req, res) => privateTenantToken(req, res, { env, rootSqlFactory, tenantSqlFactory }),
      request('POST', { grant_type: 'authorization_code', client_id: client.client_id, client_secret: client.client_secret,
        redirect_uri: CB, code: codeOf(wrong), code_verifier: 'z'.repeat(43), resource: ORIGIN + '/api/mcp' })); } finally { console.error = realError; }
    expect(bad.statusCode).toBe(400);
    // the server log for that request carries no code, verifier or secret
    for (const line of logged) for (const secret of [codeOf(wrong), 'z'.repeat(43), client.client_secret]) expect(line).not.toContain(secret);
    expect((await exchange(client, codeOf(wrong))).statusCode).toBe(400);
    const good = await approved(c, client, 'bob');
    expect((await exchange(client, codeOf(good))).statusCode).toBe(200);
    expect((await exchange(client, codeOf(good))).statusCode).toBe(400);
  });

  it('PUB-5 C: a person who hammers the token endpoint is told to wait (429 with Retry-After) and nobody else is affected', async () => {
    const c = make();
    const client = await c.registerClient({ redirect_uris: [CB] });
    const hammer = codeOf(await approved(c, client, 'alice'));
    const other = codeOf(await approved(c, client, 'bob'));
    // A real hammer issues requests concurrently. Serial PostgreSQL
    // round trips under a loaded CI host can span the limiter's full
    // time window and cease to be 40 *rapid* calls. This also checks
    // that the shared database limiter is atomic under parallel load.
    const answers = await Promise.all(Array.from({length:40},
      () => exchange(client, hammer)));
    const limited = answers.find((a) => a.statusCode === 429);
    expect(limited, 'a 429 within 40 rapid calls').toBeTruthy();
    expect(Number(limited.headers['Retry-After'])).toBeGreaterThan(0);
    expect(json(limited).error).toBe('rate_limited');
    expect((await exchange(client, other)).statusCode).toBe(200);
  });

  it('refuses unknown or revoked clients and bad requests before any GitHub request', async () => {
    const c = make();
    const client = await c.registerClient({ redirect_uris: [CB] });
    await expect(c.begin(authorizeParams(client, { redirect_uri: 'https://elsewhere.example.test/cb' }))).rejects.toThrow();
    await expect(c.begin(authorizeParams(client, { resource: 'https://elsewhere.example.test/api/mcp' }))).rejects.toThrow();
    await expect(c.begin(authorizeParams(client, { scope: 'admin everything' }))).rejects.toThrow();
    // PUB-5 C: no PKCE downgrade on the public sign-in
    await expect(c.begin(authorizeParams(client, { code_challenge_method: 'plain' }))).rejects.toThrow();
    await expect(c.begin(authorizeParams(client, { code_challenge: undefined }))).rejects.toThrow();
    await expect(c.begin(authorizeParams(client, { scope: 'github.notifications.read' }))).resolves.toBeTruthy();
    await expect(c.begin(authorizeParams({ client_id: MANAGE_CLIENT }))).rejects.toThrow();
    await expect(c.finish({ state: 'pc.' + 'a'.repeat(40), code: 'alice-fixture-code-1' })).rejects.toThrow();
    const a = await approved(c, client, 'alice');
    expect(await directory.deletePublicClient(client.client_id)).toBe(true);
    expect((await exchange(client, codeOf(a))).statusCode).toBe(401);
  });

  it('PUB-5 B: no cap on the number of people; the open-sign-in cap still holds', async () => {
    const existing = (await admin.query('SELECT count(*)::int n FROM gh_tenant_pilot_bootstraps')).rows[0].n;
    // the old setting is ignored: a brand-new person still gets in even when it equals the number of people
    const c = make({ GITHUB_PUBLIC_MAX_TENANTS: String(existing) });
    const client = await c.registerClient({ redirect_uris: [CB] });
    people.zed = { token: 'tok-zed-00004', id: 31004, login: 'zed-new', installs: [{ id: 41030, app_id: APP, account: { id: 31004, login: 'zed-new', type: 'User' }, repository_selection: 'all', suspended_at: null }] };
    expect(await approved(c, client, 'zed')).toContain(CB);
    expect(await approved(c, client, 'alice')).toContain(CB);
    const open = (await admin.query('SELECT count(*)::int n FROM gh_public_flows WHERE expires_at > now()')).rows[0].n;
    await expect(make({ GITHUB_PUBLIC_MAX_OPEN_FLOWS: String(open) }).begin(authorizeParams(client))).rejects.toMatchObject({ code: 'capacity' });
  });

  it('PUB-5 B: new sign-ups pause by hand or when the estimated cost is reached; people already in are never affected', async () => {
    people.pauser = { token: 'tok-pauser-07', id: 31907, login: 'pauser-one', installs: [{ id: 41960, app_id: APP, account: { id: 31907, login: 'pauser-one', type: 'User' }, repository_selection: 'all', suspended_at: null }] };
    const c = make({ GITHUB_PUBLIC_NEW_SIGNUPS: 'paused' });
    const client = await c.registerClient({ redirect_uris: [CB] });
    await expect((await signIn(c, client, 'pauser')).finished).rejects.toMatchObject({ code: 'paused' });
    expect(await approved(c, client, 'alice')).toContain(CB); // already connected: still fine
    // by cost: put one heavy day of calls in, with a tiny pause level
    const [{ tenant_id }] = (await admin.query('SELECT tenant_id FROM gh_tenant_pilot_bootstraps LIMIT 1')).rows;
    await admin.query('INSERT INTO gh_public_usage_daily(day, tenant_id, calls) VALUES ((now() AT TIME ZONE \'UTC\')::date, $1, 700000) ON CONFLICT (day, tenant_id) DO UPDATE SET calls = 700000', [tenant_id]);
    await admin.query("DELETE FROM server_settings WHERE setting = 'public_cost_estimate_cache'");
    const cost = make({ PUBLIC_COST_PAUSE_CENTS: '100' });
    await expect((await signIn(cost, client, 'pauser')).finished).rejects.toMatchObject({ code: 'paused' });
    expect(await approved(cost, client, 'alice')).toContain(CB);
    // pause level 0 = off
    await admin.query("DELETE FROM server_settings WHERE setting = 'public_cost_estimate_cache'");
    expect(await approved(make({ PUBLIC_COST_PAUSE_CENTS: '0' }), client, 'pauser')).toContain(CB);
    await admin.query('DELETE FROM gh_public_usage_daily WHERE calls = 700000');
  });

  it('PUB-5 B: stale never-used registrations are removed, recent ones and the fixed ones stay', async () => {
    const c = make();
    const old = await c.registerClient({ redirect_uris: [CB] });
    const fresh = await c.registerClient({ redirect_uris: [CB] });
    await admin.query("UPDATE gh_public_clients SET created_at = now() - interval '40 days' WHERE client_id = $1", [old.client_id]);
    await c.registerClient({ redirect_uris: [CB] }); // registering sweeps
    const left = (await admin.query('SELECT client_id FROM gh_public_clients WHERE client_id = ANY($1)', [[old.client_id, fresh.client_id, FORGET_CLIENT, MANAGE_CLIENT]])).rows.map((r) => r.client_id);
    expect(left).not.toContain(old.client_id);
    expect(left).toContain(fresh.client_id);
  });

  it('web pages: straight to GitHub, no cookies, plain English, never echo untrusted input', async () => {
    const client = await make().registerClient({ redirect_uris: [CB], client_name: '<script>alert(1)</script>' });
    const go = await call((req, res) => publicAuthorize(req, res, { env, connect: make() }), request('GET', authorizeParams(client)));
    expect(go.statusCode).toBe(302);
    expect(go.headers.Location).toMatch(/^https:\/\/github\.com\/login\/oauth\/authorize\?/);
    expect(go.headers['Set-Cookie']).toBeUndefined();
    const state = new URL(go.headers.Location).searchParams.get('state');
    const page = await call((req, res) => publicCallback(req, res, { env, connect: make() }), request('GET', { state, code: 'alice-fixture-code-1' }));
    expect(page.statusCode).toBe(200);
    expect(page.headers['Set-Cookie']).toBeUndefined();
    expect(page.body).toContain('Approve the connection');
    expect(page.body).toContain('alice-dev');
    expect(page.body).toContain('chat.example.test');
    expect(page.body).toContain('Read-only');
    expect(page.body).not.toContain('<script>alert');
    expect(page.headers['Content-Security-Policy']).toContain("default-src 'none'");
    expect(page.headers['Content-Security-Policy']).toContain("frame-ancestors 'none'");
    const handle = /name="handle" value="([^"]+)"/.exec(page.body)[1];
    // a post naming another site is refused, even with the real handle
    const foreign = await call((req, res) => publicApprove(req, res, { env, connect: make() }),
      request('POST', { step: 'approve', handle, choice: 'approve' }, { origin: 'https://evil.example.test' }));
    expect(foreign.statusCode).toBe(403);
    // our own page's post (some in-app browsers send no Origin at all) is answered with the hand-back page
    const ok = await call((req, res) => publicApprove(req, res, { env, connect: make() }), request('POST', { step: 'approve', handle, choice: 'approve' }));
    expect(ok.statusCode).toBe(200);
    expect(ok.headers.Location).toBeUndefined();
    const target = /http-equiv="refresh" content="0;url=([^"]+)"/.exec(ok.body)?.[1]?.replaceAll('&amp;', '&');
    expect(target).toContain(CB);
    expect(new URL(target).searchParams.get('code')).toBeTruthy();
    expect(ok.headers['Referrer-Policy']).toBe('no-referrer');
    // the same page posted again: a plain "expired" page, no detail
    const again = await call((req, res) => publicApprove(req, res, { env, connect: make() }), request('POST', { step: 'approve', handle, choice: 'approve' }));
    expect(again.statusCode).toBe(403);
    expect(again.body).toContain('This step has expired');
    expect(again.body).not.toMatch(/stack|sql|token/i);
    // an old consent form posted after this change gets a plain explanation
    const old = await call((req, res) => publicAuthorize(req, res, { env, connect: make() }), request('POST', { ...authorizeParams(client), form_csrf: 'x'.repeat(43) }));
    expect(old.statusCode).toBe(410);
    const off = await call((req, res) => publicAuthorize(req, res, { env: { ...env, GITHUB_PUBLIC_CONNECT: undefined } }), request('GET', authorizeParams(client)));
    expect(off.statusCode).toBe(404);
  });

  it('the MCP gate refuses a public connection once its client is deleted or the person is revoked', async () => {
    const c = make();
    const client = await c.registerClient({ redirect_uris: [CB] });
    const r = await approved(c, client, 'bob');
    const token = json(await exchange(client, codeOf(r)));
    expect(await gateFor(token)).not.toBeNull();
    expect(await resolvePrivateTenantMcpBearer({ authorization: 'Bearer tac_' + 'A'.repeat(86) + '_' + 'B'.repeat(43), env, fetchImpl, rootSqlFactory, tenantSqlFactory })).toBeNull();
    const sel = parsePublicCode(codeOf(r));
    expect(await directory.revokePilotIdentity(sel.tenantId, sel.identityId, sel.identityId)).toBe(true);
    expect(await gateFor(token)).toBeNull();
    const refresh = await call((req, res) => privateTenantToken(req, res, { env, rootSqlFactory, tenantSqlFactory }),
      request('POST', { grant_type: 'refresh_token', client_id: client.client_id, client_secret: client.client_secret, refresh_token: token.refresh_token, resource: ORIGIN + '/api/mcp' }));
    expect(refresh.statusCode).toBe(401);
    const other = await c.registerClient({ redirect_uris: [CB] });
    const t2 = await tokenFor(c, other, 'alice');
    expect(await directory.deletePublicClient(other.client_id)).toBe(true);
    expect(await gateFor(t2)).toBeNull();
  });
});

describe('PUB-6 branding', () => {
  it('shows the Robinson look and icon on the pages and lists the icon on the MCP server', async () => {
    const { serverInfo, BRAND_CSS, iconBytes } = await import('../../src/brand/brand.js');
    const page = await call((req, res) => publicManage(req, res, { env, connect: make() }), request('GET', { manage: '1' }));
    expect(page.body).toContain('Robinson MCP for GitHub');
    expect(page.body).toContain('/brand/icon-256.png');
    expect(page.body).toContain('#00B67A');
    expect(page.headers['Content-Security-Policy']).toContain("img-src 'self'");
    expect(BRAND_CSS).toContain('#0C0C0C');
    const info = serverInfo(ORIGIN);
    expect(info.title).toBe('Robinson MCP for GitHub');
    expect(info.icons[0].src).toBe(ORIGIN + '/brand/icon-256.png');
    expect(serverInfo(null).icons).toBeUndefined();
    expect(iconBytes(256).subarray(0, 4).toString('hex')).toBe('89504e47');
  });
});

describe('PUB-6 who may connect which account', () => {
  it('lets a person connect only their own account or an organization they administer', async () => {
    const c = make();
    const client = await c.registerClient({ redirect_uris: [CB] });
    // Erin can SEE the client organization's installation but is only a member: nothing is connected, no tenant data written.
    const first = await (await signIn(c, client, 'erin')).finished;
    expect(first.install).toBeDefined();
    const erinTenant = await admin.query("SELECT count(*)::int n FROM gh_tenant_identities WHERE provider_subject='31005'");
    expect(erinTenant.rows[0].n).toBe(0);
    // A personal installation whose account id is not the signed-in person is refused too.
    const spoof = { ...people.erin.installs[0], account: { id: 99999, login: 'someone-else', type: 'User' } };
    const saved = people.erin.installs;
    people.erin.installs = [spoof];
    expect((await (await signIn(c, client, 'erin')).finished).install).toBeDefined();
    people.erin.installs = saved;
  });
});

describe('PUB-6 letting the assistant make changes', () => {
  it('default: changes are on for the accounts the person owns, still gated; Read-only ticked: preview only', async () => {
    const c = make();
    const client = await c.registerClient({ redirect_uris: [CB] });
    const tokenOn = await tokenFor(c, client, 'alice');
    const routedOn = await gateFor(tokenOn);
    const grantOn = await routedOn.db.getAccessToken(tokenOn.access_token);
    expect(grantOn.mode).toBe('production');
    for (const login of grantOn.accounts) expect((await routedOn.db.getAccount(login)).production_enabled).toBe(true);
    const tokenOff = await tokenFor(c, client, 'alice', { readOnly: true });
    // Read-only is the read_only profile (every change tool refused), not only preview mode (review finding on #337)
    expect((await (await gateFor(tokenOff)).db.getAccessToken(tokenOff.access_token))).toMatchObject({ mode: 'preview', profile: 'read_only' });
  });
});

describe('My connection', () => {
  const manageSignIn = async (c, who) => {
    const started = await c.startManage();
    expect(new URL(started.url).origin + new URL(started.url).pathname).toBe('https://github.com/login/oauth/authorize');
    return c.finish({ state: started.state, code: who + '-fixture-code-1' });
  };

  it('someone who never connected is told so and is not enrolled', async () => {
    const c = make();
    people.newbie = { token: 'tok-newbie-07', id: 31007, login: 'newbie', installs: [] };
    const before = (await admin.query('SELECT count(*)::int AS n FROM gh_tenant_identities')).rows[0].n;
    expect(await manageSignIn(c, 'newbie')).toEqual({ manage: { none: true, signedInAs: 'newbie' } });
    expect((await admin.query('SELECT count(*)::int AS n FROM gh_tenant_identities')).rows[0].n).toBe(before);
  });

  it('adds a newly installed account to an app that is already connected, without reconnecting', async () => {
    const c = make();
    const client = await c.registerClient({ redirect_uris: [CB], client_name: 'Claude' });
    const token = await tokenFor(c, client, 'dave');
    expect((await (await gateFor(token)).db.getAccessToken(token.access_token)).accounts).toEqual(['client-co']);
    const page = await manageSignIn(c, 'dave');
    expect(page.manage.offers).toEqual([{ login: 'dave-solo', id: 31006, type: 'User' }]);
    expect(page.manage.connections.map((x) => x.name)).toEqual(['Claude']);
    // "Add dave-solo" sends the person to GitHub's install page aimed at that account
    const added = await c.manageAction({ handle: page.manage.handle, action: 'add', value: 'dave-solo' });
    const addUrl = new URL(added.go);
    expect(addUrl.href).toMatch(/^https:\/\/github\.com\/apps\/public-connect-app\/installations\/new\?state=pc\./);
    expect(addUrl.searchParams.get('suggested_target_id')).toBe('31006');
    // the page handle was used up
    await expect(c.manageAction({ handle: page.manage.handle, action: 'refresh' })).rejects.toThrow();
    // back from installing, the person signs in once more (silently) and lands on My connection with both accounts
    people.dave.installs.push({ id: 41051, app_id: APP, account: { id: 31006, login: 'dave-solo', type: 'User' }, repository_selection: 'all', suspended_at: null });
    const resumed = await c.resumeInstall({ state: addUrl.searchParams.get('state') });
    const back = await c.finish({ state: resumed.state, code: 'dave-fixture-code-1' });
    expect(back.manage.accounts.map((a) => a.login).sort()).toEqual(['client-co', 'dave-solo']);
    expect(back.manage.offers).toEqual([]);
    // each installed place links to GitHub's own page for that installation (change repositories / uninstall); nothing here uninstalls
    const byLogin = Object.fromEntries(back.manage.accounts.map((a) => [a.login, a.githubUrl]));
    expect(byLogin['dave-solo']).toBe('https://github.com/settings/installations/41051');
    expect(byLogin['client-co']).toMatch(/^https:\/\/github\.com\/organizations\/client-co\/settings\/installations\/\d+$/);
    expect((await (await gateFor(token)).db.getAccessToken(token.access_token)).accounts).toEqual(['client-co', 'dave-solo']);
    people.dave.installs.pop();
  });

  it('read-only switch, time zone and disconnect act on this person only; bad values are refused', async () => {
    const c = make();
    const client = await c.registerClient({ redirect_uris: [CB], client_name: 'ChatGPT' });
    const alice = await tokenFor(c, client, 'alice'), bob = await tokenFor(c, client, 'bob');
    let page = (await manageSignIn(c, 'alice')).manage;
    page = (await c.manageAction({ handle: page.handle, action: 'read_only' })).manage;
    expect(page.notice).toMatch(/can now look, but not change anything/);
    expect(await (await gateFor(alice)).db.getAccessToken(alice.access_token)).toMatchObject({ mode: 'preview', profile: 'read_only' });
    expect(await (await gateFor(bob)).db.getAccessToken(bob.access_token)).toMatchObject({ mode: 'production', profile: 'full' });
    // the switch still covers an app whose one-hour access lapsed but can renew it, and refresh keeps the choice
    const aliceDb = (await gateFor(alice)).db;
    const refreshed = await call((req, res) => privateTenantToken(req, res, { env, rootSqlFactory, tenantSqlFactory }),
      request('POST', { grant_type: 'refresh_token', client_id: client.client_id, client_secret: client.client_secret, refresh_token: alice.refresh_token, resource: ORIGIN + '/api/mcp' }));
    expect(refreshed.statusCode).toBe(200);
    const alice2 = json(refreshed);
    expect(await aliceDb.getAccessToken(alice2.access_token)).toMatchObject({ mode: 'preview', profile: 'read_only' });
    page = (await c.manageAction({ handle: page.handle, action: 'allow_changes' })).manage;
    expect(await (await gateFor(alice2)).db.getAccessToken(alice2.access_token)).toMatchObject({ mode: 'production', profile: 'full' });
    Object.assign(alice, alice2);
    await expect(c.manageAction({ handle: page.handle, action: 'time_zone', value: 'Mars/Base' })).rejects.toThrow();
    page = (await manageSignIn(c, 'alice')).manage;
    page = (await c.manageAction({ handle: page.handle, action: 'time_zone', value: 'America/Denver' })).manage;
    expect(page.timeZone).toBe('America/Denver');
    expect(await (await gateFor(alice)).db.getSetting('time_zone')).toBe('America/Denver');
    expect(await (await gateFor(bob)).db.getSetting('time_zone')).toBeNull();
    // an app whose one-hour access has lapsed (but can still renew) is still listed and can be disconnected (review finding on #337)
    const sel = parsePublicCode(codeOf(await approved(c, client, 'alice')));
    const tdb = await tenantOf(sel);
    await (await import('../../src/tenancy/directory.js')).openAuthorizedTenantDb({ directory, tenantId: sel.tenantId, verifiedIdentityId: sel.identityId, connectionString: env.DATABASE_URL, sqlFactory: tenantSqlFactory })
      .then(({ sql }) => sql`UPDATE oauth_tokens SET expires_at = now() - interval '1 minute' WHERE kind = 'connector'`);
    expect((await tdb.listConnections()).filter((x) => x.kind === 'connector')).toEqual([]);
    page = (await manageSignIn(c, 'alice')).manage;
    expect(page.connections.map((x) => x.name)).toContain('ChatGPT');
    // only this person's own apps can be disconnected; another value is refused
    await expect(c.manageAction({ handle: page.handle, action: 'disconnect', value: 'pcl_not_mine_at_all_000000000000' })).rejects.toThrow();
    page = (await manageSignIn(c, 'alice')).manage;
    const target = page.connections.find((x) => x.name === 'ChatGPT');
    page = (await c.manageAction({ handle: page.handle, action: 'disconnect', value: target.clientId })).manage;
    expect(page.notice).toMatch(/Disconnected/);
    expect(await gateFor(alice)).toBeNull();
    expect(await gateFor(bob)).not.toBeNull();
    // a handle from someone else's page, or a made-up action, is refused
    await expect(c.manageAction({ handle: page.handle, action: 'drop_tables' })).rejects.toThrow();
  });

  it('web page: a GitHub sign-in button, posts refused from another site, no cookies', async () => {
    const start = await call((req, res) => publicManage(req, res, { env, connect: make() }), request('GET', { manage: '1' }));
    expect(start.statusCode).toBe(200);
    expect(start.body).toContain('Sign in with GitHub');
    expect(start.headers['Set-Cookie']).toBeUndefined();
    const go = await call((req, res) => publicManage(req, res, { env, connect: make() }), request('GET', { manage: '1', go: '1' }));
    expect(go.statusCode).toBe(302);
    expect(go.headers.Location).toMatch(/^https:\/\/github\.com\/login\/oauth\/authorize\?/);
    const state = new URL(go.headers.Location).searchParams.get('state');
    const page = await call((req, res) => publicCallback(req, res, { env, connect: make() }), request('GET', { state, code: 'alice-fixture-code-1' }));
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('My connection');
    expect(page.body).toContain('Delete my data');
    const handle = /name="handle" value="([^"]+)"/.exec(page.body)[1];
    const foreign = await call((req, res) => publicManage(req, res, { env, connect: make() }),
      request('POST', { handle, action: 'read_only', value: '' }, { origin: 'https://evil.example.test' }));
    expect(foreign.statusCode).toBe(403);
    const master = await call((req, res) => publicManage(req, res, { env, connect: make() }), request('POST', { handle, action: 'master', value: '' }, { origin: ORIGIN }));
    expect(master.statusCode).toBe(303);
    expect(master.headers.Location).toMatch(new RegExp('^' + ORIGIN + '/api/tenant/optional\\?master_link='));
  });
});

describe('PUB-6 owner usage summary', () => {
  it('PUB-5 B: adds up each person\'s calls from the daily counts, shows the top 10, and never shows tokens', async () => {
    const people2 = await admin.query("SELECT tenant_id FROM gh_tenant_pilot_bootstraps WHERE account_login='public-connect' ORDER BY created_at LIMIT 2").then((r) => r.rows);
    expect(people2.length).toBe(2);
    const put = async (tenantId, daysAgo, calls, writes, errors) => admin.query(
      `INSERT INTO gh_public_usage_daily(day, tenant_id, calls, writes, errors) VALUES ((now() AT TIME ZONE 'UTC')::date - $2::int, $1, $3, $4, $5)
       ON CONFLICT (day, tenant_id) DO UPDATE SET calls = EXCLUDED.calls, writes = EXCLUDED.writes, errors = EXCLUDED.errors`, [tenantId, daysAgo, calls, writes, errors]);
    await put(people2[0].tenant_id, 0, 12, 2, 0);
    await put(people2[1].tenant_id, 0, 5, 0, 1);
    await put(people2[1].tenant_id, 3, 4, 1, 4);
    await put(people2[1].tenant_id, 20, 99, 0, 0);
    const { publicUsageSummary } = await import('../../src/tenancy/usage-summary.js');
    const out = await publicUsageSummary(rootSqlFactory(), { connectionString: process.env.TEST_DATABASE_URL, sqlFactory: tenantSqlFactory, env });
    expect(out.peopleConnected).toBeGreaterThanOrEqual(2);
    expect(out.activeToday).toBeGreaterThanOrEqual(2);
    expect(out.lastDay.calls).toBeGreaterThanOrEqual(17);
    expect(out.lastDay.writes).toBeGreaterThanOrEqual(2);
    expect(out.lastWeek.calls).toBeGreaterThanOrEqual(out.lastDay.calls + 4);
    expect(out.lastWeek.calls).toBeLessThan(out.lastDay.calls + 4 + 99);
    expect(out.lastWeek.errors).toBeGreaterThanOrEqual(5);
    expect(out.top.length).toBeGreaterThanOrEqual(2);
    expect(out.top.length).toBeLessThanOrEqual(10);
    expect(out.top[0].calls).toBeGreaterThanOrEqual(out.top[1].calls);
    expect(JSON.stringify(out)).not.toMatch(/tok-|secret|@/);
    await admin.query('DELETE FROM gh_public_usage_daily');
  });
});

describe('PUB-5 B hourly change allowance', () => {
  it('parallel changes cannot pass the limit, and a handed-back slot can be used again', async () => {
    const { createPublicUsage } = await import('../../src/tenancy/public-usage.js');
    const { publicUsageLimits } = await import('../../src/tenancy/public-usage.js');
    const limits = publicUsageLimits({ PUBLIC_FREE_WRITES_PER_HOUR: '10' });
    const [{ tenant_id }] = (await admin.query('SELECT tenant_id FROM gh_tenant_pilot_bootstraps LIMIT 1')).rows;
    const clientsN = await Promise.all([1, 2, 3, 4, 5].map(async () => connect(process.env.TEST_DATABASE_URL)));
    for (const c of clientsN) await c.query('SET search_path TO "' + admin.ns + '"');
    const usages = clientsN.map((c) => createPublicUsage(sqlFor(c), limits));
    const results = await Promise.all(Array.from({ length: 40 }, (_, i) => usages[i % 5].reserveWrite(tenant_id)));
    expect(results.filter((r) => r === null).length).toBe(10);
    const refused = results.find((r) => r);
    expect(refused.message).toContain('10');
    expect(refused.retryAfterSeconds).toBeGreaterThan(0);
    await usages[0].releaseWrite(tenant_id);
    expect(await usages[1].reserveWrite(tenant_id)).toBeNull();
    expect(await usages[2].reserveWrite(tenant_id)).not.toBeNull();
    expect(await usages[3].reserveWrite(tenant_id, { exempt: true })).toBeNull(); // exempt people are never refused
    await admin.query('DELETE FROM gh_public_usage_hourly');
  });
});

describe('PUB-5 B inactive people', () => {
  it('signs out people unused for the set number of days; keeps recent, just-signed-in and unlimited people', async () => {
    const { removeInactivePeople } = await import('../../src/tenancy/public-inactive.js');
    const { publicUsageLimits } = await import('../../src/tenancy/public-usage.js');
    const rows = (await admin.query(`SELECT b.tenant_id, i.provider_subject FROM gh_tenant_pilot_bootstraps b JOIN gh_tenant_identities i ON i.id=b.identity_id
      WHERE b.account_login='public-connect' AND EXISTS (SELECT 1 FROM gh_tenant_user_authorizations a WHERE a.tenant_id=b.tenant_id) ORDER BY b.created_at LIMIT 4`)).rows;
    expect(rows.length).toBe(4);
    const [stale, used, unlimited, mine] = rows;
    const grants = async (t) => Number((await admin.query('SELECT count(*) n FROM gh_tenant_user_authorizations WHERE tenant_id=$1', [t.tenant_id])).rows[0].n);
    await admin.query("UPDATE gh_tenant_user_authorizations SET updated_at = now() - interval '300 days' WHERE tenant_id = ANY($1::uuid[])", [rows.map((r) => r.tenant_id)]);
    await admin.query("INSERT INTO gh_public_usage_daily(day, tenant_id, calls) VALUES ((now() AT TIME ZONE 'UTC')::date - 2, $1, 3) ON CONFLICT DO NOTHING", [used.tenant_id]);
    const limits = publicUsageLimits({ PUBLIC_UNLIMITED_SUBJECTS: String(unlimited.provider_subject) });
    const out = await removeInactivePeople({ rootSql: rootSqlFactory(), connectionString: process.env.TEST_DATABASE_URL, sqlFactory: tenantSqlFactory, limits, exceptTenantId: mine.tenant_id });
    expect(out).toBeGreaterThanOrEqual(1);
    expect(await grants(stale)).toBe(0);
    expect(await grants(used)).toBeGreaterThan(0);
    expect(await grants(unlimited)).toBeGreaterThan(0);
    expect(await grants(mine)).toBeGreaterThan(0);
    await admin.query('DELETE FROM gh_public_usage_daily');
  });
});

describe('PUB-6 owner deletes one public person\'s data', () => {
  it('removes that person completely, keeps everyone else, and refuses organization names', async () => {
    const { forgetPublicPerson, findPublicTenantsByLogin } = await import('../../src/tenancy/forget-person.js');
    const c = make();
    const client = await c.registerClient({ redirect_uris: [CB] });
    const alice = await tokenFor(c, client, 'alice'), bob = await tokenFor(c, client, 'bob');
    expect(await gateFor(alice)).not.toBeNull(); expect(await gateFor(bob)).not.toBeNull();
    const opts = { connectionString: process.env.TEST_DATABASE_URL, sqlFactory: tenantSqlFactory };
    const aliceTenant = await admin.query("SELECT tenant_id FROM gh_tenant_pilot_bootstraps b JOIN gh_tenant_identities i ON i.id=b.identity_id WHERE b.account_login='public-connect' AND i.provider_subject=$1", ['31001']).then((r) => r.rows[0].tenant_id);
    const schemaExists = async (id) => (await admin.query('SELECT 1 FROM information_schema.schemata WHERE schema_name=$1', [tenantSchemaName(String(id))])).rowCount === 1;
    expect(await schemaExists(aliceTenant)).toBe(true);
    expect(await findPublicTenantsByLogin(rootSqlFactory(), 'client-co', opts)).toEqual([]);
    expect(await forgetPublicPerson(directory, rootSqlFactory(), 'nobody-here', opts)).toBe(0);
    await expect(forgetPublicPerson(directory, rootSqlFactory(), 'bad name!', opts)).rejects.toThrow();
    expect(await forgetPublicPerson(directory, rootSqlFactory(), 'alice-dev', opts)).toBe(1);
    expect(await schemaExists(aliceTenant)).toBe(false);
    for (const table of ['gh_tenants', 'gh_tenant_memberships', 'gh_tenant_pilot_bootstraps', 'gh_tenant_pilot_allowlist']) {
      const col = table === 'gh_tenants' ? 'id' : 'tenant_id';
      expect((await admin.query(`SELECT 1 FROM ${table} WHERE ${col}=$1`, [aliceTenant])).rowCount).toBe(0);
    }
    expect((await admin.query("SELECT 1 FROM gh_tenant_identities WHERE provider_subject='31001'")).rowCount).toBe(0);
    // PUB-5 C: no table that carries a tenant_id (or identity_id) still holds anything for this person; a table added later is caught too
    const carriers = (await admin.query("SELECT table_name, column_name FROM information_schema.columns WHERE table_schema=current_schema() AND column_name='tenant_id' AND table_name LIKE 'gh\\_%'")).rows;
    expect(carriers.length).toBeGreaterThan(3);
    for (const { table_name: table, column_name: col } of carriers) {
      expect((await admin.query(`SELECT 1 FROM ${table} WHERE ${col}=$1`, [aliceTenant])).rowCount, table + ' still holds the forgotten person').toBe(0);
    }
    expect(await gateFor(alice)).toBeNull();
    expect(await gateFor(bob)).not.toBeNull();
    expect(await directory.forgetPublicTenant(aliceTenant)).toBe(false);
    const priv = await admin.query("SELECT tenant_id FROM gh_tenant_pilot_bootstraps WHERE account_login<>'public-connect' LIMIT 1").then((r) => r.rows[0]);
    if (priv) await expect(directory.forgetPublicTenant(String(priv.tenant_id))).rejects.toThrow();
    expect(await gateFor(await tokenFor(c, client, 'alice'))).not.toBeNull();
  });
});

describe('PUB-6 a person deletes their own data', () => {
  it('needs a GitHub sign-in, one use of the confirm step, and removes only that person', async () => {
    const c = make();
    const client = await c.registerClient({ redirect_uris: [CB] });
    const alice = await tokenFor(c, client, 'alice'), bob = await tokenFor(c, client, 'bob');
    expect(await gateFor(alice)).not.toBeNull();
    const signInToForget = async (who) => {
      const started = await c.startForget();
      expect(new URL(started.url).origin + new URL(started.url).pathname).toBe('https://github.com/login/oauth/authorize');
      return c.finish({ state: started.state, code: who + '-fixture-code-1' });
    };
    const before = (await admin.query('SELECT count(*)::int AS n FROM gh_tenant_identities')).rows[0].n;
    expect(await signInToForget('erin')).toEqual({ forget: { none: true } });
    expect((await admin.query('SELECT count(*)::int AS n FROM gh_tenant_identities')).rows[0].n).toBe(before);
    await expect(c.begin(authorizeParams({ client_id: FORGET_CLIENT }))).rejects.toThrow();
    const asked = await signInToForget('alice');
    expect(asked.forget).toMatchObject({ signedInAs: 'alice-dev' });
    // a confirm handle is not an Approve or My connection handle, and using it wrongly spends it
    await expect(c.approve({ handle: asked.forget.handle, choice: 'approve' })).rejects.toThrow();
    await expect(c.forgetConfirm({ handle: asked.forget.handle })).rejects.toThrow();
    const again = await signInToForget('alice');
    expect(await c.forgetConfirm({ handle: again.forget.handle })).toBe(true);
    await expect(c.forgetConfirm({ handle: again.forget.handle })).rejects.toThrow();
    expect(await gateFor(alice)).toBeNull();
    expect(await gateFor(bob)).not.toBeNull();
    expect(await signInToForget('alice')).toEqual({ forget: { none: true } });
  });
  it('shows plain-English pages, needs no cookie, and refuses a post from another site', async () => {
    const connect = make();
    const page = await call((req, res) => publicForget(req, res, { env, connect }), request('GET', { forget: '1' }));
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('Delete my data');
    expect(page.headers['Set-Cookie']).toBeUndefined();
    const start = await call((req, res) => publicForget(req, res, { env, connect }), request('POST', { forget: '1', action: 'start' }, { origin: ORIGIN }));
    expect(start.statusCode).toBe(303);
    expect(start.headers.Location).toMatch(/^https:\/\/github\.com\/login\/oauth\/authorize\?/);
    const foreign = await call((req, res) => publicForget(req, res, { env, connect }), request('POST', { forget: '1', action: 'start' }, { origin: 'https://evil.example.test' }));
    expect(foreign.statusCode).toBe(403);
    const off = await call((req, res) => publicForget(req, res, { env: { ...env, GITHUB_PUBLIC_CONNECT: undefined }, connect }), request('GET', { forget: '1' }));
    expect(off.statusCode).toBe(404);
  });
});

describe('GOD-1 the master token (one classic token, kind M)', () => {
  const scopesHeader = (value) => ({ get: (name) => (String(name).toLowerCase() === 'x-oauth-scopes' ? value : null) });
  const fetchMaster = (scopes) => async (url, opts) => {
    const out = await fetchImpl(url, opts);
    if (url === 'https://api.github.com/user' && scopes !== undefined) return { ...out, headers: scopesHeader(scopes) };
    return out;
  };
  const enrollmentWith = async (fetchFn) => {
    const { createPrivateOptionalEnrollment } = await import('../../src/tenancy/optional-setup.js');
    const { openAuthorizedTenantDb } = await import('../../src/tenancy/directory.js');
    return createPrivateOptionalEnrollment({ env, fetchImpl: fetchFn, directoryFactory: () => createTenantDirectory(rootSqlFactory()),
      tenantAccess: (dir, claim) => openAuthorizedTenantDb({ directory: dir, tenantId: claim.tenantId, verifiedIdentityId: claim.identityId, connectionString: env.DATABASE_URL, sqlFactory: tenantSqlFactory }) });
  };
  /** The master-token form as My connection opens it (the link it 303s to). */
  const masterFormFromMyConnection = async (c, who, enrollment) => {
    const started = await c.startManage();
    const page = await c.finish({ state: started.state, code: who + '-fixture-code-1' });
    const { go } = await c.manageAction({ handle: page.manage.handle, action: 'master' });
    return enrollment.startMasterLink(new URL(go).searchParams.get('master_link'));
  };

  it('is added from My connection, must be the same person and a classic token, and then K/P and any API call can use it', async () => {
    const c = make();
    const client = await c.registerClient({ redirect_uris: [CB] });
    const token = await tokenFor(c, client, 'alice');
    const enrollment = await enrollmentWith(fetchMaster('repo, notifications, gist'));
    const form = await masterFormFromMyConnection(c, 'alice', enrollment);
    expect(form.kind).toBe('M');
    // someone else's token is refused, and the state is spent
    await expect(enrollment.finish({ state: form.state, action: 'save', value: people.bob.token })).rejects.toThrow();
    await expect(enrollment.finish({ state: form.state, action: 'save', value: people.alice.token })).rejects.toThrow();
    // a token with no classic permission header (fine-grained) is refused
    const plain = await enrollmentWith(fetchMaster(''));
    const form2 = await masterFormFromMyConnection(c, 'alice', plain);
    await expect(plain.finish({ state: form2.state, action: 'save', value: people.alice.token })).rejects.toThrow();
    // the right person, a classic token: saved, a plain return (no new login), usable at once by the existing connection
    const form3 = await masterFormFromMyConnection(c, 'alice', enrollment);
    const saved = await enrollment.finish({ state: form3.state, action: 'save', value: people.alice.token });
    expect(saved.status).toBe('read-observed-at-enrollment');
    expect(new URL(saved.destination).searchParams.get('code')).toBeNull();
    const credentials = (await gateFor(token)).credentials;
    const status = await credentials.masterStatus();
    expect(status.enrolled).toBe(true);
    expect(status.scopes).toEqual(['repo', 'notifications', 'gist']);
    expect(JSON.stringify(status)).not.toContain(people.alice.token);
    expect(await credentials.authorizeOptionalRequest({ account: 'alice-dev', kind: 'M', method: 'POST', url: 'https://api.github.com/user/gists' })).toBe(true);
    await expect(credentials.authorizeOptionalRequest({ account: 'alice-dev', kind: 'M', method: 'GET', url: 'https://evil.example/user' })).rejects.toThrow();
    await expect(credentials.authorizeOptionalRequest({ account: 'alice-dev', kind: 'M', method: 'GET', url: 'https://user:pw@api.github.com/user' })).rejects.toThrow();
    expect(await credentials.token({ account: 'alice-dev', cred: 'M' })).toBe(people.alice.token);
    await expect(credentials.token({ account: 'alice-dev', cred: 'M', scope: { repositories: ['x'] } })).rejects.toThrow();
    expect(await credentials.token({ account: 'alice-dev', cred: 'K' })).toBe(people.alice.token);
    expect(await credentials.authorizeOptionalRequest({ account: 'alice-dev', kind: 'K', method: 'GET', url: 'https://api.github.com/notifications?per_page=1' })).toBe(true);
    await expect(credentials.authorizeOptionalRequest({ account: 'alice-dev', kind: 'K', method: 'POST', url: 'https://api.github.com/user/gists' })).rejects.toThrow();
    expect(await credentials.authorizeOptionalRequest({ account: 'client-co', kind: 'P', method: 'GET', url: 'https://api.github.com/orgs/client-co/packages' })).toBe(true);
    await expect(credentials.authorizeOptionalRequest({ account: 'client-co', kind: 'P', method: 'GET', url: 'https://api.github.com/orgs/other-org/packages' })).rejects.toThrow();
    // My connection shows it is there (never the token)
    const page = await c.finish({ state: (await c.startManage()).state, code: 'alice-fixture-code-1' });
    expect(page.manage.master).toMatchObject({ added: true });
    expect(page.manage.master.unlocks).toContainEqual({ area: 'Gists', unlocked: true });
    expect(JSON.stringify(page)).not.toContain(people.alice.token);
    // another person's connection has none
    const bobRouted = await gateFor(await tokenFor(c, client, 'bob'));
    expect((await bobRouted.credentials.masterStatus()).enrolled).toBe(false);
    await expect(bobRouted.credentials.token({ account: 'bob-test', cred: 'M' })).rejects.toThrow();
  });

  it('never works for a read-only connection or a narrowed scope, and the legacy owner vault has no master token', async () => {
    const { credentialFor, CREDENTIAL_KINDS } = await import('../../src/github/client.js');
    expect(CREDENTIAL_KINDS).toContain('M');
    const ctx = (profile) => ({ connection: { profile, accounts: ['alice-dev'], default_account: 'alice-dev' },
      credentials: { token: async () => 'fake-token-value', authorizeOptionalRequest: async () => true } });
    await expect(credentialFor(ctx('read_only'), { owner: 'alice-dev', cred: 'M' })).rejects.toThrow(/master token/);
    await expect(credentialFor(ctx('full'), { owner: 'alice-dev', cred: 'M', scope: { repositories: ['x'] } })).rejects.toThrow(/master token/);
    await expect(credentialFor({ ...ctx('full'), connection: { ...ctx('full').connection, pass: true } }, { owner: 'alice-dev', cred: 'M' })).rejects.toThrow();
    expect((await credentialFor(ctx('full'), { owner: 'alice-dev', cred: 'M' })).token).toBe('fake-token-value');
  });

  it('can be added or removed at any time with the assistant\'s private one-use link, without reconnecting', async () => {
    const c = make();
    const client = await c.registerClient({ redirect_uris: [CB] });
    const enrollment = await enrollmentWith(fetchMaster('repo, admin:org'));
    const routed = await gateFor(await tokenFor(c, client, 'dave'));
    expect((await routed.credentials.masterStatus()).enrolled).toBe(false);
    const made = await routed.credentials.masterLink({ clientId: client.client_id, redirectUri: CB });
    expect(made.url.startsWith(ORIGIN + '/api/tenant/optional?master_link=')).toBe(true);
    const handle = new URL(made.url).searchParams.get('master_link');
    const form = await enrollment.startMasterLink(handle);
    expect(form.kind).toBe('M');
    await expect(enrollment.startMasterLink(handle)).rejects.toThrow();
    await expect(enrollment.startMasterLink('x'.repeat(43))).rejects.toThrow();
    const saved = await enrollment.finish({ state: form.state, action: 'save', value: people.dave.token });
    expect(saved.status).toBe('read-observed-at-enrollment');
    expect(new URL(saved.destination).searchParams.get('code')).toBeNull();
    expect(await routed.credentials.masterStatus()).toMatchObject({ enrolled: true, scopes: ['repo', 'admin:org'] });
    const again = await enrollment.startMasterLink(new URL((await routed.credentials.masterLink({ clientId: client.client_id, redirectUri: CB })).url).searchParams.get('master_link'));
    await expect(enrollment.finish({ state: again.state, action: 'revoke', value: people.bob.token })).rejects.toThrow();
    const again2 = await enrollment.startMasterLink(new URL((await routed.credentials.masterLink({ clientId: client.client_id, redirectUri: CB })).url).searchParams.get('master_link'));
    const gone = await enrollment.finish({ state: again2.state, action: 'revoke', value: people.dave.token });
    expect(gone.status).toBe('revoked-on-this-service');
    expect((await routed.credentials.masterStatus()).enrolled).toBe(false);
  });

  it('the GitHub link has every permission ticked', async () => {
    const { masterTokenLink, MASTER_SCOPES } = await import('../../src/tenancy/master-credential.js');
    const link = new URL(masterTokenLink());
    expect(link.origin + link.pathname).toBe('https://github.com/settings/tokens/new');
    expect(link.searchParams.get('scopes').split(',')).toEqual([...MASTER_SCOPES]);
    const { default: optional } = await import('../../api/tenant/optional.js');
    expect(typeof optional).toBe('function');
  });
});

describe('GOD-1 the master token lasts exactly as long as the person set it on GitHub', () => {
  it('keeps no limit of ours: no expiry header means it never expires; a dated one is kept as given; an already-expired one is refused', async () => {
    const { createPrivateOptionalEnrollment } = await import('../../src/tenancy/optional-setup.js');
    const { openAuthorizedTenantDb } = await import('../../src/tenancy/directory.js');
    const withHeaders = (extra) => async (url, opts) => {
      const out = await fetchImpl(url, opts);
      if (url !== 'https://api.github.com/user') return out;
      return { ...out, headers: { get: (n) => ({ 'x-oauth-scopes': 'repo, gist', ...extra })[String(n).toLowerCase()] ?? null } };
    };
    const enroll = (fetchFn) => createPrivateOptionalEnrollment({ env, fetchImpl: fetchFn, directoryFactory: () => createTenantDirectory(rootSqlFactory()),
      tenantAccess: (dir, claim) => openAuthorizedTenantDb({ directory: dir, tenantId: claim.tenantId, verifiedIdentityId: claim.identityId, connectionString: env.DATABASE_URL, sqlFactory: tenantSqlFactory }) });
    const c = make();
    const client = await c.registerClient({ redirect_uris: [CB] });
    const routed = await gateFor(await tokenFor(c, client, 'bob'));
    const save = async (fetchFn) => {
      const link = await routed.credentials.masterLink({ clientId: client.client_id, redirectUri: CB });
      const form = await enroll(fetchFn).startMasterLink(new URL(link.url).searchParams.get('master_link'));
      return enroll(fetchFn).finish({ state: form.state, action: 'save', value: people.bob.token });
    };
    await expect(save(withHeaders({ 'github-authentication-token-expiration': '2020-01-01 00:00:00 UTC' }))).rejects.toThrow();
    expect((await routed.credentials.masterStatus()).enrolled).toBe(false);
    await save(withHeaders({ 'github-authentication-token-expiration': '2031-05-06 07:08:09 UTC' }));
    expect((await routed.credentials.masterStatus()).expires_at ?? (await routed.credentials.masterStatus()).expiresAt).toBe('2031-05-06T07:08:09.000Z');
    await save(withHeaders({}));
    const never = await routed.credentials.masterStatus();
    expect(never.enrolled).toBe(true);
    expect(never.expires_at).toBeNull();
    expect(await routed.credentials.token({ account: 'bob-test', cred: 'M' })).toBe(people.bob.token);
  });
});

describe('GOD-4 cancelling leaked tokens (github_credential_revoke)', () => {
  const revokeCalls = [];
  const fetchRevoke = (status = 202) => async (url, opts) => {
    if (url === 'https://api.github.com/credentials/revoke') { revokeCalls.push(JSON.parse(opts.body)); return new Response('{}', { status, headers: { 'content-type': 'application/json' } }); }
    return fetchImpl(url, opts);
  };
  const enrollmentWith = async (fetchFn) => {
    const { createPrivateOptionalEnrollment } = await import('../../src/tenancy/optional-setup.js');
    const { openAuthorizedTenantDb } = await import('../../src/tenancy/directory.js');
    return createPrivateOptionalEnrollment({ env, fetchImpl: fetchFn, directoryFactory: () => createTenantDirectory(rootSqlFactory()),
      tenantAccess: (dir, claim) => openAuthorizedTenantDb({ directory: dir, tenantId: claim.tenantId, verifiedIdentityId: claim.identityId, connectionString: env.DATABASE_URL, sqlFactory: tenantSqlFactory }) });
  };
  const open = async (routed, client, enrollment) => {
    const made = await routed.credentials.revokeLink({ clientId: client.client_id, redirectUri: CB });
    expect(made.url.startsWith(ORIGIN + '/api/tenant/optional?revoke_link=')).toBe(true);
    return enrollment.startRevokeLink(new URL(made.url).searchParams.get('revoke_link'));
  };
  const LEAK1 = 'ghp_FAKEleakedtokenAAAA1111', LEAK2 = 'github_pat_FAKEleakedtokenBBBB2222';

  it('opens a one-use form, sends the pasted tokens to GitHub once, and only ever reports their last four characters', async () => {
    const c = make();
    const client = await c.registerClient({ redirect_uris: [CB] });
    const enrollment = await enrollmentWith(fetchRevoke());
    const routed = await gateFor(await tokenFor(c, client, 'dave'));
    const made = await routed.credentials.revokeLink({ clientId: client.client_id, redirectUri: CB });
    const handle = new URL(made.url).searchParams.get('revoke_link');
    const form = await enrollment.startRevokeLink(handle);
    expect(form.kind).toBe('R');
    await expect(enrollment.startRevokeLink(handle)).rejects.toThrow(); // the link works once
    await expect(enrollment.startRevokeLink('x'.repeat(43))).rejects.toThrow();
    const out = await enrollment.revokeLeaked({ state: form.state, value: LEAK1 + '\n' + LEAK2 + '\n' + LEAK1 });
    expect(out).toMatchObject({ accepted: true, status: 202, count: 2, last4: ['1111', '2222'] });
    expect(JSON.stringify(out)).not.toContain('FAKEleaked');
    expect(revokeCalls).toEqual([{ credentials: [LEAK1, LEAK2] }]);
    await expect(enrollment.revokeLeaked({ state: form.state, value: LEAK1 })).rejects.toThrow(); // the form works once
    expect(revokeCalls).toHaveLength(1);
  });

  it('refuses before any GitHub call: other kinds of link, bad input, too many tokens; and reports a GitHub refusal honestly', async () => {
    const c = make();
    const client = await c.registerClient({ redirect_uris: [CB] });
    const enrollment = await enrollmentWith(fetchRevoke(422));
    const routed = await gateFor(await tokenFor(c, client, 'dave'));
    revokeCalls.length = 0;
    // a master-token link cannot open the revoke form, and the other way round
    const masterHandle = new URL((await routed.credentials.masterLink({ clientId: client.client_id, redirectUri: CB })).url).searchParams.get('master_link');
    await expect(enrollment.startRevokeLink(masterHandle)).rejects.toThrow();
    const revokeHandle = new URL((await routed.credentials.revokeLink({ clientId: client.client_id, redirectUri: CB })).url).searchParams.get('revoke_link');
    await expect(enrollment.startMasterLink(revokeHandle)).rejects.toThrow();
    // the form handle is not a link and the link is not a form
    const form = await open(routed, client, enrollment);
    for (const value of ['', 'short', 'has a\u0001control char', Array.from({ length: 26 }, (_, i) => 'ghp_FAKE' + String(i).padStart(8, '0')).join('\n')]) {
      const f = await open(routed, client, enrollment);
      await expect(enrollment.revokeLeaked({ state: f.state, value })).rejects.toThrow();
    }
    expect(revokeCalls).toEqual([]);
    const rejected = await enrollment.revokeLeaked({ state: form.state, value: LEAK1 });
    expect(rejected).toMatchObject({ accepted: false, status: 422, count: 1, last4: ['1111'] });
  });

  it('the page renders the form and the result without ever echoing a pasted token', async () => {
    const c = make();
    const client = await c.registerClient({ redirect_uris: [CB] });
    const enrollment = await enrollmentWith(fetchRevoke());
    const routed = await gateFor(await tokenFor(c, client, 'dave'));
    const { makePrivateOptionalPage } = await import('../../api/tenant/optional.js');
    const handler = makePrivateOptionalPage({ env, enrollment });
    const res = () => { const r = { headers: {}, code: 0, body: '', setHeader(k, v) { r.headers[k] = v; }, status(n) { r.code = n; return r; }, send(b) { r.body = String(b); return r; }, end() { return r; } }; return r; };
    const made = await routed.credentials.revokeLink({ clientId: client.client_id, redirectUri: CB });
    const get = res();
    await handler({ method: 'GET', query: { revoke_link: new URL(made.url).searchParams.get('revoke_link') }, headers: {} }, get);
    expect(get.code).toBe(200);
    expect(get.body).toContain('name="value"');
    const state = get.body.match(/name="csrf" value="([A-Za-z0-9_-]{43})"/)[1];
    const post = res();
    await handler({ method: 'POST', body: { csrf: state, action: 'revoke_leaked', value: LEAK1 }, headers: { origin: ORIGIN } }, post);
    expect(post.code).toBe(200);
    expect(post.body).toContain('1111');
    expect(post.body).not.toContain('FAKEleaked');
    expect(get.body).not.toContain('FAKEleaked');
  });
});

// GOD-5 extra places: the master token reaches an organization or repositories where the App is not installed.
describe('GOD-5 extra places (master token) in REAL PostgreSQL', () => {
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const none = () => json({ message: 'Not Found' }, 404);
  // Only requests made through the shared client (its user agent) are answered here; sign-in keeps using the shared fixtures.
  const placeFetch = async (url, opts = {}) => {
    const ua = String(opts.headers?.['user-agent'] ?? '');
    if (!ua.includes('robinson-github-mcp') || !String(url).startsWith('https://api.github.com/')) return fetchImpl(url, opts);
    if (!String(opts.headers?.authorization ?? '').endsWith(' ' + people.alice.token)) return json({ message: 'Bad credentials' }, 401);
    const path = new URL(url).pathname;
    const table = {
      '/user': json({ id: 31001, login: 'alice-dev', type: 'User' }),
      '/users/alice-dev': json({ id: 31001, login: 'alice-dev', type: 'User' }),
      '/users/client-co': json({ id: 51001, login: 'client-co', type: 'Organization' }),
      '/users/side-co': json({ id: 51050, login: 'side-co', type: 'Organization' }),
      '/user/memberships/orgs/side-co': json({ state: 'active', role: 'member', organization: { id: 51050 } }),
      '/users/outsider-co': json({ id: 51099, login: 'outsider-co', type: 'Organization' }),
      '/users/stranger': json({ id: 61000, login: 'stranger', type: 'User' }),
      '/user/memberships/orgs/client-co': json({ state: 'active', role: 'admin', organization: { id: 51001 } }),
      '/user/memberships/orgs/outsider-co': json({ state: 'pending', role: 'member' }),
      '/repos/client-co/website': json({ name: 'website', owner: { login: 'client-co' }, permissions: { pull: true } }),
      '/repos/outsider-co/public-site': json({ name: 'public-site', owner: { login: 'outsider-co' }, permissions: { pull: true } }),
      '/repos/outsider-co/no-access': json({ name: 'no-access', owner: { login: 'outsider-co' }, permissions: { pull: false } })
    };
    return table[path] ?? none();
  };
  const withFetch = () => createPublicConnect({ env, fetchImpl: placeFetch, rootSqlFactory, tenantSqlFactory });
  const enrollmentWith = async (fetchFn) => {
    const { createPrivateOptionalEnrollment } = await import('../../src/tenancy/optional-setup.js');
    const { openAuthorizedTenantDb } = await import('../../src/tenancy/directory.js');
    return createPrivateOptionalEnrollment({ env, fetchImpl: fetchFn, directoryFactory: () => createTenantDirectory(rootSqlFactory()),
      tenantAccess: (dir, claim) => openAuthorizedTenantDb({ directory: dir, tenantId: claim.tenantId, verifiedIdentityId: claim.identityId, connectionString: env.DATABASE_URL, sqlFactory: tenantSqlFactory }) });
  };
  /** Sign in to My connection as `who`; returns a function that runs one action and re-opens the page for the next. */
  const session = async (c, who) => {
    let page = (await c.finish({ state: (await c.startManage()).state, code: who + '-fixture-code-1' })).manage;
    return {
      get page() { return page; },
      act: async (action, value = '') => { const out = await c.manageAction({ handle: page.handle, action, value }); if (out.manage) page = out.manage; return out; }
    };
  };
  const addMaster = async (c, who, scopes = 'repo') => {
    const enrollment = await enrollmentWith(async (url, opts) => {
      const out = await fetchImpl(url, opts);
      return url === 'https://api.github.com/user' ? { ...out, headers: { get: (n) => (String(n).toLowerCase() === 'x-oauth-scopes' ? scopes : null) } } : out;
    });
    const s = await session(c, who);
    const { go } = await s.act('master');
    const form = await enrollment.startMasterLink(new URL(go).searchParams.get('master_link'));
    await enrollment.finish({ state: form.state, action: 'save', value: people[who].token });
  };

  it('adds an organization and a repository as read-only extra places, joins live connections, and removes them again', async () => {
    const c = withFetch();
    const client = await c.registerClient({ redirect_uris: [CB] });
    const token = await tokenFor(c, client, 'alice');
    await addMaster(c, 'alice');
    const s = await session(c, 'alice');
    expect(s.page.master.added).toBe(true);

    await s.act('add_place', 'side-co');
    expect(s.page.notice).toMatch(/Added side-co as an extra place.*read-only/);
    const db = await tenantOf(await parsePublicCode(codeOf(await approved(c, client, 'alice'))));
    const row = await db.getAccount('side-co');
    expect(row).toMatchObject({ credential_kind: 'master', allow_changes: false, allowed_repos: null, installation_status: 'none', is_default: false, account_type: 'Organization' });
    // the already-live connection gained it without reconnecting; a brand-new connection gets it too
    expect((await gateFor(token)).connection ?? (await gateFor(token))).toBeTruthy();
    const live = await db.getAccessToken(token.access_token);
    expect(live.accounts).toContain('side-co');
    expect(live.default_account).toBe('alice-dev');
    expect(s.page.places).toEqual([{ login: 'side-co', organization: true, changes: false, repos: null }]);

    // a repository of an organization the person is not a member of
    await s.act('add_place', 'outsider-co/public-site');
    expect(s.page.notice).toMatch(/Added outsider-co\/public-site/);
    expect((await db.getAccount('outsider-co')).allowed_repos).toEqual(['public-site']);

    // flipping changes on and off
    await s.act('place_changes', 'side-co:on');
    expect((await db.getAccount('side-co')).allow_changes).toBe(true);
    await s.act('place_changes', 'side-co:off');
    expect((await db.getAccount('side-co')).allow_changes).toBe(false);

    // read-only and back: an extra place never stops the connection from returning to production mode
    await db.setProductionEnabled('alice-dev', true); await db.setProductionEnabled('client-co', true);
    await db.setConnectionsReadOnly(true);
    await db.setConnectionsReadOnly(false);
    const restored = await db.getAccessToken(token.access_token);
    expect(restored.accounts).toEqual(expect.arrayContaining(['alice-dev', 'side-co']));
    expect(restored).toMatchObject({ profile: 'full', mode: 'production' });
    await db.setProductionEnabled('alice-dev', false); await db.setProductionEnabled('client-co', false);

    // removing a repository removes the place when its list empties; removing the whole place leaves every connection
    await s.act('remove_place', 'outsider-co/public-site');
    expect(await db.getAccount('outsider-co')).toBeNull();
    await s.act('remove_place', 'side-co');
    expect(await db.getAccount('side-co')).toBeNull();
    expect((await db.getAccessToken(token.access_token)).accounts).not.toContain('side-co');
    expect(s.page.places).toEqual([]);
    expect(JSON.stringify(s.page)).not.toContain(people.alice.token);
  });

  it('refuses a place the master token cannot see, an organization the person has not joined, a connected account, and bad input', async () => {
    const c = withFetch();
    await addMaster(c, 'alice');
    const s2 = await session(c, 'alice');
    const before = (await s2.page.places).length;
    for (const [value, words] of [['nonexistent-co', /does not show nonexistent-co/], ['outsider-co', /not an active member of outsider-co/],
      ['outsider-co/no-access', /cannot read outsider-co\/no-access/], ['stranger', /specific repository of stranger/],
      ['alice-dev', /already connected with the GitHub App/], ['client-co', /already connected with the GitHub App/], ['bad value!', /Type an organization/]]) {
      await s2.act('add_place', value);
      expect(s2.page.notice, value).toMatch(words);
    }
    expect(s2.page.places).toHaveLength(before);
    // a made-up action value for flipping or removing is refused outright
    await expect(c.manageAction({ handle: s2.page.handle, action: 'place_changes', value: 'client-co:maybe' })).rejects.toThrow();
    const s3 = await session(c, 'alice');
    await expect(c.manageAction({ handle: s3.page.handle, action: 'remove_place', value: '../etc' })).rejects.toThrow();
  });

  it('works for the connection: a new connection carries the place, tools see it as an extra place, and the page shows it without any token', async () => {
    const c = withFetch();
    const client = await c.registerClient({ redirect_uris: [CB] });
    await addMaster(c, 'alice');
    const s = await session(c, 'alice');
    await s.act('add_place', 'outsider-co/public-site');
    const fresh = await tokenFor(c, client, 'alice');
    const gate = await gateFor(fresh);
    const row = await gate.db.getAccessToken(fresh.access_token);
    expect(row.accounts).toContain('outsider-co');
    const { credentialFor } = await import('../../src/github/client.js');
    const ctx = { connection: { ...row, profile: 'full' }, db: gate.db, credentials: gate.credentials };
    expect((await credentialFor(ctx, { owner: 'outsider-co', cred: 'I' })).token).toBe(people.alice.token);
    await expect(credentialFor({ ...ctx, connection: { ...row, profile: 'read_only' } }, { owner: 'outsider-co', cred: 'I' })).rejects.toThrow(/master token/);
    const readOnly = await tokenFor(c, client, 'alice', { readOnly: true });
    expect((await (await gateFor(readOnly)).db.getAccessToken(readOnly.access_token)).accounts).not.toContain('outsider-co');
    await s.act('remove_place', 'outsider-co');
  });

  it('shows the extra places section on a phone-sized page, with the forms, and no token', async () => {
    const c = withFetch();
    await addMaster(c, 'alice');
    const s = await session(c, 'alice');
    await s.act('add_place', 'side-co');
    const html = await call((req, res) => publicManage(req, res, { env, connect: { manageAction: async () => ({ manage: s.page }) } }), request('POST', { handle: 'x', action: 'refresh', value: '' }, { origin: ORIGIN }));
    expect(html.statusCode).toBe(200);
    for (const text of ['Extra places (uses your master token)', 'side-co', 'read-only', 'id="add-place"', 'id="place-changes-side-co"', 'id="remove-place-side-co"']) expect(html.body).toContain(text);
    expect(html.body).not.toContain(people.alice.token);
    await s.act('remove_place', 'side-co');
  });
});

// LAUNCH-1: uninstalling or revoking the App cleans a public person's own store; invite-only keeps newcomers out.
describe('LAUNCH-1 uninstall clean-up and invite-only in REAL PostgreSQL', () => {
  const SECRET = 'fixture-webhook-secret';
  const delivery = (event, payload, { secret = SECRET } = {}) => {
    const body = Buffer.from(JSON.stringify(payload));
    return Object.assign(Readable.from([body]), { method: 'POST', headers: { 'x-github-event': event, 'x-github-hook-installation-target-id': String(APP),
      'x-hub-signature-256': 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex') } });
  };
  const handler = () => createWebhookHandler({ db: root, credentials: createCredentials({ db: root, env }),
    publicCleanup: createPublicCleanup({ rootSql: rootSqlFactory(), connectionString: env.DATABASE_URL, sqlFactory: tenantSqlFactory }) });
  const send = async (event, payload, opts) => { const res = response(); await handler()(delivery(event, payload, opts), res); return res; };
  const tenantFor = async (who) => tenantOf(await parsePublicCode(codeOf(await approved(make(), await make().registerClient({ redirect_uris: [CB] }), who))));
  const inst = (id, login) => ({ id, account: { login } });

  it('an uninstalled App marks the public person\'s account none and drops its cached tokens; others are untouched', async () => {
    const aliceDb = await tenantFor('alice'), bobDb = await tenantFor('bob');
    const stored = await aliceDb.getAccount('client-co');
    expect(stored).toMatchObject({ installation_id: 41002, installation_status: 'active' });
    await aliceDb.putInstallationToken(41002, 'k', 'enc-token-value', new Date(Date.now() + 3600_000));
    expect(await aliceDb.getInstallationToken(41002, 'k')).toBeTruthy();

    expect((await send('installation', { action: 'deleted', installation: inst(41002, 'client-co') }, { secret: 'wrong' })).statusCode).toBe(401);
    expect((await aliceDb.getAccount('client-co')).installation_status).toBe('active');

    expect((await send('installation', { action: 'deleted', installation: inst(41002, 'client-co') })).statusCode).toBe(200);
    expect((await aliceDb.getAccount('client-co')).installation_status).toBe('none');
    expect(await aliceDb.getInstallationToken(41002, 'k')).toBeFalsy();
    expect((await aliceDb.getAccount('alice-dev')).installation_status).toBe('active');
    expect((await bobDb.getAccount('bob-test')).installation_status).toBe('active');

    // suspend and unsuspend follow the installation id; an unknown installation changes nothing
    await send('installation', { action: 'suspend', installation: inst(41010, 'bob-test') });
    expect((await bobDb.getAccount('bob-test')).installation_status).toBe('suspended');
    await send('installation', { action: 'unsuspend', installation: inst(41010, 'bob-test') });
    expect((await bobDb.getAccount('bob-test')).installation_status).toBe('active');
    expect((await send('installation', { action: 'deleted', installation: inst(99999, 'nobody') })).statusCode).toBe(200);
    expect((await bobDb.getAccount('bob-test')).installation_status).toBe('active');
  });

  it('a revoked App authorization removes that person\'s stored user grants only', async () => {
    const count = async (subject) => Number((await admin.query(`SELECT count(*) n FROM gh_tenant_user_authorizations a JOIN gh_tenant_identities i ON i.id=a.identity_id WHERE i.provider_subject=$1`, [String(subject)])).rows[0].n);
    const before = { alice: await count(31001), bob: await count(31002) };
    expect(before.alice).toBeGreaterThan(0); expect(before.bob).toBeGreaterThan(0);
    expect((await send('github_app_authorization', { action: 'revoked', sender: { id: 31001, login: 'alice-dev' } })).statusCode).toBe(200);
    expect(await count(31001)).toBe(0);
    expect(await count(31002)).toBe(before.bob);
    expect((await send('github_app_authorization', { action: 'revoked', sender: {} })).statusCode).toBe(200);
    expect(await count(31002)).toBe(before.bob);
  });

  it('invite-only keeps a new person out until invited, never locks out an existing person, and the list is managed in the directory', async () => {
    people.gina = { token: 'tok-gina-0007', id: 31007, login: 'gina-new', installs: [{ id: 41060, app_id: APP, account: { id: 31007, login: 'gina-new', type: 'User' }, repository_selection: 'all', suspended_at: null }] };
    people.ivan = { token: 'tok-ivan-0008', id: 31008, login: 'ivan-new', installs: [{ id: 41061, app_id: APP, account: { id: 31008, login: 'ivan-new', type: 'User' }, repository_selection: 'all', suspended_at: null }] };
    const dir = createTenantDirectory(rootSqlFactory());
    const c = make({ GITHUB_PUBLIC_INVITE_ONLY: 'enabled' });
    const client = await c.registerClient({ redirect_uris: [CB] });
    // a brand-new person (no store yet) is refused with the plain sentence, and no store is created
    await expect((await signIn(c, client, 'gina')).finished).rejects.toMatchObject({ code: 'invite_only', message: /invite-only right now/ });
    expect(await dir.findPublicTenantBySubject(31007)).toBeNull();
    // existing people still sign in and approve
    expect(codeOf(await approved(c, client, 'bob'))).toBeTruthy();
    // invites are lower-cased, validated and removable; an invited newcomer gets in
    expect(await dir.addPublicInvites(['Gina-New', 'someone'])).toBe(2);
    expect(await dir.isPublicInvited('gina-new')).toBe(true);
    await expect(dir.addPublicInvites(['bad name!'])).rejects.toThrow();
    expect(await dir.removePublicInvite('someone')).toBe(true);
    expect(await dir.listPublicInvites()).toContain('gina-new');
    expect(await dir.listPublicInvites()).not.toContain('someone');
    expect(codeOf(await approved(c, client, 'gina'))).toBeTruthy();
    expect(await dir.findPublicTenantBySubject(31007)).toBeTruthy();
    // off by default: an uninvited newcomer connects
    const open = make();
    expect(codeOf(await approved(open, await open.registerClient({ redirect_uris: [CB] }), 'ivan'))).toBeTruthy();
  });
});

describe('HARD-1 sign-in steps: no single app can fill the table for everyone', () => {
  it('caps open sign-in steps per app (default 20); another app still works; a rejected step leaves no row', async () => {
    const c = make();
    const noisy = await c.registerClient({ redirect_uris: [CB] });
    for (let i = 0; i < 20; i += 1) await c.begin(authorizeParams(noisy, { state: 'noisy-state-' + i }));
    await expect(c.begin(authorizeParams(noisy, { state: 'noisy-state-21' }))).rejects.toMatchObject({ code: 'capacity' });
    const quiet = await c.registerClient({ redirect_uris: [CB] });
    expect((await c.begin(authorizeParams(quiet))).url).toMatch(/^https:\/\/github\.com\/login\/oauth\/authorize\?/);
    const open = await admin.query('SELECT count(*)::int n FROM gh_public_flows WHERE client_id=$1 AND expires_at > now()', [noisy.client_id]);
    expect(open.rows[0].n).toBe(20);
  });
  it('the per-app cap is a setting, expired steps never count, and the built-in pages have their own larger cap', async () => {
    const c = make({ GITHUB_PUBLIC_MAX_OPEN_FLOWS_PER_CLIENT: '2' });
    const app = await c.registerClient({ redirect_uris: [CB] });
    await c.begin(authorizeParams(app, { state: 'cap-a' })); await c.begin(authorizeParams(app, { state: 'cap-b' }));
    await expect(c.begin(authorizeParams(app, { state: 'cap-c' }))).rejects.toMatchObject({ code: 'capacity' });
    await admin.query("UPDATE gh_public_flows SET expires_at = now() - interval '1 minute' WHERE client_id=$1", [app.client_id]);
    expect((await c.begin(authorizeParams(app, { state: 'cap-d' }))).url).toBeTruthy();
    expect((await admin.query('SELECT count(*)::int n FROM gh_public_flows WHERE client_id=$1', [app.client_id])).rows[0].n).toBe(1);
    // the built-in My connection page is not held to the per-app cap of 2
    for (let i = 0; i < 5; i += 1) expect((await c.startManage()).url).toBeTruthy();
  });
});

describe('HARD-1 one shared copy of the App keys', () => {
  it('a replaced App key reaches an already-connected person at once, without them signing in again', async () => {
    const c = make();
    const client = await c.registerClient({ redirect_uris: [CB] });
    const token = json(await exchange(client, codeOf(await approved(c, client, 'bob'))));
    const before = await gateFor(token);
    expect(before).not.toBeNull();
    // The person's own copy still holds the old (fixture) key, which cannot sign anything.
    await expect(before.credentials.appJwt(APP)).rejects.toThrow();
    // The owner replaces the App key in the shared copy only.
    const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = pair.privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
    const sealed = encryptSecret(pem, { aad: `github-mcp/app/${APP}/private_key`, key: Buffer.from(env.TOKEN_ENCRYPTION_KEY, 'base64url') });
    const current = await root.getApp(APP);
    await root.saveApp({ id: APP, slug: current.slug, ownerLogin: current.owner_login, ownerType: current.owner_type, clientId: current.client_id,
      clientSecretEnc: current.client_secret_enc, privateKeyEnc: sealed, webhookSecretEnc: current.webhook_secret_enc, permissions: current.permissions });
    const after = await gateFor(token);
    const jwt = await after.credentials.appJwt(APP);
    const [head, body, signature] = jwt.split('.');
    expect(crypto.verify('RSA-SHA256', Buffer.from(head + '.' + body), pair.publicKey, Buffer.from(signature, 'base64url'))).toBe(true);
  });
});

describe('HARD-2 people who signed in before a release get its new columns', () => {
  it('a tenant created before accounts.allow_changes existed is upgraded the first time it is opened', async () => {
    const c = make();
    const client = await c.registerClient({ redirect_uris: [CB] });
    const token = json(await exchange(client, codeOf(await approved(c, client, 'carol'))));
    const first = await gateFor(token);
    expect(first).not.toBeNull();
    const sel = { tenant_id: first.tenant.tenantId, identity_id: first.tenant.identityId };
    expect(sel.tenant_id).toBeTruthy();
    const schema = tenantSchemaName(sel.tenant_id);
    // Make this person look like someone who signed in before GOD-5: the two columns are not there.
    await admin.query(`ALTER TABLE "${schema}".gh_accounts DROP COLUMN IF EXISTS allow_changes, DROP COLUMN IF EXISTS allowed_repos`);
    const before = await admin.query(`SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'gh_accounts' AND column_name = 'allow_changes'`, [schema]);
    expect(before.rows.length).toBe(0);
    const directoryMod = await import('../../src/tenancy/directory.js');
    directoryMod.forgetUpgradedTenantsForTests();
    const gate = await gateFor(token);
    expect(gate).not.toBeNull();
    const after = await admin.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'gh_accounts' AND column_name IN ('allow_changes','allowed_repos')`, [schema]);
    expect(after.rows.map((r) => r.column_name).sort()).toEqual(['allow_changes', 'allowed_repos']);
    // The listing that github_whoami uses (it selects the new columns) works again.
    const db = await tenantOf({ tenantId: sel.tenant_id, identityId: sel.identity_id });
    await expect(db.listAccounts()).resolves.toBeInstanceOf(Array);
  });
});

describe('PUB-5 A: sign-in keeps the shared installation lookup current', () => {
  it('records the App installations of the accounts a person connects (numbers only) and adds nothing for an extra place', async () => {
    const c = make();
    const client = await c.registerClient({ redirect_uris: [CB] });
    const idsOf = async (subject) => {
      const t = await admin.query("SELECT b.tenant_id FROM gh_tenant_pilot_bootstraps b JOIN gh_tenant_identities i ON i.id=b.identity_id WHERE b.account_login='public-connect' AND i.provider_subject=$1", [subject]).then((r) => r.rows[0]?.tenant_id);
      const rows = t ? await admin.query('SELECT installation_id FROM gh_public_installations WHERE tenant_id=$1 ORDER BY 1', [t]).then((r) => r.rows.map((x) => Number(x.installation_id))) : [];
      return { tenantId: t, rows };
    };
    const bob = await tokenFor(c, client, 'bob');
    expect((await idsOf('31002')).rows).toEqual([41010]);
    const alice = await tokenFor(c, client, 'alice');
    const first = await idsOf('31001');
    expect(first.rows).toEqual([41001, 41002]); // the other App's installation (41003) is not ours and is not recorded
    // an extra place (master token) lives in the person's own store and has no installation: signing in again changes nothing
    const aliceDb = (await gateFor(alice)).db;
    await aliceDb.upsertAccount({ login: 'alice-extra-place', accountId: 99, accountType: 'Organization', label: 'extra', credentialKind: 'master' });
    await tokenFor(c, client, 'alice');
    expect((await idsOf('31001')).rows).toEqual([41001, 41002]);
    expect(bob.access_token).toBeTruthy();
  });
});


describe('Marketplace isolated free customer lifecycle', () => {
  const mpEnv = () => ({...env,GITHUB_MARKETPLACE_CONNECT:'enabled',GITHUB_MARKETPLACE_PLAN_ID:'920001',GITHUB_MARKETPLACE_WEBHOOK_SECRET:'FAKE-marketplace-webhook-secret-00000000'});
  const resource = ORIGIN + '/api/marketplace/mcp?account=51001';
  const payload = (action, date) => ({action,effective_date:date,marketplace_purchase:{account:{id:51001},plan:{id:920001,monthly_price_in_cents:0,yearly_price_in_cents:0}}});
  const delivery = async (body, id, signature = true) => {
    const rawBody = Buffer.from(JSON.stringify(body));
    return call(createMarketplaceWebhook({sql:sqlFor(admin),rootDb:root,env:mpEnv(),fetchImpl}),
      {...request('POST'),rawBody,headers:{'x-github-event':'marketplace_purchase','x-github-delivery':id,
        'x-hub-signature-256':signature ? 'sha256=' + crypto.createHmac('sha256',mpEnv().GITHUB_MARKETPLACE_WEBHOOK_SECRET).update(rawBody).digest('hex') : 'sha256='+'0'.repeat(64)}});
  };
  it('requires signed purchase, independent subscription and real admin authority; binds the exact MCP resource', async () => {
    const direct = make(), directClient = await direct.registerClient({redirect_uris:[CB]});
    const originalDirect = await tokenFor(direct,directClient,'alice');
    const c = make(mpEnv()), client = await c.registerClient({redirect_uris:[CB]});
    await expect((await signIn(c,client,'market',{resource})).finished).rejects.toThrow();
    expect((await delivery(payload('purchased','2026-01-01T00:00:00Z'),'market-purchase-001',false)).statusCode).toBe(401);
    expect((await delivery(payload('purchased','2026-01-01T00:00:00Z'),'market-purchase-001')).statusCode).toBe(200);
    // A real non-admin cannot provision the organization's customer tenant.
    await expect((await signIn(c,client,'erin',{resource})).finished).resolves.toHaveProperty('install');
    const result = await approved(c,client,'market',{extra:{resource}});
    const code = codeOf(result);
    expect((await exchange(client,code)).statusCode).toBe(400);
    const tokenRes = await call((req,res)=>privateTenantToken(req,res,{env:mpEnv(),rootSqlFactory,tenantSqlFactory}),
      request('POST',{grant_type:'authorization_code',client_id:client.client_id,client_secret:client.client_secret,redirect_uri:CB,code,code_verifier:verifier,resource}));
    expect(tokenRes.statusCode).toBe(200);
    const token = json(tokenRes);
    const context = await resolvePrivateTenantMcpBearer({authorization:'Bearer '+token.access_token,env:mpEnv(),rootSqlFactory,tenantSqlFactory,fetchImpl});
    expect(context.marketplaceAccountId).toBe(51001);
    expect((await context.db.listAccounts()).map(a=>a.login)).toEqual(['client-co']);
    const directId = await directory.findPublicTenantBySubject('31001');
    expect(context.tenant.tenantId).not.toBe(directId);
    const store = createMarketplaceStore(sqlFor(admin));
    // Revocation failure must still block access immediately and keep a durable cleanup job.
    failMarketplaceRevocation = true;
    const cancelled = payload('cancelled','2026-01-02T00:00:00Z');
    expect((await delivery(cancelled,'market-cancel-001')).statusCode).toBe(503);
    expect((await store.binding(context.tenant.tenantId)).active).toBe(false);
    expect(await resolvePrivateTenantMcpBearer({authorization:'Bearer '+token.access_token,env:mpEnv(),rootSqlFactory,tenantSqlFactory,fetchImpl})).toBeNull();
    expect((await delivery(payload('purchased','2026-01-01T00:00:00Z'),'market-stale-001')).statusCode).toBe(200);
    expect((await store.subscription(51001)).status).toBe('cancelled');
    failMarketplaceRevocation = false;
    expect(await sweepMarketplace({sql:sqlFor(admin),rootDb:root,env:mpEnv(),fetchImpl})).toEqual({removed:1,failed:0});
    expect(revokedMarketplace).toEqual(new Set(['ghu_FAKE-marketplace-0001']));
    expect((await admin.query('SELECT 1 FROM gh_tenants WHERE id=$1',[context.tenant.tenantId])).rowCount).toBe(0);
    expect((await admin.query('SELECT 1 FROM pg_namespace WHERE nspname=$1',[context.tenant.namespace])).rowCount).toBe(0);
    expect(await directory.findPublicTenantBySubject('31001')).toBe(directId);
    // Replay remains harmless after deletion; a new ID with an older purchase cannot resurrect it.
    expect((await delivery(cancelled,'market-cancel-001')).statusCode).toBe(200);
    expect((await delivery(payload('purchased','2026-01-01T00:00:00Z'),'market-stale-002')).statusCode).toBe(200);
    expect(await store.subscription(51001)).toBeNull();
    expect(await gateFor(originalDirect)).not.toBeNull();
    // A sign-in begun before cancellation must not leave a new identity or namespace behind.
    expect(await store.enroll({accountId:51001,subject:'999991',planId:920001,effectiveAt:'2026-01-01T00:00:00Z'})).toBeNull();
    expect((await admin.query("SELECT 1 FROM gh_tenant_identities WHERE provider_subject='999991'")).rowCount).toBe(0);
  });
  it('waits for an in-flight refresh, revokes its replacement and rejects a pending Approve page', async () => {
    expect((await delivery(payload('purchased','2026-01-03T00:00:00Z'),'market-rebuy-001')).statusCode).toBe(200);
    const c=make(mpEnv()), client=await c.registerClient({redirect_uris:[CB]});
    const pending=await (await signIn(c,client,'market',{resource})).finished;
    const tenantId=await directory.findPublicTenantBySubject('31001','marketplace-51001');
    const identityId=(await admin.query('SELECT identity_id FROM gh_marketplace_tenants WHERE tenant_id=$1',[tenantId])).rows[0].identity_id;
    const old=await directory.getPilotUserAuthorization(tenantId,identityId,'client-co');
    const claimId=crypto.randomUUID();
    expect(await directory.claimPilotUserRefresh({tenantId,identityId,accountLogin:'client-co',expectedAccessEnc:old.access_enc,claimId})).not.toBeNull();
    expect((await delivery(payload('cancelled','2026-01-04T00:00:00Z'),'market-cancel-002')).statusCode).toBe(503);
    await expect(c.approve({handle:pending.approve.handle,choice:'approve'})).rejects.toThrow();
    expect(await directory.claimPilotUserRefresh({tenantId,identityId,accountLogin:'client-co',expectedAccessEnc:old.access_enc,claimId:crypto.randomUUID()})).toBeNull();
    const accessEnc=encryptSecret('ghu_FAKE-marketplace-refreshed',{key:Buffer.from(env.TOKEN_ENCRYPTION_KEY,'base64url'),
      aad:`github-mcp/private-tenant/${tenantId}/identity/${identityId}/account/client-co/access`});
    expect(await directory.finishPilotUserRefresh({tenantId,identityId,accountLogin:'client-co',expectedAccessEnc:old.access_enc,claimId,
      accessEnc,accessExpiresAt:new Date(Date.now()+3600000),refreshEnc:old.refresh_enc,refreshExpiresAt:old.refresh_expires_at})).toBe(true);
    expect(await sweepMarketplace({sql:sqlFor(admin),rootDb:root,env:mpEnv(),fetchImpl})).toEqual({removed:1,failed:0});
    expect(revokedMarketplace.has('ghu_FAKE-marketplace-refreshed')).toBe(true);
    expect((await admin.query('SELECT 1 FROM gh_marketplace_grants WHERE tenant_id=$1',[tenantId])).rowCount).toBe(0);
  });
});
