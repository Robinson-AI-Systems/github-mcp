// PUB-5 B: the optional `usage` hook in createDispatch counts REAL changes only, one by one (even inside a batch), refuses new
// changes at the hourly limit while reads and previews keep working, and changes nothing when it is absent.
import { describe, expect, it } from 'vitest';
import { createDispatch } from '../../src/tools/dispatch.js';
import { callLimitText, changeLimitText, publicUsageLimits } from '../../src/tenancy/public-usage.js';
import { createFakeDb } from '../../test/helpers/fake-db.js';

const objectSchema = { type: 'object', properties: { dryRun: { type: 'boolean' }, confirm: { type: 'boolean' }, n: { type: 'integer' } } };
const write = { name: 'github_fixture_change', description: 'Fixture change', area: 'server', writes: true, writeContract: 'defineWrite-v1', profiles: ['full'], inputSchema: objectSchema };
const read = { name: 'github_fixture_look', description: 'Fixture read', area: 'server', annotations: { readOnlyHint: true }, inputSchema: objectSchema };
const batch = { name: 'github_fixture_batch', description: 'Fixture batch', area: 'server', passthrough: true, usesRegistry: true, profiles: ['full'], inputSchema: { type: 'object', properties: { n: { type: 'integer' } } } };
const connection = Object.freeze({ client_id: 'pcl_x', default_account: 'a', accounts: Object.freeze(['a']), mode: 'preview', profile: 'full', listing: 'compact' });
const outcome = (status) => ({ content: [{ type: 'text', text: '{}' }], structuredContent: { status } });

async function fixture({ status = 'applied', limited = false } = {}) {
  const db = createFakeDb(); await db.initSchema();
  const log = [];
  const handlers = {
    [write.name]: async (args) => outcome(args.dryRun === true ? 'preview' : status),
    [read.name]: async () => ({ ok: true }),
    [batch.name]: async (args, { callTool }) => { for (let i = 0; i < (args.n ?? 3); i++) await callTool(write.name, { confirm: true }); return outcome('applied'); }
  };
  const registry = { tools: [write, read, batch], handlers };
  const usage = { beforeWrite: async () => { log.push('before'); return limited ? { message: changeLimitText(300), retryAfterSeconds: 1234 } : null; }, afterWrite: async () => { log.push('after'); }, release: async () => { log.push('release'); } };
  const run = (name, args = {}, withUsage = true) => createDispatch({ ...(withUsage ? { usage } : {}) })({ registry, name, args, connection, db });
  return { run, log };
}

describe('the dispatch usage hook', () => {
  it('counts a real change once, and a batch of 3 changes 3 times', async () => {
    const f = await fixture();
    await f.run(write.name, { confirm: true });
    expect(f.log).toEqual(['before', 'after']);
    f.log.length = 0;
    await f.run(batch.name, { n: 3 });
    expect(f.log).toEqual(['before', 'after', 'before', 'after', 'before', 'after']);
  });

  it('hands the reserved slot back when the change throws, and does not reserve for a refused-by-limit call', async () => {
    const f = await fixture();
    const thrower = createDispatch({ usage: { beforeWrite: async () => { f.log.push('before'); return null; }, afterWrite: async () => f.log.push('after'), release: async () => f.log.push('release') } });
    const db = createFakeDb(); await db.initSchema();
    await thrower({ registry: { tools: [write], handlers: { [write.name]: async () => { throw new TypeError('boom'); } } }, name: write.name, args: { confirm: true }, connection, db });
    expect(f.log).toEqual(['before', 'release']);
    const g = await fixture({ limited: true });
    await g.run(write.name, { confirm: true });
    expect(g.log).toEqual(['before']); // nothing was reserved, so nothing to give back
  });

  it('does not count a preview, a dry run, a refusal or a read', async () => {
    const f = await fixture();
    await f.run(write.name, { dryRun: true });
    await f.run(read.name, {});
    expect(f.log).toEqual([]);
    for (const status of ['preview', 'needs_confirmation', 'refused', 'blocked']) {
      const g = await fixture({ status });
      await g.run(write.name, { confirm: true });
      expect(g.log).toEqual(['before', 'release']); // slot reserved first, handed back, never counted
    }
  });

  it('counts unconfirmed and uncertain results (the change may have happened)', async () => {
    for (const status of ['unconfirmed', 'uncertain']) {
      const f = await fixture({ status });
      await f.run(write.name, { confirm: true });
      expect(f.log).toEqual(['before', 'after']);
    }
  });

  it('at the limit a change is refused with a plain message and retry time, while reads and previews still work', async () => {
    const f = await fixture({ limited: true });
    const refused = await f.run(write.name, { confirm: true });
    expect(refused.isError).toBe(true);
    expect(refused.content[0].text).toMatch(/free limit of 300 changes/);
    expect(refused.structuredContent).toEqual({ error: 'rate_limited', retry_after_seconds: 1234 });
    expect(f.log).toEqual(['before']);
    expect((await f.run(read.name, {})).isError).not.toBe(true);
    expect((await f.run(write.name, { dryRun: true })).structuredContent.status).toBe('preview');
  });

  it('with no usage hook it behaves exactly as before', async () => {
    const f = await fixture({ limited: true });
    const res = await f.run(write.name, { confirm: true }, false);
    expect(res.structuredContent.status).toBe('applied');
    expect(f.log).toEqual([]);
  });

  it('a hook that throws never blocks work', async () => {
    const db = createFakeDb(); await db.initSchema();
    const registry = { tools: [write], handlers: { [write.name]: async () => outcome('applied') } };
    const usage = { beforeWrite: async () => { throw new Error('db down'); }, afterWrite: async () => { throw new Error('db down'); } };
    const res = await createDispatch({ usage })({ registry, name: write.name, args: { confirm: true }, connection, db });
    expect(res.structuredContent.status).toBe('applied');
  });
});

describe('fair-use settings and messages', () => {
  it('add no usage limit of their own by default (LIMITS-MATCH-GITHUB-1), accept only sensible overrides', () => {
    expect(publicUsageLimits({})).toMatchObject({ callsPerDay: null, writesPerHour: null, costPauseCents: 5000, inactiveDays: 180, unlimitedSubjects: [] });
    expect(publicUsageLimits({ PUBLIC_FREE_CALLS_PER_DAY: 'unlimited', PUBLIC_FREE_WRITES_PER_HOUR: '' })).toMatchObject({ callsPerDay: null, writesPerHour: null });
    expect(publicUsageLimits({ PUBLIC_FREE_CALLS_PER_DAY: '100', PUBLIC_FREE_WRITES_PER_HOUR: '7', PUBLIC_COST_PAUSE_CENTS: '0', PUBLIC_INACTIVE_DAYS: '30' }))
      .toMatchObject({ callsPerDay: 100, writesPerHour: 7, costPauseCents: 0, inactiveDays: 30 });
    expect(publicUsageLimits({ PUBLIC_FREE_CALLS_PER_DAY: '0', PUBLIC_FREE_WRITES_PER_HOUR: '-5', PUBLIC_INACTIVE_DAYS: 'abc' }))
      .toMatchObject({ callsPerDay: null, writesPerHour: null, inactiveDays: 180 });
  });
  it('the exempt list takes numeric GitHub ids only (a login can be renamed and taken by someone else)', () => {
    expect(publicUsageLimits({ PUBLIC_UNLIMITED_SUBJECTS: ' 12345 , christcr2012,0,99999999999999999999 ,678 ' }).unlimitedSubjects).toEqual(['12345', '678']);
  });
  it('the refusal says what happened, when it resets and where to read more', () => {
    expect(callLimitText(5000)).toBe("You have reached today's free limit of 5,000 calls. It resets at midnight UTC. See /limits.");
    expect(changeLimitText(300)).toContain('300 changes');
  });
});
