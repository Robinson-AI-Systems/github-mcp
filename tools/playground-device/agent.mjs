#!/usr/bin/env node
// Robinson Playground host agent (FLEET-3). Turns a computer or server YOU control
// into a Playground host for YOUR OWN connection. It only makes outbound HTTPS
// requests: no tunnel, no open port, no public IP. Needs Node 22+ and Docker
// Engine with Compose v2. On Windows the PLAY-3 installer provides both inside
// its own WSL2 distro (Docker Desktop is never used); see README.
//
//   node agent.mjs join --device DEVICE_ID --code PAIRING_CODE   (from My connection)
//   node agent.mjs run                                          (keep running; see README)
//   node agent.mjs status | leave
//
// Safety: every order from the control plane is signed and checked against the
// key pinned at join. Only fixed actions exist (start/stop one allocation from a
// signed plan, forward a signed request to its loopback port, readiness check,
// terminate). Your GitHub sign-in never touches this machine.
import {createHash, createPublicKey, sign, verify} from 'node:crypto';
import {execFile} from 'node:child_process';
import {mkdir, readFile, writeFile, rm, statfs} from 'node:fs/promises';
import {homedir, cpus, totalmem, freemem, platform, availableParallelism} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadOrCreateDeviceKey} from './pair.mjs';
import {applyUpdate} from './update.mjs';

export const AGENT_VERSION = 'fleet-agent/1';
const DEFAULT_SERVER = 'https://github.robinsonaisystems.com';
const HEX32 = /^[a-f0-9]{32}$/, HEX64 = /^[a-f0-9]{64}$/;
const OWNER_LABEL = 'com.robinson.playground.owner', BINDING_LABEL = 'com.robinson.playground.binding';
const READY_IMAGE = 'busybox:1.36';
const sha = v => createHash('sha256').update(v).digest('hex');
const sleepMs = ms => new Promise(r => setTimeout(r, ms));
const fail = m => Object.assign(new Error(m), {agent: true});

export function defaultExec(cmd, args, {timeoutMs = 120000, input} = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(cmd, args, {encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: timeoutMs}, (error, stdout, stderr) =>
      error ? reject(Object.assign(error, {stdout, stderr})) : resolve(stdout.trim()));
    if (input !== undefined) { child.stdin.end(input); }
  });
}

export class HostAgent {
  constructor({dir = join(homedir(), '.config', 'ras-playground'), exec = defaultExec, fetchImpl = fetch, now = Date.now, sleep = sleepMs, log = m => process.stdout.write(m + '\n'), exit = c => process.exit(c), supervised = process.env.RAS_PLAYGROUND_SUPERVISED === '1'} = {}) {
    Object.assign(this, {dir, exec, fetchImpl, now, sleep, log, exit, supervised});
    this.statePath = join(dir, 'agent.json');
    this.work = new Map(); this.inflight = new Set();
  }
  async load() { try { this.state = JSON.parse(await readFile(this.statePath, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; this.state = null; } return this.state; }
  async save() { await mkdir(this.dir, {recursive: true, mode: 0o700}); await writeFile(this.statePath, JSON.stringify(this.state, null, 1), {mode: 0o600}); }
  async key() { return (await loadOrCreateDeviceKey(this.dir)).privateKey; }

  async join({device, code, server = DEFAULT_SERVER}) {
    if (!HEX32.test(device ?? '') || !/^[A-Za-z0-9_-]{43}$/.test(code ?? '')) throw fail('Use the device ID and one-time code shown on your My connection page.');
    const base = new URL(server); if (base.protocol !== 'https:' || base.pathname !== '/' || base.search || base.username) throw fail('The server must be a bare HTTPS address.');
    const keyRes = await this.fetchImpl(new URL('/api/native-git-key', base).href, {redirect: 'error'});
    const controlKey = keyRes.ok ? (await keyRes.json()).public_key : null;
    if (typeof controlKey !== 'string' || !controlKey.startsWith('ed25519:')) throw fail('Could not read the server\'s public signing key.');
    const privateKey = await this.key();
    const publicDer = createPublicKey(privateKey).export({format: 'der', type: 'spki'});
    const message = JSON.stringify({purpose: 'robinson-playground-device-pair/v1', deviceId: device, code, origin: null});
    const res = await this.fetchImpl(new URL('/api/playground/enroll', base).href, {method: 'POST', redirect: 'error', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({deviceId: device, code, publicKey: 'ed25519:' + publicDer.toString('base64url'), signature: sign(null, Buffer.from(message), privateKey).toString('base64url')})});
    if (!res.ok) throw fail('Pairing was not accepted. Start again from My connection to get a fresh code.');
    const out = await res.json();
    if (out.deviceId !== device || out.fingerprint !== sha(publicDer) || out.transport !== 'dial-out') throw fail('The server did not confirm this exact machine.');
    this.state = {server: base.origin, deviceId: device, generation: 1, controlKey, seq: 0, allocations: {}, joinedAt: this.now()};
    await this.save();
    return {fingerprint: out.fingerprint};
  }

  async signed(purpose, extra) {
    this.state.seq = Math.max((this.state.seq ?? 0) + 1, this.now());
    await this.save();
    const request = JSON.stringify({purpose, protocol: 1, deviceId: this.state.deviceId, generation: this.state.generation, seq: this.state.seq, sentAt: this.now(), ...extra});
    return {request, signature: 'ed25519:' + sign(null, Buffer.from(request), await this.key()).toString('base64url')};
  }
  async post(path, payload, timeoutMs = 35000) {
    const res = await this.fetchImpl(new URL(path, this.state.server).href, {method: 'POST', redirect: 'error', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload), signal: AbortSignal.timeout(timeoutMs)});
    let body = null; try { body = await res.json(); } catch { /* empty */ }
    return {status: res.status, body};
  }
  verifyOrder(o) {
    const key = createPublicKey({key: Buffer.from(this.state.controlKey.slice(8), 'base64'), format: 'der', type: 'spki'});
    if (typeof o?.body !== 'string' || typeof o.signature !== 'string' || !o.signature.startsWith('ed25519:') ||
        !verify(null, Buffer.from(o.body), key, Buffer.from(o.signature.slice(8), 'base64url'))) throw fail('Order signature invalid.');
    const order = JSON.parse(o.body);
    if (order.purpose !== 'robinson-fleet-order/v1' || order.deviceId !== this.state.deviceId || order.generation !== this.state.generation || !HEX32.test(order.id ?? '')) throw fail('Order is not for this machine.');
    return order;
  }

  // PLAY-3 §5.1: the running payload's version is the version.json beside
  // this file when the launcher shim installed one (that file is the update
  // receipt: a new payload's first check-in reports its new version here);
  // the installer-placed payload reports the built-in AGENT_VERSION.
  async payloadVersion() {
    if (this._payloadVersion !== undefined) return this._payloadVersion;
    try { const v = JSON.parse(await readFile(join(dirname(fileURLToPath(import.meta.url)), 'version.json'), 'utf8')).version; this._payloadVersion = typeof v === 'string' && v ? v : AGENT_VERSION; }
    catch { this._payloadVersion = AGENT_VERSION; }
    return this._payloadVersion;
  }
  async capacity() {
    let freeDiskBytes = null;
    try { const root = await this.exec('docker', ['info', '--format', '{{.DockerRootDir}}'], {timeoutMs: 15000}); const s = await statfs(root).catch(() => statfs(homedir())); freeDiskBytes = Number(s.bavail) * Number(s.bsize); } catch { /* unknown */ }
    let docker = null, compose = null;
    try { docker = await this.exec('docker', ['version', '--format', '{{.Server.Version}}'], {timeoutMs: 15000}); } catch { /* not running */ }
    try { compose = await this.exec('docker', ['compose', 'version', '--short'], {timeoutMs: 15000}); } catch { /* missing */ }
    return {cpus: typeof availableParallelism === 'function' ? availableParallelism() : cpus().length, memoryBytes: totalmem(), freeMemoryBytes: freemem(), freeDiskBytes,
      docker, compose, agent: await this.payloadVersion(), platform: platform(), allocations: Object.keys(this.state.allocations ?? {})};
  }

  // PLAY-3 §5.1: the launcher shim leaves this file when it rolls a bad
  // update back; the next successful check-in carries it to the control
  // plane and then clears it.
  async takeUpdateReport() {
    const p = join(this.dir, 'pending-update-report.json');
    try { const r = JSON.parse(await readFile(p, 'utf8')); return {report: r, clear: async () => { await rm(p, {force: true}); }}; } catch { return {report: null, clear: async () => {}}; }
  }
  // PLAY-3 §5.1: a signed agentUpdate advertisement on the check-in response.
  // Only a supervised agent (systemd unit / launcher shim sets
  // RAS_PLAYGROUND_SUPERVISED=1) may apply one — it exits so the supervisor
  // restarts it into the new payload. A foreground agent only logs it: the
  // person running it by hand stays in charge of their own terminal.
  async maybeUpdate(ad) {
    if (!ad) return null;
    if (!this.supervised) { this.log('An agent update is available; it will be applied by the service supervisor.'); return {applied: false, reason: 'not_supervised'}; }
    try {
      const r = await applyUpdate({dir: this.dir, ad, controlKey: this.state.controlKey, currentVersion: await this.payloadVersion(),
        fetchImpl: this.fetchImpl, isIdle: () => this.inflight.size === 0, hasAllocations: () => Object.keys(this.state.allocations ?? {}).length > 0, log: this.log});
      if (r.applied) { this.log('Restarting into agent ' + r.version + '.'); this.exit(0); }
      return r;
    } catch (e) { this.log('Agent update refused: ' + e.message); return {applied: false, reason: e.message}; }
  }

  // One check-in: report capacity, receive and start signed orders.
  async checkInOnce() {
    const {report: updateReport, clear: clearUpdateReport} = await this.takeUpdateReport();
    const res = await this.post('/api/fleet/checkin', await this.signed('robinson-fleet-checkin/v1', {capacity: await this.capacity(), ...(updateReport ? {agentUpdateReport: updateReport} : {})}));
    if (res.status === 410) { this.log('This machine was removed from your connection. Stopping its runtimes.'); await this.terminate(); return {revoked: true}; }
    if (res.status !== 200) return {retryAfterMs: 15000, status: res.status};
    if (updateReport) await clearUpdateReport();
    for (const o of res.body.orders ?? []) {
      let order; try { order = this.verifyOrder(o); } catch (e) { this.log('Ignored an order: ' + e.message); continue; }
      const lane = order.payload?.binding ?? order.payload?.bindingPrefix ?? order.kind;
      const prior = order.kind === 'relay' ? Promise.resolve() : this.work.get(lane) ?? Promise.resolve();
      const job = prior.then(() => this.handle(order)).then(result => this.report(order, result)).catch(e => this.log('Order ' + order.kind + ' failed: ' + e.message));
      if (order.kind !== 'relay') this.work.set(lane, job);
      this.inflight.add(job); job.finally(() => this.inflight.delete(job));
    }
    if (res.body.agentUpdate) { await this.settle(); await this.maybeUpdate(res.body.agentUpdate); }
    return {status: res.body.status, pollAfterMs: res.body.pollAfterMs ?? 0, orders: (res.body.orders ?? []).length};
  }
  async report(order, result) {
    const res = await this.post('/api/fleet/report', await this.signed('robinson-fleet-report/v1', {id: order.id, result}));
    if (res.status !== 200) this.log('The server did not accept a report (' + res.status + ').');
  }
  async handle(order) {
    switch (order.kind) {
      case 'readiness': return this.readiness(order.payload);
      case 'allocation_up': return this.up(order.payload);
      case 'allocation_down': return this.down(order.payload);
      case 'relay': return this.relay(order.payload);
      case 'terminate': return this.terminate();
      default: throw fail('Unknown order kind.');
    }
  }

  async readiness({nonce}) {
    const net = 'ras-ready-' + String(nonce).slice(0, 12), out = {nonce, dockerOk: false, composeOk: false, internalNetworkOk: false, uid1000Ok: false, cleanedUp: false};
    try {
      await this.exec('docker', ['version', '--format', '{{.Server.Version}}'], {timeoutMs: 20000}); out.dockerOk = true;
      await this.exec('docker', ['compose', 'version', '--short'], {timeoutMs: 20000}); out.composeOk = true;
      await this.exec('docker', ['network', 'create', '--internal', '--label', OWNER_LABEL + '=readiness', net], {timeoutMs: 20000});
      const uid = await this.exec('docker', ['run', '--rm', '--network', net, '--user', '1000:1000', '--cap-drop', 'ALL', '--read-only', READY_IMAGE, 'id', '-u'], {timeoutMs: 300000});
      out.uid1000Ok = uid.trim() === '1000';
      let reached = true;
      try { await this.exec('docker', ['run', '--rm', '--network', net, '--user', '1000:1000', READY_IMAGE, 'wget', '-q', '-T', '3', '-O', '-', 'http://1.1.1.1'], {timeoutMs: 30000}); } catch { reached = false; }
      out.internalNetworkOk = !reached;
    } catch (e) { out.reason = String(e.stderr || e.message).slice(0, 200); }
    finally { try { await this.exec('docker', ['network', 'rm', net], {timeoutMs: 20000}); } catch { /* absent */ } }
    try { out.cleanedUp = (await this.exec('docker', ['network', 'ls', '-q', '--filter', 'name=^' + net + '$'], {timeoutMs: 20000})) === ''; } catch { /* unknown */ }
    return out;
  }

  // Validate the signed plan is the expected isolated shape, then make the
  // gateway reachable on this machine's loopback only.
  localCompose({binding, composeFile, planHash}) {
    if (!HEX64.test(binding ?? '') || typeof composeFile !== 'string' || sha(JSON.stringify(composeFile)) !== planHash) throw fail('Plan does not match its hash.');
    const c = JSON.parse(composeFile), services = c.services ?? {};
    for (const [name, s] of Object.entries(services)) {
      if (s.labels?.[BINDING_LABEL] !== binding || s.privileged || s.pid === 'host' || s.ipc === 'host' || s.network_mode === 'host' || s.ports || s.devices ||
          (s.volumes ?? []).some(v => typeof v !== 'string' || v.startsWith('/') || v.includes('docker.sock'))) throw fail('Plan service ' + name + ' is not in the isolated shape.');
    }
    if (!services.coding || !services.ingress || c.networks?.workspace?.internal !== true) throw fail('Plan is missing the isolated runtime.');
    services.ingress.ports = ['127.0.0.1::3000'];
    return c;
  }
  // FLEET-5: two caches shared by every runtime on this machine (only its owner's work
  // runs here): package downloads for commands, Git objects for the broker. Runtimes
  // stopping never delete them; leaving or revocation does.
  cacheNames() { const s = this.state.deviceId.slice(0, 12); return {deps: 'ras-cache-deps-' + s, git: 'ras-cache-git-' + s}; }
  async ensureCaches() {
    const names = this.cacheNames();
    for (const name of Object.values(names)) {
      try { await this.exec('docker', ['volume', 'inspect', name], {timeoutMs: 20000}); continue; } catch { /* create below */ }
      await this.exec('docker', ['volume', 'create', '--label', OWNER_LABEL + '=device-cache', '--label', 'com.robinson.playground.device=' + this.state.deviceId, name], {timeoutMs: 20000});
      await this.exec('docker', ['run', '--rm', '--network', 'none', '-v', name + ':/c', READY_IMAGE, 'chown', '1000:1000', '/c'], {timeoutMs: 300000});
    }
    return names;
  }
  withCaches(c, names) {
    c.volumes = {...c.volumes, 'cache-deps': {name: names.deps, external: true}, 'cache-git': {name: names.git, external: true}};
    c.services.coding.volumes = [...(c.services.coding.volumes ?? []), 'cache-deps:/cache'];
    c.services.coding.environment = {...c.services.coding.environment, CODING_CACHE_ROOT: '/cache'};
    if (c.services.broker) {
      c.services.broker.volumes = [...(c.services.broker.volumes ?? []), 'cache-git:/git-cache'];
      c.services.broker.environment = {...c.services.broker.environment, NATIVE_GIT_OBJECT_CACHE: '/git-cache'};
    }
    return c;
  }
  async up(payload) {
    const project = payload.project;
    if (!/^ras-pg-[a-f0-9]{32}$/.test(project ?? '')) return {up: false, reason: 'bad_project'};
    let compose; try { compose = this.localCompose(payload); } catch (e) { return {up: false, reason: e.message}; }
    try { compose = this.withCaches(compose, await this.ensureCaches()); } catch { /* caches are optional; run without them */ }
    const dir = join(this.dir, 'allocations', project), file = join(dir, 'compose.json');
    await mkdir(dir, {recursive: true, mode: 0o700}); await writeFile(file, JSON.stringify(compose), {mode: 0o600});
    try {
      await this.exec('docker', ['compose', '-p', project, '-f', file, 'up', '-d', '--build'], {timeoutMs: 45 * 60000});
      const port = await this.exec('docker', ['compose', '-p', project, '-f', file, 'port', 'ingress', '3000'], {timeoutMs: 30000});
      const m = /^127\.0\.0\.1:(\d{2,5})$/.exec(port.trim().split('\n')[0]);
      if (!m) throw fail('Gateway is not on loopback.');
      const network = await this.attest(project, compose);
      this.state.allocations[payload.binding] = {project, port: Number(m[1]), file};
      await this.save();
      return {up: true, network};
    } catch (e) {
      try { await this.exec('docker', ['compose', '-p', project, '-f', file, 'down', '-v', '--remove-orphans'], {timeoutMs: 300000}); } catch { /* reported below */ }
      return {up: false, reason: String(e.stderr || e.message).slice(0, 200)};
    }
  }
  async attest(project, compose) {
    const net = JSON.parse(await this.exec('docker', ['network', 'inspect', compose.networks.workspace.name], {timeoutMs: 30000}))[0];
    const ids = (await this.exec('docker', ['compose', '-p', project, 'ps', '-q'], {timeoutMs: 30000})).split('\n').filter(Boolean);
    const rows = ids.length ? JSON.parse(await this.exec('docker', ['inspect', ...ids], {timeoutMs: 30000})) : [];
    const svc = r => r.Config?.Labels?.['com.docker.compose.service'];
    const published = r => Object.values(r.NetworkSettings?.Ports ?? {}).filter(Boolean).flat();
    const coding = rows.find(r => svc(r) === 'coding'), ingress = rows.find(r => svc(r) === 'ingress');
    return {workspaceInternal: net?.Internal === true, codingPublishedPorts: coding ? published(coding).length : -1,
      ingressLoopbackOnly: !!ingress && published(ingress).length > 0 && published(ingress).every(b => b.HostIp === '127.0.0.1'),
      noDockerSocket: rows.every(r => (r.Mounts ?? []).every(mt => !String(mt.Source ?? '').includes('docker.sock')))};
  }
  async relay({bindingPrefix, path, signature, body}) {
    const entry = Object.entries(this.state.allocations ?? {}).find(([b]) => b.startsWith(bindingPrefix ?? '-'));
    if (!entry || !['/v1/coding', '/v1/workspace'].includes(path)) return {status: 503, body: JSON.stringify({error: 'runtime_not_running'})};
    try {
      const res = await this.fetchImpl(`http://127.0.0.1:${entry[1].port}${path}`, {method: 'POST', redirect: 'error', headers: {'Content-Type': 'application/json', 'x-robinson-signature': signature}, body, signal: AbortSignal.timeout(50000)});
      const text = await res.text();
      return Buffer.byteLength(text) > 3 * 1024 * 1024 ? {status: 502, body: JSON.stringify({error: 'response_too_large'})} : {status: res.status, body: text};
    } catch { return {status: 502, body: JSON.stringify({error: 'runtime_unreachable'})}; }
  }
  async absent(binding) {
    const q = async kind => (await this.exec('docker', [kind, 'ls', ...(kind === 'container' ? ['-a'] : []), '-q', '--filter', 'label=' + BINDING_LABEL + '=' + binding], {timeoutMs: 30000})) === '';
    return {containersAbsent: await q('container'), volumesAbsent: await q('volume'), networksAbsent: await q('network')};
  }
  async down({binding, project}) {
    const a = this.state.allocations?.[binding], file = a?.file ?? join(this.dir, 'allocations', project, 'compose.json');
    try { await this.exec('docker', ['compose', '-p', project, '-f', file, 'down', '-v', '--remove-orphans', '--timeout', '30'], {timeoutMs: 300000}); } catch { /* verify below */ }
    const evidence = await this.absent(binding);
    if (evidence.containersAbsent && evidence.volumesAbsent && evidence.networksAbsent) { delete this.state.allocations[binding]; await this.save(); await rm(join(this.dir, 'allocations', project), {recursive: true, force: true}); }
    return evidence;
  }
  async terminate() {
    let all = true;
    for (const [binding, a] of Object.entries(this.state?.allocations ?? {})) { const e = await this.down({binding, project: a.project}); all &&= e.containersAbsent && e.volumesAbsent && e.networksAbsent; }
    if (this.state?.deviceId) for (const name of Object.values(this.cacheNames())) { try { await this.exec('docker', ['volume', 'rm', name], {timeoutMs: 60000}); } catch { /* absent */ } }
    return {allAbsent: all};
  }

  // PLAY-3 §6 startup reconciliation (distro/engine death, machine reboot):
  // recorded allocations are verified against Docker reality before the
  // first check-in reports them. An allocation whose containers are gone is
  // retired through down() — which only clears the record when absence is
  // proven — never silently resurrected and never blindly trusted.
  async reconcile() {
    let retired = 0;
    for (const [binding, a] of Object.entries(this.state?.allocations ?? {})) {
      let live = false;
      try { live = (await this.exec('docker', ['compose', '-p', a.project, '-f', a.file, 'ps', '-q'], {timeoutMs: 30000})).split('\n').filter(Boolean).length > 0; }
      catch (err) {
        // SECOND-SHIFT-599: a probe that could not run (daemon busy, the 30s
        // timeout expiring under boot load) is INDETERMINATE, not absence.
        // down() issues `docker compose down -v` BEFORE its own absence
        // verification, so calling it on a probe error could tear down a live
        // allocation — volumes included — the moment the daemon answers
        // again. Skip this allocation this cycle; the next reconcile (or the
        // check-in loop) retries with a working probe. Absence is acted on
        // only from a successful probe that returned zero containers.
        this.log('Reconcile probe failed for allocation ' + a.project + ' (' + (err?.message || err) + '); indeterminate — skipping this cycle, no down issued.');
        continue;
      }
      if (!live) { const e = await this.down({binding, project: a.project}); if (!this.state.allocations?.[binding]) { retired++; this.log('Reconciled allocation ' + a.project + ': no live containers; retired with absence evidence ' + JSON.stringify(e) + '.'); } }
    }
    return {retired};
  }

  async run({forever = true} = {}) {
    if (!await this.load()) throw fail('Not joined yet. Run: node agent.mjs join --device ID --code CODE');
    await this.reconcile();
    this.log('Robinson Playground host agent running for device ' + this.state.deviceId + '. Press Ctrl+C to stop.');
    let backoff = 1000;
    do {
      try { const r = await this.checkInOnce(); if (r.revoked) return r; backoff = 1000; await this.sleep(r.retryAfterMs ?? r.pollAfterMs ?? 0); }
      catch (e) { this.log('Check-in failed (' + e.message + '); retrying.'); await this.sleep(backoff); backoff = Math.min(backoff * 2, 60000); }
    } while (forever);
    return {stopped: true};
  }
  // Wait for every order this agent has started (used on shutdown and in tests).
  async settle() { while (this.inflight.size) await Promise.allSettled([...this.inflight]); }
  async leave() { await this.load(); const r = await this.terminate(); await rm(this.statePath, {force: true}); return r; }
}

function args(argv) { const o = {}; for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) o[argv[i].slice(2)] = argv[++i]; return o; }
async function main() {
  const [cmd, ...rest] = process.argv.slice(2), o = args(rest), agent = new HostAgent();
  if (cmd === 'join') { const r = await agent.join({device: o.device, code: o.code, server: o.server}); process.stdout.write('Paired. Fingerprint: ' + r.fingerprint + '\nNow open My connection, check the fingerprint matches, and press Approve. Then run: node agent.mjs run\n'); }
  else if (cmd === 'run') await agent.run();
  else if (cmd === 'status') { await agent.load(); process.stdout.write(JSON.stringify(agent.state ? {deviceId: agent.state.deviceId, server: agent.state.server, runtimes: Object.keys(agent.state.allocations ?? {}).length} : {joined: false}) + '\n'); }
  else if (cmd === 'leave') { const r = await agent.leave(); process.stdout.write('Stopped and removed this machine\'s runtimes: ' + JSON.stringify(r) + '\nAlso remove the device on My connection.\n'); }
  else process.stdout.write('Usage: node agent.mjs join --device ID --code CODE | run | status | leave\n');
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch(e => { process.stderr.write('Agent error: ' + e.message + '\n'); process.exitCode = 1; });
