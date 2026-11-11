#!/usr/bin/env node
// PLAY-3 §5.1 launcher shim. Installed once by the installer and replaced
// only by a repair/reinstall; the systemd unit (and the Linux/macOS
// hand-rolled units) run THIS file, never a versioned payload directly.
//
//   node run.mjs run [agent args...]
//
// It starts the payload named by ~/.config/ras-playground/agent-versions/
// current (falling back to the installer-placed agent.mjs beside this file
// when no pointer exists yet), forwards stdio and signals, and propagates
// the child's exit code — with one exception: if a freshly flipped payload
// crash-loops (3 non-zero exits inside 10 minutes of an update), the shim
// flips the pointer back to the retained previous version, records the
// failure in pending-update-report.json for the agent's next check-in, and
// starts the previous payload instead. A bad update degrades to "still on
// the old version, control plane informed", never to a dead machine.
import {spawn} from 'node:child_process';
import {readFile, writeFile, rename, stat, mkdir} from 'node:fs/promises';
import {join, dirname} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {readPointer, rollbackPointer, versionsDir} from './update.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CRASH_WINDOW_MS = 10 * 60 * 1000, CRASH_LIMIT = 3;

export function payloadEntry(dir, version) { return join(versionsDir(dir), version, 'agent.mjs'); }

export async function resolvePayload({dir, here = HERE} = {}) {
  const version = await readPointer(dir);
  if (version) {
    const entry = payloadEntry(dir, version);
    if (await stat(entry).catch(() => null)) return {entry, version};
  }
  return {entry: join(here, 'agent.mjs'), version: null}; // installer payload (pre-versioning)
}

async function writeReport(dir, report) {
  await mkdir(dir, {recursive: true});
  const tmp = join(dir, 'pending-update-report.json.tmp');
  await writeFile(tmp, JSON.stringify(report), {mode: 0o600});
  await rename(tmp, join(dir, 'pending-update-report.json'));
}

async function loadCrashes(dir, now) {
  try { const s = JSON.parse(await readFile(join(dir, 'payload-crashes.json'), 'utf8')); return Array.isArray(s) ? s.filter(t => now() - t < CRASH_WINDOW_MS) : []; } catch { return []; }
}
async function saveCrashes(dir, crashes) {
  await mkdir(dir, {recursive: true});
  const tmp = join(dir, 'payload-crashes.json.tmp');
  await writeFile(tmp, JSON.stringify(crashes), {mode: 0o600});
  await rename(tmp, join(dir, 'payload-crashes.json'));
}

export async function supervise({dir, argv, spawnImpl = spawn, now = Date.now, log = m => process.stdout.write(m + '\n'), here} = {}) {
  let {entry, version} = await resolvePayload({dir, here});
  // Crash stamps persist across shim restarts: systemd restarts THIS shim on
  // a non-zero exit, so in-memory counting alone would never see a loop.
  let crashes = await loadCrashes(dir, now);
  for (;;) {
    const startedAt = now();
    const code = await new Promise((resolve, reject) => {
      const child = spawnImpl(process.execPath, [entry, ...argv], {stdio: 'inherit', env: {...process.env, RAS_PLAYGROUND_SUPERVISED: '1'}});
      const fwd = s => () => { try { child.kill(s); } catch { /* gone */ } };
      const onSigint = fwd('SIGINT'), onSigterm = fwd('SIGTERM');
      process.on('SIGINT', onSigint); process.on('SIGTERM', onSigterm);
      child.on('error', reject);
      child.on('exit', (c, signal) => { process.off('SIGINT', onSigint); process.off('SIGTERM', onSigterm); resolve(signal ? 1 : (c ?? 1)); });
    });
    if (code === 0) { await saveCrashes(dir, []); return 0; }
    // Crash accounting only applies to a versioned payload: the installer
    // payload has nothing to roll back to, so its exit code is propagated.
    if (!version) return code;
    crashes = crashes.filter(t => now() - t < CRASH_WINDOW_MS); crashes.push(now());
    await saveCrashes(dir, crashes);
    if (crashes.length < CRASH_LIMIT) return code; // systemd restarts the shim; the persisted stamps keep the count
    const back = await rollbackPointer(dir, version);
    if (!back) return code;
    await writeReport(dir, {failedVersion: version, rolledBackTo: back, at: new Date(now()).toISOString(), reason: 'crash_loop', runtimeMs: now() - startedAt}).catch(() => {});
    log('Agent payload ' + version + ' crash-looped; rolled back to ' + back + '.');
    ({entry, version} = await resolvePayload({dir, here}));
    crashes = []; await saveCrashes(dir, crashes);
  }
}

async function main() {
  const dir = process.env.RAS_PLAYGROUND_DIR || join(homedir(), '.config', 'ras-playground');
  process.exitCode = await supervise({dir, argv: process.argv.slice(2)});
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch(e => { process.stderr.write('Launcher error: ' + e.message + '\n'); process.exitCode = 1; });
