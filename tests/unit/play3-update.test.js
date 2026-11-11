// PLAY-3 step 2 — signed agent self-update (design §5.1) and the launcher
// shim's crash-loop rollback. Adversarial cases first: an update is the most
// privileged order the control plane can give, so bad signature, bad hash,
// downgrade and busy-host refusals are the contract, not edge cases.
import {describe, it, expect, afterEach} from 'vitest';
import {generateKeyPairSync, sign, createPublicKey, createHash} from 'node:crypto';
import {mkdtemp, rm, mkdir, writeFile, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {verifyRelease, applyUpdate, readPointer, compareVersions, RELEASE_PURPOSE} from '../../tools/playground-device/update.mjs';
import {agentUpdateAdvertisement} from '../../src/fleet/host.js';
import {nativeWorkerPublicKey} from '../../src/native-git/signing.js';

const cleanups = []; afterEach(async () => { for (const c of cleanups.splice(0)) await c(); });
const dir = async () => { const d = await mkdtemp(join(tmpdir(), 'play3-update-')); cleanups.push(() => rm(d, {recursive: true, force: true})); return d; };
const control = generateKeyPairSync('ed25519');
const controlKey = 'ed25519:' + createPublicKey(control.privateKey).export({format: 'der', type: 'spki'}).toString('base64');
const other = generateKeyPairSync('ed25519').privateKey;
const envelope = (rel, key = control.privateKey) => { const body = JSON.stringify(rel); return {body, signature: 'ed25519:' + sign(null, Buffer.from(body), key).toString('base64url')}; };
const bundleBytes = Buffer.from('fake bundle bytes for tests');
const release = (over = {}) => ({purpose: RELEASE_PURPOSE, version: 'fleet-agent/2', bundleSha256: createHash('sha256').update(bundleBytes).digest('hex'), bundleUrl: 'https://example.test/agent-release.tar.gz', ...over});
const unpackOk = async (bundlePath, dest) => { await mkdir(dest, {recursive: true}); await writeFile(join(dest, 'version.json'), JSON.stringify({version: 'fleet-agent/2'})); await writeFile(join(dest, 'agent.mjs'), '// payload'); };
const fetchBundle = async () => ({ok: true, status: 200, arrayBuffer: async () => bundleBytes.buffer.slice(bundleBytes.byteOffset, bundleBytes.byteOffset + bundleBytes.byteLength)});

describe('PLAY-3 update advertisement verification', () => {
  it('accepts a properly signed newer release', () => {
    expect(verifyRelease(envelope(release()), controlKey, 'fleet-agent/1')).toMatchObject({version: 'fleet-agent/2'});
    expect(compareVersions('fleet-agent/10', 'fleet-agent/2')).toBeGreaterThan(0);
    expect(compareVersions('1.2.3', '1.2.10')).toBeLessThan(0);
  });
  it('refuses a bad signature and a foreign key', () => {
    const ad = envelope(release());
    expect(() => verifyRelease({...ad, signature: 'ed25519:' + 'A'.repeat(86)}, controlKey, 'fleet-agent/1')).toThrow();
    expect(() => verifyRelease(envelope(release(), other), controlKey, 'fleet-agent/1')).toThrow(/signature/);
  });
  it('refuses downgrades and same-version updates', () => {
    expect(() => verifyRelease(envelope(release({version: 'fleet-agent/1'})), controlKey, 'fleet-agent/1')).toThrow(/not newer/);
    expect(() => verifyRelease(envelope(release({version: 'fleet-agent/1'})), controlKey, 'fleet-agent/2')).toThrow(/not newer/);
  });
  it('refuses malformed advertisements (hash, URL, purpose)', () => {
    expect(() => verifyRelease(envelope(release({bundleSha256: 'zz'})), controlKey, 'fleet-agent/1')).toThrow(/hash/);
    expect(() => verifyRelease(envelope(release({bundleUrl: 'http://example.test/x.tgz'})), controlKey, 'fleet-agent/1')).toThrow(/HTTPS/);
    expect(() => verifyRelease(envelope(release({purpose: 'robinson-fleet-order/v1'})), controlKey, 'fleet-agent/1')).toThrow(/purpose/);
  });
});

describe('PLAY-3 update application and rollback', () => {
  it('applies when idle: verifies the bundle hash, flips the pointer atomically, retains the previous version', async () => {
    const d = await dir();
    await mkdir(join(d, 'agent-versions', 'fleet-agent/1'), {recursive: true});
    await writeFile(join(d, 'agent-versions', 'current'), 'fleet-agent/1\n');
    const r = await applyUpdate({dir: d, ad: envelope(release()), controlKey, currentVersion: 'fleet-agent/1', fetchImpl: fetchBundle, isIdle: () => true, unpack: unpackOk, log: () => {}});
    expect(r).toMatchObject({applied: true, version: 'fleet-agent/2', previous: 'fleet-agent/1'});
    expect(await readPointer(d)).toBe('fleet-agent/2');
    const {readdir} = await import('node:fs/promises');
    expect((await readdir(join(d, 'agent-versions'))).sort()).toEqual(['current', 'fleet-agent/1', 'fleet-agent/2']);
  });
  it('refuses a bundle whose bytes do not match the signed hash', async () => {
    const d = await dir();
    const badFetch = async () => ({ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(4)});
    await expect(applyUpdate({dir: d, ad: envelope(release()), controlKey, currentVersion: 'fleet-agent/1', fetchImpl: badFetch, isIdle: () => true, unpack: unpackOk})).rejects.toThrow(/hash/);
    expect(await readPointer(d)).toBeNull();
  });
  it('refuses while busy, and waits for drain when a protocol raise would strand allocations', async () => {
    const d = await dir();
    expect(await applyUpdate({dir: d, ad: envelope(release()), controlKey, currentVersion: 'fleet-agent/1', fetchImpl: fetchBundle, isIdle: () => false, unpack: unpackOk})).toMatchObject({applied: false, reason: 'busy'});
    expect(await applyUpdate({dir: d, ad: envelope(release({minimumProtocol: 2})), controlKey, currentVersion: 'fleet-agent/1', fetchImpl: fetchBundle, isIdle: () => true, hasAllocations: () => true, unpack: unpackOk})).toMatchObject({applied: false, reason: 'awaiting_drain'});
    expect(await readPointer(d)).toBeNull();
  });
  it('refuses a bundle whose version.json disagrees with the advertisement', async () => {
    const d = await dir();
    const lying = async (p, dest) => { await mkdir(dest, {recursive: true}); await writeFile(join(dest, 'version.json'), JSON.stringify({version: 'fleet-agent/9'})); await writeFile(join(dest, 'agent.mjs'), '// payload'); };
    await expect(applyUpdate({dir: d, ad: envelope(release()), controlKey, currentVersion: 'fleet-agent/1', fetchImpl: fetchBundle, isIdle: () => true, unpack: lying})).rejects.toThrow(/does not match/);
    expect(await readPointer(d)).toBeNull();
  });
});

describe('PLAY-3 control-plane advertisement', () => {
  const env = {TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64')};
  it('is absent unless a full release is configured, and verifies against the pinned key when present', () => {
    expect(agentUpdateAdvertisement(env)).toBeNull();
    expect(agentUpdateAdvertisement({...env, PLAYGROUND_AGENT_LATEST_VERSION: 'fleet-agent/2'})).toBeNull();
    const full = {...env, PLAYGROUND_AGENT_LATEST_VERSION: 'fleet-agent/2', PLAYGROUND_AGENT_BUNDLE_SHA256: 'a'.repeat(64), PLAYGROUND_AGENT_BUNDLE_URL: 'https://example.test/agent-release.tar.gz'};
    const ad = agentUpdateAdvertisement(full);
    expect(ad).not.toBeNull();
    expect(verifyRelease(ad, nativeWorkerPublicKey(env), 'fleet-agent/1')).toMatchObject({version: 'fleet-agent/2', bundleSha256: 'a'.repeat(64)});
    expect(agentUpdateAdvertisement({...full, PLAYGROUND_AGENT_BUNDLE_URL: 'http://example.test/x.tgz'})).toBeNull();
  });
});

describe('PLAY-3 launcher shim rollback (real subprocesses)', () => {
  const runShim = (d) => new Promise((resolve) => execFile(process.execPath, [join(process.cwd(), 'tools/playground-device/run.mjs'), 'run'], {env: {...process.env, RAS_PLAYGROUND_DIR: d}, timeout: 30000}, (e, stdout) => resolve({code: e?.code ?? 0, stdout})));
  it('rolls a crash-looping payload back to the retained version and reports it', async () => {
    const d = await dir();
    const v1 = join(d, 'agent-versions', 'fleet-agent/1'), v2 = join(d, 'agent-versions', 'fleet-agent/2');
    await mkdir(v1, {recursive: true}); await mkdir(v2, {recursive: true});
    await writeFile(join(v1, 'agent.mjs'), 'process.stdout.write("old payload ran\\n");\n');
    await writeFile(join(v2, 'agent.mjs'), 'process.exit(3);\n');
    await writeFile(join(d, 'agent-versions', 'current'), 'fleet-agent/2\n');
    // Crash stamps persist across shim restarts (systemd restarts the shim):
    // runs one and two propagate the crash; on the third the shim flips the
    // pointer and starts the retained payload instead.
    expect((await runShim(d)).code).toBe(3);
    expect((await runShim(d)).code).toBe(3);
    const third = await runShim(d);
    expect(third.code).toBe(0);
    expect(third.stdout).toContain('old payload ran');
    expect(await readPointer(d)).toBe('fleet-agent/1');
    const report = JSON.parse(await readFile(join(d, 'pending-update-report.json'), 'utf8'));
    expect(report).toMatchObject({failedVersion: 'fleet-agent/2', rolledBackTo: 'fleet-agent/1', reason: 'crash_loop'});
  }, 60000);
});
