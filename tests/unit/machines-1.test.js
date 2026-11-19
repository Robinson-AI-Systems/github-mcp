// MACHINES-1 (2026-11-19): built-in adding, removing and switching off/on of machines, kept as safe as protected settings.
import {afterEach, describe, expect, it} from 'vitest';
import {randomBytes} from 'node:crypto';
import {createFakeDb} from '../../test/helpers/fake-db.js';
import {configuredHosts} from '../../src/native-git/pool-config.js';
import {MACHINES_SETTING, changeMachines, refreshMachines, resetMachinesCache, signMachines, verifiedMachines} from '../../src/native-git/machines.js';
import {machineChange, machineList, probeGitMachine} from '../../src/tools/machines.js';
import {createEnrolledHostStore, REVOCATION_WAIT_MS} from '../../src/playground/enrolled-hosts.js';

const KEY = randomBytes(32).toString('base64url');
const ENV = {TOKEN_ENCRYPTION_KEY: KEY, NATIVE_GIT_WORKER_URL: 'https://pc.example.test',
  NATIVE_GIT_WORKER_POOL: JSON.stringify([{name: 'potato', origin: 'https://potato.example.test', priority: 900, audience: 'owner'}])};
const owner = (db, extra = {}) => ({env: ENV, db, connection: {operator: true, profile: 'full', default_account: 'me'}, machineStates: async () => [], probeGitMachine: async () => ({ok: true, protocol: 3}), ...extra});
const names = () => Object.fromEntries(configuredHosts(ENV).map(h => [h.name, {on: h.enabled, audience: h.audience, added: h.added === true}]));
afterEach(() => resetMachinesCache());

describe('the signed machine list', () => {
  it('verifies only a list signed by this server; an altered, unsigned or other-key list is ignored', async () => {
    const hosts = {office: {origin: 'https://office.example.test', audience: 'owner'}};
    const good = {revision: 3, hosts, sig: signMachines(ENV, 3, hosts)};
    expect(verifiedMachines(ENV, good)).toEqual(hosts);
    expect(verifiedMachines(ENV, {...good, hosts: {office: {origin: 'https://evil.example.test', audience: 'owner'}}})).toBeNull();
    expect(verifiedMachines(ENV, {...good, revision: 4})).toBeNull();
    expect(verifiedMachines(ENV, {revision: 3, hosts})).toBeNull();
    expect(verifiedMachines({TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64url')}, good)).toBeNull();
    // A database write alone (no server key) cannot add a machine.
    const db = createFakeDb();
    await db.setSetting(MACHINES_SETTING, {revision: 1, hosts: {evil: {origin: 'https://evil.example.test'}}, sig: 'x'.repeat(43)});
    await refreshMachines(ENV, {db, force: true});
    expect(Object.keys(names())).toEqual(['primary', 'potato']);
  });

  it('adds, switches off and removes machines on every lookup; the primary is never removed or switched off', async () => {
    const db = createFakeDb();
    await changeMachines(ENV, db, () => ({office: {origin: 'https://office.example.test'}, potato: {enabled: false}, primary: {removed: true, enabled: false}}));
    expect(names()).toEqual({primary: {on: true, audience: 'shared', added: false}, potato: {on: false, audience: 'owner', added: false}, office: {on: true, audience: 'owner', added: true}});
    await changeMachines(ENV, db, m => ({...m, potato: {removed: true}}));
    expect(Object.keys(names())).toEqual(['primary', 'office']);
    // Another instance picks the list up from the database.
    resetMachinesCache(); expect(Object.keys(names())).toEqual(['primary', 'potato']);
    await refreshMachines(ENV, {db, force: true});
    expect(Object.keys(names())).toEqual(['primary', 'office']);
  });
});

describe('github_machine_change and github_machines', () => {
  it('adds a Git machine only after its address answers as a native Git worker', async () => {
    const db = createFakeDb();
    await expect(machineChange(owner(db, {probeGitMachine: async () => ({ok: false, reason: 'could not be reached'})}), {operation: 'add_git_machine', name: 'office', origin: 'https://office.example.test'}))
      .rejects.toThrow(/Nothing was added: office.example.test could not be reached/);
    expect(await db.getSetting(MACHINES_SETTING)).toBeNull();
    const out = await machineChange(owner(db), {operation: 'add_git_machine', name: 'office', origin: 'https://office.example.test', priority: 40, note: 'new office PC'});
    expect(out).toMatchObject({done: true, added: true, address: 'office.example.test', audience: 'owner'});
    const list = await machineList(owner(db));
    expect(list.git_machines.find(m => m.name === 'office')).toMatchObject({added_here: true, on: true, priority: 40, audience: 'owner', address: 'office.example.test'});
    await expect(machineChange(owner(db), {operation: 'add_git_machine', name: 'office', origin: 'https://other.example.test'})).rejects.toThrow(/already exists/);
    await expect(machineChange(owner(db), {operation: 'add_git_machine', name: 'again', origin: 'https://office.example.test'})).rejects.toThrow(/already one of/);
    await expect(machineChange(owner(db), {operation: 'add_git_machine', name: 'bad', origin: 'http://x.example.test/path'})).rejects.toThrow(/https address/);
  });

  it('switches a machine off and on, removes configured and added machines, and refuses the primary', async () => {
    const db = createFakeDb();
    expect(await machineChange(owner(db), {operation: 'git_machine_off', name: 'potato'})).toMatchObject({on: false});
    expect(names().potato.on).toBe(false);
    expect(await machineChange(owner(db, {env: {...ENV, NATIVE_GIT_WORKER_OFF: 'potato'}}), {operation: 'git_machine_on', name: 'potato'})).toMatchObject({on: true, warning: expect.stringMatching(/NATIVE_GIT_WORKER_OFF/)});
    await machineChange(owner(db), {operation: 'add_git_machine', name: 'office', origin: 'https://office.example.test'});
    await machineChange(owner(db), {operation: 'remove_git_machine', name: 'office'});
    await machineChange(owner(db), {operation: 'remove_git_machine', name: 'potato'});
    expect(Object.keys(names())).toEqual(['primary']);
    expect(verifiedMachines(ENV, await db.getSetting(MACHINES_SETTING))).toEqual({potato: expect.objectContaining({removed: true})});
    for (const operation of ['remove_git_machine', 'git_machine_off']) await expect(machineChange(owner(db), {operation, name: 'primary'})).rejects.toThrow(/primary/);
    await expect(machineChange(owner(db), {operation: 'remove_git_machine', name: 'nobody'})).rejects.toThrow(/no Git machine named/);
  });

  it('is owner only', async () => {
    const db = createFakeDb(), someone = {env: ENV, db, connection: {profile: 'full'}};
    await expect(machineList(someone)).rejects.toThrow(/Only the owner/);
    await expect(machineChange(someone, {operation: 'git_machine_off', name: 'potato'})).rejects.toThrow(/Only the owner/);
  });

  it('probe accepts only a native Git worker', async () => {
    const reply = body => async () => ({status: 200, json: async () => body});
    expect(await probeGitMachine('https://a.example.test', {fetchImpl: reply({service: 'robinson-native-git', protocol: 3})})).toEqual({ok: true, protocol: 3});
    expect((await probeGitMachine('https://a.example.test', {fetchImpl: reply({hello: 1})})).ok).toBe(false);
    expect(await probeGitMachine('https://a.example.test', {fetchImpl: async () => { throw new TypeError('fetch failed'); }})).toEqual({ok: false, reason: 'could not be reached'});
  });
});

describe('computers: removal from any connection, and never pending forever', () => {
  async function computers() {
    let t = 1_000_000_000_000; const now = () => t, db = createFakeDb(), root = createFakeDb();
    const mk = clientId => createEnrolledHostStore({db, root, tenantId: 'ten', identityId: 'me', clientId, now});
    const put = async (deviceId, clientId, patch) => {
      await db.setSetting('pg_host.' + deviceId, {kind: 'playground-enrolled-host', tenantId: 'ten', identityId: 'me', clientId, deviceId, generation: 1, status: 'ready', lastLeaseAt: t, revision: 1, ...patch});
      const idx = await db.getSetting('pg_enrolled_index');
      await db.setSetting('pg_enrolled_index', {revision: (idx?.revision ?? 0) + 1, ids: [...(idx?.ids ?? []), deviceId]});
    };
    return {db, mk, put, advance: ms => { t += ms; }};
  }
  const A = 'a'.repeat(32), B = 'b'.repeat(32);

  it('lists and removes computers paired by any of the person\'s connections', async () => {
    const w = await computers(); await w.put(A, 'claude', {}); await w.put(B, 'muse', {});
    const mine = w.mk('claude');
    expect((await mine.list()).map(h => h.deviceId)).toEqual([A]);
    expect((await mine.list({allClients: true})).map(h => [h.deviceId, h.thisConnection])).toEqual([[A, true], [B, false]]);
    await expect(mine.revoke(B)).rejects.toThrow(/not enrolled under this connection/);
    expect(await mine.revoke(B, {allClients: true})).toMatchObject({status: 'revocation_pending', cleanupConfirmed: false});
  });

  it('a machine that is gone closes at once; a silent unpaired one closes after 7 days, labelled unconfirmed', async () => {
    const w = await computers(); await w.put(A, 'claude', {}); await w.put(B, 'claude', {});
    const s = w.mk('claude');
    expect(await s.revoke(A, {gone: true})).toMatchObject({status: 'revoked', cleanupConfirmed: false, cleanup: 'unconfirmed', unconfirmedReason: 'machine_gone'});
    expect(await s.revoke(B)).toMatchObject({status: 'revocation_pending'});
    w.advance(REVOCATION_WAIT_MS - 1000);
    expect((await s.list()).find(h => h.deviceId === B).status).toBe('revocation_pending');
    w.advance(2000);
    expect((await s.list()).find(h => h.deviceId === B)).toMatchObject({status: 'revoked', cleanup: 'unconfirmed', unconfirmedReason: 'computer_offline_7_days'});
  });
});
