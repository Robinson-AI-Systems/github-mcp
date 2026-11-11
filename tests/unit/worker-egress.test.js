// WORKER-RESOLV-GUARD-1: the worker's own timed resolver/egress verdict, and the chain
// worker capabilities -> github_server_status. Fakes only: no real DNS, no real GitHub.
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEgressMonitor, EGRESS_NAMES, EGRESS_PROBE_TIMEOUT_MS } from '../../workers/native-git/egress.js';
import { nativeGitServer } from '../../workers/native-git/server.js';
import { serverStatus, _resetServerStatusCache } from '../../src/tools/server-status.js';

const KEY = 'FAKE-worker-service-key-for-local-tests-only';
const RELEASE = 'a'.repeat(40);
const resources = { policy: {}, body: () => ({ allowed: true }), check: async () => ({ allowed: true }), close() {} };

describe('the worker egress monitor', () => {
  it('probes exactly the names the worker exists to reach, with a 2500 ms default timeout', () => {
    expect(EGRESS_NAMES).toEqual(['github.com', 'api.github.com']);
    expect(EGRESS_PROBE_TIMEOUT_MS).toBe(2500);
  });

  it('reports unknown until the first probe completes, then ok with a round-trip time', async () => {
    const monitor = createEgressMonitor({ resolve4Impl: async () => ['140.82.112.3'] });
    expect(monitor.report()).toMatchObject({ status: 'unknown', ms: null });
    const verdict = await monitor.probeNow();
    expect(verdict.status).toBe('ok');
    expect(typeof verdict.ms).toBe('number');
    expect(verdict.names).toEqual({ 'github.com': 'ok', 'api.github.com': 'ok' });
    expect(monitor.report().status).toBe('ok');
  });

  it('reports down when any name fails, empties, or hangs past the timeout', async () => {
    const failing = createEgressMonitor({ resolve4Impl: async (name) => { if (name === 'api.github.com') throw new Error('ENOTFOUND'); return ['140.82.112.3']; } });
    expect((await failing.probeNow()).status).toBe('down');
    expect(failing.report().names['api.github.com']).toBe('down');

    const empty = createEgressMonitor({ resolve4Impl: async () => [] });
    expect((await empty.probeNow()).status).toBe('down');

    const hanging = createEgressMonitor({ timeoutMs: 40, resolve4Impl: () => new Promise(() => {}) });
    const start = Date.now();
    expect((await hanging.probeNow()).status).toBe('down');
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it('shares one probe round between concurrent callers and can recover on a later probe', async () => {
    let calls = 0; let broken = true;
    const monitor = createEgressMonitor({ resolve4Impl: async () => { calls += 1; if (broken) throw new Error('SERVFAIL'); return ['140.82.112.3']; } });
    const [a, b] = await Promise.all([monitor.probeNow(), monitor.probeNow()]);
    expect(a.status).toBe('down'); expect(b.status).toBe('down');
    expect(calls).toBe(EGRESS_NAMES.length);
    broken = false;
    expect((await monitor.probeNow()).status).toBe('ok');
  });
});

describe('the worker surface: /health and signed capabilities carry the verdict', () => {
  let server; let dir;
  const boot = async (egressMonitor) => {
    dir = await mkdtemp(join(tmpdir(), 'wrg-egress-'));
    server = nativeGitServer({ root: join(dir, 'storage'), key: KEY, allowLocalFixtures: true, resources, egressMonitor });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${server.address().port}`;
  };
  afterEach(async () => { if (server) await new Promise((resolve) => server.close(resolve)); if (dir) await rm(dir, { recursive: true, force: true }); server = null; });

  const monitor = (status) => { const report = { status, ms: status === 'unknown' ? null : 12, names: {}, checked_at: null }; return { report: () => report, probeNow: async () => report, start() {}, stop() {} }; };

  it('/health answers 503 only while the resolver verdict is down', async () => {
    let origin = await boot(monitor('down'));
    expect((await fetch(`${origin}/health`)).status).toBe(503);
    await new Promise((resolve) => server.close(resolve));
    origin = await boot(monitor('ok'));
    expect((await fetch(`${origin}/health`)).status).toBe(200);
    await new Promise((resolve) => server.close(resolve));
    origin = await boot(monitor('unknown'));
    expect((await fetch(`${origin}/health`)).status).toBe(200);
  });

  it('github_server_status flips the worker leg to down on the worker\'s own verdict, and only then', async () => {
    for (const [verdict, expected] of [['down', 'down'], ['ok', 'ok'], ['unknown', 'ok']]) {
      const origin = await boot(monitor(verdict));
      try {
        _resetServerStatusCache();
        const ctx = {
          env: { NATIVE_GIT_WORKER_URL: 'https://10.20.30.40/', NATIVE_GIT_WORKER_KEY: KEY, VERCEL_GIT_COMMIT_SHA: RELEASE },
          fetch: (url, init) => (new URL(url).host === '10.20.30.40' ? fetch(`${origin}/v1/workspace`, init) : fetch(url, init)),
          now: Date.now, credentials: null, connection: { accounts: [] },
          db: { getSetting: async () => null }
        };
        const out = await serverStatus({ detail: 'full', fields: ['health', 'workers'] }, ctx);
        expect(out.health.worker.status).toBe(expected);
        if (verdict === 'down') {
          expect(out.health.worker.reason).toContain('resolver is not working');
          expect(out.health.worker.egress).toMatchObject({ status: 'down' });
          expect(out.health.overall).toBe('down');
        }
        expect(out.workers.native_git.egress).toMatchObject({ status: verdict });
      } finally { await new Promise((resolve) => server.close(resolve)); server = null; }
    }
  });
});
