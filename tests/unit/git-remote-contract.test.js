// GIT-REMOTE-1: github_git_remote_setup passes the nine write-contract checks through every door
// (handler, MCP dispatch, github_call), and its one-time setup command really works from every door.
import { afterEach, it, expect } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runWriteContract, makeWorld, parse, doorsFor } from '../../test/helpers/write-contract.js';
import { startGitRemote, run, WORKER } from '../../test/helpers/git-remote-world.js';
import * as gitRemote from '../../src/tools/git-remote.js';

const cleanups = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
const definition = { tool: gitRemote.tools[0], handler: gitRemote.handlers.github_git_remote_setup };
const arrange = (gh, outcome) => { gh.gitRemoteOutcome = outcome; gh.when('GET /repos/{owner}/{repo}').reply(200, { full_name: 'example-org/hello', default_branch: 'main', permissions: { pull: true, push: true } }); };
async function prepare(w) {
 await w.db.createAccessToken({ accessToken: 'FAKE-access-token-contract', refreshToken: 'FAKE-refresh-token-contract', clientId: 'client-1', defaultAccount: 'example-org', accounts: ['example-org'], mode: 'production', profile: 'full', listing: 'compact' });
 const r = await startGitRemote(w); cleanups.push(r.close);
 const providerFetch = w.gh.fetch;
 w.ctx = { ...w.ctx, env: r.env, fetch: async (url, init) => String(url).startsWith(WORKER + '/') ? fetch(r.workerOrigin + new URL(url).pathname, init) : providerFetch(url, init) };
 // The dispatch doors build their own context from these.
 w.gh.fetch = w.ctx.fetch; w.remote = r;
 if (w.gh.gitRemoteOutcome === 'mismatch') { const get = w.db.getGitRemoteKey; w.db.getGitRemoteKey = async id => { const row = await get(id); return row && { ...row, access: row.access === 'write' ? 'read' : 'write' }; }; }
}

runWriteContract({ label: 'github_git_remote_setup', definition, args: { repo: 'hello', access: 'write' }, arrange, needsConfirm: true, profile: 'full', expectedWrites: 0, prepare });

it('every door issues a working one-time setup command; a replay never shows it again', async () => {
 for (const door of doorsFor(definition)) {
  const w = await makeWorld({ profile: 'full', mode: 'production', gates: [] }); arrange(w.gh, 'ok'); await prepare(w);
  w.ctx = { ...w.ctx }; const env = w.ctx.env;
  const out = parse(await door.call({ ...w, ctx: { ...w.ctx, env } }, { repo: 'hello', access: 'write', requestKey: 'door-' + door.name }));
  expect(out, door.name).toMatchObject({ status: 'applied', result: { remote_url: 'https://mcp.example.test/git/example-org/hello.git' } });
  const work = await mkdtemp(join(tmpdir(), 'git-remote-door-')); cleanups.push(() => rm(work, { recursive: true, force: true }));
  const ran = await run('sh', ['-c', out.result.command], { cwd: work, env: w.remote.agentEnv });
  expect(ran.status, door.name + ran.stderr).toBe(0);
  expect(await readFile(join(w.remote.home, '.git-credentials-robinson'), 'utf8')).toMatch(/^https:\/\/x-robinson-git:rgk_[a-f0-9]{32}_[A-Za-z0-9_-]{43}@mcp\.example\.test\/git\/example-org\/hello\.git\n$/);
  const cloned = await run('git', ['clone', '-q', out.result.remote_url, 'repo'], { cwd: work, env: w.remote.agentEnv });
  expect(cloned.status, door.name + cloned.stderr).toBe(0);
  const again = parse(await door.call(w, { repo: 'hello', access: 'write', requestKey: 'door-' + door.name }));
  expect(again).toMatchObject({ status: 'replayed', replayed: true });
  expect(JSON.stringify(again)).not.toMatch(/rgc_[a-f0-9]{32}_/);
 }
}, 120000);
