// WORKER-RESOLV-GUARD-1 BEHAVIOUR (SECOND-SHIFT-611): the source-shape tests
// in worker-resolv-guard.test.js pin that the guard script SAYS the right
// things; this file pins that it DOES them. It runs the real
// deploy/pc/worker-resolv-guard.sh end to end in a temp worker home with the
// outside world stubbed on PATH: `docker` (inspect = running, exec = the
// in-container resolver probe, whose verdict the scenario controls; compose
// calls are logged, never executed), `curl` (local health always OK) and
// `ss` (no established connections). Everything else the script uses —
// flock, python3 status/receipt writes, the drain lock glob, the pause
// files — is real, against the temp home. One environment assumption is
// inherited from production: the host's own /etc/resolv.conf carries a
// nameserver (the boot-race deferral for an empty host file is a status
// string this harness does not simulate).
import {describe, it, expect, afterEach} from 'vitest';
import {execFile} from 'node:child_process';
import {mkdtemp, rm, mkdir, writeFile, readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'deploy', 'pc', 'worker-resolv-guard.sh');
const HEALTHY = JSON.stringify({nameserver: true, ok: true, ms: 12, names: {'github.com': 'ok', 'api.github.com': 'ok'}});
const POISONED = JSON.stringify({nameserver: false, ok: false, ms: 2500, names: {'github.com': 'down', 'api.github.com': 'down'}});
const cleanups = [];
afterEach(async () => { for (const c of cleanups.splice(0)) await c(); });

async function guardHome({poisonedProbes = 0, drainLock = false, extraEnv = {}} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'resolv-guard-behavior-'));
  cleanups.push(() => rm(root, {recursive: true, force: true}));
  const home = join(root, 'worker-home'), stub = join(root, 'stub');
  await mkdir(join(home, 'data'), {recursive: true});
  await mkdir(stub, {recursive: true});
  await writeFile(join(home, '.env'), 'PC_WORKER_DATA=' + join(home, 'data') + '\n');
  if (drainLock) {
    await mkdir(join(home, 'data', 'git_fixture'), {recursive: true});
    await writeFile(join(home, 'data', 'git_fixture', 'mutation.lock'), '');
  }
  await writeFile(join(stub, 'probe-healthy.json'), HEALTHY + '\n');
  await writeFile(join(stub, 'probe-poisoned.json'), POISONED + '\n');
  const docker = [
    '#!/usr/bin/env bash',
    'echo "docker $*" >> "$STUB_DIR/calls.log"',
    'case "$1" in',
    '  inspect) echo "running" ;;',
    '  exec)',
    '    n=0; [ -f "$STUB_DIR/probe-count" ] && n=$(cat "$STUB_DIR/probe-count"); n=$((n+1)); echo "$n" > "$STUB_DIR/probe-count"',
    '    if [ "$n" -le "${STUB_POISONED_COUNT:-0}" ]; then cat "$STUB_DIR/probe-poisoned.json"; else cat "$STUB_DIR/probe-healthy.json"; fi ;;',
    '  compose) exit 0 ;;',
    'esac',
    'exit 0',
    '',
  ].join('\n');
  await writeFile(join(stub, 'docker'), docker, {mode: 0o755});
  await writeFile(join(stub, 'curl'), '#!/usr/bin/env bash\nexit 0\n', {mode: 0o755});
  await writeFile(join(stub, 'ss'), '#!/usr/bin/env bash\nexit 0\n', {mode: 0o755});
  const env = {
    ...process.env,
    PATH: stub + ':' + process.env.PATH,
    PC_WORKER_HOME: home,
    WORKER_RESOLV_GUARD_RECLAIM_FILE: join(root, 'no-reclaim-flag'),
    STUB_DIR: stub,
    STUB_POISONED_COUNT: String(poisonedProbes),
    ...extraEnv,
  };
  const run = () => new Promise((resolve) => {
    execFile('bash', [SCRIPT], {env, timeout: 55000}, (error, stdout, stderr) => resolve({code: error?.code ?? 0, stdout, stderr}));
  });
  const read = async (p) => existsSync(p) ? readFile(p, 'utf8') : '';
  return {
    run,
    status: async () => JSON.parse(await read(join(home, 'resolv-guard', 'status.json')) || '{}'),
    receipts: () => read(join(home, 'resolv-guard', 'receipts.jsonl')),
    calls: () => read(join(stub, 'calls.log')),
    pauseExists: () => existsSync(join(home, 'data', '.owner-pause')),
  };
}

describe('worker-resolv-guard behaviour (real script, stubbed docker/curl/ss)', () => {
  it('healthy probe: reports ok, writes no heal receipt, never touches compose', async () => {
    const g = await guardHome({poisonedProbes: 0});
    const r = await g.run();
    expect(r.code).toBe(0);
    expect((await g.status()).state).toBe('ok');
    expect(await g.receipts()).toBe('');
    expect(await g.calls()).not.toContain('compose');
    expect(g.pauseExists()).toBe(false);
  }, 60000);

  it('poisoned then healed by restart: detects, closes admission, restarts, reopens, journals healed_restart', async () => {
    const g = await guardHome({poisonedProbes: 1});
    const r = await g.run();
    expect(r.code).toBe(0);
    const receipts = await g.receipts();
    expect(receipts).toContain('"result": "detected"');
    expect(receipts).toContain('"result": "healed_restart"');
    expect(await g.calls()).toContain('compose');
    expect(await g.calls()).toContain('restart');
    expect((await g.status()).state).toBe('ok');
    // Admission was closed for the repair and reopened by the heal.
    expect(g.pauseExists()).toBe(false);
  }, 60000);

  it('drain cap reached with work in flight: defers, stops nothing, reopens its own pause', async () => {
    const g = await guardHome({poisonedProbes: 99, drainLock: true, extraEnv: {WORKER_RESOLV_GUARD_MAX_DRAIN_SECONDS: '1'}});
    const r = await g.run();
    expect(r.code).toBe(0);
    const receipts = await g.receipts();
    expect(receipts).toContain('"result": "detected"');
    expect(receipts).toContain('"result": "deferred"');
    expect(receipts).toContain('drain cap');
    expect((await g.status()).state).toBe('deferred');
    // The cardinal rule: a running job is never killed for a repair.
    expect(await g.calls()).not.toContain('compose');
    expect(g.pauseExists()).toBe(false);
  }, 60000);
});
