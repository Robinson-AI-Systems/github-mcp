// PLAY3-BOOT-RETRY-1 — the Playground host agent must survive a bad boot.
// Proven live 2026-11-11: dockerd's first start failed on an iptables chain
// race and recovered seconds later, but the agent unit's start job had
// already failed with result 'dependency' (it Requires=docker.service) and
// nothing retried it — the agent stayed down until started by hand. These
// pins hold the boot-retry contract in the service definitions and in the
// provisioning convergence script that restates them on older installs.
import {describe, it, expect} from 'vitest';
import {readFileSync} from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const systemUnit = read('../../tools/playground-device/service/ras-playground-agent.service');
const userUnit = read('../../tools/playground-device/service/ras-playground-agent.user.service');
const apply = read('../../tools/playground-device/provision/apply-provisioning.sh');

const unitSection = (text) => text.split('[Service]')[0];

describe('PLAY-3 agent boot-retry contract (system unit)', () => {
  it('orders after docker but only wants it — a failed docker start cannot fail the agent start job', () => {
    const unit = unitSection(systemUnit);
    expect(unit).toMatch(/^After=.*docker\.service/m);
    expect(unit).toMatch(/^Wants=.*docker\.service/m);
    expect(unit).not.toMatch(/^Requires=/m);
  });
  it('carries no start limit that could wedge it permanently, and restarts always', () => {
    expect(unitSection(systemUnit)).toMatch(/^StartLimitIntervalSec=0$/m);
    expect(systemUnit).not.toMatch(/^StartLimitBurst=/m);
    expect(systemUnit).toMatch(/^Restart=always$/m);
    expect(systemUnit).toMatch(/^RestartSec=5s$/m);
  });
});

describe('PLAY-3 agent boot-retry contract (user unit)', () => {
  it('mirrors the no-start-limit rule', () => {
    expect(unitSection(userUnit)).toMatch(/^StartLimitIntervalSec=0$/m);
    expect(userUnit).not.toMatch(/^StartLimitBurst=/m);
    expect(userUnit).toMatch(/^Restart=always$/m);
  });
});

describe('PLAY-3 provisioning convergence restates the boot-retry settings', () => {
  it('writes the boot-retry drop-in for an existing install', () => {
    expect(apply).toMatch(/ras-playground-agent\.service\.d\/10-boot-retry\.conf/);
    // The empty Requires= line is the dependency-list reset: it drops a
    // fatal docker.service requirement from an older base unit.
    expect(apply).toMatch(/\nRequires=\n/);
    expect(apply).toMatch(/Wants=docker\.service/);
    expect(apply).toMatch(/StartLimitIntervalSec=0/);
  });
  it('reloads systemd after writing the drop-in', () => {
    const stanza = apply.split('10-boot-retry.conf')[1] ?? '';
    expect(stanza).toMatch(/systemctl daemon-reload/);
  });
});
