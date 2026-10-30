// GOD-5: extra places. An account added with the person's master token (no App installed) behaves exactly like the master
// token: refused for read-only connections, service passes and narrowed scopes; read-only until the person allows changes;
// limited to the repositories the person named. Every other guard (protected resources) still applies.
import { describe, expect, it } from 'vitest';
import { githubFor, credentialFor } from '../../src/github/client.js';
import { createGates } from '../../src/tools/gates.js';
import { extraPlaceGate } from '../../src/tools/extra-place-guard.js';
import { productionEnabledGate } from '../../src/tools/production-guard.js';
import { createFakeDb } from '../../test/helpers/fake-db.js';
import { makeFakeGitHub } from '../../test/helpers/fake-github.js';

const PLACE = 'acme-co';
async function setup(connection = {}) {
  const gh = makeFakeGitHub();
  const db = createFakeDb({ clock: () => 1_800_000_000_000 });
  await db.initSchema();
  await db.upsertAccount({ login: 'example-org', accountId: 1, accountType: 'Organization', label: 'example-org', credentialKind: 'app', appId: 5 });
  const asked = [];
  const ctx = {
    db, fetch: gh.fetch, now: () => 1_800_000_000_000, retryAfterBaseValue: 1, sleep: async () => {},
    connection: { client_id: 'pcl_x', default_account: 'example-org', accounts: ['example-org', PLACE], mode: 'preview', profile: 'full', listing: 'compact', ...connection },
    credentials: { token: async (r) => { asked.push(r); return r.cred === 'M' ? 'ghp_FAKEmaster' : 'ghs_FAKEinstall'; } }
  };
  return { gh, db, ctx, asked };
}
const addPlace = (db, repo = null) => db.upsertExtraPlace({ login: PLACE, accountId: 77, accountType: 'Organization', repo });

describe('credentials for an extra place', () => {
  it('is the master token whatever the tool asked for', async () => {
    const { ctx, db, asked } = await setup();
    await addPlace(db);
    const out = await credentialFor(ctx, { owner: PLACE, cred: 'I' });
    expect(out.token).toBe('ghp_FAKEmaster');
    expect(asked.at(-1)).toMatchObject({ account: PLACE, cred: 'M' });
    // a normal connected account is untouched
    expect((await credentialFor(ctx, { owner: 'example-org', cred: 'I' })).token).toBe('ghs_FAKEinstall');
  });
  it('is refused for a read-only connection, a service pass and a narrowed scope, exactly like the master token', async () => {
    const a = await setup({ profile: 'read_only' }); await addPlace(a.db);
    await expect(credentialFor(a.ctx, { owner: PLACE })).rejects.toMatchObject({ code: 'outside_scope' });
    const b = await setup({ pass: true }); await addPlace(b.db);
    await expect(credentialFor(b.ctx, { owner: PLACE })).rejects.toMatchObject({ code: 'outside_scope' });
    const c = await setup(); await addPlace(c.db);
    await expect(credentialFor(c.ctx, { owner: PLACE, scope: { repositories: ['website'] } })).rejects.toMatchObject({ code: 'outside_scope' });
    await expect(credentialFor(c.ctx, { owner: PLACE, scope: { permissions: { contents: 'read' } } })).rejects.toMatchObject({ code: 'outside_scope' });
  });
  it('says the place needs the master token when none is enrolled', async () => {
    const { ctx, db } = await setup(); await addPlace(db);
    ctx.credentials = { token: async () => '' };
    await expect(credentialFor(ctx, { owner: PLACE })).rejects.toMatchObject({ code: 'no_credentials', message: expect.stringMatching(/needs your master token/) });
  });
});

describe('what a request on an extra place may do', () => {
  it('reads work on a new place, but every change is refused until changes are allowed', async () => {
    const { ctx, db, gh } = await setup(); await addPlace(db);
    gh.when('GET /repos/{owner}/{repo}').reply(200, { id: 1 });
    gh.when('POST /repos/{owner}/{repo}/issues').reply(201, { number: 3 });
    const octokit = await githubFor(ctx, { owner: PLACE });
    expect((await octokit.request('GET /repos/{owner}/{repo}', { owner: PLACE, repo: 'website' })).status).toBe(200);
    await expect(octokit.request('POST /repos/{owner}/{repo}/issues', { owner: PLACE, repo: 'website', title: 't' })).rejects.toMatchObject({ code: 'outside_scope', message: expect.stringMatching(/Changes are off/) });
    expect(gh.calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    await db.setPlaceChanges(PLACE, true);
    const again = await githubFor(ctx, { owner: PLACE });
    expect((await again.request('POST /repos/{owner}/{repo}/issues', { owner: PLACE, repo: 'website', title: 't' })).status).toBe(201);
  });
  it('a place limited to named repositories refuses every other repository, owner-level addresses and GraphQL', async () => {
    const { ctx, db, gh } = await setup(); await addPlace(db, 'website');
    gh.when('GET /repos/{owner}/{repo}').reply(200, { id: 1 });
    gh.when('GET /orgs/{org}/repos').reply(200, []);
    gh.when('POST /graphql').reply(200, { data: {} });
    const octokit = await githubFor(ctx, { owner: PLACE });
    expect((await octokit.request('GET /repos/{owner}/{repo}', { owner: PLACE, repo: 'Website' })).status).toBe(200);
    await expect(octokit.request('GET /repos/{owner}/{repo}', { owner: PLACE, repo: 'secret-stuff' })).rejects.toMatchObject({ code: 'outside_scope', message: expect.stringMatching(/not one of the places you added/) });
    await expect(octokit.request('GET /repos/{owner}/{repo}', { owner: 'someone-else', repo: 'website' })).rejects.toMatchObject({ code: 'outside_scope' });
    await expect(octokit.request('GET /orgs/{org}/repos', { org: PLACE })).rejects.toMatchObject({ code: 'outside_scope' });
    await expect(octokit.request('POST /graphql', { query: 'query { viewer { login } }' })).rejects.toMatchObject({ code: 'outside_scope' });
    expect(gh.calls.map((c) => c.route)).toEqual(['GET /repos/{owner}/{repo}']);
  });
  it('adding the same place again widens its list; adding the whole owner clears the limit; a connected account is never replaced', async () => {
    const { db } = await setup();
    await addPlace(db, 'website'); await addPlace(db, 'api'); await addPlace(db, 'api');
    expect((await db.getAccount(PLACE)).allowed_repos.sort()).toEqual(['api', 'website']);
    await addPlace(db, null);
    expect((await db.getAccount(PLACE)).allowed_repos).toBeNull();
    expect(await db.upsertExtraPlace({ login: 'example-org', accountId: 99, accountType: 'Organization' })).toBeNull();
    expect((await db.getAccount('example-org')).credential_kind).toBe('app');
  });
});

describe('the extra-place gate', () => {
  const run = async (db, target) => extraPlaceGate()({ ctx: { db }, target });
  it('refuses a write while changes are off, in plain words, and allows it once they are on', async () => {
    const { db } = await setup(); await addPlace(db);
    const refused = await run(db, { owner: PLACE, repo: 'website' });
    expect(refused).toMatchObject({ by: 'extra place' });
    expect(refused.refuse).toMatch(/Changes are off for acme-co.*allow changes.*My connection/);
    await db.setPlaceChanges(PLACE, true);
    expect(await run(db, { owner: PLACE, repo: 'website' })).toBeNull();
  });
  it('limits a repository place to its list and refuses owner-level writes there', async () => {
    const { db } = await setup(); await addPlace(db, 'website'); await db.setPlaceChanges(PLACE, true);
    expect(await run(db, { owner: PLACE, repo: 'website' })).toBeNull();
    expect((await run(db, { owner: PLACE, repo: 'other' })).refuse).toMatch(/not one of the repositories you added/);
    expect((await run(db, { owner: PLACE })).refuse).toMatch(/changes to the account itself are not allowed/);
  });
  it('does nothing for a connected account', async () => {
    const { db } = await setup();
    expect(await run(db, { owner: 'example-org', repo: 'x' })).toBeNull();
    expect(await run(db, {})).toBeNull();
  });
  it('is in the guard list, ahead of the protected-resource gate, and a protected repository on an extra place is still refused', async () => {
    const { db } = await setup(); await addPlace(db); await db.setPlaceChanges(PLACE, true);
    await db.seedProtectedResources([{ kind: 'repo', target: 'acme-co/guarded', level: 'locked', reason: 'test' }]);
    const gates = createGates();
    expect(gates.length).toBeGreaterThanOrEqual(5);
    let verdict = null;
    for (const gate of gates) {
      verdict = await gate({ name: 'github_content_put_file', args: {}, ctx: { db, connection: { mode: 'preview' } }, target: { owner: PLACE, repo: 'guarded', scope: 'repo' }, classification: {}, declarations: {}, before: {} });
      if (verdict) break;
    }
    expect(verdict).toMatchObject({ by: 'protected resource' });
  });
});

describe('production changes on an extra place', () => {
  const prod = async (db, target, connection = { mode: 'production', pass: true }) => productionEnabledGate()({ ctx: { db, connection }, target, classification: { production: 'it changes the default branch' } });
  it('are authorized by the person allowing changes for that place, and by nothing else', async () => {
    const { db } = await setup(); await addPlace(db);
    // changes are off: the extra-place gate refuses first; the production gate alone would also refuse
    expect(await prod(db, { owner: PLACE, repo: 'website' })).toMatchObject({ by: 'production switch' });
    await db.setPlaceChanges(PLACE, true);
    expect(await prod(db, { owner: PLACE, repo: 'website' })).toBeNull();
    // a connected account still needs its own production switch
    expect(await prod(db, { owner: 'example-org', repo: 'x' })).toMatchObject({ by: 'production switch' });
    // a normal sign-in connection is not vetoed by the per-account switch (owner decision 2026-10-27)
    expect(await prod(db, { owner: 'example-org', repo: 'x' }, { mode: 'production', profile: 'everyday' })).toBeNull();
  });
});

