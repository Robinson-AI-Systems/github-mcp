// PLAY-3 delegated host enrollment — the owner-delegation route to pairing
// approval (owner instruction, 2026-11-11). The anti-self-approval property
// of PLAY-2 is structural, not procedural: approve() in the enrollment store
// is reachable only from owner-side scopes — the GitHub-authenticated My
// connection page, or these tools under the owner's OWN Full connection.
// The device being enrolled holds only its device key and the one-time
// pairing code; it has no MCP credential and can never call this. Every
// approval made here is recorded on the host record as
// {via:'owner-delegated-agent', clientId, at, note?} so the journal always
// attributes the act to the owner's delegated agent and the owner's note
// (for example the instruction it was given), never to the device and never
// to a simulated owner click. An agent calling without the owner's Full
// connection scope is refused; a device from another tenant or client is
// invisible to this scope and cannot be approved through it.
import {defineRead} from './define-read.js';
import {defineGithubWrite} from './define-github-write.js';
import {createEnrolledHostStore} from '../playground/enrolled-hosts.js';
import {rootAllocationDb} from '../playground/index.js';
import {MANAGE_CLIENT} from '../tenancy/public-connect.js';

const safe = (message, safeCode) => Object.assign(new TypeError(message), {safeMessage: true, safeCode});
const DEVICE = {type: 'string', pattern: '^[a-f0-9]{32}$', description: 'The device id shown by begin and by the machine being enrolled'};
const guidance = 'Enroll a computer or server YOU own as a Playground host for this connection. begin mints a one-time pairing (ten minutes): run the Playground host installer on that machine with the device id and code — the code is an owner-side secret, delivered only through your own install step. The machine then proves its device key (status pending_confirm); approve records your approval on the host record as owner-delegated (via, client, time, your optional delegation_note naming the instruction it rests on). Approval is never available to the device itself. After approval the host runs its readiness check on its first check-ins and becomes ready. revoke stops and deletes its runtimes at its next check-in.';

export async function hostStore(ctx) {
  const scope = ctx?.db?.playgroundScope;
  if (!scope?.tenantId || !scope?.identityId) throw safe('Playground hosts need a signed-in connection; this call carries no connection scope.', 'host_scope');
  const clientId = ctx.connection?.client_id;
  if (!clientId || clientId === MANAGE_CLIENT) throw safe('Playground hosts belong to one of your connected apps; use a connection for an app with Full permissions.', 'host_client');
  const conns = await ctx.db.listUpgradeableConnections();
  if (!conns?.some(c => c.client_id === clientId && c.profile === 'full')) throw safe('This connection is not a Full connection; host enrollment needs Full.', 'host_client');
  return createEnrolledHostStore({db: ctx.db, root: rootAllocationDb(ctx), tenantId: scope.tenantId, identityId: scope.identityId, clientId});
}

export async function hostPairingAction(ctx, args) {
  const store = await hostStore(ctx);
  if (args.operation === 'list') return {hosts: await store.list()};
  if (args.operation === 'begin') {
    const b = await store.begin();
    return {device_id: b.deviceId, code: b.code, expires_at: b.expiresAt, status: 'pending_pair',
      next: 'Within ten minutes, run the Playground host setup on the machine being enrolled and give it this device id and code (or: node agent.mjs join --device DEVICE --code CODE in the agent folder). Then approve once it shows pending_confirm.'};
  }
  if (args.operation === 'approve') {
    const r = await store.approve(args.device_id, {via: 'owner-delegated-agent', clientId: ctx.connection.client_id, note: args.delegation_note});
    return {device_id: r.deviceId, status: r.status, fingerprint: r.fingerprint, approval: r.approval};
  }
  if (args.operation === 'revoke') {
    const r = await store.revoke(args.device_id);
    return {device_id: r.deviceId, status: r.status, cleanup_confirmed: r.cleanupConfirmed};
  }
  throw safe('Unknown host pairing operation.', 'host_operation');
}

const readHosts = defineRead({name: 'github_playground_hosts', area: 'playground', audience: ['B', 'O', 'Op'],
  description: 'List this connection’s enrolled Playground hosts and pairings, with status and approval provenance.',
  guidance,
  properties: {operation: {type: 'string', enum: ['list']}}, required: ['operation'],
  handler: async (a, c) => hostPairingAction(c, {operation: 'list'})});

const pairing = defineGithubWrite({name: 'github_playground_host_pairing', area: 'playground', audience: ['B', 'O', 'Op'],
  description: 'Begin, approve or revoke a Playground host pairing for this connection; approval is recorded as owner-delegated.',
  guidance,
  properties: {
    operation: {type: 'string', enum: ['begin', 'approve', 'revoke']},
    device_id: DEVICE,
    delegation_note: {type: 'string', maxLength: 200, description: 'With approve: the owner instruction this approval rests on, recorded on the host record (for example “Owner instruction 2026-11-11, main chat”)'}
  },
  required: ['operation', 'requestKey'],
  declarations: {production: 'never', confirm: 'when-needed', profiles: ['full']},
  target: (args, ctx) => ({owner: ctx.connection.default_account, scope: 'server', kind: 'playground-host'}),
  read: async (args, ctx) => {
    try { const store = await hostStore(ctx); const hosts = await store.list(); return {device: hosts.find(h => h.deviceId === args.device_id) ?? null, hosts: hosts.length}; }
    catch (e) { return {device: null, blocked: e.message}; }
  },
  classify: () => ({}),
  summarize: ({args}) => args.operation === 'begin' ? 'Begin a new Playground host pairing for this connection (one-time code, ten minutes).'
    : args.operation === 'approve' ? `Approve Playground host ${args.device_id} under this connection, recorded as owner-delegated approval.`
    : `Revoke Playground host ${args.device_id}; its runtimes stop and are deleted at its next check-in.`,
  apply: async ({args, ctx}) => hostPairingAction(ctx, args),
  readAfter: async ({args, ctx, response}) => {
    try { const store = await hostStore(ctx); const hosts = await store.list(); const id = response?.device_id ?? args.device_id; return {device: hosts.find(h => h.deviceId === id) ?? null, hosts: hosts.length}; }
    catch { return {device: null}; }
  },
  verify: ({args, after, response}) => {
    if (args.operation === 'begin') return after?.device?.status === 'pending_pair' || response?.status === 'pending_pair';
    if (args.operation === 'approve') return after?.device?.status === 'pending_canary' && after?.device?.approval?.via === 'owner-delegated-agent';
    if (args.operation === 'revoke') return ['revoked', 'revocation_pending'].includes(after?.device?.status ?? response?.status);
    return false;
  },
  present: ({response, after}) => ({...response, device: after?.device ?? null})
});

export const tools = [readHosts.tool, pairing.tool];
export const handlers = Object.fromEntries([readHosts, pairing].map(x => [x.tool.name, x.handler]));
