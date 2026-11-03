// GIT-SSH-LEG-1: the worker's SSH leg to GitHub, end to end through the real git remote (Routing Middleware stand-in,
// real worker and pre-receive hook, real broker). "GitHub" is the fake API (validated against the vendored OpenAPI
// description) plus a fake SSH host: a stand-in ssh program that checks the pinned known_hosts and strict host key
// checking, derives the public key from the private key file it was handed, accepts it only while it is a registered
// deploy key, and runs the real git-receive-pack on the fake GitHub repository. The real ssh client is checked against a
// real local sshd with an unknown host key. Every key here is made at runtime; nothing is a real credential.
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile, rm, readdir, chmod, mkdir } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer, connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeWorld, parse } from '../../test/helpers/write-contract.js';
import { startGitRemote, gitIn, run } from '../../test/helpers/git-remote-world.js';
import * as gitRemote from '../../src/tools/git-remote.js';
import { GITHUB_SSH_HOST_KEYS, knownHostsText, transportSettings, httpVersionArgs, githubSshRemote, sshCommand, sshProblem, ephemeralKey, removeLeftoverKeys, PUSH_KEY_TITLE as WORKER_TITLE, pushKeyTitle as workerTitle } from '../../workers/native-git/github-ssh.js';
import { PUSH_KEY_TITLE, pushKeyTitle, validPublicKey, addRefusal } from '../../src/git-remote/deploy-keys.js';
import { transportReport } from '../../src/git-remote/api.js';
import { callBroker } from '../../workers/native-git/remote.js';

const handler = gitRemote.handlers.github_git_remote_setup;
const cleanups = [];
afterEach(async () => { for (const c of cleanups.splice(0).reverse()) await c(); });
const MIN = 60000;

/** Fake GitHub deploy keys for example-org/hello, shared with the fake ssh program through a file. */
function deployKeys(w, dir, { addStatus = null, deleteFails = 0 } = {}) {
 const state = { keys: new Map(), next: 500, deleteFails, addStatus, order: [] };
 const file = join(dir, 'deploy-keys.json');
 const save = () => writeFile(file, JSON.stringify([...state.keys.values()].map(k => k.key)));
 const view = k => ({ id: k.id, key: k.key, url: `https://api.github.com/repos/example-org/hello/keys/${k.id}`, title: k.title, verified: true, created_at: k.created_at, read_only: k.read_only, added_by: 'example-user', last_used: null, enabled: true });
 w.gh.when('GET /repos/{owner}/{repo}/keys').replyWith(() => { state.order.push('list'); return { status: 200, body: [...state.keys.values()].map(view) }; });
 w.gh.when('POST /repos/{owner}/{repo}/keys').replyWith(async req => {
  state.order.push('add');
  if (state.addStatus) return { status: state.addStatus, body: { message: state.addStatus === 422 ? 'Deploy keys are disabled for this repository' : 'Resource not accessible by integration' } };
  const k = { id: state.next++, key: req.body.key, title: req.body.title, read_only: req.body.read_only, created_at: new Date(w.ctx.now()).toISOString() };
  state.keys.set(k.id, k); await save();
  return { status: 201, body: view(k) };
 });
 w.gh.when('GET /repos/{owner}/{repo}/keys/{key_id}').replyWith(req => { state.order.push('get'); const k = state.keys.get(Number(req.params.key_id)); return k ? { status: 200, body: view(k) } : { status: 404, body: { message: 'Not Found' } }; });
 w.gh.when('DELETE /repos/{owner}/{repo}/keys/{key_id}').replyWith(async req => {
  state.order.push('delete');
  if (state.deleteFails > 0) { state.deleteFails--; return { status: 500, body: { message: 'Server Error' } }; }
  state.keys.delete(Number(req.params.key_id)); await save();
  return { status: 204, body: null };
 });
 state.seed = async k => { state.keys.set(k.id, k); await save(); };
 return { state, file, save };
}

/** The fake GitHub SSH host: a stand-in for `ssh` that GIT_SSH_COMMAND names. */
async function fakeSsh(dir, githubRoot, keysFile) {
 const script = join(dir, 'fake-ssh.mjs'), log = join(dir, 'fake-ssh.log'), captured = join(dir, 'captured-private-key.txt');
 await writeFile(script, `#!${process.execPath}
import { readFileSync, appendFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
const args = process.argv.slice(2);
const opt = name => { for (let i = 0; i < args.length - 1; i++) if (args[i] === '-o' && args[i + 1].startsWith(name + '=')) return args[i + 1].slice(name.length + 1); return null; };
const fail = msg => { appendFileSync(${JSON.stringify(log)}, JSON.stringify({ refused: msg }) + '\\n'); process.stderr.write(msg + '\\n'); process.exit(255); };
const key = args[args.indexOf('-i') + 1];
if (existsSync(${JSON.stringify(join(dir, 'ssh-down'))})) { process.stderr.write('ssh: connect to host ssh.github.com port 443: Connection timed out\\n'); process.exit(255); }
if (opt('StrictHostKeyChecking') !== 'yes') fail('strict host key checking is off');
if (readFileSync(opt('UserKnownHostsFile'), 'utf8') !== ${JSON.stringify(knownHostsText())}) fail('Host key verification failed.');
if (opt('GlobalKnownHostsFile') !== '/dev/null' || opt('IdentitiesOnly') !== 'yes' || !args.includes('-F')) fail('unexpected ssh options');
writeFileSync(${JSON.stringify(captured)}, readFileSync(key, 'utf8'));
const pub = execFileSync('ssh-keygen', ['-y', '-f', key]).toString().trim().split(' ').slice(0, 2).join(' ');
const allowed = JSON.parse(readFileSync(${JSON.stringify(keysFile)}, 'utf8'));
const command = args[args.length - 1], host = args[args.length - 2], port = args[args.indexOf('-p') + 1];
appendFileSync(${JSON.stringify(log)}, JSON.stringify({ host, port: args.includes('-p') ? port : null, command, keyAllowed: allowed.includes(pub) }) + '\\n');
if (!allowed.includes(pub)) fail('git@github.com: Permission denied (publickey).');
const m = /^(git-receive-pack|git-upload-pack) '\\/?([^']+)'$/.exec(command);
if (!m) fail('unexpected command');
// A real ssh session starts with a clean environment on GitHub's side (no GIT_* from the worker's hook).
const r = spawnSync(m[1], [${JSON.stringify(githubRoot)} + '/' + m[2]], { stdio: 'inherit', env: { PATH: process.env.PATH, HOME: '/nonexistent' } });
process.exit(r.status ?? 1);
`);
 await chmod(script, 0o755);
 const entries = async () => (await readFile(log, 'utf8').catch(() => '')).split('\n').filter(Boolean).map(l => JSON.parse(l));
 return { script, entries, captured };
}

async function world({ transport = 'ssh', sshPort = 443, httpVersion = null, keys = {} } = {}) {
 const w = await makeWorld({ profile: 'full', mode: 'production', gates: [] });
 w.gh.when('GET /repos/{owner}/{repo}').reply(200, { full_name: 'example-org/hello', default_branch: 'main', permissions: { pull: true, push: true } });
 await w.db.createAccessToken({ accessToken: 'FAKE-access-token-git-ssh', refreshToken: 'FAKE-refresh-token-git-ssh', clientId: 'client-1', defaultAccount: 'example-org', accounts: ['example-org'], mode: 'production', profile: 'full', listing: 'compact' });
 const dir = await mkdtemp(join(tmpdir(), 'git-ssh-leg-')); cleanups.push(() => rm(dir, { recursive: true, force: true }));
 const sshTmp = join(dir, 'keys'); await mkdir(sshTmp, { mode: 0o700 });
 const dk = deployKeys(w, dir, keys); await dk.save();
 // The fake SSH host serves the same bare repositories as the fake GitHub git host (linked once it has started).
 const fake = await fakeSsh(dir, join(dir, 'github-root-link'), dk.file);
 const r = await startGitRemote(w, { transport: { transport, sshPort, httpVersion, problems: [], sshBinary: fake.script, sshTmp }, githubSsh: (o, rp, port) => githubSshRemote(o, rp, port) });
 cleanups.push(r.close);
 const WORKER_ORIGIN = 'https://native-worker.example.test/', providerFetch = w.gh.fetch;
 w.ctx = { ...w.ctx, env: r.env, fetch: async (url, init) => String(url).startsWith(WORKER_ORIGIN) ? fetch(r.workerOrigin + new URL(url).pathname, init) : providerFetch(url, init) };
 execFileSync('ln', ['-s', r.github.root, join(dir, 'github-root-link')]);
 const work = await mkdtemp(join(tmpdir(), 'git-ssh-agent-')); cleanups.push(() => rm(work, { recursive: true, force: true }));
 const sh = command => run('sh', ['-c', command], { cwd: work, env: r.agentEnv });
 const git = (cwd, ...args) => run('git', ['-c', 'user.name=Agent', '-c', 'user.email=agent@example.test', ...args], { cwd, env: r.agentEnv });
 const out = parse(await handler({ repo: 'hello', access: 'write', requestKey: 'setup-' + randomBytes(4).toString('hex') }, w.ctx));
 expect(out).toMatchObject({ done: true, status: 'applied' });
 expect((await sh(out.result.command)).status).toBe(0);
 expect((await git(work, 'clone', '-q', out.result.remote_url, 'hello')).status).toBe(0);
 const repo = join(work, 'hello');
 const commit = async (name, text) => { await writeFile(join(repo, name), text); await git(repo, 'add', name); return git(repo, 'commit', '-qm', 'change ' + name); };
 const rows = async () => { const list = []; for (let id = 1; id < 60; id++) { const c = await w.db.getChange(id); if (c) list.push(c); } return list; };
 return { w, r, dk, fake, git, repo, commit, rows, sshTmp, dir, keyId: out.result.key_id };
}

const keyCalls = w => w.gh.calls.filter(c => /\/keys/.test(c.route ?? '')).map(c => c.route.split(' ')[0] + (c.route.endsWith('{key_id}') ? ' one' : ' all'));

describe('the SSH leg: add a deploy key, push over SSH, remove it', () => {
 it('adds a write deploy key on exactly this repository, pushes over ssh.github.com:443, removes it and reads back that it is gone; access changes and timings are in the change log; the private key appears nowhere', async () => {
  const t = await world();
  await t.commit('feature.txt', 'over ssh\n');
  const pushed = await t.git(t.repo, 'push', 'origin', 'HEAD:refs/heads/agent/ssh');
  expect(pushed.status, pushed.stderr).toBe(0);
  expect(pushed.stderr).toMatch(/remote: Sent to GitHub over SSH in \d+(\.\d)? s\./);
  expect(pushed.stderr).toMatch(/remote: Pushed to GitHub example-org\/hello: created branch agent\/ssh\./);
  expect(t.r.github.log('rev-parse', 'refs/heads/agent/ssh')).toBe(gitIn(t.repo, 'rev-parse', 'HEAD'));
  // Order: sweep list, add, (push), then get, delete, get (read back: 404).
  expect(keyCalls(t.w)).toEqual(['GET all', 'POST all', 'GET one', 'DELETE one', 'GET one']);
  const ssh = await t.fake.entries();
  expect(ssh).toEqual([{ host: 'git@ssh.github.com', port: '443', command: "git-receive-pack '/example-org/hello.git'", keyAllowed: true }]);
  // Nothing went to the HTTPS git host's receive-pack; the read-back did use HTTPS.
  expect(t.r.github.seen.some(s => s.path.endsWith('/git-receive-pack'))).toBe(false);
  expect(t.r.github.seen.some(s => s.query === '?service=git-upload-pack')).toBe(true);
  const added = t.w.gh.calls.find(c => c.route === 'POST /repos/{owner}/{repo}/keys');
  expect(added.params).toEqual({ owner: 'example-org', repo: 'hello' });
  expect(added.body).toMatchObject({ read_only: false });
  expect(added.body.title).toMatch(PUSH_KEY_TITLE);
  expect(validPublicKey(added.body.key)).toBe(true);
  expect(t.dk.state.keys.size).toBe(0);
  // Change log: the key's add and removal are access changes, with who and which repository; the push row has the timings.
  const rows = await t.rows();
  // (The change-log listing is what github_change_log reads; it carries the access-change mark.)
  const keyRows = (await t.w.db.listChanges({ tool: 'github_git_remote_deploy_key', limit: 100 })).reverse();
  expect(keyRows.map(c => c.summary)).toEqual([
   expect.stringMatching(/^Added a temporary write deploy key "GitHub Unleashed push [a-f0-9]{12} \(auto-removed\)" to example-org\/hello for one git push over SSH/),
   expect.stringMatching(/^Removed the temporary write deploy key "GitHub Unleashed push [a-f0-9]{12} \(auto-removed\)" from example-org\/hello after the push \(read back: gone\)$/)]);
  expect(keyRows.every(c => c.accessWidening === true && c.repo === 'example-org/hello' && c.after.acted_as === 'app' && c.confirmed === true)).toBe(true);
  expect(keyRows[1].after).toMatchObject({ action: 'remove', verified_absent: true });
  const push = rows.find(c => c.tool === 'github_git_remote_push');
  expect(push.confirmed).toBe(true);
  expect(push.after).toMatchObject({ outcome: 'applied', remote_verified: true, transport: 'ssh', deploy_key_removed: true });
  for (const k of ['scan_ms', 'key_ms', 'push_ms', 'readback_ms', 'total_ms']) expect(Number.isSafeInteger(push.after.timing[k]), k).toBe(true);
  expect(push.after.timing.total_ms).toBeGreaterThanOrEqual(push.after.timing.push_ms);
  // The private key: handed to ssh only, deleted after the push, in no output, log, request, change row or report.
  const privateKey = await readFile(t.fake.captured, 'utf8');
  expect(privateKey).toMatch(/PRIVATE KEY/);
  const body = privateKey.split('\n').filter(l => l && !l.startsWith('-----')).join('');
  const seen = JSON.stringify({ stderr: pushed.stderr, stdout: pushed.stdout, rows, api: t.r.api.calls, gh: t.w.gh.calls, uses: await t.w.db.listGitRemoteUses(t.keyId, { limit: 200 }) });
  for (const piece of [body.slice(0, 40), body.slice(40, 80), body.slice(-40)]) expect(seen).not.toContain(piece);
  expect(await readdir(t.sshTmp)).toEqual([]);
  expect(t.w.gh.invalid).toEqual([]);
 }, 120000);

 it('removes the key when GitHub refuses the push (protected branch), and reports the refusal', async () => {
  const t = await world({ sshPort: 22 });
  await t.commit('p.txt', 'protected\n');
  const pushed = await t.git(t.repo, 'push', 'origin', 'HEAD:protected');
  expect(pushed.status).not.toBe(0);
  expect(pushed.stderr).toMatch(/GitHub refused the push to example-org\/hello/);
  expect((await t.fake.entries())[0]).toMatchObject({ host: 'git@github.com', keyAllowed: true });
  expect(keyCalls(t.w)).toEqual(['GET all', 'POST all', 'GET one', 'DELETE one', 'GET one']);
  expect(t.dk.state.keys.size).toBe(0);
  const push = (await t.rows()).find(c => c.tool === 'github_git_remote_push');
  expect(push.after).toMatchObject({ outcome: 'rejected', transport: 'ssh', deploy_key_removed: true });
  expect(await readdir(t.sshTmp)).toEqual([]);
 }, 120000);

 it('when GitHub cannot be reached over SSH, removes the key, reads back that nothing changed, and sends the same leased push over HTTPS', async () => {
  const t = await world();
  await writeFile(join(t.dir, 'ssh-down'), '');
  await t.commit('d.txt', 'down\n');
  const pushed = await t.git(t.repo, 'push', 'origin', 'HEAD:refs/heads/agent/down');
  expect(pushed.status, pushed.stderr).toBe(0);
  expect(pushed.stderr).toMatch(/remote: Sent to GitHub over HTTPS in/);
  expect(pushed.stderr).toMatch(/remote: SSH was not used for this push: GitHub could not be reached over SSH from this host; sent over HTTPS instead\./);
  expect(t.r.github.log('rev-parse', 'refs/heads/agent/down')).toBe(gitIn(t.repo, 'rev-parse', 'HEAD'));
  expect(keyCalls(t.w)).toEqual(['GET all', 'POST all', 'GET one', 'DELETE one', 'GET one']);
  expect(t.dk.state.keys.size).toBe(0);
  expect((await t.rows()).find(c => c.tool === 'github_git_remote_push').after).toMatchObject({ outcome: 'applied', transport: 'https', deploy_key_removed: true, transport_note: expect.stringMatching(/sent over HTTPS instead/) });
 }, 120000);

 it('falls back to HTTPS and says why when the credential cannot add deploy keys (403) or the organization turns them off (422)', async () => {
  for (const [status, why] of [[403, /cannot add deploy keys to this repository \(GitHub needs Administration write\)/], [422, /policy turns deploy keys off/]]) {
   const t = await world({ keys: { addStatus: status } });
   await t.commit(`f${status}.txt`, 'fallback\n');
   const pushed = await t.git(t.repo, 'push', 'origin', `HEAD:refs/heads/agent/fallback-${status}`);
   expect(pushed.status, pushed.stderr).toBe(0);
   expect(pushed.stderr).toMatch(/remote: Sent to GitHub over HTTPS in/);
   expect(pushed.stderr).toMatch(new RegExp('remote: SSH was not used for this push: .*' + why.source));
   expect(await t.fake.entries()).toEqual([]);
   expect(t.r.github.seen.some(s => s.path.endsWith('/git-receive-pack'))).toBe(true);
   expect(keyCalls(t.w)).toEqual(['GET all', 'POST all']);
   const rows = await t.rows();
   expect(rows.filter(c => c.tool === 'github_git_remote_deploy_key')).toEqual([]);
   expect(rows.find(c => c.tool === 'github_git_remote_push').after).toMatchObject({ outcome: 'applied', transport: 'https', transport_note: expect.stringMatching(why) });
   expect(await readdir(t.sshTmp)).toEqual([]);
   for (const c of cleanups.splice(0).reverse()) await c();
  }
 }, 180000);

 it('a removal that keeps failing is recorded and retried by the worker timer until the key is gone', async () => {
  const t = await world({ keys: { deleteFails: 3 } });
  await t.commit('r.txt', 'retry\n');
  const pushed = await t.git(t.repo, 'push', 'origin', 'HEAD:refs/heads/agent/retry');
  expect(pushed.status, pushed.stderr).toBe(0);
  expect(pushed.stderr).toMatch(/remote: The temporary deploy key could not be removed from GitHub yet; this worker keeps retrying/);
  expect(t.dk.state.keys.size).toBe(1);
  const leftover = join(t.r.root, '.remote-ssh-cleanup');
  const files = await readdir(leftover);
  expect(files).toEqual([`${[...t.dk.state.keys.keys()][0]}.json`]);
  const record = JSON.parse(await readFile(join(leftover, files[0]), 'utf8'));
  expect(Object.keys(record).sort()).toEqual(['actedAs', 'at', 'broker', 'claim', 'journal', 'keyId', 'n']);
  const failed = (await t.rows()).filter(c => c.tool === 'github_git_remote_deploy_key' && /^FAILED/.test(c.summary));
  expect(failed.length).toBe(3);
  expect((await t.rows()).find(c => c.tool === 'github_git_remote_push').after).toMatchObject({ deploy_key_removed: false });
  // The minute timer's step (GitHub answers again now).
  expect(await removeLeftoverKeys(t.r.root, { callBroker })).toEqual({ removed: 1, kept: 0 });
  expect(t.dk.state.keys.size).toBe(0);
  expect(await readdir(leftover)).toEqual([]);
  expect((await t.rows()).filter(c => c.tool === 'github_git_remote_deploy_key').at(-1).summary).toMatch(/^Removed the temporary write deploy key/);
 }, 120000);

 it('the sweep removes only this service\'s marked keys older than 15 minutes, never anyone else\'s', async () => {
  const t = await world();
  const old = new Date(t.w.ctx.now() - 20 * MIN).toISOString(), recent = new Date(t.w.ctx.now() - 5 * MIN).toISOString();
  const pub = () => { const k = execFileSync('sh', ['-c', `d=$(mktemp -d) && ssh-keygen -q -t ed25519 -N '' -f "$d/k" && cat "$d/k.pub" && rm -rf "$d"`]).toString().trim(); return k.split(' ').slice(0, 2).join(' '); };
  await t.dk.state.seed({ id: 11, key: pub(), title: pushKeyTitle('aaaaaaaaaaaa'), read_only: false, created_at: old });
  await t.dk.state.seed({ id: 12, key: pub(), title: pushKeyTitle('bbbbbbbbbbbb'), read_only: false, created_at: recent });
  await t.dk.state.seed({ id: 13, key: pub(), title: 'deploy bot', read_only: false, created_at: old });
  await t.dk.state.seed({ id: 14, key: pub(), title: 'GitHub Unleashed push aaaaaaaaaaaa (auto-removed) copy', read_only: true, created_at: old });
  await t.commit('s.txt', 'sweep\n');
  const pushed = await t.git(t.repo, 'push', 'origin', 'HEAD:refs/heads/agent/sweep');
  expect(pushed.status, pushed.stderr).toBe(0);
  expect([...t.dk.state.keys.keys()].sort()).toEqual([12, 13, 14]);
  const swept = (await t.rows()).filter(c => c.tool === 'github_git_remote_deploy_key' && c.after.action === 'sweep');
  expect(swept.map(c => c.after.key_id)).toEqual([11]);
  expect(t.w.gh.invalid).toEqual([]);
 }, 120000);

 it('HTTP version setting reaches the outbound HTTPS git commands and the change log', async () => {
  const t = await world({ transport: 'https', httpVersion: 'HTTP/1.1' });
  await t.commit('h.txt', 'http\n');
  const pushed = await t.git(t.repo, 'push', 'origin', 'HEAD:refs/heads/agent/http');
  expect(pushed.status, pushed.stderr).toBe(0);
  expect(pushed.stderr).toMatch(/remote: Sent to GitHub over HTTPS in/);
  expect(pushed.stderr).not.toMatch(/SSH was not used/);
  expect(keyCalls(t.w)).toEqual([]);
  expect((await t.rows()).find(c => c.tool === 'github_git_remote_push').after).toMatchObject({ transport: 'https', http_version: 'HTTP/1.1', timing: expect.any(Object) });
 }, 120000);
});

describe('SSH leg settings and safety pieces', () => {
 it('parses the transport, port and HTTP version settings, defaulting to HTTPS and git\'s own HTTP version', () => {
  expect(transportSettings({})).toEqual({ transport: 'https', sshPort: 443, httpVersion: null, problems: [] });
  expect(transportSettings({ NATIVE_GIT_GITHUB_TRANSPORT: 'SSH', NATIVE_GIT_GITHUB_SSH_PORT: '22', NATIVE_GIT_GITHUB_HTTP_VERSION: 'http/2' })).toEqual({ transport: 'ssh', sshPort: 22, httpVersion: 'HTTP/2', problems: [] });
  const odd = transportSettings({ NATIVE_GIT_GITHUB_TRANSPORT: 'ftp', NATIVE_GIT_GITHUB_SSH_PORT: '2222', NATIVE_GIT_GITHUB_HTTP_VERSION: 'HTTP/3' });
  expect(odd).toMatchObject({ transport: 'https', sshPort: 443, httpVersion: null });
  expect(odd.problems).toHaveLength(3);
  expect(httpVersionArgs('HTTP/1.1')).toEqual(['-c', 'http.version=HTTP/1.1']);
  expect(httpVersionArgs('HTTP/2')).toEqual(['-c', 'http.version=HTTP/2']);
  expect(httpVersionArgs(null)).toEqual([]);
  expect(httpVersionArgs('HTTP/1.1 -c core.sshCommand=x')).toEqual([]);
  expect(githubSshRemote('o', 'r', 443)).toBe('ssh://git@ssh.github.com:443/o/r.git');
  expect(githubSshRemote('o', 'r', 22)).toBe('ssh://git@github.com/o/r.git');
 });

 it('the worker and broker agree on the key title marker, and only exact titles match', () => {
  expect(WORKER_TITLE.source).toBe(PUSH_KEY_TITLE.source);
  expect(workerTitle('0123456789ab')).toBe(pushKeyTitle('0123456789ab'));
  expect(PUSH_KEY_TITLE.test(pushKeyTitle('0123456789ab'))).toBe(true);
  for (const t of ['GitHub Unleashed push 0123456789ab', 'x GitHub Unleashed push 0123456789ab (auto-removed)', 'GitHub Unleashed push 0123456789AB (auto-removed)']) expect(PUSH_KEY_TITLE.test(t)).toBe(false);
  expect(addRefusal({ status: 403 })).toMatch(/Administration write/);
  expect(addRefusal({ status: 422, response: { data: { message: 'Deploy keys are disabled for this repository' } } })).toMatch(/policy/);
 });

 it('pins exactly GitHub\'s published host keys (their SHA256 fingerprints) and never turns strict checking off', () => {
  const fingerprint = b64 => 'SHA256:' + createHash('sha256').update(Buffer.from(b64, 'base64')).digest('base64').replace(/=+$/, '');
  expect(GITHUB_SSH_HOST_KEYS.map(([, k]) => fingerprint(k))).toEqual(['SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU', 'SHA256:p2QAMXNIC1TJYWeIOttrVc98/R1BUFWu3/LiyKgUfQM', 'SHA256:uNiVztksCsDhcc0u9e8BujQXVUpKZIDTMczCvj3tD2s']);
  expect(knownHostsText().split('\n').filter(Boolean).every(l => l.startsWith('github.com,ssh.github.com,[ssh.github.com]:443 '))).toBe(true);
  const cmd = sshCommand({ keyFile: '/dev/shm/robinson-ssh-x/id', knownHostsFile: '/dev/shm/robinson-ssh-x/known_hosts' });
  expect(cmd).toContain('-o StrictHostKeyChecking=yes');
  expect(cmd).toContain('-o UserKnownHostsFile=/dev/shm/robinson-ssh-x/known_hosts -o GlobalKnownHostsFile=/dev/null');
  expect(cmd).not.toMatch(/StrictHostKeyChecking=(no|accept-new|off)/i);
  expect(() => sshCommand({ keyFile: "/tmp/a'; rm -rf /", knownHostsFile: '/tmp/k' })).toThrow();
  expect(sshProblem('Host key verification failed.')).toMatch(/did not match the pinned keys/);
 });

 it('the real ssh client refuses a server whose host key is not GitHub\'s', async () => {
  const sshd = ['/usr/sbin/sshd', '/usr/bin/sshd'].find(p => existsSync(p));
  expect(sshd, 'OpenSSH server binary for this check').toBeTruthy();
  // Run as root (a local sandbox), sshd wants its privilege separation folder; as a normal user (CI) it does not.
  if (process.getuid?.() === 0) await mkdir('/run/sshd', { recursive: true, mode: 0o755 });
  const dir = await mkdtemp(join(tmpdir(), 'git-ssh-hostkey-')); cleanups.push(() => rm(dir, { recursive: true, force: true }));
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', join(dir, 'host')]);
  const port = await new Promise(resolve => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  await writeFile(join(dir, 'sshd_config'), `Port ${port}\nListenAddress 127.0.0.1\nHostKey ${join(dir, 'host')}\nPidFile ${join(dir, 'pid')}\nStrictModes no\nUsePAM no\nAuthorizedKeysFile /dev/null\n`);
  const server = spawn(sshd, ['-D', '-e', '-f', join(dir, 'sshd_config')], { stdio: ['ignore', 'ignore', 'pipe'] });
  let said = ''; server.stderr.on('data', c => { said += c; });
  cleanups.push(() => server.kill('SIGKILL'));
  for (let i = 0; i < 50; i++) { const ok = await new Promise(r => { const c = connect(port, '127.0.0.1', () => { c.destroy(); r(true); }); c.on('error', () => r(false)); }); if (ok) break; await new Promise(r => setTimeout(r, 100)); }
  const key = await ephemeralKey({ base: dir });
  cleanups.push(key.dispose);
  // The same command git runs, with this local server standing in for ssh.github.com (HostKeyAlias keeps the pinned name).
  const result = await run('sh', ['-c', `${key.env.GIT_SSH_COMMAND} -o HostKeyAlias=ssh.github.com -p ${port} git@127.0.0.1 true`], { env: { PATH: process.env.PATH } });
  expect(result.status).not.toBe(0);
  expect(result.stderr, said).toMatch(/Host key verification failed|host key/i);
  expect(sshProblem(result.stderr)).toMatch(/did not match the pinned keys/);
 }, 60000);

 it('the change-log transport fields take numbers and fixed words only', () => {
  expect(transportReport({ transport: 'ssh', timing: { scan_ms: 5, push_ms: 18000, key_ms: -1, total_ms: 'x', readback_ms: 2.5 }, transportNote: 'a\nb', httpVersion: 'HTTP/9', deployKeyRemoved: true }))
   .toEqual({ transport: 'ssh', deploy_key_removed: true, transport_note: 'a b', timing: { scan_ms: 5, push_ms: 18000 } });
  expect(transportReport({ transport: 'telnet' })).toEqual({});
 });
});
