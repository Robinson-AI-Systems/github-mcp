// FLEET-3 mailbox: the control plane leaves orders for a dial-out host agent in
// the tenant's own database, and the agent's signed check-ins collect them.
// Settings rows + compare-and-set, the same pattern as allocations/enrollment.
import {randomBytes} from 'node:crypto';

const QUEUE_LIMIT = 64;
const queueKey = deviceId => 'fleet_q.' + deviceId;
export const messageKey = id => 'fleet_m.' + id;
const fail = message => Object.assign(new TypeError(message), {safeMessage: true, safeCode: 'fleet_mailbox'});
const ID = /^[a-f0-9]{32}$/;

async function cas(db, key, update) {
  for (let n = 0; n < 6; n++) {
    const old = await db.getSetting(key), revision = old?.revision ?? 0, next = update(old);
    if (next === undefined) return old;
    if (await db.compareAndSetSetting(key, revision, {...next, revision: revision + 1})) return next;
  }
  throw fail('The host mailbox changed concurrently; retry the same intent.');
}

// kinds: relay | allocation_up | allocation_down | readiness | terminate
export async function enqueue(db, {deviceId, generation, kind, payload, ttlMs = 60000, now = Date.now, id = randomBytes(16).toString('hex')}) {
  if (!ID.test(deviceId ?? '') || !ID.test(id)) throw fail('Invalid host mailbox identity.');
  const at = now();
  const message = {kind: 'fleet-message', id, deviceId, generation, type: kind, payload, state: 'queued', createdAt: at, expiresAt: at + ttlMs, revision: 1};
  if (!await db.compareAndSetSetting(messageKey(id), 0, message)) throw fail('Mailbox message identity collision.');
  let full = false;
  await cas(db, queueKey(deviceId), old => {
    const ids = (old?.ids ?? []).filter(x => x !== id);
    if (ids.length >= QUEUE_LIMIT) { full = true; return undefined; }
    return {ids: [...ids, id]};
  });
  if (full) {
    await db.compareAndSetSetting(messageKey(id), 1, {...message, state: 'refused', revision: 2});
    throw Object.assign(fail('The host has too many undelivered orders; it may be offline.'), {safeRetryable: true});
  }
  return message;
}

// Hand queued, unexpired orders to the agent once; expired ones are dropped.
export async function take(db, deviceId, {now = Date.now, max = 16} = {}) {
  const queue = await db.getSetting(queueKey(deviceId)), out = [], drop = new Set();
  for (const id of (queue?.ids ?? []).slice(0, QUEUE_LIMIT)) {
    if (!ID.test(id)) { drop.add(id); continue; }
    const m = await db.getSetting(messageKey(id));
    if (!m || m.deviceId !== deviceId) { drop.add(id); continue; }
    if (m.state !== 'queued') { if (m.state !== 'delivered') drop.add(id); continue; }
    if (m.expiresAt <= now()) { await db.compareAndSetSetting(messageKey(id), m.revision, {...m, state: 'expired', revision: m.revision + 1}); drop.add(id); continue; }
    if (out.length >= max) continue;
    const delivered = {...m, state: 'delivered', deliveredAt: now(), revision: m.revision + 1};
    if (await db.compareAndSetSetting(messageKey(id), m.revision, delivered)) out.push(delivered);
  }
  if (drop.size) await cas(db, queueKey(deviceId), old => ({ids: (old?.ids ?? []).filter(x => !drop.has(x))}));
  return out;
}

export async function complete(db, deviceId, id, result, {now = Date.now} = {}) {
  if (!ID.test(id ?? '')) throw fail('Invalid mailbox message.');
  const m = await db.getSetting(messageKey(id));
  if (!m || m.deviceId !== deviceId) throw fail('This order was not sent to this host.');
  if (m.state === 'done') return m;
  if (m.state !== 'delivered') throw fail('This order was not delivered to the host.');
  const done = {...m, state: 'done', result, completedAt: now(), revision: m.revision + 1};
  if (!await db.compareAndSetSetting(messageKey(id), m.revision, done)) throw fail('The order changed concurrently.');
  await cas(db, queueKey(deviceId), old => ({ids: (old?.ids ?? []).filter(x => x !== id)}));
  return done;
}

export async function read(db, id) { return ID.test(id ?? '') ? await db.getSetting(messageKey(id)) : null; }

// Wait (bounded) for the agent's answer. Not finding one is "uncertain", never failure.
export async function awaitResult(db, id, {timeoutMs = 25000, pollMs = 250, sleep = ms => new Promise(r => setTimeout(r, ms)), clock = Date.now} = {}) {
  const until = clock() + timeoutMs, rounds = Math.ceil(timeoutMs / pollMs) + 1;
  for (let round = 0; ; round++) {
    const m = await db.getSetting(messageKey(id));
    if (m?.state === 'done') return m;
    // Bounded by both the clock and a round count, so a stalled clock can't spin forever.
    if (['expired', 'refused'].includes(m?.state) || clock() >= until || round >= rounds) return m ?? null;
    await sleep(pollMs);
  }
}
