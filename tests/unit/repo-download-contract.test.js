// SINGLE-DOMAIN-1 compound: github_repo_download = open-or-reuse a Git-only workspace + one-time
// download, in one call. The nine write-contract checks through every door, and real clones of the
// returned single-domain address (fresh clone and reuse) against a real local worker and relay.
import { afterEach, it, expect } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { runWriteContract, makeWorld, parse, doorsFor } from '../../test/helpers/write-contract.js';
import { prepareNativeWorld } from '../../test/helpers/native-git-world.js';
import * as native from '../../src/tools/native-git.js';
import { registry, COMPACT_DEVELOPER_TOOLS } from '../../src/tools/index.js';
import { toolsForListing } from '../../src/core/registry.js';

const spawnAsync = (cmd, args, opts) => new Promise(resolve => { const child = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] }); let stderr = ''; child.stderr.on('data', c => { stderr += c; }); child.on('close', status => resolve({ status, stderr })); });
const cleanups = [];
afterEach(async () => { for (const close of cleanups.splice(0)) await close(); });
const definition = { tool: native.tools.find(t => t.name === 'github_repo_download'), handler: native.handlers.github_repo_download };
const arrange = (gh, outcome) => { gh.nativeOutcome = outcome; gh.when('GET /repos/{owner}/{repo}').reply(200, { full_name: 'example-org/hello', default_branch: 'main' }); };
const ENV = { ...process.env, http_proxy: '', HTTP_PROXY: '', https_proxy: '', HTTPS_PROXY: '', ALL_PROXY: '', all_proxy: '', NO_PROXY: '*', no_proxy: '*', GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
async function world(existing) { const w = await makeWorld({ profile: 'full', mode: 'production', gates: [] }); arrange(w.gh, 'ok'); cleanups.push(await prepareNativeWorld(w, { existing })); return w; }
const clone = async (w, result) => {
 const dir = await mkdtemp(join(tmpdir(), 'repo-download-')); cleanups.push(() => rm(dir, { recursive: true, force: true }));
 const done = await spawnAsync('git', ['-c', 'http.followRedirects=false', 'clone', '--quiet', w.transferLocal(result.url), join(dir, 'repo')], { env: ENV });
 return { ...done, dir: join(dir, 'repo') };
};

runWriteContract({ label: 'github_repo_download (reuses the open workspace)', definition, args: { repo: 'hello', mode: 'git' }, arrange, needsConfirm: true, profile: 'full', expectedWrites: 0,
 prepare: async w => { cleanups.push(await prepareNativeWorld(w, { existing: true })); } });
runWriteContract({ label: 'github_repo_download archive', definition, args: { repo: 'hello', mode: 'archive' }, arrange, needsConfirm: true, profile: 'full', expectedWrites: 0,
 prepare: async w => { cleanups.push(await prepareNativeWorld(w, { existing: true })); } });

it('fresh repository through every door: clones a Git-only workspace, returns a single-domain clone command, a real clone works, and replay never re-issues it', async () => {
 for (const door of doorsFor(definition)) {
  const w = await world(false);
  const out = parse(await door.call(w, { repo: 'hello', requestKey: 'get-' + door.name }));
  expect(out, JSON.stringify(out)).toMatchObject({ status: 'applied', confirmed: true, result: { reused: false, state: 'awaiting', mode: 'git', single_use: true, workspace_id: expect.stringMatching(/^job_[a-f0-9]{16}$/) } });
  expect(new URL(out.result.url).origin).toBe('https://mcp.example.test');
  expect(out.result.command).toBe(`git -c http.followRedirects=false clone "${out.result.url}" repo`);
  expect(out.progress).toMatchObject({ command: out.result.command, if_blocked: expect.stringContaining('mcp.example.test') });
  expect(Buffer.byteLength(JSON.stringify(out.progress))).toBeLessThanOrEqual(1200);
  expect(w.nativeRequests.filter(a => a === 'open')).toHaveLength(1);
  const replay = parse(await door.call(w, { repo: 'hello', requestKey: 'get-' + door.name }));
  expect(replay).toMatchObject({ status: 'replayed' }); expect(JSON.stringify(replay)).not.toContain(new URL(out.result.url).pathname);
  const done = await clone(w, out.result);
  expect(done.status, done.stderr).toBe(0);
  expect(await readFile(join(done.dir, 'file.txt'), 'utf8')).toBe('fixture\n');
  expect(w.nativeRequests.filter(a => a === 'open')).toHaveLength(1);
  // The workspace it opened has no runtime and appears in the workspace list for upload later.
  const listed = await native.handlers.github_git_workspace_list({}, w.ctx);
  expect(JSON.stringify(listed)).toContain(out.result.workspace_id);
 }
}, 90000);

it('reuses the open workspace for the same repository (no second clone); fresh: true always clones', async () => {
 const w = await world(true);
 const reused = parse(await definition.handler({ repo: 'hello', mode: 'archive', requestKey: 'reuse' }, w.ctx));
 expect(reused).toMatchObject({ status: 'applied', result: { reused: true, workspace_id: 'job_0123456789abcdef', state: 'awaiting', mode: 'archive' } });
 expect(reused.result.command).toMatch(/^curl -fsS "https:\/\/mcp\.example\.test\/v1\/transfer\/d\/w\/.+" -o repo\.tar\.gz && mkdir -p repo && tar -xzf repo\.tar\.gz -C repo$/);
 const res = await fetch(w.transferLocal(reused.result.url)); expect(res.status).toBe(200);
 expect(execFileSync('tar', ['-tzf', '-'], { input: Buffer.from(await res.arrayBuffer()), encoding: 'utf8' }).trim()).toBe('file.txt');
 expect((w.nativeRequests ?? []).filter(a => a === 'open')).toEqual([]);
 const fresh = parse(await definition.handler({ repo: 'hello', fresh: true, requestKey: 'fresh' }, w.ctx));
 expect(fresh).toMatchObject({ status: 'applied', result: { reused: false } }); expect(fresh.result.workspace_id).not.toBe('job_0123456789abcdef');
 expect(w.nativeRequests.filter(a => a === 'open')).toHaveLength(1);
 const wrong = parse(await definition.handler({ repo: 'hello', mode: 'git', ref: 'worktree', requestKey: 'wrong' }, w.ctx));
 expect(wrong).toMatchObject({ done: false, status: 'refused_by_guard', no_change_sent: true });
}, 60000);

it('is in the default (compact) tool list with the workspace download and upload tools, and its listing stays short', () => {
 const compact = toolsForListing(registry, 'full', 'compact').map(t => t.name);
 for (const name of ['github_repo_download', 'github_git_workspace_download', 'github_git_workspace_upload']) {
  expect(compact, name).toContain(name); expect(COMPACT_DEVELOPER_TOOLS).toContain(name);
 }
 const tool = registry.tools.find(t => t.name === 'github_repo_download');
 expect(tool.description.length).toBeLessThanOrEqual(160);
 expect(tool.guidance).toMatch(/Capabilities \/ network access allowed-domains/);
});

it('a large repository still cloning: the call says so plainly, and the next call reuses that workspace instead of cloning again', async () => {
 const w = await world(false);
 const real = w.ctx.fetch; let opens = 0;
 const lease = p => ({ idle_timeout_ms: p.idleTimeoutMs, last_activity_at: w.ctx.now(), expires_at: w.ctx.now() + p.idleTimeoutMs });
 w.ctx = { ...w.ctx, fetch: async (url, init) => {
  if (String(url).startsWith('https://native-worker.example.test/')) { const p = JSON.parse(init.body);
   if (p.action === 'open') { opens++; return new Response(JSON.stringify({ state: 'opening', workspace_id: p.workspace_id, ...lease(p) })); }
   if (p.action === 'inspect') return new Response(JSON.stringify({ state: 'opening', ...lease(p) })); }
  return real(url, init); } };
 const first = parse(await definition.handler({ repo: 'hello', requestKey: 'big-1' }, w.ctx));
 expect(first).toMatchObject({ status: 'applied', confirmed: true, result: { state: 'opening', workspace_id: expect.stringMatching(/^job_/) } });
 expect(first.result.next).toMatch(/still cloning.*call github_repo_download again/i); expect(first.progress.next).toBe(first.result.next);
 const second = parse(await definition.handler({ repo: 'hello', requestKey: 'big-2' }, w.ctx));
 expect(second).toMatchObject({ result: { state: 'opening', workspace_id: first.result.workspace_id } });
 expect(opens).toBe(1);
});
