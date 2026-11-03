// PUSH-EXIT-1 (owner direction 2026-11-03): the direct git host is a replaceable "push exit" — one configured pool host
// (GIT_DIRECT_HOST, unset = the primary) serving one configured origin (GIT_DIRECT_ORIGIN). Here the primary is the
// owner's PC (owner-only) and the push exit is the shared "previous" host (Dokploy's role): real worker, real git, real
// control-plane handlers, fake GitHub. Every value is fake.
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeWorld, parse } from '../../test/helpers/write-contract.js';
import { startGitRemote, run, gitIn, WORKER, DIRECT } from '../../test/helpers/git-remote-world.js';
import * as gitRemote from '../../src/tools/git-remote.js';
import { configuredHosts, directHostOf, hostId } from '../../src/native-git/pool-config.js';
import { serverStatus } from '../../src/tools/server-status.js';
import { DIRECT_WORKER_SETTING } from '../../src/git-remote/api.js';
import { POOL_SETTING } from '../../src/native-git/pool.js';

const handler = gitRemote.handlers.github_git_remote_setup;
const PC = 'https://pc-worker.example.test';
const cleanups = [];
afterEach(async () => { for (const c of cleanups.splice(0).reverse()) await c(); });

/** owner: the service owner's own connector (operator mark); otherwise a person. `exit` = GIT_DIRECT_HOST. */
async function world({ owner = true, exit = 'previous', pcReachable = false } = {}) {
 const w = await makeWorld({ profile: 'full', mode: 'production', gates: [], operator: owner });
 w.gh.when('GET /repos/{owner}/{repo}').reply(200, { full_name: 'example-org/hello', default_branch: 'main', permissions: { pull: true, push: true } });
 await w.db.createAccessToken({ accessToken: 'FAKE-access-token-push-exit', refreshToken: 'FAKE-refresh-token-push-exit', clientId: 'client-1', defaultAccount: 'example-org', accounts: ['example-org'], mode: 'production', profile: 'full', listing: 'compact' });
 const r = await startGitRemote(w, { direct: true });
 cleanups.push(r.close);
 // The PC is the primary (owner-only); the worker in this world is the previous host, and the push exit.
 Object.assign(r.env, { NATIVE_GIT_WORKER_URL: PC + '/', NATIVE_GIT_PREVIOUS_WORKER_URL: WORKER + '/', NATIVE_GIT_WORKER_CUTOVER_AT: '2026-11-03T00:00:00Z', ...(exit === undefined ? {} : { GIT_DIRECT_HOST: exit }) });
 const pcRequests = [];
 const providerFetch = w.gh.fetch;
 const fetchImpl = async (url, init) => {
  const text = String(url);
  if (text.startsWith(PC + '/')) { pcRequests.push(JSON.parse(init.body).action); if (!pcReachable) throw new TypeError('fetch failed'); return fetch(r.workerOrigin + new URL(url).pathname, init); }
  if (text.startsWith(WORKER + '/')) return fetch(r.workerOrigin + new URL(url).pathname, init);
  if (text === DIRECT + '/health') return fetch(r.directOrigin + '/health', init);
  return providerFetch(url, init);
 };
 w.ctx = { ...w.ctx, env: r.env, fetch: fetchImpl };
 if (!owner) { const connection = Object.freeze({ ...w.ctx.connection, operator: undefined }); w.ctx = { ...w.ctx, connection }; w.connection = connection; }
 const work = await mkdtemp(join(tmpdir(), 'push-exit-agent-')); cleanups.push(() => rm(work, { recursive: true, force: true }));
 const sh = command => run('sh', ['-c', command], { cwd: work, env: r.agentEnv });
 const git = (cwd, ...args) => run('git', ['-c', 'user.name=Agent', '-c', 'user.email=agent@example.test', ...args], { cwd, env: r.agentEnv });
 return { w, r, work, sh, git, pcRequests };
}
async function setup(t) {
 const out = parse(await handler({ repo: 'hello', access: 'write', requestKey: 'setup-' + randomBytes(4).toString('hex') }, t.w.ctx));
 expect(out, JSON.stringify(out)).toMatchObject({ done: true, status: 'applied', confirmed: true });
 return out.result;
}
const keyHost = async (t, id) => (await t.w.db.getSetting('git_remote.' + id))?.host;
function directGet(t, path, headers = {}) {
 return new Promise((resolve, reject) => {
  const req = httpRequest(t.r.directOrigin + path, { headers: { host: 'git.example.test', ...headers } }, res => { let body = ''; res.on('data', c => { body += c; }); res.on('end', () => resolve({ status: res.statusCode, body })); });
  req.on('error', reject); req.end();
 });
}

describe('which host is the push exit', () => {
 const env = { NATIVE_GIT_WORKER_URL: PC + '/', NATIVE_GIT_PREVIOUS_WORKER_URL: WORKER + '/', NATIVE_GIT_WORKER_POOL: JSON.stringify([{ name: 'dokploy', origin: WORKER }]) };
 const exitOf = extra => directHostOf({ ...env, ...extra })?.origin ?? null;
 it('unset = the primary (GIT-DIRECT-1/-2 behaviour); a host name or a role picks that host; anything else is no exit at all', () => {
  expect(exitOf({})).toBe(PC);
  expect(exitOf({ GIT_DIRECT_HOST: '' })).toBe(PC);
  expect(exitOf({ GIT_DIRECT_HOST: 'dokploy' })).toBe(WORKER);
  expect(exitOf({ GIT_DIRECT_HOST: 'previous' })).toBe(WORKER); // by role, whatever the host is named
  expect(exitOf({ GIT_DIRECT_HOST: 'primary' })).toBe(PC);
  expect(exitOf({ GIT_DIRECT_HOST: 'workshop' })).toBeNull();
  expect(exitOf({ GIT_DIRECT_HOST: 'Not A Name!' })).toBeNull();
  expect(directHostOf({})).toBeNull();
  // The exit is read from protected configuration only, and audiences are unchanged by it.
  expect(configuredHosts({ ...env, GIT_DIRECT_HOST: 'dokploy' }).map(h => [h.name, h.audience])).toEqual([['primary', 'owner'], ['dokploy', 'shared']]);
 });
});

describe('git through the push exit', () => {
 it('the owner\'s key is placed on the push exit (not the PC); clone and a real push go through it with every rail', async () => {
  const t = await world({ owner: true });
  const result = await setup(t);
  expect(result).toMatchObject({ remote_url: `${DIRECT}/git/example-org/hello.git`, fallback_url: 'https://mcp.example.test/git/example-org/hello.git', push_exit: 'previous (git.example.test)' });
  expect(result.push_note).toMatch(/stream to the worker/);
  expect(result.if_blocked).toMatch(/git\.example\.test/);
  expect(await keyHost(t, result.key_id)).toBe(hostId(WORKER));
  expect(await t.w.db.getSetting(DIRECT_WORKER_SETTING)).toMatchObject({ origin: DIRECT, worker_key: expect.stringMatching(/^ed25519:/) });
  // The owner's workspaces are still placed on the PC first; only the git remote key went to the exit.
  expect(t.pcRequests).toEqual([]);
  const ran = await t.sh(result.command); expect(ran.status, ran.stderr).toBe(0);
  const cloned = await t.git(t.work, 'clone', result.remote_url, 'hello'); expect(cloned.status, cloned.stderr).toBe(0);
  const repo = join(t.work, 'hello');
  await writeFile(join(repo, 'big.txt'), randomBytes(3 * 1024 * 1024).toString('base64'));
  expect((await t.git(repo, 'add', 'big.txt')).status).toBe(0);
  expect((await t.git(repo, 'commit', '-qm', 'through the exit')).status).toBe(0);
  const pushed = await t.git(repo, 'push', 'origin', 'HEAD:refs/heads/agent/exit');
  expect(pushed.status, pushed.stderr).toBe(0);
  expect(pushed.stderr).toMatch(/remote: Pushed to GitHub example-org\/hello: created branch agent\/exit\./);
  expect(t.r.github.log('rev-parse', 'refs/heads/agent/exit')).toBe(gitIn(repo, 'rev-parse', 'HEAD'));
  // Per-request authorization through the control plane, signed by the pinned worker key; change log confirmed.
  expect(t.r.api.authorize.length).toBeGreaterThanOrEqual(4);
  const rows = []; for (let id = 1; id < 60; id++) { const c = await t.w.db.getChange(id); if (c?.tool === 'github_git_remote_push') rows.push(c); }
  expect(rows.map(c => [c.confirmed, c.after.remote_verified])).toEqual([[true, true]]);
  expect(t.r.seen).toEqual([]); // nothing went through the MCP domain's Routing Middleware
  expect(t.pcRequests).toEqual([]);
 }, 120000);

 it('a person\'s key is placed on the shared push exit and gets the direct address; the owner\'s PC is never asked', async () => {
  const t = await world({ owner: false });
  const result = await setup(t);
  expect(result).toMatchObject({ remote_url: `${DIRECT}/git/example-org/hello.git`, push_exit: 'previous (git.example.test)' });
  expect(await keyHost(t, result.key_id)).toBe(hostId(WORKER));
  const ran = await t.sh(result.command); expect(ran.status, ran.stderr).toBe(0);
  const cloned = await t.git(t.work, 'clone', '-q', result.remote_url, 'hello'); expect(cloned.status, cloned.stderr).toBe(0);
  expect(t.pcRequests).toEqual([]);
  expect(JSON.stringify(result)).not.toMatch(/pc-worker/);
 }, 60000);

 it('a scanner refusal through the push exit stays a refusal (content protection is unchanged)', async () => {
  const t = await world({ owner: true });
  const result = await setup(t);
  expect((await t.sh(result.command)).status).toBe(0);
  expect((await t.git(t.work, 'clone', '-q', result.remote_url, 'hello')).status).toBe(0);
  const repo = join(t.work, 'hello');
  // A credential-shaped value built at run time (fake) in a non-fixture file.
  await writeFile(join(repo, 'settings.env'), `TOKEN=${['ghp', 'R9xT2mQ8vL4kP7nW3jH6sD1fG5aZ0cB8eY2u'].join('_')}\n`);
  expect((await t.git(repo, 'add', 'settings.env')).status).toBe(0);
  expect((await t.git(repo, 'commit', '-qm', 'oops')).status).toBe(0);
  const pushed = await t.git(repo, 'push', 'origin', 'HEAD:refs/heads/agent/leak');
  expect(pushed.status).not.toBe(0);
  expect(pushed.stderr).toMatch(/remote rejected/);
  expect(() => t.r.github.log('rev-parse', '--verify', '-q', 'refs/heads/agent/leak')).toThrow();
 }, 60000);
});

describe('when the push exit cannot take the key', () => {
 it('the owner falls back to ordinary placement on this service\'s domain with a plain note naming the exit', async () => {
  const t = await world({ owner: true, pcReachable: true });
  expect((await setup(t)).push_exit).toBe('previous (git.example.test)'); // pins the exit's key
  await t.w.db.setSetting(POOL_SETTING, { hosts: { previous: { enabled: false } } });
  const result = await setup(t);
  expect(result.remote_url).toBe('https://mcp.example.test/git/example-org/hello.git');
  expect(result.fallback_url).toBeUndefined();
  expect(result.push_exit).toBeUndefined();
  expect(result.direct_note).toMatch(/The push exit \(previous\) is not taking new work just now, so this key uses the primary host through this service's own domain/);
  expect(await keyHost(t, result.key_id)).toBe(hostId(PC));
  // A key whose mirror is on another host is never served by the push exit (refused before anything is served).
  expect((await t.sh(result.command)).status).toBe(0);
  const stored = await readFile(join(t.r.home, '.git-credentials-robinson'), 'utf8');
  const key = /:(rgk_[^@]+)@mcp\.example\.test/.exec(stored)[1];
  const answer = await directGet(t, '/git/example-org/hello.git/info/refs?service=git-upload-pack', { authorization: 'Basic ' + Buffer.from('x-robinson-git:' + key).toString('base64') });
  expect(answer.status).toBe(403);
  expect(answer.body).toMatch(/belongs to another worker host/);
 }, 60000);

 it('a GIT_DIRECT_HOST that names no configured host means no direct host at all: setup uses this domain, authorize refuses, status says why', async () => {
  const t = await world({ owner: true, exit: 'workshop', pcReachable: true });
  const result = await setup(t);
  expect(result.remote_url).toBe('https://mcp.example.test/git/example-org/hello.git');
  expect(result.fallback_url).toBeUndefined();
  const health = await directGet(t, '/health'); expect(health.status).toBe(200);
  const status = await serverStatus({ fields: ['health'] }, t.w.ctx, { budgetMs: 5000 });
  expect(status.health.direct_git).toMatchObject({ status: 'down', reason: expect.stringMatching(/GIT_DIRECT_HOST names no configured worker host/) });
  expect((await t.sh(result.command)).status).toBe(0);
  const key = /:(rgk_[^@]+)@mcp\.example\.test/.exec(await readFile(join(t.r.home, '.git-credentials-robinson'), 'utf8'))[1];
  const answer = await directGet(t, '/git/example-org/hello.git/info/refs?service=git-upload-pack', { authorization: 'Basic ' + Buffer.from('x-robinson-git:' + key).toString('base64') });
  expect(answer.status).toBe(503);
  expect(answer.body).toMatch(/not set up on the service yet/);
 }, 60000);
});

describe('github_server_status names the push exit', () => {
 it('the owner and a person both see which host is the shared push exit (by name, never its address)', async () => {
  for (const owner of [true, false]) {
   const t = await world({ owner });
   const status = await serverStatus({ fields: ['health'] }, t.w.ctx, { budgetMs: 5000 });
   expect(status.health.direct_git).toMatchObject({ status: expect.stringMatching(/^(ok|degraded)$/), exit: 'previous' });
   expect(JSON.stringify(status.health.direct_git)).not.toMatch(/example\.test/);
  }
 }, 60000);
});

describe('the Dokploy front door (compose.yaml + push-exit.Caddyfile)', () => {
 const compose = readFileSync(new URL('../../workers/native-git/compose.yaml', import.meta.url), 'utf8');
 const caddy = readFileSync(new URL('../../workers/native-git/push-exit.Caddyfile', import.meta.url), 'utf8');
 const service = compose.slice(compose.indexOf('\n  push-exit:'), compose.indexOf('\nvolumes:'));
 it('Traefik routes the push-exit name by SNI with TLS passthrough and PROXY protocol v2 (no 60 s HTTP cut); one host name setting', () => {
  expect(service).toContain('traefik.tcp.routers.robinson-push-exit.rule=HostSNI(`${GIT_PUSH_EXIT_HOST:-git.robinsonaisystems.com}`)');
  expect(service).toContain('traefik.tcp.routers.robinson-push-exit.entrypoints=websecure');
  expect(service).toContain('traefik.tcp.routers.robinson-push-exit.tls.passthrough=true');
  expect(service).toContain('traefik.tcp.services.robinson-push-exit.loadbalancer.proxyprotocol.version=2');
  expect(service).toContain('traefik.tcp.services.robinson-push-exit.loadbalancer.server.port=8443');
  expect(service).not.toMatch(/traefik\.http\./); // never an HTTP router (that is where the 60 s cut lives)
  expect(service).toContain('GIT_PUSH_EXIT_HOST: ${GIT_PUSH_EXIT_HOST:-git.robinsonaisystems.com}');
 });
 it('the front door runs locked down, with a pinned image and its certificate on its own volume', () => {
  expect(service).toMatch(/image: caddy:\d+\.\d+\.\d+-alpine/);
  for (const line of ['read_only: true', 'cap_drop: [ALL]', 'cap_add: [NET_BIND_SERVICE]', 'security_opt: [no-new-privileges:true]', './push-exit.Caddyfile:/etc/caddy/Caddyfile:ro', 'push-exit-data:/data']) expect(service).toContain(line);
  expect(service).not.toMatch(/ports:/); // reachable only through Traefik on the Docker network
 });
 it('Caddy trusts the PROXY header only from private peers, gets its certificate by TLS-ALPN-01, and passes only the direct git paths', () => {
  expect(caddy.indexOf('proxy_protocol {')).toBeLessThan(caddy.indexOf('\t\t\ttls\n'));
  expect(caddy).toMatch(/allow 10\.0\.0\.0\/8 172\.16\.0\.0\/12 192\.168\.0\.0\/16\n/);
  expect(caddy).toContain('disable_http_challenge');
  expect(caddy).toContain('alt_tlsalpn_port 8443');
  expect(caddy).toContain('{$GIT_PUSH_EXIT_HOST}:8443 {');
  expect(caddy).toContain('@git path /git/* /health');
  expect(caddy).toContain('reverse_proxy native-git:3001 {');
  expect(caddy).toContain('flush_interval -1');
  expect(caddy).toContain('admin off');
  expect(caddy).not.toMatch(/trusted_proxies/); // a client's own X-Forwarded-For is replaced by the real address
 });
});
