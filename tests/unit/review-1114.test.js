// Second Shift review, 2026-11-14 (github-mcp #633-#636): findings fixed.
import { describe, expect, it } from 'vitest';
import { describeGithubError, isInternalBug, isOwnRefusal } from '../../src/tools/errors.js';
import { saveRefusalReceipts } from '../../src/github/push-refusals.js';

describe('who failed: our refusal, our bug, or the network', () => {
  it('a fault in this server\'s own code is an internal error, never "request refused"', () => {
    for (const msg of ["Cannot read properties of undefined (reading 'suppressions')", 'x.map is not a function',
      'settings is not iterable', 'Maximum call stack size exceeded']) {
      const e = msg.startsWith('Maximum') ? new RangeError(msg) : new TypeError(msg);
      const d = describeGithubError(e);
      expect(d.kind, msg).toBe('internal_error');
      expect(d.todo).toMatch(/fault in the server, not in the request/);
      expect(isInternalBug(e)).toBe(true);
      expect(isOwnRefusal(e)).toBe(false);
    }
  });
  it('a refusal this server threw on purpose stays an invalid request', () => {
    const e = new TypeError('Use either suppressions (the whole new list) or addSuppressions/removeSuppressions, not both.');
    expect(describeGithubError(e).kind).toBe('invalid_request');
    expect(isOwnRefusal(e)).toBe(true);
  });
  it('a network failure is neither', () => {
    const e = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
    expect(describeGithubError(e).kind).toBe('network');
    expect(isOwnRefusal(e)).toBe(false);
    expect(isInternalBug(e)).toBe(false);
  });
  it('an error that carries a status (from GitHub) is never ours', () => {
    const e = Object.assign(new TypeError('Cannot read properties of undefined'), { status: 422 });
    expect(isInternalBug(e)).toBe(false);
    expect(isOwnRefusal(e)).toBe(false);
  });
});

describe('push refusal receipts are never lost silently', () => {
  const receipt = { path: 'a/b.py', blobSha: 'c'.repeat(40), rule: 'private-key', line: 1, valueFingerprint: 'd'.repeat(64) };
  it('a saved receipt says so', async () => {
    const m = new Map();
    const db = { getSetting: async (k) => m.get(k) ?? null, setSetting: async (k, v) => { m.set(k, v); } };
    expect(await saveRefusalReceipts(db, 'o', 'r', [receipt])).toEqual({ saved: 1 });
  });
  it('a failed save is reported and logged, without failing the push report', async () => {
    const logged = [];
    const db = { getSetting: async () => null, setSetting: async () => { throw new Error('database is read-only'); } };
    const out = await saveRefusalReceipts(db, 'o', 'r', [receipt], { log: (...a) => logged.push(a.join(' ')) });
    expect(out).toEqual({ saved: 0, error: 'the refusal receipt could not be saved' });
    expect(logged[0]).toMatch(/o\/r database is read-only/);
  });
});

import { defineWrite } from '../../src/core/write.js';
import { makeWorld, parse } from '../../test/helpers/write-contract.js';

describe('the write layer names who failed', () => {
  const tool = (thrown) => defineWrite({ name: 'github_x_fail', description: 'd', declarations: { production: 'never' },
    target: () => ({ owner: 'example-org', scope: 'org' }), read: async () => null, classify: () => ({}), summarize: () => 's',
    apply: async () => { throw thrown; }, readAfter: async () => null, verify: () => true, requestKey: () => 'rmcp_x_fail_' + Math.random(),
    classifyError: () => 'rejected', explain: (e) => e.message });
  it('our own refusal: rejected, invalid_request (not provider_rejected)', async () => {
    const w = await makeWorld({ gates: [] });
    const out = parse(await tool(new TypeError('Use either suppressions or addSuppressions, not both.')).handler({ confirm: true }, w.ctx));
    expect(out).toMatchObject({ status: 'rejected', reason_code: 'invalid_request' });
  });
  it('a bug in our code: uncertain internal_error (it may have stopped part-way), never "rejected"', async () => {
    const w = await makeWorld({ gates: [] });
    const out = parse(await tool(new TypeError("Cannot read properties of undefined (reading 'id')")).handler({ confirm: true }, w.ctx));
    expect(out).toMatchObject({ status: 'uncertain', reason_code: 'internal_error' });
    expect(out.warning).toMatch(/Check the current state/);
  });
  it('a refusal from GitHub stays provider_rejected', async () => {
    const w = await makeWorld({ gates: [] });
    const out = parse(await tool(Object.assign(new Error('Validation Failed'), { status: 422 })).handler({ confirm: true }, w.ctx));
    expect(out).toMatchObject({ status: 'rejected', reason_code: 'provider_rejected' });
  });
});
