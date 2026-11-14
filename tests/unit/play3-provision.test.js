// PLAY-3 steps 3–4 — provisioning payload logic: the .wslconfig merge
// (never clobber, idempotent) and the pre-flight F1–F14 classification
// (design §3 steps 1–2 + §4 vocabulary; the PowerShell bootstrapper mirrors
// this module and is held to the same fixture outcomes in its dry-run test).
import {describe, it, expect} from 'vitest';
import {mergeWslConfig, recommendedSizing} from '../../tools/playground-device/provision/merge-wslconfig.mjs';
import {classifyPreflight, classifyFailure} from '../../tools/playground-device/setup/preflight.mjs';

const sizing = recommendedSizing({memoryBytes: 32 * 1073741824, processors: 16});
const goodFacts = {os: {build: 26100, edition: 'Windows 11 Pro', isWindows11: true}, smode: false, pendingReboot: false, pendingUpdateCount: 0,
  cpuVirtualizationFirmware: true, hypervisorPresent: true, wslFeatureEnabled: true, vmPlatformEnabled: true, wslPresent: true,
  isAdmin: true, freeDiskBytes: 200 * 1073741824, avProducts: ['Microsoft Defender'], conflictingAv: false, installerBusy: false,
  networkOk: true, existingDistro: false, dockerDesktopPresent: false, fleetKeeperPresent: false, otherDistros: []};

describe('PLAY-3 .wslconfig merge', () => {
  it('sizes by the clamp rule', () => {
    expect(sizing).toEqual({memory: '8GB', processors: '8', swap: '2GB', networkingMode: 'mirrored'});
    expect(recommendedSizing({memoryBytes: 4 * 1073741824, processors: 2})).toEqual({memory: '2GB', processors: '1', swap: '2GB', networkingMode: 'mirrored'});
  });
  it('creates a fresh file and is idempotent', () => {
    const once = mergeWslConfig('', sizing);
    expect(once.changed).toBe(true);
    expect(once.text).toContain('[wsl2]');
    expect(once.text).toContain('memory=8GB');
    const twice = mergeWslConfig(once.text, sizing);
    expect(twice.changed).toBe(false);
    expect(twice.text).toBe(once.text);
  });
  it('respects existing user keys and preserves unknown sections and keys verbatim', () => {
    const existing = '# my settings\n[wsl2]\nmemory=32GB\nlocalhostForwarding=true\n\n[experimental]\nautoProxy=true\n';
    const r = mergeWslConfig(existing, sizing);
    expect(r.changed).toBe(true);
    expect(r.respected).toEqual(['memory']);
    expect(r.text).toContain('memory=32GB');
    expect(r.text).toContain('localhostForwarding=true');
    expect(r.text).toContain('[experimental]\nautoProxy=true');
    expect(r.text).toContain('processors=8');
    expect(r.text).not.toContain('memory=8GB');
  });
  it('refuses an unparsable file instead of rewriting it', () => {
    expect(() => mergeWslConfig('this is not a config file', sizing)).toThrow(/unparsable|outside/);
  });
});

describe('PLAY-3 pre-flight classification (F1–F14)', () => {
  it('proceeds on a healthy machine and reports what will be left alone', () => {
    const r = classifyPreflight({...goodFacts, dockerDesktopPresent: true, fleetKeeperPresent: true, otherDistros: ['Ubuntu']});
    expect(r.verdict).toBe('proceed');
    expect(r.detected).toMatchObject({dockerDesktopLeftAlone: true, fleetKeeperLeftAlone: true, otherDistrosLeftAlone: ['Ubuntu'], featuresAlreadyOn: true, rebootNeeded: false});
  });
  it('detours S mode (F11) ahead of everything else', () => {
    const r = classifyPreflight({...goodFacts, smode: true, pendingReboot: true, cpuVirtualizationFirmware: false});
    expect(r.primary).toMatchObject({code: 'F11', page: 's-mode'});
  });
  it('detours pending updates (F3) before BIOS (F1)', () => {
    const r = classifyPreflight({...goodFacts, pendingReboot: true, cpuVirtualizationFirmware: false, hypervisorPresent: false});
    expect(r.primary.code).toBe('F3');
    expect(r.detours.map(d => d.code)).toContain('F1');
  });
  it('detours BIOS-off virtualization (F1) with the BIOS page', () => {
    expect(classifyPreflight({...goodFacts, cpuVirtualizationFirmware: false, hypervisorPresent: false}).primary).toMatchObject({code: 'F1', page: 'bios-virtualization'});
    // Live finding 2026-11-11 (instance #1): a running hypervisor (WSL2 already working) refutes the firmware flag -- no F1.
    expect(classifyPreflight({...goodFacts, cpuVirtualizationFirmware: false}).detours.map(d => d.code)).not.toContain('F1');
  });
  it('detours a standard account (F5), low disk (F4) and old Windows (F9)', () => {
    expect(classifyPreflight({...goodFacts, isAdmin: false}).primary.code).toBe('F5');
    expect(classifyPreflight({...goodFacts, freeDiskBytes: 5 * 1073741824}).primary.code).toBe('F4');
    expect(classifyPreflight({...goodFacts, os: {build: 19045, edition: 'Windows 10', isWindows11: false}}).primary.code).toBe('F9');
  });
  it('maps runtime failures onto the same vocabulary', () => {
    expect(classifyFailure('download').code).toBe('F12');
    expect(classifyFailure('join')).toMatchObject({code: 'F13', page: 'join-rejected'});
    expect(classifyFailure('firstrun').code).toBe('F14');
  });
});
