// SINGLE-DOMAIN-1 history: a workspace attached to a shared-pool Playground runtime used to download and upload
// from the runtime's own copy through the relay's broker route. That route went with the retired pool
// (SWEEP-CLEANUP-1, 2026-11-19); shared-pool and own-computer runtimes are refused plainly with the fallback.
import { afterEach, it, expect } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createServer, request as httpRequest } from 'node:http';
import { execFileSync } from 'node:child_process';
import { makeWorld, parse } from '../../test/helpers/write-contract.js';
import { prepareNativeWorld } from '../../test/helpers/native-git-world.js';
import { startTransferRelay } from '../../test/helpers/transfer-relay.js';
import { nativeGitServer } from '../../workers/native-git/server.js';
import { createResourceMonitor } from '../../workers/native-git/resources.js';
import { NativeGitWorker } from '../../workers/native-git/engine.js';
import { ingressServer } from '../../workers/coding-workspace/ingress.js';
import { nativeWorkerPublicKey } from '../../src/native-git/signing.js';
import { nativeBindingHash } from '../../src/native-git/protocol.js';
import * as native from '../../src/tools/native-git.js';

const WORKSPACE = 'job_0123456789abcdef';
const BROKER = 'https://ras-pg-' + '1'.repeat(32) + '-203-0-113-10.sslip.io';
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const cleanups = [];
afterEach(async () => { for (const close of cleanups.splice(0)) await close(); });
const call = (w, name, args) => native.handlers[name](args, w.ctx).then(parse);

async function attachedWorld({ ingress = 'current', origin = BROKER } = {}) {
 const w = await makeWorld({ profile: 'full', mode: 'production', gates: [] });
 w.gh.nativeOutcome = 'ok'; w.gh.when('GET /repos/{owner}/{repo}').reply(200, { full_name: 'example-org/hello', default_branch: 'main' });
 cleanups.push(await prepareNativeWorld(w, { existing: true }));
 const { binding, workerId, seed } = w.nativeFixture;
 // The runtime's copy: same workspace identity, plus one commit that exists only there.
 const dir = await mkdtemp(join(tmpdir(), 'broker-')); cleanups.push(() => rm(dir, { recursive: true, force: true }));
 const root = join(dir, 'storage');
 await new NativeGitWorker({ root, authorize: async () => true, allowLocalFixtures: true, now: w.ctx.now }).create(binding, { requestKey: 'fixture', fixtureRemote: seed });
 const repo = join(root, workerId, 'repo'), git = (...a) => execFileSync('git', a, { cwd: repo, stdio: 'pipe' });
 await writeFile(join(repo, 'runtime.txt'), 'made in the runtime\n'); git('add', 'runtime.txt'); git('-c', 'user.name=Runtime', '-c', 'user.email=runtime@example.test', 'commit', '-m', 'runtime work');
 w.brokerRepo = repo;
 // This in-process broker shares the test runner's event loop with the control plane under test (in
 // production they are separate processes), so its loop-delay admission would measure the test's own
 // first-call work. Memory and disk admission keep their defaults; only the shared-loop delay is widened.
 const resources = createResourceMonitor({ root, policy: { maxLoopDelayMs: 5000 } });
 const broker = nativeGitServer({ resources, root, key: nativeWorkerPublicKey(w.ctx.env), now: w.ctx.now, singleWorkspaceId: workerId, singleBinding: nativeBindingHash(binding) });
 const brokerPort = await listen(broker); cleanups.push(() => { broker.closeAllConnections(); return new Promise(r => broker.close(r)); });
 const coding = createServer((_req, res) => { res.writeHead(404); res.end(); }); const codingPort = await listen(coding); cleanups.push(() => new Promise(r => coding.close(r)));
 const front = ingress === 'current' ? ingressServer({ coding: { hostname: '127.0.0.1', port: codingPort }, broker: { hostname: '127.0.0.1', port: brokerPort } })
  // An older ingress: only /v1/workspace reaches the broker; everything else goes to the coding server.
  : createServer((req, res) => { if (req.url !== '/v1/workspace') { req.resume(); res.writeHead(404); return res.end(); } req.pipe(httpRequest({ hostname: '127.0.0.1', port: brokerPort, path: req.url, method: req.method, headers: req.headers }, a => { res.writeHead(a.statusCode, a.headers); a.pipe(res); })); });
 const frontPort = await listen(front); cleanups.push(() => { front.closeAllConnections?.(); return new Promise(r => front.close(r)); });
 const ingressOrigin = `http://127.0.0.1:${frontPort}`;
 // Attach: the allocation record nativeRecord reads (as the attach flow saves it).
 const allocationBinding = createHash('sha256').update(JSON.stringify(['robinson-playground/v1', WORKSPACE, binding.authority, binding.connection, binding.owner.toLowerCase(), binding.repo.toLowerCase(), workerId])).digest('hex');
 await w.db.setSetting('playground.' + allocationBinding.slice(0, 40), { binding: allocationBinding, connection: binding.connection, workspace: WORKSPACE, phase: 'attached', brokerOrigin: origin, revision: 1 });
 const shared = w.ctx.fetch;
 w.brokerRequests = [];
 const fetchAll = (url, init) => { if (!String(url).startsWith(BROKER + '/')) return shared(url, init); const u = new URL(url); w.brokerRequests.push(u.pathname); return fetch(ingressOrigin + u.pathname + u.search, init); };
 w.ctx = { ...w.ctx, fetch: fetchAll, env: { ...w.ctx.env, PLAYGROUND_INGRESS_IPV4: '203.0.113.10' } };
 const relay = await startTransferRelay({ env: () => w.ctx.env, now: w.ctx.now, destinations: { [BROKER]: ingressOrigin } }); cleanups.push(relay.close);
 w.local = url => relay.local(url);
 w.relay = relay;
 return w;
}

it('a retired shared-pool runtime (any image) or an own-computer runtime is refused plainly with the fallback, and nothing is prepared', async () => {
 // SWEEP-CLEANUP-1 (2026-11-19): one-time transfers to a shared-pool runtime went through the relay's broker route,
 // removed with the retired pool (DOKPLOY-RETIRE-1); such a workspace now gets the Git-only fallback.
 for (const ingress of ['current', 'old']) {
  const w = await attachedWorld({ ingress });
  const down = await call(w, 'github_git_workspace_download', { workspace_id: WORKSPACE, mode: 'git', requestKey: 'pool-' + ingress });
  expect(down).toMatchObject({ done: false, status: 'refused_by_guard' }); expect(down.error).toMatch(/retired shared Playground pool.*github_repo_download with fresh: true/);
  const up = await call(w, 'github_git_workspace_upload', { workspace_id: WORKSPACE, operation: 'begin', mode: 'git', requestKey: 'pool-up-' + ingress });
  expect(up.error).toMatch(/retired shared Playground pool/);
  expect(w.brokerRequests).not.toContain('/v1/workspace');
 }
 const device = await attachedWorld({ origin: 'https://d' + 'a'.repeat(32) + '-' + 'b'.repeat(24) + '.fleet.invalid/' });
 const own = await call(device, 'github_git_workspace_download', { workspace_id: WORKSPACE, mode: 'archive', requestKey: 'device' });
 expect(own.error).toMatch(/your own computer.*github_repo_download/);
}, 60000);
