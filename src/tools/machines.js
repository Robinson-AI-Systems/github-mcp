// MACHINES-1 (owner request 2026-11-19): one simple, built-in place to see, add and remove the machines this service
// runs work on, because a machine may not stay available and more will be added later.
//
//   github_machines          list every machine: Git machines (native Git workspaces) and Playground computers
//   github_machine_change    add a Git machine, remove one, switch one off or on; pair a new computer, remove one
//
// Owner only. Git machines are stored in the signed list of src/native-git/machines.js (a database write alone can
// never add one). Computers keep using the pairing flow of PLAY-3 (src/tools/playground-hosts.js); removing one works
// from any of the owner's connections, and a computer that is gone is closed at once instead of waiting forever.
import { defineRead } from './define-read.js';
import { defineGithubWrite, classifyGithubError } from './define-github-write.js';
import { isOwnRefusal } from '../core/error-origin.js';
import { configuredHosts, HOST_NAME, workerOriginOf } from '../native-git/pool-config.js';
import { changeMachines, refreshMachines, verifiedMachines, MACHINES_SETTING } from '../native-git/machines.js';
import { ownerCaller } from '../native-git/pool-audience.js';
import { poolStatus } from '../native-git/pool.js';
import { rootAllocationDb } from '../playground/index.js';
import { hostStore, hostPairingAction } from './playground-hosts.js';

const safe = (message, safeCode, extra = {}) => Object.assign(new TypeError(message), { safeMessage: true, safeCode, noOperationStarted: true, ...extra });
const NAME = { type: 'string', pattern: HOST_NAME.source, description: 'Git machine name, lowercase letters, digits and dashes (for example "potato" or "office-pc")' };
const DEVICE = { type: 'string', pattern: '^[a-f0-9]{32}$', description: 'Computer device id, from github_machines' };
const OPERATIONS = ['add_git_machine', 'remove_git_machine', 'git_machine_off', 'git_machine_on', 'pair_computer', 'remove_computer'];
const guidance = 'One place for the machines this service uses. Git machines run native Git workspaces; computers run Playground runtimes. '
 + 'add_git_machine: name + origin (the machine\'s https address, running the native Git worker; it is checked first) and optional priority (lower is tried first), max_workspaces, audience (owner by default; shared lets everyone use it). '
 + 'remove_git_machine: the machine is gone or no longer yours; workspaces open on it stop working. git_machine_off / git_machine_on: keep it, but send no new work there for now (for example while it is being repaired). The primary machine cannot be removed or switched off. '
 + 'pair_computer: start pairing a new computer (one-time code for ten minutes), then approve it with github_playground_host_pairing. remove_computer: device_id; gone: true when the machine no longer exists, so it closes at once instead of waiting for it to check in.';

export function ownerOnly(ctx) {
 if (!ownerCaller(ctx)) throw safe('Only the owner of this service can see or change its machines.', 'machine_owner_only');
}

/** Every machine, in one list for people: Git machines (configured and added) and Playground computers. */
export async function machineList(ctx) {
 ownerOnly(ctx);
 await refreshMachines(ctx.env, { db: rootAllocationDb(ctx), force: true });
 const states = await (ctx.machineStates ?? poolStatus)(ctx).catch(() => []);
 const stateOf = name => states.find?.(s => s.name === name)?.state ?? null;
 const git = configuredHosts(ctx.env).map(h => ({ name: h.name, kind: 'git', role: h.role, added_here: h.added === true, address: new URL(h.origin).host,
  on: h.enabled, state: stateOf(h.name), audience: h.audience, priority: h.priority, max_workspaces: h.maxWorkspaces }));
 let computers = [], computers_note = null;
 try { computers = (await (await hostStore(ctx)).list({ allClients: true })).map(c => ({ device_id: c.deviceId, kind: 'computer', status: c.status,
  last_seen: c.lastCheckInAt ? new Date(c.lastCheckInAt).toISOString() : null, cpus: c.capacity?.cpus ?? null, paired_by_this_connection: c.thisConnection,
  note: c.approval?.note ?? null, ...(c.cleanup ? { cleanup: c.cleanup, unconfirmed_reason: c.unconfirmedReason } : {}) })); }
 catch (e) { computers_note = e?.safeMessage ? e.message : 'Computers could not be listed from this connection.'; }
 return { git_machines: git, computers, ...(computers_note ? { computers_note } : {}),
  next: 'Change machines with github_machine_change (add_git_machine, remove_git_machine, git_machine_off, git_machine_on, pair_computer, remove_computer).' };
}

/** Checks an address really is a native Git worker before it is trusted with work. */
export async function probeGitMachine(origin, { fetchImpl = fetch, timeoutMs = 8000 } = {}) {
 try {
  const res = await fetchImpl(origin + '/health', { signal: AbortSignal.timeout(timeoutMs), redirect: 'error' });
  const body = await res.json().catch(() => null);
  return body?.service === 'robinson-native-git' ? { ok: true, protocol: body.protocol ?? null } : { ok: false, reason: `answered ${res.status} but is not a native Git worker` };
 } catch (e) { return { ok: false, reason: e?.name === 'TimeoutError' ? 'did not answer within 8 s' : 'could not be reached' }; }
}

export async function machineChange(ctx, a) {
 ownerOnly(ctx);
 const db = rootAllocationDb(ctx), hosts = configuredHosts(ctx.env), byName = hosts.find(h => h.name === a.name);
 const note = typeof a.note === 'string' ? a.note.slice(0, 200) : undefined, changedAt = Date.now();
 const needName = () => { if (!HOST_NAME.test(a.name ?? '')) throw safe('Name the Git machine (lowercase letters, digits and dashes).', 'machine_name'); };
 const notPrimary = () => { if (byName?.role === 'primary') throw safe('That is the primary Git machine; it cannot be removed or switched off here (it comes from the deployment settings).', 'machine_primary'); };
 switch (a.operation) {
 case 'add_git_machine': {
  needName();
  const origin = workerOriginOf(a.origin);
  if (!origin) throw safe('Give the machine\'s https address with no path, for example https://office-pc.example.ts.net.', 'machine_origin');
  if (byName) throw safe(`A Git machine named "${a.name}" already exists; pick another name or remove it first.`, 'machine_exists');
  if (hosts.some(h => h.origin === origin)) throw safe('That address is already one of the Git machines.', 'machine_exists');
  const probe = await (ctx.probeGitMachine ?? probeGitMachine)(origin);
  if (!probe.ok) throw safe(`Nothing was added: ${new URL(origin).host} ${probe.reason}. Install and start the native Git worker there first (docs/NATIVE-GIT-OPERATIONS.md), then try again.`, 'machine_unreachable');
  await changeMachines(ctx.env, db, m => ({ ...Object.fromEntries(Object.entries(m).filter(([n]) => n !== a.name)), [a.name]: { origin,
   ...(a.priority !== undefined ? { priority: a.priority } : {}), ...(a.max_workspaces !== undefined ? { maxWorkspaces: a.max_workspaces } : {}),
   audience: a.audience ?? 'owner', ...(note ? { note } : {}), changedAt } }));
  return { done: true, machine: a.name, added: true, address: new URL(origin).host, audience: a.audience ?? 'owner', protocol: probe.protocol,
   next: 'It takes new work right away (in priority order). Check it with github_machines.' };
 }
 case 'remove_git_machine': {
  needName(); notPrimary();
  if (!byName) throw safe(`There is no Git machine named "${a.name}".`, 'machine_missing');
  await changeMachines(ctx.env, db, m => {
   const e = m[a.name];
   if (e?.origin) { delete m[a.name]; if (!hosts.some(h => h.name === a.name && !h.added)) return m; }
   return { ...m, [a.name]: { removed: true, ...(note ? { note } : {}), changedAt } };
  });
  return { done: true, machine: a.name, removed: true, warning: 'Workspaces that were open on it stop working; reopen them and they go to another machine.' };
 }
 case 'git_machine_off': case 'git_machine_on': {
  needName(); notPrimary();
  if (!byName) throw safe(`There is no Git machine named "${a.name}".`, 'machine_missing');
  const on = a.operation === 'git_machine_on';
  await changeMachines(ctx.env, db, m => ({ ...m, [a.name]: { ...(m[a.name] ?? {}), enabled: on, ...(note ? { note } : {}), changedAt } }));
  const envOff = String(ctx.env?.NATIVE_GIT_WORKER_OFF ?? '').split(',').map(x => x.trim()).includes(a.name);
  return { done: true, machine: a.name, on, ...(on && envOff ? { warning: 'The deployment setting NATIVE_GIT_WORKER_OFF still lists it, which keeps it off until that setting changes.' } : {}),
   next: on ? 'New work can go there again.' : 'No new work goes there; workspaces already open on it keep working while it answers.' };
 }
 case 'pair_computer': return { ...(await hostPairingAction(ctx, { operation: 'begin' })),
  then: 'After the computer joins, approve it: github_playground_host_pairing operation approve with this device_id.' };
 case 'remove_computer': {
  if (!/^[a-f0-9]{32}$/.test(a.device_id ?? '')) throw safe('Give the computer\'s device_id from github_machines.', 'machine_device');
  const r = await (await hostStore(ctx)).revoke(a.device_id, { allClients: true, gone: a.gone === true });
  return { done: true, device_id: r.deviceId, status: r.status, ...(r.cleanup ? { cleanup: r.cleanup, unconfirmed_reason: r.unconfirmedReason } : {}),
   next: r.status === 'revoked' ? 'Removed. Nothing new will run there.' : 'Removed for new work. Its runtimes are deleted when it next checks in; if it never does, it closes by itself after 7 days (or say gone: true now).' };
 }
 default: throw safe('Unknown machine operation.', 'machine_operation');
 }
}

const read = defineRead({ name: 'github_machines', area: 'server', audience: ['O', 'Op'],
 description: 'List every machine this service uses: Git machines and Playground computers, with on/off, state and last check-in.',
 guidance, properties: {}, required: [],
 handler: async (_a, c) => machineList(c) });

const machineErrorClass = e => e?.safeCode?.startsWith?.('machine_') || e?.safeCode === 'playground_enrollment_denied' || isOwnRefusal(e) ? 'rejected' : classifyGithubError(e);
const change = defineGithubWrite({ name: 'github_machine_change', area: 'server', audience: ['O', 'Op'],
 description: 'Add, remove, switch off or on a Git machine; pair a new Playground computer or remove one (owner only).',
 guidance,
 properties: {
  operation: { type: 'string', enum: OPERATIONS },
  name: NAME,
  origin: { type: 'string', maxLength: 200, description: 'add_git_machine: the machine\'s https address (no path)' },
  priority: { type: 'integer', minimum: 0, maximum: 1000, description: 'add_git_machine: lower is tried first (the PC is 10)' },
  max_workspaces: { type: 'integer', minimum: 1, maximum: 1000, description: 'add_git_machine: most workspaces at once' },
  audience: { type: 'string', enum: ['owner', 'shared'], description: 'add_git_machine: owner (default) = only your work; shared = everyone' },
  device_id: DEVICE,
  gone: { type: 'boolean', description: 'remove_computer: the machine no longer exists, so close it now' },
  note: { type: 'string', maxLength: 200, description: 'Why (kept with the change)' }
 },
 required: ['operation', 'requestKey'],
 declarations: { production: 'never', confirm: 'when-needed', profiles: ['full'] },
 target: (_a, ctx) => ({ owner: ctx.connection.default_account, scope: 'server', kind: 'machines' }),
 read: async (_a, ctx) => { try { const s = await rootAllocationDb(ctx).getSetting(MACHINES_SETTING); return { revision: s?.revision ?? 0, valid: !s || !!verifiedMachines(ctx.env, s) }; } catch (e) { return { blocked: e.message }; } },
 classify: () => ({}),
 classifyError: machineErrorClass,
 summarize: ({ args: a }) => ({ add_git_machine: `Add Git machine ${a.name} at ${a.origin}`, remove_git_machine: `Remove Git machine ${a.name}`, git_machine_off: `Switch Git machine ${a.name} off for new work`,
  git_machine_on: `Switch Git machine ${a.name} back on`, pair_computer: 'Start pairing a new Playground computer (one-time code, ten minutes)', remove_computer: `Remove Playground computer ${a.device_id}${a.gone ? ' (machine gone)' : ''}` })[a.operation] ?? 'Change machines',
 apply: async ({ args, ctx }) => machineChange(ctx, args),
 readAfter: async ({ ctx }) => { try { const s = await rootAllocationDb(ctx).getSetting(MACHINES_SETTING); return { revision: s?.revision ?? 0 }; } catch { return {}; } },
 verify: ({ response }) => response?.done === true || response?.status === 'pending_pair',
 present: ({ response }) => response });

export const tools = [read.tool, change.tool];
export const handlers = Object.fromEntries([read, change].map(x => [x.tool.name, x.handler]));
