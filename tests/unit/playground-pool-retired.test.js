// DOKPLOY-RETIRE-1 (2026-11-17): the shared operator pool (Dokploy) is retired. A runtime is placed only on a
// computer paired with github_playground_host_pairing; a row left from the retired pool is closed in place;
// the maintenance sweep is called by a scheduler (the rack's project timer) with the deployment's CRON_SECRET.
import {it, expect, afterEach} from 'vitest';
import {makeWorld} from '../../test/helpers/write-contract.js';
import {preparePlaygroundWorld} from '../../test/helpers/playground-world.js';
import {nativeRecord, nativeConnection} from '../../src/native-git/client.js';
import {playgroundBinding} from '../../src/playground/client.js';
import {ensureAllocation, inspectAllocation, disposeAllocation, allocationKey, allocationRecord} from '../../src/playground/allocations.js';
import {playgroundAvailability} from '../../src/playground/availability.js';
import {allocationAuthority} from '../../src/playground/lifecycle.js';
import {sweep, sweepKey} from '../../src/playground/manager.js';

const cleanups = []; afterEach(async () => { for (const close of cleanups.splice(0)) await close(); });

async function world() {
  const w = await makeWorld({profile: 'full', mode: 'production', gates: []});
  w.gh.nativeOutcome = 'ok'; w.gh.when('GET /repos/{owner}/{repo}').reply(200, {full_name: 'example-org/hello'});
  cleanups.push(await preparePlaygroundWorld(w));
  const record = await nativeRecord(w.ctx, 'job_0123456789abcdef');
  return {w, record, binding: playgroundBinding(record)};
}
const poolRow = (w, record, binding, phase = 'allocated') => ({revision: 1, kind: 'playground-allocation', pool: 'default', size: 'medium',
  providerOrigin: 'https://old-pool.example.test', providerProject: 'p', providerEnvironment: 'e', binding, connection: nativeConnection(w.ctx),
  workspace: record.row.id, owner: 'example-org', repo: 'hello', phase, composeId: 'compose-1', plan: {name: 'ras-pg-x'}});

it('without a paired computer, provisioning answers plainly and keeps the workspace', async () => {
  const {w, record} = await world();
  await expect(ensureAllocation(w.ctx, record, {size: 'small'})).rejects.toThrow(/Pair one of your own computers or servers with github_playground_host_pairing/);
  expect(await allocationRecord(w.ctx, record)).toBeNull();
});

it('a row left from the retired pool is closed in place, reported as retired, and replaced only on a paired computer', async () => {
  const {w, record, binding} = await world();
  expect(await w.ctx.db.compareAndSetSetting(allocationKey(binding), 0, poolRow(w, record, binding))).toBeTruthy();
  const closed = await ensureAllocation(w.ctx, record);
  expect(closed).toMatchObject({phase: 'disposed', disposed: true, retiredPool: true, cleanupEvidence: 'operator_pool_retired'});
  expect(await inspectAllocation(w.ctx, record)).toMatchObject({phase: 'disposed', disposed: true});
  // Disposing again changes nothing; provisioning again needs a paired computer.
  expect((await disposeAllocation(w.ctx, record)).revision).toBe(closed.revision);
  await expect(ensureAllocation(w.ctx, record)).rejects.toThrow(/github_playground_host_pairing/);
});

it('reading a still-open pool row says the pool is retired', async () => {
  const {w, record, binding} = await world();
  await w.ctx.db.compareAndSetSetting(allocationKey(binding), 0, poolRow(w, record, binding, 'attached'));
  expect(await inspectAllocation(w.ctx, record)).toMatchObject({retired_pool: true, allocation_ready: false, execution_available: false, next: expect.stringMatching(/retired shared pool/)});
});

it('availability and authority treat a pool row as retired; an operator runtime without an observation still waits', async () => {
  const {w, record, binding} = await world();
  await w.ctx.db.compareAndSetSetting(allocationKey(binding), 0, poolRow(w, record, binding, 'attached'));
  const ctx = {...w.ctx, env: {...w.ctx.env, PLAYGROUND_ENFORCEMENT: '[]'}};
  const allocation = {binding, url: 'https://playground.example.test/', repositoryAttached: true};
  expect(await playgroundAvailability(ctx, {...record, allocation}, async () => { throw new Error('no probe expected'); })).toMatchObject({execution_available: false, reason: 'shared_pool_retired'});
  const job = {kind: 'native-git-workspace', state: 'pending', expires_at: new Date(Date.now() + 14400000)};
  const rows = [{client_id: 'client', profile: 'full', accounts: ['example-org'], mode: 'production'}];
  const stored = {binding, workspace: 'job_0123456789abcdef', connection: 'client', clientId: 'client', owner: 'example-org', repo: 'hello', phase: 'attached'};
  const actx = s => ({now: () => Date.now(), env: {}, stored: s, db: {getJob: async () => job, listUpgradeableConnections: async () => rows}});
  expect(await allocationAuthority(actx({...stored, providerOrigin: 'https://old-pool.example.test'}))).toMatchObject({allowed: false, cleanup: true, reason: 'shared_pool_retired'});
  expect(await allocationAuthority(actx(stored))).toMatchObject({allowed: false, cleanup: false, reason: 'enforcement_unverified'});
});

it('the sweep accepts the deployment CRON_SECRET (rack timer) or the sweep key, and nothing else', async () => {
  const {w} = await world();
  const env = {...w.ctx.env, CRON_SECRET: 'c'.repeat(64)};
  const call = async (auth, method = 'POST') => {
    let code = null, body = null;
    const res = {setHeader() {}, status(c) { code = c; return this; }, json(b) { body = b; return this; }};
    await sweep({method, headers: auth ? {authorization: auth} : {}}, res, {env, root: {}, run: async () => ({inspected: 0, disposed: 0, pending: 0, next_page: false})});
    return {code, body};
  };
  expect((await call('Bearer ' + env.CRON_SECRET)).code).toBe(200);
  expect((await call('Bearer ' + sweepKey(env))).code).toBe(200);
  expect((await call('Bearer ' + 'x'.repeat(64))).code).toBe(401);
  expect((await call(null)).code).toBe(401);
  expect((await call('Bearer ' + env.CRON_SECRET, 'GET')).code).toBe(405);
  // A short CRON_SECRET is never accepted as a sweep credential.
  const weak = {...w.ctx.env, CRON_SECRET: 'short'};
  let code = null; const res = {setHeader() {}, status(c) { code = c; return this; }, json() { return this; }};
  await sweep({method: 'POST', headers: {authorization: 'Bearer short'}}, res, {env: weak, root: {}, run: async () => ({})});
  expect(code).toBe(401);
});
