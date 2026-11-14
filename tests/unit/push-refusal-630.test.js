// Issue #630 (2026-11-14): a credential-shaped value already on the default branch blocks the first push that
// touches its file; a commit on top that removes it does not clear the refusal. The refusal now says which values
// were already on GitHub, says plainly that a fixing commit will not help (with the non-rewriting route), and prints
// the exact owner exception call. Real git, the real worker and its real pre-receive hook, a fake GitHub served by
// git http-backend; every value is fake and built at runtime.
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeWorld, parse } from '../../test/helpers/write-contract.js';
import { startGitRemote, gitIn, run, WORKER } from '../../test/helpers/git-remote-world.js';
import * as gitRemote from '../../src/tools/git-remote.js';

const handler = gitRemote.handlers.github_git_remote_setup;
const cleanups = [];
afterEach(async () => { for (const c of cleanups.splice(0).reverse()) await c(); });

async function world() {
 const w = await makeWorld({ profile: 'full', mode: 'production', gates: [] });
 w.gh.when('GET /repos/{owner}/{repo}').reply(200, { full_name: 'example-org/hello', default_branch: 'main', permissions: { pull: true, push: true } });
 await w.db.createAccessToken({ accessToken: 'FAKE-access-token-630', refreshToken: 'FAKE-refresh-token-630', clientId: 'client-1', defaultAccount: 'example-org', accounts: ['example-org'], mode: 'production', profile: 'full', listing: 'compact' });
 const r = await startGitRemote(w, {});
 cleanups.push(r.close);
 const providerFetch = w.gh.fetch;
 const fetchVia = async (url, init) => String(url).startsWith(WORKER + '/') ? fetch(r.workerOrigin + new URL(url).pathname, init) : providerFetch(url, init);
 w.ctx = { ...w.ctx, env: r.env, fetch: fetchVia };
 const work = await mkdtemp(join(tmpdir(), 'push-630-')); cleanups.push(() => rm(work, { recursive: true, force: true }));
 const sh = (command, cwd = work) => run('sh', ['-c', command], { cwd, env: r.agentEnv });
 const git = (cwd, ...args) => run('git', ['-c', 'user.name=Agent', '-c', 'user.email=agent@example.test', ...args], { cwd, env: r.agentEnv });
 return { w, r, work, sh, git };
}

// A sample database address with a user and password, as an .env.example might carry (not FAKE-marked).
const SAMPLE = ['postgres', '://demo_user:', 'demo', 'Pass9921', '@localhost:5432/app'].join('');

describe('issue #630: values already on GitHub', () => {
 it('names the pre-existing value, says a fixing commit will not help, gives the non-rewriting route and the exact exception call', async () => {
  const t = await world();
  // Already on GitHub's main before any of this session's pushes (another route put it there).
  const seed = t.r.github.seed;
  await writeFile(join(seed, '.env.example'), `APP=1\nDATABASE_URL=${SAMPLE}\n`);
  gitIn(seed, 'add', '.env.example'); gitIn(seed, 'commit', '-qm', 'example env'); gitIn(seed, 'push', '-q', 'origin', 'main');

  const out = parse(await handler({ repo: 'hello', access: 'write', requestKey: 'setup-' + randomBytes(4).toString('hex') }, t.w.ctx));
  expect(out).toMatchObject({ done: true, status: 'applied' });
  expect((await t.sh(out.result.command)).status).toBe(0);
  const repo = join(t.work, 'hello');
  expect((await t.git(t.work, 'clone', '-q', out.result.remote_url, 'hello')).status).toBe(0);

  // A push that leaves the file alone goes through.
  await writeFile(join(repo, 'notes.txt'), 'n\n'); await t.git(repo, 'add', '.'); await t.git(repo, 'commit', '-qm', 'notes');
  const untouched = await t.git(repo, 'push', 'origin', 'HEAD:main');
  expect(untouched.status, untouched.stderr).toBe(0);

  // Touching the file (unrelated line) is refused, and the refusal says the value was already there.
  await writeFile(join(repo, '.env.example'), `APP=1\nDATABASE_URL=${SAMPLE}\nDEBUG=0\n`);
  await t.git(repo, 'add', '.'); await t.git(repo, 'commit', '-qm', 'debug flag');
  const touched = await t.git(repo, 'push', 'origin', 'HEAD:main');
  expect(touched.status).not.toBe(0);
  expect(touched.stderr).toMatch(/remote: Nothing was pushed to GitHub\. Remove the value from your commits: a new commit that removes it does not help, because every pushed commit is checked\./);
  expect(touched.stderr).toMatch(/remote: Without rewriting anything on GitHub: rebuild your change as one new commit on the remote tip without the value \(git fetch, git reset --soft origin\/main/);
  expect(touched.stderr).toMatch(/remote: Every value below was already on GitHub before this push/);
  expect(touched.stderr).toMatch(/remote:\s+"\.env\.example" blobSha [0-9a-f]{40} line 2 rule [a-z-]+ value_fingerprint [0-9a-f]{64} \(already on main before this push\)/);
  const call = /remote:\s+github_secret_scanner (\{.*\})\s*$/m.exec(touched.stderr);
  expect(call, touched.stderr).toBeTruthy();
  const parsed = JSON.parse(call[1]);
  expect(parsed).toMatchObject({ action: 'configure', args: { repo: 'hello', expectedRevision: expect.any(Number),
   verification: [expect.objectContaining({ door: 'push', path: '.env.example', expectedBefore: true, expectedAfter: false })],
   changes: { addSuppressions: [expect.objectContaining({ path: '.env.example', pushException: true })] } } });
  expect(parsed.args.verification[0].valueFingerprint).toBe(parsed.args.changes.addSuppressions[0].valueFingerprint);
  expect(touched.stderr).not.toContain('Pass9921');

  // A commit on top that removes the value is still refused (the earlier commit carries it): as the message says.
  await writeFile(join(repo, '.env.example'), 'APP=1\nDATABASE_URL=\nDEBUG=0\n');
  await t.git(repo, 'add', '.'); await t.git(repo, 'commit', '-qm', 'drop sample');
  expect((await t.git(repo, 'push', 'origin', 'HEAD:main')).status).not.toBe(0);
  // The route the message gives works without rewriting anything on GitHub.
  expect((await t.git(repo, 'fetch', '-q', 'origin')).status).toBe(0);
  expect((await t.git(repo, 'reset', '--soft', 'origin/main')).status).toBe(0);
  expect((await t.git(repo, 'commit', '-qm', 'debug flag, sample removed')).status).toBe(0);
  const rebuilt = await t.git(repo, 'push', 'origin', 'HEAD:main');
  expect(rebuilt.status, rebuilt.stderr).toBe(0);
 }, 120000);

 it('a value the push itself adds is not marked as pre-existing', async () => {
  const t = await world();
  const out = parse(await handler({ repo: 'hello', access: 'write', requestKey: 'setup-' + randomBytes(4).toString('hex') }, t.w.ctx));
  expect((await t.sh(out.result.command)).status).toBe(0);
  const repo = join(t.work, 'hello');
  expect((await t.git(t.work, 'clone', '-q', out.result.remote_url, 'hello')).status).toBe(0);
  await writeFile(join(repo, 'db.env'), `DATABASE_URL=${SAMPLE}\n`); await t.git(repo, 'add', '.'); await t.git(repo, 'commit', '-qm', 'db');
  const added = await t.git(repo, 'push', 'origin', 'HEAD:refs/heads/feature');
  expect(added.status).not.toBe(0);
  expect(added.stderr).toMatch(/remote:\s+"db\.env" blobSha [0-9a-f]{40} line 1 /);
  expect(added.stderr).not.toMatch(/already on/);
 }, 120000);
});
