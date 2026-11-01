import {expect, it} from 'vitest';
import {playgroundAvailability} from '../../src/playground/availability.js';

// Enforcement evidence path: a protected operator observation is present, so the
// availability check goes straight to the runtime probe.
const now = Date.now();
const record = {row: {id: 'job_' + '1'.repeat(16)}, job: {idleTimeoutMs: 600000}, binding: {connection: 'c'},
  allocation: {binding: 'b'.repeat(64), url: 'https://ras-pg.example.test/', repositoryAttached: true}};
const cap = allowed => ({protocol: 1, arbitraryCommands: true, idleTimeoutMs: 600000, authority: {required: true, allowed},
  capacity: {cpu: {cgroupQuotaCpus: 2}, memory: {cgroupLimitBytes: 2 * 1024 ** 3}}});
function ctx(extra = {}) {
  const observation = {workspace_id: record.row.id, binding: record.allocation.binding, observedAt: now - 1000, expiresAt: now + 600000, isolation: true, termination: true,
    repositoryAttached: true, cpuCpus: 2, memoryBytes: 2 * 1024 ** 3, storageQuotaBytes: 10 * 1024 ** 3};
  return {now: () => now, db: {getSetting: async () => null}, env: {PLAYGROUND_ENFORCEMENT: JSON.stringify([observation])}, ...extra};
}

it('waits a few seconds for a just-attached runtime to receive its first authority lease', async () => {
  const answers = [cap(false), cap(false), cap(true)];
  let probes = 0;
  const result = await playgroundAvailability(ctx({authorityStartupWait: {tries: 4, ms: 1}}), record, async () => answers[Math.min(probes++, 2)]).catch(e => e);
  expect(probes).toBe(3);
  expect(result).toMatchObject({execution_available: true});
});

it('still reports recovery mode when the lease never arrives within the bounded wait', async () => {
  let probes = 0;
  const result = await playgroundAvailability(ctx({authorityStartupWait: {tries: 3, ms: 1}}), record, async () => { probes++; return cap(false); }).catch(e => e);
  expect(probes).toBe(3);
  expect(result).toMatchObject({reason: 'authority_unavailable', retryable: true, mode: 'recovery'});
});
