// PG-STUCK-1: which calls count as workspace activity (extend the idle lease), and closing a
// runtime-attached workspace in one call or by repeating the same call.
import {it, expect, describe, afterEach} from 'vitest';
import {makeWorld, parse} from '../../test/helpers/write-contract.js';
import {prepareNativeWorld} from '../../test/helpers/native-git-world.js';
import {preparePlaygroundWorld} from '../../test/helpers/playground-world.js';
import {nativeConnection} from '../../src/native-git/client.js';
import {playgroundRecord} from '../../src/playground/client.js';
import {ensureAllocation, allocationRecord} from '../../src/playground/allocations.js';
import * as native from '../../src/tools/native-git.js';
import * as playground from '../../src/tools/playground.js';

const ID = 'job_0123456789abcdef', MIN = 60000;
const cleanups = []; afterEach(async () => { for (const close of cleanups.splice(0)) await close(); });
async function nativeWorld() {
  const w = await makeWorld({profile: 'full', mode: 'production', gates: []});
  w.gh.nativeOutcome = 'ok'; w.gh.when('GET /repos/{owner}/{repo}').reply(200, {full_name: 'example-org/hello'});
  cleanups.push(await prepareNativeWorld(w, {existing: true})); await w.nativeReady();
  return w;
}
const expiry = async w => (await w.db.getJob(ID, nativeConnection(w.ctx))).expires_at.getTime();
const view = r => r?.content || r?.structuredContent ? parse(r) : r;
const call = (w, name, args, extra = {}) => (native.handlers[name] ?? playground.handlers[name])(args, {...w.ctx, ...extra});

describe('only real work extends the idle lease', () => {
  it('status reads and failed preflights do not; Git reads and Git operations do', async () => {
    const w = await nativeWorld();
    w.advanceClock(10 * MIN); await call(w, 'github_git_workspace_read', {workspace_id: ID, operation: 'refs'});
    const renewed = await expiry(w); expect(renewed).toBe(w.ctx.now() + 240 * MIN);
    // A status check, even repeated, is not activity.
    w.advanceClock(10 * MIN);
    for (let i = 0; i < 3; i++) expect(view(await call(w, 'github_git_workspace_read', {workspace_id: ID, operation: 'status'}))).toMatchObject({state: 'ready', head: expect.stringMatching(/^[a-f0-9]{40}$/)});
    expect(await expiry(w)).toBe(renewed);
    // A refused write (bad arguments) is not activity either.
    parse(await call(w, 'github_git_workspace_run', {workspace_id: ID, operation: 'branch_create', expectedGeneration: 0, options: {}, requestKey: 'bad'}));
    expect(await expiry(w)).toBe(renewed);
    // A real Git operation is.
    w.advanceClock(5 * MIN);
    expect(parse(await call(w, 'github_git_workspace_run', {workspace_id: ID, operation: 'branch_create', expectedGeneration: 0, options: {name: 'activity'}, requestKey: 'real'})).status).toBe('applied');
    expect(await expiry(w)).toBe(w.ctx.now() + 240 * MIN);
  });
  it('a Playground status/log read through the runtime is activity', async () => {
    const w = await makeWorld({profile: 'full', mode: 'production', gates: []});
    w.gh.when('GET /repos/{owner}/{repo}').reply(200, {full_name: 'example-org/hello'});
    cleanups.push(await preparePlaygroundWorld(w));
    w.advanceClock(20 * MIN);
    await call(w, 'github_playground_read', {owner: 'example-org', repo: 'hello', workspace_id: ID, operation: 'status', execution_id: 'a'.repeat(64)});
    expect(await expiry(w)).toBe(w.ctx.now() + 240 * MIN);
  });
});

describe('closing a workspace', () => {
  it('an unconfirmed close is finished by the same call again (same requestKey), not a new key', async () => {
    const w = await nativeWorld();
    w.gh.nativeOutcome = 'mismatch'; // the worker does not close it on the first try
    const first = parse(await call(w, 'github_git_workspace_close', {workspace_id: ID, requestKey: 'close-once'}));
    expect(first).toMatchObject({status: 'unconfirmed', done: false});
    w.gh.nativeOutcome = 'ok';
    const again = parse(await call(w, 'github_git_workspace_close', {workspace_id: ID, requestKey: 'close-once'}));
    expect(again).toMatchObject({status: 'replayed', done: true, confirmed: true, replay_state: 'current', result: {disposed: true}});
    expect((await w.db.getJob(ID, nativeConnection(w.ctx))).state).toBe('ready');
    // And once more: nothing is sent again.
    const closes = w.nativeRequests.filter(a => a === 'close').length;
    expect(parse(await call(w, 'github_git_workspace_close', {workspace_id: ID, requestKey: 'close-once'}))).toMatchObject({status: 'replayed', done: true});
    expect(w.nativeRequests.filter(a => a === 'close')).toHaveLength(closes);
  });

  // A workspace with a Playground runtime on a fake Dokploy whose containers stop only after `stopsAfter` checks.
  async function attachedWorld({stopsAfter = 0} = {}) {
    const w = await makeWorld({profile: 'full', mode: 'production', gates: []});
    w.gh.nativeOutcome = 'ok'; w.gh.when('GET /repos/{owner}/{repo}').reply(200, {full_name: 'example-org/hello'});
    cleanups.push(await prepareNativeWorld(w, {existing: true})); await w.nativeReady();
    const config = {origin: 'https://dokploy.example.test', key: 'FAKE_PROVIDER_KEY', project: 'fixture', environment: 'fixture-env', image: 'ghcr.io/example/runtime@sha256:' + 'a'.repeat(64), ingress: '107.90.116.157'};
    const rows = new Map(); let n = 0, checks = 0; const prior = w.ctx.fetch;
    const fetch = async (url, init) => {
      if (new URL(url).origin !== config.origin) return prior(url, init);
      const u = new URL(url), op = u.pathname.split('/').pop(), input = init.method === 'GET' ? Object.fromEntries(u.searchParams) : JSON.parse(init.body), row = rows.get(input.composeId);
      if (op === 'project.one') return Response.json({projectId: config.project, environments: [{environmentId: config.environment, compose: [...rows.values()]}]});
      if (op === 'compose.create') { const created = {...input, composeId: 'compose-' + ++n, environment: {projectId: config.project}, domains: [], composeStatus: 'idle'}; rows.set(created.composeId, created); return Response.json(created); }
      if (op === 'compose.one') return Response.json(row ?? null, {status: row ? 200 : 404});
      if (op === 'domain.create') { row.domains.push(input); return Response.json(input); }
      if (op === 'compose.deploy') { row.composeStatus = 'done'; return Response.json({}); }
      if (op === 'compose.stop') { row.stopped = true; return Response.json({}); }
      if (op === 'docker.getContainersByAppNameMatch') { const live = [...rows.values()].filter(r => r.appName === input.appName); return Response.json(live.map(r => ({State: r.stopped && ++checks > stopsAfter ? 'exited' : 'running'}))); }
      if (op === 'compose.delete') { rows.delete(input.composeId); return Response.json({}); }
      if (op === 'dockerVolume.getVolumeConfig') return Response.json(null, {status: 404});
      throw Error('Unexpected provider operation ' + op);
    };
    w.gh.fetch = fetch;
    w.ctx = {...w.ctx, fetch, sleep: async () => {}, env: {...w.ctx.env, PLAYGROUND_DOKPLOY_ORIGIN: config.origin, PLAYGROUND_DOKPLOY_API_KEY: config.key, PLAYGROUND_DOKPLOY_PROJECT_ID: config.project, PLAYGROUND_DOKPLOY_ENVIRONMENT_ID: config.environment, PLAYGROUND_IMAGE: config.image, PLAYGROUND_INGRESS_IPV4: config.ingress, PLAYGROUND_ADMISSION: JSON.stringify({project: config.project, observedAt: w.ctx.now(), availableMemoryBytes: 8 * 1024 ** 3, availableDiskBytes: 10 * 1024 ** 3, pressure: 0})}};
    const record = await playgroundRecord(w.ctx, {owner: 'example-org', repo: 'hello', workspace_id: ID}, {allowUnattached: true});
    expect((await ensureAllocation(w.ctx, record, {manager: async () => {}})).phase).toBe('allocated');
    return {w, record};
  }
  it('the first call waits for the runtime to be deleted, then closes the workspace (applied in one call)', async () => {
    const {w, record} = await attachedWorld({stopsAfter: 2});
    const out = parse(await call(w, 'github_git_workspace_close', {workspace_id: ID, requestKey: 'close-attached'}));
    expect(out).toMatchObject({status: 'applied', done: true, result: {disposed: true}});
    expect((await allocationRecord(w.ctx, record)).phase).toBe('disposed');
    expect((await w.db.getJob(ID, nativeConnection(w.ctx))).detail).toBe('Native workspace disposed.');
  });
  it('a runtime still deleting past the budget answers "call again with the same arguments", and that same call finishes it', async () => {
    const {w, record} = await attachedWorld({stopsAfter: 1000});
    const out = parse(await call(w, 'github_git_workspace_close', {workspace_id: ID, requestKey: 'close-slow'}, {runtimeDisposeBudgetMs: 1}));
    expect(out).toMatchObject({done: false, status: 'rejected', retryable: true});
    expect(out.error).toMatch(/still being deleted.*call github_git_workspace_close again with the same arguments/i);
    expect((await w.db.getJob(ID, nativeConnection(w.ctx))).state).toBe('pending');
    // The containers stop; the identical call (same requestKey) completes the close.
    w.ctx.fetch = (orig => async (url, init) => { const res = await orig(url, init); if (String(url).includes('getContainersByAppNameMatch')) return Response.json((await res.json()).map(() => ({State: 'exited'}))); return res; })(w.ctx.fetch);
    w.gh.fetch = w.ctx.fetch;
    const again = parse(await call(w, 'github_git_workspace_close', {workspace_id: ID, requestKey: 'close-slow'}));
    expect(again).toMatchObject({status: 'applied', done: true, result: {disposed: true}});
    expect((await allocationRecord(w.ctx, record)).phase).toBe('disposed');
  });
});
