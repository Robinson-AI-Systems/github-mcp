import { describe, expect, it } from 'vitest';
import { DEFAULT_PRODUCTION_NAMES, cleanNames, globToRegExp, matchesAny, productionEnabledGate, productionNames, productionReason } from '../../src/tools/production-guard.js';
import { makeWorld } from '../../test/helpers/write-contract.js';

const REPO = 'GET /repos/{owner}/{repo}';
const BRANCH = 'GET /repos/{owner}/{repo}/branches/{branch}';
const RULES = 'GET /repos/{owner}/{repo}/rules/branches/{branch}';
const ENV = 'GET /repos/{owner}/{repo}/environments/{environment_name}';
const T = { owner: 'example-org', repo: 'hello', scope: 'repo' };

async function world(arrange = () => {}) {
  const w = await makeWorld();
  w.gh.when(REPO).reply(200, { default_branch: 'main' });
  w.gh.when(BRANCH).reply(200, { name: 'feature', protected: false });
  w.gh.when(RULES).reply(200, []);
  w.gh.when(ENV).reply(404, { message: 'Not Found' });
  arrange(w.gh);
  return w;
}
const reason = async (w, target, options) => productionReason(w.ctx, { ...T, ...target }, options);

describe('production rules (B2)', () => {
  it('rule 1: the default branch is production', async () => {
    const w = await world();
    expect(await reason(w, { ref: 'main' })).toContain('default branch of example-org/hello');
  });
  it('rule 2: a protected branch, or any branch a ruleset applies to, is production', async () => {
    const protectedBranch = await world((gh) => gh.when(BRANCH).reply(200, { name: 'release', protected: true }));
    expect(await reason(protectedBranch, { ref: 'release' })).toContain('protected branch');
    const ruleset = await world((gh) => gh.when(RULES).reply(200, [{ type: 'pull_request' }]));
    expect(await reason(ruleset, { ref: 'feature' })).toContain('ruleset applies');
    const plain = await world();
    expect(await reason(plain, { ref: 'feature' })).toBeNull();
    const absent = await world((gh) => gh.when(BRANCH).reply(404, { message: 'Branch not found' }));
    expect(await reason(absent, { ref: 'brand-new' })).toBeNull();
  });
  it('rule 3: a project profile\'s production branches count, without asking GitHub', async () => {
    const w = await world();
    expect(await reason(w, { ref: 'live' }, { profile: { productionBranches: ['live', 'release/*'] } })).toContain('named as production');
    expect(await reason(w, { ref: 'release/1.2' }, { profile: { productionBranches: ['release/*'] } })).toContain('named as production');
    expect(w.gh.calls).toEqual([]);
  });
  it('rule 4: tags and releases are production', async () => {
    const w = await world();
    expect(await reason(w, { kind: 'tag' })).toContain('tag');
    expect(await reason(w, { kind: 'release' })).toContain('release');
  });
  it('rule 5: repository settings are production', async () => {
    expect(await reason(await world(), { kind: 'repo-settings' })).toContain('repository settings');
  });
  it('rule 6: an environment is production by name, by required reviewers, or by a wait timer', async () => {
    const w = await world();
    for (const environment of ['production', 'Prod', 'LIVE']) expect(await reason(w, { environment }), environment).toContain('production environment');
    expect(await reason(w, { environment: 'staging' })).toBeNull();
    const reviewers = await world((gh) => gh.when(ENV).reply(200, { name: 'staging', protection_rules: [{ type: 'required_reviewers' }] }));
    expect(await reason(reviewers, { environment: 'staging' })).toContain('required reviewers or a wait timer');
    const timer = await world((gh) => gh.when(ENV).reply(200, { name: 'staging', protection_rules: [{ type: 'wait_timer', wait_timer: 5 }] }));
    expect(await reason(timer, { environment: 'staging' })).toContain('wait timer');
    const branchOnly = await world((gh) => gh.when(ENV).reply(200, { name: 'staging', protection_rules: [{ type: 'branch_policy' }] }));
    expect(await reason(branchOnly, { environment: 'staging' })).toBeNull();
    expect(await reason(w, { environment: 'qa' }, { profile: { productionEnvironments: ['qa'] } })).toContain('production environment');
  });
  it('rule 7: organization and personal-account scope are production', async () => {
    const w = await world();
    expect(await reason(w, { scope: 'org', repo: undefined })).toContain('organization-level');
    expect(await reason(w, { scope: 'user', repo: undefined })).toContain('personal account');
  });
  it('a failed read counts as production, at every step', async () => {
    for (const [route, target] of [[REPO, { ref: 'feature' }], [BRANCH, { ref: 'feature' }], [RULES, { ref: 'feature' }], [ENV, { environment: 'staging' }]]) {
      const w = await world((gh) => gh.when(route).reply(500, { message: 'boom' }));
      const found = await productionReason({ ...w.ctx, retryAfterBaseValue: 1 }, { ...T, ...target });
      expect(found, route).toContain('treated as production');
    }
    const noCreds = await world();
    const stranger = { ...noCreds.ctx, connection: Object.freeze({ ...noCreds.connection, accounts: Object.freeze(['elsewhere']) }) };
    expect(await productionReason(stranger, { ...T, ref: 'feature' })).toContain('treated as production');
  });
  it('makes only the reads it needs', async () => {
    const w = await world();
    await reason(w, { ref: 'feature' });
    expect(w.gh.calls.map((c) => c.route)).toEqual([REPO, BRANCH, RULES]);
    expect(w.gh.invalid).toEqual([]);
  });
});

describe('production names (IN-12)', () => {
  it('always include the built-in environments and add the owner\'s', async () => {
    const w = await makeWorld();
    expect(await productionNames(w.db)).toEqual({ environments: ['production', 'prod', 'live'], branches: [] });
    await w.db.setSetting('production_names', { environments: ['qa'], branches: ['release/*'] });
    expect(await productionNames(w.db)).toEqual({ environments: ['production', 'prod', 'live', 'qa'], branches: ['release/*'] });
    await w.db.setSetting('production_names', { environments: [], branches: [] });
    expect((await productionNames(w.db)).environments).toEqual([...DEFAULT_PRODUCTION_NAMES.environments]);
    await w.db.setSetting('production_names', { environments: ['<script>', 5, 'ok'], branches: 'nope' });
    expect(await productionNames(w.db)).toEqual({ environments: ['production', 'prod', 'live', 'ok'], branches: [] });
    expect(Object.isFrozen(DEFAULT_PRODUCTION_NAMES)).toBe(true);
  });
  it('are cleaned and limited when the owner types them', () => {
    expect(cleanNames('qa, release/*, qa', 'branch')).toEqual({ names: ['qa', 'release/*'] });
    expect(cleanNames('', 'branch')).toEqual({ names: [] });
    expect(cleanNames('bad name', 'branch').error).toContain('not a valid branch name');
    expect(cleanNames(Array.from({ length: 21 }, (_, i) => `b${i}`), 'branch').error).toContain('At most 20');
    expect(cleanNames('a'.repeat(61), 'environment').error).toContain('environment');
  });
  it('match branch globs', () => {
    expect(globToRegExp('release/*').test('release/1.0')).toBe(true);
    expect(globToRegExp('release/*').test('release/1/2')).toBe(false);
    expect(globToRegExp('transfer/**').test('transfer/a/b')).toBe(true);
    expect(globToRegExp('a.b').test('axb')).toBe(false);
    expect(globToRegExp('v?').test('v1')).toBe(true);
    expect(matchesAny('live', ['live'])).toBe(true);
    expect(matchesAny('x', [])).toBe(false);
  });
});

describe('production switch gate', () => {
  const gate = productionEnabledGate();
  const input = async (mode, production, enabled) => {
    const w = await makeWorld({ mode });
    await w.db.setProductionEnabled('example-org', enabled);
    return { ctx: { ...w.ctx, connection: { ...w.ctx.connection, pass: true } }, target: T, classification: { production } };
  };
  it('lets a production change through only when the account\'s switch is on', async () => {
    expect(await gate(await input('production', 'x', true))).toBeNull();
    expect(await gate(await input('production', 'x', false))).toMatchObject({ by: 'production switch' });
  });
  it('does not veto a normal sign-in connection, only a delegated pass', async () => {
    const w = await makeWorld({ mode: 'production' });
    await w.db.setProductionEnabled('example-org', false);
    expect(await gate({ ctx: w.ctx, target: T, classification: { production: 'x' } })).toBeNull();
  });
  it('does not apply to non-production changes or preview connections (the mode refuses those)', async () => {
    expect(await gate(await input('production', null, false))).toBeNull();
    expect(await gate(await input('preview', 'x', false))).toBeNull();
  });
});
