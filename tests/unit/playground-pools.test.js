import {it, expect, afterEach} from 'vitest';
import {makeWorld} from '../../test/helpers/write-contract.js';
import {preparePlaygroundWorld} from '../../test/helpers/playground-world.js';
import {playgroundRecord} from '../../src/playground/client.js';
import {dokployPools, choosePool, dokployConfig, dokployProvider, allocationPlan} from '../../src/playground/dokploy.js';
import {ensureAllocation, disposeAllocation} from '../../src/playground/allocations.js';

const base = {owner: 'example-org', repo: 'hello', workspace_id: 'job_0123456789abcdef'};
const cleanups = []; afterEach(async () => { for (const c of cleanups.splice(0)) await c(); });
const IMAGE = 'ghcr.io/example/runtime@sha256:' + 'a'.repeat(64);
const pools = (extra = {}) => ({
  PLAYGROUND_IMAGE: IMAGE, PUBLIC_BASE_URL: 'https://mcp.example.test',
  PLAYGROUND_KEY_EAST: 'FAKE_EAST_KEY', PLAYGROUND_KEY_WEST: 'FAKE_WEST_KEY',
  PLAYGROUND_POOLS: JSON.stringify([
    {id: 'east', origin: 'https://east.example.test', keyEnv: 'PLAYGROUND_KEY_EAST', project: 'p-east', environment: 'e-east', ingress: '203.0.113.10', serverId: 'srv_east'},
    {id: 'west', origin: 'https://west.example.test', keyEnv: 'PLAYGROUND_KEY_WEST', project: 'p-west', environment: 'e-west', ingress: '203.0.113.20', weight: 3}]), ...extra});

it('reads legacy settings as one default pool and validates pool lists without inline secrets', () => {
  const legacy = {PLAYGROUND_DOKPLOY_ORIGIN: 'https://d.example.test', PLAYGROUND_DOKPLOY_API_KEY: 'FAKE', PLAYGROUND_DOKPLOY_PROJECT_ID: 'p', PLAYGROUND_DOKPLOY_ENVIRONMENT_ID: 'e', PLAYGROUND_IMAGE: IMAGE, PLAYGROUND_INGRESS_IPV4: '203.0.113.1'};
  expect(dokployPools(legacy).map(p => p.pool)).toEqual(['default']);
  expect(dokployPools({})).toEqual([]);
  const two = dokployPools(pools());
  expect(two.map(p => [p.pool, p.origin, p.key, p.serverId ?? null, p.weight])).toEqual([['east', 'https://east.example.test', 'FAKE_EAST_KEY', 'srv_east', 1], ['west', 'https://west.example.test', 'FAKE_WEST_KEY', null, 3]]);
  expect(() => dokployPools({...pools(), PLAYGROUND_POOLS: '[{"id":"x","apiKey":"secret","keyEnv":"PLAYGROUND_K"}]'})).toThrow(/keyEnv/);
  expect(() => dokployPools({...pools(), PLAYGROUND_POOLS: '{'})).toThrow(/JSON/);
  expect(() => dokployConfig(pools(), 'gone')).toThrow(/no longer configured/);
  expect(dokployConfig(legacy, 'default').origin).toBe('https://d.example.test');
});

it('spreads new allocations by weight, deterministically, and skips weight-0 pools', () => {
  const env = pools(), counts = {east: 0, west: 0};
  for (let i = 0; i < 400; i++) { const b = i.toString(16).padStart(64, '0'); const p = choosePool(env, b); counts[p.pool]++; expect(choosePool(env, b).pool).toBe(p.pool); }
  expect(counts.west / counts.east).toBeGreaterThan(2); expect(counts.west / counts.east).toBeLessThan(4.5);
  const drained = JSON.parse(env.PLAYGROUND_POOLS); drained[1].weight = 0;
  expect(choosePool({...env, PLAYGROUND_POOLS: JSON.stringify(drained)}, 'f'.repeat(64)).pool).toBe('east');
});

it('creates on the chosen Dokploy server and keeps every later step on the same pool', async () => {
  const sent = [];
  const config = dokployConfig(pools(), 'east');
  const plan = allocationPlan({binding: 'b'.repeat(64), verificationKey: 'ed25519:FAKE', idleTimeoutMs: 14400000}, {...config, worker: 'git_' + '1'.repeat(32), nativeBinding: '2'.repeat(64)});
  const provider = dokployProvider(config, {fetch: async (url, init) => { sent.push({url: new URL(url), body: init.body && JSON.parse(init.body)}); const op = new URL(url).pathname.split('/').pop();
    if (op === 'project.one') return Response.json({projectId: 'p-east', environments: [{environmentId: 'e-east', compose: []}]});
    if (op === 'compose.create') return Response.json({composeId: 'c1'});
    return Response.json({composeId: 'c1', name: plan.name, appName: plan.name, environmentId: 'e-east', environment: {projectId: 'p-east'}, description: plan.description, composeFile: plan.composeFile, sourceType: 'raw'}); }});
  await provider.create(plan);
  const create = sent.find(s => s.url.pathname.endsWith('compose.create'));
  expect(create.url.origin).toBe('https://east.example.test'); expect(create.body.serverId).toBe('srv_east');

  const w = await makeWorld({profile: 'full', mode: 'production', gates: []}); w.gh.when('GET /repos/{owner}/{repo}').reply(200, {full_name: 'example-org/hello'});
  cleanups.push(await preparePlaygroundWorld(w)); delete w.ctx.env.PLAYGROUND_ALLOCATIONS; delete w.ctx.env.PLAYGROUND_ENFORCEMENT;
  Object.assign(w.ctx.env, pools());
  const record = await playgroundRecord(w.ctx, base, {allowUnattached: true});
  const rows = new Map(); let created = 0;
  const fake = {project: async () => ({}), inventory: async () => [...rows.values()], async create(p) { created++; const r = {composeId: 'x' + created, appName: p.name, plan: p, composeStatus: 'idle'}; rows.set(r.composeId, r); return r; },
    async inspect(id) { return rows.get(id) ?? null; }, async expose() {}, async deploy(id) { rows.get(id).composeStatus = 'done'; }, async stop() {}, async containers() { return []; }, async remove(id) { rows.delete(id); }, async absent(id) { return !rows.has(id); }};
  const row = await ensureAllocation(w.ctx, record, {provider: fake, manager: async () => {}});
  const chosen = choosePool(w.ctx.env, row.binding).pool;
  expect(row.pool).toBe(chosen); expect(row.providerOrigin).toBe(`https://${chosen}.example.test`);
  // Removing the pool from settings never moves or orphans the allocation silently.
  const only = JSON.parse(w.ctx.env.PLAYGROUND_POOLS).filter(p => p.id !== chosen);
  await expect(disposeAllocation({...w.ctx, env: {...w.ctx.env, PLAYGROUND_POOLS: JSON.stringify(only)}}, record, {provider: fake})).rejects.toThrow(/no longer configured/);
  expect((await disposeAllocation(w.ctx, record, {provider: fake})).phase).toBe('disposed');
});
