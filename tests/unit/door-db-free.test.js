// DOOR-DB-1: a keyless knock on a cold instance must answer without opening the database. The refusals below were
// captured from the code before this change (main a52b616a) and are pinned byte for byte: status, headers in the order
// they are set, and the exact body text. The database factory and the Neon driver are both instrumented, so "no
// database work" means: createDb() never ran, initSchema() never ran, neon() was never called and no SQL was sent.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import { createFakeDb } from '../../test/helpers/fake-db.js';

const probe = vi.hoisted(() => ({ createDb: 0, initSchema: 0, neon: 0, sql: 0, methods: [], db: null, gate: null }));

vi.mock('@neondatabase/serverless', async (load) => {
  const actual = await load();
  return { ...actual, neon: () => { probe.neon++; return () => { probe.sql++; return Promise.reject(new Error('no SQL in this test')); }; } };
});
vi.mock('../../src/db.js', async (load) => {
  const actual = await load();
  return {
    ...actual,
    createDb: () => {
      probe.createDb++;
      const db = probe.db;
      return new Proxy(db, {
        get(target, key) {
          const value = target[key];
          if (typeof value !== 'function') return value;
          return async (...args) => {
            probe.methods.push(String(key));
            if (key === 'initSchema') { probe.initSchema++; if (probe.gate) await probe.gate; }
            return value.apply(target, args);
          };
        }
      });
    }
  };
});

const ORIGIN = 'https://github-mcp.example.test';
const ACCESS = 'a'.repeat(60);
const SCOPE = { clientId: 'client-1', defaultAccount: 'example-org', accounts: ['example-org'], mode: 'preview', profile: 'everyday', listing: 'catalog' };
const saved = {};
const ENV = { PUBLIC_BASE_URL: ORIGIN, DATABASE_URL: 'postgres://fixture.invalid/db', GITHUB_PRIVATE_TENANT_PILOT: '', GITHUB_PUBLIC_CONNECT: '' };

/** The Vercel-shaped response double, recording every header in the order it was set. */
function response() {
  return {
    statusCode: 200, headers: [], body: null,
    setHeader(k, v) { this.headers.push([k, v]); return this; },
    status(s) { this.statusCode = s; return this; },
    send(v) { this.body = v; return this; },
    json(v) { this.body = JSON.stringify(v); return this; },
    end() { return this; }
  };
}
const request = (headers = {}, extra = {}) => ({ method: 'POST', url: '/api/mcp', headers, body: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }, query: {}, ...extra });

async function fresh() {
  vi.resetModules(); // a cold function instance: runtime.js's once-per-instance database promise starts empty
  return {
    mcp: await import('../../api/mcp.js'),
    resource: (await import('../../api/well-known/oauth-protected-resource.js')).default,
    metadata: (await import('../../api/well-known/oauth-authorization-server.js')).default,
    whoami: (await import('../../api/whoami.js')).default,
    tools: (await import('../../api/tools/index.js')).default
  };
}
const untouched = () => expect({ createDb: probe.createDb, initSchema: probe.initSchema, neon: probe.neon, sql: probe.sql, methods: probe.methods })
  .toEqual({ createDb: 0, initSchema: 0, neon: 0, sql: 0, methods: [] });

beforeEach(async () => {
  Object.assign(probe, { createDb: 0, initSchema: 0, neon: 0, sql: 0, methods: [], gate: null });
  probe.db = createFakeDb();
  await probe.db.createAccessToken({ accessToken: ACCESS, refreshToken: 'b'.repeat(60), ...SCOPE });
  for (const [k, v] of Object.entries(ENV)) { saved[k] = process.env[k]; process.env[k] = v; }
});
afterEach(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });

const MCP_CHALLENGE = {
  status: 401,
  headers: [
    ['WWW-Authenticate', `Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource"`],
    ['Cache-Control', 'no-store'],
    ['X-Content-Type-Options', 'nosniff'],
    ['Content-Type', 'application/json; charset=utf-8']
  ],
  body: '{"error":"unauthorized","error_description":"A valid connection is required"}'
};

describe('DOOR-DB-1: keyless knocks on /api/mcp issue zero SQL', () => {
  it('answers the sign-in challenge byte for byte on a cold instance without opening the database', async () => {
    const { mcp } = await fresh();
    for (const headers of [{}, { authorization: '' }, { authorization: 'Bearer short' }, { authorization: 'Basic ' + ACCESS }, { authorization: 'Bearer ' + ACCESS + ' extra' }]) {
      const res = response();
      await mcp.default(request(headers), res);
      expect({ status: res.statusCode, headers: res.headers, body: res.body }).toEqual(MCP_CHALLENGE);
    }
    const get = response();
    await mcp.default(request({}, { method: 'GET', body: undefined }), get);
    expect({ status: get.statusCode, headers: get.headers, body: get.body }).toEqual(MCP_CHALLENGE);
    untouched();
  });

  it('a misconfigured origin still answers the same 503 as before, without the database', async () => {
    process.env.PUBLIC_BASE_URL = 'http://not-https.example.test';
    const { mcp } = await fresh();
    const res = response();
    await mcp.default(request({}), res);
    expect({ status: res.statusCode, body: res.body }).toEqual({ status: 503,
      body: '{"error":"temporarily_unavailable","error_description":"GitHub Unleashed is not configured or its database is unavailable"}' });
    untouched();
  });

  it('the OAuth discovery documents answer unchanged without the database', async () => {
    const { resource, metadata } = await fresh();
    const r = response();
    await resource({ method: 'GET', headers: {}, query: {} }, r);
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body)).toMatchObject({ resource: `${ORIGIN}/api/mcp`, authorization_servers: [ORIGIN] });
    const m = response();
    await metadata({ method: 'GET', headers: {}, query: {} }, m);
    expect(m.statusCode).toBe(200);
    expect(JSON.parse(m.body)).toMatchObject({ issuer: ORIGIN, token_endpoint: `${ORIGIN}/api/oauth/token` });
    untouched();
  });

  it('keyless RTC knocks (whoami, tools) are refused byte for byte without the database', async () => {
    const { whoami, tools } = await fresh();
    const REFUSAL = { status: 401, headers: [['Cache-Control', 'no-store'], ['X-Content-Type-Options', 'nosniff']],
      body: '{"ok":false,"error":{"code":"permission","what":"Owner-issued RTC pass required.","cause":"permission","todo":"Check authorization and input.","technical":""}}' };
    for (const [door, headers] of [[whoami, {}], [tools, {}], [whoami, { authorization: 'Bearer rtc_pass_short' }], [tools, { authorization: 'Basic x' }]]) {
      const res = response();
      await door({ method: 'GET', headers, query: {} }, res);
      expect({ status: res.statusCode, headers: res.headers, body: res.body }).toEqual(REFUSAL);
    }
    untouched();
  });
});

describe('DOOR-DB-1: the first authenticated call still prepares and checks the store', () => {
  let server;
  afterEach(async () => { if (server) await new Promise((resolve) => server.close(resolve)); server = null; });
  async function start(handler) {
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
    return `http://127.0.0.1:${server.address().port}/api/mcp?listing=compact`;
  }
  const rpc = async (url, token, id = 1) => {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream',
      ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/list', params: {} }) });
    const text = await res.text();
    const data = text.split('\n').find((line) => line.startsWith('data:'));
    return { status: res.status, body: data ? JSON.parse(data.slice(5)) : (text ? JSON.parse(text) : null) };
  };

  it('a keyless knock first leaves the store closed; the first signed-in call then runs schema setup once and lists tools', async () => {
    const { mcp } = await fresh();
    const url = await start(mcp.default);
    expect((await rpc(url, null)).status).toBe(401);
    untouched();
    const signedIn = await rpc(url, ACCESS);
    expect(signedIn.status).toBe(200);
    expect(signedIn.body.result.tools.length).toBeGreaterThan(0);
    expect(probe.createDb).toBe(1);
    expect(probe.initSchema).toBe(1);
    expect(probe.methods[0]).toBe('initSchema');
    expect(probe.methods).toContain('getAccessToken');
    expect((await rpc(url, ACCESS, 2)).status).toBe(200);
    expect(probe.initSchema).toBe(1); // once per instance, as before
  });

  it('a well-formed but unknown or revoked bearer is still looked up in the store and refused', async () => {
    const { mcp } = await fresh();
    const url = await start(mcp.default);
    const unknown = await rpc(url, 'c'.repeat(60));
    expect(unknown).toEqual({ status: 401, body: { error: 'invalid_token' } });
    expect(probe.initSchema).toBe(1);
    expect(probe.methods).toContain('getAccessToken');
    expect((await rpc(url, ACCESS)).status).toBe(200);
    await probe.db.revokeAccessToken(ACCESS);
    expect(await rpc(url, ACCESS)).toEqual({ status: 401, body: { error: 'invalid_token' } });
  });

  it('concurrent first signed-in calls on a cold instance share one schema setup and all succeed', async () => {
    const { mcp } = await fresh();
    const url = await start(mcp.default);
    let open;
    probe.gate = new Promise((resolve) => { open = resolve; });
    const calls = Promise.all([1, 2, 3, 4, 5].map((id) => rpc(url, ACCESS, id)));
    await vi.waitFor(() => expect(probe.initSchema).toBe(1));
    open();
    const results = await calls;
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    expect(probe.createDb).toBe(1);
    expect(probe.initSchema).toBe(1);
  });

  it('a failed schema setup is not cached: the next signed-in call retries it', async () => {
    const { mcp } = await fresh();
    const url = await start(mcp.default);
    probe.gate = Promise.reject(new Error('store waking up'));
    probe.gate.catch(() => {});
    expect((await rpc(url, ACCESS)).status).toBe(503);
    probe.gate = null;
    expect((await rpc(url, ACCESS, 2)).status).toBe(200);
    expect(probe.initSchema).toBe(2);
  });
});
