// CAP-6: the runner, larger-runner, merge-queue and Copilot families are offered only where GitHub shows the account has
// the feature. Both decisions (on and off, plus "could not ask") are proven for every family, through the listing
// helper, the dispatcher, github_call, github_search_tools and github_describe_tool, with the validating fake GitHub.
import fs from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearFeatureCache, decideAccount, familyOf, FEATURE_CACHE_MS, featureRefusal, offeredRegistry, offeredTools } from '../../src/github/feature-gates.js';
import { createDispatch } from '../../src/tools/dispatch.js';
import { registry } from '../../src/tools/index.js';
import { makeWorld, parse } from '../../test/helpers/write-contract.js';

const ORG = 'example-org';
const graphqlReply = ({ mergeQueue = false, copilotUser = false } = {}) => (request) => {
  const q = String(request.body?.query ?? '');
  if (q.includes('organization(login')) return { data: { organization: { repositories: { nodes: [{ name: 'hello', mergeQueue: mergeQueue ? { id: 'MQ_1' } : null }, { name: 'other', mergeQueue: null }] } } } };
  if (q.includes('user(login')) return { data: { user: { repositories: { nodes: [{ name: 'site', suggestedActors: { nodes: copilotUser ? [{ login: 'copilot-swe-agent' }] : [] } }] } } } };
  return { data: {} };
};
function arrangeOrg(gh, { runners = 200, hosted = 200, copilot = 200, mergeQueue = true } = {}) {
  gh.when('GET /orgs/{org}/actions/runners').reply(runners, runners === 200 ? { total_count: 2, runners: [] } : { message: 'no' });
  gh.when('GET /orgs/{org}/actions/hosted-runners').reply(hosted, hosted === 200 ? { total_count: 1, runners: [] } : { message: 'no' });
  gh.when('GET /orgs/{org}/copilot/billing').reply(copilot, copilot === 200 ? { plan_type: 'business', seat_breakdown: { total: 3 } } : { message: 'no' });
  gh.when('POST /graphql').reply(200, graphqlReply({ mergeQueue }));
}
const run = (w, name, args, { featureGates = true, reg = registry } = {}) => createDispatch({ credentials: w.credentials, fetch: w.gh.fetch, now: w.ctx.now, gates: w.ctx.gates, sleep: w.ctx.sleep, featureGates })
  .call(null, { registry: reg, name, args, connection: w.connection, db: w.db });

beforeEach(() => clearFeatureCache());

describe('family membership', () => {
  it('puts every runner, hosted-runner, merge-queue and Copilot tool in its family and nothing else', () => {
    expect(familyOf('github_runner_list')).toBe('runners');
    expect(familyOf('github_hosted_runner_create')).toBe('larger_runners');
    expect(familyOf('github_merge_queue_enqueue')).toBe('merge_queue');
    expect(familyOf('github_copilot_assign_issue')).toBe('copilot');
    expect(familyOf('github_review_request_copilot')).toBe('copilot');
    expect(familyOf('github_pr_merge')).toBeNull();
    expect(familyOf('github_feature_families')).toBeNull();
    const counts = {};
    for (const t of registry.tools) { const f = familyOf(t.name); if (f) counts[f] = (counts[f] ?? 0) + 1; }
    expect(counts).toMatchObject({ runners: 8, larger_runners: 4, merge_queue: 3 });
    expect(counts.copilot).toBeGreaterThanOrEqual(20);
  });
});

describe('each gate decides on and off from GitHub itself', () => {
  it('an organization with every feature: all four families on, with plain reasons', async () => {
    const w = await makeWorld();
    arrangeOrg(w.gh);
    const d = await decideAccount(w.ctx, ORG);
    expect(d.type).toBe('Organization');
    for (const f of ['runners', 'larger_runners', 'merge_queue', 'copilot']) expect(d.families[f].state, f).toBe('on');
    expect(d.families.merge_queue.reason).toContain('hello');
    expect(d.families.copilot.reason).toContain('business');
    expect(w.gh.invalid).toEqual([]);
    expect(w.gh.calls.every((c) => c.method === 'GET' || (c.route === 'POST /graphql' && !/^\s*mutation/.test(c.body.query)))).toBe(true);
  });
  it('an organization without them: runners/larger runners/Copilot answered "not found", no merge queue -> off', async () => {
    const w = await makeWorld();
    arrangeOrg(w.gh, { runners: 404, hosted: 404, copilot: 404, mergeQueue: false });
    const d = await decideAccount(w.ctx, ORG);
    for (const f of ['runners', 'larger_runners', 'merge_queue', 'copilot']) expect(d.families[f].state, f).toBe('off');
    expect(d.families.copilot.reason).toMatch(/no Copilot Business or Enterprise plan/);
    expect(d.families.merge_queue.reason).toMatch(/Require merge queue/);
    expect(w.gh.invalid).toEqual([]);
  });
  it('a permission refusal is "unknown", never a guessed yes or no', async () => {
    const w = await makeWorld();
    arrangeOrg(w.gh, { runners: 403, hosted: 403, copilot: 403 });
    w.gh.when('POST /graphql').reply(403, { message: 'Resource not accessible by integration' });
    const d = await decideAccount(w.ctx, ORG);
    for (const f of ['runners', 'larger_runners', 'merge_queue', 'copilot']) {
      expect(d.families[f].state, f).toBe('unknown');
      expect(d.families[f].reason, f).toMatch(/calling one by name still works/);
    }
  });
  it('a personal account: runners on, larger runners and merge queue off by GitHub rule, Copilot from the coding agent', async () => {
    const w = await makeWorld({ packageUser: true });
    w.gh.when('POST /graphql').reply(200, graphqlReply({ copilotUser: true }));
    const d = await decideAccount(w.ctx, ORG);
    expect(d.type).toBe('User');
    expect(d.families).toMatchObject({ runners: { state: 'on' }, larger_runners: { state: 'off' }, merge_queue: { state: 'off' }, copilot: { state: 'on' } });
    clearFeatureCache();
    const w2 = await makeWorld({ packageUser: true });
    w2.gh.when('POST /graphql').reply(200, graphqlReply({ copilotUser: false }));
    expect((await decideAccount(w2.ctx, ORG)).families.copilot).toMatchObject({ state: 'off', reason: expect.stringMatching(/not offered in site/) });
    expect(w.gh.invalid).toEqual([]);
    expect(w2.gh.invalid).toEqual([]);
  });
  it('keeps the answer 10 minutes per connection and account, then asks again; refresh asks at once', async () => {
    const w = await makeWorld();
    arrangeOrg(w.gh);
    await decideAccount(w.ctx, ORG);
    const after = w.gh.calls.length;
    await decideAccount(w.ctx, ORG);
    expect(w.gh.calls.length).toBe(after);
    w.advanceClock(FEATURE_CACHE_MS + 1);
    await decideAccount(w.ctx, ORG);
    expect(w.gh.calls.length).toBeGreaterThan(after);
    const again = w.gh.calls.length;
    await decideAccount(w.ctx, ORG, { refresh: true });
    expect(w.gh.calls.length).toBeGreaterThan(again);
  });
});

describe('listing: a family is offered only where it is on', () => {
  it('hides off and unknown families with per-account reasons, keeps on families and every ungated tool', async () => {
    const w = await makeWorld();
    arrangeOrg(w.gh, { runners: 200, hosted: 404, copilot: 403, mergeQueue: false });
    const { tools, hidden } = await offeredTools(w.ctx, registry.tools);
    const names = new Set(tools.map((t) => t.name));
    expect(names.has('github_runner_list')).toBe(true);
    expect(names.has('github_hosted_runner_create')).toBe(false);
    expect(names.has('github_merge_queue_get')).toBe(false);
    expect(names.has('github_copilot_assign_issue')).toBe(false);
    expect(names.has('github_pr_merge')).toBe(true);
    expect(registry.tools.filter((t) => !familyOf(t.name)).every((t) => names.has(t.name))).toBe(true);
    expect(hidden.map((h) => h.family).sort()).toEqual(['copilot', 'larger_runners', 'merge_queue']);
    expect(hidden.find((h) => h.family === 'copilot').accounts[0]).toMatchObject({ account: ORG, state: 'unknown' });
    const reg = await offeredRegistry(registry, w.ctx);
    expect(reg.tools.length).toBe(tools.length);
    expect(reg.handlers).toBe(registry.handlers);
  });
  it('lists the whole family when every feature is present', async () => {
    const w = await makeWorld();
    arrangeOrg(w.gh);
    const reg = await offeredRegistry(registry, w.ctx);
    expect(reg).toBe(registry);
  });
  it('a family on for any one of several accounts is listed', async () => {
    const w = await makeWorld({ accounts: [ORG, 'second-org'] });
    w.gh.when('GET /orgs/{org}/actions/runners').reply(200, { total_count: 0, runners: [] });
    w.gh.when('GET /orgs/{org}/actions/hosted-runners').reply(404, { message: 'no' });
    w.gh.when('GET /orgs/{org}/copilot/billing').reply(404, { message: 'no' });
    w.gh.when('POST /graphql').reply(200, (req) => ({ data: { organization: { repositories: { nodes: [{ name: 'r', mergeQueue: req.body.variables.login === 'second-org' ? { id: 'MQ' } : null }] } } } }));
    const { tools } = await offeredTools(w.ctx, registry.tools);
    expect(tools.some((t) => t.name === 'github_merge_queue_get')).toBe(true);
    expect(tools.some((t) => t.name === 'github_copilot_get_billing')).toBe(false);
  });
});

describe('calls: refused only where GitHub showed the feature is absent', () => {
  it('off: a Copilot call is refused in plain words before anything is sent, through the dispatcher and github_call', async () => {
    for (const viaCall of [false, true]) {
      clearFeatureCache();
      const w = await makeWorld({ mode: 'production', profile: 'full' });
      arrangeOrg(w.gh, { copilot: 404 });
      const args = { repo: 'hello', number: 3, confirm: true };
      const out = viaCall ? await run(w, 'github_call', { name: 'github_copilot_assign_issue', args }) : await run(w, 'github_copilot_assign_issue', args);
      expect(out.isError).toBe(true);
      expect(parse(out)).toMatchObject({ reason_code: 'feature_not_available', family: 'copilot', account: ORG, no_change_sent: true });
      expect(parse(out).error).toMatch(/no Copilot Business or Enterprise plan/);
      expect(w.gh.calls.filter((c) => c.route === 'POST /graphql' && /mutation/.test(c.body.query))).toEqual([]);
    }
  });
  it('on: the same family runs normally', async () => {
    const w = await makeWorld();
    arrangeOrg(w.gh);
    w.gh.when('GET /orgs/{org}/actions/runners').reply(200, { total_count: 1, runners: [{ id: 1, name: 'box', os: 'linux', status: 'online', busy: false, labels: [] }] });
    const out = await run(w, 'github_runner_list', {});
    expect(out.isError).toBeUndefined();
    expect(parse(out).runners[0].name).toBe('box');
  });
  it('unknown: a call by name still runs and GitHub decides', async () => {
    const w = await makeWorld();
    arrangeOrg(w.gh, { runners: 403 });
    expect(await featureRefusal(w.ctx, 'github_runner_list', {})).toBeNull();
  });
  it('without the production switch (featureGates off) nothing is probed', async () => {
    const w = await makeWorld();
    w.gh.when('GET /orgs/{org}/actions/runners').reply(200, { total_count: 0, runners: [] });
    await run(w, 'github_runner_list', {}, { featureGates: false });
    expect(w.gh.calls.map((c) => c.route)).toEqual(['GET /orgs/{org}/actions/runners']);
  });
  it('an account outside the connection is left to the tool\'s own account check', async () => {
    const w = await makeWorld();
    expect(await featureRefusal(w.ctx, 'github_copilot_get_billing', { owner: 'someone-else' })).toBeNull();
    expect(w.gh.calls).toEqual([]);
  });
});

describe('the meta-tools say what is hidden and why', () => {
  it('github_search_tools leaves hidden families out and names them with reasons; github_describe_tool marks offered: false', async () => {
    const w = await makeWorld();
    arrangeOrg(w.gh, { runners: 200, hosted: 404, copilot: 404, mergeQueue: false });
    const search = parse(await run(w, 'github_search_tools', { query: 'merge queue' }));
    expect(search.tools.some((t) => t.name.startsWith('github_merge_queue_'))).toBe(false);
    expect(search.hidden_families[0]).toMatchObject({ family: 'merge_queue', accounts: [{ account: ORG, state: 'off' }] });
    const described = parse(await run(w, 'github_describe_tool', { name: 'github_merge_queue_enqueue' }));
    expect(described).toMatchObject({ offered: false, hidden_because: expect.stringMatching(/merge queue/) });
    const shown = parse(await run(w, 'github_search_tools', { query: 'self-hosted runners' }));
    expect(shown.tools.some((t) => t.name === 'github_runner_list')).toBe(true);
  });
  it('github_feature_families explains every family per account, and refresh asks GitHub again', async () => {
    const w = await makeWorld();
    arrangeOrg(w.gh, { hosted: 404 });
    const out = parse(await run(w, 'github_feature_families', {}));
    expect(out.kept_minutes).toBe(10);
    expect(out.accounts[0]).toMatchObject({ account: ORG, families: { runners: { offered: true }, larger_runners: { offered: false, state: 'off' }, copilot: { offered: true } } });
    const before = w.gh.calls.length;
    await run(w, 'github_feature_families', { refresh: true });
    expect(w.gh.calls.length).toBeGreaterThan(before);
    expect((await run(w, 'github_feature_families', { owner: 'not-mine' })).isError).toBe(true);
  });
});

describe('every production door turns the gate on', () => {
  it('the MCP endpoint and the RTC HTTPS door both list through the gate and dispatch with featureGates', () => {
    const mcp = fs.readFileSync(new URL('../../api/mcp.js', import.meta.url), 'utf8');
    const rtc = fs.readFileSync(new URL('../../src/rtc/entry.js', import.meta.url), 'utf8');
    expect(mcp).toMatch(/offered: \(reg, connection, listing\) =>/);
    expect(mcp).toMatch(/featureGates: true/);
    expect(rtc).toMatch(/featureGates:true/);
    expect(rtc).toMatch(/createRtcHttpHandler\(\{db,registry,dispatch,offered\}\)/);
  });
});
