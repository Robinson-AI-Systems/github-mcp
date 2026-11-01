// KEY-ROTATION rehearsals (docs/KEY-ROTATION.md, evidence for docs/launch/key-rotation.json). Each test follows the written
// procedure end to end in the local harness with fake keys made at run time: the old value works, both work during the
// change, then only the new one works, and a wrong value is refused without changing anything. A fake GitHub really checks
// RS256 signatures and client secrets, so "GitHub accepted it" is proved, not assumed. Never a real key or a real account.
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createCredentials } from '../../src/github/credentials.js';
import { createSetupHandlers } from '../../src/github/setup-page.js';
import { createWebhookHandler } from '../../src/github/webhook.js';
import { createOneTimeStore } from '../../src/core/one-time-secrets.js';
import { readEncryptionKey } from '../../src/core/crypto.js';
import { ROTATION_WINDOW_MS } from '../../src/github/app-secret-rotation.js';
import { ROUTING_OVERLAP_MAX_DAYS, issueTenantCredential, routingKeyOverlap, verifyTenantCredential } from '../../src/tenancy/routed-credential.js';
import { createFakeDb } from '../../test/helpers/fake-db.js';
import { call, request, response } from '../../test/helpers/http-harness.js';

const rsa = () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { pem: privateKey.export({ type: 'pkcs1', format: 'pem' }).toString(), pub: publicKey.export({ type: 'spki', format: 'pem' }).toString() };
};
const KEY_A = rsa(), KEY_B = rsa(), KEY_C = rsa();
const ORIGIN = 'https://github-mcp.example.test';
const PASS = 'fixture-admin-passphrase';
const APP_ID = 5150, CLIENT_ID = 'Iv1.fixtureclientid', INSTALLATION = 777;
const OLD_CLIENT_SECRET = 'a'.repeat(40), NEW_CLIENT_SECRET = 'b'.repeat(40), WRONG_CLIENT_SECRET = 'c'.repeat(40);
const OLD_WEBHOOK = 'fixture-old-webhook-secret-value';
const ENV = { VERCEL_ENV: 'production', PUBLIC_BASE_URL: ORIGIN, ADMIN_PASSPHRASE: PASS, TOKEN_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64url') };
const PEM_SHAPE = /BEGIN [A-Z ]*PRIVATE KEY/;

/** A fake GitHub that, like the real one, accepts any of the App's currently active keys and client secrets. */
function fakeGitHub() {
  const keys = new Set([KEY_A.pub]), secrets = new Set([OLD_CLIENT_SECRET]);
  const seen = { jwtKeys: [], oauthSecrets: [] };
  let n = 0;
  const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const signer = (authorization) => {
    const [head, body, sig] = String(authorization ?? '').replace(/^(bearer|token) /i, '').split('.');
    if (!head || !body || !sig) return null;
    for (const pub of keys) if (crypto.verify('RSA-SHA256', Buffer.from(`${head}.${body}`), pub, Buffer.from(sig, 'base64url'))) return pub;
    return null;
  };
  async function fetch(url, init = {}) {
    const u = new URL(String(url));
    if (u.origin === 'https://github.com' && u.pathname === '/login/oauth/access_token') {
      const form = new URLSearchParams(String(init.body));
      if (form.get('client_id') !== CLIENT_ID || !secrets.has(form.get('client_secret'))) return reply(200, { error: 'incorrect_client_credentials' });
      seen.oauthSecrets.push(form.get('client_secret'));
      if (form.get('grant_type') === 'refresh_token') return reply(200, { access_token: `ghu_FAKEuserToken${++n}`, expires_in: 28800, refresh_token: `ghr_FAKErefresh${n}`, refresh_token_expires_in: 15811200 });
      return reply(200, { error: 'bad_verification_code' });
    }
    const pub = signer(new Headers(init.headers).get('authorization'));
    if (!pub) return reply(401, { message: 'A JSON web token could not be decoded' });
    seen.jwtKeys.push(pub);
    if ((init.method ?? 'GET') === 'GET' && u.pathname === '/app') return reply(200, { id: APP_ID, slug: 'robinson-mcp-example-org' });
    if (init.method === 'POST' && u.pathname === `/app/installations/${INSTALLATION}/access_tokens`)
      return reply(201, { token: `ghs_FAKEinstallationToken${++n}`, expires_at: new Date(Date.now() + 3600e3).toISOString() });
    return reply(404, { message: 'Not Found' });
  }
  return { keys, secrets, seen, fetch };
}

async function world() {
  let t = Date.now();
  const clock = () => t;
  const db = createFakeDb({ clock });
  await db.initSchema();
  const gh = fakeGitHub();
  const credentials = createCredentials({ db, env: ENV, fetch: gh.fetch, now: clock });
  await credentials.storeApp({ id: APP_ID, slug: 'robinson-mcp-example-org', client_id: CLIENT_ID, client_secret: OLD_CLIENT_SECRET, pem: KEY_A.pem,
    webhook_secret: OLD_WEBHOOK, permissions: { contents: 'write' } }, { ownerLogin: 'example-org', ownerType: 'Organization' });
  await db.upsertAccount({ login: 'example-org', accountId: 1001, accountType: 'Organization', label: 'Example Org', credentialKind: 'app', appId: APP_ID });
  await db.setInstallation('example-org', { installationId: INSTALLATION, repositorySelection: 'all', permissions: { contents: 'write' }, status: 'active' });
  const oneTimeStore = createOneTimeStore({ db, service: 'github', setupPath: '/api/github/setup', encryptionKey: readEncryptionKey(ENV) });
  const setup = createSetupHandlers({ db, credentials, oneTimeStore, env: ENV, fetch: gh.fetch });
  const webhook = createWebhookHandler({ db, credentials });
  const opened = await call(setup.setup, request('GET', {}));
  const cookie = /github_setup_csrf=([A-Za-z0-9_-]{43})/.exec(opened.headers['Set-Cookie'])[1];
  const post = (fields) => call(setup.setup, request('POST', { csrf: cookie, passphrase: PASS, ...fields }, { origin: ORIGIN, cookie: `github_setup_csrf=${cookie}` }));
  const deliver = async (secret) => {
    const raw = Buffer.from(JSON.stringify({ zen: 'fixture' }));
    const req = Object.assign(Readable.from([raw]), { method: 'POST', headers: { 'x-github-event': 'ping', 'x-github-hook-installation-target-id': String(APP_ID),
      'x-hub-signature-256': 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex') } });
    const res = response();
    await webhook(req, res);
    return res.statusCode;
  };
  /** One fresh installation token, as every tool call gets it (cache dropped so the App key is really used). */
  const installationToken = async () => { await db.deleteInstallationTokens(INSTALLATION); return credentials.token({ account: 'example-org' }); };
  return { db, gh, credentials, post, deliver, installationToken, advance: (ms) => { t += ms; } };
}
const noValues = (res, ...values) => {
  const text = `${res.body}${JSON.stringify(res.headers)}`;
  expect(text).not.toMatch(PEM_SHAPE);
  for (const v of values) expect(text).not.toContain(v);
};

describe('KEY-ROTATION rehearsal: the GitHub App private key', () => {
  it('rehearsal: replacing the App private key keeps installation tokens flowing, then only the new key is used', async () => {
    const w = await world();
    // 1. Before: the old key works.
    expect(await w.installationToken()).toMatch(/^ghs_FAKE/);
    expect(w.gh.seen.jwtKeys.at(-1)).toBe(KEY_A.pub);

    // A key GitHub does not know is refused, and nothing changes.
    const wrong = await w.post({ action: 'replace-app-secret', login: 'example-org', kind: 'private_key', newSecret: KEY_C.pem, confirmReplace: 'yes' });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.body).toContain('GitHub did not accept that private key');
    noValues(wrong);
    expect(await w.installationToken()).toMatch(/^ghs_FAKE/);
    expect(w.gh.seen.jwtKeys.at(-1)).toBe(KEY_A.pub);

    // 2. Chris generates a second key on GitHub: both are active there; the server still uses the old one.
    w.gh.keys.add(KEY_B.pub);
    expect(await w.installationToken()).toMatch(/^ghs_FAKE/);
    // He pastes the new key on the setup page: GitHub proves it (GET /app signed with it), then it is saved.
    const saved = await w.post({ action: 'replace-app-secret', login: 'example-org', kind: 'private_key', newSecret: KEY_B.pem, confirmReplace: 'yes' });
    expect(saved.statusCode).toBe(200);
    expect(saved.body).toContain('GitHub accepted the new private key');
    noValues(saved);
    expect(w.gh.seen.jwtKeys.at(-1)).toBe(KEY_B.pub);
    expect(await w.installationToken()).toMatch(/^ghs_FAKE/);
    expect(w.gh.seen.jwtKeys.at(-1)).toBe(KEY_B.pub);
    expect((await w.credentials.appSecretWindows(APP_ID)).map((x) => x.kind)).toEqual(['private_key']);
    expect((await w.db.listChanges({ includePreviews: true })).map((c) => c.tool)).toContain('setup_replace_app_secret');

    // 3. Chris deletes the old key on GitHub: only the new one works, and the server needs nothing more.
    w.gh.keys.delete(KEY_A.pub);
    expect(await w.installationToken()).toMatch(/^ghs_FAKE/);
    expect(w.gh.seen.jwtKeys.at(-1)).toBe(KEY_B.pub);
    // The same key again is refused (nothing to replace).
    expect((await w.post({ action: 'replace-app-secret', login: 'example-org', kind: 'private_key', newSecret: KEY_B.pem, confirmReplace: 'yes' })).statusCode).toBe(400);
    // Finish now forgets the old one; Undo then has nothing to put back.
    expect((await w.post({ action: 'finish-app-secret', login: 'example-org', kind: 'private_key' })).statusCode).toBe(200);
    expect((await w.post({ action: 'undo-app-secret', login: 'example-org', kind: 'private_key' })).statusCode).toBe(404);
    expect(await w.credentials.appSecretWindows(APP_ID)).toEqual([]);
  });

  it('Undo puts the previous private key back within the window, and not after it', async () => {
    const w = await world();
    w.gh.keys.add(KEY_B.pub);
    expect((await w.post({ action: 'replace-app-secret', login: 'example-org', kind: 'private_key', newSecret: KEY_B.pem, confirmReplace: 'yes' })).statusCode).toBe(200);
    expect((await w.post({ action: 'undo-app-secret', login: 'example-org', kind: 'private_key' })).statusCode).toBe(200);
    await w.installationToken();
    expect(w.gh.seen.jwtKeys.at(-1)).toBe(KEY_A.pub);
    // Replace again, then let the window pass: Undo is no longer possible and the new key stays.
    expect((await w.post({ action: 'replace-app-secret', login: 'example-org', kind: 'private_key', newSecret: KEY_B.pem, confirmReplace: 'yes' })).statusCode).toBe(200);
    w.advance(ROTATION_WINDOW_MS + 1000);
    expect((await w.post({ action: 'undo-app-secret', login: 'example-org', kind: 'private_key' })).statusCode).toBe(404);
    await w.installationToken();
    expect(w.gh.seen.jwtKeys.at(-1)).toBe(KEY_B.pub);
  });

  it('refuses without confirmation, a pasted non-key, an unknown account and outside production, changing nothing', async () => {
    const w = await world();
    w.gh.keys.add(KEY_B.pub);
    expect((await w.post({ action: 'replace-app-secret', login: 'example-org', kind: 'private_key', newSecret: KEY_B.pem })).statusCode).toBe(400);
    expect((await w.post({ action: 'replace-app-secret', login: 'example-org', kind: 'private_key', newSecret: 'not a key', confirmReplace: 'yes' })).statusCode).toBe(400);
    expect((await w.post({ action: 'replace-app-secret', login: 'example-org', kind: 'everything', newSecret: KEY_B.pem, confirmReplace: 'yes' })).statusCode).toBe(400);
    expect((await w.post({ action: 'replace-app-secret', login: 'nobody-here', kind: 'private_key', newSecret: KEY_B.pem, confirmReplace: 'yes' })).statusCode).toBe(404);
    const preview = createSetupHandlers({ db: w.db, credentials: w.credentials, env: { ...ENV, VERCEL_ENV: 'preview' }, fetch: w.gh.fetch });
    const opened = await call(preview.setup, request('GET', {}));
    const cookie = /github_setup_csrf=([A-Za-z0-9_-]{43})/.exec(opened.headers['Set-Cookie'])[1];
    const res = await call(preview.setup, request('POST', { csrf: cookie, passphrase: PASS, action: 'replace-app-secret', login: 'example-org', kind: 'private_key', newSecret: KEY_B.pem, confirmReplace: 'yes' },
      { origin: ORIGIN, cookie: `github_setup_csrf=${cookie}` }));
    expect(res.statusCode).toBe(403);
    await w.installationToken();
    expect(w.gh.seen.jwtKeys.at(-1)).toBe(KEY_A.pub);
    expect(await w.credentials.appSecretWindows(APP_ID)).toEqual([]);
  });
});

describe('KEY-ROTATION rehearsal: the GitHub App client secret', () => {
  it('rehearsal: replacing the App client secret keeps GitHub sign-ins renewing, then only the new secret is used', async () => {
    const w = await world();
    const renew = async () => {
      await w.credentials.storeUserAuthorization('example-org', { userLogin: 'example-user', accessToken: 'ghu_FAKEexpiringSoon', expiresIn: 1, refreshToken: 'ghr_FAKEstored', refreshExpiresIn: 86400 });
      return w.credentials.token({ account: 'example-org', cred: 'U' });
    };
    // 1. Before: the old secret renews a sign-in.
    expect(await renew()).toMatch(/^ghu_FAKEuserToken/);
    expect(w.gh.seen.oauthSecrets.at(-1)).toBe(OLD_CLIENT_SECRET);
    // A secret GitHub does not know is refused, nothing changes.
    const wrong = await w.post({ action: 'replace-app-secret', login: 'example-org', kind: 'client_secret', newSecret: WRONG_CLIENT_SECRET, confirmReplace: 'yes' });
    expect(wrong.statusCode).toBe(400);
    noValues(wrong, WRONG_CLIENT_SECRET);
    // 2. Chris generates a new client secret on GitHub (both active there) and pastes it here; GitHub proves it first.
    w.gh.secrets.add(NEW_CLIENT_SECRET);
    const saved = await w.post({ action: 'replace-app-secret', login: 'example-org', kind: 'client_secret', newSecret: NEW_CLIENT_SECRET, confirmReplace: 'yes' });
    expect(saved.statusCode).toBe(200);
    noValues(saved, NEW_CLIENT_SECRET, OLD_CLIENT_SECRET);
    expect(await renew()).toMatch(/^ghu_FAKEuserToken/);
    expect(w.gh.seen.oauthSecrets.at(-1)).toBe(NEW_CLIENT_SECRET);
    expect((await w.credentials.clientCredentials(APP_ID)).clientId).toBe(CLIENT_ID);
    // 3. Chris deletes the old secret on GitHub: renewals keep working with the new one.
    w.gh.secrets.delete(OLD_CLIENT_SECRET);
    expect(await renew()).toMatch(/^ghu_FAKEuserToken/);
    expect(w.gh.seen.oauthSecrets.at(-1)).toBe(NEW_CLIENT_SECRET);
    expect((await w.post({ action: 'finish-app-secret', login: 'example-org', kind: 'client_secret' })).statusCode).toBe(200);
  });
});

describe('KEY-ROTATION rehearsal: the GitHub App webhook secret', () => {
  it('rehearsal: replacing the App webhook secret loses no delivery, then only the new secret is believed', async () => {
    const w = await world();
    // 1. Before: deliveries signed with the old secret are believed; anything else is refused.
    expect(await w.deliver(OLD_WEBHOOK)).toBe(200);
    expect(await w.deliver('fixture-unknown-secret-value')).toBe(401);
    // 2. Chris presses Replace (no value typed): the server makes a new secret and shows it once.
    const made = await w.post({ action: 'replace-app-secret', login: 'example-org', kind: 'webhook_secret', confirmReplace: 'yes' });
    expect(made.statusCode).toBe(200);
    noValues(made, OLD_WEBHOOK);
    const id = /show=([A-Za-z0-9_-]{32})/.exec(made.body)[1];
    const shown = await w.post({ action: 'reveal', id });
    const fresh = /<pre>([A-Za-z0-9_-]{43})<\/pre>/.exec(shown.body)[1];
    expect((await w.post({ action: 'reveal', id })).statusCode).toBe(410);
    // Until he saves it on GitHub, GitHub still signs with the old one: believed. After he saves it: the new one is believed.
    expect(await w.deliver(OLD_WEBHOOK)).toBe(200);
    expect(await w.deliver(fresh)).toBe(200);
    expect(await w.deliver('fixture-unknown-secret-value')).toBe(401);
    // 3. The window ends (or Finish now): only the new one is believed.
    w.advance(ROTATION_WINDOW_MS + 1000);
    expect(await w.deliver(OLD_WEBHOOK)).toBe(401);
    expect(await w.deliver(fresh)).toBe(200);
  });

  it('Finish now stops accepting the old webhook secret at once (for an exposed secret); Undo restores it inside the window', async () => {
    const w = await world();
    const made = await w.post({ action: 'replace-app-secret', login: 'example-org', kind: 'webhook_secret', confirmReplace: 'yes' });
    const fresh = /<pre>([A-Za-z0-9_-]{43})<\/pre>/.exec((await w.post({ action: 'reveal', id: /show=([A-Za-z0-9_-]{32})/.exec(made.body)[1] })).body)[1];
    expect((await w.post({ action: 'finish-app-secret', login: 'example-org', kind: 'webhook_secret' })).statusCode).toBe(200);
    expect(await w.deliver(OLD_WEBHOOK)).toBe(401);
    expect(await w.deliver(fresh)).toBe(200);
    // A second replacement, then Undo: the previous (fresh) one is current again and the newest is forgotten.
    expect((await w.post({ action: 'replace-app-secret', login: 'example-org', kind: 'webhook_secret', confirmReplace: 'yes' })).statusCode).toBe(200);
    expect((await w.post({ action: 'undo-app-secret', login: 'example-org', kind: 'webhook_secret' })).statusCode).toBe(200);
    expect(await w.deliver(fresh)).toBe(200);
    expect(await w.credentials.webhookSecrets(APP_ID)).toHaveLength(1);
  });
});

describe('KEY-ROTATION rehearsal: the tenant routing key', () => {
  const T = '5ca85cbb-2222-4222-8222-333333333333', I = '5ca85cbb-2222-4222-8222-444444444444';
  const claim = { tenantId: T, identityId: I, membershipRevision: 2, pilotRevision: 4 };
  const OLD = crypto.randomBytes(32).toString('base64url'), NEW = crypto.randomBytes(32).toString('base64url');
  const NOW = Date.parse('2026-11-01T12:00:00Z');
  const before = { GITHUB_PRIVATE_TENANT_PILOT: 'enabled', GITHUB_TENANT_ROUTING_KEY: OLD };
  const during = { ...before, GITHUB_TENANT_ROUTING_KEY: NEW, GITHUB_TENANT_ROUTING_KEY_PREVIOUS: OLD, GITHUB_TENANT_ROUTING_KEY_PREVIOUS_UNTIL: '2026-11-08T12:00:00Z' };
  const after = { GITHUB_PRIVATE_TENANT_PILOT: 'enabled', GITHUB_TENANT_ROUTING_KEY: NEW };

  it('rehearsal: replacing the tenant routing key with an overlap window keeps people connected', () => {
    // 1. Before: credentials issued with the old key work.
    const old = Object.fromEntries(['tac', 'trf', 'tcl'].map((k) => [k, issueTenantCredential(k, claim, before)]));
    for (const [kind, value] of Object.entries(old)) expect(verifyTenantCredential(value, kind, before, NOW)).toEqual(claim);
    // 2. During the window: old ones still check, new ones are issued with (and check under) the new key.
    expect(routingKeyOverlap(during, NOW)).toEqual({ open: true, until: '2026-11-08T12:00:00.000Z' });
    for (const [kind, value] of Object.entries(old)) expect(verifyTenantCredential(value, kind, during, NOW)).toEqual(claim);
    // A refresh during the window (src/tenancy/oauth-token.js: verify the old refresh credential, issue new ones) moves the person to the new key.
    const refreshed = verifyTenantCredential(old.trf, 'trf', during, NOW);
    const moved = { tac: issueTenantCredential('tac', refreshed, during), trf: issueTenantCredential('trf', refreshed, during) };
    for (const [kind, value] of Object.entries(moved)) {
      expect(verifyTenantCredential(value, kind, during, NOW)).toEqual(claim);
      expect(verifyTenantCredential(value, kind, after, NOW)).toEqual(claim);
      expect(verifyTenantCredential(value, kind, before, NOW)).toBeNull();
    }
    // 3. After the window ends (or the previous key is removed): only the new key works.
    const later = Date.parse('2026-11-08T12:00:01Z');
    for (const [kind, value] of Object.entries(old)) {
      expect(verifyTenantCredential(value, kind, during, later)).toBeNull();
      expect(verifyTenantCredential(value, kind, after, NOW)).toBeNull();
    }
    for (const [kind, value] of Object.entries(moved)) expect(verifyTenantCredential(value, kind, during, later)).toEqual(claim);
    expect(routingKeyOverlap(during, later).open).toBe(false);
  });

  it('the previous routing key is never used to issue, and any doubtful window setting means strict (no previous key)', () => {
    const old = issueTenantCredential('tac', claim, before);
    // New credentials are always signed with the current key only.
    expect(verifyTenantCredential(issueTenantCredential('tac', claim, during), 'tac', before, NOW)).toBeNull();
    const far = new Date(NOW + (ROUTING_OVERLAP_MAX_DAYS + 1) * 86400000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    for (const bad of [
      { GITHUB_TENANT_ROUTING_KEY_PREVIOUS_UNTIL: undefined },
      { GITHUB_TENANT_ROUTING_KEY_PREVIOUS_UNTIL: 'next week' },
      { GITHUB_TENANT_ROUTING_KEY_PREVIOUS_UNTIL: '2026-11-08' },
      { GITHUB_TENANT_ROUTING_KEY_PREVIOUS_UNTIL: '2026-10-31T00:00:00Z' },
      { GITHUB_TENANT_ROUTING_KEY_PREVIOUS_UNTIL: far },
      { GITHUB_TENANT_ROUTING_KEY_PREVIOUS: 'too-short' },
      { GITHUB_TENANT_ROUTING_KEY_PREVIOUS: NEW },
      { GITHUB_PRIVATE_TENANT_PILOT: 'disabled' }
    ]) {
      const env = { ...during, ...bad };
      for (const k of Object.keys(bad)) if (bad[k] === undefined) delete env[k];
      expect(verifyTenantCredential(old, 'tac', env, NOW)).toBeNull();
      expect(routingKeyOverlap(env, NOW).open).toBe(false);
    }
    expect(JSON.stringify(routingKeyOverlap(during, NOW))).not.toContain(OLD);
  });
});
