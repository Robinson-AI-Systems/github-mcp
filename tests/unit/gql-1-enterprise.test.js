// GQL-1: enterprise-wide member policies and the enterprise profile (master token only, enterprises the person administers).
import { describe, expect, it } from 'vitest';
import { makeWorld, runWriteContract, parse } from '../../test/helpers/write-contract.js';
import { createDispatch } from '../../src/tools/dispatch.js';
import { registry } from '../../src/tools/index.js';
import * as write from '../../src/tools/enterprise-policy.js';
import { POLICIES } from '../../src/tools/enterprise-policy.js';
import { REFUSED_MUTATIONS } from '../../src/github/graphql-writes.js';
import { COVERED_BY_TOOL } from '../../src/github/capability-inventory.js';

const SLUG = 'acme-ent';
function withMaster(w, scopes = ['admin:enterprise']) {
  const base = w.credentials;
  const credentials = Object.assign(Object.create(base), {
    masterStatus: async () => ({ enrolled: true, scopes, expires_at: null }),
    authorizeOptionalRequest: async () => true,
    token: async (o) => (o.cred === 'M' ? 'ghp_FAKEmaster' : base.token(o))
  });
  w.credentials = credentials;
  w.ctx = { ...w.ctx, credentials };
  return w;
}
/** A tiny enterprise GraphQL: the admin list, the policy/profile reads (state flips after the mutation) and the mutations. */
function arrange(gh, { policy = {}, profile = {}, flips = true, admin = [{ slug: SLUG, name: 'Acme' }] } = {}) {
  const state = { policy: { membersCanDeleteRepositoriesSetting: 'ENABLED', defaultRepositoryPermissionSetting: 'READ', ...policy },
    profile: { name: 'Acme', description: 'old', location: 'Denver', websiteUrl: null, securityContactEmail: null, ...profile }, sent: [] };
  gh.when('POST /graphql').reply(200, (req) => {
    const q = String(req.body?.query ?? '');
    const input = req.body?.variables?.input;
    if (q.includes('EnterprisePolicySet') || q.includes('EnterpriseProfileSet')) {
      state.sent.push(input);
      if (flips) {
        if (q.includes('EnterprisePolicySet')) {
          const name = q.match(/(updateEnterprise\w+)\(/)[1];
          const p = Object.values(POLICIES).find((x) => x.mutation === name);
          state.policy[p.read] = input.settingValue;
          if (input.policyValue) state.policy.allowPrivateRepositoryForkingSettingPolicyValue = input.policyValue;
        } else Object.assign(state.profile, Object.fromEntries(Object.entries(input).filter(([k]) => k !== 'enterpriseId')));
      }
      return { data: { x: { clientMutationId: null } } };
    }
    if (q.includes('EnterprisePolicies')) return { data: { enterprise: { id: 'E1', ownerInfo: { ...state.policy } } } };
    if (q.includes('EnterpriseProfile')) return { data: { enterprise: { id: 'E1', ...state.profile } } };
    if (q.includes('organizations(first')) return { data: { enterprise: { organizations: { totalCount: 1, nodes: [{ login: 'robinson-ai-scratch' }] } } } };
    return { data: { viewer: { enterprises: { nodes: admin } } } };
  });
  return state;
}
async function call(w, name, args = {}) {
  const run = createDispatch({ env: w.ctx.env, credentials: w.credentials, fetch: w.gh.fetch, now: w.ctx.now, sleep: w.ctx.sleep, gates: [] });
  return run({ registry, name, args, connection: w.connection, db: w.db });
}
const prepare = async (w) => { withMaster(w); };
const base = { needsConfirm: true, production: true, profile: 'full', prepare };
const def = (name) => ({ tool: write.tools.find((t) => t.name === name), handler: write.handlers[name] });

runWriteContract({ ...base, label: 'github_enterprise_policy_set', definition: def('github_enterprise_policy_set'), accessWidening: false,
  args: { enterprise: SLUG, setting: 'members_can_delete_repositories', value: 'DISABLED' },
  arrange: (gh, result) => { arrange(gh, { flips: result === 'ok' }); } });
runWriteContract({ ...base, label: 'github_enterprise_profile_set', definition: def('github_enterprise_profile_set'),
  args: { enterprise: SLUG, description: 'new' },
  arrange: (gh, result) => { arrange(gh, { flips: result === 'ok' }); } });

describe('GQL-1 enterprise policies and profile', () => {
  it('changes one policy, confirms by reading it back, and offers the old value as undo', async () => {
    const w = withMaster(await makeWorld({ profile: 'full', mode: 'production' }));
    const state = arrange(w.gh);
    const preview = parse(await call(w, 'github_enterprise_policy_set', { enterprise: SLUG, setting: 'members_can_delete_repositories', value: 'DISABLED', dryRun: true }));
    expect(preview.status).toBe('preview');
    expect(state.sent).toEqual([]);
    const done = parse(await call(w, 'github_enterprise_policy_set', { enterprise: SLUG, setting: 'members_can_delete_repositories', value: 'DISABLED', confirm: true }));
    expect(done).toMatchObject({ status: 'applied', confirmed: true });
    expect(state.sent).toEqual([{ enterpriseId: 'E1', settingValue: 'DISABLED' }]);
    expect(w.gh.invalid).toEqual([]);
    expect((await w.db.getChange(done.logged.id)).inverse).toMatchObject({ tool: 'github_enterprise_policy_set', args: { setting: 'members_can_delete_repositories', value: 'ENABLED' } });
  });
  it('a value the setting does not accept, and a policy already at that value, are refused before anything is sent', async () => {
    const w = withMaster(await makeWorld({ profile: 'full', mode: 'production' }));
    const state = arrange(w.gh);
    const bad = await call(w, 'github_enterprise_policy_set', { enterprise: SLUG, setting: 'members_can_make_purchases', value: 'NO_POLICY', confirm: true });
    expect(bad.isError).toBe(true);
    const same = await call(w, 'github_enterprise_policy_set', { enterprise: SLUG, setting: 'members_can_delete_repositories', value: 'ENABLED', confirm: true });
    expect(parse(same).status).not.toBe('applied');
    expect(state.sent).toEqual([]);
  });
  it('turning on a widening policy is flagged as an access change', async () => {
    const w = withMaster(await makeWorld({ profile: 'full', mode: 'production' }));
    arrange(w.gh);
    const preview = parse(await call(w, 'github_enterprise_policy_set', { enterprise: SLUG, setting: 'default_repository_permission', value: 'ADMIN', dryRun: true }));
    expect(JSON.stringify(preview)).toMatch(/default permission/i);
    expect(preview.status).toBe('preview');
  });
  it('owner enterprise policies use provider authority despite legacy protected-list entries', async () => {
    const w = withMaster(await makeWorld({ profile: 'full', mode: 'production' }));
    const state = arrange(w.gh);
    await w.db.seedProtectedResources([{ kind: 'repo', target: 'robinson-ai-scratch/guarded', level: 'locked', reason: 'test' }]);
    const out = parse(await call(w, 'github_enterprise_policy_set', { enterprise: SLUG, setting: 'default_repository_permission', value: 'ADMIN', confirm: true }));
    expect(out.status).toBe('applied');
    expect(state.sent).toHaveLength(1);
    const ok = parse(await call(w, 'github_enterprise_policy_set', { enterprise: SLUG, setting: 'organization_projects', value: 'DISABLED', confirm: true }));
    expect(ok.status).toBe('applied');
  });
  it('the forking preview names the requested and current forking policy, and a same-value change with a new forking policy still goes ahead', async () => {
    const w = withMaster(await makeWorld({ profile: 'full', mode: 'production' }));
    const state = arrange(w.gh, { policy: { allowPrivateRepositoryForkingSetting: 'ENABLED', allowPrivateRepositoryForkingSettingPolicyValue: 'SAME_ORGANIZATION' } });
    const args = { enterprise: SLUG, setting: 'allow_private_repository_forking', value: 'ENABLED', forkingPolicy: 'EVERYWHERE' };
    const preview = parse(await call(w, 'github_enterprise_policy_set', { ...args, dryRun: true }));
    expect(JSON.stringify(preview)).toMatch(/EVERYWHERE/);
    expect(JSON.stringify(preview)).toMatch(/SAME_ORGANIZATION/);
    const done = parse(await call(w, 'github_enterprise_policy_set', { ...args, confirm: true }));
    expect(done.status).toBe('applied');
    expect(state.sent).toEqual([{ enterpriseId: 'E1', settingValue: 'ENABLED', policyValue: 'EVERYWHERE' }]);
  });
  it('an enterprise the person does not administer is refused and nothing is sent', async () => {
    const w = withMaster(await makeWorld({ profile: 'full', mode: 'production' }));
    const state = arrange(w.gh);
    const out = await call(w, 'github_enterprise_policy_set', { enterprise: 'someone-elses', setting: 'organization_projects', value: 'DISABLED', confirm: true });
    expect(out.isError).toBe(true);
    expect(JSON.stringify(out)).toMatch(/not an enterprise you administer/);
    expect(state.sent).toEqual([]);
  });
  it('a master token without enterprise permission is refused, and so is a read-only connection', async () => {
    const lacking = withMaster(await makeWorld({ profile: 'full', mode: 'production' }), ['repo']);
    arrange(lacking.gh);
    expect((await call(lacking, 'github_enterprise_profile_set', { enterprise: SLUG, name: 'X', confirm: true })).isError).toBe(true);
    const ro = withMaster(await makeWorld({ profile: 'read_only' }));
    const state = arrange(ro.gh);
    expect((await call(ro, 'github_enterprise_profile_set', { enterprise: SLUG, name: 'X', confirm: true })).isError).toBe(true);
    expect(state.sent).toEqual([]);
  });
  it('profile undo restores every changed field, and offers none when a field was empty before', async () => {
    const w = withMaster(await makeWorld({ profile: 'full', mode: 'production' }));
    arrange(w.gh);
    const changed = parse(await call(w, 'github_enterprise_profile_set', { enterprise: SLUG, description: 'new', location: 'Boulder', confirm: true }));
    expect((await w.db.getChange(changed.logged.id)).inverse).toMatchObject({ tool: 'github_enterprise_profile_set', args: { description: 'old', location: 'Denver' } });
    const w2 = withMaster(await makeWorld({ profile: 'full', mode: 'production' }));
    arrange(w2.gh);
    const done = parse(await call(w2, 'github_enterprise_profile_set', { enterprise: SLUG, websiteUrl: 'https://example.test', confirm: true }));
    expect(done.status).toBe('applied');
    expect((await w2.db.getChange(1)).inverse).toBeNull();
  });
  it('every enterprise setting mutation has a disposition, and the refused ones say why', () => {
    for (const p of Object.values(POLICIES)) expect(COVERED_BY_TOOL.get(p.mutation), p.mutation).toBe('github_enterprise_policy_set');
    expect(COVERED_BY_TOOL.get('updateEnterpriseProfile')).toBe('github_enterprise_profile_set');
    for (const m of ['updateEnterpriseTwoFactorAuthenticationRequiredSetting', 'updateEnterpriseTwoFactorAuthenticationDisallowedMethodsSetting',
      'updateEnterpriseDeployKeySetting', 'updateEnterpriseRepositoryProjectsSetting', 'updateEnterpriseMembersCanCreateRepositoriesSetting'])
      expect(REFUSED_MUTATIONS.get(m)?.length, m).toBeGreaterThan(30);
  });
});
