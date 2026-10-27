import { describe, expect, it } from 'vitest';
import { createDispatch } from '../../src/tools/dispatch.js';
import { registry } from '../../src/tools/index.js';
import { createFakeDb } from '../../test/helpers/fake-db.js';
import { containsCredential, redact } from '../../src/tools/util.js';

async function run(mode, name = 'github_whoami', args = {}) {
  const db = createFakeDb();
  await db.initSchema();
  await db.upsertAccount({ login: 'example-org', accountId: 1, accountType: 'Organization', label: 'x', credentialKind: 'fine_grained' });
  await db.setSpendLimitCents('example-org', 1950);
  const connection = Object.freeze({ client_id: 'c', default_account: 'example-org', accounts: Object.freeze(['example-org']), mode, profile: 'read_only', listing: 'compact' });
  return createDispatch({}).call(null, { registry, name, args, connection, db });
}

describe('every tool result is shaped on the way out', () => {
  it('a production connection sees PRODUCTION first, a preview one does not', async () => {
    const live = (await run('production')).structuredContent;
    expect(Object.keys(live)[0]).toBe('mode');
    expect(live.mode).toBe('PRODUCTION');
    expect((await run('preview')).structuredContent.mode).toBe('PREVIEW');
  });
  it('whole cents gain a dollars twin and the text copy matches the structured copy', async () => {
    const res = await run('preview');
    expect(res.structuredContent.accounts[0].spend_limit_cents).toBe(1950);
    expect(res.structuredContent.accounts[0].spend_limit_display).toBe('$19.50');
    expect(JSON.parse(res.content[0].text)).toEqual(res.structuredContent);
  });
});

describe('credential-shaped repository text', () => {
  it('detects and redacts fake token patterns even without word boundaries in a minified file', () => {
    const fakeToken = 'ghp_FAKEonly_in_fake_tests_never_real_1234';
    const embedded = 'a'.repeat(100) + fakeToken + 'z'.repeat(100);
    expect(containsCredential(embedded)).toBe(true);
    expect(redact(embedded)).not.toContain(fakeToken);
    expect(containsCredential('prefixgithub_pat_FAKEonly_in_test0000suffix')).toBe(true);
  });
});
