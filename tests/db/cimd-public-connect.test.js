import crypto, { createHash } from 'node:crypto';
import pg from 'pg';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createDb } from '../../src/db.js';
import { createTenantDirectory, tenantSchemaName } from '../../src/tenancy/directory.js';
import { createPublicConnect } from '../../src/tenancy/public-connect.js';
import { clearCimdClientCache } from '../../src/tenancy/cimd-client.js';
import { privateTenantToken } from '../../src/tenancy/oauth-token.js';
import { encryptSecret } from '../../src/core/crypto.js';
import { call, json, request } from '../../test/helpers/http-harness.js';

// PUB-10: CIMD card clients (Claude, ChatGPT) through the real public-connect
// flow in real PostgreSQL. Document fixtures mirror the live documents
// fetched 2026-11-02; the fake fetch serves them, so no live network runs.
const APP = 960101, ORIGIN = 'https://connect.example.test';
const CLAUDE_ID = 'https://claude.ai/oauth/mcp-oauth-client-metadata';
const CLAUDE_CB = 'https://claude.ai/api/mcp/auth_callback';
const CHATGPT_ID = 'https://chatgpt.com/oauth/client.json';
const CHATGPT_CB = 'https://chatgpt.com/connector_platform_oauth_redirect';
const DOCS = {
  [CLAUDE_ID]: { client_id: CLAUDE_ID, client_name: 'Claude', client_uri: 'https://claude.ai',
    redirect_uris: [CLAUDE_CB], grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'], token_endpoint_auth_method: 'none' },
  [CHATGPT_ID]: { client_id: CHATGPT_ID, client_uri: 'https://chatgpt.com/', redirect_uris: [CHATGPT_CB],
    token_endpoint_auth_method: 'private_key_jwt', token_endpoint_auth_methods_supported: ['none', 'private_key_jwt'],
    grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], client_name: 'ChatGPT' },
};
let admin, directory, env;
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
const alice = { token: 'tok-alice-0001', id: 31001, login: 'alice-dev', installs: [
  { id: 41001, app_id: APP, account: { id: 31001, login: 'alice-dev', type: 'User' }, repository_selection: 'all', suspended_at: null }] };
const fetchImpl = async (url, opts = {}) => {
  if (DOCS[url]) return { ok: true, status: 200, text: async () => JSON.stringify(DOCS[url]), json: async () => DOCS[url] };
  if (url === 'https://github.com/login/oauth/access_token') {
    const who = String(opts.body.get('code')).startsWith('alice') ? alice : null;
    if (!who) return { ok: false, status: 400, json: async () => ({}) };
    return { ok: true, json: async () => ({ access_token: who.token, refresh_token: who.token + '-refresh', expires_in: 28800, refresh_token_expires_in: 15000000 }) };
  }
  const who = opts.headers?.authorization === 'Bearer ' + alice.token ? alice : null;
  if (!who) return { ok: false, status: 401, json: async () => ({}) };
  if (url === 'https://api.github.com/user') return { ok: true, status: 200, json: async () => ({ id: who.id, login: who.login, type: 'User' }) };
  if (url === 'https://api.github.com/user/memberships/orgs?state=active&per_page=100')
    return { ok: true, status: 200, json: async () => [] };
  if (url === 'https://api.github.com/user/installations?per_page=100')
    return { ok: true, status: 200, json: async () => ({ total_count: who.installs.length, installations: who.installs }) };
  throw new Error('unrecognized fixture route ' + url);
};
const deadFetch = async (url, opts = {}) => url.startsWith('https://claude.ai/') || url.startsWith('https://chatgpt.com/')
  ? { ok: false, status: 404, text: async () => 'not found', json: async () => ({}) } : fetchImpl(url, opts);
const verifier = 'v'.repeat(43), challenge = createHash('sha256').update(verifier).digest('base64url');
const make = (fetch = fetchImpl) => createPublicConnect({ env, fetchImpl: fetch, rootSqlFactory, tenantSqlFactory });
const paramsFor = (clientId, redirectUri) => ({ client_id: clientId, response_type: 'code', redirect_uri: redirectUri,
  code_challenge: challenge, code_challenge_method: 'S256', state: 'client-nonce', resource: ORIGIN + '/api/mcp' });

beforeAll(async () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('Disposable TEST_DATABASE_URL is required.');
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(url).hostname)) throw new Error('Refusing non-local PostgreSQL.');
  admin = await connect(url);
  const ns = 'github_cimd_' + crypto.randomBytes(6).toString('hex');
  await admin.query('CREATE SCHEMA "' + ns + '"'); await admin.query('SET search_path TO "' + ns + '"');
  admin.ns = ns;
  directory = createTenantDirectory(sqlFor(admin)); await directory.initSchema();
  const root = createDb(sqlFor(admin)); await root.initSchema();
  env = { VERCEL_ENV: 'production', GITHUB_PRIVATE_TENANT_PILOT: 'enabled', GITHUB_PUBLIC_CONNECT: 'enabled',
    GITHUB_PILOT_APP_ID: String(APP), PUBLIC_BASE_URL: ORIGIN, DATABASE_URL: url,
    GITHUB_PILOT_APP_CLIENT_ID: 'fixture-app-client', GITHUB_PILOT_APP_CLIENT_SECRET: 'fixture-app-secret',
    TOKEN_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64url'),
    GITHUB_TENANT_ROUTING_KEY: crypto.randomBytes(32).toString('base64url') };
  const secret = (text, kind) => encryptSecret(text, { aad: `github-mcp/app/${APP}/${kind}`, key: Buffer.from(env.TOKEN_ENCRYPTION_KEY, 'base64url') });
  await root.saveApp({ id: APP, slug: 'cimd-connect-app', ownerLogin: 'service-owner', ownerType: 'Organization', clientId: 'fixture-app-client',
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

describe('PUB-10 CIMD card clients in real PostgreSQL', () => {
  it('admits Claude at authorize and refuses an unlisted redirect', async () => {
    const c = make();
    const started = await c.begin(paramsFor(CLAUDE_ID, CLAUDE_CB));
    expect(new URL(started.url).origin + new URL(started.url).pathname).toBe('https://github.com/login/oauth/authorize');
    await expect(c.begin(paramsFor(CLAUDE_ID, 'https://elsewhere.example.test/cb'))).rejects.toThrow();
    // The mirrored row names the document host, never the self-asserted name.
    const row = await directory.getPublicClient(CLAUDE_ID);
    expect(row).toMatchObject({ authMethod: 'none', clientName: 'claude.ai', redirectUris: [CLAUDE_CB] });
  });
  it('admits ChatGPT (plural "none" intersection) and refuses a redirect from another card', async () => {
    const c = make();
    const started = await c.begin(paramsFor(CHATGPT_ID, CHATGPT_CB));
    expect(started.url).toContain('https://github.com/login/oauth/authorize');
    await expect(c.begin(paramsFor(CHATGPT_ID, CLAUDE_CB))).rejects.toThrow();
  });
  it('refuses both cards when the document cannot be fetched (today\u2019s production behavior)', async () => {
    clearCimdClientCache();
    const c = make(deadFetch);
    await expect(c.begin(paramsFor(CLAUDE_ID, CLAUDE_CB))).rejects.toThrow();
    await expect(c.begin(paramsFor(CHATGPT_ID, CHATGPT_CB))).rejects.toThrow();
  });
  it('runs Claude through consent, code, token and refresh with no secret', async () => {
    const c = make();
    const started = await c.begin(paramsFor(CLAUDE_ID, CLAUDE_CB));
    const finished = await c.finish({ state: started.state, code: 'alice-fixture-code-1' });
    expect(finished.approve?.appName).toBe('claude.ai');
    const redirect = (await c.approve({ handle: finished.approve.handle, choice: 'approve' })).redirect;
    const target = new URL(redirect);
    expect(target.origin + target.pathname).toBe(CLAUDE_CB);
    const code = target.searchParams.get('code');
    const exchange = (body) => call((req, res) => privateTenantToken(req, res, { env, rootSqlFactory, tenantSqlFactory }),
      request('POST', body));
    const tokens = json(await exchange({ grant_type: 'authorization_code', client_id: CLAUDE_ID,
      redirect_uri: CLAUDE_CB, code, code_verifier: verifier, resource: ORIGIN + '/api/mcp' }));
    expect(tokens.access_token).toBeTruthy();
    expect(tokens.refresh_token).toBeTruthy();
    const refreshed = json(await exchange({ grant_type: 'refresh_token', client_id: CLAUDE_ID,
      refresh_token: tokens.refresh_token, resource: ORIGIN + '/api/mcp' }));
    expect(refreshed.access_token).toBeTruthy();
    expect(refreshed.access_token).not.toBe(tokens.access_token);
  });
});
