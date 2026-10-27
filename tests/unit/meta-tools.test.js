import { describe, expect, it } from 'vitest';
import { createDispatch } from '../../src/tools/dispatch.js';
import { COMPACT_DEVELOPER_TOOLS, registry } from '../../src/tools/index.js';
import { mergeNamespaces, listedDescription, listedTool, toolsForListing, toolsForProfile } from '../../src/core/registry.js';
import { areaOf, describeTool, kindOf, marksOf, searchTools } from '../../src/core/meta.js';
import { createGates } from '../../src/tools/gates.js';
import { makeWorld } from '../../test/helpers/write-contract.js';
import { defineRead } from '../../src/tools/define-read.js';
import { sampleSeat, sampleLabel } from '../../test/helpers/sample-writes.js';
import * as meta from '../../src/tools/meta.js';

async function world(profile = 'full', extra = {}) {
  const w = await makeWorld({ profile, accounts: ['example-org', 'example-user'], gates: createGates(), ...extra });
  const dispatch = createDispatch({ credentials: w.credentials, gates: w.ctx.gates, fetch: w.gh.fetch, now: w.ctx.now });
  const run = (name, args, reg = registry) => dispatch({ registry: reg, name, args, connection: w.connection, db: w.db });
  return { ...w, run };
}
const data = (r) => r.structuredContent;

describe('github_search_tools', () => {
  it('finds tools by plain words, with kind and safety marks', async () => {
    const w = await world();
    const r = data(await w.run('github_search_tools', { query: 'default account' }));
    expect(r.tools[0]).toMatchObject({ name: 'github_set_default_account', kind: 'change', area: 'server' });
    expect(r.tools[0].safety).toContain('safe writes run once; dryRun optional');
    const prod = data(await w.run('github_search_tools', { query: 'production' })).tools.map((t) => t.name);
    expect(prod).toContain('github_enable_production');
  });
  it('shows only the tools the profile includes', async () => {
    const full = await world('full');
    const low = await world('read_only');
    expect(data(await full.run('github_search_tools', { query: 'spend limit' })).tools.map((t) => t.name)).toContain('github_set_spend_limit');
    expect(data(await low.run('github_search_tools', { query: 'spend limit' })).tools.map((t) => t.name)).not.toContain('github_set_spend_limit');
  });
  it('filters by area and audience, caps the count, and wants something to go on', async () => {
    const w = await world();
    const byArea = data(await w.run('github_search_tools', { area: 'meta' }));
    expect(byArea.tools.map((t) => t.name).sort()).toEqual(['github_batch', 'github_call', 'github_describe_tool', 'github_search_tools', 'github_tool_manifest']);
    const op = data(await w.run('github_search_tools', { audience: 'Op', limit: 2 }));
    expect(op.count).toBe(2);
    expect((await w.run('github_search_tools', {})).isError).toBe(true);
    expect(data(await w.run('github_search_tools', { query: 'zzzzqqqq' })).count).toBe(0);
    expect((await w.run('github_search_tools', { query: 'x', limit: 99 })).isError).toBe(true);
  });
});

describe('github_describe_tool', () => {
  it('gives the arguments and safety of a read and of a change', async () => {
    const w = await world();
    const read = data(await w.run('github_describe_tool', { name: 'github_recent_changes' }));
    expect(read).toMatchObject({ kind: 'read', safety: ['read-only'] });
    expect(read.arguments.properties).toHaveProperty('includePreviews');
    const write = data(await w.run('github_describe_tool', { name: 'github_revoke_connection' }));
    expect(write).toMatchObject({ kind: 'change', profiles: ['full'] });
    expect(write.safety).toContain('always asks first');
    expect(write.how_to_change).toContain('call once without dryRun or confirm');
    expect(write.how_to_change).toContain('needs_confirmation');
    expect(write.how_to_change).toContain('obtain the required approval');
  });
  it('does not describe a tool the profile cannot see, or one that does not exist', async () => {
    const low = await world('read_only');
    for (const name of ['github_revoke_connection', 'github_nope']) {
      const r = await low.run('github_describe_tool', { name });
      expect(r.isError).toBe(true);
      expect(r.content[0].text).toContain('Unknown or unavailable');
    }
  });
});

describe('canonical read aliases', () => {
  it('describes canonical names once, while documenting accepted aliases separately', async () => {
    const w = await world('read_only');
    for (const [name, canonical, alias] of [
      ['github_commit_list', 'ref', 'branch'],
      ['github_pr_get', 'number', 'pull_number'],
      ['github_pr_list_files', 'number', 'pull_number']
    ]) {
      const result = data(await w.run('github_describe_tool', { name }));
      expect(result.arguments.properties).toHaveProperty(canonical);
      expect(result.arguments.properties).not.toHaveProperty(alias);
      expect(result.accepted_aliases[canonical]).toContain(alias);
      const registered = registry.tools.find(t => t.name === name);
      expect(registered.inputSchema.properties).toHaveProperty(alias);
    }
  });
});

describe('github_tool_manifest', () => {
  it('is stable, bounded, sorted, profile-scoped, and changes with a direct-tool contract', async () => {
    const w = await world();
    const a = data(await w.run('github_tool_manifest', {}));
    const b = data(await w.run('github_tool_manifest', {}, { ...registry, tools: [...registry.tools].reverse() }));
    expect(a).toEqual(b);
    expect(a.format_version).toBe(1);
    expect(a.count).toBe(a.tools.length);
    expect(a.tools.map(x => x.name)).toEqual([...a.tools.map(x => x.name)].sort());
    expect(a.tools.every(x => /^1-[a-f0-9]{12}$/.test(x.version))).toBe(true);
    expect(a.manifest_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(a.changelog_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(Buffer.byteLength(JSON.stringify(a))).toBeLessThan(8192);
    const low = await world('read_only');
    const onlyRead = data(await low.run('github_tool_manifest', {}));
    expect(onlyRead.count).toBeLessThan(a.count);
    const extra = defineRead({
      name: 'github_test_direct_extra', description: 'Synthetic manifest fixture.',
      compact: true, handler: async () => ({ ready: true })
    });
    const changed = data(await w.run('github_tool_manifest', {}, {
      ...registry, tools: [...registry.tools, extra.tool],
      handlers: { ...registry.handlers, [extra.tool.name]: extra.handler }
    }));
    expect(changed.manifest_hash).not.toBe(a.manifest_hash);
    expect(changed.tools.map(t => t.name)).toContain(extra.tool.name);
  });
});

describe('github_call', () => {
  it('runs a read tool exactly as calling it directly', async () => {
    const w = await world();
    const direct = data(await w.run('github_whoami', {}));
    const called = data(await w.run('github_call', { name: 'github_whoami', args: {} }));
    expect(called).toEqual(direct);
  });
  it('runs a change through the write layer: preview, then the same refusals', async () => {
    const w = await world();
    await w.db.upsertAccount({ login: 'example-user', accountId: 55, accountType: 'User', label: 'P', credentialKind: 'fine_grained' });
    const preview = data(await w.run('github_call', { name: 'github_set_default_account', args: { account: 'example-user', dryRun: true } }));
    expect(preview.preview).toContain('example-user');
    const refused = await w.run('github_call', { name: 'github_set_default_account', args: { account: 'unrelated-org', confirm: true } });
    expect(data(refused).status).toBe('refused');
  });
  it('cannot be used to reach a tool the profile hides, a tool that does not exist, bad arguments, or the tool-finding tools', async () => {
    const low = await world('read_only');
    for (const [name, args] of [['github_revoke_connection', { connection: 'x', confirm: true }], ['github_nope', {}], ['github_call', { name: 'github_whoami' }], ['github_batch', { calls: [{ name: 'github_whoami' }] }], ['github_search_tools', { query: 'x' }]]) {
      const r = await low.run('github_call', { name, args });
      expect(r.isError, name).toBe(true);
    }
    expect((await low.run('github_call', { name: 'github_whoami', args: { detail: 'huge' } })).isError).toBe(true);
    expect((await low.run('github_call', {})).isError).toBe(true);
    expect((await low.run('github_call', { name: 'github_whoami', extra: 1 })).isError).toBe(true);
  });
  it('is not listed as read-only, because it can run changes', () => {
    const tool = meta.tools.find((t) => t.name === 'github_call');
    expect(tool.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
  });
});

describe('github_batch', () => {
  it('runs several reads and reports each, including one that fails', async () => {
    const w = await world();
    const r = data(await w.run('github_batch', { calls: [{ name: 'github_whoami' }, { name: 'github_list_accounts', args: { detail: 'huge' } }, { name: 'github_recent_changes', args: { limit: 1 } }] }));
    expect(r.count).toBe(3);
    expect(r.results[0]).toMatchObject({ name: 'github_whoami', ok: true });
    expect(r.results[0].result.accounts).toBeTruthy();
    expect(r.results[1]).toMatchObject({ name: 'github_list_accounts', ok: false });
    expect(r.results[2]).toMatchObject({ name: 'github_recent_changes', ok: true });
  });
  it('refuses changes, the runner and tool-finding tools, tools it cannot see, empty and oversize batches', async () => {
    const w = await world();
    for (const name of ['github_set_default_account', 'github_call', 'github_batch', 'github_search_tools', 'github_nope']) {
      const r = await w.run('github_batch', { calls: [{ name: 'github_whoami' }, { name }] });
      expect(r.isError, name).toBe(true);
      expect(r.content[0].text).toContain('read tools only');
    }
    expect((await w.run('github_batch', { calls: [] })).isError).toBe(true);
    expect((await w.run('github_batch', { calls: Array.from({ length: 11 }, () => ({ name: 'github_whoami' })) })).isError).toBe(true);
  });
  it('runs at most three independent reads at once and keeps original order and individual errors', async () => {
    const w = await world();
    let active = 0;
    let peak = 0;
    const read = defineRead({
      name: 'github_t_fast_read', description: 'A bounded synthetic read.',
      properties: { index: { type: 'integer', minimum: 0 } }, required: ['index'],
      handler: async ({ index }) => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise(resolve => setTimeout(resolve, 5 + (index % 3) * 5));
        active -= 1;
        if (index === 4) throw new TypeError('Synthetic item failed.');
        return { index };
      }
    });
    const reg = mergeNamespaces([meta, { tools: [read.tool], handlers: { [read.tool.name]: read.handler } }]);
    const calls = Array.from({ length: 10 }, (_, index) => ({ name: read.tool.name, args: { index } }));
    const result = data(await w.run('github_batch', { calls }, reg));
    expect(peak).toBe(3);
    expect(active).toBe(0);
    expect(result.count).toBe(10);
    for (let index = 0; index < 10; index++) {
      expect(result.results[index].name).toBe(read.tool.name);
      if (index === 4) expect(result.results[index]).toMatchObject({ ok: false });
      else expect(result.results[index]).toMatchObject({ ok: true, result: { index } });
    }
  });

  it('refuses a mixed read/write batch before starting any read', async () => {
    const w = await world();
    let readCount = 0;
    const read = defineRead({ name: 'github_t_bounded_read', description: 'Synthetic side-effect counter for denied batches.',
      handler: async () => { readCount += 1; return { ok: true }; } });
    const reg = mergeNamespaces([meta, { tools: [read.tool], handlers: { [read.tool.name]: read.handler } }]);
    const denied = await w.run('github_batch', { calls: [{ name: read.tool.name }, { name: 'github_call' }] }, reg);
    expect(denied.isError).toBe(true);
    expect(readCount).toBe(0);
  });

  it('keeps a combined result that is too big behind a handle', async () => {
    const w = await world();
    const bigRead = defineRead({ name: 'github_t_big', description: 'Big.', handler: async () => ({ text: 'word '.repeat(1500), list: Array.from({ length: 30 }, (_, i) => ({ i, note: 'n'.repeat(100) })) }) });
    const reg = mergeNamespaces([meta, { tools: [bigRead.tool], handlers: { github_t_big: bigRead.handler } }]);
    const r = data(await w.run('github_batch', { calls: [{ name: 'github_t_big' }, { name: 'github_t_big' }, { name: 'github_t_big' }] }, reg));
    expect(JSON.stringify(r).length).toBeLessThanOrEqual(8192);
    expect(r.kept_result?.handle ?? r.results[0].result.kept_result?.handle).toMatch(/^res_/);
  });
});

describe('listing', () => {
  it('compact exposes approved developer tools and retains all existing shortcuts without broadening rights', () => {
    const compact = toolsForListing(registry, 'full', 'compact').map((t) => t.name);
    const existing = ['github_search_tools', 'github_describe_tool', 'github_call', 'github_batch', 'github_whoami', 'github_get_result', 'github_workflow_pr_status', 'github_workflow_open_pr', 'github_workflow_merge_when_green', 'github_workflow_merge_stack'];
    expect(compact.filter(name => existing.includes(name))).toEqual(existing);
    expect(COMPACT_DEVELOPER_TOOLS.every(name => compact.includes(name))).toBe(true);
    expect(toolsForListing(registry, 'full', 'catalog')).toHaveLength(registry.tools.length);
    expect(toolsForListing(registry, 'read_only', 'catalog')).toEqual(toolsForProfile(registry, 'read_only'));
    const low=toolsForListing(registry,'read_only','compact').map(x=>x.name);
    expect(low).toContain('github_workflow_pr_status');
    expect(low).not.toContain('github_workflow_open_pr');
    expect(low).not.toContain('github_workflow_merge_when_green');
    expect(low).not.toContain('github_workflow_merge_stack');
    expect(toolsForListing(registry, 'read_only', 'whatever')).toEqual(toolsForProfile(registry, 'read_only'));
  });
  it('puts PRODUCTION and SPENDS MONEY first in the description of a tool that is, and sends annotations', () => {
    expect(listedDescription(sampleSeat.tool)).toBe('SPENDS MONEY: Sample: assign Copilot seats (costs money).');
    expect(listedDescription(sampleLabel.tool)).toBe(sampleLabel.tool.description);
    const prod = { name: 'github_x', description: 'Delete it.', writes: true, declarations: { production: 'always', spend: true } };
    expect(listedDescription(prod)).toBe('PRODUCTION, SPENDS MONEY: Delete it.');
    expect(listedDescription({ ...prod, description: 'PRODUCTION, SPENDS MONEY: Delete it.' })).toBe('PRODUCTION, SPENDS MONEY: Delete it.');
    expect(listedTool(sampleSeat.tool)).toHaveProperty('annotations.readOnlyHint', false);
    expect(Object.keys(listedTool(sampleSeat.tool)).sort()).toEqual(['annotations', 'description', 'inputSchema', 'name']);
  });
});

describe('the finding helpers', () => {
  it('derive area, kind, marks and a description', () => {
    expect(areaOf({ name: 'github_pr_merge' })).toBe('pr');
    expect(areaOf({ name: 'github_pr_merge', area: 'custom' })).toBe('custom');
    expect(kindOf(meta.tools.find((t) => t.name === 'github_call'))).toBe('runner');
    expect(marksOf(sampleSeat.tool)).toContain('SPENDS MONEY');
    expect(marksOf(sampleLabel.tool)).toContain('safe writes run once; dryRun optional');
    expect(marksOf({ name: 'x', writes: true, declarations: { production: 'when-target', accessWidening: true, notifies: true, confirm: 'always' } })).toEqual(['production when the target is', 'changes who has access', 'may notify people', 'always asks first']);
    expect(describeTool(sampleSeat.tool).arguments).toBe(sampleSeat.tool.inputSchema);
    expect(searchTools([sampleSeat.tool, sampleLabel.tool], { query: 'copilot seats' }).map((t) => t.name)).toEqual(['github_sample_seat']);
  });
});
