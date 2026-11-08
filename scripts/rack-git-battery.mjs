#!/usr/bin/env node
// Rack staging battery (S-2 exit criteria): run on a bench with the
// staging tree + git installed. Expects DATABASE_URL (scratch
// Postgres, disposable) in the environment. Proves:
//   1. front door through the rack entrypoint reports the fixture
//      pin + production tool counts (514 / 513 full);
//   2. /api/contract answers; the MCP door refuses a tokenless call
//      in production's shape (401 invalid_token challenge);
//   3. OAuth discovery issuer == PUBLIC_BASE_URL (byte shape);
//   4. git battery: a real `git clone` and `git push` through the
//      entrypoint's /git/* middleware family against a fixture bare
//      repository served by a fixture worker (git http-backend),
//      with the middleware's session-key check enforced (a wrong key
//      is refused 401 before any proxying);
//   5. transfer family shape: an unsigned /v1/transfer/* address is
//      refused by the middleware (404), never proxied.
// Prints BATTERY lines; exits non-zero on the first failure.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { randomBytes } from 'node:crypto';

const PIN = 'f21fad344d704bd1ea85b10da6da58de515d09e3';
const ENTRY = 20000 + Math.floor(Math.random() * 8000);
const WORKER = ENTRY + 1;
const scratch = process.env.DATABASE_URL;
if (!scratch) { console.error('DATABASE_URL required'); process.exit(1); }

const env = {
  ...process.env,
  STORE_TRANSPORT: 'pg',
  DATABASE_URL: scratch,
  PUBLIC_BASE_URL: 'https://github.robinsonaisystems.com',
  VERCEL_ENV: 'production',
  VERCEL_GIT_COMMIT_SHA: PIN,
  TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  NATIVE_GIT_WORKER_URL: `https://127.0.0.1:${WORKER}`,
  NODE_TLS_REJECT_UNAUTHORIZED: '0',
  PORT: String(ENTRY),
  HOST: '127.0.0.1',
};
Object.assign(process.env, env);

// --- fixture bare repository + worker (git http-backend) ----------
const root = mkdtempSync(join(tmpdir(), 'rack-git-battery-'));
const projectRoot = join(root, 'projects');
execFileSync('git', ['init', '--bare', '-q', join(projectRoot, 'fixture-owner', 'fixture-repo.git')], { stdio: 'inherit' });
const seedDir = join(root, 'seed');
execFileSync('git', ['init', '-q', seedDir]);
writeFileSync(join(seedDir, 'README.md'), 'fixture\n');
execFileSync('git', ['-C', seedDir, 'add', '.']);
execFileSync('git', ['-C', seedDir, '-c', 'user.email=fixture@example.invalid', '-c', 'user.name=Fixture', 'commit', '-qm', 'seed']);
execFileSync('git', ['-C', seedDir, 'push', '-q', join(projectRoot, 'fixture-owner', 'fixture-repo.git'), 'HEAD:refs/heads/main']);

const claims = [];
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-keyout', join(root, 'worker-key.pem'),
  '-out', join(root, 'worker-cert.pem'), '-days', '1', '-nodes', '-subj', '/CN=127.0.0.1',
  '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore' });
const worker = https.createServer(
  { key: readFileSync(join(root, 'worker-key.pem')), cert: readFileSync(join(root, 'worker-cert.pem')) },
  (req, res) => {
  claims.push(req.headers['x-robinson-git-claim'] ?? null);
  const u = new URL(req.url, 'http://worker');
  // The real worker resolves the mirror from the signed claim, not
  // the path: the rewrite destination is /v1/remote/<suffix> where
  // the suffix is only info/refs or the pack service name.
  let claimPath = '';
  try {
    const claim = JSON.parse(Buffer.from(String(req.headers['x-robinson-git-claim']).split('.')[0], 'base64url').toString('utf8'));
    claimPath = `/${claim.owner}/${claim.repo}.git`;
  } catch { /* no claim: the backend 404s, as it should */ }
  const backend = spawn('git', ['http-backend'], {
    env: {
      ...process.env,
      GIT_PROJECT_ROOT: projectRoot,
      GIT_HTTP_EXPORT_ALL: '1',
      PATH_INFO: claimPath + u.pathname.replace(/^\/v1\/remote/, ''),
      QUERY_STRING: u.search.slice(1),
      REQUEST_METHOD: req.method,
      CONTENT_TYPE: req.headers['content-type'] ?? '',
      REMOTE_ADDR: '127.0.0.1',
    },
  });
  let head = '';
  backend.stdout.on('data', (chunk) => {
    head += chunk.toString('latin1');
    const split = head.indexOf('\r\n\r\n') >= 0 ? head.indexOf('\r\n\r\n') + 4 : head.indexOf('\n\n') >= 0 ? head.indexOf('\n\n') + 2 : -1;
    if (split >= 0) {
      const headerBlock = head.slice(0, split);
      const rest = Buffer.from(head.slice(split), 'latin1');
      head = '';
      backend.stdout.removeAllListeners('data');
      let status = 200;
      for (const line of headerBlock.split(/\r?\n/)) {
        const m = /^Status:\s*(\d+)/i.exec(line);
        if (m) status = Number(m[1]);
        else if (line.includes(':')) { const i = line.indexOf(':'); res.setHeader(line.slice(0, i).trim(), line.slice(i + 1).trim()); }
      }
      res.statusCode = status;
      if (rest.length) res.write(rest);
      backend.stdout.pipe(res);
    }
  });
  req.pipe(backend.stdin);
  backend.on('error', () => { if (!res.headersSent) res.statusCode = 502; res.end(); });
  });
await new Promise((r) => worker.listen(WORKER, '127.0.0.1', r));

// --- seed the store through production code -----------------------
const { createDb } = await import('../src/db.js');
const { newSessionKey, sha256, indexKey } = await import('../src/git-remote/keys.js');
const { GIT_REMOTE_ID } = await import('../src/db.js');
const db = createDb();
await db.initSchema();
const id = randomBytes(16).toString('hex');
if (!GIT_REMOTE_ID.test(id)) throw new Error('bad fixture id');
const code = 'rgc_' + id + '_' + randomBytes(32).toString('base64url');
const codeHash = sha256(code);
const now = Date.now();
await db.createGitRemoteKey({
  id, connection: 'fixture-client', owner: 'fixture-owner', repo: 'fixture-repo', access: 'write',
  codeHash, codeExpiresAt: new Date(now + 600_000), expiresAt: new Date(now + 8 * 3600_000),
});
const sessionKey = newSessionKey(id);
const exchanged = await db.exchangeGitRemoteCode({ id, codeHash, keyHash: sha256(sessionKey) });
if (!exchanged) throw new Error('fixture exchange failed');
await db.setSetting(indexKey(id), { kind: 'git-remote-index', id, scope: { legacy: true } });
const { storeFactory } = await import('../src/db-transport.js');
const sql = storeFactory(scratch);
await sql`INSERT INTO oauth_tokens (token_hash, client_id, default_account, accounts, mode, profile, listing, kind, expires_at)
  VALUES ('fixturehash', 'fixture-client', 'fixture-owner', ARRAY['fixture-owner'], 'preview', 'full', 'compact', 'connector', now() + interval '1 day')`;
console.log('BATTERY seed: git remote key exchanged + connection live in scratch store');

// --- entrypoint ----------------------------------------------------
const server = spawn('node', ['rack-server.mjs'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });
const waitFor = async (path, tries = 60) => {
  for (let i = 0; i < tries; i += 1) {
    try { const r = await fetch(`http://127.0.0.1:${ENTRY}${path}`); if (r.status) return r; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`entrypoint did not answer ${path}; log: ${serverLog.slice(-800)}`);
};

try {
  // 1. Front door
  const door = await (await waitFor('/')).json();
  console.log(`BATTERY front door: ${JSON.stringify(door)}`);
  if (door.deployed_source_sha !== PIN) throw new Error('front door pin mismatch');
  if (door.tools !== 514 || door.tools_by_profile?.full !== 513) throw new Error('front door counts mismatch');
  console.log('BATTERY 1 PASS front door pin + counts (514 / 513)');

  // 2. Contract + MCP refusal shape
  const contract = await fetch(`http://127.0.0.1:${ENTRY}/api/contract`);
  if (contract.status !== 200) throw new Error(`contract ${contract.status}`);
  const mcp = await fetch(`http://127.0.0.1:${ENTRY}/api/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
  if (mcp.status !== 401) throw new Error(`mcp tokenless expected 401, got ${mcp.status}`);
  console.log('BATTERY 2 PASS contract 200 + MCP tokenless 401');

  // 3. Discovery issuer
  const discovery = await (await fetch(`http://127.0.0.1:${ENTRY}/.well-known/oauth-authorization-server`)).json();
  if (discovery.issuer !== env.PUBLIC_BASE_URL) throw new Error(`issuer ${discovery.issuer}`);
  console.log('BATTERY 3 PASS discovery issuer == PUBLIC_BASE_URL');

  // 4. Git battery through the middleware family
  const basic = (key) => 'Basic ' + Buffer.from(`x-robinson-git:${key}`).toString('base64');
  const refused = await fetch(`http://127.0.0.1:${ENTRY}/git/fixture-owner/fixture-repo.git/info/refs?service=git-upload-pack`, { headers: { Authorization: basic('rgk_' + '0'.repeat(32) + '_' + 'A'.repeat(43)) } });
  if (refused.status !== 401) throw new Error(`wrong key expected 401, got ${refused.status}: ${(await refused.text()).slice(0,300)} | server log: ${serverLog.slice(-500)}`);
  console.log('BATTERY 4a PASS wrong session key refused 401 by middleware');
  try {
    const probe = await fetch(`http://127.0.0.1:${ENTRY}/git/fixture-owner/fixture-repo.git/info/refs?service=git-upload-pack`, { headers: { Authorization: basic(sessionKey) }, signal: AbortSignal.timeout(15000) });
    const probeBody = Buffer.from(await probe.arrayBuffer());
    console.log(`BATTERY trace: direct info/refs fetch -> ${probe.status}, ${probeBody.length} bytes, claims seen by worker: ${claims.length}`);
  } catch (e) { console.log('BATTERY trace: direct info/refs fetch FAILED:', e.message, '| claims:', claims.length); throw e; }
  console.log('BATTERY trace: starting clone');
  const cloneDir = join(root, 'clone');
  const gitEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: `http.extraHeader`, GIT_CONFIG_VALUE_0: `Authorization: ${basic(sessionKey)}` };
  try {
    execFileSync('git', ['clone', '-q', `http://127.0.0.1:${ENTRY}/git/fixture-owner/fixture-repo.git`, cloneDir], { env: { ...gitEnv, GIT_TRACE: '1', GIT_CURL_VERBOSE: '1' }, stdio: ['ignore', 'pipe', 'pipe'], timeout: 45000 });
  } catch (e) {
    console.log('BATTERY trace: clone failed:', e.message);
    console.log('BATTERY trace: clone stderr tail:', Buffer.from(e.stderr ?? '').toString('utf8').slice(-3000));
    throw e;
  }
  if (!existsSync(join(cloneDir, 'README.md'))) throw new Error('clone missing fixture file');
  console.log('BATTERY 4b PASS git clone through entrypoint');
  writeFileSync(join(cloneDir, 'pushed.txt'), 'pushed through the rack entrypoint\n');
  execFileSync('git', ['-C', cloneDir, 'add', '.']);
  execFileSync('git', ['-C', cloneDir, '-c', 'user.email=fixture@example.invalid', '-c', 'user.name=Fixture', 'commit', '-qm', 'battery push']);
  console.log('BATTERY trace: starting push');
  execFileSync('git', ['-C', cloneDir, 'push', '-q', 'origin', 'HEAD:refs/heads/main'], { env: gitEnv, stdio: 'inherit' });
  const log = execFileSync('git', ['--git-dir', join(projectRoot, 'fixture-owner', 'fixture-repo.git'), 'log', '--oneline', 'main']).toString();
  if (!log.includes('battery push')) throw new Error('push did not land in fixture repo');
  if (!claims.some((c) => typeof c === 'string' && c.length > 20)) throw new Error('worker saw no signed claim header');
  console.log('BATTERY 4c PASS git push through entrypoint + signed claim reached worker');

  // 5. Transfer family refusal shape
  const transfer = await fetch(`http://127.0.0.1:${ENTRY}/v1/transfer/d/w/${'A'.repeat(32)}/${'A'.repeat(10)}.${'B'.repeat(10)}/info/refs`);
  if (transfer.status !== 404 && transfer.status !== 403) throw new Error(`transfer expected refusal, got ${transfer.status}`);
  console.log(`BATTERY 5 PASS unsigned transfer refused (${transfer.status})`);
  console.log('BATTERY ALL LEGS PASS');
} finally {
  server.kill('SIGTERM');
  worker.close();
  await sql.end().catch(() => {});
}
