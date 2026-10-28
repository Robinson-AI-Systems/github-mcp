// Contract for owner settings, the production switch and "pending owner confirmation" states (B-2). Run against the in-memory
// fake and real PostgreSQL.
import { describe, expect, it } from 'vitest';

const state = (c) => c.repeat(43);

export function runSettingsContract(name, make) {
  describe(`owner settings and production switch: ${name}`, () => {
    it('stores a JSON setting, replaces it, and answers null for an unknown one', async () => {
      const db = await make();
      expect(await db.getSetting('production_names')).toBeNull();
      await db.setSetting('production_names', { environments: ['production'], branches: [] });
      expect(await db.getSetting('production_names')).toEqual({ environments: ['production'], branches: [] });
      await db.setSetting('production_names', { environments: ['live'], branches: ['release/*'] });
      expect(await db.getSetting('production_names')).toEqual({ environments: ['live'], branches: ['release/*'] });
      await expect(db.setSetting('Bad Key', 1)).rejects.toThrow(TypeError);
      await expect(db.setSetting('', 1)).rejects.toThrow(TypeError);
    });

    it('atomically claims and advances non-secret setting revisions without lost updates',async()=>{
      const db=await make(),key='scanner_revision_contract';
      const first=await Promise.all([db.compareAndSetSetting(key,0,{revision:1,settings:{name:'first'}}),db.compareAndSetSetting(key,0,{revision:1,settings:{name:'second'}})]);
      expect(first.filter(Boolean)).toHaveLength(1);expect(await db.getSetting(key)).toEqual(first.find(Boolean));
      const second=await Promise.all([db.compareAndSetSetting(key,1,{revision:2,settings:{name:'a'}}),db.compareAndSetSetting(key,1,{revision:2,settings:{name:'b'}})]);
      expect(second.filter(Boolean)).toHaveLength(1);expect(await db.getSetting(key)).toEqual(second.find(Boolean));
      expect(await db.compareAndSetSetting(key,1,{revision:2})).toBeNull();
      expect(await db.compareAndSetSetting('scanner_absent_revision',3,{revision:4})).toBeNull();
      await expect(db.compareAndSetSetting('Bad Key',0,{revision:1})).rejects.toThrow(TypeError);
      await expect(db.compareAndSetSetting(key,2,{revision:8})).rejects.toThrow(TypeError);
    });

    it('turns production on and off for a known account only', async () => {
      const db = await make();
      await db.upsertAccount({ login: 'example-org', accountId: 1, accountType: 'Organization', label: 'Example', credentialKind: 'app' });
      expect((await db.getAccount('example-org')).production_enabled).toBe(false);
      expect(await db.setProductionEnabled('Example-Org', true)).toBe(true);
      expect((await db.getAccount('example-org')).production_enabled).toBe(true);
      expect((await db.listAccounts())[0].production_enabled).toBe(true);
      expect(await db.setProductionEnabled('example-org', false)).toBe(true);
      expect((await db.getAccount('example-org')).production_enabled).toBe(false);
      expect(await db.setProductionEnabled('nobody', true)).toBe(false);
    });

    it('keeps a pending owner confirmation per account, single use, case-insensitive, and purpose-bound', async () => {
      const db = await make();
      await db.createSetupState({ state: state('a'), purpose: 'enable_production', accountHint: 'Example-Org', ttlSeconds: 600 });
      await db.createSetupState({ state: state('b'), purpose: 'manifest', accountHint: 'example-org' });
      expect(await db.hasPendingSetupState('enable_production', 'example-org')).toBe(true);
      expect(await db.hasPendingSetupState('enable_production', 'other')).toBe(false);
      expect(await db.consumeSetupStateByHint('user_auth', 'example-org')).toBeNull();
      expect(await db.consumeSetupStateByHint('enable_production', 'other')).toBeNull();
      expect(await db.consumeSetupStateByHint('enable_production', '')).toBeNull();
      expect(await db.consumeSetupStateByHint('enable_production', 'example-org')).toEqual({ account_hint: 'Example-Org' });
      expect(await db.consumeSetupStateByHint('enable_production', 'example-org')).toBeNull();
      expect(await db.hasPendingSetupState('enable_production', 'example-org')).toBe(false);
      expect(await db.consumeSetupState(state('b'), 'manifest')).toMatchObject({ account_hint: 'example-org' });
    });

    it('does not offer an expired confirmation', async () => {
      const db = await make();
      await db.createSetupState({ state: state('c'), purpose: 'enable_production', accountHint: 'example-org', ttlSeconds: -5 });
      expect(await db.hasPendingSetupState('enable_production', 'example-org')).toBe(false);
      expect(await db.consumeSetupStateByHint('enable_production', 'example-org')).toBeNull();
    });
  });
}

export function runProtectedContract(name, make) {
  describe(`protected resources list: ${name}`, () => {
    const entry = { kind: 'repo', target: 'Example-Org/Server', level: 'pr-only', reason: 'the server itself' };
    it('saves, lists sorted, changes in place, and removes entries (targets are stored lowercase)', async () => {
      const db = await make();
      expect(await db.listProtectedResources()).toEqual([]);
      await db.saveProtectedResource(entry);
      await db.saveProtectedResource({ kind: 'installation', target: '*', level: 'locked', reason: 'own Apps' });
      await db.saveProtectedResource({ ...entry, level: 'locked', reason: 'now fully locked' });
      const list = await db.listProtectedResources();
      expect(list.map((e) => `${e.kind}:${e.target}:${e.level}`)).toEqual(['installation:*:locked', 'repo:example-org/server:locked']);
      expect(list[1].reason).toBe('now fully locked');
      expect(await db.removeProtectedResource('repo', 'EXAMPLE-ORG/server')).toBe(true);
      expect(await db.removeProtectedResource('repo', 'example-org/server')).toBe(false);
      expect((await db.listProtectedResources()).map((e) => e.target)).toEqual(['*']);
    });
    it('refuses malformed entries with a plain sentence', async () => {
      const db = await make();
      for (const bad of [{ ...entry, kind: 'org' }, { ...entry, level: 'open' }, { ...entry, target: 'no-slash' }, { ...entry, target: 'a/b/c' }, { ...entry, reason: '' },
        { kind: 'installation', target: 'abc', level: 'locked', reason: 'why' }]) {
        await expect(db.saveProtectedResource(bad)).rejects.toThrow(TypeError);
      }
      expect(await db.listProtectedResources()).toEqual([]);
    });
    it('seeds once ever: a removed seed entry is not put back, and existing entries are not overwritten', async () => {
      const db = await make();
      await db.saveProtectedResource({ ...entry, level: 'locked', reason: 'owner choice' });
      expect(await db.seedProtectedResources([entry, { kind: 'repo', target: 'example-org/other', level: 'pr-only', reason: 'seed' }])).toBe(true);
      expect((await db.listProtectedResources()).map((e) => `${e.target}:${e.level}`)).toEqual(['example-org/other:pr-only', 'example-org/server:locked']);
      await db.removeProtectedResource('repo', 'example-org/other');
      expect(await db.seedProtectedResources([{ kind: 'repo', target: 'example-org/other', level: 'pr-only', reason: 'seed' }])).toBe(false);
      expect((await db.listProtectedResources()).map((e) => e.target)).toEqual(['example-org/server']);
    });
  });
}

export function runSpendContract(name, make) {
  describe(`spend limit and monthly spend: ${name}`, () => {
    const change = (extra) => ({ account: 'example-org', mode: 'production', tool: 'github_x', target: 'example-org', summary: 'did it', ...extra });
    it('sets the limit in whole cents for a known account only', async () => {
      const db = await make();
      await db.upsertAccount({ login: 'example-org', accountId: 1, accountType: 'Organization', label: 'Example', credentialKind: 'app' });
      expect((await db.getAccount('example-org')).spend_limit_cents).toBe(0);
      expect(await db.setSpendLimitCents('Example-Org', 5000)).toBe(true);
      expect((await db.getAccount('example-org')).spend_limit_cents).toBe(5000);
      expect(await db.setSpendLimitCents('nobody', 100)).toBe(false);
      for (const bad of [-1, 1.5, '5', 1e12]) await expect(db.setSpendLimitCents('example-org', bad)).rejects.toThrow(TypeError);
    });
    it('sums real spend since a moment: counts sent and uncertain changes, skips previews, rejections, other accounts and older rows', async () => {
      const db = await make();
      const since = new Date(Date.now() - 60_000);
      await db.recordChange(change({ dryRun: true, spendCents: 900, summary: 'preview' }));
      const a = await db.claimChange(change({ spendCents: 1900, requestKey: 'k1'.padEnd(20, 'x') }));
      await db.finishChange(a.id, { summary: 'seat assigned', confirmed: true });
      const b = await db.claimChange(change({ spendCents: 3800, requestKey: 'k2'.padEnd(20, 'x') }));
      await db.finishChange(b.id, { summary: 'UNCERTAIN: seat', confirmed: false });
      const c = await db.claimChange(change({ spendCents: 7600, requestKey: 'k3'.padEnd(20, 'x') }));
      await db.finishChange(c.id, { summary: 'REJECTED: seat', confirmed: false, releaseKey: true });
      const d = await db.claimChange(change({ account: 'other-org', spendCents: 100, requestKey: 'k4'.padEnd(20, 'x') }));
      await db.finishChange(d.id, { summary: 'seat', confirmed: true });
      await db.claimChange(change({ spendCents: 500, requestKey: 'k5'.padEnd(20, 'x') }));
      expect(await db.sumSpendCents('Example-Org', since)).toBe(1900 + 3800 + 500);
      expect(await db.sumSpendCents('example-org', new Date(Date.now() + 3_600_000))).toBe(0);
      expect(await db.sumSpendCents('nobody', since)).toBe(0);
    });
  });
}
