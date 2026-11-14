import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const updater = readFileSync(new URL('../../deploy/pc/worker-autoupdate.sh', import.meta.url), 'utf8');
const service = readFileSync(new URL('../../deploy/pc/worker-autoupdate.service', import.meta.url), 'utf8');
const timer = readFileSync(new URL('../../deploy/pc/worker-autoupdate.timer', import.meta.url), 'utf8');
const install = readFileSync(new URL('../../deploy/pc/install.sh', import.meta.url), 'utf8');
const pcWorker = readFileSync(new URL('../../deploy/pc/pc-worker', import.meta.url), 'utf8');

describe('WORKER-AUTOUPDATE-1: the PC worker updates itself between jobs (owner order 2026-11-11)', () => {
  it('ships the updater script and its systemd units in the PC kit', () => {
    expect(existsSync(new URL('../../deploy/pc/worker-autoupdate.sh', import.meta.url))).toBe(true);
    expect(service).toMatch(/ExecStart=\/srv\/robinson-git\/worker-autoupdate\.sh/);
    expect(timer).toMatch(/OnUnitActiveSec=10min/);
    expect(timer).toMatch(/Unit=worker-autoupdate\.service/);
  });

  it('compares the worker build against the release branch tip, the same ref install.sh installs', () => {
    expect(updater).toContain('RELEASE_REF="live"');
    expect(updater).toMatch(/git ls-remote "\$REPO_URL" "refs\/heads\/\$RELEASE_REF"/);
    expect(updater).toMatch(/current_build\(\) \{ env_value SOURCE_COMMIT/);
  });

  it('closes admission with the worker own owner-pause gate, marked as the updater pause', () => {
    expect(updater).toContain('PAUSE_FILE="$DATA_DIR/.owner-pause"');
    expect(updater).toContain('PAUSE_MARKER="worker-autoupdate"');
    // A pause the updater did not write is never removed and blocks the run entirely.
    expect(updater).toMatch(/if \[\[ -e "\$PAUSE_FILE" \]\]; then\n    journal "skip: the worker is owner-paused/);
  });

  it('drains on real job boundaries and defers instead of ever stopping a running job', () => {
    expect(updater).toContain('MAX_DRAIN_SECONDS="${WORKER_AUTOUPDATE_MAX_DRAIN_SECONDS:-900}"');
    expect(updater).toMatch(/compgen -G "\$DATA_DIR\/git_\*\/mutation\.lock"/);
    expect(updater).toMatch(/state established/);
    expect(updater).toContain('receipt "deferred"');
    expect(updater).not.toMatch(/docker (stop|kill|restart)/);
    expect(updater).not.toMatch(/compose (stop|down|kill)/);
    expect(updater).not.toContain('pc-worker" stop');
    expect(updater).not.toContain('pc-worker" pause');
  });

  it('swaps through the existing control and verifies before reopening admission', () => {
    expect(updater).toMatch(/"\$HOME_DIR\/pc-worker" update --commit "\$target"/);
    expect(updater).toContain('verify_build "$target"');
    expect(updater).toContain('key_pin_ok');
    expect(updater).toContain('/api/native-git-key');
    expect(updater).toContain('http_version_ok');
    expect(updater).toContain('public_health_ok');
  });

  it('rolls back to the previous build automatically when verification fails', () => {
    expect(updater).toMatch(/"\$HOME_DIR\/pc-worker" update --commit "\$current"/);
    expect(updater).toContain('receipt "rolled_back"');
    expect(updater).toContain('receipt "rollback_failed"');
  });

  it('does nothing under Reclaim, under its own pause, or while another run holds the lock', () => {
    expect(updater).toContain('RECLAIM_FILE="${WORKER_AUTOUPDATE_RECLAIM_FILE:-/mnt/c/VivienneHome/RECLAIM}"');
    expect(updater).toContain('UPDATER_PAUSE="$HOME_DIR/.autoupdate-pause"');
    expect(updater).toMatch(/flock -n 9/);
  });

  it('AUTOUPDATE-GATE-2: the public check avoids the host hairpin and never gates the build', () => {
    const gate = updater.slice(updater.indexOf('public_health_ok() {'), updater.indexOf('key_pin_ok() {'));
    // host resolution, then a public DoH resolution of the same origin, then the canonical origins
    expect(gate).toMatch(/curl -fsS --max-time 10 "\$origin\/health"/);
    expect(gate).toMatch(/--doh-url https:\/\/1\.1\.1\.1\/dns-query "\$origin\/health"/);
    expect(gate).toContain('PC_WORKER_CANONICAL_ORIGINS "https://gitworker.robinsonaisystems.com"');
    // the worker is host-networked: probing "from inside the container" is the same vantage
    expect(gate).not.toMatch(/docker exec/);
    const verify = updater.slice(updater.indexOf('verify_build() {'), updater.indexOf('main() {'));
    expect(verify).toContain('PUBLIC_PATH="unverified from this host"');
    expect(verify).not.toMatch(/public_health_ok \|\| \{[^}]*return 1/);
    expect(verify.trimEnd().endsWith('return 0\n}') || /return 0\n\}\s*$/.test(verify)).toBe(true);
  });

  it('AUTOUPDATE-GATE-2: the updater starts the new build itself if the install left the old one running', () => {
    expect(updater).toMatch(/ensure_running\(\) \{/);
    expect(updater).toMatch(/up -d --no-build native-git/);
    expect(updater).toMatch(/journal "install\.sh completed for \$target"\n    ensure_running "\$target"/);
    expect(updater).toMatch(/ensure_running "\$current" \|\| journal/);
  });

  it('AUTOUPDATE-GATE-2: a rollback keeps this updater (the failed-target hold survives)', () => {
    expect(updater).toContain('cp -p "$0" "$STATE_DIR/updater.keep"');
    expect(updater).toMatch(/mv "\$HOME_DIR\/\.worker-autoupdate\.sh\.keep\.tmp" "\$HOME_DIR\/worker-autoupdate\.sh"/);
  });

  it('AUTOUPDATE-GATE-1: a target that failed verification is held, not retried every cycle', () => {
    expect(updater).toContain('FAILED_TARGET_FILE="$STATE_DIR/failed-target"');
    // recorded the moment verification fails, before the rollback
    expect(updater).toMatch(/rolling back to \$current"\n  printf '%s\\n' "\$target" > "\$FAILED_TARGET_FILE"/);
    // checked before any admission pause is written
    expect(updater.indexOf('already failed verification here')).toBeLessThan(updater.indexOf("printf 'paused %s %s\\n'"));
    expect(updater).toContain('write_status "holding"');
    // cleared by a verified update
    expect(updater).toContain('rm -f "$PAUSE_FILE" "$FAILED_TARGET_FILE"');
  });

  it("AUTOUPDATE-GATE-1: under the updater's own pause install.sh starts the new image; only the owner's pause holds it", () => {
    expect(install).toMatch(/if \[\[ -e "\$data\/\.owner-pause" \]\] && ! grep -q "worker-autoupdate" "\$data\/\.owner-pause"/);
  });

  it('AUTOUPDATE-GATE-1: verification checks the RUNNING container build, not only the .env record', () => {
    const verify = updater.slice(updater.indexOf('verify_build() {'), updater.indexOf('main() {'));
    expect(verify).toContain('running="$(running_build)"');
    expect(updater).toMatch(/running_build\(\) \{\n  docker inspect -f .*"\$WORKER_CONTAINER"/);
    expect(updater).toContain("sed -n 's/^NATIVE_GIT_BUILD_COMMIT=//p'");
  });

  it('receipts stay one JSON object per line even after a hand-written line without a newline', () => {
    const block = updater.slice(updater.indexOf('receipt() {'), updater.indexOf('pending_since_for() {'));
    expect(block).toContain('lead = "" if f.read(1) == b"\\n" else "\\n"');
    expect(block).toContain('f.write(lead + json.dumps(r) + "\\n")');
  });

  it('preflights the build machinery and defers before closing admission when it is broken', () => {
    expect(updater).toContain('preflight_build');
    expect(updater).toMatch(/receipt "deferred"[^;]*build machinery preflight failed/);
    expect(updater.indexOf('preflight_build; then')).toBeLessThan(updater.indexOf('pause_owned=1'));
    expect(updater).toContain('KIT_DOCKER_CONFIG="$STATE_DIR/docker"');
    // the kit config is self-contained: install.sh checks `docker compose version`, so the
    // kit seeds BOTH plugins it needs, checksum-verified
    expect(updater).toContain('seed_plugin docker-buildx');
    expect(updater).toContain('seed_plugin docker-compose');
    expect(updater).toContain('sha256sum -c -');
    expect(updater).toContain('docker compose version');
  });

  it('checks public health from the Windows side when the WSL side cannot reach the Funnel name', () => {
    expect(updater).toContain('/mnt/c/Windows/System32/curl.exe');
    expect(updater).toMatch(/public_health_ok\(\)[\s\S]*?curl\.exe/);
  });

  it('never downgrades: a rewound release branch is journaled and skipped', () => {
    expect(updater).toMatch(/merge-base --is-ancestor "\$target" "\$current"/);
    expect(updater).toContain('not downgrading');
  });

  it('writes a machine-readable status and a receipt for every attempt', () => {
    expect(updater).toContain('STATUS_FILE="$STATE_DIR/status.json"');
    expect(updater).toContain('RECEIPTS_FILE="$STATE_DIR/receipts.jsonl"');
    expect(updater).toContain('"paired_build"');
    expect(updater).toContain('receipt "updated"');
    expect(updater).toContain('receipt "deferred"');
  });

  it('install.sh installs the updater atomically and enables its timer when the source carries it', () => {
    expect(install).toContain('WORKER-AUTOUPDATE-1');
    expect(install).toMatch(/install -m 755 "\$SRC\/deploy\/pc\/worker-autoupdate\.sh" "\$au_tmp" && mv "\$au_tmp" "\$home\/worker-autoupdate\.sh"/);
    expect(install).toMatch(/systemctl enable --now worker-autoupdate\.timer/);
  });

  it('pc-worker exposes the updater status in one command', () => {
    expect(pcWorker).toContain('autoupdate) cmd_autoupdate "$@" ;;');
    expect(pcWorker).toContain('cmd_autoupdate()');
    expect(pcWorker).toContain('status.json');
  });
});
