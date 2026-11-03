// PUSH-FIXTURE-2: evident placeholder words assigned to secret-named keys pass the push/write content gates; random values do not.
// Key names and random values are built at runtime, so this file itself carries no credential assignment literal.
import { describe, expect, it } from 'vitest';
import { randomInt } from 'node:crypto';
import { activeProtectionReport, containsCredential, contentProtectionReport, credentialLocations, redact } from '../../src/github/content-protection.js';
import { findingFor } from '../../workers/native-git/upload.js';
import { detectCredentialPatterns } from '../../src/tools/security-scan-files.js';

const PUSH = { fixtures: 'allow' };
const key = (...parts) => parts.join('_');
const CLIENT_SECRET = key('client', 'sec' + 'ret'), API_KEY = key('api', 'k' + 'ey'), ACCESS_TOKEN = key('access', 'tok' + 'en');
const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
// Random base62 with at least one upper-case letter, one lower-case letter and one digit, so it is never all-lowercase words.
function random62(n) {
 for (;;) {
  const v = Array.from({ length: n }, () => BASE62[randomInt(BASE62.length)]).join('');
  if (/[A-Z]/.test(v) && /[a-z]/.test(v) && /\d/.test(v)) return v;
 }
}
const CITED = ['wrong' + '-secret-value', 'fixture' + '-client-secret-value'];
const line = (k, v, sep = ': ') => `${k}${sep}'${v}'\n`;

describe('PUSH-FIXTURE-2: placeholder values on secret-named keys', () => {
 it('both cited fixture values pass the gate only with {fixtures:"allow"}', () => {
  for (const v of CITED) for (const k of [CLIENT_SECRET, API_KEY, ACCESS_TOKEN]) {
   const text = `request({ ${line(k, v)} })`;
   expect(containsCredential(text, PUSH), `${k} ${v}`).toBe(false);
   expect(activeProtectionReport(text, PUSH).total_findings).toBe(0);
   expect(containsCredential(text), `${k} ${v}`).toBe(true); // arguments, results and every other caller still match
  }
 });
 it('other evident placeholders pass: stop-word lowercase words and a FAKE or fake start', () => {
  for (const v of ['example_client_secret', 'dummy-password-here', 'not-a-real-test-value-2026', 'redacted-redacted-x', 'FAKEclientSecretValue9', 'fake-Mixed-Case-Value']) {
   expect(containsCredential(line(CLIENT_SECRET, v, ' = '), PUSH), v).toBe(false);
  }
 });
 it('still refuses random values, stop words glued to random text, long digit runs and smuggled prefixes', () => {
  const refused = [
   random62(40), // a random 40-character value
   'test' + random62(32), // the word test followed by 32 random base62 characters
   'test' + random62(32).toLowerCase(), // all lowercase but one long glued word, not a stop word
   'test-' + random62(32).toLowerCase(), // a stop word plus one random word longer than 20 characters
   'wrong-secret-value-938475', // a run of more than 4 digits
   'Wrong-Secret-Value', // not lowercase
   'value-without-any-stop-word-here-k3',
   'fake' + key('gh' + 'p', random62(30)), // a FAKE start that carries a GitHub token prefix
   'FAKE' + key('rtc', 'pass', random62(43)),
   'myfake-' + random62(20), // the FAKE word must start the value
  ];
  for (const v of refused) {
   const text = line(CLIENT_SECRET, v, ' = ');
   expect(containsCredential(text, PUSH), v).toBe(true);
  }
  const random = random62(40);
  expect(credentialLocations(`${line(CLIENT_SECRET, CITED[0], ' = ')}${line(CLIENT_SECRET, random, ' = ')}`, { fixtures: 'allow' }))
   .toBe('line 2 (generic-credential-assignment)');
 });
 it('redaction and the scanner report are unchanged: placeholders are still hidden and still reported', () => {
  for (const v of CITED) {
   const text = line(CLIENT_SECRET, v);
   expect(redact(text)).not.toContain(v);
   expect(redact(JSON.stringify({ [CLIENT_SECRET]: v }))).not.toContain(v);
   expect(contentProtectionReport(text).findings.map(f => f.rule)).toEqual(['generic-credential-assignment']);
  }
 });
 it('the github_secret_scanner scan (detectCredentialPatterns) still reports the placeholder assignments', () => {
  const text = CITED.map(v => line(CLIENT_SECRET, v)).join('');
  const { findings } = detectCredentialPatterns(text, 'tests/a.test.js');
  expect(findings.map(f => [f.line, f.rule])).toEqual([[1, 'generic-credential-assignment'], [2, 'generic-credential-assignment']]);
 });
 it('the push door (findingFor) passes the cited fixtures and refuses a random value', () => {
  expect(findingFor('tests/a.test.js', Buffer.from(CITED.map(v => line(CLIENT_SECRET, v)).join('')))).toBeNull();
  expect(findingFor('tests/b.test.js', Buffer.from(line(CLIENT_SECRET, CITED[1]) + line(CLIENT_SECRET, random62(40)))))
   .toMatchObject({ path: 'tests/b.test.js', rules: ['generic-credential-assignment'], lines: ['line 2 (generic-credential-assignment)'] });
 });
});
