import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bindHost } from '../../workers/native-git/server.js';

const compose = readFileSync(new URL('../../deploy/pc/compose.yaml', import.meta.url), 'utf8');
const install = readFileSync(new URL('../../deploy/pc/install.sh', import.meta.url), 'utf8');
const pcWorker = readFileSync(new URL('../../deploy/pc/pc-worker', import.meta.url), 'utf8');

describe('PC-WORKER-2: the PC kit works on WSL2 with mirrored networking (found live 2026-11-03)', () => {
  it('the worker can be told to listen on loopback only; anything else falls back to all interfaces', () => {
    expect(bindHost({ NATIVE_GIT_BIND_HOST: '127.0.0.1' })).toBe('127.0.0.1');
    expect(bindHost({ NATIVE_GIT_BIND_HOST: '::1' })).toBe('::1');
    expect(bindHost({})).toBe('0.0.0.0');
    expect(bindHost({ NATIVE_GIT_BIND_HOST: '192.168.1.5' })).toBe('0.0.0.0');
  });
  it('the PC compose uses host networking bound to loopback, with no Docker published ports and no blkio weight', () => {
    expect(compose).toMatch(/^\s*network_mode: host$/m);
    expect(compose).toMatch(/NATIVE_GIT_BIND_HOST: 127\.0\.0\.1/);
    expect(compose).toMatch(/PORT: \$\{PC_WORKER_API_PORT:-47300\}/);
    expect(compose).toMatch(/GIT_DIRECT_PORT: \$\{PC_WORKER_GIT_PORT:-47301\}/);
    expect(compose).not.toMatch(/^\s*ports:/m);
    expect(compose).not.toMatch(/^\s*blkio_config:/m);
  });
  it('both scripts build with a clean Docker config when the configured credential store is unusable', () => {
    for (const script of [install, pcWorker]) {
      expect(script).toMatch(/docker_config_check\(\) \{/);
      expect(script).toMatch(/compose\(\) \{\n  docker_config_check\n  docker compose/);
      expect(script).toContain('${DOCKER_CONFIG:-${HOME:-/root}/.docker}/config.json');
      expect(script).not.toMatch(/\$HOME\/\.docker/);
    }
  });
  it('the PC kit pushes to GitHub over HTTP/1.1 by default (measured 2026-11-03), with SSH left off', () => {
    expect(compose).toMatch(/NATIVE_GIT_GITHUB_HTTP_VERSION: \$\{NATIVE_GIT_GITHUB_HTTP_VERSION:-HTTP\/1\.1\}/);
    expect(compose).toMatch(/NATIVE_GIT_GITHUB_TRANSPORT: \$\{NATIVE_GIT_GITHUB_TRANSPORT:-https\}/);
    const example = readFileSync(new URL('../../deploy/pc/.env.example', import.meta.url), 'utf8');
    expect(example).toMatch(/^NATIVE_GIT_GITHUB_HTTP_VERSION=HTTP\/1\.1$/m);
    expect(example).toMatch(/^NATIVE_GIT_GITHUB_TRANSPORT=https$/m);
  });
});
