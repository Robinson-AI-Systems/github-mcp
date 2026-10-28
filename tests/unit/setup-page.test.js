import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createCredentials } from '../../src/github/credentials.js';
import { createSetupHandlers } from '../../src/github/setup-page.js';
import { createOneTimeStore } from '../../src/core/one-time-secrets.js';
import { readEncryptionKey } from '../../src/core/crypto.js';
import { missingPermissions } from '../../src/github/setup-readback.js';
import { MANIFEST_PERMISSIONS } from '../../src/github/app-manifest.js';
import { renderSetup, resultPage } from '../../src/github/setup-html.js';
import { createFakeDb } from '../../test/helpers/fake-db.js';
import { makeFakeGitHub } from '../../test/helpers/fake-github.js';
import { call, request } from '../../test/helpers/http-harness.js';

// Every key is generated at run time; token-looking values are obvious fakes.
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const ORIGIN = 'https://github-mcp.example.test';
const PASS = 'fixture-admin-passphrase';
const KEY = crypto.randomBytes(32).toString('base64url');
const PROD = { VERCEL_ENV: 'production', PUBLIC_BASE_URL: ORIGIN, ADMIN_PASSPHRASE: PASS, TOKEN_ENCRYPTION_KEY: KEY };
const CONVERSION = { id: 5150, slug: 'robinson-mcp-example-org', client_id: 'Iv1.fixtureclientid', client_secret: 'fixture-client-secret-value', pem: PEM,
  webhook_secret: 'fixture-webhook-secret-value', owner: { login: 'example-org', id: 1001, type: 'Organization' }, permissions: { contents: 'write' } };
const SECRET_SHAPES = [/ghp_[A-Za-z0-9]{6,}/, /github_pat_[A-Za-z0-9_]{6,}/, /ghs_[A-Za-z0-9]{6,}/, /BEGIN [A-Z ]*PRIVATE KEY/, /fixture-client-secret-value/, /fixture-webhook-secret-value/];

async function build({ env = PROD } = {}) {
  const db = createFakeDb();
  await db.initSchema();
  const gh = makeFakeGitHub();
  const oauth = { calls: [], reply: { status: 200, body: { access_token: 'ghu_FAKEuserTokenValue1', expires_in: 28800, refresh_token: 'ghr_FAKErefreshValue1', refresh_token_expires_in: 15811200 } } };
  const fetch = async (url, init) => {
    if (String(url).startsWith('https://github.com/login/oauth/access_token')) {
      oauth.calls.push(Object.fromEntries(new URLSearchParams(String(init.body))));
      return new Response(JSON.stringify(oauth.reply.body), { status: oauth.reply.status, headers: { 'content-type': 'application/json' } });
    }
    return gh.fetch(url, init);
  };
  const credentials = createCredentials({ db, env, fetch });
  const oneTimeStore = env.TOKEN_ENCRYPTION_KEY ? createOneTimeStore({ db, service: 'github', setupPath: '/api/github/setup', encryptionKey: readEncryptionKey(env) }) : undefined;
  const handlers = createSetupHandlers({ db, credentials, oneTimeStore, env, fetch });
  const page = { cookie: null, csrf: null };
  const open = async () => {
    const res = await call(handlers.setup, request('GET', {}));
    page.cookie = /github_setup_csrf=([A-Za-z0-9_-]{43})/.exec(res.headers['Set-Cookie'])?.[1];
    page.csrf = page.cookie;
    return res;
  };
  const post = (fields, { origin = ORIGIN, csrf = page.csrf, cookie = page.cookie, ip } = {}) => call(handlers.setup, {
    ...request('POST', { csrf, passphrase: PASS, ...fields }, { origin, cookie: cookie ? `github_setup_csrf=${cookie}` : '' }),
    ...(ip ? { socket: { remoteAddress: ip } } : {})
  });
  return { db, gh, credentials, oneTimeStore, handlers, oauth, fetch, open, post, page };
}
const all = (res) => `${res.body}${JSON.stringify(res.headers)}`;
const noSecrets = (res) => { for (const shape of SECRET_SHAPES) expect(all(res)).not.toMatch(shape); };
const stateIn = (html) => /state=([A-Za-z0-9_-]{43})/.exec(html.replaceAll('&amp;', '&'))[1];

describe('the setup page', () => {
  it('shows the page with a fresh single-purpose cookie and a locked-down policy', async () => {
    const t = await build();
    const res = await t.open();
    expect(res.statusCode).toBe(200);
    expect(res.headers['Set-Cookie']).toMatch(/HttpOnly; Secure; SameSite=Strict/);
    expect(res.headers['Content-Security-Policy']).toContain("default-src 'none'");
    expect(res.headers['Content-Security-Policy']).toContain("form-action 'self' https://github.com");
    expect(res.body).toContain('Robinson GitHub MCP');
    expect(res.body).not.toMatch(/<script/i);
    expect(t.page.csrf).toHaveLength(43);
  });

  it('keeps private tenant fair-use configuration behind verified owner confirmation',async()=>{
    const t=await build();const page=await t.open();
    expect(page.body).toContain('Save private fair-use limits');
    const form={action:'set-private-tenant-capacity',login:'example-org',
      confirmLogin:'example-org',confirmPilot:'yes',
      clientRate:'120',tenantRate:'600'};
    expect((await t.post(form,{origin:'https://untrusted.invalid'})).statusCode).toBe(403);
    expect((await t.post(form,{csrf:'tampered'})).statusCode).toBe(403);
    expect((await t.post({...form,passphrase:'wrong'})).statusCode).toBe(401);
    expect((await t.post({...form,confirmPilot:'no'})).statusCode).toBe(400);
    expect((await t.post({...form,confirmLogin:'different'})).statusCode).toBe(400);
    expect((await t.post({...form,clientRate:'601'})).statusCode).toBe(400);
    expect((await t.post({...form,clientRate:'200',tenantRate:'100'})).statusCode).toBe(400);
    const closed=await t.post(form);
    expect(closed.statusCode).toBe(409);
    expect(closed.body).toContain('Private tenant configuration is disabled');
    noSecrets(closed);
    const preview=await build({env:{...PROD,VERCEL_ENV:'preview'}});
    await preview.open();
    expect((await preview.post(form)).statusCode).toBe(403);
  });

  it('keeps private tenant bootstrap behind production, explicit confirmation, owner passphrase and CSRF', async () => {
    const t=await build();const page=await t.open();
    expect(page.body).toContain('Prepare my private GitHub pilot tenant');
    expect(page.body).toContain('Issue private MCP client');
    expect(page.body).toContain('Revoke private pilot access');
    const action={action:'bootstrap-private-pilot',login:'example-org',
      confirmLogin:'example-org',confirmPilot:'yes'};
    expect((await t.post(action,{origin:'https://outside.invalid'})).statusCode).toBe(403);
    expect((await t.post(action,{csrf:'wrong'})).statusCode).toBe(403);
    expect((await t.post({...action,passphrase:'wrong'})).statusCode).toBe(401);
    expect((await t.post({...action,confirmPilot:'no'})).statusCode).toBe(400);
    expect((await t.post({...action,confirmLogin:'different'})).statusCode).toBe(400);
    const issue={action:'register-private-pilot-client',login:'example-org',
      confirmLogin:'example-org',confirmPilot:'yes',
      redirectUri:'https://client.example.test/callback'};
    expect((await t.post({...issue,confirmPilot:'no'})).statusCode).toBe(400);
    expect((await t.post({...issue,redirectUri:'http://unsafe.example/cb'})).statusCode).toBe(400);
    expect((await t.post(issue)).statusCode).toBe(409);
    const revoke={action:'revoke-private-pilot',login:'example-org',
      confirmLogin:'example-org',confirmPilot:'revoke'};
    expect((await t.post({...revoke,confirmPilot:'no'})).statusCode).toBe(400);
    expect((await t.post({...revoke,confirmLogin:'other'})).statusCode).toBe(400);
    expect((await t.post(revoke)).statusCode).toBe(404);
    const closed=await t.post(action);
    expect(closed.statusCode).toBe(409);
    expect(closed.body).toContain('could not be safely initialized');
    noSecrets(closed);
    const preview=await build({env:{...PROD,VERCEL_ENV:'preview'}});
    await preview.open();
    expect((await preview.post(action)).statusCode).toBe(403);
  });

  it('refuses a wrong method, an unset PUBLIC_BASE_URL and an unset passphrase without leaking anything', async () => {
    const t = await build();
    expect((await call(t.handlers.setup, request('DELETE', {}))).statusCode).toBe(405);
    const noOrigin = await build({ env: { ...PROD, PUBLIC_BASE_URL: '' } });
    expect((await call(noOrigin.handlers.setup, request('GET', {}))).statusCode).toBe(503);
    const noPass = await build({ env: { ...PROD, ADMIN_PASSPHRASE: '' } });
    await noPass.open();
    expect((await noPass.post({ action: 'status' })).statusCode).toBe(503);
  });

  it('refuses a post from another site, with no cookie, with a mismatched token, or with a wrong or empty passphrase', async () => {
    const t = await build();
    await t.open();
    expect((await t.post({ action: 'status' }, { origin: 'https://evil.example' })).statusCode).toBe(403);
    expect((await t.post({ action: 'status' }, { origin: '' })).statusCode).toBe(403);
    expect((await t.post({ action: 'status' }, { cookie: '' })).statusCode).toBe(403);
    expect((await t.post({ action: 'status' }, { csrf: 'x'.repeat(43) })).statusCode).toBe(403);
    expect((await t.post({ action: 'status', passphrase: 'nope' })).statusCode).toBe(401);
    expect((await t.post({ action: 'status', passphrase: '' })).statusCode).toBe(401);
    expect((await t.post({ action: 'status', passphrase: undefined })).statusCode).toBe(401);
    expect((await t.post({ action: 'status' })).statusCode).toBe(200);
  });

  it('locks an address out after five wrong passphrases, even for the right one', async () => {
    const t = await build();
    await t.open();
    for (let i = 0; i < 5; i += 1) expect((await t.post({ action: 'status', passphrase: `wrong-${i}` })).statusCode).toBe(401);
    const locked = await t.post({ action: 'status' });
    expect(locked.statusCode).toBe(429);
    expect(locked.headers['Retry-After']).toBeDefined();
    expect((await t.post({ action: 'status' }, { ip: '198.51.100.99' })).statusCode).toBe(200);
  });

  it('refuses every credential step off the production deployment, but still shows status', async () => {
    const t = await build({ env: { ...PROD, VERCEL_ENV: 'preview' } });
    await t.open();
    for (const action of ['start-app', 'start-user-auth', 'add-fine-grained', 'add-classic', 'add-package', 'remove-package', 'remove-classic', 'remove-fine-grained', 'reveal']) {
      const res = await t.post({ action, login: 'example-org', token: 'ghp_FAKE'.padEnd(40, 'x') });
      expect(res.statusCode, action).toBe(403);
      expect(res.body).toContain('production deployment');
    }
    expect((await t.post({ action: 'status' })).statusCode).toBe(200);
    expect(await t.db.listAccounts()).toEqual([]);
  });

  it('binds only an observed exact protected package metadata read, never package writes',async()=>{
    const t=await build();await t.open();
    await t.db.upsertAccount({login:'fixture-org',accountId:901,
      accountType:'Organization',label:'Fixture'});
    await t.credentials.storeUserAuthorization('fixture-org',{userLogin:'fixture-user',
      accessToken:'fixture-user-access-token-for-test'});
    t.gh.when('GET /rate_limit').reply(200,{}, {'x-oauth-scopes':'read:packages'});
    t.gh.when('GET /user').reply(200,{id:4001,login:'fixture-user',type:'User'});
    t.gh.when('GET /orgs/{org}/packages').reply(200,[]);
    const token='fixture-package-token-for-readback-012345';
    const res=await t.post({action:'add-package',login:'fixture-org',token});
    expect(res.statusCode).toBe(200);
    const proof=(await t.db.additionalCredentialProofs('fixture-org')).P;
    expect(proof).toMatchObject({actorId:4001,accountId:901,
      verification:'identity-and-capability-readback',
      operation:'GET /orgs/{org}/packages',resource:'org/901',
      scopes:['read:packages']});
    expect(JSON.stringify(proof)).not.toContain(token);
    t.gh.when('GET /orgs/{org}/packages').reply(403,{message:'Organization policy denied'});
    const another=await t.post({action:'add-package',login:'fixture-org',
      token:token+'replacement'});
    expect(another.statusCode).toBe(200);
    expect((await t.db.additionalCredentialProofs('fixture-org')).P.verification)
      .toBe('identity-only');
  });
  it('proves only the one classic notification read when GitHub accepts the exact token',async()=>{
    const t=await build();await withApp(t);
    await t.credentials.storeUserAuthorization('example-org',{
      userLogin:'fixture-human',accessToken:'fixture-user-access-token-012345'
    });
    t.gh.when('GET /rate_limit').reply(200,{}, {'x-oauth-scopes':'notifications'});
    t.gh.when('GET /user').reply(200,{id:5001,login:'fixture-human',type:'User'});
    t.gh.when('GET /notifications').reply(200,[]);
    const value='fixture-classic-notifications-token-012345';
    expect((await t.post({action:'add-classic',login:'example-org',token:value})).statusCode).toBe(200);
    const proof=(await t.db.additionalCredentialProofs('example-org')).K;
    expect(proof).toMatchObject({actorId:5001,accountId:1001,
      verification:'identity-and-capability-readback',
      operation:'GET /notifications',resource:'user/5001',scopes:['notifications']});
    expect(JSON.stringify(proof)).not.toContain(value);
    expect((await t.post({action:'remove-classic',login:'example-org'})).statusCode).toBe(200);
    expect(await t.db.additionalCredentialProofs('example-org')).toEqual({});
  });
  it('uses existing protected form controls for K/F removal without clearing sibling kinds',async()=>{
    const t=await build();
    const res=await t.open();
    expect(res.body).toContain('Remove stored notifications token');
    expect(res.body).toContain('Remove stored fine-grained token');
    await t.db.upsertAccount({login:'fixture-user',accountId:7001,
      accountType:'User',label:'Fixture',credentialKind:'fine_grained'});
    await t.db.setClassicToken('fixture-user',{enc:'sealed-classic-value',scopes:['notifications'],last4:'last'});
    await t.db.setFineGrainedToken('fixture-user',{enc:'sealed-fg-value',last4:'last'});
    const k={action:'remove-classic',login:'fixture-user'};
    expect((await t.post(k,{origin:'https://evil.invalid'})).statusCode).toBe(403);
    expect((await t.post(k,{csrf:'invalid'})).statusCode).toBe(403);
    expect((await t.post({...k,passphrase:'wrong'})).statusCode).toBe(401);
    expect((await t.post(k)).statusCode).toBe(200);
    expect((await t.db.getAccount('fixture-user')).classic_enc).toBeNull();
    expect((await t.db.getAccount('fixture-user')).fine_grained_enc).toBe('sealed-fg-value');
    expect((await t.post(k)).statusCode).toBe(404);
    const f={action:'remove-fine-grained',login:'fixture-user'};
    expect((await t.post(f)).statusCode).toBe(200);
    expect((await t.db.getAccount('fixture-user')).fine_grained_enc).toBeNull();
    noSecrets(await t.post(f));
  });
  it('says plainly when the encryption key is missing and stores nothing', async () => {
    const t = await build({ env: { ...PROD, TOKEN_ENCRYPTION_KEY: '' } });
    await t.open();
    const res = await t.post({ action: 'start-app', login: 'example-org', accountType: 'Organization' });
    expect(res.statusCode).toBe(503);
    expect(res.body).toContain('TOKEN_ENCRYPTION_KEY');
  });

  it('rejects an unknown action and an invalid account name', async () => {
    const t = await build();
    await t.open();
    expect((await t.post({ action: 'delete-everything', login: 'example-org' })).statusCode).toBe(400);
    for (const login of ['', '-bad', 'bad-', 'has space', 'a'.repeat(40), '../etc', 'a/b', '<script>']) {
      expect((await t.post({ action: 'start-app', login })).statusCode, login).toBe(400);
    }
  });
});

describe('owner protected connection mode upgrade', () => {
  const seed = async (t) => {
    await t.db.upsertAccount({ login: 'example-org', accountId: 55577, accountType: 'Organization', label: 'Example org', credentialKind: 'app', appId: 5150, isScratch: true });
    await t.db.setInstallation('example-org', { installationId: 5151, repositorySelection: 'all', permissions: { contents: 'write' }, status: 'active' });
    await t.db.createOAuthClient({ clientId: 'chatgpt-test-client', clientSecret: 'fixture-secret-value',
      clientName: 'Robinson GitHub Cloud', redirectUris: ['https://example.test/callback'] });
    await t.db.createAccessToken({ clientId: 'chatgpt-test-client', accessToken: 'fixture-mode-access',
      refreshToken: 'fixture-mode-refresh', defaultAccount: 'example-org', accounts: ['example-org'],
      mode: 'preview', profile: 'full', listing: 'compact' });
  };
  it('requires owner passphrase, CSRF and exact client without a legacy account activation gate, then reads back and audits upgrade', async () => {
    const t = await build();
    await seed(t); await t.open();
    const ask = { action: 'upgrade-connection-production', login: 'example-org', connection: 'chatgpt-test-client' };
    expect((await t.post(ask, { csrf: 'wrong' })).statusCode).toBe(403);
    expect((await t.post({ ...ask, passphrase: 'wrong' })).statusCode).toBe(401);
    expect((await t.db.getAccessToken('fixture-mode-access')).mode).toBe('preview');
    const page = await t.post({ action: 'status' });
    expect(page.body).toContain('chatgpt-test-client');
    expect(page.body).toContain('PREVIEW');
    expect((await t.post({ ...ask, connection: 'unknown-client' })).statusCode).toBe(403);
    const result = await t.post(ask);
    expect(result.statusCode).toBe(200);
    expect(result.body).toContain('now PRODUCTION');
    expect((await t.db.getAccessToken('fixture-mode-access')).mode).toBe('production');
    expect((await t.post(ask)).statusCode).toBe(403);
    expect((await t.db.listChanges({ tool: 'setup_upgrade_connection_production' }))[0]).toMatchObject({ accessWidening: true, confirmed: true });
    noSecrets(result);
  });
  it('refuses in preview environments; anonymous GET reveals no client identifiers', async () => {
    const t = await build({ env: { ...PROD, VERCEL_ENV: 'preview' } });
    await seed(t); await t.db.setProductionEnabled('example-org', true);
    expect((await t.open()).body).not.toContain('chatgpt-test-client');
    const res = await t.post({ action: 'upgrade-connection-production', login: 'example-org', connection: 'chatgpt-test-client' });
    expect(res.statusCode).toBe(403);
    expect((await t.db.getAccessToken('fixture-mode-access')).mode).toBe('preview');
  });
});

describe('protected connector OAuth readiness on owner setup',()=>{
  it('keeps registration counts hidden from GET and only reveals aggregates after passphrase',async()=>{
    const t=await build();
    const get=await t.open();
    expect(get.body).not.toContain('Registered clients:');
    const denied=await t.post({action:'status'},{origin:'https://not-owner.example.test'});
    expect(denied.statusCode).toBe(403);
    expect(denied.body).not.toContain('Registered clients:');
    const status=await t.post({action:'status'});
    expect(status.statusCode).toBe(200);
    expect(status.body).toContain('Custom MCP OAuth connection status');
    expect(status.body).toContain('Registered clients: 0');
    expect(status.body).toContain('No custom MCP client registered yet');
    expect(status.body).toContain('https://github-mcp.example.test/api/mcp');
    noSecrets(status);
  });
  it('distinguishes registered but unauthorized clients from authorized connector sessions',async()=>{
    const t=await build();await t.open();
    await t.db.createOAuthClient({clientId:'private-client-id',
      clientSecret:'private-client-secret',redirectUris:['https://client.example.test/cb']});
    const waiting=await t.post({action:'status'});
    expect(waiting.body).toContain('Client registered; authorization not completed');
    expect(waiting.body).not.toContain('private-client-id');
    expect(waiting.body).not.toContain('private-client-secret');
    await t.db.createAccessToken({accessToken:'private-connector-access',refreshToken:'private-refresh',
      clientId:'private-client-id',defaultAccount:'example-org',accounts:['example-org']});
    const active=await t.post({action:'status'});
    expect(active.body).toContain('A connector token record is present');
    expect(active.body).not.toContain('private-connector-access');
    expect(active.body).not.toContain('private-refresh');
    // Only the authenticated owner-status response lists enrolled client IDs.
    expect(active.body).toContain('private-client-id');
    noSecrets(active);
    await t.db.revokeAccessToken('private-connector-access');
    const revoked=await t.post({action:'status'});
    expect(revoked.body).toContain('Client registered; authorization not completed');
  });
});
describe('creating the GitHub App', () => {
  async function start(t, login = 'example-org', accountType = 'Organization') {
    await t.open();
    const res = await t.post({ action: 'start-app', login, accountType });
    expect(res.statusCode).toBe(200);
    return res;
  }

  it('prepares a private manifest for the right account type, with a single-use state', async () => {
    const t = await build();
    const org = await start(t);
    expect(org.body).toContain('https://github.com/organizations/example-org/settings/apps/new');
    const manifest = JSON.parse(/name="manifest" value="([^"]*)"/.exec(org.body)[1].replaceAll('&quot;', '"').replaceAll('&amp;', '&').replaceAll('&#39;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>'));
    expect(manifest).toMatchObject({ public: false, redirect_url: `${ORIGIN}/api/github/manifest-callback`, default_events: [] });
    const user = await start(await build(), 'example-user', 'User');
    expect(user.body).toContain('https://github.com/settings/apps/new');
    noSecrets(org);
  });

  it('turns GitHub’s code into a stored, encrypted App, once, without showing any secret', async () => {
    const t = await build();
    const state = stateIn((await start(t)).body);
    t.gh.when('POST /app-manifests/{code}/conversions').reply(201, CONVERSION);
    const res = await call(t.handlers.manifestCallback, request('GET', { code: 'abcdef123456', state }));
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('GitHub App created');
    expect(res.body).toContain('https://github.com/apps/robinson-mcp-example-org/installations/new');
    noSecrets(res);
    expect(await t.credentials.clientCredentials(5150)).toEqual({ clientId: 'Iv1.fixtureclientid', clientSecret: 'fixture-client-secret-value' });
    expect(await t.db.getAccount('example-org')).toMatchObject({ app_id: 5150, credential_kind: 'app' });
    expect(t.gh.invalid).toEqual([]);
    const again = await call(t.handlers.manifestCallback, request('GET', { code: 'abcdef123456', state }));
    expect(again.statusCode).toBe(400);
  });

  it('refuses an unknown, wrong-purpose or malformed state and a malformed code, and never calls GitHub', async () => {
    const t = await build();
    const userState = 'u'.repeat(43);
    await t.db.createSetupState({ state: userState, purpose: 'user_auth', accountHint: 'example-org' });
    for (const query of [{ code: 'abcdef123456', state: 'nope' }, { code: 'abcdef123456', state: userState }, { code: 'abcdef123456' }, {}]) {
      expect((await call(t.handlers.manifestCallback, request('GET', query))).statusCode).toBe(400);
    }
    const state = stateIn((await start(t)).body);
    expect((await call(t.handlers.manifestCallback, request('GET', { code: '<bad>', state }))).statusCode).toBe(400);
    expect(t.gh.calls).toEqual([]);
    expect((await call(t.handlers.manifestCallback, request('POST', { code: 'abcdef123456', state }))).statusCode).toBe(405);
  });

  it('answers with a plain failure and stores nothing when GitHub refuses the conversion', async () => {
    const t = await build();
    const state = stateIn((await start(t)).body);
    t.gh.when('POST /app-manifests/{code}/conversions').reply(404, { message: 'Not Found' });
    const res = await call(t.handlers.manifestCallback, request('GET', { code: 'abcdef123456', state }));
    expect(res.statusCode).toBe(502);
    expect(await t.db.listAccounts()).toEqual([]);
    noSecrets(res);
  });

  it('refuses the callback itself off the production deployment', async () => {
    const t = await build({ env: { ...PROD, VERCEL_ENV: 'preview' } });
    await t.db.createSetupState({ state: 'm'.repeat(43), purpose: 'manifest', accountHint: 'example-org' });
    t.gh.when('POST /app-manifests/{code}/conversions').reply(201, CONVERSION);
    const res = await call(t.handlers.manifestCallback, request('GET', { code: 'abcdef123456', state: 'm'.repeat(43) }));
    expect(res.statusCode).toBe(502);
    expect(t.gh.calls).toEqual([]);
    expect(await t.db.listAccounts()).toEqual([]);
  });
});

async function withApp(t, { installed = true } = {}) {
  await t.credentials.storeApp(CONVERSION, { ownerLogin: 'example-org', ownerType: 'Organization' });
  await t.db.upsertAccount({ login: 'example-org', accountId: 1001, accountType: 'Organization', label: 'Example Org', credentialKind: 'app', appId: 5150 });
  if (installed) await t.db.setInstallation('example-org', { installationId: 777, repositorySelection: 'all', permissions: MANIFEST_PERMISSIONS, status: 'active' });
  await t.open();
}

describe('coming back from installing the App', () => {
  const install = { id: 777, account: { login: 'example-org' }, repository_selection: 'selected', permissions: { contents: 'write' }, suspended_at: null };

  it('records the installation after reading it from GitHub as the App, not from the URL', async () => {
    const t = await build();
    await withApp(t, { installed: false });
    t.gh.when('GET /app/installations/{installation_id}').reply(200, install);
    const res = await call(t.handlers.setup, request('GET', { installation_id: '777', setup_action: 'install' }));
    expect(res.statusCode).toBe(200);
    expect(await t.db.getAccount('example-org')).toMatchObject({ installation_id: 777, installation_status: 'active' });
    const asApp = t.gh.calls.find((c) => c.route === 'GET /app/installations/{installation_id}');
    expect(asApp.headers.authorization).toMatch(/^bearer ey/i);
  });

  it('records nothing for an installation that belongs to another account or does not exist', async () => {
    const t = await build();
    await withApp(t, { installed: false });
    t.gh.when('GET /app/installations/{installation_id}').reply(200, { ...install, account: { login: 'someone-else' } });
    expect((await call(t.handlers.setup, request('GET', { installation_id: '777' }))).statusCode).toBe(404);
    t.gh.when('GET /app/installations/{installation_id}').reply(404, { message: 'Not Found' });
    expect((await call(t.handlers.setup, request('GET', { installation_id: '999' }))).statusCode).toBe(404);
    expect((await t.db.getAccount('example-org')).installation_id).toBeNull();
  });

  it('ignores a malformed installation id and shows the normal page', async () => {
    const t = await build();
    const res = await call(t.handlers.setup, request('GET', { installation_id: '12abc' }));
    expect(res.body).toContain('private setup');
  });
});

describe('showing the accounts', () => {
  it('reads each account back from GitHub, lists what is missing, and keeps tokens out of the page', async () => {
    const t = await build();
    await withApp(t);
    t.gh.when('GET /app').reply(200, { id: 5150, slug: 'robinson-mcp-example-org', name: 'robinson-mcp-example-org' });
    t.gh.when('GET /app/installations/{installation_id}').reply(200, { id: 777, account: { login: 'example-org' }, repository_selection: 'all', permissions: { contents: 'write' }, suspended_at: null });
    const res = await t.post({ action: 'status' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('GitHub App created (robinson-mcp-example-org)');
    expect(res.body).toContain('Installed on example-org');
    expect(res.body).toMatch(/has not granted \d+ requested permission/);
    noSecrets(res);
  });

  it('shows a suspended or missing installation, and a read-back failure, as plain sentences', async () => {
    const t = await build();
    await withApp(t);
    t.gh.when('GET /app').reply(200, { id: 5150, slug: 's', name: 'n' });
    t.gh.when('GET /app/installations/{installation_id}').reply(200, { id: 777, account: { login: 'example-org' }, repository_selection: 'all', permissions: MANIFEST_PERMISSIONS, suspended_at: '2026-10-01T00:00:00Z' });
    expect((await t.post({ action: 'status' })).body).toContain('suspended');
    t.gh.when('GET /app/installations/{installation_id}').reply(404, { message: 'Not Found' });
    t.gh.when('GET /app/installations').reply(200, []);
    expect((await t.post({ action: 'status' })).body).toContain('not installed');
    t.gh.when('GET /app').reply(500, { message: 'boom' });
    const failed = await t.post({ action: 'status' });
    expect(failed.body).toContain('Could not read the GitHub App back');
    noSecrets(failed);
  });

  it('computes missing permissions by level', () => {
    expect(missingPermissions({ contents: 'admin' }, { contents: 'write' })).toEqual([]);
    expect(missingPermissions({ contents: 'read' }, { contents: 'write' })).toEqual(['contents (read→write)']);
    expect(missingPermissions({}, { issues: 'read' })).toEqual(['issues (none→read)']);
  });
});

describe('authorizing as the owner (user authorization)', () => {
  async function begin(t) {
    const res = await t.post({ action: 'start-user-auth', login: 'example-org' });
    expect(res.statusCode).toBe(303);
    const location = new URL(res.headers.Location);
    return { state: location.searchParams.get('state'), location };
  }

  it('sends the owner to GitHub with PKCE and a single-use state, then stores the encrypted token', async () => {
    const t = await build();
    await withApp(t);
    const { state, location } = await begin(t);
    expect(location.origin + location.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(location.searchParams.get('client_id')).toBe('Iv1.fixtureclientid');
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(location.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/api/github/user-callback`);
    expect(location.search).not.toContain('fixture-client-secret-value');
    t.gh.when('GET /user').reply(200, { login: 'example-owner', id: 55 });
    const res = await call(t.handlers.userCallback, request('GET', { code: 'fixturecode', state }));
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('example-owner');
    noSecrets(res);
    expect(res.body).not.toContain('ghu_FAKE');
    const sent = t.oauth.calls[0];
    expect(sent).toMatchObject({ client_id: 'Iv1.fixtureclientid', code: 'fixturecode', redirect_uri: `${ORIGIN}/api/github/user-callback` });
    expect(crypto.createHash('sha256').update(sent.code_verifier).digest('base64url')).toBe(location.searchParams.get('code_challenge'));
    expect(await t.db.getAccount('example-org')).toMatchObject({ user_login: 'example-owner' });
    expect(JSON.stringify(await t.db.getAccount('example-org'))).not.toContain('ghu_FAKEuserTokenValue1');
    const again = await call(t.handlers.userCallback, request('GET', { code: 'fixturecode', state }));
    expect(again.statusCode).toBe(400);
    expect(t.oauth.calls).toHaveLength(1);
  });

  it('needs the App created first, and refuses a state of the wrong purpose', async () => {
    const t = await build();
    await t.open();
    expect((await t.post({ action: 'start-user-auth', login: 'example-org' })).statusCode).toBe(404);
    await t.db.createSetupState({ state: 'm'.repeat(43), purpose: 'manifest', accountHint: 'example-org' });
    expect((await call(t.handlers.userCallback, request('GET', { code: 'c', state: 'm'.repeat(43) }))).statusCode).toBe(400);
    expect((await call(t.handlers.userCallback, request('GET', { code: 'c', state: 'unknown' }))).statusCode).toBe(400);
    expect((await call(t.handlers.userCallback, request('GET', { state: 'm'.repeat(43) }))).statusCode).toBe(400);
  });

  it('saves nothing when GitHub refuses the exchange', async () => {
    const t = await build();
    await withApp(t);
    const { state } = await begin(t);
    t.oauth.reply = { status: 200, body: { error: 'bad_verification_code' } };
    const res = await call(t.handlers.userCallback, request('GET', { code: 'fixturecode', state }));
    expect(res.statusCode).toBe(502);
    expect((await t.db.getAccount('example-org')).user_login ?? null).toBeNull();
    noSecrets(res);
  });
});

describe('tokens entered on the page', () => {
  const FINE = 'github_pat_FAKE0123456789abcdefghij';
  const CLASSIC = 'ghp_FAKE0123456789abcdefghij';

  it('verifies a fine-grained token with GitHub, then stores it encrypted and shows only its last four characters', async () => {
    const t = await build();
    await t.open();
    t.gh.when('GET /rate_limit').reply(200, { resources: {}, rate: { limit: 5000, remaining: 4999, reset: 1, used: 1 } }, { 'github-authentication-token-expiration': '2027-01-01 00:00:00 UTC' });
    t.gh.when('GET /users/{username}').reply(200, { login: 'example-user', id: 55, type: 'User' });
    const res = await t.post({ action: 'add-fine-grained', login: 'example-user', token: FINE, label: 'Personal' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain(`ends in ${FINE.slice(-4)}`);
    expect(all(res)).not.toContain(FINE);
    expect(await t.db.getAccount('example-user')).toMatchObject({ credential_kind: 'fine_grained', label: 'Personal', fine_grained_last4: FINE.slice(-4) });
    expect(JSON.stringify(await t.db.getAccount('example-user'))).not.toContain(FINE);
    expect(await t.credentials.token({ account: 'example-user', cred: 'I' })).toBeTruthy();
  });

  it('refuses a classic token in the fine-grained box, a token GitHub rejects, and an unknown account', async () => {
    const t = await build();
    await t.open();
    t.gh.when('GET /rate_limit').reply(200, { resources: {}, rate: { limit: 5000, remaining: 1, reset: 1, used: 1 } }, { 'x-oauth-scopes': 'repo' });
    const classic = await t.post({ action: 'add-fine-grained', login: 'example-user', token: CLASSIC });
    expect(classic.statusCode).toBe(400);
    expect(classic.body).toContain('classic token');
    t.gh.when('GET /rate_limit').reply(401, { message: 'Bad credentials' });
    expect((await t.post({ action: 'add-fine-grained', login: 'example-user', token: FINE })).body).toContain('did not accept');
    t.gh.when('GET /rate_limit').reply(200, { resources: {}, rate: { limit: 1, remaining: 1, reset: 1, used: 0 } });
    t.gh.when('GET /users/{username}').reply(404, { message: 'Not Found' });
    expect((await t.post({ action: 'add-fine-grained', login: 'nobody-here', token: FINE })).body).toContain('could not find');
    expect((await t.post({ action: 'add-fine-grained', login: 'example-user', token: 'short' })).statusCode).toBe(400);
    expect((await t.post({ action: 'add-fine-grained', login: 'example-user', token: `${FINE} extra` })).statusCode).toBe(400);
    expect(await t.db.listAccounts()).toEqual([]);
  });

  it('will not turn an account that uses a GitHub App into a fine-grained-token account', async () => {
    const t = await build();
    await withApp(t);
    t.gh.when('GET /rate_limit').reply(200, { resources: {}, rate: { limit: 5000, remaining: 1, reset: 1, used: 1 } });
    t.gh.when('GET /users/{username}').reply(200, { login: 'example-org', id: 1001, type: 'Organization' });
    const res = await t.post({ action: 'add-fine-grained', login: 'example-org', token: FINE });
    expect(res.statusCode).toBe(409);
    expect(await t.db.getAccount('example-org')).toMatchObject({ credential_kind: 'app', app_id: 5150 });
  });

  it('accepts a classic token only with exactly the notifications scope, for an account that already exists', async () => {
    const t = await build();
    await withApp(t);
    t.gh.when('GET /rate_limit').reply(200, { resources: {}, rate: { limit: 5000, remaining: 1, reset: 1, used: 1 } }, { 'x-oauth-scopes': 'notifications' });
    const ok = await t.post({ action: 'add-classic', login: 'example-org', token: CLASSIC });
    expect(ok.statusCode).toBe(200);
    expect(all(ok)).not.toContain(CLASSIC);
    expect(await t.db.getAccount('example-org')).toMatchObject({ classic_last4: CLASSIC.slice(-4), classic_scopes: ['notifications'] });
    expect(JSON.stringify(await t.db.getAccount('example-org'))).not.toContain(CLASSIC);
    for (const scopes of ['notifications, repo', 'repo', '']) {
      t.gh.when('GET /rate_limit').reply(200, { resources: {}, rate: { limit: 1, remaining: 1, reset: 1, used: 0 } }, { 'x-oauth-scopes': scopes });
      expect((await t.post({ action: 'add-classic', login: 'example-org', token: CLASSIC })).statusCode, scopes).toBe(400);
    }
    t.gh.when('GET /rate_limit').reply(200, { resources: {}, rate: { limit: 1, remaining: 1, reset: 1, used: 0 } });
    expect((await t.post({ action: 'add-classic', login: 'example-org', token: CLASSIC })).body).toContain('not a classic token');
    t.gh.when('GET /rate_limit').reply(200, { resources: {}, rate: { limit: 1, remaining: 1, reset: 1, used: 0 } }, { 'x-oauth-scopes': 'notifications' });
    expect((await t.post({ action: 'add-classic', login: 'unknown-account', token: CLASSIC })).statusCode).toBe(404);
  });
});

describe('one-time secrets', () => {
  it('shows a secret once on the page and then never again', async () => {
    const t = await build();
    await t.open();
    const { id } = await t.oneTimeStore.issue({ account: 'example-org', kind: 'fixture-secret', secret: 'fixture-one-time-value' });
    const show = await call(t.handlers.setup, request('GET', { show: id }));
    expect(show.body).not.toContain('fixture-one-time-value');
    const revealed = await t.post({ action: 'reveal', id });
    expect(revealed.statusCode).toBe(200);
    expect(revealed.body).toContain('fixture-one-time-value');
    expect(revealed.body).toContain('Secret type: fixture-secret');
    const second = await t.post({ action: 'reveal', id });
    expect(second.statusCode).toBe(410);
    expect(second.body).not.toContain('fixture-one-time-value');
    expect((await t.post({ action: 'reveal', id: 'not-an-id' })).statusCode).toBe(410);
    expect((await t.post({ action: 'reveal', id }, { origin: 'https://evil.example' })).statusCode).toBe(403);
  });
});

describe('the page HTML', () => {
  it('escapes everything it prints', () => {
    const evil = '<img src=x onerror=alert(1)>"\'&';
    const html = renderSetup({ csrf: evil, result: evil, revealed: evil, show: evil, blocked: evil, keyHelp: evil, installLink: evil,
      manifestForm: { action: evil, manifest: evil },
      accounts: [{ login: evil, label: evil, account_type: evil, credential_kind: 'app', app: { created: true, slug: evil, error: evil },
        installation: { status: 'active', repository_selection: evil, missing_permissions: [evil] }, user: { authorized: true, login: evil },
        classic: { present: true, last4: evil, scopes: [evil] }, fine_grained: {}, production_enabled: false, is_default: true }, { login: evil, error: evil }] });
    expect(html).not.toContain('<img');
    expect(html).not.toContain('onerror=alert(1)>');
    const page = resultPage({ title: evil, message: evil, installSlug: evil });
    expect(page).not.toContain('<img');
  });
});

describe('turning production on (B-2, step 2)', () => {
  const ask = (t, ttlSeconds = 600) => t.db.createSetupState({ state: crypto.randomBytes(32).toString('base64url'), purpose: 'enable_production', accountHint: 'example-org', ttlSeconds });

  it('confirms a waiting request with the passphrase, turns production on, and logs it', async () => {
    const t = await build();
    await withApp(t);
    await ask(t);
    const res = await t.post({ action: 'confirm-production', login: 'example-org' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Production is now ON for example-org');
    expect((await t.db.getAccount('example-org')).production_enabled).toBe(true);
    noSecrets(res);
  });
  it('the waiting request is single-use', async () => {
    const t = await build();
    await withApp(t);
    await ask(t);
    await t.post({ action: 'confirm-production', login: 'example-org' });
    await t.db.setProductionEnabled('example-org', false);
    const again = await t.post({ action: 'confirm-production', login: 'example-org' });
    expect(again.statusCode).toBe(409);
    expect((await t.db.getAccount('example-org')).production_enabled).not.toBe(true);
  });
  it('without a waiting request nothing changes', async () => {
    const t = await build();
    await withApp(t);
    const res = await t.post({ action: 'confirm-production', login: 'example-org' });
    expect(res.statusCode).toBe(409);
    expect((await t.db.getAccount('example-org')).production_enabled).not.toBe(true);
  });
  it('an expired request does not count', async () => {
    const t = await build();
    await withApp(t);
    await ask(t, -5);
    expect((await t.post({ action: 'confirm-production', login: 'example-org' })).statusCode).toBe(409);
  });
  it('a wrong passphrase leaves the request in place and production off', async () => {
    const t = await build();
    await withApp(t);
    await ask(t);
    const res = await t.post({ action: 'confirm-production', login: 'example-org', passphrase: 'wrong-wrong-wrong' });
    expect(res.statusCode).toBe(401);
    expect(await t.db.hasPendingSetupState('enable_production', 'example-org')).toBe(true);
  });
  it('rejects bad or unknown account names, and a preview deployment', async () => {
    const t = await build();
    await withApp(t);
    expect((await t.post({ action: 'confirm-production', login: 'bad-' })).statusCode).toBe(400);
    expect((await t.post({ action: 'confirm-production', login: 'nobody' })).statusCode).toBe(404);
    const preview = await build({ env: { ...PROD, VERCEL_ENV: 'preview' } });
    await preview.open();
    expect((await preview.post({ action: 'confirm-production', login: 'example-org' })).statusCode).toBe(403);
  });
  it('saves extra production names, keeps the built-in ones, and refuses bad names', async () => {
    const t = await build();
    await t.open();
    const ok = await t.post({ action: 'set-production-names', environments: 'staging-live, eu-prod', branches: 'release/*' });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toContain('eu-prod');
    expect(ok.body).toContain('production');
    const bad = await t.post({ action: 'set-production-names', environments: 'bad name!', branches: '' });
    expect(bad.statusCode).toBe(400);
    expect(bad.body).toContain('not a valid environment name');
    const status = await t.post({ action: 'status' });
    expect(status.body).toContain('eu-prod');
  });
});

describe('the protected list on the setup page (B-3)', () => {
  it('shows the starting list on the status screen', async () => {
    const t = await build();
    await t.open();
    const res = await t.post({ action: 'status' });
    expect(res.body).toContain('robinson-ai-systems/github-mcp');
    expect(res.body).toContain('pr-only');
    expect(res.body).toContain('robinsons-toolkit-mcp');
  });
  it('adds, changes and removes an entry with the passphrase, and logs each', async () => {
    const t = await build();
    await t.open();
    const add = await t.post({ action: 'save-protected', kind: 'repo', target: 'Example-Org/Crown-Jewels', level: 'locked', reason: 'never touch' });
    expect(add.statusCode).toBe(200);
    expect((await t.db.listProtectedResources()).some((e) => e.target === 'example-org/crown-jewels' && e.level === 'locked')).toBe(true);
    const loosen = await t.post({ action: 'save-protected', kind: 'repo', target: 'example-org/crown-jewels', level: 'pr-only', reason: 'ok through PRs' });
    expect(loosen.body).toContain('was locked');
    const gone = await t.post({ action: 'remove-protected', kind: 'repo', target: 'example-org/crown-jewels' });
    expect(gone.statusCode).toBe(200);
    expect((await t.db.listProtectedResources()).some((e) => e.target === 'example-org/crown-jewels')).toBe(false);
    const logged = [await t.db.getChange(1), await t.db.getChange(2), await t.db.getChange(3)];
    expect(logged.map((r) => r?.tool)).toEqual(['setup_save_protected', 'setup_save_protected', 'setup_remove_protected']);
    expect(logged[1].summary).toContain('was locked');
  });
  it('refuses bad entries, unknown removals, a wrong passphrase and a preview deployment', async () => {
    const t = await build();
    await t.open();
    expect((await t.post({ action: 'save-protected', kind: 'repo', target: 'no-slash', level: 'locked', reason: 'why not' })).statusCode).toBe(400);
    expect((await t.post({ action: 'save-protected', kind: 'repo', target: 'a/b', level: 'open', reason: 'why not' })).statusCode).toBe(400);
    expect((await t.post({ action: 'remove-protected', kind: 'repo', target: 'a/never-listed' })).statusCode).toBe(404);
    const before = (await t.db.listProtectedResources()).length;
    expect((await t.post({ action: 'save-protected', kind: 'repo', target: 'a/b', level: 'locked', reason: 'why not', passphrase: 'wrong-wrong-wrong' })).statusCode).toBe(401);
    expect((await t.db.listProtectedResources()).length).toBe(before);
    const preview = await build({ env: { ...PROD, VERCEL_ENV: 'preview' } });
    await preview.open();
    expect((await preview.post({ action: 'save-protected', kind: 'repo', target: 'a/b', level: 'locked', reason: 'why not' })).statusCode).toBe(403);
  });
});

describe('spend limit and own people on the setup page (B-4)', () => {
  it('raises and lowers the monthly limit in dollars, logs it, and shows used this month', async () => {
    const t = await build();
    await withApp(t);
    const up = await t.post({ action: 'set-spend-limit', login: 'example-org', dollars: '$25.50' });
    expect(up.statusCode).toBe(200);
    expect(up.body).toContain('$25.50');
    expect((await t.db.getAccount('example-org')).spend_limit_cents).toBe(2550);
    expect((await t.post({ action: 'set-spend-limit', login: 'example-org', dollars: '0' })).statusCode).toBe(200);
    expect((await t.db.getAccount('example-org')).spend_limit_cents).toBe(0);
    expect((await t.post({ action: 'status' })).body).toContain('limit $0.00, used this month $0.00');
  });
  it('refuses nonsense amounts, unknown accounts, a wrong passphrase and a preview deployment', async () => {
    const t = await build();
    await withApp(t);
    for (const dollars of ['-5', 'lots', '1.234', '', '99999999']) expect((await t.post({ action: 'set-spend-limit', login: 'example-org', dollars })).statusCode).toBe(400);
    expect((await t.post({ action: 'set-spend-limit', login: 'nobody', dollars: '5' })).statusCode).toBe(404);
    expect((await t.post({ action: 'set-spend-limit', login: 'example-org', dollars: '5', passphrase: 'wrong-wrong-wrong' })).statusCode).toBe(401);
    expect((await t.db.getAccount('example-org')).spend_limit_cents).toBe(0);
    const preview = await build({ env: { ...PROD, VERCEL_ENV: 'preview' } });
    await preview.open();
    expect((await preview.post({ action: 'set-spend-limit', login: 'example-org', dollars: '5' })).statusCode).toBe(403);
  });
  it('shows public usage as counts only, and nothing when nobody has connected', async () => {
    const { renderSetup } = await import('../../src/github/setup-html.js');
    const none = renderSetup({ csrf: 'c', publicUsage: { peopleConnected: 0, moreThanShown: false, unreadable: 0, lastDay: { calls: 0 }, lastWeek: { calls: 0 } } });
    expect(none).not.toContain('Public usage');
    const some = renderSetup({ csrf: 'c', publicUsage: { peopleConnected: 3, activeToday: 2, activeThisWeek: 3, unreadable: 1,
      lastDay: { calls: 12, writes: 2, errors: 0 }, lastWeek: { calls: 80 }, signups: { paused: false, pauseCents: 5000 },
      top: [{ login: 'heavy-user', calls: 60, writes: 4 }, { login: null, calls: 20, writes: 0 }] } });
    expect(some).toContain('Public usage');
    expect(some).toContain('People connected through the public sign-in: 3');
    expect(some).toContain('Active today: 2; active this week: 3');
    expect(some).toContain('Assistant calls today: 12 (2 real changes, 0 errors)');
    expect(some).toContain('New sign-ups: <strong>open</strong>');
    expect(some).toContain('heavy-user (60, 4)');
    expect(some).toContain('name not available (20, 0)');
    expect(some).toContain('1 names could not be read');
    const paused = renderSetup({ csrf: 'c', publicUsage: { peopleConnected: 3, lastDay: { calls: 1 }, lastWeek: { calls: 1 },
      signups: { paused: true, manual: false, reason: 'estimated monthly cost $60.00 reached $50.00', pauseCents: 5000 } } });
    expect(paused).toContain('New sign-ups: paused');
    expect(paused).toContain('reached $50.00');
  });
  it('refuses to delete a person\'s data unless the name is typed twice and confirmed', async () => {
    const t = await build();
    await t.open();
    expect((await t.post({ action: 'forget-person', login: 'alice-dev', confirmLogin: 'someone-else', confirmDelete: 'yes' })).statusCode).toBe(400);
    expect((await t.post({ action: 'forget-person', login: 'alice-dev', confirmLogin: 'alice-dev' })).statusCode).toBe(400);
    expect((await t.post({ action: 'forget-person', login: 'bad name!', confirmLogin: 'bad name!', confirmDelete: 'yes' })).statusCode).toBe(400);
  });
  it('shows the invite list with its on/off state, and the invite forms refuse bad names, a wrong passphrase and a preview deployment (LAUNCH-1)', async () => {
    const { renderSetup } = await import('../../src/github/setup-html.js');
    const on = renderSetup({ csrf: 'c', publicInvites: { on: true, logins: ['gina-new', 'ivan'] } });
    expect(on).toContain('Invite list');
    expect(on).toContain('Invite-only is ON');
    expect(on).toContain('gina-new, ivan');
    expect(renderSetup({ csrf: 'c', publicInvites: { on: false, logins: [] } })).toContain('Invite-only is OFF');
    expect(renderSetup({ csrf: 'c' })).not.toContain('Invite list');
    const t = await build({ env: { ...PROD, GITHUB_PRIVATE_TENANT_PILOT: 'enabled', DATABASE_URL: 'postgres://invalid.example.test/none' } });
    await t.open();
    expect((await t.post({ action: 'add-invites', logins: 'bad name!' })).statusCode).toBe(400);
    expect((await t.post({ action: 'add-invites', logins: '' })).statusCode).toBe(400);
    expect((await t.post({ action: 'remove-invite', login: 'no good' })).statusCode).toBe(400);
    expect((await t.post({ action: 'add-invites', logins: 'gina', passphrase: 'wrong-wrong-wrong' })).statusCode).toBe(401);
    const notSetUp = await build();
    await notSetUp.open();
    expect((await notSetUp.post({ action: 'add-invites', logins: 'gina' })).statusCode).toBe(409);
    const preview = await build({ env: { ...PROD, VERCEL_ENV: 'preview' } });
    await preview.open();
    expect((await preview.post({ action: 'add-invites', logins: 'gina' })).statusCode).toBe(403);
  });
  it('saves a display time zone (blank means UTC) and rejects a name that is not a real zone', async () => {
    const t = await build();
    await t.open();
    expect((await t.post({ action: 'set-time-zone', zone: 'America/Denver' })).statusCode).toBe(200);
    expect(await t.db.getSetting('time_zone')).toBe('America/Denver');
    expect((await t.post({ action: 'set-time-zone', zone: '' })).statusCode).toBe(200);
    expect(await t.db.getSetting('time_zone')).toBe('UTC');
    expect((await t.post({ action: 'set-time-zone', zone: 'Mars/Base' })).statusCode).toBe(400);
    expect(await t.db.getSetting('time_zone')).toBe('UTC');
  });
  it('saves, replaces and rejects the extra own-people list', async () => {
    const t = await build();
    await t.open();
    const ok = await t.post({ action: 'set-own-people', logins: '@alice, bob' });
    expect(ok.statusCode).toBe(200);
    expect(await t.db.getSetting('own_people')).toEqual({ logins: ['alice', 'bob'] });
    await t.post({ action: 'set-own-people', logins: '' });
    expect(await t.db.getSetting('own_people')).toEqual({ logins: [] });
    expect((await t.post({ action: 'set-own-people', logins: 'bad name!' })).statusCode).toBe(400);
  });
});


describe('IN-06 owner-only scratch Organization designation', () => {
  const post = (t, extra = {}) => t.post({ action: 'set-scratch', login: 'example-org',
    confirmLogin: 'example-org', enabled: 'true', ...extra });
  const installation = (overrides = {}) => ({ id: 777,
    account: { login: 'example-org', type: 'Organization' }, repository_selection: 'all',
    permissions: MANIFEST_PERMISSIONS, suspended_at: null, ...overrides });

  it('requires an exact GitHub-verified App installation and logs explicit owner approval', async () => {
    const t = await build(); await withApp(t);
    t.gh.when('GET /app/installations/{installation_id}').reply(200, installation());
    const yes = await post(t);
    expect(yes.statusCode).toBe(200);
    expect(yes.body).toContain('Scratch testing is ON');
    expect((await t.db.getAccount('example-org')).is_scratch).toBe(true);
    t.gh.when('GET /app').reply(200, { id: 5150, slug: 'robinson-mcp-example-org', name: 'Scratch App' });
    expect((await t.post({action:'status'})).body).toContain('Disposable scratch organization: <strong>yes</strong>');
    const off = await post(t, {enabled:'false'});
    expect(off.statusCode).toBe(200);
    expect((await t.db.getAccount('example-org')).is_scratch).toBe(false);
    noSecrets(yes);
  });

  it('refuses selected repositories, suspended Apps, incomplete permissions and foreign installation identities', async () => {
    const t = await build(); await withApp(t);
    for(const variation of [
      { repository_selection: 'selected' },
      { suspended_at: '2026-10-01T00:00:00Z' },
      { permissions: { contents:'read' } },
      { account: { login:'someone-else',type:'Organization' } },
      { account: { login:'example-org',type:'User' } },
      { id: 999 }
    ]) {
      t.gh.when('GET /app/installations/{installation_id}').reply(200, installation(variation));
      expect((await post(t)).statusCode).toBe(409);
      expect((await t.db.getAccount('example-org')).is_scratch).toBe(false);
    }
    t.gh.when('GET /app/installations/{installation_id}').reply(403, {message:'Forbidden'});
    expect((await post(t)).statusCode).toBe(409);
    expect((await t.db.getAccount('example-org')).is_scratch).toBe(false);
  });

  it('requires production setup, CSRF, matching organization name and the administrator passphrase', async () => {
    const t = await build(); await withApp(t);
    expect((await post(t,{confirmLogin:'wrong-org'})).statusCode).toBe(400);
    expect((await post(t,{enabled:'maybe'})).statusCode).toBe(400);
    expect((await post(t,{passphrase:'wrong'})).statusCode).toBe(401);
    expect((await t.post({action:'set-scratch',login:'example-org',confirmLogin:'example-org',
      enabled:'true'}, {csrf:'bad'})).statusCode).toBe(403);
    await t.db.setProductionEnabled('example-org',true);
    expect((await post(t)).statusCode).toBe(409);
    expect((await t.db.getAccount('example-org')).is_scratch).toBe(false);
    const preview = await build({env:{...PROD,VERCEL_ENV:'preview'}});
    await preview.open();
    expect((await post(preview)).statusCode).toBe(403);
  });

  it('refuses flagging personal and token-only accounts even with a forged installation', async () => {
    const t=await build(); await t.open();
    await t.db.upsertAccount({login:'example-org',accountId:1001,accountType:'User',
      label:'Not scratch',credentialKind:'fine_grained'});
    await t.db.setInstallation('example-org',{installationId:777,repositorySelection:'all',
      permissions:MANIFEST_PERMISSIONS,status:'active'});
    expect((await post(t)).statusCode).toBe(409);
    expect((await t.db.getAccount('example-org')).is_scratch).toBe(false);
  });
});


describe('canonical setup URL and strict mobile-browser error guidance', () => {
  it('redirects alternate public aliases before setting any CSRF cookie', async () => {
    const t=await build();
    const other=await call(t.handlers.setup,request('GET',{}, {host:'github-mcp-xi.vercel.app'}));
    expect(other.statusCode).toBe(302);
    expect(other.headers.Location).toBe(`${ORIGIN}/api/github/setup`);
    expect(other.headers['Set-Cookie']).toBeUndefined();
    expect(other.headers['Cache-Control']).toBe('no-store');
    const canonical=await call(t.handlers.setup,request('GET',{}, {host:new URL(ORIGIN).host}));
    expect(canonical.statusCode).toBe(200);
    expect(canonical.headers['Set-Cookie']).toMatch(/SameSite=Strict/);
  });
  it('never trusts host/alias as permission to POST without exact Origin', async()=>{
    const t=await build();await t.open();
    for(const origin of ['', 'null','https://evil.example','https://github-mcp-xi.vercel.app']) {
      const req=request('POST',{action:'status',passphrase:PASS,csrf:t.page.csrf},
        {host:new URL(ORIGIN).host,origin,cookie:`github_setup_csrf=${t.page.cookie}`});
      const res=await call(t.handlers.setup,req);
      expect(res.statusCode).toBe(403);
      expect(res.body).toContain('Secure browser required');
      expect(res.body).toContain(ORIGIN);
    }
    expect((await t.post({action:'status'})).statusCode).toBe(200);
  });
  it('forwards only validated setup query fields when redirecting an alias',async()=>{
    const t=await build();
    const q={secret:'a'.repeat(44),show:'b'.repeat(44),installation_id:'321',malicious:'evil'};
    const response=await call(t.handlers.setup,request('GET',q,{host:'another.vercel.app'}));
    expect(response.statusCode).toBe(302);
    const url=new URL(response.headers.Location);
    expect(url.origin).toBe(ORIGIN);
    expect(url.pathname).toBe('/api/github/setup');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      installation_id:'321',show:'b'.repeat(44),secret:'a'.repeat(44)
    });
  });
});


describe('same-origin Referrer-Policy for actual HTML form navigations', () => {
  it('sends same-origin on setup pages and POST-returned forms, while keeping refusal pages no-referrer', async()=>{
    const t=await build();
    const getRes=await t.open();
    expect(getRes.headers['Referrer-Policy']).toBe('same-origin');
    const success=await t.post({action:'status'});
    expect(success.statusCode).toBe(200);
    expect(success.headers['Referrer-Policy']).toBe('same-origin');
    const wrong=await t.post({action:'status',passphrase:'bad'});
    expect(wrong.statusCode).toBe(401);
    expect(wrong.headers['Referrer-Policy']).toBe('same-origin');
    const reject=await t.post({action:'status'},{origin:'null'});
    expect(reject.statusCode).toBe(403);
    expect(reject.headers['Referrer-Policy']).toBe('no-referrer');
  });
});

describe('setup form feedback visibility on mobile without JavaScript', () => {
  it('anchors internal forms to the feedback at page start, not a different origin', async () => {
    const t=await build();
    const page=await t.open();
    expect(page.body).toContain('<h1 id="setup-feedback">');
    expect(page.body).toContain('<form method="post" action="#setup-feedback" autocomplete="off">');
    expect((page.body.match(/action="#setup-feedback"/g)??[]).length).toBeGreaterThan(5);
    expect(page.body).not.toMatch(/<script/i);
    expect(page.headers['Content-Security-Policy']).toContain("form-action 'self' https://github.com");
  });

  it('displays wrong passphrase and exact next GitHub App step above all forms', async () => {
    const t=await build(); await t.open();
    const wrong=await t.post({action:'start-app',login:'example-org',passphrase:'wrong'});
    expect(wrong.statusCode).toBe(401);
    expect(wrong.body).toMatch(/<h1 id="setup-feedback">[\s\S]*Setup response:<\/strong> Incorrect administrator passphrase\./);
    expect((await t.db.listAccounts()).length).toBe(0);
    const good=await t.post({action:'start-app',login:'example-org',accountType:'Organization'});
    expect(good.statusCode).toBe(200);
    expect(good.body).toContain('Setup response:</strong> Ready to create the GitHub App');
    expect(good.body).toContain('Continue to GitHub');
    expect(good.body.indexOf('Ready to create the GitHub App')).toBeLessThan(good.body.indexOf('1. Create the GitHub App for an account'));
    expect(good.body).toContain('<form method="post" action="https://github.com/organizations/example-org/settings/apps/new');
  });
});

describe('dedicated package credential enrollment', () => {
  const token = 'fixture-package-token-value-only';
  async function prepare(scopes = 'read:packages, write:packages, delete:packages', actor = 'example-user') {
    const t = await build();
    await t.db.upsertAccount({ login: 'example-org', accountId: 1001, accountType: 'Organization', label: 'Example' });
    await t.credentials.storeUserAuthorization('example-org', { userLogin: 'example-user', accessToken: 'fixture-user-authorization-value' });
    t.gh.when('GET /rate_limit').reply(200, {}, { 'x-oauth-scopes': scopes });
    t.gh.when('GET /user').reply(200, { id: 1002, login: actor });
    await t.open();
    return t;
  }
  it('verifies scopes and actor, encrypts separately, never reveals token, then removes it', async () => {
    const t = await prepare();
    const result = await t.post({ action: 'add-package', login: 'example-org', token });
    expect(result.statusCode).toBe(200);
    expect(JSON.stringify(result)).not.toContain(token);
    const row = await t.db.getAccount('example-org');
    expect(row.package_enc).toMatch(/^v1\./);
    expect(row.package_enc).not.toContain(token);
    expect(row.classic_enc).toBeNull();
    expect(await t.credentials.token({ account: 'example-org', cred: 'P' })).toBe(token);
    expect((await t.post({ action: 'remove-package', login: 'example-org' })).statusCode).toBe(200);
    await expect(t.credentials.token({ account: 'example-org', cred: 'P' })).rejects.toMatchObject({ code: 'no_credentials' });
  });
  it.each(['notifications', 'read:packages, admin:org', ''])('rejects incorrect scopes without storage: %s', async scopes => {
    const t = await prepare(scopes);
    expect((await t.post({ action: 'add-package', login: 'example-org', token })).statusCode).toBe(400);
    expect((await t.db.getAccount('example-org')).package_enc).toBeNull();
    expect(t.gh.calls.some(c => c.route === 'GET /user')).toBe(false);
  });
  it.each([
    ['', /not a "classic" token|does not have the read:packages/],
    ['notifications', /does not have the read:packages permission\. GitHub reports: notifications/],
    ['read:packages, admin:org', /extra permissions.*admin:org/]
  ])('tells the owner exactly what is wrong with the token scopes: %s', async (scopes, message) => {
    const t = await prepare(scopes);
    const r = await t.post({ action: 'add-package', login: 'example-org', token });
    expect(r.statusCode).toBe(400);
    expect(JSON.stringify(r)).toMatch(message);
  });
  it('accepts the scope list GitHub really reports when write and delete are ticked (read is implied)', async () => {
    const t = await prepare('delete:packages, write:packages');
    expect((await t.post({ action: 'add-package', login: 'example-org', token })).statusCode).toBe(200);
    expect(await t.credentials.token({ account: 'example-org', cred: 'P' })).toBe(token);
  });
  it('rejects another user and preserves an existing credential', async () => {
    const t = await prepare('read:packages', 'outsider');
    await t.credentials.storePackage('example-org', token, { scopes: ['read:packages'], actor: 'example-user' });
    const before = (await t.db.getAccount('example-org')).package_enc;
    expect((await t.post({ action: 'add-package', login: 'example-org', token: token + 'new' })).statusCode).toBe(400);
    expect((await t.db.getAccount('example-org')).package_enc).toBe(before);
  });
  it.each(['add-package', 'remove-package'])('retains passphrase and CSRF guards for %s', async action => {
    const t = await prepare();
    expect((await t.post({ action, login: 'example-org', token, passphrase: 'wrong' })).statusCode).toBe(401);
    expect((await t.post({ action, login: 'example-org', token }, { csrf: 'wrong' })).statusCode).toBe(403);
    expect((await t.db.getAccount('example-org')).package_enc).toBeNull();
  });
});

describe('package enrollment provider boundaries', () => {
  const token = 'fixture-package-token-value-only';
  it('supports a personal account without an unrelated App authorization and accepts optional repo for inherited packages', async () => {
    const t = await build();
    await t.db.upsertAccount({ login: 'example-user', accountId: 1002, accountType: 'User', label: 'Personal' });
    t.gh.when('GET /rate_limit').reply(200, {}, { 'x-oauth-scopes': 'read:packages, repo' });
    t.gh.when('GET /user').reply(200, { id: 1002, login: 'EXAMPLE-USER' });
    await t.open();
    expect((await t.post({ action: 'add-package', login: 'example-user', token })).statusCode).toBe(200);
    expect((await t.db.getAccount('example-user')).package_scopes).toEqual(['read:packages', 'repo']);
  });
  it.each([
    [undefined, 200, { id: 1002, login: 'example-user' }],
    ['read:packages', 401, { message: 'Bad credentials' }],
    ['read:packages', 200, { login: 'example-user' }]
  ])('refuses nonclassic or unverified identities without storing the token', async (scopes, status, user) => {
    const t = await build();
    await t.db.upsertAccount({ login: 'example-user', accountId: 1002, accountType: 'User', label: 'Personal' });
    t.gh.when('GET /rate_limit').reply(200, {}, scopes ? { 'x-oauth-scopes': scopes } : {});
    t.gh.when('GET /user').reply(status, user);
    await t.open();
    expect((await t.post({ action: 'add-package', login: 'example-user', token })).statusCode).toBe(400);
    expect((await t.db.getAccount('example-user')).package_enc).toBeNull();
  });
  it('records provider expiry and refuses an expired token without replacing a valid token', async () => {
    const t = await build();
    await t.db.upsertAccount({ login: 'example-user', accountId: 1002, accountType: 'User', label: 'Personal' });
    const headers = { 'x-oauth-scopes': 'read:packages', 'github-authentication-token-expiration': new Date(Date.now()+3600e3).toISOString() };
    t.gh.when('GET /rate_limit').reply(200, {}, headers);
    t.gh.when('GET /user').reply(200, { id: 1002, login: 'example-user' });
    await t.open();
    expect((await t.post({ action: 'add-package', login: 'example-user', token })).statusCode).toBe(200);
    const before = await t.db.getAccount('example-user');
    expect(new Date(before.package_expires_at).toISOString()).toBe(headers['github-authentication-token-expiration']);
    t.gh.when('GET /rate_limit').reply(200, {}, { ...headers, 'github-authentication-token-expiration': '2000-01-01T00:00:00Z' });
    expect((await t.post({ action: 'add-package', login: 'example-user', token: token+'new' })).statusCode).toBe(400);
    expect((await t.db.getAccount('example-user')).package_enc).toBe(before.package_enc);
  });
});

describe('package token removal when encryption is unavailable',()=>{
  it('removes ciphertext with existing owner safeguards without needing to decrypt it',async()=>{
    const t=await build({env:{...PROD,TOKEN_ENCRYPTION_KEY:''}});
    await t.db.upsertAccount({login:'example-user',accountId:1002,accountType:'User',label:'Personal'});
    await t.db.setPackageToken('example-user',{enc:'v1.fixture-package-ciphertext',scopes:['read:packages'],actor:'example-user'});
    await t.open();
    expect((await t.post({action:'remove-package',login:'example-user'},{csrf:'wrong'})).statusCode).toBe(403);
    expect((await t.db.getAccount('example-user')).package_enc).not.toBeNull();
    expect((await t.post({action:'remove-package',login:'example-user',passphrase:'wrong'})).statusCode).toBe(401);
    expect((await t.post({action:'remove-package',login:'example-user'})).statusCode).toBe(200);
    expect((await t.db.getAccount('example-user')).package_enc).toBeNull();
    expect((await t.post({action:'add-package',login:'example-user',token:'fixture-package-token-value-only'})).statusCode).toBe(503);
    expect(t.gh.calls).toEqual([]);
  });
  it('does not enroll a reused personal login with a different numeric provider identity',async()=>{
    const t=await build();
    await t.db.upsertAccount({login:'example-user',accountId:1002,accountType:'User',label:'Personal'});
    t.gh.when('GET /rate_limit').reply(200,{},{'x-oauth-scopes':'read:packages'});
    t.gh.when('GET /user').reply(200,{id:9999,login:'example-user'});
    await t.open();
    expect((await t.post({action:'add-package',login:'example-user',token:'fixture-package-token-value-only'})).statusCode).toBe(400);
    expect((await t.db.getAccount('example-user')).package_enc).toBeNull();
  });
});

describe('guided Unlock more tools section', () => {
  const html = renderSetup({ csrf: 'x'.repeat(43) });
  it('explains each extra token and opens GitHub with the right boxes ticked', () => {
    expect(html).toContain('Unlock more tools');
    expect(html).toContain('scopes=read:packages,write:packages,delete:packages');
    expect(html).toContain('scopes=notifications');
  });
  it('still offers every save and remove action, only on protected forms', () => {
    for (const a of ['add-package', 'remove-package', 'add-classic', 'remove-classic', 'add-fine-grained', 'remove-fine-grained']) expect(html).toContain(`value="${a}"`);
    expect(html).not.toMatch(/<form[^>]*method="get"/);
  });
});
