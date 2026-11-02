// PG-STUCK-1: a Playground runtime that cannot make progress is removed (only the runtime; the
// native workspace stays), replaced by the next provision/attach, and reported in plain words.
import {it, expect, describe, afterEach} from 'vitest';
import {makeWorld, doorsFor, parse} from '../../test/helpers/write-contract.js';
import * as tools from '../../src/tools/playground.js';
import {preparePlaygroundWorld} from '../../test/helpers/playground-world.js';
import {playgroundRecord} from '../../src/playground/client.js';
import {ensureAllocation, allocationRecord, inspectAllocation, provisionAllocation, recoverAllocation} from '../../src/playground/allocations.js';
import {attachRepository} from '../../src/playground/attachment.js';
import {sweepAllocations} from '../../src/playground/manager.js';
import {stuckAfterMs, stuckReason, STUCK_DEFAULT_MINUTES, MAX_FAILED_STARTS} from '../../src/playground/stuck.js';
import {nativeConnection} from '../../src/native-git/client.js';

const base = {owner: 'example-org', repo: 'hello', workspace_id: 'job_0123456789abcdef'};
const MIN = 60000;
const cleanups = []; afterEach(async () => { for (const close of cleanups.splice(0)) await close(); });
const config = {origin: 'https://dokploy.example.test', key: 'FAKE_PROVIDER_KEY', project: 'fixture-project', environment: 'fixture-environment', image: 'ghcr.io/example/runtime@sha256:' + 'a'.repeat(64), ingress: '107.90.116.157'};
const providerEnv = {PLAYGROUND_DOKPLOY_ORIGIN: config.origin, PLAYGROUND_DOKPLOY_API_KEY: config.key, PLAYGROUND_DOKPLOY_PROJECT_ID: config.project, PLAYGROUND_DOKPLOY_ENVIRONMENT_ID: config.environment, PLAYGROUND_IMAGE: config.image, PLAYGROUND_INGRESS_IPV4: config.ingress};

async function world() {
  const w = await makeWorld({profile: 'full', mode: 'production', gates: []});
  w.gh.when('GET /repos/{owner}/{repo}').reply(200, {full_name: 'example-org/hello'});
  cleanups.push(await preparePlaygroundWorld(w));
  // The runtime is not attached yet: the fixture's protected allocation list would otherwise make it look attached.
  w.ctx.env = {...w.ctx.env, ...providerEnv, PLAYGROUND_ALLOCATIONS: '[]', PLAYGROUND_ADMISSION: JSON.stringify({project: config.project, observedAt: w.ctx.now(), availableMemoryBytes: 8 * 1024 ** 3, availableDiskBytes: 10 * 1024 ** 3, pressure: 0})};
  return {w, record: await playgroundRecord(w.ctx, base, {allowUnattached: true})};
}
// A Dokploy stand-in: each create makes a new compose; deploy ends in `deployStatus` ('done' or 'error').
function provider({deployStatus = 'done'} = {}) {
  const calls = [], rows = new Map(); let n = 0;
  const p = {calls, rows, deployStatus, project: async () => ({}), inventory: async () => [...rows.values()],
    async create(plan) { calls.push('create'); const row = {composeId: 'compose-' + ++n, appName: plan.name, plan, composeStatus: 'idle', stopped: false}; rows.set(row.composeId, row); return row; },
    async inspect(id) { return rows.get(id) ?? null; },
    async expose() { calls.push('expose'); },
    async deploy(id) { calls.push('deploy:' + id); rows.get(id).composeStatus = p.deployStatus; },
    async stop(id) { calls.push('stop:' + id); rows.get(id).stopped = true; },
    async containers(plan) { return [...rows.values()].filter(r => r.plan.name === plan.name && !r.stopped).map(() => ({State: 'running'})); },
    async remove(id) { calls.push('remove:' + id); rows.delete(id); },
    async absent(id) { return !rows.has(id); }};
  return p;
}
const manager = async () => {};
async function stored(w, record) { return allocationRecord(w.ctx, record); }
async function job(w) { return w.db.getJob(base.workspace_id, nativeConnection(w.ctx)); }
// The sweep's own scope loader and grant check are replaced; everything else (marking, provider
// cleanup, workspace handling) is the real code path.
const sweep = (w, p, authority) => sweepAllocations({root: w.db, env: w.ctx.env, now: w.ctx.now, warm: async () => ({enabled: false}),
  providerFactory: () => p,
  load: async () => ({...w.ctx, stored: (await w.db.listPlaygroundIndexes())[0]?.value.allocation}),
  authorityOf: authority ?? (async ctx => ({allowed: false, bootstrap: !ctx.stored.runtimePublicKey, cleanup: false, reason: 'allocation_not_active', connection: w.ctx.connection, job: {expires_at: new Date(w.ctx.now() + 4 * 3600000).toISOString()}}))});

describe('the stored threshold', () => {
  it('defaults to 45 minutes and accepts a whole-minute operator setting between 15 and 1440', () => {
    expect(STUCK_DEFAULT_MINUTES).toBe(45);
    expect(stuckAfterMs({})).toBe(45 * MIN);
    expect(stuckAfterMs({PLAYGROUND_STUCK_AFTER_MINUTES: '90'})).toBe(90 * MIN);
    for (const bad of ['5', '2000', '1.5', 'soon']) expect(stuckAfterMs({PLAYGROUND_STUCK_AFTER_MINUTES: bad})).toBe(45 * MIN);
  });
  it('is measured from the last step that made progress, and only for pre-attached operator-pool runtimes', () => {
    const t = 1_000_000_000_000, row = {phase: 'attaching', createdAt: t, progressAt: t + 30 * MIN};
    expect(stuckReason(row, {now: t + 70 * MIN})).toBeNull();
    expect(stuckReason(row, {now: t + 75 * MIN})).toBe('runtime_stuck');
    expect(stuckReason({phase: 'deploying', createdAt: t}, {now: t + 46 * MIN})).toBe('runtime_stuck');
    expect(stuckReason({phase: 'deploying', createdAt: t}, {now: t + MIN, composeStatus: 'error'})).toBe('runtime_failed_to_start');
    for (const phase of ['requested', 'waiting_resources', 'attached', 'disposed']) expect(stuckReason({phase, createdAt: t}, {now: t + 600 * MIN})).toBeNull();
    expect(stuckReason({phase: 'deploying', placement: 'device', createdAt: t}, {now: t + 600 * MIN})).toBeNull();
    expect(stuckReason({phase: 'deploying', cleanupRequested: true, createdAt: t}, {now: t + 600 * MIN})).toBeNull();
  });
});

describe('the sweep gives up on stuck runtimes and keeps the workspace', () => {
  it('a runtime stuck before attachment is marked with a reason and removed after the threshold; the workspace survives', async () => {
    const {w, record} = await world(), p = provider();
    p.deployStatus = 'running';
    const first = await ensureAllocation(w.ctx, record, {provider: p, config, manager});
    expect(first.phase).toBe('deploying');
    const leaseBefore = (await job(w)).expires_at;
    // Before the threshold the sweep keeps advancing it (it is still deploying).
    w.advanceClock(30 * MIN);
    expect(stuckReason(await stored(w, record), {now: w.ctx.now(), env: w.ctx.env})).toBeNull();
    w.advanceClock(16 * MIN);
    const out = await sweep(w, p);
    expect(out).toMatchObject({inspected: 1, disposed: 1, pending: 0});
    const after = await stored(w, record);
    expect(after).toMatchObject({phase: 'disposed', cleanupRequested: true, cleanupReason: 'runtime_stuck', runtimeOnly: true, failedStarts: 1, stuckAfterMs: 45 * MIN});
    expect(p.calls).toContain('remove:' + first.composeId);
    // Only the runtime went: the native workspace job is still open and its lease was not extended.
    const row = await job(w);
    expect(row.state).toBe('pending'); expect(row.expires_at).toEqual(leaseBefore);
    expect(w.nativeRequests ?? []).not.toContain('close');
    // A disposed row is no longer swept.
    expect((await sweep(w, p)).inspected).toBe(0);
  });
  it('a provider deployment in error is marked at once (no threshold) and never redeployed', async () => {
    const {w, record} = await world(), p = provider({deployStatus: 'error'});
    const first = await ensureAllocation(w.ctx, record, {provider: p, config, manager});
    // The deploy itself reports error on the same call's readback.
    expect(first).toMatchObject({phase: 'deploying', cleanupRequested: true, cleanupReason: 'runtime_failed_to_start', runtimeOnly: true});
    const again = await ensureAllocation(w.ctx, record, {provider: p, config, manager});
    expect(again.revision).toBe(first.revision);
    expect(p.calls.filter(c => c.startsWith('deploy'))).toHaveLength(1);
    await sweep(w, p);
    expect((await stored(w, record)).phase).toBe('disposed');
    expect((await job(w)).state).toBe('pending');
  });
  it('an expired or closed workspace still disposes everything as before (not runtime-only)', async () => {
    const {w, record} = await world(), p = provider();
    p.deployStatus = 'running';
    await ensureAllocation(w.ctx, record, {provider: p, config, manager});
    w.advanceClock(50 * MIN);
    // The workspace lease ran out: the grant check reports cleanup, so the workspace itself is closed too.
    let closed = 0;
    const out = await sweepAllocations({root: w.db, env: w.ctx.env, now: w.ctx.now, warm: async () => ({enabled: false}), providerFactory: () => p,
      load: async () => ({...w.ctx, stored: (await w.db.listPlaygroundIndexes())[0]?.value.allocation, fetch: async (url, init) => { if (JSON.parse(init.body ?? '{}').action === 'close') closed++; return w.ctx.fetch(url, init); }}),
      authorityOf: async () => ({allowed: false, cleanup: true, reason: 'workspace_expired_or_closed'})});
    expect(out.disposed).toBe(1);
    expect((await stored(w, record)).sourceDisposed).toBe(true);
    expect(closed).toBe(1);
  });
});

describe('the next provision replaces a removed runtime cleanly', () => {
  it('creates a fresh compose (never the broken one), and keeps the size and failure history', async () => {
    const {w, record} = await world(), p = provider({deployStatus: 'error'});
    const broken = await ensureAllocation(w.ctx, record, {provider: p, config, manager, size: 'small'});
    p.deployStatus = 'done';
    const fresh = await provisionAllocation(w.ctx, record, {provider: p, config, manager});
    expect(fresh).toMatchObject({phase: 'allocated', replacedReason: 'runtime_failed_to_start', failedStarts: 1, replacements: 1, size: 'small'});
    expect(fresh).not.toHaveProperty('cleanupRequested'); expect(fresh).not.toHaveProperty('runtimeOnly');
    expect(fresh.composeId).not.toBe(broken.composeId);
    expect(fresh.transferAttempt).toBe(1);
    expect(fresh.previous).toMatchObject({reason: 'runtime_failed_to_start'});
    expect(p.calls).toEqual(['create', 'expose', 'deploy:compose-1', 'stop:compose-1', 'remove:compose-1', 'create', 'expose', 'deploy:compose-2']);
    expect((await job(w)).state).toBe('pending');
  });
  it('stops replacing after three runtimes in a row failed to start and says so plainly', async () => {
    const {w, record} = await world(), p = provider({deployStatus: 'error'});
    await ensureAllocation(w.ctx, record, {provider: p, config, manager});
    for (let i = 1; i < MAX_FAILED_STARTS; i++) await provisionAllocation(w.ctx, record, {provider: p, config, manager}).catch(() => {});
    await recoverAllocation(w.ctx, record, {provider: p, config});
    expect((await stored(w, record))).toMatchObject({phase: 'disposed', failedStarts: MAX_FAILED_STARTS});
    const creates = p.calls.filter(c => c === 'create').length;
    await expect(provisionAllocation(w.ctx, record, {provider: p, config, manager})).rejects.toMatchObject({safeCode: 'playground_runtime_failed', message: expect.stringMatching(/failed to start 3 times in a row.*files are kept/)});
    expect(p.calls.filter(c => c === 'create')).toHaveLength(creates);
    expect(await inspectAllocation(w.ctx, record, {provider: p, config})).toMatchObject({phase: 'disposed', runtime_failed: true, next: expect.stringMatching(/nothing more is retried/)});
  });
  it('a removal whose process absence is not yet confirmed answers "being replaced, call provision again"', async () => {
    const {w, record} = await world(), p = provider({deployStatus: 'error'});
    await ensureAllocation(w.ctx, record, {provider: p, config, manager});
    p.containers = async () => [{State: 'running'}];
    await expect(provisionAllocation(w.ctx, record, {provider: p, config, manager})).rejects.toMatchObject({safeCode: 'playground_runtime_replacing', safeRetryable: true, message: expect.stringMatching(/being removed.*provision again/)});
  });
});

describe('plain answers for the agent', () => {
  it('attach on a still-starting runtime is refused as not started and points to reading the allocation', async () => {
    const {w, record} = await world(), p = provider(); p.deployStatus = 'running';
    await ensureAllocation(w.ctx, record, {provider: p, config, manager});
    await expect(attachRepository(w.ctx, record)).rejects.toMatchObject({noOperationStarted: true, message: expect.stringMatching(/still starting \(phase deploying\).*not another attach/)});
  });
  it('attach on a runtime marked for replacement says so and names provision as the single next call', async () => {
    const {w, record} = await world(), p = provider({deployStatus: 'error'});
    await ensureAllocation(w.ctx, record, {provider: p, config, manager});
    await expect(attachRepository(w.ctx, record)).rejects.toMatchObject({noOperationStarted: true, message: expect.stringMatching(/failed to start and is being replaced.*operation provision/)});
  });
  it('reading the allocation of a stuck runtime reports it as failed with the next call', async () => {
    const {w, record} = await world(), p = provider(); p.deployStatus = 'running';
    await ensureAllocation(w.ctx, record, {provider: p, config, manager});
    w.advanceClock(46 * MIN);
    expect(await inspectAllocation(w.ctx, record, {provider: p, config})).toMatchObject({runtime_failed: true, failed_reason: 'runtime_stuck', allocation_ready: false, next: expect.stringMatching(/no progress for 45 minutes.*operation provision/)});
  });
});

// Through the real tool (MCP handler, dispatch and github_call doors) with a fake Dokploy REST API.
function fakeDokploy(w, {status = 'running'} = {}) {
  const rows = new Map(); let n = 0; const prior = w.ctx.fetch;
  const fetch = async (url, init) => {
    if (new URL(url).origin !== config.origin) return prior(url, init);
    const u = new URL(url), op = u.pathname.split('/').pop(), input = init.method === 'GET' ? Object.fromEntries(u.searchParams) : JSON.parse(init.body), row = rows.get(input.composeId);
    if (op === 'project.one') return Response.json({projectId: config.project, environments: [{environmentId: config.environment, compose: [...rows.values()]}]});
    if (op === 'compose.create') { const created = {...input, composeId: 'compose-' + ++n, environment: {projectId: config.project}, domains: [], composeStatus: 'idle'}; rows.set(created.composeId, created); return Response.json(created); }
    if (op === 'compose.one') return Response.json(row ?? null, {status: row ? 200 : 404});
    if (op === 'domain.create') { row.domains.push(input); return Response.json(input); }
    if (op === 'compose.deploy') { row.composeStatus = row.appName?.includes('manager') ? 'done' : status; return Response.json({}); }
    throw Error('Unexpected provider operation ' + op);
  };
  w.gh.fetch = fetch; w.ctx = {...w.ctx, fetch, env: {...w.ctx.env, PUBLIC_BASE_URL: 'https://mcp.example.test'}};
  return rows;
}
it('through every door, attach on a still-starting runtime answers "not started" with one next call, and releases the key', async () => {
  const tool = {tool: tools.tools.find(t => t.name === 'github_playground_workspace'), handler: tools.handlers.github_playground_workspace};
  for (const door of doorsFor(tool)) {
    const {w} = await world(); fakeDokploy(w);
    expect(parse(await door.call(w, {...base, operation: 'provision', requestKey: 'p-' + door.name})).result).toMatchObject({phase: 'deploying'});
    const out = parse(await door.call(w, {...base, operation: 'attach', requestKey: 'a-' + door.name}));
    expect(out).toMatchObject({done: false, status: 'not_applied', reason_code: 'no_operation_started', no_change_sent: true});
    expect(out.error).toMatch(/still starting \(phase deploying\).*github_playground_read operation allocation/);
  }
});
