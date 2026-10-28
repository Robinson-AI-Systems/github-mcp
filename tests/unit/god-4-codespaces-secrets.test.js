// GOD-4 A: personal Codespaces secrets (level "user") — routes, the nine write-contract checks, and the plain refusal without a master token.
import { describe, expect, it } from 'vitest';
import sodium from 'libsodium-wrappers';
import { runWriteContract, makeWorld, parse } from '../../test/helpers/write-contract.js';
import * as secrets from '../../src/tools/secrets.js';
import { secretRoutes } from '../../src/github/secret-seal.js';

await sodium.ready;
const PAIR = sodium.crypto_box_keypair();
const KEY = { key_id: 'k1', key: sodium.to_base64(PAIR.publicKey, sodium.base64_variants.ORIGINAL) };
const def = (name) => ({ tool: secrets.tools.find((t) => t.name === name), handler: secrets.handlers[name] });
const seq = (gh, route, steps) => gh.when(route).replySequence(steps.map(([status, body]) => ({ status, body })));
const withMaster = (scopes = ['codespace']) => async (w) => {
  w.credentials.masterStatus = async () => ({ enrolled: true, scopes, expires_at: null });
  const base = w.credentials.token.bind(w.credentials);
  w.credentials.token = async (o) => (o.cred === 'M' ? 'ghp_FAKEmaster' : base(o));
};
const P = 'user/codespaces/secrets';
const S = (updated_at, extra = {}) => ({ name: 'DEV_KEY', updated_at, ...extra });
const opts = { profile: 'full', needsConfirm: true, production: true, prepare: withMaster() };
const ARGS = { level: 'user', kind: 'codespaces', name: 'DEV_KEY' };

runWriteContract({
  ...opts, label: 'github_secret_set generate (personal codespaces)', definition: def('github_secret_set'), args: { ...ARGS, valueFrom: 'generate' },
  arrange(gh, outcome) {
    seq(gh, `GET /${P}/{secret_name}`, [[200, S('2026-10-10T00:00:00Z')], [200, S(outcome === 'ok' ? '2026-10-11T00:00:00Z' : '2026-10-10T00:00:00Z')]]);
    gh.when(`GET /${P}/public-key`).reply(200, KEY);
    gh.when(`PUT /${P}/{secret_name}`).reply(204, null);
  }
});
runWriteContract({
  ...opts, label: 'github_secret_delete (personal codespaces)', definition: def('github_secret_delete'), args: ARGS,
  arrange(gh, outcome) {
    seq(gh, `GET /${P}/{secret_name}`, outcome === 'ok' ? [[200, S('a')], [404, { message: 'Not Found' }]] : [[200, S('a')], [200, S('a')]]);
    gh.when(`DELETE /${P}/{secret_name}`).reply(204, null);
  }
});

describe('GOD-4 personal Codespaces secrets', () => {
  it('a personal secret change is a production change: a preview connection is refused', async () => {
    const w = await makeWorld({ profile: 'full', mode: 'preview' });
    await withMaster()(w);
    w.gh.when(`GET /${P}/{secret_name}`).reply(404, { message: 'Not Found' });
    const out = parse(await secrets.handlers.github_secret_set({ ...ARGS, valueFrom: 'generate', dryRun: true }, w.ctx));
    expect(out.status).toBe('preview');
    expect(w.gh.calls.filter((c) => c.method !== 'GET')).toEqual([]);
  });
  it('github_secret_set_repo_access accepts level user in its schema', () => {
    expect(secrets.tools.find((t) => t.name === 'github_secret_set_repo_access').inputSchema.properties.level).toMatchObject({ enum: ['user'] });
  });
  it('has the three personal paths and no owner parameter', () => {
    expect(secretRoutes({ kind: 'codespaces', level: 'user', name: 'X' })).toMatchObject({ key: 'GET /user/codespaces/secrets/public-key', one: '/user/codespaces/secrets/{secret_name}', params: {} });
  });
  it('refuses non-codespaces kinds at the user level', () => {
    expect(() => secretRoutes({ kind: 'actions', level: 'user' })).toThrow(/Codespaces/);
  });
  it('uses the master token for the request', async () => {
    const w = await makeWorld({ profile: 'full', mode: 'preview' });
    await withMaster()(w);
    w.gh.when(`GET /${P}/{secret_name}`).reply(404, { message: 'Not Found' });
    await secrets.handlers.github_secret_set({ ...ARGS, dryRun: true }, w.ctx);
    const c = w.gh.calls.find((x) => x.route === `GET /${P}/{secret_name}`);
    expect(c.headers.authorization).toContain('ghp_FAKEmaster');
  });
  it('without a master token is a plain refusal naming codespace, not a crash', async () => {
    const w = await makeWorld({ profile: 'full', mode: 'production' });
    const out = parse(await secrets.handlers.github_secret_set({ ...ARGS, dryRun: true }, w.ctx));
    expect(JSON.stringify(out)).toMatch(/codespace/i);
    expect(w.gh.calls.filter((c) => c.method !== 'GET')).toEqual([]);
    const applied = parse(await secrets.handlers.github_secret_delete({ ...ARGS, confirm: true }, w.ctx));
    expect(JSON.stringify(applied)).toMatch(/codespace/i);
    expect(applied.status).not.toBe('applied');
  });
});
