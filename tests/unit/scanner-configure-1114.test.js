// SCANNER-CONFIGURE-1114 (2026-11-14): a scanner configure whose suppression reason showed a
// postgres URL shape was refused by the settings check, but the write layer reported it as
// "The current state could not be read, so nothing was sent. Try again in a moment." The real
// reason was hidden and the advice (retry) could never work. Also: a push exception is written
// with valueFingerprint, but its verification case only took fingerprint.
// Credential-shaped inputs are built at runtime.
import { describe, expect, it } from 'vitest';
import { defineWrite } from '../../src/core/write.js';
import { makeWorld, parse } from '../../test/helpers/write-contract.js';
import { scannerSettings } from '../../src/github/scanner-policy.js';
import { verifyScannerChange, VERIFICATION_SCHEMA } from '../../src/tools/scanner-verification.js';

const URL_SHAPE = ['postgres', '://role:', 'hunter2', 'secretvalue', '@db.example.com/app'].join('');

describe('a request refused while reading the current state says why', () => {
  const tool = (thrown) => defineWrite({ name: 'github_x_readcheck', description: 'd', declarations: { production: 'never' },
    target: () => ({ owner: 'example-org', scope: 'org' }), read: async () => { throw thrown; }, classify: () => ({}), summarize: () => 's',
    apply: async () => ({}), readAfter: async () => null, verify: () => true, requestKey: () => 'rmcp_x_readcheck_' + Math.random(),
    classifyError: () => 'rejected', explain: (e) => e.message });

  it('our own refusal: the real message, invalid_request, not retryable, not "could not be read"', async () => {
    const w = await makeWorld({ gates: [] });
    const out = parse(await tool(new TypeError('Scanner settings accept rule structure, never credential values: addSuppressions[0].reason looks like it contains one.')).handler({ confirm: true }, w.ctx));
    expect(out).toMatchObject({ status: 'refused_by_guard', refusedBy: 'request', reason_code: 'invalid_request', retryable: false, no_change_sent: true });
    expect(out.error).toContain('addSuppressions[0].reason');
    expect(out.error).not.toMatch(/could not be read|Try again/);
    expect(out).not.toHaveProperty('production');
  });

  it('a dry run shows the same reason as its warning', async () => {
    const w = await makeWorld({ gates: [], mode: 'production' });
    const out = parse(await tool(new TypeError('That blob is not on GitHub and no refused push recorded it.')).handler({ dryRun: true }, w.ctx));
    expect(out.warning).toContain('no refused push recorded it');
  });

  it('a real read failure (network, or a bug in this server) still says the state could not be read', async () => {
    const w = await makeWorld({ gates: [], mode: 'production' });
    for (const e of [new TypeError('fetch failed'), new TypeError("Cannot read properties of undefined (reading 'x')"), Object.assign(new Error('boom'), { status: 502 })]) {
      const out = parse(await tool(e).handler({ confirm: true }, w.ctx));
      expect(out.refusedBy).toBe('read');
      expect(out.error).toMatch(/could not be read/);
    }
  });
});

describe('the settings check names the field holding credential-shaped text, never the text', () => {
  it('points at the suppression reason', () => {
    let message = '';
    try {
      scannerSettings({ addSuppressions: [{ rule: 'database-uri-password', path: 'a.py', blobSha: 'a'.repeat(40), reason: `comment shows ${URL_SHAPE}` }] });
    } catch (e) { message = e.message; }
    expect(message).toContain('addSuppressions[0].reason');
    expect(message).not.toContain('hunter2');
  });
  it('a plain reason passes', () => {
    expect(() => scannerSettings({ addSuppressions: [{ rule: 'database-uri-password', path: 'a.py', blobSha: 'a'.repeat(40), reason: 'a comment showing a postgres URL with a placeholder password' }] })).not.toThrow();
  });
});

describe('a verification case accepts valueFingerprint as well as fingerprint', () => {
  it('the schema allows it', () => {
    expect(VERIFICATION_SCHEMA.properties).toHaveProperty('valueFingerprint');
  });
  it('two different values are refused before anything is read', async () => {
    await expect(verifyScannerChange({}, { owner: 'o', repo: 'r' }, {}, {}, {
      path: 'a.py', blobSha: 'a'.repeat(40), rule: 'x', door: 'push', expectedBefore: true, expectedAfter: false,
      fingerprint: 'b'.repeat(64), valueFingerprint: 'c'.repeat(64),
    })).rejects.toThrow(/same thing/);
  });
});
