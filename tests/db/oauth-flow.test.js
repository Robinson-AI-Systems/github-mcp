import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { createDb } from '../../src/db.js';
import { createOAuthHandlers } from '../../src/core/oauth-handlers.js';
import { createGithubPolicy } from '../../src/oauth/policy.js';
import { requireMcpToken } from '../../src/core/mcp-auth.js';
import { openIsolatedSchema, closeIsolatedSchema, neonShapedQuery, rawQuery } from '../../test/helpers/pg-neon-adapter.js';
import { call, json, request, response } from '../../test/helpers/http-harness.js';
import {createDispatch} from '../../src/tools/dispatch.js';
import {createGates} from '../../src/tools/gates.js';
import {mergeNamespaces} from '../../src/core/registry.js';
import * as server from '../../src/tools/server.js';
import * as meta from '../../src/tools/meta.js';

const env = { PUBLIC_BASE_URL: 'https://github-mcp.example.test', ADMIN_PASSPHRASE: 'only-the-owner-knows', VERCEL_ENV: 'production' };
const resource = env.PUBLIC_BASE_URL + '/api/mcp';
const callback = 'https://client.example.test/cb';
const verifier = 'a'.repeat(43);
const challenge = createHash('sha256').update(verifier).digest('base64url');

let db;
let h;
beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL must point to disposable localhost Postgres (npm run test:db)');
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(process.env.TEST_DATABASE_URL).hostname)) throw new Error('Refusing non-local Postgres in tests');
  await openIsolatedSchema(process.env.TEST_DATABASE_URL);
  db = createDb(neonShapedQuery());
  await db.initSchema();
  await rawQuery(`INSERT INTO gh_accounts (login, account_id, account_type, label, production_enabled, is_default) VALUES
    ('example-org', 1, 'Organization', 'Example Org', FALSE, TRUE), ('example-user', 2, 'User', 'Example User', TRUE, FALSE)`);
  h = createOAuthHandlers({ db, env, policy: createGithubPolicy({ env }) });
});
afterAll(async () => { await closeIsolatedSchema(); });

describe('connector login end to end on throwaway Postgres', () => {
  it('registers, signs in, exchanges the code, refreshes, and the MCP gate sees every setting each time', async () => {
    const client = json(await call(h.register, request('POST', { redirect_uris: [callback], client_name: 'Personal agent' })));
    const form = {
      client_id: client.client_id, redirect_uri: callback, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', resource, state: 's',
      'acct:example-org': 'on', 'acct:example-user': 'on', default_account: 'example-user', mode: 'preview', profile: 'read_only', listing: 'compact'
    };
    const page = await call(h.authorize, request('GET', form));
    expect(page.body).toContain('Example Org');

    const production = await call(h.authorize, request('POST', { ...form, mode: 'production', passphrase: env.ADMIN_PASSPHRASE }));
    // owner decision 2026-10-27: production sign-in is allowed on the production deployment without a per-account switch
    expect(production.statusCode).toBe(302);
    await rawQuery('DELETE FROM oauth_codes');
    expect(Number((await rawQuery('SELECT count(*) FROM oauth_codes'))[0].count)).toBe(0);

    const authorized = await call(h.authorize, request('POST', { ...form, passphrase: env.ADMIN_PASSPHRASE }));
    expect(authorized.statusCode).toBe(302);
    const code = new URL(authorized.headers.Location).searchParams.get('code');
    const exchange = { grant_type: 'authorization_code', client_id: client.client_id, client_secret: client.client_secret, redirect_uri: callback, code, code_verifier: verifier, resource };
    const first = json(await call(h.token, request('POST', exchange)));
    expect((await call(h.token, request('POST', exchange))).statusCode).toBe(400);

    const toConnection = createGithubPolicy({ env }).toConnection;
    const expected = { client_id: client.client_id, default_account: 'example-user', accounts: ['example-org', 'example-user'], mode: 'preview', profile: 'read_only', listing: 'compact' };
    const gate = (token) => requireMcpToken(request('POST', {}, { authorization: `Bearer ${token}` }), response(), db, env, { toConnection });
    expect(await gate(first.access_token)).toEqual(expected);

    const refresh = (token) => call(h.token, request('POST', { grant_type: 'refresh_token', client_id: client.client_id, client_secret: client.client_secret, refresh_token: token, resource }));
    const second = json(await refresh(first.refresh_token));
    expect(await gate(second.access_token)).toEqual(expected);
    expect(await gate(first.access_token)).toBeNull();
    // PUB-5 C: a used refresh token shown again is refused AND ends the whole sign-in (real database)
    expect((await refresh(first.refresh_token)).statusCode).toBe(400);
    expect(await gate(second.access_token)).toEqual(expected); // two refreshes racing inside a minute: refused, sign-in lives
    await rawQuery("UPDATE oauth_tokens SET rotated_at = now() - interval '5 minutes'");
    expect((await refresh(first.refresh_token)).statusCode).toBe(400);
    expect(await gate(second.access_token)).toBeNull();
    expect((await refresh(second.refresh_token)).statusCode).toBe(400);
  });

  it('requires explicit renewed owner consent for Full while older Everyday and refresh credentials stay narrow',async()=>{
    const client=json(await call(h.register,request('POST',{
      redirect_uris:[callback],client_name:'Full reauthorization fixture'
    })));
    const common={
      client_id:client.client_id,redirect_uri:callback,response_type:'code',
      code_challenge:challenge,code_challenge_method:'S256',resource,
      'acct:example-org':'on',default_account:'example-org',mode:'preview',
      listing:'compact',passphrase:env.ADMIN_PASSPHRASE
    };
    const issue=async profile=>{
      const consent=await call(h.authorize,request('POST',{...common,profile}));
      expect(consent.statusCode).toBe(302);
      const code=new URL(consent.headers.Location).searchParams.get('code');
      return json(await call(h.token,request('POST',{
        grant_type:'authorization_code',client_id:client.client_id,
        client_secret:client.client_secret,redirect_uri:callback,
        code,code_verifier:verifier,resource
      })));
    };
    const gate=async token=>requireMcpToken(
      request('POST',{}, {authorization:`Bearer ${token}`}),
      response(),db,env,{toConnection:createGithubPolicy({env}).toConnection}
    );
    const everyday=await issue('everyday');
    expect(await gate(everyday.access_token)).toMatchObject({
      profile:'everyday',mode:'preview',accounts:['example-org']
    });
    const full=await issue('full');
    expect(await gate(full.access_token)).toMatchObject({
      profile:'full',mode:'preview',accounts:['example-org']
    });
    // A second explicit grant never upgrades or revokes the existing client's
    // unrelated grant; both refresh families retain their original profiles.
    expect(await gate(everyday.access_token)).toMatchObject({
      profile:'everyday',mode:'preview',default_account:'example-org'
    });
    const renew=async token=>json(await call(h.token,request('POST',{
      grant_type:'refresh_token',client_id:client.client_id,
      client_secret:client.client_secret,refresh_token:token,resource
    })));
    const oldRotated=await renew(everyday.refresh_token);
    const fullRotated=await renew(full.refresh_token);
    expect(await gate(oldRotated.access_token)).toMatchObject({
      profile:'everyday',mode:'preview',accounts:['example-org']
    });
    expect(await gate(fullRotated.access_token)).toMatchObject({
      profile:'full',mode:'preview',accounts:['example-org']
    });
    expect(await gate(everyday.access_token)).toBeNull();
    expect(await gate(full.access_token)).toBeNull();
    expect((await rawQuery(`SELECT production_enabled FROM gh_accounts WHERE login = 'example-org'`))[0].production_enabled).toBe(false);
  });

  it('executes an authorized Full-only native MCP operation through direct and meta dispatch while Everyday remains refused',async()=>{
    const client=json(await call(h.register,request('POST',{redirect_uris:[callback]})));
    const params={client_id:client.client_id,redirect_uri:callback,
      response_type:'code',code_challenge:challenge,code_challenge_method:'S256',
      resource,'acct:example-org':'on','acct:example-user':'on',
      default_account:'example-org',mode:'preview',listing:'catalog',
      passphrase:env.ADMIN_PASSPHRASE};
    const issue=async profile=>{
      const authorized=await call(h.authorize,request('POST',{...params,profile}));
      expect(authorized.statusCode).toBe(302);
      const code=new URL(authorized.headers.Location).searchParams.get('code');
      const token=json(await call(h.token,request('POST',{
        grant_type:'authorization_code',client_id:client.client_id,
        client_secret:client.client_secret,redirect_uri:callback,
        code,code_verifier:verifier,resource})));
      return requireMcpToken(request('POST',{},{
        authorization:`Bearer ${token.access_token}`}),response(),db,env,{
        toConnection:createGithubPolicy({env}).toConnection});
    };
    const everyday=await issue('everyday'),full=await issue('full');
    const registry=mergeNamespaces([meta,server]);
    const dispatch=createDispatch({env,gates:createGates()});
    const args={account:'example-user',confirm:true};
    const forbidden=await dispatch({registry,name:'github_set_default_account',
      args,connection:everyday,db});
    expect(forbidden.isError).toBe(true);
    expect(forbidden.content[0].text).toContain('Unknown or unavailable tool');
    expect((await db.listConnections()).filter(x=>x.client_id===client.client_id)
      .every(x=>x.default_account==='example-org')).toBe(true);
    const allowed=await dispatch({registry,name:'github_set_default_account',
      args,connection:full,db});
    expect(allowed.structuredContent).toMatchObject({
      done:true,status:'applied',confirmed:true,result:{default_account:'example-user'}});
    const viaMeta=await dispatch({registry,name:'github_call',
      args:{name:'github_set_default_account',args:{account:'example-org',confirm:true}},
      connection:full,db});
    expect(viaMeta.structuredContent).toMatchObject({
      done:true,status:'applied',confirmed:true,result:{default_account:'example-org'}});
    const stillRestricted=await dispatch({registry,name:'github_call',
      args:{name:'github_set_default_account',args},
      connection:everyday,db});
    expect(stillRestricted.isError).toBe(true);
    expect((await db.listConnections()).filter(x=>x.client_id===client.client_id)
      .every(x=>x.profile==='full'||x.profile==='everyday')).toBe(true);
    expect((await db.listConnections()).filter(x=>x.client_id===client.client_id)
      .map(x=>x.default_account)).toEqual(['example-org','example-org']);
  });

  it('grants production to the one account that has it turned on, and the MCP gate then accepts it on the production deployment', async () => {
    const client = json(await call(h.register, request('POST', { redirect_uris: [callback] })));
    const form = {
      client_id: client.client_id, redirect_uri: callback, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', resource,
      'acct:example-user': 'on', default_account: 'example-user', mode: 'production', profile: 'full', listing: 'catalog', passphrase: env.ADMIN_PASSPHRASE
    };
    const authorized = await call(h.authorize, request('POST', form));
    expect(authorized.statusCode).toBe(302);
    const code = new URL(authorized.headers.Location).searchParams.get('code');
    const tokens = json(await call(h.token, request('POST', { grant_type: 'authorization_code', client_id: client.client_id, client_secret: client.client_secret, redirect_uri: callback, code, code_verifier: verifier, resource })));
    const connection = await requireMcpToken(request('POST', {}, { authorization: `Bearer ${tokens.access_token}` }), response(), db, env, { toConnection: createGithubPolicy({ env }).toConnection });
    expect(connection).toMatchObject({ mode: 'production', accounts: ['example-user'], profile: 'full', listing: 'catalog' });
    const preview = { ...env, VERCEL_ENV: 'preview' };
    const refused = response();
    expect(await requireMcpToken(request('POST', {}, { authorization: `Bearer ${tokens.access_token}` }), refused, db, preview, { toConnection: createGithubPolicy({ env: preview }).toConnection })).toBeNull();
    expect(refused.statusCode).toBe(403);
  });
});
