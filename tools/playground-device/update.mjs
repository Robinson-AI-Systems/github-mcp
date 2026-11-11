#!/usr/bin/env node
// PLAY-3 §5.1 — signed agent self-update: advertisement verification, drain
// gate, atomic version-pointer flip and rollback. The advertisement rides the
// ordinary check-in response and is signed with the same control-plane key
// that signs orders (pinned at join); an update is the most privileged order,
// so it verifies against exactly that trust root and nothing else.
//
// Bundle format: a .tar.gz containing the payload files (agent.mjs, pair.mjs,
// update.mjs, run.mjs, version.json) at its root. version.json carries
// {"version": "fleet-agent/N"} and the bundle sha256 in the signed
// advertisement must match the downloaded bytes before anything is unpacked.
import {createHash, createPublicKey, verify} from 'node:crypto';
import {execFile} from 'node:child_process';
import {mkdir, readFile, writeFile, rename, rm, readdir, stat} from 'node:fs/promises';
import {join} from 'node:path';

export const RELEASE_PURPOSE = 'robinson-playground-agent-release/v1';
const sha256 = v => createHash('sha256').update(v).digest('hex');
const fail = m => Object.assign(new Error(m), {agent: true});

// Versions are "fleet-agent/<int>" (the AGENT_VERSION shape) or dotted
// semver. Anything else is not a version this updater will move toward.
export function parseVersion(v) {
  if (typeof v !== 'string') return null;
  const m = /^fleet-agent\/(\d+)$/.exec(v);
  if (m) return [Number(m[1])];
  if (/^\d+\.\d+\.\d+$/.test(v)) return v.split('.').map(Number);
  return null;
}
export function compareVersions(a, b) {
  const pa = parseVersion(a), pb = parseVersion(b);
  if (!pa || !pb) return null;
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) { const d = (pa[i] ?? 0) - (pb[i] ?? 0); if (d) return d; }
  return 0;
}

// Verify an advertisement envelope {body, signature} against the control key
// pinned at join ("ed25519:<base64 der spki>", the agent.json controlKey).
// Returns the parsed release or throws. Rejects downgrades and same-version
// "updates" here so no caller can apply one by forgetting the check.
export function verifyRelease(ad, controlKey, currentVersion) {
  if (!ad || typeof ad.body !== 'string' || typeof ad.signature !== 'string' || !ad.signature.startsWith('ed25519:')) throw fail('Update advertisement is not signed.');
  const key = createPublicKey({key: Buffer.from(String(controlKey ?? '').slice(8), 'base64'), format: 'der', type: 'spki'});
  if (!verify(null, Buffer.from(ad.body), key, Buffer.from(ad.signature.slice(8), 'base64url'))) throw fail('Update advertisement signature invalid.');
  let rel; try { rel = JSON.parse(ad.body); } catch { throw fail('Update advertisement is not JSON.'); }
  if (rel.purpose !== RELEASE_PURPOSE) throw fail('Update advertisement has the wrong purpose.');
  if (!parseVersion(rel.version)) throw fail('Update advertisement version is not a version.');
  if (!/^[a-f0-9]{64}$/.test(rel.bundleSha256 ?? '')) throw fail('Update advertisement bundle hash is malformed.');
  let url; try { url = new URL(rel.bundleUrl); } catch { throw fail('Update advertisement bundle URL is invalid.'); }
  if (url.protocol !== 'https:' || url.username || url.password) throw fail('Update bundle must be a bare HTTPS URL.');
  if (rel.minimumProtocol !== undefined && (!Number.isSafeInteger(rel.minimumProtocol) || rel.minimumProtocol < 1)) throw fail('Update minimumProtocol is malformed.');
  const cmp = compareVersions(rel.version, currentVersion);
  if (cmp === null) throw fail('Cannot compare update version with the running version.');
  if (cmp <= 0) throw fail('Update is not newer than the running version (downgrade refused).');
  return rel;
}

export const versionsDir = dir => join(dir, 'agent-versions');
export const pointerPath = dir => join(versionsDir(dir), 'current');
export async function readPointer(dir) {
  try { const v = (await readFile(pointerPath(dir), 'utf8')).trim(); return parseVersion(v) ? v : null; } catch { return null; }
}
export async function flipPointer(dir, version) {
  if (!parseVersion(version)) throw fail('Not a version: ' + version);
  await mkdir(versionsDir(dir), {recursive: true, mode: 0o700});
  const tmp = pointerPath(dir) + '.tmp';
  await writeFile(tmp, version + '\n', {mode: 0o600});
  await rename(tmp, pointerPath(dir)); // atomic on the same filesystem
}
export async function listVersions(dir) {
  // Version strings may contain a slash ('fleet-agent/2'), so a payload
  // directory can nest (agent-versions/fleet-agent/2). A directory counts
  // as a payload when it directly holds agent.mjs; walk up to 3 levels.
  const found = [];
  async function walk(abs, rel, depth) {
    let entries; try { entries = await readdir(abs, {withFileTypes: true}); } catch { return; }
    if (rel && entries.some(e => e.isFile() && e.name === 'agent.mjs') && parseVersion(rel)) { found.push(rel); return; }
    if (depth >= 3) return;
    for (const e of entries) if (e.isDirectory()) await walk(join(abs, e.name), rel ? rel + '/' + e.name : e.name, depth + 1);
  }
  await walk(versionsDir(dir), '', 0);
  return found;
}

function defaultExec(cmd, args, {timeoutMs = 120000} = {}) {
  return new Promise((resolve, reject) => execFile(cmd, args, {encoding: 'utf8', timeout: timeoutMs}, (e, stdout, stderr) => e ? reject(Object.assign(e, {stdout, stderr})) : resolve(stdout)));
}
async function defaultUnpack(bundlePath, destDir, exec) {
  await mkdir(destDir, {recursive: true, mode: 0o700});
  await exec('tar', ['-xzf', bundlePath, '-C', destDir], {timeoutMs: 120000});
}

// Apply a verified release. Gates, in order: signature/version (verifyRelease),
// drain (isIdle must report no in-flight orders and no allocation mid-up/down;
// a minimumProtocol above the running protocol additionally requires zero
// allocations — the update waits for drain rather than stranding a runtime),
// bundle hash, unpack + payload version match. On success the pointer is
// flipped and the caller exits so the supervisor restarts into the new
// payload; the previous version directory is retained for rollback.
export async function applyUpdate({dir, ad, controlKey, currentVersion, fetchImpl = fetch, isIdle = () => false, hasAllocations = () => false, unpack = null, exec = defaultExec, log = () => {}}) {
  const rel = verifyRelease(ad, controlKey, currentVersion);
  if (!isIdle()) return {applied: false, reason: 'busy', version: rel.version};
  if ((rel.minimumProtocol ?? 1) > 1 && hasAllocations()) return {applied: false, reason: 'awaiting_drain', version: rel.version};
  const res = await fetchImpl(rel.bundleUrl, {redirect: 'error'});
  if (!res.ok) throw fail('Update bundle download failed (' + res.status + ').');
  const bytes = Buffer.from(await res.arrayBuffer());
  if (sha256(bytes) !== rel.bundleSha256) throw fail('Update bundle hash does not match the signed advertisement.');
  const dest = join(versionsDir(dir), rel.version);
  const staging = dest + '.tmp';
  await rm(staging, {recursive: true, force: true});
  const bundlePath = join(versionsDir(dir), '.bundle.tar.gz');
  await mkdir(versionsDir(dir), {recursive: true, mode: 0o700});
  await writeFile(bundlePath, bytes, {mode: 0o600});
  try {
    await (unpack ?? (async (p, d) => defaultUnpack(p, d, exec)))(bundlePath, staging);
    let vj; try { vj = JSON.parse(await readFile(join(staging, 'version.json'), 'utf8')); } catch { throw fail('Update bundle has no readable version.json.'); }
    if (vj.version !== rel.version) throw fail('Update bundle version does not match the signed advertisement.');
    if (!(await stat(join(staging, 'agent.mjs')).catch(() => null))) throw fail('Update bundle has no agent.mjs.');
    await rm(dest, {recursive: true, force: true});
    await rename(staging, dest);
  } finally { await rm(bundlePath, {force: true}); await rm(staging, {recursive: true, force: true}); }
  const previous = await readPointer(dir);
  await flipPointer(dir, rel.version);
  log('Agent update applied: ' + currentVersion + ' -> ' + rel.version + ' (previous retained: ' + (previous ?? 'installer payload') + ').');
  return {applied: true, version: rel.version, previous};
}

// Rollback used by the launcher shim: flip the pointer back to the newest
// retained version that is not `badVersion`. Returns the version flipped to,
// or null when there is nothing to roll back to.
export async function rollbackPointer(dir, badVersion) {
  const candidates = (await listVersions(dir)).filter(v => v !== badVersion).sort((a, b) => compareVersions(b, a));
  if (!candidates.length) return null;
  await flipPointer(dir, candidates[0]);
  return candidates[0];
}
