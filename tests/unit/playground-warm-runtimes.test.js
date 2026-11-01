// FLEET-7 warm-runtime gate: on/off decisions (demand and fresh host headroom below/above the
// stored thresholds), pool sizing from demand capped by headroom, drain when demand falls or
// headroom shrinks, the tenant-free image-holder plan (never pre-bound), provider request shapes
// against a fake Dokploy, crash recovery, sweep coverage, and the plain-words read output.
import {afterEach, describe, expect, it} from 'vitest';
import {warmDecision, warmSettings, warmHolderPlan, reconcileWarmRuntimes, warmRuntimeStatus, WARM_DEFAULTS, WARM_STATE_KEY, WARM_NAME_PREFIX} from '../../src/playground/warm-runtimes.js';
import {sweepAllocations} from '../../src/playground/manager.js';
import {allocationPlan, dokployProvider} from '../../src/playground/dokploy.js';
import {_resetPrebuiltImageCache} from '../../src/playground/prebuilt-image.js';
import {createFakeDb} from '../../test/helpers/fake-db.js';
import {makeWorld, parse} from '../../test/helpers/write-contract.js';
import {prepareNativeWorld} from '../../test/helpers/native-git-world.js';
import * as playground from '../../src/tools/playground.js';

const NOW = 1793318400000, GiB = 1024 ** 3, GB = 1000 ** 3;
const SHA = 'c'.repeat(40), FULL = 'sha256:' + 'd'.repeat(64), SLIM = 'sha256:' + 'e'.repeat(64), REPO = 'ghcr.io/example-org/runtime';
const IMAGES = {full: REPO + '@' + FULL, slim: REPO + '@' + SLIM};
const big = (over = {}) => ({project: 'fixture', observedAt: NOW - 1000, availableMemoryBytes: 24 * GiB, availableDiskBytes: 120 * GB, pressure: 0.2, ...over});
const demand = (total, slim = 0) => ({total, variants: {full: total - slim, slim}});
const decide = over => warmDecision({env: {}, pool: 'default', project: 'fixture', demand: demand(240), observation: big(), images: IMAGES, now: NOW, ...over});
afterEach(() => _resetPrebuiltImageCache());

describe('the gate decides from measured demand and fresh headroom', () => {
  it('defaults keep it dormant on today\'s single small shared host', () => {
    expect(WARM_DEFAULTS).toEqual({minAllocationsPerHour: 6, allocationsPerImage: 6, maxImages: 2, minHostMemoryBytes: 8 * GiB, minHostDiskBytes: 50 * GB, maxHostPressure: 0.5, diskPerImageBytes: 6 * GB});
    // A handful of runtimes a day, best effort without a capacity feed (production today).
    const today = decide({demand: demand(12), observation: undefined});
    expect(today).toMatchObject({enabled: false, target: 0, images: [], demand_per_hour: 0.5});
    expect(today.reason).toMatch(/12 new runtimes started in the last 24 hours \(0\.5 per hour\), below the 6 per hour needed/);
    // Even at high demand, a small host with a fresh reading stays off.
    expect(decide({observation: big({availableMemoryBytes: 3 * GiB, availableDiskBytes: 40 * GB})}).reason).toMatch(/free memory 3\.0 GiB is below 8\.0 GiB/);
  });
  it('is off below each threshold and on only when demand AND headroom both exceed them', () => {
    expect(decide({demand: demand(143)})).toMatchObject({enabled: false});
    expect(decide({demand: demand(144)})).toMatchObject({enabled: true, target: 1});
    expect(decide({observation: undefined}).reason).toMatch(/no fresh host measurement/);
    expect(decide({observation: null}).enabled).toBe(false);
    expect(decide({observation: big({observedAt: NOW - 61000})}).reason).toMatch(/no fresh host measurement/);
    expect(decide({observation: big({observedAt: NOW + 1})}).enabled).toBe(false);
    expect(decide({observation: big({project: 'other'})}).enabled).toBe(false);
    expect(decide({observation: big({availableDiskBytes: 49 * GB})}).reason).toMatch(/free disk 49 GB is below 50 GB/);
    expect(decide({observation: big({pressure: 0.6})}).reason).toMatch(/host pressure 0\.6 is above 0\.5/);
    const on = decide({});
    expect(on).toMatchObject({enabled: true, target: 1, images: [{variant: 'full', image: IMAGES.full}]}); // only the full image is in use
    expect(on.reason).toMatch(/^Warm runtimes are on: 10 new runtimes per hour.*Nothing is pre-bound to any workspace or credential\.$/);
  });
  it('honours the kill switch and fails closed on any invalid protected setting', () => {
    expect(decide({env: {PLAYGROUND_WARM_RUNTIMES: 'off'}}).reason).toMatch(/PLAYGROUND_WARM_RUNTIMES is off/);
    expect(decide({env: {PLAYGROUND_WARM_RUNTIMES: 'always'}}).enabled).toBe(false);
    for (const [name, value] of [['PLAYGROUND_WARM_MIN_ALLOCATIONS_PER_HOUR', '0'], ['PLAYGROUND_WARM_MAX_IMAGES', '9'], ['PLAYGROUND_WARM_MAX_HOST_PRESSURE', '2'], ['PLAYGROUND_WARM_MIN_HOST_DISK_BYTES', 'lots']]) {
      expect(warmSettings({[name]: value}).ok).toBe(false);
      expect(decide({env: {[name]: value}})).toMatchObject({enabled: false, reason: expect.stringContaining(name)});
    }
    expect(decide({env: {PLAYGROUND_WARM_MAX_IMAGES: '0'}}).enabled).toBe(false);
    expect(decide({env: {PLAYGROUND_WARM_MIN_ALLOCATIONS_PER_HOUR: '1'}, demand: demand(24)})).toMatchObject({enabled: true, target: 1});
  });
  it('stays off when no digest-pinned image exists (source builds have nothing to keep ready)', () => {
    expect(decide({images: {full: null, slim: null}}).reason).toMatch(/no published, digest-pinned runtime image/);
    expect(decide({images: {pinned: null}}).enabled).toBe(false);
  });
});

describe('pool sizing', () => {
  it('sizes from demand, ranks images by use and caps by images, headroom and running holders', () => {
    expect(decide({demand: demand(240, 0)})).toMatchObject({target: 1, images: [{variant: 'full'}]}); // only full is used
    expect(decide({demand: demand(240, 200)})).toMatchObject({target: 2, images: [{variant: 'slim'}, {variant: 'full'}]});
    expect(decide({demand: demand(150, 100), env: {PLAYGROUND_WARM_ALLOCATIONS_PER_IMAGE: '12'}})).toMatchObject({target: 1, images: [{variant: 'slim'}]});
    expect(decide({demand: demand(2400, 1200), env: {PLAYGROUND_WARM_MAX_IMAGES: '1'}}).target).toBe(1);
    // 56 GB free, 50 GB minimum, 6 GB per image: room for one more image only.
    expect(decide({demand: demand(240, 120), observation: big({availableDiskBytes: 56 * GB})}).target).toBe(1);
    expect(decide({demand: demand(240, 120), observation: big({availableDiskBytes: 55 * GB})}).reason).toMatch(/no room for another 6 GB runtime image/);
    // An image already warm is already counted in the free-disk reading, so it is not drained by its own footprint.
    expect(decide({demand: demand(240, 120), observation: big({availableDiskBytes: 55 * GB}), running: 1}).target).toBe(1);
    expect(decide({images: {pinned: REPO + '@' + FULL}, demand: demand(2400, 1200)})).toMatchObject({target: 1, images: [{variant: 'operator_pinned', image: REPO + '@' + FULL}]});
  });
});

describe('a warm runtime is never pre-bound', () => {
  const plan = warmHolderPlan({pool: 'default', image: IMAGES.full, variant: 'full', origin: 'https://mcp.example.test'});
  const body = JSON.parse(plan.composeFile), svc = body.services.warm;
  it('holds only the image: no environment, volume, network, port, domain, binding, key or credential', () => {
    expect(Object.keys(body.services)).toEqual(['warm']);
    expect(body).not.toHaveProperty('volumes');
    expect(body).not.toHaveProperty('networks');
    expect(svc).toMatchObject({image: IMAGES.full, read_only: true, user: '1000:1000', cap_drop: ['ALL'], security_opt: ['no-new-privileges:true'], network_mode: 'none', restart: 'no', mem_limit: '64m', cpus: '0.05'});
    for (const key of ['environment', 'volumes', 'ports', 'expose', 'networks', 'tmpfs', 'cap_add', 'env_file', 'secrets', 'build']) expect(svc).not.toHaveProperty(key);
    expect(Object.keys(svc.labels)).toEqual(['com.robinson.playground.owner', 'com.robinson.playground.warm']);
    expect(plan.composeFile).not.toMatch(/binding|ed25519|NATIVE_GIT|CODING_|SWEEP|FAKE|api\/playground|tenant/i);
    expect(plan.volumes).toEqual([]);
  });
  it('is the same for every tenant and cannot collide with any workspace allocation name', () => {
    expect(warmHolderPlan({pool: 'default', image: IMAGES.full, variant: 'full', origin: 'https://mcp.example.test'})).toEqual(plan);
    expect(plan.name).toMatch(new RegExp('^' + WARM_NAME_PREFIX + '[a-f0-9]{16}$'));
    const allocation = allocationPlan({binding: 'b'.repeat(64), verificationKey: 'ed25519:FAKE_PUBLIC', idleTimeoutMs: 14400000}, {image: IMAGES.full, ingress: '107.90.116.157', worker: 'git_' + '1'.repeat(32), nativeBinding: '2'.repeat(64)});
    expect(allocation.name).toMatch(/^ras-pg-[a-f0-9]{32}$/); // hex only: "warm" can never be a binding prefix
    expect(plan.name.startsWith(allocation.name)).toBe(false);
    expect(() => warmHolderPlan({pool: 'default', image: 'ras-playground:' + SHA, variant: 'source_build', origin: 'https://mcp.example.test'})).toThrow(/digest-pinned/);
  });
});

// Fake Dokploy with the pinned operation names, methods and bodies of src/playground/dokploy.js.
function fakeDokploy({project = 'fixture', environment = 'fixture-env'} = {}) {
  const rows = new Map(), calls = [];let sequence = 0, loseCreate = false, foreign = false;
  const fetch = async (url, init) => {
    const u = new URL(url), op = u.pathname.split('/').pop(), input = init.method === 'GET' ? Object.fromEntries(u.searchParams) : JSON.parse(init.body), row = rows.get(input.composeId);
    calls.push({op, method: init.method, input});
    expect(init.headers['x-api-key']).toBe('FAKE_PROJECT_KEY');
    if (op === 'project.one') return Response.json({projectId: project, environments: [{environmentId: environment, compose: [...rows.values()]}]});
    if (op === 'compose.create') { expect(init.method).toBe('POST'); const created = {...input, appName: input.appName + '-a1b2c3', composeId: 'compose-' + ++sequence, environment: {projectId: project}, composeStatus: 'idle', containers: []}; rows.set(created.composeId, created); if (loseCreate) { loseCreate = false; return new Response('lost', {status: 502}); } return Response.json(created); }
    if (op === 'compose.one') return row ? Response.json(foreign ? {...row, composeFile: '{"tampered":true}'} : row) : Response.json(null, {status: 404});
    if (op === 'compose.deploy') { row.composeStatus = 'done'; row.containers = [{Id: 'c-' + row.composeId, State: 'running'}]; return Response.json({}); }
    if (op === 'domain.create') { (row.domains ??= []).push(input); return Response.json(input); }
    if (op === 'compose.stop') { for (const c of row.containers) c.State = 'exited'; return Response.json({}); }
    if (op === 'compose.delete') { expect(input.deleteVolumes).toBe(true); rows.delete(input.composeId); return Response.json({}); }
    if (op === 'docker.getContainersByAppNameMatch') return Response.json([...rows.values()].filter(r => r.appName === input.appName).flatMap(r => r.containers));
    throw Error('Unexpected provider operation ' + op);
  };
  return {rows, calls, fetch, loseNextCreate: () => { loseCreate = true; }, tamper: () => { foreign = true; }};
}
function registry() {
  return async url => {
    if (url.startsWith('https://ghcr.io/token')) return {status: 200, json: async () => ({token: 'anon-pull-token'})};
    const tag = url.split('/manifests/')[1], digest = tag === SHA + '-slim' ? SLIM : tag === SHA ? FULL : null;
    return {status: digest ? 200 : 404, headers: {get: k => (k === 'docker-content-digest' ? digest : null)}};
  };
}
const poolEnv = {PUBLIC_BASE_URL: 'https://mcp.example.test', PLAYGROUND_DOKPLOY_ORIGIN: 'https://dokploy.example.test', PLAYGROUND_DOKPLOY_API_KEY: 'FAKE_PROJECT_KEY', PLAYGROUND_DOKPLOY_PROJECT_ID: 'fixture', PLAYGROUND_DOKPLOY_ENVIRONMENT_ID: 'fixture-env', PLAYGROUND_INGRESS_IPV4: '107.90.116.157', PLAYGROUND_IMAGE_REPOSITORY: REPO, PLAYGROUND_BUILD_SOURCE_SHA: SHA};
async function harness({allocations = 240, slim = 0, observation = big()} = {}) {
  let now = NOW;const db = createFakeDb({clock: () => now}), dokploy = fakeDokploy(), reg = registry();
  const fetch = (url, init) => String(url).startsWith('https://ghcr.io/') ? reg(String(url), init) : dokploy.fetch(url, init);
  const h = {db, dokploy, fetch, env: {...poolEnv, PLAYGROUND_ADMISSION: JSON.stringify(observation)}, advance: ms => { now += ms; }, now: () => now};
  h.demand = async (count, slimCount = 0, at = now - HOUR_MS) => { for (let i = 0; i < count; i++) await db.setSetting('pg_index.' + 'a'.repeat(8) + String(h.seq = (h.seq ?? 0) + 1).padStart(6, '0'), {kind: 'playground-index', revision: 1, allocation: {binding: String(h.seq).padStart(64, '0'), pool: 'default', phase: 'disposed', createdAt: at, revision: 1, runtimeImage: {variant: i < slimCount ? 'slim' : 'full'}}}); };
  h.round = () => reconcileWarmRuntimes({root: db, env: h.env, fetch, now: h.now});
  h.state = () => db.getSetting(WARM_STATE_KEY);
  await h.demand(allocations, slim);
  return h;
}
const HOUR_MS = 3600000;

describe('reconcile: create, run and drain image holders through the fake Dokploy', () => {
  it('counts disposed allocations as demand, excludes device runs and old rows', async () => {
    const h = await harness({allocations: 4});
    await h.db.setSetting('pg_index.zzzz', {kind: 'playground-index', allocation: {binding: 'f'.repeat(64), placement: 'device', createdAt: NOW, revision: 1}});
    await h.demand(3, 0, NOW - 25 * HOUR_MS);
    expect(await h.db.playgroundDemandSince(NOW - 24 * HOUR_MS)).toEqual([{pool: 'default', variant: 'full', count: 4}]);
    await expect(h.db.playgroundDemandSince(-1)).rejects.toThrow();
  });
  it('dormant gate makes no provider, telemetry or registry call and stores nothing', async () => {
    const h = await harness({allocations: 10});
    expect(await h.round()).toMatchObject({enabled: false, running: 0, holders: 0, pending: 0});
    expect(h.dokploy.calls).toEqual([]);
    expect(await h.state()).toBeNull();
  });
  it('creates one holder per round with the pinned request shape, deploys it, then marks it running', async () => {
    const h = await harness({allocations: 240, slim: 200});
    await h.round();
    const create = h.dokploy.calls.find(c => c.op === 'compose.create');
    expect(create.input).toMatchObject({environmentId: 'fixture-env', composeType: 'docker-compose', sourceType: 'raw', name: expect.stringMatching(/^ras-pg-warm-/)});
    expect(JSON.parse(create.input.composeFile).services.warm.image).toBe(IMAGES.slim); // most used first
    expect(h.dokploy.calls.filter(c => c.op === 'compose.create')).toHaveLength(1);
    let holders = Object.values((await h.state()).holders);
    expect(holders).toMatchObject([{variant: 'slim', phase: 'deploying', providerAppName: expect.stringMatching(/-a1b2c3$/)}]);
    expect(h.dokploy.calls.filter(c => c.op === 'compose.deploy')).toHaveLength(1);
    await h.round();
    expect(h.dokploy.calls.filter(c => c.op === 'compose.create')).toHaveLength(2); // second image, next round
    expect(h.dokploy.calls.filter(c => c.op === 'compose.deploy')).toHaveLength(2);
    await h.round();
    holders = Object.values((await h.state()).holders);
    expect(holders.map(x => [x.variant, x.phase]).sort()).toEqual([['full', 'running'], ['slim', 'running']]);
    expect(await h.round()).toMatchObject({enabled: true, running: 2, pending: 0});
    expect(h.dokploy.calls.filter(c => c.op === 'compose.create')).toHaveLength(2); // steady state: nothing new
  });
  it('drains every holder with stop, exited-container check, delete and absence readback when demand falls', async () => {
    const h = await harness({allocations: 240});
    for (let i = 0; i < 3; i++) await h.round();
    expect(Object.values((await h.state()).holders)).toMatchObject([{phase: 'running'}]);
    h.advance(25 * HOUR_MS); h.dokploy.calls.length = 0; // the demand window has moved on
    expect(await h.round()).toMatchObject({enabled: false, drained: 1, holders: 0, pending: 0});
    expect(h.dokploy.calls.map(c => c.op)).toEqual(['compose.one', 'compose.one', 'compose.stop', 'docker.getContainersByAppNameMatch', 'compose.one', 'docker.getContainersByAppNameMatch', 'compose.delete', 'compose.one', 'docker.getContainersByAppNameMatch']);
    expect(h.dokploy.rows.size).toBe(0);
    expect((await h.state()).holders).toEqual({});
  });
  it('drains when headroom shrinks or the feed goes stale', async () => {
    for (const shrink of [big({pressure: 0.95}), big({observedAt: NOW - 120000})]) {
      const h = await harness({allocations: 240});
      for (let i = 0; i < 3; i++) await h.round();
      h.env.PLAYGROUND_ADMISSION = JSON.stringify(shrink);
      expect(await h.round()).toMatchObject({enabled: false, drained: 1, holders: 0});
      expect(h.dokploy.rows.size).toBe(0);
    }
  });
  it('the kill switch drains immediately', async () => {
    const h = await harness({allocations: 240});
    for (let i = 0; i < 3; i++) await h.round();
    h.env.PLAYGROUND_WARM_RUNTIMES = 'off';
    expect(await h.round()).toMatchObject({drained: 1, holders: 0});
  });
  it('recovers a lost create response from exact inventory instead of creating a duplicate', async () => {
    const h = await harness({allocations: 240});
    h.dokploy.loseNextCreate();
    expect((await h.round()).pending).toBe(1);
    expect(Object.values((await h.state()).holders)).toMatchObject([{phase: 'creating'}]);
    await h.round();
    expect(h.dokploy.calls.filter(c => c.op === 'compose.create')).toHaveLength(1);
    expect(Object.values((await h.state()).holders)).toMatchObject([{phase: 'deploying', composeId: 'compose-1'}]);
  });
  it('a create that never appears is dropped only after ten minutes; a tampered holder is never deleted', async () => {
    const h = await harness({allocations: 240});
    h.dokploy.loseNextCreate(); await h.round(); h.dokploy.rows.clear();
    expect((await h.round()).pending).toBe(1);
    h.advance(11 * 60000); h.env.PLAYGROUND_ADMISSION = JSON.stringify(big({observedAt: h.now() - 1000}));
    await h.round(); // the uncertain record is dropped
    expect((await h.state()).holders).toEqual({});
    await h.round();
    expect(h.dokploy.calls.filter(c => c.op === 'compose.create')).toHaveLength(2);
    const t = await harness({allocations: 240});
    for (let i = 0; i < 3; i++) await t.round();
    t.dokploy.tamper(); t.env.PLAYGROUND_WARM_RUNTIMES = 'off';
    expect(await t.round()).toMatchObject({pending: 1, holders: 1});
    expect(t.dokploy.calls.some(c => ['compose.stop', 'compose.delete'].includes(c.op))).toBe(false);
  });
  it('places holders on the pool\'s own server and refuses to touch holders of a removed pool', async () => {
    const h = await harness({allocations: 240});
    const pools = [{id: 'default', origin: 'https://dokploy.example.test', keyEnv: 'PLAYGROUND_KEY_DEFAULT', project: 'fixture', environment: 'fixture-env', ingress: '107.90.116.157', serverId: 'server-1'}];
    h.env = {...h.env, PLAYGROUND_POOLS: JSON.stringify(pools), PLAYGROUND_KEY_DEFAULT: 'FAKE_PROJECT_KEY'};
    await h.round();
    expect(h.dokploy.calls.find(c => c.op === 'compose.create').input.serverId).toBe('server-1');
    const {PLAYGROUND_DOKPLOY_ORIGIN: _legacy, ...rest} = h.env;
    h.env = {...rest, PLAYGROUND_POOLS: JSON.stringify([{...pools[0], id: 'east'}])};
    expect(await h.round()).toMatchObject({pending: 1, holders: 1});
    expect(h.dokploy.rows.size).toBe(1);
  });
});

describe('sweep coverage', () => {
  it('the cleanup sweep runs the gate and drains warm holders even with no allocations left to inspect', async () => {
    const h = await harness({allocations: 240});
    for (let i = 0; i < 3; i++) await h.round();
    h.advance(25 * HOUR_MS);
    const out = await sweepAllocations({root: h.db, env: h.env, fetch: h.fetch, now: h.now, providerFactory: dokployProvider});
    expect(out).toMatchObject({inspected: 0, disposed: 0, pending: 0, warm: {enabled: false, running: 0, pending: false}});
    expect(h.dokploy.rows.size).toBe(0);
  });
  it('a failing warm step never blocks allocation cleanup', async () => {
    const db = createFakeDb();
    const out = await sweepAllocations({root: db, env: poolEnv, warm: async () => { throw new Error('down'); }});
    expect(out).toMatchObject({inspected: 0, pending: 0, warm: {enabled: false, pending: true}});
  });
});

describe('plain-words visibility', () => {
  it('github_playground_read capabilities and availability without a workspace explain the decision', async () => {
    const h = await harness({allocations: 12});
    const ctx = {db: h.db, env: h.env, fetch: h.fetch, now: h.now};
    const status = await warmRuntimeStatus(ctx);
    expect(status).toMatchObject({enabled: false, pools: [{pool: 'default', enabled: false, target_images: 0, demand_per_hour: 0.5}], warm_images: []});
    expect(status.reason).toMatch(/^Warm runtimes are off: 12 new runtimes started in the last 24 hours/);
    expect(status.never_bound).toMatch(/holds no workspace, connection, tenant or credential/);
    expect(await warmRuntimeStatus({db: h.db, env: {}})).toMatchObject({enabled: false, reason: expect.stringMatching(/no shared Playground pool/)});
    expect(await warmRuntimeStatus({db: {getSetting: async () => { throw new Error('db down'); }}, env: h.env})).toMatchObject({enabled: false, reason: expect.stringMatching(/could not be evaluated/)});
    const w = await makeWorld({profile: 'full', mode: 'production', gates: []});
    for (const operation of ['capabilities', 'availability']) {
      const out = await playground.handlers.github_playground_read({operation}, {...w.ctx, env: {...w.ctx.env, ...poolEnv}});
      const shown = out.structuredContent ?? out;
      expect(shown.warm_runtimes).toMatchObject({enabled: false, reason: expect.stringMatching(/^Warm runtimes are off: 0 new runtimes/)});
    }
  });
});

// The allocation path is unchanged: with a warm holder running, a provision still creates its own
// fresh per-binding compose; the holder is never inspected, adopted, redeployed or deleted by it.
const cleanups = []; afterEach(async () => { for (const close of cleanups.splice(0)) await close(); });
it('a workspace provision never adopts or touches a warm holder; it uses the same image the holder keeps ready', async () => {
  const w = await makeWorld({profile: 'full', mode: 'production', gates: []});
  w.gh.nativeOutcome = 'ok'; w.gh.when('GET /repos/{owner}/{repo}').reply(200, {full_name: 'example-org/hello'});
  cleanups.push(await prepareNativeWorld(w, {existing: true}));
  const dokploy = fakeDokploy(), reg = registry(), prior = w.ctx.fetch;
  const fetch = async (url, init) => String(url).startsWith('https://ghcr.io/') ? reg(String(url), init) : new URL(url).origin === 'https://dokploy.example.test' ? dokploy.fetch(url, init) : prior(url, init);
  w.gh.fetch = fetch;
  const env = {...w.ctx.env, ...poolEnv, PLAYGROUND_ADMISSION: JSON.stringify(big({observedAt: w.ctx.now() - 1000}))};
  w.ctx = {...w.ctx, fetch, env};
  await w.nativeReady();
  for (let i = 0; i < 240; i++) await w.db.setSetting('pg_index.warmdemand' + String(i).padStart(4, '0'), {kind: 'playground-index', allocation: {binding: String(i).padStart(64, '0'), pool: 'default', phase: 'disposed', createdAt: w.ctx.now() - 1000, revision: 9, runtimeImage: {variant: 'full'}}});
  for (let i = 0; i < 3; i++) await reconcileWarmRuntimes({root: w.db, env, fetch, now: w.ctx.now});
  const [holder] = [...dokploy.rows.values()];
  expect(holder.composeStatus).toBe('done');
  const frozen = JSON.stringify(holder);dokploy.calls.length = 0;
  const out = parse(await playground.handlers.github_playground_workspace({owner: 'example-org', repo: 'hello', workspace_id: 'job_0123456789abcdef', operation: 'provision', size: 'medium', requestKey: 'p-warm'}, w.ctx));
  expect(out.status, JSON.stringify(out)).toBe('applied');
  const workspace = [...dokploy.rows.values()].find(r => r.composeId !== holder.composeId && !r.name.includes('manager'));
  expect(workspace.name).toMatch(/^ras-pg-[a-f0-9]{32}$/);
  expect(workspace.composeFile).toContain(IMAGES.full);
  expect(JSON.stringify(dokploy.rows.get(holder.composeId))).toBe(frozen);
  expect(dokploy.calls.filter(c => c.input.composeId === holder.composeId)).toEqual([]);
});
