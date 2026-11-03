// GIT-DIRECT-2: the control plane configures the worker's direct git host. The worker accepts only the
// signed `direct_configure` action (pinned control key), checks both origins, stores them on its volume
// (atomic, 0600), starts the direct listener at once and reads the file again at boot; its environment
// wins. github_git_remote_setup sends the action once (applied setups only), then pins and uses the
// direct address, or falls back to the MCP domain with a plain note. Every value here is fake.
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nativeGitServer } from '../../workers/native-git/server.js';
import { directIdentity, readDirectFile, directOrigins } from '../../workers/native-git/direct.js';
import { WORKER_PROTOCOL } from '../../src/native-git/protocol.js';
import { makeWorld, parse, runWriteContract, doorsFor } from '../../test/helpers/write-contract.js';
import { startGitRemote, run, WORKER, DIRECT, PUBLIC } from '../../test/helpers/git-remote-world.js';
import * as gitRemote from '../../src/tools/git-remote.js';
import { DIRECT_WORKER_SETTING } from '../../src/git-remote/api.js';

const cleanups = [];
afterEach(async () => { for (const c of cleanups.splice(0).reverse()) await c(); });

// ---- The worker side ---------------------------------------------------------------------------
const control = generateKeyPairSync('ed25519');
const CONTROL_KEY = 'ed25519:' + control.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
const stranger = generateKeyPairSync('ed25519');
const signWith = (privateKey, body) => 'ed25519:' + sign(null, Buffer.from(body), privateKey).toString('base64url');
const GOOD = { origin: 'https://git.example.test', control: 'https://mcp.example.test' };
const listenLocal = server => new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); }); });
const origin = server => `http://127.0.0.1:${server.address().port}`;

async function storage() {
 const root = await mkdtemp(join(tmpdir(), 'git-direct-configure-'));
 cleanups.push(() => rm(root, { recursive: true, force: true }));
 return root;
}
/** Boots a worker the way server.js does: identity and stored file read from the volume, then start(). */
async function boot(root, env = {}) {
 const worker = nativeGitServer({ root, key: CONTROL_KEY, direct: { identity: await directIdentity(root), env: { GIT_DIRECT_PORT: '1', ...env }, stored: await readDirectFile(root), listen: listenLocal } });
 await new Promise(resolve => worker.listen(0, '127.0.0.1', resolve));
 await worker.directHost.start();
 const close = async () => { for (const s of [worker, ...(worker.direct.listening ? [worker.direct] : [])]) { s.closeAllConnections(); await new Promise(r => s.close(() => r())); } };
 cleanups.push(close);
 return { worker, close };
}
async function call(worker, claim, { signer = control.privateKey, signature } = {}) {
 const body = JSON.stringify({ version: WORKER_PROTOCOL, expiresAt: Date.now() + 60000, ...claim });
 const headers = { 'Content-Type': 'application/json', ...(signature === null ? {} : { 'x-robinson-signature': signature ?? signWith(signer, body) }) };
 const res = await fetch(origin(worker) + '/v1/workspace', { method: 'POST', headers, body });
 return { status: res.status, body: await res.json() };
}
const configure = (worker, options, extra = {}) => call(worker, { action: 'direct_configure', options, allowWrite: true }, extra);
const capabilities = async worker => (await call(worker, { action: 'capabilities' })).body;
function plain(server, path, host = 'git.example.test') {
 return new Promise((resolve, reject) => {
  const req = httpRequest(origin(server) + path, { headers: { host } }, res => { let body = ''; res.on('data', c => { body += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body })); });
  req.on('error', reject); req.end();
 });
}

describe('GIT-DIRECT-2 worker: direct_configure', () => {
 it('accepts only the signed action with a write lease; unsigned, badly signed and read leases change nothing', async () => {
  const root = await storage();
  const { worker } = await boot(root);
  const before = await capabilities(worker);
  expect(before.git_direct).toBeUndefined();
  expect(before.git_direct_configure).toBe('v1');
  expect(worker.direct.listening).toBe(false);

  expect(await configure(worker, GOOD, { signature: null })).toMatchObject({ status: 401, body: { error: 'invalid_worker_lease' } });
  expect(await configure(worker, GOOD, { signer: stranger.privateKey })).toMatchObject({ status: 401, body: { error: 'invalid_worker_lease' } });
  expect(await configure(worker, GOOD, { signature: 'ed25519:' + 'A'.repeat(86) })).toMatchObject({ status: 401 });
  expect(await call(worker, { action: 'direct_configure', options: GOOD, allowWrite: false })).toMatchObject({ status: 400, body: { reason: expect.stringMatching(/authorized write lease/) } });
  expect(await call(worker, { action: 'direct_configure', options: GOOD, allowWrite: true, expiresAt: Date.now() - 1 })).toMatchObject({ status: 401 });
  expect(await readDirectFile(root)).toBeNull();
  expect(worker.direct.listening).toBe(false);

  const done = await configure(worker, GOOD);
  expect(done.status).toBe(200);
  expect(done.body.git_direct).toMatchObject({ version: 'v1', origin: GOOD.origin, control: GOOD.control, source: 'file', worker_key: expect.stringMatching(/^ed25519:/) });
  expect((await capabilities(worker)).git_direct).toEqual(done.body.git_direct);
  // The worker's private key is never in an answer.
  expect(JSON.stringify(done.body)).not.toMatch(/PRIVATE KEY/);
 });

 it('refuses bad origins and the same host for both, storing nothing', async () => {
  const root = await storage();
  const { worker } = await boot(root);
  const bad = [
   { origin: 'http://git.example.test', control: GOOD.control },
   { origin: 'https://git.example.test/path', control: GOOD.control },
   { origin: 'https://user:FAKE-pass@git.example.test', control: GOOD.control },
   { origin: 'https://git.example.test?x=1', control: GOOD.control },
   { origin: GOOD.origin, control: 'ftp://mcp.example.test' },
   { origin: GOOD.origin },
   { origin: 'https://mcp.example.test', control: 'https://mcp.example.test' },
   { origin: 'https://git.example.test', control: 'https://git.example.test/' }
  ];
  for (const options of bad) {
   const out = await configure(worker, options);
   expect(out.status, JSON.stringify(options)).toBe(400);
   expect(out.body.reason).toMatch(/https origin|different address/);
  }
  expect(() => directOrigins({ origin: 'https://git.example.test', control: 'https://git.example.test' })).toThrow(/different address/);
  expect(await readDirectFile(root)).toBeNull();
  expect((await capabilities(worker)).git_direct).toBeUndefined();
  expect(worker.direct.listening).toBe(false);
 });

 it('starts the listener live (no restart): /health answers, git routes need a key, other host names are refused', async () => {
  const root = await storage();
  const { worker } = await boot(root);
  expect((await configure(worker, GOOD)).status).toBe(200);
  expect(worker.direct.listening).toBe(true);
  expect(await plain(worker.direct, '/health')).toMatchObject({ status: 200, body: 'ok\n' });
  const noKey = await plain(worker.direct, '/git/example-org/hello.git/info/refs?service=git-upload-pack');
  expect(noKey.status).toBe(401);
  expect(noKey.headers['www-authenticate']).toMatch(/^Basic realm=/);
  expect((await plain(worker.direct, '/git/example-org/hello.git/info/refs?service=git-upload-pack', 'elsewhere.example.test')).status).toBe(421);
  // Not an open proxy: anything but the fixed git paths is not found.
  expect((await plain(worker.direct, '/https://github.com/')).status).toBe(404);
  // Configuring again with the same values is a no-op; the listener stays up.
  expect((await configure(worker, GOOD)).status).toBe(200);
  expect(worker.direct.listening).toBe(true);
 });

 it('stores the configuration atomically (0600) and reads it again after a restart', async () => {
  const root = await storage();
  const first = await boot(root);
  expect((await configure(first.worker, GOOD)).status).toBe(200);
  const file = join(root, '.git-direct', 'config.json');
  expect((await stat(file)).mode & 0o777).toBe(0o600);
  expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ version: 1, ...GOOD });
  await first.close();

  const second = await boot(root);
  expect((await capabilities(second.worker)).git_direct).toMatchObject({ origin: GOOD.origin, control: GOOD.control, source: 'file' });
  expect(second.worker.direct.listening).toBe(true);
  expect(await plain(second.worker.direct, '/health')).toMatchObject({ status: 200 });
  // A damaged file is ignored (the host stays off until it is configured again).
  await second.close();
  await writeFile(file, '{"version":1,"origin":"http://git.example.test","control":"https://mcp.example.test"}\n');
  const third = await boot(root);
  expect((await capabilities(third.worker)).git_direct).toBeUndefined();
  expect(third.worker.direct.listening).toBe(false);
 });

 it('the worker environment wins over the stored file and cannot be changed or turned off by the action', async () => {
  const root = await storage();
  const first = await boot(root);
  expect((await configure(first.worker, { origin: 'https://git-old.example.test', control: GOOD.control })).status).toBe(200);
  await first.close();

  const { worker } = await boot(root, { GIT_DIRECT_ORIGIN: GOOD.origin, GIT_DIRECT_CONTROL_ORIGIN: GOOD.control });
  expect((await capabilities(worker)).git_direct).toMatchObject({ origin: GOOD.origin, source: 'environment' });
  expect(worker.direct.listening).toBe(true);
  const other = await configure(worker, { origin: 'https://git-old.example.test', control: GOOD.control });
  expect(other).toMatchObject({ status: 400, body: { reason: expect.stringMatching(/worker environment .* wins/) } });
  expect(await configure(worker, { origin: null })).toMatchObject({ status: 400, body: { reason: expect.stringMatching(/worker environment/) } });
  // The file is never consulted or changed while the environment names the host.
  expect(await readDirectFile(root)).toEqual({ origin: 'https://git-old.example.test', control: GOOD.control });
  expect(await configure(worker, GOOD)).toMatchObject({ status: 200, body: { git_direct: { origin: GOOD.origin, source: 'environment' } } });
 });

 it('{ origin: null } turns the stored host off: git routes answer "turned off", capabilities omit it, and it stays off after a restart', async () => {
  const root = await storage();
  const first = await boot(root);
  expect((await configure(first.worker, GOOD)).status).toBe(200);
  const off = await configure(first.worker, { origin: null });
  expect(off).toMatchObject({ status: 200, body: { git_direct: null } });
  expect((await capabilities(first.worker)).git_direct).toBeUndefined();
  const refused = await plain(first.worker.direct, '/git/example-org/hello.git/info/refs?service=git-upload-pack');
  expect(refused.status).toBe(404);
  expect(refused.body).toMatch(/turned off/);
  expect(await readDirectFile(root)).toBeNull();
  await first.close();
  const again = await boot(root);
  expect((await capabilities(again.worker)).git_direct).toBeUndefined();
  expect(again.worker.direct.listening).toBe(false);
 });

 it('a dedicated single-workspace broker has no direct host and refuses the action', async () => {
  const root = await storage();
  const worker = nativeGitServer({ root, key: CONTROL_KEY, singleWorkspaceId: 'w'.repeat(32), direct: { identity: await directIdentity(root), env: {}, stored: null, listen: listenLocal } });
  await new Promise(resolve => worker.listen(0, '127.0.0.1', resolve));
  cleanups.push(() => new Promise(r => { worker.closeAllConnections(); worker.close(() => r()); }));
  expect(worker.direct).toBeNull();
  expect(await configure(worker, GOOD)).toMatchObject({ status: 404 });
 });
});

// ---- The control-plane side --------------------------------------------------------------------
const handler = gitRemote.handlers.github_git_remote_setup;
async function world({ mode = 'configure', configureFails = null } = {}) {
 const w = await makeWorld({ profile: 'full', mode: 'production', gates: [] });
 w.gh.when('GET /repos/{owner}/{repo}').reply(200, { full_name: 'example-org/hello', default_branch: 'main', permissions: { pull: true, push: true } });
 await w.db.createAccessToken({ accessToken: 'FAKE-access-token-git-direct-2', refreshToken: 'FAKE-refresh-token-git-direct-2', clientId: 'client-1', defaultAccount: 'example-org', accounts: ['example-org'], mode: 'production', profile: 'full', listing: 'compact' });
 const r = await startGitRemote(w, { direct: mode });
 cleanups.push(r.close);
 const actions = [], providerFetch = w.gh.fetch;
 w.ctx = { ...w.ctx, env: { ...r.env, GIT_DIRECT_ORIGIN: DIRECT }, fetch: async (url, init) => {
  if (!String(url).startsWith(WORKER + '/')) return providerFetch(url, init);
  const action = JSON.parse(init.body).action; actions.push(action);
  if (action === 'direct_configure' && configureFails === 'transport') throw new TypeError('connect ECONNREFUSED');
  return fetch(r.workerOrigin + new URL(url).pathname, init);
 } };
 const work = await mkdtemp(join(tmpdir(), 'git-direct-2-agent-')); cleanups.push(() => rm(work, { recursive: true, force: true }));
 return { w, r, actions, work, sh: command => run('sh', ['-c', command], { cwd: work, env: r.agentEnv }), git: (cwd, ...args) => run('git', ['-c', 'user.name=Agent', '-c', 'user.email=agent@example.test', ...args], { cwd, env: r.agentEnv }) };
}
const setup = async (t, extra = {}) => parse(await handler({ repo: 'hello', access: 'write', requestKey: 'setup-' + randomBytes(4).toString('hex'), ...extra }, t.w.ctx));

describe('GIT-DIRECT-2 setup: configures the worker from this service', () => {
 it('with only GIT_DIRECT_ORIGIN set here, the first applied setup configures the worker once, pins its key and returns the direct address; git works through it', async () => {
  const t = await world();
  expect(t.r.directOrigin).toBeNull();
  // A dry run previews only: nothing is sent to change the worker.
  const preview = await setup(t, { dryRun: true });
  expect(preview.status).not.toBe('applied');
  expect(t.actions).not.toContain('direct_configure');
  expect(t.r.worker.direct.listening).toBe(false);

  const out = await setup(t);
  expect(out).toMatchObject({ done: true, status: 'applied', result: { remote_url: `${DIRECT}/git/example-org/hello.git`, fallback_url: `${PUBLIC}/git/example-org/hello.git` } });
  expect(out.result.direct_note).toBeUndefined();
  expect(t.actions.filter(a => a === 'direct_configure')).toHaveLength(1);
  // The worker stored exactly this service's two origins and listens now.
  expect(await readDirectFile(t.r.root)).toEqual({ origin: DIRECT, control: PUBLIC });
  expect(t.r.worker.direct.listening).toBe(true);
  expect(await t.w.db.getSetting(DIRECT_WORKER_SETTING)).toMatchObject({ kind: 'git-direct-worker', origin: DIRECT, worker_key: expect.stringMatching(/^ed25519:/) });

  const ran = await t.sh(out.result.command);
  expect(ran.status, ran.stderr).toBe(0);
  const cloned = await t.git(t.work, 'clone', out.result.remote_url, 'hello');
  expect(cloned.status, cloned.stderr).toBe(0);
  const repo = join(t.work, 'hello');
  await writeFile(join(repo, 'feature.txt'), 'through the configured direct host\n');
  expect((await t.git(repo, 'add', 'feature.txt')).status).toBe(0);
  expect((await t.git(repo, 'commit', '-qm', 'feature')).status).toBe(0);
  const pushed = await t.git(repo, 'push', 'origin', 'HEAD:refs/heads/agent/configured');
  expect(pushed.status, pushed.stderr).toBe(0);
  // The direct host asked this service (at PUBLIC) for every request, signed by the pinned worker key.
  expect(t.r.api.authorize.length).toBeGreaterThanOrEqual(3);
  expect(t.r.seen.length).toBe(0);

  // Later setups find it configured: no second configure.
  const again = await setup(t);
  expect(again.result.remote_url).toBe(`${DIRECT}/git/example-org/hello.git`);
  expect(t.actions.filter(a => a === 'direct_configure')).toHaveLength(1);
 }, 120000);

 it('falls back to the MCP domain with a plain note when configuring fails', async () => {
  // The worker cannot be reached for the action.
  const a = await world({ configureFails: 'transport' });
  const out = await setup(a);
  expect(out).toMatchObject({ status: 'applied', result: { remote_url: `${PUBLIC}/git/example-org/hello.git` } });
  expect(out.result.fallback_url).toBeUndefined();
  expect(out.result.direct_note).toMatch(/could not be set up to serve the direct git host https:\/\/git\.example\.test\. Native Git worker could not be reached.*own domain for now/);
  expect(out.result.command).not.toContain('git.example.test');
  expect(await a.w.db.getSetting(DIRECT_WORKER_SETTING)).toBeNull();
  expect(a.actions.filter(x => x === 'direct_configure')).toHaveLength(1);
  // The key still works through the fallback.
  expect((await a.sh(out.result.command)).status).toBe(0);
  expect((await a.git(a.work, 'clone', '-q', out.result.remote_url, 'repo')).status).toBe(0);

  // The worker refuses: this service names its own domain as the direct host.
  const b = await world();
  b.w.ctx = { ...b.w.ctx, env: { ...b.w.ctx.env, GIT_DIRECT_ORIGIN: PUBLIC } };
  const same = await setup(b);
  expect(same.result.remote_url).toBe(`${PUBLIC}/git/example-org/hello.git`);
  expect(same.result.direct_note).toMatch(/HTTP 400: The direct git host must be a different address from the control plane/);
  expect(await readDirectFile(b.r.root)).toBeNull();

  // A worker without the action (not updated yet): nothing is sent, the note says so.
  const c = await world({ mode: false });
  const old = await setup(c);
  expect(old.result.remote_url).toBe(`${PUBLIC}/git/example-org/hello.git`);
  expect(old.result.direct_note).toMatch(/worker must be updated/);
  expect(c.actions).not.toContain('direct_configure');
 }, 120000);

 it('reconfigures a stored host that asks a different control origin; an environment-configured worker is left alone', async () => {
  const t = await world();
  const first = await setup(t);
  expect(first.result.remote_url).toBe(`${DIRECT}/git/example-org/hello.git`);
  // The worker's stored control origin no longer matches this service (as after a PUBLIC_BASE_URL change).
  await t.r.worker.directHost.configure({ origin: DIRECT, control: 'https://old-mcp.example.test' });
  expect(await readDirectFile(t.r.root)).toEqual({ origin: DIRECT, control: 'https://old-mcp.example.test' });
  const second = await setup(t);
  expect(second.result.remote_url).toBe(`${DIRECT}/git/example-org/hello.git`);
  expect(t.actions.filter(a => a === 'direct_configure')).toHaveLength(2);
  expect(await readDirectFile(t.r.root)).toEqual({ origin: DIRECT, control: PUBLIC });
  // A worker whose environment names the host (GIT-DIRECT-1) is used as it is; nothing is sent.
  const env = await world({ mode: true });
  const fromEnv = await setup(env);
  expect(fromEnv.result.remote_url).toBe(`${DIRECT}/git/example-org/hello.git`);
  expect(env.actions).not.toContain('direct_configure');
 }, 120000);
});

// The nine write-contract checks still pass through every door with the control-plane-configured host.
const definition = { tool: gitRemote.tools[0], handler };
const arrange = (gh, outcome) => { gh.gitRemoteOutcome = outcome; gh.when('GET /repos/{owner}/{repo}').reply(200, { full_name: 'example-org/hello', default_branch: 'main', permissions: { pull: true, push: true } }); };
async function prepare(w) {
 await w.db.createAccessToken({ accessToken: 'FAKE-access-token-contract-2', refreshToken: 'FAKE-refresh-token-contract-2', clientId: 'client-1', defaultAccount: 'example-org', accounts: ['example-org'], mode: 'production', profile: 'full', listing: 'compact' });
 const r = await startGitRemote(w, { direct: 'configure' }); cleanups.push(r.close);
 const providerFetch = w.gh.fetch;
 w.ctx = { ...w.ctx, env: { ...r.env, GIT_DIRECT_ORIGIN: DIRECT }, fetch: async (url, init) => String(url).startsWith(WORKER + '/') ? fetch(r.workerOrigin + new URL(url).pathname, init) : providerFetch(url, init) };
 w.gh.fetch = w.ctx.fetch; w.remote = r;
 if (w.gh.gitRemoteOutcome === 'mismatch') { const get = w.db.getGitRemoteKey; w.db.getGitRemoteKey = async id => { const row = await get(id); return row && { ...row, access: row.access === 'write' ? 'read' : 'write' }; }; }
}
runWriteContract({ label: 'github_git_remote_setup (GIT-DIRECT-2 configured host)', definition, args: { repo: 'hello', access: 'write' }, arrange, needsConfirm: true, profile: 'full', expectedWrites: 0, prepare });

it('every door configures the worker and returns the direct address', async () => {
 for (const door of doorsFor(definition)) {
  const w = await makeWorld({ profile: 'full', mode: 'production', gates: [] }); arrange(w.gh, 'ok'); await prepare(w);
  const out = parse(await door.call(w, { repo: 'hello', access: 'write', requestKey: 'door-' + door.name }));
  expect(out, door.name).toMatchObject({ status: 'applied', result: { remote_url: `${DIRECT}/git/example-org/hello.git`, fallback_url: `${PUBLIC}/git/example-org/hello.git` } });
  expect(w.remote.worker.direct.listening, door.name).toBe(true);
 }
}, 120000);
