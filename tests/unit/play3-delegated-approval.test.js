// PLAY-3 delegated host approval (owner instruction 2026-11-11): pairing
// approval through the owner's own Full MCP connection, recorded on the host
// record as owner-delegated. The anti-self-approval property is structural:
// the device side (claim) can never approve; approval requires an owner-side
// scope, is limited to that scope's own tenant + client, and refuses every
// other caller shape.
import {describe, it, expect} from 'vitest';
import {generateKeyPairSync, sign, createPublicKey} from 'node:crypto';
import {createEnrolledHostStore, pairingMessage} from '../../src/playground/enrolled-hosts.js';
import {hostPairingAction, hostStore} from '../../src/tools/playground-hosts.js';

function fakeDb(connections = [{client_id: 'app-1', profile: 'full', client_name: 'Test app'}]) {
  const m = new Map();
  return {map: m,
    async getSetting(k) { const v = m.get(k); return v ? structuredClone(v) : null; },
    async compareAndSetSetting(k, rev, val) { const cur = m.get(k); if ((cur?.revision ?? 0) !== rev) return null; m.set(k, structuredClone(val)); return structuredClone(val); },
    async setSetting(k, val) { m.set(k, structuredClone(val)); return val; },
    async listUpgradeableConnections() { return connections; }};
}
function ctxFor(db, root, over = {}) {
  const c = {db, publicDb: root, env: {}, connection: {client_id: 'app-1', default_account: 'christcr2012', profile: 'full'}, ...over};
  db.playgroundScope = {tenantId: 'tenant-1', identityId: 'identity-1'};
  return c;
}
const deviceKey = () => { const kp = generateKeyPairSync('ed25519'); return {priv: kp.privateKey, pub: 'ed25519:' + createPublicKey(kp.privateKey).export({format: 'der', type: 'spki'}).toString('base64url')}; };

async function beginAndClaim(ctx, db, root) {
  const begun = await hostPairingAction(ctx, {operation: 'begin'});
  const dk = deviceKey();
  const store = createEnrolledHostStore({db, root, tenantId: 'tenant-1', identityId: 'identity-1', clientId: 'app-1'});
  const sig = sign(null, Buffer.from(pairingMessage({deviceId: begun.device_id, code: begun.code, origin: null})), dk.priv).toString('base64url');
  const claimed = await store.claim({code: begun.code, deviceId: begun.device_id, publicKey: dk.pub, signature: sig});
  return {begun, claimed};
}

describe('PLAY-3 delegated host approval', () => {
  it('runs begin → claim → approve under the owner connection and records provenance', async () => {
    const db = fakeDb(), root = fakeDb(), ctx = ctxFor(db, root);
    const {begun} = await beginAndClaim(ctx, db, root);
    expect(begun.status).toBe('pending_pair');
    const approved = await hostPairingAction(ctx, {operation: 'approve', device_id: begun.device_id, delegation_note: 'Owner instruction 2026-11-11, main chat'});
    expect(approved).toMatchObject({status: 'pending_canary'});
    expect(approved.approval).toMatchObject({via: 'owner-delegated-agent', clientId: 'app-1', note: 'Owner instruction 2026-11-11, main chat'});
    const list = await hostPairingAction(ctx, {operation: 'list'});
    expect(list.hosts.find(h => h.deviceId === begun.device_id).approval.via).toBe('owner-delegated-agent');
  });
  it('refuses approval before the device has proved its key (no self-approval shortcut)', async () => {
    const db = fakeDb(), root = fakeDb(), ctx = ctxFor(db, root);
    const begun = await hostPairingAction(ctx, {operation: 'begin'});
    await expect(hostPairingAction(ctx, {operation: 'approve', device_id: begun.device_id})).rejects.toThrow(/prove its key/);
  });
  it('refuses a caller whose connection is not Full, and a foreign client', async () => {
    const db = fakeDb([{client_id: 'app-1', profile: 'read'}]), root = fakeDb(), ctx = ctxFor(db, root);
    await expect(hostPairingAction(ctx, {operation: 'list'})).rejects.toThrow(/Full/);
    const db2 = fakeDb(), root2 = fakeDb(), foreign = ctxFor(db2, root2, {connection: {client_id: 'app-2', default_account: 'christcr2012', profile: 'full'}});
    await expect(hostPairingAction(foreign, {operation: 'list'})).rejects.toThrow(/Full/);
  });
  it('a different tenant scope cannot see or approve the device', async () => {
    const db = fakeDb(), root = fakeDb(), ctx = ctxFor(db, root);
    const {begun} = await beginAndClaim(ctx, db, root);
    const otherDb = db; // same rows, different scope values
    const other = {db: otherDb, publicDb: root, env: {}, connection: {client_id: 'app-1', default_account: 'someoneelse', profile: 'full'}};
    otherDb.playgroundScope = {tenantId: 'tenant-2', identityId: 'identity-2'};
    await expect(hostPairingAction(other, {operation: 'approve', device_id: begun.device_id})).rejects.toThrow();
    const list = await hostPairingAction(other, {operation: 'list'});
    expect(list.hosts).toEqual([]);
  });
  it('the browser path still records my-connection provenance', async () => {
    const db = fakeDb(), root = fakeDb(), ctx = ctxFor(db, root);
    const {begun} = await beginAndClaim(ctx, db, root);
    const store = createEnrolledHostStore({db, root, tenantId: 'tenant-1', identityId: 'identity-1', clientId: 'app-1'});
    const r = await store.approve(begun.device_id);
    expect(r.approval).toMatchObject({via: 'my-connection', clientId: 'app-1'});
  });
  it('revoke works through the same delegated route', async () => {
    const db = fakeDb(), root = fakeDb(), ctx = ctxFor(db, root);
    const {begun} = await beginAndClaim(ctx, db, root);
    await hostPairingAction(ctx, {operation: 'approve', device_id: begun.device_id});
    const r = await hostPairingAction(ctx, {operation: 'revoke', device_id: begun.device_id});
    expect(r.status).toBe('revoked');
  });
  it('hostStore refuses a call with no connection scope', async () => {
    await expect(hostStore({db: fakeDb(), connection: {client_id: 'app-1'}})).rejects.toThrow(/scope/);
  });
});
