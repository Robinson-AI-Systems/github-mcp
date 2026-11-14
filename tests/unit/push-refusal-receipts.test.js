// PUSH-REFUSAL-RECEIPTS-1 (2026-11-13): a push exception can be granted for a file the push
// guard refused (so the file has never been on GitHub), from the guard's value-free receipts.
// Credential-shaped inputs are built at runtime.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/tools/github-read.js', async (orig) => {
 const real = await orig();
 const notFound = () => Object.assign(new Error('Not Found'), { status: 404 });
 return { ...real, readerFor: async (args) => ({ owner: args.owner, octokit: { request: async () => { throw notFound(); } } }) };
});

const { findingFor } = await import('../../workers/native-git/upload.js');
const { blockingPushFindings } = await import('../../src/github/file-protection.js');
const { scannerSettings } = await import('../../src/github/scanner-policy.js');
const { cleanReceipts, recordRefusals, refusalsFor, receiptBlocked, refusalKey } = await import('../../src/github/push-refusals.js');
const { verifyScannerChange, assertScannerVerifications } = await import('../../src/tools/scanner-verification.js');
const { contentProtectionCheck } = await import('../../src/tools/code-read.js');

const KEY = ['-----BEGIN', 'PRIVATE KEY-----\nMIIB\n-----END', 'PRIVATE KEY-----'].join(' ');
const PATH = 'acceptance/check.py', BLOB = 'c'.repeat(40);
const text = `planted = '${KEY.replace(/\n/g, '\\n')}'\n`;
const memoryDb = () => { const m = new Map(); return { getSetting: async k => m.has(k) ? structuredClone(m.get(k)) : null, setSetting: async (k, v) => { m.set(k, structuredClone(v)); }, m }; };

describe('refused findings carry value fingerprints, never values', () => {
 it('findingFor lists each finding\'s rule, line and value fingerprint', () => {
  const f = findingFor(PATH, Buffer.from(text));
  expect(f.values.length).toBe(1);
  expect(f.values[0]).toMatchObject({ rule: 'private-key', line: 1 });
  expect(f.values[0].valueFingerprint).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(f)).not.toContain('MIIB');
 });
});

describe('receipts', () => {
 it('keeps only well-formed, value-free receipts, per repository, without duplicates', async () => {
  const db = memoryDb();
  const fp = findingFor(PATH, Buffer.from(text)).values[0].valueFingerprint;
  const good = { path: PATH, blobSha: BLOB, rule: 'private-key', line: 1, valueFingerprint: fp };
  expect(cleanReceipts([good, { ...good, path: '/abs' }, { ...good, blobSha: 'x' }, { ...good, value: KEY }]).length).toBe(2);
  expect(cleanReceipts([{ ...good, value: KEY }])[0]).not.toHaveProperty('value');
  await recordRefusals(db, 'Org', 'Repo', [good, good]);
  await recordRefusals(db, 'org', 'repo', [good]);
  expect((await refusalsFor(db, 'org', 'repo', { path: PATH, blobSha: BLOB })).length).toBe(1);
  expect(await refusalsFor(db, 'org', 'other', { path: PATH, blobSha: BLOB })).toEqual([]);
  expect(JSON.stringify([...db.m.values()])).not.toContain('MIIB');
  const old = Date.now() + 8 * 24 * 3600 * 1000;
  expect(await refusalsFor(db, 'org', 'repo', { path: PATH, blobSha: BLOB }, old)).toEqual([]);
 });
 it('applies exactly the push guard\'s exception rule', () => {
  const fp = findingFor(PATH, Buffer.from(text)).values[0].valueFingerprint;
  const r = { path: PATH, blobSha: BLOB, rule: 'private-key', valueFingerprint: fp };
  const allow = scannerSettings({ suppressions: [{ rule: 'private-key', path: PATH, blobSha: BLOB, reason: 'planted fake key in a test', pushException: true, valueFingerprint: fp }] });
  const other = scannerSettings({ suppressions: [{ rule: 'private-key', path: 'elsewhere.py', blobSha: BLOB, reason: 'planted fake key in a test', pushException: true, valueFingerprint: fp }] });
  for (const s of [scannerSettings({}), allow, other])
   expect(receiptBlocked(r, s)).toBe(blockingPushFindings(PATH, text, s).length > 0);
 });
});

describe('check and configure work for a refused file that is not on GitHub', () => {
 const setup = async () => {
  const db = memoryDb();
  const v = findingFor(PATH, Buffer.from(text)).values[0];
  await recordRefusals(db, 'org', 'repo', [{ path: PATH, blobSha: BLOB, ...v }]);
  return { db, fp: v.valueFingerprint };
 };
 it('check lists the refused findings from the receipt', async () => {
  const { db, fp } = await setup();
  const out = await contentProtectionCheck.handler({ owner: 'org', repo: 'repo', path: PATH, blobSha: BLOB }, { db });
  const body = typeof out === 'string' ? JSON.parse(out) : out;
  const parsed = body.structuredContent ?? body;
  expect(JSON.stringify(parsed)).toContain(fp);
  expect(JSON.stringify(parsed)).toContain('refused_push_receipt');
  expect(JSON.stringify(parsed)).not.toContain('MIIB');
 });
 it('a push exception verifies through the push door from the receipt, and coverage passes', async () => {
  const { db, fp } = await setup();
  const before = scannerSettings({}), s = { rule: 'private-key', path: PATH, blobSha: BLOB, reason: 'planted fake key in a test', pushException: true, valueFingerprint: fp };
  const after = scannerSettings({ suppressions: [s] });
  const check = await verifyScannerChange({ db }, { owner: 'org', repo: 'repo' }, before, after,
   { path: PATH, blobSha: BLOB, rule: 'private-key', fingerprint: fp, door: 'push', expectedBefore: true, expectedAfter: false });
  expect(check).toMatchObject({ before_detected: true, after_detected: false, source: 'refused_push_receipt' });
  expect(() => assertScannerVerifications(before, after, [check])).not.toThrow();
 });
 it('a wrong fingerprint or an unrecorded blob is refused, and other doors still need GitHub', async () => {
  const { db } = await setup();
  const before = scannerSettings({}), after = before;
  await expect(verifyScannerChange({ db }, { owner: 'org', repo: 'repo' }, before, after,
   { path: PATH, blobSha: BLOB, rule: 'private-key', fingerprint: 'd'.repeat(64), door: 'push', expectedBefore: true, expectedAfter: false })).rejects.toThrow(/no refused push recorded/);
  await expect(verifyScannerChange({ db }, { owner: 'org', repo: 'repo' }, before, after,
   { path: PATH, blobSha: 'e'.repeat(40), rule: 'private-key', door: 'push', expectedBefore: true, expectedAfter: false })).rejects.toThrow(/no refused push recorded/);
  await expect(verifyScannerChange({ db }, { owner: 'org', repo: 'repo' }, before, after,
   { path: PATH, blobSha: BLOB, rule: 'private-key', door: 'scan', expectedBefore: true, expectedAfter: false })).rejects.toThrow(/Not Found/);
 });
 it('the receipt key is per repository', () => {
  expect(refusalKey('Org', 'Repo')).toBe(refusalKey('org', 'repo'));
  expect(refusalKey('org', 'a')).not.toBe(refusalKey('org', 'b'));
 });
});
