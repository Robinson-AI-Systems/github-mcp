// PLAY-3 §3 steps 1–2 — machine pre-flight and the F1–F14 failure-vocabulary
// classification. Pure and testable: the PowerShell bootstrapper collects
// raw probe facts (plain JSON) and this module turns them into a verdict the
// setup page can render: proceed, proceed-with-warning, or ONE plain-words
// detour (highest priority) with its guidance-page key. Run order at the
// top: S-mode (F11) and pending updates (F3) are checked first because a
// machine that will reboot or refuse installs must be handled before
// anything else starts. (Design §3 step 1–2; vocabulary §4.)
export const DETOUR_PAGES = {
  F1: 'bios-virtualization', F2: 'bios-virtualization', F3: 'pending-updates', F4: 'disk-space',
  F5: 'admin-account', F6: 'antivirus', F7: 'another-installer', F8: 'network', F9: 'windows-edition',
  F10: 'virtualization-platform', F11: 's-mode', F12: 'download-failed', F13: 'join-rejected', F14: 'first-run-failed'
};
// Lower number wins when several detours apply.
const PRIORITY = ['F11', 'F3', 'F1', 'F2', 'F9', 'F10', 'F5', 'F4', 'F6', 'F7', 'F8', 'F12', 'F14', 'F13'];

// facts: {
//   os: {build, edition: 'Home'|'Pro'|..., isWindows11},
//   smode: bool, pendingReboot: bool, pendingUpdateCount: int,
//   cpuVirtualizationFirmware: bool|null, hypervisorPresent: bool,
//   wslFeatureEnabled: bool, vmPlatformEnabled: bool, wslPresent: bool,
//   isAdmin: bool, freeDiskBytes: int|null,
//   avProducts: [names], conflictingAv: bool,
//   installerBusy: bool,            // another MSI/install in progress
//   networkOk: bool|null,            // control-plane reachability probe
//   existingDistro: bool,            // PlaygroundWorker present
//   dockerDesktopPresent: bool, fleetKeeperPresent: bool, otherDistros: [names]
// }
export function classifyPreflight(facts) {
  const detours = [], warnings = [];
  if (!facts) return {verdict: 'detour', detours: [{code: 'F14', page: DETOUR_PAGES.F14, what: 'Setup could not read this computer\u2019s state.'}], warnings, facts: {}};
  if (facts.smode) detours.push({code: 'F11', page: DETOUR_PAGES.F11, what: 'This PC is in Windows S mode, which only allows Store apps.'});
  if (facts.pendingReboot || (facts.pendingUpdateCount ?? 0) > 0) detours.push({code: 'F3', page: DETOUR_PAGES.F3, what: 'Windows has updates waiting to finish.'});
  if (facts.cpuVirtualizationFirmware === false) detours.push({code: 'F1', page: DETOUR_PAGES.F1, what: 'Hardware virtualization is turned off in this PC\u2019s BIOS settings.'});
  if (facts.hypervisorPresent === false && facts.cpuVirtualizationFirmware !== true) detours.push({code: 'F2', page: DETOUR_PAGES.F2, what: 'Windows could not start its virtual machine platform.'});
  if (!facts.os?.isWindows11) detours.push({code: 'F9', page: DETOUR_PAGES.F9, what: 'This setup supports Windows 11. Older Windows versions are not supported yet.'});
  if (facts.wslPresent === false && facts.wslFeatureEnabled === false && facts.vmPlatformEnabled === false) detours.push({code: 'F10', page: DETOUR_PAGES.F10, what: 'The Windows virtualization features could not be enabled.'});
  if (!facts.isAdmin) detours.push({code: 'F5', page: DETOUR_PAGES.F5, what: 'The signed-in account is not an administrator on this PC.'});
  if (facts.freeDiskBytes != null && facts.freeDiskBytes < 15 * 1073741824) detours.push({code: 'F4', page: DETOUR_PAGES.F4, what: 'This PC needs at least 15 GB of free disk space.'});
  if (facts.conflictingAv) detours.push({code: 'F6', page: DETOUR_PAGES.F6, what: 'Your antivirus blocked part of the setup.'});
  if (facts.installerBusy) detours.push({code: 'F7', page: DETOUR_PAGES.F7, what: 'Another program is installing right now.'});
  if (facts.networkOk === false) detours.push({code: 'F8', page: DETOUR_PAGES.F8, what: 'Setup could not reach the internet.'});
  // Fast-path facts the design requires to be DETECTED and left untouched —
  // informational only, never a detour.
  const detected = {
    existingPlaygroundDistro: !!facts.existingDistro,
    dockerDesktopLeftAlone: !!facts.dockerDesktopPresent,
    fleetKeeperLeftAlone: !!facts.fleetKeeperPresent,
    otherDistrosLeftAlone: facts.otherDistros ?? [],
    featuresAlreadyOn: !!(facts.wslFeatureEnabled && facts.vmPlatformEnabled),
    rebootNeeded: !(facts.wslFeatureEnabled && facts.vmPlatformEnabled)
  };
  detours.sort((a, b) => PRIORITY.indexOf(a.code) - PRIORITY.indexOf(b.code));
  return {verdict: detours.length ? 'detour' : 'proceed', primary: detours[0] ?? null, detours, warnings, detected};
}

// Map a runtime failure during the flow onto the same vocabulary, so the
// enrollment-status endpoint and the setup page never invent new strings.
export function classifyFailure(stage, detail = {}) {
  const by = {download: 'F12', join: 'F13', firstrun: 'F14', network: 'F8', av: 'F6', installer: 'F7'};
  const code = by[stage] ?? 'F14';
  return {code, page: DETOUR_PAGES[code], what: detail.what ?? 'Something needs attention before setup can continue.'};
}
