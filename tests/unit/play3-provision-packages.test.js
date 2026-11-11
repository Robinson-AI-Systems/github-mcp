// PLAY-3 device tooling contract: the allocation build uses a remote git
// build context, so every provisioned device must carry BOTH the buildx
// plugin (BuildKit) and a git binary (classic-builder fallback fetches the
// context with it). Missing either, the first allocation_up order is refused
// on the device (proven live 2026-11-11: "unable to find 'git'").
import {describe, it, expect} from 'vitest';
import {readFileSync} from 'node:fs';

const userData = readFileSync(new URL('../../tools/playground-device/provision/user-data.yaml', import.meta.url), 'utf8');
const apply = readFileSync(new URL('../../tools/playground-device/provision/apply-provisioning.sh', import.meta.url), 'utf8');

describe('PLAY-3 provisioning carries the allocation build tools', () => {
  it('cloud-init package list includes docker-buildx and git', () => {
    expect(userData).toMatch(/^\s+-\s+docker-buildx\s*$/m);
    expect(userData).toMatch(/^\s+-\s+git\s*$/m);
  });
  it('the convergence script installs docker-buildx when buildx is missing', () => {
    expect(apply).toMatch(/docker buildx version/);
    expect(apply).toMatch(/need_pkgs="\$need_pkgs docker-buildx"/);
  });
  it('the convergence script installs git when git is missing', () => {
    expect(apply).toMatch(/command -v git/);
    expect(apply).toMatch(/need_pkgs="\$need_pkgs git"/);
  });
});
