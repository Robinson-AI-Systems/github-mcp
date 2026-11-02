// SINGLE-DOMAIN-1: the one-domain transfer relay (src/native-git/relay.js + middleware.js) is not an
// open proxy: destination from configuration or an HMAC-bound broker route only, capability verified
// exactly like the worker does, an allowlist of headers, and clients told never to follow redirects.
import { afterEach, describe, it, expect } from 'vitest';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planTransferRelay, transferUrl, routeFor, relayOrigin, blockedNote, fitDigest, FORWARDED_HEADERS } from '../../src/native-git/relay.js';
import { handleTransfer, rewriteResponse } from '../../middleware.js';
import { signNativeDownloadClaim, signNativeUploadClaim } from '../../src/native-git/signing.js';
import { signWorkerBody, DOWNLOAD_PURPOSE, UPLOAD_PURPOSE } from '../../src/native-git/protocol.js';
import { startTransferRelay } from '../../test/helpers/transfer-relay.js';

const HMAC = 'FAKE-relay-test-shared-worker-key-0123456789';
const NOW = 1_800_000_000_000;
const BROKER = 'https://ras-pg-' + 'a'.repeat(32) + '-203-0-113-10.sslip.io';
const ENV = { TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'), PUBLIC_BASE_URL: 'https://mcp.example.test', NATIVE_GIT_WORKER_URL: 'https://worker.example.test/', PLAYGROUND_INGRESS_IPV4: '203.0.113.10' };
const fields = (extra = {}) => ({ version: 1, workspace_id: 'git_' + 'b'.repeat(32), binding: 'c'.repeat(64), mode: 'git', maxBytes: 1048576, expiresAt: NOW + 600000, nonce: 'd'.repeat(32), ...extra });
const download = (env = ENV, extra = {}) => { const claim = JSON.stringify({ purpose: DOWNLOAD_PURPOSE, ...fields(extra), downloadId: 'e'.repeat(32) }); return `${Buffer.from(claim).toString('base64url')}.${signNativeDownloadClaim(claim, env)}`; };
const upload = (env = ENV) => { const claim = JSON.stringify({ purpose: UPLOAD_PURPOSE, ...fields(), uploadId: 'f'.repeat(32) }); return `${Buffer.from(claim).toString('base64url')}.${signNativeUploadClaim(claim, env)}`; };
const plan = (url, { method = 'GET', headers = {}, env = ENV, now = NOW } = {}) => planTransferRelay({ method, url, headers }, env, now);
const cleanups = [];
afterEach(async () => { for (const c of cleanups.splice(0)) await c(); });

describe('addresses', () => {
 it('issues on PUBLIC_BASE_URL with a route naming only the configured worker or a configured-ingress broker; off switch and missing origin fall back', () => {
  const cap = download(), url = transferUrl(ENV, { kind: 'd', destinationOrigin: 'https://worker.example.test', capability: cap });
  expect(url).toMatch(new RegExp(`^https://mcp\\.example\\.test/v1/transfer/d/w/[A-Za-z0-9_-]{32}/${cap.replace('.', '\\.')}$`));
  expect(routeFor(ENV, BROKER)).toBe('b.' + new URL(BROKER).hostname);
  expect(routeFor(ENV, 'https://ras-pg-' + 'a'.repeat(32) + '-198-51-100-7.sslip.io')).toBeNull(); // not a configured ingress
  expect(routeFor(ENV, 'https://evil.example.test')).toBeNull();
  expect(routeFor(ENV, BROKER + ':8443')).toBeNull();
  expect(routeFor(ENV, 'https://d' + 'a'.repeat(32) + '-' + 'b'.repeat(24) + '.fleet.invalid')).toBeNull();
  expect(transferUrl(ENV, { kind: 'd', destinationOrigin: 'https://evil.example.test', capability: cap })).toBeNull();
  expect(relayOrigin({ ...ENV, NATIVE_GIT_TRANSFER_RELAY: 'off' })).toBeNull();
  expect(relayOrigin({ ...ENV, PUBLIC_BASE_URL: undefined })).toBeNull();
  expect(relayOrigin({ ...ENV, PUBLIC_BASE_URL: 'http://mcp.example.test' })).toBeNull();
 });
});

describe('refusals', () => {
 const cap = download(), good = transferUrl(ENV, { kind: 'd', destinationOrigin: 'https://worker.example.test', capability: cap });
 it('forwards a valid address to the configured worker, verbatim path and the fixed Git query only', () => {
  expect(plan(good)).toMatchObject({ ok: true, destination: `https://worker.example.test/v1/download/${cap}` });
  expect(plan(good + '/info/refs?service=git-upload-pack')).toMatchObject({ ok: true, destination: `https://worker.example.test/v1/download/${cap}/info/refs?service=git-upload-pack` });
  expect(plan(good + '/git-upload-pack', { method: 'POST' })).toMatchObject({ ok: true, destination: `https://worker.example.test/v1/download/${cap}/git-upload-pack` });
 });
 it('refuses tampered, expired and wrong-purpose capabilities, and a tampered or moved route tag', () => {
  const [enc, sig] = cap.split('.');
  const flipped = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1);
  const resigned = transferUrl(ENV, { kind: 'd', destinationOrigin: 'https://worker.example.test', capability: `${enc}.${flipped}` });
  expect(plan(resigned)).toMatchObject({ ok: false, status: 403, message: expect.stringMatching(/not valid/) });
  const forgedClaim = Buffer.from(JSON.stringify({ purpose: DOWNLOAD_PURPOSE, ...fields({ maxBytes: 999 }), downloadId: 'e'.repeat(32) })).toString('base64url');
  expect(plan(transferUrl(ENV, { kind: 'd', destinationOrigin: 'https://worker.example.test', capability: `${forgedClaim}.${sig}` }))).toMatchObject({ ok: false, status: 403 });
  expect(plan(good, { now: NOW + 600000 + 300001 })).toMatchObject({ ok: false, status: 403, message: expect.stringMatching(/expired/) });
  // An upload capability is never a download (and the reverse), even with a correctly bound route.
  const up = upload();
  expect(plan(transferUrl(ENV, { kind: 'd', destinationOrigin: 'https://worker.example.test', capability: up }))).toMatchObject({ ok: false, status: 403 });
  expect(plan(transferUrl(ENV, { kind: 'u', destinationOrigin: 'https://worker.example.test', capability: cap }), { method: 'PUT' })).toMatchObject({ ok: false, status: 403 });
  expect(plan(transferUrl(ENV, { kind: 'u', destinationOrigin: 'https://worker.example.test', capability: up }), { method: 'PUT' })).toMatchObject({ ok: true, destination: `https://worker.example.test/v1/upload/${up}` });
  // The route tag binds kind + destination + capability.
  const tag = good.split('/')[7];
  expect(plan(good.replace(tag, (tag[0] === 'A' ? 'B' : 'A') + tag.slice(1)))).toMatchObject({ ok: false, status: 403 });
  expect(plan(good.replace('/d/w/', '/u/w/'), { method: 'PUT' })).toMatchObject({ ok: false, status: 403 });
  expect(plan(good.replace('/d/w/', '/d/b.' + new URL(BROKER).hostname + '/'))).toMatchObject({ ok: false, status: 403 });
  // Another shared key (not this service's) is not accepted.
  expect(plan(transferUrl(ENV, { kind: 'd', destinationOrigin: 'https://worker.example.test', capability: download({ ...ENV, NATIVE_GIT_WORKER_KEY: HMAC }) }))).toMatchObject({ ok: false, status: 403 });
 });
 it('never takes a destination from the request: foreign hosts, unconfigured previous worker and unconfigured ingress are not found', () => {
  const tag = good.split('/')[7];
  for (const route of ['b.evil.example.test', 'b.ras-pg-' + 'a'.repeat(32) + '-198-51-100-7.sslip.io', 'p', 'x', 'b.' + new URL(BROKER).hostname + '.evil.example.test'])
   expect(plan(`https://mcp.example.test/v1/transfer/d/${route}/${tag}/${cap}`).ok, route).toBe(false);
  expect(plan(`https://mcp.example.test/v1/transfer/d/https%3A%2F%2Fevil.example.test/${tag}/${cap}`)).toMatchObject({ ok: false, status: 404 });
  expect(plan(good + '/../../evil')).toMatchObject({ ok: false, status: 404 });
  expect(plan(good + '?redirect=https://evil.example.test')).toMatchObject({ ok: false, status: 404 });
  expect(plan(good + '/info/refs?service=git-receive-pack')).toMatchObject({ ok: false, status: 404 });
  expect(plan(good + '/git-receive-pack', { method: 'POST' })).toMatchObject({ ok: false, status: 404 });
  expect(plan(good, { method: 'DELETE' })).toMatchObject({ ok: false, status: 405 });
  expect(plan(good, { method: 'PUT' })).toMatchObject({ ok: false, status: 405 });
  expect(plan('https://mcp.example.test/v1/transfer/')).toMatchObject({ ok: false, status: 404 });
  // Refusal text never echoes the request.
  expect(plan(`https://mcp.example.test/v1/transfer/d/b.evil.example.test/${tag}/${cap}`).message).not.toContain('evil');
 });
 it('a dedicated broker route needs an Ed25519 control-plane capability; a shared-secret one is refused', () => {
  const env = { ...ENV, NATIVE_GIT_WORKER_KEY: HMAC };
  const ed = download(ENV), url = transferUrl(env, { kind: 'd', destinationOrigin: BROKER, capability: ed });
  expect(plan(url, { env })).toMatchObject({ ok: true, destination: `${BROKER}/v1/download/${ed}` });
  const shared = download(env);
  expect(plan(transferUrl(env, { kind: 'd', destinationOrigin: BROKER, capability: shared }), { env })).toMatchObject({ ok: false, status: 403 });
  // …while the shared worker accepts the shared-secret capability it was signed for.
  expect(plan(transferUrl(env, { kind: 'd', destinationOrigin: 'https://worker.example.test', capability: shared }), { env })).toMatchObject({ ok: true });
 });
 it('forwards only the transfer header allowlist: cookies, authorization and service headers are dropped', () => {
  const out = plan(good + '/git-upload-pack', { method: 'POST', headers: { Cookie: 'FAKE_SESSION=1', Authorization: 'Bearer ghp_FAKE0000', 'Proxy-Authorization': 'Basic FAKE', 'x-robinson-signature': 'FAKE', 'x-forwarded-host': 'evil.example.test', 'Content-Type': 'application/x-git-upload-pack-request', 'Git-Protocol': 'version=2', 'Content-Encoding': 'gzip', 'Content-Length': '12', 'User-Agent': 'git/2.45' } });
  expect([...out.headers.keys()].sort()).toEqual(['content-encoding', 'content-length', 'content-type', 'git-protocol', 'user-agent']);
  expect(FORWARDED_HEADERS).not.toContain('cookie'); expect(FORWARDED_HEADERS).not.toContain('authorization');
 });
});

describe('middleware', () => {
 it('answers with the documented rewrite headers that REPLACE upstream request headers, or a plain refusal', async () => {
  const cap = download(), url = transferUrl(ENV, { kind: 'd', destinationOrigin: 'https://worker.example.test', capability: cap });
  const ok = handleTransfer(new Request(url, { headers: { Cookie: 'FAKE_SESSION=1', 'User-Agent': 'curl/8' } }), ENV, NOW);
  expect(ok.headers.get('x-middleware-rewrite')).toBe(`https://worker.example.test/v1/download/${cap}`);
  expect(ok.headers.get('x-middleware-override-headers')).toBe('user-agent');
  expect(ok.headers.get('x-middleware-request-user-agent')).toBe('curl/8');
  expect(ok.headers.get('x-middleware-request-cookie')).toBeNull();
  const no = handleTransfer(new Request(url.replace('/d/w/', '/d/b.evil.example.test/')), ENV, NOW);
  expect(no.status).toBe(404); expect(no.headers.get('x-middleware-rewrite')).toBeNull(); expect(await no.text()).not.toContain('evil');
  expect(rewriteResponse('https://worker.example.test/x', new Headers()).headers.get('x-middleware-override-headers')).toBe('');
 });
 it('is configured to run only on transfer paths, without the request body, and transfers are never cached', async () => {
  const { config } = await import('../../middleware.js');
  expect(config).toEqual({ matcher: ['/v1/transfer/:path*'], runtime: 'nodejs' });
  const vercel = JSON.parse(await (await import('node:fs/promises')).readFile(new URL('../../vercel.json', import.meta.url), 'utf8'));
  expect(vercel.skipMiddlewareRequestBody).toBe(true);
  expect(vercel.headers).toContainEqual({ source: '/v1/transfer/(.*)', headers: expect.arrayContaining([{ key: 'x-vercel-enable-rewrite-caching', value: '0' }]) });
 });
 it('a redirect from upstream is passed back, never followed by the relay, and the issued git command refuses to follow it', async () => {
  const hits = []; const elsewhere = createServer((req, res) => { hits.push(req.url); res.end('x'); });
  await new Promise(r => elsewhere.listen(0, '127.0.0.1', r)); cleanups.push(() => new Promise(r => elsewhere.close(r)));
  const upstream = createServer((req, res) => { res.writeHead(302, { Location: `http://127.0.0.1:${elsewhere.address().port}${req.url}` }); res.end(); });
  await new Promise(r => upstream.listen(0, '127.0.0.1', r)); cleanups.push(() => new Promise(r => upstream.close(r)));
  const relay = await startTransferRelay({ env: () => ENV, now: () => NOW, destinations: { 'https://worker.example.test': `http://127.0.0.1:${upstream.address().port}` } }); cleanups.push(relay.close);
  const url = relay.local(transferUrl(ENV, { kind: 'd', destinationOrigin: 'https://worker.example.test', capability: download() }));
  const answer = await fetch(url, { redirect: 'manual' }); expect(answer.status).toBe(302);
  const dir = await mkdtemp(join(tmpdir(), 'relay-redirect-')); cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const env = { ...process.env, http_proxy: '', HTTP_PROXY: '', https_proxy: '', HTTPS_PROXY: '', NO_PROXY: '*', no_proxy: '*', GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  const status = await new Promise(r => { const c = spawn('git', ['-c', 'http.followRedirects=false', 'clone', '--quiet', url, join(dir, 'repo')], { env, stdio: 'ignore' }); c.on('close', r); });
  expect(status).not.toBe(0);
  expect(hits).toEqual([]);
  expect(relay.seen.every(s => s.destination.startsWith('https://worker.example.test/'))).toBe(true);
 });
});

describe('guidance', () => {
 it('names the one domain to allow, says it is the same for every repository, and nothing is lost', () => {
  const note = blockedNote('https://mcp.example.test/v1/transfer/d/w/x/y');
  expect(note).toMatch(/cannot reach mcp\.example\.test .*add that one domain to your AI's network allowlist/);
  expect(note).toMatch(/Capabilities \/ network access allowed-domains/);
  expect(note).toMatch(/Same domain for every repository and transfer/);
  expect(note).toMatch(/nothing is lost/);
 });
 it('fitDigest drops optional fields first and stays within 1200 bytes', () => {
  const big = { command: 'c'.repeat(800), if_blocked: 'i'.repeat(300), next: 'n'.repeat(200), head: 'h'.repeat(40) };
  const out = fitDigest(big, ['next', 'head']);
  expect(Buffer.byteLength(JSON.stringify(out))).toBeLessThanOrEqual(1200);
  expect(out).toMatchObject({ command: big.command, if_blocked: big.if_blocked }); expect(out.next).toBeUndefined();
  expect(signWorkerBody('x', HMAC)).toMatch(/^[a-f0-9]{64}$/);
 });
});
