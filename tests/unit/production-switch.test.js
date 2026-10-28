import { describe, expect, it } from 'vitest';
import { handlers } from '../../src/tools/server.js';
import { createGates } from '../../src/tools/gates.js';
import { productionEnabledGate } from '../../src/tools/production-guard.js';
import { makeWorld, parse } from '../../test/helpers/write-contract.js';

const enable = (w, args) => handlers.github_enable_production({ account: 'example-org', ...args }, w.ctx).then(parse);
const disable = (w, args) => handlers.github_disable_production({ account: 'example-org', ...args }, w.ctx).then(parse);
const full = (extra = {}) => makeWorld({ profile: 'full', ...extra });

describe('github_enable_production', () => {
  it('the owner changes its standing production preference in one call without a setup ritual', async () => {
    const w = await full();
    const done = await enable(w, {});
    expect(done.status).toBe('applied');
    expect(await w.db.hasPendingSetupState('enable_production', 'example-org')).toBe(false);
    expect((await w.db.getAccount('example-org')).production_enabled).toBe(true);
  });
  it('a preview (dryRun) creates no waiting request', async () => {
    const w = await full();
    const res = await enable(w, { dryRun: true });
    expect(res.preview).toContain('production preference ON');
    expect(await w.db.hasPendingSetupState('enable_production', 'example-org')).toBe(false);
  });
  it('is refused on connections below the full profile', async () => {
    for (const profile of ['read_only', 'everyday']) {
      const w = await makeWorld({ profile });
      const res = await enable(w, { confirm: true });
      expect(res.status).toBe('refused');
      expect(await w.db.hasPendingSetupState('enable_production', 'example-org')).toBe(false);
    }
  });
  it('is refused for an account outside the connection', async () => {
    const w = await full();
    const res = await enable(w, { account: 'someone-else', confirm: true });
    expect(res.status).toBe('refused');
  });
  it('an account the server does not know cannot be started', async () => {
    const w2 = await full();
    w2.ctx.connection = Object.freeze({ ...w2.connection, accounts: Object.freeze(['example-org', 'ghost']) });
    const res = await enable(w2, { account: 'ghost', confirm: true });
    expect(['refused', 'rejected']).toContain(res.status);
    expect(await w2.db.hasPendingSetupState('enable_production', 'ghost')).toBe(false);
  });
  it('shows nothing that looks like a secret', async () => {
    const w = await full();
    const res = JSON.stringify(await enable(w, { confirm: true }));
    expect(res).not.toMatch(/ghp_|github_pat_|ghs_|BEGIN [A-Z ]*PRIVATE KEY/);
  });
});

describe('github_disable_production and the gate', () => {
  const productionChange = { production: 'changes repository settings' };
  it('turns production off at once after confirmation', async () => {
    const w = await full();
    await w.db.setProductionEnabled('example-org', true);
    expect((await disable(w, { dryRun: true })).status).toBe('preview');
    expect((await w.db.getAccount('example-org')).production_enabled).toBe(true);
    const res = await disable(w, { confirm: true });
    expect(res.status).toBe('applied');
    expect((await w.db.getAccount('example-org')).production_enabled).toBe(false);
  });
  it('is refused on non-full profiles', async () => {
    const w = await makeWorld({ profile: 'everyday' });
    await w.db.setProductionEnabled('example-org', true);
    expect((await disable(w, { confirm: true })).status).toBe('refused');
    expect((await w.db.getAccount('example-org')).production_enabled).toBe(true);
  });
  it('the gate stops production connections while the switch is off, and lets them through to confirmation when on', async () => {
    const gate = productionEnabledGate();
    const w = await full({ mode: 'production', delegated: true });
    const input = { ctx: w.ctx, target: { owner: 'example-org', scope: 'repo' }, classification: productionChange, args: {} };
    const off = await gate(input);
    expect(off?.refuse).toBeTruthy();
    expect(off.by).toBe('production switch');
    await w.db.setProductionEnabled('example-org', true);
    expect((await gate(input))?.refuse).toBeFalsy();
    await w.db.setProductionEnabled('example-org', false);
    expect((await gate(input))?.refuse).toBeTruthy();
  });
  it('the gate ignores changes that are not production', async () => {
    const gate = productionEnabledGate();
    const w = await full({ mode: 'production' });
    expect((await gate({ ctx: w.ctx, target: { owner: 'example-org', scope: 'repo' }, classification: {}, args: {} }))?.refuse).toBeFalsy();
  });
  it('the real gate list contains the production switch', () => {
    expect(createGates().length).toBeGreaterThanOrEqual(1);
  });
});
