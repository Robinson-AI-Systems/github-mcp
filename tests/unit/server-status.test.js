// SRV-STATUS-1: github_server_status with fakes only (no real GitHub, worker, registry or database).
import { beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serverStatus, _resetServerStatusCache, CACHE_MS, SLOW_MS } from '../../src/tools/server-status.js';
import { _resetPrebuiltImageCache } from '../../src/playground/prebuilt-image.js';
import { withTimeZone } from '../../src/core/time-zone.js';
import { WORKER_PROTOCOL } from '../../src/native-git/protocol.js';
import { NATIVE_OPTIONS_VERSION } from '../../src/native-git/commands.js';
import { registry } from '../../src/tools/index.js';
import { toolsForListing, listedDescription } from '../../src/core/registry.js';
import { createDispatch } from '../../src/tools/dispatch.js';
import { createFakeDb } from '../../test/helpers/fake-db.js';
import { nativeGitServer, workerBuildCommit } from '../../workers/native-git/server.js';

const KEY = 'FAKE-worker-service-key-for-local-tests-only';
const sha = (n) => n.toString(16).padStart(2, '0').repeat(20);
// First-parent chain on live, newest first: even entries are PR merges (#560, #559, ...), odd ones plain commits.
const CHAIN = Array.from({ length: 12 }, (_, i) => sha(i + 1));
const SIDE = (i) => sha(100 + i);
const RELEASE = CHAIN[0];
const DATES = CHAIN.map((_, i) => new Date(Date.UTC(2026, 10, 3, 2, 30) - i * 3600000).toISOString().replace('.000Z', 'Z'));
const LONG = 'x'.repeat(300);
function commits() {
  const list = [];
  CHAIN.forEach((s, i) => {
    const merge = i % 2 === 0;
    list.push({ sha: s, parents: [{ sha: CHAIN[i + 1] ?? sha(200) }, ...(merge ? [{ sha: SIDE(i) }] : [])],
      commit: { committer: { date: DATES[i] }, message: merge ? `Merge pull request #${560 - i / 2} from Robinson-AI-Systems/ai/x\n\n${i === 2 ? LONG : `Change number ${560 - i / 2}`}` : `plain ${i}` } });
    // A side-branch merge message that is not on the first-parent chain must not be listed.
    if (merge) list.push({ sha: SIDE(i), parents: [{ sha: sha(201) }], commit: { committer: { date: DATES[i] }, message: 'Merge pull request #1 from someone/else\n\nside' } });
  });
  return list;
}
const SECRET_ENV = {
  NATIVE_GIT_WORKER_URL: 'https://10.20.30.40/', NATIVE_GIT_WORKER_KEY: KEY, GIT_DIRECT_ORIGIN: 'https://git.internal-host.example.test',
  DATABASE_URL: 'FAKE-database-setting-FAKEdbPassword-internal-host', TOKEN_ENCRYPTION_KEY: 'FAKE-encryption-root-value-0123456789',
  VERCEL_GIT_COMMIT_SHA: RELEASE, VERCEL_ENV: 'production', PLAYGROUND_IMAGE_REPOSITORY: 'ghcr.io/robinson-ai-systems/github-mcp-runtime'
};
const DIGEST = 'sha256:' + 'd'.repeat(64);

function world(over = {}) {
  const calls = [];
  const s = {
    env: { ...SECRET_ENV }, cap: { ready: true, protocol: WORKER_PROTOCOL, build_commit: CHAIN[3], native_options: NATIVE_OPTIONS_VERSION, capacity_mode: 'resource-aware',
      admission: { allowed: true }, direct_upload: 'quarantine-v1', direct_download: 'one-time-v1', upload_chunks: 'chunks-v1', upload_apply: 'delete-v1', git_remote: 'v1',
      git_direct: { version: 'v1', origin: 'https://git.internal-host.example.test', worker_key: 'ed25519:FAKEworkerpublickey' } },
    deployments: [{ id: 91, sha: RELEASE, created_at: '2026-11-03T02:32:58Z' }],
    statuses: [{ state: 'in_progress', created_at: '2026-11-03T02:33:00Z' }, { state: 'success', created_at: '2026-11-03T02:33:40Z' }],
    commits: commits(), direct: 200, published: true, dbSetting: async () => null, managerState: null, ...over
  };
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    calls.push(`${init.method ?? 'GET'} ${u.host}${u.pathname}`);
    if (s.hang?.includes(u.host)) return new Promise(() => {});
    if (u.host === 'api.github.com') {
      if (s.githubDown) throw new Error('getaddrinfo api.github.com');
      if (u.pathname.endsWith('/commits')) return Response.json(s.commits);
      if (u.pathname.endsWith('/statuses')) return Response.json(s.statuses);
      if (u.pathname.endsWith('/deployments')) return Response.json(s.deployments.filter((d) => d.sha === u.searchParams.get('sha')));
    }
    if (u.host === '10.20.30.40') {
      if (s.workerDown) throw new Error('connect ECONNREFUSED 10.20.30.40');
      return Response.json(s.cap);
    }
    if (u.host === 'git.internal-host.example.test') return new Response('ok', { status: s.direct });
    if (u.host === 'ghcr.io') {
      if (u.pathname === '/token') return Response.json({ token: 'FAKE-anonymous-registry-token' });
      return s.published ? new Response(null, { status: 200, headers: { 'docker-content-digest': DIGEST } }) : new Response(null, { status: 404 });
    }
    return new Response('not found', { status: 404 });
  };
  let clock = Date.UTC(2026, 10, 3, 3, 0);
  const ctx = {
    env: s.env, fetch, now: () => clock, credentials: null,
    connection: { client_id: 'c', default_account: 'example-org', accounts: ['example-org'], mode: 'preview', profile: 'read_only' },
    db: { getSetting: (key) => (key === 'playground_manager' ? Promise.resolve(s.managerState) : s.dbSetting(key)) }
  };
  return { s, ctx, calls, tick: (ms) => { clock += ms; }, run: (args = {}, opts) => withTimeZone('America/Denver', () => serverStatus(args, ctx, opts)) };
}

beforeEach(() => { _resetServerStatusCache(); _resetPrebuiltImageCache(); });

describe('github_server_status', () => {
  it('reports release, deployment time, recent live merges, worker versions and healthy checks in under 2 KB', async () => {
    const w = world();
    const out = await w.run();
    expect(out.release).toEqual({ version: expect.stringMatching(/\+010101010101$/), commit: RELEASE, source: `https://github.com/Robinson-AI-Systems/github-mcp/commit/${RELEASE}` });
    expect(out.deployed_at).toMatchObject({ utc: '2026-11-03T02:33:40Z', local: 'Nov 2, 2026, 7:33 PM MST', zone: 'America/Denver', source: 'github_deployment_status' });
    expect(out.recent_changes.untrusted).toBe(true);
    expect(out.recent_changes.items.map((i) => i.pr)).toEqual([560, 559, 558, 557, 556]);
    expect(out.recent_changes.items[1].title.length).toBeLessThanOrEqual(100);
    expect(out.workers.native_git).toEqual({ protocol: WORKER_PROTOCOL, build_commit: CHAIN[3].slice(0, 12), features: ['direct_download', 'direct_upload', 'upload_chunks', 'upload_apply', 'git_remote', 'git_direct'] });
    expect(out.workers.playground.runtime_image).toMatchObject({ tag: RELEASE.slice(0, 12), published: true });
    expect(out.health).toMatchObject({ overall: 'ok', database: { status: 'ok' }, worker: { status: 'ok' }, direct_git: { status: 'ok' } });
    expect(typeof out.health.worker.ms).toBe('number');
    expect(out.warnings).toEqual([{ warning: expect.stringContaining('older commit (040404040404, 3 commits behind on live)'), next: expect.stringContaining('Redeploy the native Git worker') }]);
    expect(JSON.stringify(out).length).toBeLessThan(2048);
  });

  it('never returns secrets, environment values, worker or direct-host addresses, or provider error text', async () => {
    for (const over of [{}, { workerDown: true, githubDown: true, direct: 503, dbSetting: async () => { throw new Error('password authentication failed for db.internal-host.example.test'); } }]) {
      _resetServerStatusCache();
      const text = JSON.stringify(await world(over).run({ detail: 'full' }));
      for (const leak of ['10.20.30.40', 'internal-host', KEY, 'FAKEdbPassword', 'FAKE-encryption-root', 'FAKEworkerpublickey', 'FAKE-anonymous-registry-token', 'ECONNREFUSED', 'getaddrinfo', 'password authentication'])
        expect(text).not.toContain(leak);
    }
  });

  it('marks each health state and the overall worst state', async () => {
    let out = await world({ dbSetting: async () => { throw new Error('boom'); }, workerDown: true, direct: 503 }).run({ fields: ['health'] });
    expect(out.health).toMatchObject({ overall: 'down', database: { status: 'down', reason: expect.any(String) }, worker: { status: 'down', reason: expect.stringContaining('could not be reached') }, direct_git: { status: 'down' } });
    out = await world({ cap: { ready: false, protocol: WORKER_PROTOCOL } }).run({ fields: ['health'] });
    expect(out.health).toMatchObject({ overall: 'degraded', database: { status: 'ok' }, worker: { status: 'degraded', reason: expect.stringContaining('not ready') } });
    out = await world({ env: { ...SECRET_ENV, NATIVE_GIT_WORKER_DRAINING: 'true' } }).run({ fields: ['health'] });
    expect(out.health.worker).toEqual({ status: 'degraded', reason: expect.stringContaining('maintenance') });
    out = await world({ env: { ...SECRET_ENV, NATIVE_GIT_WORKER_URL: undefined, GIT_DIRECT_ORIGIN: undefined } }).run({ fields: ['health'] });
    expect(out.health.worker).toEqual({ status: 'down', reason: expect.stringContaining('No native Git worker is configured') });
    expect(out.health.direct_git).toBeUndefined();
    out = await world().run({ fields: ['health'] }, { slowMs: { ...SLOW_MS, database: -1 } });
    expect(out.health).toMatchObject({ overall: 'degraded', database: { status: 'degraded', reason: expect.stringContaining('slowly') } });
  });

  it('reports the Playground pool from the recorded manager state, without a provider call', async () => {
    const pools = JSON.stringify([{ id: 'east', origin: 'https://dokploy.internal-host.example.test', keyEnv: 'PLAYGROUND_DOKPLOY_API_KEY_EAST', project: 'p', environment: 'e', ingress: '203.0.113.10' }]);
    const env = { ...SECRET_ENV, PLAYGROUND_POOLS: pools, PLAYGROUND_DOKPLOY_API_KEY_EAST: 'FAKE-dokploy-key-0123456789' };
    const w = world({ env, managerState: { phase: 'running', source: { image: `ras-playground:${CHAIN[5]}` } } });
    const out = await w.run({ fields: ['health', 'workers'] });
    expect(out.health.playground_pool).toEqual({ status: 'ok', pools: 1 });
    expect(out.workers.playground.manager).toEqual({ phase: 'running', built_from: CHAIN[5].slice(0, 12) });
    expect(w.calls.some((c) => c.includes('dokploy'))).toBe(false);
    expect(JSON.stringify(out)).not.toMatch(/FAKE-dokploy|203\.0\.113|internal-host/);
    const idle = await world({ env, managerState: null }).run({ fields: ['health'] });
    expect(idle.health.playground_pool).toMatchObject({ status: 'degraded', reason: expect.stringContaining('not created') });
  });

  it('answers within its time bound when every dependency hangs', async () => {
    const w = world({ hang: ['api.github.com', '10.20.30.40', 'git.internal-host.example.test', 'ghcr.io'], dbSetting: () => new Promise(() => {}) });
    const start = Date.now();
    const out = await w.run({}, { budgetMs: 120 });
    expect(Date.now() - start).toBeLessThan(1500);
    expect(out.health).toMatchObject({ overall: 'down', database: { status: 'down', reason: expect.stringContaining('did not answer') }, worker: { status: 'down' }, direct_git: { status: 'down' } });
    expect(out.recent_changes).toMatchObject({ untrusted: true, items: [], unavailable: 'GitHub did not answer in time.' });
    expect(out.deployed_at.source).toBe('unknown');
    expect(out.workers.playground.runtime_image).toMatchObject({ published: false, lookup: 'timed out' });
    expect(out.warnings.some((x) => /published/.test(x.warning))).toBe(false);
  });

  it('caches the release history and deployment time for five minutes', async () => {
    const w = world();
    await w.run(); await w.run();
    const github = () => w.calls.filter((c) => c.startsWith('GET api.github.com'));
    expect(github().filter((c) => c.endsWith('/commits'))).toHaveLength(1);
    expect(github().filter((c) => c.endsWith('/deployments'))).toHaveLength(1);
    w.tick(CACHE_MS + 1);
    await w.run();
    expect(github().filter((c) => c.endsWith('/commits'))).toHaveLength(2);
  });

  it('labels the deployed_at source: success report, deployment start, live-branch fallback, unknown', async () => {
    expect((await world({ statuses: [{ state: 'pending', created_at: '2026-11-03T02:33:00Z' }] }).run({ fields: ['deployed_at'] })).deployed_at)
      .toMatchObject({ utc: '2026-11-03T02:32:58Z', source: 'github_deployment_created' });
    _resetServerStatusCache();
    expect((await world({ deployments: [] }).run({ fields: ['deployed_at'] })).deployed_at)
      .toMatchObject({ utc: DATES[0], source: 'live_branch_commit_date', source_note: expect.stringContaining('Fallback') });
    _resetServerStatusCache();
    const none = await world({ env: { ...SECRET_ENV, VERCEL_GIT_COMMIT_SHA: undefined } }).run({ fields: ['deployed_at', 'release'] });
    expect(none.deployed_at).toMatchObject({ utc: null, source: 'unknown' });
    expect(none.release.commit).toBeNull();
  });

  it('shows times in the saved zone and in UTC, labelled UTC when no zone is saved', async () => {
    const w = world();
    const utc = await serverStatus({ fields: ['deployed_at'] }, w.ctx);
    expect(utc.deployed_at).toMatchObject({ local: 'Nov 3, 2026, 2:33 AM UTC', utc: '2026-11-03T02:33:40Z', zone: 'UTC' });
    const tokyo = await withTimeZone('Asia/Tokyo', () => serverStatus({ fields: ['deployed_at'] }, w.ctx));
    expect(tokyo.deployed_at.local).toBe('Nov 3, 2026, 11:33 AM GMT+9');
  });

  it('warns plainly about mismatched worker, protocol and runtime image, each with a next step', async () => {
    let out = await world({ cap: { ready: true, protocol: WORKER_PROTOCOL - 1, native_options: 'older-v0' }, published: false }).run({ fields: ['warnings'] });
    expect(out.warnings.map((x) => x.warning)).toEqual([
      expect.stringContaining(`speaks protocol ${WORKER_PROTOCOL - 1}`), expect.stringContaining('options differ'),
      expect.stringContaining('does not report the commit'), expect.stringContaining('No Playground runtime image is published')]);
    expect(out.warnings.every((x) => typeof x.next === 'string' && x.next.length > 10)).toBe(true);
    out = await world({ env: { ...SECRET_ENV, PLAYGROUND_BUILD_SOURCE_SHA: CHAIN[4] }, cap: { ready: true, protocol: WORKER_PROTOCOL, build_commit: RELEASE } }).run({ fields: ['warnings'] });
    expect(out.warnings).toEqual([{ warning: expect.stringContaining('runtime image is pinned to an older commit (050505050505, 4 commits behind'), next: expect.stringContaining('PLAYGROUND_BUILD_SOURCE_SHA') }]);
    out = await world({ cap: { ready: true, protocol: WORKER_PROTOCOL, build_commit: 'e'.repeat(40) } }).run({ fields: ['warnings'] });
    expect(out.warnings[0].warning).toContain('a different commit (eeeeeeeeeeee)');
  });

  it('supports fields and detail; asking only for the release makes no outside call', async () => {
    const w = world();
    expect(await w.run({ fields: ['release'] })).toEqual({ release: expect.objectContaining({ commit: RELEASE }) });
    expect(w.calls).toEqual([]);
    const titles = await w.run({ fields: ['recent_changes.items.title'] });
    expect(titles.recent_changes.untrusted).toBe(true);
    expect(Object.keys(titles.recent_changes.items[0])).toEqual(['title']);
    await expect(w.run({ fields: ['secrets'] })).rejects.toThrow(/Unknown field: secrets/);
    const full = await w.run({ detail: 'full' });
    expect(full.recent_changes.items[0]).toEqual({ pr: 560, title: 'Change number 560', merged_at: DATES[0], commit: RELEASE.slice(0, 12) });
    expect(full.workers.native_git).toMatchObject({ native_options: NATIVE_OPTIONS_VERSION, capacity_mode: 'resource-aware', admission: 'open', features: { git_direct: 'v1', direct_upload: 'quarantine-v1' } });
    expect(full.workers.playground.runtime_image.digest).toBe(DIGEST);
  });

  it('is a compact read for every audience, and github_whoami points to it', async () => {
    const tool = registry.tools.find((t) => t.name === 'github_server_status');
    expect(tool).toMatchObject({ area: 'server', audience: ['B', 'O', 'Op'], compact: true, annotations: { readOnlyHint: true } });
    expect(listedDescription(tool).length).toBeLessThanOrEqual(160);
    for (const profile of ['read_only', 'everyday', 'full']) expect(toolsForListing(registry, profile, 'compact').map((t) => t.name)).toContain('github_server_status');
    const db = createFakeDb(); await db.initSchema();
    const connection = Object.freeze({ client_id: 'c', default_account: 'example-org', accounts: Object.freeze(['example-org']), mode: 'preview', profile: 'read_only', listing: 'compact' });
    const w = world();
    const dispatch = createDispatch({ env: { VERCEL_GIT_COMMIT_SHA: RELEASE }, fetch: w.ctx.fetch });
    const who = (await dispatch({ registry, name: 'github_whoami', args: {}, connection, db })).structuredContent;
    expect(who.server_release.commit).toBe(RELEASE);
    expect(who.server_status).toMatch(/^github_server_status: /);
    const status = await dispatch({ registry, name: 'github_server_status', args: {}, connection, db });
    expect(status.isError).toBeUndefined();
    expect(status.structuredContent).toMatchObject({ release: { commit: RELEASE }, recent_changes: { untrusted: true }, health: { database: { status: 'ok' }, worker: { status: 'down' } } });
  });
});

describe('native Git worker build commit (read only)', () => {
  it('reads only a full commit from the build argument or Render', () => {
    expect(workerBuildCommit({ NATIVE_GIT_BUILD_COMMIT: RELEASE })).toBe(RELEASE);
    expect(workerBuildCommit({ NATIVE_GIT_BUILD_COMMIT: '', RENDER_GIT_COMMIT: CHAIN[1] })).toBe(CHAIN[1]);
    expect(workerBuildCommit({ NATIVE_GIT_BUILD_COMMIT: 'main' })).toBeNull();
    expect(workerBuildCommit({})).toBeNull();
  });
  it('reports build_commit in signed capabilities, and nothing when unknown', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'srv-status-'));
    const resources = { policy: {}, body: () => ({ allowed: true }), check: async () => ({ allowed: true }), close() {} };
    try {
      for (const buildCommit of [RELEASE, null]) {
        const server = nativeGitServer({ root: join(dir, 'storage'), key: KEY, allowLocalFixtures: true, resources, buildCommit });
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        const origin = `http://127.0.0.1:${server.address().port}`;
        try {
          _resetServerStatusCache();
          const w = world();
          const fetchWorker = (url, init) => (new URL(url).host === '10.20.30.40' ? fetch(`${origin}/v1/workspace`, init) : w.ctx.fetch(url, init));
          // The real worker checks the lease against its own clock.
          const out = await serverStatus({ fields: ['workers', 'health'] }, { ...w.ctx, now: Date.now, fetch: fetchWorker });
          expect(out.health.worker.status).toBe('ok');
          expect(out.workers.native_git.build_commit).toBe(buildCommit ? RELEASE.slice(0, 12) : 'not reported');
          expect(out.workers.native_git.protocol).toBe(WORKER_PROTOCOL);
        } finally { await new Promise((resolve) => server.close(resolve)); }
      }
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
