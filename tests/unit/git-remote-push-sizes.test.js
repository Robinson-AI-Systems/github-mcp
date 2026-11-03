// RELAY-BODY-1: plain `git push` through the service domain, at every size measured live on 2026-11-03
// (8 KB ok, 20 KB to 200 KB corrupted or cut off, 800 KB and 2 MB ok). Real git client, the exact setup
// command (http.postBuffer included), the real Routing Middleware, a stand-in for the Go reverse proxy in
// front of the PC worker (Tailscale Funnel: test/helpers/go-front-proxy.js), the real worker and its real
// pre-receive hook, to a fake GitHub served by git http-backend. Each push must arrive byte-exact.
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeWorld, parse } from '../../test/helpers/write-contract.js';
import { startGitRemote, gitIn, run, WORKER } from '../../test/helpers/git-remote-world.js';
import { GO_MAX_POST_HANDLER_READ_BYTES } from '../../test/helpers/go-front-proxy.js';
import * as gitRemote from '../../src/tools/git-remote.js';

const handler = gitRemote.handlers.github_git_remote_setup;
const cleanups = [];
afterEach(async () => { for (const c of cleanups.splice(0).reverse()) await c(); });

async function world() {
 const w = await makeWorld({ profile: 'full', mode: 'production', gates: [] });
 w.gh.when('GET /repos/{owner}/{repo}').reply(200, { full_name: 'example-org/hello', default_branch: 'main', permissions: { pull: true, push: true } });
 await w.db.createAccessToken({ accessToken: 'FAKE-access-token-push-sizes', refreshToken: 'FAKE-refresh-token-push-sizes', clientId: 'client-1', defaultAccount: 'example-org', accounts: ['example-org'], mode: 'production', profile: 'full', listing: 'compact' });
 const r = await startGitRemote(w, { front: 'go' });
 cleanups.push(r.close);
 const providerFetch = w.gh.fetch;
 w.ctx = { ...w.ctx, env: r.env, fetch: async (url, init) => String(url).startsWith(WORKER + '/') ? fetch(r.workerOrigin + new URL(url).pathname, init) : providerFetch(url, init) };
 const work = await mkdtemp(join(tmpdir(), 'git-remote-sizes-')); cleanups.push(() => rm(work, { recursive: true, force: true }));
 const git = (cwd, ...args) => run('git', ['-c', 'user.name=Agent', '-c', 'user.email=agent@example.test', ...args], { cwd, env: r.agentEnv });
 return { w, r, work, git };
}

describe('RELAY-BODY-1: git push through the service domain arrives byte-exact at every size', () => {
 it('8 KB, 20 KB, 60 KB, 200 KB, 800 KB and 2 MB pushes (one new base64 file each) all land on GitHub unchanged', async () => {
  const t = await world();
  const out = parse(await handler({ repo: 'hello', access: 'write', requestKey: 'sizes-1' }, t.w.ctx));
  const ran = await run('sh', ['-c', out.result.command], { cwd: t.work, env: t.r.agentEnv });
  expect(ran.status, ran.stderr).toBe(0);
  expect((await t.git(t.work, 'clone', '-q', out.result.remote_url, 'hello')).status).toBe(0);
  const repo = join(t.work, 'hello');
  const sizes = { '8k': 8000, '20k': 20000, '60k': 60000, '200k': 200000, '800k': 800000, '2m': 2000000 };
  const packs = [];
  for (const [name, bytes] of Object.entries(sizes)) {
   // base64 of random bytes: as measured live (text that does not compress much).
   const content = randomBytes(Math.ceil(bytes * 3 / 4)).toString('base64').slice(0, bytes);
   await writeFile(join(repo, `probe-${name}.txt`), content);
   expect((await t.git(repo, 'add', '.')).status).toBe(0);
   expect((await t.git(repo, 'commit', '-qm', `probe ${name}`)).status).toBe(0);
   const before = t.r.seen.length;
   const pushed = await t.git(repo, 'push', 'origin', `HEAD:refs/heads/probe-${name}`);
   expect(pushed.status, `${name}: ${pushed.stderr}`).toBe(0);
   expect(pushed.stderr, name).toMatch(/remote: Pushed to GitHub example-org\/hello: created branch probe-/);
   // Byte-exact: what the client sent is exactly what the worker was given, and nothing was dropped in front.
   const pack = t.r.seen.slice(before).find(s => s.destination.endsWith('/v1/remote/git-receive-pack'));
   expect(pack, name).toBeTruthy();
   expect(pack.discarded, name).toBe(false);
   expect(pack.deliveredBytes, name).toBe(pack.clientBytes);
   expect(pack.deliveredSha, name).toBe(pack.clientSha);
   expect(pack.clientBytes, name).toBe(Number(pack.headers['content-length']));
   packs.push(pack.clientBytes);
   // GitHub has the very commit and the very file.
   const head = gitIn(repo, 'rev-parse', 'HEAD');
   expect(t.r.github.log('rev-parse', `refs/heads/probe-${name}`), name).toBe(head);
   expect(t.r.github.log('cat-file', '-p', `${head}:probe-${name}.txt`), name).toBe(content);
   expect(await readFile(join(repo, `probe-${name}.txt`), 'utf8')).toBe(content);
  }
  // The sizes really span the Go proxy's discard window (under 256 KiB unread) and beyond it.
  expect(packs.some(n => n > 16384 && n < GO_MAX_POST_HANDLER_READ_BYTES)).toBe(true);
  expect(packs.some(n => n > GO_MAX_POST_HANDLER_READ_BYTES)).toBe(true);
 }, 180000);
});
