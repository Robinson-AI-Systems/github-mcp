import { describe, expect, it } from 'vitest';
import { MASTER_AREAS, masterUnlocks } from '../../src/github/master-areas.js';
import { masterTokenLink, MASTER_SCOPES } from '../../src/tenancy/master-credential.js';
import { registry } from '../../src/tools/index.js';

describe('GOD-3 master areas', () => {
  it('marks areas unlocked or locked with the permission to tick', () => {
    const rows = Object.fromEntries(masterUnlocks(['gist', 'user']).map((r) => [r.area, r]));
    expect(rows.Gists.unlocked).toBe(true);
    expect(rows['Your profile, emails, follows and blocks'].unlocked).toBe(true);
    expect(rows.Packages).toEqual({ area: 'Packages', unlocked: false, needs: 'write:packages' });
  });
  it('repo scope unlocks stars', () => {
    const rows = Object.fromEntries(masterUnlocks(['repo']).map((r) => [r.area, r]));
    expect(rows['Stars, watching and star lists'].unlocked).toBe(true);
  });
  it('every listed tool name exists', () => {
    const names = new Set(registry.tools.map((t) => t.name));
    for (const a of MASTER_AREAS) for (const t of a.tools) expect(names.has(t), t).toBe(true);
  });
  it('master link is unchanged without options and adds enterprise once when asked', () => {
    const old = 'https://github.com/settings/tokens/new?description=' + encodeURIComponent('GitHub Unleashed master token') +
      '&scopes=' + MASTER_SCOPES.map(encodeURIComponent).join(',');
    expect(masterTokenLink()).toBe(old);
    const link = masterTokenLink({ enterprise: true });
    expect(link.split('admin%3Aenterprise').length - 1).toBe(1);
    expect(link).toContain('read%3Aenterprise');
  });
});
