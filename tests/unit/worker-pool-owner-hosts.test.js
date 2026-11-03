// WORKER-POOL-2 (owner decision 2026-11-03, "Only my work on my PC"): owner-only pool hosts. Real signed worker hosts
// (workers/native-git/server.js) on real local Git behind the same control plane, fake GitHub validated against the
// vendored schema. The primary ("pc") is owner-only by default whenever another host serves everyone.
import { afterEach, describe, expect, it } from 'vitest';
import { generateKeyPairSync, createPublicKey, sign } from 'node:crypto';
import { makeWorld, parse, doorsFor } from '../../test/helpers/write-contract.js';
import { prepareNativeWorld, POOL_ORIGIN } from '../../test/helpers/native-git-world.js';
import * as native from '../../src/tools/native-git.js';
import * as gitRemote from '../../src/tools/git-remote.js';
import { nativeConnection } from '../../src/native-git/client.js';
import { configuredHosts, applyPoolSetting, hostId, ownerCaller, hostAllowed, routeJobFor, strayCount } from '../../src/native-git/pool-config.js';
import { serverStatus } from '../../src/tools/server-status.js';
import { handleGitRemote } from '../../src/git-remote/edge.js';
import { directAuthorize, DIRECT_WORKER_SETTING } from '../../src/git-remote/api.js';
import { directPayload, sha256 as wireSha } from '../../src/git-remote/wire.js';
import { newExchangeCode, newSessionKey, sha256 } from '../../src/git-remote/keys.js';

const cleanups = [];
afterEach(async () => { for (const close of cleanups.splice(0)) await close(); });
const PC = 'https://native-worker.example.test';
const DOKPLOY = [{ name: 'dokploy', role: 'previous' }];
const def = name => ({ tool: [...native.tools, ...gitRemote.tools].find(t => t.name === name), handler: native.handlers[name] ?? gitRemote.handlers[name] });
const arrange = gh => { gh.nativeOutcome = 'ok'; gh.when('GET /repos/{owner}/{repo}').reply(200, { full_name: 'example-org/hello', default_branch: 'main' }); };
/** owner: true = the service owner's own connector (operator mark); false = anyone else (public or tenant person). */
async function world({ owner, pool = DOKPLOY } = {}) {
 const w = await makeWorld({ profile: 'full', mode: 'production', gates: [], operator: owner }); arrange(w.gh);
 cleanups.push(await prepareNativeWorld(w, { pool })); await w.nativeReady();
 return w;
}
const open = (w, requestKey, door = doorsFor(def('github_git_workspace_open'))[0]) => door.call(w, { owner: 'example-org', repo: 'hello', runtime: 'none', requestKey }).then(parse);
const hostOf = async (w, id) => JSON.parse((await w.db.getJob(id, nativeConnection(w.ctx))).provider_ref).host;
const idOf = name => hostId(name === 'pc' ? PC : POOL_ORIGIN(name));
// Credential-shaped fixture values are built at run time (fake, never real).
const fake = (...parts) => ['FAKE', ...parts].join('-');
const view = r => r?.content || r?.structuredContent ? parse(r) : r;
const asPerson = w => { const connection = Object.freeze({ ...w.connection, operator: undefined }); return { ...w, connection, ctx: { ...w.ctx, connection } }; };

describe('host audience comes from protected configuration only', () => {
 const two = { NATIVE_GIT_WORKER_URL: PC + '/', NATIVE_GIT_PREVIOUS_WORKER_URL: 'https://old.example.test/' };
 const audiences = env => configuredHosts(env).map(h => [h.name, h.audience]);
 it('defaults: the primary is owner-only whenever another host is shared; a one-host pool stays shared', () => {
  expect(audiences(two)).toEqual([['primary', 'owner'], ['previous', 'shared']]);
  expect(audiences({ NATIVE_GIT_WORKER_URL: PC + '/' })).toEqual([['primary', 'shared']]);
  expect(audiences({ NATIVE_GIT_WORKER_URL: PC + '/', NATIVE_GIT_WORKER_POOL: JSON.stringify([{ name: 'workshop', origin: 'https://workshop.example.test' }]) })).toEqual([['primary', 'owner'], ['workshop', 'shared']]);
 });
 it('an explicit audience wins; an invalid one is skipped and reported; a primary with no shared host beside it is shared unless told', () => {
  expect(audiences({ ...two, NATIVE_GIT_WORKER_POOL: JSON.stringify([{ name: 'pc', origin: PC, audience: 'shared' }]) })).toEqual([['pc', 'shared'], ['previous', 'shared']]);
  expect(audiences({ ...two, NATIVE_GIT_WORKER_POOL: JSON.stringify([{ name: 'old', origin: 'https://old.example.test', audience: 'owner' }]) })).toEqual([['primary', 'shared'], ['old', 'owner']]);
  expect(audiences({ NATIVE_GIT_WORKER_URL: PC + '/', NATIVE_GIT_WORKER_POOL: JSON.stringify([{ name: 'pc', origin: PC, audience: 'owner' }]) })).toEqual([['pc', 'owner']]);
  const bad = configuredHosts({ ...two, NATIVE_GIT_WORKER_POOL: JSON.stringify([{ name: 'pc', origin: PC, audience: 'everyone' }]) });
  expect(bad.invalid).toBe(true); expect(bad.map(h => [h.name, h.audience])).toEqual([['primary', 'owner'], ['previous', 'shared']]);
 });
 it('the stored setting cannot change a host\'s audience', () => {
  const adjusted = applyPoolSetting(configuredHosts(two), { hosts: { primary: { audience: 'shared', priority: 95 } } });
  expect(adjusted.map(h => [h.name, h.audience, h.priority])).toEqual([['previous', 'shared', 90], ['primary', 'owner', 95]]);
 });
 it('only the operator\'s own direct full connector on the owner\'s database is the owner', () => {
  const full = { client_id: 'c', profile: 'full' };
  expect(ownerCaller({ connection: { ...full, operator: true }, db: {} })).toBe(true);
  expect(ownerCaller({ connection: full, db: {} })).toBe(false); // a public or Marketplace connection, an RTC/HTTPS door
  expect(ownerCaller({ connection: { ...full, operator: true }, db: { playgroundScope: { tenantId: 't-1' } } })).toBe(false); // a tenant schema
  expect(ownerCaller({ connection: { ...full, operator: true, pass: true }, db: {} })).toBe(false); // a service pass
  expect(ownerCaller({ connection: { client_id: 'c', pass_id: null }, db: {} })).toBe(false); // background maintenance
  const owner = configuredHosts(two)[0];
  expect(hostAllowed({ connection: full, db: {} }, owner)).toBe(false);
  expect(hostAllowed({ connection: { ...full, operator: true }, db: {} }, owner)).toBe(true);
 });
 it('an unpinned call from a non-owner goes to a shared host; a pinned one keeps its host; none shared is a plain refusal', () => {
  const person = { env: two, connection: { client_id: 'c', profile: 'full' }, db: {} };
  expect(routeJobFor(person, undefined)).toEqual({ host: hostId('https://old.example.test') });
  expect(routeJobFor({ ...person, connection: { ...person.connection, operator: true } }, undefined)).toBeUndefined();
  const pinned = { id: 'job_1', host: hostId(PC) };
  expect(routeJobFor(person, pinned)).toBe(pinned);
  const ownerOnly = { env: { NATIVE_GIT_WORKER_URL: PC + '/', NATIVE_GIT_PREVIOUS_WORKER_URL: 'https://old.example.test/', NATIVE_GIT_WORKER_POOL: JSON.stringify([{ name: 'old', origin: 'https://old.example.test', enabled: false }]) }, connection: person.connection, db: {} };
  expect(() => routeJobFor(ownerOnly, undefined)).toThrow(expect.objectContaining({ safeCode: 'native_hosts_busy', noOperationStarted: true }));
 });
});

describe('placement: other people never land on the owner\'s PC', () => {
 it('a public or tenant connection is placed on Dokploy through every door, and the PC is never even asked', async () => {
  const w = await world({ owner: false });
  for (const door of doorsFor(def('github_git_workspace_open'))) {
   const r = await open(w, 'person-' + door.name, door);
   expect(r.status, JSON.stringify(r)).toBe('applied');
   expect(await hostOf(w, r.result.workspace_id)).toBe(idOf('dokploy'));
  }
  expect(w.pool.pc.requests).toEqual([]);
  expect(w.pool.dokploy.requests.filter(a => a === 'open')).toHaveLength(3);
 });
 it('github_repo_download for a person also goes to Dokploy', async () => {
  const w = await world({ owner: false });
  const r = parse(await doorsFor(def('github_repo_download'))[0].call(w, { owner: 'example-org', repo: 'hello', mode: 'archive', requestKey: 'person-download' }));
  expect(r.status, JSON.stringify(r)).toBe('applied');
  expect(w.pool.pc.requests).toEqual([]);
  expect(w.pool.dokploy.requests).toContain('open');
 });
 it('the owner\'s connection is placed on the PC first and spills to Dokploy when the PC is paused', async () => {
  const w = await world({ owner: true });
  expect(await hostOf(w, (await open(w, 'owner-first')).result.workspace_id)).toBe(idOf('pc'));
  await w.pool.pc.pause();
  expect(await hostOf(w, (await open(w, 'owner-spill')).result.workspace_id)).toBe(idOf('dokploy'));
 });
 it('when the shared host is down a person gets the plain retryable refusal, not the PC', async () => {
  const w = await world({ owner: false, pool: [{ name: 'dokploy', role: 'previous', offline: true }] });
  const r = await open(w, 'person-down');
  expect(r.status, JSON.stringify(r)).toBe('refused_by_guard');
  expect(r).toMatchObject({ reason_code: 'native_hosts_busy', retryable: true, no_change_sent: true });
  expect(r.error).toMatch(/try again in a minute\. No operation was started/);
  expect(r.error).not.toMatch(/\bpc\b|primary/);
  expect(w.pool.pc.requests).toEqual([]);
  // The owner in the same configuration still gets the PC.
  const o = await world({ owner: true, pool: [{ name: 'dokploy', role: 'previous', offline: true }] });
  expect(await hostOf(o, (await open(o, 'owner-down')).result.workspace_id)).toBe(idOf('pc'));
 });
 it('a paused shared host also refuses the person (nothing cloned, no job), and the same intent works once it resumes', async () => {
  const w = await world({ owner: false });
  await w.pool.dokploy.pause();
  const r = await open(w, 'person-paused');
  expect(r.reason_code).toBe('native_hosts_busy');
  expect(w.pool.pc.requests).toEqual([]);
  await w.pool.dokploy.resume();
  const again = await open(w, 'person-paused');
  expect(again.status, JSON.stringify(again)).toBe('applied');
  expect(await hostOf(w, again.result.workspace_id)).toBe(idOf('dokploy'));
 });
 it('workspace capabilities for a person come from the shared host, never the PC', async () => {
  const w = await world({ owner: false });
  const r = await native.handlers.github_git_workspace_read({ operation: 'capabilities' }, w.ctx);
  expect(view(r).worker.ready).toBe(true);
  expect(w.pool.pc.requests).toEqual([]);
  expect(w.pool.dokploy.requests).toContain('capabilities');
 });
});

describe('pinned workspaces keep their host', () => {
 it('a non-owner request for a workspace already on the PC is still served there, and counted', async () => {
  const w = await world({ owner: true });
  const r = await open(w, 'owner-pinned');
  expect(await hostOf(w, r.result.workspace_id)).toBe(idOf('pc'));
  const before = strayCount().count;
  const person = asPerson(w);
  const read = view(await native.handlers.github_git_workspace_read({ workspace_id: r.result.workspace_id, operation: 'status' }, person.ctx));
  expect(read.state, JSON.stringify(read)).toBe('ready');
  expect(w.pool.pc.requests.at(-1)).toBe('inspect');
  expect(strayCount().count).toBeGreaterThan(before);
  expect(strayCount().by_host.pc).toBeGreaterThan(0);
  // The owner's own calls are not counted.
  const mid = strayCount().count;
  await native.handlers.github_git_workspace_read({ workspace_id: r.result.workspace_id, operation: 'status' }, w.ctx);
  expect(strayCount().count).toBe(mid);
 });
});

describe('git remote for a person', () => {
 it('setup places the key on Dokploy and hands out this service\'s domain, never the PC\'s direct address', async () => {
  const w = await world({ owner: false });
  w.ctx.env.GIT_DIRECT_ORIGIN = 'https://pc-direct.example.test';
  const setup = doorsFor(def('github_git_remote_setup'))[0];
  const r = parse(await setup.call(w, { owner: 'example-org', repo: 'hello', access: 'write', requestKey: 'person-remote' }));
  expect(r.status, JSON.stringify(r)).toBe('applied');
  expect(r.result.remote_url).toBe('https://mcp.example.test/git/example-org/hello.git');
  expect(r.result.fallback_url).toBeUndefined();
  expect(JSON.stringify(r)).not.toMatch(/pc-direct|native-worker\.example|primary worker/);
  expect((await w.db.getSetting('git_remote.' + r.result.key_id)).host).toBe(idOf('dokploy'));
  expect(w.pool.pc.requests).toEqual([]);
 });
 it('the owner\'s setup still uses the PC (and its direct host when configured)', async () => {
  const w = await world({ owner: true });
  const r = parse(await doorsFor(def('github_git_remote_setup'))[0].call(w, { owner: 'example-org', repo: 'hello', access: 'read', requestKey: 'owner-remote' }));
  expect(r.status, JSON.stringify(r)).toBe('applied');
  expect((await w.db.getSetting('git_remote.' + r.result.key_id)).host).toBe(idOf('pc'));
 });

 const ENV = { TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'), PUBLIC_BASE_URL: 'https://mcp.example.test', NATIVE_GIT_WORKER_URL: PC + '/', NATIVE_GIT_PREVIOUS_WORKER_URL: 'https://old.example.test/', NATIVE_GIT_WORKER_CUTOVER_AT: '2026-11-03T00:00:00Z', NATIVE_GIT_WORKER_KEY: fake('owner', 'hosts', 'worker', 'key', 'for', 'signing', 'tests'), VERCEL_ENV: 'production', GIT_DIRECT_ORIGIN: 'https://pc-direct.example.test' };
 async function keyWorld(scope, host) {
  const w = await makeWorld({ profile: 'full', mode: 'production', operator: true });
  await w.db.createAccessToken({ accessToken: fake('access', 'owner', 'hosts'), refreshToken: fake('refresh', 'owner', 'hosts'), clientId: 'client-1', defaultAccount: 'example-org', accounts: ['example-org'], mode: 'production', profile: 'full', listing: 'compact' });
  const { id, code } = newExchangeCode(), secret = newSessionKey(id);
  await w.db.createGitRemoteKey({ id, connection: 'client-1', owner: 'example-org', repo: 'hello', access: 'write', codeHash: sha256(code), codeExpiresAt: new Date(w.ctx.now() + 600000), expiresAt: new Date(w.ctx.now() + 8 * 3600000) });
  await w.db.exchangeGitRemoteCode({ id, codeHash: sha256(code), keyHash: sha256(secret) });
  return { w, id, secret, openScope: async () => ({ db: w.db, env: ENV, scope, host }) };
 }
 it('a person\'s key made before this change on the PC keeps working through the domain door, and is counted', async () => {
  const k = await keyWorld({ tenantId: 't-1', identityId: 'i-1', membershipRevision: 1 }, null);
  const before = strayCount().count;
  const res = await handleGitRemote(new Request('https://mcp.example.test/git/example-org/hello.git/info/refs?service=git-upload-pack', { headers: { authorization: 'Basic ' + Buffer.from('x-robinson-git:' + k.secret).toString('base64') } }), ENV, { now: k.w.ctx.now, openScope: k.openScope });
  expect(res.headers.get('x-middleware-rewrite')).toBe(PC + '/v1/remote/info/refs?service=git-upload-pack');
  expect(strayCount().count).toBe(before + 1);
  // The owner's own key is not counted.
  const own = await keyWorld({ legacy: true }, null);
  await handleGitRemote(new Request('https://mcp.example.test/git/example-org/hello.git/info/refs?service=git-upload-pack', { headers: { authorization: 'Basic ' + Buffer.from('x-robinson-git:' + own.secret).toString('base64') } }), ENV, { now: own.w.ctx.now, openScope: own.openScope });
  expect(strayCount().count).toBe(before + 1);
 });
 it('the PC\'s direct git host refuses a key whose mirror lives on another host', async () => {
  const { privateKey } = generateKeyPairSync('ed25519');
  const workerKey = 'ed25519:' + createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).toString('base64');
  const call = async k => {
   await k.w.db.setSetting(DIRECT_WORKER_SETTING, { kind: 'git-direct-worker', origin: ENV.GIT_DIRECT_ORIGIN, worker_key: workerKey });
   const body = { id: k.id, hash: wireSha(k.secret), owner: 'example-org', repo: 'hello', service: 'git-upload-pack', step: 'refs' };
   const at = String(k.w.ctx.now()), nonce = 'e'.repeat(32);
   const signature = sign(null, directPayload(at, nonce, JSON.stringify([body.id, body.hash, body.owner, body.repo, body.service, body.step])), privateKey).toString('base64url');
   let payload; const res = { statusCode: 200, setHeader() {}, end(text) { payload = JSON.parse(text); } };
   await directAuthorize({ method: 'POST', headers: { 'content-type': 'application/json', 'x-robinson-git-worker': `${at}.${nonce}.${signature}` }, body, query: { op: 'authorize' } }, res, { env: ENV, openScope: k.openScope, now: k.w.ctx.now, root: k.w.db });
   return payload;
  };
  const elsewhere = await call(await keyWorld({ tenantId: 't-1', identityId: 'i-1', membershipRevision: 1 }, hostId('https://old.example.test')));
  expect(elsewhere).toMatchObject({ allow: false, status: 403, reason: 'other_host' });
  expect(JSON.stringify(elsewhere)).not.toMatch(/example\.test/);
  const onPc = await call(await keyWorld({ legacy: true }, hostId(PC)));
  expect(onPc.reason).not.toBe('other_host');
 });
});

describe('github_server_status', () => {
 it('shows each host\'s audience; a person sees the PC by name and audience only, and no direct git host', async () => {
  const w = await world({ owner: false });
  w.ctx.env.GIT_DIRECT_ORIGIN = 'https://pc-direct.example.test';
  const status = await serverStatus({ fields: ['health', 'workers'] }, w.ctx, { budgetMs: 5000 });
  expect(status.health.worker_pool.hosts).toEqual([{ name: 'pc', audience: 'owner', state: 'owner_only' }, { name: 'dokploy', audience: 'shared', state: 'available', active: 0 }]);
  expect(status.health.worker_pool).toMatchObject({ status: 'ok', available: 1 });
  expect(status.health.direct_git).toBeUndefined();
  expect(status.workers.native_git.protocol).toBeTypeOf('number');
  expect(JSON.stringify(status)).not.toMatch(/example\.test/);
  expect(w.pool.pc.requests).toEqual([]);
 });
 it('the owner sees the PC\'s live state', async () => {
  const w = await world({ owner: true });
  const status = await serverStatus({ fields: ['health'] }, w.ctx, { budgetMs: 5000 });
  expect(status.health.worker_pool.hosts[0]).toMatchObject({ name: 'pc', audience: 'owner', state: 'available' });
  expect(JSON.stringify(status)).not.toMatch(/native-worker/);
 });
});
