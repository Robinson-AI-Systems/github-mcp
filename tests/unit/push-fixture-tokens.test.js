// PUSH-FIXTURE-1: documented FAKE test tokens pass the push/write content gates; real credentials do not.
// Every token-shaped input below is built at runtime (join), so this file itself carries no token literal.
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { activeProtectionReport, containsCredential, credentialLocations, redact, withRepositoryProtection } from '../../src/github/content-protection.js';
import { findingFor } from '../../workers/native-git/upload.js';
import { gitCommand } from '../../src/native-git/commands.js';
import { makeWorld, parse } from '../../test/helpers/write-contract.js';
import { startGitRemote, run, WORKER } from '../../test/helpers/git-remote-world.js';
import * as gitRemote from '../../src/tools/git-remote.js';

const PUSH = { fixtures: 'allow' };
const tok = (prefix, payload) => [prefix, payload].join('_');
const FIXTURES = [tok('ghp', 'FAKE0123456789abcdefghijklmnopqrstuv'), tok('ghs', 'FAKEinstallationtoken1'), tok('ghu', 'FAKE-marketplace-0001'),
 tok('gho', 'FAKE.with.dots'), tok('ghr', 'FAKErefresh1'), tok('github_pat', 'FAKE0123456789abcdefghij'), tok('ghp', 'FAKE')];
const REAL = tok('ghp', 'Zx9' + 'aB3dE5fG7hJ9kL1mN3pQ5rS7tU9vW1xY3z');
const SMUGGLED = [tok('ghp', 'FAKE' + REAL), tok('ghp', 'FAKE-' + tok('github_pat', 'A1b2C3d4E5f6G7h8')), tok('github_pat', 'FAKE' + tok('ghs', 'abcd1234')),
 tok('ghp', 'FAKE' + tok('rtc_pass', 'x')), tok('ghp', 'FAKEx' + tok('tac', 'y')), tok('ghp', 'FAKEx' + tok('rgk', 'y'))];
const PRIVATE_KEY = ['-----BEGIN RSA', 'PRIVATE KEY-----\nMIIEow\n-----END RSA', 'PRIVATE KEY-----'].join(' ');
// Credential-style key names are built at runtime too, so this file carries no credential assignment literal.
const key = (...parts) => parts.join('_');
const DB_PASSWORD = `export const ${key('db', 'pass' + 'word')} = "` + 'h7Kq2Lp9Xw4Zr' + '";\n';
const CLIENT_SECRET = key('client', 'sec' + 'ret'), ACCESS_TOKEN = key('access', 'tok' + 'en');

describe('content protection: documented fixtures in pushed or written file content', () => {
 it('allows each FAKE fixture shape only with {fixtures:"allow"}', () => {
  for (const value of FIXTURES) {
   const file = `const token = '${value}';\n`;
   expect(containsCredential(file, PUSH), value).toBe(false);
   expect(activeProtectionReport(file, PUSH).total_findings).toBe(0);
   expect(containsCredential(file), value).toBe(true); // arguments, results and every other caller still match
  }
 });
 it('still refuses a real-shaped token, a FAKE prefix smuggling another credential, and lowercase "fake"', () => {
  for (const value of [REAL, ...SMUGGLED, tok('ghp', 'fake0123456789abcdef'), tok('ghp', 'Fake0123456789abcdef'), tok('ghp', 'XFAKE0123456789')]) {
   expect(containsCredential(`x = ${value}\n`, PUSH), value).toBe(true);
  }
  const report = activeProtectionReport(`a ${FIXTURES[0]}\nb ${SMUGGLED[0]}\n`, PUSH);
  expect(report.findings.map(f => [f.line, f.rule])).toEqual([[2, 'github-token']]);
  expect(credentialLocations(`a ${FIXTURES[0]}\nb ${REAL}\n`, PUSH)).toBe('line 2 (github-token)');
 });
 it('leaves private keys, database passwords, generic assignments and custom rules unchanged', () => {
  expect(containsCredential(PRIVATE_KEY, PUSH)).toBe(true);
  expect(containsCredential(DB_PASSWORD, PUSH)).toBe(true);
  expect(containsCredential(`${CLIENT_SECRET} = "Qw8eR7tY6uI5oP4aS3dF2"\n`, PUSH)).toBe(true);
  // A fixture assigned to a credential key is judged by the token rule alone; another value there is still caught.
  expect(containsCredential(`${ACCESS_TOKEN} = "${FIXTURES[0]}"\n`, PUSH)).toBe(false);
  expect(containsCredential(`${ACCESS_TOKEN} = "${FIXTURES[0]}-Qw8eR7tY6uI5oP4aS3dF2"\n`, PUSH)).toBe(false);
  expect(containsCredential(`${ACCESS_TOKEN} = "x${FIXTURES[0]}Qw8eR7tY6uI5oP"\n`, PUSH)).toBe(true);
  const custom = [{ type: 'prefix', id: 'repo-fake-prefix', label: 'repo rule', prefix: 'FAKE', alphabet: 'alnum', minLength: 8, maxLength: 64 }];
  expect(withRepositoryProtection(custom, () => containsCredential(`t = ${FIXTURES[0]}`, PUSH))).toBe(true);
  // The documented fake key header is not a PRIVATE KEY block at all.
  expect(containsCredential('-----BEGIN FAKE KEY-----\nabc\n-----END FAKE KEY-----\n')).toBe(false);
 });
 it('redaction still hides FAKE tokens in text returned to AIs', () => {
  for (const value of FIXTURES) expect(redact(`leaked ${value} here`)).not.toContain(value);
  expect(redact(JSON.stringify({ token: FIXTURES[5] }))).not.toContain('FAKE0123');
 });
});

describe('PUSH-FIXTURE-1 doors', () => {
 it('workspace upload, git remote and direct host scanner (findingFor) allow fixtures and refuse real values', () => {
  expect(findingFor('tests/a.test.js', Buffer.from(FIXTURES.map(v => `'${v}'`).join('\n')))).toBeNull();
  expect(findingFor('tests/b.test.js', Buffer.from(`ok '${FIXTURES[0]}'\nbad '${SMUGGLED[0]}'\n`))).toMatchObject({ path: 'tests/b.test.js', rules: ['github-token'], lines: ['line 2 (github-token)'] });
  expect(findingFor('k.pem', Buffer.from(PRIVATE_KEY))).toMatchObject({ rules: ['private-key'] });
  expect(findingFor('db.js', Buffer.from(DB_PASSWORD))).toMatchObject({ rules: ['database-password-assignment'] });
 });
 it('workspace write_file allows fixture file content but never a token in the arguments themselves', () => {
  const b64 = text => Buffer.from(text).toString('base64');
  expect(() => gitCommand('write_file', { path: 'tests/a.test.js', base64: b64(`'${FIXTURES[0]}'\n`) })).not.toThrow();
  expect(() => gitCommand('write_file', { path: 'tests/a.test.js', base64: b64(`'${REAL}'\n`) })).toThrow(/Credential-shaped file input belongs in protected setup, not tool arguments \(matched at line 1 \(github-token\)/);
  expect(() => gitCommand('write_file', { path: 'tests/a.test.js', base64: b64(`'${SMUGGLED[0]}'\n`) })).toThrow(/Credential-shaped file input/);
  expect(() => gitCommand('write_file', { path: FIXTURES[0], base64: b64('x') })).toThrow(/Credential-shaped native input/);
 });
});

const cleanups = [];
afterEach(async () => { for (const c of cleanups.splice(0).reverse()) await c(); });
async function remoteWorld() {
 const w = await makeWorld({ profile: 'full', mode: 'production', gates: [] });
 w.gh.when('GET /repos/{owner}/{repo}').reply(200, { full_name: 'example-org/hello', default_branch: 'main', permissions: { pull: true, push: true } });
 await w.db.createAccessToken({ accessToken: 'FAKE-access-token-push-fixture', refreshToken: 'FAKE-refresh-token-push-fixture', clientId: 'client-1', defaultAccount: 'example-org', accounts: ['example-org'], mode: 'production', profile: 'full', listing: 'compact' });
 const r = await startGitRemote(w, { gates: [] }); cleanups.push(r.close);
 const providerFetch = w.gh.fetch;
 w.ctx = { ...w.ctx, env: r.env, fetch: async (url, init) => String(url).startsWith(WORKER + '/') ? fetch(r.workerOrigin + new URL(url).pathname, init) : providerFetch(url, init) };
 const work = await mkdtemp(join(tmpdir(), 'push-fixture-')); cleanups.push(() => rm(work, { recursive: true, force: true }));
 const git = (cwd, ...args) => run('git', ['-c', 'user.name=Agent', '-c', 'user.email=agent@example.test', ...args], { cwd, env: r.agentEnv });
 return { w, r, work, git, sh: command => run('sh', ['-c', command], { cwd: work, env: r.agentEnv }) };
}

describe('the git remote push gate with fixtures (end to end)', () => {
 it('pushes a test file of FAKE fixtures to GitHub; a smuggled real token is still refused before GitHub', async () => {
  const t = await remoteWorld();
  const out = parse(await gitRemote.handlers.github_git_remote_setup({ repo: 'hello', access: 'write', requestKey: 'setup-' + randomBytes(4).toString('hex') }, t.w.ctx));
  expect((await t.sh(out.result.command)).status).toBe(0);
  const repo = join(t.work, 'hello');
  expect((await t.git(t.work, 'clone', '-q', out.result.remote_url, 'hello')).status).toBe(0);
  await writeFile(join(repo, 'fixtures.test.js'), FIXTURES.map((v, i) => `export const T${i} = '${v}';`).join('\n') + '\n');
  await t.git(repo, 'add', '.'); await t.git(repo, 'commit', '-qm', 'fixtures');
  const ok = await t.git(repo, 'push', 'origin', 'HEAD:refs/heads/fixtures');
  expect(ok.status, ok.stderr).toBe(0);
  expect(t.r.github.log('rev-parse', 'refs/heads/fixtures').trim()).toBe((await t.git(repo, 'rev-parse', 'HEAD')).stdout.trim());
  const before = t.r.github.log('for-each-ref', '--format=%(refname) %(objectname)');
  await writeFile(join(repo, 'leak.js'), `export const t = '${SMUGGLED[0]}';\n`);
  await t.git(repo, 'add', '.'); await t.git(repo, 'commit', '-qm', 'leak');
  const leak = await t.git(repo, 'push', 'origin', 'HEAD:refs/heads/leak');
  expect(leak.status).not.toBe(0);
  expect(leak.stderr).toMatch(/remote: Refused: content protection found credential-shaped content in 1 file\(s\) or commit message\(s\), first "leak\.js" \(line 1 \(github-token\)\)/);
  expect(leak.stderr).not.toContain(REAL);
  expect(t.r.github.log('for-each-ref', '--format=%(refname) %(objectname)')).toBe(before);
 }, 120000);
});
