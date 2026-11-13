// FIXTURE-EXCEPTION-1 (2026-11-13): the owner can allow one exact fake test value in one file on pushes.
// The exception follows the VALUE (path + rule + matched text), so edits elsewhere in the file keep it;
// a different value, path or rule is still refused. Credential-shaped inputs are built at runtime.
import { describe, expect, it } from 'vitest';
import { blockingPushFindings, evaluateFileProtection, valueFingerprint } from '../../src/github/file-protection.js';
import { findingFor } from '../../workers/native-git/upload.js';
import { scannerSettings } from '../../src/github/scanner-policy.js';
import { assertTuneCoverage } from '../../src/tools/scanner-verification.js';

const KEY = ['-----BEGIN', 'PRIVATE KEY-----\nMIIB\n-----END', 'PRIVATE KEY-----'].join(' ');
const OTHER_KEY = ['-----BEGIN', 'PRIVATE KEY-----\nMIIC\n-----END', 'PRIVATE KEY-----'].join(' ');
const PATH = 'test/acceptance.test.mjs', SHA = 'a'.repeat(40);
const fileWith = (value, extra = '') => `${extra}const planted = '${value.replace(/\n/g, '\\n')}';\n`;
const matchedIn = text => { const f = evaluateFileProtection({ path: PATH, sha: SHA, source: text, settings: scannerSettings({}) }).report.findings[0]; return f; };

describe('push exceptions for deliberate fake values', () => {
 it('the file-protection check reports a value fingerprint (never the value)', () => {
  const f = matchedIn(fileWith(KEY));
  expect(f.rule).toBe('private-key');
  expect(f.value_fingerprint).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(f)).not.toContain('MIIB');
 });
 it('blocks without an exception; allows the exact value with one, even after the file is edited elsewhere', () => {
  const text = fileWith(KEY), f = matchedIn(text);
  const settings = scannerSettings({ suppressions: [{ rule: 'private-key', path: PATH, blobSha: SHA, reason: 'planted fake key in a refusal test', pushException: true, valueFingerprint: f.value_fingerprint }] });
  expect(findingFor(PATH, Buffer.from(text))).not.toBeNull();
  expect(findingFor(PATH, Buffer.from(text), settings)).toBeNull();
  expect(findingFor(PATH, Buffer.from(fileWith(KEY, '// an unrelated edit above\n'.repeat(3))), settings)).toBeNull();
 });
 it('still refuses another value, another file, or a second credential added beside the excepted one', () => {
  const f = matchedIn(fileWith(KEY));
  const settings = scannerSettings({ suppressions: [{ rule: 'private-key', path: PATH, blobSha: SHA, reason: 'planted fake key in a refusal test', pushException: true, valueFingerprint: f.value_fingerprint }] });
  expect(findingFor(PATH, Buffer.from(fileWith(OTHER_KEY)), settings)).not.toBeNull();
  expect(findingFor('src/real.js', Buffer.from(fileWith(KEY)), settings)).not.toBeNull();
  const both = fileWith(KEY) + fileWith(OTHER_KEY);
  expect(blockingPushFindings(PATH, both, settings).length).toBe(1);
 });
 it('settings validation: a push exception needs its value fingerprint', () => {
  expect(() => scannerSettings({ suppressions: [{ rule: 'private-key', path: PATH, blobSha: SHA, reason: 'planted fake key', pushException: true }] })).toThrow(/value fingerprint/);
  expect(valueFingerprint(PATH, 'private-key', 'x')).not.toBe(valueFingerprint('other.js', 'private-key', 'x'));
 });
 it('a push exception must be proven through the push door', () => {
  const s = { rule: 'private-key', path: PATH, blobSha: SHA, reason: 'planted fake key', pushException: true, valueFingerprint: 'b'.repeat(64) };
  const before = scannerSettings({}), after = scannerSettings({ suppressions: [s] });
  const scanOnly = [{ rule: s.rule, path: PATH, blobSha: SHA, door: 'scan', before_detected: true, after_detected: false }];
  expect(() => assertTuneCoverage(before, after, scanOnly)).toThrow(/push door/);
  const viaPush = [{ rule: s.rule, path: PATH, blobSha: SHA, door: 'push', fingerprint: s.valueFingerprint, before_detected: true, after_detected: false }];
  expect(() => assertTuneCoverage(before, after, viaPush)).not.toThrow();
 });
});
