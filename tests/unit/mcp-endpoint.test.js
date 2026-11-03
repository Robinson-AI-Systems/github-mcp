import { afterEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import { createFakeDb } from '../../test/helpers/fake-db.js';
import { call, json, request, response } from '../../test/helpers/http-harness.js';
import { CONNECTION_FIELDS } from '../../src/db.js';
import { requireMcpToken } from '../../src/core/mcp-auth.js';
import { createMcpHandler, denyAll } from '../../src/core/mcp-server.js';
import { mergeNamespaces , isToolVisible } from '../../src/core/registry.js';
import { registry as builtRegistry } from '../../src/tools/index.js';
import { createGithubPolicy } from '../../src/oauth/policy.js';
import { handleOAuth } from '../../src/oauth/routes.js';
import indexHandler from '../../api/index.js';

const env = { PUBLIC_BASE_URL: 'https://github-mcp.example.test', ADMIN_PASSPHRASE: 'only-the-owner-knows' };
const ACCESS = 'a'.repeat(60);
const SCOPE = { clientId: 'client-1', defaultAccount: 'example-org', accounts: ['example-org', 'example-user'], mode: 'preview', profile: 'everyday', listing: 'catalog' };
const bearer = (token) => ({ authorization: `Bearer ${token}` });

describe('policy.tokenSettings and policy.toConnection', () => {
  const policy = createGithubPolicy({ env });

  it('maps every connection field from the issuing row to the token parameters, so none can be dropped', () => {
    const row = { client_id: 'c', default_account: 'example-user', accounts: ['example-org', 'example-user'], mode: 'production', profile: 'full', listing: 'compact', code_challenge: 'x' };
    const settings = policy.tokenSettings(row);
    expect(Object.keys(settings)).toHaveLength(CONNECTION_FIELDS.length);
    expect(settings).toEqual({ defaultAccount: 'example-user', accounts: ['example-org', 'example-user'], mode: 'production', profile: 'full', listing: 'compact' });
    expect(settings).not.toHaveProperty('code_challenge');
  });

  it('builds a frozen connection for a valid row and refuses a malformed one', () => {
    const row = { client_id: 'c', default_account: 'example-org', accounts: ['example-org'], mode: 'preview', profile: 'read_only', listing: 'compact' };
    const { connection } = policy.toConnection(row);
    expect(connection).toEqual(row);
    expect(Object.isFrozen(connection)).toBe(true);
    expect(Object.isFrozen(connection.accounts)).toBe(true);
    for (const change of [{ mode: 'live' }, { profile: 'admin' }, { listing: 'x' }, { accounts: [] }, { accounts: null }, { default_account: 'other' }]) {
      expect(policy.toConnection({ ...row, ...change })).toBeNull();
    }
  });

  it('refuses a production connection anywhere but the production deployment', () => {
    const row = { client_id: 'c', default_account: 'example-org', accounts: ['example-org'], mode: 'production', profile: 'full', listing: 'compact' };
    for (const e of [{}, { VERCEL_ENV: 'preview' }, { VERCEL_ENV: 'development' }]) {
      expect(createGithubPolicy({ env: e }).toConnection(row)).toMatchObject({ refuse: { status: 403, body: { error: 'production_unavailable' } } });
    }
    expect(createGithubPolicy({ env: { VERCEL_ENV: 'production' } }).toConnection(row).connection.mode).toBe('production');
  });
});

describe('requireMcpToken', () => {
  const toConnection = createGithubPolicy({ env }).toConnection;

  it('needs a toConnection function', async () => {
    await expect(requireMcpToken(request('POST', {}), response(), createFakeDb(), env)).rejects.toThrow(TypeError);
  });

  it('never allows MCP access without a valid bearer, and names where to sign in', async () => {
    const db = createFakeDb();
    const missing = response();
    expect(await requireMcpToken(request('POST', {}), missing, db, env, { toConnection })).toBeNull();
    expect(missing.statusCode).toBe(401);
    expect(missing.headers['WWW-Authenticate']).toBe(`Bearer resource_metadata="${env.PUBLIC_BASE_URL}/.well-known/oauth-protected-resource"`);
    for (const header of ['Bearer short', 'Basic ' + ACCESS, `Bearer ${ACCESS} extra`, 'Bearer ' + 'a'.repeat(300), 'Bearer a b']) {
      const res = response();
      expect(await requireMcpToken(request('POST', {}, { authorization: header }), res, db, env, { toConnection })).toBeNull();
      expect(res.statusCode).toBe(401);
    }
  });

  it('accepts a live token and hands tools the whole frozen connection', async () => {
    const db = createFakeDb();
    await db.createAccessToken({ accessToken: ACCESS, refreshToken: 'b'.repeat(60), ...SCOPE });
    const connection = await requireMcpToken(request('POST', {}, bearer(ACCESS)), response(), db, env, { toConnection });
    expect(connection).toEqual({ client_id: 'client-1', default_account: 'example-org', accounts: ['example-org', 'example-user'], mode: 'preview', profile: 'everyday', listing: 'catalog' });
    expect(Object.isFrozen(connection)).toBe(true);
  });

  it('refuses unknown, expired and revoked tokens', async () => {
    const db = createFakeDb();
    await db.createAccessToken({ accessToken: ACCESS, refreshToken: 'b'.repeat(60), ...SCOPE });
    await db.createAccessToken({ accessToken: 'e'.repeat(60), refreshToken: 'f'.repeat(60), ...SCOPE, ttlSeconds: -10 });
    await db.createAccessToken({ accessToken: 'r'.repeat(60), refreshToken: 's'.repeat(60), ...SCOPE });
    await db.revokeAccessToken('r'.repeat(60));
    for (const token of ['x'.repeat(60), 'e'.repeat(60), 'r'.repeat(60)]) {
      const res = response();
      expect(await requireMcpToken(request('POST', {}, bearer(token)), res, db, env, { toConnection })).toBeNull();
      expect(res.statusCode).toBe(401);
      expect(res.headers['WWW-Authenticate']).toContain('invalid_token');
    }
  });

  it('answers a production token on a non-production deployment with a plain 403, not a sign-in loop', async () => {
    const db = createFakeDb();
    await db.createAccessToken({ accessToken: ACCESS, refreshToken: 'b'.repeat(60), ...SCOPE, mode: 'production' });
    const res = response();
    expect(await requireMcpToken(request('POST', {}, bearer(ACCESS)), res, db, env, { toConnection })).toBeNull();
    expect(res.statusCode).toBe(403);
    expect(json(res).error).toBe('production_unavailable');
    expect(res.headers['WWW-Authenticate']).toBeUndefined();
    const prod = createGithubPolicy({ env: { ...env, VERCEL_ENV: 'production' } });
    expect((await requireMcpToken(request('POST', {}, bearer(ACCESS)), response(), db, { ...env, VERCEL_ENV: 'production' }, { toConnection: prod.toConnection })).mode).toBe('production');
  });
});

  it('accepts scheme case and horizontal whitespace without altering credential bytes',async()=>{
    const record={client_id:'client-A'};
    const seen=[];
    const db={async getAccessToken(token){seen.push(token);return token===ACCESS?record:null;}};
    const policy={toConnection:row=>({connection:Object.freeze({...row})})};
    for(const prefix of ['bearer ','BEARER\t','bEaReR  ']){
      expect(await requireMcpToken(request('POST',{}, {authorization:prefix+ACCESS}),
        response(),db,env,policy)).toEqual(record);
    }
    expect(seen).toEqual([ACCESS,ACCESS,ACCESS]);
    for(const header of ['Bearer '+ACCESS+' extra','Bearer\n'+ACCESS,'Basic '+ACCESS])
      expect(await requireMcpToken(request('POST',{}, {authorization:header}),response(),db,env,policy)).toBeNull();
  });

describe('MCP endpoint over HTTP', () => {
  let server;
  afterEach(async () => { if (server) await new Promise((resolve) => server.close(resolve)); server = null; });

  async function start(registry, extra = {}) {
    const db = createFakeDb();
    await db.createAccessToken({ accessToken: ACCESS, refreshToken: 'b'.repeat(60), ...SCOPE });
    const handler = createMcpHandler({ db, registry, env, toConnection: createGithubPolicy({ env }).toConnection, ...extra });
    server = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', async () => {
        req.body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
        res.status = (code) => { res.statusCode = code; return res; };
        res.send = (value) => res.end(value);
        res.json = (value) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); };
        await handler(req, res);
      });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${server.address().port}`;
  }
  async function rpc(url, method, params, token = ACCESS) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(token ? bearer(token) : {}) },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
    });
    const text = await res.text();
    const data = text.split('\n').find((line) => line.startsWith('data:'));
    return { status: res.status, body: data ? JSON.parse(data.slice(5)) : (text ? JSON.parse(text) : null) };
  }

  it('lists zero tools while the registry is empty', async () => {
    const url = await start(mergeNamespaces([]));
    const { status, body } = await rpc(url, 'tools/list', {});
    expect(status).toBe(200);
    expect(body.result.tools).toEqual([]);
  });
  it('preserves injected per-tool OAuth metadata over the actual MCP transport',async()=>{
    const url=await start(builtRegistry,{toolSecuritySchemes:()=>[
      {type:'oauth2',scopes:['fixture.read']} ]});
    const {body}=await rpc(url,'tools/list',{});
    expect(body.result.tools.length).toBeGreaterThan(0);
    expect(body.result.tools.every(t=>t.securitySchemes?.[0]?.scopes?.[0]==='fixture.read')).toBe(true);
  });

  it('CAP-6: tools/list shows only what the injected gate offers, and a failing gate never breaks the listing', async () => {
    const seen = [];
    const url = await start(builtRegistry, { offered: async (reg, connection, listing) => { seen.push([connection.profile, listing]);
      return { ...reg, tools: reg.tools.filter((t) => !t.name.startsWith('github_merge_queue_')) }; } });
    const names = [];
    let cursor;
    do {
      const { body } = await rpc(url, 'tools/list', cursor ? { cursor } : {});
      names.push(...body.result.tools.map((t) => t.name));
      cursor = body.result.nextCursor;
    } while (cursor);
    expect(names.some((n) => n.startsWith('github_merge_queue_'))).toBe(false);
    expect(names).toContain('github_pr_merge');
    expect(seen[0][1]).toBe('catalog');
    await new Promise((resolve) => server.close(resolve)); server = null;
    const broken = await start(builtRegistry, { offered: async () => { throw new Error('gate down'); } });
    const { status, body } = await rpc(broken, 'tools/list', {});
    expect(status).toBe(200);
    expect(body.result.tools.length).toBeGreaterThan(0);
  });

  it('follows standard nextCursor to retrieve every actual catalog tool over HTTP', async () => {
    const url = await start(builtRegistry);
    const names = [];
    let cursor;
    do {
      const { status, body } = await rpc(url, 'tools/list', cursor ? { cursor } : {});
      expect(status).toBe(200);
      expect(body.result.tools.length).toBeLessThanOrEqual(40);
      names.push(...body.result.tools.map(t => t.name));
      cursor = body.result.nextCursor;
    } while (cursor);
    const expected = builtRegistry.tools.filter(t => isToolVisible(t,'everyday')).map(t => t.name);
    expect(names).toEqual(expected);
    expect(new Set(names).size).toBe(names.length);
  });

  it('answers any tool call with an error while only the default deny dispatcher exists, even for a registered tool', async () => {
    let ran = false;
    const registry = mergeNamespaces([{ tools: [{ name: 'github_example', description: 'Example', inputSchema: { type: 'object' } }], handlers: { github_example: async () => { ran = true; return {}; } } }]);
    const url = await start(registry);
    const listed = await rpc(url, 'tools/list', {});
    expect(listed.body.result.tools.map((t) => t.name)).toEqual(['github_example']);
    const called = await rpc(url, 'tools/call', { name: 'github_example', arguments: {} });
    expect(called.body.result.isError).toBe(true);
    expect(called.body.result.content[0].text).toContain('Unknown or unavailable tool');
    expect(ran).toBe(false);
    expect((await denyAll({ name: 'x'.repeat(500) })).content[0].text.length).toBeLessThan(140);
  });

  it('hands a replaced dispatcher the name, arguments and the whole connection', async () => {
    const seen = [];
    const url = await start(mergeNamespaces([]), { dispatch: async (ctx) => { seen.push(ctx); return { content: [{ type: 'text', text: 'ok' }] }; } });
    const { body } = await rpc(url, 'tools/call', { name: 'github_x', arguments: { a: 1 } });
    expect(body.result.content[0].text).toBe('ok');
    expect(seen[0]).toMatchObject({ name: 'github_x', args: { a: 1 }, connection: { default_account: 'example-org', profile: 'everyday' } });
  });

  it('refuses a missing or unknown bearer before any MCP processing', async () => {
    const url = await start(mergeNamespaces([]));
    expect((await rpc(url, 'tools/list', {}, null)).status).toBe(401);
    expect((await rpc(url, 'tools/list', {}, 'x'.repeat(60))).status).toBe(401);
  });
});

describe('routes and home page', () => {
  it('answers 503 with no internal detail when the database fails or the origin is not configured', async () => {
    const failing = { getOAuthClient: async () => { throw new Error('password authentication failed for user "fixture-owner" at db.internal'); } };
    for (const [db, e, which] of [[failing, env, 'authorize'], [createFakeDb(), {}, 'metadata']]) {
      const res = await call((req, r) => handleOAuth(which, req, r, { db, env: e }), request('GET', { client_id: 'x' }));
      expect(res.statusCode).toBe(503);
      expect(res.headers['Cache-Control']).toBe('no-store');
      expect(res.body).not.toMatch(/password|fixture-owner|internal|PUBLIC_BASE_URL/);
      expect(json(res).error).toBe('temporarily_unavailable');
    }
  });

  it('routes each name to its handler', async () => {
    const db = createFakeDb();
    const meta = await call((req, r) => handleOAuth('metadata', req, r, { db, env }), request('GET', {}));
    expect(json(meta).issuer).toBe(env.PUBLIC_BASE_URL);
    const resource = await call((req, r) => handleOAuth('resourceMetadata', req, r, { db, env }), request('GET', {}));
    expect(json(resource).resource).toBe(env.PUBLIC_BASE_URL + '/api/mcp');
    const registered = await call((req, r) => handleOAuth('register', req, r, { db, env }), request('POST', { redirect_uris: ['https://client.example.test/cb'] }));
    expect(registered.statusCode).toBe(201);
  });

  it('serves a home page with the tool count and nothing secret', async () => {
    const res = await call(indexHandler, request('GET', {}));
    expect(res.statusCode).toBe(200);
    expect(json(res)).toMatchObject({ name: 'GitHub Unleashed by Robinson AI Systems', tools: builtRegistry.tools.length, endpoint: '/api/mcp', oauth: '/.well-known/oauth-authorization-server' });
    expect(res.headers['Cache-Control']).toBe('no-store');
  });
});
