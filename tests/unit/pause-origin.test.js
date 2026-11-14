// PAUSE-ORIGIN-1 (2026-11-11): the worker's admission pause file is shared by the owner (pc-worker pause),
// the self-updater and the name-lookup guard. A failed self-update left it in place "for operator repair",
// and agents were told the worker was "paused by its owner (the computer is in use)" while nobody was at
// the PC. These pin who-holds-it in the admission answer, the worker's text, the pool status and the
// control plane's message — while the reason code (and so placement and retry) stays `owner_paused`.
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createResourceMonitor, pauseHolder, pausedText, refusalText, OWNER_PAUSED_TEXT } from '../../workers/native-git/resources.js';
import { judgeHost } from '../../src/native-git/pool.js';
import { pausedMessage } from '../../src/native-git/client.js';

const histogram = () => ({ percentile: () => 0, enable() {}, disable() {}, reset() {} });
const dirs = [];
afterEach(async () => { for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true }); });
async function monitorWith(text) {
 const dir = await mkdtemp(join(tmpdir(), 'pause-origin-'));
 dirs.push(dir);
 const pauseFile = join(dir, '.owner-pause');
 if (text !== null) await writeFile(pauseFile, text);
 return createResourceMonitor({ root: dir, delay: histogram(), pauseFile, memory: () => 1e12, filesystem: async () => ({ bavail: 1e9, bsize: 4096 }) });
}

describe('who holds the pause', () => {
 it('reads the marker the scripts write', () => {
  expect(pauseHolder('paused 2026-11-11T21:45:00Z worker-autoupdate\n')).toBe('updater');
  expect(pauseHolder('paused 2026-11-11T21:45:00Z worker-resolv-guard\n')).toBe('resolver_guard');
  expect(pauseHolder('paused by chris\n')).toBe('owner');
  expect(pauseHolder('')).toBe('owner');
 });

 it('an updater pause is refused as owner_paused but held by the updater, with honest text', async () => {
  const m = await monitorWith('paused 2026-11-11T21:45:00Z worker-autoupdate\n');
  const check = await m.check();
  m.close();
  expect(check).toMatchObject({ allowed: false, reason: 'owner_paused', held_by: 'updater' });
  const text = refusalText(check, 'pressure');
  expect(text).toMatch(/self-updater, not by its owner/);
  expect(text).not.toMatch(/computer is in use/);
 });

 it("the owner's own pause keeps its words", async () => {
  const m = await monitorWith('paused 2026-11-11T21:45:00Z\n');
  const check = await m.check();
  m.close();
  expect(check.held_by).toBe('owner');
  expect(refusalText(check, 'pressure')).toBe(OWNER_PAUSED_TEXT);
 });

 it('no pause file: admitted, no holder', async () => {
  const m = await monitorWith(null);
  const check = await m.check();
  m.close();
  expect(check.allowed).toBe(true);
  expect(m.pauseHolder()).toBe('owner');
 });

 it('pool status names a maintenance holder; owner pauses stay plain', () => {
  const host = { enabled: true };
  const cap = { ready: true, capacity_mode: 'resource-aware' };
  expect(judgeHost(host, { ...cap, owner_paused: true, admission: { allowed: false, reason: 'owner_paused', held_by: 'updater' } })).toMatchObject({ state: 'paused', reason: 'self-updater' });
  const owner = judgeHost(host, { ...cap, owner_paused: true, admission: { allowed: false, reason: 'owner_paused', held_by: 'owner' } });
  expect(owner.state).toBe('paused');
  expect(owner.reason).toBeUndefined();
 });

 it('the control plane says who holds it', () => {
  expect(pausedMessage('updater')).toMatch(/self-updater, not by its owner/);
  expect(pausedMessage('resolver_guard')).toMatch(/name-lookup guard, not by its owner/);
  expect(pausedMessage(undefined)).toMatch(/paused by its owner \(the computer it runs on is in use\)/);
  expect(pausedText('nobody')).toBe(OWNER_PAUSED_TEXT);
 });
});
