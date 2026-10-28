// G-3 part 2: the owner types a secret on the setup page. The value is sealed on the server and sent to GitHub; it is never stored,
// logged, written to the change log or shown on any page.
import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import sodium from 'libsodium-wrappers';
import { createCredentials } from '../../src/github/credentials.js';
import { createSetupHandlers } from '../../src/github/setup-page.js';
import { createFakeDb } from '../../test/helpers/fake-db.js';
import { makeFakeGitHub } from '../../test/helpers/fake-github.js';
import { call, request } from '../../test/helpers/http-harness.js';

await sodium.ready;
const PAIR = sodium.crypto_box_keypair();
const KEY = { key_id: 'k1', key: sodium.to_base64(PAIR.publicKey, sodium.base64_variants.ORIGINAL) };
const ORIGIN = 'https://github-mcp.example.test';
const PASS = 'fixture-admin-passphrase';
const PROD = { VERCEL_ENV: 'production', PUBLIC_BASE_URL: ORIGIN, ADMIN_PASSPHRASE: PASS, TOKEN_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64url') };
const VALUE = 'super-secret-value-12345';
const ID = 'r'.repeat(43);
const SCOPE = { kind: 'actions', level: 'repo', owner: 'example-org', repo: 'hello', name: 'DEPLOY_KEY' };
const REPO = 'repos/{owner}/{repo}/actions/secrets';

async function build({ env = PROD, productionEnabled = false, scope = SCOPE } = {}) {
  const db = createFakeDb();
  await db.initSchema();
  const gh = makeFakeGitHub();
  const credentials = createCredentials({ db, env, fetch: gh.fetch });
  await db.upsertAccount({ login: 'example-org', accountId: 1001, accountType: 'Organization', label: 'Example Org', credentialKind: 'fine_grained' });
  await credentials.storeFineGrained('example-org', 'github_pat_FAKE0123456789abcdefghij', { expiresAt: null });
  if (productionEnabled) await db.setProductionEnabled('example-org', true);
  await db.createSecretRequest({ id: ID, account: 'example-org', scope });
  const handlers = createSetupHandlers({ db, credentials, env, fetch: gh.fetch });
  const csrf = 'c'.repeat(43);
  const post = (fields) => call(handlers.setup, request('POST', { csrf, passphrase: PASS, action: 'enter-secret', id: ID, value: VALUE, ...fields }, { origin: ORIGIN, cookie: `github_setup_csrf=${csrf}` }));
  return { db, gh, handlers, post };
}
const arrangeOk = (gh) => {
  gh.when(`GET /${REPO}/public-key`).reply(200, KEY);
  gh.when(`PUT /${REPO}/{secret_name}`).reply(201, {});
  gh.when(`GET /${REPO}/{secret_name}`).reply(200, { name: 'DEPLOY_KEY', updated_at: '2026-10-11T00:00:00Z' });
};
const everything = async (t, res) => JSON.stringify([res.body, res.headers, await t.db.listChanges({ limit: 50, includePreviews: true })]);

describe('typing a secret on the setup page', () => {
  it('shows where the secret goes, with a password box, and never a value', async () => {
    const t = await build();
    const res = await call(t.handlers.setup, request('GET', { secret: ID }));
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('actions secret DEPLOY_KEY in example-org/hello');
    expect(res.body).toMatch(/type="password" name="value"/);
    const unknown = await call(t.handlers.setup, request('GET', { secret: 'z'.repeat(43) }));
    expect(unknown.body).toContain('unknown, already used or expired');
    expect(unknown.body).not.toMatch(/name="value"/);
  });

  it('seals the value for GitHub, sends it once and leaves it nowhere else', async () => {
    const t = await build();
    arrangeOk(t.gh);
    const res = await t.post({});
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Done. DEPLOY_KEY is saved');
    const put = t.gh.calls.find((c) => c.method === 'PUT');
    expect(put.body.key_id).toBe('k1');
    expect(sodium.to_string(sodium.crypto_box_seal_open(sodium.from_base64(put.body.encrypted_value, sodium.base64_variants.ORIGINAL), PAIR.publicKey, PAIR.privateKey))).toBe(VALUE);
    expect(await everything(t, res)).not.toContain(VALUE);
    expect(JSON.stringify(t.gh.calls.filter((c) => c !== put))).not.toContain(VALUE);
    expect(await t.db.listChanges({ limit: 5 })).toEqual(expect.arrayContaining([expect.objectContaining({ tool: 'setup_enter_secret', confirmed: true })]));
    expect(t.gh.invalid).toEqual([]);
    expect((await t.post({})).statusCode).toBe(410);
    expect(t.gh.calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
  });

  it('puts the request back when GitHub refuses, so the owner can try again', async () => {
    const t = await build();
    t.gh.when(`GET /${REPO}/public-key`).reply(200, KEY);
    t.gh.when(`PUT /${REPO}/{secret_name}`).reply(403, { message: 'Resource not accessible' });
    const res = await t.post({});
    expect(res.statusCode).toBe(403);
    expect(res.body).toContain('Nothing was saved');
    expect(await everything(t, res)).not.toContain(VALUE);
    expect(await t.db.getSecretRequest(ID)).not.toBeNull();
  });

  it('is refused off the production deployment, with a wrong passphrase, or for an empty value, and the request stays waiting', async () => {
    const preview = await build({ env: { ...PROD, VERCEL_ENV: 'preview' } });
    expect((await preview.post({})).statusCode).toBe(403);
    expect(await preview.db.getSecretRequest(ID)).not.toBeNull();
    const t = await build();
    expect((await t.post({ passphrase: 'nope' })).statusCode).toBe(401);
    expect((await t.post({ value: '' })).statusCode).toBe(400);
    expect(await t.db.getSecretRequest(ID)).not.toBeNull();
    expect(t.gh.calls).toEqual([]);
  });

  it('honors the authenticated owner secret submission despite a standing protected list', async () => {
    const t = await build();
    await t.db.saveProtectedResource({ kind: 'repo', target: 'example-org/hello', level: 'locked', reason: 'test' });
    arrangeOk(t.gh);
    const res = await t.post({});
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Done. DEPLOY_KEY is saved');
    expect(t.gh.calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
    expect(await t.db.getSecretRequest(ID)).toBeNull();
    expect(await everything(t, res)).not.toContain(VALUE);
  });

  it('an authenticated owner can set an organization secret with legacy production off', async () => {
    const org = { kind: 'actions', level: 'org', owner: 'example-org', name: 'DEPLOY_KEY', visibility: 'all' };
    const on = await build({ scope: org });
    on.gh.when('GET /orgs/{org}/actions/secrets/public-key').reply(200, KEY);
    on.gh.when('PUT /orgs/{org}/actions/secrets/{secret_name}').reply(201, {});
    on.gh.when('GET /orgs/{org}/actions/secrets/{secret_name}').reply(200, { name: 'DEPLOY_KEY', updated_at: '2026-10-11T00:00:00Z' });
    expect((await on.post({})).statusCode).toBe(200);
    expect(on.gh.calls.find((c) => c.method === 'PUT').body.visibility).toBe('all');
    expect(on.gh.invalid).toEqual([]);
  });
});
