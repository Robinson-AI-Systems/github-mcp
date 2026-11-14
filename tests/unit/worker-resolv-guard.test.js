import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const guard = readFileSync(new URL('../../deploy/pc/worker-resolv-guard.sh', import.meta.url), 'utf8');
const service = readFileSync(new URL('../../deploy/pc/worker-resolv-guard.service', import.meta.url), 'utf8');
const timer = readFileSync(new URL('../../deploy/pc/worker-resolv-guard.timer', import.meta.url), 'utf8');
const install = readFileSync(new URL('../../deploy/pc/install.sh', import.meta.url), 'utf8');
const pcWorker = readFileSync(new URL('../../deploy/pc/pc-worker', import.meta.url), 'utf8');

describe('WORKER-RESOLV-GUARD-1: the PC worker never runs silently with a broken resolver', () => {
  it('ships the guard script and its systemd units in the PC kit', () => {
    expect(existsSync(new URL('../../deploy/pc/worker-resolv-guard.sh', import.meta.url))).toBe(true);
    expect(service).toMatch(/ExecStart=\/srv\/robinson-git\/worker-resolv-guard\.sh/);
    expect(timer).toMatch(/OnBootSec=1min/);
    expect(timer).toMatch(/OnUnitActiveSec=2min/);
    expect(timer).toMatch(/Unit=worker-resolv-guard\.service/);
  });

  it('probes timed, from inside the worker container, the same names the worker itself reports on', () => {
    expect(guard).toMatch(/docker exec .*"\$CONTAINER" node -e/);
    expect(guard).toContain('timeout 20 docker exec');
    expect(guard).toContain('"github.com", "api.github.com"');
    expect(guard).toContain('dns.resolve4');
    expect(guard).toContain('PROBE_TIMEOUT_MS="${WORKER_RESOLV_GUARD_PROBE_TIMEOUT_MS:-2500}"');
    // The capture itself is checked, not just resolution: an empty resolv.conf is poisoned.
    expect(guard).toMatch(/nameserver\\s\+/);
    expect(guard).toContain('/etc/resolv.conf');
  });

  it('checks the host resolver first: during the boot race a restart cannot help, so it defers', () => {
    expect(guard).toMatch(/host_resolver_ready\(\) \{ grep -q '\^nameserver' \/etc\/resolv\.conf/);
    expect(guard).toContain('boot race');
    expect(guard).toContain('receipt_once "deferred"');
  });

  it('closes admission with the worker own owner-pause gate, marked as the guard pause', () => {
    expect(guard).toContain('PAUSE_FILE="$DATA_DIR/.owner-pause"');
    expect(guard).toContain('PAUSE_MARKER="worker-resolv-guard"');
    // A pause the guard did not write is never overridden: the owner's pause blocks the run.
    expect(guard).toMatch(/the worker is owner-paused; a repair never overrides the owner's pause/);
  });

  it('drains on the updater own rule and defers instead of ever stopping a running job', () => {
    expect(guard).toContain('MAX_DRAIN_SECONDS="${WORKER_RESOLV_GUARD_MAX_DRAIN_SECONDS:-900}"');
    expect(guard).toMatch(/compgen -G "\$DATA_DIR\/git_\*\/mutation\.lock"/);
    expect(guard).toMatch(/state established/);
    expect(guard).toContain('nothing was stopped');
    expect(guard).not.toMatch(/docker (stop|kill)/);
    expect(guard).not.toContain('compose down');
    expect(guard).not.toContain('pc-worker" stop');
    expect(guard).not.toContain('pc-worker" pause');
  });

  it('heals by the proven route first (restart), escalates once (recreate), then stops and shouts', () => {
    expect(guard).toContain('compose restart native-git');
    expect(guard).toContain('compose up -d --no-build --force-recreate native-git');
    expect(guard).toContain('receipt "healed_restart"');
    expect(guard).toContain('receipt "healed_recreate"');
    expect(guard).toContain('receipt "heal_failed"');
    expect(guard).toContain('MAX_HEAL_ATTEMPTS="${WORKER_RESOLV_GUARD_MAX_HEAL_ATTEMPTS:-3}"');
  });

  it('does nothing under Reclaim, under its own pause, during an autoupdate, or while another run holds the lock', () => {
    expect(guard).toContain('RECLAIM_FILE="${WORKER_RESOLV_GUARD_RECLAIM_FILE:-/mnt/c/VivienneHome/RECLAIM}"');
    expect(guard).toContain('GUARD_PAUSE="$HOME_DIR/.resolv-guard-pause"');
    expect(guard).toContain('UPDATER_MARKER="worker-autoupdate"');
    expect(guard).toContain('AUTOUPDATE_LOCK="$HOME_DIR/autoupdate/run.lock"');
    expect(guard).toMatch(/flock -n 9/);
  });

  it('writes a machine-readable status and receipts in its own state folder', () => {
    expect(guard).toContain('STATE_DIR="$HOME_DIR/resolv-guard"');
    expect(guard).toContain('STATUS_FILE="$STATE_DIR/status.json"');
    expect(guard).toContain('RECEIPTS_FILE="$STATE_DIR/receipts.jsonl"');
    expect(guard).toContain('receipt_once "detected"');
    expect(guard).toContain('receipt "recovered"');
  });

  it('install.sh installs the guard atomically and enables its timer when the source carries it', () => {
    expect(install).toContain('WORKER-RESOLV-GUARD-1');
    expect(install).toMatch(/install -m 755 "\$SRC\/deploy\/pc\/worker-resolv-guard\.sh" "\$guard_tmp" && mv "\$guard_tmp" "\$home\/worker-resolv-guard\.sh"/);
    expect(install).toMatch(/systemctl enable --now worker-resolv-guard\.timer/);
  });

  it('pc-worker exposes the guard status in one command', () => {
    expect(pcWorker).toContain('resolv-guard) cmd_resolv_guard "$@" ;;');
    expect(pcWorker).toContain('cmd_resolv_guard()');
    expect(pcWorker).toContain('state_dir="$HOME_DIR/resolv-guard"');
    expect(pcWorker).toContain('worker-resolv-guard.timer');
  });
});
