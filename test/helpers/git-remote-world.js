// GIT-REMOTE-1 test world: everything real except GitHub and the database.
//  - "GitHub": bare repositories served by the real `git http-backend` over HTTP, requiring
//    `x-access-token:<credential>` Basic auth (every credential it sees is recorded), with an optional
//    server-side pre-receive hook that refuses a protected branch the way GitHub does (GH006).
//  - The real native Git worker (workers/native-git/server.js) with its real pre-receive hook.
//  - The real control-plane handlers (src/git-remote/api.js) behind a local HTTP server.
//  - "This service's domain": a stand-in for Vercel's edge that runs the real Routing Middleware
//    (middleware.js → handleGitRemote) WITHOUT the request body, then proxies a rewrite to the
//    worker with exactly the override headers, streaming both ways (as test/helpers/transfer-relay.js).
//    Other paths (/git-remote/exchange, /api/…) go to the function server, as on Vercel.
import { createServer, request as httpRequest } from 'node:http';
import { createServer as createTlsServer } from 'node:https';
import { createServer as createTlsSocketServer } from 'node:tls';
import { connect } from 'node:net';
import { readFileSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nativeGitServer } from '../../workers/native-git/server.js';
import { handleGitRemote } from '../../src/git-remote/edge.js';
import { exchange, broker, directAuthorize } from '../../src/git-remote/api.js';
import { directConfig, directIdentity } from '../../workers/native-git/direct.js';
import { indexKey } from '../../src/git-remote/keys.js';

export const WORKER_KEY = 'FAKE-local-git-remote-worker-key-0123456789';
export const PUBLIC = 'https://mcp.example.test';
export const WORKER = 'https://native-worker.example.test';
export const DIRECT = 'https://git.example.test';
export const GIT_ENV = { ...process.env, http_proxy: '', HTTP_PROXY: '', https_proxy: '', HTTPS_PROXY: '', ALL_PROXY: '', all_proxy: '', NO_PROXY: '*', no_proxy: '*', GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
const permissive = { policy: {}, body: () => ({ allowed: true }), check: async () => ({ allowed: true }), close() {} };
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
const readBody = async req => { const chunks = []; for await (const c of req) chunks.push(c); return Buffer.concat(chunks).toString('utf8'); };
export const gitIn = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=Agent', '-c', 'user.email=agent@example.test', ...args], { cwd, stdio: 'pipe', env: GIT_ENV, maxBuffer: 256 * 1024 * 1024 }).toString().trim();
export const run = (cmd, args, opts = {}) => new Promise(resolve => {
 const child = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] }); let stdout = '', stderr = '';
 child.stdout.on('data', c => { stdout += c; }); child.stderr.on('data', c => { stderr += c; }); child.on('close', status => resolve({ status, stdout, stderr }));
});

/** A fake GitHub git host (smart HTTP via git http-backend) with one seeded repository. */
export async function startFakeGithubGit({ owner = 'example-org', repo = 'hello', pushLimit = null } = {}) {
 const root = await mkdtemp(join(tmpdir(), 'fake-github-git-'));
 const bare = join(root, owner, `${repo}.git`);
 await mkdir(join(root, owner), { recursive: true });
 gitIn(root, 'init', '--bare', '--initial-branch=main', bare); gitIn(bare, 'config', 'http.receivepack', 'true');
 const seed = join(root, 'seed'); gitIn(root, 'clone', '--quiet', bare, seed); gitIn(seed, 'checkout', '-q', '-B', 'main');
 await writeFile(join(seed, 'README.md'), '# hello\n'); await mkdir(join(seed, 'src')); await writeFile(join(seed, 'src', 'app.js'), 'console.log(1)\n');
 gitIn(seed, 'add', '.'); gitIn(seed, 'commit', '-qm', 'seed'); gitIn(seed, 'push', '-q', 'origin', 'main');
 gitIn(seed, 'push', '-q', 'origin', 'main:refs/heads/protected');
 // GitHub's own branch protection, as GitHub reports it. With `pushLimit`, also GitHub's per-push size
 // limit (every received pack is kept as a pack and measured; sizes are logged), and a test can make the
 // next push touching a matching ref fail by writing a shell pattern into the bare repository's fail-on file.
 await mkdir(join(bare, 'hooks'), { recursive: true });
 if (pushLimit) gitIn(bare, 'config', 'receive.unpackLimit', '1');
 const limitCheck = pushLimit ? `size=$(cat "$GIT_QUARANTINE_PATH"/pack/*.pack 2>/dev/null | wc -c); echo "$size" >> push-sizes.log; if [ "$size" -gt ${pushLimit} ]; then echo "error: GH001: push exceeds the push size limit" >&2; exit 1; fi\n` : '';
 await writeFile(join(bare, 'hooks', 'pre-receive'), '#!/bin/sh\n' + limitCheck + 'while read old new ref; do if [ -f fail-on ]; then case "$ref" in $(cat fail-on)) echo "error: GH999: injected failure for $ref" >&2; rm -f fail-on; exit 1;; esac; fi; if [ "$ref" = "refs/heads/protected" ]; then echo "error: GH006: Protected branch update failed for refs/heads/protected." >&2; echo "error: Changes must be made through a pull request." >&2; printf "error: \\033[2Jrule text from the repository\\n" >&2; exit 1; fi; done\nexit 0\n');
 await chmod(join(bare, 'hooks', 'pre-receive'), 0o755);
 const backend = join(gitIn(root, '--exec-path'), 'git-http-backend');
 const seen = [];
 const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const auth = String(req.headers.authorization ?? '');
  const decoded = auth.startsWith('Basic ') ? Buffer.from(auth.slice(6), 'base64').toString() : '';
  seen.push({ method: req.method, path: url.pathname, query: url.search, credential: decoded.startsWith('x-access-token:') ? decoded.slice(15) : null });
  if (!decoded.startsWith('x-access-token:')) { req.resume(); res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="GitHub"' }); return res.end(); }
  const child = spawn(backend, [], { env: { PATH: process.env.PATH, GIT_PROJECT_ROOT: root, GIT_HTTP_EXPORT_ALL: '1', GIT_HTTP_MAX_REQUEST_BUFFER: '1000M', REQUEST_METHOD: req.method, PATH_INFO: url.pathname, QUERY_STRING: url.search.slice(1),
   CONTENT_TYPE: req.headers['content-type'] ?? '', ...(req.headers['content-length'] ? { CONTENT_LENGTH: req.headers['content-length'] } : {}), HTTP_CONTENT_ENCODING: req.headers['content-encoding'] ?? '', REMOTE_USER: 'x-access-token', REMOTE_ADDR: '127.0.0.1', GIT_COMMITTER_NAME: 'srv', GIT_COMMITTER_EMAIL: 'srv@example.com' } });
  req.pipe(child.stdin);
  const out = []; child.stdout.on('data', c => out.push(c));
  child.on('close', () => {
   const raw = Buffer.concat(out), split = raw.indexOf('\r\n\r\n'), head = raw.subarray(0, split).toString(), body = raw.subarray(split + 4);
   let status = 200; const headers = {};
   for (const line of head.split('\r\n')) { const [k, ...v] = line.split(': '); if (k.toLowerCase() === 'status') status = Number(v.join(': ').split(' ')[0]); else if (k) headers[k] = v.join(': '); }
   res.writeHead(status, headers); res.end(body);
  });
 });
 const origin = await listen(server);
 return { origin, root, bare, seed, seen, url: (o, r) => `${origin}/${o}/${r}.git`, log: (...a) => gitIn(bare, ...a), close: async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); await rm(root, { recursive: true, force: true }); } };
}

/**
 * The whole git remote around a write-contract world `w` (fake DB with a live connector login,
 * fake GitHub API for repository checks and credentials).
 */
export async function startGitRemote(w, { gates = [], direct = false, githubPushLimit = null, limits = undefined, freeDisk = undefined, limiter = undefined } = {}) {
 const github = await startFakeGithubGit({ pushLimit: githubPushLimit });
 const dir = await mkdtemp(join(tmpdir(), 'git-remote-world-'));
 const root = join(dir, 'storage');
 const env = { ...w.ctx.env, NATIVE_GIT_WORKER_URL: WORKER + '/', NATIVE_GIT_WORKER_KEY: WORKER_KEY, PUBLIC_BASE_URL: PUBLIC, VERCEL_ENV: 'production', ...(direct ? { GIT_DIRECT_ORIGIN: DIRECT } : {}) };
 const now = () => w.ctx.now();
 // Legacy (owner database) scope: the root index lives in the same fake database.
 const openScope = async (id, { withCredentials = false } = {}) => {
  const index = await w.db.getSetting(indexKey(id));
  if (index?.kind !== 'git-remote-index' || index.id !== id) return null;
  return { db: w.db, env, scope: index.scope, ...(withCredentials ? { credentials: w.credentials } : {}) };
 };
 const api = { calls: [], authorize: [] };
 const functions = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const body = await readBody(req);
  const shaped = Object.assign(req, { query: Object.fromEntries(url.searchParams), body });
  api.calls.push({ path: url.pathname, op: url.searchParams.get('op'), body });
  if (url.pathname === '/git-remote/exchange') return exchange(shaped, res, { env, openScope, now });
  if (url.pathname === '/api/git-remote' && url.searchParams.get('op') === 'authorize') { api.authorize.push({ headers: { ...req.headers }, body }); return directAuthorize(Object.assign(shaped, { body: JSON.parse(body || '{}') }), res, { env, openScope, now, root: w.db }); }
  if (url.pathname === '/api/git-remote') return broker(shaped, res, { env, openScope, now, fetchImpl: w.gh.fetch, gates });
  res.statusCode = 404; res.end('no route');
 });
 const functionsOrigin = await listen(functions);
 const directSettings = direct ? { config: directConfig({ GIT_DIRECT_ORIGIN: DIRECT, GIT_DIRECT_CONTROL_ORIGIN: functionsOrigin, GIT_DIRECT_PORT: '1' }, { local: true }), identity: await directIdentity(root) } : null;
 const worker = nativeGitServer({ root, key: WORKER_KEY, now, allowLocalFixtures: true, resources: permissive, direct: directSettings,
  remote: { github: github.url, broker: () => `${functionsOrigin}/api/git-remote?op=broker`, limits, freeDisk, limiter } });
 const workerOrigin = await listen(worker);
 const directOrigin = worker.direct ? await listen(worker.direct) : null;
 const seen = [];
 // A certificate for the public test hostname; the agent's git and curl trust it and reach it through a CONNECT proxy,
 // so the setup command runs exactly as issued (https only, the real hostname).
 const cert = join(dir, 'c.pem'), keyFile = join(dir, 'k.pem');
 execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=mcp.example.test', '-addext', 'subjectAltName=DNS:mcp.example.test,DNS:git.example.test', '-keyout', keyFile, '-out', cert], { stdio: 'ignore' });
 const edge = createTlsServer({ key: readFileSync(keyFile), cert: readFileSync(cert) }, async (req, res) => {
  if (!req.url.startsWith('/git/')) {
   const upstream = httpRequest(functionsOrigin + req.url, { method: req.method, headers: req.headers }, reply => { res.writeHead(reply.statusCode, reply.headers); reply.pipe(res); });
   upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); }); return req.pipe(upstream);
  }
  const headers = new Headers(); for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
  const answer = await handleGitRemote(new Request(PUBLIC + req.url, { method: req.method, headers }), env, { now, openScope });
  const target = answer.headers.get('x-middleware-rewrite');
  if (!target) { req.resume(); res.writeHead(answer.status, Object.fromEntries(answer.headers)); return res.end(Buffer.from(await answer.arrayBuffer())); }
  const forwarded = {};
  for (const name of (answer.headers.get('x-middleware-override-headers') ?? '').split(',').filter(Boolean)) forwarded[name] = answer.headers.get('x-middleware-request-' + name);
  const destination = new URL(target);
  seen.push({ destination: target, headers: forwarded });
  if (destination.origin !== WORKER) { req.resume(); res.writeHead(502); return res.end(); }
  const upstream = httpRequest(workerOrigin + destination.pathname + destination.search, { method: req.method, headers: forwarded }, reply => { res.writeHead(reply.statusCode, reply.headers); reply.pipe(res); });
  upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
  req.on('close', () => { if (!req.complete) upstream.destroy(); });
  req.pipe(upstream);
 });
 await new Promise(resolve => edge.listen(0, '127.0.0.1', resolve));
 const edgePort = edge.address().port;
 // The direct host's TLS terminator (Traefik's role in production): TLS in, plain bytes to the worker's direct port.
 const terminator = directOrigin ? createTlsSocketServer({ key: readFileSync(keyFile), cert: readFileSync(cert) }, socket => {
  const upstream = connect(Number(new URL(directOrigin).port), '127.0.0.1'); socket.pipe(upstream); upstream.pipe(socket);
  upstream.on('error', () => socket.destroy()); socket.on('error', () => upstream.destroy());
 }) : null;
 if (terminator) await new Promise(resolve => terminator.listen(0, '127.0.0.1', resolve));
 const proxy = createServer((req, res) => { res.writeHead(405); res.end(); });
 proxy.on('connect', (req, socket, head) => {
  const port = String(req.url) === 'mcp.example.test:443' ? edgePort : terminator && String(req.url) === 'git.example.test:443' ? terminator.address().port : null;
  if (!port) { socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
  const upstream = connect(port, '127.0.0.1', () => { socket.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head?.length) upstream.write(head); upstream.pipe(socket); socket.pipe(upstream); });
  upstream.on('error', () => socket.destroy()); socket.on('error', () => upstream.destroy());
 });
 const proxyOrigin = await listen(proxy);
 // The agent's sandbox: its own HOME (credential store); only the service's domain is reachable (through the proxy).
 const home = join(dir, 'home'); await mkdir(home);
 const agentEnv = { ...GIT_ENV, HOME: home, GIT_CONFIG_GLOBAL: join(home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1', https_proxy: proxyOrigin, HTTPS_PROXY: proxyOrigin, NO_PROXY: '', no_proxy: '',
  GIT_SSL_CAINFO: cert, CURL_CA_BUNDLE: cert };
 return { github, root, env, now, openScope, functionsOrigin, workerOrigin, directOrigin, worker, seen, api, home, agentEnv, dir, cert,
  close: async () => { proxy.close(); terminator?.close(); for (const s of [edge, worker, ...(worker.direct ? [worker.direct] : []), functions]) { s.closeAllConnections(); await new Promise(r => s.close(r)); } await github.close(); await rm(dir, { recursive: true, force: true }); } };
}
