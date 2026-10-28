// R-1: the gates and the credential limit that bind a scoped pass, plus the preview-only pass tool.
import { describe, expect, it } from 'vitest';
import { githubFor } from '../../src/github/client.js';
import { spendGate } from '../../src/tools/spend-guard.js';
import { passAccessGate, createGates } from '../../src/tools/gates.js';
import { handlers } from '../../src/tools/server.js';
import { parse } from '../../test/helpers/write-contract.js';
import { passWorld } from '../../test/helpers/rtc-fixture.js';

const passConnection = (extra = {}) => Object.freeze({ client_id: 'rtc-' + 'c'.repeat(24), default_account: 'example-org', accounts: Object.freeze(['example-org']), mode: 'preview', profile: 'everyday',
  listing: 'compact', pass: true, allow_writes: true, allow_access_changes: false, spend_limit_cents: 0, areas: null, repos: null, ...extra });

describe('credential limit', () => {
  const tokenFor = async (connection, scope) => {
    const asked = [];
    await githubFor({ connection, credentials: { token: async (input) => { asked.push(input.scope); return 'ghs_FAKE0123456789abcdefghij'; } }, fetch: async () => new Response('{}') }, { owner: 'example-org', scope });
    return asked[0];
  };
  it('narrows installation tokens to the pass\'s repositories', async () => {
    expect((await tokenFor(passConnection({ repos: ['example-org/app', 'example-org/web'] }), undefined)).repositories).toEqual(['app', 'web']);
    expect((await tokenFor(passConnection({ repos: ['example-org/app', 'example-org/web'] }), { repositories: ['web'] })).repositories).toEqual(['web']);
  });
  it('never widens: a request for a repository outside the pass gets the pass list, not all repositories', async () => {
    expect((await tokenFor(passConnection({ repos: ['example-org/app'] }), { repositories: ['secret'] })).repositories).toEqual(['app']);
  });
  it('leaves tokens alone for a pass without a repository list', async () => {
    expect(await tokenFor(passConnection(), undefined)).toBeUndefined();
  });
});

describe('pass gates', () => {
  it('passAccessGate refuses access changes unless the pass allows them', async () => {
    const gate = passAccessGate();
    const input = (connection, widening) => ({ ctx: { connection }, classification: { accessWidening: widening }, declarations: {} });
    expect(await gate(input(passConnection(), true))).toMatchObject({ by: 'pass access permission' });
    expect(await gate(input(passConnection({ allow_access_changes: true }), true))).toBeNull();
    expect(await gate(input(passConnection(), false))).toBeNull();
    expect(await gate(input({ client_id: 'login' }, true))).toBeNull();
  });
  it('the spend gate gives a pass only its own allowance, on top of the account limit', async () => {
    const world = await passWorld();
    await world.db.setSpendLimitCents('example-org', 100000);
    const gate = spendGate();
    const run = (connection, cents) => gate({ name: 'github_x', args: {}, ctx: { ...world.ctx, connection }, target: { owner: 'example-org' }, classification: { spendCents: cents }, declarations: { spend: true } });
    expect(await run(passConnection({ spend_limit_cents: 0 }), 500)).toMatchObject({ by: 'pass spend allowance' });
    expect(await run(passConnection({ spend_limit_cents: 400 }), 500)).toMatchObject({ by: 'pass spend allowance' });
    expect(await run(passConnection({ spend_limit_cents: 1000 }), 500)).toMatchObject({ confirm: expect.any(String) });
    expect(await run({ client_id: 'login', accounts: ['example-org'] }, 500)).toMatchObject({ confirm: expect.any(String) });
  });
  it('is part of the standard gate list, first', () => {
    expect(createGates()).toHaveLength(6);
  });
});

describe('github_create_pass', () => {
  const call = async (w, args) => parse(await handlers.github_create_pass(args, w.ctx));
  it('previews, then makes a preview pass that the owner can find, list and switch off; the pass itself is never in the reply', async () => {
    const w = await passWorld();
    const preview = await call(w, { account: 'example-org', repos: ['example-org/app'], days: 3, dryRun: true });
    expect(preview).toMatchObject({ status: 'preview' });
    expect(preview.preview).toMatch(/preview read_only pass for example-org.*no spending.*no access changes.*3 day/);
    const made = await call(w, { account: 'example-org', repos: ['example-org/app'], days: 3, confirm: true });
    expect(made).toMatchObject({ status: 'applied', confirmed: true });
    expect(JSON.stringify(made)).not.toMatch(/rtc_pass_/);
    expect(made.result.connection_id).toMatch(/^rtc-[a-f0-9]{24}$/);
    expect((await w.db.listConnections()).some((c) => c.client_id === made.result.connection_id && c.kind === 'pass')).toBe(true);
  });
  it('refuses settings a preview pass may not have', async () => {
    const w = await passWorld();
    for (const args of [{ account: 'example-org', profile: 'read_only', allowWrites: true }, { account: 'example-org', repos: ['other-org/x'] }, { account: 'unknown-org' }]) {
      const out = await call(w, { ...args, confirm: true });
      expect(out.status).not.toBe('applied');
    }
  });
});
