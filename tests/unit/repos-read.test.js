import { describe, expect, it } from 'vitest';
import { createDispatch } from '../../src/tools/dispatch.js';
import { registry } from '../../src/tools/index.js';
import { makeWorld, parse } from '../../test/helpers/write-contract.js';

const R = { repo: 'hello' };
const repoBody = (extra = {}) => ({ full_name: 'example-org/hello', description: 'Hi', private: true, visibility: 'private', default_branch: 'trunk', topics: ['a'], archived: false, has_issues: true, allow_squash_merge: true, ...extra });

async function run(world, name, args) {
  const dispatch = createDispatch({ credentials: world.credentials, gates: [], fetch: world.gh.fetch, now: world.ctx.now, sleep: async () => {} });
  const result = await dispatch({ registry, name, args, connection: world.connection, db: world.db });
  return { result, body: result.isError ? null : (result.structuredContent ?? parse(result)) };
}

describe('repository read tools (D-1)', () => {
  it('github_repo_get reads the repository, the rules on its real default branch and the custom properties', async () => {
    const w = await makeWorld({ profile: 'read_only' });
    w.gh.when('GET /repos/{owner}/{repo}').reply(200, repoBody());
    w.gh.when('GET /repos/{owner}/{repo}/rules/branches/{branch}').reply(200, [{ type: 'pull_request' }, { type: 'deletion' }]);
    w.gh.when('GET /repos/{owner}/{repo}/properties/values').reply(200, [{ property_name: 'team', value: 'core' }]);
    const { body } = await run(w, 'github_repo_get', R);
    expect(body).toMatchObject({ full_name: 'example-org/hello', default_branch: 'trunk', default_branch_rules: { count: 2, types: ['pull_request', 'deletion'] }, custom_properties: { team: 'core' } });
    expect(w.gh.calls.find((c) => c.route === 'GET /repos/{owner}/{repo}/rules/branches/{branch}').params.branch).toBe('trunk');
    expect(w.gh.invalid).toEqual([]);
  });

  it('github_repo_get still answers when rules or properties cannot be read', async () => {
    const w = await makeWorld({ profile: 'read_only' });
    w.gh.when('GET /repos/{owner}/{repo}').reply(200, repoBody());
    w.gh.when('GET /repos/{owner}/{repo}/rules/branches/{branch}').reply(403, { message: 'no' });
    w.gh.when('GET /repos/{owner}/{repo}/properties/values').reply(404, { message: 'no' });
    const { body } = await run(w, 'github_repo_get', R);
    expect(body.default_branch_rules.unknown).toEqual(expect.any(String));
    expect(body.custom_properties).toBeNull();
  });

  it('github_repo_list uses the organization route for an organization, filters archived and summarises', async () => {
    const w = await makeWorld({ profile: 'read_only' });
    w.gh.when('GET /orgs/{org}/repos').reply(200, [repoBody(), repoBody({ full_name: 'example-org/old', archived: true })]);
    const { body } = await run(w, 'github_repo_list', { archived: 'exclude' });
    expect(body.count).toBe(1);
    expect(body.items[0]).toMatchObject({ full_name: 'example-org/hello', default_branch: 'trunk' });
    expect(w.gh.calls[0].query).toMatchObject({ type: 'all', sort: 'pushed' });
    expect(w.gh.invalid).toEqual([]);
  });

  it('github_repo_list uses the user route for a personal account', async () => {
    const w = await makeWorld({ profile: 'read_only' });
    await w.db.upsertAccount({ login: 'example-org', accountId: 1, accountType: 'User', label: 'x', credentialKind: 'fine_grained' });
    w.gh.when('GET /users/{username}/repos').reply(200, [repoBody()]);
    const { body } = await run(w, 'github_repo_list', {});
    expect(body.count).toBe(1);
    expect(w.gh.calls.at(-1).route).toBe('GET /users/{username}/repos');
    expect(body.public_only).toBe(true);
  });

  it('github_repo_list shows a personal account\'s PRIVATE repositories through the installation (PRIVATE-LIST-1)', async () => {
    const w = await makeWorld({ profile: 'read_only' });
    await w.db.upsertAccount({ login: 'example-org', accountId: 1, accountType: 'User', label: 'x', credentialKind: 'fine_grained' });
    const mine = (name, extra) => ({ ...repoBody({ full_name: `example-org/${name}`, ...extra }), name, owner: { login: 'example-org' } });
    w.gh.when('GET /installation/repositories').reply(200, { total_count: 3, repositories: [
      mine('open', { private: false, pushed_at: '2026-11-01T00:00:00Z' }), mine('secret', { private: true, pushed_at: '2026-11-10T00:00:00Z' }),
      { ...repoBody({ full_name: 'other/x' }), owner: { login: 'other' } }] });
    const { body } = await run(w, 'github_repo_list', {});
    expect(body.items.map((r) => r.full_name)).toEqual(['example-org/secret', 'example-org/open']);
    expect(body.public_only).toBeUndefined();
    const priv = (await run(w, 'github_repo_list', { type: 'private' })).body;
    expect(priv.items.map((r) => r.full_name)).toEqual(['example-org/secret']);
    expect(w.gh.calls.some((c) => c.route === 'GET /users/{username}/repos')).toBe(false);
  });

  it('refuses an account outside the connection in plain words', async () => {
    const w = await makeWorld({ profile: 'read_only' });
    const { result } = await run(w, 'github_repo_list', { owner: 'someone-else' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not one of the GitHub accounts');
    expect(w.gh.calls).toEqual([]);
  });

  it('github_repo_find searches only the connection\'s accounts and strips qualifiers the caller typed', async () => {
    const w = await makeWorld({ profile: 'read_only', accounts: ['example-org', 'example-owner'] });
    w.gh.when('GET /search/repositories').reply(200, { total_count: 1, items: [repoBody()] });
    const { body } = await run(w, 'github_repo_find', { text: 'hello user:evil' });
    expect(body.searched).toEqual(['example-org', 'example-owner']);
    expect(w.gh.calls.map((c) => c.query.q)).toEqual(['hello org:example-org', 'hello org:example-owner']);
    expect(w.gh.invalid).toEqual([]);
  });

  describe('insights', () => {
    const arrange = (w, statuses) => {
      w.gh.when('GET /repos/{owner}/{repo}/languages').reply(200, { JavaScript: 750, CSS: 250 });
      w.gh.when('GET /repos/{owner}/{repo}/contributors').reply(200, [{ login: 'octo', contributions: 9 }]);
      w.gh.when('GET /repos/{owner}/{repo}/community/profile').reply(200, { health_percentage: 71, files: { readme: { url: 'x' }, license: null } });
      w.gh.when('GET /repos/{owner}/{repo}/stats/commit_activity').replySequence(statuses);
    };
    const week = (total) => ({ total, week: 1, days: [0, 0, 0, 0, 0, 0, total] });
    it('summarises the four answers', async () => {
      const w = await makeWorld({ profile: 'read_only' });
      arrange(w, [{ status: 200, body: [week(3), week(2)] }]);
      const { body } = await run(w, 'github_repo_get_insights', R);
      expect(body).toMatchObject({ languages: { JavaScript: '75%', CSS: '25%' }, top_contributors: [{ login: 'octo', contributions: 9 }], community: { health_percentage: 71, has: { readme: true, license: false } }, commit_activity: { last_52_weeks: 5, last_4_weeks: 5 } });
    });
    it('retries GitHub\'s 202 at most three times, then says it is still computing', async () => {
      const w = await makeWorld({ profile: 'read_only' });
      arrange(w, [{ status: 202, body: {} }]);
      const { body } = await run(w, 'github_repo_get_insights', R);
      expect(w.gh.calls.filter((c) => c.route.endsWith('/stats/commit_activity'))).toHaveLength(3);
      expect(body.commit_activity.status).toContain('still computing');
    });
    it('uses the answer when GitHub finishes on the second try', async () => {
      const w = await makeWorld({ profile: 'read_only' });
      arrange(w, [{ status: 202, body: {} }, { status: 200, body: [week(4)] }]);
      const { body } = await run(w, 'github_repo_get_insights', R);
      expect(body.commit_activity.last_52_weeks).toBe(4);
    });
  });

  it('github_repo_get_traffic summarises views, clones, referrers and paths', async () => {
    const w = await makeWorld({ profile: 'read_only' });
    w.gh.when('GET /repos/{owner}/{repo}/traffic/views').reply(200, { count: 10, uniques: 4, views: [] });
    w.gh.when('GET /repos/{owner}/{repo}/traffic/clones').reply(200, { count: 5, uniques: 2, clones: [] });
    w.gh.when('GET /repos/{owner}/{repo}/traffic/popular/referrers').reply(200, [{ referrer: 'google.com', count: 3, uniques: 2 }]);
    w.gh.when('GET /repos/{owner}/{repo}/traffic/popular/paths').reply(200, [{ path: '/a', title: 'A', count: 3, uniques: 2 }]);
    const { body } = await run(w, 'github_repo_get_traffic', R);
    expect(body).toMatchObject({ views: { total: 10, unique: 4 }, clones: { total: 5, unique: 2 }, top_referrers: [{ referrer: 'google.com' }], top_paths: [{ path: '/a' }] });
    expect(w.gh.invalid).toEqual([]);
  });

  it('github_repo_list_activity passes the filters and names who did what', async () => {
    const w = await makeWorld({ profile: 'read_only' });
    w.gh.when('GET /repos/{owner}/{repo}/activity').reply(200, [{ activity_type: 'force_push', ref: 'refs/heads/x', actor: { login: 'octo' }, timestamp: '2026-10-10T10:00:00Z', before: 'a', after: 'b' }]);
    const { body } = await run(w, 'github_repo_list_activity', { ...R, activity_type: 'force_push' });
    expect(w.gh.calls[0].query).toMatchObject({ activity_type: 'force_push' });
    expect(body.items[0]).toMatchObject({ type: 'force_push', who: 'octo' });
    expect(w.gh.invalid).toEqual([]);
  });

  it('github_repo_get_custom_properties lists the values', async () => {
    const w = await makeWorld({ profile: 'read_only' });
    w.gh.when('GET /repos/{owner}/{repo}/properties/values').reply(200, [{ property_name: 'tier', value: 'gold' }]);
    expect((await run(w, 'github_repo_get_custom_properties', R)).body.properties).toEqual({ tier: 'gold' });
  });

  it('a GitHub 404 becomes a plain sentence, not a stack trace', async () => {
    const w = await makeWorld({ profile: 'read_only' });
    w.gh.when('GET /repos/{owner}/{repo}').reply(404, { message: 'Not Found' });
    const { result } = await run(w, 'github_repo_get', R);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Why:|Next:/);
  });
});
