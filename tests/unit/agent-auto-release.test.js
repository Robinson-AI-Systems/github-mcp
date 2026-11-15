// AGENT-AUTO-RELEASE-1: the control plane publishes the agent it carries — a deterministic bundle,
// served by sha256, advertised from version.json, verified by the agent's own updater end to end.
import {describe, expect, it} from 'vitest';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {builtInRelease, currentRelease, packTarGz, releaseInputs, PAYLOAD} from '../../src/fleet/agent-release.js';
import {agentUpdateAdvertisement} from '../../src/fleet/host.js';
import {nativeWorkerPublicKey} from '../../src/native-git/signing.js';
import {verifyRelease} from '../../tools/playground-device/update.mjs';
import {createAgentBundleHandler} from '../../api/fleet/agent-bundle.js';

const env = {TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'), PUBLIC_BASE_URL: 'https://github.example.test/'};
const version = JSON.parse(readFileSync('tools/playground-device/version.json', 'utf8')).version;

describe('the built-in agent release', () => {
  it('is byte-identical on every build, so every instance advertises the same sha256', () => {
    const a = builtInRelease(), b = builtInRelease();
    expect(a.version).toBe(version);
    expect(a.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(Buffer.compare(a.bytes, b.bytes)).toBe(0);
    expect(currentRelease().sha256).toBe(a.sha256);
  });
  it('unpacks with system tar into exactly the payload and version.json', () => {
    const d = mkdtempSync(join(tmpdir(), 'agent-rel-'));
    try {
      writeFileSync(join(d, 'b.tar.gz'), builtInRelease().bytes);
      mkdirSync(join(d, 'x'));
      execFileSync('tar', ['-xzf', join(d, 'b.tar.gz'), '-C', join(d, 'x')]);
      for (const f of PAYLOAD) expect(readFileSync(join(d, 'x', f), 'utf8')).toBe(readFileSync(join('tools/playground-device', f), 'utf8'));
      expect(JSON.parse(readFileSync(join(d, 'x', 'version.json'), 'utf8'))).toEqual({version});
    } finally { rmSync(d, {recursive: true, force: true}); }
  });
  it('is advertised, signed, from the server\'s own base URL — and verifies against the pinned key', () => {
    const ad = agentUpdateAdvertisement(env);
    const rel = verifyRelease(ad, nativeWorkerPublicKey(env), 'fleet-agent/1');
    expect(rel).toMatchObject({version, bundleSha256: builtInRelease().sha256});
    expect(rel.bundleUrl).toBe(`https://github.example.test/api/fleet/agent-bundle?sha=${builtInRelease().sha256}`);
  });
  it('stays off without an https base URL, when switched off, and yields to operator values', () => {
    expect(releaseInputs({})).toEqual({});
    expect(releaseInputs({PUBLIC_BASE_URL: 'http://plain.test'})).toEqual({});
    expect(releaseInputs({...env, PLAYGROUND_AGENT_AUTO_RELEASE: 'off'})).toEqual({});
    expect(releaseInputs({...env, PLAYGROUND_AGENT_LATEST_VERSION: 'fleet-agent/9', PLAYGROUND_AGENT_BUNDLE_SHA256: 'b'.repeat(64), PLAYGROUND_AGENT_BUNDLE_URL: 'https://x.test/a.tgz'}))
      .toEqual({version: 'fleet-agent/9', bundleSha256: 'b'.repeat(64), bundleUrl: 'https://x.test/a.tgz'});
    expect(releaseInputs(env, {read: () => { throw new Error('no files'); }})).toEqual({});
  });
  it('packs a valid tar for arbitrary entries', () => {
    const d = mkdtempSync(join(tmpdir(), 'agent-tar-'));
    try {
      writeFileSync(join(d, 't.tgz'), packTarGz([['a.txt', Buffer.from('x'.repeat(513))], ['b.txt', Buffer.from('')]]));
      expect(execFileSync('tar', ['-tzf', join(d, 't.tgz')], {encoding: 'utf8'}).split('\n').filter(Boolean)).toEqual(['./a.txt', './b.txt']);
    } finally { rmSync(d, {recursive: true, force: true}); }
  });
});

describe('the bundle route', () => {
  const call = async (handler, url, method = 'GET') => {
    const res = {statusCode: 0, headers: {}, body: null, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = b ?? null; },
      status(s) { this.statusCode = s; return this; }, send(b) { this.body = b; return this; }};
    await handler({method, url}, res);
    return res;
  };
  it('serves the exact bytes for the advertised sha and nothing for any other', async () => {
    const h = createAgentBundleHandler(), rel = builtInRelease();
    const ok = await call(h, `/api/fleet/agent-bundle?sha=${rel.sha256}`);
    expect(ok.statusCode).toBe(200);
    expect(Buffer.compare(ok.body, rel.bytes)).toBe(0);
    expect(ok.headers['content-type']).toBe('application/gzip');
    expect((await call(h, `/api/fleet/agent-bundle?sha=${'0'.repeat(64)}`)).statusCode).toBe(404);
    expect((await call(h, `/api/fleet/agent-bundle?sha=${rel.sha256}`, 'HEAD')).body).toBeNull();
    expect((await call(h, '/api/fleet/agent-bundle')).statusCode).toBe(404);
    expect((await call(h, `/api/fleet/agent-bundle?sha=${rel.sha256}`, 'POST')).statusCode).toBe(405);
  });
});
