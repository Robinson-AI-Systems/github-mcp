// WORKER-POOL-1: the native Git worker pool. Real signed worker hosts (workers/native-git/server.js) on real local Git,
// fake GitHub validated against the vendored schema; only transport to an "offline" host is made to fail.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { makeWorld, parse, doorsFor, runWriteContract } from '../../test/helpers/write-contract.js';
import { prepareNativeWorld, POOL_ORIGIN } from '../../test/helpers/native-git-world.js';
import * as native from '../../src/tools/native-git.js';
import * as playground from '../../src/tools/playground.js';
import * as repoChange from '../../src/tools/repo-change.js';
import * as gitRemote from '../../src/tools/git-remote.js';
import { nativeConnection, callNativeWorker } from '../../src/native-git/client.js';
import { configuredHosts, configuredHost, applyPoolSetting, hostId } from '../../src/native-git/pool-config.js';
import { placeWorkspace, judgeHost, STATUS_TTL_MS, POOL_SETTING, poolStatus } from '../../src/native-git/pool.js';
import { nativeWorkerRoute, nativeWorkerHost } from '../../src/native-git/protocol.js';
import { transferUrl, planTransferRelay, routeFor } from '../../src/native-git/relay.js';
import { serverStatus } from '../../src/tools/server-status.js';
import { handleGitRemote } from '../../src/git-remote/edge.js';
import { newExchangeCode, newSessionKey, sha256 } from '../../src/git-remote/keys.js';

const cleanups = [];
afterEach(async () => { for (const close of cleanups.splice(0)) await close(); });
const PC = 'https://native-worker.example.test';
const def = name => ({ tool: [...native.tools, ...playground.tools, ...repoChange.tools, ...gitRemote.tools].find(t => t.name === name), handler: native.handlers[name] ?? playground.handlers[name] ?? repoChange.handlers[name] ?? gitRemote.handlers[name] });
const view = r => r?.content || r?.structuredContent ? parse(r) : r;
const arrange = (gh, outcome = 'ok') => { gh.nativeOutcome = outcome; gh.when('GET /repos/{owner}/{repo}').reply(200, { full_name: 'example-org/hello', default_branch: 'main' }); };
const POOL = [{ name: 'dokploy', role: 'previous' }, { name: 'workshop' }];
async function world(options = {}) {
 // WORKER-POOL-2: these are the owner's own connection (operator mark), so the primary (owner-only by default) is theirs.
 const w = await makeWorld({ profile: 'full', mode: 'production', gates: [], operator: options.owner ?? true }); arrange(w.gh);
 cleanups.push(await prepareNativeWorld(w, { pool: options.pool ?? POOL, primary: options.primary ?? {} })); await w.nativeReady();
 return w;
}
const open = (w, requestKey, door = doorsFor(def('github_git_workspace_open'))[0]) => door.call(w, { owner: 'example-org', repo: 'hello', runtime: 'none', requestKey }).then(parse);
const hostOf = async (w, id) => JSON.parse((await w.db.getJob(id, nativeConnection(w.ctx))).provider_ref).host;
const idOf = name => hostId(name === 'pc' ? PC : POOL_ORIGIN(name));
const clones = w => Object.fromEntries(Object.entries(w.pool).map(([name, h]) => [name, h.requests.filter(a => a === 'open').length]));

describe('pool configuration (protected environment only)', () => {
 const env = { NATIVE_GIT_WORKER_URL: PC + '/', NATIVE_GIT_PREVIOUS_WORKER_URL: 'https://old.example.test/',
  NATIVE_GIT_WORKER_POOL: JSON.stringify([{ name: 'pc', origin: PC, maxWorkspaces: 3 }, { name: 'workshop', origin: 'https://workshop.example.test', priority: 40 }, { name: 'bad name', origin: 'https://x.example.test' }, { name: 'creds', origin: 'https://u:p@y.example.test' }]) };
 it('seeds primary and previous from the existing settings, adds pool entries, skips invalid ones, orders by priority', () => {
  const hosts = configuredHosts(env);
  expect(hosts.map(h => [h.name, h.role, h.priority, h.maxWorkspaces])).toEqual([['pc', 'primary', 10, 3], ['workshop', 'pool', 40, null], ['previous', 'previous', 90, null]]);
  expect(hosts.invalid).toBe(true);
  expect(hosts[0].id).toBe(nativeWorkerHost(env)); // existing workspaces' stored host id is unchanged
  expect(configuredHosts({ NATIVE_GIT_WORKER_URL: PC + '/' }).map(h => h.name)).toEqual(['primary']);
  expect(configuredHosts({ NATIVE_GIT_WORKER_URL: PC + '/', NATIVE_GIT_WORKER_POOL: 'not json' }).invalid).toBe(true);
 });
 it('the stored owner setting only switches a configured host off or changes its priority or limit; it never adds an address', () => {
  const adjusted = applyPoolSetting(configuredHosts(env), { hosts: { pc: { enabled: false }, previous: { priority: 5, maxWorkspaces: 2 }, intruder: { origin: 'https://evil.example.test', enabled: true } } });
  expect(adjusted.map(h => [h.name, h.enabled, h.priority, h.maxWorkspaces])).toEqual([['previous', true, 5, 2], ['pc', false, 10, 3], ['workshop', true, 40, null]]);
  expect(adjusted.some(h => h.origin.includes('evil'))).toBe(false);
 });
 it('routes a pinned workspace to its pool host, keeps old pins working, and refuses an unknown host', () => {
  const workshop = configuredHosts(env).find(h => h.name === 'workshop');
  expect(nativeWorkerRoute(env, { host: workshop.id })).toBe('https://workshop.example.test/v1/workspace');
  expect(nativeWorkerRoute(env, { host: hostId('https://old.example.test') })).toBe('https://old.example.test/v1/workspace');
  expect(() => nativeWorkerRoute(env, { host: 'f'.repeat(32) })).toThrow(/no longer configured/);
  expect(configuredHost(env, 'not-an-id')).toBeNull();
 });
 it('judges capabilities: paused, update, pressure, full (worker or registry limit), unavailable, disabled', () => {
  const host = { enabled: true, maxWorkspaces: null }, cap = { ready: true, capacity_mode: 'resource-aware', admission: { allowed: true }, active_workspaces: 2, max_workspaces: null };
  expect(judgeHost(host, cap).state).toBe('available');
  expect(judgeHost(host, { ...cap, owner_paused: true }).state).toBe('paused');
  expect(judgeHost(host, { ...cap, capacity_mode: undefined }).state).toBe('update_required');
  expect(judgeHost(host, { ...cap, admission: { allowed: false, reason: 'memory_pressure' } })).toMatchObject({ state: 'busy', reason: 'memory_pressure' });
  expect(judgeHost(host, { ...cap, max_workspaces: 2 }).state).toBe('full');
  expect(judgeHost({ ...host, maxWorkspaces: 2 }, cap).state).toBe('full');
  expect(judgeHost(host, null).state).toBe('unavailable');
  expect(judgeHost({ ...host, enabled: false }, cap).state).toBe('disabled');
  // The git remote needs no resource-based admission, only no explicit refusal or pause.
  expect(judgeHost(host, { ready: true, git_remote: 'v1' }, { workspace: false }).state).toBe('available');
  expect(judgeHost(host, { ready: true, git_remote: 'v1' }).state).toBe('update_required');
  expect(judgeHost(host, { ready: true, admission: { allowed: false, reason: 'memory_pressure' } }, { workspace: false }).state).toBe('busy');
  expect(judgeHost(host, { ready: true, owner_paused: true }, { workspace: false }).state).toBe('paused');
 });
});

describe('placement on open', () => {
 // The worker hosts share this test process's event loop, and their admission measures its delay: one warm-up open
 // absorbs first-use compilation so the first assertion measures placement, not a cold process.
 beforeAll(async () => { const w = await world(); await open(w, 'warm-up'); await w.nativeReady(); });
 it('prefers the primary while it has headroom and pins the workspace there', async () => {
  const w = await world();
  const r = await open(w, 'preferred');
  expect(r.status, JSON.stringify(r)).toBe('applied');
  expect(await hostOf(w, r.result.workspace_id)).toBe(idOf('pc'));
  expect(clones(w)).toEqual({ pc: 1, dokploy: 0, workshop: 0 });
 });
 it('spills when the primary is paused by its owner, and comes back at once after resume', async () => {
  const w = await world();
  await w.pool.pc.pause();
  const r = await open(w, 'paused-pc');
  expect(r.status, JSON.stringify(r)).toBe('applied');
  expect(await hostOf(w, r.result.workspace_id)).toBe(idOf('workshop')); // priority 50 before the previous host's 90
  await w.pool.pc.resume();
  const back = await open(w, 'resumed-pc');
  expect(await hostOf(w, back.result.workspace_id)).toBe(idOf('pc'));
 });
 it('spills when the primary is over its workspace limit (worker-reported or registry)', async () => {
  const w = await world({ primary: { maxWorkspaces: 1 } });
  const first = await open(w, 'fill-pc'); expect(await hostOf(w, first.result.workspace_id)).toBe(idOf('pc'));
  const second = await open(w, 'over-limit'); expect(await hostOf(w, second.result.workspace_id)).toBe(idOf('workshop'));
  const v = await world({ primary: { limit: 1 } });
  await open(v, 'fill-registry');
  expect(await hostOf(v, (await open(v, 'over-registry')).result.workspace_id)).toBe(idOf('workshop'));
 });
 it('spills when the primary fails resource admission or is unreachable', async () => {
  const w = await world();
  w.pool.pc.pressure = 'memory_pressure';
  expect(await hostOf(w, (await open(w, 'pressure')).result.workspace_id)).toBe(idOf('workshop'));
  const v = await world({ pool: [{ name: 'laptop', offline: true, priority: 1 }, { name: 'dokploy', role: 'previous' }] });
  // The offline host is preferred by priority but does not answer: the primary takes it.
  expect(await hostOf(v, (await open(v, 'offline-first')).result.workspace_id)).toBe(idOf('pc'));
  await v.pool.pc.pause();
  expect(await hostOf(v, (await open(v, 'offline-then-paused')).result.workspace_id)).toBe(idOf('dokploy'));
  // An unreachable host counts as unavailable until it answers again: it was asked once inside the cache time.
  expect(v.pool.laptop.requests.filter(a => a === 'capabilities')).toHaveLength(1);
 });
 it('a host that refuses at the moment of the clone (no operation started) is skipped for the next one; nothing is retried on the same host', async () => {
  const w = await world();
  expect((await open(w, 'warm')).status).toBe('applied'); // the primary's "available" answer is now cached
  await w.pool.pc.pause();
  const r = await open(w, 'raced');
  expect(r.status, JSON.stringify(r)).toBe('applied');
  expect(await hostOf(w, r.result.workspace_id)).toBe(idOf('workshop'));
  expect(clones(w)).toEqual({ pc: 2, dokploy: 0, workshop: 1 }); // the refused clone request started nothing on the PC
  const failed = await w.db.listNativeGitWorkspaces(nativeConnection(w.ctx), { limit: 20 }); // active ones only: the refused record is closed
  expect(failed).toHaveLength(2);
 });
 it('no host answered at all: says so plainly and names the routes that need no worker; a mix with a busy host keeps the busy wording', async () => {
  const w = await world({ pool: [{ name: 'workshop', offline: true }] });
  await w.db.setSetting(POOL_SETTING, { kind: 'native-git-worker-pool', hosts: { pc: { enabled: false } } });
  const r = await open(w, 'none-answered');
  expect(r).toMatchObject({ status: 'refused_by_guard', reason_code: 'native_hosts_busy', retryable: true, no_change_sent: true });
  expect(r.error).toMatch(/No workspace host answered/);
  expect(r.error).toMatch(/No operation was started/);
  expect(r.error).toMatch(/github_content_push_files/);
  expect(r.error.length).toBeLessThanOrEqual(300); // longer refusals are replaced by a generic one before the agent sees them
  const v = await world({ pool: [{ name: 'workshop', offline: true }] });
  await v.pool.pc.pause();
  const mixed = await open(v, 'one-paused');
  expect(mixed.error).toMatch(/All workspace hosts are busy or paused/);
 });
 it('all hosts busy or paused: plain retryable refusal, no_operation_started, nothing cloned, through every door', async () => {
  for (const door of doorsFor(def('github_git_workspace_open'))) {
   const w = await world();
   await w.pool.pc.pause(); await w.pool.dokploy.pause(); w.pool.workshop.pressure = 'storage_pressure';
   const r = await open(w, 'all-busy-' + door.name, door);
   expect(r.status, JSON.stringify(r)).toBe('refused_by_guard');
   expect(r).toMatchObject({ done: false, reason_code: 'native_hosts_busy', retryable: true, no_change_sent: true });
   expect(r.error).toMatch(/All workspace hosts are busy or paused; try again in a minute\. No operation was started/);
   expect(r.error).toMatch(/pc paused, workshop busy \(storage_pressure\), dokploy paused/);
   expect(clones(w)).toEqual({ pc: 0, dokploy: 0, workshop: 0 });
   expect(await w.db.listNativeGitWorkspaces(nativeConnection(w.ctx), { limit: 20 })).toHaveLength(0);
   // The same intent works once a host is free.
   await w.pool.dokploy.resume();
   const later = await open(w, 'all-busy-' + door.name, door);
   expect(later.status, JSON.stringify(later)).toBe('applied');
   expect(await hostOf(w, later.result.workspace_id)).toBe(idOf('dokploy'));
  }
 });
 it('the race refusal after every host is tried is "not applied" with no_operation_started', async () => {
  const w = await world({ pool: [{ name: 'workshop' }] });
  expect((await open(w, 'warm-both')).status).toBe('applied');
  await w.pool.pc.pause(); // cached "available" for the PC; the workshop answers live
  w.pool.workshop.pressure = 'memory_pressure';
  const r = await open(w, 'race-all');
  expect(r).toMatchObject({ status: 'not_applied', reason_code: 'no_operation_started', retryable: true, no_change_sent: true });
 });
 it('a disabled host (stored owner setting) takes no new work', async () => {
  const w = await world();
  await w.db.setSetting(POOL_SETTING, { kind: 'native-git-worker-pool', hosts: { pc: { enabled: false }, workshop: { enabled: false } } });
  expect(await hostOf(w, (await open(w, 'disabled')).result.workspace_id)).toBe(idOf('dokploy'));
 });
});

describe('pinning after open', () => {
 it('workspaces on different hosts keep every later call on their own host', async () => {
  const w = await world();
  const onPc = (await open(w, 'pin-pc')).result.workspace_id;
  await w.pool.pc.pause();
  const onWorkshop = (await open(w, 'pin-workshop')).result.workspace_id;
  await w.pool.pc.resume();
  for (const h of Object.values(w.pool)) h.requests.length = 0;
  const run = doorsFor(def('github_git_workspace_run'))[0], read = native.handlers.github_git_workspace_read;
  for (const [id, name] of [[onPc, 'pc'], [onWorkshop, 'workshop']]) {
   const status = view(await read({ workspace_id: id, operation: 'status' }, w.ctx));
   expect(status.state).toBe('ready');
   const made = parse(await run.call(w, { workspace_id: id, operation: 'branch_create', expectedGeneration: status.generation, options: { name: 'topic-' + name }, requestKey: 'pin-run-' + name }));
   expect(made.status, JSON.stringify(made)).toBe('applied');
  }
  expect(w.pool.pc.requests).toEqual(expect.arrayContaining(['inspect', 'run'])); expect(w.pool.workshop.requests).toEqual(expect.arrayContaining(['inspect', 'run']));
  expect(w.pool.pc.requests.filter(a => a === 'run')).toHaveLength(1); expect(w.pool.workshop.requests.filter(a => a === 'run')).toHaveLength(1);
  expect(w.pool.dokploy.requests).toEqual([]);
  // Pinned for life: pausing the workshop never moves its workspace; its calls get the paused answer, not another host.
  await w.pool.workshop.pause();
  const refused = parse(await run.call(w, { workspace_id: onWorkshop, operation: 'branch_create', expectedGeneration: 1, options: { name: 'x' }, requestKey: 'pin-paused' }));
  expect(refused.status).not.toBe('applied');
  expect(w.pool.pc.requests.filter(a => a === 'run')).toHaveLength(1);
 });
 it('one-time downloads from a workspace on a pool host use the h.<host id> relay route and really clone', async () => {
  const w = await world();
  await w.pool.pc.pause();
  const r = parse(await doorsFor(def('github_repo_download'))[0].call(w, { owner: 'example-org', repo: 'hello', mode: 'archive', requestKey: 'pool-download' }));
  expect(r.status, JSON.stringify(r)).toBe('applied');
  expect(await hostOf(w, r.result.workspace_id)).toBe(idOf('workshop'));
  expect(r.result.url).toContain(`/v1/transfer/d/h.${idOf('workshop')}/`);
  const answer = await fetch(w.transferLocal(r.result.url));
  expect(answer.status).toBe(200);
  expect((await answer.arrayBuffer()).byteLength).toBeGreaterThan(20);
  expect(w.transferRelay.seen.at(-1).destination.startsWith(POOL_ORIGIN('workshop') + '/v1/download/')).toBe(true);
 });
});

describe('relay routes per worker', () => {
 const env = { NATIVE_GIT_WORKER_URL: PC + '/', NATIVE_GIT_PREVIOUS_WORKER_URL: 'https://old.example.test/', NATIVE_GIT_WORKER_POOL: JSON.stringify([{ name: 'workshop', origin: 'https://workshop.example.test' }]),
  NATIVE_GIT_WORKER_KEY: 'FAKE-relay-shared-key', PUBLIC_BASE_URL: 'https://mcp.example.test', TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') };
 it('keeps w and p, names other pool hosts by id, and refuses an unconfigured or mismatched id', () => {
  expect(routeFor(env, PC)).toBe('w'); expect(routeFor(env, 'https://old.example.test')).toBe('p');
  const id = hostId('https://workshop.example.test');
  expect(routeFor(env, 'https://workshop.example.test')).toBe('h.' + id);
  const cap = 'e30.' + 'a'.repeat(43);
  const url = transferUrl(env, { kind: 'd', destinationOrigin: 'https://workshop.example.test', capability: cap });
  expect(url).toMatch(new RegExp(`^https://mcp\\.example\\.test/v1/transfer/d/h\\.${id}/[A-Za-z0-9_-]{32}/`));
  // A valid tag for one host cannot be pointed at another host (the tag binds the destination origin).
  const moved = url.replace('/h.' + id + '/', '/w/');
  expect(planTransferRelay({ method: 'GET', url: moved, headers: {} }, env)).toMatchObject({ ok: false, status: 403 });
  expect(planTransferRelay({ method: 'GET', url: url.replace(id, 'f'.repeat(32)), headers: {} }, env)).toMatchObject({ ok: false, status: 404 });
  // The tag itself is good here: what fails is only the fake capability.
  expect(planTransferRelay({ method: 'GET', url, headers: {} }, env)).toMatchObject({ ok: false, status: 403, message: expect.stringMatching(/not valid/) });
  const withoutPool = { ...env, NATIVE_GIT_WORKER_POOL: undefined };
  expect(planTransferRelay({ method: 'GET', url, headers: {} }, withoutPool)).toMatchObject({ ok: false, status: 404 });
 });
});

describe('capabilities caching', () => {
 it('reuses an available answer inside the cache time, asks again after it, and never reuses a paused answer', async () => {
  const w = await world();
  const caps = () => w.pool.pc.requests.filter(a => a === 'capabilities').length;
  await placeWorkspace(w.ctx); await placeWorkspace(w.ctx);
  expect(caps()).toBe(1);
  w.advanceClock(STATUS_TTL_MS + 1);
  await placeWorkspace(w.ctx);
  expect(caps()).toBe(2);
  w.advanceClock(STATUS_TTL_MS + 1);
  await w.pool.pc.pause();
  expect((await placeWorkspace(w.ctx)).name).toBe('workshop');
  expect((await placeWorkspace(w.ctx)).name).toBe('workshop');
  expect(caps()).toBe(4); // paused is asked again every time, so a resume is seen at once
  await w.pool.pc.resume();
  expect((await placeWorkspace(w.ctx)).name).toBe('pc');
 });
});

describe('visibility', () => {
 it('github_server_status lists each pool host by name with its audience, state and counts, never an address', async () => {
  const w = await world({ primary: { limit: 4 } });
  await open(w, 'status-one');
  await w.pool.dokploy.pause();
  const status = await serverStatus({ fields: ['health'] }, w.ctx, { budgetMs: 5000 });
  expect(status.health.worker_pool).toMatchObject({ status: 'ok', available: 2 });
  expect(status.health.worker_pool.hosts).toEqual([{ name: 'pc', audience: 'owner', state: 'available', active: 1, max: 4 }, { name: 'workshop', audience: 'shared', state: 'available', active: 0 }, { name: 'dokploy', audience: 'shared', state: 'paused', active: 0 }]);
  expect(JSON.stringify(status)).not.toMatch(/example\.test/);
  const states = await poolStatus(w.ctx);
  expect(states.map(s => s.role)).toEqual(['primary', 'pool', 'previous']);
 });
});

describe('every opener uses the pool', () => {
 it('github_playground_run places its workspace on the next host when the primary is paused', async () => {
  const w = await world();
  await w.pool.pc.pause();
  const out = parse(await doorsFor(def('github_playground_run'))[0].call(w, { owner: 'example-org', repo: 'hello', ref: 'main', argv: ['npm', 'test'], requestKey: 'pool-run' }));
  expect(out.status, JSON.stringify(out)).toBe('applied');
  expect(clones(w)).toEqual({ pc: 0, dokploy: 0, workshop: 1 });
 });
 it('github_repo_change clones on the next host when the primary is paused', async () => {
  const w = await world();
  w.gh.when('GET /repos/{owner}/{repo}/git/ref/{ref}').reply(200, { ref: 'refs/heads/main', object: { sha: 'a'.repeat(40), type: 'commit' } });
  await w.pool.pc.pause();
  await doorsFor(def('github_repo_change'))[0].call(w, { repo: 'hello', branch: 'topic', files: [{ path: 'new.txt', content: 'hello\n' }], message: 'Add new.txt', requestKey: 'pool-change' });
  expect(clones(w)).toMatchObject({ pc: 0, workshop: 1 });
 });
});

// The nine write-contract checks for the openers through every door, in a pool whose primary is paused.
const pausedPool = async w => { cleanups.push(await prepareNativeWorld(w, { pool: POOL })); await w.nativeReady(); await w.pool.pc.pause(); };
runWriteContract({ label: 'github_git_workspace_open (pool, primary paused)', definition: def('github_git_workspace_open'), args: { owner: 'example-org', repo: 'hello' }, arrange, needsConfirm: true, profile: 'full', expectedWrites: 0, prepare: pausedPool });
runWriteContract({ label: 'github_repo_download (pool, primary paused)', definition: def('github_repo_download'), args: { owner: 'example-org', repo: 'hello', mode: 'archive' }, arrange, needsConfirm: true, profile: 'full', expectedWrites: 0, prepare: pausedPool });
runWriteContract({ label: 'github_playground_run (pool, primary paused)', definition: def('github_playground_run'), args: { owner: 'example-org', repo: 'hello', ref: 'main', argv: ['npm', 'test'], requestKey: 'pool-contract-run' }, arrange, needsConfirm: true, profile: 'full', expectedWrites: 0, prepare: pausedPool });

describe('worker capacity report and limit', () => {
 it('capabilities report active_workspaces and max_workspaces; a full worker refuses a new clone before starting anything', async () => {
  const w = await world({ primary: { maxWorkspaces: 1 }, pool: [{ name: 'workshop', offline: true }] });
  const empty = await callNativeWorker(w.ctx, { action: 'capabilities', job: { host: idOf('pc') } });
  expect(empty).toMatchObject({ active_workspaces: 0, max_workspaces: 1 });
  const one = await open(w, 'only-one'); expect(one.status, JSON.stringify(one)).toBe('applied');
  expect(await callNativeWorker(w.ctx, { action: 'capabilities', job: { host: idOf('pc') } })).toMatchObject({ active_workspaces: 1, max_workspaces: 1 });
  const binding = { authority: 'a'.repeat(32), connection: nativeConnection(w.ctx), owner: 'example-org', repo: 'hello' };
  const refused = await callNativeWorker(w.ctx, { action: 'open', binding, job: { id: 'job_' + 'b'.repeat(16), host: idOf('pc'), idleTimeoutMs: 3600000 }, requestKey: 'direct-over-limit', allowWrite: true, network: true, renewLease: false, options: { ttlMs: 3600000 } }).catch(e => e);
  expect(refused.message, String(refused?.message)).toMatch(/workspace_limit/);
  expect(refused.nativeNoOperationStarted).toBe(true);
  expect(refused.message).toMatch(/workspace_limit\. No operation was started/);
  // With the only other host offline, the tool answers the plain retryable refusal.
  const r = await open(w, 'second');
  expect(r).toMatchObject({ status: 'refused_by_guard', reason_code: 'native_hosts_busy', retryable: true, no_change_sent: true });
  expect(r.error).toMatch(/pc full, workshop unavailable/);
 });
});

describe('git remote keys stay on their pool host', () => {
 const ENV = { TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'), PUBLIC_BASE_URL: 'https://mcp.example.test', NATIVE_GIT_WORKER_URL: PC + '/', NATIVE_GIT_WORKER_KEY: 'FAKE-pool-remote-worker-key-for-signing-tests', VERCEL_ENV: 'production',
  NATIVE_GIT_WORKER_POOL: JSON.stringify([{ name: 'workshop', origin: 'https://workshop.example.test' }]) };
 async function key(host) {
  const w = await makeWorld({ profile: 'full', mode: 'production', operator: true });
  await w.db.createAccessToken({ accessToken: 'FAKE-access-pool', refreshToken: 'FAKE-refresh-pool', clientId: 'client-1', defaultAccount: 'example-org', accounts: ['example-org'], mode: 'production', profile: 'full', listing: 'compact' });
  const { id, code } = newExchangeCode(), secret = newSessionKey(id);
  await w.db.createGitRemoteKey({ id, connection: 'client-1', owner: 'example-org', repo: 'hello', access: 'write', codeHash: sha256(code), codeExpiresAt: new Date(w.ctx.now() + 600000), expiresAt: new Date(w.ctx.now() + 8 * 3600000) });
  await w.db.exchangeGitRemoteCode({ id, codeHash: sha256(code), keyHash: sha256(secret) });
  const openScope = async () => ({ db: w.db, env: ENV, scope: { legacy: true }, host });
  return env => handleGitRemote(new Request('https://mcp.example.test/git/example-org/hello.git/info/refs?service=git-upload-pack', { headers: { authorization: 'Basic ' + Buffer.from('x-robinson-git:' + secret).toString('base64') } }), env, { now: w.ctx.now, openScope });
 }
 it('forwards to the recorded host, the primary for older keys, and refuses a host that is no longer configured', async () => {
  const workshop = hostId('https://workshop.example.test');
  const first = await (await key(workshop))(ENV);
  expect(first.headers.get('x-middleware-rewrite'), first.status + ' ' + await first.clone().text()).toBe('https://workshop.example.test/v1/remote/info/refs?service=git-upload-pack');
  expect((await (await key(null))(ENV)).headers.get('x-middleware-rewrite')).toBe(PC + '/v1/remote/info/refs?service=git-upload-pack');
  const gone = await (await key(workshop))({ ...ENV, NATIVE_GIT_WORKER_POOL: undefined });
  expect(gone.status).toBe(503); expect(gone.headers.get('x-middleware-rewrite')).toBeNull();
  expect(await gone.text()).toMatch(/no longer configured/);
 });
});

describe('git remote setup places the key', () => {
 it('records the next host for the key and uses this service\'s own domain (no direct host) when the primary is paused', async () => {
  const w = await world();
  w.ctx.env.GIT_DIRECT_ORIGIN = 'https://git-direct.example.test';
  const setup = doorsFor(def('github_git_remote_setup'))[0];
  await w.pool.pc.pause();
  const r = parse(await setup.call(w, { owner: 'example-org', repo: 'hello', access: 'read', requestKey: 'remote-paused' }));
  expect(r.status, JSON.stringify(r)).toBe('applied');
  expect(r.result.remote_url).toBe('https://mcp.example.test/git/example-org/hello.git');
  expect(r.result.fallback_url).toBeUndefined();
  const index = await w.db.getSetting('git_remote.' + r.result.key_id);
  expect(index.host).toBe(idOf('workshop'));
  expect(JSON.stringify(r)).toMatch(/workshop host through this service's own domain/);
  expect(w.pool.pc.requests).not.toContain('direct_configure');
 });
});
