// MACHINES-1 (owner request 2026-11-19: "a simple way built in for adding and removing machines, because we may not
// always have access to the same machine, and at some point I plan to make other machines available").
//
// The owner adds, removes, switches off and on Git machines with github_machine_change, without editing the deployment's
// protected settings. The change is stored in one setting, `native_git.machines`, as {revision, hosts, sig}.
//
// A Git machine receives signed leases and short-lived GitHub credentials, which is why hosts used to come only from
// protected configuration (pool-config.js). That property is kept: the stored list is signed with a key derived from
// TOKEN_ENCRYPTION_KEY (never stored in the database), and a list whose signature does not verify is ignored
// entirely. Someone able to write the database but not the server's environment still cannot add a machine. Only this
// server, acting for the owner through github_machine_change, can produce a valid list.
//
// The verified list is applied in-process (setMachineOverlay) so every synchronous lookup that routes a pinned
// workspace sees it too. It is reloaded at most every RELOAD_MS on requests (rack-server.mjs, poolHosts) and
// immediately after a change on this instance.
import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';
import { readEncryptionKey } from '../core/crypto.js';
import { createDb } from '../db.js';
import { storeFactory } from '../db-transport.js';
import { AUDIENCES, HOST_NAME, MAX_POOL_HOSTS, setMachineOverlay, workerOriginOf } from './pool-config.js';

export const MACHINES_SETTING = 'native_git.machines';
export const RELOAD_MS = 15000;
const FIELDS = ['origin', 'removed', 'enabled', 'priority', 'maxWorkspaces', 'audience', 'note', 'changedAt'];

const macKey = env => Buffer.from(hkdfSync('sha256', readEncryptionKey(env), Buffer.from('robinson-native-git/v1'), Buffer.from('machine-list'), 32));
const canonical = hosts => JSON.stringify(Object.keys(hosts).sort().map(name => [name, FIELDS.map(f => hosts[name][f] ?? null)]));
export const signMachines = (env, revision, hosts) => createHmac('sha256', macKey(env)).update(JSON.stringify(['robinson-machines/v1', revision, canonical(hosts)])).digest('base64url');

/** One stored machine entry, validated; null when anything in it is wrong. */
export function validEntry(name, e) {
 if (!HOST_NAME.test(name) || !e || typeof e !== 'object' || Array.isArray(e)) return null;
 const int = (v, lo, hi) => v === undefined || (Number.isSafeInteger(v) && v >= lo && v <= hi);
 if (e.origin !== undefined && workerOriginOf(e.origin) !== e.origin) return null;
 if (e.removed !== undefined && e.removed !== true) return null;
 if (e.enabled !== undefined && typeof e.enabled !== 'boolean') return null;
 if (!int(e.priority, 0, 1000) || !(e.maxWorkspaces === undefined || e.maxWorkspaces === null || int(e.maxWorkspaces, 1, 1000))) return null;
 if (e.audience !== undefined && !AUDIENCES.includes(e.audience)) return null;
 if (e.note !== undefined && (typeof e.note !== 'string' || e.note.length > 200)) return null;
 return Object.fromEntries(FIELDS.filter(f => e[f] !== undefined).map(f => [f, e[f]]));
}

/** The verified hosts map of a stored value, or null (missing, malformed or not signed by this server). */
export function verifiedMachines(env, stored) {
 if (!stored || typeof stored !== 'object' || !Number.isSafeInteger(stored.revision) || typeof stored.sig !== 'string') return null;
 const raw = stored.hosts;
 if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length > MAX_POOL_HOSTS * 2) return null;
 const hosts = {};
 for (const [name, e] of Object.entries(raw)) { const v = validEntry(name, e); if (!v) return null; hosts[name] = v; }
 let want; try { want = Buffer.from(signMachines(env, stored.revision, hosts)); } catch { return null; }
 const got = Buffer.from(stored.sig);
 return got.length === want.length && timingSafeEqual(got, want) ? hosts : null;
}

let loadedAt = -Infinity, loading = null;
const rootDb = env => createDb(storeFactory(env.DATABASE_URL));

/** Reloads the verified list into the in-process overlay when older than RELOAD_MS (or when forced). Never throws. */
export async function refreshMachines(env = process.env, { db = null, force = false, now = Date.now } = {}) {
 if (!force && now() - loadedAt < RELOAD_MS) return;
 if (loading) return loading;
 loading = (async () => {
  try {
   if (!db && !env?.DATABASE_URL) return;
   const stored = await (db ?? rootDb(env)).getSetting(MACHINES_SETTING);
   setMachineOverlay(verifiedMachines(env, stored));
   loadedAt = now();
  } catch { /* keep the last good list; a database hiccup never changes routing */ }
  finally { loading = null; }
 })();
 return loading;
}

/**
 * Applies one owner change to the stored list (compare-and-set, signed) and to this instance at once.
 * mutate(hosts) gets a copy of the verified hosts map and returns the new map. Returns the new hosts map.
 */
export async function changeMachines(env, db, mutate) {
 for (let attempt = 0; attempt < 3; attempt++) {
  const stored = await db.getSetting(MACHINES_SETTING);
  const current = verifiedMachines(env, stored) ?? {};
  const next = mutate(structuredClone(current));
  for (const [name, e] of Object.entries(next)) if (!validEntry(name, e)) throw Object.assign(new TypeError('That machine change is not valid.'), { safeMessage: true, safeCode: 'machine_invalid' });
  const revision = (stored?.revision ?? 0) + 1;
  const saved = await db.compareAndSetSetting(MACHINES_SETTING, stored?.revision ?? 0, { revision, hosts: next, sig: signMachines(env, revision, next) });
  if (saved) { setMachineOverlay(next); loadedAt = Date.now(); return next; }
 }
 throw Object.assign(new TypeError('The machine list changed at the same moment; nothing was changed. Try again.'), { safeMessage: true, safeCode: 'machine_conflict', safeRetryable: true });
}

/** Test helper: forget the cached load time. */
export const resetMachinesCache = () => { loadedAt = -Infinity; loading = null; setMachineOverlay(null); };
