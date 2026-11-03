// GIT-REMOTE-1: the git remote is never an open proxy. Routing Middleware checks the key before any
// forwarding, forwards only to the configured worker with an allowlist of Git headers plus a signed
// claim (never the key), and the worker and the broker each accept only an exact, current claim.
import { afterEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { makeWorld } from '../../test/helpers/write-contract.js';
import { startGitRemote, WORKER, WORKER_KEY } from '../../test/helpers/git-remote-world.js';
import { handleGitRemote, parseGitRequest, REMOTE_FORWARDED_HEADERS } from '../../src/git-remote/edge.js';
import { config } from '../../middleware.js';
import { verifyRemoteClaim, REMOTE_PURPOSE } from '../../src/native-git/protocol.js';
import { signGitRemoteClaim } from '../../src/native-git/signing.js';
import { indexKey, newSessionKey, sha256, parseSecret, KEY_PREFIX, CODE_PREFIX, newExchangeCode, checkKey } from '../../src/git-remote/keys.js';

const cleanups = [];
afterEach(async () => { for (const c of cleanups.splice(0).reverse()) await c(); });
const ENV = { TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'), PUBLIC_BASE_URL: 'https://mcp.example.test', NATIVE_GIT_WORKER_URL: WORKER + '/', NATIVE_GIT_WORKER_KEY: WORKER_KEY, VERCEL_ENV: 'production' };

async function keyWorld({ access = 'write', profile = 'full' } = {}) {
 const w = await makeWorld({ profile: 'full', mode: 'production' });
 await w.db.createAccessToken({ accessToken: 'FAKE-access-edge', refreshToken: 'FAKE-refresh-edge', clientId: 'client-1', defaultAccount: 'example-org', accounts: ['example-org'], mode: 'production', profile, listing: 'compact' });
 const { id, code } = newExchangeCode(), key = newSessionKey(id);
 await w.db.setSetting(indexKey(id), { kind: 'git-remote-index', id, scope: { legacy: true } });
 await w.db.createGitRemoteKey({ id, connection: 'client-1', owner: 'example-org', repo: 'hello', access, codeHash: sha256(code), codeExpiresAt: new Date(w.ctx.now() + 600000), expiresAt: new Date(w.ctx.now() + 8 * 3600000) });
 await w.db.exchangeGitRemoteCode({ id, codeHash: sha256(code), keyHash: sha256(key) });
 const openScope = async kid => ((await w.db.getSetting(indexKey(kid)))?.id === kid ? { db: w.db, env: ENV, scope: { legacy: true } } : null);
 const ask = (path, { method = 'GET', headers = {}, password = key, env = ENV } = {}) => handleGitRemote(new Request('https://mcp.example.test' + path, { method, headers: { ...(password ? { authorization: 'Basic ' + Buffer.from('x-robinson-git:' + password).toString('base64') } : {}), ...headers } }), env, { now: w.ctx.now, openScope });
 return { w, id, key, ask };
}
const forwarded = answer => Object.fromEntries((answer.headers.get('x-middleware-override-headers') ?? '').split(',').filter(Boolean).map(n => [n, answer.headers.get('x-middleware-request-' + n)]));

describe('Routing Middleware', () => {
 it('is registered for /git/ and checks only the fixed smart-HTTP shapes', () => {
  expect(config.matcher).toEqual(['/v1/transfer/:path*', '/git/:path*']);
  const u = p => new URL('https://mcp.example.test' + p);
  expect(parseGitRequest('GET', u('/git/example-org/hello.git/info/refs?service=git-upload-pack'))).toMatchObject({ owner: 'example-org', repo: 'hello', service: 'git-upload-pack', step: 'refs' });
  expect(parseGitRequest('POST', u('/git/example-org/hello/git-receive-pack'))).toMatchObject({ repo: 'hello', service: 'git-receive-pack', step: 'pack' });
  for (const [m, p] of [['GET', '/git/example-org/hello.git/info/refs'], ['GET', '/git/example-org/hello.git/HEAD'], ['GET', '/git/example-org/hello.git/objects/info/packs'],
   ['POST', '/git/example-org/hello.git/info/refs?service=git-upload-pack'], ['GET', '/git/example-org/hello.git/git-upload-pack'], ['POST', '/git/example-org/hello.git/git-upload-pack?x=1'],
   ['GET', '/git/../hello.git/info/refs?service=git-upload-pack'], ['GET', '/git/example-org/hello.git/info/refs?service=git-upload-pack&x=https://evil.example']])
   expect(parseGitRequest(m, u(p)).refuse, `${m} ${p}`).toBeInstanceOf(Response);
 });

 it('forwards a valid request only to the configured worker: no key, no cookie, no Authorization, only Git headers and a signed claim', async () => {
  const t = await keyWorld();
  const answer = await t.ask('/git/example-org/hello.git/git-receive-pack', { method: 'POST', headers: { cookie: 'a=b', 'proxy-authorization': 'Basic x', 'x-robinson-signature': 'forged', 'x-forwarded-host': 'evil.example', 'content-type': 'application/x-git-receive-pack-request', 'content-length': '10', 'git-protocol': 'version=2' } });
  expect(answer.headers.get('x-middleware-rewrite')).toBe(WORKER + '/v1/remote/git-receive-pack');
  const headers = forwarded(answer);
  expect(Object.keys(headers).sort()).toEqual(['content-length', 'content-type', 'git-protocol', 'x-robinson-git-claim']);
  expect(Object.keys(headers).every(n => n === 'x-robinson-git-claim' || REMOTE_FORWARDED_HEADERS.includes(n))).toBe(true);
  expect(JSON.stringify([...answer.headers])).not.toContain(t.key);
  const claim = verifyRemoteClaim(headers['x-robinson-git-claim'], WORKER_KEY, t.w.ctx.now());
  expect(Object.keys(claim).sort()).toEqual(['access', 'control', 'expiresAt', 'key', 'mirror', 'nonce', 'owner', 'purpose', 'repo', 'service', 'step', 'version']);
  expect(claim).toMatchObject({ purpose: REMOTE_PURPOSE, key: t.id, owner: 'example-org', repo: 'hello', service: 'git-receive-pack', step: 'pack', access: 'write', control: 'https://mcp.example.test' });
  expect(JSON.stringify(claim)).not.toMatch(/rgk_|password|credential/);
  // No configured worker: nothing is forwarded anywhere.
  const off = await t.ask('/git/example-org/hello.git/info/refs?service=git-upload-pack', { env: { ...ENV, NATIVE_GIT_WORKER_URL: undefined } });
  expect(off.status).toBe(503); expect(off.headers.get('x-middleware-rewrite')).toBeNull();
 });

 it('refuses before forwarding: no key (401 challenge), unknown, tampered, other repository, read-only push, ended connection, read-only connection', async () => {
  const t = await keyWorld({ access: 'read' });
  const cases = [
   [await t.ask('/git/example-org/hello.git/info/refs?service=git-upload-pack', { password: null }), 401, /Sign-in needed/],
   [await t.ask('/git/example-org/hello.git/info/refs?service=git-upload-pack', { password: newSessionKey(randomBytes(16).toString('hex')) }), 401, /not valid/],
   [await t.ask('/git/example-org/hello.git/info/refs?service=git-upload-pack', { password: t.key.slice(0, -1) + (t.key.endsWith('A') ? 'B' : 'A') }), 401, /not valid/],
   [await t.ask('/git/example-org/other.git/info/refs?service=git-upload-pack'), 403, /for example-org\/hello only/],
   [await t.ask('/git/example-org/hello.git/info/refs?service=git-receive-pack'), 403, /read-only, so git push is refused/]];
  for (const [answer, status, text] of cases) {
   expect(answer.status).toBe(status); expect(await answer.text()).toMatch(text); expect(answer.headers.get('x-middleware-rewrite')).toBeNull();
   if (status === 401) expect(answer.headers.get('www-authenticate')).toBe('Basic realm="GitHub Unleashed git", charset="UTF-8"');
  }
  await t.w.db.revokeConnection('client-1');
  const ended = await t.ask('/git/example-org/hello.git/info/refs?service=git-upload-pack');
  expect(ended.status).toBe(401); expect(await ended.text()).toMatch(/connection this git session key belongs to was disconnected/);
  const r = await keyWorld({ profile: 'read_only' });
  const ro = await r.ask('/git/example-org/hello.git/info/refs?service=git-receive-pack');
  expect(ro.status).toBe(403); expect(await ro.text()).toMatch(/Your connection is read-only now/);
  expect((await r.ask('/git/example-org/hello.git/info/refs?service=git-upload-pack')).headers.get('x-middleware-rewrite')).toBe(WORKER + '/v1/remote/info/refs?service=git-upload-pack');
 });

 it('keys and codes are 256-bit, well-formed only, and compared by hash', () => {
  const { id, code } = newExchangeCode(), key = newSessionKey(id);
  expect(code).toMatch(new RegExp(`^${CODE_PREFIX}${id}_[A-Za-z0-9_-]{43}$`)); expect(key).toMatch(new RegExp(`^${KEY_PREFIX}${id}_[A-Za-z0-9_-]{43}$`));
  expect(parseSecret(key, KEY_PREFIX)).toEqual({ id, hash: sha256(key) });
  expect(parseSecret(code, KEY_PREFIX)).toBeNull(); expect(parseSecret(key + 'x', KEY_PREFIX)).toBeNull(); expect(parseSecret(null, KEY_PREFIX)).toBeNull();
  const row = { key_hash: sha256(key), owner: 'o', repo: 'r', access: 'write', expires_at: new Date(Date.now() + 1000), revoked_at: null };
  expect(checkKey(row, sha256(key), { service: 'git-receive-pack', owner: 'O', repo: 'R' })).toEqual({ ok: true });
  expect(checkKey({ ...row, key_hash: null }, sha256(key), { service: 'git-upload-pack', owner: 'o', repo: 'r' }).reason).toBe('invalid');
 });
});

describe('the worker and the broker accept only an exact, current claim', () => {
 it('worker: missing, forged, expired and mismatched claims are refused; a refs claim never serves a pack', async () => {
  const w = await makeWorld({ profile: 'full', mode: 'production' });
  const r = await startGitRemote(w); cleanups.push(r.close);
  const claim = (extra = {}) => { const body = JSON.stringify({ purpose: REMOTE_PURPOSE, version: 1, key: 'a'.repeat(32), mirror: 'b'.repeat(64), owner: 'example-org', repo: 'hello', service: 'git-upload-pack', step: 'refs', access: 'read', control: 'https://mcp.example.test', expiresAt: w.ctx.now() + 60000, nonce: 'c'.repeat(32), ...extra }); return `${Buffer.from(body).toString('base64url')}.${signGitRemoteClaim(body, r.env)}`; };
  const hit = (path, token, method = 'GET', headers = {}) => fetch(r.workerOrigin + path, { method, headers: { ...(token ? { 'x-robinson-git-claim': token } : {}), ...headers } });
  expect((await hit('/v1/remote/info/refs?service=git-upload-pack')).status).toBe(403);
  const [enc, sig] = claim().split('.');
  expect(await (await hit('/v1/remote/info/refs?service=git-upload-pack', `${enc}.${sig.slice(0, -2)}AA`)).text()).toMatch(/not issued by this service/);
  expect(await (await hit('/v1/remote/info/refs?service=git-upload-pack', claim({ expiresAt: w.ctx.now() - 1 }))).text()).toMatch(/took too long/);
  expect(await (await hit('/v1/remote/info/refs?service=git-receive-pack', claim())).text()).toMatch(/does not match/);
  expect(await (await hit('/v1/remote/git-upload-pack', claim(), 'POST', { 'content-type': 'application/x-git-upload-pack-request' })).text()).toMatch(/does not match/);
  expect((await hit('/v1/remote/git-receive-pack', claim({ service: 'git-receive-pack', step: 'pack', access: 'read' }), 'POST')).status).toBe(403);
  expect((await hit('/v1/remote/objects/info/packs', claim())).status).toBe(404);
  // A claim the broker no longer honours (unknown key) comes back as the broker's refusal, not a credential.
  const refused = await hit('/v1/remote/info/refs?service=git-upload-pack', claim());
  expect(refused.status).toBe(403); expect(await refused.text()).toMatch(/no longer valid/);
 });

 it('broker: an invalid claim is 401, each step of a claim works once, and a fetch claim cannot push', async () => {
  const w = await makeWorld({ profile: 'full', mode: 'production' });
  w.gh.when('GET /repos/{owner}/{repo}').reply(200, { full_name: 'example-org/hello', default_branch: 'main', permissions: { push: true } });
  await w.db.createAccessToken({ accessToken: 'FAKE-access-broker', refreshToken: 'FAKE-refresh-broker', clientId: 'client-1', defaultAccount: 'example-org', accounts: ['example-org'], mode: 'production', profile: 'full', listing: 'compact' });
  const r = await startGitRemote(w); cleanups.push(r.close);
  const { id, code } = newExchangeCode(), key = newSessionKey(id);
  await w.db.setSetting(indexKey(id), { kind: 'git-remote-index', id, scope: { legacy: true } });
  await w.db.createGitRemoteKey({ id, connection: 'client-1', owner: 'example-org', repo: 'hello', access: 'write', codeHash: sha256(code), codeExpiresAt: new Date(w.ctx.now() + 600000), expiresAt: new Date(w.ctx.now() + 3600000) });
  await w.db.exchangeGitRemoteCode({ id, codeHash: sha256(code), keyHash: sha256(key) });
  const claim = (extra = {}) => { const body = JSON.stringify({ purpose: REMOTE_PURPOSE, version: 1, key: id, mirror: 'b'.repeat(64), owner: 'example-org', repo: 'hello', service: 'git-upload-pack', step: 'refs', access: 'write', control: 'https://mcp.example.test', expiresAt: w.ctx.now() + 60000, nonce: randomBytes(16).toString('hex'), ...extra }); return `${Buffer.from(body).toString('base64url')}.${signGitRemoteClaim(body, r.env)}`; };
  const post = async (token, body, op = 'broker') => { const res = await fetch(`${r.functionsOrigin}/api/git-remote?op=${op}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { 'x-robinson-git-claim': token } : {}) }, body: JSON.stringify(body) }); return { status: res.status, data: await res.json() }; };
  expect((await post(null, { phase: 'fetch' })).status).toBe(401);
  expect((await post(claim({ expiresAt: w.ctx.now() - 1 }), { phase: 'fetch' })).status).toBe(401);
  const once = claim();
  const first = await post(once, { phase: 'fetch' });
  expect(first.data).toMatchObject({ allow: true, credential: 'github_pat_FAKE0123456789abcdefghij', default_branch: 'main' });
  expect((await post(once, { phase: 'fetch' })).status).toBe(409);
  expect((await post(claim(), { phase: 'push', updates: [{ old: '0'.repeat(40), new: 'a'.repeat(40), ref: 'refs/heads/x' }] })).status).toBe(400);
  const push = claim({ service: 'git-receive-pack', step: 'pack' });
  expect((await post(push, { phase: 'push', updates: [{ old: '0'.repeat(40), new: 'a'.repeat(40), ref: 'refs/notes/x' }] })).data).toMatchObject({ allow: false, message: expect.stringMatching(/Only branches/) });
  // A report needs the journal row this very claim opened.
  expect((await post(push, { journal: 1, outcome: 'applied' }, 'report')).status).toBe(409);
 });
});

import { setupCommand as gitRemoteSetupCommand, PUSH_NOTE as gitRemotePushNote } from '../../src/tools/git-remote.js';
it('the setup command makes git declare push sizes for this address only (hosting proxy refuses chunked bodies over ~4 MB)', () => {
  const cmd = gitRemoteSetupCommand('https://mcp.example.test', 'rgc_FAKE', 'https://mcp.example.test/git/o/r.git');
  expect(cmd).toContain('git config --global http.https://mcp.example.test.postBuffer 209715200');
  expect(cmd).not.toMatch(/--global http\.postBuffer/);
  expect(gitRemotePushNote).toMatch(/about 25 MB/);
});
