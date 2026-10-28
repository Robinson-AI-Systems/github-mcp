import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../../src/db.js';
import { githubFor } from '../../src/github/client.js';
import { openIsolatedSchema, closeIsolatedSchema, neonShapedQuery, rawQuery } from '../../test/helpers/pg-neon-adapter.js';
import { makeFakeGitHub } from '../../test/helpers/fake-github.js';

const CONNECTION = Object.freeze({ client_id: 'c', default_account: 'example-org', accounts: Object.freeze(['example-org']), mode: 'preview', profile: 'everyday', listing: 'catalog' });

let dbA;
let dbB;
beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL must point to disposable localhost Postgres (npm run test:db)');
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(process.env.TEST_DATABASE_URL).hostname)) throw new Error('Refusing non-local Postgres in tests');
  await openIsolatedSchema(process.env.TEST_DATABASE_URL);
  dbA = createDb(neonShapedQuery()); // two handlers = two server instances sharing one database
  dbB = createDb(neonShapedQuery());
  await dbA.initSchema();
});
afterAll(async () => { await closeIsolatedSchema(); });
beforeEach(async () => { await rawQuery('TRUNCATE gh_write_slots, gh_rate_state, gh_etag_cache'); });

function instance(db, gh, sleeps) {
  return {
    connection: CONNECTION, db, fetch: gh.fetch, retryAfterBaseValue: 1,
    sleep: async (ms) => { sleeps.push(ms); },
    credentials: { token: async () => 'ghs_FAKEinstallationtoken' }
  };
}

describe('GitHub client on throwaway Postgres only', () => {
  it('two overlapping writes on one installation, from two instances, get slots at least a second apart', async () => {
    const gh = makeFakeGitHub();
    gh.when('POST /repos/{owner}/{repo}/issues').reply(201, { number: 1 });
    const sleepsA = [];
    const sleepsB = [];
    // Verify genuinely overlapping database slot claims, not a fragile
    // assumption that independent credential/ETag preflight ends in <100ms.
    // Both requests must arrive at the slot allocator before either
    // reserves; the original >=900ms wait assertion remains unchanged.
    let arrived = 0;
    let release;
    const together = new Promise((resolve) => { release = resolve; });
    const simultaneous = (db) => ({
      ...db,
      claimWriteSlot: async (...args) => {
        if (++arrived === 2) release();
        await together;
        return db.claimWriteSlot(...args);
      }
    });
    const a = await githubFor(instance(simultaneous(dbA), gh, sleepsA), {});
    const b = await githubFor(instance(simultaneous(dbB), gh, sleepsB), {});
    await Promise.all([
      a.request('POST /repos/{owner}/{repo}/issues', { owner: 'example-org', repo: 'hello', title: 'from A' }),
      b.request('POST /repos/{owner}/{repo}/issues', { owner: 'example-org', repo: 'hello', title: 'from B' })
    ]);
    expect(gh.calls).toHaveLength(2);
    const waits = [...sleepsA, ...sleepsB, 0].sort((x, y) => x - y); // the first writer needs no wait (and does not sleep)
    expect(sleepsA.length + sleepsB.length).toBe(1);
    expect(waits.at(-1)).toBeGreaterThanOrEqual(900);
    expect(waits.at(-1)).toBeLessThanOrEqual(1100);
  });

  it('a different installation (account) is not delayed by the first', async () => {
    const gh = makeFakeGitHub();
    gh.when('POST /repos/{owner}/{repo}/issues').reply(201, { number: 1 });
    const sleeps = [];
    const both = { ...CONNECTION, accounts: ['example-org', 'example-user'] };
    const ctx = { ...instance(dbA, gh, sleeps), connection: both };
    await (await githubFor(ctx, { owner: 'example-org' })).request('POST /repos/{owner}/{repo}/issues', { owner: 'example-org', repo: 'hello', title: 'one' });
    await (await githubFor(ctx, { owner: 'example-user' })).request('POST /repos/{owner}/{repo}/issues', { owner: 'example-user', repo: 'hello', title: 'two' });
    expect(sleeps).toEqual([]);
  });

  it('a rate block written by one instance stops calls on another instance without touching GitHub', async () => {
    const gh = makeFakeGitHub();
    gh.when('GET /repos/{owner}/{repo}').reply(403, { message: 'You have exceeded a secondary rate limit.' }, { 'retry-after': '300' });
    const a = await githubFor(instance(dbA, gh, []), {});
    await expect(a.request('GET /repos/{owner}/{repo}', { owner: 'example-org', repo: 'hello' })).rejects.toMatchObject({ code: 'rate_limited' });
    expect(gh.calls).toHaveLength(1);
    const b = await githubFor(instance(dbB, gh, []), {});
    const error = await b.request('GET /repos/{owner}/{repo}', { owner: 'example-org', repo: 'hello' }).catch((e) => e);
    expect(error.code).toBe('rate_limited');
    expect(error.details.reset_display).toMatch(/ UTC$/);
    expect(gh.calls).toHaveLength(1);
    const [row] = await rawQuery(`SELECT blocked_until > now() AS blocked FROM gh_rate_state WHERE account = 'example-org' AND resource = 'core'`);
    expect(row.blocked).toBe(true);
  });

  it('an ETag 304 returns the body cached by another instance', async () => {
    const gh = makeFakeGitHub();
    gh.when('GET /repos/{owner}/{repo}/pulls/{pull_number}').replySequence([
      { status: 200, body: { number: 9, state: 'open' }, headers: { etag: 'W/"x"' } },
      { status: 304, headers: { etag: 'W/"x"' } }
    ]);
    const get = async (db) => (await githubFor(instance(db, gh, []), {})).request('GET /repos/{owner}/{repo}/pulls/{pull_number}',
      { owner: 'example-org', repo: 'hello', pull_number: 9, request: { etag: true } });
    expect((await get(dbA)).data).toEqual({ number: 9, state: 'open' });
    const second = await get(dbB);
    expect(second).toMatchObject({ status: 200, notModified: true, data: { number: 9, state: 'open' } });
    expect(gh.calls[1].headers['if-none-match']).toBe('W/"x"');
  });
});
