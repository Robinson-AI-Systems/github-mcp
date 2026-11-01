// FLEET-3 wire protocol between a dial-out host agent and the control plane.
// Every agent request is signed by the device key confirmed at pairing; every
// order the control plane hands back is signed by the control-plane fleet key.
import {createPublicKey, verify} from 'node:crypto';

export const CHECKIN = 'robinson-fleet-checkin/v1';
export const REPORT = 'robinson-fleet-report/v1';
export const ORDER = 'robinson-fleet-order/v1';
export const ORDER_KINDS = ['relay', 'allocation_up', 'allocation_down', 'readiness', 'terminate'];
export const AGENT_PROTOCOL = 1;
const ID = /^[a-f0-9]{32}$/;
const SIG = /^ed25519:[A-Za-z0-9_-]{86}$/;
const deny = () => Object.assign(new TypeError('Host request was not accepted.'), {safeCode: 'fleet_denied'});

export function deviceKey(encoded) {
  if (typeof encoded !== 'string' || !encoded.startsWith('ed25519:')) throw deny();
  let key; try { key = createPublicKey({key: Buffer.from(encoded.slice(8), 'base64url'), format: 'der', type: 'spki'}); } catch { throw deny(); }
  if (key.asymmetricKeyType !== 'ed25519') throw deny();
  return key;
}

// Parse without trusting: only deviceId is read before the signature is checked.
export function peekDevice(body) {
  if (typeof body !== 'string' || Buffer.byteLength(body) > 4 * 1024 * 1024) throw deny();
  let p; try { p = JSON.parse(body); } catch { throw deny(); }
  if (!p || typeof p !== 'object' || Array.isArray(p) || !ID.test(p.deviceId ?? '')) throw deny();
  return p.deviceId;
}

// Replay protection: each seq is accepted once (the last 64 are remembered and anything
// at or below the floor is refused); sentAt must be within two minutes. Check-ins and
// reports run concurrently, so arrival order may differ from signing order.
export function verifyDeviceRequest(body, signature, host, {purpose, now = Date.now, generation = host.generation} = {}) {
  if (typeof signature !== 'string' || !SIG.test(signature)) throw deny();
  if (!verify(null, Buffer.from(body), deviceKey(host.publicKey), Buffer.from(signature.slice(8), 'base64url'))) throw deny();
  const p = JSON.parse(body);
  if (p.purpose !== purpose || p.deviceId !== host.deviceId || p.generation !== generation ||
      !Number.isSafeInteger(p.seq) || p.seq <= (host.seqFloor ?? 0) || (host.recentSeqs ?? []).includes(p.seq) || !Number.isSafeInteger(p.sentAt) ||
      Math.abs(p.sentAt - now()) > 120000 || p.protocol !== AGENT_PROTOCOL) throw deny();
  return p;
}

// Capacity the agent advertises. Measured values only; unknown stays null.
export function cleanCapacity(c = {}) {
  const num = (v, max) => Number.isFinite(v) && v > 0 && v <= max ? v : null;
  return {
    cpus: num(c.cpus, 1024), memoryBytes: Number.isSafeInteger(c.memoryBytes) ? num(c.memoryBytes, 2 ** 50) : null,
    freeMemoryBytes: Number.isSafeInteger(c.freeMemoryBytes) ? num(c.freeMemoryBytes, 2 ** 50) : null,
    freeDiskBytes: Number.isSafeInteger(c.freeDiskBytes) ? num(c.freeDiskBytes, 2 ** 60) : null,
    docker: typeof c.docker === 'string' ? c.docker.slice(0, 40) : null,
    compose: typeof c.compose === 'string' ? c.compose.slice(0, 40) : null,
    agent: typeof c.agent === 'string' ? c.agent.slice(0, 40) : null,
    platform: typeof c.platform === 'string' ? c.platform.slice(0, 40) : null,
    allocations: Array.isArray(c.allocations) ? c.allocations.filter(b => /^[a-f0-9]{64}$/.test(b)).slice(0, 64) : []
  };
}

// The readiness check the agent must pass before any work is placed on it.
export function readinessPassed(result, order) {
  return !!result && result.nonce === order.payload.nonce && result.dockerOk === true && result.composeOk === true &&
    result.internalNetworkOk === true && result.uid1000Ok === true && result.cleanedUp === true;
}
