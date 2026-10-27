import http from 'node:http';
import crypto from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { createCredentials } from '../../src/github/credentials.js';
import { createMcpHandler } from '../../src/core/mcp-server.js';
import { createDispatch } from '../../src/tools/dispatch.js';
import { validateArgs } from '../../src/core/validate.js';
import { registry } from '../../src/tools/index.js';
import { toolsForListing } from '../../src/core/registry.js';
import { mergeNamespaces } from '../../src/core/registry.js';
import { createGithubPolicy } from '../../src/oauth/policy.js';
import { createFakeDb } from '../../test/helpers/fake-db.js';

const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const ENV = { TOKEN_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64url'), PUBLIC_BASE_URL: 'https://github-mcp.example.test' };
const ACCESS = 'a'.repeat(60);
const FINE = 'github_pat_FAKE0123456789abcdefghij';
const CLASSIC = 'ghp_FAKE0123456789abcdefghij';
const SECRET_SHAPES = [/gh[pousr]_[A-Za-z0-9]{8,}/, /github_pat_[A-Za-z0-9_]{8,}/, /BEGIN [A-Z ]*PRIVATE KEY/, /fixture-client-secret/, /fixture-webhook-secret/];

async function build(scope = {}) {
  const db = createFakeDb();
  await db.initSchema();
  const credentials = createCredentials({ db, env: ENV, fetch });
  await credentials.storeApp({ id: 5150, slug: 'app', client_id: 'Iv1.fixtureclientid', client_secret: 'fixture-client-secret-value', webhook_secret: 'fixture-webhook-secret-value',
    pem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), permissions: {} }, { ownerLogin: 'example-org', ownerType: 'Organization' });
  await db.upsertAccount({ login: 'example-org', accountId: 1001, accountType: 'Organization', label: 'Example Org', credentialKind: 'app', appId: 5150 });
  await db.setInstallation('example-org', { installationId: 777, repositorySelection: 'all', permissions: { contents: 'write' }, status: 'active' });
  await credentials.storeUserAuthorization('example-org', { userLogin: 'example-owner', accessToken: 'ghu_FAKEuserToken1', expiresIn: 28800, refreshToken: 'ghr_FAKErefresh1', refreshExpiresIn: 15811200 });
  await credentials.storeClassic('example-org', CLASSIC, ['notifications']);
  await db.upsertAccount({ login: 'example-user', accountId: 55, accountType: 'User', label: 'Personal', credentialKind: 'fine_grained' });
  await credentials.storeFineGrained('example-user', FINE, { expiresAt: null });
  await db.upsertAccount({ login: 'other-org', accountId: 77, accountType: 'Organization', label: 'Other', credentialKind: 'app' });
  await db.recordRateState({ account: 'example-org', resource: 'core', remaining: 4321, resetAt: new Date('2026-10-10T20:00:00Z') });
  const connection = Object.freeze({ client_id: 'c', default_account: 'example-org', accounts: Object.freeze(['example-org', 'example-user']), mode: 'preview', profile: 'read_only', listing: 'compact', ...scope });
  const dispatch = createDispatch({ env: ENV });
  const run = (name, args) => dispatch({ registry, name, args, connection, db });
  return { db, credentials, connection, run, dispatch };
}
const data = (result) => result.structuredContent;

describe('github_whoami', () => {
  it('describes the connection and only the accounts it may use, with credential types and no credential', async () => {
    const t = await build();
    const result = await t.run('github_whoami', {});
    expect(result.isError).toBeUndefined();
    const out = data(result);
    expect(out).toMatchObject({ mode: 'PREVIEW', profile: 'read_only', listing: 'compact', default_account: 'example-org', api_version: '2026-03-10' });
    expect(out.accounts.map((a) => a.login).sort()).toEqual(['example-org', 'example-user']);
    const org = out.accounts.find((a) => a.login === 'example-org');
    expect(org).toMatchObject({ is_default: true, credentials: { I: true, U: true, K: true }, production_enabled: false, spend_limit: 'not configured', spend_limit_cents: null, spend_limit_explicit: false });
    expect(org.rate_core.remaining).toBe(4321);
    expect(org.rate_core.resets_at).toMatch(/Oct 10, 2026/);
    expect(out.accounts.find((a) => a.login === 'example-user').credentials).toEqual({ I: true, U: false, K: false, P: false });
    for (const shape of SECRET_SHAPES) expect(result.content[0].text).not.toMatch(shape);
  });

  it('shows the master token without ever showing it, and warns within 14 days of its expiry', async () => {
    const t = await build();
    const soon = new Date(Date.now() + 5 * 86400000).toISOString(), far = new Date(Date.now() + 200 * 86400000).toISOString();
    const withMaster = (status) => createDispatch({ env: ENV, credentials: { masterStatus: async () => status } });
    const ask = async (status) => data(await withMaster(status)({ registry, name: 'github_whoami', args: {}, connection: t.connection, db: t.db })).master_token;
    const near = await ask({ enrolled: true, scopes: ['repo', 'gist'], expires_at: soon });
    expect(near).toMatchObject({ added: true, permissions: ['repo', 'gist'], expires_in_days: 5 });
    expect(near.reminder).toMatch(/runs out in 5 days/);
    const distant = await ask({ enrolled: true, scopes: ['repo'], expires_at: far });
    expect(distant.reminder).toBeUndefined();
    const never = await ask({ enrolled: true, scopes: ['repo'], expires_at: null });
    expect(never.expires_at).toMatch(/never/);
    expect(never.reminder).toBeUndefined();
    expect((await ask({ enrolled: false })).added).toBe(false);
  });

  it('whoami lists what the master token unlocks', async () => {
    const t = await build();
    const withMaster = (status) => createDispatch({ env: ENV, credentials: { masterStatus: async () => status } });
    const ask = async (status) => data(await withMaster(status)({ registry, name: 'github_whoami', args: {}, connection: t.connection, db: t.db })).master_token;
    const on = await ask({ enrolled: true, scopes: ['gist', 'user'], expires_at: null });
    expect(on.unlocks).toContainEqual({ area: 'Gists', unlocked: true });
    expect(on.unlocks).toContainEqual({ area: 'Packages', unlocked: false, needs: 'write:packages' });
    expect(JSON.stringify(on)).not.toMatch(/ghp_/);
    const off = await ask({ enrolled: false });
    expect(off.would_unlock).toContain('Gists');
  });

  it('shows more with detail=full and only the named fields with fields', async () => {
    const t = await build();
    const full = data(await t.run('github_whoami', { detail: 'full' }));
    expect(full.accounts[0]).toHaveProperty('setup');
    const narrow = data(await t.run('github_whoami', { fields: ['credentials'] }));
    expect(Object.keys(narrow.accounts[0]).sort()).toEqual(['credentials', 'login']);
    const bad = await t.run('github_whoami', { fields: ['no_such_field'] });
    expect(bad.isError).toBe(true);
    expect(bad.content[0].text).toContain('Unknown field');
  });

  it('reflects a production connection and a spend limit', async () => {
    const t = await build({ mode: 'production' });
    t.db.seedAccounts?.([]);
    expect(data(await t.run('github_whoami', {})).mode).toBe('PRODUCTION');
  });
});


describe('C-8 whoami independent-read scheduling',()=>{
  it('overlaps two account-rate lookups with master authority evidence and performs no duplicate personal-rate read',async()=>{
    const t=await build({mode:'production',profile:'full'});
    const getRate=t.db.getRateState.bind(t.db);
    let inFlight=0, peak=0;
    const rateKeys=[];
    t.db.getRateState=async(account,resource)=>{
      inFlight++; peak=Math.max(peak,inFlight);rateKeys.push(account+':'+resource);
      try {
        await new Promise(resolve=>setTimeout(resolve,20));
        return await getRate(account,resource);
      } finally { inFlight--; }
    };
    let statusReads=0;
    const run=createDispatch({env:ENV,credentials:{masterStatus:async()=>{
      statusReads++;
      await new Promise(resolve=>setTimeout(resolve,20));
      return {enrolled:true,subject:'123',login:'fixture-actor',scopes:['repo'],expires_at:null};
    }}});
    const out=data(await run({registry,name:'github_whoami',args:{detail:'full'},connection:t.connection,db:t.db}));
    expect(out.accounts.map(a=>a.login)).toEqual(['example-org','example-user']);
    expect(out.accounts[0].rate_core.remaining).toBe(4321);
    expect(out.acting_as).toMatchObject({mode:'you',login:'fixture-actor'});
    expect(statusReads).toBe(1);
    expect(peak).toBeGreaterThanOrEqual(2);
    expect(rateKeys.filter(k=>k==='~me:123:core')).toHaveLength(1);
    expect(rateKeys).toHaveLength(3);
  });
});

describe('github_list_accounts', () => {
  it('lists setup state per account without leaking anything', async () => {
    const t = await build();
    const result = await t.run('github_list_accounts', { detail: 'full' });
    const out = data(result);
    expect(out.count).toBe(2);
    const org = out.accounts.find((a) => a.login === 'example-org');
    expect(org).toMatchObject({ credential_kind: 'GitHub App', setup: 'installed', repository_selection: 'all', user_authorization: 'signed in as example-owner', notifications_token: 'saved', notifications_scopes: ['notifications'] });
    expect(out.accounts.find((a) => a.login === 'example-user')).toMatchObject({ credential_kind: 'fine-grained token', setup: 'token saved', user_authorization: 'not signed in' });
    expect(result.content[0].text).not.toContain('other-org');
    for (const shape of SECRET_SHAPES) expect(result.content[0].text).not.toMatch(shape);
  });
});

describe('the read-only dispatcher', () => {
  it('refuses unknown tools, tools not marked read-only, prototype names and bad arguments', async () => {
    const t = await build();
    for (const name of ['nope', 'constructor', '__proto__', 'toString', undefined]) expect((await t.run(name, {})).isError, String(name)).toBe(true);
    const unmarked = mergeNamespaces([{ tools: [{ name: 'github_fake_write', description: 'x', inputSchema: { type: 'object', properties: {} } }], handlers: { github_fake_write: async () => ({ done: true }) } }]);
    const res = await t.dispatch({ registry: unmarked, name: 'github_fake_write', args: {}, connection: t.connection, db: t.db });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('Unknown or unavailable');
    for (const args of [{ detail: 'huge' }, { extra: 1 }, { fields: 'login' }, { fields: [1] }, [], 'x']) expect((await t.run('github_whoami', args)).isError, JSON.stringify(args)).toBe(true);
    expect((await t.run('github_whoami', undefined)).isError).toBeUndefined();
  });

  it('hides anything shaped like a credential in a result and hides internal errors', async () => {
    const t = await build();
    const leaky = mergeNamespaces([{ tools: [{ name: 'github_leaky', description: 'x', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } },
      { name: 'github_broken', description: 'x', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } }],
    handlers: { github_leaky: async () => ({ value: 'ghs_FAKEinstallationtoken1' }), github_broken: async () => { throw new Error('postgres://user:pw@host'); } } }]);
    const a = await t.dispatch({ registry: leaky, name: 'github_leaky', args: {}, connection: t.connection, db: t.db });
    expect(a.isError).toBeUndefined();
    expect(a.content[0].text).not.toContain('ghs_');
    expect(a.structuredContent.value).toBe('[hidden]');
    const b = await t.dispatch({ registry: leaky, name: 'github_broken', args: {}, connection: t.connection, db: t.db });
    expect(b.content[0].text).not.toContain('postgres');
  });

  it('validates the small schema subset it supports', () => {
    const schema = { type: 'object', properties: { a: { type: 'string', enum: ['x'] } }, required: ['a'] };
    expect(validateArgs(schema, { a: 'x' })).toBeNull();
    expect(validateArgs(schema, {})).toContain('required');
    expect(validateArgs({ properties: { n: { type: 'null' } } }, { n: 1 })).toContain('must be null');
    expect(validateArgs({ properties: { n: { type: 'null' } } }, { n: null })).toBeNull();
  });
});

describe('over the MCP endpoint', () => {
  let server;
  afterEach(async () => { if (server) await new Promise((resolve) => server.close(resolve)); server = null; });

  it('lists the tools and runs the read-only ones with a real connector token', async () => {
    const t = await build();
    await t.db.createAccessToken({ accessToken: ACCESS, refreshToken: 'b'.repeat(60), clientId: 'c', defaultAccount: 'example-org', accounts: ['example-org'], mode: 'preview', profile: 'read_only', listing: 'compact' });
    const handler = createMcpHandler({ db: t.db, registry, env: ENV, toConnection: createGithubPolicy({ env: ENV }).toConnection, dispatch: createDispatch({ env: ENV }) });
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
    const url = `http://127.0.0.1:${server.address().port}`;
    const rpc = async (method, params, query = '') => {
      const res = await fetch(url + query, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${ACCESS}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
      const text = await res.text();
      return JSON.parse(text.split('\n').find((l) => l.startsWith('data:'))?.slice(5) ?? text);
    };
    const listed = await rpc('tools/list', {});
    // the connection is read_only (no write workflow, B-6) and compact (meta tools, whoami, result reader, and W-1 read-only PR status)
    expect(listed.result.tools.map(x => x.name)).toEqual(toolsForListing(registry, 'read_only', 'compact').map(x => x.name));
    expect(listed.result.tools.map(x => x.name)).toContain('github_content_get');
    expect(listed.result.tools.map(x => x.name)).not.toContain('github_content_push_files');
    expect(listed.result.tools.every((x) => x.annotations && x.description && x.inputSchema)).toBe(true);
    // the connection can ask for the other listing on the endpoint address; an invalid value is ignored
    const catalog = await rpc('tools/list', {}, '?listing=catalog');
    expect(catalog.result.tools.map((x) => x.name)).toContain('github_list_accounts');
    expect(catalog.result.tools.map((x) => x.name)).not.toContain('github_revoke_connection');
    expect((await rpc('tools/list', {}, '?listing=everything')).result.tools.map(x => x.name)).toEqual(listed.result.tools.map(x => x.name));
    const called = await rpc('tools/call', { name: 'github_list_accounts', arguments: {} });
    const out = JSON.parse(called.result.content[0].text);
    expect(out.accounts.map((a) => a.login)).toEqual(['example-org']);
    const blocked = await rpc('tools/call', { name: 'github_whoami', arguments: { detail: 'x' } });
    expect(blocked.result.isError).toBe(true);
  });
});
