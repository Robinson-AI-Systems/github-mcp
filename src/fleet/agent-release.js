// AGENT-AUTO-RELEASE-1 (2026-11-15): the control plane publishes the Playground host
// agent it carries. Before this, a release needed an operator to build a bundle by hand,
// host it somewhere and set three env values; that was never done, so agent fixes
// (PLAY-IMAGES-1) reached machines only by manual rebuilds.
//
// Now the server packs tools/playground-device (the same payload files make-bundle.mjs
// uses) into a byte-identical tar.gz — fixed order, zero mtimes, fixed modes, gzip with no
// name or time — so every instance computes the same sha256. It serves those bytes at
// /api/fleet/agent-bundle?sha=<sha256> and advertises the version in version.json. Agents
// still verify the signature, the hash and refuse downgrades (update.mjs); bumping
// version.json is what releases a new agent.
//
// Explicit PLAYGROUND_AGENT_* env values still win (operator override), and
// PLAYGROUND_AGENT_AUTO_RELEASE=off turns the built-in release off.
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {gzipSync} from 'node:zlib';

export const PAYLOAD = ['agent.mjs', 'pair.mjs', 'update.mjs', 'run.mjs'];
const HERE = new URL('../../tools/playground-device/', import.meta.url);
const VERSION = /^fleet-agent\/\d+$/;

function header(name, size) {
  const h = Buffer.alloc(512);
  const put = (text, at, len) => h.write(text, at, Math.min(Buffer.byteLength(text), len), 'utf8');
  const octal = (n, len) => n.toString(8).padStart(len - 1, '0') + '\0';
  put('./' + name, 0, 100);
  put(octal(0o644, 8), 100, 8);
  put(octal(0, 8), 108, 8);
  put(octal(0, 8), 116, 8);
  put(octal(size, 12), 124, 12);
  put(octal(0, 12), 136, 12);
  h.fill(' ', 148, 156);
  h[156] = '0'.charCodeAt(0);
  put('ustar\0', 257, 6);
  put('00', 263, 2);
  let sum = 0;
  for (const b of h) sum += b;
  put(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
  return h;
}

/** A deterministic tar.gz of [name, bytes] entries, in the order given. */
export function packTarGz(entries) {
  const parts = [];
  for (const [name, bytes] of entries) {
    parts.push(header(name, bytes.length), bytes);
    const pad = (512 - (bytes.length % 512)) % 512;
    if (pad) parts.push(Buffer.alloc(pad));
  }
  parts.push(Buffer.alloc(1024));
  // Node's gzip header carries mtime 0 and no file name, so the output is stable.
  return gzipSync(Buffer.concat(parts), {level: 9});
}

/** The built-in release: {version, bytes, sha256}, or null when the files are not present. */
export function builtInRelease({read = path => readFileSync(new URL(path, HERE))} = {}) {
  try {
    const version = JSON.parse(String(read('version.json'))).version;
    if (!VERSION.test(version ?? '')) return null;
    const entries = PAYLOAD.map(f => [f, Buffer.from(read(f))]);
    entries.push(['version.json', Buffer.from(JSON.stringify({version}) + '\n')]);
    const bytes = packTarGz(entries);
    return {version, bytes, sha256: createHash('sha256').update(bytes).digest('hex')};
  } catch {
    return null;
  }
}

let memo = null;
export function currentRelease(options) {
  if (options) return builtInRelease(options);
  memo ??= builtInRelease();
  return memo;
}

/** The three release inputs agentUpdateAdvertisement needs, from env or the built-in release. */
export function releaseInputs(env, options) {
  if (env?.PLAYGROUND_AGENT_LATEST_VERSION || env?.PLAYGROUND_AGENT_BUNDLE_SHA256 || env?.PLAYGROUND_AGENT_BUNDLE_URL)
    return {version: env.PLAYGROUND_AGENT_LATEST_VERSION, bundleSha256: env.PLAYGROUND_AGENT_BUNDLE_SHA256, bundleUrl: env.PLAYGROUND_AGENT_BUNDLE_URL};
  if (String(env?.PLAYGROUND_AGENT_AUTO_RELEASE ?? '').toLowerCase() === 'off') return {};
  const base = String(env?.PUBLIC_BASE_URL ?? '').replace(/\/+$/, '');
  if (!/^https:\/\//.test(base)) return {};
  const rel = currentRelease(options);
  if (!rel) return {};
  return {version: rel.version, bundleSha256: rel.sha256, bundleUrl: `${base}/api/fleet/agent-bundle?sha=${rel.sha256}`};
}
