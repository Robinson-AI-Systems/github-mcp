// SWEEP-CLEANUP-1 (2026-11-19): the every-minute sweep never blocks on an offline computer, a removal order is
// never waited on forever, a runtime the server closed is ordered down when its computer checks in again, and
// closed records are cleared once a week old with their workspace gone.
import {it, expect} from 'vitest';
import {createFakeDb} from '../../test/helpers/fake-db.js';
import {disposeDeviceAllocation} from '../../src/fleet/device-allocations.js';
import {orphanRuntimeOrders} from '../../src/fleet/host.js';
import {read, complete, take} from '../../src/fleet/mailbox.js';
import {clearClosedAllocations, sweepAllocations, RETAIN_CLOSED_MS} from '../../src/playground/manager.js';

const DEV = 'a'.repeat(32), B = 'b'.repeat(64), B2 = 'c'.repeat(64), B3 = 'd'.repeat(64);
const DAY = 86400000;
function world(t0 = 10 * DAY) {
  let t = t0; const now = () => t; const db = createFakeDb({clock: now});
  const host = (patch = {}) => db.setSetting('pg_host.' + DEV, {kind: 'playground-enrolled-host', deviceId: DEV, transport: 'dial-out', status: 'ready', generation: 1, lastLeaseAt: t, revision: 1, ...patch});
  const stored = {revision: 1, binding: B, placement: 'device', phase: 'attached', device: {deviceId: DEV, generation: 1}, plan: {name: 'ras-pg-' + B.slice(0, 32)}};
  let current = stored;
  const save = async patch => (current = {...current, ...patch, revision: current.revision + 1});
  return {db, now, host, advance: ms => { t += ms; }, ctx: {db, now, relaySleep: async () => {}}, get current() { return current; }, save, stored};
}

it('a removal order is checked briefly, not waited on for 20 s', async () => {
  const w = world(); await w.host();
  let slept = 0; w.ctx.relaySleep = async ms => { slept += ms; w.advance(ms); };
  const out = await disposeDeviceAllocation(w.ctx, w.stored, w.save, {waitMs: 1500});
  expect(out).toMatchObject({phase: 'deleting', disposed: false});
  expect(slept).toBeLessThanOrEqual(1750);
});

it('a lapsed order is re-sent while the computer is online, and closed as unconfirmed when it stayed offline', async () => {
  const w = world(); await w.host();
  let out = await disposeDeviceAllocation(w.ctx, w.stored, w.save, {waitMs: 0});
  const first = out.downOrder;
  w.advance(7 * DAY + 1); await w.host();
  await take(w.db, DEV, {now: w.now}); // the mailbox marks the lapsed order expired
  out = await disposeDeviceAllocation(w.ctx, w.current, w.save, {waitMs: 0});
  expect(out.phase).toBe('deleting'); expect(out.downOrder).not.toBe(first);
  expect((await read(w.db, out.downOrder)).state).toBe('queued');
  // Now the computer goes offline for the whole life of the new order.
  w.advance(7 * DAY + 1); await take(w.db, DEV, {now: w.now});
  out = await disposeDeviceAllocation(w.ctx, w.current, w.save, {waitMs: 0});
  expect(out).toMatchObject({phase: 'disposed', disposed: true, cleanupEvidence: 'device_unconfirmed', unconfirmedReason: 'computer_offline_7_days'});
});

it('an unpaired computer, a removed one or a refused order closes the record as unconfirmed; a confirmed one as attested', async () => {
  let w = world(); await w.host({status: 'revoked'});
  expect(await disposeDeviceAllocation(w.ctx, w.stored, w.save, {waitMs: 0})).toMatchObject({cleanupEvidence: 'device_unconfirmed', unconfirmedReason: 'computer_unpaired'});
  w = world();
  expect(await disposeDeviceAllocation(w.ctx, w.stored, w.save, {waitMs: 0})).toMatchObject({cleanupEvidence: 'device_unconfirmed', unconfirmedReason: 'computer_removed'});
  w = world(); await w.host();
  let out = await disposeDeviceAllocation(w.ctx, w.stored, w.save, {waitMs: 0});
  const m = await read(w.db, out.downOrder); await w.db.compareAndSetSetting('fleet_m.' + m.id, m.revision, {...m, state: 'refused', revision: m.revision + 1});
  expect(await disposeDeviceAllocation(w.ctx, w.current, w.save, {waitMs: 0})).toMatchObject({cleanupEvidence: 'device_unconfirmed', unconfirmedReason: 'order_refused'});
  w = world(); await w.host();
  out = await disposeDeviceAllocation(w.ctx, w.stored, w.save, {waitMs: 0});
  await take(w.db, DEV, {now: w.now});
  await complete(w.db, DEV, out.downOrder, {containersAbsent: true, volumesAbsent: true, networksAbsent: true}, {now: w.now});
  expect(await disposeDeviceAllocation(w.ctx, w.current, w.save, {waitMs: 0})).toMatchObject({phase: 'disposed', cleanupEvidence: 'device_attested'});
});

it('an order delivered but never answered counts as lapsed once its life is over', async () => {
  const w = world(); await w.host();
  const out = await disposeDeviceAllocation(w.ctx, w.stored, w.save, {waitMs: 0});
  await take(w.db, DEV, {now: w.now}); // delivered to the agent, which then went silent
  w.advance(7 * DAY + 1);
  expect(await disposeDeviceAllocation(w.ctx, w.current, w.save, {waitMs: 0})).toMatchObject({unconfirmedReason: 'computer_offline_7_days'});
  expect(out.downOrder).toBeTruthy();
});

it('a computer that still reports a closed or unknown runtime is ordered to remove it, once per order life', async () => {
  const w = world(); await w.host();
  await w.db.setSetting('playground.' + B.slice(0, 40), {binding: B, phase: 'disposed', revision: 3});
  await w.db.setSetting('playground.' + B2.slice(0, 40), {binding: B2, phase: 'attached', revision: 3});
  const host = await w.db.getSetting('pg_host.' + DEV);
  const first = await orphanRuntimeOrders(w.db, host, [B, B2, B3, 'not-a-binding'], w.now);
  expect(Object.keys(first).sort()).toEqual([B, B3]);
  const order = await read(w.db, first[B].order);
  expect(order).toMatchObject({type: 'allocation_down', payload: {binding: B, project: 'ras-pg-' + B.slice(0, 32)}});
  // Next check-in: same report, orders still alive → nothing new.
  expect(await orphanRuntimeOrders(w.db, {...host, orphanDowns: first}, [B, B2, B3], w.now)).toBeNull();
  // The computer stops reporting B: it drops from the map.
  expect(Object.keys(await orphanRuntimeOrders(w.db, {...host, orphanDowns: first}, [B3], w.now))).toEqual([B3]);
});

function clearWorld({jobExists = false, loadThrows = false, phase = 'disposed', age = RETAIN_CLOSED_MS + 1} = {}) {
  const t = 100 * DAY, now = () => t, root = createFakeDb({clock: now}), tenant = createFakeDb({clock: now});
  const allocation = {revision: 4, binding: B, phase, workspace: 'job_0123456789abcdef', connection: 'conn', disposedAt: t - age, scope: {tenantId: 'ten', identityId: 'id'}};
  return {root, tenant, now, allocation,
    seed: async () => { await root.setSetting('pg_index.' + B.slice(0, 40), {kind: 'playground-index', revision: 5, allocation}); await tenant.setSetting('playground.' + B.slice(0, 40), allocation); },
    load: async () => { if (loadThrows) throw new TypeError('Allocation scope changed.'); return {db: {...tenant, getJob: async () => jobExists ? {id: 'job'} : null, deleteSettingAt: tenant.deleteSettingAt}, stored: allocation}; }};
}

it('closed records a week old with their workspace gone are cleared from both places, and counted', async () => {
  const w = clearWorld(); await w.seed();
  expect(await clearClosedAllocations({root: w.root, load: w.load, now: w.now})).toEqual({cleared: 1, kept: 0});
  expect(await w.root.getSetting('pg_index.' + B.slice(0, 40))).toBeNull();
  expect(await w.tenant.getSetting('playground.' + B.slice(0, 40))).toBeNull();
  expect(await w.root.getSetting('playground_retention')).toMatchObject({clearedTotal: 1, lastClearedAt: w.now()});
});

it('a recent record, one whose workspace still exists, or one not closed is kept; an unloadable one loses only its index row', async () => {
  for (const opts of [{age: DAY}, {jobExists: true}]) {
    const w = clearWorld(opts); await w.seed();
    await clearClosedAllocations({root: w.root, load: w.load, now: w.now});
    expect(await w.root.getSetting('pg_index.' + B.slice(0, 40))).not.toBeNull();
    expect(await w.tenant.getSetting('playground.' + B.slice(0, 40))).not.toBeNull();
  }
  const w = clearWorld({loadThrows: true}); await w.seed();
  expect(await clearClosedAllocations({root: w.root, load: w.load, now: w.now})).toEqual({cleared: 1, kept: 0});
  expect(await w.root.getSetting('pg_index.' + B.slice(0, 40))).toBeNull();
});

it('the sweep finishes with the clearing pass and reports it', async () => {
  const w = clearWorld(); await w.seed();
  const out = await sweepAllocations({root: w.root, load: w.load, now: w.now, env: {}});
  expect(out).toMatchObject({inspected: 0, cleared: 1});
});
